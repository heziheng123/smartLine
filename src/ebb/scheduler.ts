// ============================================================
// Ebbinghaus 复习模块 - 任务调度核心算法
// 任务生成、去重、轮次计算、smartSpread、逾期处理
// ============================================================

import dayjs from 'dayjs';
import type { ReviewTask, ComplexityLevel, TagStat, TopicStat, EbbSettings } from './types';
import { getPointWeight, getIntervalsForComplexity } from './complexity';
import { todayStr, addDays, isBeforeDay, isAfterDay, diffDays, formatDate, getDayOfWeek } from '@/utils/dateSafe';

// ── 工具函数 ────────────────────────────────────────────────

/** 生成简单 ID（不依赖 uuid，足够前端使用） */
export function genId(prefix = 'eb'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 判断日期是否逾期（未完成且早于今天） */
export function isOverdue(task: ReviewTask): boolean {
  if (task.isCompleted) return false;
  if (!task.dueDate) return false;
  return isBeforeDay(task.dueDate, todayStr());
}

/** 判断是否今日到期 */
export function isDueToday(task: ReviewTask): boolean {
  return task.dueDate === todayStr();
}

// ── 轮次计算（带缓存） ──────────────────────────────────────

let roundCacheKey = '';
let roundCache = new Map<string, number>(); // taskId -> round
let totalRoundsCache = new Map<string, number>(); // topicName -> totalRounds

/**
 * 计算所有任务的轮次。
 * 同一 topicName 的任务按 dueDate 升序，第 i 个为第 i+1 轮。
 * 基于任务内容原文缓存，避免重复计算（不再使用哈希，避免碰撞）。
 */
export function computeRounds(tasks: ReviewTask[]): {
  roundMap: Map<string, number>;
  totalRoundsMap: Map<string, number>;
} {
  // 直接用原文字符串作 cache key，避免哈希碰撞导致返回错误轮次缓存
  const key = tasks
      .map((t) => `${t.id}|${t.topicName}|${t.dueDate ?? ''}`)
      .sort()
      .join(';');

  if (key === roundCacheKey) {
    return { roundMap: roundCache, totalRoundsMap: totalRoundsCache };
  }

  const roundMap = new Map<string, number>();
  const totalRoundsMap = new Map<string, number>();

  // 按 topicName 分组
  const byTopic = new Map<string, ReviewTask[]>();
  for (const t of tasks) {
    if (!byTopic.has(t.topicName)) byTopic.set(t.topicName, []);
    byTopic.get(t.topicName)!.push(t);
  }

  for (const [topic, group] of byTopic) {
    // 兜底：dueDate 可能为 undefined（脏数据），用空串占位避免 localeCompare 崩溃
    const sorted = [...group].sort((a, b) =>
      (a.dueDate ?? '').localeCompare(b.dueDate ?? ''),
    );
    sorted.forEach((t, i) => roundMap.set(t.id, i + 1));
    totalRoundsMap.set(topic, sorted.length);
  }

  roundCacheKey = key;
  roundCache = roundMap;
  totalRoundsCache = totalRoundsMap;
  return { roundMap, totalRoundsMap };
}

/**
 * 获取单个任务的轮次（运行时派生）
 */
export function getTaskRound(taskId: string, tasks: ReviewTask[]): number {
  const { roundMap } = computeRounds(tasks);
  return roundMap.get(taskId) ?? 0;
}

// ── 任务生成 ────────────────────────────────────────────────

export interface GenerateTasksInput {
  topicName: string;
  tag?: string;
  complexity?: ComplexityLevel;
  startDate: string;
  intervals: number[];
  outlineNodeId?: string;
}

export interface GenerateTasksResult {
  tasks: ReviewTask[];
  conflicts: number; // 去重时顺延的次数
}

/**
 * 生成复习任务。
 * 1. 校验输入
 * 2. 生成原始任务：dueDate = startDate + intervals[i] 天
 * 3. 去重：与同主题已有任务日期冲突时 +1 天
 *
 * @param existingTasks 已有任务（用于去重）
 * @param settings 全局设置（用于 smartSpread 负载均衡）
 */
export function generateTasks(
  input: GenerateTasksInput,
  existingTasks: ReviewTask[],
  settings?: EbbSettings,
): GenerateTasksResult {
  // 校验
  const errors = validateInput(input);
  if (errors.length > 0) {
    throw new Error(errors.join('; '));
  }

  let conflicts = 0;
  const tasks: ReviewTask[] = [];

  // 收集同主题已有日期集合
  const topicDates = new Set<string>();
  for (const t of existingTasks) {
    if (t.topicName === input.topicName) topicDates.add(t.dueDate);
  }

  for (let i = 0; i < input.intervals.length; i++) {
    const interval = input.intervals[i];
    let dueDate = addDays(input.startDate, interval);

    // 去重：同主题日期冲突时 +1 天
    while (topicDates.has(dueDate)) {
      dueDate = addDays(dueDate, 1);
      conflicts++;
    }

    // smartSpread：若启用设置，检查日负载
    if (settings) {
      const spread = smartSpreadDate(dueDate, existingTasks, input.topicName, settings, topicDates);
      if (spread !== dueDate) conflicts++;
      dueDate = spread;
    }

    topicDates.add(dueDate);

    tasks.push({
      id: genId('rt'),
      topicName: input.topicName,
      dueDate,
      isCompleted: false,
      tag: input.tag,
      outlineNodeId: input.outlineNodeId,
      complexity: input.complexity,
      smStatus: 'scheduled',
    });
  }

  return { tasks, conflicts };
}

/** 校验生成输入 */
export function validateInput(input: GenerateTasksInput): string[] {
  const errors: string[] = [];
  if (!input.topicName || !input.topicName.trim()) {
    errors.push('主题名称不能为空');
  }
  if (input.topicName && input.topicName.length > 100) {
    errors.push('主题名称不能超过 100 字');
  }
  if (!input.startDate || !dayjs(input.startDate).isValid()) {
    errors.push('起始日期无效');
  }
  if (!input.intervals || input.intervals.length === 0) {
    errors.push('间隔序列不能为空');
  }
  if (input.intervals) {
    for (let i = 0; i < input.intervals.length; i++) {
      const n = input.intervals[i];
      if (!Number.isInteger(n) || n < 1 || n > 1825) {
        errors.push(`间隔 ${n} 无效（应为 1-1825 的正整数）`);
      }
      if (i > 0 && n < input.intervals[i - 1]) {
        errors.push('间隔序列必须非递减');
        break;
      }
    }
  }
  return errors;
}

/**
 * smartSpread：若某日负载超限，向后顺延到满足负载的日期。
 * 最多顺延 maxSpreadDays 天，保证同主题间隔 ≥ minTopicGapDays。
 */
export function smartSpreadDate(
  initialDate: string,
  existingTasks: ReviewTask[],
  topicName: string,
  settings: EbbSettings,
  topicDates: Set<string>,
): string {
  const { dailyTaskLimit, dailyPointLimit, maxSpreadDays, minTopicGapDays } = settings;
  let date = initialDate;

  for (let offset = 0; offset <= maxSpreadDays; offset++) {
    const candidate = offset === 0 ? date : addDays(date, offset);
    date = candidate;

    // 同主题日期冲突
    if (topicDates.has(candidate)) continue;

    // 同主题最小间隔校验
    if (minTopicGapDays > 0) {
      const sameTopicTasks = existingTasks.filter((t) => t.topicName === topicName);
      const tooClose = sameTopicTasks.some((t) => {
        const d = Math.abs(diffDays(candidate, t.dueDate));
        return d < minTopicGapDays && d > 0;
      });
      if (tooClose) continue;
    }

    // 日任务数负载
    const dayTasks = existingTasks.filter((t) => t.dueDate === candidate);
    if (dayTasks.length >= dailyTaskLimit) continue;

    // 日积分负载
    const dayPoints = dayTasks.reduce((sum, t) => {
      const round = getTaskRound(t.id, existingTasks);
      return sum + (t.complexity ? getPointWeight(round, t.complexity, settings.complexityConfigs) : 0);
    }, 0);
    if (dayPoints >= dailyPointLimit) continue;

    return candidate;
  }

  // 全部失败：返回原始日期
  return initialDate;
}

// ── 完成顺序约束 ────────────────────────────────────────────

/**
 * 检查是否可以完成指定任务（必须按轮次顺序）。
 * @returns 错误消息；为空表示可以完成
 */
export function checkCanComplete(
  taskId: string,
  tasks: ReviewTask[],
): string | null {
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return '任务不存在';
  if (task.isCompleted) return null; // 已完成，允许取消

  const { roundMap, totalRoundsMap } = computeRounds(tasks);
  const currentRound = roundMap.get(taskId) ?? 0;
  const totalRounds = totalRoundsMap.get(task.topicName) ?? 0;

  // 检查是否有未完成的前序轮次
  for (const t of tasks) {
    if (t.topicName !== task.topicName) continue;
    const r = roundMap.get(t.id) ?? 0;
    if (r < currentRound && !t.isCompleted) {
      return `需先完成第 ${r} 轮（共 ${totalRounds} 轮）`;
    }
  }
  return null;
}

// ── 统计计算 ────────────────────────────────────────────────

/**
 * 计算标签统计
 */
export function computeTagStats(tasks: ReviewTask[]): TagStat[] {
  const map = new Map<string, ReviewTask[]>();
  for (const t of tasks) {
    const tag = t.tag || '';
    if (!map.has(tag)) map.set(tag, []);
    map.get(tag)!.push(t);
  }

  const stats: TagStat[] = [];
  for (const [tag, group] of map) {
    const total = group.length;
    const completed = group.filter((t) => t.isCompleted).length;
    const pending = total - completed;
    const overdue = group.filter(isOverdue).length;
    stats.push({
      tag,
      total,
      completed,
      pending,
      overdue,
      ratio: total > 0 ? completed / total : 0,
    });
  }
  // 无标签组排最后
  return stats.sort((a, b) => {
    if (a.tag === '' && b.tag !== '') return 1;
    if (a.tag !== '' && b.tag === '') return -1;
    return a.tag.localeCompare(b.tag);
  });
}

/**
 * 计算主题统计（矩阵视图行）
 */
export function computeTopicStats(
  tasks: ReviewTask[],
  settings?: EbbSettings,
): TopicStat[] {
  const { roundMap, totalRoundsMap } = computeRounds(tasks);
  const byTopic = new Map<string, ReviewTask[]>();
  for (const t of tasks) {
    if (!byTopic.has(t.topicName)) byTopic.set(t.topicName, []);
    byTopic.get(t.topicName)!.push(t);
  }

  const stats: TopicStat[] = [];
  for (const [topicName, group] of byTopic) {
    const totalRounds = totalRoundsMap.get(topicName) ?? group.length;
    const completedRounds = group.filter((t) => t.isCompleted).length;
    const overdueRounds = group.filter(isOverdue).length;
    const pendingRounds = totalRounds - completedRounds;
    const futurePending = group
      .filter((t) => !t.isCompleted && !isOverdue(t))
      .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    const nextDueDate = futurePending[0]?.dueDate;

    let earnedPoints = 0;
    let totalPoints = 0;
    for (const t of group) {
      const round = roundMap.get(t.id) ?? 0;
      if (t.complexity) {
        const w = settings
          ? getPointWeight(round, t.complexity, settings.complexityConfigs)
          : getPointWeight(round, t.complexity);
        totalPoints += w;
        if (t.isCompleted) earnedPoints += w;
      }
    }

    const firstTask = group[0];
    stats.push({
      topicName,
      tag: firstTask?.tag,
      complexity: firstTask?.complexity,
      totalRounds,
      completedRounds,
      pendingRounds,
      overdueRounds,
      nextDueDate,
      totalPoints,
      earnedPoints,
      ratio: totalRounds > 0 ? completedRounds / totalRounds : 0,
    });
  }

  return stats.sort((a, b) => a.topicName.localeCompare(b.topicName));
}

/**
 * 计算今日积分
 */
export function calcTodayPoints(tasks: ReviewTask[], settings?: EbbSettings): number {
  const today = todayStr();
  const { roundMap } = computeRounds(tasks);
  let sum = 0;
  for (const t of tasks) {
    if (t.dueDate !== today) continue;
    if (!t.isCompleted || !t.complexity) continue;
    const round = roundMap.get(t.id) ?? 0;
    sum += settings
      ? getPointWeight(round, t.complexity, settings.complexityConfigs)
      : getPointWeight(round, t.complexity);
  }
  return sum;
}

/**
 * 计算本周积分
 */
export function calcWeekPoints(tasks: ReviewTask[], settings?: EbbSettings): number {
  const { roundMap } = computeRounds(tasks);
  const now = dayjs();
  // 用本地分量拼接周一和周日的日期字符串，避免 dayjs('YYYY-MM-DD') 偏移
  const weekStart = now.startOf('week').add(1, 'day');
  const weekEnd = weekStart.add(6, 'day');
  const weekStartStr = `${weekStart.year()}-${String(weekStart.month() + 1).padStart(2, '0')}-${String(weekStart.date()).padStart(2, '0')}`;
  const weekEndStr = `${weekEnd.year()}-${String(weekEnd.month() + 1).padStart(2, '0')}-${String(weekEnd.date()).padStart(2, '0')}`;
  let sum = 0;
  for (const t of tasks) {
    if (!t.isCompleted || !t.complexity) continue;
    if (isBeforeDay(t.dueDate, weekStartStr) || isAfterDay(t.dueDate, weekEndStr)) continue;
    const round = roundMap.get(t.id) ?? 0;
    sum += settings
      ? getPointWeight(round, t.complexity, settings.complexityConfigs)
      : getPointWeight(round, t.complexity);
  }
  return sum;
}

// ── 日期标签智能显示 ────────────────────────────────────────

/**
 * 生成日期标签文本与颜色类
 */
export function getDateLabel(
  dateStr: string,
  isCompleted: boolean,
): { text: string; variant: 'future' | 'overdue' | 'today' | 'tomorrow' | 'yesterday' | 'completed' } {
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const yesterday = addDays(today, -1);

  if (isCompleted) {
    return { text: formatDate(dateStr, 'M月D日'), variant: 'completed' };
  }
  if (dateStr === today) return { text: '今天', variant: 'today' };
  if (dateStr === tomorrow) return { text: '明天', variant: 'tomorrow' };
  if (dateStr === yesterday) return { text: '昨天', variant: 'yesterday' };
  if (isBeforeDay(dateStr, today)) return { text: formatDate(dateStr, 'M月D日'), variant: 'overdue' };
  return { text: formatDate(dateStr, 'M月D日'), variant: 'future' };
}

/**
 * 基于已完成轮次推算新轮次的间隔。
 * 简单策略：取最近完成轮次与上一轮的差值 + 1。
 */
export function suggestNextInterval(
  completedRounds: number,
  complexity?: ComplexityLevel,
  customIntervals?: number[],
): number {
  // 优先使用复杂度预设的下一个间隔
  if (complexity) {
    const preset = getIntervalsForComplexity(complexity);
    const idx = Math.min(completedRounds, preset.length - 1);
    if (idx >= 0) return preset[idx];
  }
  // 其次使用自定义间隔
  if (customIntervals && customIntervals.length > 0) {
    const idx = Math.min(completedRounds, customIntervals.length - 1);
    return customIntervals[idx];
  }
  // 兜底：默认 7 天
  return 7;
}

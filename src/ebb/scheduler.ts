// ============================================================
// Ebbinghaus 复习模块 - 任务调度核心算法
// 任务生成、去重、轮次计算、smartSpread、逾期处理
// ============================================================

import dayjs from 'dayjs';
import type { ReviewTask, ComplexityLevel, TagStat, TopicStat, EbbSettings } from './types';
import { getPointWeight, getIntervalsForComplexity, parseIntervals } from './complexity';
import { todayStr, addDays, isBeforeDay, isAfterDay, diffDays, formatDate } from '@/utils/dateSafe';

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
let totalRoundsCache = new Map<string, number>(); // topicKey -> totalRounds

/**
 * Separates graph-backed review chains even when different nodes share a display name.
 * Legacy tasks without a graph node continue to use their topic name as the key.
 */
export function getReviewTopicKey(task: Pick<ReviewTask, 'graphNodeId' | 'topicName'>): string {
  return task.graphNodeId ? `graph:${task.graphNodeId}` : `topic:${task.topicName}`;
}

/**
 * Adds stable round identities to legacy tasks that predate roundOrder.
 * Missing values are assigned deterministically from the original schedule,
 * so every later reschedule keeps the same round identity.
 */
export function normalizeReviewRoundOrders(tasks: ReviewTask[]): ReviewTask[] {
  const byTopic = new Map<string, ReviewTask[]>();
  for (const task of tasks) {
    if (task.isArchived) continue;
    const topicKey = getReviewTopicKey(task);
    const group = byTopic.get(topicKey) ?? [];
    group.push(task);
    byTopic.set(topicKey, group);
  }

  const assigned = new Map<string, number>();
  for (const group of byTopic.values()) {
    let nextOrder = Math.max(0, ...group.map((task) => task.roundOrder ?? 0)) + 1;
    const missing = group
      .filter((task) => !Number.isInteger(task.roundOrder) || task.roundOrder! <= 0)
      .sort((a, b) =>
        (a.originalDueDate ?? a.dueDate ?? '').localeCompare(b.originalDueDate ?? b.dueDate ?? '')
        || a.id.localeCompare(b.id),
      );
    missing.forEach((task) => assigned.set(task.id, nextOrder++));
  }

  if (assigned.size === 0) return tasks;
  return tasks.map((task) => assigned.has(task.id)
    ? { ...task, roundOrder: assigned.get(task.id)! }
    : task);
}

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
  const activeTasks = tasks.filter((task) => !task.isArchived);
  const key = activeTasks
      .map((t) => `${t.id}|${getReviewTopicKey(t)}|${t.roundOrder ?? 0}`)
      .sort()
      .join(';');

  if (key === roundCacheKey) {
    return { roundMap: roundCache, totalRoundsMap: totalRoundsCache };
  }

  const roundMap = new Map<string, number>();
  const totalRoundsMap = new Map<string, number>();

  // 按稳定主题键分组
  const byTopic = new Map<string, ReviewTask[]>();
  for (const t of activeTasks) {
    const topicKey = getReviewTopicKey(t);
    if (!byTopic.has(topicKey)) byTopic.set(topicKey, []);
    byTopic.get(topicKey)!.push(t);
  }

  for (const [topic, group] of byTopic) {
    // roundOrder is stable across reschedules. The date/id fallback only serves
    // un-migrated data while it is being normalized by the store.
    const sorted = [...group].sort((a, b) =>
      (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER)
      || (a.originalDueDate ?? a.dueDate ?? '').localeCompare(b.originalDueDate ?? b.dueDate ?? '')
      || a.id.localeCompare(b.id),
    );
    sorted.forEach((t, i) => roundMap.set(t.id, t.roundOrder ?? i + 1));
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

/**
 * Build one additional round for an existing review chain.
 * The new round always inherits the chain identity (including graphNodeId),
 * and is scheduled after both today and the current last round.
 */
export function buildNextRoundTask(
  topicTasks: ReviewTask[],
  settings: EbbSettings,
): ReviewTask | null {
  const activeTasks = topicTasks.filter((task) => !task.isArchived);
  const sortedTasks = [...activeTasks].sort((a, b) =>
    (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.id.localeCompare(b.id),
  );
  const lastTask = sortedTasks[sortedTasks.length - 1];
  if (!lastTask) return null;

  const customIntervals = parseIntervals(settings.customIntervals) ?? undefined;
  const nextInterval = suggestNextInterval(
    sortedTasks.length,
    lastTask.complexity,
    customIntervals,
    settings.complexityConfigs,
  );

  const today = todayStr();
  const baseDate = isAfterDay(lastTask.dueDate, today) ? lastTask.dueDate : today;
  let dueDate = addDays(baseDate, nextInterval);
  const occupiedDates = new Set(sortedTasks.map((task) => task.dueDate));
  while (occupiedDates.has(dueDate)) {
    dueDate = addDays(dueDate, 1);
  }

  return {
    id: genId('rt'),
    topicName: lastTask.topicName,
    dueDate,
    originalDueDate: dueDate,
    roundOrder: Math.max(0, ...activeTasks.map((task) => task.roundOrder ?? 0)) + 1,
    isCompleted: false,
    tag: lastTask.tag,
    outlineNodeId: lastTask.outlineNodeId,
    graphNodeId: lastTask.graphNodeId,
    complexity: lastTask.complexity,
    smStatus: 'scheduled',
  };
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
      originalDueDate: dueDate,
      roundOrder: Math.max(
        0,
        ...existingTasks
          .filter((task) => task.topicName === input.topicName && !task.isArchived)
          .map((task) => task.roundOrder ?? 0),
      ) + tasks.length + 1,
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
  for (let offset = 0; offset <= maxSpreadDays; offset++) {
    // Each candidate is measured from the original planned date. Advancing from
    // the previous candidate would accumulate offsets (+0, +1, +3, +6, ...).
    const candidate = offset === 0 ? initialDate : addDays(initialDate, offset);

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
  const task = tasks.find((t) => t.id === taskId && !t.isArchived);
  if (!task) return '任务不存在';
  if (task.isCompleted) return null; // 已完成，允许取消

  const { roundMap, totalRoundsMap } = computeRounds(tasks);
  const currentRound = roundMap.get(taskId) ?? 0;
  const topicKey = getReviewTopicKey(task);
  const totalRounds = totalRoundsMap.get(topicKey) ?? 0;

  // 检查是否有未完成的前序轮次
  for (const t of tasks) {
    if (t.isArchived) continue;
    if (getReviewTopicKey(t) !== topicKey) continue;
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
    const topicKey = getReviewTopicKey(t);
    if (!byTopic.has(topicKey)) byTopic.set(topicKey, []);
    byTopic.get(topicKey)!.push(t);
  }

  const stats: TopicStat[] = [];
  for (const [topicKey, group] of byTopic) {
    const topicName = group[0]?.topicName ?? '';
    const totalRounds = totalRoundsMap.get(topicKey) ?? group.length;
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
      topicKey,
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
  // Keep Sunday in the week that is ending. startOf('week') is Sunday,
  // so calculate the distance from the current day back to Monday.
  const daysSinceMonday = (now.day() + 6) % 7;
  const weekStart = now.subtract(daysSinceMonday, 'day').startOf('day');
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
  existingRounds: number,
  complexity?: ComplexityLevel,
  customIntervals?: number[],
  customConfigs?: EbbSettings['complexityConfigs'],
): number {
  // 手动追加轮次优先使用设置页中的“默认复习间隔”。
  if (customIntervals && customIntervals.length > 0) {
    const idx = Math.min(existingRounds, customIntervals.length - 1);
    return customIntervals[idx];
  }
  // 兼容没有默认间隔配置的旧数据：回退到复杂度预设。
  if (complexity) {
    const preset = getIntervalsForComplexity(complexity, customConfigs);
    const idx = Math.min(existingRounds, preset.length - 1);
    if (idx >= 0) return preset[idx];
  }
  // 兜底：默认 7 天
  return 7;
}

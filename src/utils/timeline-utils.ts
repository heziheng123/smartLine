// ============================================================
// Smart Timeline - 时间轴工具函数
// ============================================================

import dayjs from 'dayjs';
import { makeLocalDayjs, splitDate } from '@/utils/dateSafe';
import type {
  TaskWithLayout,
  MonthLayout,
  Note,
  NoteSegment,
  Milestone,
  MilestoneInMonth,
  TaskGroup,
  GroupRange,
} from '@/types';

// ── 布局常量 ──────────────────────────────────────────────

/** 任务行高 */
export const ROW_HEIGHT = 34;
/** 任务条高度 */
export const BAR_HEIGHT = 24;

/**
 * 时间轴标准主题色（5 套同色系）
 * 同色系绑定原则：外层"分组"与内部"任务"使用同一套主题。
 * - groupColor:  分组外框 & 分组标签背景色
 * - taskBorder:  内部任务边框颜色（用于任务条箭头/强调色/左右细边框）
 * - taskText:    内部任务文字颜色
 * - taskBg:      内部任务浅背景色（任务条填充）
 *
 * 特殊说明：索引 4（红色主题）为主线任务专用，isMain=true 的任务优先使用该主题。
 */
export interface TimelineTheme {
  groupColor: string;
  taskBorder: string;
  taskText: string;
  taskBg: string;
}

export const TIMELINE_THEMES: TimelineTheme[] = [
  { groupColor: '#60A5FA', taskBorder: '#3B82F6', taskText: '#1D4ED8', taskBg: '#DBEAFE' },
  { groupColor: '#A78BFA', taskBorder: '#8B5CF6', taskText: '#5B21B6', taskBg: '#EDE9FE' },
  { groupColor: '#34D399', taskBorder: '#10B981', taskText: '#047857', taskBg: '#D1FAE5' },
  { groupColor: '#FBBF24', taskBorder: '#F59E0B', taskText: '#B45309', taskBg: '#FEF3C7' },
  // 红色主题（索引 4）：主线任务专用，浅红背景 + 深红文字/边框
  { groupColor: '#F87171', taskBorder: '#EF4444', taskText: '#991B1B', taskBg: '#FEE2E2' },
];

/** 主线任务红色主题索引（TIMELINE_THEMES[4]） */
export const MAIN_TASK_THEME_IDX = 4;

/** 任务浅背景预设色（取自各主题 taskBg，供任务色板使用） */
export const TASK_BG_PRESET = TIMELINE_THEMES.map((t) => t.taskBg);
/** 分组色预设（取自各主题 groupColor，供分组色板使用） */
export const GROUP_COLOR_PRESET = TIMELINE_THEMES.map((t) => t.groupColor);

/** taskBg -> 主题 的反查缓存，O(1) 查表 */
const TASK_BG_INDEX: Map<string, TimelineTheme> = (() => {
  const m = new Map<string, TimelineTheme>();
  for (const t of TIMELINE_THEMES) {
    m.set(t.taskBg.toLowerCase(), t);
  }
  return m;
})();

/** 根据 taskBg 反查所属主题，O(1) 查表 */
export function findThemeByTaskBg(taskBg: string): TimelineTheme | undefined {
  return TASK_BG_INDEX.get((taskBg || '').toLowerCase());
}

/** 旧版莫兰迪色系，仅作历史数据回退用 */
const LEGACY_MORANDI_PALETTE: [string, string][] = [
  ['#E0F2FE', '#0369A1'],
  ['#D1FAE5', '#047857'],
  ['#FFE4E6', '#BE123C'],
  ['#FEF3C7', '#B45309'],
  ['#EDE9FE', '#6D28D9'],
  ['#FFEDD5', '#C2410C'],
  ['#CFFAFE', '#0E7490'],
  ['#FCE7F3', '#BE185D'],
  ['#ECFCCB', '#4D7C0F'],
  ['#F3E8FF', '#7E22CE'],
];

function clampHex(c: string): string {
  let v = (c || '').trim().replace('#', '');
  if (/^[0-9a-fA-F]{3}$/.test(v)) {
    v = v.split('').map((x) => x + x).join('');
  }
  return /^[0-9a-fA-F]{6}$/.test(v) ? v : '';
}

function brightnessOf(hex: string): number {
  const v = clampHex(hex);
  if (!v) return 0;
  const r = parseInt(v.substring(0, 2), 16);
  const g = parseInt(v.substring(2, 4), 16);
  const b = parseInt(v.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

function darkenHex(hex: string, factor: number): string {
  const v = clampHex(hex);
  if (!v) return '#9F1239';
  const r = parseInt(v.substring(0, 2), 16);
  const g = parseInt(v.substring(2, 4), 16);
  const b = parseInt(v.substring(4, 6), 16);
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

/** 通用回退：根据背景色计算深色文字/边框色（兼容历史数据） */
export function getBorderColor(bgColor: string): string {
  if (!bgColor) return '#9F1239';
  const legacy = LEGACY_MORANDI_PALETTE.find(([bg]) => bg === bgColor);
  if (legacy) return legacy[1];
  const factor = brightnessOf(bgColor) > 150 ? 0.35 : 0.7;
  return darkenHex(bgColor, factor);
}

/** 内部任务文字颜色：同主题深文字（兼容变体色），否则回退 */
export function getTaskTextColor(taskBg: string): string {
  const theme = findThemeByTaskBg(taskBg);
  return theme ? theme.taskText : getBorderColor(taskBg);
}

/** 内部任务边框颜色：同主题边框色（兼容变体色），否则回退 */
export function getTaskBorderColor(taskBg: string): string {
  const theme = findThemeByTaskBg(taskBg);
  return theme ? theme.taskBorder : getBorderColor(taskBg);
}

/** 分组色 -> 主题 的反查缓存 */
const GROUP_COLOR_INDEX: Map<string, TimelineTheme> = (() => {
  const m = new Map<string, TimelineTheme>();
  for (const t of TIMELINE_THEMES) m.set(t.groupColor.toLowerCase(), t);
  return m;
})();

/** 分组外框颜色：规范规定外框 = 分组色本身 */
export function getGroupBorderColor(groupColor: string): string {
  if (!groupColor) return '#9F1239';
  const theme = GROUP_COLOR_INDEX.get(groupColor.toLowerCase());
  return theme ? theme.groupColor : getBorderColor(groupColor);
}

/** 分组标签文字颜色：在分组色背景上保证可读 */
export function getGroupLabelTextColor(groupColor: string): string {
  if (!groupColor) return '#FFFFFF';
  if (brightnessOf(groupColor) > 170) {
    const theme = GROUP_COLOR_INDEX.get(groupColor.toLowerCase());
    return theme ? theme.taskText : getBorderColor(groupColor);
  }
  return '#FFFFFF';
}

// ── 月份工具 ──────────────────────────────────────────────

export function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

export const MONTH_NAMES = [
  '1月', '2月', '3月', '4月', '5月', '6月',
  '7月', '8月', '9月', '10月', '11月', '12月',
];

export function isWeekend(year: number, month: number, day: number): boolean {
  const dow = new Date(year, month, day).getDay();
  return dow === 0 || dow === 6;
}

// ── 核心：任务切割算法 ────────────────────────────────────

export function sliceTasksForYear(
  tasks: TaskWithLayout[],
  year: number
): MonthLayout[] {
  const months: MonthLayout[] = Array.from({ length: 12 }, (_, m) => ({
    month: m,
    daysInMonth: getDaysInMonth(year, m),
    segments: [],
    noteSegments: [],
    milestones: [],
    groupRanges: [],
    totalRows: 0,
  }));

  const yearStart = makeLocalDayjs(`${year}-01-01`);
  const yearEnd = makeLocalDayjs(`${year}-12-31`);

  for (const task of tasks) {
    const tStart = makeLocalDayjs(task.start);
    const tEnd = makeLocalDayjs(task.end);

    if (!tStart.isValid() || !tEnd.isValid()) continue;
    if (tEnd.isBefore(yearStart) || tStart.isAfter(yearEnd)) continue;

    const startMonth = tStart.year() === year ? tStart.month() : 0;
    const endMonth = tEnd.year() === year ? tEnd.month() : 11;

    for (let m = startMonth; m <= endMonth; m++) {
      const segStart =
        m === startMonth && tStart.year() === year ? tStart.date() : 1;
      const segEnd =
        m === endMonth && tEnd.year() === year ? tEnd.date() : months[m].daysInMonth;

      const isStart = m === startMonth && tStart.year() === year;
      const isEnd = m === endMonth && tEnd.year() === year;

      // 颜色选择逻辑：
      // 1. 主线任务（isMain）：优先使用红色主题（浅红背景 #FEE2E2），除非用户显式设置了自定义颜色
      // 2. 普通任务：优先使用任务自带颜色，否则按 id 轮询标准主题浅背景（前 4 套）
      const colorIdx = parseInt(task.id.slice(0, 16), 16) || 0;
      const safeIdx = colorIdx % (TIMELINE_THEMES.length - 1); // 普通任务只用前 4 套，排除红色主题
      const bgColor = task.isMain
        ? task.color ?? TIMELINE_THEMES[MAIN_TASK_THEME_IDX].taskBg
        : task.color ?? TIMELINE_THEMES[safeIdx].taskBg;

      months[m].segments.push({
        taskId: task.id,
        taskName: task.name,
        color: bgColor,
        month: m,
        startDay: segStart,
        endDay: segEnd,
        row: task.row,
        isStart,
        isEnd,
        isMain: task.isMain,
        completed: task.completed,
        groupId: task.groupId,
      });

      // 每月动态计算：该月出现的任务最大行号 + 1
      months[m].totalRows = Math.max(months[m].totalRows, task.row + 1);
    }
  }

  return months;
}

// ── 便签切割算法 ──────────────────────────────────────────

export function sliceNotesForYear(
  notes: Note[],
  year: number
): NoteSegment[][] {
  const yearStart = makeLocalDayjs(`${year}-01-01`);
  const yearEnd = makeLocalDayjs(`${year}-12-31`);

  // 12个月的便签片段数组
  const result: NoteSegment[][] = Array.from({ length: 12 }, () => []);

  for (const note of notes) {
    const nStart = makeLocalDayjs(note.date);
    const nEnd = note.endDate ? makeLocalDayjs(note.endDate) : nStart;

    if (nEnd.isBefore(yearStart) || nStart.isAfter(yearEnd)) continue;

    const startMonth = nStart.year() === year ? nStart.month() : 0;
    const endMonth = nEnd.year() === year ? nEnd.month() : 11;

    for (let m = startMonth; m <= endMonth; m++) {
      const segStart =
        m === startMonth && nStart.year() === year ? nStart.date() : 1;
      const segEnd =
        m === endMonth && nEnd.year() === year ? nEnd.date() : getDaysInMonth(year, m);

      result[m].push({
        noteId: note.id,
        noteName: note.name,
        color: note.color || '#F59E0B',
        type: note.type,
        month: m,
        startDay: segStart,
        endDay: segEnd,
      });
    }
  }

  return result;
}

// ── 里程碑映射 ────────────────────────────────────────────

export function mapMilestonesForYear(
  milestones: Milestone[],
  year: number
): MilestoneInMonth[][] {
  const result: MilestoneInMonth[][] = Array.from({ length: 12 }, () => []);

  for (const ms of milestones) {
    const d = makeLocalDayjs(ms.date);
    if (d.year() !== year) continue;

    result[d.month()].push({
      milestoneId: ms.id,
      milestoneName: ms.name,
      color: ms.color || '#FBBF24',
      day: d.date(),
    });
  }

  return result;
}

// ── 分组范围计算 ──────────────────────────────────────────

export function computeGroupRangesForYear(
  groups: TaskGroup[],
  tasks: TaskWithLayout[],
  year: number
): GroupRange[][] {
  const yearStart = makeLocalDayjs(`${year}-01-01`);
  const yearEnd = makeLocalDayjs(`${year}-12-31`);

  const result: GroupRange[][] = Array.from({ length: 12 }, () => []);

  for (const group of groups) {
    // 计算分组日期范围
    let gStart = makeLocalDayjs(group.start);
    let gEnd = makeLocalDayjs(group.end);

    if (group.autoDate && group.children.length > 0) {
      const childStarts = group.children.map((c) => makeLocalDayjs(c.start).valueOf());
      const childEnds = group.children.map((c) => makeLocalDayjs(c.end).valueOf());
      gStart = dayjs(Math.min(...childStarts));
      gEnd = dayjs(Math.max(...childEnds));
    }

    // 非法日期（空字符串/无效格式）直接跳过，避免渲染成横跨整年的错误分组框
    if (!gStart.isValid() || !gEnd.isValid()) continue;
    if (gEnd.isBefore(yearStart) || gStart.isAfter(yearEnd)) continue;

    // 找到分组内任务在布局中的行范围
    const childIds = new Set(group.children.map((c) => c.id));
    const groupTasks = tasks.filter((t) => childIds.has(t.id));

    if (groupTasks.length === 0) continue;

    const startMonth = gStart.year() === year ? gStart.month() : 0;
    const endMonth = gEnd.year() === year ? gEnd.month() : 11;

    // 预计算每个分组任务的 [startMs, endMs, row]，避免月份循环内重复创建 dayjs
    const groupTaskMs: Array<{ startMs: number; endMs: number; row: number }> = [];
    for (const t of groupTasks) {
      const ts = makeLocalDayjs(t.start);
      const te = makeLocalDayjs(t.end);
      if (!ts.isValid() || !te.isValid()) continue;
      groupTaskMs.push({ startMs: ts.valueOf(), endMs: te.valueOf(), row: t.row });
    }
    if (groupTaskMs.length === 0) continue;

    for (let m = startMonth; m <= endMonth; m++) {
      const daysInMonth = getDaysInMonth(year, m);
      const monthStartMs = new Date(year, m, 1).getTime();
      const monthEndMs = new Date(year, m, daysInMonth, 23, 59, 59, 999).getTime();
      // 只取该月实际出现的分组任务，计算当月行范围（避免空行）
      const monthTasks = groupTaskMs.filter(
        (t) => t.endMs >= monthStartMs && t.startMs <= monthEndMs
      );
      if (monthTasks.length === 0) continue;

      const rowStart = Math.min(...monthTasks.map((t) => t.row));
      const rowEnd = Math.max(...monthTasks.map((t) => t.row));

      const segStart =
        m === startMonth && gStart.year() === year ? gStart.date() : 1;
      const segEnd =
        m === endMonth && gEnd.year() === year ? gEnd.date() : daysInMonth;

      result[m].push({
        groupId: group.id,
        groupName: group.name,
        color: group.color || TIMELINE_THEMES[0].groupColor,
        startDay: segStart,
        endDay: segEnd,
        rowStart,
        rowEnd,
      });
    }
  }

  return result;
}

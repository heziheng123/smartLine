// ============================================================
// Smart Timeline - 时间轴工具函数
// ============================================================

import dayjs from 'dayjs';
import type {
  TaskWithLayout,
  TaskSegment,
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
 * 莫兰迪色系（高明度浅背景 + 同色系深文字）
 * 每组：[浅背景色, 深文字/边框色]
 */
const MORANDI_PALETTE: [string, string][] = [
  ['#E0F2FE', '#0369A1'], // 天青
  ['#D1FAE5', '#047857'], // 薄荷
  ['#FFE4E6', '#BE123C'], // 蜜桃
  ['#FEF3C7', '#B45309'], // 琥珀
  ['#EDE9FE', '#6D28D9'], // 薰衣草
  ['#FFEDD5', '#C2410C'], // 珊瑚
  ['#CFFAFE', '#0E7490'], // 冰川
  ['#FCE7F3', '#BE185D'], // 樱草
  ['#ECFCCB', '#4D7C0F'], // 苔藓
  ['#F3E8FF', '#7E22CE'], // 紫藤
];

/** 根据背景色获取对应的边框/文字色 */
export function getBorderColor(bgColor: string): string {
  const idx = MORANDI_PALETTE.findIndex(([bg]) => bg === bgColor);
  if (idx >= 0) return MORANDI_PALETTE[idx][1];
  // fallback：计算深版本（确保至少 30% 亮度差）
  let c = (bgColor || '').trim().replace('#', '');
  if (/^[0-9a-fA-F]{3}$/.test(c)) {
    c = c.split('').map(x => x + x).join('');
  }
  if (!/^[0-9a-fA-F]{6}$/.test(c)) {
    return '#9F1239';
  }
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  // 按亮度对比度缩放：浅色用 0.35 倍，深色用 0.7 倍
  const factor = brightness > 150 ? 0.35 : 0.7;
  const dr = Math.round(r * factor);
  const dg = Math.round(g * factor);
  const db = Math.round(b * factor);
  return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
}

/**
 * 主线任务配色：浅红背景 + 深红文字
 */
export const MAIN_TASK_BG = '#FEE2E2';
export const MAIN_TASK_TEXT = '#991B1B';

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

  const yearStart = dayjs(`${year}-01-01`);
  const yearEnd = dayjs(`${year}-12-31`);

  for (const task of tasks) {
    const tStart = dayjs(task.start);
    const tEnd = dayjs(task.end);

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

      // 主线任务使用浅红背景，否则使用莫兰迪色
      const colorIdx = parseInt(task.id.slice(0, 1), 16) || 0;
      const safeIdx = colorIdx % MORANDI_PALETTE.length;
      const bgColor = task.isMain
        ? MAIN_TASK_BG
        : (task.color ?? MORANDI_PALETTE[safeIdx][0]);

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
  const yearStart = dayjs(`${year}-01-01`);
  const yearEnd = dayjs(`${year}-12-31`);

  // 12个月的便签片段数组
  const result: NoteSegment[][] = Array.from({ length: 12 }, () => []);

  for (const note of notes) {
    const nStart = dayjs(note.date);
    const nEnd = note.endDate ? dayjs(note.endDate) : nStart;

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
    const d = dayjs(ms.date);
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
  const yearStart = dayjs(`${year}-01-01`);
  const yearEnd = dayjs(`${year}-12-31`);

  const result: GroupRange[][] = Array.from({ length: 12 }, () => []);

  for (const group of groups) {
    // 计算分组日期范围
    let gStart = dayjs(group.start);
    let gEnd = dayjs(group.end);

    if (group.autoDate && group.children.length > 0) {
      const childStarts = group.children.map((c) => dayjs(c.start).valueOf());
      const childEnds = group.children.map((c) => dayjs(c.end).valueOf());
      gStart = dayjs(Math.min(...childStarts));
      gEnd = dayjs(Math.max(...childEnds));
    }

    if (gEnd.isBefore(yearStart) || gStart.isAfter(yearEnd)) continue;

    // 找到分组内任务在布局中的行范围
    const childIds = new Set(group.children.map((c) => c.id));
    const groupTasks = tasks.filter((t) => childIds.has(t.id));

    if (groupTasks.length === 0) continue;

    const rowStart = Math.min(...groupTasks.map((t) => t.row));
    const rowEnd = Math.max(...groupTasks.map((t) => t.row));

    const startMonth = gStart.year() === year ? gStart.month() : 0;
    const endMonth = gEnd.year() === year ? gEnd.month() : 11;

    for (let m = startMonth; m <= endMonth; m++) {
      const segStart =
        m === startMonth && gStart.year() === year ? gStart.date() : 1;
      const segEnd =
        m === endMonth && gEnd.year() === year ? gEnd.date() : getDaysInMonth(year, m);

      result[m].push({
        groupId: group.id,
        groupName: group.name,
        color: group.color || '#D1FAE5',
        startDay: segStart,
        endDay: segEnd,
        rowStart,
        rowEnd,
      });
    }
  }

  return result;
}

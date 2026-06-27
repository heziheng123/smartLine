// ============================================================
// Smart Timeline - 智能行合并布局算法（分组感知版）
// ============================================================

import dayjs from 'dayjs';
import type { TimelineData, Task, TaskWithLayout, LayoutResult } from '@/types';

/** 分组之间不留整行缓冲（避免浪费垂直空间），改由渲染层加视觉间隔 */
const GROUP_BUFFER_ROWS = 0;

/**
 * 判断两个日期范围是否重叠（结束日期为包含当天）
 * 区间视为 [start, end+1)，即结束日期占满整天
 */
function dateRangesOverlap(
  aStart: number, aEnd: number,
  bStart: number, bEnd: number
): boolean {
  return aStart < bEnd + 86400000 && aEnd + 86400000 > bStart;
}

/**
 * 对一组任务执行智能行合并（Smart Row Packing）
 *
 * - 主线任务(isMain=true)优先排列在低行号
 * - 其余任务按 start 日期升序贪心放入第一个不重叠的行
 * - 所有行号加上 rowOffset 偏移量
 *
 * @returns 该组任务占用的行数
 */
function packTasks(
  taskList: Task[],
  rowOffset: number,
  result: TaskWithLayout[],
): number {
  if (taskList.length === 0) return 0;

  const mainTasks = taskList.filter((t) => t.isMain);
  const normalTasks = taskList.filter((t) => !t.isMain);

  const sortedMain = [...mainTasks].sort(
    (a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf()
  );
  const sortedNormal = [...normalTasks].sort(
    (a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf()
  );

  const localRows: TaskWithLayout[][] = [];

  function tryPlace(task: Task): void {
    const taskStart = dayjs(task.start).valueOf();
    const taskEnd = dayjs(task.end).valueOf();

    let placed = false;
    for (let rowIdx = 0; rowIdx < localRows.length; rowIdx++) {
      const overlaps = localRows[rowIdx].some((existing) => {
        const exStart = dayjs(existing.start).valueOf();
        const exEnd = dayjs(existing.end).valueOf();
        return dateRangesOverlap(taskStart, taskEnd, exStart, exEnd);
      });

      if (!overlaps) {
        const placedTask: TaskWithLayout = { ...task, row: rowIdx + rowOffset };
        localRows[rowIdx].push(placedTask);
        result.push(placedTask);
        placed = true;
        break;
      }
    }

    if (!placed) {
      const placedTask: TaskWithLayout = { ...task, row: localRows.length + rowOffset };
      localRows.push([placedTask]);
      result.push(placedTask);
    }
  }

  for (const task of sortedMain) tryPlace(task);
  for (const task of sortedNormal) tryPlace(task);

  return localRows.length;
}

/**
 * 核心布局算法：分组感知的智能行合并
 *
 * 排列顺序：
 * 1. 未分组的主线任务 → 最顶部（优先低行号）
 * 2. 各分组任务 → 每个分组占独立行块，组间留 GROUP_BUFFER_ROWS 空行
 * 3. 未分组的普通任务 → 最底部
 *
 * 由于不同分组的行范围天然不重叠（中间有缓冲空行），
 * 渲染时的虚线边框不会重叠，且框间有明确间隔。
 */
export function calculateLayout(data: TimelineData): LayoutResult {
  const { tasks } = data;

  if (tasks.length === 0) {
    return { tasks: [], totalRows: 0 };
  }

  const result: TaskWithLayout[] = [];
  let cursor = 0;

  // ── 按分组归类任务 ──────────────────────────────────
  const groupedTasks = new Map<string, Task[]>();
  const ungroupedMain: Task[] = [];
  const ungroupedNormal: Task[] = [];

  for (const task of tasks) {
    if (task.groupId) {
      if (!groupedTasks.has(task.groupId)) groupedTasks.set(task.groupId, []);
      groupedTasks.get(task.groupId)!.push(task);
    } else if (task.isMain) {
      ungroupedMain.push(task);
    } else {
      ungroupedNormal.push(task);
    }
  }

  // ── 1. 未分组主线任务（最优先） ─────────────────────
  if (ungroupedMain.length > 0) {
    cursor += packTasks(ungroupedMain, cursor, result);
  }

  // ── 2. 各分组独立行块（按最早任务开始日期排序） ──────
  const groupEntries = Array.from(groupedTasks.entries())
    .map(([groupId, gTasks]) => ({
      groupId,
      tasks: gTasks,
      earliest: Math.min(...gTasks.map((t) => dayjs(t.start).valueOf())),
    }))
    .sort((a, b) => a.earliest - b.earliest);

  for (const ge of groupEntries) {
    if (cursor > 0) cursor += GROUP_BUFFER_ROWS; // 组间缓冲空行
    cursor += packTasks(ge.tasks, cursor, result);
  }

  // ── 3. 未分组普通任务（最后） ───────────────────────
  if (ungroupedNormal.length > 0) {
    if (cursor > 0) cursor += GROUP_BUFFER_ROWS; // 与上方内容之间留缓冲
    cursor += packTasks(ungroupedNormal, cursor, result);
  }

  return { tasks: result, totalRows: cursor };
}

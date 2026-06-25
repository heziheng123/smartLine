// ============================================================
// Smart Timeline - 智能行合并布局算法
// ============================================================

import dayjs from 'dayjs';
import type { TimelineData, TaskWithLayout, LayoutResult } from '@/types';

/**
 * 判断两个日期范围是否重叠（结束日期为包含当天）
 * 区间视为 [start, end+1)，即结束日期占满整天
 */
function dateRangesOverlap(
  aStart: number, aEnd: number,
  bStart: number, bEnd: number
): boolean {
  // end+1天：结束日期是 inclusive 的，6月30日结束意味着占据到6月30日全天
  return aStart < bEnd + 86400000 && aEnd + 86400000 > bStart;
}

/**
 * 核心布局算法：智能行合并（Smart Row Packing）
 *
 * 1. 主线任务(isMain=true)优先排列在第0行
 * 2. 其余任务纯按日期重叠排布：
 *    a. 按 start 日期升序排序
 *    b. 贪心遍历：尝试将当前任务放入第一个不重叠的行
 *    c. 若所有现有行都重叠，则新增一行
 */
export function calculateLayout(data: TimelineData): LayoutResult {
  const { tasks } = data;

  if (tasks.length === 0) {
    return { tasks: [], totalRows: 0 };
  }

  // 分离主线任务和普通任务
  const mainTasks = tasks.filter((t) => t.isMain);
  const normalTasks = tasks.filter((t) => !t.isMain);

  // 普通任务按开始日期升序排序
  const sortedNormal = [...normalTasks].sort(
    (a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf()
  );

  const rows: TaskWithLayout[][] = [];
  const result: TaskWithLayout[] = [];

  // 先放置主线任务（贪心算法，优先尝试低行号）
  if (mainTasks.length > 0) {
    const sortedMain = [...mainTasks].sort(
      (a, b) => dayjs(a.start).valueOf() - dayjs(b.start).valueOf()
    );

    for (const task of sortedMain) {
      const taskStart = dayjs(task.start).valueOf();
      const taskEnd = dayjs(task.end).valueOf();

      let placed = false;
      for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
        const overlaps = rows[rowIdx].some((existing) => {
          const exStart = dayjs(existing.start).valueOf();
          const exEnd = dayjs(existing.end).valueOf();
          return dateRangesOverlap(taskStart, taskEnd, exStart, exEnd);
        });

        if (!overlaps) {
          const placedTask: TaskWithLayout = { ...task, row: rowIdx };
          rows[rowIdx].push(placedTask);
          result.push(placedTask);
          placed = true;
          break;
        }
      }

      if (!placed) {
        const placedTask: TaskWithLayout = { ...task, row: rows.length };
        rows.push([placedTask]);
        result.push(placedTask);
      }
    }
  }

  // 再放置普通任务（从已有行开始尝试）
  for (const task of sortedNormal) {
    const taskStart = dayjs(task.start).valueOf();
    const taskEnd = dayjs(task.end).valueOf();

    let placed = false;

    for (let rowIdx = 0; rowIdx < rows.length; rowIdx++) {
      const overlaps = rows[rowIdx].some((existing) => {
        const exStart = dayjs(existing.start).valueOf();
        const exEnd = dayjs(existing.end).valueOf();
        return dateRangesOverlap(taskStart, taskEnd, exStart, exEnd);
      });

      if (!overlaps) {
        const placedTask: TaskWithLayout = { ...task, row: rowIdx };
        rows[rowIdx].push(placedTask);
        result.push(placedTask);
        placed = true;
        break;
      }
    }

    if (!placed) {
      const placedTask: TaskWithLayout = { ...task, row: rows.length };
      rows.push([placedTask]);
      result.push(placedTask);
    }
  }

  return { tasks: result, totalRows: rows.length };
}

// ============================================================
// Smart Task Block 待办聚合 Hook
// 从所有 Task 的 blocks 中提取 SmartTaskBlock，
// 扁平化为与 AggregatedTodo 兼容的格式
// ============================================================

import { useMemo } from 'react';
import type { Task, TaskGroup, AggregatedTodo } from '@/types';
import {
  getQuantityInitialCompleted,
  getQuantityRecords,
  getQuantityTotal,
  getQuantityUnit,
  getSmartTaskBlocks,
  getValidGraphNodeIds,
  isQuantityTask,
} from '@/utils/blocks';
import { resolveTaskTheme } from '@/utils/timeline-utils';

/**
 * 接收全局 tasks 数组，解析每个任务的 SmartTaskBlock，
 * 返回扁平化的 AggregatedTodo 数组。
 * 与 useTodos (markdown) 返回格式完全一致，可在 DailyScheduleView 中混用。
 */
export function useSmartTaskTodos(tasks: Task[], groups: TaskGroup[] = []): AggregatedTodo[] {
  return useMemo(() => {
    // Build lookup maps so each task/group association is O(1) instead of O(n×m).
    const groupById = new Map<string, TaskGroup>();
    const groupByChildId = new Map<string, TaskGroup>();
    for (const g of groups) {
      groupById.set(g.id, g);
      for (const child of g.children ?? []) {
        groupByChildId.set(child.id, g);
      }
    }

    const all: AggregatedTodo[] = [];
    for (const task of tasks) {
      // Task.groupId is optional; only consult the primary map when defined to
      // avoid a TS error on passing undefined into Map<string, ...>.get().
      const group = (task.groupId !== undefined ? groupById.get(task.groupId) : undefined)
        ?? groupByChildId.get(task.id)
        ?? undefined;
      const projectTheme = resolveTaskTheme(task, group?.color);
      const blocks = task.blocks ?? [];
      const smartBlocks = getSmartTaskBlocks(blocks);

      for (const block of smartBlocks) {
        const h = block.header;
        if (h.isArchived || h.frozenAt) continue;
        all.push({
          id: `${task.id}-blk-${block.id}`,
          text: h.title,
          due: h.deadline,
          scheduled: h.date,
          start: h.date,
          created: undefined,
          doneDate: h.completedDate,
          checked: h.isCompleted,
          parentTaskId: task.id,
          parentTaskTitle: task.name,
          parentTaskColor: projectTheme.backgroundColor,
          parentTaskStart: task.start,
          parentTaskEnd: task.end,
          recurring: h.recurring,
          priority: undefined,
          // 附加 block 特有字段（方便 DailyScheduleView 展示）
          _blockId: block.id,
          _tag: h.tag,
          _tagColor: h.tagColor,
          _duration: h.duration,
          _complexity: h.complexity,
          _graphNodeId: h.graphNodeId,
          _graphNodeIds: getValidGraphNodeIds(h),
          _autoSyncEbb: h.autoSyncEbb,
          _taskKind: h.taskKind,
          _vocabularyTotalWords: h.vocabularyTotalWords,
          _vocabularyInitialCompletedWords: h.vocabularyInitialCompletedWords,
          _vocabularyRecords: h.vocabularyRecords,
          _quantityUnit: isQuantityTask(h) ? getQuantityUnit(h) : undefined,
          _quantityTotal: isQuantityTask(h) ? getQuantityTotal(h) : undefined,
          _quantityInitialCompleted: isQuantityTask(h) ? getQuantityInitialCompleted(h) : undefined,
          _quantityRecords: isQuantityTask(h) ? getQuantityRecords(h) : undefined,
        });
      }
    }

    return all;
  }, [tasks, groups]);
}

export default useSmartTaskTodos;

// ============================================================
// Smart Timeline - 待办聚合 Hook
// 从所有任务的 Markdown 详情中提取微观待办，扁平化为统一数组
// ============================================================

import { useMemo } from 'react';
import type { Task, AggregatedTodo } from '@/types';
import { extractTodos } from '@/utils/markdown';

/**
 * 接收全局 tasks 数组，解析每个任务 Markdown 中的待办事项，
 * 返回扁平化的 allTodos 数组。
 *
 * 每个 todo 包含：id / text / date / checked / parentTaskId / parentTaskTitle
 * 其中 id 为 `${parentTaskId}-${line}`（line 为待办在 Markdown 中的行号），
 * 保证全局唯一且可回溯到源任务。
 */
export function useTodos(tasks: Task[]): AggregatedTodo[] {
  return useMemo(() => {
    const all: AggregatedTodo[] = [];

    for (const task of tasks) {
      const md = task.markdown ?? '';
      if (!md.trim()) continue;

      const items = extractTodos(md);
      for (const item of items) {
        all.push({
          id: `${task.id}-${item.line}`,
          text: item.text,
          date: item.date,
          checked: item.done,
          parentTaskId: task.id,
          parentTaskTitle: task.name,
          parentTaskColor: task.color,
        });
      }
    }

    return all;
  }, [tasks]);
}

export default useTodos;

// ============================================================
// Smart Timeline - 待办聚合 Hook（Obsidian Tasks 兼容协议）
// 从所有任务的 Markdown 详情中提取微观待办，扁平化为统一数组
// ============================================================

import { useMemo, useRef } from 'react';
import type { Task, AggregatedTodo } from '@/types';
import { extractTodos } from '@/utils/markdown';

/**
 * 接收全局 tasks 数组，解析每个任务 Markdown 中的待办事项，
 * 返回扁平化的 allTodos 数组。
 *
 * 性能优化：维护 taskId -> { markdown, items } 缓存。
 * 仅当任务的 markdown 真正变化时才重新解析该任务的待办，
 * 避免任一任务字段变化就全量重算 extractTodos。
 *
 * 字段映射（Obsidian Tasks 协议）：
 *   - due:       📅 截止日（决定何时出现在 Daily Schedule）
 *   - scheduled: ⏳ 计划日
 *   - start:     🛫 开始日
 *   - created:   ➕ 创建日
 *   - doneDate:  ✅ 完成日
 *   - recurring: 🔁 循环规则
 *   - parentTaskStart/End: 用于智能越界警告
 */
interface CachedEntry {
  markdown: string;
  items: ReturnType<typeof extractTodos>;
}

export function useTodos(tasks: Task[]): AggregatedTodo[] {
  // 模块级缓存，跨多次调用复用。key = taskId。
  const cacheRef = useRef<Map<string, CachedEntry>>(new Map());

  return useMemo(() => {
    const all: AggregatedTodo[] = [];
    const cache = cacheRef.current;
    const seenIds = new Set<string>();

    for (const task of tasks) {
      seenIds.add(task.id);
      const md = task.markdown ?? '';

      let entry = cache.get(task.id);
      if (!entry || entry.markdown !== md) {
        // 仅 markdown 变化时重新解析，否则复用上次的 items
        entry = {
          markdown: md,
          items: md.trim() ? extractTodos(md) : [],
        };
        cache.set(task.id, entry);
      }

      const items = entry.items;
      for (const item of items) {
        all.push({
          id: `${task.id}-${item.line}`,
          text: item.text,
          due: item.due,
          scheduled: item.scheduled,
          start: item.start,
          created: item.created,
          doneDate: item.doneDate,
          checked: item.done,
          parentTaskId: task.id,
          parentTaskTitle: task.name,
          parentTaskColor: task.color,
          parentTaskStart: task.start,
          parentTaskEnd: task.end,
          recurring: item.recurring,
          priority: item.priority,
        });
      }
    }

    // 清理已被删除任务的缓存，避免内存泄漏
    if (cache.size > seenIds.size) {
      for (const id of cache.keys()) {
        if (!seenIds.has(id)) cache.delete(id);
      }
    }

    return all;
  }, [tasks]);
}

export default useTodos;

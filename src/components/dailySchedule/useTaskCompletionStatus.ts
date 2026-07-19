import { useCallback, useMemo } from 'react';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { parseSourceId } from './conversion';
import type { TaskSource } from './types';
import { useShallow } from 'zustand/react/shallow';

export function useTaskCompletionStatus() {
  const { tasks, groups } = useTimelineStore(
    useShallow((s) => ({ tasks: s.tasks, groups: s.groups })),
  );
  const ebbReviewTasks = useEbbStore((s) => s.reviewTasks);
  const tlTasks = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.id, task]));
    for (const group of groups) {
      for (const child of group.children) {
        if (!byId.has(child.id)) byId.set(child.id, child);
      }
    }
    return [...byId.values()];
  }, [tasks, groups]);

  const checkIsCompleted = useCallback((source: TaskSource, sourceId: string, date?: string) => {
    if (source === 'free') return false;
    
    const parsed = parseSourceId(sourceId);
    if (!parsed) return false;

    if (parsed.source === 'review') {
      const reviewTask = ebbReviewTasks.find((t) => t.id === parsed.reviewId);
      return reviewTask ? reviewTask.isCompleted : false;
    }
    
    if (parsed.source === 'project') {
      const parentTask = tlTasks.find((t) => t.id === parsed.parentTaskId);
      if (!parentTask || !parentTask.blocks) return false;
      
      if (parsed.blockId) {
        const block = parentTask.blocks.find(b => b.id === parsed.blockId);
        if (block?.type === 'smart-task') {
          if (block.header.taskKind === 'vocabulary') {
            return Boolean(date && block.header.vocabularyRecords?.[date]);
          }
          return block.header.isCompleted;
        }
      }
    }
    return false;
  }, [tlTasks, ebbReviewTasks]);

  return { checkIsCompleted };
}

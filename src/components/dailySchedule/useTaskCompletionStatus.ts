import { useCallback, useMemo } from 'react';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { parseSourceId } from './conversion';
import type { TaskSource } from './types';
import type { Block } from '@/types';
import { useShallow } from 'zustand/react/shallow';
import { getQuantityDailyStatus, isQuantityTask } from '@/utils/blocks';
import { getUniqueTasks } from '@/store/timelineData';

export function useTaskCompletionStatus() {
  const { tasks, groups } = useTimelineStore(
    useShallow((s) => ({ tasks: s.tasks, groups: s.groups })),
  );
  const ebbReviewTasks = useEbbStore((s) => s.reviewTasks);
  const tlTasks = useMemo(() => getUniqueTasks(tasks, groups), [tasks, groups]);
  const projectBlocks = useMemo(() => {
    const map = new Map<string, Block>();
    for (const task of tlTasks) {
      for (const block of task.blocks ?? []) map.set(`${task.id}::${block.id}`, block);
    }
    return map;
  }, [tlTasks]);
  const reviewById = useMemo(() => new Map(ebbReviewTasks.map((task) => [task.id, task])), [ebbReviewTasks]);

  const checkIsCompleted = useCallback((source: TaskSource, sourceId: string, date?: string) => {
    if (source === 'free') return false;
    
    const parsed = parseSourceId(sourceId);
    if (!parsed) return false;

    if (parsed.source === 'review') {
      const reviewTask = reviewById.get(parsed.reviewId);
      return reviewTask ? reviewTask.isCompleted : false;
    }
    
    if (parsed.source === 'project') {
      if (parsed.blockId) {
        const block = projectBlocks.get(`${parsed.parentTaskId}::${parsed.blockId}`);
        if (block?.type === 'smart-task') {
          if (isQuantityTask(block.header)) {
            if (!date) return false;
            const status = getQuantityDailyStatus(block.header, date);
            return status.state === 'achieved' || status.state === 'recorded';
          }
          return block.header.isCompleted;
        }
      }
    }
    return false;
  }, [projectBlocks, reviewById]);

  return { checkIsCompleted };
}

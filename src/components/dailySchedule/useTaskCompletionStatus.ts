import { useCallback } from 'react';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { parseSourceId } from './conversion';
import type { TaskSource } from './types';

export function useTaskCompletionStatus() {
  const tlTasks = useTimelineStore((s) => s.tasks);
  const ebbReviewTasks = useEbbStore((s) => s.reviewTasks);

  const checkIsCompleted = useCallback((source: TaskSource, sourceId: string) => {
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
          return block.header.isCompleted;
        }
      }
    }
    return false;
  }, [tlTasks, ebbReviewTasks]);

  return { checkIsCompleted };
}
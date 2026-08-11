import type { Task } from '../types/index.ts';
import { isContinuousTask } from './taskRules.ts';

export interface OverdueFreezeTarget {
  taskId: string;
  blockId: string;
  expectedDate: string;
}

/**
 * Finds active one-day tasks that are old enough to return to the backlog.
 * Archived tasks are cold data and must never be rewritten by maintenance.
 */
export function collectOverdueFreezeTargets(
  tasks: readonly Task[],
  thresholdDate: string,
): OverdueFreezeTarget[] {
  const targets: OverdueFreezeTarget[] = [];
  for (const task of tasks) {
    for (const block of Array.isArray(task.blocks) ? task.blocks : []) {
      if (block.type !== 'smart-task') continue;
      const header = block.header;
      if (header.isArchived || header.isCompleted || header.frozenAt || isContinuousTask(header) || !header.date) continue;
      if (header.date >= thresholdDate) continue;
      targets.push({ taskId: task.id, blockId: block.id, expectedDate: header.date });
    }
  }
  return targets;
}

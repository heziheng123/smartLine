import type { SmartTaskHeader, Task } from '../types/index.ts';
import { isContinuousTask } from './taskRules.ts';

export interface OverdueFreezeTarget {
  taskId: string;
  blockId: string;
  expectedDate: string;
}

/**
 * A recovered marker is only valid for a standard task whose retained plan
 * date is older than the current recovery threshold. Newer dates can only be
 * produced by legacy/manual edits that changed `date` without releasing the
 * marker. Archived tasks use the same timestamp field for cold storage and
 * are deliberately left untouched.
 */
export function shouldClearStaleFrozenMarker(
  header: Partial<SmartTaskHeader>,
  thresholdDate: string,
): boolean {
  if (!header.frozenAt || header.isArchived) return false;
  return isContinuousTask(header) || !header.date || header.date >= thresholdDate;
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

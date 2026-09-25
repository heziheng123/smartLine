import { addDays, diffDays, todayStr } from '@/utils/dateSafe';
import { getReviewTopicKey } from './scheduler';
import type { ReviewTask } from './types';

export interface ArchivedReviewPlan {
  id: string;
  topicKey: string;
  topicName: string;
  graphNodeId?: string;
  archivedAt?: string;
  tasks: ReviewTask[];
}

const byRound = (left: ReviewTask, right: ReviewTask) =>
  (left.roundOrder ?? Number.MAX_SAFE_INTEGER) - (right.roundOrder ?? Number.MAX_SAFE_INTEGER)
  || left.dueDate.localeCompare(right.dueDate)
  || left.id.localeCompare(right.id);

const getArchivePlanToken = (task: ReviewTask) => task.archivedAt
  ?? `legacy:${task.createdAt || task.id}`;

export function listArchivedReviewPlans(tasks: ReviewTask[]): ArchivedReviewPlan[] {
  const groups = new Map<string, ReviewTask[]>();
  for (const task of tasks) {
    if (!task.isArchived) continue;
    const key = `${getReviewTopicKey(task)}\u0000${getArchivePlanToken(task)}`;
    const group = groups.get(key) ?? [];
    group.push(task);
    groups.set(key, group);
  }
  return [...groups.entries()].map(([id, group]) => {
    const ordered = [...group].sort(byRound);
    const first = ordered[0];
    return {
      id,
      topicKey: getReviewTopicKey(first),
      topicName: first.topicName,
      graphNodeId: first.graphNodeId,
      archivedAt: first.archivedAt,
      tasks: ordered,
    };
  }).sort((left, right) => (
    right.archivedAt ?? right.tasks[0]?.createdAt ?? ''
  ).localeCompare(left.archivedAt ?? left.tasks[0]?.createdAt ?? ''));
}

export function archiveReviewPlan(
  tasks: ReviewTask[],
  topicKey: string,
  archivedAt: string,
): { reviewTasks: ReviewTask[]; archivedTaskIds: string[] } {
  return archiveReviewPlans(tasks, [topicKey], archivedAt);
}

/** Archives all active review plans matching the supplied topic keys in one operation. */
export function archiveReviewPlans(
  tasks: ReviewTask[],
  topicKeys: Iterable<string>,
  archivedAt: string,
): { reviewTasks: ReviewTask[]; archivedTaskIds: string[] } {
  const keys = new Set(topicKeys);
  const archivedTasks = tasks.filter((task) => !task.isArchived && keys.has(getReviewTopicKey(task)));
  const archivedTaskIds = archivedTasks.map((task) => task.id);
  if (archivedTaskIds.length === 0) return { reviewTasks: tasks, archivedTaskIds };
  const ids = new Set(archivedTaskIds);
  const totalRoundsByTopic = new Map<string, number>();
  archivedTasks.forEach((task) => {
    const topicKey = getReviewTopicKey(task);
    totalRoundsByTopic.set(topicKey, (totalRoundsByTopic.get(topicKey) ?? 0) + 1);
  });
  return {
    reviewTasks: tasks.map((task) => ids.has(task.id)
      ? {
          ...task,
          isArchived: true,
          archivedReason: 'manual',
          archivedAt,
          cycleTotalRounds: totalRoundsByTopic.get(getReviewTopicKey(task)),
        }
      : task),
    archivedTaskIds,
  };
}

/** Restores one archived plan while moving any current plan for the same topic back to history. */
export function restoreArchivedReviewPlan(
  tasks: ReviewTask[],
  archivedTaskIds: string[],
  archivedAt: string,
  replanFrom = todayStr(),
): { reviewTasks: ReviewTask[]; activeTaskIds: string[]; restoredTaskIds: string[] } {
  const wanted = new Set(archivedTaskIds);
  const selected = tasks.filter((task) => wanted.has(task.id) && task.isArchived);
  const first = selected[0];
  if (!first || selected.some((task) => getReviewTopicKey(task) !== getReviewTopicKey(first))) {
    return { reviewTasks: tasks, activeTaskIds: [], restoredTaskIds: [] };
  }

  const topicKey = getReviewTopicKey(first);
  const activeTaskIds = tasks
    .filter((task) => !task.isArchived && getReviewTopicKey(task) === topicKey)
    .map((task) => task.id);
  const activeIds = new Set(activeTaskIds);
  const orderedRestored = [...selected].sort(byRound);
  const pending = orderedRestored.filter((task) => !task.isCompleted);
  const firstPending = pending[0];
  const latestCompletedDate = orderedRestored
    .filter((task) => task.isCompleted)
    .map((task) => task.completedDate ?? task.dueDate)
    .sort()
    .at(-1);
  const firstPendingDate = latestCompletedDate && latestCompletedDate >= replanFrom
    ? addDays(latestCompletedDate, 1)
    : replanFrom;
  const dueDateById = new Map<string, string>();
  if (firstPending) {
    for (const task of pending) {
      dueDateById.set(task.id, addDays(firstPendingDate, Math.max(0, diffDays(task.dueDate, firstPending.dueDate))));
    }
  }

  return {
    reviewTasks: tasks.map((task) => {
      if (activeIds.has(task.id)) {
        return {
          ...task,
          isArchived: true,
          archivedReason: 'superseded',
          archivedAt,
          cycleTotalRounds: activeTaskIds.length,
        };
      }
      if (wanted.has(task.id)) {
        return {
          ...task,
          isArchived: false,
          archivedReason: undefined,
          archivedAt: undefined,
          cycleTotalRounds: undefined,
          ...(dueDateById.has(task.id) ? {
            dueDate: dueDateById.get(task.id),
            originalDueDate: dueDateById.get(task.id),
          } : {}),
        };
      }
      return task;
    }),
    activeTaskIds,
    restoredTaskIds: orderedRestored.map((task) => task.id),
  };
}

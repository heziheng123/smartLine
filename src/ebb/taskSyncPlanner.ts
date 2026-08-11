import { getReviewSourceId } from '@/components/dailySchedule/sourceIds';
import { addDays, diffDays, todayStr } from '@/utils/dateSafe';
import { genId } from './scheduler';
import { buildAbsoluteScheduleDates } from './dataNormalization';
import type { EbbSettings, ReviewTask, SyncTaskToEbbPayload } from './types';

export interface EbbTaskSyncPlan {
  reviewTasks: ReviewTask[];
  dailySourceIdsToRemove: string[];
  changed: boolean;
}

interface EbbTaskSyncPlanInput {
  reviewTasks: ReviewTask[];
  ebbSettings: EbbSettings;
  payload: SyncTaskToEbbPayload;
  today?: string;
  createdAt?: string;
  createReviewTaskId?: () => string;
}

const unchanged = (reviewTasks: ReviewTask[]): EbbTaskSyncPlan => ({
  reviewTasks,
  dailySourceIdsToRemove: [],
  changed: false,
});

/**
 * Plans project-task → EBB changes without mutating either store. The caller
 * commits the returned review tasks and clears the listed daily projections.
 */
export function planEbbTaskSync({
  reviewTasks,
  ebbSettings,
  payload,
  today = todayStr(),
  createdAt = `${today}T00:00:00.000Z`,
  createReviewTaskId = () => genId('rt'),
}: EbbTaskSyncPlanInput): EbbTaskSyncPlan {
  const {
    action = 'add',
    graphNodeId,
    topicName,
    complexity = 'normal',
    triggerSchedule = true,
    sourceTaskId,
    sourceBlockId,
  } = payload;
  const existingTasks = reviewTasks
    .filter((task) => !task.isArchived && task.graphNodeId === graphNodeId)
    .sort((a, b) =>
      (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER),
    );

  if (action === 'revert-source') {
    if (!sourceTaskId || !sourceBlockId) return unchanged(reviewTasks);

    const supplementalIds = new Set(
      existingTasks
        .filter((task) =>
          task.isSupplemental
          && !task.isCompleted
          && task.scheduleSourceTaskId === sourceTaskId
          && task.scheduleSourceBlockId === sourceBlockId,
        )
        .map((task) => task.id),
    );
    const target = existingTasks.find((task) =>
      task.completionSource === 'project-task'
      && task.completionSourceTaskId === sourceTaskId
      && task.completionSourceBlockId === sourceBlockId,
    );
    const targetOrder = target?.roundOrder ?? Number.MAX_SAFE_INTEGER;
    const hasLaterCompletedRound = !!target && existingTasks.some((task) =>
      task.isCompleted && (task.roundOrder ?? 0) > targetOrder,
    );
    if (!target && supplementalIds.size === 0) return unchanged(reviewTasks);

    const previousSchedule = !hasLaterCompletedRound
      ? new Map((target?.previousSchedule ?? []).map((entry) => [entry.reviewTaskId, entry.dueDate]))
      : new Map<string, string>();
    const changedScheduleIds = new Set(previousSchedule.keys());
    supplementalIds.forEach((id) => changedScheduleIds.add(id));
    const nextReviewTasks = reviewTasks
      .filter((task) => !supplementalIds.has(task.id))
      .map((task) => {
        if (previousSchedule.has(task.id)) {
          return { ...task, dueDate: previousSchedule.get(task.id)! };
        }
        if (target && task.id === target.id && !hasLaterCompletedRound) {
          return {
            ...task,
            isCompleted: false,
            completedDate: undefined,
            smStatus: 'scheduled' as const,
            completionSource: undefined,
            completionSourceTaskId: undefined,
            completionSourceBlockId: undefined,
            previousSchedule: undefined,
          };
        }
        return task;
      });
    return {
      reviewTasks: nextReviewTasks,
      dailySourceIdsToRemove: [...changedScheduleIds].map(getReviewSourceId),
      changed: true,
    };
  }

  if (action === 'remove') {
    if (existingTasks.some((task) => task.isCompleted) || existingTasks.length === 0) {
      return unchanged(reviewTasks);
    }
    return {
      reviewTasks: reviewTasks.filter(
        (task) => task.isArchived || task.graphNodeId !== graphNodeId,
      ),
      dailySourceIdsToRemove: existingTasks.map((task) => getReviewSourceId(task.id)),
      changed: true,
    };
  }

  if (!triggerSchedule) return unchanged(reviewTasks);

  if (existingTasks.length === 0) {
    const intervals = ebbSettings.complexityConfigs[complexity].intervals;
    const dueDates = buildAbsoluteScheduleDates(today, intervals);
    const generated = intervals.map((_, index): ReviewTask => ({
      id: createReviewTaskId(),
      topicName,
      graphNodeId,
      createdAt,
      dueDate: dueDates[index],
      originalDueDate: dueDates[index],
      roundOrder: index + 1,
      isCompleted: false,
      complexity,
      smStatus: 'scheduled',
      scheduleCreatedDate: today,
      scheduleSourceTaskId: sourceTaskId,
      scheduleSourceBlockId: sourceBlockId,
    }));
    return {
      reviewTasks: [...reviewTasks, ...generated],
      dailySourceIdsToRemove: [],
      changed: true,
    };
  }

  const sourceAlreadyHandled = !!sourceTaskId && !!sourceBlockId && existingTasks.some((task) =>
    (task.completionSourceTaskId === sourceTaskId && task.completionSourceBlockId === sourceBlockId)
    || (task.scheduleSourceTaskId === sourceTaskId && task.scheduleSourceBlockId === sourceBlockId),
  );
  if (sourceAlreadyHandled) return unchanged(reviewTasks);

  const hasReviewCompletedToday = existingTasks.some(
    (task) => task.isCompleted && task.completedDate === today,
  );
  const planCreatedToday = existingTasks.some((task) => task.scheduleCreatedDate === today);
  if (hasReviewCompletedToday || planCreatedToday) return unchanged(reviewTasks);

  const uncompletedTasks = existingTasks.filter((task) => !task.isCompleted);
  if (uncompletedTasks.length > 0) {
    const candidate = uncompletedTasks[0];
    if (candidate.dueDate > addDays(today, 1)) return unchanged(reviewTasks);

    const delayDays = Math.max(0, diffDays(today, candidate.dueDate));
    const laterTasks = uncompletedTasks.slice(1);
    const previousSchedule = delayDays > 0
      ? laterTasks.map((task) => ({ reviewTaskId: task.id, dueDate: task.dueDate }))
      : [];
    const laterIds = new Set(laterTasks.map((task) => task.id));
    const nextReviewTasks = reviewTasks.map((task) => {
      if (task.id === candidate.id) {
        return {
          ...task,
          isCompleted: true,
          completedDate: today,
          smStatus: 'confirmed' as const,
          completionSource: 'project-task' as const,
          completionSourceTaskId: sourceTaskId,
          completionSourceBlockId: sourceBlockId,
          previousSchedule: previousSchedule.length > 0 ? previousSchedule : undefined,
        };
      }
      if (delayDays > 0 && laterIds.has(task.id)) {
        return {
          ...task,
          dueDate: addDays(task.dueDate, delayDays),
          originalDueDate: task.originalDueDate ?? task.dueDate,
          smStatus: 'scheduled' as const,
        };
      }
      return task;
    });
    return {
      reviewTasks: nextReviewTasks,
      dailySourceIdsToRemove: delayDays > 0
        ? laterTasks.map((task) => getReviewSourceId(task.id))
        : [],
      changed: true,
    };
  }

  const nextRoundOrder = Math.max(0, ...existingTasks.map((task) => task.roundOrder ?? 0)) + 1;
  const dueDate = addDays(today, 1);
  const inheritedComplexity = existingTasks.find((task) => task.complexity)?.complexity ?? complexity;
  const inheritedBaseDuration = existingTasks.find((task) => task.baseDurationMinutes !== undefined)?.baseDurationMinutes;
  return {
    reviewTasks: [
      ...reviewTasks,
      {
        id: createReviewTaskId(),
        topicName,
        graphNodeId,
        createdAt,
        dueDate,
        originalDueDate: dueDate,
        roundOrder: nextRoundOrder,
        isCompleted: false,
        complexity: inheritedComplexity,
        baseDurationMinutes: inheritedBaseDuration,
        smStatus: 'scheduled',
        scheduleCreatedDate: today,
        scheduleSourceTaskId: sourceTaskId,
        scheduleSourceBlockId: sourceBlockId,
        isSupplemental: true,
      },
    ],
    dailySourceIdsToRemove: [],
    changed: true,
  };
}

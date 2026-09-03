import { getReviewSourceId } from '@/components/dailySchedule/sourceIds';
import { buildAbsoluteScheduleDates } from './dataNormalization';
import { genId } from './scheduler';
import { planEbbTaskSync } from './taskSyncPlanner';
import type { ComplexityLevel, EbbSettings, ReviewTask, SyncTaskToEbbPayload } from './types';
import { isValidCalendarDate, todayStr } from '@/utils/dateSafe';

export interface ProjectTaskEbbNodeResult {
  graphNodeId: string;
  mode: 'continue' | 'relearn';
  changed: boolean;
  skippedSameDayRestart?: boolean;
  completedOldRoundIds: string[];
  archivedOldRoundIds: string[];
  generatedRoundIds: string[];
}

export interface ProjectTaskEbbBatchPlan {
  baseReviewTasks: ReviewTask[];
  reviewTasks: ReviewTask[];
  dailySourceIdsToRemove: string[];
  nodeResults: ProjectTaskEbbNodeResult[];
  changed: boolean;
  error?: string;
}

interface BatchPlanInput {
  reviewTasks: ReviewTask[];
  ebbSettings: EbbSettings;
  payloads: SyncTaskToEbbPayload[];
  today?: string;
  createdAt?: string;
  createReviewTaskId?: (context?: {
    mode: 'relearn';
    graphNodeId: string;
    completedDate: string;
    roundOrder: number;
  }) => string;
}

const sortRounds = (tasks: ReviewTask[]) => [...tasks].sort((left, right) =>
  (left.roundOrder ?? Number.MAX_SAFE_INTEGER) - (right.roundOrder ?? Number.MAX_SAFE_INTEGER)
  || left.dueDate.localeCompare(right.dueDate)
  || left.id.localeCompare(right.id),
);

function getIntervals(settings: EbbSettings, complexity: ComplexityLevel): number[] | null {
  const intervals = settings.complexityConfigs[complexity]?.intervals;
  if (!Array.isArray(intervals)
    || intervals.length === 0
    || intervals.some((value) => !Number.isInteger(value) || value <= 0)) return null;
  return intervals;
}

function planRelearnCompletion(
  reviewTasks: ReviewTask[],
  settings: EbbSettings,
  payload: SyncTaskToEbbPayload,
  today: string,
  createdAt: string,
  createReviewTaskId: NonNullable<BatchPlanInput['createReviewTaskId']>,
): ProjectTaskEbbBatchPlan {
  const completedDate = payload.completedDate;
  if (!completedDate || !isValidCalendarDate(completedDate)) {
    return {
      baseReviewTasks: reviewTasks,
      reviewTasks,
      dailySourceIdsToRemove: [],
      nodeResults: [],
      changed: false,
      error: '重新学习需要有效的任务完成日期。',
    };
  }
  if (completedDate > today) {
    return {
      baseReviewTasks: reviewTasks,
      reviewTasks,
      dailySourceIdsToRemove: [],
      nodeResults: [],
      changed: false,
      error: '完成日期在未来，不能重启复习周期。',
    };
  }

  const active = sortRounds(reviewTasks.filter(
    (task) => !task.isArchived && task.graphNodeId === payload.graphNodeId,
  ));
  if (active.length === 0) {
    const complexity = payload.complexity ?? 'normal';
    if (!getIntervals(settings, complexity)) {
      return {
        baseReviewTasks: reviewTasks,
        reviewTasks,
        dailySourceIdsToRemove: [],
        nodeResults: [],
        changed: false,
        error: `“${payload.topicName}”的复习间隔为空或无效，任务未完成。`,
      };
    }
    const fallback = planEbbTaskSync({
      reviewTasks,
      ebbSettings: settings,
      payload: { ...payload, completionMode: 'continue' },
      today: completedDate,
      createdAt,
      createReviewTaskId,
    });
    return {
      baseReviewTasks: reviewTasks,
      reviewTasks: fallback.reviewTasks,
      dailySourceIdsToRemove: fallback.dailySourceIdsToRemove,
      nodeResults: [{
        graphNodeId: payload.graphNodeId,
        mode: 'relearn',
        changed: fallback.changed,
        completedOldRoundIds: [],
        archivedOldRoundIds: [],
        generatedRoundIds: fallback.reviewTasks.slice(reviewTasks.length).map((task) => task.id),
      }],
      changed: fallback.changed,
    };
  }

  // A fresh task-generated chain already anchored to this date is the same
  // business operation, even if another project task points at the same node.
  if (active.every((task) => task.scheduleCreatedDate === completedDate
    && Boolean(task.scheduleSourceTaskId)
    && Boolean(task.scheduleSourceBlockId))) {
    return {
      baseReviewTasks: reviewTasks,
      reviewTasks,
      dailySourceIdsToRemove: [],
      nodeResults: [{
        graphNodeId: payload.graphNodeId,
        mode: 'relearn',
        changed: false,
        skippedSameDayRestart: true,
        completedOldRoundIds: [],
        archivedOldRoundIds: [],
        generatedRoundIds: [],
      }],
      changed: false,
    };
  }

  const template = active[active.length - 1];
  const complexity = payload.complexity ?? template.complexity ?? 'normal';
  const intervals = getIntervals(settings, complexity);
  if (!intervals) {
    return {
      baseReviewTasks: reviewTasks,
      reviewTasks,
      dailySourceIdsToRemove: [],
      nodeResults: [],
      changed: false,
      error: `“${payload.topicName}”的复习间隔为空或无效，任务未完成。`,
    };
  }

  const alreadyCompletedOnDate = active.some(
    (task) => task.isCompleted && task.completedDate === completedDate,
  );
  const candidate = alreadyCompletedOnDate
    ? undefined
    : active.find((task) => !task.isCompleted && task.dueDate <= completedDate);
  const activeIds = new Set(active.map((task) => task.id));
  const totalRounds = active.length;
  const completedOldRoundIds = candidate ? [candidate.id] : [];
  const archivedAt = createdAt;
  const archived = reviewTasks.map((task): ReviewTask => {
    if (!activeIds.has(task.id)) return task;
    const completedTask = candidate?.id === task.id
      ? {
          ...task,
          isCompleted: true,
          completedDate,
          smStatus: 'confirmed' as const,
          completionSource: 'project-task' as const,
          completionSourceTaskId: payload.sourceTaskId,
          completionSourceBlockId: payload.sourceBlockId,
          previousSchedule: undefined,
        }
      : task;
    return {
      ...completedTask,
      isArchived: true,
      archivedReason: 'relearned',
      archivedAt,
      cycleTotalRounds: totalRounds,
    };
  });
  const dates = buildAbsoluteScheduleDates(completedDate, intervals);
  const generated = dates.map((dueDate, index): ReviewTask => ({
    id: createReviewTaskId({
      mode: 'relearn',
      graphNodeId: payload.graphNodeId,
      completedDate,
      roundOrder: index + 1,
    }),
    topicName: payload.topicName || template.topicName,
    graphNodeId: payload.graphNodeId,
    createdAt,
    dueDate,
    originalDueDate: dueDate,
    roundOrder: index + 1,
    isCompleted: false,
    complexity,
    baseDurationMinutes: template.baseDurationMinutes,
    smStatus: 'scheduled',
    scheduleCreatedDate: completedDate,
    scheduleSourceTaskId: payload.sourceTaskId,
    scheduleSourceBlockId: payload.sourceBlockId,
    cycleOrigin: 'project-task-relearn',
  }));

  return {
    baseReviewTasks: reviewTasks,
    reviewTasks: [...archived, ...generated],
    dailySourceIdsToRemove: active.map((task) => getReviewSourceId(task.id)),
    nodeResults: [{
      graphNodeId: payload.graphNodeId,
      mode: 'relearn',
      changed: true,
      completedOldRoundIds,
      archivedOldRoundIds: active.map((task) => task.id),
      generatedRoundIds: generated.map((task) => task.id),
    }],
    changed: true,
  };
}

/** Plans every node against an in-memory result, then exposes one final EBB array. */
export function planProjectTaskEbbBatch({
  reviewTasks,
  ebbSettings,
  payloads,
  today = todayStr(),
  createdAt = new Date().toISOString(),
  createReviewTaskId = (context) => context
    ? `rt-relearn-${encodeURIComponent(context.graphNodeId)}-${context.completedDate}-${context.roundOrder}`
    : genId('rt'),
}: BatchPlanInput): ProjectTaskEbbBatchPlan {
  let nextTasks = reviewTasks;
  const sourceIds = new Set<string>();
  const nodeResults: ProjectTaskEbbNodeResult[] = [];

  for (const payload of payloads) {
    if (payload.completionMode === 'relearn' && payload.action !== 'remove' && payload.action !== 'revert-source') {
      const relearn = planRelearnCompletion(
        nextTasks,
        ebbSettings,
        payload,
        today,
        createdAt,
        createReviewTaskId,
      );
      if (relearn.error) return { ...relearn, baseReviewTasks: reviewTasks };
      nextTasks = relearn.reviewTasks;
      relearn.dailySourceIdsToRemove.forEach((id) => sourceIds.add(id));
      nodeResults.push(...relearn.nodeResults);
      continue;
    }

    const activeForNode = nextTasks.filter(
      (task) => !task.isArchived && task.graphNodeId === payload.graphNodeId,
    );
    if ((payload.action === undefined || payload.action === 'add')
      && payload.triggerSchedule !== false
      && activeForNode.length === 0) {
      const complexity = payload.complexity ?? 'normal';
      if (!getIntervals(ebbSettings, complexity)) {
        return {
          baseReviewTasks: reviewTasks,
          reviewTasks,
          dailySourceIdsToRemove: [],
          nodeResults: [],
          changed: false,
          error: `“${payload.topicName}”的复习间隔为空或无效，任务未完成。`,
        };
      }
    }

    const result = planEbbTaskSync({
      reviewTasks: nextTasks,
      ebbSettings,
      payload,
      today,
      createdAt,
      createReviewTaskId,
    });
    nextTasks = result.reviewTasks;
    result.dailySourceIdsToRemove.forEach((id) => sourceIds.add(id));
    nodeResults.push({
      graphNodeId: payload.graphNodeId,
      mode: 'continue',
      changed: result.changed,
      completedOldRoundIds: [],
      archivedOldRoundIds: [],
      generatedRoundIds: [],
    });
  }

  return {
    baseReviewTasks: reviewTasks,
    reviewTasks: nextTasks,
    dailySourceIdsToRemove: [...sourceIds],
    nodeResults,
    changed: nextTasks !== reviewTasks,
  };
}

import type { ReviewTask } from '@/ebb/types';
import { computeRounds, getReviewTopicKey } from '@/ebb/scheduler';
import type { GraphNode } from '@/graph/types';
import type { Task, TaskGroup } from '@/types';
import {
  getQuantityCompleted,
  getQuantityRecords,
  getQuantityTotal,
  getQuantityUnit,
  getValidGraphNodeIds,
  isQuantityTask,
} from '@/utils/blocks';
import { getUniqueTasks } from '@/store/timelineData';
import { getProjectBlockSourceId, getReviewSourceId } from '@/components/dailySchedule/sourceIds';
import type { DaySchedule } from '@/components/dailySchedule/types';
import type {
  CompletedActivity,
  DailyRetrospective,
  RetrospectiveEntry,
  RetrospectiveOverall,
} from '@/components/dailySchedule/retrospectiveTypes';
import {
  EMPTY_OVERALL,
  EMPTY_REFLECTION,
} from '@/components/dailySchedule/retrospectiveTypes';

const uniqueIds = (values: string[]) => [...new Set(values.filter(Boolean))];

export function collectCompletedActivities(
  date: string,
  tasks: Task[],
  groups: TaskGroup[],
  reviewTasks: ReviewTask[],
  graphNodes: GraphNode[],
  daySchedule?: DaySchedule,
): CompletedActivity[] {
  const nodeNameById = new Map(graphNodes.map((node) => [node.id, node.name]));
  const result: CompletedActivity[] = [];

  for (const task of getUniqueTasks(tasks, groups)) {
    for (const block of task.blocks ?? []) {
      if (block.type !== 'smart-task' || block.header.isArchived) continue;
      const header = block.header;
      const continuous = isQuantityTask(header);
      const quantityActual = continuous ? (getQuantityRecords(header)[date] ?? 0) : 0;
      if (continuous ? quantityActual <= 0 : !(header.isCompleted && header.completedDate === date)) continue;

      const nodeIds = uniqueIds(getValidGraphNodeIds(header));
      const sourceId = getProjectBlockSourceId(task.id, block.id);
      result.push({
        id: `${date}:${sourceId}`,
        sourceId,
        sourceType: continuous
          ? (header.taskKind === 'vocabulary' ? 'vocabulary' : 'quantity')
          : 'project',
        title: header.title,
        projectName: task.name,
        taskId: task.id,
        blockId: block.id,
        completedDate: date,
        quantityActual: continuous ? quantityActual : undefined,
        quantityCompleted: continuous ? getQuantityCompleted(header) : undefined,
        quantityTotal: continuous ? getQuantityTotal(header) : undefined,
        quantityUnit: continuous ? getQuantityUnit(header) : undefined,
        nodeIds,
        nodeSnapshots: nodeIds.map((id) => ({ id, name: nodeNameById.get(id) ?? '已删除知识节点' })),
      });
    }
  }

  const { roundMap, totalRoundsMap } = computeRounds(reviewTasks);
  for (const review of reviewTasks) {
    if (!review.isCompleted || review.completedDate !== date) continue;
    if (review.isArchived && review.archivedReason !== 'relearned') continue;
    const sourceId = getReviewSourceId(review.id);
    const linkedProjectSourceId = review.completionSource === 'project-task'
      && review.completionSourceTaskId
      && review.completionSourceBlockId
      ? getProjectBlockSourceId(review.completionSourceTaskId, review.completionSourceBlockId)
      : undefined;
    const nodeIds = review.graphNodeId ? [review.graphNodeId] : [];
    const restartedNextDueDate = review.isArchived
      && review.archivedReason === 'relearned'
      && review.graphNodeId
      ? reviewTasks
          .filter((task) =>
            !task.isArchived
            && task.graphNodeId === review.graphNodeId
            && task.scheduleCreatedDate === date
            && task.scheduleSourceTaskId === review.completionSourceTaskId
            && task.scheduleSourceBlockId === review.completionSourceBlockId,
          )
          .sort((left, right) =>
            (left.roundOrder ?? Number.MAX_SAFE_INTEGER) - (right.roundOrder ?? Number.MAX_SAFE_INTEGER)
            || left.dueDate.localeCompare(right.dueDate),
          )[0]?.dueDate
      : undefined;
    result.push({
      id: `${date}:${sourceId}`,
      sourceId,
      sourceType: 'review',
      title: review.topicName,
      reviewTaskId: review.id,
      completedDate: date,
      completionSource: review.completionSource ?? 'manual',
      linkedProjectSourceId,
      round: roundMap.get(review.id) ?? review.roundOrder ?? 1,
      totalRounds: review.cycleTotalRounds ?? totalRoundsMap.get(getReviewTopicKey(review)) ?? 1,
      restartedNextDueDate,
      nodeIds,
      nodeSnapshots: nodeIds.map((id) => ({ id, name: nodeNameById.get(id) ?? '已删除知识节点' })),
    });
  }

  const existingSourceIds = new Set(result.map((activity) => activity.sourceId));
  const freeActivities = [
    ...(daySchedule?.items ?? []),
    ...(daySchedule?.blocks ?? []),
  ].filter((entry) => entry.source === 'free' && entry.completedDate === date);
  for (const entry of freeActivities) {
    if (existingSourceIds.has(entry.sourceId)) continue;
    existingSourceIds.add(entry.sourceId);
    result.push({
      id: `${date}:${entry.sourceId}`,
      sourceId: entry.sourceId,
      sourceType: 'free',
      title: entry.name,
      completedDate: date,
      nodeIds: [],
      nodeSnapshots: [],
    });
  }

  return result.sort((left, right) => {
    if (left.completionSource === 'project-task' && right.completionSource !== 'project-task') return 1;
    if (right.completionSource === 'project-task' && left.completionSource !== 'project-task') return -1;
    return left.title.localeCompare(right.title, 'zh-CN');
  });
}

export function mergeRetrospectiveWithActivities(
  date: string,
  activities: CompletedActivity[],
  existing?: DailyRetrospective,
): DailyRetrospective {
  const previousEntries = new Map((existing?.entries ?? []).map((entry) => [entry.id, entry]));
  const now = new Date().toISOString();
  const entries: RetrospectiveEntry[] = activities.map((activity) => {
    const previous = previousEntries.get(activity.id);
    if (previous) {
      return {
        ...activity,
        title: previous.title,
        projectName: previous.projectName,
        // A retrospective is a historical snapshot. Rebinding the source task later
        // must not silently move an already-created record to different nodes.
        nodeIds: previous.nodeIds ?? [],
        nodeSnapshots: previous.nodeSnapshots ?? [],
        categories: previous.categories ?? [],
        completionStatusChanged: false,
        reflection: previous.reflection ?? { ...EMPTY_REFLECTION },
        updatedAt: previous.updatedAt,
      };
    }
    return {
      ...activity,
      categories: [],
      completionStatusChanged: false,
      reflection: { ...EMPTY_REFLECTION },
      updatedAt: now,
    };
  });

  // Finalized or previously edited entries remain readable even if the source task
  // is later deleted or its completion state is reverted.
  for (const entry of existing?.entries ?? []) {
    if (!entries.some((candidate) => candidate.id === entry.id)) {
      entries.push({
        ...entry,
        nodeIds: entry.nodeIds ?? [],
        nodeSnapshots: entry.nodeSnapshots ?? [],
        categories: entry.categories ?? [],
        completionStatusChanged: true,
        reflection: entry.reflection ?? { ...EMPTY_REFLECTION },
      });
    }
  }

  return {
    id: existing?.id ?? `retrospective:${date}`,
    date,
    status: existing?.status ?? 'draft',
    entries,
    overall: existing?.overall ?? { ...EMPTY_OVERALL },
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    finalizedAt: existing?.finalizedAt,
  };
}

const joinNonEmpty = (values: string[]) => values.map((value) => value.trim()).filter(Boolean).join('\n');

export function buildOverallFromEntries(entries: RetrospectiveEntry[]): RetrospectiveOverall {
  const reflectedEntries = entries.filter((entry) => entry.completionSource !== 'project-task');
  return {
    summary: joinNonEmpty(reflectedEntries.map((entry) =>
      entry.reflection?.content ? `${entry.title}：${entry.reflection.content}` : entry.title,
    )),
  };
}

export function isRetrospectiveEntryCurrentlyCompleted(
  entry: RetrospectiveEntry,
  tasks: Task[],
  groups: TaskGroup[],
  reviewTasks: ReviewTask[],
  schedules: Record<string, DaySchedule>,
): boolean {
  if (entry.sourceType === 'review') {
    const review = reviewTasks.find((candidate) => candidate.id === entry.reviewTaskId);
    return Boolean(review?.isCompleted && review.completedDate === entry.completedDate);
  }
  if (entry.sourceType === 'free') {
    const schedule = schedules[entry.completedDate];
    return [...(schedule?.items ?? []), ...(schedule?.blocks ?? [])]
      .some((candidate) => candidate.sourceId === entry.sourceId && candidate.completedDate === entry.completedDate);
  }
  const task = getUniqueTasks(tasks, groups).find((candidate) => candidate.id === entry.taskId);
  const block = task?.blocks.find((candidate) => candidate.id === entry.blockId);
  if (!block || block.type !== 'smart-task') return false;
  if (isQuantityTask(block.header)) {
    return (getQuantityRecords(block.header)[entry.completedDate] ?? 0) > 0;
  }
  return Boolean(block.header.isCompleted && block.header.completedDate === entry.completedDate);
}

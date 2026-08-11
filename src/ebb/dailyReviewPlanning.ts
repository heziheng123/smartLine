import { addDays, diffDays, isValidCalendarDate } from '../utils/dateSafe.ts';
import type { ReviewTask } from './types.ts';
import { computeRounds, getReviewTopicKey } from './scheduler.ts';
import { getReviewRoundDuration } from './duration.ts';

export interface DailyReviewCandidate {
  taskId: string;
  topicKey: string;
  topicName: string;
  dueDate: string;
  round: number;
  totalRounds: number;
  laterPendingRounds: number;
  deferralCount: number;
  previousDecision?: 'keep' | 'defer';
  durationMinutes: number;
  /** 逾期或连续推迟过多的轮次默认锁定在明日，仍允许用户显式覆盖。 */
  recommendedLocked: boolean;
}

export interface DailyReviewPlanRequest {
  planDate: string;
  candidateTaskIds: string[];
  keptTaskIds: string[];
  /** 显式日期分配；未提供时兼容旧版“保留/顺延一天”请求。 */
  assignmentsByTaskId?: Record<string, string>;
}

export interface DailyReviewPlan {
  planDate: string;
  rolloverDate: string;
  candidates: DailyReviewCandidate[];
  keptCount: number;
  deferredCount: number;
  cascadeCount: number;
  previousTasks: ReviewTask[];
  nextTasks: ReviewTask[];
  dateChangedTaskIds: string[];
  assignmentsByTaskId: Record<string, string>;
}

export interface DailyReviewWorkloadDay {
  date: string;
  minutes: number;
  taskIds: string[];
  overCapacity: boolean;
}

export interface BalancedDailyReviewPlan {
  planDate: string;
  capacityMinutes: number;
  assignmentsByTaskId: Record<string, string>;
  days: DailyReviewWorkloadDay[];
  totalMinutes: number;
  overflowMinutes: number;
}

const sortByRound = (tasks: ReviewTask[]) => [...tasks].sort((a, b) =>
  (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER)
  || (a.originalDueDate ?? a.dueDate).localeCompare(b.originalDueDate ?? b.dueDate)
  || a.id.localeCompare(b.id),
);

/**
 * Only the earliest unfinished round of each topic can enter tomorrow's choice.
 * Later rounds remain attached to that round so completion-order constraints
 * cannot be bypassed by the planning UI.
 */
export function getDailyReviewCandidates(
  tasks: ReviewTask[],
  planDate: string,
): DailyReviewCandidate[] {
  if (!isValidCalendarDate(planDate)) return [];
  const active = tasks.filter((task) => !task.isArchived && !task.isCompleted);
  const byTopic = new Map<string, ReviewTask[]>();
  active.forEach((task) => {
    const key = getReviewTopicKey(task);
    const group = byTopic.get(key) ?? [];
    group.push(task);
    byTopic.set(key, group);
  });
  const { roundMap, totalRoundsMap } = computeRounds(tasks);
  const candidates: DailyReviewCandidate[] = [];

  for (const [topicKey, rawGroup] of byTopic) {
    const group = sortByRound(rawGroup);
    const task = group[0];
    const belongsToOpenPlan = task.rollingPlanDate === planDate;
    if (task.dueDate > planDate && !belongsToOpenPlan) continue;
    candidates.push({
      taskId: task.id,
      topicKey,
      topicName: task.topicName,
      dueDate: task.dueDate,
      round: roundMap.get(task.id) ?? task.roundOrder ?? 1,
      totalRounds: totalRoundsMap.get(topicKey) ?? group.length,
      laterPendingRounds: Math.max(0, group.length - 1),
      deferralCount: Math.max(0, Math.trunc(task.rollingDeferralCount ?? 0)),
      previousDecision: belongsToOpenPlan ? task.rollingDecision : undefined,
      durationMinutes: getReviewRoundDuration(task, roundMap.get(task.id) ?? task.roundOrder ?? 1),
      recommendedLocked: task.dueDate < planDate || Math.max(0, Math.trunc(task.rollingDeferralCount ?? 0)) >= 3,
    });
  }

  return candidates.sort((a, b) =>
    b.deferralCount - a.deferralCount
    || a.dueDate.localeCompare(b.dueDate)
    || a.topicName.localeCompare(b.topicName, 'zh-CN')
    || a.taskId.localeCompare(b.taskId),
  );
}

/**
 * Produces a deterministic three-day capacity proposal. Urgent items stay on
 * the plan date; flexible items use the earliest day with room. When the whole
 * horizon is full, the least-loaded day is chosen and the overflow is surfaced
 * instead of silently dropping work.
 */
export function buildBalancedDailyReviewPlan(
  tasks: ReviewTask[],
  planDate: string,
  capacityMinutes: number,
  horizonDays = 3,
): BalancedDailyReviewPlan {
  const safeCapacity = Math.max(15, Math.trunc(capacityMinutes || 60));
  const safeHorizon = Math.min(7, Math.max(1, Math.trunc(horizonDays)));
  const dates = Array.from({ length: safeHorizon }, (_, index) => addDays(planDate, index));
  const candidates = getDailyReviewCandidates(tasks, planDate);
  const candidateIds = new Set(candidates.map((candidate) => candidate.taskId));
  const minutesByDate = new Map(dates.map((date) => [date, 0]));
  const idsByDate = new Map(dates.map((date) => [date, [] as string[]]));
  const { roundMap } = computeRounds(tasks);

  // Future rounds already occupying the horizon count toward capacity. The
  // visible candidate rounds are excluded because they are placed below.
  for (const task of tasks) {
    if (task.isArchived || task.isCompleted || candidateIds.has(task.id) || !minutesByDate.has(task.dueDate)) continue;
    const duration = getReviewRoundDuration(task, roundMap.get(task.id) ?? task.roundOrder ?? 1);
    minutesByDate.set(task.dueDate, (minutesByDate.get(task.dueDate) ?? 0) + duration);
    idsByDate.get(task.dueDate)!.push(task.id);
  }

  const assignmentsByTaskId: Record<string, string> = {};
  for (const candidate of candidates) {
    let targetDate = planDate;
    if (!candidate.recommendedLocked) {
      targetDate = dates.find((date) => (minutesByDate.get(date) ?? 0) + candidate.durationMinutes <= safeCapacity)
        ?? [...dates].sort((left, right) =>
          (minutesByDate.get(left) ?? 0) - (minutesByDate.get(right) ?? 0)
          || left.localeCompare(right),
        )[0];
    }
    assignmentsByTaskId[candidate.taskId] = targetDate;
    minutesByDate.set(targetDate, (minutesByDate.get(targetDate) ?? 0) + candidate.durationMinutes);
    idsByDate.get(targetDate)!.push(candidate.taskId);
  }

  const days = dates.map((date) => ({
    date,
    minutes: minutesByDate.get(date) ?? 0,
    taskIds: idsByDate.get(date) ?? [],
    overCapacity: (minutesByDate.get(date) ?? 0) > safeCapacity,
  }));
  return {
    planDate,
    capacityMinutes: safeCapacity,
    assignmentsByTaskId,
    days,
    totalMinutes: candidates.reduce((sum, candidate) => sum + candidate.durationMinutes, 0),
    overflowMinutes: days.reduce((sum, day) => sum + Math.max(0, day.minutes - safeCapacity), 0),
  };
}

const sameTask = (a: ReviewTask, b: ReviewTask) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Builds one atomic rolling-day decision.
 *
 * Visible candidate rounds are placed on tomorrow when kept, otherwise exactly
 * one day later. Every later unfinished round in the same topic moves by the
 * same delta, preserving round order and the existing intervals. Completed
 * rounds and graph/source identities are never modified.
 */
export function planDailyReviewSelection(
  tasks: ReviewTask[],
  request: DailyReviewPlanRequest,
): DailyReviewPlan {
  if (!isValidCalendarDate(request.planDate)) throw new Error('明日日期无效，请重新打开规划');
  const requestedIds = [...new Set(request.candidateTaskIds)];
  const keptIds = new Set(request.keptTaskIds);
  if ([...keptIds].some((id) => !requestedIds.includes(id))) {
    throw new Error('选择中包含已经失效的复习轮次，请重新打开规划');
  }

  const currentCandidates = getDailyReviewCandidates(tasks, request.planDate);
  const candidateById = new Map(currentCandidates.map((candidate) => [candidate.taskId, candidate]));
  const missing = requestedIds.filter((id) => !candidateById.has(id));
  if (missing.length > 0) throw new Error('复习计划已在其他位置发生变化，请重新打开规划');

  const rolloverDate = addDays(request.planDate, 1);
  const assignmentsByTaskId = Object.fromEntries(requestedIds.map((id) => [
    id,
    request.assignmentsByTaskId?.[id] ?? (keptIds.has(id) ? request.planDate : rolloverDate),
  ]));
  for (const [id, date] of Object.entries(assignmentsByTaskId)) {
    if (!candidateById.has(id) || !isValidCalendarDate(date)) throw new Error('负荷规划包含无效日期，请重新打开规划');
    const offset = diffDays(date, request.planDate);
    if (offset < 0 || offset > 6) throw new Error('明日负荷最多可在未来 7 天内调整');
  }
  const nextById = new Map(tasks.map((task) => [task.id, task]));
  const previousById = new Map<string, ReviewTask>();
  const dateChangedIds = new Set<string>();
  const dateDeltaById = new Map<string, number>();
  let cascadeCount = 0;

  for (const candidateId of requestedIds) {
    const candidate = candidateById.get(candidateId)!;
    const currentTask = nextById.get(candidateId);
    if (!currentTask) throw new Error('复习轮次已经不存在，请重新打开规划');
    const desiredDate = assignmentsByTaskId[candidateId];
    const keep = desiredDate === request.planDate;
    const delta = diffDays(desiredDate, currentTask.dueDate);
    const currentOrder = currentTask.roundOrder ?? candidate.round;
    const topicTasks = sortByRound(tasks.filter((task) =>
      !task.isArchived
      && !task.isCompleted
      && getReviewTopicKey(task) === candidate.topicKey
      && (task.roundOrder ?? Number.MAX_SAFE_INTEGER) >= currentOrder,
    ));

    for (const topicTask of topicTasks) {
      const latest = nextById.get(topicTask.id) ?? topicTask;
      const isCandidate = topicTask.id === candidateId;
      const nextDueDate = delta === 0 ? latest.dueDate : addDays(latest.dueDate, delta);
      const alreadyDeferredForPlan = latest.rollingPlanDate === request.planDate
        && latest.rollingDecision === 'defer';
      const nextTask: ReviewTask = {
        ...latest,
        dueDate: nextDueDate,
        ...(delta !== 0
          ? {
              originalDueDate: latest.originalDueDate ?? latest.dueDate,
              smStatus: 'scheduled' as const,
            }
          : {}),
        ...(isCandidate
          ? {
              rollingPlanDate: request.planDate,
              rollingDecision: keep ? 'keep' as const : 'defer' as const,
              rollingDeferralCount: keep
                ? 0
                : alreadyDeferredForPlan
                  ? Math.max(0, Math.trunc(latest.rollingDeferralCount ?? 0))
                  : Math.max(0, Math.trunc(latest.rollingDeferralCount ?? 0)) + 1,
            }
          : {}),
      };
      if (!sameTask(latest, nextTask)) {
        previousById.set(topicTask.id, latest);
        nextById.set(topicTask.id, nextTask);
        if (latest.dueDate !== nextTask.dueDate) {
          dateChangedIds.add(topicTask.id);
          dateDeltaById.set(topicTask.id, diffDays(nextTask.dueDate, latest.dueDate));
        }
        if (!isCandidate) cascadeCount += 1;
      }
    }
  }

  // Project-task completion can carry a reversible snapshot of later rounds.
  // Move that snapshot by the same manual delta so cancelling the source task
  // removes only its own earlier shift and never erases this nightly decision.
  for (const task of tasks) {
    if (!task.isCompleted || !task.previousSchedule?.length) continue;
    let snapshotChanged = false;
    const previousSchedule = task.previousSchedule.map((entry) => {
      const delta = dateDeltaById.get(entry.reviewTaskId);
      if (!delta) return entry;
      snapshotChanged = true;
      return { ...entry, dueDate: addDays(entry.dueDate, delta) };
    });
    if (!snapshotChanged) continue;
    const latest = nextById.get(task.id) ?? task;
    const nextTask = { ...latest, previousSchedule };
    previousById.set(task.id, latest);
    nextById.set(task.id, nextTask);
  }

  const previousTasks = [...previousById.values()].sort((a, b) => a.id.localeCompare(b.id));
  const nextTasks = previousTasks.map((task) => nextById.get(task.id)!).sort((a, b) => a.id.localeCompare(b.id));
  return {
    planDate: request.planDate,
    rolloverDate,
    candidates: requestedIds.map((id) => candidateById.get(id)!),
    keptCount: keptIds.size,
    deferredCount: requestedIds.length - keptIds.size,
    cascadeCount,
    previousTasks,
    nextTasks,
    dateChangedTaskIds: [...dateChangedIds],
    assignmentsByTaskId,
  };
}

import { addDays, diffDays, todayStr } from '../utils/dateSafe.ts';
import type { EbbSettings, ReviewTask } from './types.ts';
import { buildNextRoundTask, genId, getReviewTopicKey } from './scheduler.ts';
import { getReviewRoundDuration } from './duration.ts';

export type BatchReviewAction =
  | { kind: 'reanchor'; startDate: string }
  | { kind: 'shift'; days: number }
  | { kind: 'trim'; count: number; minRemaining: number }
  | { kind: 'append'; count: number }
  | { kind: 'template'; startDate: string; intervals: number[] };

export type ReviewAdjustmentGoal =
  | {
      kind: 'backlog' | 'balance';
      startDate: string;
      horizonDays: number;
      capacityMinutes: number;
      maxRoundsPerDay: number;
      maxMoveDays: number;
      deadline?: string;
      protectedTaskIds?: string[];
    }
  | { kind: 'cadence'; startDate: string; intervals: number[] }
  | {
      kind: 'lifecycle';
      operation: 'trim' | 'append' | 'restart';
      count: number;
      startDate: string;
      intervals: number[];
    }
  | { kind: 'advanced'; action: BatchReviewAction };

export type BatchReviewRequest =
  | { topicKeys: string[]; mode?: 'action'; action: BatchReviewAction; goal?: never }
  | { topicKeys: string[]; mode: 'goal'; goal: ReviewAdjustmentGoal; action?: never };

export interface ReviewAdjustmentDayLoad {
  date: string;
  beforeMinutes: number;
  afterMinutes: number;
  beforeRounds: number;
  afterRounds: number;
  capacityMinutes: number;
  maxRoundsPerDay: number;
  beforeOverCapacity: boolean;
  afterOverCapacity: boolean;
}

export interface BatchReviewTopicResult {
  topicKey: string;
  topicName: string;
  status: 'changed' | 'skipped';
  description: string;
  beforeCount: number;
  afterCount: number;
  removedCount: number;
  addedCount: number;
  rescheduledCount: number;
}

export interface BatchReviewPlan {
  request: BatchReviewRequest;
  previousTasks: ReviewTask[];
  nextTasks: ReviewTask[];
  sourceIdsToClear: string[];
  results: BatchReviewTopicResult[];
  affectedTopics: number;
  skippedTopics: number;
  removedRounds: number;
  addedRounds: number;
  rescheduledRounds: number;
  dayLoads?: ReviewAdjustmentDayLoad[];
  warnings?: string[];
  blockingIssues?: string[];
}

const sortRounds = (tasks: ReviewTask[]) => [...tasks].sort((a, b) =>
  (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER)
  || (a.originalDueDate ?? a.dueDate).localeCompare(b.originalDueDate ?? b.dueDate)
  || a.id.localeCompare(b.id),
);

const isValidIntervals = (intervals: number[]) => intervals.length > 0
  && intervals.every((value, index) => Number.isInteger(value)
    && value > 0
    && value <= 1825
    && (index === 0 || value >= intervals[index - 1]));

const isValidDate = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};

const boundedInteger = (value: number, min: number, max: number, fallback: number) => {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
};

const makeSkipped = (
  topicKey: string,
  topicName: string,
  count: number,
  description: string,
): BatchReviewTopicResult => ({
  topicKey,
  topicName,
  status: 'skipped',
  description,
  beforeCount: count,
  afterCount: count,
  removedCount: 0,
  addedCount: 0,
  rescheduledCount: 0,
});

const getEffectiveCompletedDate = (task: ReviewTask) => task.completedDate ?? task.dueDate;

const isStrictlyOrdered = (dates: string[]) => dates.every((date, index) => index === 0 || date > dates[index - 1]);

const buildLoadMap = (tasks: ReviewTask[]) => {
  const result = new Map<string, { minutes: number; rounds: number }>();
  for (const task of tasks) {
    if (task.isArchived || task.isCompleted || !isValidDate(task.dueDate)) continue;
    const current = result.get(task.dueDate) ?? { minutes: 0, rounds: 0 };
    const round = task.roundOrder ?? 1;
    result.set(task.dueDate, {
      minutes: current.minutes + getReviewRoundDuration(task, round),
      rounds: current.rounds + 1,
    });
  }
  return result;
};

const buildDayLoads = (
  beforeTasks: ReviewTask[],
  afterTasks: ReviewTask[],
  startDate: string,
  horizonDays: number,
  capacityMinutes: number,
  maxRoundsPerDay: number,
): ReviewAdjustmentDayLoad[] => {
  const before = buildLoadMap(beforeTasks);
  const after = buildLoadMap(afterTasks);
  return Array.from({ length: horizonDays }, (_, index) => {
    const date = addDays(startDate, index);
    const previous = before.get(date) ?? { minutes: 0, rounds: 0 };
    const next = after.get(date) ?? { minutes: 0, rounds: 0 };
    return {
      date,
      beforeMinutes: previous.minutes,
      afterMinutes: next.minutes,
      beforeRounds: previous.rounds,
      afterRounds: next.rounds,
      capacityMinutes,
      maxRoundsPerDay,
      beforeOverCapacity: previous.minutes > capacityMinutes || previous.rounds > maxRoundsPerDay,
      afterOverCapacity: next.minutes > capacityMinutes || next.rounds > maxRoundsPerDay,
    };
  });
};

const combinePlanWithWorkspace = (
  reviewTasks: ReviewTask[],
  request: BatchReviewRequest,
  plan: BatchReviewPlan,
) => {
  const selectedKeys = new Set(request.topicKeys);
  return [
    ...reviewTasks.filter((task) => task.isArchived || !selectedKeys.has(getReviewTopicKey(task))),
    ...plan.nextTasks,
  ];
};

function planActionAdjustment(
  reviewTasks: ReviewTask[],
  settings: EbbSettings,
  request: Extract<BatchReviewRequest, { action: BatchReviewAction }>,
): BatchReviewPlan {
  const selectedKeys = new Set(request.topicKeys);
  const activeSelected = reviewTasks.filter((task) => !task.isArchived && selectedKeys.has(getReviewTopicKey(task)));
  const previousTasks = sortRounds(activeSelected);
  const byTopic = new Map<string, ReviewTask[]>();
  for (const task of previousTasks) {
    const topicKey = getReviewTopicKey(task);
    const group = byTopic.get(topicKey) ?? [];
    group.push(task);
    byTopic.set(topicKey, group);
  }

  const nextTasks: ReviewTask[] = [];
  const sourceIdsToClear = new Set<string>();
  const results: BatchReviewTopicResult[] = [];

  for (const topicKey of request.topicKeys) {
    const rounds = sortRounds(byTopic.get(topicKey) ?? []);
    const topicName = rounds[0]?.topicName ?? topicKey;
    if (rounds.length === 0) {
      results.push(makeSkipped(topicKey, topicName, 0, '当前没有可调整的有效轮次'));
      continue;
    }

    if (request.action.kind === 'reanchor') {
      const pending = rounds.filter((task) => !task.isCompleted);
      if (!isValidDate(request.action.startDate) || request.action.startDate < todayStr() || pending.length === 0) {
        nextTasks.push(...rounds);
        results.push(makeSkipped(topicKey, topicName, rounds.length, pending.length === 0 ? '没有未完成轮次' : '下一轮日期不能早于今天'));
        continue;
      }
      const delta = diffDays(request.action.startDate, pending[0].dueDate);
      const pendingIds = new Set(pending.map((task) => task.id));
      const shiftedDates = pending.map((task) => addDays(task.dueDate, delta));
      const latestCompleted = [...rounds].reverse().find((task) => task.isCompleted);
      const invalidOrder = shiftedDates.some((date, index) => index > 0 && date <= shiftedDates[index - 1])
        || Boolean(latestCompleted && shiftedDates[0] <= (latestCompleted.completedDate ?? latestCompleted.dueDate));
      if (new Set(shiftedDates).size !== shiftedDates.length || invalidOrder) {
        nextTasks.push(...rounds);
        results.push(makeSkipped(topicKey, topicName, rounds.length, '新日期会与已完成历史冲突'));
        continue;
      }
      nextTasks.push(...rounds.map((task) => pendingIds.has(task.id)
        ? { ...task, dueDate: addDays(task.dueDate, delta), originalDueDate: task.originalDueDate ?? task.dueDate, smStatus: 'scheduled' as const }
        : task));
      pending.forEach((task) => sourceIdsToClear.add(task.id));
      results.push({
        topicKey,
        topicName,
        status: 'changed',
        description: `下一轮从 ${request.action.startDate} 开始，保持间隔重排 ${pending.length} 轮`,
        beforeCount: rounds.length,
        afterCount: rounds.length,
        removedCount: 0,
        addedCount: 0,
        rescheduledCount: pending.length,
      });
      continue;
    }

    if (request.action.kind === 'shift') {
      const days = boundedInteger(request.action.days, -365, 365, 0);
      const pending = rounds.filter((task) => !task.isCompleted);
      if (days === 0 || pending.length === 0) {
        nextTasks.push(...rounds);
        results.push(makeSkipped(topicKey, topicName, rounds.length, days === 0 ? '调整天数为 0' : '没有未完成轮次'));
        continue;
      }
      const pendingIds = new Set(pending.map((task) => task.id));
      const completedDates = new Set(rounds.filter((task) => task.isCompleted).map((task) => task.dueDate));
      const shiftedDates = pending.map((task) => addDays(task.dueDate, days));
      const latestCompleted = [...rounds].reverse().find((task) => task.isCompleted);
      const invalidOrder = !isStrictlyOrdered(shiftedDates)
        || shiftedDates.some((date) => date < todayStr())
        || Boolean(latestCompleted && shiftedDates[0] <= getEffectiveCompletedDate(latestCompleted));
      if (new Set(shiftedDates).size !== shiftedDates.length
        || shiftedDates.some((date) => completedDates.has(date))
        || invalidOrder) {
        nextTasks.push(...rounds);
        results.push(makeSkipped(topicKey, topicName, rounds.length, '调整后会落到过去、打乱顺序或与已有轮次冲突'));
        continue;
      }
      nextTasks.push(...rounds.map((task) => pendingIds.has(task.id)
        ? {
            ...task,
            dueDate: addDays(task.dueDate, days),
            originalDueDate: task.originalDueDate ?? task.dueDate,
            smStatus: 'scheduled' as const,
          }
        : task));
      pending.forEach((task) => sourceIdsToClear.add(task.id));
      results.push({
        topicKey,
        topicName,
        status: 'changed',
        description: `${pending.length} 个未完成轮次${days > 0 ? '顺延' : '提前'} ${Math.abs(days)} 天`,
        beforeCount: rounds.length,
        afterCount: rounds.length,
        removedCount: 0,
        addedCount: 0,
        rescheduledCount: pending.length,
      });
      continue;
    }

    if (request.action.kind === 'trim') {
      const count = boundedInteger(request.action.count, 1, 12, 1);
      const minRemaining = boundedInteger(request.action.minRemaining, 1, 12, 1);
      if (rounds.length - count < minRemaining) {
        nextTasks.push(...rounds);
        results.push(makeSkipped(topicKey, topicName, rounds.length, `至少保留 ${minRemaining} 轮，当前轮次数不足`));
        continue;
      }
      const tail = rounds.slice(-count);
      if (tail.some((task) => task.isCompleted)) {
        nextTasks.push(...rounds);
        results.push(makeSkipped(topicKey, topicName, rounds.length, '末尾范围包含已完成轮次'));
        continue;
      }
      const removedIds = new Set(tail.map((task) => task.id));
      nextTasks.push(...rounds.filter((task) => !removedIds.has(task.id)));
      tail.forEach((task) => sourceIdsToClear.add(task.id));
      results.push({
        topicKey,
        topicName,
        status: 'changed',
        description: `删除末尾 ${tail.length} 个未完成轮次`,
        beforeCount: rounds.length,
        afterCount: rounds.length - tail.length,
        removedCount: tail.length,
        addedCount: 0,
        rescheduledCount: 0,
      });
      continue;
    }

    if (request.action.kind === 'append') {
      const count = boundedInteger(request.action.count, 1, 12, 1);
      const working = [...rounds];
      for (let index = 0; index < count; index += 1) {
        const next = buildNextRoundTask(working, settings);
        if (!next) break;
        working.push(next);
      }
      const addedCount = working.length - rounds.length;
      nextTasks.push(...working);
      if (addedCount === 0) {
        results.push(makeSkipped(topicKey, topicName, rounds.length, '无法根据当前计划追加轮次'));
      } else {
        results.push({
          topicKey,
          topicName,
          status: 'changed',
          description: `追加 ${addedCount} 个未完成轮次`,
          beforeCount: rounds.length,
          afterCount: working.length,
          removedCount: 0,
          addedCount,
          rescheduledCount: 0,
        });
      }
      continue;
    }

    const { startDate, intervals } = request.action;
    if (!isValidDate(startDate) || !isValidIntervals(intervals)) {
      nextTasks.push(...rounds);
      results.push(makeSkipped(topicKey, topicName, rounds.length, '模板起始日期或间隔无效'));
      continue;
    }
    const completed = rounds.filter((task) => task.isCompleted);
    const pending = rounds.filter((task) => !task.isCompleted);
    const template = rounds[rounds.length - 1];
    const occupiedDates = new Set(completed.map((task) => task.dueDate));
    const baseOrder = Math.max(0, ...completed.map((task) => task.roundOrder ?? 0));
    const latestCompletedDate = completed
      .map(getEffectiveCompletedDate)
      .sort()
      .at(-1);
    const planCreatedAt = rounds
      .map((task) => task.createdAt)
      .filter((value): value is string => Boolean(value))
      .sort()[0] ?? `${template.originalDueDate ?? template.dueDate}T00:00:00.000Z`;
    const replacement: ReviewTask[] = intervals.map((interval, index) => {
      let dueDate = addDays(startDate, interval);
      while (occupiedDates.has(dueDate)
        || dueDate < todayStr()
        || Boolean(latestCompletedDate && dueDate <= latestCompletedDate)) {
        dueDate = addDays(dueDate, 1);
      }
      occupiedDates.add(dueDate);
      return {
        id: genId('rt'),
        topicName: template.topicName,
        createdAt: planCreatedAt,
        dueDate,
        originalDueDate: dueDate,
        roundOrder: baseOrder + index + 1,
        isCompleted: false,
        tag: template.graphNodeId ? undefined : template.tag,
        outlineNodeId: template.outlineNodeId,
        graphNodeId: template.graphNodeId,
        complexity: template.complexity,
        baseDurationMinutes: template.baseDurationMinutes,
        smStatus: 'scheduled',
      };
    });
    nextTasks.push(...completed, ...replacement);
    pending.forEach((task) => sourceIdsToClear.add(task.id));
    results.push({
      topicKey,
      topicName,
      status: 'changed',
      description: `保留 ${completed.length} 个已完成轮次，按模板生成 ${replacement.length} 个未来轮次`,
      beforeCount: rounds.length,
      afterCount: completed.length + replacement.length,
      removedCount: pending.length,
      addedCount: replacement.length,
      rescheduledCount: 0,
    });
  }

  return {
    request,
    previousTasks,
    nextTasks: sortRounds(nextTasks),
    sourceIdsToClear: [...sourceIdsToClear],
    results,
    affectedTopics: results.filter((result) => result.status === 'changed').length,
    skippedTopics: results.filter((result) => result.status === 'skipped').length,
    removedRounds: results.reduce((sum, result) => sum + result.removedCount, 0),
    addedRounds: results.reduce((sum, result) => sum + result.addedCount, 0),
    rescheduledRounds: results.reduce((sum, result) => sum + result.rescheduledCount, 0),
  };
}

function planCapacityAdjustment(
  reviewTasks: ReviewTask[],
  request: Extract<BatchReviewRequest, { mode: 'goal' }> & {
    goal: Extract<ReviewAdjustmentGoal, { kind: 'backlog' | 'balance' }>;
  },
): BatchReviewPlan {
  const { goal } = request;
  const safeStartDate = isValidDate(goal.startDate) && goal.startDate >= todayStr() ? goal.startDate : todayStr();
  const safeHorizon = boundedInteger(goal.horizonDays, 1, 90, 14);
  const safeCapacity = boundedInteger(goal.capacityMinutes, 15, 1440, 60);
  const safeRoundLimit = boundedInteger(goal.maxRoundsPerDay, 1, 99, 6);
  const safeMoveDays = boundedInteger(goal.maxMoveDays, 0, 365, 30);
  const horizonEnd = addDays(safeStartDate, safeHorizon - 1);
  const deadline = goal.deadline && isValidDate(goal.deadline) ? goal.deadline : undefined;
  const protectedIds = new Set(goal.protectedTaskIds ?? []);
  const selectedKeys = new Set(request.topicKeys);
  const previousTasks = sortRounds(reviewTasks.filter(
    (task) => !task.isArchived && selectedKeys.has(getReviewTopicKey(task)),
  ));
  const groups = new Map<string, ReviewTask[]>();
  previousTasks.forEach((task) => {
    const key = getReviewTopicKey(task);
    groups.set(key, [...(groups.get(key) ?? []), task]);
  });

  // Selected pending rounds are removed from the baseline and placed back one
  // plan at a time. This makes capacity decisions global instead of letting
  // every topic independently choose the same apparently-empty date.
  const occupancyTasks = reviewTasks.filter((task) =>
    task.isArchived
    || task.isCompleted
    || !selectedKeys.has(getReviewTopicKey(task)),
  );
  const occupancy = buildLoadMap(occupancyTasks);
  const addOccupancy = (task: ReviewTask, date: string) => {
    const current = occupancy.get(date) ?? { minutes: 0, rounds: 0 };
    occupancy.set(date, {
      minutes: current.minutes + getReviewRoundDuration(task, task.roundOrder ?? 1),
      rounds: current.rounds + 1,
    });
  };

  const orderedGroups = [...groups.entries()].sort((left, right) => {
    const leftProtected = left[1].some((task) => !task.isCompleted && protectedIds.has(task.id));
    const rightProtected = right[1].some((task) => !task.isCompleted && protectedIds.has(task.id));
    if (leftProtected !== rightProtected) return leftProtected ? -1 : 1;
    const leftPending = sortRounds(left[1]).find((task) => !task.isCompleted);
    const rightPending = sortRounds(right[1]).find((task) => !task.isCompleted);
    return (leftPending?.dueDate ?? '9999-12-31').localeCompare(rightPending?.dueDate ?? '9999-12-31')
      || (leftPending?.topicName ?? '').localeCompare(rightPending?.topicName ?? '', 'zh-CN');
  });

  const nextByTopic = new Map<string, ReviewTask[]>();
  const results: BatchReviewTopicResult[] = [];
  const sourceIdsToClear = new Set<string>();
  const warnings: string[] = [];

  for (const [topicKey, rawRounds] of orderedGroups) {
    const rounds = sortRounds(rawRounds);
    const topicName = rounds[0]?.topicName ?? topicKey;
    const pending = rounds.filter((task) => !task.isCompleted);
    if (pending.length === 0) {
      nextByTopic.set(topicKey, rounds);
      results.push(makeSkipped(topicKey, topicName, rounds.length, '没有未完成轮次，已完成历史保持不变'));
      continue;
    }
    if (goal.kind === 'backlog' && pending[0].dueDate > safeStartDate) {
      pending.forEach((task) => addOccupancy(task, task.dueDate));
      nextByTopic.set(topicKey, rounds);
      results.push(makeSkipped(topicKey, topicName, rounds.length, '下一轮尚未到期，不属于当前积压范围'));
      continue;
    }
    if (goal.kind === 'balance' && !pending.some((task) => task.dueDate >= safeStartDate && task.dueDate <= horizonEnd)) {
      pending.forEach((task) => addOccupancy(task, task.dueDate));
      nextByTopic.set(topicKey, rounds);
      results.push(makeSkipped(topicKey, topicName, rounds.length, '规划区间内没有未完成轮次'));
      continue;
    }

    const first = pending[0];
    const latestCompleted = [...rounds].reverse().find((task) => task.isCompleted);
    const minimumDate = latestCompleted
      ? addDays(getEffectiveCompletedDate(latestCompleted), 1)
      : safeStartDate;
    const candidateDeltas = goal.kind === 'backlog'
      ? Array.from({ length: safeHorizon }, (_, index) => diffDays(addDays(safeStartDate, index), first.dueDate))
      : Array.from({ length: safeMoveDays * 2 + 1 }, (_, index) => index - safeMoveDays)
        .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right);

    let best: { delta: number; score: number; dates: string[] } | null = null;
    for (const delta of candidateDeltas) {
      if (delta !== 0 && pending.some((task) => protectedIds.has(task.id))) continue;
      const dates = pending.map((task) => addDays(task.dueDate, delta));
      if (!isStrictlyOrdered(dates) || new Set(dates).size !== dates.length) continue;
      if (dates[0] < safeStartDate || dates[0] < minimumDate) continue;
      if (deadline && dates[dates.length - 1] > deadline) continue;

      let score = Math.abs(delta) * (goal.kind === 'balance' ? 3 : 1);
      dates.forEach((date, index) => {
        const task = pending[index];
        const current = occupancy.get(date) ?? { minutes: 0, rounds: 0 };
        const minutes = current.minutes + getReviewRoundDuration(task, task.roundOrder ?? index + 1);
        const roundsOnDay = current.rounds + 1;
        const minuteOverflow = Math.max(0, minutes - safeCapacity);
        const roundOverflow = Math.max(0, roundsOnDay - safeRoundLimit);
        score += minuteOverflow * minuteOverflow * 20 + roundOverflow * 10_000;
        if (date < safeStartDate || date > horizonEnd) score += goal.kind === 'backlog' ? 40 : 3;
      });
      if (!best || score < best.score || (score === best.score && Math.abs(delta) < Math.abs(best.delta))) {
        best = { delta, score, dates };
      }
    }

    if (!best) {
      pending.forEach((task) => addOccupancy(task, task.dueDate));
      nextByTopic.set(topicKey, rounds);
      const reason = pending.some((task) => protectedIds.has(task.id))
        ? '已安排到每日计划的轮次受到保护，当前约束下无法移动'
        : deadline
          ? `无法在截止日期 ${deadline} 前保持合法轮次顺序`
          : '当前容量与日期约束下没有安全方案';
      results.push(makeSkipped(topicKey, topicName, rounds.length, reason));
      continue;
    }

    const pendingIds = new Set(pending.map((task) => task.id));
    const replacement = rounds.map((task) => {
      if (!pendingIds.has(task.id)) return task;
      const index = pending.findIndex((candidate) => candidate.id === task.id);
      const dueDate = best!.dates[index];
      addOccupancy(task, dueDate);
      if (dueDate === task.dueDate) return task;
      sourceIdsToClear.add(task.id);
      return {
        ...task,
        dueDate,
        originalDueDate: task.originalDueDate ?? task.dueDate,
        smStatus: 'scheduled' as const,
      };
    });
    nextByTopic.set(topicKey, replacement);
    const changedCount = pending.filter((task, index) => task.dueDate !== best!.dates[index]).length;
    if (changedCount === 0) {
      results.push(makeSkipped(topicKey, topicName, rounds.length, '当前安排已经是约束下的最优方案'));
    } else {
      results.push({
        topicKey,
        topicName,
        status: 'changed',
        description: goal.kind === 'backlog'
          ? `下一轮安排到 ${best.dates[0]}，联动重排 ${changedCount} 个未完成轮次`
          : `在 ${safeHorizon} 天负荷范围内平衡 ${changedCount} 个未完成轮次`,
        beforeCount: rounds.length,
        afterCount: rounds.length,
        removedCount: 0,
        addedCount: 0,
        rescheduledCount: changedCount,
      });
    }
  }

  request.topicKeys.forEach((topicKey) => {
    if (nextByTopic.has(topicKey)) return;
    const topicName = topicKey.replace(/^(graph|topic):/, '');
    results.push(makeSkipped(topicKey, topicName, 0, '当前没有可调整的有效计划'));
  });
  const nextTasks = request.topicKeys.flatMap((topicKey) => nextByTopic.get(topicKey) ?? []);
  const provisional: BatchReviewPlan = {
    request,
    previousTasks,
    nextTasks: sortRounds(nextTasks),
    sourceIdsToClear: [...sourceIdsToClear],
    results,
    affectedTopics: results.filter((result) => result.status === 'changed').length,
    skippedTopics: results.filter((result) => result.status === 'skipped').length,
    removedRounds: 0,
    addedRounds: 0,
    rescheduledRounds: results.reduce((sum, result) => sum + result.rescheduledCount, 0),
    warnings,
    blockingIssues: [],
  };
  const afterWorkspace = combinePlanWithWorkspace(reviewTasks, request, provisional);
  provisional.dayLoads = buildDayLoads(
    reviewTasks,
    afterWorkspace,
    safeStartDate,
    safeHorizon,
    safeCapacity,
    safeRoundLimit,
  );
  const remainingOverload = provisional.dayLoads.filter((day) => day.afterOverCapacity);
  const improvedDays = provisional.dayLoads.filter((day) => day.beforeOverCapacity && !day.afterOverCapacity).length;
  if (remainingOverload.length > 0) {
    warnings.push(`调整后仍有 ${remainingOverload.length} 天超过容量；系统已选择当前约束下负荷最低的方案`);
  }
  if (improvedDays > 0) warnings.push(`已消除 ${improvedDays} 个超载日期`);
  return provisional;
}

const actionForGoal = (goal: Exclude<ReviewAdjustmentGoal, { kind: 'backlog' | 'balance' }>): BatchReviewAction => {
  if (goal.kind === 'cadence') return { kind: 'template', startDate: goal.startDate, intervals: goal.intervals };
  if (goal.kind === 'advanced') return goal.action;
  if (goal.operation === 'trim') return { kind: 'trim', count: goal.count, minRemaining: 1 };
  if (goal.operation === 'append') return { kind: 'append', count: goal.count };
  return { kind: 'template', startDate: goal.startDate, intervals: goal.intervals };
};

export function planBatchReviewAdjustment(
  reviewTasks: ReviewTask[],
  settings: EbbSettings,
  request: BatchReviewRequest,
): BatchReviewPlan {
  if (request.mode === 'goal' && (request.goal.kind === 'backlog' || request.goal.kind === 'balance')) {
    return planCapacityAdjustment(reviewTasks, request as Extract<BatchReviewRequest, { mode: 'goal' }> & {
      goal: Extract<ReviewAdjustmentGoal, { kind: 'backlog' | 'balance' }>;
    });
  }

  const action = request.mode === 'goal'
    ? actionForGoal(request.goal as Exclude<ReviewAdjustmentGoal, { kind: 'backlog' | 'balance' }>)
    : request.action;
  const actionRequest = { topicKeys: request.topicKeys, action };
  const actionPlan = planActionAdjustment(reviewTasks, settings, actionRequest);
  const startDate = request.mode === 'goal' && 'startDate' in request.goal
    ? request.goal.startDate
    : todayStr();
  const afterWorkspace = combinePlanWithWorkspace(reviewTasks, request, actionPlan);
  const horizonDays = 30;
  const capacityMinutes = settings.dailyReviewMinutes;
  const maxRoundsPerDay = Math.max(1, settings.dailyTaskLimit);
  return {
    ...actionPlan,
    request,
    dayLoads: buildDayLoads(
      reviewTasks,
      afterWorkspace,
      isValidDate(startDate) && startDate >= todayStr() ? startDate : todayStr(),
      horizonDays,
      capacityMinutes,
      maxRoundsPerDay,
    ),
    warnings: actionPlan.skippedTopics > 0 ? [`${actionPlan.skippedTopics} 个计划未修改，请在明细中核对原因`] : [],
    blockingIssues: [],
  };
}

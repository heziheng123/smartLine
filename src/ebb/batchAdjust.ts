import { addDays, diffDays } from '../utils/dateSafe.ts';
import type { EbbSettings, ReviewTask } from './types.ts';
import { buildNextRoundTask, genId, getReviewTopicKey } from './scheduler.ts';

export type BatchReviewAction =
  | { kind: 'reanchor'; startDate: string }
  | { kind: 'shift'; days: number }
  | { kind: 'trim'; count: number; minRemaining: number }
  | { kind: 'append'; count: number }
  | { kind: 'template'; startDate: string; intervals: number[] };

export interface BatchReviewRequest {
  topicKeys: string[];
  action: BatchReviewAction;
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

export function planBatchReviewAdjustment(
  reviewTasks: ReviewTask[],
  settings: EbbSettings,
  request: BatchReviewRequest,
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
      if (!isValidDate(request.action.startDate) || pending.length === 0) {
        nextTasks.push(...rounds);
        results.push(makeSkipped(topicKey, topicName, rounds.length, pending.length === 0 ? '没有未完成轮次' : '下一轮日期无效'));
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
      if (new Set(shiftedDates).size !== shiftedDates.length || shiftedDates.some((date) => completedDates.has(date))) {
        nextTasks.push(...rounds);
        results.push(makeSkipped(topicKey, topicName, rounds.length, '调整后会与已有轮次日期冲突'));
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
    const replacement: ReviewTask[] = intervals.map((interval, index) => {
      let dueDate = addDays(startDate, interval);
      while (occupiedDates.has(dueDate)) dueDate = addDays(dueDate, 1);
      occupiedDates.add(dueDate);
      return {
        id: genId('rt'),
        topicName: template.topicName,
        dueDate,
        originalDueDate: dueDate,
        roundOrder: baseOrder + index + 1,
        isCompleted: false,
        tag: template.graphNodeId ? undefined : template.tag,
        outlineNodeId: template.outlineNodeId,
        graphNodeId: template.graphNodeId,
        complexity: template.complexity,
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

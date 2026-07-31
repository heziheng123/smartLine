import { addDays, diffDays, isValidCalendarDate, todayStr } from '@/utils/dateSafe';
import type { ReviewTask } from './types';
import { getReviewTopicKey } from './scheduler';

export type ReviewRescheduleMode = 'single' | 'following';

export interface ReviewRoundReschedulePlan {
  mode: ReviewRescheduleMode;
  taskId: string;
  topicName: string;
  round: number;
  fromDate: string;
  targetDate: string;
  deltaDays: number;
  updates: Array<{ id: string; dueDate: string }>;
}

const sortByRound = (tasks: ReviewTask[]) => [...tasks].sort((a, b) =>
  (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER)
  || (a.originalDueDate ?? a.dueDate).localeCompare(b.originalDueDate ?? b.dueDate)
  || a.id.localeCompare(b.id),
);

export function planReviewRoundReschedule(
  tasks: ReviewTask[],
  taskId: string,
  targetDate: string,
  mode: ReviewRescheduleMode,
  today = todayStr(),
): ReviewRoundReschedulePlan {
  const target = tasks.find((task) => task.id === taskId && !task.isArchived);
  if (!target) throw new Error('复习轮次已经不存在，请刷新后重试');
  if (target.isCompleted) throw new Error('已完成轮次不能改期，请先取消完成');
  if (!isValidCalendarDate(targetDate)) throw new Error('目标日期无效');
  if (targetDate < today) throw new Error('未完成轮次不能安排到今天以前');

  const topicKey = getReviewTopicKey(target);
  const rounds = sortByRound(tasks.filter((task) => !task.isArchived && getReviewTopicKey(task) === topicKey));
  const targetIndex = rounds.findIndex((task) => task.id === taskId);
  if (targetIndex < 0) throw new Error('无法识别当前轮次');
  const deltaDays = diffDays(targetDate, target.dueDate);
  if (deltaDays === 0) throw new Error('轮次日期没有变化');

  const affected = mode === 'following'
    ? rounds.slice(targetIndex).filter((task) => !task.isCompleted)
    : [target];
  const updates = affected.map((task) => ({
    id: task.id,
    dueDate: task.id === taskId ? targetDate : addDays(task.dueDate, deltaDays),
  }));
  const updateById = new Map(updates.map((update) => [update.id, update.dueDate]));
  const resultingDates = rounds.map((task) => updateById.get(task.id) ?? task.dueDate);

  if (new Set(resultingDates).size !== resultingDates.length) {
    throw new Error('调整后同一主题会有两个轮次落在同一天');
  }
  for (let index = 1; index < resultingDates.length; index += 1) {
    if (resultingDates[index] <= resultingDates[index - 1]) {
      throw new Error(mode === 'single'
        ? '仅移动本轮会打乱轮次顺序，请选择“本轮及后续一起移动”'
        : '整体移动后会越过已完成轮次，请选择其他日期');
    }
  }

  return {
    mode,
    taskId,
    topicName: target.topicName,
    round: target.roundOrder ?? targetIndex + 1,
    fromDate: target.dueDate,
    targetDate,
    deltaDays,
    updates,
  };
}

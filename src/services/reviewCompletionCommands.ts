import { useEbbStore } from '@/ebb/store';
import {
  buildNextRoundTask,
  checkCanComplete,
  getReviewTopicKey,
} from '@/ebb/scheduler';
import { todayStr } from '@/utils/dateSafe';
import { requestFinalReviewRoundDecision } from './finalReviewRoundPrompt';

export interface ManualReviewToggleResult {
  ok: boolean;
  cancelled?: boolean;
  message?: string;
  operationId?: string;
}

const pendingTaskIds = new Set<string>();

const sortByRound = <T extends {
  roundOrder?: number;
  originalDueDate?: string;
  dueDate: string;
  id: string;
}>(a: T, b: T) =>
  (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER)
  || (a.originalDueDate ?? a.dueDate).localeCompare(b.originalDueDate ?? b.dueDate)
  || a.id.localeCompare(b.id);

/**
 * The single UI-facing entry point for manually toggling review completion.
 * Automated project-task sync and history undo intentionally keep using the
 * lower-level store method, so they can never be blocked by a dialog.
 */
export async function requestManualReviewToggle(taskId: string): Promise<ManualReviewToggleResult> {
  if (pendingTaskIds.has(taskId)) {
    return { ok: false, message: '这一轮正在等待确认，请先完成当前操作' };
  }
  pendingTaskIds.add(taskId);
  try {
    const state = useEbbStore.getState();
    const task = state.reviewTasks.find((candidate) => candidate.id === taskId && !candidate.isArchived);
    if (!task) return { ok: false, message: '任务不存在' };

    if (task.isCompleted) {
      const error = state.toggleReviewTask(taskId);
      return error ? { ok: false, message: error } : { ok: true, message: '已取消完成' };
    }

    const orderError = checkCanComplete(taskId, state.reviewTasks);
    if (orderError) return { ok: false, message: orderError };

    const topicKey = getReviewTopicKey(task);
    const topicTasks = state.reviewTasks
      .filter((candidate) => !candidate.isArchived && getReviewTopicKey(candidate) === topicKey)
      .sort(sortByRound);
    const isFinalRound = topicTasks[topicTasks.length - 1]?.id === taskId;
    if (!isFinalRound) {
      const error = state.toggleReviewTask(taskId);
      return error ? { ok: false, message: error } : { ok: true, message: '已标记完成' };
    }

    const suggestedTask = buildNextRoundTask(topicTasks, state.ebbSettings);
    if (!suggestedTask) return { ok: false, message: '无法计算下一轮复习日期' };
    const choice = await requestFinalReviewRoundDecision({
      topicName: task.topicName,
      currentRound: topicTasks.length,
      suggestedDate: suggestedTask.dueDate,
      minimumDate: todayStr(),
    });
    if (!choice) return { ok: false, cancelled: true };

    const result = useEbbStore.getState().completeFinalReviewRound({
      taskId,
      decision: choice.decision,
      nextDueDate: choice.decision === 'append' ? choice.nextDueDate : undefined,
    });
    if ('error' in result) return { ok: false, message: result.error };

    return {
      ok: true,
      operationId: result.operationId,
      message: result.nextTask
        ? `已完成第 ${result.completedRound} 轮，并增加第 ${result.completedRound + 1} 轮：${result.nextTask.dueDate}`
        : '已完成最后一轮，当前复习计划已结束',
    };
  } finally {
    pendingTaskIds.delete(taskId);
  }
}

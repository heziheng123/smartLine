import {
  analyzeProjectTaskCompletion,
  buildProjectTaskCompletionFingerprint,
  type ProjectTaskCompletionImpact,
  type ProjectTaskCompletionReviewDecision,
} from '@/domain/projectTaskCompletion';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { useEbbStore } from '@/ebb/store';
import { useGraphStore } from '@/graph/store';
import type { SmartTaskHeader } from '@/types';
import { getQuantityCompleted, getQuantityRecords, getQuantityTotal, isQuantityTask } from '@/utils/blocks';
import { todayStr } from '@/utils/dateSafe';
import {
  recordQuantityProgress,
  resolveProjectTask,
  setProjectTaskCompletion,
  updateProjectTask,
  type ProjectTaskCommandResult,
} from './projectTaskCommands';
import { requestProjectTaskCompletionDecision } from './projectTaskCompletionPrompt';
import type { OperationImpact } from './operationResult';

export type RequestedProjectTaskCommandResult = ProjectTaskCommandResult | {
  ok: false;
  cancelled: true;
};

const pendingCompletions = new Set<string>();

async function ensureCompletionStoresHydrated(): Promise<void> {
  const graph = useGraphStore.getState();
  const ebb = useEbbStore.getState();
  const daily = useDailyScheduleStore.getState();
  await Promise.all([
    graph.isHydrated ? Promise.resolve() : graph.hydrateStore(),
    ebb.isHydrated ? Promise.resolve() : ebb.hydrateStore(),
    daily.isHydrated ? Promise.resolve() : daily.hydrateStore(),
  ]);
}

function buildImpact(header: SmartTaskHeader, completedDate: string): ProjectTaskCompletionImpact {
  const ebb = useEbbStore.getState();
  return analyzeProjectTaskCompletion({
    header,
    completedDate,
    graphNodes: useGraphStore.getState().nodes,
    reviewTasks: ebb.reviewTasks,
    ebbSettings: ebb.ebbSettings,
  });
}

async function decideCompletion(
  taskId: string,
  blockId: string,
  candidateHeader: SmartTaskHeader,
  completedDate: string,
): Promise<ProjectTaskCompletionReviewDecision | null | { error: string }> {
  const key = `${taskId}\u0000${blockId}`;
  if (pendingCompletions.has(key)) return null;
  await ensureCompletionStoresHydrated();
  if (pendingCompletions.has(key)) return null;
  const initial = resolveProjectTask(taskId, blockId);
  if (!initial || initial.block.header.isCompleted) {
    return { error: '任务状态已变化，请重新操作。' };
  }
  const impact = buildImpact(candidateHeader, completedDate);
  impact.fingerprint = buildProjectTaskCompletionFingerprint(
    initial.block.header,
    useGraphStore.getState().nodes,
    useEbbStore.getState().reviewTasks,
  );
  if (impact.nodes.length === 0) return { mode: 'continue' };

  pendingCompletions.add(key);
  try {
    const decision = await requestProjectTaskCompletionDecision(impact);
    if (!decision) return null;

    const current = resolveProjectTask(taskId, blockId);
    if (!current || current.block.header.isCompleted) {
      return { error: '任务状态已变化，请重新操作。' };
    }
    const graphNodes = useGraphStore.getState().nodes;
    const reviewTasks = useEbbStore.getState().reviewTasks;
    const currentFingerprint = buildProjectTaskCompletionFingerprint(
      current.block.header,
      graphNodes,
      reviewTasks,
    );
    if (currentFingerprint !== impact.fingerprint) {
      return { error: '弹窗打开期间任务、节点或复习计划已变化，请重新操作。' };
    }

    if (decision.mode === 'relearn') {
      const selected = new Set(decision.relearnNodeIds ?? []);
      const latestImpact = buildImpact(candidateHeader, completedDate);
      const invalid = latestImpact.nodes.find((node) => selected.has(node.nodeId) && !node.canRelearn);
      if (invalid) return { error: invalid.relearnBlockedReason ?? '当前节点不能重启复习周期。' };
    }
    return decision;
  } finally {
    pendingCompletions.delete(key);
  }
}

export async function requestProjectTaskUpdate(
  taskId: string,
  blockId: string,
  patch: Partial<SmartTaskHeader>,
  impact?: Pick<OperationImpact, 'operation' | 'summary'>,
): Promise<RequestedProjectTaskCommandResult> {
  await ensureCompletionStoresHydrated();
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '任务已经不存在或不再是项目任务。' };
  const candidateHeader = { ...current.block.header, ...patch };
  const newlyCompleted = !current.block.header.isCompleted && candidateHeader.isCompleted;
  if (!newlyCompleted) return updateProjectTask(taskId, blockId, patch, impact);

  const completedDate = candidateHeader.completedDate ?? todayStr();
  const decision = await decideCompletion(taskId, blockId, candidateHeader, completedDate);
  if (!decision) return { ok: false, cancelled: true };
  if ('error' in decision) return { ok: false, error: decision.error };
  return updateProjectTask(taskId, blockId, {
    ...patch,
    isCompleted: true,
    completedDate,
  }, impact, { completionReviewDecision: decision });
}

export async function requestProjectTaskCompletion(
  taskId: string,
  blockId: string,
  completed: boolean,
  completedDate?: string,
): Promise<RequestedProjectTaskCommandResult> {
  await ensureCompletionStoresHydrated();
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '任务已经不存在或不再是项目任务。' };
  if (!completed) return setProjectTaskCompletion(taskId, blockId, false);
  return requestProjectTaskUpdate(taskId, blockId, {
    isCompleted: true,
    completedDate: completedDate ?? todayStr(),
  }, {
    operation: 'complete',
    summary: '已完成任务并同步相关模块',
  });
}

export async function requestQuantityProgress(
  taskId: string,
  blockId: string,
  date: string,
  amount: number,
): Promise<RequestedProjectTaskCommandResult> {
  await ensureCompletionStoresHydrated();
  const current = resolveProjectTask(taskId, blockId);
  if (!current || !isQuantityTask(current.block.header)) {
    return { ok: false, error: '数量任务已经不存在。' };
  }
  const records = getQuantityRecords(current.block.header);
  const currentRecord = records[date] ?? 0;
  const completedBeforeDate = getQuantityCompleted(current.block.header) - currentRecord;
  const total = getQuantityTotal(current.block.header);
  const maxForDate = Math.max(0, total - completedBeforeDate);
  if (!Number.isInteger(amount)
    || amount <= 0
    || amount > maxForDate
    || !current.block.header.date
    || date < current.block.header.date) {
    return recordQuantityProgress(taskId, blockId, date, amount);
  }
  const nextCompleted = completedBeforeDate + amount;
  if (current.block.header.isCompleted || nextCompleted < total) {
    return recordQuantityProgress(taskId, blockId, date, amount);
  }

  const candidateHeader: SmartTaskHeader = {
    ...current.block.header,
    isCompleted: true,
    completedDate: date,
  };
  const decision = await decideCompletion(taskId, blockId, candidateHeader, date);
  if (!decision) return { ok: false, cancelled: true };
  if ('error' in decision) return { ok: false, error: decision.error };
  return recordQuantityProgress(taskId, blockId, date, amount, {
    completionReviewDecision: decision,
  });
}

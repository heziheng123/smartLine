import { useTimelineStore } from '@/store';
import type { SmartTaskBlock, SmartTaskHeader, Task } from '@/types';
import { requiresTaskStartDate } from '@/domain/taskRules';
import {
  getQuantityCompleted,
  getQuantityRecords,
  getQuantityTotal,
  getQuantityUnit,
  isQuantityTask,
  isVocabularyTask,
} from '@/utils/blocks';
import {
  createOperationImpact,
  type AppDomain,
  type OperationImpact,
} from '@/services/operationResult';

export interface ProjectTaskRef {
  task: Task;
  block: SmartTaskBlock;
}

export type ProjectTaskCommandResult =
  | { ok: true; task: ProjectTaskRef; impact: OperationImpact }
  | { ok: false; error: string };

const PROJECT_TASK_DOMAINS = [
  'project',
  'daily-schedule',
  'week-matrix',
  'knowledge-graph',
  'ebb',
  'undo-history',
] as const;

function success(
  task: ProjectTaskRef,
  operation: OperationImpact['operation'],
  summary: string,
  changed = true,
  affectedDomains: readonly AppDomain[] = PROJECT_TASK_DOMAINS,
): ProjectTaskCommandResult {
  return {
    ok: true,
    task,
    impact: createOperationImpact(operation, summary, [...affectedDomains], changed, changed),
  };
}

/**
 * Resolve a project task from the canonical timeline store. UI projections
 * should never update their own copy first: the timeline action coordinates
 * Daily Schedule, EBB, graph activation and the unified undo record.
 */
export function resolveProjectTask(taskId: string, blockId: string): ProjectTaskRef | null {
  const state = useTimelineStore.getState();
  const task = state.tasks.find((candidate) => candidate.id === taskId)
    ?? state.groups.flatMap((group) => group.children).find((candidate) => candidate.id === taskId);
  const block = task?.blocks.find((candidate) => candidate.id === blockId);
  return task && block?.type === 'smart-task' ? { task, block } : null;
}

export function createProjectTask(
  taskId: string,
  block: SmartTaskBlock,
): ProjectTaskCommandResult {
  const state = useTimelineStore.getState();
  const project = state.tasks.find((candidate) => candidate.id === taskId)
    ?? state.groups.flatMap((group) => group.children).find((candidate) => candidate.id === taskId);
  if (!project) return { ok: false, error: '所属项目已经不存在。' };
  if (project.blocks.some((candidate) => candidate.id === block.id)) {
    return { ok: false, error: '任务标识重复，请重新创建。' };
  }
  if (requiresTaskStartDate(block.header) && !block.header.date) {
    return { ok: false, error: '数量任务必须设置开始日期。' };
  }
  state.appendBlock(taskId, block);
  const created = resolveProjectTask(taskId, block.id);
  return created ? success(created, 'create', '已创建任务并更新相关规划视图') : { ok: false, error: '任务创建失败。' };
}

export function updateProjectTask(
  taskId: string,
  blockId: string,
  patch: Partial<SmartTaskHeader>,
  impact: Pick<OperationImpact, 'operation' | 'summary'> = {
    operation: 'update',
    summary: '已更新任务并刷新相关规划视图',
  },
): ProjectTaskCommandResult {
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '任务已经不存在或不再是项目任务。' };
  if (Object.prototype.hasOwnProperty.call(patch, 'date')
    && requiresTaskStartDate(current.block.header)
    && !patch.date) {
    return { ok: false, error: '数量任务必须保留开始日期。' };
  }
  const commit = useTimelineStore.getState().updateBlockHeader(taskId, blockId, patch);
  if (commit.error) return { ok: false, error: commit.error };
  const updated = resolveProjectTask(taskId, blockId);
  if (!updated) return { ok: false, error: '任务更新失败。' };

  const undoablePatch = (
    patch.isCompleted !== undefined
    || Object.prototype.hasOwnProperty.call(patch, 'date')
    || patch.vocabularyRecords !== undefined
    || patch.quantityRecords !== undefined
  );
  const affectedDomains = new Set<AppDomain>(['project', ...commit.affectedDomains]);
  if (commit.changed && undoablePatch) affectedDomains.add('undo-history');
  return success(
    updated,
    impact.operation,
    commit.changed ? impact.summary : '任务内容没有发生变化',
    commit.changed,
    [...affectedDomains],
  );
}

export function rescheduleProjectTask(
  taskId: string,
  blockId: string,
  date?: string,
): ProjectTaskCommandResult {
  return updateProjectTask(taskId, blockId, { date: date || undefined }, {
    operation: 'reschedule',
    summary: date ? `已改期至 ${date} 并更新每日安排` : '已清除排期并从日期视图移除',
  });
}

export function setProjectTaskArchived(
  taskId: string,
  blockId: string,
  archived: boolean,
  archivedAt = new Date().toISOString(),
): ProjectTaskCommandResult {
  return updateProjectTask(taskId, blockId, {
    isArchived: archived,
    frozenAt: archived ? archivedAt : undefined,
  }, {
    operation: 'archive',
    summary: archived ? '已归档任务并从活动视图移除' : '已恢复任务并刷新活动视图',
  });
}

export function deleteProjectTask(
  taskId: string,
  blockId: string,
): ProjectTaskCommandResult {
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '任务已经不存在或不再是项目任务。' };
  useTimelineStore.getState().removeBlock(taskId, blockId);
  return resolveProjectTask(taskId, blockId)
    ? { ok: false, error: '任务删除失败。' }
    : success(current, 'delete', '已删除任务并清理相关日程投影');
}

export function setProjectTaskCompletion(
  taskId: string,
  blockId: string,
  completed: boolean,
  completedDate?: string,
): ProjectTaskCommandResult {
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '任务已经不存在或不再是项目任务。' };
  if (isQuantityTask(current.block.header)) {
    return { ok: false, error: '数量任务需要通过“记录今日完成量”更新进度。' };
  }
  if (current.block.header.isCompleted === completed) {
    return success(current, 'complete', '任务完成状态未发生变化', false);
  }
  return updateProjectTask(taskId, blockId, {
    isCompleted: completed,
    completedDate: completed ? completedDate : undefined,
  }, {
    operation: 'complete',
    summary: completed ? '已完成任务并同步相关模块' : '已取消完成并恢复相关模块状态',
  });
}

export function toggleProjectTaskCompletion(
  taskId: string,
  blockId: string,
  completedDate?: string,
): ProjectTaskCommandResult {
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '任务已经不存在或不再是项目任务。' };
  return setProjectTaskCompletion(taskId, blockId, !current.block.header.isCompleted, completedDate);
}

export function recordVocabularyProgress(
  taskId: string,
  blockId: string,
  date: string,
  learnedWords: number,
): ProjectTaskCommandResult {
  return recordQuantityProgress(taskId, blockId, date, learnedWords);
}

export function recordQuantityProgress(
  taskId: string,
  blockId: string,
  date: string,
  amount: number,
): ProjectTaskCommandResult {
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '数量任务已经不存在。' };
  if (!isQuantityTask(current.block.header)) return { ok: false, error: '当前任务不是数量任务。' };
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: '请输入大于 0 的整数。' };
  }

  const records = getQuantityRecords(current.block.header);
  const currentRecord = records[date] ?? 0;
  const completedBeforeDate = getQuantityCompleted(current.block.header) - currentRecord;
  const total = getQuantityTotal(current.block.header);
  const maxForDate = Math.max(0, total - completedBeforeDate);
  const unit = getQuantityUnit(current.block.header);
  if (amount > maxForDate) {
    return { ok: false, error: `最多还能记录 ${maxForDate} ${unit}。` };
  }

  const nextProgress = completedBeforeDate + amount;
  const recordsPatch = isVocabularyTask(current.block.header)
    ? { vocabularyRecords: { ...records, [date]: amount } }
    : { quantityRecords: { ...records, [date]: amount } };
  return updateProjectTask(taskId, blockId, {
    ...recordsPatch,
    isCompleted: nextProgress >= total,
    completedDate: nextProgress >= total ? date : undefined,
  }, {
    operation: 'record-progress',
    summary: `已记录 ${date} 的数量进度并刷新每日安排`,
  });
}

export function removeVocabularyProgress(
  taskId: string,
  blockId: string,
  date: string,
): ProjectTaskCommandResult {
  return removeQuantityProgress(taskId, blockId, date);
}

export function removeQuantityProgress(
  taskId: string,
  blockId: string,
  date: string,
): ProjectTaskCommandResult {
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '数量任务已经不存在。' };
  if (!isQuantityTask(current.block.header)) return { ok: false, error: '当前任务不是数量任务。' };
  const records = { ...getQuantityRecords(current.block.header) };
  if (records[date] === undefined) {
    return success(current, 'remove-progress', `${date} 没有需要移除的数量记录`, false);
  }
  delete records[date];
  const recordsPatch = isVocabularyTask(current.block.header)
    ? { vocabularyRecords: records }
    : { quantityRecords: records };
  return updateProjectTask(taskId, blockId, {
    ...recordsPatch,
    isCompleted: false,
    completedDate: undefined,
  }, {
    operation: 'remove-progress',
    summary: `已移除 ${date} 的数量记录并恢复进度状态`,
  });
}

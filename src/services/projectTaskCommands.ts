import { useTimelineStore } from '@/store';
import type { SmartTaskBlock, SmartTaskHeader, Task } from '@/types';
import {
  getQuantityCompleted,
  getQuantityRecords,
  getQuantityTotal,
  getQuantityUnit,
  isQuantityTask,
  isVocabularyTask,
} from '@/utils/blocks';

export interface ProjectTaskRef {
  task: Task;
  block: SmartTaskBlock;
}

export type ProjectTaskCommandResult =
  | { ok: true; task: ProjectTaskRef }
  | { ok: false; error: string };

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

export function updateProjectTask(
  taskId: string,
  blockId: string,
  patch: Partial<SmartTaskHeader>,
): ProjectTaskCommandResult {
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '任务已经不存在或不再是项目任务。' };
  useTimelineStore.getState().updateBlockHeader(taskId, blockId, patch);
  return { ok: true, task: current };
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
  if (current.block.header.isCompleted === completed) return { ok: true, task: current };
  return updateProjectTask(taskId, blockId, {
    isCompleted: completed,
    completedDate: completed ? completedDate : undefined,
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
  if (records[date] === undefined) return { ok: true, task: current };
  delete records[date];
  const recordsPatch = isVocabularyTask(current.block.header)
    ? { vocabularyRecords: records }
    : { quantityRecords: records };
  return updateProjectTask(taskId, blockId, {
    ...recordsPatch,
    isCompleted: false,
    completedDate: undefined,
  });
}

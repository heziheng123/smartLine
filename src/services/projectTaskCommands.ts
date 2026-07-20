import { useTimelineStore } from '@/store';
import type { SmartTaskBlock, SmartTaskHeader, Task } from '@/types';
import { getVocabularyLearnedWords, getVocabularyTotalWords, isVocabularyTask } from '@/utils/blocks';

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
  if (isVocabularyTask(current.block.header)) {
    return { ok: false, error: '单词任务需要通过“记录今日单词”更新进度。' };
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
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '单词任务已经不存在。' };
  if (!isVocabularyTask(current.block.header)) return { ok: false, error: '当前任务不是单词任务。' };
  if (!Number.isInteger(learnedWords) || learnedWords <= 0) {
    return { ok: false, error: '请输入大于 0 的整数。' };
  }

  const records = current.block.header.vocabularyRecords ?? {};
  const currentRecord = records[date] ?? 0;
  const learnedBeforeDate = getVocabularyLearnedWords(current.block.header) - currentRecord;
  const total = getVocabularyTotalWords(current.block.header);
  const maxForDate = Math.max(0, total - learnedBeforeDate);
  if (learnedWords > maxForDate) {
    return { ok: false, error: `最多还能记录 ${maxForDate} 个单词。` };
  }

  const nextProgress = learnedBeforeDate + learnedWords;
  return updateProjectTask(taskId, blockId, {
    vocabularyRecords: { ...records, [date]: learnedWords },
    isCompleted: nextProgress >= total,
    completedDate: nextProgress >= total ? date : undefined,
  });
}

export function removeVocabularyProgress(
  taskId: string,
  blockId: string,
  date: string,
): ProjectTaskCommandResult {
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '单词任务已经不存在。' };
  if (!isVocabularyTask(current.block.header)) return { ok: false, error: '当前任务不是单词任务。' };
  const records = { ...(current.block.header.vocabularyRecords ?? {}) };
  if (records[date] === undefined) return { ok: true, task: current };
  delete records[date];
  return updateProjectTask(taskId, blockId, {
    vocabularyRecords: records,
    isCompleted: false,
    completedDate: undefined,
  });
}

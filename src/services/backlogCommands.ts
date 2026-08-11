import {
  captureDailySourceSnapshots,
  useDailyScheduleStore,
  type DailySourceSnapshot,
} from '@/components/dailySchedule/store';
import type { TimeSlot } from '@/components/dailySchedule/types';
import { isBacklogTaskHeader, type BacklogTask } from '@/domain/taskBacklog';
import {
  recordOperation,
  registerUndoExecutor,
  runWithoutOperationRecording,
  useOperationHistory,
} from '@/services/operationHistory';
import {
  rescheduleProjectTask,
  resolveProjectTask,
  updateProjectTask,
  type ProjectTaskRef,
  type ProjectTaskCommandResult,
} from '@/services/projectTaskCommands';
import type { SmartTaskHeader } from '@/types';
import { isQuantityTask } from '@/utils/blocks';

interface BacklogDailyUndoPayload {
  taskId: string;
  blockId: string;
  sourceId: string;
  expectedDate: string;
  previousHeader: Pick<SmartTaskHeader, 'date' | 'frozenAt'>;
  previousDailySnapshots: DailySourceSnapshot[];
  createdKind: 'item' | 'block';
  createdId: string;
}

export type BacklogDailyCommandResult =
  | { ok: true; createdKind: 'item' | 'block'; createdId: string }
  | { ok: false; error: string };

export type ReturnToBacklogCommandResult =
  | {
      ok: true;
      title: string;
      previousDate: string;
      operationId?: string;
    }
  | { ok: false; error: string };

/**
 * Clears the canonical planning date for one standard project task.
 *
 * The Timeline transaction is deliberately the only writer here. It removes
 * every Daily Schedule projection for the task and keeps one contextual
 * rollback snapshot for the current session. All other task metadata remains
 * untouched because the canonical patch only contains date/frozenAt.
 */
export function returnProjectTaskToBacklog(
  taskId: string,
  blockId: string,
): ReturnToBacklogCommandResult {
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { ok: false, error: '任务已经不存在或不再是项目任务。' };

  const { header } = current.block;
  if (header.isArchived) return { ok: false, error: '已归档任务不能移入待排期箱。' };
  if (header.isCompleted) return { ok: false, error: '已完成任务不能移入待排期箱，请先取消完成。' };
  if (isQuantityTask(header)) return { ok: false, error: '数量任务必须保留开始日期，不能移入待排期箱。' };
  if (!header.date) return { ok: false, error: '任务已经在待排期箱中。' };

  const previousOperationId = useOperationHistory.getState().entries[0]?.id;
  const result = rescheduleProjectTask(taskId, blockId);
  if ('error' in result) return { ok: false, error: result.error };

  const latestOperation = useOperationHistory.getState().entries[0];
  return {
    ok: true,
    title: header.title,
    previousDate: header.date,
    operationId: latestOperation?.id !== previousOperationId ? latestOperation?.id : undefined,
  };
}

function restoreBacklogDailyOperation(payload: BacklogDailyUndoPayload): void | string {
  const current = resolveProjectTask(payload.taskId, payload.blockId);
  if (!current) return '任务已经不存在';
  if (current.block.header.date !== payload.expectedDate) return '任务日期已经发生变化';

  const daily = useDailyScheduleStore.getState();
  const day = daily.schedules[payload.expectedDate];
  const createdStillExists = payload.createdKind === 'item'
    ? day?.items.some((item) => item.id === payload.createdId && item.sourceId === payload.sourceId)
    : day?.blocks.some((block) => block.id === payload.createdId && block.sourceId === payload.sourceId);
  if (!createdStillExists) return '每日安排已经发生变化';

  daily.removeBySourceIds([payload.sourceId]);
  const result = runWithoutOperationRecording(() => updateProjectTask(
    payload.taskId,
    payload.blockId,
    {
      date: payload.previousHeader.date,
      frozenAt: payload.previousHeader.frozenAt,
    },
  ));
  if ('error' in result) return result.error;
  daily.restoreSourceSnapshots(payload.previousDailySnapshots);
}

registerUndoExecutor('backlog-daily-schedule', (raw) =>
  restoreBacklogDailyOperation(raw as BacklogDailyUndoPayload));

function resolveSchedulableBacklogTask(
  taskId: string,
  blockId: string,
): { current: ProjectTaskRef } | { error: string } {
  const current = resolveProjectTask(taskId, blockId);
  if (!current) return { error: '任务已经不存在或不再是项目任务。' };
  const { header } = current.block;
  if (header.isArchived) return { error: '任务已经归档，请刷新待排期箱后重试。' };
  if (header.isCompleted) return { error: '任务已经完成，请刷新待排期箱后重试。' };
  if (isQuantityTask(header)) return { error: '数量任务不能从待排期箱安排。' };
  if (!isBacklogTaskHeader(header)) return { error: '任务已经被安排，请刷新待排期箱后重试。' };
  return { current };
}

/** Schedules only when the canonical task still belongs to the backlog. */
export function scheduleBacklogTaskToDate(
  task: Pick<BacklogTask, 'taskId' | 'blockId'>,
  date: string,
): ProjectTaskCommandResult {
  const resolved = resolveSchedulableBacklogTask(task.taskId, task.blockId);
  if ('error' in resolved) return { ok: false, error: resolved.error };
  return rescheduleProjectTask(task.taskId, task.blockId, date);
}

function scheduleCanonicalTask(task: BacklogTask, date: string): {
  result: ProjectTaskCommandResult;
  previousHeader: Pick<SmartTaskHeader, 'date' | 'frozenAt'>;
  previousDailySnapshots: DailySourceSnapshot[];
} {
  const resolved = resolveSchedulableBacklogTask(task.taskId, task.blockId);
  if ('error' in resolved) {
    return {
      result: { ok: false, error: resolved.error },
      previousHeader: {},
      previousDailySnapshots: [],
    };
  }
  const { current } = resolved;
  const previousHeader = {
    date: current.block.header.date,
    frozenAt: current.block.header.frozenAt,
  };
  const previousDailySnapshots = captureDailySourceSnapshots(
    useDailyScheduleStore.getState().schedules,
    [task.sourceId],
  );
  const result = runWithoutOperationRecording(() => updateProjectTask(
    task.taskId,
    task.blockId,
    { date, frozenAt: undefined },
  ));
  return { result, previousHeader, previousDailySnapshots };
}

function rollbackSchedule(
  task: BacklogTask,
  previousHeader: Pick<SmartTaskHeader, 'date' | 'frozenAt'>,
  previousDailySnapshots: DailySourceSnapshot[],
) {
  runWithoutOperationRecording(() => updateProjectTask(
    task.taskId,
    task.blockId,
    previousHeader,
  ));
  useDailyScheduleStore.getState().restoreSourceSnapshots(previousDailySnapshots);
}

function recordBacklogDailyOperation(
  task: BacklogTask,
  payload: BacklogDailyUndoPayload,
  detail: string,
) {
  recordOperation({
    label: `安排“${task.title}”`,
    detail,
    modules: ['项目文档', '周矩阵', '每日安排'],
    undoSpec: { kind: 'backlog-daily-schedule', payload },
  }, () => restoreBacklogDailyOperation(payload));
}

export function scheduleBacklogTaskToSlot(input: {
  task: BacklogTask;
  date: string;
  slot: TimeSlot;
  color?: string;
  categoryColor?: string;
}): BacklogDailyCommandResult {
  const { task, date, slot, color, categoryColor } = input;
  const { result, previousHeader, previousDailySnapshots } = scheduleCanonicalTask(task, date);
  if ('error' in result) return { ok: false, error: result.error };

  const daily = useDailyScheduleStore.getState();
  const beforeIds = new Set((daily.schedules[date]?.items ?? []).map((item) => item.id));
  daily.addScheduledItem(date, {
    sourceId: task.sourceId,
    name: task.title,
    source: 'project',
    timeSlot: slot,
    color,
    categoryColor,
    detail: task.projectName,
    duration: task.duration,
  });
  const created = useDailyScheduleStore.getState().schedules[date]?.items.find(
    (item) => !beforeIds.has(item.id) && item.sourceId === task.sourceId,
  );
  if (!created) {
    rollbackSchedule(task, previousHeader, previousDailySnapshots);
    return { ok: false, error: '未能创建每日时段安排，任务已恢复到待排期箱。' };
  }

  const payload: BacklogDailyUndoPayload = {
    taskId: task.taskId,
    blockId: task.blockId,
    sourceId: task.sourceId,
    expectedDate: date,
    previousHeader,
    previousDailySnapshots,
    createdKind: 'item',
    createdId: created.id,
  };
  recordBacklogDailyOperation(
    task,
    payload,
    `已安排到 ${date} 的${slot === 'morning' ? '上午' : slot === 'afternoon' ? '下午' : '晚上'}`,
  );
  return { ok: true, createdKind: 'item', createdId: created.id };
}

export function scheduleBacklogTaskToTimeBlock(input: {
  task: BacklogTask;
  date: string;
  startTime: string;
  endTime: string;
  color?: string;
  categoryColor?: string;
}): BacklogDailyCommandResult {
  const { task, date, startTime, endTime, color, categoryColor } = input;
  const { result, previousHeader, previousDailySnapshots } = scheduleCanonicalTask(task, date);
  if ('error' in result) return { ok: false, error: result.error };

  const daily = useDailyScheduleStore.getState();
  const beforeIds = new Set((daily.schedules[date]?.blocks ?? []).map((block) => block.id));
  daily.addTimeBlock(date, {
    sourceId: task.sourceId,
    name: task.title,
    source: 'project',
    startTime,
    endTime,
    color,
    categoryColor,
    detail: task.projectName,
  });
  const created = useDailyScheduleStore.getState().schedules[date]?.blocks.find(
    (block) => !beforeIds.has(block.id) && block.sourceId === task.sourceId,
  );
  if (!created) {
    rollbackSchedule(task, previousHeader, previousDailySnapshots);
    return { ok: false, error: '未能创建时间块，任务已恢复到待排期箱。' };
  }

  const payload: BacklogDailyUndoPayload = {
    taskId: task.taskId,
    blockId: task.blockId,
    sourceId: task.sourceId,
    expectedDate: date,
    previousHeader,
    previousDailySnapshots,
    createdKind: 'block',
    createdId: created.id,
  };
  recordBacklogDailyOperation(task, payload, `已安排到 ${date} ${startTime}–${endTime}`);
  return { ok: true, createdKind: 'block', createdId: created.id };
}

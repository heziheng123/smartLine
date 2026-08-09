import { captureDailySourceSnapshots, useDailyScheduleStore } from '@/components/dailySchedule/store';
import {
  planProjectDailyShift,
  planProjectShift,
  projectShiftDailyPlacementsMatch,
  projectShiftTaskDatesMatch,
  type ProjectDailyShiftPlan,
  type ProjectShiftPlan,
} from '@/domain/projectShift';
import { useTimelineStore } from '@/store';
import { getUniqueTasks } from '@/store/timelineData';
import type { Task } from '@/types';
import { recordOperation, registerUndoExecutor } from './operationHistory';

export interface ProjectShiftPreview {
  project: ProjectShiftPlan;
  daily: ProjectDailyShiftPlan;
}

export type ProjectShiftCommandResult =
  | {
      ok: true;
      preview: ProjectShiftPreview;
      operationId: string;
    }
  | { ok: false; error: string };

interface ProjectShiftUndoPayload {
  taskId: string;
  previousTask: Task;
  expectedTask: Task;
  sourceIds: string[];
  dailySnapshots: ReturnType<typeof captureDailySourceSnapshots>;
  expectedDailySchedules: ProjectDailyShiftPlan['nextSchedules'];
}

function schedulesFromSnapshots(
  snapshots: ReturnType<typeof captureDailySourceSnapshots>,
): ProjectDailyShiftPlan['nextSchedules'] {
  const schedules: ProjectDailyShiftPlan['nextSchedules'] = {};
  for (const snapshot of snapshots) {
    const day = schedules[snapshot.date] ?? { date: snapshot.date, items: [], blocks: [] };
    schedules[snapshot.date] = snapshot.kind === 'item'
      ? { ...day, items: [...day.items, { ...snapshot.item }] }
      : { ...day, blocks: [...day.blocks, { ...snapshot.block }] };
  }
  return schedules;
}

function resolveProject(taskId: string): Task | undefined {
  const state = useTimelineStore.getState();
  return getUniqueTasks(state.tasks, state.groups).find((task) => task.id === taskId);
}

export function previewProjectShift(taskId: string, days: number): ProjectShiftPreview {
  const task = resolveProject(taskId);
  if (!task) throw new Error('项目已经不存在，请刷新后重试');
  const project = planProjectShift(task, days);
  const daily = planProjectDailyShift(useDailyScheduleStore.getState().schedules, project.tasks);
  return { project, daily };
}

function restoreProjectShift(payload: ProjectShiftUndoPayload): void | string {
  const current = resolveProject(payload.taskId);
  if (!current) return '项目已经不存在';
  if (!projectShiftTaskDatesMatch(current, payload.expectedTask)) return '项目任务在顺延后又发生了变化';

  const daily = useDailyScheduleStore.getState();
  if (!projectShiftDailyPlacementsMatch(daily.schedules, payload.expectedDailySchedules, payload.sourceIds)) {
    return '顺延后的每日安排又发生了变化';
  }
  daily.removeBySourceIds(payload.sourceIds);
  useTimelineStore.getState().updateTask(payload.previousTask);
  daily.restoreSourceSnapshots(payload.dailySnapshots);
}

export function shiftProjectSchedule(taskId: string, days: number): ProjectShiftCommandResult {
  const timeline = useTimelineStore.getState();
  const daily = useDailyScheduleStore.getState();
  if (!timeline.isHydrated || !daily.isHydrated) {
    return { ok: false, error: '项目或每日安排仍在加载，请稍后重试' };
  }

  let preview: ProjectShiftPreview;
  try {
    preview = previewProjectShift(taskId, days);
  } catch (cause) {
    return { ok: false, error: cause instanceof Error ? cause.message : '无法生成项目顺延方案' };
  }
  if (preview.project.tasks.length === 0) {
    return { ok: false, error: '这个项目没有可顺延的未完成普通任务' };
  }

  const sourceIds = preview.project.tasks.map((task) => task.sourceId);
  const dailySnapshots = captureDailySourceSnapshots(daily.schedules, sourceIds);
  try {
    timeline.updateTask(preview.project.nextTask);
    daily.replaceSchedules(preview.daily.nextSchedules);
  } catch (cause) {
    timeline.updateTask(preview.project.previousTask);
    daily.removeBySourceIds(sourceIds);
    daily.restoreSourceSnapshots(dailySnapshots);
    return { ok: false, error: cause instanceof Error ? cause.message : '项目顺延失败，原计划已恢复' };
  }

  const payload: ProjectShiftUndoPayload = {
    taskId,
    previousTask: preview.project.previousTask,
    expectedTask: preview.project.nextTask,
    sourceIds,
    dailySnapshots,
    expectedDailySchedules: schedulesFromSnapshots(captureDailySourceSnapshots(
      useDailyScheduleStore.getState().schedules,
      sourceIds,
    )),
  };
  const direction = days > 0 ? '顺延' : '提前';
  const operationId = recordOperation({
    label: `${direction}“${preview.project.previousTask.name}”${Math.abs(days)} 天`,
    detail: `${preview.project.tasks.length} 个任务 · ${preview.daily.movedSlotItems + preview.daily.movedTimeBlocks} 个每日安排${preview.daily.collisionFallbacks > 0 ? ` · ${preview.daily.collisionFallbacks} 个时间冲突已转入时段` : ''}`,
    modules: ['项目文档', '每日安排', '周矩阵'],
    undoSpec: { kind: 'project-shift', payload },
  }, () => restoreProjectShift(payload));

  return { ok: true, preview, operationId };
}

registerUndoExecutor('project-shift', (raw) => restoreProjectShift(raw as ProjectShiftUndoPayload));

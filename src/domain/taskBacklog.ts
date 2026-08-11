import type { ReviewTask } from '@/ebb/types';
import type { DaySchedule } from '@/components/dailySchedule/types';
import { getProjectBlockSourceId, getReviewSourceId } from '@/components/dailySchedule/sourceIds';
import type { SmartTaskBlock, Task, TaskGroup } from '@/types';
import { getSmartTaskBlocks, getTaskEstimatedMinutes, getValidGraphNodeIds, isQuantityTask } from '@/utils/blocks';
import { getReviewRoundDuration } from '@/ebb/duration';
import { addDays, getDayOfWeek, todayStr } from '@/utils/dateSafe';
import { timeToMinutes } from '@/components/dailySchedule/conversion';
import { buildProjectDescriptorMap } from './projectDescriptor';

export interface BacklogTask {
  id: string;
  taskId: string;
  blockId: string;
  sourceId: string;
  title: string;
  projectId: string;
  projectName: string;
  projectLabel: string;
  projectColor?: string;
  tag: string;
  tagColor: string;
  duration: number;
  deadline?: string;
  originalDate?: string;
  frozenAt?: string;
  graphNodeCount: number;
  block: SmartTaskBlock;
}

export type BacklogOriginFilter = 'all' | 'manual' | 'recovered';
export type BacklogDeadlineFilter = 'all' | 'overdue' | 'week' | 'none';
export type BacklogDurationFilter = 'all' | 'short' | 'medium' | 'long';
export type BacklogSort = 'deadline' | 'duration' | 'recent' | 'project';

export interface WorkloadPreferences {
  weekdayCapacityMinutes: number;
  weekendCapacityMinutes: number;
  showTaskCount: boolean;
  showDuration: boolean;
}

export interface DateWorkload {
  date: string;
  taskCount: number;
  totalMinutes: number;
  capacityMinutes: number;
  ratio: number;
  quantityCount: number;
}

export const DEFAULT_WORKLOAD_PREFERENCES: WorkloadPreferences = {
  weekdayCapacityMinutes: 240,
  weekendCapacityMinutes: 360,
  showTaskCount: true,
  showDuration: true,
};

export function collectBacklogTasks(tasks: readonly Task[], groups: readonly TaskGroup[] = []): BacklogTask[] {
  const result: BacklogTask[] = [];
  const seen = new Set<string>();
  const projectDescriptors = buildProjectDescriptorMap(tasks, groups);

  for (const task of tasks) {
    for (const block of getSmartTaskBlocks(task.blocks ?? [])) {
      const key = `${task.id}::${block.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const header = block.header;
      if (header.isCompleted || header.isArchived || isQuantityTask(header)) continue;
      if (header.date && !header.frozenAt) continue;
      const descriptor = projectDescriptors.get(task.id);
      result.push({
        id: `backlog:${key}`,
        taskId: task.id,
        blockId: block.id,
        sourceId: getProjectBlockSourceId(task.id, block.id),
        title: header.title,
        projectId: task.id,
        projectName: task.name,
        projectLabel: descriptor?.label ?? task.name,
        projectColor: task.color,
        tag: header.tag || '未分类',
        tagColor: header.tagColor,
        duration: getTaskEstimatedMinutes(header),
        deadline: header.deadline,
        originalDate: header.frozenAt ? header.date : undefined,
        frozenAt: header.frozenAt,
        graphNodeCount: getValidGraphNodeIds(header).length,
        block,
      });
    }
  }

  return result;
}

export function filterAndSortBacklogTasks(
  tasks: readonly BacklogTask[],
  filters: {
    query: string;
    project: string;
    tag: string;
    origin: BacklogOriginFilter;
    deadline: BacklogDeadlineFilter;
    duration: BacklogDurationFilter;
    sort: BacklogSort;
  },
): BacklogTask[] {
  const query = filters.query.trim().toLocaleLowerCase('zh-CN');
  const todayIso = todayStr();
  const weekEndIso = addDays(todayIso, 7);
  return tasks
    .filter((task) => {
      if (filters.project !== 'all' && task.projectId !== filters.project) return false;
      if (filters.tag !== 'all' && task.tag !== filters.tag) return false;
      if (filters.origin === 'manual' && task.frozenAt) return false;
      if (filters.origin === 'recovered' && !task.frozenAt) return false;
      if (filters.deadline === 'none' && task.deadline) return false;
      if (filters.deadline === 'overdue' && (!task.deadline || task.deadline >= todayIso)) return false;
      if (filters.deadline === 'week' && (!task.deadline || task.deadline < todayIso || task.deadline > weekEndIso)) return false;
      if (filters.duration === 'short' && task.duration > 30) return false;
      if (filters.duration === 'medium' && (task.duration <= 30 || task.duration > 60)) return false;
      if (filters.duration === 'long' && task.duration <= 60) return false;
      if (query) {
        const haystack = `${task.title} ${task.projectLabel} ${task.tag}`.toLocaleLowerCase('zh-CN');
        if (!haystack.includes(query)) return false;
      }
      return true;
    })
    .sort((left, right) => {
      if (filters.sort === 'duration') {
        return left.duration - right.duration || compareDeadline(left, right) || left.title.localeCompare(right.title, 'zh-CN');
      }
      if (filters.sort === 'recent') {
        return (right.frozenAt ?? '').localeCompare(left.frozenAt ?? '') || compareDeadline(left, right);
      }
      if (filters.sort === 'project') {
        return left.projectLabel.localeCompare(right.projectLabel, 'zh-CN')
          || left.tag.localeCompare(right.tag, 'zh-CN')
          || compareDeadline(left, right);
      }
      return compareDeadline(left, right)
        || Number(Boolean(right.frozenAt)) - Number(Boolean(left.frozenAt))
        || left.duration - right.duration
        || left.title.localeCompare(right.title, 'zh-CN');
    });
}

function compareDeadline(left: BacklogTask, right: BacklogTask): number {
  return (left.deadline || '9999-12-31').localeCompare(right.deadline || '9999-12-31');
}

function safeDuration(start: string, end: string): number {
  const startMinutes = timeToMinutes(start);
  const endMinutes = timeToMinutes(end);
  return Number.isFinite(startMinutes) && Number.isFinite(endMinutes) && endMinutes > startMinutes
    ? endMinutes - startMinutes
    : 30;
}

/**
 * Builds a de-duplicated workload for every requested date.
 * Canonical project/review tasks establish the source set; a concrete daily item
 * or time block overrides its duration instead of being counted a second time.
 */
export function calculateDateWorkloads(input: {
  dates: readonly string[];
  tasks: readonly Task[];
  reviewTasks: readonly ReviewTask[];
  schedules: Record<string, DaySchedule>;
  preferences: WorkloadPreferences;
}): Map<string, DateWorkload> {
  const { dates, tasks, reviewTasks, schedules, preferences } = input;
  const requested = new Set(dates);
  const durationByDate = new Map<string, Map<string, number>>();
  const quantityByDate = new Map<string, Set<string>>();

  const getDurations = (date: string) => {
    const existing = durationByDate.get(date);
    if (existing) return existing;
    const created = new Map<string, number>();
    durationByDate.set(date, created);
    return created;
  };
  const getQuantities = (date: string) => {
    const existing = quantityByDate.get(date);
    if (existing) return existing;
    const created = new Set<string>();
    quantityByDate.set(date, created);
    return created;
  };

  for (const task of tasks) {
    for (const block of getSmartTaskBlocks(task.blocks ?? [])) {
      const { header } = block;
      if (header.isArchived || header.frozenAt || !header.date) continue;
      const sourceId = getProjectBlockSourceId(task.id, block.id);
      if (isQuantityTask(header)) {
        const lastActiveDate = header.isCompleted ? (header.completedDate ?? header.date) : undefined;
        for (const date of dates) {
          if (date >= header.date && (!lastActiveDate || date <= lastActiveDate)) {
            getQuantities(date).add(sourceId);
            getDurations(date).set(sourceId, getTaskEstimatedMinutes(header));
          }
        }
      } else {
        if (!requested.has(header.date)) continue;
        getDurations(header.date).set(sourceId, getTaskEstimatedMinutes(header));
      }
    }
  }

  for (const review of reviewTasks) {
    if (review.isArchived || !requested.has(review.dueDate)) continue;
    getDurations(review.dueDate).set(getReviewSourceId(review.id), getReviewRoundDuration(review));
  }

  for (const date of dates) {
    const day = schedules[date];
    if (!day) continue;
    const durations = getDurations(date);
    for (const item of day.items ?? []) {
      if (item.source === 'free' || !durations.has(item.sourceId)) {
        durations.set(item.sourceId, getTaskEstimatedMinutes({ duration: item.duration }));
      }
    }
    for (const block of day.blocks ?? []) {
      durations.set(block.sourceId, safeDuration(block.startTime, block.endTime));
    }
  }

  const workloads = new Map<string, DateWorkload>();
  for (const date of dates) {
    const durations = durationByDate.get(date) ?? new Map<string, number>();
    const quantityCount = quantityByDate.get(date)?.size ?? 0;
    const totalMinutes = [...durations.values()].reduce((sum, duration) => sum + duration, 0);
    const dayOfWeek = getDayOfWeek(date);
    const capacityMinutes = dayOfWeek === 0 || dayOfWeek === 6
      ? preferences.weekendCapacityMinutes
      : preferences.weekdayCapacityMinutes;
    workloads.set(date, {
      date,
      taskCount: durations.size,
      totalMinutes,
      capacityMinutes,
      ratio: capacityMinutes > 0 ? totalMinutes / capacityMinutes : 0,
      quantityCount,
    });
  }
  return workloads;
}

export function getWorkloadTone(ratio: number): 'low' | 'medium' | 'high' | 'over' {
  if (ratio > 1) return 'over';
  if (ratio >= 0.9) return 'high';
  if (ratio >= 0.6) return 'medium';
  return 'low';
}

import { getProjectBlockSourceId } from '@/components/dailySchedule/sourceIds';
import type { SmartTaskBlock, SmartTaskHeader, Task, TaskGroup } from '@/types';
import { getSmartTaskBlocks, getTaskEstimatedMinutes, getValidGraphNodeIds, isQuantityTask } from '@/utils/blocks';
import { addDays, todayStr } from '@/utils/dateSafe';
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

/**
 * The single source of truth for whether a project task belongs in the
 * backlog. Recovered tasks deliberately retain their original date, so a date
 * alone is not enough to decide that a task is scheduled.
 */
export function isBacklogTaskHeader(header: Partial<SmartTaskHeader>): boolean {
  if (header.isCompleted || header.isArchived || isQuantityTask(header)) return false;
  return !header.date || Boolean(header.frozenAt);
}

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
      if (!isBacklogTaskHeader(header)) continue;
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
  // Include exactly seven calendar dates: today and the following six days.
  const weekEndIso = addDays(todayIso, 6);
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

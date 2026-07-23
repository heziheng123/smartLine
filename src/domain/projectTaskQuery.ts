import type { SmartTaskHeader } from '@/types';
import { addDays, getDayOfWeek } from '@/utils/dateSafe';
import {
  getTaskPlanningDate,
  getTaskTemporalState,
  isTaskAvailableOnDate,
} from './taskRules';

export type ProjectTaskStatusFilter = 'all' | 'pending' | 'completed' | 'overdue' | 'unscheduled';
export type ProjectTaskDateFilter = 'all' | 'today' | 'week' | 'month';

export const PROJECT_TASK_STATUS_FILTERS: readonly ProjectTaskStatusFilter[] = [
  'all', 'pending', 'completed', 'overdue', 'unscheduled',
];
export const PROJECT_TASK_DATE_FILTERS: readonly ProjectTaskDateFilter[] = [
  'all', 'today', 'week', 'month',
];

export interface ProjectTaskQueryRecord {
  projectId: string;
  tag: string;
  title: string;
  searchableText: string;
  header: SmartTaskHeader;
}

export interface ProjectTaskQueryFilters {
  query: string;
  projectId: string;
  tag: string;
  status: ProjectTaskStatusFilter;
  date: ProjectTaskDateFilter;
}

export interface ProjectTaskStats {
  total: number;
  pending: number;
  today: number;
  overdue: number;
  unscheduled: number;
  completed: number;
}

function endOfWeek(date: string): string {
  const day = getDayOfWeek(date);
  return addDays(date, day === 0 ? 0 : 7 - day);
}

export function filterAndSortProjectTasks<T>(
  items: readonly T[],
  toRecord: (item: T) => ProjectTaskQueryRecord,
  filters: ProjectTaskQueryFilters,
  today: string,
): T[] {
  const query = filters.query.trim().toLocaleLowerCase('zh-CN');
  const weekEnd = endOfWeek(today);
  const month = today.slice(0, 7);

  return items.filter((item) => {
    const record = toRecord(item);
    const state = getTaskTemporalState(record.header, today);
    const planningDate = getTaskPlanningDate(record.header, today);
    if (filters.projectId !== 'all' && record.projectId !== filters.projectId) return false;
    if (filters.tag !== 'all' && record.tag !== filters.tag) return false;
    if (query && !record.searchableText.toLocaleLowerCase('zh-CN').includes(query)) return false;
    if (filters.status === 'pending' && record.header.isCompleted) return false;
    if (filters.status === 'completed' && !record.header.isCompleted) return false;
    if (filters.status === 'overdue' && state !== 'overdue') return false;
    if (filters.status === 'unscheduled' && state !== 'unscheduled') return false;
    if (filters.date === 'today' && planningDate !== today) return false;
    if (filters.date === 'week' && (!planningDate || planningDate < today || planningDate > weekEnd)) return false;
    if (filters.date === 'month' && (!planningDate || planningDate.slice(0, 7) !== month)) return false;
    return true;
  }).sort((left, right) => {
    const a = toRecord(left);
    const b = toRecord(right);
    if (a.header.isCompleted !== b.header.isCompleted) {
      return Number(a.header.isCompleted) - Number(b.header.isCompleted);
    }
    const dateA = getTaskPlanningDate(a.header, today) || '9999-12-31';
    const dateB = getTaskPlanningDate(b.header, today) || '9999-12-31';
    return dateA.localeCompare(dateB) || a.title.localeCompare(b.title, 'zh-CN');
  });
}

export function summarizeProjectTasks<T>(
  items: readonly T[],
  getHeader: (item: T) => SmartTaskHeader,
  today: string,
): ProjectTaskStats {
  const result: ProjectTaskStats = {
    total: items.length,
    pending: 0,
    today: 0,
    overdue: 0,
    unscheduled: 0,
    completed: 0,
  };
  for (const item of items) {
    const header = getHeader(item);
    if (header.isCompleted) {
      result.completed++;
      continue;
    }
    result.pending++;
    const state = getTaskTemporalState(header, today);
    if (isTaskAvailableOnDate(header, today)) result.today++;
    if (state === 'overdue') result.overdue++;
    if (state === 'unscheduled') result.unscheduled++;
  }
  return result;
}

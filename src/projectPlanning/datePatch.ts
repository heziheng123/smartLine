import type { SmartTaskHeader, Task } from '@/types';
import { isValidCalendarDate } from '@/utils/dateSafe';

export function projectDatePatch(start: string, end: string): Pick<Task, 'start' | 'end'> | null {
  if (!isValidCalendarDate(start) || !isValidCalendarDate(end) || start > end) return null;
  return { start, end };
}

export function projectTaskDatePatch(start: string, end: string): Pick<SmartTaskHeader, 'date' | 'deadline'> | null {
  if (!isValidCalendarDate(start) || !isValidCalendarDate(end) || start > end) return null;
  return { date: start, deadline: end };
}

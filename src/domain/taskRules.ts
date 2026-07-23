import type { SmartTaskHeader } from '@/types';

export type TaskTemporalState =
  | 'completed'
  | 'unscheduled'
  | 'invalid'
  | 'waiting'
  | 'active'
  | 'overdue';

export function isContinuousTask(
  header: Partial<SmartTaskHeader> | undefined | null,
): boolean {
  return header?.taskKind === 'quantity' || header?.taskKind === 'vocabulary';
}

export function requiresTaskStartDate(
  header: Partial<SmartTaskHeader> | undefined | null,
): boolean {
  return isContinuousTask(header);
}

export function getTaskDateRole(
  header: Partial<SmartTaskHeader> | undefined | null,
): 'start' | 'scheduled' {
  return isContinuousTask(header) ? 'start' : 'scheduled';
}

/**
 * The single source of truth for date/status semantics across project, overview
 * and daily-planning surfaces.
 */
export function getTaskTemporalState(
  header: Partial<SmartTaskHeader> | undefined | null,
  referenceDate: string,
): TaskTemporalState {
  if (header?.isCompleted) return 'completed';

  if (isContinuousTask(header)) {
    if (!header?.date) return 'invalid';
    if (header.date > referenceDate) return 'waiting';
    if (header.deadline && header.deadline < referenceDate) return 'overdue';
    return 'active';
  }

  if (!header?.date) return 'unscheduled';
  if (header.date < referenceDate) return 'overdue';
  if (header.date === referenceDate) return 'active';
  return 'waiting';
}

export function isTaskAvailableOnDate(
  header: Partial<SmartTaskHeader> | undefined | null,
  date: string,
): boolean {
  if (header?.isCompleted) return false;
  if (isContinuousTask(header)) return Boolean(header?.date && header.date <= date);
  return header?.date === date || header?.deadline === date;
}

export function isTaskOverdueOnDate(
  header: Partial<SmartTaskHeader> | undefined | null,
  date: string,
): boolean {
  return getTaskTemporalState(header, date) === 'overdue';
}

/** Date used by overview grouping/filtering. Active continuous tasks belong to today. */
export function getTaskPlanningDate(
  header: Partial<SmartTaskHeader> | undefined | null,
  referenceDate: string,
): string | undefined {
  const state = getTaskTemporalState(header, referenceDate);
  if (state === 'active' && isContinuousTask(header)) return referenceDate;
  if (state === 'overdue' && isContinuousTask(header)) return header?.deadline;
  return header?.date;
}

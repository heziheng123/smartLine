import type { FocusSession, FocusSubject } from './types';

export interface FocusDayTotal {
  localDate: string;
  activeSeconds: number;
}

export interface FocusSubjectTotal {
  subjectId: string;
  activeSeconds: number;
  sessionCount: number;
  weeklyTargetMinutes?: number;
}

export function visibleFocusSessions(sessions: readonly FocusSession[]): FocusSession[] {
  return sessions.filter((session) => !session.deletedAt);
}

export function weekStart(localDate: string): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - (day === 0 ? 6 : day - 1));
  return date.toISOString().slice(0, 10);
}

function addDays(localDate: string, days: number): string {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function summarizeFocusSubjects(
  sessions: readonly FocusSession[],
  subjects: readonly FocusSubject[],
): FocusSubjectTotal[] {
  const totals = new Map(subjects.map((subject) => [subject.id, {
    subjectId: subject.id,
    activeSeconds: 0,
    sessionCount: 0,
    ...(subject.weeklyTargetMinutes ? { weeklyTargetMinutes: subject.weeklyTargetMinutes } : {}),
  }]));
  for (const session of visibleFocusSessions(sessions)) {
    const total = totals.get(session.subjectId) ?? { subjectId: session.subjectId, activeSeconds: 0, sessionCount: 0 };
    total.activeSeconds += session.activeSeconds;
    total.sessionCount += 1;
    totals.set(session.subjectId, total);
  }
  return [...totals.values()];
}

export function summarizeFocusWeek(
  sessions: readonly FocusSession[],
  currentLocalDate: string,
): FocusDayTotal[] {
  const start = weekStart(currentLocalDate);
  const totals = new Map(Array.from({ length: 7 }, (_, index) => {
    const localDate = addDays(start, index);
    return [localDate, { localDate, activeSeconds: 0 }];
  }));
  for (const session of visibleFocusSessions(sessions)) {
    const total = totals.get(session.localDate);
    if (total) total.activeSeconds += session.activeSeconds;
  }
  return [...totals.values()];
}

export function focusSessionsForDate(sessions: readonly FocusSession[], localDate: string): FocusSession[] {
  return visibleFocusSessions(sessions).filter((session) => session.localDate === localDate);
}

import type { FocusInterruptionReason, FocusSession, FocusSubject } from './types';

export type FocusAnalyticsRange = 'day' | 'week' | 'month' | 'last7' | 'last30' | 'custom';

export interface FocusDateRange {
  start: string;
  end: string;
  label: string;
}

export interface FocusTrendPoint {
  date: string;
  activeSeconds: number;
  sessionCount: number;
}

export interface FocusCategoryTotal {
  id: string;
  name: string;
  color: string;
  activeSeconds: number;
  sessionCount: number;
}

export interface FocusInterruptionSummary {
  count: number;
  activeHours: number;
  perActiveHour: number;
  reasons: Array<{ reason: FocusInterruptionReason; count: number }>;
}

export interface FocusWeekComparison {
  current: { start: string; end: string; activeSeconds: number; sessionCount: number };
  previous: { start: string; end: string; activeSeconds: number; sessionCount: number };
  bySubject: Array<{ subject: FocusSubject; currentSeconds: number; previousSeconds: number; weeklyTargetMinutes?: number }>;
}

export interface FocusQualitySummary {
  averageActiveSeconds: number;
  longestActiveSeconds: number;
  interruptionsPerActiveHour: number;
  pomodoroCompletionRate: number | null;
}

export interface FocusWeeklyReviewInsight {
  mostStableSubject?: { subject: FocusSubject; activeDays: number; sessionCount: number };
  topInterruptionReason?: { reason: FocusInterruptionReason; count: number };
}

const addDays = (value: string, amount: number) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

const monthEnd = (value: string) => {
  const date = new Date(`${value.slice(0, 7)}-01T00:00:00.000Z`);
  date.setUTCMonth(date.getUTCMonth() + 1, 0);
  return date.toISOString().slice(0, 10);
};

const monday = (value: string) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDay();
  return addDays(value, -(day === 0 ? 6 : day - 1));
};

export function focusDateRange(
  range: FocusAnalyticsRange,
  anchor: string,
  customStart: string,
  customEnd: string,
): FocusDateRange {
  if (range === 'day') return { start: anchor, end: anchor, label: anchor };
  if (range === 'week') {
    const start = monday(anchor);
    return { start, end: addDays(start, 6), label: `${start.slice(5)} – ${addDays(start, 6).slice(5)}` };
  }
  if (range === 'last7') return { start: addDays(anchor, -6), end: anchor, label: `近 7 日 · ${addDays(anchor, -6).slice(5)} – ${anchor.slice(5)}` };
  if (range === 'last30') return { start: addDays(anchor, -29), end: anchor, label: `近 30 日 · ${addDays(anchor, -29).slice(5)} – ${anchor.slice(5)}` };
  if (range === 'custom') {
    const start = customStart || anchor;
    const end = customEnd && customEnd >= start ? customEnd : start;
    return { start, end, label: `${start} – ${end}` };
  }
  return { start: `${anchor.slice(0, 7)}-01`, end: monthEnd(anchor), label: anchor.slice(0, 7) };
}

export function visibleSessionsInRange(sessions: readonly FocusSession[], range: FocusDateRange): FocusSession[] {
  return sessions.filter((session) => !session.deletedAt && session.localDate >= range.start && session.localDate <= range.end);
}

export function focusTrend(sessions: readonly FocusSession[], range: FocusDateRange): FocusTrendPoint[] {
  const totals = new Map<string, FocusTrendPoint>();
  for (let date = range.start; date <= range.end; date = addDays(date, 1)) totals.set(date, { date, activeSeconds: 0, sessionCount: 0 });
  for (const session of visibleSessionsInRange(sessions, range)) {
    const point = totals.get(session.localDate);
    if (point) {
      point.activeSeconds += session.activeSeconds;
      point.sessionCount += 1;
    }
  }
  return [...totals.values()];
}

export function focusTimeBuckets(sessions: readonly FocusSession[]): Array<{ label: string; activeSeconds: number }> {
  const values = Array.from({ length: 6 }, (_, index) => ({ label: `${String(index * 4).padStart(2, '0')}:00`, activeSeconds: 0 }));
  for (const session of sessions) {
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: session.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(session.startedAt)));
    values[Math.min(5, Math.floor(hour / 4))].activeSeconds += session.activeSeconds;
  }
  return values;
}

export function focusCategoryTotals(sessions: readonly FocusSession[], subjects: readonly FocusSubject[]): FocusCategoryTotal[] {
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const values = new Map<string, FocusCategoryTotal>();
  for (const session of sessions) {
    const subject = subjectById.get(session.subjectId);
    const current = values.get(session.subjectId) ?? {
      id: session.subjectId,
      name: subject?.name ?? '已归档主题',
      color: subject?.color ?? '#94a3b8',
      activeSeconds: 0,
      sessionCount: 0,
    };
    current.activeSeconds += session.activeSeconds;
    current.sessionCount += 1;
    values.set(session.subjectId, current);
  }
  const sorted = [...values.values()].sort((left, right) => right.activeSeconds - left.activeSeconds);
  if (sorted.length <= 6) return sorted;
  const visible = sorted.slice(0, 5);
  const rest = sorted.slice(5);
  return [...visible, {
    id: 'other', name: '其他', color: '#cbd5e1',
    activeSeconds: rest.reduce((sum, item) => sum + item.activeSeconds, 0),
    sessionCount: rest.reduce((sum, item) => sum + item.sessionCount, 0),
  }];
}

export function focusInterruptionSummary(sessions: readonly FocusSession[]): FocusInterruptionSummary {
  const counts = new Map<FocusInterruptionReason, number>();
  let count = 0;
  for (const session of sessions) {
    for (const interruption of session.interruptions) {
      count += 1;
      if (interruption.reason) counts.set(interruption.reason, (counts.get(interruption.reason) ?? 0) + 1);
    }
  }
  const activeHours = sessions.reduce((sum, session) => sum + session.activeSeconds, 0) / 3600;
  return {
    count,
    activeHours,
    perActiveHour: activeHours ? count / activeHours : 0,
    reasons: [...counts.entries()].map(([reason, reasonCount]) => ({ reason, count: reasonCount })).sort((left, right) => right.count - left.count),
  };
}

export function focusQualitySummary(sessions: readonly FocusSession[]): FocusQualitySummary {
  const activeSeconds = sessions.reduce((sum, session) => sum + session.activeSeconds, 0);
  const pomodoros = sessions.filter((session) => session.mode === 'pomodoro');
  return {
    averageActiveSeconds: sessions.length ? Math.round(activeSeconds / sessions.length) : 0,
    longestActiveSeconds: Math.max(0, ...sessions.map((session) => session.activeSeconds)),
    interruptionsPerActiveHour: focusInterruptionSummary(sessions).perActiveHour,
    pomodoroCompletionRate: pomodoros.length
      ? pomodoros.filter((session) => session.activeSeconds >= session.targetMinutes * 60).length / pomodoros.length
      : null,
  };
}

export function focusWeeklyReviewInsight(
  sessions: readonly FocusSession[],
  subjects: readonly FocusSubject[],
): FocusWeeklyReviewInsight {
  const subjectById = new Map(subjects.map((subject) => [subject.id, subject]));
  const bySubject = new Map<string, { activeDays: Set<string>; sessionCount: number; activeSeconds: number }>();
  for (const session of sessions) {
    const current = bySubject.get(session.subjectId) ?? { activeDays: new Set<string>(), sessionCount: 0, activeSeconds: 0 };
    current.activeDays.add(session.localDate);
    current.sessionCount += 1;
    current.activeSeconds += session.activeSeconds;
    bySubject.set(session.subjectId, current);
  }
  const mostStable = [...bySubject.entries()]
    .map(([subjectId, value]) => ({ subject: subjectById.get(subjectId), ...value }))
    .filter((item): item is { subject: FocusSubject; activeDays: Set<string>; sessionCount: number; activeSeconds: number } => Boolean(item.subject))
    .sort((left, right) => right.activeDays.size - left.activeDays.size || right.sessionCount - left.sessionCount || right.activeSeconds - left.activeSeconds)[0];
  return {
    mostStableSubject: mostStable && { subject: mostStable.subject, activeDays: mostStable.activeDays.size, sessionCount: mostStable.sessionCount },
    topInterruptionReason: focusInterruptionSummary(sessions).reasons[0],
  };
}

export function weeklyTargetForWeek(subject: FocusSubject, weekEnd: string): number | undefined {
  const boundary = `${weekEnd}T23:59:59.999Z`;
  const version = [...(subject.weeklyTargetHistory ?? [])]
    .sort((left, right) => left.effectiveFrom.localeCompare(right.effectiveFrom))
    .filter((item) => item.effectiveFrom <= boundary)
    .at(-1);
  return version ? version.targetMinutes ?? undefined : subject.weeklyTargetMinutes;
}

export function focusWeekComparison(
  sessions: readonly FocusSession[],
  subjects: readonly FocusSubject[],
  anchor: string,
): FocusWeekComparison {
  const currentRange = focusDateRange('week', anchor, anchor, anchor);
  const previousRange = { start: addDays(currentRange.start, -7), end: addDays(currentRange.end, -7) };
  const summarize = (range: FocusDateRange) => {
    const matched = visibleSessionsInRange(sessions, range);
    return { ...range, activeSeconds: matched.reduce((sum, session) => sum + session.activeSeconds, 0), sessionCount: matched.length, sessions: matched };
  };
  const current = summarize(currentRange);
  const previous = summarize({ ...previousRange, label: previousRange.start });
  return {
    current: { start: current.start, end: current.end, activeSeconds: current.activeSeconds, sessionCount: current.sessionCount },
    previous: { start: previous.start, end: previous.end, activeSeconds: previous.activeSeconds, sessionCount: previous.sessionCount },
    bySubject: subjects.filter((subject) => !subject.archivedAt).map((subject) => ({
      subject,
      currentSeconds: current.sessions.filter((session) => session.subjectId === subject.id).reduce((sum, session) => sum + session.activeSeconds, 0),
      previousSeconds: previous.sessions.filter((session) => session.subjectId === subject.id).reduce((sum, session) => sum + session.activeSeconds, 0),
      weeklyTargetMinutes: weeklyTargetForWeek(subject, current.end),
    })).filter((item) => item.currentSeconds || item.previousSeconds).sort((left, right) => Math.max(right.currentSeconds, right.previousSeconds) - Math.max(left.currentSeconds, left.previousSeconds)),
  };
}

export function moveFocusAnchor(range: FocusAnalyticsRange, anchor: string, direction: -1 | 1): string {
  if (range === 'month') {
    const date = new Date(`${anchor.slice(0, 7)}-01T00:00:00.000Z`);
    date.setUTCMonth(date.getUTCMonth() + direction);
    return date.toISOString().slice(0, 10);
  }
  return addDays(anchor, (range === 'week' || range === 'last7' ? 7 : range === 'last30' ? 30 : 1) * direction);
}

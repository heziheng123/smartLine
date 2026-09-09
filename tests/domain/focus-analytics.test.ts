import assert from 'node:assert/strict';
import test from 'node:test';
import { focusCategoryTotals, focusDateRange, focusInterruptionSummary, focusQualitySummary, focusTrend, focusTimeBuckets, focusWeekComparison, focusWeeklyReviewInsight, moveFocusAnchor, weeklyTargetForWeek } from '@/focus/analytics';
import { summarizeFocusCompletion } from '@/focus/completion';
import type { FocusSession, FocusSubject } from '@/focus/types';

const subject = (id: string, name: string): FocusSubject => ({ id, name, color: '#6366f1', order: 0, createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' });
const session = (id: string, subjectId: string, localDate: string, startedAt: string, activeSeconds: number): FocusSession => ({ id, subjectId, localDate, startedAt, endedAt: startedAt, activeSeconds, interruptions: [], timeZone: 'Asia/Shanghai', source: 'manual', mode: 'free', createdAt: startedAt, updatedAt: startedAt });

test('analytics derives an inclusive month trend, time buckets and a compact category breakdown', () => {
  const range = focusDateRange('month', '2026-09-06', '', '');
  const sessions = [session('one', 'math', '2026-09-02', '2026-09-02T01:00:00.000Z', 600), session('two', 'english', '2026-09-06', '2026-09-06T13:00:00.000Z', 1200)];
  assert.equal(focusTrend(sessions, range).length, 30);
  assert.equal(focusTrend(sessions, range)[1]?.activeSeconds, 600);
  assert.equal(focusTimeBuckets(sessions).reduce((sum, item) => sum + item.activeSeconds, 0), 1800);
  assert.deepEqual(focusCategoryTotals(sessions, [subject('math', '数学'), subject('english', '英语')]).map((item) => item.name), ['英语', '数学']);
  assert.equal(moveFocusAnchor('month', '2026-03-01', -1), '2026-02-01');
});

test('analytics summarizes interruption reasons without treating unknown reasons as categories', () => {
  const sessions = [{ ...session('one', 'math', '2026-09-02', '2026-09-02T01:00:00.000Z', 3600), interruptions: [
    { startedAt: '2026-09-02T01:10:00.000Z', endedAt: '2026-09-02T01:12:00.000Z', source: 'manual' as const, reason: 'urgent' as const },
    { startedAt: '2026-09-02T01:20:00.000Z', endedAt: '2026-09-02T01:22:00.000Z', source: 'manual' as const, reason: 'urgent' as const },
    { startedAt: '2026-09-02T01:30:00.000Z', endedAt: '2026-09-02T01:32:00.000Z', source: 'background' as const },
  ] }];
  assert.deepEqual(focusInterruptionSummary(sessions), { count: 3, activeHours: 1, perActiveHour: 3, reasons: [{ reason: 'urgent', count: 2 }] });
});

test('rolling trends, weekly comparison and target versions preserve historical meaning', () => {
  const math = { ...subject('math', '数学'), weeklyTargetMinutes: 300, weeklyTargetHistory: [
    { targetMinutes: 600, effectiveFrom: '2026-08-01T00:00:00.000Z' },
    { targetMinutes: 300, effectiveFrom: '2026-09-07T12:00:00.000Z' },
  ] };
  const sessions = [
    session('previous', 'math', '2026-08-31', '2026-08-31T01:00:00.000Z', 3_600),
    session('current', 'math', '2026-09-07', '2026-09-07T01:00:00.000Z', 7_200),
  ];
  assert.deepEqual(focusDateRange('last7', '2026-09-07', '', ''), { start: '2026-09-01', end: '2026-09-07', label: '近 7 日 · 09-01 – 09-07' });
  assert.equal(focusDateRange('last30', '2026-09-07', '', '').start, '2026-08-09');
  assert.equal(weeklyTargetForWeek(math, '2026-09-06'), 600);
  assert.equal(weeklyTargetForWeek(math, '2026-09-13'), 300);
  const comparison = focusWeekComparison(sessions, [math], '2026-09-07');
  assert.equal(comparison.current.activeSeconds, 7_200);
  assert.equal(comparison.previous.activeSeconds, 3_600);
  assert.equal(comparison.bySubject[0]?.weeklyTargetMinutes, 300);
});

test('completion summary records pauses and pomodoro outcome without changing timer facts', () => {
  const reached = { ...session('one', 'math', '2026-09-02', '2026-09-02T01:00:00.000Z', 3_120), mode: 'pomodoro' as const, targetMinutes: 50, interruptions: [{ startedAt: '2026-09-02T01:10:00.000Z', endedAt: '2026-09-02T01:12:00.000Z', source: 'manual' as const }] };
  assert.deepEqual(summarizeFocusCompletion(reached), { activeSeconds: 3_120, interruptions: 1, targetStatus: 'reached', targetDeltaSeconds: 120 });
  assert.deepEqual(summarizeFocusCompletion({ ...reached, activeSeconds: 2_400 }), { activeSeconds: 2_400, interruptions: 1, targetStatus: 'early', targetDeltaSeconds: 600 });
});

test('quality summary and weekly review insight use completed session facts only', () => {
  const math = subject('math', '数学');
  const writing = subject('writing', '写作');
  const sessions = [
    { ...session('one', 'math', '2026-09-01', '2026-09-01T01:00:00.000Z', 3_000), mode: 'pomodoro' as const, targetMinutes: 50, interruptions: [{ startedAt: '2026-09-01T01:10:00.000Z', endedAt: '2026-09-01T01:12:00.000Z', source: 'manual' as const, reason: 'urgent' as const }] },
    { ...session('two', 'math', '2026-09-03', '2026-09-03T01:00:00.000Z', 1_800), mode: 'pomodoro' as const, targetMinutes: 50, interruptions: [] },
    { ...session('three', 'writing', '2026-09-03', '2026-09-03T03:00:00.000Z', 900), mode: 'free' as const },
  ];
  assert.deepEqual(focusQualitySummary(sessions), {
    averageActiveSeconds: 1_900,
    longestActiveSeconds: 3_000,
    interruptionsPerActiveHour: 1 / (5_700 / 3_600),
    pomodoroCompletionRate: 0.5,
  });
  assert.deepEqual(focusWeeklyReviewInsight(sessions, [math, writing]), {
    mostStableSubject: { subject: math, activeDays: 2, sessionCount: 2 },
    topInterruptionReason: { reason: 'urgent', count: 1 },
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createActiveFocusSession,
  elapsedActiveMs,
  finalizeActiveFocusSession,
  finalizeRecoveredFocusSession,
  localDateAt,
  markFocusRecoveryNeeded,
  pauseActiveFocusSession,
  resumeActiveFocusSession,
  resumeRecoveredFocusSession,
} from '@/focus/session';
import { focusSessionsForDate, summarizeFocusSubjects, summarizeFocusWeek } from '@/focus/statistics';
import { validateActiveFocusSession, validateFocusSession, validateFocusSubject } from '@/focus/validation';

const start = new Date('2026-09-07T00:00:00.000Z');
const active = () => createActiveFocusSession({
  sessionId: 'session-1', workspaceId: 'workspace-a', subjectId: 'subject-1', timeZone: 'Asia/Shanghai', mode: 'pomodoro', targetMinutes: 50,
}, start);

test('focus session excludes pauses and only rounds after total elapsed time', () => {
  const paused = pauseActiveFocusSession(active(), 'urgent', 'manual', new Date('2026-09-07T00:00:30.500Z'));
  const resumed = resumeActiveFocusSession(paused, new Date('2026-09-07T00:01:00.500Z'));
  const session = finalizeActiveFocusSession(resumed, { endedAt: new Date('2026-09-07T00:01:30.000Z') });
  assert.equal(session.activeSeconds, 60);
  assert.deepEqual(session.interruptions, [{ startedAt: '2026-09-07T00:00:30.500Z', endedAt: '2026-09-07T00:01:00.500Z', source: 'manual', reason: 'urgent' }]);
});

test('a session below sixty seconds cannot be formalized', () => {
  assert.throws(() => finalizeActiveFocusSession(active(), { endedAt: new Date('2026-09-07T00:00:59.999Z') }), /至少需要 60 秒/);
});

test('running sessions become conservative recovery-needed sessions', () => {
  const source = active();
  const recovered = markFocusRecoveryNeeded({ ...source, lastTrustedAt: '2026-09-07T00:10:00.000Z' });
  assert.equal(recovered.state, 'recovery-needed');
  assert.equal(recovered.accumulatedActiveMs, 600_000);
  assert.equal(recovered.runningSince, undefined);
});

test('focus validation rejects invalid target, note and subject goal', () => {
  const session = finalizeActiveFocusSession(active(), { endedAt: new Date('2026-09-07T00:01:00.000Z') });
  assert.ok(validateFocusSession({ ...session, targetMinutes: 13 }).some((error) => error.includes('番茄目标')));
  assert.ok(validateFocusSession({ ...session, note: 'a\nb' }).some((error) => error.includes('备注')));
  assert.ok(validateFocusSubject({ id: 's', name: '数学', color: '#fff', order: 0, weeklyTargetMinutes: 0, createdAt: start.toISOString(), updatedAt: start.toISOString() })
    .some((error) => error.includes('每周目标')));
  assert.ok(validateFocusSubject({ id: 's', name: '数学', color: '#fff', order: 0, createdAt: start.toISOString(), updatedAt: start.toISOString(), weeklyTargetHistory: [{ targetMinutes: 50, effectiveFrom: start.toISOString() }, { targetMinutes: 30, effectiveFrom: start.toISOString() }] })
    .some((error) => error.includes('版本')));
});

test('week statistics ignore deleted records and use Monday as first day', () => {
  const session = finalizeActiveFocusSession(active(), { endedAt: new Date('2026-09-07T00:01:00.000Z') });
  const days = summarizeFocusWeek([session, { ...session, id: 'deleted', deletedAt: '2026-09-07T01:00:00.000Z' }], '2026-09-09');
  assert.equal(days[0]?.localDate, '2026-09-07');
  assert.equal(days[0]?.activeSeconds, 60);
  assert.equal(days.reduce((sum, day) => sum + day.activeSeconds, 0), 60);
});

test('free timers never carry a target and paused finalization closes the interruption', () => {
  const free = createActiveFocusSession({
    sessionId: 'free-1', workspaceId: 'workspace-a', subjectId: 'subject-1', timeZone: 'Asia/Shanghai', mode: 'free',
  }, start);
  const paused = pauseActiveFocusSession(free, 'switch-task', 'manual', new Date('2026-09-07T00:01:00.000Z'));
  const session = finalizeActiveFocusSession(paused, { endedAt: new Date('2026-09-07T00:02:00.000Z') });
  assert.equal(session.activeSeconds, 60);
  assert.equal(session.interruptions[0]?.endedAt, '2026-09-07T00:02:00.000Z');
  assert.equal('targetMinutes' in session, false);
});

test('recovery can exclude or explicitly include the unknown interval', () => {
  const recovered = markFocusRecoveryNeeded({ ...active(), lastTrustedAt: '2026-09-07T00:10:00.000Z' });
  const conservative = resumeRecoveredFocusSession(recovered, false, new Date('2026-09-07T00:20:00.000Z'));
  const inclusive = resumeRecoveredFocusSession(recovered, true, new Date('2026-09-07T00:20:00.000Z'));
  assert.equal(conservative.accumulatedActiveMs, 600_000);
  assert.equal(inclusive.accumulatedActiveMs, 1_200_000);
});

test('validation rejects inconsistent fixed dates and invalid active interruption anchors', () => {
  const session = finalizeActiveFocusSession(active(), { endedAt: new Date('2026-09-07T00:01:00.000Z') });
  assert.ok(validateFocusSession({ ...session, localDate: '2026-09-08' }).some((error) => error.includes('固定时区')));
  const paused = pauseActiveFocusSession(active(), 'urgent', 'manual', new Date('2026-09-07T00:01:00.000Z'));
  assert.ok(validateActiveFocusSession({ ...paused, currentInterruption: { ...paused.currentInterruption, reason: 'invalid' } })
    .some((error) => error.includes('打断原因')));
});

test('formalization floors once at the exact sixty-second boundary', () => {
  assert.throws(() => finalizeActiveFocusSession(active(), { endedAt: new Date('2026-09-07T00:00:59.999Z') }), /至少需要 60 秒/);
  const paused = pauseActiveFocusSession(active(), undefined, 'manual', new Date('2026-09-07T00:00:30.250Z'));
  const resumed = resumeActiveFocusSession(paused, new Date('2026-09-07T00:00:30.750Z'));
  assert.equal(finalizeActiveFocusSession(resumed, { endedAt: new Date('2026-09-07T00:01:00.500Z') }).activeSeconds, 60);
});

test('pomodoro validation enforces range and five-minute steps for active and formal sessions', () => {
  for (const targetMinutes of [0, 13, 245, 12.5]) {
    assert.throws(() => createActiveFocusSession({
      sessionId: `invalid-${targetMinutes}`, workspaceId: 'workspace-a', subjectId: 'subject-1', timeZone: 'Asia/Shanghai', mode: 'pomodoro', targetMinutes,
    }, start), /番茄目标/);
  }
  const session = finalizeActiveFocusSession(active(), { endedAt: new Date('2026-09-07T00:01:00.000Z') });
  assert.ok(validateFocusSession({ ...session, mode: 'free', targetMinutes: 50 }).some((error) => error.includes('自由计时')));
});

test('fixed timezone controls the saved date across midnight', () => {
  const source = createActiveFocusSession({
    sessionId: 'midnight', workspaceId: 'workspace-a', subjectId: 'subject-1', timeZone: 'Asia/Shanghai', mode: 'free',
  }, new Date('2026-09-07T15:59:00.000Z'));
  const session = finalizeActiveFocusSession(source, { endedAt: new Date('2026-09-07T16:01:00.000Z') });
  assert.equal(session.localDate, '2026-09-08');
  assert.equal(session.timeZone, 'Asia/Shanghai');
  assert.equal(localDateAt(session.endedAt, session.timeZone), session.localDate);
});

test('recovery finalization preserves its timezone and last trusted boundary', () => {
  const recovered = markFocusRecoveryNeeded({ ...active(), lastTrustedAt: '2026-09-07T00:02:00.000Z' });
  const session = finalizeRecoveredFocusSession(recovered, {});
  assert.equal(session.endedAt, recovered.lastTrustedAt);
  assert.equal(session.source, 'recovered');
  assert.equal(session.timeZone, recovered.timeZone);
  assert.throws(() => finalizeRecoveredFocusSession(recovered, { endedAt: new Date('2026-09-07T00:02:01.000Z') }), /最后可信时间/);
});

test('interruption validation rejects inverted, overlapping and out-of-range intervals', () => {
  const session = finalizeActiveFocusSession(active(), { endedAt: new Date('2026-09-07T00:05:00.000Z') });
  const valid = { startedAt: '2026-09-07T00:01:00.000Z', endedAt: '2026-09-07T00:02:00.000Z', source: 'manual' as const };
  assert.ok(validateFocusSession({ ...session, interruptions: [{ ...valid, endedAt: valid.startedAt }] }).some((error) => error.includes('晚于')));
  assert.ok(validateFocusSession({ ...session, interruptions: [{ ...valid, startedAt: '2026-09-06T23:59:00.000Z' }] }).some((error) => error.includes('会话范围')));
  assert.ok(validateFocusSession({ ...session, interruptions: [valid, { ...valid, startedAt: '2026-09-07T00:01:30.000Z', endedAt: '2026-09-07T00:02:30.000Z' }] }).some((error) => error.includes('重叠')));
});

test('statistics sum exact seconds and ignore tombstones without moving local dates', () => {
  const first = finalizeActiveFocusSession(active(), { endedAt: new Date('2026-09-07T00:01:31.000Z') });
  const second = { ...first, id: 'session-2', activeSeconds: 91 };
  const deleted = { ...first, id: 'deleted-2', deletedAt: '2026-09-07T01:00:00.000Z' };
  const subjects = [{ id: 'subject-1', name: '数学', color: '#fff', order: 0, createdAt: start.toISOString(), updatedAt: start.toISOString(), weeklyTargetMinutes: 3 }];
  assert.equal(summarizeFocusSubjects([first, second, deleted], subjects)[0]?.activeSeconds, 182);
  assert.equal(focusSessionsForDate([first, second, deleted], first.localDate).length, 2);
});

test('background policy defaults to continue and can be initialized per session', () => {
  assert.equal(active().backgroundPolicy, 'continue');
  const autoPause = createActiveFocusSession({
    sessionId: 'auto-pause', workspaceId: 'workspace-a', subjectId: 'subject-1', timeZone: 'Asia/Shanghai', backgroundPolicy: 'auto-pause', mode: 'free',
  }, start);
  assert.equal(autoPause.backgroundPolicy, 'auto-pause');
  assert.equal(elapsedActiveMs(pauseActiveFocusSession(autoPause, undefined, 'background', new Date('2026-09-07T00:01:00.000Z')), new Date('2026-09-07T00:05:00.000Z')), 60_000);
});

test('formal session validation rejects impossible duration, bad source and invalid notes', () => {
  const session = finalizeActiveFocusSession(active(), { endedAt: new Date('2026-09-07T00:01:00.000Z') });
  assert.ok(validateFocusSession({ ...session, activeSeconds: 61 }).some((error) => error.includes('实际时间跨度')));
  assert.ok(validateFocusSession({ ...session, source: 'other' }).some((error) => error.includes('来源')));
  assert.ok(validateFocusSession({ ...session, note: 'x'.repeat(201) }).some((error) => error.includes('200')));
  assert.equal(validateFocusSession({ ...session, correctedAt: start.toISOString(), correctedFields: ['activeSeconds'] }).length, 0);
  assert.ok(validateFocusSession({ ...session, correctedAt: start.toISOString() }).some((error) => error.includes('修正字段')));
});

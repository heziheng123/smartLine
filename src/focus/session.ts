import type {
  ActiveFocusSession,
  FocusBackgroundPolicy,
  FocusInterruptionReason,
  FocusInterruptionSource,
  FocusSession,
  FocusTiming,
} from './types';
import { assertValidActiveFocusSession, assertValidFocusSession } from './validation';

function asIso(value: Date | string): string {
  return typeof value === 'string' ? value : value.toISOString();
}

export function localDateAt(timestamp: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function elapsedActiveMs(active: ActiveFocusSession, now: Date | string): number {
  const current = Date.parse(asIso(now));
  const running = active.state === 'running' && active.runningSince
    ? Math.max(0, current - Date.parse(active.runningSince))
    : 0;
  return active.accumulatedActiveMs + running;
}

export function createActiveFocusSession(
  input: {
    sessionId: string;
    workspaceId: string;
    subjectId: string;
    timeZone: string;
    backgroundPolicy?: FocusBackgroundPolicy;
  } & FocusTiming,
  now = new Date(),
): ActiveFocusSession {
  const timestamp = now.toISOString();
  const result: ActiveFocusSession = {
    storageKey: 'active-focus-session',
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    subjectId: input.subjectId,
    startedAt: timestamp,
    timeZone: input.timeZone,
    accumulatedActiveMs: 0,
    runningSince: timestamp,
    state: 'running',
    backgroundPolicy: input.backgroundPolicy ?? 'continue',
    lastTrustedAt: timestamp,
    interruptions: [],
    ...(input.mode === 'pomodoro' ? { mode: 'pomodoro', targetMinutes: input.targetMinutes } : { mode: 'free' }),
  };
  assertValidActiveFocusSession(result);
  return result;
}

export function pauseActiveFocusSession(
  active: ActiveFocusSession,
  reason: FocusInterruptionReason | undefined,
  source: FocusInterruptionSource,
  now = new Date(),
): ActiveFocusSession {
  if (active.state !== 'running') throw new Error('当前会话不在计时中。');
  const timestamp = now.toISOString();
  const result: ActiveFocusSession = {
    ...active,
    accumulatedActiveMs: elapsedActiveMs(active, timestamp),
    runningSince: undefined,
    state: 'paused',
    lastTrustedAt: timestamp,
    currentInterruption: { startedAt: timestamp, source, ...(reason ? { reason } : {}) },
  };
  assertValidActiveFocusSession(result);
  return result;
}

export function resumeActiveFocusSession(active: ActiveFocusSession, now = new Date()): ActiveFocusSession {
  if (active.state !== 'paused' || !active.currentInterruption) throw new Error('当前会话不在暂停中。');
  const timestamp = now.toISOString();
  const result: ActiveFocusSession = {
    ...active,
    runningSince: timestamp,
    state: 'running',
    lastTrustedAt: timestamp,
    interruptions: [...active.interruptions, { ...active.currentInterruption, endedAt: timestamp }],
    currentInterruption: undefined,
  };
  assertValidActiveFocusSession(result);
  return result;
}

export function markFocusRecoveryNeeded(active: ActiveFocusSession): ActiveFocusSession {
  if (active.state !== 'running') throw new Error('只有运行中的会话需要恢复确认。');
  const result: ActiveFocusSession = {
    ...active,
    accumulatedActiveMs: elapsedActiveMs(active, active.lastTrustedAt),
    runningSince: undefined,
    state: 'recovery-needed',
  };
  assertValidActiveFocusSession(result);
  return result;
}

export function resumeRecoveredFocusSession(
  active: ActiveFocusSession,
  includeUnknownTime: boolean,
  now = new Date(),
): ActiveFocusSession {
  if (active.state !== 'recovery-needed') throw new Error('当前会话不需要恢复处理。');
  const timestamp = now.toISOString();
  const result: ActiveFocusSession = {
    ...active,
    accumulatedActiveMs: active.accumulatedActiveMs + (includeUnknownTime
      ? Math.max(0, Date.parse(timestamp) - Date.parse(active.lastTrustedAt))
      : 0),
    runningSince: timestamp,
    state: 'running',
    lastTrustedAt: timestamp,
  };
  assertValidActiveFocusSession(result);
  return result;
}

export function finalizeActiveFocusSession(
  active: ActiveFocusSession,
  input: { endedAt?: Date; note?: string; now?: Date },
): FocusSession {
  if (active.state === 'recovery-needed') throw new Error('请先处理已中断会话。');
  const endedAt = (input.endedAt ?? input.now ?? new Date()).toISOString();
  const interruptions = active.state === 'paused' && active.currentInterruption
    ? [...active.interruptions, { ...active.currentInterruption, endedAt }]
    : active.interruptions;
  const activeSeconds = Math.floor(elapsedActiveMs(active, endedAt) / 1000);
  const result: FocusSession = {
    id: active.sessionId,
    source: 'timer',
    subjectId: active.subjectId,
    startedAt: active.startedAt,
    endedAt,
    activeSeconds,
    interruptions,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    localDate: localDateAt(endedAt, active.timeZone),
    timeZone: active.timeZone,
    createdAt: endedAt,
    updatedAt: endedAt,
    ...(active.mode === 'pomodoro' ? { mode: 'pomodoro', targetMinutes: active.targetMinutes } : { mode: 'free' }),
  };
  assertValidFocusSession(result);
  return result;
}

export function finalizeRecoveredFocusSession(
  active: ActiveFocusSession,
  input: { endedAt?: Date; note?: string; now?: Date },
): FocusSession {
  if (active.state !== 'recovery-needed') throw new Error('当前会话无需中断恢复处理。');
  const endedAt = (input.endedAt ?? input.now ?? new Date(active.lastTrustedAt)).toISOString();
  if (endedAt > active.lastTrustedAt) throw new Error('中断会话只能按最后可信时间结束。');
  const activeSeconds = Math.floor(active.accumulatedActiveMs / 1000);
  const result: FocusSession = {
    id: active.sessionId,
    source: 'recovered',
    subjectId: active.subjectId,
    startedAt: active.startedAt,
    endedAt,
    activeSeconds,
    interruptions: active.interruptions,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    localDate: localDateAt(endedAt, active.timeZone),
    timeZone: active.timeZone,
    createdAt: endedAt,
    updatedAt: endedAt,
    ...(active.mode === 'pomodoro' ? { mode: 'pomodoro', targetMinutes: active.targetMinutes } : { mode: 'free' }),
  };
  assertValidFocusSession(result);
  return result;
}

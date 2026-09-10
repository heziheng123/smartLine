import { create } from 'zustand';
import { createActiveFocusSession, finalizeActiveFocusSession, finalizeRecoveredFocusSession, markFocusRecoveryNeeded, pauseActiveFocusSession, resumeActiveFocusSession, resumeRecoveredFocusSession } from './session';
import { createActiveFocusSessionAtomically, discardActiveFocusSession, finalizeActiveFocusSessionAtomically, loadActiveFocusSession, persistActiveFocusSession } from './persistence';
import { useFocusStore } from './store';
import type { ActiveFocusSession, FocusBackgroundPolicy, FocusInterruptionReason, FocusInterruptionSource, FocusSession, FocusTiming } from './types';

const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('smartline-focus-v1');
const focusTabId = crypto.randomUUID();
const FOCUS_OWNER_LEASE_KEY = 'smartline-focus-running-owner-v1';
const FOCUS_OWNER_LEASE_MS = 5_000;
let ownedSessionId: string | null = null;

interface FocusOwnerLease {
  tabId: string;
  sessionId: string;
  expiresAt: number;
}

function readOwnerLease(): FocusOwnerLease | null {
  try {
    const value = JSON.parse(localStorage.getItem(FOCUS_OWNER_LEASE_KEY) ?? 'null') as FocusOwnerLease | null;
    return value && typeof value.tabId === 'string' && typeof value.sessionId === 'string'
      && typeof value.expiresAt === 'number' ? value : null;
  } catch {
    return null;
  }
}

function claimRunningSession(sessionId: string): void {
  ownedSessionId = sessionId;
  try {
    localStorage.setItem(FOCUS_OWNER_LEASE_KEY, JSON.stringify({
      tabId: focusTabId,
      sessionId,
      expiresAt: Date.now() + FOCUS_OWNER_LEASE_MS,
    } satisfies FocusOwnerLease));
  } catch { /* BroadcastChannel probe remains available. */ }
}

function releaseRunningSession(sessionId: string): void {
  if (ownedSessionId === sessionId) ownedSessionId = null;
  try {
    const lease = readOwnerLease();
    if (lease?.tabId === focusTabId && lease.sessionId === sessionId) {
      localStorage.removeItem(FOCUS_OWNER_LEASE_KEY);
    }
  } catch { /* optional lease */ }
}

interface ActiveFocusStore {
  active: ActiveFocusSession | null;
  finishRequestedAt: string | null;
  isHydrated: boolean;
  error: string | null;
  hydrate: () => Promise<void>;
  refresh: () => Promise<void>;
  start: (input: { workspaceId: string; subjectId: string; timeZone: string; backgroundPolicy?: FocusBackgroundPolicy } & FocusTiming) => Promise<void>;
  pause: (reason?: FocusInterruptionReason, source?: FocusInterruptionSource) => Promise<void>;
  resume: () => Promise<void>;
  setBackgroundPolicy: (policy: FocusBackgroundPolicy) => Promise<void>;
  requestFinish: () => void;
  cancelFinish: () => void;
  finish: (note?: string) => Promise<FocusSession>;
  finishRecoveryAtLastTrusted: (note?: string) => Promise<FocusSession>;
  resumeRecovery: (includeUnknownTime: boolean) => Promise<void>;
  confirmTimeAnomaly: () => Promise<void>;
  discard: () => Promise<void>;
  refreshAnchor: () => Promise<void>;
  detectClockAnomaly: () => Promise<void>;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : '专注会话保存失败，请重试。';
}

function publish(): void {
  channel?.postMessage({ type: 'changed' });
}

let lastClockSample: { systemMs: number; monotonicMs: number } | null = null;

async function anotherTabOwnsRunningSession(sessionId: string): Promise<boolean> {
  const lease = readOwnerLease();
  if (lease?.sessionId === sessionId && lease.expiresAt > Date.now()) return true;
  if (!channel) return false;
  const probeId = crypto.randomUUID();
  return await new Promise((resolve) => {
    let settled = false;
    const finish = (owned: boolean) => {
      if (settled) return;
      settled = true;
      channel.removeEventListener('message', handler);
      resolve(owned);
    };
    const handler = (event: MessageEvent<unknown>) => {
      const value = event.data as { type?: unknown; probeId?: unknown; sessionId?: unknown } | null;
      if (value?.type === 'running-owner' && value.probeId === probeId && value.sessionId === sessionId) finish(true);
    };
    channel.addEventListener('message', handler);
    channel.postMessage({ type: 'probe-running', probeId, sessionId });
    window.setTimeout(() => finish(false), 750);
  });
}

export const useActiveFocusStore = create<ActiveFocusStore>()((set, get) => {
  const write = async (expected: ActiveFocusSession, next: ActiveFocusSession) => {
    await persistActiveFocusSession(next, expected);
    set({ active: next, error: null });
    publish();
  };
  return {
    active: null,
    finishRequestedAt: null,
    isHydrated: false,
    error: null,
    hydrate: async () => {
      try {
        const active = await loadActiveFocusSession();
        const continuityConfirmed = active?.state === 'running' && await anotherTabOwnsRunningSession(active.sessionId);
        const recovered = active?.state === 'running' && !continuityConfirmed
          ? resumeRecoveredFocusSession(markFocusRecoveryNeeded(active), true)
          : active;
        if (recovered && recovered !== active) await persistActiveFocusSession(recovered, active ?? undefined);
        set({ active: recovered, finishRequestedAt: null, isHydrated: true, error: null });
      } catch (error) {
        set({ isHydrated: true, error: message(error) });
      }
    },
    refresh: async () => {
      try {
        set({ active: await loadActiveFocusSession(), finishRequestedAt: null, error: null });
      } catch (error) {
        set({ error: message(error) });
      }
    },
    start: async (input) => {
      try {
        if (get().active) throw new Error('已有未结束的专注会话，请先处理当前会话。');
        const active = createActiveFocusSession({ ...input, sessionId: crypto.randomUUID() });
        await createActiveFocusSessionAtomically(active);
        claimRunningSession(active.sessionId);
        set({ active, finishRequestedAt: null, error: null });
        publish();
      } catch (error) {
        set({ error: message(error) });
        throw error;
      }
    },
    pause: async (reason, source = 'manual') => {
      try {
        const active = get().active;
        if (!active) throw new Error('没有正在进行的专注会话。');
        await write(active, pauseActiveFocusSession(active, reason, source));
      } catch (error) {
        set({ error: message(error) });
        throw error;
      }
    },
    resume: async () => {
      try {
        const active = get().active;
        if (!active) throw new Error('没有正在进行的专注会话。');
        await write(active, resumeActiveFocusSession(active));
        claimRunningSession(active.sessionId);
      } catch (error) {
        set({ error: message(error) });
        throw error;
      }
    },
    setBackgroundPolicy: async (backgroundPolicy) => {
      try {
        const active = get().active;
        if (!active || active.state === 'recovery-needed') throw new Error('请先处理已中断会话。');
        await write(active, { ...active, backgroundPolicy, lastTrustedAt: new Date().toISOString() });
      } catch (error) {
        set({ error: message(error) });
        throw error;
      }
    },
    requestFinish: () => {
      const active = get().active;
      if (active && active.state !== 'recovery-needed') set({ finishRequestedAt: new Date().toISOString(), error: null });
    },
    cancelFinish: () => set({ finishRequestedAt: null }),
    finish: async (note) => {
      try {
        const active = get().active;
        if (!active) throw new Error('没有正在进行的专注会话。');
        if (active.timeAnomalyAt && !active.timeAnomalyConfirmedAt) throw new Error('检测到设备时间可能变更，请先确认异常时长再保存。');
        const requestedAt = get().finishRequestedAt;
        const session = finalizeActiveFocusSession(active, { note, ...(requestedAt ? { endedAt: new Date(requestedAt) } : {}) });
        const data = await finalizeActiveFocusSessionAtomically(session, active.workspaceId);
        releaseRunningSession(active.sessionId);
        useFocusStore.getState().acceptPersistedFocusData(data);
        set({ active: null, finishRequestedAt: null, error: null });
        publish();
        return session;
      } catch (error) {
        set({ error: message(error) });
        throw error;
      }
    },
    finishRecoveryAtLastTrusted: async (note) => {
      try {
        const active = get().active;
        if (!active) throw new Error('没有正在进行的专注会话。');
        const session = finalizeRecoveredFocusSession(active, { note });
        const data = await finalizeActiveFocusSessionAtomically(session, active.workspaceId);
        releaseRunningSession(active.sessionId);
        useFocusStore.getState().acceptPersistedFocusData(data);
        set({ active: null, finishRequestedAt: null, error: null });
        publish();
        return session;
      } catch (error) {
        set({ error: message(error) });
        throw error;
      }
    },
    resumeRecovery: async (includeUnknownTime) => {
      try {
        const active = get().active;
        if (!active) throw new Error('没有正在进行的专注会话。');
        await write(active, resumeRecoveredFocusSession(active, includeUnknownTime));
        claimRunningSession(active.sessionId);
      } catch (error) {
        set({ error: message(error) });
        throw error;
      }
    },
    confirmTimeAnomaly: async () => {
      try {
        const active = get().active;
        if (!active?.timeAnomalyAt) return;
        await write(active, { ...active, timeAnomalyConfirmedAt: new Date().toISOString() });
      } catch (error) {
        set({ error: message(error) });
        throw error;
      }
    },
    discard: async () => {
      try {
        const active = get().active;
        if (!active) return;
        await discardActiveFocusSession(active.sessionId);
        releaseRunningSession(active.sessionId);
        set({ active: null, finishRequestedAt: null, error: null });
        publish();
      } catch (error) {
        set({ error: message(error) });
        throw error;
      }
    },
    refreshAnchor: async () => {
      const active = get().active;
      if (!active || active.state !== 'running') return;
      try {
        await write(active, { ...active, lastTrustedAt: new Date().toISOString() });
      } catch (error) {
        set({ error: message(error) });
      }
    },
    detectClockAnomaly: async () => {
      const active = get().active;
      const current = { systemMs: Date.now(), monotonicMs: performance.now() };
      const previous = lastClockSample;
      lastClockSample = current;
      if (!active || !previous || active.timeAnomalyAt) return;
      const divergence = Math.abs((current.systemMs - previous.systemMs) - (current.monotonicMs - previous.monotonicMs));
      if (divergence <= 60_000) return;
      try {
        await write(active, { ...active, timeAnomalyAt: new Date(current.systemMs).toISOString(), timeAnomalyDeltaMs: Math.round(divergence) });
      } catch (error) {
        set({ error: message(error) });
      }
    },
  };
});

export function startActiveFocusRuntime(): () => void {
  const refresh = () => { void useActiveFocusStore.getState().refresh(); };
  const respondToProbe = (event: MessageEvent<unknown>) => {
    const value = event.data as { type?: unknown; probeId?: unknown; sessionId?: unknown } | null;
    const active = useActiveFocusStore.getState().active;
    if (value?.type === 'probe-running' && typeof value.probeId === 'string'
      && active?.state === 'running' && active.sessionId === value.sessionId
      && ownedSessionId === active.sessionId) {
      channel?.postMessage({ type: 'running-owner', probeId: value.probeId, sessionId: active.sessionId });
    }
  };
  let autoPausePending = false;
  const autoPause = () => {
    if (autoPausePending) return;
    autoPausePending = true;
    void useActiveFocusStore.getState().pause(undefined, 'background').catch(() => undefined).finally(() => { autoPausePending = false; });
  };
  const visibility = () => {
    const active = useActiveFocusStore.getState().active;
    if (document.visibilityState === 'hidden') {
      if (active?.state === 'running' && active.backgroundPolicy === 'auto-pause') {
        autoPause();
      } else {
        void useActiveFocusStore.getState().refreshAnchor();
      }
    }
  };
  const pageHide = () => {
    const active = useActiveFocusStore.getState().active;
    if (active?.state === 'running' && active.backgroundPolicy === 'auto-pause') autoPause();
    else void useActiveFocusStore.getState().refreshAnchor();
  };
  lastClockSample = { systemMs: Date.now(), monotonicMs: performance.now() };
  const anomalyTimer = window.setInterval(() => { void useActiveFocusStore.getState().detectClockAnomaly(); }, 5_000);
  const ownerHeartbeat = window.setInterval(() => {
    const active = useActiveFocusStore.getState().active;
    if (active?.state === 'running' && ownedSessionId === active.sessionId) claimRunningSession(active.sessionId);
  }, 1_000);
  channel?.addEventListener('message', refresh);
  channel?.addEventListener('message', respondToProbe);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('pagehide', pageHide);
  return () => {
    channel?.removeEventListener('message', refresh);
    channel?.removeEventListener('message', respondToProbe);
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('pagehide', pageHide);
    window.clearInterval(anomalyTimer);
    window.clearInterval(ownerHeartbeat);
  };
}

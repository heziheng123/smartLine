export interface WorkspaceTabCoordinatorOptions {
  onLeader: () => void;
  onFollower: () => void;
}

const LEADER_KEY = 'smart-line-sync-leader-v1';
const LEASE_MS = 7_000;
const CLAIM_SETTLE_MS = 75;
const tabId = crypto.randomUUID();
let currentLeader = false;

interface LeaderLease { tabId: string; expiresAt: number }

function readLease(): LeaderLease | null {
  try { return JSON.parse(localStorage.getItem(LEADER_KEY) ?? 'null') as LeaderLease | null; }
  catch { return null; }
}

export function isCurrentTabSyncLeader(): boolean { return currentLeader; }

export function startWorkspaceTabCoordinator(options: WorkspaceTabCoordinatorOptions): () => void {
  if (typeof navigator !== 'undefined' && navigator.locks) {
    let stopped = false;
    let requesting = false;
    let releaseLock: (() => void) | null = null;
    let leaseTimer: number | null = null;

    const renewLease = () => {
      try {
        localStorage.setItem(LEADER_KEY, JSON.stringify({ tabId, expiresAt: Date.now() + LEASE_MS }));
      } catch {
        // Web Locks remains authoritative when storage is unavailable.
      }
    };
    const releaseLease = () => {
      try {
        if (readLease()?.tabId === tabId) localStorage.removeItem(LEADER_KEY);
      } catch { /* optional compatibility lease */ }
    };

    const attempt = () => {
      if (stopped || requesting || currentLeader) return;
      const compatibilityLease = readLease();
      if (compatibilityLease && compatibilityLease.tabId !== tabId && compatibilityLease.expiresAt > Date.now()) {
        options.onFollower();
        return;
      }
      requesting = true;
      void navigator.locks.request(
        'smartline-sync-leader',
        { mode: 'exclusive', ifAvailable: true },
        async (lock) => {
          requesting = false;
          if (stopped || !lock) {
            if (!currentLeader) options.onFollower();
            return;
          }
          currentLeader = true;
          renewLease();
          leaseTimer = window.setInterval(renewLease, 2_000);
          options.onLeader();
          await new Promise<void>((resolve) => { releaseLock = resolve; });
          releaseLock = null;
          if (leaseTimer !== null) window.clearInterval(leaseTimer);
          leaseTimer = null;
          releaseLease();
          if (currentLeader) {
            currentLeader = false;
            options.onFollower();
          }
        },
      ).catch(() => {
        requesting = false;
        if (!currentLeader) options.onFollower();
      });
    };

    attempt();
    const retryTimer = window.setInterval(attempt, 2_000);
    return () => {
      stopped = true;
      window.clearInterval(retryTimer);
      releaseLock?.();
      releaseLock = null;
      if (leaseTimer !== null) window.clearInterval(leaseTimer);
      releaseLease();
      currentLeader = false;
    };
  }

  let stopped = false;
  let claimTimer: number | null = null;
  const cancelClaim = () => {
    if (claimTimer !== null) window.clearTimeout(claimTimer);
    claimTimer = null;
  };
  const becomeFollower = () => {
    cancelClaim();
    if (!currentLeader) return;
    currentLeader = false;
    options.onFollower();
  };
  const confirmClaim = () => {
    claimTimer = null;
    if (stopped) return;
    const lease = readLease();
    if (lease?.tabId !== tabId || lease.expiresAt <= Date.now()) return;
    if (!currentLeader) {
      currentLeader = true;
      options.onLeader();
    }
  };
  const evaluate = () => {
    if (stopped) return;
    const now = Date.now();
    const lease = readLease();
    const mayLead = !lease || lease.expiresAt <= now || lease.tabId === tabId;
    if (!mayLead) {
      becomeFollower();
      return;
    }
    if (currentLeader) {
      const next: LeaderLease = { tabId, expiresAt: now + LEASE_MS };
      try { localStorage.setItem(LEADER_KEY, JSON.stringify(next)); }
      catch { becomeFollower(); }
      return;
    }
    if (claimTimer !== null) return;
    const next: LeaderLease = { tabId, expiresAt: now + LEASE_MS };
    try { localStorage.setItem(LEADER_KEY, JSON.stringify(next)); }
    catch { options.onFollower(); return; }
    // localStorage has no compare-and-set. Delay leadership until every tab
    // has observed the competing claims and only the final lease owner remains.
    claimTimer = window.setTimeout(confirmClaim, CLAIM_SETTLE_MS);
  };
  const handleStorage = (event: StorageEvent) => { if (event.key === LEADER_KEY) evaluate(); };
  const release = () => {
    if (readLease()?.tabId === tabId) localStorage.removeItem(LEADER_KEY);
  };
  evaluate();
  const timer = window.setInterval(evaluate, 2_000);
  window.addEventListener('storage', handleStorage);
  window.addEventListener('beforeunload', release);
  return () => {
    stopped = true;
    cancelClaim();
    window.clearInterval(timer);
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener('beforeunload', release);
    release();
    currentLeader = false;
  };
}

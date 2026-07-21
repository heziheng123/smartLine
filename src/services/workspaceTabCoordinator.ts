export interface WorkspaceTabCoordinatorOptions {
  onLeader: () => void;
  onFollower: () => void;
}

const LEADER_KEY = 'smart-line-sync-leader-v1';
const LEASE_MS = 7_000;
const tabId = crypto.randomUUID();
let currentLeader = false;

interface LeaderLease { tabId: string; expiresAt: number }

function readLease(): LeaderLease | null {
  try { return JSON.parse(localStorage.getItem(LEADER_KEY) ?? 'null') as LeaderLease | null; }
  catch { return null; }
}

export function isCurrentTabSyncLeader(): boolean { return currentLeader; }

export function startWorkspaceTabCoordinator(options: WorkspaceTabCoordinatorOptions): () => void {
  let stopped = false;
  const evaluate = () => {
    if (stopped) return;
    const now = Date.now();
    const lease = readLease();
    const mayLead = !lease || lease.expiresAt <= now || lease.tabId === tabId;
    if (mayLead) {
      const next: LeaderLease = { tabId, expiresAt: now + LEASE_MS };
      localStorage.setItem(LEADER_KEY, JSON.stringify(next));
      if (!currentLeader) {
        currentLeader = true;
        options.onLeader();
      }
    } else if (currentLeader) {
      currentLeader = false;
      options.onFollower();
    }
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
    window.clearInterval(timer);
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener('beforeunload', release);
    release();
    currentLeader = false;
  };
}

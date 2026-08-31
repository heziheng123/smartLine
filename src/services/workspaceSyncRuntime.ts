export type WorkspaceSyncRuntimePhase =
  | 'idle'
  | 'connecting'
  | 'initializing'
  | 'migrating'
  | 'flushing'
  | 'verifying'
  | 'connected'
  | 'conflict'
  | 'error';

export interface WorkspaceSyncRuntimeState {
  phase: WorkspaceSyncRuntimePhase;
  message: string;
  error?: string;
  revision: number;
  updatedAt: string;
}

export interface WorkspaceSyncActivity {
  update: (phase: WorkspaceSyncRuntimePhase, message: string) => void;
  finish: (phase?: 'idle' | 'connected' | 'conflict', message?: string) => void;
  fail: (error: unknown) => void;
}

export const WORKSPACE_SYNC_RUNTIME_EVENT = 'smartline:workspace-sync-runtime';

const activeActivities = new Map<number, Omit<WorkspaceSyncRuntimeState, 'revision' | 'updatedAt'>>();
let nextActivityId = 0;
let revision = 0;
let settledState: Omit<WorkspaceSyncRuntimeState, 'revision' | 'updatedAt'> = {
  phase: 'idle',
  message: '',
};
let runtimeState: WorkspaceSyncRuntimeState = {
  ...settledState,
  revision,
  updatedAt: new Date().toISOString(),
};

function publishRuntimeState(): void {
  const latestActivity = [...activeActivities.entries()].at(-1)?.[1];
  revision += 1;
  runtimeState = {
    ...(latestActivity ?? settledState),
    revision,
    updatedAt: new Date().toISOString(),
  };
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORKSPACE_SYNC_RUNTIME_EVENT, { detail: runtimeState }));
  }
}

export function readWorkspaceSyncRuntimeState(): WorkspaceSyncRuntimeState {
  return runtimeState;
}

export function setWorkspaceSyncRuntimeOutcome(
  phase: 'idle' | 'connected' | 'conflict' | 'error',
  message: string,
  error?: string,
): void {
  settledState = { phase, message, ...(error ? { error } : {}) };
  publishRuntimeState();
}

export function beginWorkspaceSyncActivity(
  phase: WorkspaceSyncRuntimePhase,
  message: string,
): WorkspaceSyncActivity {
  const id = ++nextActivityId;
  activeActivities.set(id, { phase, message });
  publishRuntimeState();

  const remove = () => activeActivities.delete(id);
  return {
    update(nextPhase, nextMessage) {
      if (!activeActivities.has(id)) return;
      activeActivities.set(id, { phase: nextPhase, message: nextMessage });
      publishRuntimeState();
    },
    finish(nextPhase = 'connected', nextMessage = '') {
      if (!remove()) return;
      settledState = { phase: nextPhase, message: nextMessage };
      publishRuntimeState();
    },
    fail(error) {
      if (!remove()) return;
      const message = error instanceof Error ? error.message : '同步操作失败。';
      // A detected conflict is more actionable than the connection error it
      // causes upstream, so keep that settled outcome until the user resolves it.
      if (settledState.phase !== 'conflict') {
        settledState = { phase: 'error', message, error: message };
      }
      publishRuntimeState();
    },
  };
}


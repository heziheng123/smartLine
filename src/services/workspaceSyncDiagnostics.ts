export interface WorkspaceSyncDiagnostics {
  lastLocalSavedAt?: string;
  lastLocalSaveMs?: number;
  lastCloudConfirmedAt?: string;
  lastCloudWaitMs?: number;
  lastFailureAt?: string;
  lastFailure?: string;
  retry?: { attempt: number; nextAt: string };
}

const DIAGNOSTICS_KEY = 'smart-line-workspace-sync-diagnostics-v1';
export const WORKSPACE_SYNC_DIAGNOSTICS_EVENT = 'smartline:workspace-sync-diagnostics';

let memoryState: WorkspaceSyncDiagnostics = {};

export function readWorkspaceSyncDiagnostics(): WorkspaceSyncDiagnostics {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIAGNOSTICS_KEY) ?? '{}') as WorkspaceSyncDiagnostics;
    return parsed && typeof parsed === 'object' ? parsed : memoryState;
  } catch {
    return memoryState;
  }
}

function writeWorkspaceSyncDiagnostics(update: Partial<WorkspaceSyncDiagnostics>): void {
  memoryState = { ...readWorkspaceSyncDiagnostics(), ...update };
  try { localStorage.setItem(DIAGNOSTICS_KEY, JSON.stringify(memoryState)); } catch { /* diagnostics are optional */ }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(WORKSPACE_SYNC_DIAGNOSTICS_EVENT, { detail: memoryState }));
  }
}

export function recordWorkspaceLocalSaved(durationMs: number): void {
  writeWorkspaceSyncDiagnostics({
    lastLocalSavedAt: new Date().toISOString(),
    lastLocalSaveMs: Math.max(0, Math.round(durationMs)),
  });
}

export function recordWorkspaceCloudConfirmed(pendingUpdatedAt: string): void {
  const queuedAt = Date.parse(pendingUpdatedAt);
  writeWorkspaceSyncDiagnostics({
    lastCloudConfirmedAt: new Date().toISOString(),
    lastCloudWaitMs: Number.isNaN(queuedAt) ? undefined : Math.max(0, Date.now() - queuedAt),
    lastFailureAt: undefined,
    lastFailure: undefined,
    retry: undefined,
  });
}

export function recordWorkspaceSyncFailure(message: string): void {
  writeWorkspaceSyncDiagnostics({ lastFailureAt: new Date().toISOString(), lastFailure: message });
}

export function recordWorkspaceSyncRetry(attempt: number, delayMs: number): void {
  writeWorkspaceSyncDiagnostics({
    retry: { attempt, nextAt: new Date(Date.now() + delayMs).toISOString() },
  });
}

export function clearWorkspaceSyncRetry(): void {
  writeWorkspaceSyncDiagnostics({ retry: undefined });
}

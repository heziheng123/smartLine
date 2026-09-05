export type ModuleSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type SyncIndicatorState = 'off' | 'connecting' | 'connected' | 'pending' | 'needs-action' | 'stopped';
export type SyncRuntimePhase = 'idle' | 'connecting' | 'initializing' | 'migrating' | 'flushing' | 'verifying' | 'connected' | 'conflict' | 'error';

export interface ModuleSyncState {
  enabled: boolean;
  status: ModuleSyncStatus;
}

export interface SyncIndicatorSnapshot {
  modules: ModuleSyncState[];
  online: boolean;
  pendingCount: number;
  conflictCount: number;
  queueError: boolean;
  recoverableError?: boolean;
  runtimePhase?: SyncRuntimePhase;
}

export function deriveSyncIndicatorState(snapshot: SyncIndicatorSnapshot): SyncIndicatorState {
  const enabledModules = snapshot.modules.filter((module) => module.enabled);
  if (enabledModules.length === 0) return 'off';
  // 'stopped' state: critical errors that require manual intervention
  if (snapshot.queueError) return 'stopped';
  if (snapshot.runtimePhase === 'error') return 'stopped';
  if (enabledModules.some((module) => module.status === 'error')) return 'stopped';
  // 'needs-action' state: conflicts that require user selection
  if (snapshot.conflictCount > 0) return 'needs-action';
  if (snapshot.runtimePhase === 'conflict') return 'needs-action';
  // 'pending' state: auto-recoverable issues (offline, uploading, etc.)
  if (!snapshot.online) return 'pending';
  if (snapshot.pendingCount > 0) return 'pending';
  if (snapshot.recoverableError) return 'pending';
  if (enabledModules.length !== snapshot.modules.length) return 'pending';
  if (enabledModules.some((module) => module.status === 'disconnected')) return 'pending';
  // 'connecting' state: active operations
  if (snapshot.runtimePhase && ['connecting', 'initializing', 'migrating', 'flushing', 'verifying'].includes(snapshot.runtimePhase)) {
    return 'connecting';
  }
  if (enabledModules.some((module) => module.status === 'connecting')) return 'connecting';
  // 'connected' state: fully synchronized
  if (enabledModules.every((module) => module.status === 'connected')) return 'connected';
  return 'connecting';
}

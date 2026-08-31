export type ModuleSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type SyncIndicatorState = 'off' | 'connecting' | 'connected' | 'pending' | 'error';
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
  runtimePhase?: SyncRuntimePhase;
}

export function deriveSyncIndicatorState(snapshot: SyncIndicatorSnapshot): SyncIndicatorState {
  const enabledModules = snapshot.modules.filter((module) => module.enabled);
  if (enabledModules.length === 0) return 'off';
  if (
    snapshot.queueError
    || snapshot.conflictCount > 0
    || snapshot.runtimePhase === 'conflict'
    || snapshot.runtimePhase === 'error'
    || enabledModules.some((module) => module.status === 'error')
  ) return 'error';
  if (
    !snapshot.online
    || snapshot.pendingCount > 0
    || enabledModules.length !== snapshot.modules.length
    || enabledModules.some((module) => module.status === 'disconnected')
  ) return 'pending';
  if (snapshot.runtimePhase && ['connecting', 'initializing', 'migrating', 'flushing', 'verifying'].includes(snapshot.runtimePhase)) {
    return 'connecting';
  }
  if (enabledModules.every((module) => module.status === 'connected')) return 'connected';
  return 'connecting';
}

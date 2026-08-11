export type ModuleSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type SyncIndicatorState = 'off' | 'connecting' | 'connected' | 'pending' | 'error';

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
}

export function deriveSyncIndicatorState(snapshot: SyncIndicatorSnapshot): SyncIndicatorState {
  const enabledModules = snapshot.modules.filter((module) => module.enabled);
  if (enabledModules.length === 0) return 'off';
  if (
    snapshot.queueError
    || snapshot.conflictCount > 0
    || enabledModules.some((module) => module.status === 'error')
  ) return 'error';
  if (
    !snapshot.online
    || snapshot.pendingCount > 0
    || enabledModules.some((module) => module.status === 'disconnected')
  ) return 'pending';
  if (enabledModules.every((module) => module.status === 'connected')) return 'connected';
  return 'connecting';
}

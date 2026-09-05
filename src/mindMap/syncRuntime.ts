import type { MindMapSyncStatus } from './syncCore';

export interface MindMapSyncRuntimeState {
  status: MindMapSyncStatus;
  error: string | null;
}

export const MIND_MAP_SYNC_RUNTIME_EVENT = 'smartline:mind-map-sync-runtime';

let currentState: MindMapSyncRuntimeState = { status: 'local', error: null };

export function readMindMapSyncRuntimeState(): MindMapSyncRuntimeState {
  return currentState;
}

/** Shares the map's separate room status with the workspace sync UI. */
export function reportMindMapSyncRuntimeState(next: MindMapSyncRuntimeState): void {
  if (currentState.status === next.status && currentState.error === next.error) return;
  currentState = next;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<MindMapSyncRuntimeState>(MIND_MAP_SYNC_RUNTIME_EVENT, {
      detail: currentState,
    }));
  }
}

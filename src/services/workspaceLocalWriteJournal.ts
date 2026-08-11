import {
  collectWorkspaceFieldChanges,
  type WorkspaceStoreReadiness,
} from './workspaceSyncCore';
import {
  isWorkspaceSystemMutationSuppressed,
  queueWorkspaceFields,
  type WorkspaceStorageField,
} from './workspaceSyncQueueCore';
import type { StoreApi } from 'zustand';

type WorkspaceState = WorkspaceStoreReadiness;
type SetStateLike<TState> = StoreApi<TState>['setState'];
type SetStateInput<TState> = Partial<TState> | TState | ((state: TState) => Partial<TState> | TState);

function isUnifiedWorkspaceConfigured(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    const settings = JSON.parse(
      localStorage.getItem('smart-line-sync-architecture-v1') ?? 'null',
    ) as { architecture?: string } | null;
    return settings?.architecture === 'unified';
  } catch {
    return false;
  }
}

/**
 * Wraps the set function received by a store config inside the Liveblocks
 * middleware. Local actions pass through this wrapper, while Liveblocks remote
 * hydration uses its outer set function and therefore is never journaled as a
 * local user edit.
 */
export function createWorkspaceTrackedSet<TState extends WorkspaceState>(
  setState: SetStateLike<TState>,
  getState: () => TState,
  fieldNames: readonly WorkspaceStorageField[],
): SetStateLike<TState> {
  const trackedSet = (partial: SetStateInput<TState>, replace?: boolean) => {
    const before = getState();
    if (replace === true) {
      setState(partial as TState | ((state: TState) => TState), true);
    } else {
      setState(partial, false);
    }
    const after = getState();

    // Initial IndexedDB hydration establishes the local baseline; it is not a
    // user mutation and must never overwrite a newer cloud workspace.
    if (!before.isHydrated || !after.isHydrated) return;
    // Explicit restore/adoption operations replace the whole workspace from a
    // previously verified snapshot. They are system mutations, not new local
    // edits, and must not recreate the queue that the operation is resolving.
    if (isWorkspaceSystemMutationSuppressed()) return;
    if (!isUnifiedWorkspaceConfigured()) return;
    const { fields, baseFields } = collectWorkspaceFieldChanges(
      before as Record<string, unknown>,
      after as Record<string, unknown>,
      fieldNames,
    );
    if (Object.keys(fields).length === 0) return;

    // Keep a write-through journal even after Liveblocks reports storage ready.
    // A flush that started during hydration must never be allowed to replay an
    // older completion snapshot over a newer local cancellation.
    queueWorkspaceFields(
      fields as Partial<Record<WorkspaceStorageField, unknown>>,
      baseFields as Partial<Record<WorkspaceStorageField, unknown>>,
      { bypassSuppression: true },
    );
  };
  return trackedSet as SetStateLike<TState>;
}

import {
  collectWorkspaceFieldChanges,
  type WorkspaceStoreReadiness,
} from './workspaceSyncCore';
import {
  queueWorkspaceFields,
  type WorkspaceStorageField,
} from './workspaceSyncQueueCore';

type WorkspaceState = WorkspaceStoreReadiness;
type SetStateLike<TState> = (
  partial: Partial<TState> | TState | ((state: TState) => Partial<TState> | TState),
  replace?: boolean,
) => void;

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
  return (partial, replace) => {
    const before = getState();
    setState(partial, replace);
    const after = getState();

    // Initial IndexedDB hydration establishes the local baseline; it is not a
    // user mutation and must never overwrite a newer cloud workspace.
    if (!before.isHydrated || !after.isHydrated) return;
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
}

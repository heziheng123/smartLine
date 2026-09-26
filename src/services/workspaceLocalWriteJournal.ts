import {
  collectWorkspaceFieldChanges,
  type WorkspaceStoreReadiness,
} from './workspaceSyncCore';
import {
  isWorkspaceConnectionMutationCaptureActive,
  isWorkspaceSystemMutationSuppressed,
  queueWorkspaceFields,
  type WorkspaceStorageField,
} from './workspaceSyncQueueCore';
import type { StoreApi } from 'zustand';
import { recordGraphDiagnostic } from '@/graph/diagnostics';
import {
  canWorkspaceMutationEnqueue,
  currentWorkspaceMutationOrigin,
  type WorkspaceMutationOrigin,
} from './workspaceMutationOrigin';

type WorkspaceState = WorkspaceStoreReadiness;
type SetStateLike<TState> = StoreApi<TState>['setState'];
type SetStateInput<TState> = Partial<TState> | TState | ((state: TState) => Partial<TState> | TState);

interface WorkspaceTrackedTransaction {
  depth: number;
  fields: Partial<Record<WorkspaceStorageField, unknown>>;
  baseFields: Partial<Record<WorkspaceStorageField, unknown>>;
  origin: WorkspaceMutationOrigin;
}

let activeTransaction: WorkspaceTrackedTransaction | null = null;

export function isWorkspaceTrackedTransactionActive(): boolean {
  return activeTransaction !== null;
}

/**
 * Groups one user intent that touches multiple stores into one durable queue
 * revision. The stores still update synchronously for the UI, but the cloud
 * can only observe the completed cross-domain state.
 */
export function runWorkspaceTrackedTransaction<TResult>(operation: () => TResult): TResult {
  const transaction = activeTransaction ?? {
    depth: 0,
    fields: {},
    baseFields: {},
    origin: currentWorkspaceMutationOrigin(),
  };
  activeTransaction = transaction;
  transaction.depth += 1;
  try {
    return operation();
  } finally {
    transaction.depth -= 1;
    if (transaction.depth === 0) {
      activeTransaction = null;
      if (Object.keys(transaction.fields).length > 0) {
        void queueWorkspaceFields(transaction.fields, transaction.baseFields, {
          bypassSuppression: true,
          origin: transaction.origin,
        });
      }
    }
  }
}

function queueOrCollectWorkspaceChanges(
  fields: Partial<Record<WorkspaceStorageField, unknown>>,
  baseFields: Partial<Record<WorkspaceStorageField, unknown>>,
  origin: WorkspaceMutationOrigin,
): void {
  if (activeTransaction) {
    for (const [field, value] of Object.entries(fields) as [WorkspaceStorageField, unknown][]) {
      activeTransaction.fields[field] = value;
      if (!Object.prototype.hasOwnProperty.call(activeTransaction.baseFields, field)) {
        activeTransaction.baseFields[field] = baseFields[field];
      }
    }
    return;
  }
  void queueWorkspaceFields(fields, baseFields, { bypassSuppression: true, origin });
}

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
 * Wraps Zustand's raw api.setState inside a store config. Local actions update
 * the local store and enter the durable workspace queue, but deliberately skip
 * the Liveblocks middleware's immediate storage write. Liveblocks still owns
 * remote hydration/subscriptions; the durable queue is the single normal cloud
 * writer and can therefore confirm a revision before deleting it.
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
    const origin = currentWorkspaceMutationOrigin();

    // Initial IndexedDB hydration establishes the local baseline; it is not a
    // user mutation and must never overwrite a newer cloud workspace.
    if (!before.isHydrated || !after.isHydrated) return;
    // Explicit restore/adoption operations replace the whole workspace from a
    // previously verified snapshot. They are system mutations, not new local
    // edits, and must not recreate the queue that the operation is resolving.
    if (isWorkspaceSystemMutationSuppressed()) return;
    if (!canWorkspaceMutationEnqueue(origin)) return;
    if (!isUnifiedWorkspaceConfigured() && !isWorkspaceConnectionMutationCaptureActive()) return;
    const { fields, baseFields } = collectWorkspaceFieldChanges(
      before as Record<string, unknown>,
      after as Record<string, unknown>,
      fieldNames,
    );
    if (Object.keys(fields).length === 0) return;

    if (fieldNames.includes('nodes') && Object.prototype.hasOwnProperty.call(fields, 'nodes')) {
      recordGraphDiagnostic('syncEnqueue');
    }

    // Keep a write-through journal even after Liveblocks reports storage ready.
    // A flush that started during hydration must never be allowed to replay an
    // older completion snapshot over a newer local cancellation.
    queueOrCollectWorkspaceChanges(
      fields as Partial<Record<WorkspaceStorageField, unknown>>,
      baseFields as Partial<Record<WorkspaceStorageField, unknown>>,
      origin,
    );
  };
  return trackedSet as SetStateLike<TState>;
}

import { createScopedStorage } from '@/utils/persistence';
import { hashWorkspaceValue } from './workspaceSyncCore';

export type WorkspaceStorageField =
  | 'tasks' | 'groups' | 'notes' | 'milestones' | 'lifeStages'
  | 'lifeMapAreas' | 'lifeMapPlanGroups' | 'lifeMapStages' | 'lifeMapThemes' | 'lifeMapGoals'
  | 'lifeMapSystems' | 'lifeMapSystemCheckIns' | 'lifeMapEvents' | 'lifeMapFocuses' | 'lifeMapNotes' | 'lifeMapReviews'
  | 'reviewTasks' | 'inboxItems' | 'outlineNodes' | 'ebbSettings'
  | 'schedules' | 'retrospectives' | 'nodes';

export interface PendingWorkspaceSync {
  version: 1;
  /** Unique token for this exact queue revision (older records may omit it). */
  writeId?: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  fields: Partial<Record<WorkspaceStorageField, unknown>>;
  /** Hash of each field before the first queued local write. */
  baseHashes?: Partial<Record<WorkspaceStorageField, string>>;
  /** Baseline snapshots used for entity/property-level three-way merging. */
  baseFields?: Partial<Record<WorkspaceStorageField, unknown>>;
}

export interface WorkspaceConflictRecord {
  id: string;
  detectedAt: string;
  remoteUpdatedAt: string;
  pending: PendingWorkspaceSync;
  remoteFields?: Partial<Record<WorkspaceStorageField, unknown>>;
  conflictingFields?: WorkspaceStorageField[];
}

export interface QueueWorkspaceFieldOptions {
  /**
   * Local user actions must still be journaled while remote hydration is
   * suppressing subscription-based tracking.
   */
  bypassSuppression?: boolean;
  /**
   * Subscription tracking is a fallback for direct store writes and remote
   * normalization. It may fill missing fields but must not replace an
   * explicit local action that is already pending.
   */
  preservePendingFields?: boolean;
}

const queueStorage = createScopedStorage('workspace_sync_queue');
const QUEUE_KEY = 'pending-v1';
const CONFLICTS_KEY = 'conflicts-v1';
const DEVICE_KEY = 'smart-line-device-id';
const EMERGENCY_QUEUE_KEY = 'smart-line-workspace-sync-emergency-v1';
const QUEUE_LOCK_NAME = 'smart-line-workspace-sync-queue-v1';
export const WORKSPACE_QUEUE_EVENT = 'smartline:workspace-queue';
export const WORKSPACE_QUEUE_ERROR_EVENT = 'smartline:workspace-queue-error';
export const workspaceQueueTabId = crypto.randomUUID();
const isBrowserRuntime = typeof window !== 'undefined'
  && typeof document !== 'undefined'
  && !(typeof process !== 'undefined' && process.versions?.node);
export const workspaceQueueChannel = !isBrowserRuntime
  || typeof BroadcastChannel === 'undefined'
  ? null
  : new BroadcastChannel('smartline-workspace-v1');

let writeChain = Promise.resolve();
let trackingSuppressionDepth = 0;
let volatilePending: PendingWorkspaceSync | null = null;

async function withQueueStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return operation();
  return locks.request(QUEUE_LOCK_NAME, { mode: 'exclusive' }, operation);
}

function readEmergencyPending(): PendingWorkspaceSync | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(EMERGENCY_QUEUE_KEY) ?? 'null') as PendingWorkspaceSync | null;
    return parsed?.version === 1 && parsed.fields && typeof parsed.fields === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function preserveEmergencyPending(pending: PendingWorkspaceSync): void {
  volatilePending = pending;
  try {
    localStorage.setItem(EMERGENCY_QUEUE_KEY, JSON.stringify(pending));
  } catch {
    // The in-memory copy remains available until the page is closed.
  }
  window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_ERROR_EVENT, {
    detail: { message: '离线变更尚未安全写入同步队列，请勿关闭页面并尽快重试。' },
  }));
}

function clearEmergencyPending(expected?: Pick<PendingWorkspaceSync, 'writeId' | 'updatedAt' | 'deviceId'>): void {
  const emergency = volatilePending ?? readEmergencyPending();
  if (emergency && expected && getPendingWorkspaceSyncToken(emergency) !== getPendingWorkspaceSyncToken(expected)) return;
  volatilePending = null;
  try { localStorage.removeItem(EMERGENCY_QUEUE_KEY); } catch { /* optional emergency storage */ }
}

export function setWorkspaceQueueSuppressed(value: boolean): void {
  trackingSuppressionDepth = value
    ? trackingSuppressionDepth + 1
    : Math.max(0, trackingSuppressionDepth - 1);
}

export function isWorkspaceQueueSuppressed(): boolean {
  return trackingSuppressionDepth > 0;
}

function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, created);
  return created;
}

export function queueWorkspaceFields(
  fields: Partial<Record<WorkspaceStorageField, unknown>>,
  baseFields: Partial<Record<WorkspaceStorageField, unknown>> = {},
  options: QueueWorkspaceFieldOptions = {},
): void {
  if (isWorkspaceQueueSuppressed() && !options.bypassSuppression) return;
  if (Object.keys(fields).length === 0) return;

  let attemptedPending: PendingWorkspaceSync | null = null;
  writeChain = writeChain.then(() => withQueueStorageLock(async () => {
    let durablePending: PendingWorkspaceSync | null = null;
    try {
      durablePending = await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
    } catch {
      // Continue from the emergency copy so a temporary IndexedDB failure does
      // not discard edits made after the first failure.
    }
    const existing = volatilePending ?? readEmergencyPending() ?? durablePending;
    const now = new Date().toISOString();
    const baseHashes = { ...(existing?.baseHashes ?? {}) };
    const initialBaseFields = { ...(existing?.baseFields ?? {}) };
    for (const [key, value] of Object.entries(baseFields) as Array<[WorkspaceStorageField, unknown]>) {
      if (!baseHashes[key]) baseHashes[key] = await hashWorkspaceValue(value);
      if (!Object.prototype.hasOwnProperty.call(initialBaseFields, key)) initialBaseFields[key] = value;
    }
    const next: PendingWorkspaceSync = {
      version: 1,
      writeId: crypto.randomUUID(),
      deviceId: existing?.deviceId || deviceId(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      fields: options.preservePendingFields
        ? { ...fields, ...(existing?.fields ?? {}) }
        : { ...(existing?.fields ?? {}), ...fields },
      baseHashes,
      baseFields: initialBaseFields,
    };
    attemptedPending = next;
    await queueStorage.setItem(QUEUE_KEY, next);
    clearEmergencyPending(next);
    workspaceQueueChannel?.postMessage({
      version: 1,
      type: 'fields',
      source: workspaceQueueTabId,
      fields: next.fields,
    });
    window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
    workspaceQueueChannel?.postMessage({
      version: 1,
      type: 'queue-ready',
      source: workspaceQueueTabId,
    });
  })).catch((error) => {
    if (attemptedPending) preserveEmergencyPending(attemptedPending);
    console.warn('[workspace-queue] 保存待同步变更失败：', error);
  });
}

export async function readPendingWorkspaceSync(): Promise<PendingWorkspaceSync | null> {
  await writeChain;
  try {
    return volatilePending
      ?? readEmergencyPending()
      ?? await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
  } catch {
    return volatilePending ?? readEmergencyPending();
  }
}

export function getPendingWorkspaceSyncToken(
  pending: Pick<PendingWorkspaceSync, 'writeId' | 'updatedAt' | 'deviceId'>,
): string {
  return pending.writeId ?? `${pending.deviceId}:${pending.updatedAt}`;
}

export async function clearPendingWorkspaceSync(
  expected?: Pick<PendingWorkspaceSync, 'writeId' | 'updatedAt' | 'deviceId'>,
): Promise<void> {
  const clearOperation = writeChain.then(() => withQueueStorageLock(async () => {
    const emergency = volatilePending ?? readEmergencyPending();
    if (emergency && (!expected || getPendingWorkspaceSyncToken(emergency) === getPendingWorkspaceSyncToken(expected))) {
      clearEmergencyPending(expected);
    }
    try {
      const current = await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
      if (!current) return;
      if (expected && getPendingWorkspaceSyncToken(current) !== getPendingWorkspaceSyncToken(expected)) return;
      await queueStorage.removeItem(QUEUE_KEY);
    } catch (error) {
      if (emergency) return;
      throw error;
    }
  }));
  // Queue clearing participates in the same serialization chain as writes, so
  // a late writer can never be deleted by an older flush.
  writeChain = clearOperation.catch(() => undefined);
  await clearOperation;
}

/**
 * Atomically acknowledges whatever queue revision currently contains the
 * exact values that were written to cloud storage. A revision token may have
 * changed while keeping the same final values; a genuinely newer/different
 * edit is serialized after this operation or fails the value comparison and
 * is therefore never deleted.
 */
export async function acknowledgeAppliedWorkspaceSync(
  appliedFields: Partial<Record<WorkspaceStorageField, unknown>>,
): Promise<boolean> {
  const acknowledgeOperation = writeChain.then(() => withQueueStorageLock(async () => {
    const appliedHash = await hashWorkspaceValue(appliedFields);
    const emergency = volatilePending ?? readEmergencyPending();
    if (emergency && await hashWorkspaceValue(emergency.fields) !== appliedHash) return false;

    const durable = await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
    if (durable && await hashWorkspaceValue(durable.fields) !== appliedHash) return false;

    if (emergency) clearEmergencyPending(emergency);
    if (durable) await queueStorage.removeItem(QUEUE_KEY);
    return true;
  }));
  writeChain = acknowledgeOperation.then(() => undefined, () => undefined);
  return acknowledgeOperation;
}

export async function preserveWorkspaceConflict(
  pending: PendingWorkspaceSync,
  remoteUpdatedAt: string,
  remoteFields?: Partial<Record<WorkspaceStorageField, unknown>>,
  conflictingFields?: WorkspaceStorageField[],
): Promise<void> {
  await withQueueStorageLock(async () => {
    const conflicts = await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [];
    const record: WorkspaceConflictRecord = {
      id: crypto.randomUUID(),
      detectedAt: new Date().toISOString(),
      remoteUpdatedAt,
      pending,
      remoteFields,
      conflictingFields,
    };
    // Unresolved edits are user data. Never silently evict an older conflict
    // merely because more conflicts were detected later.
    await queueStorage.setItem(CONFLICTS_KEY, [record, ...conflicts]);
  });
  await clearPendingWorkspaceSync(pending);
}

export async function listWorkspaceConflicts(): Promise<WorkspaceConflictRecord[]> {
  return await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [];
}

export async function removeWorkspaceConflict(id: string): Promise<void> {
  await withQueueStorageLock(async () => {
    const conflicts = await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [];
    await queueStorage.setItem(CONFLICTS_KEY, conflicts.filter((item) => item.id !== id));
  });
}

export async function replaceWorkspaceConflictPending(
  id: string,
  pending: PendingWorkspaceSync | null,
): Promise<void> {
  await withQueueStorageLock(async () => {
    const conflicts = await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [];
    await queueStorage.setItem(
      CONFLICTS_KEY,
      pending
        ? conflicts.map((item) => item.id === id ? { ...item, pending } : item)
        : conflicts.filter((item) => item.id !== id),
    );
  });
}

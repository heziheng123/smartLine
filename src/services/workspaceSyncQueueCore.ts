import { createScopedStorage } from '@/utils/persistence';
import { hashWorkspaceValue, isWorkspaceRevisionSuperseded } from './workspaceSyncCore';

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
  /** Fields the user explicitly confirmed should replace the cloud version. */
  forceFields?: WorkspaceStorageField[];
}

export interface WorkspaceConflictRecord {
  id: string;
  detectedAt: string;
  remoteUpdatedAt: string;
  /** Missing on legacy records; listWorkspaceConflicts normalizes it to active. */
  status?: 'active' | 'resolved' | 'discarded';
  resolvedAt?: string;
  resolution?: 'current' | 'manual';
  pending: PendingWorkspaceSync;
  remoteFields?: Partial<Record<WorkspaceStorageField, unknown>>;
  conflictingFields?: WorkspaceStorageField[];
}

const MAX_RESOLVED_CONFLICT_RECORDS = 50;

function normalizedConflict(record: WorkspaceConflictRecord): WorkspaceConflictRecord {
  return {
    ...record,
    status: record.status === 'resolved' || record.status === 'discarded'
      ? record.status
      : 'active',
  };
}

function retainWorkspaceConflictRecords(records: WorkspaceConflictRecord[]): WorkspaceConflictRecord[] {
  const normalized = records.map(normalizedConflict).filter((record) => record.status !== 'discarded');
  return [
    ...normalized.filter((record) => record.status === 'active'),
    ...normalized.filter((record) => record.status === 'resolved').slice(0, MAX_RESOLVED_CONFLICT_RECORDS),
  ];
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
  /** Bypasses conflict comparison only for explicitly confirmed fields. */
  forceFields?: WorkspaceStorageField[];
}

const queueStorage = createScopedStorage('workspace_sync_queue');
const QUEUE_KEY = 'pending-v1';
const CONFLICTS_KEY = 'conflicts-v1';
const DEVICE_KEY = 'smart-line-device-id';
const EMERGENCY_QUEUE_KEY = 'smart-line-workspace-sync-emergency-v1';
const QUEUE_LOCK_NAME = 'smart-line-workspace-sync-queue-v1';
const QUEUE_FALLBACK_LOCK_KEY = 'smart-line-workspace-sync-queue-lock-v1';
const QUEUE_FALLBACK_LEASE_MS = 15_000;
const QUEUE_FALLBACK_SETTLE_MS = 32;
export type WorkspaceQueueErrorKind =
  /** IndexedDB 写入失败，已降级到 emergency 存储，数据未丢失但需要页面保持开启。 */
  | 'storage_write_failed'
  /** 待同步数据补传失败（flush 异常），巡检机制会自动重试。 */
  | 'flush_failed'
  /** 同步队列持续变化（多源写入竞争），暂停并需要用户等待。 */
  | 'flush_restart_exhausted'
  /** 云端工作区持续变化（多人/多设备写入竞争），暂停并等待对端完成。 */
  | 'cloud_drift_exhausted';

export interface WorkspaceQueueErrorDetail {
  kind: WorkspaceQueueErrorKind;
  message: string;
}

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
let systemMutationSuppressionDepth = 0;
let connectionMutationCaptureDepth = 0;
let volatilePending: PendingWorkspaceSync | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

interface QueueFallbackLease {
  token: string;
  expiresAt: number;
}

function readFallbackLease(): QueueFallbackLease | null {
  try {
    const value = JSON.parse(localStorage.getItem(QUEUE_FALLBACK_LOCK_KEY) ?? 'null') as QueueFallbackLease | null;
    return value && typeof value.token === 'string' && typeof value.expiresAt === 'number' ? value : null;
  } catch {
    return null;
  }
}

/**
 * Safari versions without the Web Locks API still need one shared critical
 * section for the read-merge-write queue transaction. A short localStorage
 * lease is used only as that compatibility mutex; the queue itself remains
 * durably stored in IndexedDB.
 */
async function withFallbackQueueStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const token = crypto.randomUUID();
  const deadline = Date.now() + QUEUE_FALLBACK_LEASE_MS;

  while (Date.now() < deadline) {
    const lease = readFallbackLease();
    if (!lease || lease.expiresAt <= Date.now()) {
      try {
        localStorage.setItem(QUEUE_FALLBACK_LOCK_KEY, JSON.stringify({
          token,
          expiresAt: Date.now() + QUEUE_FALLBACK_LEASE_MS,
        } satisfies QueueFallbackLease));
      } catch {
        // Private/restricted browser modes can deny localStorage entirely. The
        // queue's existing emergency journal still protects local edits, but
        // the cross-tab serialization guarantee cannot be provided there.
        return await operation();
      }

      // localStorage has no compare-and-set. Let simultaneous contenders write
      // their claims, then only the last lease owner may enter the transaction.
      await delay(QUEUE_FALLBACK_SETTLE_MS);
      if (readFallbackLease()?.token === token) {
        const renewal = window.setInterval(() => {
          try {
            if (readFallbackLease()?.token === token) {
              localStorage.setItem(QUEUE_FALLBACK_LOCK_KEY, JSON.stringify({
                token,
                expiresAt: Date.now() + QUEUE_FALLBACK_LEASE_MS,
              } satisfies QueueFallbackLease));
            }
          } catch { /* compatibility lock only */ }
        }, Math.floor(QUEUE_FALLBACK_LEASE_MS / 3));
        try {
          // Re-verify the lease immediately before the operation. This closes the
          // race window where Tab B writes its token between our settle-check
          // (line 124) and the actual operation start, which would otherwise allow
          // both tabs to enter the critical section.
          if (readFallbackLease()?.token !== token) {
            throw new Error('同步队列锁已被其他标签页接管，本次写入被中止以避免冲突。请稍后重试。');
          }
          return await operation();
        } finally {
          window.clearInterval(renewal);
          try {
            if (readFallbackLease()?.token === token) localStorage.removeItem(QUEUE_FALLBACK_LOCK_KEY);
          } catch { /* compatibility lock only */ }
        }
      }
    }
    await delay(QUEUE_FALLBACK_SETTLE_MS);
  }

  throw new Error('等待其他标签页完成同步队列写入超时，请保持页面开启后重试。');
}

async function withQueueStorageLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks?.request) return await withFallbackQueueStorageLock(operation);
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
    detail: {
      kind: 'storage_write_failed',
      message: '离线变更尚未安全写入同步队列，请勿关闭页面并尽快重试。',
    } satisfies WorkspaceQueueErrorDetail,
  }));
}

function clearEmergencyPending(
  expected?: Pick<PendingWorkspaceSync, 'writeId' | 'updatedAt' | 'deviceId'>,
  superseded?: Pick<PendingWorkspaceSync, 'writeId' | 'updatedAt' | 'deviceId'>,
): void {
  const emergency = volatilePending ?? readEmergencyPending();
  if (emergency && expected && !isWorkspaceRevisionSuperseded(
    getPendingWorkspaceSyncToken(emergency),
    getPendingWorkspaceSyncToken(expected),
    superseded ? getPendingWorkspaceSyncToken(superseded) : undefined,
  )) return;
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

export function setWorkspaceSystemMutationSuppressed(value: boolean): void {
  systemMutationSuppressionDepth = value
    ? systemMutationSuppressionDepth + 1
    : Math.max(0, systemMutationSuppressionDepth - 1);
}

export function isWorkspaceSystemMutationSuppressed(): boolean {
  return systemMutationSuppressionDepth > 0;
}

/**
 * First-time room discovery can take several network round trips. Keep local
 * edits made during that window in the durable workspace queue even before a
 * unified-room setting has been committed, so later hydration cannot replace
 * an edit that happened after the safety snapshot.
 */
export function setWorkspaceConnectionMutationCapture(value: boolean): void {
  connectionMutationCaptureDepth = value
    ? connectionMutationCaptureDepth + 1
    : Math.max(0, connectionMutationCaptureDepth - 1);
}

export function isWorkspaceConnectionMutationCaptureActive(): boolean {
  return connectionMutationCaptureDepth > 0;
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
): Promise<void> {
  if (isWorkspaceQueueSuppressed() && !options.bypassSuppression) return Promise.resolve();
  if (Object.keys(fields).length === 0) return Promise.resolve();

  let attemptedPending: PendingWorkspaceSync | null = null;
  const operation = writeChain.then(() => withQueueStorageLock(async () => {
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
      forceFields: [...new Set([
        ...(existing?.forceFields ?? []),
        ...(options.forceFields ?? []),
      ])],
    };
    attemptedPending = next;
    await queueStorage.setItem(QUEUE_KEY, next);
    // A successfully persisted revision supersedes the emergency snapshot it
    // was built from. Matching only `next` leaves an older volatile revision
    // permanently ahead of IndexedDB after a transient storage failure.
    clearEmergencyPending(next, existing ?? undefined);
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
  }));
  writeChain = operation.catch((error) => {
    if (attemptedPending) preserveEmergencyPending(attemptedPending);
    console.warn('[workspace-queue] 保存待同步变更失败：', error);
  });
  return operation;
}

/** Broadcasts a leader's hydrated cloud changes to tabs that deliberately do
 * not keep their own Liveblocks connection open. */
export function broadcastWorkspaceFields(
  fields: Partial<Record<WorkspaceStorageField, unknown>>,
): void {
  if (Object.keys(fields).length === 0) return;
  workspaceQueueChannel?.postMessage({
    version: 1,
    type: 'fields',
    source: workspaceQueueTabId,
    fields,
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
      status: 'active',
      pending,
      remoteFields,
      conflictingFields,
    };
    // Active conflicts are user data and are never evicted. Only explicitly
    // resolved recovery copies are capped.
    await queueStorage.setItem(CONFLICTS_KEY, retainWorkspaceConflictRecords([record, ...conflicts]));
  });
  await clearPendingWorkspaceSync(pending);
}

export async function listWorkspaceConflicts(): Promise<WorkspaceConflictRecord[]> {
  return retainWorkspaceConflictRecords(
    await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [],
  );
}

export function buildPendingWorkspaceSyncRemainder(
  pending: PendingWorkspaceSync,
  acknowledgedFields: WorkspaceStorageField[],
  writeId = crypto.randomUUID(),
): PendingWorkspaceSync | null {
  const acknowledged = new Set(acknowledgedFields);
  const fields = Object.fromEntries(Object.entries(pending.fields)
    .filter(([field]) => !acknowledged.has(field as WorkspaceStorageField)));
  if (Object.keys(fields).length === 0) return null;
  const keep = <T>(values: Partial<Record<WorkspaceStorageField, T>> | undefined) =>
    Object.fromEntries(Object.entries(values ?? {})
      .filter(([field]) => !acknowledged.has(field as WorkspaceStorageField)));
  return {
    ...pending,
    writeId,
    fields,
    baseFields: keep(pending.baseFields),
    baseHashes: keep(pending.baseHashes) as Partial<Record<WorkspaceStorageField, string>>,
    forceFields: pending.forceFields?.filter((field) => !acknowledged.has(field)),
  };
}

/** Removes only confirmed fields from the exact queue version that was read for this flush. */
export async function acknowledgeWorkspaceSyncFields(
  expected: PendingWorkspaceSync,
  fields: WorkspaceStorageField[],
): Promise<boolean> {
  const acknowledged = new Set(fields);
  if (acknowledged.size === 0) return true;
  const expectedToken = getPendingWorkspaceSyncToken(expected);
  const operation = writeChain.then(() => withQueueStorageLock(async () => {
    const remainderWriteId = crypto.randomUUID();
    const emergency = volatilePending ?? readEmergencyPending();
    if (emergency && getPendingWorkspaceSyncToken(emergency) !== expectedToken) return false;
    const durable = await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
    if (durable && getPendingWorkspaceSyncToken(durable) !== expectedToken) return false;

    if (emergency) {
      const remaining = buildPendingWorkspaceSyncRemainder(emergency, [...acknowledged], remainderWriteId);
      volatilePending = remaining;
      try {
        if (remaining) localStorage.setItem(EMERGENCY_QUEUE_KEY, JSON.stringify(remaining));
        else localStorage.removeItem(EMERGENCY_QUEUE_KEY);
      } catch {
        // The in-memory emergency record remains authoritative for this page.
      }
    }
    if (durable) {
      const remaining = buildPendingWorkspaceSyncRemainder(durable, [...acknowledged], remainderWriteId);
      if (remaining) await queueStorage.setItem(QUEUE_KEY, remaining);
      else await queueStorage.removeItem(QUEUE_KEY);
    }
    return true;
  }));
  writeChain = operation.then(() => undefined, () => undefined);
  return await operation;
}

export interface WorkspaceQueueSafetySnapshot {
  durablePending: PendingWorkspaceSync | null;
  emergencyPending: PendingWorkspaceSync | null;
  conflicts: WorkspaceConflictRecord[];
}

/** Read-only raw snapshot used by repair manifests; it never reconciles or clears records. */
export async function readWorkspaceQueueSafetySnapshot(): Promise<WorkspaceQueueSafetySnapshot> {
  await writeChain;
  let durablePending: PendingWorkspaceSync | null = null;
  try {
    durablePending = await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
  } catch {
    // The emergency copy is still returned below.
  }
  return {
    durablePending,
    emergencyPending: volatilePending ?? readEmergencyPending(),
    conflicts: await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [],
  };
}

export async function markWorkspaceConflictResolved(
  id: string,
  resolution: NonNullable<WorkspaceConflictRecord['resolution']>,
): Promise<void> {
  await withQueueStorageLock(async () => {
    const conflicts = await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [];
    const resolvedAt = new Date().toISOString();
    await queueStorage.setItem(CONFLICTS_KEY, retainWorkspaceConflictRecords(conflicts.map((item) => (
      item.id === id
        ? { ...item, status: 'resolved', resolvedAt, resolution }
        : item
    ))));
  });
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
    const resolvedAt = new Date().toISOString();
    await queueStorage.setItem(CONFLICTS_KEY, retainWorkspaceConflictRecords(
      conflicts.map((item) => item.id !== id
        ? item
        : pending
          ? { ...item, pending }
          : { ...item, status: 'resolved', resolvedAt, resolution: 'manual' }),
    ));
  });
}

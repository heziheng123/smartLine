import { createScopedStorage } from '@/utils/persistence';
import { hashWorkspaceValue } from './workspaceSyncCore';

export type WorkspaceStorageField =
  | 'tasks' | 'groups' | 'notes' | 'milestones'
  | 'reviewTasks' | 'inboxItems' | 'outlineNodes' | 'ebbSettings'
  | 'schedules' | 'nodes';

export interface PendingWorkspaceSync {
  version: 1;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  fields: Partial<Record<WorkspaceStorageField, unknown>>;
  /** Hash of each field before the first queued local write. */
  baseHashes?: Partial<Record<WorkspaceStorageField, string>>;
}

export interface WorkspaceConflictRecord {
  id: string;
  detectedAt: string;
  remoteUpdatedAt: string;
  pending: PendingWorkspaceSync;
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
export const WORKSPACE_QUEUE_EVENT = 'smartline:workspace-queue';
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

  writeChain = writeChain.then(async () => {
    const existing = await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
    const now = new Date().toISOString();
    const baseHashes = { ...(existing?.baseHashes ?? {}) };
    for (const [key, value] of Object.entries(baseFields) as Array<[WorkspaceStorageField, unknown]>) {
      if (!baseHashes[key]) baseHashes[key] = await hashWorkspaceValue(value);
    }
    const next: PendingWorkspaceSync = {
      version: 1,
      deviceId: existing?.deviceId || deviceId(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      fields: options.preservePendingFields
        ? { ...fields, ...(existing?.fields ?? {}) }
        : { ...(existing?.fields ?? {}), ...fields },
      baseHashes,
    };
    await queueStorage.setItem(QUEUE_KEY, next);
    workspaceQueueChannel?.postMessage({
      type: 'fields',
      source: workspaceQueueTabId,
      fields: next.fields,
    });
    window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
    workspaceQueueChannel?.postMessage({
      type: 'queue-ready',
      source: workspaceQueueTabId,
    });
  }).catch((error) => {
    console.warn('[workspace-queue] 保存待同步变更失败：', error);
  });
}

export async function readPendingWorkspaceSync(): Promise<PendingWorkspaceSync | null> {
  await writeChain;
  return await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
}

export async function clearPendingWorkspaceSync(expectedUpdatedAt?: string): Promise<void> {
  await writeChain;
  const current = await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
  if (!current || (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt)) return;
  await queueStorage.removeItem(QUEUE_KEY);
}

export async function preserveWorkspaceConflict(
  pending: PendingWorkspaceSync,
  remoteUpdatedAt: string,
): Promise<void> {
  const conflicts = await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [];
  const record: WorkspaceConflictRecord = {
    id: crypto.randomUUID(),
    detectedAt: new Date().toISOString(),
    remoteUpdatedAt,
    pending,
  };
  await queueStorage.setItem(CONFLICTS_KEY, [record, ...conflicts].slice(0, 20));
  await clearPendingWorkspaceSync(pending.updatedAt);
}

export async function listWorkspaceConflicts(): Promise<WorkspaceConflictRecord[]> {
  return await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [];
}

export async function removeWorkspaceConflict(id: string): Promise<void> {
  const conflicts = await listWorkspaceConflicts();
  await queueStorage.setItem(CONFLICTS_KEY, conflicts.filter((item) => item.id !== id));
}

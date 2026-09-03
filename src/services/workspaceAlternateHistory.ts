import { createScopedStorage } from '@/utils/persistence';
import type { PendingWorkspaceSync, WorkspaceStorageField } from './workspaceSyncQueueCore';
import type { WorkspaceMergeAlternate } from './workspaceSyncCore';

export interface WorkspaceAlternateRecord {
  recoveryId: string;
  source: 'schema8-auto-resolution';
  field: string;
  entityId?: string;
  path: string;
  baseValue: unknown;
  localValue: unknown;
  remoteValue: unknown;
  baseHash: string;
  localHash: string;
  remoteHash: string;
  localWriteId: string;
  remoteWriteId?: string;
  deviceId: string;
  createdAt: string;
  resolvedAt: string;
  resolution: 'remote-current';
  archivedSegmentId?: string;
}

const alternateStorage = createScopedStorage('workspace_alternates_v8');

function fieldFromPath(path: string): WorkspaceStorageField {
  return path.split(/[.[]/, 1)[0] as WorkspaceStorageField;
}

function entityIdFromPath(path: string): string | undefined {
  const match = path.match(/^[^[]+\[([^\]]+)\]/);
  return match?.[1];
}

export function buildWorkspaceAlternateRecords(
  pending: PendingWorkspaceSync,
  alternates: WorkspaceMergeAlternate[],
  remoteWriteId?: string,
  resolvedAt = new Date().toISOString(),
): WorkspaceAlternateRecord[] {
  const localWriteId = pending.writeId ?? pending.deviceId + ':' + pending.updatedAt;
  return alternates.map((alternate) => ({
    recoveryId: crypto.randomUUID(),
    source: 'schema8-auto-resolution',
    field: fieldFromPath(alternate.path),
    entityId: entityIdFromPath(alternate.path),
    ...alternate,
    localWriteId,
    remoteWriteId,
    deviceId: pending.deviceId,
    createdAt: pending.createdAt,
    resolvedAt,
  }));
}

export async function persistWorkspaceAlternates(records: WorkspaceAlternateRecord[]): Promise<void> {
  for (const record of records) {
    await alternateStorage.setItem('alternate:' + record.recoveryId, record);
  }
  if (!await verifyWorkspaceAlternatesPersisted(records.map((record) => record.recoveryId))) {
    throw new Error('冲突 alternate history 未能完整落盘并回读。');
  }
}

export async function readWorkspaceAlternate(
  recoveryId: string,
): Promise<WorkspaceAlternateRecord | null> {
  return await alternateStorage.getItem<WorkspaceAlternateRecord>('alternate:' + recoveryId);
}

export async function verifyWorkspaceAlternatesPersisted(recoveryIds: string[]): Promise<boolean> {
  for (const recoveryId of recoveryIds) {
    const record = await readWorkspaceAlternate(recoveryId);
    if (!record || record.recoveryId !== recoveryId) return false;
  }
  return true;
}

export async function listWorkspaceAlternates(): Promise<WorkspaceAlternateRecord[]> {
  const keys = await alternateStorage.keys();
  const records = await Promise.all(keys
    .map(String)
    .filter((key) => key.startsWith('alternate:'))
    .map((key) => alternateStorage.getItem<WorkspaceAlternateRecord>(key)));
  return records.filter((record): record is WorkspaceAlternateRecord => Boolean(record))
    .sort((left, right) => right.resolvedAt.localeCompare(left.resolvedAt));
}

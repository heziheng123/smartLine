import type { WorkspaceBackup } from './workspaceBackup.ts';

export interface WorkspaceStoreReadiness {
  syncEnabled?: boolean;
  isHydrated?: boolean;
  liveblocks?: {
    room?: { getStatus: () => string } | null;
    status?: string;
    isStorageLoading?: boolean;
  };
}

export interface WorkspaceFieldChangeSet {
  fields: Record<string, unknown>;
  baseFields: Record<string, unknown>;
}

export function isWorkspaceStoreStorageReady(state: WorkspaceStoreReadiness): boolean {
  return state.syncEnabled === true
    && state.liveblocks?.room?.getStatus() === 'connected'
    && state.liveblocks?.status === 'connected'
    && !state.liveblocks?.isStorageLoading;
}

export function collectWorkspaceFieldChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fieldNames: readonly string[],
): WorkspaceFieldChangeSet {
  const fields: Record<string, unknown> = {};
  const baseFields: Record<string, unknown> = {};
  for (const fieldName of fieldNames) {
    if (before[fieldName] === after[fieldName]) continue;
    fields[fieldName] = after[fieldName];
    baseFields[fieldName] = before[fieldName];
  }
  return { fields, baseFields };
}

function sanitizeRoomPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

export function buildUnifiedRoomId(roomCode: string, identity = 'owner'): string {
  const safeIdentity = sanitizeRoomPart(identity) || 'owner';
  const safeCode = sanitizeRoomPart(roomCode);
  if (!safeCode) throw new Error('工作区房间号不能为空。');
  return `workspace-${safeIdentity}-${safeCode}`;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export async function hashWorkspaceValue(value: unknown): Promise<string> {
  const serialized = JSON.stringify(canonicalize(value)) ?? 'undefined';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function findWorkspaceFieldConflicts(
  fields: Record<string, unknown>,
  baseHashes: Record<string, string>,
  remote: Record<string, unknown>,
): Promise<string[]> {
  const conflicts: string[] = [];
  for (const [key, value] of Object.entries(fields)) {
    const baseHash = baseHashes[key];
    if (!baseHash) continue;
    const [remoteHash, pendingHash] = await Promise.all([
      hashWorkspaceValue(remote[key]),
      hashWorkspaceValue(value),
    ]);
    if (remoteHash !== baseHash && remoteHash !== pendingHash) conflicts.push(key);
  }
  return conflicts;
}

export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function hashWorkspaceBackup(backup: WorkspaceBackup): Promise<string> {
  const data = { timeline: backup.timeline, ebb: backup.ebb, daily: backup.daily, graph: backup.graph };
  return await hashWorkspaceValue(data);
}

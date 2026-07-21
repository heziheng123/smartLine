import type { WorkspaceBackup } from './workspaceBackup.ts';

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

export async function hashWorkspaceBackup(backup: WorkspaceBackup): Promise<string> {
  const data = { timeline: backup.timeline, ebb: backup.ebb, daily: backup.daily, graph: backup.graph };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(canonicalize(data))));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

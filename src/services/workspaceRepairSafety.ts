import { createScopedStorage } from '@/utils/persistence';
import { hashWorkspaceValue } from './workspaceSyncCore';

export type WorkspaceRepairPartName =
  | 'local'
  | 'queue'
  | 'emergencyQueue'
  | 'conflicts'
  | 'remoteRoot'
  | 'entitySidecar';

export interface WorkspaceRepairManifestPart {
  partId: string;
  sha256: string;
  value: unknown;
}

export interface WorkspaceRepairManifest {
  kind: 'smart-line-workspace-repair-manifest';
  version: 1;
  repairId: string;
  workspaceId: string;
  createdAt: string;
  parts: Record<WorkspaceRepairPartName, WorkspaceRepairManifestPart>;
}

export interface WorkspaceRepairSnapshotInput {
  repairId: string;
  workspaceId: string;
  createdAt?: string;
  local: unknown;
  queue: unknown;
  emergencyQueue: unknown;
  conflicts: unknown;
  remoteRoot: unknown;
  entitySidecar: unknown;
}

const repairStorage = createScopedStorage('workspace_repairs');
const PARTS: WorkspaceRepairPartName[] = [
  'local', 'queue', 'emergencyQueue', 'conflicts', 'remoteRoot', 'entitySidecar',
];

export async function buildWorkspaceRepairManifest(
  input: WorkspaceRepairSnapshotInput,
): Promise<WorkspaceRepairManifest> {
  const parts = {} as Record<WorkspaceRepairPartName, WorkspaceRepairManifestPart>;
  for (const name of PARTS) {
    const value = structuredClone(input[name]);
    parts[name] = {
      partId: `${input.repairId}:${name}`,
      sha256: await hashWorkspaceValue(value),
      value,
    };
  }
  return {
    kind: 'smart-line-workspace-repair-manifest',
    version: 1,
    repairId: input.repairId,
    workspaceId: input.workspaceId,
    createdAt: input.createdAt ?? new Date().toISOString(),
    parts,
  };
}

export async function verifyWorkspaceRepairManifest(manifest: WorkspaceRepairManifest): Promise<boolean> {
  if (manifest.kind !== 'smart-line-workspace-repair-manifest' || manifest.version !== 1) return false;
  for (const name of PARTS) {
    const part = manifest.parts[name];
    if (!part || part.partId !== `${manifest.repairId}:${name}`) return false;
    if (await hashWorkspaceValue(part.value) !== part.sha256) return false;
  }
  return true;
}

export async function persistWorkspaceRepairManifest(
  manifest: WorkspaceRepairManifest,
): Promise<void> {
  if (!await verifyWorkspaceRepairManifest(manifest)) throw new Error('修复前完整快照 hash 校验失败。');
  for (const name of PARTS) {
    const part = manifest.parts[name];
    await repairStorage.setItem('part:' + part.partId, part.value);
    const storedValue = await repairStorage.getItem<unknown>('part:' + part.partId);
    if (await hashWorkspaceValue(storedValue) !== part.sha256) {
      throw new Error('修复前快照分片未能持久化并回读确认：' + name);
    }
  }
  await repairStorage.setItem(`manifest:${manifest.repairId}`, manifest);
  const stored = await repairStorage.getItem<WorkspaceRepairManifest>(`manifest:${manifest.repairId}`);
  if (!stored || !await verifyWorkspaceRepairManifest(stored)) {
    throw new Error('修复前完整快照未能持久化并回读确认。');
  }
}

export async function readWorkspaceRepairManifest(
  repairId: string,
): Promise<WorkspaceRepairManifest | null> {
  return await repairStorage.getItem<WorkspaceRepairManifest>(`manifest:${repairId}`);
}

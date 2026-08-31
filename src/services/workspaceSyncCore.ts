import type { WorkspaceBackup } from './workspaceBackup.ts';
import { createEmptyLifeMapData } from '../lifeMap/data.ts';

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

export interface WorkspaceContentCounts {
  tasks: number;
  groups: number;
  lifeStages: number;
  lifeMapItems: number;
  reviewTasks: number;
  dailyDays: number;
  retrospectiveDays: number;
  graphNodes: number;
}

export interface WorkspaceQueueDrainState {
  pendingFieldCount: number;
  conflictDetected: boolean;
}

export interface WorkspaceQueueCommitActions {
  apply: () => void | Promise<void>;
  confirm: () => Promise<void>;
  clear: () => Promise<void>;
}

export type UnifiedActivationDecision = 'new' | 'matching' | 'cloud' | 'conflict';
export type LegacyDiscoveryDecision = 'unified' | 'new' | 'legacy-matching' | 'legacy-cloud' | 'conflict';

export function assertWorkspaceSchemaSupported(
  root: Record<string, unknown>,
  supportedVersion: number,
): void {
  const metadata = root.metadata && typeof root.metadata === 'object'
    ? root.metadata as Record<string, unknown>
    : {};
  const schemaVersion = typeof metadata.schemaVersion === 'number'
    ? metadata.schemaVersion
    : 0;
  if (schemaVersion > supportedVersion) {
    throw new Error(`云端工作区由更新版本的应用创建（数据版本 ${schemaVersion}），当前版本仅支持到 ${supportedVersion}。请先更新应用，已阻止连接以避免覆盖数据。`);
  }
}

export function workspaceHasUserContent(summary: WorkspaceContentCounts): boolean {
  return summary.tasks > 0
    || summary.groups > 0
    || summary.lifeStages > 0
    || summary.lifeMapItems > 0
    || summary.reviewTasks > 0
    || summary.dailyDays > 0
    || summary.retrospectiveDays > 0
    || summary.graphNodes > 0;
}

export function decideUnifiedWorkspaceActivation(
  hasRemoteStorage: boolean,
  localHash: string,
  remoteHash: string,
  localSummary: WorkspaceContentCounts,
  remoteSummary: WorkspaceContentCounts,
): UnifiedActivationDecision {
  if (!hasRemoteStorage) return 'new';
  if (localHash === remoteHash) return 'matching';
  if (!workspaceHasUserContent(localSummary)) return 'cloud';
  if (!workspaceHasUserContent(remoteSummary)) return 'new';
  return 'conflict';
}

export function decideLegacyWorkspaceDiscovery(
  hasUnifiedStorage: boolean,
  legacyHasUserContent: boolean,
  localHash: string,
  legacyHash: string,
  localSummary: WorkspaceContentCounts,
): LegacyDiscoveryDecision {
  if (hasUnifiedStorage) return 'unified';
  if (!legacyHasUserContent) return 'new';
  if (localHash === legacyHash) return 'legacy-matching';
  if (!workspaceHasUserContent(localSummary)) return 'legacy-cloud';
  return 'conflict';
}

export function isWorkspaceStoreStorageReady(state: WorkspaceStoreReadiness): boolean {
  return state.syncEnabled === true
    && state.liveblocks?.room?.getStatus() === 'connected'
    && state.liveblocks?.status === 'connected'
    && !state.liveblocks?.isStorageLoading;
}

/**
 * A fresh browser starts with the product's sample timeline. It must not be
 * treated as user content when that browser joins an existing workspace on a
 * second device.
 */
export function isBundledDemoWorkspace(backup: WorkspaceBackup): boolean {
  const hasOnlyDemoIds = (items: unknown[]): boolean => items.every((item) => {
    if (!item || typeof item !== 'object') return false;
    const record = item as { id?: unknown; children?: unknown; blocks?: unknown };
    if (typeof record.id !== 'string' || !record.id.startsWith('demo-')) return false;
    // A task added to a sample group or a task block added to a sample task is
    // genuine user content even though the containing sample still has a
    // demo-prefixed id. Never replace that state during first connection.
    if (Array.isArray(record.blocks) && record.blocks.length > 0) return false;
    return !Array.isArray(record.children) || hasOnlyDemoIds(record.children);
  });
  const isEmpty = (items: unknown[]) => items.length === 0;
  const hasOnlyDefaultLifeMap = Object.values(backup.lifeMap).every((value) => Array.isArray(value) && value.length === 0)
    || workspaceValuesEqual(backup.lifeMap, createEmptyLifeMapData());
  return hasOnlyDemoIds(backup.timeline.tasks)
    && hasOnlyDemoIds(backup.timeline.groups)
    && hasOnlyDemoIds(backup.timeline.notes)
    && hasOnlyDemoIds(backup.timeline.milestones)
    && isEmpty(backup.timeline.lifeStages)
    && isEmpty(backup.ebb.reviewTasks)
    && isEmpty(backup.ebb.inboxItems)
    && isEmpty(backup.ebb.outlineNodes)
    && isEmpty(Object.keys(backup.daily.schedules))
    && isEmpty(Object.keys(backup.daily.retrospectives))
    && isEmpty(backup.graph.nodes)
    && hasOnlyDefaultLifeMap;
}

export function assertWorkspaceQueueDrained(state: WorkspaceQueueDrainState): void {
  if (state.conflictDetected) {
    throw new Error('检测到多设备同步冲突，本机修改已保留。请在同步设置中处理冲突副本。');
  }
  if (state.pendingFieldCount > 0) {
    throw new Error(`云端已连接，但仍有 ${state.pendingFieldCount} 个数据字段等待补传。请保持页面开启并重试。`);
  }
}

export async function commitWorkspaceQueueRevisionSafely(actions: WorkspaceQueueCommitActions): Promise<void> {
  await actions.apply();
  await actions.confirm();
  await actions.clear();
}

export function shouldBackfillLegacyLifeMapSync(
  hasExistingWorkspaceSync: boolean,
  lifeMapSyncEnabled: boolean,
): boolean {
  return hasExistingWorkspaceSync && !lifeMapSyncEnabled;
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

export function buildWorkspaceBindingRoomId(identity: string): string {
  return buildUnifiedRoomId('__account_binding_v1__', identity);
}

export function buildUnifiedRoomCandidates(
  roomCode: string,
  primaryIdentity: string,
  historicalIdentity?: string,
): string[] {
  return [...new Set([
    buildUnifiedRoomId(roomCode, primaryIdentity),
    ...(historicalIdentity ? [buildUnifiedRoomId(roomCode, historicalIdentity)] : []),
  ])];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      // Use locale-invariant comparison so the canonical form is identical regardless
      // of the host system locale (e.g. en-US vs de-DE). This is required so
      // hashWorkspaceValue() produces the same digest on all devices.
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonicalize(item)]));
  }
  return value;
}

export function workspaceValuesEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

/** A later successful full-workspace verification turns an unresolved conflict
 * into a recovery copy. It may still contain useful old local edits, but it no
 * longer describes the current local/cloud synchronization state. */
export function buildWorkspaceInitializationFields(
  current: Record<string, unknown>,
  desired: Record<string, unknown>,
  overwriteExisting: boolean,
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(desired).filter(([field]) => (
    overwriteExisting || !Object.prototype.hasOwnProperty.call(current, field)
  )));
}

export function hasWorkspaceFieldSnapshotChanged(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fieldNames: readonly string[],
): boolean {
  return fieldNames.some((fieldName) => !workspaceValuesEqual(before[fieldName], after[fieldName]));
}

export function findWorkspaceFieldMismatches(
  local: Record<string, unknown>,
  remote: Record<string, unknown>,
  fieldNames: readonly string[],
): string[] {
  return fieldNames.filter((fieldName) => !workspaceValuesEqual(local[fieldName], remote[fieldName]));
}

/**
 * Selects fields which can be written back after a local normalizer has
 * repaired data received from the cloud. A field is eligible only when it is
 * still absent, or when its cloud value is exactly the value that was read
 * before the normalizer ran. This makes the write-back conditional: a newer
 * edit from another device always wins and is handled on the next pass.
 */
export function findWorkspaceFieldsSafeToBackfill(
  initialRemote: Record<string, unknown>,
  currentRemote: Record<string, unknown>,
  canonicalLocal: Record<string, unknown>,
  fieldNames: readonly string[],
): string[] {
  return fieldNames.filter((fieldName) => {
    if (!Object.prototype.hasOwnProperty.call(currentRemote, fieldName)) return true;
    return workspaceValuesEqual(currentRemote[fieldName], initialRemote[fieldName])
      && !workspaceValuesEqual(canonicalLocal[fieldName], currentRemote[fieldName]);
  });
}

export function isWorkspaceRevisionSuperseded(
  emergencyToken: string,
  durableToken: string,
  sourceToken?: string,
): boolean {
  return emergencyToken === durableToken
    || (sourceToken !== undefined && emergencyToken === sourceToken);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isEntityArray(value: unknown): value is Array<Record<string, unknown> & { id: string }> {
  return Array.isArray(value) && value.every((item) =>
    isPlainRecord(item) && typeof item.id === 'string' && item.id.length > 0,
  );
}

interface ThreeWayMergeResult {
  value: unknown;
  conflicts: string[];
}

function mergeWorkspaceValue(
  base: unknown,
  local: unknown,
  remote: unknown,
  path: string,
): ThreeWayMergeResult {
  if (workspaceValuesEqual(local, base)) return { value: remote, conflicts: [] };
  if (workspaceValuesEqual(remote, base) || workspaceValuesEqual(remote, local)) {
    return { value: local, conflicts: [] };
  }

  if (isEntityArray(base) && isEntityArray(local) && isEntityArray(remote)) {
    const baseById = new Map(base.map((item) => [item.id, item]));
    const localById = new Map(local.map((item) => [item.id, item]));
    const remoteById = new Map(remote.map((item) => [item.id, item]));
    const orderedIds = [...new Set([...remote.map((item) => item.id), ...local.map((item) => item.id), ...base.map((item) => item.id)])];
    const merged: unknown[] = [];
    const conflicts: string[] = [];
    for (const id of orderedIds) {
      const result = mergeWorkspaceValue(
        baseById.get(id),
        localById.get(id),
        remoteById.get(id),
        `${path}[${id}]`,
      );
      conflicts.push(...result.conflicts);
      if (result.value !== undefined) merged.push(result.value);
    }
    return { value: merged, conflicts };
  }

  if (isPlainRecord(base) && isPlainRecord(local) && isPlainRecord(remote)) {
    const merged: Record<string, unknown> = {};
    const conflicts: string[] = [];
    const keys = new Set([...Object.keys(base), ...Object.keys(remote), ...Object.keys(local)]);
    for (const key of keys) {
      const result = mergeWorkspaceValue(base[key], local[key], remote[key], `${path}.${key}`);
      conflicts.push(...result.conflicts);
      if (result.value !== undefined) merged[key] = result.value;
    }
    return { value: merged, conflicts };
  }

  return { value: local, conflicts: [path] };
}

export function mergeWorkspaceFieldChanges(
  fields: Record<string, unknown>,
  baseFields: Record<string, unknown>,
  remote: Record<string, unknown>,
): { fields: Record<string, unknown>; conflicts: string[] } {
  const mergedFields: Record<string, unknown> = {};
  const conflicts: string[] = [];
  for (const [key, localValue] of Object.entries(fields)) {
    // Unified storage only ever appends or replaces mapped fields; it never
    // deletes them. An absent cloud field therefore means this is a newly
    // introduced field or an empty workspace, not a competing deletion. Treat
    // it as a safe backfill so an established local workspace can seed a new
    // room instead of being trapped in a false "same-field conflict".
    if (!Object.prototype.hasOwnProperty.call(remote, key)) {
      mergedFields[key] = localValue;
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(baseFields, key)) {
      mergedFields[key] = localValue;
      continue;
    }
    const result = mergeWorkspaceValue(baseFields[key], localValue, remote[key], key);
    mergedFields[key] = result.value;
    conflicts.push(...result.conflicts);
  }
  return { fields: mergedFields, conflicts };
}

export interface WorkspaceMigrationPendingFields {
  fields: Record<string, unknown>;
  baseFields?: Record<string, unknown>;
  forceFields?: string[];
}

/**
 * Builds the exact source root for a legacy-to-unified migration. Pending
 * local edits are merged over the latest legacy snapshot, while an explicit
 * user override applies only to the fields the user confirmed.
 */
export function mergePendingWorkspaceMigrationFields(
  remote: Record<string, unknown>,
  pending: WorkspaceMigrationPendingFields,
): { root: Record<string, unknown>; conflicts: string[] } {
  const merged = mergeWorkspaceFieldChanges(pending.fields, pending.baseFields ?? {}, remote);
  const forcedFields = new Set(pending.forceFields ?? []);
  for (const field of forcedFields) {
    if (Object.prototype.hasOwnProperty.call(pending.fields, field)) {
      merged.fields[field] = pending.fields[field];
    }
  }
  return {
    root: { ...remote, ...merged.fields },
    conflicts: merged.conflicts.filter((path) => !forcedFields.has(path.split(/[.[]/, 1)[0])),
  };
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
  const data = { timeline: backup.timeline, lifeMap: backup.lifeMap, ebb: backup.ebb, daily: backup.daily, graph: backup.graph };
  return await hashWorkspaceValue(data);
}

import type { Json } from '@liveblocks/client';
import { useTimelineStore } from '@/store';
import { useEbbStore, EBB_ROOM_PREFIX } from '@/ebb/store';
import { useDailyScheduleStore, DAILY_ROOM_PREFIX } from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';
import { LIFE_MAP_ROOM_PREFIX, useLifeMapStore } from '@/lifeMap/store';
import { LIFE_MAP_FIELDS, normalizeLifeMapData } from '@/lifeMap/data';
import { liveblocksClient } from '@/store/client';
import {
  createLocalSnapshot,
  createWorkspaceBackup,
  validateWorkspaceBackup,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceBackup,
  type WorkspaceBackupSummary,
} from './workspaceBackup';
import {
  WORKSPACE_QUEUE_EVENT,
  WORKSPACE_QUEUE_ERROR_EVENT,
  acknowledgeAppliedWorkspaceSync,
  clearPendingWorkspaceSync,
  getPendingWorkspaceSyncToken,
  preserveWorkspaceConflict,
  readPendingWorkspaceSync,
  setWorkspaceQueueSuppressed,
  type WorkspaceStorageField,
} from './workspaceSyncQueueCore';
import { assertWorkspaceQueueDrained, assertWorkspaceSchemaSupported, buildUnifiedRoomId, commitWorkspaceQueueRevisionSafely, decideUnifiedWorkspaceActivation, findWorkspaceFieldConflicts, hashWorkspaceBackup, mergeWorkspaceFieldChanges, shouldBackfillLegacyLifeMapSync, withTimeout } from './workspaceSyncCore';
export { buildUnifiedRoomId, hashWorkspaceBackup } from './workspaceSyncCore';

export type SyncArchitecture = 'legacy' | 'unified';

export interface WorkspaceSyncSettings {
  architecture: SyncArchitecture;
  roomCode: string;
  unifiedRoomId?: string;
  migratedAt?: string;
  migrationHash?: string;
}

export interface WorkspaceMigrationReport {
  version: 1;
  sourceRoomCode: string;
  targetRoomId: string;
  startedAt: string;
  completedAt: string;
  sourceHash: string;
  targetHash: string;
  sourceSummary: WorkspaceBackupSummary;
  targetSummary: WorkspaceBackupSummary;
  verified: boolean;
  legacyRoomsPreserved: true;
}

export interface UnifiedWorkspaceActivationResult {
  roomId: string;
  source: 'new' | 'matching' | 'cloud';
  applied: number;
}

export interface UnifiedWorkspaceConnectionResult {
  roomId: string;
  applied: number;
}

const SETTINGS_KEY = 'smart-line-sync-architecture-v1';
const EXPECTED_KEYS = [
  'tasks', 'groups', 'notes', 'milestones', 'lifeStages',
  ...LIFE_MAP_FIELDS,
  'reviewTasks', 'inboxItems', 'outlineNodes', 'ebbSettings',
  'schedules', 'retrospectives', 'nodes',
] as const;
let queueListenerStarted = false;
let queueFlushTimer: number | null = null;
let queueFlushInFlight: Promise<{ applied: number; conflict: boolean }> | null = null;
export const WORKSPACE_CONFLICT_EVENT = 'smartline:workspace-conflict';

export function readWorkspaceSyncSettings(): WorkspaceSyncSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null') as Partial<WorkspaceSyncSettings> | null;
    if (parsed?.architecture === 'unified' && parsed.roomCode && parsed.unifiedRoomId) {
      return parsed as WorkspaceSyncSettings;
    }
  } catch { /* use legacy default */ }
  const timeline = useTimelineStore.getState();
  return { architecture: 'legacy', roomCode: timeline.syncRoomCode || '' };
}

function writeWorkspaceSyncSettings(settings: WorkspaceSyncSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function enableAll(code: string): void {
  useTimelineStore.getState().enableSync(code);
  useEbbStore.getState().enableSync(code);
  useDailyScheduleStore.getState().enableSync(code);
  useGraphStore.getState().enableSync(code);
  useLifeMapStore.getState().enableSync(code);
}

export function disconnectWorkspace(disable = false): void {
  const stores = [useTimelineStore.getState(), useEbbStore.getState(), useDailyScheduleStore.getState(), useGraphStore.getState(), useLifeMapStore.getState()];
  stores.forEach((store) => store.liveblocks?.leaveRoom?.());
  if (disable) stores.forEach((store) => store.disableSync());
}

export function connectLegacyWorkspace(fallbackCode?: string): void {
  const timeline = useTimelineStore.getState();
  const ebb = useEbbStore.getState();
  const daily = useDailyScheduleStore.getState();
  const graph = useGraphStore.getState();
  const lifeMap = useLifeMapStore.getState();
  const code = fallbackCode || timeline.syncRoomCode || ebb.syncRoomCode || daily.syncRoomCode || graph.syncRoomCode || lifeMap.syncRoomCode;
  if (!code) return;
  const existing = timeline.syncEnabled || ebb.syncEnabled || daily.syncEnabled || graph.syncEnabled || lifeMap.syncEnabled;
  if (!existing) enableAll(code);

  // Life Map was added after the original four legacy modules. Existing users
  // therefore have a valid workspace code but no module-specific Life Map
  // setting. Backfill that setting once so the new module joins the same
  // workspace automatically on every device instead of remaining local-only.
  if (shouldBackfillLegacyLifeMapSync(existing, lifeMap.syncEnabled)) lifeMap.enableSync(code);

  const connectedTimeline = useTimelineStore.getState();
  const connectedEbb = useEbbStore.getState();
  const connectedDaily = useDailyScheduleStore.getState();
  const connectedGraph = useGraphStore.getState();
  const connectedLifeMap = useLifeMapStore.getState();
  if (connectedTimeline.syncEnabled) connectedTimeline.liveblocks?.enterRoom?.(connectedTimeline.syncRoomCode || code);
  if (connectedEbb.syncEnabled) connectedEbb.liveblocks?.enterRoom?.(`${EBB_ROOM_PREFIX}${connectedEbb.syncRoomCode || code}`);
  if (connectedDaily.syncEnabled) connectedDaily.liveblocks?.enterRoom?.(`${DAILY_ROOM_PREFIX}${connectedDaily.syncRoomCode || code}`);
  if (connectedGraph.syncEnabled) connectedGraph.liveblocks?.enterRoom?.(`graph-${connectedGraph.syncRoomCode || code}`);
  if (connectedLifeMap.syncEnabled) connectedLifeMap.liveblocks?.enterRoom?.(`${LIFE_MAP_ROOM_PREFIX}${connectedLifeMap.syncRoomCode || code}`);
}

export async function connectUnifiedWorkspace(roomCode: string, roomId?: string): Promise<UnifiedWorkspaceConnectionResult> {
  const settings = readWorkspaceSyncSettings();
  const targetRoomId = roomId || settings.unifiedRoomId || buildUnifiedRoomId(roomCode);
  setWorkspaceQueueSuppressed(true);
  try {
    enableAll(roomCode);
    useTimelineStore.getState().liveblocks?.enterRoom?.(targetRoomId);
    useEbbStore.getState().liveblocks?.enterRoom?.(targetRoomId);
    useDailyScheduleStore.getState().liveblocks?.enterRoom?.(targetRoomId);
    useGraphStore.getState().liveblocks?.enterRoom?.(targetRoomId);
    useLifeMapStore.getState().liveblocks?.enterRoom?.(targetRoomId);
    ensureQueueListener();

    await waitForUnifiedStorage();
    if (queueFlushTimer) {
      window.clearTimeout(queueFlushTimer);
      queueFlushTimer = null;
    }
    const flushed = await flushWorkspaceQueue();
    const remaining = await readPendingWorkspaceSync();
    assertWorkspaceQueueDrained({
      pendingFieldCount: Object.keys(remaining?.fields ?? {}).length,
      conflictDetected: flushed.conflict,
    });

    const room = useTimelineStore.getState().liveblocks?.room;
    if (!room || room.getStatus() !== 'connected') {
      throw new Error('统一工作区连接在补传完成前中断，请检查网络后重试。');
    }
    await waitForRoomStorageSynchronized(room);
    window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
    return { roomId: targetRoomId, applied: flushed.applied };
  } finally {
    window.setTimeout(() => setWorkspaceQueueSuppressed(false), 0);
  }
}

export async function activateUnifiedWorkspace(roomCode: string, identity: string): Promise<UnifiedWorkspaceConnectionResult> {
  const roomId = buildUnifiedRoomId(roomCode, identity);
  writeWorkspaceSyncSettings({ architecture: 'unified', roomCode, unifiedRoomId: roomId });
  return connectUnifiedWorkspace(roomCode, roomId);
}

export async function reconnectConfiguredWorkspace(): Promise<UnifiedWorkspaceConnectionResult | null> {
  const settings = readWorkspaceSyncSettings();
  const anyEnabled = [useTimelineStore, useEbbStore, useDailyScheduleStore, useGraphStore, useLifeMapStore]
    .some((store) => store.getState().syncEnabled);
  if (!anyEnabled) return null;
  if (settings.architecture === 'unified' && settings.unifiedRoomId) {
    const root = await inspectRoom(settings.unifiedRoomId, '统一工作区');
    assertWorkspaceSchemaSupported(root, WORKSPACE_SCHEMA_VERSION);
    return await connectUnifiedWorkspace(settings.roomCode, settings.unifiedRoomId);
  } else {
    connectLegacyWorkspace(settings.roomCode);
    return null;
  }
}

function rootToBackup(root: Record<string, unknown>, base: WorkspaceBackup): WorkspaceBackup {
  return {
    ...base,
    timeline: {
      tasks: Array.isArray(root.tasks) ? root.tasks as WorkspaceBackup['timeline']['tasks'] : [],
      groups: Array.isArray(root.groups) ? root.groups as WorkspaceBackup['timeline']['groups'] : [],
      notes: Array.isArray(root.notes) ? root.notes as WorkspaceBackup['timeline']['notes'] : [],
      milestones: Array.isArray(root.milestones) ? root.milestones as WorkspaceBackup['timeline']['milestones'] : [],
      lifeStages: Array.isArray(root.lifeStages) ? root.lifeStages as WorkspaceBackup['timeline']['lifeStages'] : [],
    },
    ebb: {
      reviewTasks: Array.isArray(root.reviewTasks) ? root.reviewTasks as WorkspaceBackup['ebb']['reviewTasks'] : [],
      inboxItems: Array.isArray(root.inboxItems) ? root.inboxItems as WorkspaceBackup['ebb']['inboxItems'] : [],
      outlineNodes: Array.isArray(root.outlineNodes) ? root.outlineNodes as WorkspaceBackup['ebb']['outlineNodes'] : [],
      ebbSettings: root.ebbSettings && typeof root.ebbSettings === 'object'
        ? root.ebbSettings as WorkspaceBackup['ebb']['ebbSettings']
        : base.ebb.ebbSettings,
    },
    daily: {
      schedules: root.schedules && typeof root.schedules === 'object'
        ? root.schedules as WorkspaceBackup['daily']['schedules']
        : {},
      retrospectives: root.retrospectives && typeof root.retrospectives === 'object'
        ? root.retrospectives as WorkspaceBackup['daily']['retrospectives']
        : {},
    },
    graph: { nodes: Array.isArray(root.nodes) ? root.nodes as WorkspaceBackup['graph']['nodes'] : [] },
    lifeMap: LIFE_MAP_FIELDS.some((field) => root[field] !== undefined)
      ? normalizeLifeMapData(root)
      : base.lifeMap,
  };
}

function summaryOf(backup: WorkspaceBackup): WorkspaceBackupSummary {
  const result = validateWorkspaceBackup(backup);
  if (!result.summary || result.errors.length > 0) throw new Error(result.errors.join('；') || '工作区数据校验失败。');
  return result.summary;
}

async function inspectRoom(roomId: string, label: string): Promise<Record<string, unknown>> {
  const { room, leave } = liveblocksClient.enterRoom(roomId, { initialPresence: {} });
  try {
    const { root } = await withTimeout(
      room.getStorage(),
      15_000,
      `读取${label}超时。请检查网络、登录状态和 Liveblocks Secret Key 后重试。`,
    );
    return root.toJSON() as Record<string, unknown>;
  } finally {
    leave();
  }
}

/**
 * First-time unified activation is deliberately fail-closed.  Empty devices
 * may join an existing cloud workspace and equal workspaces may reconnect, but
 * two different non-empty workspaces are never silently overlaid.
 */
export async function activateUnifiedWorkspaceSafely(
  roomCode: string,
  identity: string,
): Promise<UnifiedWorkspaceActivationResult> {
  const targetRoomId = buildUnifiedRoomId(roomCode, identity);
  const local = createWorkspaceBackup();
  await createLocalSnapshot('首次连接统一工作区前');
  const remoteRoot = await inspectRoom(targetRoomId, '统一工作区');
  assertWorkspaceSchemaSupported(remoteRoot, WORKSPACE_SCHEMA_VERSION);
  const hasRemoteStorage = EXPECTED_KEYS.some((key) => remoteRoot[key] !== undefined);

  const remote = rootToBackup(remoteRoot, local);
  const [localHash, remoteHash] = await Promise.all([
    hashWorkspaceBackup(local),
    hashWorkspaceBackup(remote),
  ]);
  const [localSummary, remoteSummary] = [summaryOf(local), summaryOf(remote)];
  const decision = decideUnifiedWorkspaceActivation(hasRemoteStorage, localHash, remoteHash, localSummary, remoteSummary);
  if (decision !== 'conflict') {
    const connected = await activateUnifiedWorkspace(roomCode, identity);
    return { roomId: connected.roomId, source: decision, applied: connected.applied };
  }

  throw new Error(
    `本机和云端都已有不同数据，已阻止自动连接以避免覆盖。`
      + `本机：${localSummary.tasks} 个项目、${localSummary.lifeMapItems} 项人生规划、${localSummary.reviewTasks} 个复习轮次；`
      + `云端：${remoteSummary.tasks} 个项目、${remoteSummary.lifeMapItems} 项人生规划、${remoteSummary.reviewTasks} 个复习轮次。`
      + `连接前本地快照已经保存，请先导出备份或使用迁移工具明确处理数据方向。`,
  );
}

export async function inspectLegacyWorkspace(roomCode: string): Promise<{ backup: WorkspaceBackup; summary: WorkspaceBackupSummary; hash: string }> {
  const base = createWorkspaceBackup();
  const roomIds = [roomCode, `${EBB_ROOM_PREFIX}${roomCode}`, `${DAILY_ROOM_PREFIX}${roomCode}`, `graph-${roomCode}`, `${LIFE_MAP_ROOM_PREFIX}${roomCode}`];
  const labels = ['旧时间轴房间', '旧 EBB 房间', '旧每日安排房间', '旧知识大盘房间'];
  const [timeline, ebb, daily, graph, lifeMap] = await Promise.all(roomIds.map((roomId, index) => inspectRoom(roomId, labels[index] ?? '旧人生地图房间')));
  const backup = rootToBackup({ ...timeline, ...ebb, ...daily, ...graph, ...lifeMap }, base);
  return { backup, summary: summaryOf(backup), hash: await hashWorkspaceBackup(backup) };
}

function waitForUnifiedStorage(timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const stores = [useTimelineStore.getState(), useEbbStore.getState(), useDailyScheduleStore.getState(), useGraphStore.getState(), useLifeMapStore.getState()];
      const ready = stores.every((store) => store.liveblocks?.status === 'connected' && !store.liveblocks?.isStorageLoading);
      if (ready) {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error('统一工作区连接超时，已保留旧房间，可稍后重试。'));
      }
    }, 100);
  });
}

function waitForRoomStorageSynchronized(
  room: { getStatus: () => string; getStorageStatus?: () => string },
  timeoutMs = 20_000,
): Promise<void> {
  if (typeof room.getStorageStatus !== 'function') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (room.getStatus() !== 'connected') {
        window.clearInterval(timer);
        reject(new Error('向云端确认补传结果时连接中断，请检查网络后重试。'));
        return;
      }
      if (room.getStorageStatus?.() === 'synchronized') {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error('本机修改已提交，但云端确认超时。请保持页面开启并稍后重试。'));
      }
    }, 100);
  });
}

function reportQueueFlushFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : '待同步数据补传失败，请保持页面开启并重试。';
  window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_ERROR_EVENT, { detail: { message } }));
}

function ensureQueueListener(): void {
  if (queueListenerStarted || typeof window === 'undefined') return;
  queueListenerStarted = true;
  window.addEventListener(WORKSPACE_QUEUE_EVENT, () => {
    if (readWorkspaceSyncSettings().architecture !== 'unified') return;
    if (queueFlushTimer) window.clearTimeout(queueFlushTimer);
    queueFlushTimer = window.setTimeout(() => {
      queueFlushTimer = null;
      void flushWorkspaceQueue().catch(reportQueueFlushFailure);
    }, 700);
  });
}

export function flushWorkspaceQueue(): Promise<{ applied: number; conflict: boolean }> {
  if (queueFlushInFlight) return queueFlushInFlight;
  const operation = flushWorkspaceQueueInternal();
  queueFlushInFlight = operation;
  operation.then(
    () => { if (queueFlushInFlight === operation) queueFlushInFlight = null; },
    () => { if (queueFlushInFlight === operation) queueFlushInFlight = null; },
  );
  return operation;
}

async function flushWorkspaceQueueInternal(): Promise<{ applied: number; conflict: boolean }> {
  const pending = await readPendingWorkspaceSync();
  if (!pending) return { applied: 0, conflict: false };
  const room = useTimelineStore.getState().liveblocks?.room;
  if (!room || room.getStatus() !== 'connected') return { applied: 0, conflict: false };
  const { root } = await room.getStorage();
  const rootJson = root.toJSON() as Record<string, unknown>;
  const metadata = rootJson.metadata && typeof rootJson.metadata === 'object'
    ? rootJson.metadata as Record<string, unknown>
    : {};
  assertWorkspaceSchemaSupported(rootJson, WORKSPACE_SCHEMA_VERSION);
  const remoteUpdatedAt = typeof metadata.updatedAt === 'string' ? metadata.updatedAt : '';
  const remoteDeviceId = typeof metadata.deviceId === 'string' ? metadata.deviceId : '';
  const merged = mergeWorkspaceFieldChanges(
    pending.fields,
    pending.baseFields ?? {},
    rootJson,
  );
  const legacyFields = Object.fromEntries(
    Object.entries(pending.fields).filter(([key]) =>
      !Object.prototype.hasOwnProperty.call(pending.baseFields ?? {}, key),
    ),
  );
  const fieldConflicts = [
    ...merged.conflicts,
    ...await findWorkspaceFieldConflicts(
    legacyFields,
    pending.baseHashes ?? {},
    rootJson,
    ),
  ];
  const fieldsWithoutBaseline = Object.keys(pending.fields).filter((key) => !pending.baseHashes?.[key as keyof typeof pending.baseHashes]);
  const metadataConflict = fieldsWithoutBaseline.length > 0
    && remoteUpdatedAt > pending.updatedAt
    && remoteDeviceId
    && remoteDeviceId !== pending.deviceId;
  // Conflict hashing awaits Web Crypto and gives newer user actions time to
  // enter the queue. Re-read immediately before the synchronous room batch;
  // if the queue revision changed, restart with the newest snapshot instead
  // of replaying the stale one we read at the beginning of this flush.
  const latest = await readPendingWorkspaceSync();
  if (!latest) return { applied: 0, conflict: false };
  if (getPendingWorkspaceSyncToken(latest) !== getPendingWorkspaceSyncToken(pending)) {
    return flushWorkspaceQueueInternal();
  }

  if (fieldConflicts.length > 0 || metadataConflict) {
    const pendingKeys = Object.keys(pending.fields) as WorkspaceStorageField[];
    const remoteFields = Object.fromEntries(pendingKeys.map((key) => [key, rootJson[key]])) as Partial<Record<WorkspaceStorageField, unknown>>;
    const conflictingFields = [...new Set(fieldConflicts.map((path) => path.split(/[.[]/, 1)[0] as WorkspaceStorageField))];
    await preserveWorkspaceConflict(pending, remoteUpdatedAt, remoteFields, metadataConflict ? pendingKeys : conflictingFields);
    window.dispatchEvent(new CustomEvent(WORKSPACE_CONFLICT_EVENT));
    window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
    return { applied: 0, conflict: true };
  }

  setWorkspaceQueueSuppressed(true);
  try {
    // The local queue is the last durable copy of offline edits. Keep it until
    // Liveblocks confirms that the batch reached the cloud; a disconnect or
    // timeout must leave the queue intact so the next reconnect can retry.
    await commitWorkspaceQueueRevisionSafely({
      apply: () => room.batch(() => {
        for (const [key, value] of Object.entries(merged.fields)) root.set(key, value as Json);
        root.set('metadata', {
          ...metadata,
          schemaVersion: WORKSPACE_SCHEMA_VERSION,
          updatedAt: pending.updatedAt,
          deviceId: pending.deviceId,
        } as Json);
      }),
      confirm: () => waitForRoomStorageSynchronized(room),
      // Keep tracking suppressed until the exact queue revision applied above
      // is durably removed. Releasing suppression first lets the Liveblocks
      // echo recreate an identical pending record while IndexedDB is clearing.
      clear: () => clearPendingWorkspaceSync(pending),
    });
    // A newer local revision may have landed after the last pre-batch check.
    // Never report a successful flush while a journal entry is still pending:
    // keep suppression active and immediately drain the newest revision. This
    // also absorbs a same-value storage echo without deleting a genuinely
    // newer edit blindly.
    let remaining = await readPendingWorkspaceSync();
    if (remaining && await acknowledgeAppliedWorkspaceSync(pending.fields)) {
      remaining = await readPendingWorkspaceSync();
    }
    if (remaining) {
      return flushWorkspaceQueueInternal();
    }
  } finally {
    window.setTimeout(() => setWorkspaceQueueSuppressed(false), 0);
  }
  window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
  return { applied: Object.keys(merged.fields).length, conflict: false };
}

function workspaceRootFromBackup(backup: WorkspaceBackup): Record<string, Json> {
  return {
    tasks: backup.timeline.tasks as unknown as Json,
    groups: backup.timeline.groups as unknown as Json,
    notes: backup.timeline.notes as unknown as Json,
    milestones: backup.timeline.milestones as unknown as Json,
    lifeStages: backup.timeline.lifeStages as unknown as Json,
    reviewTasks: backup.ebb.reviewTasks as unknown as Json,
    inboxItems: backup.ebb.inboxItems as unknown as Json,
    outlineNodes: backup.ebb.outlineNodes as unknown as Json,
    ebbSettings: backup.ebb.ebbSettings as unknown as Json,
    schedules: backup.daily.schedules as unknown as Json,
    retrospectives: backup.daily.retrospectives as unknown as Json,
    nodes: backup.graph.nodes as unknown as Json,
    ...Object.fromEntries(LIFE_MAP_FIELDS.map((field) => [field, backup.lifeMap[field] as unknown as Json])),
  };
}

export async function migrateLegacyWorkspace(roomCode: string, identity: string): Promise<WorkspaceMigrationReport> {
  const startedAt = new Date().toISOString();
  const source = await inspectLegacyWorkspace(roomCode);
  const localHash = await hashWorkspaceBackup(createWorkspaceBackup());
  if (localHash !== source.hash) {
    throw new Error('本地数据与旧房间尚未一致。请保持联网，等待四个模块全部连接后重新检查。');
  }
  await clearPendingWorkspaceSync();
  await createLocalSnapshot('统一工作区迁移前');
  const targetRoomId = buildUnifiedRoomId(roomCode, identity);
  const existingRoot = await inspectRoom(targetRoomId, '统一工作区目标房间');
  assertWorkspaceSchemaSupported(existingRoot, WORKSPACE_SCHEMA_VERSION);
  const hasExistingData = EXPECTED_KEYS.some((key) => existingRoot[key] !== undefined);

  if (hasExistingData) {
    const existingBackup = rootToBackup(existingRoot, source.backup);
    const existingHash = await hashWorkspaceBackup(existingBackup);
    if (existingHash !== source.hash) {
      throw new Error('统一工作区已存在不同数据。为避免覆盖，迁移已停止；旧房间没有变化。');
    }
  }

  try {
    const connection = await connectUnifiedWorkspace(roomCode, targetRoomId);
    const target = connection.roomId;
    const timelineRoom = useTimelineStore.getState().liveblocks?.room;
    if (!timelineRoom) throw new Error('统一工作区连接未建立。');
    const { root } = await timelineRoom.getStorage();
    if (!hasExistingData) {
      timelineRoom.batch(() => {
        for (const [key, value] of Object.entries(workspaceRootFromBackup(source.backup))) root.set(key, value);
      });
    }
    root.set('metadata', {
      schemaVersion: WORKSPACE_SCHEMA_VERSION,
      sourceRoomCode: roomCode,
      migratedAt: new Date().toISOString(),
      migrationHash: source.hash,
    });
    await waitForRoomStorageSynchronized(timelineRoom);
    const verifiedRoot = root.toJSON() as Record<string, unknown>;
    const verifiedBackup = rootToBackup(verifiedRoot, source.backup);
    const targetHash = await hashWorkspaceBackup(verifiedBackup);
    const targetSummary = summaryOf(verifiedBackup);
    if (targetHash !== source.hash) throw new Error('迁移后哈希不一致，已停止切换并保留旧房间。');

    const completedAt = new Date().toISOString();
    writeWorkspaceSyncSettings({
      architecture: 'unified', roomCode, unifiedRoomId: target,
      migratedAt: completedAt, migrationHash: targetHash,
    });
    return {
      version: 1, sourceRoomCode: roomCode, targetRoomId: target,
      startedAt, completedAt, sourceHash: source.hash, targetHash,
      sourceSummary: source.summary, targetSummary,
      verified: true, legacyRoomsPreserved: true,
    };
  } catch (error) {
    connectLegacyWorkspace(roomCode);
    throw error;
  }
}

export function downloadMigrationReport(report: WorkspaceMigrationReport): void {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `smart-line-migration-${report.completedAt.slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function resetToLegacyArchitecture(roomCode: string): void {
  writeWorkspaceSyncSettings({ architecture: 'legacy', roomCode });
  connectLegacyWorkspace(roomCode);
}

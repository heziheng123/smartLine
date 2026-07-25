import type { Json } from '@liveblocks/client';
import { useTimelineStore } from '@/store';
import { useEbbStore, EBB_ROOM_PREFIX } from '@/ebb/store';
import { useDailyScheduleStore, DAILY_ROOM_PREFIX } from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';
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
  clearPendingWorkspaceSync,
  getPendingWorkspaceSyncToken,
  preserveWorkspaceConflict,
  readPendingWorkspaceSync,
  setWorkspaceQueueSuppressed,
} from './workspaceOfflineQueue';
import { buildUnifiedRoomId, findWorkspaceFieldConflicts, hashWorkspaceBackup, withTimeout } from './workspaceSyncCore';
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

const SETTINGS_KEY = 'smart-line-sync-architecture-v1';
const EXPECTED_KEYS = [
  'tasks', 'groups', 'notes', 'milestones',
  'reviewTasks', 'inboxItems', 'outlineNodes', 'ebbSettings',
  'schedules', 'retrospectives', 'nodes',
] as const;
let queueListenerStarted = false;
let queueFlushTimer: number | null = null;

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
}

export function disconnectWorkspace(disable = false): void {
  const stores = [useTimelineStore.getState(), useEbbStore.getState(), useDailyScheduleStore.getState(), useGraphStore.getState()];
  stores.forEach((store) => store.liveblocks?.leaveRoom?.());
  if (disable) stores.forEach((store) => store.disableSync());
}

export function connectLegacyWorkspace(fallbackCode?: string): void {
  const timeline = useTimelineStore.getState();
  const ebb = useEbbStore.getState();
  const daily = useDailyScheduleStore.getState();
  const graph = useGraphStore.getState();
  const code = fallbackCode || timeline.syncRoomCode || ebb.syncRoomCode || daily.syncRoomCode || graph.syncRoomCode;
  if (!code) return;
  const existing = timeline.syncEnabled || ebb.syncEnabled || daily.syncEnabled || graph.syncEnabled;
  if (!existing) enableAll(code);
  if (timeline.syncEnabled) timeline.liveblocks?.enterRoom?.(timeline.syncRoomCode || code);
  if (ebb.syncEnabled) ebb.liveblocks?.enterRoom?.(`${EBB_ROOM_PREFIX}${ebb.syncRoomCode || code}`);
  if (daily.syncEnabled) daily.liveblocks?.enterRoom?.(`${DAILY_ROOM_PREFIX}${daily.syncRoomCode || code}`);
  if (graph.syncEnabled) graph.liveblocks?.enterRoom?.(`graph-${graph.syncRoomCode || code}`);
}

export function connectUnifiedWorkspace(roomCode: string, roomId?: string): string {
  const settings = readWorkspaceSyncSettings();
  const targetRoomId = roomId || settings.unifiedRoomId || buildUnifiedRoomId(roomCode);
  setWorkspaceQueueSuppressed(true);
  enableAll(roomCode);
  useTimelineStore.getState().liveblocks?.enterRoom?.(targetRoomId);
  useEbbStore.getState().liveblocks?.enterRoom?.(targetRoomId);
  useDailyScheduleStore.getState().liveblocks?.enterRoom?.(targetRoomId);
  useGraphStore.getState().liveblocks?.enterRoom?.(targetRoomId);
  ensureQueueListener();
  void waitForUnifiedStorage()
    .then(() => flushWorkspaceQueue())
    .catch(() => undefined)
    .finally(() => window.setTimeout(() => setWorkspaceQueueSuppressed(false), 0));
  return targetRoomId;
}

export function activateUnifiedWorkspace(roomCode: string, identity: string): string {
  const roomId = buildUnifiedRoomId(roomCode, identity);
  writeWorkspaceSyncSettings({ architecture: 'unified', roomCode, unifiedRoomId: roomId });
  return connectUnifiedWorkspace(roomCode, roomId);
}

export function reconnectConfiguredWorkspace(): void {
  const settings = readWorkspaceSyncSettings();
  const anyEnabled = [useTimelineStore, useEbbStore, useDailyScheduleStore, useGraphStore]
    .some((store) => store.getState().syncEnabled);
  if (!anyEnabled) return;
  if (settings.architecture === 'unified' && settings.unifiedRoomId) {
    connectUnifiedWorkspace(settings.roomCode, settings.unifiedRoomId);
  } else {
    connectLegacyWorkspace(settings.roomCode);
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

export async function inspectLegacyWorkspace(roomCode: string): Promise<{ backup: WorkspaceBackup; summary: WorkspaceBackupSummary; hash: string }> {
  const base = createWorkspaceBackup();
  const roomIds = [roomCode, `${EBB_ROOM_PREFIX}${roomCode}`, `${DAILY_ROOM_PREFIX}${roomCode}`, `graph-${roomCode}`];
  const labels = ['旧时间轴房间', '旧 EBB 房间', '旧每日安排房间', '旧知识大盘房间'];
  const [timeline, ebb, daily, graph] = await Promise.all(roomIds.map((roomId, index) => inspectRoom(roomId, labels[index])));
  const backup = rootToBackup({ ...timeline, ...ebb, ...daily, ...graph }, base);
  return { backup, summary: summaryOf(backup), hash: await hashWorkspaceBackup(backup) };
}

function waitForUnifiedStorage(timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const stores = [useTimelineStore.getState(), useEbbStore.getState(), useDailyScheduleStore.getState(), useGraphStore.getState()];
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

function ensureQueueListener(): void {
  if (queueListenerStarted || typeof window === 'undefined') return;
  queueListenerStarted = true;
  window.addEventListener(WORKSPACE_QUEUE_EVENT, () => {
    if (readWorkspaceSyncSettings().architecture !== 'unified') return;
    if (queueFlushTimer) window.clearTimeout(queueFlushTimer);
    queueFlushTimer = window.setTimeout(() => { void flushWorkspaceQueue(); }, 700);
  });
}

export async function flushWorkspaceQueue(): Promise<{ applied: number; conflict: boolean }> {
  const pending = await readPendingWorkspaceSync();
  if (!pending) return { applied: 0, conflict: false };
  const room = useTimelineStore.getState().liveblocks?.room;
  if (!room || room.getStatus() !== 'connected') return { applied: 0, conflict: false };
  const { root } = await room.getStorage();
  const rootJson = root.toJSON() as Record<string, unknown>;
  const metadata = rootJson.metadata && typeof rootJson.metadata === 'object'
    ? rootJson.metadata as Record<string, unknown>
    : {};
  const remoteUpdatedAt = typeof metadata.updatedAt === 'string' ? metadata.updatedAt : '';
  const remoteDeviceId = typeof metadata.deviceId === 'string' ? metadata.deviceId : '';
  const fieldConflicts = await findWorkspaceFieldConflicts(
    pending.fields,
    pending.baseHashes ?? {},
    rootJson,
  );
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
    return flushWorkspaceQueue();
  }

  if (fieldConflicts.length > 0 || metadataConflict) {
    await preserveWorkspaceConflict(pending, remoteUpdatedAt);
    window.dispatchEvent(new CustomEvent('smartline:workspace-conflict'));
    return { applied: 0, conflict: true };
  }

  setWorkspaceQueueSuppressed(true);
  try {
    room.batch(() => {
      for (const [key, value] of Object.entries(pending.fields)) root.set(key, value as Json);
      root.set('metadata', {
        ...metadata,
        schemaVersion: WORKSPACE_SCHEMA_VERSION,
        updatedAt: pending.updatedAt,
        deviceId: pending.deviceId,
      } as Json);
    });
  } finally {
    window.setTimeout(() => setWorkspaceQueueSuppressed(false), 0);
  }
  await clearPendingWorkspaceSync(pending);
  return { applied: Object.keys(pending.fields).length, conflict: false };
}

function workspaceRootFromBackup(backup: WorkspaceBackup): Record<string, Json> {
  return {
    tasks: backup.timeline.tasks as unknown as Json,
    groups: backup.timeline.groups as unknown as Json,
    notes: backup.timeline.notes as unknown as Json,
    milestones: backup.timeline.milestones as unknown as Json,
    reviewTasks: backup.ebb.reviewTasks as unknown as Json,
    inboxItems: backup.ebb.inboxItems as unknown as Json,
    outlineNodes: backup.ebb.outlineNodes as unknown as Json,
    ebbSettings: backup.ebb.ebbSettings as unknown as Json,
    schedules: backup.daily.schedules as unknown as Json,
    retrospectives: backup.daily.retrospectives as unknown as Json,
    nodes: backup.graph.nodes as unknown as Json,
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
  const hasExistingData = EXPECTED_KEYS.some((key) => existingRoot[key] !== undefined);

  if (hasExistingData) {
    const existingBackup = rootToBackup(existingRoot, source.backup);
    const existingHash = await hashWorkspaceBackup(existingBackup);
    if (existingHash !== source.hash) {
      throw new Error('统一工作区已存在不同数据。为避免覆盖，迁移已停止；旧房间没有变化。');
    }
  }

  try {
    const target = connectUnifiedWorkspace(roomCode, targetRoomId);
    await waitForUnifiedStorage();
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

import type { Json } from '@liveblocks/client';
import { useTimelineStore } from '@/store';
import { useEbbStore, EBB_ROOM_PREFIX } from '@/ebb/store';
import { useDailyScheduleStore, DAILY_ROOM_PREFIX } from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';
import { LIFE_MAP_ROOM_PREFIX, useLifeMapStore } from '@/lifeMap/store';
import { LIFE_MAP_FIELDS, normalizeLifeMapData } from '@/lifeMap/data';
import { normalizeTimelineData } from '@/store/timelineData';
import { normalizeEbbData } from '@/ebb/dataNormalization';
import { createLiveblocksClient, liveblocksAuthMode } from '@/store/client';
import {
  createLocalSnapshot,
  createWorkspaceSnapshot,
  createWorkspaceBackup,
  restoreWorkspaceBackup,
  validateWorkspaceBackup,
  WORKSPACE_SCHEMA_VERSION,
  type WorkspaceBackup,
  type WorkspaceBackupSummary,
} from './workspaceBackup';
import {
  WORKSPACE_QUEUE_EVENT,
  WORKSPACE_QUEUE_ERROR_EVENT,
  acknowledgeAppliedWorkspaceSync,
  acknowledgeWorkspaceSyncFields,
  clearPendingWorkspaceSync,
  getPendingWorkspaceSyncToken,
  listWorkspaceConflicts,
  markWorkspaceConflictResolved,
  readPendingWorkspaceSync,
  setWorkspaceConnectionMutationCapture,
  setWorkspaceQueueSuppressed,
  type WorkspaceStorageField,
  type WorkspaceQueueErrorKind,
  type WorkspaceQueueErrorDetail,
} from './workspaceSyncQueueCore';
import {
  assertWorkspaceQueueDrained,
  assertWorkspaceSchemaSupported,
  buildWorkspaceInitializationFields,
  buildUnifiedRoomCandidates,
  buildUnifiedRoomId,
  buildWorkspaceBindingRoomId,
  commitWorkspaceQueueRevisionSafely,
  decideLegacyWorkspaceDiscovery,
  decideUnifiedWorkspaceActivation,
  findWorkspaceFieldConflicts,
  findWorkspaceFieldsSafeToBackfill,
  findWorkspaceFieldMismatches,
  hasWorkspaceFieldSnapshotChanged,
  hashWorkspaceBackup,
  hashWorkspaceValue,
  isBundledDemoWorkspace,
  mergePendingWorkspaceMigrationFields,
  mergeWorkspaceFieldChangesDetailed,
  shouldBackfillLegacyLifeMapSync,
  withTimeout,
  workspaceHasUserContent,
  workspaceValuesEqual,
} from './workspaceSyncCore';
import { applyWorkspaceFields } from './workspaceOfflineQueue';
import {
  WORKSPACE_ENTITY_STORAGE_VERSION,
  WORKSPACE_WRITER_PROTOCOL_VERSION,
  buildWorkspaceEntityInitializationWrites,
  buildWorkspaceEntityWrites,
  materializeWorkspaceEntityRoot,
  workspaceFieldsMatchEntityProjection,
} from './workspaceEntityStorage';
import { saveWorkspaceDailyHistoryOnce } from './workspaceHistory';
import {
  beginWorkspaceSyncActivity,
  setWorkspaceSyncRuntimeOutcome,
  type WorkspaceSyncActivity,
  type WorkspaceSyncRuntimePhase,
} from './workspaceSyncRuntime';
import {
  buildWorkspaceAlternateRecords,
  persistWorkspaceAlternates,
  verifyWorkspaceAlternatesPersisted,
} from './workspaceAlternateHistory';
import {
  confirmTimelineBlocksRepair,
  createTimelineBlocksRepairPlan,
  executePreparedTimelineBlocksRepair,
  listPendingTimelineBlocksRepairUploads,
  prepareTimelineBlocksRepair,
  readTimelineBlocksRepairUpload,
  timelineBlocksNeedRepair,
  type TimelineBlocksRepairUpload,
} from './workspaceTimelineRepair';
export { buildUnifiedRoomId, hashWorkspaceBackup } from './workspaceSyncCore';
export {
  readWorkspaceSyncRuntimeState,
  WORKSPACE_SYNC_RUNTIME_EVENT,
  type WorkspaceSyncRuntimeState,
  type WorkspaceSyncRuntimePhase,
} from './workspaceSyncRuntime';

export type SyncArchitecture = 'legacy' | 'unified';

const MAX_QUEUE_FLUSH_RESTARTS = 8;
const WORKSPACE_VERIFICATION_INTERVAL_MS = 60_000;

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
  repairedFields: string[];
  warning?: string;
}

export interface UnifiedWorkspaceConnectionResult {
  roomId: string;
  applied: number;
  repairedFields: string[];
  warning?: string;
}

export type UnifiedWorkspaceConflictResolution = 'cloud' | 'local';

export class UnifiedWorkspaceConflictError extends Error {
  readonly code = 'workspace-content-conflict';

  constructor(
    readonly localSummary: WorkspaceBackupSummary,
    readonly remoteSummary: WorkspaceBackupSummary,
    readonly remoteSource: 'unified' | 'legacy' = 'unified',
  ) {
    const remoteLabel = remoteSource === 'legacy' ? '旧房间云端' : '云端';
    super(
      `本机和云端都已有不同数据，已阻止自动连接以避免覆盖。`
        + `本机：${localSummary.tasks} 个项目、${localSummary.lifeMapItems} 项人生规划、${localSummary.reviewTasks} 个复习轮次；`
        + `${remoteLabel}：${remoteSummary.tasks} 个项目、${remoteSummary.lifeMapItems} 项人生规划、${remoteSummary.reviewTasks} 个复习轮次。`
        + `请选择保留云端或保留本机；执行前会为双方创建可恢复快照。`,
    );
    this.name = 'UnifiedWorkspaceConflictError';
  }
}

interface WorkspaceAccountBinding {
  version: 1;
  roomCode: string;
  unifiedRoomId: string;
  updatedAt: string;
}

export interface PendingWorkspaceActivationConflict {
  roomCode: string;
  remoteSource: 'unified' | 'legacy';
  detectedAt: string;
}

const SETTINGS_KEY = 'smart-line-sync-architecture-v1';
const AUTO_DISCOVERY_PAUSED_KEY = 'smart-line-sync-auto-discovery-paused-v1';
const ACTIVATION_CONFLICT_KEY = 'smart-line-sync-activation-conflict-v1';
const EXPECTED_KEYS = [
  'tasks', 'groups', 'notes', 'milestones', 'lifeStages',
  ...LIFE_MAP_FIELDS,
  'reviewTasks', 'inboxItems', 'outlineNodes', 'ebbSettings',
  'schedules', 'retrospectives', 'nodes',
] as const;

function isJsonRecord(value: unknown): value is Record<string, Json> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function workspaceProtocolMetadata(metadata: Record<string, Json>): Record<string, Json> {
  return {
    ...metadata,
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    entityStorageVersion: WORKSPACE_ENTITY_STORAGE_VERSION,
    writerProtocolVersion: WORKSPACE_WRITER_PROTOCOL_VERSION,
    minimumWriterSchemaVersion: WORKSPACE_SCHEMA_VERSION,
  };
}
let queueListenerStarted = false;
let queueFlushTimer: number | null = null;
let queueFlushInFlight: Promise<{ applied: number; conflict: boolean }> | null = null;
let workspaceVerificationTimer: number | null = null;
let workspaceVerificationInFlight: Promise<'connected' | 'pending' | 'conflict'> | null = null;
let workspaceVerificationRoomId: string | null = null;
let workspaceConnectionOperation: Promise<unknown> | null = null;
let workspaceConnectionActivity: WorkspaceSyncActivity | null = null;
export const WORKSPACE_CONFLICT_EVENT = 'smartline:workspace-conflict';
export const WORKSPACE_VERIFIED_EVENT = 'smartline:workspace-verified';

export function readPendingWorkspaceActivationConflict(): PendingWorkspaceActivationConflict | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVATION_CONFLICT_KEY) ?? 'null') as Partial<PendingWorkspaceActivationConflict> | null;
    return value
      && typeof value.roomCode === 'string'
      && (value.remoteSource === 'unified' || value.remoteSource === 'legacy')
      && typeof value.detectedAt === 'string'
      ? value as PendingWorkspaceActivationConflict
      : null;
  } catch {
    return null;
  }
}

export function clearPendingWorkspaceActivationConflict(): void {
  localStorage.removeItem(ACTIVATION_CONFLICT_KEY);
}

function recordPendingWorkspaceActivationConflict(
  roomCode: string,
  remoteSource: 'unified' | 'legacy',
): void {
  localStorage.setItem(ACTIVATION_CONFLICT_KEY, JSON.stringify({
    roomCode,
    remoteSource,
    detectedAt: new Date().toISOString(),
  } satisfies PendingWorkspaceActivationConflict));
}

export function isWorkspaceConnectionInProgress(): boolean {
  return workspaceConnectionOperation !== null;
}

function reportWorkspaceConnectionProgress(
  message: string,
  phase: WorkspaceSyncRuntimePhase = 'connecting',
): void {
  workspaceConnectionActivity?.update(phase, message);
}

function runWorkspaceConnectionOperation<T>(
  operation: () => Promise<T>,
  phase: WorkspaceSyncRuntimePhase = 'connecting',
  message = '正在连接统一工作区…',
): Promise<T> {
  if (workspaceConnectionOperation) {
    return Promise.reject(new Error('已有工作区连接任务正在进行，请等待当前任务完成后再试。'));
  }
  const activity = beginWorkspaceSyncActivity(phase, message);
  workspaceConnectionActivity = activity;
  // Defer invocation until the activity is registered. Several async flows
  // report progress before their first await; invoking immediately used to
  // lose that first state update.
  const current = Promise.resolve().then(operation);
  workspaceConnectionOperation = current;
  current.then(
    () => {
      if (workspaceConnectionOperation === current) {
        workspaceConnectionOperation = null;
        workspaceConnectionActivity = null;
        activity.finish('connected', '统一工作区已连接并完成校验。');
      }
    },
    (error) => {
      if (workspaceConnectionOperation === current) {
        workspaceConnectionOperation = null;
        workspaceConnectionActivity = null;
        activity.fail(error);
      }
    },
  );
  return current;
}

async function captureWorkspaceMutationsDuring<T>(operation: () => Promise<T>): Promise<T> {
  setWorkspaceConnectionMutationCapture(true);
  try {
    return await operation();
  } finally {
    setWorkspaceConnectionMutationCapture(false);
  }
}

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
  if (settings.architecture === 'unified') localStorage.removeItem(AUTO_DISCOVERY_PAUSED_KEY);
  if (settings.architecture === 'unified') clearPendingWorkspaceActivationConflict();
}

function enableAll(code: string): void {
  useTimelineStore.getState().enableSync(code);
  useEbbStore.getState().enableSync(code);
  useDailyScheduleStore.getState().enableSync(code);
  useGraphStore.getState().enableSync(code);
  useLifeMapStore.getState().enableSync(code);
}

function enterOrReconnectUnifiedRoom(
  liveblocks: {
    room?: { id: string; getStatus: () => string; reconnect: () => void } | null;
    enterRoom?: (roomId: string) => void;
  } | undefined,
  roomId: string,
): void {
  const currentRoom = liveblocks?.room;
  const currentStatus = currentRoom?.getStatus();
  if (
    currentRoom?.id === roomId
    && (currentStatus === 'initial' || currentStatus === 'disconnected')
  ) {
    currentRoom.reconnect();
    return;
  }
  liveblocks?.enterRoom?.(roomId);
}

function waitForRoomConnected(
  room: { getStatus: () => string; reconnect?: () => void },
  timeoutMs = 15_000,
): Promise<void> {
  if (room.getStatus() === 'connected') return Promise.resolve();
  const status = room.getStatus();
  if (status === 'initial' || status === 'disconnected') room.reconnect?.();
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (room.getStatus() === 'connected') {
        window.clearInterval(timer);
        resolve();
      } else if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error('连接云端工作区超时，请检查网络后重试。'));
      }
    }, 100);
  });
}

async function waitForRoomSnapshot(
  room: { getStorage: () => Promise<{ root: { toJSON: () => unknown } }> },
  expected: Record<string, unknown>,
  fields: readonly string[],
  timeoutMs = 15_000,
): Promise<void> {
  const { root } = await room.getStorage();
  const startedAt = Date.now();
  while (hasWorkspaceFieldSnapshotChanged(
    expected,
    materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>),
    fields,
  )) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error('本机云端缓存尚未追平最新工作区，已保留待传修改，请稍后重试。');
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

export function disconnectWorkspace(disable = false): void {
  stopWorkspaceVerificationMonitor();
  setWorkspaceSyncRuntimeOutcome('idle', disable ? '同步已关闭。' : '工作区已断开。');
  const stores = [useTimelineStore.getState(), useEbbStore.getState(), useDailyScheduleStore.getState(), useGraphStore.getState(), useLifeMapStore.getState()];
  stores.forEach((store) => store.liveblocks?.leaveRoom?.());
  if (disable) {
    stores.forEach((store) => store.disableSync());
    localStorage.removeItem(SETTINGS_KEY);
    localStorage.setItem(AUTO_DISCOVERY_PAUSED_KEY, 'true');
    clearPendingWorkspaceActivationConflict();
  }
}

export function connectLegacyWorkspace(fallbackCode?: string): void {
  stopWorkspaceVerificationMonitor();
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
  stopWorkspaceVerificationMonitor();
  setWorkspaceQueueSuppressed(true);
  try {
    reportWorkspaceConnectionProgress('正在建立统一工作区连接…', 'connecting');
    enableAll(roomCode);
    enterOrReconnectUnifiedRoom(useTimelineStore.getState().liveblocks, targetRoomId);
    enterOrReconnectUnifiedRoom(useEbbStore.getState().liveblocks, targetRoomId);
    enterOrReconnectUnifiedRoom(useDailyScheduleStore.getState().liveblocks, targetRoomId);
    enterOrReconnectUnifiedRoom(useGraphStore.getState().liveblocks, targetRoomId);
    enterOrReconnectUnifiedRoom(useLifeMapStore.getState().liveblocks, targetRoomId);
    ensureQueueListener();

    await waitForUnifiedStorage(targetRoomId);
    const connectedRoom = useTimelineStore.getState().liveblocks?.room;
    if (!connectedRoom || connectedRoom.id !== targetRoomId) {
      throw new Error('统一工作区连接已切换，无法补传本机修改。');
    }
    // An explicitly disconnected Room keeps a resolved getStorage() cache.
    // Do not merge the durable queue over that cache until Liveblocks has
    // completed the reconnect handshake and synchronized its storage state.
    await waitForRoomStorageSynchronized(connectedRoom);
    const authoritativeRoot = await inspectRoom(targetRoomId, '统一工作区最新快照');
    await waitForRoomSnapshot(connectedRoom, authoritativeRoot, EXPECTED_KEYS);
    reportWorkspaceConnectionProgress('云端已连接，正在补传本机离线修改…', 'flushing');
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
    reportWorkspaceConnectionProgress('补传已确认，正在校验五个数据域的一致性…', 'verifying');
    const repairedFields = await ensureUnifiedWorkspaceConvergence(targetRoomId);
    recordWorkspaceVerification(targetRoomId, repairedFields);
    startWorkspaceVerificationMonitor(targetRoomId);
    window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
    return { roomId: targetRoomId, applied: flushed.applied, repairedFields };
  } finally {
    window.setTimeout(() => setWorkspaceQueueSuppressed(false), 0);
  }
}

export async function activateUnifiedWorkspace(roomCode: string, identity: string): Promise<UnifiedWorkspaceConnectionResult> {
  return await activateUnifiedWorkspaceSafely(roomCode, identity);
}

async function reconnectConfiguredWorkspaceInternal(
  identity?: string,
  historicalIdentity?: string,
): Promise<UnifiedWorkspaceConnectionResult | null> {
  const settings = readWorkspaceSyncSettings();
  const anyEnabled = [useTimelineStore, useEbbStore, useDailyScheduleStore, useGraphStore, useLifeMapStore]
    .some((store) => store.getState().syncEnabled);
  if (anyEnabled && settings.architecture === 'unified' && settings.unifiedRoomId) {
    const root = await inspectRoom(settings.unifiedRoomId, '统一工作区');
    assertWorkspaceSchemaSupported(root, WORKSPACE_SCHEMA_VERSION);
    await initializeUnifiedRoomBeforeConnect(
      settings.unifiedRoomId,
      rootToBackup(root, createWorkspaceBackup()),
      root,
      false,
    );
    const connected = await connectUnifiedWorkspace(settings.roomCode, settings.unifiedRoomId);
    const warning = identity
      ? await tryWriteWorkspaceAccountBinding(identity, { roomCode: settings.roomCode, unifiedRoomId: settings.unifiedRoomId })
      : undefined;
    return { ...connected, warning };
  }
  if (anyEnabled) {
    if (identity && settings.architecture === 'legacy') {
      let binding: WorkspaceAccountBinding | null = null;
      try {
        binding = await readWorkspaceAccountBinding(identity, historicalIdentity);
      } catch (error) {
        reportWorkspaceConnectionProgress(
          `暂时无法检查账号统一工作区，已继续连接旧房间：${error instanceof Error ? error.message : '未知错误'}`,
        );
      }
      if (binding) {
        return await activateUnifiedWorkspaceSafelyInternal(binding.roomCode, identity, historicalIdentity);
      }
    }
    connectLegacyWorkspace(settings.roomCode);
    return null;
  }

  // A deliberate temporary disconnect keeps the unified binding but disables
  // every module. Re-enable it safely on startup instead of treating the device
  // as permanently unconfigured.
  if (settings.architecture === 'unified' && settings.unifiedRoomId && identity) {
    return await activateUnifiedWorkspaceSafelyInternal(settings.roomCode, identity, historicalIdentity);
  }
  if (!identity) return null;
  if (localStorage.getItem(AUTO_DISCOVERY_PAUSED_KEY) === 'true') return null;

  // The account binding lives in a small owner-scoped Liveblocks room, so a new
  // browser can discover its workspace after GitHub login without copying
  // per-device localStorage settings.
  const binding = await readWorkspaceAccountBinding(identity, historicalIdentity);
  if (!binding) return null;
  return await activateUnifiedWorkspaceSafelyInternal(binding.roomCode, identity, historicalIdentity);
}

export function reconnectConfiguredWorkspace(
  identity?: string,
  historicalIdentity?: string,
): Promise<UnifiedWorkspaceConnectionResult | null> {
  return runWorkspaceConnectionOperation(() => captureWorkspaceMutationsDuring(
    () => reconnectConfiguredWorkspaceInternal(identity, historicalIdentity),
  ));
}

function rootToBackup(root: Record<string, unknown>, base: WorkspaceBackup): WorkspaceBackup {
  const rawTasks = Array.isArray(root.tasks) ? root.tasks : [];
  const rawGroups = Array.isArray(root.groups) ? root.groups : [];
  const structuralErrors: string[] = [];
  const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
  );
  rawTasks.forEach((task, index) => {
    if (!isRecord(task)) structuralErrors.push(`tasks[${index}] 不是对象`);
    else {
      if (typeof task.id !== 'string' || !task.id) structuralErrors.push(`tasks[${index}].id 缺失`);
      if (typeof task.name !== 'string') structuralErrors.push(`tasks[${index}].name 缺失`);
    }
  });
  const rawTaskById = new Map<string, Record<string, unknown>>();
  rawTasks.forEach((task) => {
    if (isRecord(task) && typeof task.id === 'string' && task.id) rawTaskById.set(task.id, task);
  });
  const recoverableGroups = rawGroups.map((group, groupIndex) => {
    if (!isRecord(group)) {
      structuralErrors.push(`groups[${groupIndex}] 不是对象`);
      return group;
    }
    if (typeof group.id !== 'string' || !group.id) structuralErrors.push(`groups[${groupIndex}].id 缺失`);
    if (typeof group.name !== 'string') structuralErrors.push(`groups[${groupIndex}].name 缺失`);
    const children = (Array.isArray(group.children) ? group.children : []).map((task, taskIndex) => {
      if (!isRecord(task)) {
        structuralErrors.push(`groups[${groupIndex}].children[${taskIndex}] 不是对象`);
        return task;
      }
      const canonical = typeof task.id === 'string' ? rawTaskById.get(task.id) : undefined;
      if (canonical) return canonical;
      if (typeof task.id !== 'string' || !task.id) structuralErrors.push(`groups[${groupIndex}].children[${taskIndex}].id 缺失`);
      if (typeof task.name !== 'string') structuralErrors.push(`groups[${groupIndex}].children[${taskIndex}].name 缺失`);
      return task;
    });
    return { ...group, children };
  });
  if (structuralErrors.length > 0) {
    throw new Error(`云端项目数据存在无法自动修复的结构问题：${structuralErrors.slice(0, 5).join('；')}`);
  }
  const normalizedTimeline = normalizeTimelineData({
    tasks: rawTasks,
    groups: recoverableGroups,
    notes: [],
    milestones: [],
    lifeStages: [],
  });
  const normalizedEbb = normalizeEbbData({
    reviewTasks: Array.isArray(root.reviewTasks) ? root.reviewTasks : [],
    inboxItems: Array.isArray(root.inboxItems) ? root.inboxItems : [],
    outlineNodes: Array.isArray(root.outlineNodes) ? root.outlineNodes : [],
    ebbSettings: root.ebbSettings && typeof root.ebbSettings === 'object'
      ? root.ebbSettings as WorkspaceBackup['ebb']['ebbSettings']
      : base.ebb.ebbSettings,
  });
  return {
    ...base,
    timeline: {
      tasks: normalizedTimeline.tasks,
      groups: normalizedTimeline.groups,
      notes: Array.isArray(root.notes) ? root.notes as WorkspaceBackup['timeline']['notes'] : [],
      milestones: Array.isArray(root.milestones) ? root.milestones as WorkspaceBackup['timeline']['milestones'] : [],
      lifeStages: Array.isArray(root.lifeStages) ? root.lifeStages as WorkspaceBackup['timeline']['lifeStages'] : [],
    },
    ebb: normalizedEbb,
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
  const { room, leave } = createLiveblocksClient().enterRoom(roomId, { initialPresence: {} });
  try {
    // getStorage() remains resolved while an existing Room is disconnected and
    // would otherwise expose its stale pre-disconnect cache as "cloud" data.
    await waitForRoomConnected(room);
    const { root } = await withTimeout(
      room.getStorage(),
      15_000,
      `读取${label}超时。请检查网络、登录状态和 Liveblocks Secret Key 后重试。`,
    );
    await waitForRoomStorageSynchronized(room);
    return materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
  } finally {
    leave();
  }
}

function parseWorkspaceAccountBinding(
  value: unknown,
  identity: string,
  historicalIdentity?: string,
): WorkspaceAccountBinding | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.version !== 1
    || typeof record.roomCode !== 'string'
    || typeof record.unifiedRoomId !== 'string'
    || typeof record.updatedAt !== 'string') return null;
  const allowedRoomIds = buildUnifiedRoomCandidates(record.roomCode, identity, historicalIdentity);
  if (!allowedRoomIds.includes(record.unifiedRoomId)) return null;
  return record as unknown as WorkspaceAccountBinding;
}

async function readWorkspaceAccountBinding(
  identity: string,
  historicalIdentity?: string,
): Promise<WorkspaceAccountBinding | null> {
  // The stable GitHub-id room is authoritative. A stale historical-login
  // binding must not permanently block auto-connect after the stable binding
  // has been written by a newer client.
  const primaryRoot = await inspectRoom(buildWorkspaceBindingRoomId(identity), '账号工作区绑定');
  const primary = parseWorkspaceAccountBinding(primaryRoot.workspaceBinding, identity, historicalIdentity);
  if (primary) return primary;

  if (!historicalIdentity || buildWorkspaceBindingRoomId(historicalIdentity) === buildWorkspaceBindingRoomId(identity)) {
    return null;
  }
  const historicalRoot = await inspectRoom(buildWorkspaceBindingRoomId(historicalIdentity), '历史账号工作区绑定');
  return parseWorkspaceAccountBinding(historicalRoot.workspaceBinding, identity, historicalIdentity);
}

async function writeWorkspaceAccountBinding(
  identity: string,
  binding: Omit<WorkspaceAccountBinding, 'version' | 'updatedAt'>,
): Promise<void> {
  const roomId = buildWorkspaceBindingRoomId(identity);
  const { room, leave } = createLiveblocksClient().enterRoom(roomId, { initialPresence: {} });
  try {
    const { root } = await withTimeout(
      room.getStorage(),
      15_000,
      '保存账号工作区绑定超时，请检查网络后重试。',
    );
    root.set('workspaceBinding', {
      version: 1,
      ...binding,
      updatedAt: new Date().toISOString(),
    } as Json);
    await waitForRoomStorageSynchronized(room);
  } finally {
    leave();
  }
}

async function tryWriteWorkspaceAccountBinding(
  identity: string,
  binding: Omit<WorkspaceAccountBinding, 'version' | 'updatedAt'>,
): Promise<string | undefined> {
  try {
    await writeWorkspaceAccountBinding(identity, binding);
    return undefined;
  } catch (error) {
    const detail = error instanceof Error ? error.message : '未知错误';
    const warning = `数据同步已经完成，但账号自动发现绑定保存失败：${detail} 下次重连会自动重试；其他设备仍可手动输入同一房间号。`;
    reportWorkspaceConnectionProgress(warning);
    return warning;
  }
}

interface InspectedUnifiedWorkspaceTarget {
  roomId: string;
  root: Record<string, unknown>;
  hasStorage: boolean;
}

async function inspectUnifiedWorkspaceTarget(
  roomCode: string,
  identity: string,
  historicalIdentity: string | undefined,
  local: WorkspaceBackup,
): Promise<InspectedUnifiedWorkspaceTarget> {
  const candidates = buildUnifiedRoomCandidates(roomCode, identity, historicalIdentity);
  const candidateRoots = await Promise.all(candidates.map((roomId, index) =>
    inspectRoom(roomId, index === 0 ? '统一工作区' : '历史统一工作区'),
  ));
  const candidateHasStorage = candidateRoots.map((root) => EXPECTED_KEYS.some((key) => root[key] !== undefined));
  let selectedIndex = candidateHasStorage[0] ? 0 : candidateHasStorage.findIndex(Boolean);
  if (selectedIndex < 0) selectedIndex = 0;

  const populatedIndexes = candidateHasStorage
    .map((hasStorage, index) => hasStorage ? index : -1)
    .filter((index) => index >= 0);
  if (populatedIndexes.length > 1) {
    const hashes = await Promise.all(populatedIndexes.map((index) =>
      hashWorkspaceBackup(rootToBackup(candidateRoots[index], local)),
    ));
    if (new Set(hashes).size > 1) {
      throw new Error('检测到 GitHub ID 房间和历史用户名房间同时存在不同数据，已阻止自动连接。请先导出两端备份后再合并。');
    }
    selectedIndex = 0;
  }

  return {
    roomId: candidates[selectedIndex],
    root: candidateRoots[selectedIndex],
    hasStorage: candidateHasStorage[selectedIndex],
  };
}

export function normalizeWorkspaceBackupForMigrationComparison(backup: WorkspaceBackup): WorkspaceBackup {
  return rootToBackup(workspaceRootFromBackup(backup), backup);
}

/**
 * First-time unified activation is deliberately fail-closed.  Empty devices
 * may join an existing cloud workspace and equal workspaces may reconnect, but
 * two different non-empty workspaces are never silently overlaid.
 */
async function activateUnifiedWorkspaceSafelyInternal(
  roomCode: string,
  identity: string,
  historicalIdentity?: string,
): Promise<UnifiedWorkspaceActivationResult> {
  reportWorkspaceConnectionProgress('正在读取本机工作区并创建安全快照…');
  const local = createWorkspaceBackup();
  await createLocalSnapshot('首次连接统一工作区前');
  reportWorkspaceConnectionProgress('安全快照已完成，正在查找账号对应的云端工作区…');
  const target = await inspectUnifiedWorkspaceTarget(roomCode, identity, historicalIdentity, local);
  const targetRoomId = target.roomId;
  const remoteRoot = target.root;
  assertWorkspaceSchemaSupported(remoteRoot, WORKSPACE_SCHEMA_VERSION);
  const hasRemoteStorage = target.hasStorage;

  reportWorkspaceConnectionProgress('已读取云端数据，正在修复旧格式并比较本机内容…');
  const remote = rootToBackup(remoteRoot, local);
  const [localHash, remoteHash] = await Promise.all([
    hashWorkspaceBackup(local),
    hashWorkspaceBackup(remote),
  ]);
  const [localSummary, remoteSummary] = [summaryOf(local), summaryOf(remote)];
  // A newly opened device contains only product samples until it downloads the
  // workspace. Count that state as empty so it can safely adopt cloud data.
  const localDecisionSummary = isBundledDemoWorkspace(local)
    ? { ...localSummary, tasks: 0, groups: 0, lifeStages: 0, lifeMapItems: 0, reviewTasks: 0, dailyDays: 0, retrospectiveDays: 0, graphNodes: 0 }
    : localSummary;
  const decision = decideUnifiedWorkspaceActivation(hasRemoteStorage, localHash, remoteHash, localDecisionSummary, remoteSummary);
  if (decision !== 'conflict') {
    await initializeUnifiedRoomBeforeConnect(
      targetRoomId,
      decision === 'new' ? local : remote,
      remoteRoot,
      decision === 'new',
    );
    writeWorkspaceSyncSettings({ architecture: 'unified', roomCode, unifiedRoomId: targetRoomId });
    const connected = await connectUnifiedWorkspace(roomCode, targetRoomId);
    reportWorkspaceConnectionProgress('数据已一致，正在保存账号工作区绑定…');
    const warning = await tryWriteWorkspaceAccountBinding(identity, { roomCode, unifiedRoomId: targetRoomId });
    if (!warning) reportWorkspaceConnectionProgress('统一工作区连接及完整校验均已完成。');
    return {
      roomId: connected.roomId,
      source: decision,
      applied: connected.applied,
      repairedFields: connected.repairedFields,
      warning,
    };
  }

  recordPendingWorkspaceActivationConflict(roomCode, 'unified');
  throw new UnifiedWorkspaceConflictError(localSummary, remoteSummary);
}

export function activateUnifiedWorkspaceSafely(
  roomCode: string,
  identity: string,
  historicalIdentity?: string,
): Promise<UnifiedWorkspaceActivationResult> {
  return runWorkspaceConnectionOperation(() => captureWorkspaceMutationsDuring(
    () => activateUnifiedWorkspaceSafelyInternal(roomCode, identity, historicalIdentity),
  ));
}

async function activateWorkspaceWithLegacyDiscoveryInternal(
  roomCode: string,
  identity: string,
  historicalIdentity?: string,
): Promise<UnifiedWorkspaceActivationResult> {
  const local = createWorkspaceBackup();
  reportWorkspaceConnectionProgress('正在检查统一工作区及旧版五个云端房间…');
  const unifiedTarget = await inspectUnifiedWorkspaceTarget(roomCode, identity, historicalIdentity, local);
  if (unifiedTarget.hasStorage) {
    return await activateUnifiedWorkspaceSafelyInternal(roomCode, identity, historicalIdentity);
  }

  // A new browser has no per-device legacy flags. Probe the old five-room
  // layout before creating an empty unified room, otherwise the new device can
  // accidentally strand the tablet's existing data in the legacy rooms.
  const legacy = await inspectLegacyWorkspaceWithBase(roomCode, createEmptyWorkspaceBase());
  if (!workspaceHasUserContent(legacy.summary)) {
    return await activateUnifiedWorkspaceSafelyInternal(roomCode, identity, historicalIdentity);
  }

  const [localHash, localSummary] = await Promise.all([
    hashWorkspaceBackup(local),
    Promise.resolve(summaryOf(local)),
  ]);
  const localDecisionSummary = isBundledDemoWorkspace(local)
    ? { ...localSummary, tasks: 0, groups: 0, lifeStages: 0, lifeMapItems: 0, reviewTasks: 0, dailyDays: 0, retrospectiveDays: 0, graphNodes: 0 }
    : localSummary;
  const discoveryDecision = decideLegacyWorkspaceDiscovery(
    false,
    true,
    localHash,
    legacy.hash,
    localDecisionSummary,
  );
  if (discoveryDecision === 'conflict') {
    recordPendingWorkspaceActivationConflict(roomCode, 'legacy');
    throw new UnifiedWorkspaceConflictError(localSummary, legacy.summary, 'legacy');
  }

  const pendingBeforeAdoption = await readPendingWorkspaceSync();
  await createWorkspaceSnapshot(legacy.backup, '首次连接时发现的旧房间云端副本');
  if (discoveryDecision === 'legacy-cloud') {
    reportWorkspaceConnectionProgress('已发现旧房间数据，正在安全加载并迁移到统一工作区…');
    setWorkspaceQueueSuppressed(true);
    try {
      await restoreWorkspaceBackup(legacy.backup, { suppressSyncJournal: true });
      if (pendingBeforeAdoption) await clearPendingWorkspaceSync(pendingBeforeAdoption);
    } finally {
      setWorkspaceQueueSuppressed(false);
    }
  }
  const migration = await migrateLegacyWorkspaceInternal(roomCode, identity);
  reportWorkspaceConnectionProgress('旧房间数据已迁移，统一工作区连接和校验均已完成。');
  return {
    roomId: migration.targetRoomId,
    source: discoveryDecision === 'legacy-matching' ? 'matching' : 'cloud',
    applied: 0,
    repairedFields: [],
  };
}

export function activateWorkspaceWithLegacyDiscovery(
  roomCode: string,
  identity: string,
  historicalIdentity?: string,
): Promise<UnifiedWorkspaceActivationResult> {
  return runWorkspaceConnectionOperation(() => captureWorkspaceMutationsDuring(
    () => activateWorkspaceWithLegacyDiscoveryInternal(roomCode, identity, historicalIdentity),
  ));
}

async function overwriteUnifiedRoomFromBackup(
  roomId: string,
  backup: WorkspaceBackup,
): Promise<void> {
  const { room, leave } = createLiveblocksClient().enterRoom(roomId, { initialPresence: {} });
  try {
    const { root } = await withTimeout(
      room.getStorage(),
      15_000,
      '连接云端工作区超时，请检查网络后重试。',
    );
    const fields = workspaceRootFromBackup(backup);
    const currentRoot = materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
    const writeId = crypto.randomUUID();
    const entityWrites = buildWorkspaceEntityWrites(currentRoot, fields, writeId);
    const metadata = isJsonRecord(currentRoot.metadata) ? currentRoot.metadata : {};
    room.batch(() => {
      for (const [key, value] of Object.entries(fields)) root.set(key, value as Json);
      for (const [key, value] of Object.entries(entityWrites)) root.set(key, value as unknown as Json);
      root.set('metadata', workspaceProtocolMetadata(metadata));
    });
    await waitForRoomStorageSynchronized(room);
  } finally {
    leave();
  }
}

async function initializeUnifiedRoomBeforeConnect(
  roomId: string,
  backup: WorkspaceBackup,
  inspectedRoot: Record<string, unknown>,
  overwriteExisting: boolean,
): Promise<void> {
  reportWorkspaceConnectionProgress('正在确认云端工作区结构和初始化状态…', 'initializing');
  const { room, leave } = createLiveblocksClient().enterRoom(roomId, { initialPresence: {} });
  try {
    const { root } = await withTimeout(
      room.getStorage(),
      15_000,
      '初始化统一工作区超时，请检查网络后重试。',
    );
    const rawCurrentRoot = root.toJSON() as Record<string, unknown>;
    const currentRoot = materializeWorkspaceEntityRoot(rawCurrentRoot);
    assertWorkspaceSchemaSupported(currentRoot, WORKSPACE_SCHEMA_VERSION);
    if (hasWorkspaceFieldSnapshotChanged(
      inspectedRoot,
      currentRoot,
      [...EXPECTED_KEYS, 'metadata'],
    )) {
      throw new Error('统一工作区在初始化期间发生变化，已停止连接以避免覆盖，请重试。');
    }
    const initializationFields = buildWorkspaceInitializationFields(
      currentRoot,
      workspaceRootFromBackup(backup),
      overwriteExisting,
    );
    const currentMetadata = isJsonRecord(currentRoot.metadata) ? currentRoot.metadata : {};
    const expectedRoot = { ...currentRoot, ...initializationFields };
    const needsEntityInitialization = currentMetadata.entityStorageVersion !== WORKSPACE_ENTITY_STORAGE_VERSION;
    const entityWrites = needsEntityInitialization
      ? buildWorkspaceEntityInitializationWrites(
        Object.fromEntries(EXPECTED_KEYS.map((key) => [key, expectedRoot[key]])),
        crypto.randomUUID(),
      )
      : {};
    if (Object.keys(initializationFields).length === 0
      && !needsEntityInitialization
      && currentMetadata.schemaVersion === WORKSPACE_SCHEMA_VERSION
      && currentMetadata.writerProtocolVersion === WORKSPACE_WRITER_PROTOCOL_VERSION) return;
    room.batch(() => {
      for (const [key, value] of Object.entries(initializationFields)) root.set(key, value as Json);
      for (const [key, value] of Object.entries(entityWrites)) root.set(key, value as unknown as Json);
      root.set('metadata', workspaceProtocolMetadata(currentMetadata));
    });
    await waitForRoomStorageSynchronized(room);
    const confirmedRoot = materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
    if (EXPECTED_KEYS.some((key) => confirmedRoot[key] === undefined)
      || hasWorkspaceFieldSnapshotChanged(expectedRoot, confirmedRoot, EXPECTED_KEYS)) {
      throw new Error('统一工作区初始化确认失败，已停止连接以避免覆盖，请重试。');
    }
  } finally {
    leave();
  }
}

async function resolveLegacyWorkspaceConflictInternal(
  roomCode: string,
  identity: string,
  resolution: UnifiedWorkspaceConflictResolution,
  historicalIdentity?: string,
): Promise<UnifiedWorkspaceConnectionResult> {
  const local = createWorkspaceBackup();
  const localSummary = summaryOf(local);
  const legacy = await inspectLegacyWorkspaceWithBase(roomCode, createEmptyWorkspaceBase());
  if (!workspaceHasUserContent(legacy.summary)) {
    throw new Error('旧房间当前已没有可迁移内容，请重新执行普通连接。');
  }
  const pendingBeforeResolution = await readPendingWorkspaceSync();

  if (resolution === 'cloud') {
    await createWorkspaceSnapshot(legacy.backup, '采用旧房间云端数据前保存的副本');
    reportWorkspaceConnectionProgress('旧房间数据已保存，正在恢复本机并迁移到统一工作区…');
    setWorkspaceQueueSuppressed(true);
    try {
      await restoreWorkspaceBackup(legacy.backup, { suppressSyncJournal: true });
      if (pendingBeforeResolution) await clearPendingWorkspaceSync(pendingBeforeResolution);
    } finally {
      setWorkspaceQueueSuppressed(false);
    }
    const migration = await migrateLegacyWorkspaceInternal(roomCode, identity);
    return { roomId: migration.targetRoomId, applied: 0, repairedFields: [] };
  }

  await Promise.all([
    createLocalSnapshot('选择本机数据并保留旧房间前'),
    createWorkspaceSnapshot(legacy.backup, '被本机统一工作区取代前的旧房间副本'),
  ]);
  const target = await inspectUnifiedWorkspaceTarget(roomCode, identity, historicalIdentity, local);
  if (target.hasStorage) {
    const currentUnified = rootToBackup(target.root, local);
    const [localHash, unifiedHash] = await Promise.all([
      hashWorkspaceBackup(local),
      hashWorkspaceBackup(currentUnified),
    ]);
    if (localHash !== unifiedHash) {
      recordPendingWorkspaceActivationConflict(roomCode, 'unified');
      throw new UnifiedWorkspaceConflictError(localSummary, summaryOf(currentUnified));
    }
  } else {
    await overwriteUnifiedRoomFromBackup(target.roomId, local);
  }
  if (pendingBeforeResolution) await clearPendingWorkspaceSync(pendingBeforeResolution);
  writeWorkspaceSyncSettings({ architecture: 'unified', roomCode, unifiedRoomId: target.roomId });
  const connected = await connectUnifiedWorkspace(roomCode, target.roomId);
  const warning = await tryWriteWorkspaceAccountBinding(identity, { roomCode, unifiedRoomId: target.roomId });
  return { ...connected, warning };
}

async function resolveUnifiedWorkspaceConflictInternal(
  roomCode: string,
  identity: string,
  resolution: UnifiedWorkspaceConflictResolution,
  historicalIdentity?: string,
  remoteSource: 'unified' | 'legacy' = 'unified',
): Promise<UnifiedWorkspaceConnectionResult> {
  if (remoteSource === 'legacy') {
    return await resolveLegacyWorkspaceConflictInternal(roomCode, identity, resolution, historicalIdentity);
  }
  reportWorkspaceConnectionProgress('正在重新读取双方数据并创建冲突恢复点…');
  const local = normalizeWorkspaceBackupForMigrationComparison(createWorkspaceBackup());
  const target = await inspectUnifiedWorkspaceTarget(roomCode, identity, historicalIdentity, local);
  if (!target.hasStorage) throw new Error('云端工作区为空，不需要执行冲突覆盖。请直接重新连接。');
  assertWorkspaceSchemaSupported(target.root, WORKSPACE_SCHEMA_VERSION);
  const remote = rootToBackup(target.root, local);
  summaryOf(remote);
  const pendingBeforeResolution = await readPendingWorkspaceSync();

  if (resolution === 'cloud') {
    await createWorkspaceSnapshot(remote, '冲突处理时读取的云端工作区副本');
    reportWorkspaceConnectionProgress('已保存云端副本，正在用云端数据恢复本机…');
    setWorkspaceQueueSuppressed(true);
    try {
      // restoreWorkspaceBackup creates a second checkpoint containing the
      // pre-resolution local workspace, so either side remains recoverable.
      await restoreWorkspaceBackup(remote, { suppressSyncJournal: true });
      if (pendingBeforeResolution) await clearPendingWorkspaceSync(pendingBeforeResolution);
    } finally {
      setWorkspaceQueueSuppressed(false);
    }
  } else {
    await Promise.all([
      createLocalSnapshot('以本机数据覆盖云端前'),
      createWorkspaceSnapshot(remote, '被本机数据替换前的云端工作区副本'),
    ]);
    reportWorkspaceConnectionProgress('双方恢复点已保存，正在用本机数据更新云端…');
    await overwriteUnifiedRoomFromBackup(target.roomId, local);
    if (pendingBeforeResolution) await clearPendingWorkspaceSync(pendingBeforeResolution);
  }

  writeWorkspaceSyncSettings({ architecture: 'unified', roomCode, unifiedRoomId: target.roomId });
  const connected = await connectUnifiedWorkspace(roomCode, target.roomId);
  reportWorkspaceConnectionProgress('正在保存账号工作区绑定…');
  const warning = await tryWriteWorkspaceAccountBinding(identity, { roomCode, unifiedRoomId: target.roomId });
  if (!warning) reportWorkspaceConnectionProgress('冲突方向已确认，五个数据域已重新连接并校验完成。');
  return { ...connected, warning };
}

export function resolveUnifiedWorkspaceConflict(
  roomCode: string,
  identity: string,
  resolution: UnifiedWorkspaceConflictResolution,
  historicalIdentity?: string,
  remoteSource: 'unified' | 'legacy' = 'unified',
): Promise<UnifiedWorkspaceConnectionResult> {
  return runWorkspaceConnectionOperation(() => captureWorkspaceMutationsDuring(
    () => resolveUnifiedWorkspaceConflictInternal(roomCode, identity, resolution, historicalIdentity, remoteSource),
  ));
}

interface LegacyWorkspaceInspection {
  backup: WorkspaceBackup;
  summary: WorkspaceBackupSummary;
  hash: string;
}

function createEmptyWorkspaceBase(): WorkspaceBackup {
  const base = createWorkspaceBackup();
  return {
    ...base,
    timeline: { tasks: [], groups: [], notes: [], milestones: [], lifeStages: [] },
    lifeMap: normalizeLifeMapData({}),
    ebb: {
      reviewTasks: [],
      inboxItems: [],
      outlineNodes: [],
      ebbSettings: base.ebb.ebbSettings,
    },
    daily: { schedules: {}, retrospectives: {} },
    graph: { nodes: [] },
  };
}

async function inspectLegacyWorkspaceWithBase(
  roomCode: string,
  base: WorkspaceBackup,
): Promise<LegacyWorkspaceInspection> {
  const roomIds = [roomCode, `${EBB_ROOM_PREFIX}${roomCode}`, `${DAILY_ROOM_PREFIX}${roomCode}`, `graph-${roomCode}`, `${LIFE_MAP_ROOM_PREFIX}${roomCode}`];
  const labels = ['旧时间轴房间', '旧 EBB 房间', '旧每日安排房间', '旧知识大盘房间'];
  const [timeline, ebb, daily, graph, lifeMap] = await Promise.all(roomIds.map((roomId, index) => inspectRoom(roomId, labels[index] ?? '旧人生地图房间')));
  const backup = rootToBackup({ ...timeline, ...ebb, ...daily, ...graph, ...lifeMap }, base);
  return { backup, summary: summaryOf(backup), hash: await hashWorkspaceBackup(backup) };
}

export async function inspectLegacyWorkspace(roomCode: string): Promise<LegacyWorkspaceInspection> {
  return await inspectLegacyWorkspaceWithBase(roomCode, createWorkspaceBackup());
}

function waitForUnifiedStorage(targetRoomId: string, timeoutMs = 20_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const evaluate = () => {
      const stores = [useTimelineStore.getState(), useEbbStore.getState(), useDailyScheduleStore.getState(), useGraphStore.getState(), useLifeMapStore.getState()];
      return stores.every((store) => (
        store.liveblocks?.room?.id === targetRoomId
        && store.liveblocks?.status === 'connected'
        && !store.liveblocks?.isStorageLoading
      ));
    };
    if (evaluate()) {
      resolve();
      return;
    }
    const timer = window.setInterval(() => {
      if (evaluate()) {
        window.clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        window.clearInterval(timer);
        reject(new Error('统一工作区连接超时，已保留旧房间，可稍后重试。'));
      }
    }, 250);
  });
}

function isUnifiedStorageReady(targetRoomId: string): boolean {
  const stores = [
    useTimelineStore.getState(),
    useEbbStore.getState(),
    useDailyScheduleStore.getState(),
    useGraphStore.getState(),
    useLifeMapStore.getState(),
  ];
  return stores.every((store) => (
    store.liveblocks?.room?.id === targetRoomId
    && store.liveblocks?.room?.getStatus() === 'connected'
    && store.liveblocks?.status === 'connected'
    && !store.liveblocks?.isStorageLoading
  ));
}

function stopWorkspaceVerificationMonitor(): void {
  if (workspaceVerificationTimer) window.clearTimeout(workspaceVerificationTimer);
  workspaceVerificationTimer = null;
  workspaceVerificationRoomId = null;
}

function startWorkspaceVerificationMonitor(roomId: string): void {
  stopWorkspaceVerificationMonitor();
  workspaceVerificationRoomId = roomId;

  const schedule = () => {
    if (workspaceVerificationRoomId !== roomId) return;
    workspaceVerificationTimer = window.setTimeout(() => {
      workspaceVerificationTimer = null;
      if (workspaceVerificationRoomId !== roomId || !isUnifiedStorageReady(roomId)) {
        schedule();
        return;
      }
      if (workspaceVerificationInFlight) {
        schedule();
        return;
      }

      const operation = (async (): Promise<'connected' | 'pending' | 'conflict'> => {
        const pending = await readPendingWorkspaceSync();
        if (pending) {
          const flushed = await flushWorkspaceQueue();
          if (flushed.conflict) return 'conflict';
          if (await readPendingWorkspaceSync()) return 'pending';
        }
        const repairedFields = await ensureUnifiedWorkspaceConvergence(roomId);
        if (repairedFields.length > 0) recordWorkspaceVerification(roomId, repairedFields);
        const conflicts = await listWorkspaceConflicts();
        return conflicts.some((conflict) => conflict.status !== 'resolved') ? 'conflict' : 'connected';
      })();
      const runtimeActivity = beginWorkspaceSyncActivity('verifying', '正在进行周期性云端一致性校验…');
      workspaceVerificationInFlight = operation;
      void operation.then(
        (outcome) => runtimeActivity.finish(
          outcome === 'conflict' ? 'conflict' : outcome === 'pending' ? 'idle' : 'connected',
          outcome === 'conflict'
            ? '云端校验完成，但修复或自动归档门禁尚未通过。'
            : outcome === 'pending'
              ? '本机仍有修改等待补传。'
              : '周期性云端一致性校验已完成。',
        ),
        (error) => {
          runtimeActivity.fail(error);
          // Do not surface a stale error after this tab became a follower or
          // switched rooms. A current connected workspace must expose failures
          // instead of retaining a misleading green status.
          if (workspaceVerificationRoomId === roomId && isUnifiedStorageReady(roomId)) {
            reportQueueFlushFailure(error);
          }
        },
      ).finally(() => {
        if (workspaceVerificationInFlight === operation) workspaceVerificationInFlight = null;
        schedule();
      });
    }, WORKSPACE_VERIFICATION_INTERVAL_MS);
  };

  schedule();
}

function recordWorkspaceVerification(roomId: string, repairedFields: string[]): void {
  const verifiedAt = new Date().toISOString();
  try {
    const current = JSON.parse(localStorage.getItem('smart-line-sync-last-connected') ?? '{}') as Record<string, string>;
    localStorage.setItem('smart-line-sync-last-connected', JSON.stringify({
      ...current,
      workspace: verifiedAt,
      workspaceRoomId: roomId,
    }));
  } catch {
    // Verification remains valid when optional localStorage is unavailable.
  }
  window.dispatchEvent(new CustomEvent(WORKSPACE_VERIFIED_EVENT, {
    detail: { roomId, verifiedAt, repairedFields },
  }));
  setWorkspaceSyncRuntimeOutcome('connected', repairedFields.length > 0
    ? `云端校验完成，并修复 ${repairedFields.length} 个数据字段。`
    : '云端五个数据域校验一致。');
  if (liveblocksAuthMode === 'authenticated') {
    // Optional R2 history must never hold up or downgrade real-time sync.
    void saveWorkspaceDailyHistoryOnce(createWorkspaceBackup()).catch(() => undefined);
  }
}

async function ensureUnifiedWorkspaceConvergence(targetRoomId: string): Promise<string[]> {
  const room = useTimelineStore.getState().liveblocks?.room;
  if (!room || room.id !== targetRoomId || room.getStatus() !== 'connected') {
    throw new Error('统一工作区连接已切换，无法完成数据一致性校验。');
  }
  const { root } = await room.getStorage();
  const repaired = new Set<string>();

  for (let attempt = 0; attempt < 4; attempt += 1) {
    await waitForRoomStorageSynchronized(room);
    const rawRemote = root.toJSON() as Record<string, unknown>;
    const remote = materializeWorkspaceEntityRoot(rawRemote);
    assertWorkspaceSchemaSupported(remote, WORKSPACE_SCHEMA_VERSION);
    const localBackup = createWorkspaceBackup();
    const local = workspaceRootFromBackup(localBackup) as Record<string, unknown>;
    const canonicalRemote = workspaceRootFromBackup(rootToBackup(remote, localBackup)) as Record<string, unknown>;
    const projectionMismatches = findWorkspaceFieldMismatches(rawRemote, remote, EXPECTED_KEYS);
    const mismatches = [...new Set([
      ...findWorkspaceFieldMismatches(local, remote, EXPECTED_KEYS),
      ...projectionMismatches,
      // Even when Liveblocks hydrated the exact raw value into Zustand, legacy
      // data can still require normalization. Compare the cloud snapshot with
      // its canonical representation so those repairs are not skipped merely
      // because local and remote are identically stale.
      ...findWorkspaceFieldMismatches(canonicalRemote, remote, EXPECTED_KEYS),
    ])];
    if (mismatches.length === 0) return [...repaired];

    const pending = await readPendingWorkspaceSync();
    if (pending) {
      throw new Error('本机仍有修改等待同步，已停止云端一致性修复以避免覆盖。');
    }

    const latestRawBeforeRepair = root.toJSON() as Record<string, unknown>;
    const latestRemoteBeforeRepair = materializeWorkspaceEntityRoot(latestRawBeforeRepair);
    if (hasWorkspaceFieldSnapshotChanged(remote, latestRemoteBeforeRepair, mismatches)
      || hasWorkspaceFieldSnapshotChanged(rawRemote, latestRawBeforeRepair, projectionMismatches)) {
      // Another device updated one of the mismatched fields while this device
      // was checking its durable queue. Restart from the newer cloud snapshot.
      continue;
    }

    const remoteFields: Partial<Record<WorkspaceStorageField, unknown>> = {};
    for (const key of mismatches) {
      repaired.add(key);
      if (Object.prototype.hasOwnProperty.call(remote, key)) {
        remoteFields[key as WorkspaceStorageField] = remote[key];
      }
    }

    // A populated cloud field is authoritative once the durable local queue is
    // empty. Rehydrate stale Zustand slices from that exact cloud snapshot.
    applyWorkspaceFields(remoteFields, 'convergence');
    await Promise.resolve();

    // Normalizers can repair legacy values (for example group task copies)
    // while an old room can lack newly introduced fields. Write the canonical
    // values back only if that individual cloud field is still unchanged from
    // the snapshot. A simultaneous remote edit is never overwritten.
    if (!await readPendingWorkspaceSync()) {
      const latestRaw = root.toJSON() as Record<string, unknown>;
      const latestRemote = materializeWorkspaceEntityRoot(latestRaw);
      const latestLocal = workspaceRootFromBackup(createWorkspaceBackup()) as Record<string, unknown>;
      const fieldsToBackfill = [...new Set([
        ...findWorkspaceFieldsSafeToBackfill(remote, latestRemote, latestLocal, mismatches),
        ...projectionMismatches.filter((key) => (
          workspaceValuesEqual(rawRemote[key], latestRaw[key])
          && !workspaceValuesEqual(latestRaw[key], latestRemote[key])
        )),
      ])];
      if (fieldsToBackfill.length === 0) continue;
      const backfillFields = Object.fromEntries(fieldsToBackfill.map((key) => [key, latestLocal[key]]));
      const entityWrites = buildWorkspaceEntityWrites(latestRemote, backfillFields, crypto.randomUUID());
      const metadata = isJsonRecord(latestRemote.metadata) ? latestRemote.metadata : {};
      room.batch(() => {
        for (const [key, value] of Object.entries(backfillFields)) root.set(key, value as Json);
        for (const [key, value] of Object.entries(entityWrites)) root.set(key, value as unknown as Json);
        root.set('metadata', workspaceProtocolMetadata(metadata));
      });
    }
  }

  const finalRemote = materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
  const finalLocal = workspaceRootFromBackup(createWorkspaceBackup()) as Record<string, unknown>;
  const remaining = findWorkspaceFieldMismatches(finalLocal, finalRemote, EXPECTED_KEYS);
  throw new Error(`云端已连接，但 ${remaining.join('、') || '部分数据'} 未能在本机收敛，请重新连接后重试。`);
}

function waitForRoomStorageSynchronized(
  room: { getStatus: () => string; getStorageStatus?: () => string },
  timeoutMs = 20_000,
): Promise<void> {
  if (typeof room.getStorageStatus !== 'function') return Promise.resolve();
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const evaluate = () => room.getStatus() === 'connected' && room.getStorageStatus?.() === 'synchronized';
    if (evaluate()) {
      resolve();
      return;
    }
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
    }, 250);
  });
}

function classifyQueueFlushFailure(error: unknown): WorkspaceQueueErrorKind {
  if (error instanceof Error) {
    const named = (error as Error & { workspaceQueueErrorKind?: WorkspaceQueueErrorKind }).workspaceQueueErrorKind;
    if (named) return named;
    if (error.message.includes('本机同步队列持续变化')) return 'flush_restart_exhausted';
    if (error.message.includes('云端工作区持续变化')) return 'cloud_drift_exhausted';
  }
  return 'flush_failed';
}

function reportQueueFlushFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : '待同步数据补传失败，请保持页面开启并重试。';
  const detail: WorkspaceQueueErrorDetail = { kind: classifyQueueFlushFailure(error), message };
  setWorkspaceSyncRuntimeOutcome('error', message, message);
  window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_ERROR_EVENT, { detail }));
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
  const runtimeActivity = workspaceConnectionActivity
    ? null
    : beginWorkspaceSyncActivity('flushing', '正在补传本机待同步修改…');
  const operation = flushWorkspaceQueueInternal();
  queueFlushInFlight = operation;
  operation.then(
    (result) => {
      if (queueFlushInFlight === operation) queueFlushInFlight = null;
      runtimeActivity?.finish(
        result.conflict ? 'conflict' : 'connected',
        result.conflict
          ? '安全字段已同步，修复或自动归档门禁未通过的字段保持暂停。'
          : '本机待同步修改已由云端确认。',
      );
    },
    (error) => {
      if (queueFlushInFlight === operation) queueFlushInFlight = null;
      runtimeActivity?.fail(error);
    },
  );
  return operation;
}

async function flushWorkspaceQueueInternal(restartCount = 0): Promise<{ applied: number; conflict: boolean }> {
  const room = useTimelineStore.getState().liveblocks?.room;
  if (!room || room.getStatus() !== 'connected') return { applied: 0, conflict: false };
  const { root } = await room.getStorage();
  let timelineRepairBlocked = false;
  const uploadTimelineRepair = async (upload: TimelineBlocksRepairUpload): Promise<void> => {
    const rawBefore = root.toJSON() as Record<string, unknown>;
    const currentBefore = materializeWorkspaceEntityRoot(rawBefore);
    const repairFields = upload.fields;
    const currentIsBase = workspaceValuesEqual(currentBefore.tasks, upload.baseFields.tasks)
      && workspaceValuesEqual(currentBefore.groups, upload.baseFields.groups);
    const currentIsRepair = workspaceValuesEqual(currentBefore.tasks, repairFields.tasks)
      && workspaceValuesEqual(currentBefore.groups, repairFields.groups);
    if (!currentIsBase && !currentIsRepair) {
      throw new Error('timeline.blocks 修复上传前云端已变化，已保留修复任务和双方数据。');
    }

    const repairRevision = 'schema8-repair:' + upload.repairId;
    const entityWrites = buildWorkspaceEntityWrites(currentBefore, repairFields, repairRevision);
    const remoteMetadata = isJsonRecord(currentBefore.metadata) ? currentBefore.metadata : {};
    room.batch(() => {
      root.set('tasks', repairFields.tasks as unknown as Json);
      root.set('groups', repairFields.groups as unknown as Json);
      for (const [key, value] of Object.entries(entityWrites)) root.set(key, value as unknown as Json);
      root.set('metadata', workspaceProtocolMetadata({
        ...remoteMetadata,
        queueRevision: repairRevision,
      }));
    });
    await waitForRoomStorageSynchronized(room);
    const confirmedRaw = root.toJSON() as Record<string, unknown>;
    const confirmed = materializeWorkspaceEntityRoot(confirmedRaw);
    const confirmedMetadata = isJsonRecord(confirmed.metadata) ? confirmed.metadata : {};
    const confirmedHash = await hashWorkspaceValue(
      (confirmed.tasks as Array<{ id: string; blocks: unknown[] }>).map((task) => ({
        id: task.id,
        blocks: task.blocks,
      })),
    );
    const confirmedFieldsHash = await hashWorkspaceValue({
      tasks: confirmed.tasks,
      groups: confirmed.groups,
    });
    if (!workspaceFieldsMatchEntityProjection(confirmedRaw, repairFields)
      || confirmedMetadata.queueRevision !== repairRevision
      || confirmedHash !== upload.resultHash) {
      throw new Error('timeline.blocks 修复云端回读校验失败，已保留修复任务并停止出队。');
    }
    await confirmTimelineBlocksRepair(upload.repairId, confirmedHash, confirmedFieldsHash);
    if (upload.pendingAtRepair) {
      const repairedPendingFields = (['tasks', 'groups'] as WorkspaceStorageField[])
        .filter((field) => Object.prototype.hasOwnProperty.call(upload.pendingAtRepair?.fields, field));
      if (repairedPendingFields.length) {
        // A newer queue revision is intentionally retained and flushed after the repair baseline.
        await acknowledgeWorkspaceSyncFields(upload.pendingAtRepair, repairedPendingFields);
      }
    }
  };
  try {
    const pendingRepairUploads = await listPendingTimelineBlocksRepairUploads();
    for (const upload of pendingRepairUploads) await uploadTimelineRepair(upload);

    const localBeforeRepair = createWorkspaceBackup();
    const diagnosticPlan = await createTimelineBlocksRepairPlan(localBeforeRepair);
    if (timelineBlocksNeedRepair(diagnosticPlan)) {
      const rawRemoteBeforeRepair = root.toJSON() as Record<string, unknown>;
      const remoteBeforeRepair = materializeWorkspaceEntityRoot(rawRemoteBeforeRepair);
      const remoteMatchesSource = (
        (!Object.prototype.hasOwnProperty.call(remoteBeforeRepair, 'tasks')
          || workspaceValuesEqual(remoteBeforeRepair.tasks, localBeforeRepair.timeline.tasks))
        && (!Object.prototype.hasOwnProperty.call(remoteBeforeRepair, 'groups')
          || workspaceValuesEqual(remoteBeforeRepair.groups, localBeforeRepair.timeline.groups))
      );
      if (!remoteMatchesSource) {
        throw new Error('timeline.blocks 修复源与云端当前值不同，已暂停该字段并保留双方数据。');
      }
      const prepared = await prepareTimelineBlocksRepair({
        workspaceId: room.id,
        local: localBeforeRepair,
        remoteRoot: rawRemoteBeforeRepair,
      });
      const repaired = await executePreparedTimelineBlocksRepair(localBeforeRepair, prepared);
      await uploadTimelineRepair(await readTimelineBlocksRepairUpload(repaired.plan.repairId));
    }
  } catch (error) {
    timelineRepairBlocked = true;
    console.warn('[workspace-repair] timeline.blocks 修复暂停：', error);
  }
  let recoveredApplied = 0;
  const activeConflicts = (await listWorkspaceConflicts()).filter((conflict) => conflict.status !== 'resolved');
  for (const conflict of activeConflicts) {
    const conflictKeys = Object.keys(conflict.pending.fields) as WorkspaceStorageField[];
    if (conflictKeys.some((key) =>
      !Object.prototype.hasOwnProperty.call(conflict.pending.baseFields ?? {}, key)
      && !(conflict.pending.forceFields ?? []).includes(key))) {
      continue;
    }
    const currentRemote = materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
    const currentMetadata = isJsonRecord(currentRemote.metadata) ? currentRemote.metadata : {};
    const resolved = await mergeWorkspaceFieldChangesDetailed(
      conflict.pending.fields,
      conflict.pending.baseFields ?? {},
      currentRemote,
    );
    for (const key of conflict.pending.forceFields ?? []) {
      if (Object.prototype.hasOwnProperty.call(conflict.pending.fields, key)) {
        resolved.fields[key] = conflict.pending.fields[key];
        resolved.alternates = resolved.alternates.filter((alternate) =>
          alternate.path.split(/[.[]/, 1)[0] !== key);
      }
    }
    const alternateRecords = buildWorkspaceAlternateRecords(
      conflict.pending,
      resolved.alternates,
      typeof currentMetadata.queueRevision === 'string' ? currentMetadata.queueRevision : undefined,
    );
    await persistWorkspaceAlternates(alternateRecords);
    const recoveryIds = alternateRecords.map((record) => record.recoveryId);
    const submittedHash = await hashWorkspaceValue(resolved.fields);
    const resolutionRevision = 'schema8-auto-resolution:' + conflict.id;
    const entityWrites = buildWorkspaceEntityWrites(
      currentRemote,
      resolved.fields,
      resolutionRevision,
      conflict.pending.updatedAt,
    );
    const latestRemote = materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
    if (hasWorkspaceFieldSnapshotChanged(
      currentRemote,
      latestRemote,
      [...conflictKeys, 'metadata'],
    )) {
      throw new Error('旧冲突裁决期间云端已变化，已保留原冲突记录等待重试。');
    }
    room.batch(() => {
      for (const [key, value] of Object.entries(resolved.fields)) root.set(key, value as Json);
      for (const [key, value] of Object.entries(entityWrites)) root.set(key, value as unknown as Json);
      root.set('metadata', workspaceProtocolMetadata({
        ...currentMetadata,
        queueRevision: resolutionRevision,
      }));
    });
    await waitForRoomStorageSynchronized(room);
    const confirmed = materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
    const confirmedMetadata = isJsonRecord(confirmed.metadata) ? confirmed.metadata : {};
    const confirmedFields = Object.fromEntries(conflictKeys.map((key) => [key, confirmed[key]]));
    if (!conflictKeys.every((key) => workspaceValuesEqual(confirmed[key], resolved.fields[key]))
      || await hashWorkspaceValue(confirmedFields) !== submittedHash
      || confirmedMetadata.queueRevision !== resolutionRevision
      || !await verifyWorkspaceAlternatesPersisted(recoveryIds)) {
      throw new Error('旧冲突自动归档未能通过云端回读，已保留原冲突记录。');
    }
    applyWorkspaceFields(
      resolved.fields as Partial<Record<WorkspaceStorageField, unknown>>,
      'remote-hydration',
    );
    await markWorkspaceConflictResolved(conflict.id, 'current');
    recoveredApplied += conflictKeys.length;
  }
  const unresolvedActiveConflict = (await listWorkspaceConflicts())
    .some((conflict) => conflict.status !== 'resolved');

  const pending = await readPendingWorkspaceSync();
  if (!pending) {
    return {
      applied: recoveredApplied,
      conflict: timelineRepairBlocked || unresolvedActiveConflict,
    };
  }
  const rootJson = materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
  const pendingKeys = Object.keys(pending.fields) as WorkspaceStorageField[];
  const forcedKeys = new Set(pending.forceFields ?? []);
  const metadata = isJsonRecord(rootJson.metadata) ? rootJson.metadata : {};
  assertWorkspaceSchemaSupported(rootJson, WORKSPACE_SCHEMA_VERSION);
  const remoteDeviceId = typeof metadata.deviceId === 'string' ? metadata.deviceId : '';
  const legacyFields = Object.fromEntries(
    Object.entries(pending.fields).filter(([key]) =>
      !Object.prototype.hasOwnProperty.call(pending.baseFields ?? {}, key),
    ),
  );
  const legacyConflictFields = await findWorkspaceFieldConflicts(
     legacyFields,
     pending.baseHashes ?? {},
     rootJson,
    );
  const fieldsWithoutBaseline = pendingKeys.filter((key) =>
    !forcedKeys.has(key) && !pending.baseHashes?.[key]);
  // A clock-based metadataConflict is unreliable: device clocks can be skewed,
  // and "remoteUpdatedAt > pending.updatedAt" can be false even when the remote
  // legitimately wrote a new field. Instead, conflict if the remote already has
  // a value for a no-baseline field: the user made the same edit independently
  // on two devices and both wrote it without a common ancestor.
  const remoteHasNoBaselineField = fieldsWithoutBaseline.some((key) =>
    Object.prototype.hasOwnProperty.call(rootJson, key),
  );
  const metadataConflict = fieldsWithoutBaseline.length > 0
    && remoteHasNoBaselineField
    && remoteDeviceId
    && remoteDeviceId !== pending.deviceId;
  const blockedKeys = new Set<WorkspaceStorageField>([
    ...legacyConflictFields.map((path) => path.split(/[.[]/, 1)[0] as WorkspaceStorageField),
    ...(metadataConflict ? fieldsWithoutBaseline : []),
  ].filter((key) => !forcedKeys.has(key)));
  if (timelineRepairBlocked) {
    if (pendingKeys.includes('tasks')) blockedKeys.add('tasks');
    if (pendingKeys.includes('groups')) blockedKeys.add('groups');
  }
  const flushKeys = pendingKeys.filter((key) => !blockedKeys.has(key));
  const flushFields = Object.fromEntries(flushKeys.map((key) => [key, pending.fields[key]]));
  const flushBaseFields = Object.fromEntries(flushKeys.flatMap((key) =>
    Object.prototype.hasOwnProperty.call(pending.baseFields ?? {}, key)
      ? [[key, pending.baseFields?.[key]]]
      : []));
  const merged = await mergeWorkspaceFieldChangesDetailed(flushFields, flushBaseFields, rootJson);
  for (const key of forcedKeys) {
    if (flushKeys.includes(key)) merged.fields[key] = pending.fields[key];
  }
  merged.alternates = merged.alternates.filter((alternate) =>
    !forcedKeys.has(alternate.path.split(/[.[]/, 1)[0] as WorkspaceStorageField));
  // Conflict hashing awaits Web Crypto and gives newer user actions time to
  // enter the queue. Re-read immediately before the synchronous room batch;
  // if the queue revision changed, restart with the newest snapshot instead
  // of replaying the stale one we read at the beginning of this flush.
  const latest = await readPendingWorkspaceSync();
  if (!latest) return { applied: 0, conflict: false };
  if (getPendingWorkspaceSyncToken(latest) !== getPendingWorkspaceSyncToken(pending)) {
    if (restartCount >= MAX_QUEUE_FLUSH_RESTARTS) {
      throw Object.assign(new Error('本机同步队列持续变化，请稍后重试。'), { workspaceQueueErrorKind: 'flush_restart_exhausted' as WorkspaceQueueErrorKind });
    }
    return flushWorkspaceQueueInternal(restartCount + 1);
  }

  // Hashing and conflict analysis above are asynchronous. A remote Liveblocks
  // update can land during that interval, so compare the live root again before
  // entering the synchronous batch. Never write a merge produced from a stale
  // remote snapshot.
  const latestRootJson = materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
  if (hasWorkspaceFieldSnapshotChanged(rootJson, latestRootJson, [...pendingKeys, 'metadata'])) {
    if (restartCount >= MAX_QUEUE_FLUSH_RESTARTS) {
      throw Object.assign(new Error('云端工作区持续变化，请等待其他设备完成同步后重试。'), { workspaceQueueErrorKind: 'cloud_drift_exhausted' as WorkspaceQueueErrorKind });
    }
    return flushWorkspaceQueueInternal(restartCount + 1);
  }

  if (flushKeys.length === 0) {
    throw new Error('同步暂停：旧队列缺少可恢复的完整 base，已保留原队列且未覆盖云端。');
  }

  setWorkspaceQueueSuppressed(true);
  try {
    const queueRevision = getPendingWorkspaceSyncToken(pending);
    const alternateRecords = buildWorkspaceAlternateRecords(
      pending,
      merged.alternates,
      typeof metadata.queueRevision === 'string' ? metadata.queueRevision : undefined,
    );
    await persistWorkspaceAlternates(alternateRecords);
    const recoveryIds = alternateRecords.map((record) => record.recoveryId);
    const submittedHash = await hashWorkspaceValue(merged.fields);
    const entityWrites = buildWorkspaceEntityWrites(
      rootJson,
      merged.fields,
      queueRevision,
      pending.updatedAt,
    );
    // The local queue is the last durable copy of offline edits. Keep it until
    // Liveblocks confirms that the batch reached the cloud; a disconnect or
    // timeout must leave the queue intact so the next reconnect can retry.
    await commitWorkspaceQueueRevisionSafely({
      apply: () => room.batch(() => {
        for (const [key, value] of Object.entries(merged.fields)) root.set(key, value as Json);
        for (const [key, value] of Object.entries(entityWrites)) root.set(key, value as unknown as Json);
        root.set('metadata', workspaceProtocolMetadata({
          ...metadata,
          updatedAt: pending.updatedAt,
          deviceId: pending.deviceId,
          queueRevision,
        }));
      }),
      confirm: async () => {
        await waitForRoomStorageSynchronized(room);
        const confirmedRaw = root.toJSON() as Record<string, unknown>;
        const confirmed = materializeWorkspaceEntityRoot(confirmedRaw);
        const confirmedMetadata = confirmed.metadata && typeof confirmed.metadata === 'object'
          ? confirmed.metadata as Record<string, unknown>
          : {};
        const confirmedFields = Object.fromEntries(flushKeys.map((key) => [key, confirmed[key]]));
        const fieldsConfirmed = workspaceFieldsMatchEntityProjection(confirmedRaw, merged.fields);
        const alternatesConfirmed = await verifyWorkspaceAlternatesPersisted(recoveryIds);
        if (!fieldsConfirmed
          || await hashWorkspaceValue(confirmedFields) !== submittedHash
          || confirmedMetadata.queueRevision !== queueRevision
          || !alternatesConfirmed) {
          throw new Error('云端在本次提交期间发生变化，已保留本机队列并停止清除，请重试同步。');
        }
      },
      // Keep tracking suppressed until the exact queue revision applied above
      // is durably removed. Releasing suppression first lets the Liveblocks
      // echo recreate an identical pending record while IndexedDB is clearing.
      clear: async () => {
        if (!await acknowledgeWorkspaceSyncFields(pending, flushKeys)) {
          throw new Error('本机队列版本已变化，已保留新版本并停止出队。');
        }
      },
    });
    applyWorkspaceFields(merged.fields as Partial<Record<WorkspaceStorageField, unknown>>, 'remote-hydration');
    // A newer local revision may have landed after the last pre-batch check.
    // Never report a successful flush while a journal entry is still pending:
    // keep suppression active and immediately drain the newest revision. This
    // also absorbs a same-value storage echo without deleting a genuinely
    // newer edit blindly.
    let remaining = await readPendingWorkspaceSync();
    if (remaining && await acknowledgeAppliedWorkspaceSync(pending.fields)) {
      remaining = await readPendingWorkspaceSync();
    }
    if (remaining && blockedKeys.size === 0) {
      if (restartCount >= MAX_QUEUE_FLUSH_RESTARTS) {
        throw Object.assign(new Error('本机仍有新的修改等待同步，请稍后重试。'), { workspaceQueueErrorKind: 'flush_restart_exhausted' as WorkspaceQueueErrorKind });
      }
      return flushWorkspaceQueueInternal(restartCount + 1);
    }
  } finally {
    window.setTimeout(() => setWorkspaceQueueSuppressed(false), 0);
  }
  window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
  return {
    applied: recoveredApplied + Object.keys(merged.fields).length,
    conflict: timelineRepairBlocked || blockedKeys.size > 0 || unresolvedActiveConflict,
  };
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

async function migrateLegacyWorkspaceInternal(roomCode: string, identity: string): Promise<WorkspaceMigrationReport> {
  const startedAt = new Date().toISOString();
  const local = createWorkspaceBackup();
  const initialSource = await inspectLegacyWorkspaceWithBase(roomCode, local);
  // Legacy Liveblocks rooms can still contain stale group child projections or
  // fields that are repaired by rootToBackup. Compare both sides in the same
  // canonical form; otherwise a repairable old shape is mistaken for different
  // user data and blocks migration even though every connected store is current.
  const canonicalLocal = normalizeWorkspaceBackupForMigrationComparison(local);
  const localHash = await hashWorkspaceBackup(canonicalLocal);
  if (localHash !== initialSource.hash) {
    throw new Error('本机规范化后的数据与旧房间仍不一致。请保持联网，等待五个模块全部连接后重新检查。');
  }
  await createLocalSnapshot('统一工作区迁移前');

  // Re-read the legacy rooms after the safety snapshot. Edits made locally
  // during discovery are captured in the durable queue and three-way merged
  // over this latest cloud state; they are never flushed into whichever legacy
  // room happens to be attached to the timeline store.
  const latestLegacy = await inspectLegacyWorkspaceWithBase(roomCode, initialSource.backup);
  // This is the migration cut-over point. Stop accepting further legacy-room
  // hydration before deriving and seeding the unified source. Local actions are
  // still accepted and journaled by captureWorkspaceMutationsDuring.
  disconnectWorkspace();
  try {
    const pending = await readPendingWorkspaceSync();
    let sourceBackup = latestLegacy.backup;
    if (pending) {
      const migrationMerge = mergePendingWorkspaceMigrationFields(
        workspaceRootFromBackup(latestLegacy.backup),
        pending,
      );
      if (migrationMerge.conflicts.length > 0) {
        throw new Error(`迁移期间本机和旧云端修改了同一数据，已保留待传队列并停止迁移：${migrationMerge.conflicts.slice(0, 5).join('、')}`);
      }
      sourceBackup = rootToBackup(migrationMerge.root, latestLegacy.backup);
    }
    const sourceHash = await hashWorkspaceBackup(sourceBackup);
    const sourceSummary = summaryOf(sourceBackup);
    const targetRoomId = buildUnifiedRoomId(roomCode, identity);
    const existingRoot = await inspectRoom(targetRoomId, '统一工作区目标房间');
    assertWorkspaceSchemaSupported(existingRoot, WORKSPACE_SCHEMA_VERSION);
    const hasExistingData = EXPECTED_KEYS.some((key) => existingRoot[key] !== undefined);

    if (hasExistingData) {
      const existingBackup = rootToBackup(existingRoot, sourceBackup);
      const existingHash = await hashWorkspaceBackup(existingBackup);
      if (existingHash !== sourceHash) {
        recordPendingWorkspaceActivationConflict(roomCode, 'unified');
        throw new UnifiedWorkspaceConflictError(sourceSummary, summaryOf(existingBackup), 'unified');
      }
    }

    // Seed and verify the target before attaching any store to it. If this
    // fails, settings and the pending queue stay intact.
    const { room: targetRoom, leave } = createLiveblocksClient().enterRoom(targetRoomId, { initialPresence: {} });
    try {
      const { root } = await withTimeout(
        targetRoom.getStorage(),
        15_000,
        '连接统一工作区目标房间超时，请检查网络后重试。',
      );
      const currentRoot = materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
      assertWorkspaceSchemaSupported(currentRoot, WORKSPACE_SCHEMA_VERSION);
      const targetAlreadyHasData = EXPECTED_KEYS.some((key) => currentRoot[key] !== undefined);
      if (targetAlreadyHasData) {
        const currentBackup = rootToBackup(currentRoot, sourceBackup);
        if (await hashWorkspaceBackup(currentBackup) !== sourceHash) {
          recordPendingWorkspaceActivationConflict(roomCode, 'unified');
          throw new UnifiedWorkspaceConflictError(sourceSummary, summaryOf(currentBackup), 'unified');
        }
      }
      const sourceFields = workspaceRootFromBackup(sourceBackup);
      const fieldsToSeed = targetAlreadyHasData
        ? Object.fromEntries(EXPECTED_KEYS.map((key) => [key, currentRoot[key]]))
        : sourceFields;
      const metadata = isJsonRecord(currentRoot.metadata) ? currentRoot.metadata : {};
      const entityWrites = metadata.entityStorageVersion === WORKSPACE_ENTITY_STORAGE_VERSION
        ? {}
        : buildWorkspaceEntityInitializationWrites(fieldsToSeed, crypto.randomUUID());
      targetRoom.batch(() => {
        if (!targetAlreadyHasData) {
          for (const [key, value] of Object.entries(sourceFields)) root.set(key, value);
        }
        for (const [key, value] of Object.entries(entityWrites)) root.set(key, value as unknown as Json);
        root.set('metadata', workspaceProtocolMetadata({
          ...metadata,
          sourceRoomCode: roomCode,
          migratedAt: new Date().toISOString(),
          migrationHash: sourceHash,
        }));
      });
      await waitForRoomStorageSynchronized(targetRoom);
      const seededBackup = rootToBackup(
        materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>),
        sourceBackup,
      );
      if (await hashWorkspaceBackup(seededBackup) !== sourceHash) {
        throw new Error('目标房间写入后哈希不一致，已停止切换并保留旧房间和待传队列。');
      }
    } finally {
      leave();
    }

    // The account binding is the durable pointer to the verified target. Write
    // it before attaching the stores, so a failure can reconnect the old
    // architecture with the exact pending queue still retryable.
    await writeWorkspaceAccountBinding(identity, { roomCode, unifiedRoomId: targetRoomId });
    const connection = await connectUnifiedWorkspace(roomCode, targetRoomId);
    const target = connection.roomId;
    const timelineRoom = useTimelineStore.getState().liveblocks?.room;
    if (!timelineRoom) throw new Error('统一工作区连接未建立。');
    const { root } = await timelineRoom.getStorage();
    await waitForRoomStorageSynchronized(timelineRoom);
    const verifiedRoot = materializeWorkspaceEntityRoot(root.toJSON() as Record<string, unknown>);
    const finalLocal = normalizeWorkspaceBackupForMigrationComparison(createWorkspaceBackup());
    const verifiedBackup = rootToBackup(verifiedRoot, finalLocal);
    const targetHash = await hashWorkspaceBackup(verifiedBackup);
    const finalLocalHash = await hashWorkspaceBackup(finalLocal);
    const finalSourceSummary = summaryOf(finalLocal);
    const targetSummary = summaryOf(verifiedBackup);
    if (targetHash !== finalLocalHash) throw new Error('迁移后本机与统一工作区哈希不一致，已停止切换并保留恢复点。');

    const completedAt = new Date().toISOString();
    writeWorkspaceSyncSettings({
      architecture: 'unified', roomCode, unifiedRoomId: target,
      migratedAt: completedAt, migrationHash: targetHash,
    });
    return {
      version: 1, sourceRoomCode: roomCode, targetRoomId: target,
      startedAt, completedAt, sourceHash: finalLocalHash, targetHash,
      sourceSummary: finalSourceSummary, targetSummary,
      verified: true, legacyRoomsPreserved: true,
    };
  } catch (error) {
    connectLegacyWorkspace(roomCode);
    throw error;
  }
}

export function migrateLegacyWorkspace(roomCode: string, identity: string): Promise<WorkspaceMigrationReport> {
  return runWorkspaceConnectionOperation(() => captureWorkspaceMutationsDuring(
    () => migrateLegacyWorkspaceInternal(roomCode, identity),
  ), 'migrating', '正在创建迁移恢复点并读取旧工作区…');
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

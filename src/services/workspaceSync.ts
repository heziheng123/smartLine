import type { Json } from '@liveblocks/client';
import { useTimelineStore } from '@/store';
import { useEbbStore, EBB_ROOM_PREFIX } from '@/ebb/store';
import { useDailyScheduleStore, DAILY_ROOM_PREFIX } from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';
import { LIFE_MAP_ROOM_PREFIX, useLifeMapStore } from '@/lifeMap/store';
import { LIFE_MAP_FIELDS, normalizeLifeMapData } from '@/lifeMap/data';
import { normalizeTimelineData } from '@/store/timelineData';
import { normalizeEbbData } from '@/ebb/dataNormalization';
import { liveblocksClient } from '@/store/client';
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
  clearPendingWorkspaceSync,
  getPendingWorkspaceSyncToken,
  preserveWorkspaceConflict,
  readPendingWorkspaceSync,
  setWorkspaceConnectionMutationCapture,
  setWorkspaceQueueSuppressed,
  type WorkspaceStorageField,
} from './workspaceSyncQueueCore';
import {
  assertWorkspaceQueueDrained,
  assertWorkspaceSchemaSupported,
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
  isBundledDemoWorkspace,
  mergeWorkspaceFieldChanges,
  shouldBackfillLegacyLifeMapSync,
  withTimeout,
  workspaceHasUserContent,
  workspaceValuesEqual,
} from './workspaceSyncCore';
import { applyWorkspaceFields } from './workspaceOfflineQueue';
export { buildUnifiedRoomId, hashWorkspaceBackup } from './workspaceSyncCore';

export type SyncArchitecture = 'legacy' | 'unified';

const MAX_QUEUE_FLUSH_RESTARTS = 8;
const WORKSPACE_VERIFICATION_INTERVAL_MS = 5_000;

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
let queueListenerStarted = false;
let queueFlushTimer: number | null = null;
let queueFlushInFlight: Promise<{ applied: number; conflict: boolean }> | null = null;
let workspaceVerificationTimer: number | null = null;
let workspaceVerificationInFlight: Promise<void> | null = null;
let workspaceVerificationRoomId: string | null = null;
let workspaceConnectionOperation: Promise<unknown> | null = null;
export const WORKSPACE_CONFLICT_EVENT = 'smartline:workspace-conflict';
export const WORKSPACE_VERIFIED_EVENT = 'smartline:workspace-verified';
export const WORKSPACE_CONNECTION_PROGRESS_EVENT = 'smartline:workspace-connection-progress';
export const WORKSPACE_CONNECTION_STATE_EVENT = 'smartline:workspace-connection-state';

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

function reportWorkspaceConnectionState(busy: boolean): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_CONNECTION_STATE_EVENT, { detail: { busy } }));
}

function reportWorkspaceConnectionProgress(message: string): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_CONNECTION_PROGRESS_EVENT, { detail: { message } }));
}

function runWorkspaceConnectionOperation<T>(operation: () => Promise<T>): Promise<T> {
  if (workspaceConnectionOperation) {
    return Promise.reject(new Error('已有工作区连接任务正在进行，请等待当前任务完成后再试。'));
  }
  const current = operation();
  workspaceConnectionOperation = current;
  reportWorkspaceConnectionState(true);
  current.then(
    () => {
      if (workspaceConnectionOperation === current) {
        workspaceConnectionOperation = null;
        reportWorkspaceConnectionState(false);
      }
    },
    () => {
      if (workspaceConnectionOperation === current) {
        workspaceConnectionOperation = null;
        reportWorkspaceConnectionState(false);
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

export function disconnectWorkspace(disable = false): void {
  stopWorkspaceVerificationMonitor();
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
    reportWorkspaceConnectionProgress('正在建立统一工作区连接…');
    enableAll(roomCode);
    useTimelineStore.getState().liveblocks?.enterRoom?.(targetRoomId);
    useEbbStore.getState().liveblocks?.enterRoom?.(targetRoomId);
    useDailyScheduleStore.getState().liveblocks?.enterRoom?.(targetRoomId);
    useGraphStore.getState().liveblocks?.enterRoom?.(targetRoomId);
    useLifeMapStore.getState().liveblocks?.enterRoom?.(targetRoomId);
    ensureQueueListener();

    await waitForUnifiedStorage(targetRoomId);
    reportWorkspaceConnectionProgress('云端已连接，正在补传本机离线修改…');
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
    reportWorkspaceConnectionProgress('补传已确认，正在校验五个数据域的一致性…');
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
  const { room, leave } = liveblocksClient.enterRoom(roomId, { initialPresence: {} });
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
  const { room, leave } = liveblocksClient.enterRoom(roomId, { initialPresence: {} });
  try {
    const { root } = await withTimeout(
      room.getStorage(),
      15_000,
      '连接云端工作区超时，请检查网络后重试。',
    );
    const fields = workspaceRootFromBackup(backup);
    room.batch(() => {
      for (const [key, value] of Object.entries(fields)) root.set(key, value as Json);
    });
    await waitForRoomStorageSynchronized(room);
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
    const timer = window.setInterval(() => {
      const stores = [useTimelineStore.getState(), useEbbStore.getState(), useDailyScheduleStore.getState(), useGraphStore.getState(), useLifeMapStore.getState()];
      const ready = stores.every((store) => (
        store.liveblocks?.room?.id === targetRoomId
        && store.liveblocks?.status === 'connected'
        && !store.liveblocks?.isStorageLoading
      ));
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

      const operation = (async () => {
        const pending = await readPendingWorkspaceSync();
        if (pending) {
          const flushed = await flushWorkspaceQueue();
          if (flushed.conflict || await readPendingWorkspaceSync()) return;
        }
        const repairedFields = await ensureUnifiedWorkspaceConvergence(roomId);
        if (repairedFields.length > 0) recordWorkspaceVerification(roomId, repairedFields);
      })();
      workspaceVerificationInFlight = operation;
      void operation.catch((error) => {
        // Do not surface a stale error after this tab became a follower or
        // switched rooms. A current connected workspace must expose failures
        // instead of retaining a misleading green status.
        if (workspaceVerificationRoomId === roomId && isUnifiedStorageReady(roomId)) {
          reportQueueFlushFailure(error);
        }
      }).finally(() => {
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
    const remote = root.toJSON() as Record<string, unknown>;
    assertWorkspaceSchemaSupported(remote, WORKSPACE_SCHEMA_VERSION);
    const localBackup = createWorkspaceBackup();
    const local = workspaceRootFromBackup(localBackup) as Record<string, unknown>;
    const canonicalRemote = workspaceRootFromBackup(rootToBackup(remote, localBackup)) as Record<string, unknown>;
    const mismatches = [...new Set([
      ...findWorkspaceFieldMismatches(local, remote, EXPECTED_KEYS),
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

    const latestRemoteBeforeRepair = root.toJSON() as Record<string, unknown>;
    if (hasWorkspaceFieldSnapshotChanged(remote, latestRemoteBeforeRepair, mismatches)) {
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
    applyWorkspaceFields(remoteFields);
    await Promise.resolve();

    // Normalizers can repair legacy values (for example group task copies)
    // while an old room can lack newly introduced fields. Write the canonical
    // values back only if that individual cloud field is still unchanged from
    // the snapshot. A simultaneous remote edit is never overwritten.
    if (!await readPendingWorkspaceSync()) {
      const latestRemote = root.toJSON() as Record<string, unknown>;
      const latestLocal = workspaceRootFromBackup(createWorkspaceBackup()) as Record<string, unknown>;
      const fieldsToBackfill = findWorkspaceFieldsSafeToBackfill(
        remote,
        latestRemote,
        latestLocal,
        mismatches,
      );
      if (fieldsToBackfill.length === 0) continue;
      room.batch(() => {
        for (const key of fieldsToBackfill) root.set(key, latestLocal[key] as Json);
      });
    }
  }

  const finalRemote = root.toJSON() as Record<string, unknown>;
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

async function flushWorkspaceQueueInternal(restartCount = 0): Promise<{ applied: number; conflict: boolean }> {
  const pending = await readPendingWorkspaceSync();
  if (!pending) return { applied: 0, conflict: false };
  const room = useTimelineStore.getState().liveblocks?.room;
  if (!room || room.getStatus() !== 'connected') return { applied: 0, conflict: false };
  const { root } = await room.getStorage();
  const rootJson = root.toJSON() as Record<string, unknown>;
  const pendingKeys = Object.keys(pending.fields) as WorkspaceStorageField[];
  const forcedKeys = new Set(pending.forceFields ?? []);
  const protectedKeys = pendingKeys.filter((key) => !forcedKeys.has(key));
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
  ].filter((path) => !forcedKeys.has(path.split(/[.[]/, 1)[0] as WorkspaceStorageField));
  const fieldsWithoutBaseline = protectedKeys.filter((key) => !pending.baseHashes?.[key]);
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
    if (restartCount >= MAX_QUEUE_FLUSH_RESTARTS) throw new Error('本机同步队列持续变化，请稍后重试。');
    return flushWorkspaceQueueInternal(restartCount + 1);
  }

  // Hashing and conflict analysis above are asynchronous. A remote Liveblocks
  // update can land during that interval, so compare the live root again before
  // entering the synchronous batch. Never write a merge produced from a stale
  // remote snapshot.
  const latestRootJson = root.toJSON() as Record<string, unknown>;
  if (hasWorkspaceFieldSnapshotChanged(rootJson, latestRootJson, [...pendingKeys, 'metadata'])) {
    if (restartCount >= MAX_QUEUE_FLUSH_RESTARTS) throw new Error('云端工作区持续变化，请等待其他设备完成同步后重试。');
    return flushWorkspaceQueueInternal(restartCount + 1);
  }

  if (fieldConflicts.length > 0 || metadataConflict) {
    const remoteFields = Object.fromEntries(pendingKeys.map((key) => [key, rootJson[key]])) as Partial<Record<WorkspaceStorageField, unknown>>;
    const conflictingFields = [...new Set(fieldConflicts.map((path) => path.split(/[.[]/, 1)[0] as WorkspaceStorageField))];
    await preserveWorkspaceConflict(pending, remoteUpdatedAt, remoteFields, metadataConflict ? protectedKeys : conflictingFields);
    window.dispatchEvent(new CustomEvent(WORKSPACE_CONFLICT_EVENT));
    window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
    return { applied: 0, conflict: true };
  }

  setWorkspaceQueueSuppressed(true);
  try {
    const queueRevision = getPendingWorkspaceSyncToken(pending);
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
          queueRevision,
        } as Json);
      }),
      confirm: async () => {
        await waitForRoomStorageSynchronized(room);
        const confirmed = root.toJSON() as Record<string, unknown>;
        const confirmedMetadata = confirmed.metadata && typeof confirmed.metadata === 'object'
          ? confirmed.metadata as Record<string, unknown>
          : {};
        const fieldsConfirmed = pendingKeys.every((key) => workspaceValuesEqual(confirmed[key], merged.fields[key]));
        if (!fieldsConfirmed || confirmedMetadata.queueRevision !== queueRevision) {
          throw new Error('云端在本次提交期间发生变化，已保留本机队列并停止清除，请重试同步。');
        }
      },
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
      if (restartCount >= MAX_QUEUE_FLUSH_RESTARTS) throw new Error('本机仍有新的修改等待同步，请稍后重试。');
      return flushWorkspaceQueueInternal(restartCount + 1);
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

async function migrateLegacyWorkspaceInternal(roomCode: string, identity: string): Promise<WorkspaceMigrationReport> {
  const startedAt = new Date().toISOString();
  const local = createWorkspaceBackup();
  const source = await inspectLegacyWorkspaceWithBase(roomCode, local);
  // Legacy Liveblocks rooms can still contain stale group child projections or
  // fields that are repaired by rootToBackup. Compare both sides in the same
  // canonical form; otherwise a repairable old shape is mistaken for different
  // user data and blocks migration even though every connected store is current.
  const canonicalLocal = normalizeWorkspaceBackupForMigrationComparison(local);
  const localHash = await hashWorkspaceBackup(canonicalLocal);
  if (localHash !== source.hash) {
    throw new Error('本机规范化后的数据与旧房间仍不一致。请保持联网，等待五个模块全部连接后重新检查。');
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
      recordPendingWorkspaceActivationConflict(roomCode, 'unified');
      throw new UnifiedWorkspaceConflictError(source.summary, summaryOf(existingBackup), 'unified');
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
    // Binding must be durable before the local architecture flag switches.
    // If it fails, the catch path can reconnect the untouched legacy layout
    // without leaving settings that claim migration already completed.
    await writeWorkspaceAccountBinding(identity, { roomCode, unifiedRoomId: target });
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

export function migrateLegacyWorkspace(roomCode: string, identity: string): Promise<WorkspaceMigrationReport> {
  return runWorkspaceConnectionOperation(() => captureWorkspaceMutationsDuring(
    () => migrateLegacyWorkspaceInternal(roomCode, identity),
  ));
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

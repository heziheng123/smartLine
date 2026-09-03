import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import {
  normalizeDailyRetrospectives,
  normalizeDailySchedules,
  useDailyScheduleStore,
} from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';
import { normalizeGraphNodes } from '@/graph/store';
import { normalizeTimelineData } from '@/store/timelineData';
import { useLifeMapStore } from '@/lifeMap/store';
import { LIFE_MAP_FIELDS, normalizeLifeMapData } from '@/lifeMap/data';
import { normalizeEbbData } from '@/ebb/dataNormalization';
import { createLocalSnapshot } from './workspaceBackup';
import {
  canWorkspaceMutationEnqueue,
  currentWorkspaceMutationOrigin,
  runWorkspaceMutationWithOrigin,
  type WorkspaceMutationOrigin,
} from './workspaceMutationOrigin';
import {
  broadcastWorkspaceFields,
  isWorkspaceConnectionMutationCaptureActive,
  isWorkspaceQueueSuppressed,
  listWorkspaceConflicts,
  markWorkspaceConflictResolved,
  queueWorkspaceFields,
  replaceWorkspaceConflictPending,
  setWorkspaceQueueSuppressed,
  setWorkspaceSystemMutationSuppressed,
  WORKSPACE_QUEUE_EVENT,
  workspaceQueueChannel,
  workspaceQueueTabId,
  type WorkspaceStorageField,
} from './workspaceSyncQueueCore';

export {
  clearPendingWorkspaceSync,
  getPendingWorkspaceSyncToken,
  listWorkspaceConflicts,
  markWorkspaceConflictResolved,
  preserveWorkspaceConflict,
  queueWorkspaceFields,
  readPendingWorkspaceSync,
  setWorkspaceQueueSuppressed,
  WORKSPACE_QUEUE_EVENT,
  WORKSPACE_QUEUE_ERROR_EVENT,
  type PendingWorkspaceSync,
  type WorkspaceConflictRecord,
  type WorkspaceStorageField,
} from './workspaceSyncQueueCore';
export { acknowledgeAppliedWorkspaceSync } from './workspaceSyncQueueCore';

export function applyWorkspaceFields(
  fields: Partial<Record<WorkspaceStorageField, unknown>>,
  origin: WorkspaceMutationOrigin,
): void {
  runWorkspaceMutationWithOrigin(origin, () => {
  const hasTimelineFields = ['tasks', 'groups', 'notes', 'milestones', 'lifeStages']
    .some((key) => fields[key as WorkspaceStorageField] !== undefined);
  if (hasTimelineFields) {
    const current = useTimelineStore.getState();
    const normalized = normalizeTimelineData({
      tasks: fields.tasks ?? current.tasks,
      groups: fields.groups ?? current.groups,
      notes: fields.notes ?? current.notes,
      milestones: fields.milestones ?? current.milestones,
      lifeStages: fields.lifeStages ?? current.lifeStages,
    });
    useTimelineStore.setState({
      tasks: normalized.tasks,
      groups: normalized.groups,
      notes: normalized.notes,
      milestones: normalized.milestones,
      lifeStages: normalized.lifeStages,
    });
  }

  const hasLifeMapFields = LIFE_MAP_FIELDS.some((key) => fields[key] !== undefined);
  if (hasLifeMapFields) {
    const current = useLifeMapStore.getState();
    const source = Object.fromEntries(LIFE_MAP_FIELDS.map((key) => [key, fields[key] ?? current[key]]));
    useLifeMapStore.setState(normalizeLifeMapData(source));
  }

  const hasEbbFields = ['reviewTasks', 'inboxItems', 'outlineNodes', 'ebbSettings']
    .some((key) => fields[key as WorkspaceStorageField] !== undefined);
  if (hasEbbFields) {
    const current = useEbbStore.getState();
    const normalized = normalizeEbbData({
      reviewTasks: fields.reviewTasks ?? current.reviewTasks,
      inboxItems: fields.inboxItems ?? current.inboxItems,
      outlineNodes: fields.outlineNodes ?? current.outlineNodes,
      ebbSettings: fields.ebbSettings ?? current.ebbSettings,
    });
    useEbbStore.setState(normalized);
  }

  if (fields.schedules !== undefined) {
    useDailyScheduleStore.setState({
      schedules: normalizeDailySchedules(fields.schedules),
    });
  }
  if (fields.retrospectives !== undefined) {
    useDailyScheduleStore.setState({
      retrospectives: normalizeDailyRetrospectives(fields.retrospectives),
    });
  }
  if (fields.nodes !== undefined) {
    useGraphStore.setState({ nodes: normalizeGraphNodes(fields.nodes) });
  }
  });
}

function isWorkspaceMessage(value: unknown): value is {
  version?: 1;
  type: 'queue-ready' | 'fields';
  source: string;
  fields?: Partial<Record<WorkspaceStorageField, unknown>>;
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.version !== undefined && record.version !== 1) return false;
  if (record.type !== 'queue-ready' && record.type !== 'fields') return false;
  if (typeof record.source !== 'string' || !record.source) return false;
  if (record.type === 'queue-ready') return true;
  if (!record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)) return false;
  const allowed = new Set<WorkspaceStorageField>([
    'tasks', 'groups', 'notes', 'milestones', 'lifeStages',
    ...LIFE_MAP_FIELDS,
    'reviewTasks', 'inboxItems', 'outlineNodes', 'ebbSettings',
    'schedules', 'retrospectives', 'nodes',
  ]);
  return Object.keys(record.fields).every((key) => allowed.has(key as WorkspaceStorageField));
}

export function startWorkspaceCrossTabDataSync(): () => void {
  if (!workspaceQueueChannel) return () => undefined;

  const channel = workspaceQueueChannel;
  const handler = (event: MessageEvent<unknown>) => {
    if (!isWorkspaceMessage(event.data)) return;
    if (event.data.source === workspaceQueueTabId) return;
    if (event.data.type === 'queue-ready') {
      window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
      return;
    }
    if (event.data.type !== 'fields' || !event.data.fields) return;

    // Remote-broadcast fields are not local user edits. System mutation
    // suppression blocks trackedSet from journaling this apply and recreating
    // a queue loop on tabs that intentionally do not hold their own connection.
    setWorkspaceSystemMutationSuppressed(true);
    setWorkspaceQueueSuppressed(true);
    try {
      applyWorkspaceFields(event.data.fields, 'broadcast');
    } finally {
      window.setTimeout(() => {
        setWorkspaceQueueSuppressed(false);
        setWorkspaceSystemMutationSuppressed(false);
      }, 0);
    }
  };

  channel.addEventListener('message', handler);
  return () => channel.removeEventListener('message', handler);
}

export async function restoreWorkspaceConflict(id: string): Promise<void> {
  const conflicts = await listWorkspaceConflicts();
  const conflict = conflicts.find((item) => item.id === id);
  if (!conflict) throw new Error('冲突副本不存在。');

  setWorkspaceQueueSuppressed(true);
  try {
    applyWorkspaceFields(conflict.pending.fields, 'restore');
  } finally {
    setWorkspaceQueueSuppressed(false);
  }

  const fields = Object.keys(conflict.pending.fields) as WorkspaceStorageField[];
  await queueWorkspaceFields(conflict.pending.fields, {}, {
    bypassSuppression: true,
    forceFields: fields,
    origin: 'restore',
  });
  await markWorkspaceConflictResolved(id, 'manual');
}

export async function restoreWorkspaceConflictFields(
  id: string,
  selected: WorkspaceStorageField[],
): Promise<void> {
  const selectedSet = new Set(selected);
  if (selectedSet.size === 0) throw new Error('请至少选择一个要恢复的数据字段。');
  const conflicts = await listWorkspaceConflicts();
  const conflict = conflicts.find((item) => item.id === id);
  if (!conflict) throw new Error('冲突副本不存在。');
  const pickedFields = Object.fromEntries(Object.entries(conflict.pending.fields).filter(([key]) => selectedSet.has(key as WorkspaceStorageField))) as Partial<Record<WorkspaceStorageField, unknown>>;
  if (Object.keys(pickedFields).length === 0) throw new Error('所选字段已不在冲突副本中。');
  // A conflict record is an old recovery snapshot, not the current local
  // workspace. Preserve the current complete workspace before replacing any
  // field so an accidental recovery can always be undone locally.
  await createLocalSnapshot(`恢复冲突副本前 · ${conflict.detectedAt}`);
  setWorkspaceQueueSuppressed(true);
  try {
    applyWorkspaceFields(pickedFields, 'restore');
  } finally {
    setWorkspaceQueueSuppressed(false);
  }
  await queueWorkspaceFields(pickedFields, {}, {
    bypassSuppression: true,
    forceFields: [...selectedSet],
    origin: 'restore',
  });

  const remainingFields = Object.fromEntries(Object.entries(conflict.pending.fields).filter(([key]) => !selectedSet.has(key as WorkspaceStorageField))) as Partial<Record<WorkspaceStorageField, unknown>>;
  const remainingBaseFields = Object.fromEntries(Object.entries(conflict.pending.baseFields ?? {}).filter(([key]) => !selectedSet.has(key as WorkspaceStorageField))) as Partial<Record<WorkspaceStorageField, unknown>>;
  const remainingBaseHashes = Object.fromEntries(Object.entries(conflict.pending.baseHashes ?? {}).filter(([key]) => !selectedSet.has(key as WorkspaceStorageField))) as Partial<Record<WorkspaceStorageField, string>>;
  await replaceWorkspaceConflictPending(id, Object.keys(remainingFields).length ? {
    ...conflict.pending,
    fields: remainingFields,
    baseFields: remainingBaseFields,
    baseHashes: remainingBaseHashes,
    forceFields: conflict.pending.forceFields?.filter((field) => !selectedSet.has(field)),
    updatedAt: new Date().toISOString(),
  } : null);
}

/** Removes a saved recovery copy without changing the current local workspace,
 * cloud storage, or pending upload queue. */
export async function discardWorkspaceConflict(id: string): Promise<void> {
  const conflicts = await listWorkspaceConflicts();
  const conflict = conflicts.find((item) => item.id === id);
  if (!conflict) return;
  if (conflict.status === 'active') await markWorkspaceConflictResolved(id, 'current');
  else return;
  window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
}

function readUnifiedWorkspaceRoomId(): string | null {
  try {
    const settings = JSON.parse(
      localStorage.getItem('smart-line-sync-architecture-v1') ?? 'null',
    ) as { architecture?: string; unifiedRoomId?: string } | null;
    return settings?.architecture === 'unified' && typeof settings.unifiedRoomId === 'string'
      ? settings.unifiedRoomId
      : null;
  } catch {
    return null;
  }
}

function isUnifiedWorkspaceConfigured(): boolean {
  return readUnifiedWorkspaceRoomId() !== null;
}

function isWorkspaceStorageReady(): boolean {
  const targetRoomId = readUnifiedWorkspaceRoomId();
  if (!targetRoomId) return true;
  const stores = [
    useTimelineStore.getState(),
    useEbbStore.getState(),
    useDailyScheduleStore.getState(),
    useGraphStore.getState(),
    useLifeMapStore.getState(),
  ];
  return stores.every((state) => (
    state.liveblocks?.room?.id === targetRoomId
    &&
    state.liveblocks?.room?.getStatus() === 'connected'
    && state.liveblocks?.status === 'connected'
    && !state.liveblocks?.isStorageLoading
  ));
}

export function startWorkspaceQueueTracking(): () => void {
  let timeline = useTimelineStore.getState();
  let ebb = useEbbStore.getState();
  let daily = useDailyScheduleStore.getState();
  let graph = useGraphStore.getState();
  let lifeMap = useLifeMapStore.getState();

  const shouldQueue = () => (
    (isUnifiedWorkspaceConfigured() || isWorkspaceConnectionMutationCaptureActive())
    && !isWorkspaceStorageReady()
  );
  const queueTrackedFields = (
    changed: Partial<Record<WorkspaceStorageField, unknown>>,
    base: Partial<Record<WorkspaceStorageField, unknown>>,
  ) => {
    const origin = currentWorkspaceMutationOrigin();
    if (!canWorkspaceMutationEnqueue(origin)) return;
    void queueWorkspaceFields(changed, base, { preservePendingFields: true, origin });
  };
  const broadcastHydratedFields = (fields: Partial<Record<WorkspaceStorageField, unknown>>) => {
    if (!isWorkspaceQueueSuppressed() && !shouldQueue()) broadcastWorkspaceFields(fields);
  };

  const unsubscribers = [
    useTimelineStore.subscribe((state) => {
      const changed: Partial<Record<WorkspaceStorageField, unknown>> = {};
      const base: Partial<Record<WorkspaceStorageField, unknown>> = {};
      if (state.tasks !== timeline.tasks) {
        changed.tasks = state.tasks;
        base.tasks = timeline.tasks;
      }
      if (state.groups !== timeline.groups) {
        changed.groups = state.groups;
        base.groups = timeline.groups;
      }
      if (state.notes !== timeline.notes) {
        changed.notes = state.notes;
        base.notes = timeline.notes;
      }
      if (state.milestones !== timeline.milestones) {
        changed.milestones = state.milestones;
        base.milestones = timeline.milestones;
      }
      if (state.lifeStages !== timeline.lifeStages) {
        changed.lifeStages = state.lifeStages;
        base.lifeStages = timeline.lifeStages;
      }
      timeline = state;
      if (
        !isWorkspaceQueueSuppressed()
        && shouldQueue()
        && Object.keys(changed).length
      ) {
        queueTrackedFields(changed, base);
      }
      if (Object.keys(changed).length) broadcastHydratedFields(changed);
    }),
    useEbbStore.subscribe((state) => {
      const changed: Partial<Record<WorkspaceStorageField, unknown>> = {};
      const base: Partial<Record<WorkspaceStorageField, unknown>> = {};
      if (state.reviewTasks !== ebb.reviewTasks) {
        changed.reviewTasks = state.reviewTasks;
        base.reviewTasks = ebb.reviewTasks;
      }
      if (state.inboxItems !== ebb.inboxItems) {
        changed.inboxItems = state.inboxItems;
        base.inboxItems = ebb.inboxItems;
      }
      if (state.outlineNodes !== ebb.outlineNodes) {
        changed.outlineNodes = state.outlineNodes;
        base.outlineNodes = ebb.outlineNodes;
      }
      if (state.ebbSettings !== ebb.ebbSettings) {
        changed.ebbSettings = state.ebbSettings;
        base.ebbSettings = ebb.ebbSettings;
      }
      ebb = state;
      if (
        !isWorkspaceQueueSuppressed()
        && shouldQueue()
        && Object.keys(changed).length
      ) {
        queueTrackedFields(changed, base);
      }
      if (Object.keys(changed).length) broadcastHydratedFields(changed);
    }),
    useDailyScheduleStore.subscribe((state) => {
      const previous = daily;
      daily = state;
      const changed: Partial<Record<WorkspaceStorageField, unknown>> = {};
      const base: Partial<Record<WorkspaceStorageField, unknown>> = {};
      if (state.schedules !== previous.schedules) {
        changed.schedules = state.schedules;
        base.schedules = previous.schedules;
      }
      if (state.retrospectives !== previous.retrospectives) {
        changed.retrospectives = state.retrospectives;
        base.retrospectives = previous.retrospectives;
      }
      if (
        !isWorkspaceQueueSuppressed()
        && shouldQueue()
        && Object.keys(changed).length
      ) {
        queueTrackedFields(changed, base);
      }
      if (Object.keys(changed).length) broadcastHydratedFields(changed);
    }),
    useGraphStore.subscribe((state) => {
      const previous = graph;
      graph = state;
      if (
        !isWorkspaceQueueSuppressed()
        && shouldQueue()
        && state.nodes !== previous.nodes
      ) {
        queueTrackedFields({ nodes: state.nodes }, { nodes: previous.nodes });
      }
      if (state.nodes !== previous.nodes) broadcastHydratedFields({ nodes: state.nodes });
    }),
    useLifeMapStore.subscribe((state) => {
      const previous = lifeMap;
      lifeMap = state;
      const changed: Partial<Record<WorkspaceStorageField, unknown>> = {};
      const base: Partial<Record<WorkspaceStorageField, unknown>> = {};
      LIFE_MAP_FIELDS.forEach((field) => {
        if (state[field] !== previous[field]) {
          changed[field] = state[field];
          base[field] = previous[field];
        }
      });
      if (!isWorkspaceQueueSuppressed() && shouldQueue() && Object.keys(changed).length) {
        queueTrackedFields(changed, base);
      }
      if (Object.keys(changed).length) broadcastHydratedFields(changed);
    }),
  ];

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

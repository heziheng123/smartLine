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
import { normalizeEbbData } from '@/ebb/dataNormalization';
import {
  isWorkspaceQueueSuppressed,
  listWorkspaceConflicts,
  queueWorkspaceFields,
  removeWorkspaceConflict,
  setWorkspaceQueueSuppressed,
  WORKSPACE_QUEUE_EVENT,
  workspaceQueueChannel,
  workspaceQueueTabId,
  type WorkspaceStorageField,
} from './workspaceSyncQueueCore';

export {
  clearPendingWorkspaceSync,
  getPendingWorkspaceSyncToken,
  listWorkspaceConflicts,
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

function applyWorkspaceFields(fields: Partial<Record<WorkspaceStorageField, unknown>>): void {
  const hasTimelineFields = ['tasks', 'groups', 'notes', 'milestones']
    .some((key) => fields[key as WorkspaceStorageField] !== undefined);
  if (hasTimelineFields) {
    const current = useTimelineStore.getState();
    const normalized = normalizeTimelineData({
      tasks: fields.tasks ?? current.tasks,
      groups: fields.groups ?? current.groups,
      notes: fields.notes ?? current.notes,
      milestones: fields.milestones ?? current.milestones,
    });
    useTimelineStore.setState({
      tasks: normalized.tasks,
      groups: normalized.groups,
      notes: normalized.notes,
      milestones: normalized.milestones,
    });
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
    'tasks', 'groups', 'notes', 'milestones',
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

    setWorkspaceQueueSuppressed(true);
    try {
      applyWorkspaceFields(event.data.fields);
    } finally {
      window.setTimeout(() => setWorkspaceQueueSuppressed(false), 0);
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
    applyWorkspaceFields(conflict.pending.fields);
  } finally {
    setWorkspaceQueueSuppressed(false);
  }

  queueWorkspaceFields(conflict.pending.fields);
  await removeWorkspaceConflict(id);
}

function isUnifiedWorkspaceConfigured(): boolean {
  try {
    const settings = JSON.parse(
      localStorage.getItem('smart-line-sync-architecture-v1') ?? 'null',
    ) as { architecture?: string } | null;
    return settings?.architecture === 'unified';
  } catch {
    return false;
  }
}

function isWorkspaceStorageReady(): boolean {
  if (!isUnifiedWorkspaceConfigured()) return true;
  const stores = [
    useTimelineStore.getState(),
    useEbbStore.getState(),
    useDailyScheduleStore.getState(),
    useGraphStore.getState(),
  ];
  return stores.every((state) => (
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

  const shouldQueue = () => (
    isUnifiedWorkspaceConfigured()
    && !isWorkspaceStorageReady()
  );

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
      timeline = state;
      if (
        !isWorkspaceQueueSuppressed()
        && shouldQueue()
        && Object.keys(changed).length
      ) {
        queueWorkspaceFields(changed, base, { preservePendingFields: true });
      }
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
        queueWorkspaceFields(changed, base, { preservePendingFields: true });
      }
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
        queueWorkspaceFields(
          changed,
          base,
          { preservePendingFields: true },
        );
      }
    }),
    useGraphStore.subscribe((state) => {
      const previous = graph;
      graph = state;
      if (
        !isWorkspaceQueueSuppressed()
        && shouldQueue()
        && state.nodes !== previous.nodes
      ) {
        queueWorkspaceFields(
          { nodes: state.nodes },
          { nodes: previous.nodes },
          { preservePendingFields: true },
        );
      }
    }),
  ];

  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

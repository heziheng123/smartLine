import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';
import { reconcileTimelineTaskCopies } from '@/store/timelineData';
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
  type PendingWorkspaceSync,
  type WorkspaceConflictRecord,
  type WorkspaceStorageField,
} from './workspaceSyncQueueCore';

function applyWorkspaceFields(fields: Partial<Record<WorkspaceStorageField, unknown>>): void {
  const timelinePatch: Record<string, unknown> = {};
  for (const key of ['tasks', 'groups', 'notes', 'milestones'] as const) {
    if (fields[key] !== undefined) timelinePatch[key] = fields[key];
  }
  if (Object.keys(timelinePatch).length) {
    if (fields.tasks !== undefined || fields.groups !== undefined) {
      const current = useTimelineStore.getState();
      const reconciled = reconcileTimelineTaskCopies(
        Array.isArray(fields.tasks) ? fields.tasks as typeof current.tasks : current.tasks,
        Array.isArray(fields.groups) ? fields.groups as typeof current.groups : current.groups,
      );
      timelinePatch.tasks = reconciled.tasks;
      timelinePatch.groups = reconciled.groups;
    }
    useTimelineStore.setState(timelinePatch as never);
  }

  const ebbPatch: Record<string, unknown> = {};
  for (const key of ['reviewTasks', 'inboxItems', 'outlineNodes', 'ebbSettings'] as const) {
    if (fields[key] !== undefined) ebbPatch[key] = fields[key];
  }
  if (Object.keys(ebbPatch).length) {
    useEbbStore.setState(ebbPatch as never);
  }

  if (fields.schedules !== undefined) {
    useDailyScheduleStore.setState({ schedules: fields.schedules } as never);
  }
  if (fields.nodes !== undefined) {
    useGraphStore.setState({ nodes: fields.nodes } as never);
  }
}

export function startWorkspaceCrossTabDataSync(): () => void {
  if (!workspaceQueueChannel) return () => undefined;

  const handler = (event: MessageEvent<{
    type?: string;
    source?: string;
    fields?: Partial<Record<WorkspaceStorageField, unknown>>;
  }>) => {
    if (event.data?.source === workspaceQueueTabId) return;
    if (event.data?.type === 'queue-ready') {
      window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
      return;
    }
    if (event.data?.type !== 'fields' || !event.data.fields) return;

    setWorkspaceQueueSuppressed(true);
    try {
      applyWorkspaceFields(event.data.fields);
    } finally {
      window.setTimeout(() => setWorkspaceQueueSuppressed(false), 0);
    }
  };

  workspaceQueueChannel.addEventListener('message', handler);
  return () => workspaceQueueChannel.removeEventListener('message', handler);
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
      if (
        !isWorkspaceQueueSuppressed()
        && shouldQueue()
        && state.schedules !== previous.schedules
      ) {
        queueWorkspaceFields(
          { schedules: state.schedules },
          { schedules: previous.schedules },
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

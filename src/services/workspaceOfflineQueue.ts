import { createScopedStorage } from '@/utils/persistence';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';

export type WorkspaceStorageField =
  | 'tasks' | 'groups' | 'notes' | 'milestones'
  | 'reviewTasks' | 'inboxItems' | 'outlineNodes' | 'ebbSettings'
  | 'schedules' | 'nodes';

export interface PendingWorkspaceSync {
  version: 1;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
  fields: Partial<Record<WorkspaceStorageField, unknown>>;
}

export interface WorkspaceConflictRecord {
  id: string;
  detectedAt: string;
  remoteUpdatedAt: string;
  pending: PendingWorkspaceSync;
}

const queueStorage = createScopedStorage('workspace_sync_queue');
const QUEUE_KEY = 'pending-v1';
const CONFLICTS_KEY = 'conflicts-v1';
const DEVICE_KEY = 'smart-line-device-id';
export const WORKSPACE_QUEUE_EVENT = 'smartline:workspace-queue';
let writeChain = Promise.resolve();
let trackingSuppressed = false;
const tabId = crypto.randomUUID();
const crossTabChannel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('smartline-workspace-v1');

export function setWorkspaceQueueSuppressed(value: boolean): void {
  trackingSuppressed = value;
}

function deviceId(): string {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const created = crypto.randomUUID();
  localStorage.setItem(DEVICE_KEY, created);
  return created;
}

export function queueWorkspaceFields(fields: Partial<Record<WorkspaceStorageField, unknown>>): void {
  if (trackingSuppressed) return;
  crossTabChannel?.postMessage({ type: 'fields', source: tabId, fields });
  writeChain = writeChain.then(async () => {
    const existing = await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
    const now = new Date().toISOString();
    const next: PendingWorkspaceSync = {
      version: 1,
      deviceId: existing?.deviceId || deviceId(),
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      fields: { ...(existing?.fields ?? {}), ...fields },
    };
    await queueStorage.setItem(QUEUE_KEY, next);
    window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
    crossTabChannel?.postMessage({ type: 'queue-ready', source: tabId });
  }).catch((error) => console.warn('[workspace-queue] 保存待同步变更失败：', error));
}

export function startWorkspaceCrossTabDataSync(): () => void {
  if (!crossTabChannel) return () => undefined;
  const handler = (event: MessageEvent<{ type?: string; source?: string; fields?: Partial<Record<WorkspaceStorageField, unknown>> }>) => {
    if (event.data?.source === tabId) return;
    if (event.data?.type === 'queue-ready') {
      window.dispatchEvent(new CustomEvent(WORKSPACE_QUEUE_EVENT));
      return;
    }
    if (event.data?.type !== 'fields' || !event.data.fields) return;
    const fields = event.data.fields;
    setWorkspaceQueueSuppressed(true);
    try {
      applyWorkspaceFields(fields);
    } finally {
      window.setTimeout(() => setWorkspaceQueueSuppressed(false), 0);
    }
  };
  crossTabChannel.addEventListener('message', handler);
  return () => crossTabChannel.removeEventListener('message', handler);
}

export async function readPendingWorkspaceSync(): Promise<PendingWorkspaceSync | null> {
  await writeChain;
  return await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
}

export async function clearPendingWorkspaceSync(expectedUpdatedAt?: string): Promise<void> {
  await writeChain;
  const current = await queueStorage.getItem<PendingWorkspaceSync>(QUEUE_KEY);
  if (!current || (expectedUpdatedAt && current.updatedAt !== expectedUpdatedAt)) return;
  await queueStorage.removeItem(QUEUE_KEY);
}

export async function preserveWorkspaceConflict(pending: PendingWorkspaceSync, remoteUpdatedAt: string): Promise<void> {
  const conflicts = await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [];
  const record: WorkspaceConflictRecord = {
    id: crypto.randomUUID(), detectedAt: new Date().toISOString(), remoteUpdatedAt, pending,
  };
  await queueStorage.setItem(CONFLICTS_KEY, [record, ...conflicts].slice(0, 20));
  await clearPendingWorkspaceSync(pending.updatedAt);
}

export async function listWorkspaceConflicts(): Promise<WorkspaceConflictRecord[]> {
  return await queueStorage.getItem<WorkspaceConflictRecord[]>(CONFLICTS_KEY) ?? [];
}

function applyWorkspaceFields(fields: Partial<Record<WorkspaceStorageField, unknown>>): void {
  const timelinePatch: Record<string, unknown> = {};
  for (const key of ['tasks', 'groups', 'notes', 'milestones'] as const) if (fields[key] !== undefined) timelinePatch[key] = fields[key];
  if (Object.keys(timelinePatch).length) useTimelineStore.setState(timelinePatch as never);
  const ebbPatch: Record<string, unknown> = {};
  for (const key of ['reviewTasks', 'inboxItems', 'outlineNodes', 'ebbSettings'] as const) if (fields[key] !== undefined) ebbPatch[key] = fields[key];
  if (Object.keys(ebbPatch).length) useEbbStore.setState(ebbPatch as never);
  if (fields.schedules !== undefined) useDailyScheduleStore.setState({ schedules: fields.schedules } as never);
  if (fields.nodes !== undefined) useGraphStore.setState({ nodes: fields.nodes } as never);
}

export async function restoreWorkspaceConflict(id: string): Promise<void> {
  const conflicts = await listWorkspaceConflicts();
  const conflict = conflicts.find((item) => item.id === id);
  if (!conflict) throw new Error('冲突副本不存在。');
  setWorkspaceQueueSuppressed(true);
  try { applyWorkspaceFields(conflict.pending.fields); }
  finally { setWorkspaceQueueSuppressed(false); }
  queueWorkspaceFields(conflict.pending.fields);
  await queueStorage.setItem(CONFLICTS_KEY, conflicts.filter((item) => item.id !== id));
}

export function startWorkspaceQueueTracking(): () => void {
  let timeline = useTimelineStore.getState();
  let ebb = useEbbStore.getState();
  let daily = useDailyScheduleStore.getState();
  let graph = useGraphStore.getState();

  const unsubscribers = [
    useTimelineStore.subscribe((state) => {
      const changed: Partial<Record<WorkspaceStorageField, unknown>> = {};
      if (state.tasks !== timeline.tasks) changed.tasks = state.tasks;
      if (state.groups !== timeline.groups) changed.groups = state.groups;
      if (state.notes !== timeline.notes) changed.notes = state.notes;
      if (state.milestones !== timeline.milestones) changed.milestones = state.milestones;
      timeline = state;
      if (!trackingSuppressed && Object.keys(changed).length) queueWorkspaceFields(changed);
    }),
    useEbbStore.subscribe((state) => {
      const changed: Partial<Record<WorkspaceStorageField, unknown>> = {};
      if (state.reviewTasks !== ebb.reviewTasks) changed.reviewTasks = state.reviewTasks;
      if (state.inboxItems !== ebb.inboxItems) changed.inboxItems = state.inboxItems;
      if (state.outlineNodes !== ebb.outlineNodes) changed.outlineNodes = state.outlineNodes;
      if (state.ebbSettings !== ebb.ebbSettings) changed.ebbSettings = state.ebbSettings;
      ebb = state;
      if (!trackingSuppressed && Object.keys(changed).length) queueWorkspaceFields(changed);
    }),
    useDailyScheduleStore.subscribe((state) => {
      if (!trackingSuppressed && state.schedules !== daily.schedules) queueWorkspaceFields({ schedules: state.schedules });
      daily = state;
    }),
    useGraphStore.subscribe((state) => {
      if (!trackingSuppressed && state.nodes !== graph.nodes) queueWorkspaceFields({ nodes: state.nodes });
      graph = state;
    }),
  ];
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
}

import type { TimelineData } from '@/types';
import type { EbbData, ReviewTask, StudyOutlineNode } from '@/ebb/types';
import type { GraphData, GraphNode } from '@/graph/types';
import type { DaySchedule } from '@/components/dailySchedule/types';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { useGraphStore } from '@/graph/store';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { createScopedStorage } from '@/utils/persistence';

export const WORKSPACE_SCHEMA_VERSION = 1;
const SNAPSHOT_LIMIT = 10;
const snapshotStorage = createScopedStorage('workspace_snapshots');

export interface WorkspaceBackup {
  kind: 'smart-line-workspace';
  schemaVersion: number;
  revision: number;
  exportedAt: string;
  deviceId: string;
  timeline: TimelineData;
  ebb: EbbData;
  graph: GraphData;
  daily: { schedules: Record<string, DaySchedule> };
  settings: { timelineViewPreferences?: unknown };
}

export interface WorkspaceBackupSummary {
  tasks: number;
  groups: number;
  projectDocuments: number;
  reviewTasks: number;
  dailyDays: number;
  graphNodes: number;
  issues: string[];
}

export interface WorkspaceSnapshot {
  id: string;
  createdAt: string;
  reason: string;
  backup: WorkspaceBackup;
}

function getOrCreateDeviceId(): string {
  const key = 'smart-line-device-id';
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  localStorage.setItem(key, id);
  return id;
}

function currentRevision(): number {
  const stored = Number.parseInt(localStorage.getItem('smart-line-workspace-revision') ?? '0', 10);
  return Math.max(Number.isFinite(stored) ? stored : 0, Date.now());
}

function deepClone<T>(value: T): T {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value)) as T;
}

export function createWorkspaceBackup(): WorkspaceBackup {
  const timeline = useTimelineStore.getState();
  const ebb = useEbbStore.getState();
  const graph = useGraphStore.getState();
  const daily = useDailyScheduleStore.getState();

  if (!timeline.isHydrated || !ebb.isHydrated || !graph.isHydrated || !daily.isHydrated) {
    throw new Error('工作区数据仍在加载，请稍后再试。');
  }
  const backup: WorkspaceBackup = {
    kind: 'smart-line-workspace',
    schemaVersion: WORKSPACE_SCHEMA_VERSION,
    revision: currentRevision(),
    exportedAt: new Date().toISOString(),
    deviceId: getOrCreateDeviceId(),
    timeline: {
      tasks: timeline.tasks,
      groups: timeline.groups,
      notes: timeline.notes,
      milestones: timeline.milestones,
    },
    ebb: {
      reviewTasks: ebb.reviewTasks,
      inboxItems: ebb.inboxItems,
      outlineNodes: ebb.outlineNodes,
      ebbSettings: ebb.ebbSettings,
    },
    graph: { nodes: graph.nodes },
    daily: { schedules: daily.schedules },
    settings: {
      timelineViewPreferences: (() => {
        try { return JSON.parse(localStorage.getItem('smart-timeline-view-preferences-v2') ?? 'null'); }
        catch { return undefined; }
      })(),
    },
  };
  return deepClone(backup);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasUniqueIds(items: unknown[]): boolean {
  const ids = items
    .filter(isRecord)
    .map((item) => item.id)
    .filter((id): id is string => typeof id === 'string');
  return ids.length === items.length && ids.length === new Set(ids).size;
}

function isDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateWorkspaceBackup(value: unknown): {
  backup?: WorkspaceBackup;
  summary?: WorkspaceBackupSummary;
  errors: string[];
} {
  const errors: string[] = [];
  if (!isRecord(value) || value.kind !== 'smart-line-workspace') {
    return { errors: ['这不是 Smart Line 完整工作区备份文件。'] };
  }
  if (value.schemaVersion !== WORKSPACE_SCHEMA_VERSION) {
    errors.push(`不支持的备份版本：${String(value.schemaVersion)}。`);
  }
  const timeline = value.timeline;
  const ebb = value.ebb;
  const graph = value.graph;
  const daily = value.daily;
  if (!isRecord(timeline) || !Array.isArray(timeline.tasks) || !Array.isArray(timeline.groups)
    || !Array.isArray(timeline.notes) || !Array.isArray(timeline.milestones)) {
    errors.push('时间轴或项目文档数据格式无效。');
  }
  if (!isRecord(ebb) || !Array.isArray(ebb.reviewTasks) || !Array.isArray(ebb.inboxItems)
    || !Array.isArray(ebb.outlineNodes) || !isRecord(ebb.ebbSettings)) {
    errors.push('EBB 数据格式无效。');
  }
  if (!isRecord(graph) || !Array.isArray(graph.nodes)) errors.push('知识大盘数据格式无效。');
  if (!isRecord(daily) || !isRecord(daily.schedules)) errors.push('每日安排数据格式无效。');
  if (errors.length > 0) return { errors };

  const backup = value as unknown as WorkspaceBackup;
  if (!backup.timeline.tasks.every((task) => isRecord(task)
    && typeof task.id === 'string' && typeof task.name === 'string'
    && isDate(task.start) && isDate(task.end) && Array.isArray(task.blocks))) {
    errors.push('时间轴任务包含缺失字段或无效日期。');
  }
  if (!backup.timeline.groups.every((group) => isRecord(group)
    && typeof group.id === 'string' && typeof group.name === 'string'
    && isDate(group.start) && isDate(group.end) && Array.isArray(group.children))) {
    errors.push('项目分组包含缺失字段或无效日期。');
  }
  if (!backup.timeline.notes.every((note) => isRecord(note)
    && typeof note.id === 'string' && typeof note.name === 'string'
    && isDate(note.date) && (note.type === 'pin' || note.type === 'range'))) {
    errors.push('便签数据包含缺失字段或无效日期。');
  }
  if (!backup.timeline.milestones.every((milestone) => isRecord(milestone)
    && typeof milestone.id === 'string' && typeof milestone.name === 'string' && isDate(milestone.date))) {
    errors.push('里程碑数据包含缺失字段或无效日期。');
  }
  if (!backup.ebb.reviewTasks.every((task) => isRecord(task)
    && typeof task.id === 'string' && typeof task.topicName === 'string'
    && isDate(task.dueDate) && typeof task.isCompleted === 'boolean')) {
    errors.push('EBB 轮次包含缺失字段或无效日期。');
  }
  if (!backup.graph.nodes.every((node) => isRecord(node)
    && typeof node.id === 'string' && typeof node.name === 'string'
    && (node.parentId === null || typeof node.parentId === 'string')
    && typeof node.createdAt === 'number')) {
    errors.push('知识节点包含缺失字段或无效父节点。');
  }
  if (!backup.ebb.inboxItems.every((item) => isRecord(item)
    && typeof item.id === 'string' && typeof item.topicName === 'string'
    && typeof item.createdAt === 'string' && (item.status === 'draft' || item.status === 'staged'))) {
    errors.push('EBB 收件箱包含缺失字段。');
  }
  if (!backup.ebb.outlineNodes.every((node) => isRecord(node)
    && typeof node.id === 'string' && typeof node.name === 'string'
    && (node.parentId === null || typeof node.parentId === 'string')
    && Array.isArray(node.childrenIds) && typeof node.orderIndex === 'number')) {
    errors.push('EBB 大纲包含缺失字段或无效父子关系。');
  }
  for (const [date, schedule] of Object.entries(backup.daily.schedules)) {
    if (!isDate(date) || !isRecord(schedule) || schedule.date !== date
      || !Array.isArray(schedule.items) || !Array.isArray(schedule.blocks)
      || !schedule.items.every((item) => isRecord(item)
        && typeof item.id === 'string' && typeof item.sourceId === 'string'
        && typeof item.name === 'string' && typeof item.order === 'number')
      || !schedule.blocks.every((block) => isRecord(block)
        && typeof block.id === 'string' && typeof block.sourceId === 'string'
        && typeof block.name === 'string' && typeof block.startTime === 'string' && typeof block.endTime === 'string')) {
      errors.push(`每日安排 ${date} 包含无效数据。`);
    }
  }
  if (errors.length > 0) return { errors };

  const issues: string[] = [];
  const localRevision = Number.parseInt(localStorage.getItem('smart-line-workspace-revision') ?? '0', 10);
  if (Number.isFinite(localRevision) && backup.revision < localRevision) {
    issues.push('该备份版本早于当前设备数据版本');
  }
  const collections: Array<[string, unknown[]]> = [
    ['时间轴任务', backup.timeline.tasks],
    ['项目分组', backup.timeline.groups],
    ['EBB 轮次', backup.ebb.reviewTasks],
    ['EBB 大纲', backup.ebb.outlineNodes],
    ['知识节点', backup.graph.nodes],
  ];
  for (const [label, items] of collections) {
    if (!hasUniqueIds(items)) issues.push(`${label}存在重复 ID`);
  }
  const graphIds = new Set(backup.graph.nodes.map((node) => node.id));
  for (const node of backup.graph.nodes) {
    if (node.parentId && !graphIds.has(node.parentId)) issues.push(`知识节点“${node.name}”的父节点不存在`);
  }
  for (const node of backup.graph.nodes) {
    const visited = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        issues.push(`知识节点“${node.name}”存在父子循环`);
        break;
      }
      visited.add(parentId);
      parentId = backup.graph.nodes.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
  }
  for (const task of backup.ebb.reviewTasks) {
    if (!isDate(task.dueDate)) issues.push(`EBB 轮次“${task.topicName}”日期无效`);
    if (task.graphNodeId && !graphIds.has(task.graphNodeId)) issues.push(`EBB 轮次“${task.topicName}”绑定节点不存在`);
  }
  for (const [date, schedule] of Object.entries(backup.daily.schedules)) {
    if (!isDate(date) || !isRecord(schedule) || !Array.isArray(schedule.items) || !Array.isArray(schedule.blocks)) {
      issues.push(`每日安排 ${date} 格式无效`);
    }
  }

  return {
    backup,
    errors,
    summary: {
      tasks: backup.timeline.tasks.length,
      groups: backup.timeline.groups.length,
      projectDocuments: backup.timeline.tasks.filter((task) => task.blocks.length > 0).length,
      reviewTasks: backup.ebb.reviewTasks.length,
      dailyDays: Object.keys(backup.daily.schedules).length,
      graphNodes: backup.graph.nodes.length,
      issues: [...new Set(issues)].slice(0, 50),
    },
  };
}

export async function createLocalSnapshot(reason: string): Promise<WorkspaceSnapshot> {
  const snapshot: WorkspaceSnapshot = {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `snapshot-${Date.now()}`,
    createdAt: new Date().toISOString(),
    reason,
    backup: createWorkspaceBackup(),
  };
  const snapshots = await listLocalSnapshots();
  const next = [snapshot, ...snapshots].slice(0, SNAPSHOT_LIMIT);
  await snapshotStorage.setItem('items', next);
  return snapshot;
}

export async function listLocalSnapshots(): Promise<WorkspaceSnapshot[]> {
  const value = await snapshotStorage.getItem<WorkspaceSnapshot[]>('items');
  return Array.isArray(value) ? value : [];
}

export async function restoreWorkspaceBackup(backup: WorkspaceBackup): Promise<void> {
  await createLocalSnapshot('恢复完整工作区前');
  const before = createWorkspaceBackup();
  const apply = (source: WorkspaceBackup) => {
    const safe = deepClone(source);
    useTimelineStore.getState().replaceData(safe.timeline);
    useEbbStore.setState({
      reviewTasks: safe.ebb.reviewTasks as ReviewTask[],
      inboxItems: safe.ebb.inboxItems,
      outlineNodes: safe.ebb.outlineNodes as StudyOutlineNode[],
      ebbSettings: safe.ebb.ebbSettings,
      undoStack: [],
    });
    useGraphStore.setState({ nodes: safe.graph.nodes as GraphNode[] });
    useDailyScheduleStore.setState({ schedules: safe.daily.schedules });
  };
  try {
    apply(backup);
    if (backup.settings?.timelineViewPreferences !== undefined) {
      localStorage.setItem('smart-timeline-view-preferences-v2', JSON.stringify(backup.settings.timelineViewPreferences));
    }
    await new Promise((resolve) => window.setTimeout(resolve, 750));
  } catch (error) {
    apply(before);
    await new Promise((resolve) => window.setTimeout(resolve, 750));
    throw error;
  }
  localStorage.setItem('smart-line-workspace-revision', String(Math.max(currentRevision(), backup.revision)));
}

export function downloadWorkspaceBackup(): void {
  const backup = createWorkspaceBackup();
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `smart-line-workspace-${backup.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

let revisionTimer: ReturnType<typeof setTimeout> | null = null;
function markWorkspaceChanged() {
  if (revisionTimer) clearTimeout(revisionTimer);
  revisionTimer = setTimeout(() => {
    localStorage.setItem('smart-line-workspace-revision', String(Date.now()));
  }, 300);
}
useTimelineStore.subscribe((state, previous) => {
  if (state.tasks !== previous.tasks || state.groups !== previous.groups || state.notes !== previous.notes || state.milestones !== previous.milestones) markWorkspaceChanged();
});
useEbbStore.subscribe((state, previous) => {
  if (state.reviewTasks !== previous.reviewTasks || state.inboxItems !== previous.inboxItems || state.outlineNodes !== previous.outlineNodes || state.ebbSettings !== previous.ebbSettings) markWorkspaceChanged();
});
useGraphStore.subscribe((state, previous) => { if (state.nodes !== previous.nodes) markWorkspaceChanged(); });
useDailyScheduleStore.subscribe((state, previous) => { if (state.schedules !== previous.schedules) markWorkspaceChanged(); });

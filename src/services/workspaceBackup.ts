import type { TimelineData } from '@/types';
import type { EbbData } from '@/ebb/types';
import type { GraphData } from '@/graph/types';
import type { DaySchedule } from '@/components/dailySchedule/types';
import { persistTimelineData, useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { useGraphStore } from '@/graph/store';
import { persistDailySchedules, useDailyScheduleStore } from '@/components/dailySchedule/store';
import { parseSourceId } from '@/components/dailySchedule/conversion';
import { getReviewTopicKey } from '@/ebb/scheduler';
import { createScopedStorage } from '@/utils/persistence';

export const WORKSPACE_SCHEMA_VERSION = 1;
const snapshotStorage = createScopedStorage('workspace_snapshots');
const snapshotChunkStorage = createScopedStorage('workspace_snapshot_chunks');

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
  backup?: WorkspaceBackup;
  format?: 2;
  chunks?: Record<SnapshotSection, string>;
  isCheckpoint?: boolean;
  storedBytes?: number;
}

type SnapshotSection = 'header' | 'timeline' | 'ebb' | 'graph' | 'daily' | 'settings';

interface SnapshotChunk {
  encoding: 'gzip' | 'json';
  data: string;
  rawBytes: number;
  storedBytes: number;
}

export interface SnapshotStorageStats {
  snapshotCount: number;
  chunkCount: number;
  snapshotBytes: number;
  browserUsage?: number;
  browserQuota?: number;
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

function isTime(value: unknown): value is string {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return false;
  return true;
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
    && isDate(group.start) && isDate(group.end) && Array.isArray(group.children)
    && group.children.every((task) => isRecord(task)
      && typeof task.id === 'string' && typeof task.name === 'string'
      && isDate(task.start) && isDate(task.end) && Array.isArray(task.blocks)))) {
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
    ['便签', backup.timeline.notes],
    ['里程碑', backup.timeline.milestones],
    ['EBB 轮次', backup.ebb.reviewTasks],
    ['EBB 收件箱', backup.ebb.inboxItems],
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
  const timelineTaskMap = new Map<string, TimelineData['tasks'][number]>();
  for (const task of backup.timeline.tasks) timelineTaskMap.set(task.id, task);
  for (const group of backup.timeline.groups) {
    if (group.start > group.end) issues.push(`项目分组“${group.name}”的开始日期晚于结束日期`);
    if (new Set(group.children.map((task) => task.id)).size !== group.children.length) issues.push(`项目分组“${group.name}”存在重复子任务`);
    for (const task of group.children) {
      if (!timelineTaskMap.has(task.id)) timelineTaskMap.set(task.id, task);
    }
  }
  const taskGroupOwners = new Map<string, string>();
  for (const group of backup.timeline.groups) {
    for (const task of group.children) {
      const previousGroup = taskGroupOwners.get(task.id);
      if (previousGroup && previousGroup !== group.id) issues.push(`任务“${task.name}”同时属于多个项目分组`);
      taskGroupOwners.set(task.id, group.id);
    }
  }
  for (const note of backup.timeline.notes) {
    if (note.endDate !== undefined && !isDate(note.endDate)) issues.push(`便签“${note.name}”的结束日期无效`);
    if (note.endDate && note.date > note.endDate) issues.push(`便签“${note.name}”的开始日期晚于结束日期`);
  }
  for (const task of timelineTaskMap.values()) {
    if (task.start > task.end) issues.push(`项目“${task.name}”的开始日期晚于结束日期`);
    const blockIds = new Set<string>();
    for (const block of task.blocks) {
      if (!isRecord(block) || typeof block.id !== 'string' || (block.type !== 'text' && block.type !== 'smart-task')) {
        issues.push(`项目“${task.name}”包含无效任务块`);
        continue;
      }
      if (blockIds.has(block.id)) issues.push(`项目“${task.name}”存在重复任务块 ID`);
      blockIds.add(block.id);
      if (block.type !== 'smart-task') continue;
      if (!isRecord(block.header)) {
        issues.push(`项目“${task.name}”包含无效智能任务块`);
        continue;
      }
      const title = typeof block.header.title === 'string' ? block.header.title : block.id;
      if (typeof block.header.isCompleted !== 'boolean') issues.push(`任务“${title}”的完成状态无效`);
      const isQuantity = block.header.taskKind === 'quantity' || block.header.taskKind === 'vocabulary';
      if (typeof block.header.duration !== 'number' || !Number.isFinite(block.header.duration)
        || (isQuantity ? block.header.duration < 0 : block.header.duration <= 0)) {
        issues.push(`任务“${title}”的时长无效`);
      }
      if (isQuantity) {
        const legacyVocabulary = block.header.taskKind === 'vocabulary';
        const total = legacyVocabulary ? block.header.vocabularyTotalWords : block.header.quantityTotal;
        const initial = legacyVocabulary ? block.header.vocabularyInitialCompletedWords : block.header.quantityInitialCompleted;
        const records = legacyVocabulary ? block.header.vocabularyRecords : block.header.quantityRecords;
        const unit = legacyVocabulary ? '个' : block.header.quantityUnit;
        if (!Number.isInteger(total) || (total ?? 0) <= 0
          || !Number.isInteger(initial) || (initial ?? 0) < 0
          || !isRecord(records) || typeof unit !== 'string' || !unit.trim()) {
          issues.push(`数量任务“${title}”的数量配置无效`);
        } else {
          let learned = initial as number;
          for (const [date, amount] of Object.entries(records)) {
            if (!isDate(date) || !Number.isInteger(amount) || (amount as number) <= 0) {
              issues.push(`数量任务“${title}”包含无效的每日记录`);
            } else {
              learned += amount as number;
            }
          }
          if (learned > (total as number)) issues.push(`数量任务“${title}”的累计数量超过总数`);
          if (block.header.isCompleted !== (learned >= (total as number))) issues.push(`数量任务“${title}”的完成状态与数量不一致`);
        }
      }
      if (block.header.date !== undefined && !isDate(block.header.date)) issues.push(`任务“${title}”的计划日期无效`);
      if (block.header.deadline !== undefined && !isDate(block.header.deadline)) issues.push(`任务“${title}”的截止日期无效`);
      if (block.header.completedDate !== undefined && !isDate(block.header.completedDate)) issues.push(`任务“${title}”的完成日期无效`);
      if (block.header.isCompleted === true && !block.header.completedDate) issues.push(`任务“${title}”已完成但缺少完成日期`);
      const boundIds = new Set<string>();
      if (typeof block.header.graphNodeId === 'string' && block.header.graphNodeId) boundIds.add(block.header.graphNodeId);
      if (Array.isArray(block.header.graphNodeIds)) {
        block.header.graphNodeIds.forEach((id) => { if (typeof id === 'string' && id) boundIds.add(id); });
      }
      boundIds.forEach((nodeId) => {
        if (!graphIds.has(nodeId)) issues.push(`任务“${title}”绑定的知识节点不存在`);
      });
    }
  }

  const outlineIds = new Set(backup.ebb.outlineNodes.map((node) => node.id));
  for (const node of backup.ebb.outlineNodes) {
    if (node.parentId && !outlineIds.has(node.parentId)) issues.push(`EBB 大纲节点“${node.name}”的父节点不存在`);
    const uniqueChildren = new Set(node.childrenIds);
    if (uniqueChildren.size !== node.childrenIds.length) issues.push(`EBB 大纲节点“${node.name}”存在重复子节点`);
    for (const childId of node.childrenIds) {
      const child = backup.ebb.outlineNodes.find((candidate) => candidate.id === childId);
      if (!child) issues.push(`EBB 大纲节点“${node.name}”引用的子节点不存在`);
      else if (child.parentId !== node.id) issues.push(`EBB 大纲节点“${node.name}”的父子关系不一致`);
    }
    const visited = new Set<string>([node.id]);
    let parentId = node.parentId;
    while (parentId) {
      if (visited.has(parentId)) {
        issues.push(`EBB 大纲节点“${node.name}”存在父子循环`);
        break;
      }
      visited.add(parentId);
      parentId = backup.ebb.outlineNodes.find((candidate) => candidate.id === parentId)?.parentId ?? null;
    }
  }

  const roundOrdersByTopic = new Map<string, Set<number>>();
  for (const task of backup.ebb.reviewTasks.filter((reviewTask) => !reviewTask.isArchived)) {
    if (task.outlineNodeId && !outlineIds.has(task.outlineNodeId)) issues.push(`EBB 轮次“${task.topicName}”绑定的大纲节点不存在`);
    if (task.completedDate !== undefined && !isDate(task.completedDate)) issues.push(`EBB 轮次“${task.topicName}”的完成日期无效`);
    if (task.isCompleted && !task.completedDate) issues.push(`EBB 轮次“${task.topicName}”已完成但缺少完成日期`);
    if (task.roundOrder !== undefined) {
      if (!Number.isInteger(task.roundOrder) || task.roundOrder <= 0) {
        issues.push(`EBB 轮次“${task.topicName}”的轮次编号无效`);
        continue;
      }
      const topicKey = getReviewTopicKey(task);
      const orders = roundOrdersByTopic.get(topicKey) ?? new Set<number>();
      if (orders.has(task.roundOrder)) issues.push(`EBB 主题“${task.topicName}”存在重复轮次编号`);
      orders.add(task.roundOrder);
      roundOrdersByTopic.set(topicKey, orders);
    }
  }

  const reviewIds = new Set(backup.ebb.reviewTasks.map((task) => task.id));
  for (const [date, schedule] of Object.entries(backup.daily.schedules)) {
    if (!isDate(date) || !isRecord(schedule) || !Array.isArray(schedule.items) || !Array.isArray(schedule.blocks)) {
      issues.push(`每日安排 ${date} 格式无效`);
      continue;
    }
    const scheduleIds = new Set<string>();
    for (const entry of [...schedule.items, ...schedule.blocks]) {
      if (scheduleIds.has(entry.id)) issues.push(`每日安排 ${date} 存在重复条目 ID`);
      scheduleIds.add(entry.id);
      if (entry.source === 'free') continue;
      const parsed = parseSourceId(entry.sourceId);
      if (!parsed) {
        issues.push(`每日安排 ${date} 包含无效来源`);
      } else if (parsed.source === 'review' && (!parsed.reviewId || !reviewIds.has(parsed.reviewId))) {
        issues.push(`每日安排 ${date} 引用的 EBB 轮次不存在`);
      } else if (parsed.source === 'project') {
        const project = parsed.parentTaskId ? timelineTaskMap.get(parsed.parentTaskId) : undefined;
        const blockExists = project && (!parsed.blockId || project.blocks.some((block) => block.id === parsed.blockId));
        if (!blockExists) issues.push(`每日安排 ${date} 引用的项目任务不存在`);
      }
    }
    for (const block of schedule.blocks) {
      if (!isTime(block.startTime) || !isTime(block.endTime) || block.startTime >= block.endTime) {
        issues.push(`每日安排 ${date} 包含无效时间块`);
      }
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

async function hashText(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function compressText(value: string): Promise<SnapshotChunk> {
  const raw = new TextEncoder().encode(value);
  if (typeof CompressionStream === 'undefined') {
    return { encoding: 'json', data: value, rawBytes: raw.byteLength, storedBytes: raw.byteLength };
  }
  const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip'));
  const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < compressed.length; offset += 0x8000) {
    binary += String.fromCharCode(...compressed.subarray(offset, offset + 0x8000));
  }
  return { encoding: 'gzip', data: btoa(binary), rawBytes: raw.byteLength, storedBytes: compressed.byteLength };
}

async function decompressChunk(chunk: SnapshotChunk): Promise<string> {
  if (chunk.encoding === 'json') return String(chunk.data);
  if (typeof DecompressionStream === 'undefined') throw new Error('当前浏览器无法解压此快照。');
  const binary = atob(chunk.data);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return await new Response(stream).text();
}

function snapshotSections(backup: WorkspaceBackup): Record<SnapshotSection, unknown> {
  return {
    header: {
      kind: backup.kind, schemaVersion: backup.schemaVersion, revision: backup.revision,
      exportedAt: backup.exportedAt, deviceId: backup.deviceId,
    },
    timeline: backup.timeline,
    ebb: backup.ebb,
    graph: backup.graph,
    daily: backup.daily,
    settings: backup.settings,
  };
}

async function storeSnapshotChunks(backup: WorkspaceBackup): Promise<{ chunks: Record<SnapshotSection, string>; storedBytes: number }> {
  const chunks = {} as Record<SnapshotSection, string>;
  let storedBytes = 0;
  for (const [section, value] of Object.entries(snapshotSections(backup)) as Array<[SnapshotSection, unknown]>) {
    const json = JSON.stringify(value);
    const hash = await hashText(json);
    chunks[section] = hash;
    let chunk = await snapshotChunkStorage.getItem<SnapshotChunk>(hash);
    if (!chunk || typeof chunk.data !== 'string') {
      chunk = await compressText(json);
      await snapshotChunkStorage.setItem(hash, chunk);
    }
    storedBytes += chunk.storedBytes;
  }
  return { chunks, storedBytes };
}

function retainSnapshots(snapshots: WorkspaceSnapshot[]): WorkspaceSnapshot[] {
  const sorted = [...snapshots].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const keep = new Map<string, WorkspaceSnapshot>();
  sorted.slice(0, 3).forEach((snapshot) => keep.set(snapshot.id, { ...snapshot, isCheckpoint: true }));
  const now = Date.now();
  const daily = new Set<string>();
  const monthly = new Set<string>();
  for (const snapshot of sorted.slice(3)) {
    const ageDays = (now - new Date(snapshot.createdAt).getTime()) / 86_400_000;
    const day = snapshot.createdAt.slice(0, 10);
    const month = snapshot.createdAt.slice(0, 7);
    if (ageDays <= 7 && !daily.has(day)) {
      daily.add(day);
      keep.set(snapshot.id, { ...snapshot, isCheckpoint: false });
    } else if (!monthly.has(month)) {
      monthly.add(month);
      keep.set(snapshot.id, { ...snapshot, isCheckpoint: false });
    }
  }
  return [...keep.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 24);
}

async function cleanupSnapshotChunks(snapshots: WorkspaceSnapshot[]): Promise<void> {
  const referenced = new Set(snapshots.flatMap((snapshot) => Object.values(snapshot.chunks ?? {})));
  const keys = await snapshotChunkStorage.keys();
  await Promise.all(keys.filter((key) => !referenced.has(String(key))).map((key) => snapshotChunkStorage.removeItem(key)));
}

export async function createLocalSnapshot(reason: string): Promise<WorkspaceSnapshot> {
  const backup = createWorkspaceBackup();
  const stored = await storeSnapshotChunks(backup);
  const snapshot: WorkspaceSnapshot = {
    id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `snapshot-${Date.now()}`,
    createdAt: new Date().toISOString(), reason, format: 2,
    chunks: stored.chunks, storedBytes: stored.storedBytes,
  };
  const next = retainSnapshots([snapshot, ...await listLocalSnapshots()]);
  await snapshotStorage.setItem('items', next);
  await cleanupSnapshotChunks(next);
  return next.find((item) => item.id === snapshot.id) ?? snapshot;
}

export async function listLocalSnapshots(): Promise<WorkspaceSnapshot[]> {
  const value = await snapshotStorage.getItem<WorkspaceSnapshot[]>('items');
  return Array.isArray(value) ? value : [];
}

export async function materializeWorkspaceSnapshot(snapshot: WorkspaceSnapshot): Promise<WorkspaceBackup> {
  if (snapshot.backup) return deepClone(snapshot.backup);
  if (snapshot.format !== 2 || !snapshot.chunks) throw new Error('快照格式不完整。');
  const values = {} as Record<SnapshotSection, unknown>;
  for (const [section, hash] of Object.entries(snapshot.chunks) as Array<[SnapshotSection, string]>) {
    const chunk = await snapshotChunkStorage.getItem<SnapshotChunk>(hash);
    if (!chunk) throw new Error(`快照数据块缺失：${section}`);
    values[section] = JSON.parse(await decompressChunk(chunk));
  }
  const header = values.header as Pick<WorkspaceBackup, 'kind' | 'schemaVersion' | 'revision' | 'exportedAt' | 'deviceId'>;
  return {
    ...header,
    timeline: values.timeline as WorkspaceBackup['timeline'],
    ebb: values.ebb as WorkspaceBackup['ebb'],
    graph: values.graph as WorkspaceBackup['graph'],
    daily: values.daily as WorkspaceBackup['daily'],
    settings: values.settings as WorkspaceBackup['settings'],
  };
}

export async function restoreLocalSnapshot(snapshot: WorkspaceSnapshot): Promise<void> {
  await restoreWorkspaceBackup(await materializeWorkspaceSnapshot(snapshot));
}

export async function getSnapshotStorageStats(): Promise<SnapshotStorageStats> {
  const snapshots = await listLocalSnapshots();
  const keys = await snapshotChunkStorage.keys();
  let snapshotBytes = 0;
  for (const key of keys) snapshotBytes += (await snapshotChunkStorage.getItem<SnapshotChunk>(key))?.storedBytes ?? 0;
  const estimate = await navigator.storage?.estimate?.();
  return {
    snapshotCount: snapshots.length, chunkCount: keys.length, snapshotBytes,
    browserUsage: estimate?.usage, browserQuota: estimate?.quota,
  };
}

export async function restoreWorkspaceBackup(backup: WorkspaceBackup): Promise<void> {
  await createLocalSnapshot('恢复完整工作区前');
  const before = createWorkspaceBackup();
  const apply = async (source: WorkspaceBackup) => {
    const safe = deepClone(source);
    useTimelineStore.getState().replaceData(safe.timeline);
    useEbbStore.getState().replaceEbbData(safe.ebb);
    useGraphStore.getState().replaceGraphData(safe.graph);
    useDailyScheduleStore.getState().replaceSchedules(safe.daily.schedules);
    await Promise.all([
      persistTimelineData({
        tasks: useTimelineStore.getState().tasks,
        groups: useTimelineStore.getState().groups,
        notes: useTimelineStore.getState().notes,
        milestones: useTimelineStore.getState().milestones,
      }),
      persistDailySchedules(useDailyScheduleStore.getState().schedules),
    ]);
  };
  try {
    await apply(backup);
    if (backup.settings?.timelineViewPreferences !== undefined) {
      localStorage.setItem('smart-timeline-view-preferences-v2', JSON.stringify(backup.settings.timelineViewPreferences));
    }
  } catch (error) {
    await apply(before);
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

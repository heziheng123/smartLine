import { addDays } from '@/utils/dateSafe';
import type { EbbData, EbbSettings, InboxItem, ReviewTask, StudyOutlineNode } from './types';
import { DEFAULT_EBB_SETTINGS, TAG_COLOR_PALETTE } from './constants';
import { normalizeReviewRoundOrders } from './scheduler';

export function buildAbsoluteScheduleDates(
  baseDate: string,
  intervals: number[],
  count = intervals.length,
): string[] {
  if (intervals.length === 0 || count <= 0) return [];
  const lastIndex = intervals.length - 1;
  return Array.from({ length: count }, (_, index) => {
    const overflowDays = Math.max(0, index - lastIndex);
    const interval = intervals[Math.min(index, lastIndex)] + overflowDays;
    return addDays(baseDate, interval);
  });
}

export const serializeReviewTasks = (tasks: ReviewTask[]): string => JSON.stringify(
  [...tasks].sort((a, b) => a.id.localeCompare(b.id)),
);

export function ensureTagColors(tasks: ReviewTask[], settings: EbbSettings): EbbSettings {
  const existingTags = new Set(Object.keys(settings.tagColors));
  const newColors = { ...settings.tagColors };
  let paletteIdx = existingTags.size % TAG_COLOR_PALETTE.length;
  for (const task of tasks) {
    // Graph-linked reviews are categorised dynamically by their root node.
    // Do not create stale colour entries from the source project-task title.
    if (task.graphNodeId) continue;
    const tag = task.tag?.trim() || '';
    const categoryKey = tag ? `manual:${tag}` : '';
    if (categoryKey && !newColors[categoryKey] && !newColors[tag]) {
      newColors[categoryKey] = TAG_COLOR_PALETTE[paletteIdx % TAG_COLOR_PALETTE.length];
      paletteIdx++;
    }
  }
  return { ...settings, tagColors: newColors };
}

export function isValidEbbDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidReviewTask(value: unknown): value is ReviewTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Record<string, unknown>;
  return typeof task.id === 'string' && task.id.trim().length > 0
    && typeof task.topicName === 'string'
    && isValidEbbDate(task.dueDate)
    && typeof task.isCompleted === 'boolean';
}

function isValidInboxItem(value: unknown): value is InboxItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.trim().length > 0
    && typeof item.topicName === 'string'
    && typeof item.createdAt === 'string'
    && (item.status === 'draft' || item.status === 'staged');
}

function isValidOutlineNode(value: unknown): value is StudyOutlineNode {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  return typeof node.id === 'string' && node.id.trim().length > 0
    && typeof node.name === 'string'
    && (node.type === 'book' || node.type === 'chapter' || node.type === 'section')
    && (node.parentId === null || typeof node.parentId === 'string')
    && Number.isFinite(node.orderIndex);
}

function deduplicateById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  values.forEach((value) => byId.set(value.id, value));
  return [...byId.values()];
}

function normalizeOutlineNodes(values: unknown[]): StudyOutlineNode[] {
  const nodes = deduplicateById(values.filter(isValidOutlineNode).map((node) => ({ ...node })));
  const ids = new Set(nodes.map((node) => node.id));
  nodes.forEach((node) => {
    if (!node.parentId || node.parentId === node.id || !ids.has(node.parentId)) node.parentId = null;
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const state = new Map<string, 'visiting' | 'visited'>();
  const breakCycles = (id: string) => {
    const node = byId.get(id);
    if (!node || state.get(id) === 'visited') return;
    state.set(id, 'visiting');
    if (node.parentId) {
      if (state.get(node.parentId) === 'visiting') node.parentId = null;
      else breakCycles(node.parentId);
    }
    state.set(id, 'visited');
  };
  nodes.forEach((node) => breakCycles(node.id));
  nodes.forEach((node) => { node.childrenIds = []; });
  nodes.forEach((node) => {
    if (node.parentId) byId.get(node.parentId)?.childrenIds.push(node.id);
  });
  nodes.forEach((node) => {
    node.childrenIds.sort((a, b) => (byId.get(a)?.orderIndex ?? 0) - (byId.get(b)?.orderIndex ?? 0));
  });
  return nodes.sort((a, b) => a.orderIndex - b.orderIndex);
}

export function normalizeEbbData(data: Partial<EbbData> | null | undefined): EbbData {
  const rawTasks = Array.isArray(data?.reviewTasks) ? data.reviewTasks : [];
  let reviewTasks = normalizeReviewRoundOrders(
    deduplicateById(rawTasks.filter(isValidReviewTask).map((task) => ({
      ...task,
      originalDueDate: isValidEbbDate(task.originalDueDate) ? task.originalDueDate : task.dueDate,
      completedDate: isValidEbbDate(task.completedDate)
        ? task.completedDate
        : task.isCompleted ? task.dueDate : undefined,
      isCompleted: task.isCompleted,
      scheduleCreatedDate: isValidEbbDate(task.scheduleCreatedDate) ? task.scheduleCreatedDate : undefined,
      scheduleSourceTaskId: typeof task.scheduleSourceTaskId === 'string' ? task.scheduleSourceTaskId : undefined,
      scheduleSourceBlockId: typeof task.scheduleSourceBlockId === 'string' ? task.scheduleSourceBlockId : undefined,
      completionSource: task.isCompleted && (task.completionSource === 'manual' || task.completionSource === 'project-task')
        ? task.completionSource
        : undefined,
      completionSourceTaskId: task.isCompleted && typeof task.completionSourceTaskId === 'string'
        ? task.completionSourceTaskId
        : undefined,
      completionSourceBlockId: task.isCompleted && typeof task.completionSourceBlockId === 'string'
        ? task.completionSourceBlockId
        : undefined,
      previousSchedule: task.isCompleted && Array.isArray(task.previousSchedule)
        ? task.previousSchedule.filter((entry) =>
            !!entry
            && typeof entry.reviewTaskId === 'string'
            && isValidEbbDate(entry.dueDate),
          )
        : undefined,
    }))),
  );
  const inboxItems = deduplicateById(
    (Array.isArray(data?.inboxItems) ? data.inboxItems : []).filter(isValidInboxItem),
  );
  const outlineNodes = normalizeOutlineNodes(
    Array.isArray(data?.outlineNodes) ? data.outlineNodes : [],
  );
  const outlineIds = new Set(outlineNodes.map((node) => node.id));
  reviewTasks = reviewTasks.map((task) =>
    task.outlineNodeId && !outlineIds.has(task.outlineNodeId)
      ? { ...task, outlineNodeId: undefined }
      : task,
  );
  const incomingSettings = data?.ebbSettings;
  const ebbSettings: EbbSettings = {
    ...DEFAULT_EBB_SETTINGS,
    ...(incomingSettings ?? {}),
    complexityConfigs: {
      ...DEFAULT_EBB_SETTINGS.complexityConfigs,
      ...(incomingSettings?.complexityConfigs ?? {}),
    },
    tagColors: { ...(incomingSettings?.tagColors ?? {}) },
    collapsedGroups: Array.isArray(incomingSettings?.collapsedGroups)
      ? incomingSettings.collapsedGroups
      : [],
    loadThresholds: Array.isArray(incomingSettings?.loadThresholds)
      && incomingSettings.loadThresholds.length === 4
      ? incomingSettings.loadThresholds
      : DEFAULT_EBB_SETTINGS.loadThresholds,
  };
  return {
    reviewTasks,
    inboxItems,
    outlineNodes,
    ebbSettings: ensureTagColors(reviewTasks, ebbSettings),
  };
}

/**
 * Projects a Zustand/Liveblocks state back to the four serializable EBB fields.
 * Callers may pass a structurally compatible store object containing actions;
 * those runtime functions must never reach IndexedDB.
 */
export function toEbbData(data: EbbData): EbbData {
  return normalizeEbbData({
    reviewTasks: Array.isArray(data.reviewTasks) ? data.reviewTasks : [],
    inboxItems: Array.isArray(data.inboxItems) ? data.inboxItems : [],
    outlineNodes: Array.isArray(data.outlineNodes) ? data.outlineNodes : [],
    ebbSettings: data.ebbSettings,
  });
}

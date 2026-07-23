import type { Milestone, Note, SmartTaskHeader, Task, TaskGroup, TimelineData } from '@/types';
import {
  getValidGraphNodeIds,
  migrateMarkdownToBlocks,
  recoverRequiredTaskStartDate,
  shouldAutoSyncEbb,
} from '@/utils/blocks';

export const headerValueEquals = (left: unknown, right: unknown): boolean =>
  typeof left === 'object' || typeof right === 'object'
    ? JSON.stringify(left) === JSON.stringify(right)
    : left === right;

export function normalizeTimelineTask(task: Task): Task {
  const normalizedTask = { ...task } as Task & { markdown?: string };
  if (normalizedTask.markdown && (!normalizedTask.blocks || normalizedTask.blocks.length === 0)) {
    const blocks = migrateMarkdownToBlocks(task);
    delete normalizedTask.markdown;
    return { ...normalizedTask, blocks };
  }

  delete normalizedTask.markdown;
  return {
    ...normalizedTask,
    blocks: Array.isArray(normalizedTask.blocks)
      ? normalizedTask.blocks.map((block) => (
        block.type === 'smart-task'
          ? {
            ...block,
            header: {
              ...block.header,
              date: recoverRequiredTaskStartDate(block.header, normalizedTask.start),
              autoSyncEbb: shouldAutoSyncEbb(block.header),
            },
          }
          : block
      ))
      : [],
  };
}

function isValidTask(task: unknown): task is Task {
  if (!task || typeof task !== 'object') return false;
  const record = task as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.start === 'string'
    && typeof record.end === 'string';
}

function isValidNote(note: unknown): note is Note {
  if (!note || typeof note !== 'object') return false;
  const record = note as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.date === 'string'
    && (record.type === 'pin' || record.type === 'range');
}

function isValidMilestone(milestone: unknown): milestone is Milestone {
  if (!milestone || typeof milestone !== 'object') return false;
  const record = milestone as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.date === 'string';
}

function isValidGroup(group: unknown): group is TaskGroup {
  if (!group || typeof group !== 'object') return false;
  const record = group as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.start === 'string'
    && typeof record.end === 'string'
    && Array.isArray(record.children);
}

export function normalizeTimelineData(data: TimelineData): TimelineData {
  const tasks = Array.isArray(data?.tasks) ? data.tasks.filter(isValidTask).map(normalizeTimelineTask) : [];
  const groups = Array.isArray(data?.groups)
    ? data.groups
      .filter(isValidGroup)
      .map((group) => ({
        ...group,
        children: Array.isArray(group.children)
          ? group.children.filter(isValidTask).map((child) => ({
            ...normalizeTimelineTask(child),
            groupId: group.id,
          }))
          : [],
      }))
    : [];
  const canonicalTasks = new Map(tasks.map((task) => [task.id, task]));
  for (const group of groups) {
    for (const child of group.children) {
      canonicalTasks.set(child.id, {
        ...(canonicalTasks.get(child.id) ?? child),
        groupId: group.id,
      });
    }
  }
  const reconciledGroups = groups.map((group) => ({
    ...group,
    children: group.children.map((child) => ({
      ...(canonicalTasks.get(child.id) ?? child),
      groupId: group.id,
    })),
  }));
  return {
    tasks: [...canonicalTasks.values()],
    notes: Array.isArray(data?.notes) ? data.notes.filter(isValidNote) : [],
    milestones: Array.isArray(data?.milestones) ? data.milestones.filter(isValidMilestone) : [],
    groups: reconciledGroups,
  };
}

export function getAllGraphNodeIds(header: SmartTaskHeader): string[] {
  const ids = new Set(getValidGraphNodeIds(header));
  if (typeof header.graphNodeId === 'string' && header.graphNodeId.trim()) {
    ids.add(header.graphNodeId);
  }
  return [...ids];
}

export function getUniqueTasks(tasks: Task[], groups: TaskGroup[]): Task[] {
  const byId = new Map<string, Task>();
  for (const task of tasks) byId.set(task.id, task);
  for (const group of groups) {
    for (const child of group.children) {
      if (!byId.has(child.id)) byId.set(child.id, child);
    }
  }
  return [...byId.values()];
}

export function toTimelineData(data: TimelineData): TimelineData {
  return {
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    groups: Array.isArray(data.groups) ? data.groups : [],
    notes: Array.isArray(data.notes) ? data.notes : [],
    milestones: Array.isArray(data.milestones) ? data.milestones : [],
  };
}

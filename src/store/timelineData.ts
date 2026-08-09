import type { LifeStage, Milestone, Note, SmartTaskHeader, Task, TaskGroup, TimelineData } from '@/types';
import {
  getValidGraphNodeIds,
  migrateMarkdownToBlocks,
  recoverRequiredTaskStartDate,
  shouldAutoSyncEbb,
} from '@/utils/blocks';
import { todayStr } from '@/utils/dateSafe';
import { isValidCalendarDate } from '@/utils/dateSafe';

export const headerValueEquals = (left: unknown, right: unknown): boolean =>
  typeof left === 'object' || typeof right === 'object'
    ? JSON.stringify(left) === JSON.stringify(right)
    : left === right;

export function normalizeTimelineTask(task: Task): Task {
  const fallbackDate = todayStr();
  const validStart = typeof task.start === 'string' && isValidCalendarDate(task.start)
    ? task.start
    : undefined;
  const validEnd = typeof task.end === 'string' && isValidCalendarDate(task.end)
    ? task.end
    : undefined;
  const start = validStart ?? validEnd ?? fallbackDate;
  const end = validEnd && validEnd >= start ? validEnd : start;
  const normalizedTask = { ...task, start, end } as Task & { markdown?: string };
  if (normalizedTask.markdown && (!normalizedTask.blocks || normalizedTask.blocks.length === 0)) {
    const blocks = migrateMarkdownToBlocks(normalizedTask);
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

function taskCopiesEqual(left: Task, right: Task): boolean {
  if (left === right) return true;
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Repairs only the structural invariant required by the live application.
 * Semantic migrations (for example recovering a quantity start date) remain
 * part of explicit load/import normalization so remote reconciliation does not
 * silently change user data or hide backup validation warnings.
 */
export function repairTimelineTaskStructure(task: Task): Task {
  if (Array.isArray(task.blocks)) return task;
  const legacy = task as Task & { markdown?: string };
  if (typeof legacy.markdown === 'string' && legacy.markdown.trim()) {
    return normalizeTimelineTask(task);
  }
  return { ...task, blocks: [] };
}

/**
 * `tasks` is the canonical project collection. `groups.children` remains a
 * compatibility projection for the timeline UI and older stored workspaces.
 *
 * Liveblocks synchronizes `tasks` and `groups` as separate root fields, so a
 * remote batch can temporarily deliver two different copies of the same
 * project. Always rebuild the compatibility copy from `tasks`; group-only
 * legacy projects are promoted into `tasks` before rebuilding.
 */
export function reconcileTimelineTaskCopies(
  tasks: Task[],
  groups: TaskGroup[],
): { tasks: Task[]; groups: TaskGroup[]; changed: boolean } {
  const canonicalById = new Map<string, Task>();
  let tasksChanged = false;

  for (const task of tasks) {
    const repaired = repairTimelineTaskStructure(task);
    const canonical = taskCopiesEqual(task, repaired) ? task : repaired;
    if (canonical !== task) tasksChanged = true;
    canonicalById.set(canonical.id, canonical);
  }

  // Preserve legacy workspaces whose grouped projects were stored only inside
  // groups.children, while making the promoted top-level copy authoritative.
  for (const group of groups) {
    const children = Array.isArray(group.children) ? group.children : [];
    for (const child of children) {
      const repairedChild = repairTimelineTaskStructure(child);
      const groupedChild = repairedChild.groupId === group.id
        ? repairedChild
        : { ...repairedChild, groupId: group.id };
      const existing = canonicalById.get(groupedChild.id);
      if (!existing) {
        canonicalById.set(groupedChild.id, groupedChild);
        tasksChanged = true;
      } else if (existing.groupId !== group.id) {
        canonicalById.set(groupedChild.id, { ...existing, groupId: group.id });
        tasksChanged = true;
      }
    }
  }

  const nextTasks = tasksChanged ? [...canonicalById.values()] : tasks;
  let groupsChanged = false;
  const nextGroups = groups.map((group) => {
    const sourceChildren = Array.isArray(group.children) ? group.children : [];
    let childrenChanged = sourceChildren !== group.children;
    const children = sourceChildren.map((child) => {
      const canonical = canonicalById.get(child.id);
      if (!canonical) return child;
      const projected = canonical.groupId === group.id
        ? canonical
        : { ...canonical, groupId: group.id };
      if (taskCopiesEqual(child, projected)) return child;
      childrenChanged = true;
      return projected;
    });
    if (!childrenChanged) return group;
    groupsChanged = true;
    return { ...group, children };
  });

  return {
    tasks: nextTasks,
    groups: groupsChanged ? nextGroups : groups,
    changed: tasksChanged || groupsChanged,
  };
}

function isValidTask(task: unknown): task is Task {
  if (!task || typeof task !== 'object') return false;
  const record = task as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string';
}

function isValidNote(note: unknown): note is Note {
  if (!note || typeof note !== 'object') return false;
  const record = note as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.date === 'string'
    && isValidCalendarDate(record.date)
    && (record.endDate === undefined
      || (typeof record.endDate === 'string'
        && isValidCalendarDate(record.endDate)
        && record.endDate >= record.date))
    && (record.type === 'pin' || record.type === 'range');
}

function isValidMilestone(milestone: unknown): milestone is Milestone {
  if (!milestone || typeof milestone !== 'object') return false;
  const record = milestone as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.date === 'string'
    && isValidCalendarDate(record.date);
}

function isValidLifeStage(stage: unknown): stage is LifeStage {
  if (!stage || typeof stage !== 'object') return false;
  const record = stage as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.start === 'string'
    && isValidCalendarDate(record.start)
    && typeof record.end === 'string'
    && isValidCalendarDate(record.end)
    && record.end >= record.start;
}

function isValidGroup(group: unknown): group is TaskGroup {
  if (!group || typeof group !== 'object') return false;
  const record = group as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && Array.isArray(record.children);
}

export function normalizeTimelineData(value: unknown): TimelineData & { lifeStages: LifeStage[] } {
  const data = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<TimelineData>
    : {};
  const tasks = Array.isArray(data.tasks) ? data.tasks.filter(isValidTask).map(normalizeTimelineTask) : [];
  const groups = Array.isArray(data.groups)
    ? data.groups
      .filter(isValidGroup)
      .map((group) => {
        const fallbackDate = todayStr();
        const children = Array.isArray(group.children)
          ? group.children.filter(isValidTask).map((child) => ({
            ...normalizeTimelineTask(child),
            groupId: group.id,
          }))
          : [];
        const validStart = typeof group.start === 'string' && isValidCalendarDate(group.start)
          ? group.start
          : undefined;
        const validEnd = typeof group.end === 'string' && isValidCalendarDate(group.end)
          ? group.end
          : undefined;
        const childStarts = children.map((child) => child.start).filter(isValidCalendarDate);
        const childEnds = children.map((child) => child.end).filter(isValidCalendarDate);
        const derivedStart = group.autoDate && childStarts.length > 0
          ? [...childStarts].sort()[0]
          : undefined;
        const derivedEnd = group.autoDate && childEnds.length > 0
          ? [...childEnds].sort().at(-1)
          : undefined;
        const start = derivedStart ?? validStart ?? validEnd ?? fallbackDate;
        const candidateEnd = derivedEnd ?? validEnd;
        const end = candidateEnd && candidateEnd >= start ? candidateEnd : start;
        return {
          ...group,
          start,
          end,
          children,
        };
      })
    : [];
  const reconciled = reconcileTimelineTaskCopies(tasks, groups);
  return {
    tasks: reconciled.tasks,
    notes: Array.isArray(data?.notes) ? data.notes.filter(isValidNote) : [],
    milestones: Array.isArray(data?.milestones) ? data.milestones.filter(isValidMilestone) : [],
    lifeStages: Array.isArray(data?.lifeStages) ? data.lifeStages.filter(isValidLifeStage) : [],
    groups: reconciled.groups,
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
  for (const task of Array.isArray(tasks) ? tasks : []) byId.set(task.id, task);
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const child of Array.isArray(group.children) ? group.children : []) {
      if (!byId.has(child.id)) byId.set(child.id, child);
    }
  }
  return [...byId.values()];
}

export function toTimelineData(data: TimelineData): TimelineData & { lifeStages: LifeStage[] } {
  return {
    tasks: Array.isArray(data.tasks) ? data.tasks : [],
    groups: Array.isArray(data.groups) ? data.groups : [],
    notes: Array.isArray(data.notes) ? data.notes : [],
    milestones: Array.isArray(data.milestones) ? data.milestones : [],
    lifeStages: Array.isArray(data.lifeStages) ? data.lifeStages : [],
  };
}

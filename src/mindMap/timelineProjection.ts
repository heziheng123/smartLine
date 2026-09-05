import type { LifeMapData } from '@/lifeMap/types';
import type { ProjectPlanningSnapshot } from '@/projectPlanning/adapter';
import type { TimelineSection } from './model';

export interface TimelineProjectionItem {
  id: string;
  title: string;
  start: string;
  end: string;
  color: string;
  kind: 'group' | 'stage' | 'project' | 'task' | 'milestone' | 'system' | 'theme' | 'goal' | 'focus' | 'note' | 'review';
  shape: 'range' | 'marker';
  parentId?: string;
  progress?: number;
  projectTaskId?: string;
  lifeItemId?: string;
}

export type LifeTimelineSnapshot = Pick<
  LifeMapData,
  'lifeMapAreas' | 'lifeMapStages' | 'lifeMapThemes' | 'lifeMapGoals' | 'lifeMapSystems'
  | 'lifeMapEvents' | 'lifeMapFocuses' | 'lifeMapNotes' | 'lifeMapReviews'
>;

export function timelineStatus(items: TimelineProjectionItem[], today: string) {
  return items.reduce((status, item) => {
    if (item.shape === 'range' && item.start <= today && item.end >= today && item.progress !== 100) status.active += 1;
    if (item.progress !== undefined && item.progress < 100 && item.end < today) status.overdue += 1;
    return status;
  }, { active: 0, overdue: 0 });
}

const active = <T extends { deletedAt?: string }>(items: T[]) => items.filter((item) => !item.deletedAt);
const range = (
  id: string,
  title: string,
  start: string | undefined,
  end: string | undefined,
  color: string,
  kind: TimelineProjectionItem['kind'],
  extras: Pick<TimelineProjectionItem, 'parentId' | 'progress'> = {},
): TimelineProjectionItem | null => (
  start && (end || start) ? { id, title, start, end: end || start, color, kind, shape: end && end !== start ? 'range' : 'marker', ...extras } : null
);

const lifeRange = (...args: Parameters<typeof range>): TimelineProjectionItem | null => {
  const item = range(...args);
  return item ? { ...item, lifeItemId: item.id } : null;
};

export function projectTimelineItems(projectId: string, data: ProjectPlanningSnapshot): TimelineProjectionItem[] {
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) return [];
  const tasks = project.blocks.filter((block) => block.type === 'smart-task');
  const progress = project.lifeMapProgress ?? (tasks.length
    ? Math.round(tasks.filter((block) => block.header.isCompleted).length / tasks.length * 100)
    : project.completed ? 100 : 0);
  return [
    range(`project:${project.id}`, project.name, project.start, project.end, project.color ?? '#5e5ce6', 'project', { progress }),
    ...project.blocks.flatMap((block) => {
      if (block.type !== 'smart-task') return [];
      const item = range(`task:${project.id}:${block.id}`, block.header.title, block.header.date, block.header.deadline, block.header.tagColor || project.color || '#5e5ce6', 'task', {
        parentId: `project:${project.id}`,
        progress: block.header.isCompleted ? 100 : 0,
      });
      return item ? [{ ...item, projectTaskId: `project-blk:${project.id}::${block.id}` }] : [];
    }),
    ...data.milestones.filter((item) => item.relatedPlanId === project.id)
      .map((item) => range(`milestone:${item.id}`, item.name, item.date, item.date, item.color ?? '#af52de', 'milestone')),
  ].filter((item): item is TimelineProjectionItem => Boolean(item));
}

const groupTimelineItem = (group: NonNullable<ProjectPlanningSnapshot['groups']>[number]) => (
  range(`group:${group.id}`, group.name, group.start, group.end, group.color ?? '#64748b', 'group')
);

export function timelineSelectedProjectIds(section: TimelineSection, data: ProjectPlanningSnapshot) {
  if (section.selectionScopes.length > 0) {
    const groupIds = new Set(section.selectionScopes.filter((scope) => scope.type === 'group').map((scope) => scope.id));
    return [...new Set([
      ...data.projects.filter((project) => project.groupId && groupIds.has(project.groupId)).map((project) => project.id),
      ...section.selectionScopes.filter((scope) => scope.type === 'project').map((scope) => scope.id),
    ])];
  }
  if (section.source === 'project' && section.targetId) return [section.targetId];
  if (section.source !== 'manual') return [];
  return [...new Set(section.manualItems.flatMap((reference) => (
    reference.source === 'project' && reference.itemId === `project:${reference.contextId}` ? [reference.contextId] : []
  )))];
}

const projectUnscheduledItemIds = (projectId: string, data: ProjectPlanningSnapshot) => {
  const project = data.projects.find((item) => item.id === projectId);
  if (!project) return [];
  return project.blocks.flatMap((block) => block.type === 'smart-task' && !block.header.date && !block.header.deadline
    ? [`task:${project.id}:${block.id}`]
    : []);
};

export function timelineUnscheduledItemCount(section: TimelineSection, data: ProjectPlanningSnapshot) {
  if (section.selectionScopes.length > 0) return timelineSelectedProjectIds(section, data)
    .reduce((count, projectId) => count + projectUnscheduledItemIds(projectId, data).length, 0);
  if (section.source === 'project' && section.targetId) return projectUnscheduledItemIds(section.targetId, data).length;
  if (section.source !== 'manual') return 0;
  const unscheduled = new Set(section.manualItems.flatMap((reference) => reference.source === 'project'
    ? projectUnscheduledItemIds(reference.contextId, data)
    : []));
  return section.manualItems.filter((reference) => unscheduled.has(reference.itemId)).length;
}

export function lifeTimelineItems(areaId: string, data: LifeTimelineSnapshot): TimelineProjectionItem[] {
  const area = active(data.lifeMapAreas).find((item) => item.id === areaId);
  if (!area) return [];
  const color = area.color || '#5e5ce6';
  return [
    ...active(data.lifeMapStages).filter((item) => !item.areaIds || item.areaIds.includes(areaId))
      .map((item) => lifeRange(`stage:${item.id}`, item.name, item.start, item.end, item.color ?? color, 'stage')),
    ...active(data.lifeMapThemes).filter((item) => item.areaId === areaId)
      .map((item) => lifeRange(`theme:${item.id}`, item.name, item.start, item.end, item.color ?? color, 'theme')),
    ...active(data.lifeMapGoals).filter((item) => item.areaId === areaId)
      .map((item) => lifeRange(`goal:${item.id}`, item.name, item.start, item.targetDate, item.color ?? color, 'goal', { progress: item.progress })),
    ...active(data.lifeMapSystems).filter((item) => item.areaId === areaId)
      .map((item) => lifeRange(`system:${item.id}`, item.name, item.start, item.end, item.color ?? color, 'system')),
    ...active(data.lifeMapFocuses).filter((item) => item.areaId === areaId)
      .map((item) => lifeRange(`focus:${item.id}`, item.name, item.start, item.end, item.color ?? color, 'focus')),
    ...active(data.lifeMapEvents).filter((item) => item.areaId === areaId)
      .map((item) => lifeRange(`event:${item.id}`, item.name, item.date, item.date, item.color ?? color, 'milestone')),
    ...active(data.lifeMapNotes).filter((item) => item.areaId === areaId)
      .map((item) => lifeRange(`note:${item.id}`, item.name, item.date, item.endDate, item.color ?? color, 'note')),
    ...active(data.lifeMapReviews).filter((item) => item.areaIds?.includes(areaId))
      .map((item) => lifeRange(`review:${item.id}`, item.title, item.start, item.end, color, 'review')),
  ].filter((item): item is TimelineProjectionItem => Boolean(item));
}

export function timelineProjectionItems(
  section: TimelineSection,
  projects: ProjectPlanningSnapshot,
  life: LifeTimelineSnapshot,
): TimelineProjectionItem[] {
  const scopedItems = section.selectionScopes.length > 0
    ? [
        ...section.selectionScopes.flatMap((scope) => {
          const group = scope.type === 'group' ? (projects.groups ?? []).find((item) => item.id === scope.id) : null;
          const item = group ? groupTimelineItem(group) : null;
          return item ? [item] : [];
        }),
        ...timelineSelectedProjectIds(section, projects).flatMap((projectId) => projectTimelineItems(projectId, projects)),
      ]
    : null;
  if (scopedItems) return [...new Map(scopedItems.map((item) => [item.id, item])).values()];
  const items = section.source === 'project' && section.targetId
    ? projectTimelineItems(section.targetId, projects)
    : section.source === 'life' && section.targetId
      ? lifeTimelineItems(section.targetId, life)
      : section.source === 'manual'
        ? section.manualItems.flatMap((reference) => {
            const candidates = reference.source === 'project'
              ? projectTimelineItems(reference.contextId, projects)
              : lifeTimelineItems(reference.contextId, life);
            const item = candidates.find((candidate) => candidate.id === reference.itemId);
            return item ? [item] : [];
          })
        : [];
  const order = (item: TimelineProjectionItem) => (
    item.kind === 'group' || item.kind === 'stage' ? 0
      : item.kind === 'project' ? 1
        : item.kind === 'task' ? 2
          : item.kind === 'milestone' || item.shape === 'marker' ? 4
            : 3
  );
  return [...new Map(items.map((item) => [item.id, item])).values()]
    .sort((left, right) => order(left) - order(right) || left.start.localeCompare(right.start) || left.end.localeCompare(right.end));
}

export const timelineDateValue = (value: string) => {
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
};

export function timelineVisibleItems(
  items: TimelineProjectionItem[],
  start: string,
  end: string,
  maximumRows: number,
): TimelineProjectionItem[] {
  return items.filter((item) => item.end >= start && item.start <= end).slice(0, Math.max(0, maximumRows));
}

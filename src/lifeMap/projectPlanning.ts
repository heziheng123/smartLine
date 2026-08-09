import type { Task } from '../types/index.ts';
import type {
  LifeArea,
  LifeGoal,
  LifeMapPlanGroupId,
  LifeMapPlanGroupPreference,
} from './types.ts';

export const UNCLASSIFIED_PLANNING_AREA_ID = '__unclassified__';
export type ProjectPlanningGroupId = LifeMapPlanGroupId | 'unclassified';

export interface ProjectPlanningScope {
  groupId: 'all' | ProjectPlanningGroupId;
  areaId?: string;
}

export interface ProjectPlanningArea extends Omit<LifeArea, 'planGroupId'> {
  planGroupId: ProjectPlanningGroupId;
}

export interface ProjectPlanningGroup extends Omit<LifeMapPlanGroupPreference, 'id'> {
  id: ProjectPlanningGroupId;
}

export interface ProjectPlanningProjection {
  tasks: Task[];
  goals: ProjectPlanningGoal[];
  areas: ProjectPlanningArea[];
  groups: ProjectPlanningGroup[];
}

export interface ProjectPlanningGoal extends LifeGoal {
  projectTaskId: string;
}

const VIEW_STAMP = {
  createdAt: '1970-01-01T00:00:00.000Z',
  updatedAt: '1970-01-01T00:00:00.000Z',
  revision: 0,
};

const DEFAULT_GROUPS: ProjectPlanningGroup[] = [
  { id: 'learning', placement: 'above', order: 0, ...VIEW_STAMP },
  { id: 'work', placement: 'above', order: 1, ...VIEW_STAMP },
  { id: 'life', placement: 'below', order: 2, ...VIEW_STAMP },
  { id: 'unclassified', placement: 'below', order: 3, ...VIEW_STAMP },
];

const UNCLASSIFIED_AREA: ProjectPlanningArea = {
  id: UNCLASSIFIED_PLANNING_AREA_ID,
  name: '未分类',
  color: '#94A3B8',
  order: Number.MAX_SAFE_INTEGER,
  planGroupId: 'unclassified',
  ...VIEW_STAMP,
};

function activeVisibleAreaById(areas: LifeArea[]): Map<string, LifeArea> {
  return new Map(areas
    .filter((area) => !area.deletedAt && !area.isHidden)
    .map((area) => [area.id, area]));
}

export function resolveProjectPlanningAreaId(task: Task, areas: LifeArea[]): string {
  if (!task.planningAreaId) return UNCLASSIFIED_PLANNING_AREA_ID;
  return activeVisibleAreaById(areas).has(task.planningAreaId)
    ? task.planningAreaId
    : UNCLASSIFIED_PLANNING_AREA_ID;
}

export function filterProjectsByPlanningScope(
  tasks: Task[],
  areas: LifeArea[],
  scope: ProjectPlanningScope,
): Task[] {
  if (scope.groupId === 'all' && !scope.areaId) return tasks;
  const byId = activeVisibleAreaById(areas);
  return tasks.filter((task) => {
    const areaId = task.planningAreaId && byId.has(task.planningAreaId)
      ? task.planningAreaId
      : UNCLASSIFIED_PLANNING_AREA_ID;
    if (scope.areaId) return areaId === scope.areaId;
    if (scope.groupId === 'all') return true;
    if (scope.groupId === 'unclassified') return areaId === UNCLASSIFIED_PLANNING_AREA_ID;
    return byId.get(areaId)?.planGroupId === scope.groupId;
  });
}

function projectProgress(task: Task): number {
  const smartBlocks = task.blocks.filter((block) => block.type === 'smart-task');
  if (task.completed) return 100;
  if (smartBlocks.length === 0) return 0;
  return Math.round(smartBlocks.filter((block) => block.header.isCompleted).length / smartBlocks.length * 100);
}

export function createProjectPlanningProjection(
  tasks: Task[],
  areas: LifeArea[],
  planGroups: LifeMapPlanGroupPreference[] = [],
): ProjectPlanningProjection {
  const areaById = activeVisibleAreaById(areas);
  const resolvedAreaId = (task: Task) => task.planningAreaId && areaById.has(task.planningAreaId)
    ? task.planningAreaId
    : UNCLASSIFIED_PLANNING_AREA_ID;
  const hasUnclassified = tasks.some((task) => resolvedAreaId(task) === UNCLASSIFIED_PLANNING_AREA_ID);
  const referencedAreaIds = new Set(tasks.map(resolvedAreaId));
  const projectedAreas: ProjectPlanningArea[] = [
    ...[...areaById.values()].filter((area) => referencedAreaIds.has(area.id)),
    ...(hasUnclassified ? [UNCLASSIFIED_AREA] : []),
  ];
  const suppliedGroups = new Map(planGroups.filter((group) => !group.deletedAt).map((group) => [group.id, group]));
  const groups = DEFAULT_GROUPS
    .filter((group) => group.id !== 'unclassified' || hasUnclassified)
    .map((group) => suppliedGroups.get(group.id as LifeMapPlanGroupId) ?? group);

  return {
    tasks: tasks.map((task) => {
      const areaId = resolvedAreaId(task);
      const progress = projectProgress(task);
      const smartTaskCount = task.blocks.filter((block) => block.type === 'smart-task').length;
      return {
        ...task,
        groupId: areaId,
        lifeMapKind: 'plan',
        lifeMapSource: 'timeline-project',
        lifeMapProgress: progress,
        lifeMapMeta: `${smartTaskCount} 项任务 · ${progress}%`,
      };
    }),
    goals: tasks.map((task) => ({
      id: `timeline-project:${task.id}`,
      projectTaskId: task.id,
      areaId: resolvedAreaId(task),
      name: task.name,
      start: task.start,
      targetDate: task.end,
      color: task.color,
      status: task.completed ? 'completed' : 'active',
      progress: projectProgress(task),
      kind: 'plan',
      ...VIEW_STAMP,
    })),
    areas: projectedAreas,
    groups,
  };
}

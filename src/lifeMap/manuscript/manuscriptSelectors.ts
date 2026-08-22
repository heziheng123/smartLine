import type { LifeArea, LifeGoal, LifeMapData, LifeMapPlanGroupId } from '../types';
import { assignVerticalIntervalLanes, assignVerticalIntervalTracks } from '../geometry/verticalIntervalLayout';

export const MANUSCRIPT_CATEGORIES: Array<{ id: LifeMapPlanGroupId; name: string }> = [
  { id: 'learning', name: '学习' }, { id: 'work', name: '工作' }, { id: 'life', name: '生活' },
];

export function getManuscriptAreas(data: LifeMapData, groupId: LifeMapPlanGroupId): LifeArea[] {
  return data.lifeMapAreas.filter((area) => !area.deletedAt && !area.isHidden && area.planGroupId === groupId).sort((a, b) => a.order - b.order);
}

export function getProjectsByCategory(data: LifeMapData, groupId: LifeMapPlanGroupId) {
  const areaIds = new Set(getManuscriptAreas(data, groupId).map((area) => area.id));
  return data.lifeMapGoals.filter((goal) => !goal.deletedAt && goal.kind === 'plan' && areaIds.has(goal.areaId));
}

export function getProjectChildren(data: LifeMapData, projectId: string): LifeGoal[] {
  return data.lifeMapGoals.filter((goal) => !goal.deletedAt && goal.kind === 'phase' && goal.parentGoalId === projectId);
}

export interface ManuscriptProjectStrip extends LifeGoal {
  /** Present only when this visible strip is a child project. */
  parentProject?: LifeGoal;
}

/**
 * A parent with children is a range label, not a lane participant. Its child
 * projects join every other visible strip in the category's shared lane pool.
 * A parent without children remains an independent project strip.
 */
export function getProjectStripsByCategory(data: LifeMapData, groupId: LifeMapPlanGroupId): ManuscriptProjectStrip[] {
  return getProjectsByCategory(data, groupId).flatMap((project) => {
    const children = getProjectChildren(data, project.id);
    return children.length
      ? children.map((child) => ({ ...child, parentProject: project }))
      : [{ ...project }];
  });
}

export function getCategoryProjectTracks(data: LifeMapData, groupId: LifeMapPlanGroupId) {
  return assignVerticalIntervalTracks(getProjectsByCategory(data, groupId).map((item) => ({ ...item, end: item.targetDate })));
}

export function getCategoryProjectLanes(data: LifeMapData, groupId: LifeMapPlanGroupId) {
  return assignVerticalIntervalLanes(getProjectStripsByCategory(data, groupId).map((item) => ({ ...item, end: item.targetDate })));
}

export function getActiveItemsAtDate(data: LifeMapData, date: string) {
  return data.lifeMapGoals.filter((goal) => !goal.deletedAt && goal.kind === 'plan' && goal.start <= date && goal.targetDate >= date);
}

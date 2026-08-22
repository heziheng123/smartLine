import { calculateGoalProgress } from '../metrics';
import { activeLifeMapItems } from '../data';
import type { LifeEvent, LifeGoal, LifeMapData, LifeMapNote, LifeMapStage, LifeSystem } from '../types';
import { addDays, diffDays } from '@/utils/dateSafe';

export type StageWorkspaceZoom = 'month' | 'half-month' | 'week' | 'day';

export interface StageOverlap {
  start: string;
  end: string;
  stageIds: string[];
}

export interface StageContents {
  stage: LifeMapStage;
  plans: LifeGoal[];
  phases: LifeGoal[];
  systems: LifeSystem[];
  systemCheckIns: LifeMapData['lifeMapSystemCheckIns'];
  themes: LifeMapData['lifeMapThemes'];
  focuses: LifeMapData['lifeMapFocuses'];
  rangeNotes: LifeMapNote[];
  pinNotes: LifeMapNote[];
  events: LifeEvent[];
}

export interface StageStats {
  planCount: number;
  completionRate: number;
  activeSystemCount: number;
  systemCheckInCount: number;
}

export interface UnassignedLifeMapContent {
  plans: LifeGoal[];
  systems: LifeSystem[];
  themes: LifeMapData['lifeMapThemes'];
  focuses: LifeMapData['lifeMapFocuses'];
  notes: LifeMapNote[];
  events: LifeEvent[];
  count: number;
}

const overlaps = (start: string, end: string, rangeStart: string, rangeEnd: string) => start <= rangeEnd && end >= rangeStart;
const stageById = (data: LifeMapData, id: string) => getVisibleStages(data).find((stage) => stage.id === id);

export function getVisibleStages(data: Pick<LifeMapData, 'lifeMapStages'>): LifeMapStage[] {
  return activeLifeMapItems(data.lifeMapStages).sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end) || left.id.localeCompare(right.id));
}

export function getVisibleEvents(data: Pick<LifeMapData, 'lifeMapEvents'>): LifeEvent[] {
  return activeLifeMapItems(data.lifeMapEvents).sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));
}

/** Returns each maximal date interval in which at least two visible stages overlap. */
export function getStageOverlaps(data: Pick<LifeMapData, 'lifeMapStages'>): StageOverlap[] {
  const stages = getVisibleStages(data);
  const boundaries = [...new Set(stages.flatMap((stage) => [stage.start, addDays(stage.end, 1)]))].sort();
  const result: StageOverlap[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index];
    const end = addDays(boundaries[index + 1], -1);
    const ids = stages.filter((stage) => overlaps(stage.start, stage.end, start, end)).map((stage) => stage.id);
    if (ids.length < 2) continue;
    const previous = result[result.length - 1];
    if (previous && previous.end === addDays(start, -1) && previous.stageIds.join('|') === ids.join('|')) previous.end = end;
    else result.push({ start, end, stageIds: ids });
  }
  return result;
}

export function getStageContents(data: LifeMapData, stageId: string): StageContents | null {
  const stage = stageById(data, stageId);
  if (!stage) return null;
  const plans = activeLifeMapItems(data.lifeMapGoals).filter((goal) => goal.kind === 'plan' && overlaps(goal.start, goal.targetDate, stage.start, stage.end));
  const planIds = new Set(plans.map((plan) => plan.id));
  const phases = activeLifeMapItems(data.lifeMapGoals).filter((goal) => goal.kind === 'phase' && Boolean(goal.parentGoalId) && planIds.has(goal.parentGoalId!));
  const systems = activeLifeMapItems(data.lifeMapSystems).filter((system) => system.status === 'active' && overlaps(system.start, system.end ?? stage.end, stage.start, stage.end));
  const systemIds = new Set(systems.map((system) => system.id));
  return {
    stage,
    plans,
    phases,
    systems,
    systemCheckIns: activeLifeMapItems(data.lifeMapSystemCheckIns).filter((entry) => systemIds.has(entry.systemId) && entry.date >= stage.start && entry.date <= stage.end),
    themes: activeLifeMapItems(data.lifeMapThemes).filter((item) => overlaps(item.start, item.end, stage.start, stage.end)),
    focuses: activeLifeMapItems(data.lifeMapFocuses).filter((item) => overlaps(item.start, item.end, stage.start, stage.end)),
    rangeNotes: activeLifeMapItems(data.lifeMapNotes).filter((item) => item.type === 'range' && Boolean(item.endDate) && overlaps(item.date, item.endDate!, stage.start, stage.end)),
    pinNotes: activeLifeMapItems(data.lifeMapNotes).filter((item) => item.type === 'pin' && item.date >= stage.start && item.date <= stage.end),
    events: getVisibleEvents(data).filter((event) => event.date >= stage.start && event.date <= stage.end),
  };
}

export function getStageStats(data: LifeMapData, stageId: string): StageStats | null {
  const contents = getStageContents(data, stageId);
  if (!contents) return null;
  const progressItems = [...contents.plans, ...contents.phases];
  return {
    planCount: contents.plans.length,
    completionRate: progressItems.length === 0 ? 0 : Math.round(progressItems.reduce((sum, goal) => sum + calculateGoalProgress(goal), 0) / progressItems.length),
    activeSystemCount: contents.systems.length,
    systemCheckInCount: contents.systemCheckIns.reduce((sum, entry) => sum + entry.count, 0),
  };
}

export function getUnassignedLifeMapContent(data: LifeMapData): UnassignedLifeMapContent {
  const stages = getVisibleStages(data);
  const outside = (start: string, end: string) => !stages.some((stage) => overlaps(start, end, stage.start, stage.end));
  const plans = activeLifeMapItems(data.lifeMapGoals).filter((item) => item.kind === 'plan' && outside(item.start, item.targetDate));
  const systems = activeLifeMapItems(data.lifeMapSystems).filter((item) => outside(item.start, item.end ?? '9999-12-31'));
  const themes = activeLifeMapItems(data.lifeMapThemes).filter((item) => outside(item.start, item.end));
  const focuses = activeLifeMapItems(data.lifeMapFocuses).filter((item) => outside(item.start, item.end));
  const notes = activeLifeMapItems(data.lifeMapNotes).filter((item) => outside(item.date, item.endDate ?? item.date));
  const events = getVisibleEvents(data).filter((item) => outside(item.date, item.date));
  return { plans, systems, themes, focuses, notes, events, count: plans.length + systems.length + themes.length + focuses.length + notes.length + events.length };
}

export function getStageWorkspaceDefaultZoom(stage: Pick<LifeMapStage, 'start' | 'end'>): StageWorkspaceZoom {
  const days = diffDays(stage.end, stage.start) + 1;
  if (days > 365) return 'month';
  if (days >= 90) return 'half-month';
  if (days >= 7) return 'week';
  return 'day';
}

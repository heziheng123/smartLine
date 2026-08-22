import { LIFE_MAP_PLAN_GROUP_META } from './data.ts';
import { addDays } from '@/utils/dateSafe';
import type {
  LifeArea,
  LifeGoal,
  LifeMapPlanGroupId,
  LifeMapPlanGroupPreference,
  LifeMapPlacement,
  LifeSystem,
} from './types';

export const PLAN_SWIMLANE_LABEL_WIDTH = 128;
export const PLAN_SWIMLANE_AXIS_GAP = 18;
export const PLAN_SWIMLANE_GROUP_HEADER_HEIGHT = 32;
export const PLAN_SWIMLANE_GROUP_PADDING = 8;
export const PLAN_SWIMLANE_ROW_PADDING = 6;
export const PLAN_SWIMLANE_TRACK_HEIGHT = 30;

export type LifeMapPlanGroupFilter = 'all' | LifeMapPlanGroupId;
type PlanningGoal = LifeGoal;

export interface PlanTrackAssignment {
  trackById: Map<string, number>;
  trackCount: number;
}

export interface LifeMapPlanSwimlaneBar {
  id: string;
  goalId: string;
  taskId: string;
  kind: 'plan' | 'phase' | 'system';
  parentGoalId?: string;
  rowId: string;
  areaId: string;
  groupId: LifeMapPlanGroupId;
  placement: LifeMapPlacement;
  trackIndex: number;
  top: number;
  left: number;
  width: number;
}

export interface LifeMapPlanSwimlaneRow {
  id: string;
  groupId: LifeMapPlanGroupId;
  areaId: string;
  name: string;
  color: string;
  top: number;
  height: number;
  trackCount: number;
  bars: LifeMapPlanSwimlaneBar[];
}

export interface LifeMapPlanSwimlaneSection {
  id: string;
  groupId: LifeMapPlanGroupId;
  name: string;
  color: string;
  placement: LifeMapPlacement;
  order: number;
  offset: number;
  height: number;
  rows: LifeMapPlanSwimlaneRow[];
}

export interface LifeMapPlanSwimlaneLayout {
  sections: LifeMapPlanSwimlaneSection[];
  rows: LifeMapPlanSwimlaneRow[];
  bars: LifeMapPlanSwimlaneBar[];
  topHeight: number;
  bottomHeight: number;
}

interface LayoutInput {
  plans: PlanningGoal[];
  phases: PlanningGoal[];
  systems?: LifeSystem[];
  areas: LifeArea[];
  groups: LifeMapPlanGroupPreference[];
  filter: LifeMapPlanGroupFilter;
  dateToX: (date: string) => number;
  layoutEnd?: string;
}

export function assignInclusiveIntervalTracks(plans: Pick<LifeGoal, 'id' | 'start' | 'targetDate'>[]): PlanTrackAssignment {
  const trackById = new Map<string, number>();
  const trackEnds: string[] = [];
  [...plans]
    .sort((left, right) => left.start.localeCompare(right.start)
      || left.targetDate.localeCompare(right.targetDate)
      || left.id.localeCompare(right.id))
    .forEach((plan) => {
      const available = trackEnds.findIndex((endExclusive) => endExclusive <= plan.start);
      const trackIndex = available === -1 ? trackEnds.length : available;
      trackEnds[trackIndex] = addDays(plan.targetDate, 1);
      trackById.set(plan.id, trackIndex);
    });
  return { trackById, trackCount: trackEnds.length };
}

export function createLifeMapPlanSwimlaneLayout(input: LayoutInput): LifeMapPlanSwimlaneLayout {
  const plansByArea = new Map<string, PlanningGoal[]>();
  input.plans.filter((plan) => plan.kind === 'plan').forEach((plan) => {
    const items = plansByArea.get(plan.areaId) ?? [];
    items.push(plan);
    plansByArea.set(plan.areaId, items);
  });
  const systemsByArea = new Map<string, LifeSystem[]>();
  (input.systems ?? []).filter((system) => !system.deletedAt && system.status !== 'archived').forEach((system) => {
    const items = systemsByArea.get(system.areaId) ?? [];
    items.push(system);
    systemsByArea.set(system.areaId, items);
  });
  const planById = new Map(input.plans.filter((plan) => plan.kind === 'plan').map((plan) => [plan.id, plan]));
  const phasesByParent = new Map<string, PlanningGoal[]>();
  input.phases.filter((phase) => phase.kind === 'phase' && phase.parentGoalId && planById.has(phase.parentGoalId)).forEach((phase) => {
    const items = phasesByParent.get(phase.parentGoalId!) ?? [];
    items.push(phase);
    phasesByParent.set(phase.parentGoalId!, items);
  });

  const groupPreferences = [...input.groups]
    .filter((group) => input.filter === 'all' || group.id === input.filter)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const draftSections = groupPreferences.flatMap((group) => {
    const groupAreas = input.areas
      .filter((area) => area.planGroupId === group.id)
      .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    if (groupAreas.length === 0) return [];
    let rowTop = PLAN_SWIMLANE_GROUP_PADDING + PLAN_SWIMLANE_GROUP_HEADER_HEIGHT;
    const rows = groupAreas.map((area): LifeMapPlanSwimlaneRow => {
      const areaPlans = plansByArea.get(area.id) ?? [];
      const areaSystems = systemsByArea.get(area.id) ?? [];
      const systemIntervals = areaSystems.map((system) => ({ id: system.id, start: system.start, targetDate: system.end ?? input.layoutEnd ?? system.start }));
      const systemAssignment = assignInclusiveIntervalTracks(systemIntervals);
      const planAssignment = assignInclusiveIntervalTracks(areaPlans);
      const trackCount = Math.max(1, systemAssignment.trackCount + planAssignment.trackCount);
      const height = PLAN_SWIMLANE_ROW_PADDING * 2 + trackCount * PLAN_SWIMLANE_TRACK_HEIGHT;
      const rowId = `plan-row:${group.id}:${area.id}`;
      const systemBars = areaSystems.map((system): LifeMapPlanSwimlaneBar => {
        const trackIndex = systemAssignment.trackById.get(system.id) ?? 0;
        const end = system.end ?? input.layoutEnd ?? system.start;
        const left = input.dateToX(system.start);
        return {
          id: `plan-swimlane:system:${system.id}`,
          goalId: system.id,
          taskId: `system:${system.id}`,
          kind: 'system',
          rowId,
          areaId: area.id,
          groupId: group.id,
          placement: group.placement,
          trackIndex,
          top: rowTop + PLAN_SWIMLANE_ROW_PADDING + trackIndex * PLAN_SWIMLANE_TRACK_HEIGHT,
          left,
          width: Math.max(6, input.dateToX(addDays(end, 1)) - left),
        };
      });
      const planBars = areaPlans.flatMap((plan): LifeMapPlanSwimlaneBar[] => {
        const trackIndex = systemAssignment.trackCount + (planAssignment.trackById.get(plan.id) ?? 0);
        const barTop = rowTop + PLAN_SWIMLANE_ROW_PADDING + trackIndex * PLAN_SWIMLANE_TRACK_HEIGHT;
        const makeBar = (goal: PlanningGoal, kind: 'plan' | 'phase'): LifeMapPlanSwimlaneBar => {
          const left = input.dateToX(goal.start);
          return {
            id: `plan-swimlane:${goal.id}`,
            goalId: goal.id,
            taskId: `goal:${goal.id}`,
            kind,
            parentGoalId: kind === 'phase' ? plan.id : undefined,
            rowId,
            areaId: area.id,
            groupId: group.id,
            placement: group.placement,
            trackIndex,
            top: barTop,
            left,
            width: Math.max(6, input.dateToX(addDays(goal.targetDate, 1)) - left),
          };
        };
        const phaseBars = (phasesByParent.get(plan.id) ?? [])
          .sort((left, right) => left.start.localeCompare(right.start) || left.id.localeCompare(right.id))
          .map((phase) => makeBar(phase, 'phase'));
        return [makeBar(plan, 'plan'), ...phaseBars];
      });
      const bars = [...systemBars, ...planBars];
      const row = { id: rowId, groupId: group.id, areaId: area.id, name: area.name, color: area.color, top: rowTop, height, trackCount, bars };
      rowTop += height;
      return row;
    });
    const groupMeta = LIFE_MAP_PLAN_GROUP_META[group.id];
    return [{
      id: `plan-group:${group.id}`,
      groupId: group.id,
      name: groupMeta.name,
      color: groupMeta.color,
      placement: group.placement,
      order: group.order,
      offset: 0,
      height: rowTop + PLAN_SWIMLANE_GROUP_PADDING,
      rows,
    } satisfies LifeMapPlanSwimlaneSection];
  });

  const sideOffsets: Record<LifeMapPlacement, number> = { above: 0, below: 0 };
  const sections = draftSections.map((section) => {
    const offset = sideOffsets[section.placement];
    sideOffsets[section.placement] += section.height;
    return { ...section, offset };
  });
  const rows = sections.flatMap((section) => section.rows);
  return {
    sections,
    rows,
    bars: rows.flatMap((row) => row.bars),
    topHeight: sideOffsets.above,
    bottomHeight: sideOffsets.below,
  };
}

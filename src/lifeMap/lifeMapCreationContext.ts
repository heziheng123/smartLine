import dayjs from 'dayjs';
import type { LifeGoal, LifeMapData } from './types';

export type LifeMapPrimaryIntent = 'goal' | 'plan' | 'system' | 'event';

export interface LifeMapCreateContext {
  source: 'global' | 'lane' | 'plan' | 'date';
  areaId?: string;
  planId?: string;
  date?: string;
}

export interface LifeMapCreationDefaults {
  areaId?: string;
  parentPlanId?: string;
  date?: string;
}

const activeAreas = (data: LifeMapData) => data.lifeMapAreas
  .filter((area) => !area.deletedAt && !area.isHidden)
  .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));

export function resolveLifeMapCreationDefaults(
  intent: LifeMapPrimaryIntent,
  context: LifeMapCreateContext,
  data: LifeMapData,
  lastUsedAreaIds: Partial<Record<LifeMapPrimaryIntent, string>>,
): LifeMapCreationDefaults {
  if (intent === 'event') return context.date ? { date: context.date } : {};

  const areas = activeAreas(data);
  const areaIds = new Set(areas.map((area) => area.id));
  const parent = context.planId
    ? data.lifeMapGoals.find((goal) => !goal.deletedAt && goal.id === context.planId && goal.kind === 'plan')
    : undefined;
  const areaId = parent?.areaId
    ?? (context.areaId && areaIds.has(context.areaId) ? context.areaId : undefined)
    ?? (lastUsedAreaIds[intent] && areaIds.has(lastUsedAreaIds[intent]!) ? lastUsedAreaIds[intent] : undefined)
    ?? areas[0]?.id;

  return {
    ...(areaId ? { areaId } : {}),
    ...(parent ? { parentPlanId: parent.id } : {}),
    ...(context.date ? { date: context.date } : {}),
  };
}

export function findFirstAvailablePhaseRange(
  plan: LifeGoal,
  phases: LifeGoal[],
): { start: string; end: string } | null {
  const relevant = phases
    .filter((phase) => !phase.deletedAt
      && phase.kind === 'phase'
      && phase.parentGoalId === plan.id
      && phase.targetDate >= plan.start
      && phase.start <= plan.targetDate)
    .map((phase) => ({
      start: phase.start < plan.start ? plan.start : phase.start,
      end: phase.targetDate > plan.targetDate ? plan.targetDate : phase.targetDate,
    }))
    .sort((left, right) => left.start.localeCompare(right.start) || left.end.localeCompare(right.end));

  let cursor = plan.start;
  for (const phase of relevant) {
    if (phase.start > cursor) {
      return { start: cursor, end: dayjs(phase.start).subtract(1, 'day').format('YYYY-MM-DD') };
    }
    if (phase.end >= cursor) cursor = dayjs(phase.end).add(1, 'day').format('YYYY-MM-DD');
    if (cursor > plan.targetDate) return null;
  }
  return cursor <= plan.targetDate ? { start: cursor, end: plan.targetDate } : null;
}

import type { LifeMapData, LifeMapLayoutLane, LifeMapPlacement } from './types';

export interface LifeMapPeriodFocus {
  sourceKind: 'theme' | 'focus' | 'range-note';
  sourceId: string;
  areaId: string;
  name: string;
  start: string;
  end: string;
  color?: string;
  placement?: LifeMapPlacement;
  layoutLane?: LifeMapLayoutLane;
}

export function createLifeMapPeriodFocusItems(data: Pick<LifeMapData, 'lifeMapThemes' | 'lifeMapFocuses' | 'lifeMapNotes'>): LifeMapPeriodFocus[] {
  const themes: LifeMapPeriodFocus[] = data.lifeMapThemes
    .filter((item) => !item.deletedAt)
    .map((item) => ({
      sourceKind: 'theme', sourceId: item.id, areaId: item.areaId, name: item.name,
      start: item.start, end: item.end, color: item.color, placement: item.placement, layoutLane: item.layoutLane,
    }));
  const focuses: LifeMapPeriodFocus[] = data.lifeMapFocuses
    .filter((item) => !item.deletedAt)
    .map((item) => ({
      sourceKind: 'focus', sourceId: item.id, areaId: item.areaId, name: item.name,
      start: item.start, end: item.end, color: item.color, placement: item.placement, layoutLane: item.layoutLane,
    }));
  const rangeNotes: LifeMapPeriodFocus[] = data.lifeMapNotes
    .filter((item) => !item.deletedAt && item.type === 'range' && Boolean(item.endDate))
    .map((item) => ({
      sourceKind: 'range-note', sourceId: item.id, areaId: item.areaId, name: item.name,
      start: item.date, end: item.endDate!, color: item.color, placement: item.placement, layoutLane: item.layoutLane,
    }));
  return [...themes, ...focuses, ...rangeNotes]
    .sort((left, right) => left.start.localeCompare(right.start)
      || left.end.localeCompare(right.end)
      || left.sourceId.localeCompare(right.sourceId));
}

import { addDays, diffDays, getDayOfWeek, todayStr } from '@/utils/dateSafe';
import type { TimelineSection } from '../model';
import { timelineStatus, timelineVisibleItems, type TimelineProjectionItem } from '../timelineProjection';
import { buildTimelineTicks, createTimelineCoordinates, dateToX } from '../timelineLayout';

export type TimelineVisibility = { stages: boolean; milestones: boolean; progress: boolean; today: boolean };
export const DEFAULT_TIMELINE_VISIBILITY: TimelineVisibility = { stages: true, milestones: true, progress: true, today: true };
export type TimelineFocus = 'all' | 'active' | 'upcoming' | 'overdue';
export type TimelineDensity = 'overview' | 'compact' | 'detail';

export interface TimelineLane {
  id: string;
  title: string;
  color: string;
  startRow: number;
  rowCount: number;
}

export type TimelineTemporalState = 'normal' | 'active' | 'upcoming' | 'overdue' | 'done';

const dateAfter = (start: string, days: number) => {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

export const mindMapTimelineRange = (timeline: TimelineSection, items: TimelineProjectionItem[]) => {
  const today = todayStr();
  const fallbackDays = timeline.scale === 'week' ? 6 : timeline.scale === 'month' ? 30 : 365;
  const earliestItemStart = items.reduce((earliest, item) => !earliest || item.start < earliest ? item.start : earliest, '');
  const start = (timeline.rangeStart ?? earliestItemStart) || today;
  const end = timeline.rangeEnd ?? (items.reduce((latest, item) => item.end > latest ? item.end : latest, '') || dateAfter(start, fallbackDays));
  return { start, end: end >= start ? end : start };
};

export function timelineTemporalState(item: TimelineProjectionItem, today: string): TimelineTemporalState {
  if (item.progress === 100) return 'done';
  if (item.end < today && item.progress !== undefined) return 'overdue';
  if (item.shape === 'range' && item.start <= today && item.end >= today) return 'active';
  if (item.start > today && item.start <= addDays(today, 14)) return 'upcoming';
  return 'normal';
}

const matchesFocus = (item: TimelineProjectionItem, today: string, focus: TimelineFocus) => (
  focus === 'all' || timelineTemporalState(item, today) === focus
);

const orderRowsByLane = (items: TimelineProjectionItem[]) => {
  const children = new Map<string, TimelineProjectionItem[]>();
  for (const item of items) {
    if (!item.parentId) continue;
    children.set(item.parentId, [...(children.get(item.parentId) ?? []), item]);
  }
  const ordered: TimelineProjectionItem[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id) || item.parentId) continue;
    ordered.push(item);
    seen.add(item.id);
    for (const child of children.get(item.id) ?? []) {
      ordered.push(child);
      seen.add(child.id);
    }
  }
  for (const item of items) if (!seen.has(item.id)) ordered.push(item);
  return ordered;
};

export function buildMindMapTimelineLayer(
  timeline: TimelineSection,
  allItems: TimelineProjectionItem[],
  cameraScale: number,
  visibility: TimelineVisibility,
  focus: TimelineFocus = 'all',
) {
  const range = mindMapTimelineRange(timeline, allItems);
  const summaryMode = cameraScale < 0.45;
  const detailThreshold = timeline.scale === 'week' ? 0.78 : timeline.scale === 'month' ? 0.86 : 1.05;
  const density: TimelineDensity = summaryMode ? 'overview' : cameraScale >= detailThreshold ? 'detail' : 'compact';
  const lodItems = summaryMode
    ? []
    : allItems.filter((item) => density === 'detail' || (item.kind !== 'task' && item.kind !== 'note'));
  const rangedItems = timelineVisibleItems(lodItems, range.start, range.end, Number.MAX_SAFE_INTEGER);
  const today = todayStr();
  const focusedIds = new Set(rangedItems.filter((item) => matchesFocus(item, today, focus)).map((item) => item.id));
  for (const item of rangedItems) if (item.parentId && focusedIds.has(item.id)) focusedIds.add(item.parentId);
  const visibleItems = focus === 'all' ? rangedItems : rangedItems.filter((item) => focusedIds.has(item.id));
  const stageCandidates = visibility.stages && focus === 'all' ? visibleItems.filter((item) => item.kind === 'stage') : [];
  const milestoneCandidates = visibility.milestones ? visibleItems.filter((item) => item.kind === 'milestone' || item.shape === 'marker') : [];
  const rowCandidates = orderRowsByLane(visibleItems.filter((item) => item.kind !== 'stage' && item.kind !== 'milestone' && item.shape !== 'marker'));
  const headerHeight = 52;
  const axisHeight = 76;
  const axisLineY = 64;
  const stageRowHeight = 26;
  const maximumStageRows = Math.max(0, Math.floor((timeline.height - headerHeight - axisHeight - 116) / stageRowHeight));
  const stages = stageCandidates.slice(0, maximumStageRows);
  const stageHeight = stages.length ? stages.length * stageRowHeight + 8 : 8;
  const coordinates = createTimelineCoordinates(range.start, range.end, timeline.width);
  const maximumMilestoneStack = Math.max(1, Math.floor((timeline.height - headerHeight - axisHeight - stageHeight - 110) / 14));
  const milestoneBuckets = new Map<number, number>();
  const milestoneOverflowByBucket = new Map<number, { date: string; count: number; stack: number }>();
  const milestoneLayouts = milestoneCandidates.flatMap((item) => {
    const bucket = Math.round(dateToX(item.start, coordinates) / 58);
    const stack = milestoneBuckets.get(bucket) ?? 0;
    milestoneBuckets.set(bucket, stack + 1);
    if (stack < maximumMilestoneStack) return [{ item, stack }];
    const overflow = milestoneOverflowByBucket.get(bucket);
    milestoneOverflowByBucket.set(bucket, { date: overflow?.date ?? item.start, count: (overflow?.count ?? 0) + 1, stack: maximumMilestoneStack });
    return [];
  });
  const milestoneOverflow = [...milestoneOverflowByBucket.values()];
  const milestoneStackHeight = Math.max(0, ...Array.from(milestoneBuckets.values(), (count) => Math.min(count, maximumMilestoneStack)));
  const milestoneHeight = milestoneLayouts.length || milestoneOverflow.length ? 12 + (milestoneStackHeight + (milestoneOverflow.length ? 1 : 0)) * 14 : 18;
  const rowAreaHeight = Math.max(32, timeline.height - headerHeight - axisHeight - stageHeight - milestoneHeight - 18);
  const maximumRows = Math.max(1, Math.floor(rowAreaHeight / 34));
  const items = rowCandidates.slice(0, maximumRows);
  const rowStep = items.length ? Math.min(52, Math.max(34, rowAreaHeight / items.length)) : 40;
  const rowsTop = axisHeight + stageHeight + Math.max(0, (rowAreaHeight - rowStep * items.length) / 2);
  const milestoneTop = timeline.height - headerHeight - milestoneHeight;
  const ticks = buildTimelineTicks({ rangeStart: range.start, rangeEnd: range.end, plotWidth: coordinates.plotWidth, scale: timeline.scale });
  const projects = new Map(allItems.filter((item) => item.kind === 'project').map((item) => [item.id, item]));
  const lanes = items.reduce<TimelineLane[]>((result, item, row) => {
    const laneId = item.kind === 'project' ? item.id : item.parentId ?? item.id;
    const previous = result.at(-1);
    if (previous?.id === laneId) {
      previous.rowCount += 1;
      return result;
    }
    const project = projects.get(laneId);
    result.push({ id: laneId, title: project?.title ?? item.title, color: project?.color ?? item.color, startRow: row, rowCount: 1 });
    return result;
  }, []);
  const rangeDays = diffDays(range.end, range.start);
  const weekends = rangeDays <= 62 ? Array.from({ length: rangeDays + 1 }, (_, offset) => addDays(range.start, offset))
    .filter((date) => [0, 6].includes(getDayOfWeek(date)))
    .map((date) => ({ start: dateToX(date, coordinates), end: dateToX(addDays(date, 1), coordinates) })) : [];
  const baseStatus = timelineStatus(allItems, today);
  const status = {
    ...baseStatus,
    upcoming: allItems.filter((item) => timelineTemporalState(item, today) === 'upcoming').length,
  };
  return {
    range, summaryMode, density, focus, rowCandidates, headerHeight, axisHeight, axisLineY, stageRowHeight, stages,
    milestones: milestoneLayouts.map(({ item }) => item), milestoneLayouts, milestoneOverflow,
    items, lanes, rowStep, rowsTop, milestoneTop, milestoneHeight, coordinates, ticks, weekends, today,
    todayVisible: visibility.today && today >= range.start && today <= range.end, status,
  };
}

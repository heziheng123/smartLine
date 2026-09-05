import { addDays, diffDays, getDayOfWeek, isValidCalendarDate, splitDate } from '@/utils/dateSafe';
import type { TimelineSection } from './model';

export interface TimelineCoordinates {
  rangeStart: string;
  rangeEnd: string;
  plotLeft: number;
  plotRight: number;
  plotWidth: number;
  totalDays: number;
}

export interface TimelineTick {
  date: string;
  label: string;
  sublabel?: string;
  kind: 'major' | 'minor';
}

export function resizeTimelineRect(
  initial: Pick<TimelineSection, 'x' | 'y' | 'width' | 'height'>,
  dx: number,
  dy: number,
) {
  const constrainedDx = Math.max(-initial.width + 320, dx);
  const constrainedDy = Math.max(-initial.height + 180, dy);
  return {
    x: initial.x + constrainedDx / 2,
    y: initial.y + constrainedDy / 2,
    width: initial.width + constrainedDx,
    height: initial.height + constrainedDy,
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function createTimelineCoordinates(
  rangeStart: string,
  rangeEnd: string,
  sectionWidth: number,
  labelColumnWidth = Math.min(132, Math.max(110, sectionWidth * 0.2)),
  rightPadding = 24,
): TimelineCoordinates {
  const totalDays = Math.max(1, diffDays(rangeEnd, rangeStart));
  const plotLeft = Math.min(sectionWidth - 64, labelColumnWidth);
  const plotRight = Math.max(plotLeft + 40, sectionWidth - rightPadding);
  return { rangeStart, rangeEnd, plotLeft, plotRight, plotWidth: plotRight - plotLeft, totalDays };
}

export function dateToX(date: string, coordinates: TimelineCoordinates): number {
  const days = Math.max(0, Math.min(coordinates.totalDays, diffDays(date, coordinates.rangeStart)));
  return coordinates.plotLeft + days / coordinates.totalDays * coordinates.plotWidth;
}

export function xToDate(x: number, coordinates: TimelineCoordinates): string {
  const ratio = Math.max(0, Math.min(1, (x - coordinates.plotLeft) / coordinates.plotWidth));
  return addDays(coordinates.rangeStart, Math.round(ratio * coordinates.totalDays));
}

const isoDate = (year: number, monthIndex: number, day: number) => (
  `${String(year).padStart(4, '0')}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

const nextMonth = (date: string) => {
  const { year, month } = splitDate(date);
  return month === 12 ? isoDate(year + 1, 0, 1) : isoDate(year, month, 1);
};

const monthlyTicks = (start: string, end: string, plotWidth: number): TimelineTick[] => {
  const dates = [start];
  for (let date = nextMonth(start); date <= end; date = nextMonth(date)) dates.push(date);
  const step = Math.max(1, Math.ceil(dates.length / Math.max(1, Math.floor(plotWidth / 54))));
  return dates.filter((_, index) => index % step === 0).map((date) => ({
    date,
    label: MONTHS[splitDate(date).month - 1],
    kind: 'major',
  }));
};

const weeklyMinorTicks = (start: string, end: string): TimelineTick[] => {
  const offset = (8 - getDayOfWeek(start)) % 7;
  const ticks: TimelineTick[] = [];
  for (let date = addDays(start, offset); date <= end; date = addDays(date, 7)) {
    if (date !== start) ticks.push({ date, label: '', kind: 'minor' });
  }
  return ticks;
};

const dayTicks = (start: string, end: string, plotWidth: number): TimelineTick[] => {
  const days = diffDays(end, start);
  const startParts = splitDate(start);
  const endParts = splitDate(end);
  const singleMonth = startParts.year === endParts.year && startParts.month === endParts.month;
  if (singleMonth && startParts.day <= 2 && endParts.day >= 28) {
    const values = [startParts.day, 5, 10, 15, 20, 25, endParts.day]
      .filter((day, index, all) => day >= startParts.day && day <= endParts.day && all.indexOf(day) === index);
    return values.map((day) => ({ date: isoDate(startParts.year, startParts.month - 1, day), label: String(day), kind: 'major' }));
  }
  const minimumSpacing = 58;
  const targetStep = Math.max(1, Math.ceil(days / Math.max(1, Math.floor(plotWidth / minimumSpacing))));
  const step = [1, 2, 3, 5, 7, 10, 14].find((value) => value >= targetStep) ?? 14;
  const dates: string[] = [];
  for (let offset = 0; offset <= days; offset += step) dates.push(addDays(start, offset));
  if (dates.at(-1) !== end) dates.push(end);
  return dates.map((date) => {
    const parts = splitDate(date);
    return { date, label: singleMonth ? String(parts.day) : `${parts.month}/${parts.day}`, kind: 'major' };
  });
};

export function buildTimelineTicks(options: {
  rangeStart: string;
  rangeEnd: string;
  plotWidth: number;
  scale: 'long-range' | 'month' | 'week';
}): TimelineTick[] {
  const { rangeStart: start, rangeEnd: end, plotWidth, scale } = options;
  if (!isValidCalendarDate(start) || !isValidCalendarDate(end) || end < start) return [];
  const days = diffDays(end, start);
  if (days <= 14) {
    return Array.from({ length: days + 1 }, (_, offset) => {
      const date = addDays(start, offset);
      return { date, label: WEEKDAYS[getDayOfWeek(date)], sublabel: String(splitDate(date).day), kind: 'major' as const };
    });
  }
  if (days <= 60) return dayTicks(start, end, plotWidth);
  const major = monthlyTicks(start, end, plotWidth);
  return days < 150 && scale === 'week' ? [...major, ...weeklyMinorTicks(start, end)] : major;
}

export function formatTimelineRange(start: string, end: string): string {
  const left = splitDate(start);
  const right = splitDate(end);
  if (left.year === right.year && left.month === right.month) return `${left.year} 年 ${left.month} 月`;
  return left.year === right.year
    ? `${left.year} 年 ${left.month}–${right.month} 月`
    : `${left.year} 年 ${left.month} 月–${right.year} 年 ${right.month} 月`;
}

export const timelineScaleLabel = (scale: 'long-range' | 'month' | 'week') => (
  scale === 'long-range' ? '长期' : scale === 'month' ? '月' : '周'
);

export function recommendedTimelineHeight(items: Array<{ kind: string; shape: 'range' | 'marker'; start?: string }>): number {
  const stages = items.filter((item) => item.kind === 'stage').length;
  const milestoneStacks = new Map<string, number>();
  for (const item of items) {
    if (item.kind !== 'milestone' && item.shape !== 'marker') continue;
    const key = item.start ?? '';
    milestoneStacks.set(key, (milestoneStacks.get(key) ?? 0) + 1);
  }
  const milestoneStack = Math.max(0, ...milestoneStacks.values());
  const rows = items.filter((item) => item.kind !== 'stage' && item.kind !== 'milestone' && item.shape !== 'marker').length;
  return Math.max(300, Math.min(2_000, 48 + 52 + (stages ? stages * 26 + 8 : 8) + Math.max(2, rows) * 40 + (milestoneStack ? 12 + milestoneStack * 14 : 18) + 18));
}

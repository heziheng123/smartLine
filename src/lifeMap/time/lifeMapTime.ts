import type { LifeMapData } from '../types';
import { addDays, diffDays, isValidCalendarDate } from '@/utils/dateSafe';

export interface LifeMapDateRange {
  minDate: string;
  maxDate: string;
  baseDate: string;
}

export interface LifeMapTimeMapper {
  baseDate: string;
  pixelsPerDay: number;
  dateToWorldY: (date: string) => number;
  worldYToDate: (worldY: number) => string;
}

/**
 * Returns the vertical world range for the v13 canvas. Deliberately excludes
 * projects, systems and notes: auxiliary content must never stretch the main
 * life path away from the user's actual stages, events and today.
 */
export function getLifeMapDateRange(data: Pick<LifeMapData, 'lifeMapStages' | 'lifeMapEvents'>, today: string): LifeMapDateRange {
  if (!isValidCalendarDate(today)) throw new Error(`Invalid life-map date: ${today}`);
  const dates = [today];
  data.lifeMapStages.forEach((stage) => {
    if (!stage.deletedAt) dates.push(stage.start, stage.end);
  });
  data.lifeMapEvents.forEach((event) => {
    if (!event.deletedAt) dates.push(event.date);
  });
  const validDates = dates.filter(isValidCalendarDate).sort();
  return {
    minDate: addDays(validDates[0] ?? today, -90),
    maxDate: addDays(validDates[validDates.length - 1] ?? today, 90),
    baseDate: addDays(validDates[0] ?? today, -90),
  };
}

/** The v14 manuscript range includes every dated entity, while open systems
 * stop at today so a long-running habit never creates an infinite canvas. */
export function getManuscriptDateRange(data: LifeMapData, today: string): LifeMapDateRange {
  if (!isValidCalendarDate(today)) throw new Error(`Invalid life-map date: ${today}`);
  const dates = [today];
  const addRange = (item: { start?: string; end?: string; date?: string; endDate?: string; targetDate?: string; deletedAt?: string }) => {
    if (item.deletedAt) return;
    [item.start, item.end, item.date, item.endDate, item.targetDate].forEach((date) => { if (date && isValidCalendarDate(date)) dates.push(date); });
  };
  data.lifeMapStages.forEach(addRange);
  data.lifeMapGoals.forEach(addRange);
  data.lifeMapEvents.forEach(addRange);
  data.lifeMapNotes.forEach(addRange);
  data.lifeMapSystems.forEach((system) => addRange({ start: system.start, end: system.end ?? today, deletedAt: system.deletedAt }));
  const validDates = dates.sort();
  return { minDate: addDays(validDates[0] ?? today, -75), maxDate: addDays(validDates[validDates.length - 1] ?? today, 75), baseDate: addDays(validDates[0] ?? today, -75) };
}

export function createLifeMapTimeMapper(baseDate: string, pixelsPerDay: number): LifeMapTimeMapper {
  if (!isValidCalendarDate(baseDate)) throw new Error(`Invalid life-map base date: ${baseDate}`);
  if (!Number.isFinite(pixelsPerDay) || pixelsPerDay <= 0) throw new Error('pixelsPerDay must be positive.');
  return {
    baseDate,
    pixelsPerDay,
    dateToWorldY: (date) => {
      if (!isValidCalendarDate(date)) throw new Error(`Invalid life-map date: ${date}`);
      return diffDays(date, baseDate) * pixelsPerDay;
    },
    worldYToDate: (worldY) => addDays(baseDate, Math.round(worldY / pixelsPerDay)),
  };
}

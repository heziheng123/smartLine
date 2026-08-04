import dayjs, { type Dayjs } from 'dayjs';
import type { LifeMaintenancePeriod } from './types';

export function maintenanceEnd(period: LifeMaintenancePeriod, fallback: Dayjs = dayjs()): Dayjs {
  return period.end ? dayjs(period.end).subtract(1, 'day').endOf('day') : fallback.endOf('day');
}

export function isMaintenanceActive(periods: LifeMaintenancePeriod[] | undefined, reference: Dayjs = dayjs()): boolean {
  return Boolean(periods?.some((period) => {
    const start = dayjs(period.start).startOf('day');
    const resumeDate = period.end ? dayjs(period.end).startOf('day') : null;
    return !reference.isBefore(start, 'day') && (!resumeDate || reference.isBefore(resumeDate, 'day'));
  }));
}

export function activeMaintenancePeriod(periods: LifeMaintenancePeriod[] | undefined, reference: Dayjs = dayjs()): LifeMaintenancePeriod | undefined {
  return periods?.find((period) => {
    const start = dayjs(period.start).startOf('day');
    const resumeDate = period.end ? dayjs(period.end).startOf('day') : null;
    return !reference.isBefore(start, 'day') && (!resumeDate || reference.isBefore(resumeDate, 'day'));
  });
}

export function isDateInMaintenance(dateValue: Dayjs | string, periods: LifeMaintenancePeriod[] | undefined): boolean {
  const date = dayjs(dateValue).startOf('day');
  return Boolean(periods?.some((period) => {
    const start = dayjs(period.start).startOf('day');
    const resumeDate = period.end ? dayjs(period.end).startOf('day') : dayjs('9999-12-31').startOf('day');
    return !date.isBefore(start, 'day') && date.isBefore(resumeDate, 'day');
  }));
}

export function mergeMaintenancePeriods(...collections: Array<LifeMaintenancePeriod[] | undefined>): LifeMaintenancePeriod[] {
  const byId = new Map<string, LifeMaintenancePeriod>();
  collections.flatMap((items) => items ?? []).forEach((period) => byId.set(period.id, period));
  return [...byId.values()].sort((left, right) => left.start.localeCompare(right.start));
}

export function maintenanceDayCount(periods: LifeMaintenancePeriod[] | undefined, startValue: Dayjs | string, endValue: Dayjs | string): number {
  let count = 0;
  let cursor = dayjs(startValue).startOf('day');
  const last = dayjs(endValue).startOf('day');
  while (!cursor.isAfter(last, 'day')) {
    if (isDateInMaintenance(cursor, periods)) count += 1;
    cursor = cursor.add(1, 'day');
  }
  return count;
}

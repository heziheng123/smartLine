import dayjs, { type Dayjs } from 'dayjs';
import type { LifeGoal, LifeSystem, LifeSystemCheckIn } from './types';

const clampPercent = (value: number) => Math.min(100, Math.max(0, Math.round(value)));

export function calculateGoalProgress(goal: Pick<LifeGoal, 'progress' | 'progressMode' | 'initialValue' | 'currentValue' | 'targetValue'>): number {
  if (goal.progressMode !== 'auto') return clampPercent(goal.progress ?? 0);
  const { initialValue, currentValue, targetValue } = goal;
  if (![initialValue, currentValue, targetValue].every((value) => typeof value === 'number' && Number.isFinite(value))) {
    return clampPercent(goal.progress ?? 0);
  }
  const distance = (targetValue as number) - (initialValue as number);
  if (distance === 0) return (currentValue as number) === targetValue ? 100 : 0;
  return clampPercent((((currentValue as number) - (initialValue as number)) / distance) * 100);
}

export function systemPeriodRange(frequency: LifeSystem['frequency'], reference: Dayjs = dayjs()): { start: Dayjs; end: Dayjs; label: string } {
  if (frequency === 'daily') return { start: reference.startOf('day'), end: reference.endOf('day'), label: '今天' };
  if (frequency === 'monthly') return { start: reference.startOf('month'), end: reference.endOf('month'), label: '本月' };
  const start = reference.day() === 0 ? reference.subtract(6, 'day').startOf('day') : reference.startOf('week').add(1, 'day');
  return { start, end: start.add(6, 'day').endOf('day'), label: '本周' };
}

function activeRange(system: LifeSystem, start: Dayjs, end: Dayjs): { start: Dayjs; end: Dayjs } | null {
  const systemStart = dayjs(system.start).startOf('day');
  const systemEnd = system.end ? dayjs(system.end).endOf('day') : end;
  const actualStart = systemStart.isAfter(start) ? systemStart : start;
  const actualEnd = systemEnd.isBefore(end) ? systemEnd : end;
  return actualEnd.isBefore(actualStart, 'day') ? null : { start: actualStart, end: actualEnd };
}

export function systemTargetForRange(system: LifeSystem, rangeStart: string | Dayjs, rangeEnd: string | Dayjs): number {
  const start = dayjs(rangeStart).startOf('day');
  const end = dayjs(rangeEnd).endOf('day');
  const range = activeRange(system, start, end);
  if (!range) return 0;
  if (system.frequency === 'daily') return (range.end.startOf('day').diff(range.start.startOf('day'), 'day') + 1) * system.targetCount;
  if (system.frequency === 'monthly') {
    let cursor = range.start.startOf('month');
    let periods = 0;
    while (!cursor.isAfter(range.end, 'day')) {
      periods += 1;
      cursor = cursor.add(1, 'month');
    }
    return periods * system.targetCount;
  }
  let cursor = systemPeriodRange('weekly', range.start).start;
  let periods = 0;
  while (!cursor.isAfter(range.end, 'day')) {
    periods += 1;
    cursor = cursor.add(7, 'day');
  }
  return periods * system.targetCount;
}

export function systemCompletedForRange(checkIns: LifeSystemCheckIn[], systemId: string, rangeStart: string | Dayjs, rangeEnd: string | Dayjs): number {
  const start = dayjs(rangeStart).format('YYYY-MM-DD');
  const end = dayjs(rangeEnd).format('YYYY-MM-DD');
  return checkIns
    .filter((entry) => entry.systemId === systemId && !entry.deletedAt && entry.date >= start && entry.date <= end)
    .reduce((sum, entry) => sum + entry.count, 0);
}

export function currentSystemStats(system: LifeSystem, checkIns: LifeSystemCheckIn[], reference: Dayjs = dayjs()): { completed: number; target: number; label: string; start: string; end: string } {
  const period = systemPeriodRange(system.frequency, reference);
  return {
    completed: systemCompletedForRange(checkIns, system.id, period.start, period.end),
    target: system.targetCount,
    label: period.label,
    start: period.start.format('YYYY-MM-DD'),
    end: period.end.format('YYYY-MM-DD'),
  };
}

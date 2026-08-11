import type { DaySchedule, ScheduledItem, TimeBlock, TimeSlot } from '../components/dailySchedule/types.ts';
import { getProjectBlockSourceId } from '../components/dailySchedule/sourceIds.ts';
import type { Block, SmartTaskBlock, Task } from '../types/index.ts';
import { addDays, isValidCalendarDate } from '../utils/dateSafe.ts';

const getProjectTaskBlocks = (blocks: Block[]): SmartTaskBlock[] =>
  blocks.filter((block): block is SmartTaskBlock => block.type === 'smart-task');

const isContinuousTask = (block: SmartTaskBlock): boolean =>
  block.header.taskKind === 'quantity' || block.header.taskKind === 'vocabulary';

export interface ProjectShiftTaskPreview {
  blockId: string;
  sourceId: string;
  title: string;
  fromDate: string;
  toDate: string;
  deadline?: string;
  exceedsDeadline: boolean;
}

export interface ProjectShiftPlan {
  days: number;
  previousTask: Task;
  nextTask: Task;
  tasks: ProjectShiftTaskPreview[];
  skippedCompleted: number;
  skippedUnscheduled: number;
  skippedInvalidDates: number;
  skippedContinuous: number;
  skippedArchived: number;
  shiftedStart: string;
  shiftedEnd: string;
}

export interface ProjectDailyShiftPlan {
  previousSchedules: Record<string, DaySchedule>;
  nextSchedules: Record<string, DaySchedule>;
  movedSlotItems: number;
  movedTimeBlocks: number;
  collisionFallbacks: number;
}

const cloneSchedules = (schedules: Record<string, DaySchedule>): Record<string, DaySchedule> =>
  Object.fromEntries(Object.entries(schedules).map(([date, day]) => [date, {
    ...day,
    items: (day.items ?? []).map((item) => ({ ...item })),
    blocks: (day.blocks ?? []).map((block) => ({ ...block })),
  }]));

const slotForTime = (time: string): TimeSlot => {
  const hour = Number.parseInt(time.slice(0, 2), 10);
  if (hour < 12) return 'morning';
  if (hour < 18) return 'afternoon';
  return 'evening';
};

const durationBetween = (startTime: string, endTime: string): number => {
  const [startHour, startMinute] = startTime.split(':').map(Number);
  const [endHour, endMinute] = endTime.split(':').map(Number);
  return Math.max(5, (endHour * 60 + endMinute) - (startHour * 60 + startMinute));
};

const overlaps = (candidate: TimeBlock, existing: TimeBlock[]): boolean => existing.some((block) =>
  candidate.startTime < block.endTime && candidate.endTime > block.startTime,
);

const nextSlotOrder = (items: ScheduledItem[], timeSlot: TimeSlot): number =>
  items.reduce((highest, item) => (
    item.timeSlot === timeSlot && Number.isFinite(item.order)
      ? Math.max(highest, item.order)
      : highest
  ), -1) + 1;

function shiftBlock(block: Block, days: number, previews: ProjectShiftTaskPreview[], taskId: string): Block {
  if (block.type !== 'smart-task') return block;
  const { header } = block;
  if (header.isCompleted || header.isArchived || header.frozenAt || !header.date
    || !isValidCalendarDate(header.date) || isContinuousTask(block)) return block;
  const toDate = addDays(header.date, days);
  previews.push({
    blockId: block.id,
    sourceId: getProjectBlockSourceId(taskId, block.id),
    title: header.title,
    fromDate: header.date,
    toDate,
    deadline: header.deadline,
    exceedsDeadline: Boolean(header.deadline && toDate > header.deadline),
  });
  return {
    ...block,
    header: {
      ...header,
      date: toDate,
      frozenAt: undefined,
    },
  };
}

export function planProjectShift(task: Task, rawDays: number): ProjectShiftPlan {
  if (!Number.isInteger(rawDays) || rawDays === 0 || Math.abs(rawDays) > 365) {
    throw new Error('顺延天数必须是 -365 到 365 之间的非零整数');
  }
  const days = rawDays;
  if (!isValidCalendarDate(task.start) || !isValidCalendarDate(task.end)) {
    throw new Error('项目起止日期无效，请先修复项目日期');
  }

  const smartBlocks = getProjectTaskBlocks(task.blocks ?? []);
  const tasks: ProjectShiftTaskPreview[] = [];
  const nextBlocks = (task.blocks ?? []).map((block) => shiftBlock(block, days, tasks, task.id));
  const nextTask: Task = {
    ...task,
    start: addDays(task.start, days),
    end: addDays(task.end, days),
    blocks: nextBlocks,
    blocksUpdatedAt: new Date().toISOString(),
  };

  return {
    days,
    previousTask: task,
    nextTask,
    tasks,
    skippedCompleted: smartBlocks.filter((block) => block.header.isCompleted).length,
    skippedArchived: smartBlocks.filter((block) => block.header.isArchived).length,
    skippedUnscheduled: smartBlocks.filter((block) => !block.header.isCompleted && !block.header.isArchived && !block.header.frozenAt && !block.header.date).length,
    skippedInvalidDates: smartBlocks.filter((block) => !block.header.isCompleted && !block.header.isArchived
      && !block.header.frozenAt && Boolean(block.header.date) && !isValidCalendarDate(block.header.date!)).length,
    skippedContinuous: smartBlocks.filter((block) => !block.header.isCompleted && !block.header.isArchived && !block.header.frozenAt && Boolean(block.header.date) && isContinuousTask(block)).length,
    shiftedStart: nextTask.start,
    shiftedEnd: nextTask.end,
  };
}

export function planProjectDailyShift(
  schedules: Record<string, DaySchedule>,
  tasks: ProjectShiftTaskPreview[],
): ProjectDailyShiftPlan {
  const previousSchedules = cloneSchedules(schedules);
  const nextSchedules = cloneSchedules(schedules);
  const targetBySourceId = new Map(tasks.map((task) => [task.sourceId, task.toDate]));
  const movedItems: Array<{ targetDate: string; item: ScheduledItem }> = [];
  const movedBlocks: Array<{ targetDate: string; block: TimeBlock }> = [];

  for (const [date, day] of Object.entries(nextSchedules)) {
    const items = day.items.filter((item) => {
      const targetDate = targetBySourceId.get(item.sourceId);
      if (!targetDate) return true;
      movedItems.push({ targetDate, item: { ...item } });
      return false;
    });
    const blocks = day.blocks.filter((block) => {
      const targetDate = targetBySourceId.get(block.sourceId);
      if (!targetDate) return true;
      movedBlocks.push({ targetDate, block: { ...block } });
      return false;
    });
    nextSchedules[date] = { ...day, items, blocks };
  }

  for (const { targetDate, item } of movedItems) {
    const day = nextSchedules[targetDate] ?? { date: targetDate, items: [], blocks: [] };
    if (day.items.some((candidate) => candidate.sourceId === item.sourceId)
      || day.blocks.some((candidate) => candidate.sourceId === item.sourceId)) continue;
    const order = nextSlotOrder(day.items, item.timeSlot);
    nextSchedules[targetDate] = { ...day, items: [...day.items, { ...item, order }] };
  }

  let movedTimeBlocks = 0;
  let collisionFallbacks = 0;
  for (const { targetDate, block } of movedBlocks) {
    const day = nextSchedules[targetDate] ?? { date: targetDate, items: [], blocks: [] };
    if (day.items.some((candidate) => candidate.sourceId === block.sourceId)
      || day.blocks.some((candidate) => candidate.sourceId === block.sourceId)) continue;
    if (!overlaps(block, day.blocks)) {
      nextSchedules[targetDate] = { ...day, blocks: [...day.blocks, block] };
      movedTimeBlocks += 1;
      continue;
    }
    const timeSlot = slotForTime(block.startTime);
    const fallback: ScheduledItem = {
      id: block.id,
      sourceId: block.sourceId,
      name: block.name,
      source: block.source,
      timeSlot,
      order: nextSlotOrder(day.items, timeSlot),
      duration: durationBetween(block.startTime, block.endTime),
      color: block.color,
      categoryColor: block.categoryColor,
      detail: block.detail,
    };
    nextSchedules[targetDate] = { ...day, items: [...day.items, fallback] };
    collisionFallbacks += 1;
  }

  return {
    previousSchedules,
    nextSchedules,
    movedSlotItems: movedItems.length,
    movedTimeBlocks,
    collisionFallbacks,
  };
}

function sourcePlacementSignatures(
  schedules: Record<string, DaySchedule>,
  sourceIds: string[],
): string[] {
  const ids = new Set(sourceIds);
  const signatures: string[] = [];
  const serialize = (value: ScheduledItem | TimeBlock): string => JSON.stringify(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
  for (const [date, day] of Object.entries(schedules)) {
    day.items.forEach((item) => {
      if (ids.has(item.sourceId)) signatures.push(`item\u0000${date}\u0000${serialize(item)}`);
    });
    day.blocks.forEach((block) => {
      if (ids.has(block.sourceId)) signatures.push(`block\u0000${date}\u0000${serialize(block)}`);
    });
  }
  return signatures.sort();
}

export function projectShiftDailyPlacementsMatch(
  currentSchedules: Record<string, DaySchedule>,
  expectedSchedules: Record<string, DaySchedule>,
  sourceIds: string[],
): boolean {
  const current = sourcePlacementSignatures(currentSchedules, sourceIds);
  const expected = sourcePlacementSignatures(expectedSchedules, sourceIds);
  return current.length === expected.length
    && current.every((signature, index) => signature === expected[index]);
}

export function projectShiftTaskDatesMatch(task: Task, expected: Task): boolean {
  if (task.start !== expected.start || task.end !== expected.end) return false;
  const currentDates = new Map(
    getProjectTaskBlocks(task.blocks ?? []).map((block) => [block.id, block.header.date]),
  );
  const expectedDates = new Map(
    getProjectTaskBlocks(expected.blocks ?? []).map((block) => [block.id, block.header.date]),
  );
  return [...expectedDates].every(
    ([blockId, expectedDate]) =>
      currentDates.has(blockId) && currentDates.get(blockId) === expectedDate,
  );
}

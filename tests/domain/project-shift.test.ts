import assert from 'node:assert/strict';
import test from 'node:test';
import {
  planProjectDailyShift,
  planProjectShift,
  projectShiftDailyPlacementsMatch,
} from '../../src/domain/projectShift.ts';
import type { Task } from '../../src/types/index.ts';

const project: Task = {
  id: 'project-1',
  name: '复习项目',
  start: '2026-08-01',
  end: '2026-08-10',
  blocks: [
    { type: 'smart-task', id: 'standard', body: '', header: { title: '普通任务', tag: '默认', tagColor: '#000', date: '2026-08-02', deadline: '2026-08-03', duration: 30, isCompleted: false } },
    { type: 'smart-task', id: 'completed', body: '', header: { title: '已完成', tag: '默认', tagColor: '#000', date: '2026-08-01', duration: 30, isCompleted: true } },
    { type: 'smart-task', id: 'unscheduled', body: '', header: { title: '未排期', tag: '默认', tagColor: '#000', duration: 30, isCompleted: false } },
    { type: 'smart-task', id: 'quantity', body: '', header: { taskKind: 'quantity', title: '数量任务', tag: '默认', tagColor: '#000', date: '2026-08-01', duration: 30, isCompleted: false, quantityTotal: 100 } },
    { type: 'smart-task', id: 'invalid-date', body: '', header: { title: '异常日期', tag: '默认', tagColor: '#000', date: '2026-02-30', duration: 30, isCompleted: false } },
  ],
};

test('project shift moves only scheduled unfinished standard tasks and the project range', () => {
  const plan = planProjectShift(project, 2);
  assert.equal(plan.shiftedStart, '2026-08-03');
  assert.equal(plan.shiftedEnd, '2026-08-12');
  assert.equal(plan.tasks.length, 1);
  assert.deepEqual(plan.tasks[0], {
    blockId: 'standard',
    sourceId: 'project-blk:project-1::standard',
    title: '普通任务',
    fromDate: '2026-08-02',
    toDate: '2026-08-04',
    deadline: '2026-08-03',
    exceedsDeadline: true,
  });
  assert.equal(plan.skippedCompleted, 1);
  assert.equal(plan.skippedUnscheduled, 1);
  assert.equal(plan.skippedContinuous, 1);
  assert.equal(plan.skippedInvalidDates, 1);
  const headers = plan.nextTask.blocks.filter((block) => block.type === 'smart-task').map((block) => block.header);
  assert.deepEqual(headers.map((header) => header.date), ['2026-08-04', '2026-08-01', undefined, '2026-08-01', '2026-02-30']);
});

test('daily placements follow the shifted task and conflicting time blocks fall back to a slot', () => {
  const tasks = [
    { blockId: 'standard', sourceId: 'project-blk:project-1::standard', title: '普通任务', fromDate: '2026-08-02', toDate: '2026-08-04', exceedsDeadline: false },
    { blockId: 'second', sourceId: 'project-blk:project-1::second', title: '冲突任务', fromDate: '2026-08-02', toDate: '2026-08-04', exceedsDeadline: false },
  ];
  const schedules = {
    '2026-08-02': {
      date: '2026-08-02',
      items: [{ id: 'item-1', sourceId: tasks[0].sourceId, name: '普通任务', source: 'project' as const, timeSlot: 'morning' as const, order: 0 }],
      blocks: [{ id: 'block-1', sourceId: tasks[1].sourceId, name: '冲突任务', source: 'project' as const, startTime: '14:00', endTime: '15:00' }],
    },
    '2026-08-04': {
      date: '2026-08-04',
      items: [],
      blocks: [{ id: 'occupied', sourceId: 'free-1', name: '已有安排', source: 'free' as const, startTime: '14:30', endTime: '15:30' }],
    },
  };
  const plan = planProjectDailyShift(schedules, tasks);
  assert.equal(plan.nextSchedules['2026-08-02'].items.length, 0);
  assert.equal(plan.nextSchedules['2026-08-02'].blocks.length, 0);
  assert.equal(plan.nextSchedules['2026-08-04'].items.length, 2);
  assert.equal(plan.nextSchedules['2026-08-04'].blocks.length, 1);
  assert.equal(plan.nextSchedules['2026-08-04'].items.find((item) => item.sourceId === tasks[1].sourceId)?.timeSlot, 'afternoon');
  assert.equal(plan.movedSlotItems, 1);
  assert.equal(plan.movedTimeBlocks, 0);
  assert.equal(plan.collisionFallbacks, 1);
});

test('slot migration appends after the highest existing order', () => {
  const sourceId = 'project-blk:project-1::standard';
  const plan = planProjectDailyShift({
    '2026-08-02': {
      date: '2026-08-02',
      items: [{ id: 'moving', sourceId, name: '普通任务', source: 'project', timeSlot: 'morning', order: 0 }],
      blocks: [],
    },
    '2026-08-04': {
      date: '2026-08-04',
      items: [{ id: 'existing', sourceId: 'free-1', name: '已有安排', source: 'free', timeSlot: 'morning', order: 5 }],
      blocks: [],
    },
  }, [{ blockId: 'standard', sourceId, title: '普通任务', fromDate: '2026-08-02', toDate: '2026-08-04', exceedsDeadline: false }]);
  assert.equal(plan.nextSchedules['2026-08-04'].items.find((item) => item.sourceId === sourceId)?.order, 6);
});

test('undo guard detects later changes to shifted daily placements', () => {
  const sourceId = 'project-blk:project-1::standard';
  const expected = {
    '2026-08-04': {
      date: '2026-08-04',
      items: [{ id: 'moving', sourceId, name: '普通任务', source: 'project' as const, timeSlot: 'morning' as const, order: 0 }],
      blocks: [],
    },
  };
  assert.equal(projectShiftDailyPlacementsMatch(expected, expected, [sourceId]), true);
  const changed = {
    '2026-08-04': {
      ...expected['2026-08-04'],
      items: [{ ...expected['2026-08-04'].items[0], timeSlot: 'afternoon' as const }],
    },
  };
  assert.equal(projectShiftDailyPlacementsMatch(changed, expected, [sourceId]), false);
});

test('fractional shift days are rejected', () => {
  assert.throws(() => planProjectShift(project, 1.5), /非零整数/);
});

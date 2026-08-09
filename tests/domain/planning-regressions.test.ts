import assert from 'node:assert/strict';
import test from 'node:test';
import { collectOverdueFreezeTargets } from '../../src/domain/icebox.ts';
import { DEFAULT_EBB_SETTINGS } from '../../src/ebb/constants.ts';
import { generateTasks } from '../../src/ebb/scheduler.ts';
import type { Task } from '../../src/types/index.ts';
import { isValidCalendarDate, makeLocalDayjs } from '../../src/utils/dateSafe.ts';

const task = (id: string, date: string, patch: Record<string, unknown> = {}): Task => ({
  id,
  name: id,
  start: '2026-01-01',
  end: '2026-12-31',
  blocks: [{
    type: 'smart-task',
    id: `${id}-block`,
    header: {
      title: id,
      tag: 'test',
      tagColor: '#000000',
      date,
      duration: 30,
      isCompleted: false,
      ...patch,
    },
    body: '',
  }],
});

test('icebox maintenance freezes only active overdue one-day tasks', () => {
  const targets = collectOverdueFreezeTargets([
    task('active-overdue', '2026-01-01'),
    task('archived-overdue', '2026-01-01', { isArchived: true }),
    task('completed-overdue', '2026-01-01', { isCompleted: true }),
    task('quantity-overdue', '2026-01-01', { taskKind: 'quantity' }),
    task('threshold-day', '2026-01-08'),
  ], '2026-01-08');

  assert.deepEqual(targets, [{
    taskId: 'active-overdue',
    blockId: 'active-overdue-block',
    expectedDate: '2026-01-01',
  }]);
});

test('review generation enforces the configured gap within the same batch', () => {
  const result = generateTasks({
    topicName: 'same-batch-gap',
    startDate: '2026-01-01',
    intervals: [1, 2],
    complexity: 'normal',
  }, [], {
    ...DEFAULT_EBB_SETTINGS,
    minTopicGapDays: 3,
    maxSpreadDays: 10,
  });

  assert.deepEqual(result.tasks.map((item) => item.dueDate), ['2026-01-02', '2026-01-05']);
});

test('strict calendar validation rejects normalized and reversed-looking input', () => {
  assert.equal(isValidCalendarDate('2024-02-29'), true);
  assert.equal(isValidCalendarDate('2026-02-29'), false);
  assert.equal(isValidCalendarDate('2026-02-30'), false);
  assert.equal(isValidCalendarDate('2026-13-01'), false);
  assert.equal(makeLocalDayjs('2026-02-30').isValid(), false);
  assert.throws(() => generateTasks({
    topicName: 'invalid-date',
    startDate: '2026-02-30',
    intervals: [1],
  }, [], DEFAULT_EBB_SETTINGS), /日期|date|invalid/i);
});

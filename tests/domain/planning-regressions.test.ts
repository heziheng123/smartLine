import assert from 'node:assert/strict';
import test from 'node:test';
import { collectOverdueFreezeTargets, shouldClearStaleFrozenMarker } from '../../src/domain/icebox.ts';
import { DEFAULT_EBB_SETTINGS } from '../../src/ebb/constants.ts';
import { generateTasks } from '../../src/ebb/scheduler.ts';
import { buildBalancedDailyReviewPlan, planDailyReviewSelection } from '../../src/ebb/dailyReviewPlanning.ts';
import { planBatchReviewAdjustment } from '../../src/ebb/batchAdjust.ts';
import type { ReviewTask } from '../../src/ebb/types.ts';
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

test('stale recovered markers are repaired only when the retained date cannot be a frozen overdue date', () => {
  const frozenAt = '2026-08-10T00:00:00.000Z';
  const thresholdDate = '2026-08-09';

  assert.equal(shouldClearStaleFrozenMarker({ date: '2026-08-08', frozenAt }, thresholdDate), false);
  assert.equal(shouldClearStaleFrozenMarker({ date: '2026-08-09', frozenAt }, thresholdDate), true);
  assert.equal(shouldClearStaleFrozenMarker({ date: '2026-08-12', frozenAt }, thresholdDate), true);
  assert.equal(shouldClearStaleFrozenMarker({ frozenAt }, thresholdDate), true);
  assert.equal(shouldClearStaleFrozenMarker({ date: '2026-08-12', frozenAt, taskKind: 'quantity' }, thresholdDate), true);
  assert.equal(shouldClearStaleFrozenMarker({ date: '2026-08-12', frozenAt, isArchived: true }, thresholdDate), false);
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

const review = (id: string, topicName: string, dueDate: string, roundOrder: number, patch: Partial<ReviewTask> = {}): ReviewTask => ({
  id,
  topicName,
  dueDate,
  originalDueDate: dueDate,
  roundOrder,
  isCompleted: false,
  complexity: 'normal',
  ...patch,
});

test('tomorrow workload balancing uses minutes, protects overdue work and spreads flexible rounds', () => {
  const tasks = [
    review('urgent', 'urgent-topic', '2026-08-09', 1, { baseDurationMinutes: 40 }),
    review('flex-a', 'flex-a-topic', '2026-08-11', 1, { baseDurationMinutes: 35 }),
    review('flex-b', 'flex-b-topic', '2026-08-11', 1, { baseDurationMinutes: 35 }),
  ];
  const plan = buildBalancedDailyReviewPlan(tasks, '2026-08-11', 60, 3);

  assert.equal(plan.assignmentsByTaskId.urgent, '2026-08-11');
  assert.notEqual(plan.assignmentsByTaskId['flex-a'], plan.assignmentsByTaskId['flex-b']);
  assert.deepEqual(plan.days.map((day) => day.minutes), [40, 35, 35]);
  assert.equal(plan.overflowMinutes, 0);
});

test('explicit workload dates cascade through later unfinished rounds and remain revisable', () => {
  const tasks = [
    review('r1', 'topic', '2026-08-10', 1, { isCompleted: true, completedDate: '2026-08-10' }),
    review('r2', 'topic', '2026-08-11', 2),
    review('r3', 'topic', '2026-08-14', 3),
  ];
  const plan = planDailyReviewSelection(tasks, {
    planDate: '2026-08-11',
    candidateTaskIds: ['r2'],
    keptTaskIds: [],
    assignmentsByTaskId: { r2: '2026-08-13' },
  });

  assert.deepEqual(plan.nextTasks.filter((item) => item.id === 'r2' || item.id === 'r3').map((item) => [item.id, item.dueDate]), [
    ['r2', '2026-08-13'],
    ['r3', '2026-08-16'],
  ]);
  assert.equal(plan.deferredCount, 1);
  assert.equal(plan.cascadeCount, 1);
});

test('batch reanchor preserves completed history and each plan remaining intervals', () => {
  const tasks = [
    review('a1', 'topic-a', '2026-08-01', 1, { isCompleted: true, completedDate: '2026-08-01' }),
    review('a2', 'topic-a', '2026-08-10', 2),
    review('a3', 'topic-a', '2026-08-14', 3),
  ];
  const plan = planBatchReviewAdjustment(tasks, DEFAULT_EBB_SETTINGS, {
    topicKeys: ['topic:topic-a'],
    action: { kind: 'reanchor', startDate: '2026-08-11' },
  });
  assert.equal(plan.affectedTopics, 1);
  assert.deepEqual(plan.nextTasks.map((item) => [item.id, item.dueDate]), [
    ['a1', '2026-08-01'],
    ['a2', '2026-08-11'],
    ['a3', '2026-08-15'],
  ]);
});

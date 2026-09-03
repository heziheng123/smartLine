import assert from 'node:assert/strict';
import test from 'node:test';
import { collectOverdueFreezeTargets, shouldClearStaleFrozenMarker } from '../../src/domain/icebox.ts';
import { DEFAULT_EBB_SETTINGS } from '../../src/ebb/constants.ts';
import { computeTopicStats, generateTasks } from '../../src/ebb/scheduler.ts';
import { normalizeEbbData } from '../../src/ebb/dataNormalization.ts';
import { buildBalancedDailyReviewPlan, planDailyReviewSelection } from '../../src/ebb/dailyReviewPlanning.ts';
import { planBatchReviewAdjustment } from '../../src/ebb/batchAdjust.ts';
import { planProjectTaskEbbBatch } from '../../src/ebb/projectTaskSyncBatch.ts';
import { planEbbTaskSync } from '../../src/ebb/taskSyncPlanner.ts';
import type { ReviewTask } from '../../src/ebb/types.ts';
import type { Task } from '../../src/types/index.ts';
import { isValidCalendarDate, makeLocalDayjs } from '../../src/utils/dateSafe.ts';
import { analyzeProjectTaskCompletion } from '../../src/domain/projectTaskCompletion.ts';
import { collectCompletedActivities } from '../../src/domain/dailyRetrospective.ts';
import { planProjectTaskEffects } from '../../src/domain/projectTaskEffects.ts';

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
  assert.equal(new Set(result.tasks.map((item) => item.createdAt)).size, 1);
  assert.match(result.tasks[0].createdAt ?? '', /^\d{4}-\d{2}-\d{2}T/);
});

test('legacy review creation time is restored deterministically from generated ids', () => {
  const generatedAt = Date.parse('2025-03-04T05:06:07.000Z');
  const normalized = normalizeEbbData({
    reviewTasks: [{
      id: `rt-${generatedAt.toString(36)}-legacy`,
      topicName: '旧计划',
      dueDate: '2026-08-11',
      originalDueDate: '2026-08-11',
      isCompleted: false,
    }],
    inboxItems: [],
    outlineNodes: [],
    ebbSettings: DEFAULT_EBB_SETTINGS,
  });

  assert.equal(normalized.reviewTasks[0].createdAt, '2025-03-04T05:06:07.000Z');
});

test('relearning completes only the due old round, archives the old chain and creates a full new cycle', () => {
  let sequence = 0;
  const plan = planProjectTaskEbbBatch({
    reviewTasks: [
      review('old-r1', '极限', '2026-08-20', 1, { graphNodeId: 'limit', isCompleted: true, completedDate: '2026-08-20' }),
      review('old-r2', '极限', '2026-09-01', 2, { graphNodeId: 'limit' }),
      review('old-r3', '极限', '2026-09-02', 3, { graphNodeId: 'limit' }),
    ],
    ebbSettings: DEFAULT_EBB_SETTINGS,
    payloads: [{
      graphNodeId: 'limit',
      topicName: '极限',
      complexity: 'normal',
      completionMode: 'relearn',
      completedDate: '2026-09-01',
      sourceTaskId: 'project',
      sourceBlockId: 'lesson',
    }],
    today: '2026-09-01',
    createdAt: '2026-09-01T12:00:00.000Z',
    createReviewTaskId: () => `new-r${++sequence}`,
  });

  assert.equal(plan.error, undefined);
  assert.equal(plan.changed, true);
  const oldRounds = plan.reviewTasks.filter((item) => item.id.startsWith('old-'));
  assert.equal(oldRounds.every((item) => item.isArchived && item.archivedReason === 'relearned'), true);
  assert.equal(oldRounds.every((item) => item.cycleTotalRounds === 3), true);
  assert.equal(oldRounds.find((item) => item.id === 'old-r2')?.isCompleted, true);
  assert.equal(oldRounds.find((item) => item.id === 'old-r2')?.completionSource, 'project-task');
  assert.equal(oldRounds.find((item) => item.id === 'old-r3')?.isCompleted, false);
  const newRounds = plan.reviewTasks.filter((item) => item.id.startsWith('new-'));
  assert.equal(newRounds.length, DEFAULT_EBB_SETTINGS.complexityConfigs.normal.intervals.length);
  assert.equal(newRounds.every((item) => item.cycleOrigin === 'project-task-relearn'), true);
  assert.deepEqual(newRounds.map((item) => item.dueDate), ['2026-09-02', '2026-09-03', '2026-09-05', '2026-09-08', '2026-09-16', '2026-10-01', '2026-10-31']);
  assert.equal(newRounds.every((item) => item.scheduleCreatedDate === '2026-09-01'), true);
});

test('relearning after a manual review on the same day does not consume the next old round', () => {
  const plan = planProjectTaskEbbBatch({
    reviewTasks: [
      review('manual-today', '导数', '2026-09-01', 1, {
        graphNodeId: 'derivative',
        isCompleted: true,
        completedDate: '2026-09-01',
        completionSource: 'manual',
      }),
      review('next-old', '导数', '2026-08-30', 2, { graphNodeId: 'derivative' }),
    ],
    ebbSettings: DEFAULT_EBB_SETTINGS,
    payloads: [{
      graphNodeId: 'derivative',
      topicName: '导数',
      completionMode: 'relearn',
      completedDate: '2026-09-01',
      sourceTaskId: 'project',
      sourceBlockId: 'lesson',
    }],
    today: '2026-09-01',
    createReviewTaskId: (() => { let id = 0; return () => `manual-new-${++id}`; })(),
  });

  assert.equal(plan.reviewTasks.find((item) => item.id === 'manual-today')?.completionSource, 'manual');
  assert.equal(plan.reviewTasks.find((item) => item.id === 'next-old')?.isCompleted, false);
  assert.deepEqual(plan.nodeResults[0].completedOldRoundIds, []);
});

test('same-node same-day task restart is idempotent', () => {
  const fresh = [
    review('fresh-r1', '连续性', '2026-09-02', 1, {
      graphNodeId: 'continuity',
      scheduleCreatedDate: '2026-09-01',
      scheduleSourceTaskId: 'first-project',
      scheduleSourceBlockId: 'first-task',
    }),
    review('fresh-r2', '连续性', '2026-09-03', 2, {
      graphNodeId: 'continuity',
      scheduleCreatedDate: '2026-09-01',
      scheduleSourceTaskId: 'first-project',
      scheduleSourceBlockId: 'first-task',
    }),
  ];
  const plan = planProjectTaskEbbBatch({
    reviewTasks: fresh,
    ebbSettings: DEFAULT_EBB_SETTINGS,
    payloads: [{
      graphNodeId: 'continuity',
      topicName: '连续性',
      completionMode: 'relearn',
      completedDate: '2026-09-01',
      sourceTaskId: 'second-project',
      sourceBlockId: 'second-task',
    }],
    today: '2026-09-01',
  });

  assert.equal(plan.changed, false);
  assert.equal(plan.reviewTasks, fresh);
  assert.equal(plan.nodeResults[0].skippedSameDayRestart, true);
});

test('invalid relearn intervals reject the whole batch without changing reviews', () => {
  const original = [review('invalid-r1', '无效间隔', '2026-09-01', 1, { graphNodeId: 'invalid-node' })];
  const plan = planProjectTaskEbbBatch({
    reviewTasks: original,
    ebbSettings: {
      ...DEFAULT_EBB_SETTINGS,
      complexityConfigs: {
        ...DEFAULT_EBB_SETTINGS.complexityConfigs,
        normal: { ...DEFAULT_EBB_SETTINGS.complexityConfigs.normal, intervals: [] },
      },
    },
    payloads: [{
      graphNodeId: 'invalid-node',
      topicName: '无效间隔',
      completionMode: 'relearn',
      completedDate: '2026-09-01',
    }],
    today: '2026-09-01',
  });

  assert.match(plan.error ?? '', /间隔/);
  assert.equal(plan.reviewTasks, original);
  assert.equal(plan.changed, false);
});

test('later manual task uncompletion keeps a relearned cycle intact', () => {
  const tasks = [
    review('archived-old', '极限', '2026-09-01', 1, {
      graphNodeId: 'limit',
      isArchived: true,
      archivedReason: 'relearned',
      archivedAt: '2026-09-01T12:00:00.000Z',
      cycleTotalRounds: 1,
    }),
    review('active-new', '极限', '2026-09-02', 1, {
      graphNodeId: 'limit',
      scheduleCreatedDate: '2026-09-01',
      scheduleSourceTaskId: 'project',
      scheduleSourceBlockId: 'lesson',
      cycleOrigin: 'project-task-relearn',
    }),
  ];
  const plan = planEbbTaskSync({
    reviewTasks: tasks,
    ebbSettings: DEFAULT_EBB_SETTINGS,
    payload: {
      action: 'remove',
      graphNodeId: 'limit',
      topicName: '极限',
      sourceTaskId: 'project',
      sourceBlockId: 'lesson',
    },
    today: '2026-09-05',
  });

  assert.equal(plan.changed, false);
  assert.equal(plan.reviewTasks, tasks);
});

test('completion impact prompts only for active chains on non-archived leaf nodes', () => {
  const header = task('impact-project', '2026-09-01', {
    autoSyncEbb: true,
    graphNodeIds: ['leaf', 'parent', 'archived', 'empty-leaf'],
  }).blocks[0];
  assert.equal(header.type, 'smart-task');
  if (header.type !== 'smart-task') return;
  const impact = analyzeProjectTaskCompletion({
    header: header.header,
    completedDate: '2026-09-01',
    graphNodes: [
      { id: 'parent', name: '父节点', parentId: null, createdAt: 1 },
      { id: 'leaf', name: '叶子节点', parentId: 'parent', createdAt: 2 },
      { id: 'archived', name: '归档节点', parentId: null, createdAt: 3, isArchived: true },
      { id: 'empty-leaf', name: '无计划节点', parentId: null, createdAt: 4 },
    ],
    reviewTasks: [
      review('leaf-r1', '叶子节点', '2026-09-01', 1, { graphNodeId: 'leaf' }),
      review('parent-r1', '父节点', '2026-09-01', 1, { graphNodeId: 'parent' }),
      review('archived-r1', '归档节点', '2026-09-01', 1, { graphNodeId: 'archived' }),
    ],
    ebbSettings: DEFAULT_EBB_SETTINGS,
    today: '2026-09-01',
  });

  assert.deepEqual(impact.nodes.map((node) => node.nodeId), ['leaf']);
  assert.equal(impact.nodes[0].linkedRoundOrder, 1);
  assert.equal(impact.nodes[0].newRoundCount, 7);
});

test('past completion previews overdue new rounds while future completion disables relearn', () => {
  const block = task('date-impact', '2026-08-01', {
    autoSyncEbb: true,
    graphNodeIds: ['date-node'],
  }).blocks[0];
  assert.equal(block.type, 'smart-task');
  if (block.type !== 'smart-task') return;
  const graphNodes = [{ id: 'date-node', name: '日期节点', parentId: null, createdAt: 1 }];
  const reviewTasks = [review('date-old', '日期节点', '2026-08-01', 1, { graphNodeId: 'date-node' })];
  const past = analyzeProjectTaskCompletion({
    header: block.header,
    completedDate: '2026-08-01',
    graphNodes,
    reviewTasks,
    ebbSettings: DEFAULT_EBB_SETTINGS,
    today: '2026-09-01',
  });
  const future = analyzeProjectTaskCompletion({
    header: block.header,
    completedDate: '2026-09-02',
    graphNodes,
    reviewTasks,
    ebbSettings: DEFAULT_EBB_SETTINGS,
    today: '2026-09-01',
  });

  assert.equal(past.nodes[0].canRelearn, true);
  assert.equal(past.nodes[0].overdueNewRoundCount > 0, true);
  assert.equal(future.nodes[0].canRelearn, false);
  assert.match(future.nodes[0].relearnBlockedReason ?? '', /未来/);
});

test('daily retrospective keeps the linked old round after relearn archival', () => {
  const project = task('reflection-project', '2026-09-01', {
    title: '极限强化课',
    isCompleted: true,
    completedDate: '2026-09-01',
    graphNodeIds: ['reflection-node'],
  });
  const oldRound = review('reflection-old', '极限', '2026-09-01', 2, {
    graphNodeId: 'reflection-node',
    isCompleted: true,
    completedDate: '2026-09-01',
    completionSource: 'project-task',
    completionSourceTaskId: 'reflection-project',
    completionSourceBlockId: 'reflection-project-block',
    isArchived: true,
    archivedReason: 'relearned',
    archivedAt: '2026-09-01T12:00:00.000Z',
    cycleTotalRounds: 7,
  });
  const nextRound = review('reflection-new', '极限', '2026-09-02', 1, {
    graphNodeId: 'reflection-node',
    scheduleCreatedDate: '2026-09-01',
    scheduleSourceTaskId: 'reflection-project',
    scheduleSourceBlockId: 'reflection-project-block',
  });
  const activities = collectCompletedActivities(
    '2026-09-01',
    [project],
    [],
    [oldRound, nextRound],
    [{ id: 'reflection-node', name: '极限', parentId: null, createdAt: 1 }],
  );
  const linked = activities.find((activity) => activity.reviewTaskId === 'reflection-old');

  assert.equal(linked?.completionSource, 'project-task');
  assert.equal(linked?.round, 2);
  assert.equal(linked?.totalRounds, 7);
  assert.equal(linked?.restartedNextDueDate, '2026-09-02');
});

test('multi-node completion restarts only selected nodes and continues the others', () => {
  const source = task('multi-project', '2026-09-01', {
    autoSyncEbb: true,
    graphNodeIds: ['restart-node', 'continue-node'],
  });
  const block = source.blocks[0];
  assert.equal(block.type, 'smart-task');
  if (block.type !== 'smart-task') return;
  const graphNodes = [
    { id: 'restart-node', name: '重学节点', parentId: null, createdAt: 1 },
    { id: 'continue-node', name: '衔接节点', parentId: null, createdAt: 2 },
  ];
  const effects = planProjectTaskEffects({
    tasks: [source],
    taskId: source.id,
    blockId: block.id,
    currentHeader: block.header,
    nextHeader: { ...block.header, isCompleted: true, completedDate: '2026-09-01' },
    graphNodes,
    completionReviewDecision: { mode: 'relearn', relearnNodeIds: ['restart-node'] },
  });
  assert.deepEqual(effects.ebbPayloads.map((payload) => [payload.graphNodeId, payload.completionMode]), [
    ['restart-node', 'relearn'],
    ['continue-node', 'continue'],
  ]);

  let id = 0;
  const plan = planProjectTaskEbbBatch({
    reviewTasks: [
      review('restart-old', '重学节点', '2026-09-01', 1, { graphNodeId: 'restart-node' }),
      review('continue-old', '衔接节点', '2026-09-01', 1, { graphNodeId: 'continue-node' }),
    ],
    ebbSettings: DEFAULT_EBB_SETTINGS,
    payloads: effects.ebbPayloads.map((payload) => ({
      ...payload,
      sourceTaskId: source.id,
      sourceBlockId: block.id,
    })),
    today: '2026-09-01',
    createReviewTaskId: () => `multi-new-${++id}`,
  });
  assert.equal(plan.reviewTasks.find((item) => item.id === 'restart-old')?.isArchived, true);
  assert.equal(plan.reviewTasks.find((item) => item.id === 'continue-old')?.isArchived, undefined);
  assert.equal(plan.reviewTasks.find((item) => item.id === 'continue-old')?.isCompleted, true);
  assert.equal(plan.reviewTasks.filter((item) => !item.isArchived && item.graphNodeId === 'restart-node').length, 7);
});

test('relearning an all-complete final cycle creates a new cycle without a supplemental round', () => {
  const plan = planProjectTaskEbbBatch({
    reviewTasks: [review('finished-final', '终轮', '2026-08-31', 1, {
      graphNodeId: 'final-node',
      isCompleted: true,
      completedDate: '2026-08-31',
    })],
    ebbSettings: DEFAULT_EBB_SETTINGS,
    payloads: [{
      graphNodeId: 'final-node',
      topicName: '终轮',
      completionMode: 'relearn',
      completedDate: '2026-09-01',
      sourceTaskId: 'final-project',
      sourceBlockId: 'final-task',
    }],
    today: '2026-09-01',
    createReviewTaskId: (() => { let id = 0; return () => `final-new-${++id}`; })(),
  });

  assert.equal(plan.reviewTasks.find((item) => item.id === 'finished-final')?.isArchived, true);
  const active = plan.reviewTasks.filter((item) => !item.isArchived);
  assert.equal(active.length, 7);
  assert.equal(active.some((item) => item.isSupplemental), false);
});

test('a missing active chain with invalid intervals blocks completion planning', () => {
  const original: ReviewTask[] = [];
  const plan = planProjectTaskEbbBatch({
    reviewTasks: original,
    ebbSettings: {
      ...DEFAULT_EBB_SETTINGS,
      complexityConfigs: {
        ...DEFAULT_EBB_SETTINGS.complexityConfigs,
        normal: { ...DEFAULT_EBB_SETTINGS.complexityConfigs.normal, intervals: [] },
      },
    },
    payloads: [{
      graphNodeId: 'empty-node',
      topicName: '空计划',
      complexity: 'normal',
      completionMode: 'continue',
      triggerSchedule: true,
    }],
    today: '2026-09-01',
  });

  assert.match(plan.error ?? '', /间隔/);
  assert.equal(plan.reviewTasks, original);
});

test('concurrent relearn planners generate the same round ids for one node and date', () => {
  const input = {
    reviewTasks: [review('concurrent-old', '并发节点', '2026-09-01', 1, { graphNodeId: 'concurrent-node' })],
    ebbSettings: DEFAULT_EBB_SETTINGS,
    payloads: [{
      graphNodeId: 'concurrent-node',
      topicName: '并发节点',
      completionMode: 'relearn' as const,
      completedDate: '2026-09-01',
      sourceTaskId: 'project',
      sourceBlockId: 'lesson',
    }],
    today: '2026-09-01',
  };
  const first = planProjectTaskEbbBatch({ ...input, createdAt: '2026-09-01T10:00:00.000Z' });
  const second = planProjectTaskEbbBatch({ ...input, createdAt: '2026-09-01T10:00:01.000Z' });
  const activeIds = (plan: typeof first) => plan.reviewTasks
    .filter((item) => !item.isArchived)
    .map((item) => item.id);

  assert.deepEqual(activeIds(first), activeIds(second));
  assert.equal(new Set(activeIds(first)).size, 7);
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

test('topic creation time keeps the first generated round when later rounds are appended', () => {
  const stats = computeTopicStats([
    review('created-r1', 'created-topic', '2099-01-02', 1, { createdAt: '2026-01-02T10:00:00.000Z' }),
    review('created-r2', 'created-topic', '2099-01-03', 2, { createdAt: '2026-01-02T10:00:00.000Z' }),
    review('created-r3', 'created-topic', '2099-01-04', 3, { createdAt: '2026-08-11T10:00:00.000Z' }),
  ], DEFAULT_EBB_SETTINGS);

  assert.equal(stats[0].createdAt, '2026-01-02T10:00:00.000Z');
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
    review('a1', 'topic-a', '2099-01-01', 1, { isCompleted: true, completedDate: '2099-01-01' }),
    review('a2', 'topic-a', '2099-01-10', 2),
    review('a3', 'topic-a', '2099-01-14', 3),
  ];
  const plan = planBatchReviewAdjustment(tasks, DEFAULT_EBB_SETTINGS, {
    topicKeys: ['topic:topic-a'],
    action: { kind: 'reanchor', startDate: '2099-01-11' },
  });
  assert.equal(plan.affectedTopics, 1);
  assert.deepEqual(plan.nextTasks.map((item) => [item.id, item.dueDate]), [
    ['a1', '2099-01-01'],
    ['a2', '2099-01-11'],
    ['a3', '2099-01-15'],
  ]);
});

test('goal-driven balancing coordinates load across topics instead of stacking every plan on one day', () => {
  const tasks = [
    review('load-a', 'load-a', '2099-01-02', 1, { baseDurationMinutes: 40 }),
    review('load-b', 'load-b', '2099-01-02', 1, { baseDurationMinutes: 40 }),
    review('load-c', 'load-c', '2099-01-02', 1, { baseDurationMinutes: 40 }),
  ];
  const plan = planBatchReviewAdjustment(tasks, DEFAULT_EBB_SETTINGS, {
    mode: 'goal',
    topicKeys: ['topic:load-a', 'topic:load-b', 'topic:load-c'],
    goal: {
      kind: 'balance',
      startDate: '2099-01-02',
      horizonDays: 3,
      capacityMinutes: 60,
      maxRoundsPerDay: 3,
      maxMoveDays: 2,
    },
  });

  assert.deepEqual(plan.nextTasks.map((item) => item.dueDate).sort(), ['2099-01-02', '2099-01-03', '2099-01-04']);
  assert.deepEqual(plan.dayLoads?.map((day) => day.afterMinutes), [40, 40, 40]);
  assert.equal(plan.dayLoads?.some((day) => day.afterOverCapacity), false);
});

test('goal-driven balancing protects manually scheduled rounds while moving flexible work', () => {
  const tasks = [
    review('locked', 'locked-topic', '2099-02-01', 1, { baseDurationMinutes: 45 }),
    review('flexible', 'flexible-topic', '2099-02-01', 1, { baseDurationMinutes: 45 }),
  ];
  const plan = planBatchReviewAdjustment(tasks, DEFAULT_EBB_SETTINGS, {
    mode: 'goal',
    topicKeys: ['topic:locked-topic', 'topic:flexible-topic'],
    goal: {
      kind: 'balance',
      startDate: '2099-02-01',
      horizonDays: 2,
      capacityMinutes: 60,
      maxRoundsPerDay: 3,
      maxMoveDays: 1,
      protectedTaskIds: ['locked'],
    },
  });

  assert.equal(plan.nextTasks.find((item) => item.id === 'locked')?.dueDate, '2099-02-01');
  assert.equal(plan.nextTasks.find((item) => item.id === 'flexible')?.dueDate, '2099-02-02');
  assert.equal(plan.sourceIdsToClear.includes('locked'), false);
  assert.equal(plan.sourceIdsToClear.includes('flexible'), true);
});

test('goal-driven planning explains an impossible deadline without modifying that plan', () => {
  const tasks = [
    review('deadline-r1', 'deadline-topic', '2099-03-01', 1),
    review('deadline-r2', 'deadline-topic', '2099-03-10', 2),
  ];
  const plan = planBatchReviewAdjustment(tasks, DEFAULT_EBB_SETTINGS, {
    mode: 'goal',
    topicKeys: ['topic:deadline-topic'],
    goal: {
      kind: 'balance',
      startDate: '2099-03-01',
      horizonDays: 5,
      capacityMinutes: 60,
      maxRoundsPerDay: 3,
      maxMoveDays: 4,
      deadline: '2099-03-05',
    },
  });

  assert.equal(plan.affectedTopics, 0);
  assert.match(plan.results[0].description, /截止日期/);
  assert.deepEqual(plan.nextTasks.map((item) => item.dueDate), ['2099-03-01', '2099-03-10']);
});

test('advanced shifting refuses to move unfinished rounds into the past', () => {
  const tasks = [review('past-r1', 'past-topic', '2026-08-12', 1)];
  const plan = planBatchReviewAdjustment(tasks, DEFAULT_EBB_SETTINGS, {
    topicKeys: ['topic:past-topic'],
    action: { kind: 'shift', days: -7 },
  });

  assert.equal(plan.affectedTopics, 0);
  assert.match(plan.results[0].description, /过去/);
  assert.equal(plan.nextTasks[0].dueDate, '2026-08-12');
});

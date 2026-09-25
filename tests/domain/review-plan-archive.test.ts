import assert from 'node:assert/strict';
import test from 'node:test';
import { archiveReviewPlan, archiveReviewPlans, listArchivedReviewPlans, restoreArchivedReviewPlan } from '@/ebb/reviewPlanArchive';
import { DEFAULT_EBB_SETTINGS } from '@/ebb/constants';
import { planEbbTaskSync } from '@/ebb/taskSyncPlanner';
import { reviewTasksForDate } from '@/domain/dailyTaskProjection';
import { normalizeEbbData } from '@/ebb/dataNormalization';
import type { ReviewTask } from '@/ebb/types';

const task = (id: string, topicName: string, dueDate: string, overrides: Partial<ReviewTask> = {}): ReviewTask => ({
  id,
  topicName,
  dueDate,
  originalDueDate: dueDate,
  createdAt: '2026-01-01T00:00:00.000Z',
  isCompleted: false,
  roundOrder: Number(id.replace(/\D/g, '')) || 1,
  graphNodeId: topicName === '极限' ? 'limit-node' : undefined,
  ...overrides,
});

test('归档只收起指定主题的活动复习计划', () => {
  const source = [
    task('r1', '极限', '2026-09-14'),
    task('r2', '极限', '2026-09-17'),
    task('r3', '导数', '2026-09-15'),
  ];

  const result = archiveReviewPlan(source, 'graph:limit-node', '2026-09-13T01:00:00.000Z');

  assert.deepEqual(result.archivedTaskIds, ['r1', 'r2']);
  assert.equal(result.reviewTasks[0].isArchived, true);
  assert.equal(result.reviewTasks[0].archivedReason, 'manual');
  assert.equal(result.reviewTasks[0].cycleTotalRounds, 2);
  assert.notEqual(result.reviewTasks[2].isArchived, true);
});

test('批量归档只影响选中节点子树的活动复习，不影响其他节点和历史', () => {
  const source = [
    task('root-r1', '极限', '2026-09-14'),
    task('child-r1', '导数', '2026-09-15', { graphNodeId: 'derivative-node' }),
    task('other-r1', '积分', '2026-09-16', { graphNodeId: 'integral-node' }),
    task('old-r1', '极限', '2026-08-14', { isArchived: true, archivedReason: 'relearned' }),
  ];

  const result = archiveReviewPlans(source, ['graph:limit-node', 'graph:derivative-node'], '2026-09-13T01:00:00.000Z');
  const byId = new Map(result.reviewTasks.map((item) => [item.id, item]));

  assert.deepEqual(result.archivedTaskIds, ['root-r1', 'child-r1']);
  assert.equal(byId.get('root-r1')?.isArchived, true);
  assert.equal(byId.get('child-r1')?.isArchived, true);
  assert.equal(byId.get('root-r1')?.cycleTotalRounds, 1);
  assert.equal(byId.get('child-r1')?.cycleTotalRounds, 1);
  assert.notEqual(byId.get('other-r1')?.isArchived, true);
  assert.equal(byId.get('old-r1')?.archivedReason, 'relearned');
});

test('恢复旧计划时会归档当前计划，并从今天重排旧计划的未完成轮次', () => {
  const source = [
    task('r1', '极限', '2026-08-01', { isArchived: true, isCompleted: true, completedDate: '2026-08-01', archivedAt: '2026-09-01T01:00:00.000Z' }),
    task('r2', '极限', '2026-08-04', { isArchived: true, archivedAt: '2026-09-01T01:00:00.000Z' }),
    task('r3', '极限', '2026-08-10', { isArchived: true, archivedAt: '2026-09-01T01:00:00.000Z' }),
    task('r4', '极限', '2026-09-15'),
  ];

  const result = restoreArchivedReviewPlan(source, ['r1', 'r2', 'r3'], '2026-09-13T02:00:00.000Z', '2026-09-13');
  const byId = new Map(result.reviewTasks.map((item) => [item.id, item]));

  assert.deepEqual(result.activeTaskIds, ['r4']);
  assert.deepEqual(result.restoredTaskIds, ['r1', 'r2', 'r3']);
  assert.equal(byId.get('r4')?.isArchived, true);
  assert.equal(byId.get('r4')?.archivedReason, 'superseded');
  assert.equal(byId.get('r1')?.isArchived, false);
  assert.equal(byId.get('r1')?.dueDate, '2026-08-01');
  assert.equal(byId.get('r2')?.dueDate, '2026-09-13');
  assert.equal(byId.get('r3')?.dueDate, '2026-09-19');
});

test('旧版没有归档时间的周期按创建时间分开，恢复不会混入多个旧周期', () => {
  const plans = listArchivedReviewPlans([
    task('old-a1', '极限', '2026-01-02', { isArchived: true, createdAt: '2026-01-01T00:00:00.000Z' }),
    task('old-a2', '极限', '2026-01-04', { isArchived: true, createdAt: '2026-01-01T00:00:00.000Z' }),
    task('old-b1', '极限', '2026-03-02', { isArchived: true, createdAt: '2026-03-01T00:00:00.000Z' }),
  ]);

  assert.equal(plans.length, 2);
  assert.deepEqual(plans.map((plan) => plan.tasks.map((item) => item.id)), [['old-b1'], ['old-a1', 'old-a2']]);
});

test('归档计划不会出现在每日投影，新强化任务仍可生成一套新计划', () => {
  const archived = archiveReviewPlan([
    task('base-r1', '极限', '2026-09-13', {
      scheduleSourceTaskId: 'base-project',
      scheduleSourceBlockId: 'base-block',
    }),
    task('base-r2', '极限', '2026-09-15', {
      scheduleSourceTaskId: 'base-project',
      scheduleSourceBlockId: 'base-block',
    }),
  ], 'graph:limit-node', '2026-09-13T01:00:00.000Z').reviewTasks;

  assert.deepEqual(reviewTasksForDate(archived, '2026-09-13', '2026-09-13').pending, []);
  const reinforcement = planEbbTaskSync({
    reviewTasks: archived,
    ebbSettings: DEFAULT_EBB_SETTINGS,
    payload: {
      graphNodeId: 'limit-node',
      topicName: '极限',
      sourceTaskId: 'reinforcement-project',
      sourceBlockId: 'reinforcement-block',
    },
    today: '2026-09-13',
    createReviewTaskId: (() => { let id = 0; return () => `reinforcement-${++id}`; })(),
  });

  assert.equal(reinforcement.changed, true);
  assert.equal(reinforcement.reviewTasks.filter((item) => !item.isArchived).length, DEFAULT_EBB_SETTINGS.complexityConfigs.normal.intervals.length);
  assert.equal(reinforcement.reviewTasks.filter((item) => item.isArchived).length, 2);
});

test('误把已归档的基础课任务取消再完成，不会重建旧复习计划', () => {
  const archived = archiveReviewPlan([
    task('base-r1', '极限', '2026-09-13', {
      scheduleSourceTaskId: 'base-project',
      scheduleSourceBlockId: 'base-block',
    }),
  ], 'graph:limit-node', '2026-09-13T01:00:00.000Z').reviewTasks;

  const repeatedBaseCompletion = planEbbTaskSync({
    reviewTasks: archived,
    ebbSettings: DEFAULT_EBB_SETTINGS,
    payload: {
      graphNodeId: 'limit-node',
      topicName: '极限',
      sourceTaskId: 'base-project',
      sourceBlockId: 'base-block',
    },
    today: '2026-09-14',
  });

  assert.equal(repeatedBaseCompletion.changed, false);
  assert.equal(repeatedBaseCompletion.reviewTasks, archived);
});

test('手动归档和恢复替换标记可被持久化数据完整保留', () => {
  const normalized = normalizeEbbData({
    reviewTasks: [
      task('manual', '极限', '2026-09-13', { isArchived: true, archivedReason: 'manual', archivedAt: '2026-09-13T01:00:00.000Z', cycleTotalRounds: 2 }),
      task('superseded', '极限', '2026-09-14', { isArchived: true, archivedReason: 'superseded', archivedAt: '2026-09-14T01:00:00.000Z', cycleTotalRounds: 1 }),
    ],
    inboxItems: [],
    outlineNodes: [],
    ebbSettings: DEFAULT_EBB_SETTINGS,
  });

  assert.deepEqual(normalized.reviewTasks.map((item) => item.archivedReason), ['manual', 'superseded']);
});

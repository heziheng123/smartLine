import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createProjectPlanningProjection,
  filterProjectsByPlanningScope,
  UNCLASSIFIED_PLANNING_AREA_ID,
} from '../../src/lifeMap/projectPlanning.ts';
import { createLifeMapPlanSwimlaneLayout } from '../../src/lifeMap/planSwimlaneLayout.ts';
import type { Task } from '../../src/types/index.ts';
import type { LifeArea } from '../../src/lifeMap/types.ts';

const stamp = {
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  revision: 1,
};

const areas: LifeArea[] = [
  { id: 'study', name: '专业学习', color: '#6366F1', order: 0, planGroupId: 'learning', ...stamp },
  { id: 'career', name: '职业发展', color: '#D8A72E', order: 0, planGroupId: 'work', ...stamp },
  { id: 'health', name: '健康', color: '#10B981', order: 0, planGroupId: 'life', ...stamp },
  { id: 'hidden-area', name: '隐藏领域', color: '#64748B', order: 1, planGroupId: 'learning', isHidden: true, ...stamp },
  { id: 'deleted-area', name: '已删除领域', color: '#64748B', order: 2, planGroupId: 'work', deletedAt: '2026-08-09T01:00:00.000Z', ...stamp },
];

const task = (id: string, planningAreaId?: string): Task => ({
  id,
  name: id,
  start: '2026-08-01',
  end: '2026-08-31',
  planningAreaId,
  groupId: 'timeline-group',
  blocks: [{
    type: 'smart-task',
    id: `${id}-block`,
    header: {
      title: `${id} task`, tag: '', tagColor: '#6366F1', date: '2026-08-10', duration: 30, isCompleted: false,
    },
    body: '',
  }],
});

test('人生地图投影保留全部真实项目，并把缺失、隐藏和已删除分类安全归入未分类', () => {
  const tasks = [
    task('study-project', 'study'),
    task('uncategorized-project'),
    task('missing-project', 'missing-area'),
    task('hidden-project', 'hidden-area'),
    task('deleted-project', 'deleted-area'),
  ];

  const projection = createProjectPlanningProjection(tasks, areas);

  assert.deepEqual(projection.tasks.map((item) => item.id), tasks.map((item) => item.id));
  assert.equal(projection.tasks[0].groupId, 'study');
  assert.equal(projection.tasks[0].lifeMapKind, 'plan');
  assert.equal(projection.tasks[0].blocks[0].id, 'study-project-block');
  assert.deepEqual(
    projection.tasks.slice(1).map((item) => item.groupId),
    Array(4).fill(UNCLASSIFIED_PLANNING_AREA_ID),
  );
  assert.ok(projection.areas.some((area) => area.id === UNCLASSIFIED_PLANNING_AREA_ID));
  assert.ok(projection.groups.some((group) => group.id === 'unclassified'));
  assert.deepEqual(projection.goals.map((goal) => goal.id), tasks.map((item) => `timeline-project:${item.id}`));
});

test('项目规划按一级分类、二级领域和未分类筛选，但全部视图永不丢项目', () => {
  const tasks = [
    task('study-project', 'study'),
    task('career-project', 'career'),
    task('health-project', 'health'),
    task('uncategorized-project'),
    task('orphan-project', 'missing-area'),
  ];

  assert.deepEqual(filterProjectsByPlanningScope(tasks, areas, { groupId: 'all' }).map((item) => item.id), tasks.map((item) => item.id));
  assert.deepEqual(filterProjectsByPlanningScope(tasks, areas, { groupId: 'learning' }).map((item) => item.id), ['study-project']);
  assert.deepEqual(filterProjectsByPlanningScope(tasks, areas, { groupId: 'work', areaId: 'career' }).map((item) => item.id), ['career-project']);
  assert.deepEqual(filterProjectsByPlanningScope(tasks, areas, { groupId: 'unclassified' }).map((item) => item.id), ['uncategorized-project', 'orphan-project']);
});

test('人生地图泳道把真实项目放入对应分类，并为旧项目建立独立未分类分区', () => {
  const projection = createProjectPlanningProjection([
    task('study-project', 'study'),
    task('legacy-project'),
  ], areas);

  const layout = createLifeMapPlanSwimlaneLayout({
    plans: projection.goals,
    phases: [],
    systems: [],
    areas: projection.areas,
    groups: projection.groups,
    filter: 'all',
    dateToX: (date) => Number(date.slice(-2)) * 10,
  });

  assert.deepEqual(layout.sections.map((section) => section.groupId), ['learning', 'unclassified']);
  assert.deepEqual(layout.bars.map((bar) => bar.taskId), ['study-project', 'legacy-project']);
  assert.equal(layout.rows.find((row) => row.areaId === UNCLASSIFIED_PLANNING_AREA_ID)?.name, '未分类');
});

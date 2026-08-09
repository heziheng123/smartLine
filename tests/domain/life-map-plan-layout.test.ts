import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyLifeMapData } from '../../src/lifeMap/data.ts';
import {
  assignInclusiveIntervalTracks,
  createLifeMapPlanSwimlaneLayout,
} from '../../src/lifeMap/planSwimlaneLayout.ts';
import type { LifeArea, LifeGoal, LifeSystem } from '../../src/lifeMap/types.ts';

const stamp = { createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z', revision: 1 };
const area = (id: string, planGroupId: LifeArea['planGroupId'], order = 0): LifeArea => ({
  id, name: id, color: '#64748B', planGroupId, order, ...stamp,
});
const goal = (id: string, areaId: string, start: string, targetDate: string, kind: 'plan' | 'phase' = 'plan', parentGoalId?: string): LifeGoal => ({
  id, areaId, name: id, start, targetDate, status: 'active', progress: 0, kind, parentGoalId, ...stamp,
});
const system = (id: string, areaId: string, start: string, end?: string): LifeSystem => ({
  id, areaId, name: id, start, end, frequency: 'weekly', targetCount: 3, status: 'active', ...stamp,
});

test('包含结束日的计划分轨使用最少轨道，相邻次日可以复用', () => {
  const result = assignInclusiveIntervalTracks([
    goal('a', 'math', '2026-08-01', '2026-08-03'),
    goal('b', 'math', '2026-08-03', '2026-08-04'),
    goal('c', 'math', '2026-08-04', '2026-08-04'),
    goal('d', 'math', '2026-08-05', '2026-08-06'),
  ]);

  assert.equal(result.trackCount, 2);
  assert.equal(result.trackById.get('a'), 0);
  assert.equal(result.trackById.get('b'), 1);
  assert.equal(result.trackById.get('c'), 0);
  assert.equal(result.trackById.get('d'), 0);
});

test('每个领域独立分轨，阶段继承父计划的大类、领域、侧边和轨道', () => {
  const data = createEmptyLifeMapData('2026-08-09T00:00:00.000Z');
  const areas = [area('math', 'learning'), area('english', 'learning', 1), area('job', 'work')];
  const plans = [
    goal('math-a', 'math', '2026-08-01', '2026-08-10'),
    goal('math-b', 'math', '2026-08-03', '2026-08-05'),
    goal('english-a', 'english', '2026-08-03', '2026-08-05'),
    goal('job-a', 'job', '2026-08-01', '2026-08-02'),
  ];
  const phases = [goal('phase-a', 'job', '2026-08-04', '2026-08-06', 'phase', 'math-a')];

  const layout = createLifeMapPlanSwimlaneLayout({
    plans, phases, areas, groups: data.lifeMapPlanGroups, filter: 'all',
    dateToX: (date) => Number(date.slice(-2)) * 10,
  });

  const math = layout.rows.find((row) => row.areaId === 'math');
  const english = layout.rows.find((row) => row.areaId === 'english');
  const phase = layout.bars.find((bar) => bar.goalId === 'phase-a');
  const parent = layout.bars.find((bar) => bar.goalId === 'math-a');
  assert.equal(math?.trackCount, 2);
  assert.equal(english?.trackCount, 1);
  assert.equal(phase?.areaId, 'math');
  assert.equal(phase?.groupId, 'learning');
  assert.equal(phase?.placement, 'above');
  assert.equal(phase?.trackIndex, parent?.trackIndex);
  assert.equal(phase?.rowId, parent?.rowId);
});

test('项目筛选只输出目标大类，全部大类同侧时仍按固定顺序稳定排列', () => {
  const data = createEmptyLifeMapData('2026-08-09T00:00:00.000Z');
  const groups = data.lifeMapPlanGroups.map((group) => ({ ...group, placement: 'above' as const }));
  const areas = [area('study', 'learning'), area('career', 'work'), area('health', 'life')];
  const plans = [
    goal('study-plan', 'study', '2026-08-01', '2026-08-02'),
    goal('career-plan', 'career', '2026-08-01', '2026-08-02'),
    goal('health-plan', 'health', '2026-08-01', '2026-08-02'),
  ];
  const input = { plans, phases: [], areas, groups, dateToX: () => 0 };

  const all = createLifeMapPlanSwimlaneLayout({ ...input, filter: 'all' });
  assert.deepEqual(all.sections.map((section) => section.groupId), ['learning', 'work', 'life']);
  assert.deepEqual(all.sections.map((section) => section.offset), [0, all.sections[0].height, all.sections[0].height + all.sections[1].height]);
  assert.equal(all.bottomHeight, 0);

  const filtered = createLifeMapPlanSwimlaneLayout({ ...input, filter: 'work' });
  assert.deepEqual(filtered.sections.map((section) => section.groupId), ['work']);
  assert.deepEqual(filtered.bars.map((bar) => bar.goalId), ['career-plan']);
});

test('长期系统进入所属领域并始终排在项目轨道上方', () => {
  const data = createEmptyLifeMapData('2026-08-09T00:00:00.000Z');
  const areas = [area('math', 'learning')];
  const layout = createLifeMapPlanSwimlaneLayout({
    plans: [goal('plan-a', 'math', '2026-08-01', '2026-08-20')],
    phases: [],
    systems: [
      system('system-a', 'math', '2026-08-01', '2026-08-31'),
      system('system-b', 'math', '2026-08-10', '2026-08-25'),
    ],
    areas,
    groups: data.lifeMapPlanGroups,
    filter: 'all',
    layoutEnd: '2026-12-31',
    dateToX: (date) => Number(date.slice(-2)) * 10,
  });

  const systemBars = layout.bars.filter((bar) => bar.kind === 'system');
  const planBar = layout.bars.find((bar) => bar.kind === 'plan');
  assert.deepEqual(systemBars.map((bar) => bar.trackIndex), [0, 1]);
  assert.equal(planBar?.trackIndex, 2);
  assert.equal(layout.rows[0].trackCount, 3);
  assert.ok(systemBars.every((bar) => bar.areaId === 'math' && bar.groupId === 'learning'));
});

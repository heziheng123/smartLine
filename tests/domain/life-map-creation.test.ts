import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyLifeMapData } from '../../src/lifeMap/data.ts';
import {
  findFirstAvailablePhaseRange,
  resolveLifeMapCreationDefaults,
} from '../../src/lifeMap/lifeMapCreationContext.ts';
import { createLifeMapPeriodFocusItems } from '../../src/lifeMap/lifeMapPeriodFocus.ts';
import type { LifeGoal, LifeMapSyncMeta } from '../../src/lifeMap/types.ts';

const meta: LifeMapSyncMeta = {
  createdAt: '2026-08-09T00:00:00.000Z',
  updatedAt: '2026-08-09T00:00:00.000Z',
  revision: 1,
};

const plan = (value: Partial<LifeGoal> = {}): LifeGoal => ({
  id: 'plan-a',
  areaId: 'learning',
  name: '考研政治',
  start: '2026-08-01',
  targetDate: '2026-08-31',
  status: 'active',
  kind: 'plan',
  ...meta,
  ...value,
});

test('创建默认值优先使用当前项目，其次使用当前领域、上次领域和首个可见领域', () => {
  const data = createEmptyLifeMapData();
  data.lifeMapGoals = [plan()];

  assert.deepEqual(
    resolveLifeMapCreationDefaults('plan', { source: 'plan', planId: 'plan-a' }, data, { plan: 'career' }),
    { areaId: 'learning', parentPlanId: 'plan-a' },
  );
  assert.deepEqual(
    resolveLifeMapCreationDefaults('goal', { source: 'lane', areaId: 'health' }, data, { goal: 'career' }),
    { areaId: 'health' },
  );
  assert.deepEqual(
    resolveLifeMapCreationDefaults('system', { source: 'global' }, data, { system: 'career' }),
    { areaId: 'career' },
  );
  assert.deepEqual(
    resolveLifeMapCreationDefaults('goal', { source: 'global' }, data, {}),
    { areaId: 'health' },
  );
});

test('关键日期默认保持全局，只继承画布选择的日期', () => {
  const data = createEmptyLifeMapData();
  assert.deepEqual(
    resolveLifeMapCreationDefaults('event', { source: 'date', areaId: 'learning', date: '2026-08-20' }, data, { event: 'career' }),
    { date: '2026-08-20' },
  );
});

test('子阶段默认使用项目内第一段未覆盖的完整区间', () => {
  const parent = plan();
  const phases = [
    plan({ id: 'phase-a', kind: 'phase', parentGoalId: parent.id, start: '2026-08-01', targetDate: '2026-08-10' }),
    plan({ id: 'phase-b', kind: 'phase', parentGoalId: parent.id, start: '2026-08-15', targetDate: '2026-08-20' }),
  ];

  assert.deepEqual(findFirstAvailablePhaseRange(parent, phases), { start: '2026-08-11', end: '2026-08-14' });
  assert.deepEqual(findFirstAvailablePhaseRange(parent, []), { start: '2026-08-01', end: '2026-08-31' });
  assert.equal(findFirstAvailablePhaseRange(parent, [
    plan({ id: 'phase-all', kind: 'phase', parentGoalId: parent.id, start: parent.start, targetDate: parent.targetDate }),
  ]), null);
});

test('主题、重点和旧范围便签统一投影为时期重点且保留来源', () => {
  const data = createEmptyLifeMapData();
  data.lifeMapThemes = [{ id: 'theme-a', areaId: 'learning', name: '冲刺', start: '2026-08-01', end: '2026-09-30', ...meta }];
  data.lifeMapFocuses = [{ id: 'focus-a', areaId: 'career', name: '交付', start: '2026-08-10', end: '2026-08-20', ...meta }];
  data.lifeMapNotes = [
    { id: 'range-a', areaId: 'health', name: '恢复', date: '2026-08-05', endDate: '2026-08-12', type: 'range', ...meta },
    { id: 'pin-a', areaId: 'health', name: '普通便签', date: '2026-08-09', type: 'pin', ...meta },
  ];

  assert.deepEqual(createLifeMapPeriodFocusItems(data).map((item) => [item.sourceKind, item.sourceId, item.name]), [
    ['theme', 'theme-a', '冲刺'],
    ['range-note', 'range-a', '恢复'],
    ['focus', 'focus-a', '交付'],
  ]);
});

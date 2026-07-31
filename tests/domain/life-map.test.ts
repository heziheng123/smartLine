import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  activeLifeMapItems,
  createEmptyLifeMapData,
  hasIndependentLifeMapContent,
  migrateLegacyLifeMapLayouts,
  normalizeLifeMapData,
} from '../../src/lifeMap/data.ts';
import { mergeWorkspaceFieldChanges } from '../../src/services/workspaceSyncCore.ts';
import { calculateGoalProgress, currentSystemStats, systemTargetForRange } from '../../src/lifeMap/metrics.ts';

const meta = { createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z', revision: 1 };

test('人生地图默认领域完整，且默认领域不算用户规划内容', () => {
  const data = createEmptyLifeMapData();
  assert.equal(data.lifeMapAreas.length, 6);
  assert.equal(hasIndependentLifeMapContent(data), false);
});

test('规范化会补齐默认领域、去重并过滤悬空领域引用', () => {
  const data = normalizeLifeMapData({
    lifeMapAreas: [],
    lifeMapGoals: [
      { id: 'goal-1', areaId: 'health', name: '恢复作息', start: '2026-07-30', targetDate: '2026-08-30', status: 'active', ...meta },
      { id: 'goal-1', areaId: 'health', name: '恢复稳定作息', start: '2026-07-30', targetDate: '2026-08-30', status: 'active', ...meta },
      { id: 'goal-orphan', areaId: 'missing', name: '悬空', start: '2026-07-30', targetDate: '2026-08-30', status: 'active', ...meta },
    ],
  });
  assert.equal(data.lifeMapAreas.length, 6);
  assert.equal(data.lifeMapGoals.length, 1);
  assert.equal(data.lifeMapGoals[0]?.name, '恢复稳定作息');
});

test('删除墓碑会保留在同步数据中，但不会出现在活动内容中', () => {
  const deletedAt = '2026-07-31T00:00:00.000Z';
  const data = normalizeLifeMapData({
    lifeMapEvents: [{ id: 'event-1', areaId: 'health', name: '体检', date: '2026-08-20', ...meta, deletedAt }],
  });
  assert.equal(data.lifeMapEvents.length, 1);
  assert.equal(activeLifeMapItems(data.lifeMapEvents).length, 0);
});

test('规范化会拒绝空日期和起止倒置，避免保存后刷新静默消失', () => {
  const data = normalizeLifeMapData({
    lifeMapStages: [
      { id: 'bad-empty', name: '空日期', start: '', end: '2026-08-01', ...meta },
      { id: 'bad-order', name: '倒置日期', start: '2026-09-01', end: '2026-08-01', ...meta },
      { id: 'good', name: '有效阶段', start: '2026-08-01', end: '2026-09-01', ...meta },
    ],
    lifeMapNotes: [
      { id: 'bad-note', areaId: 'health', name: '倒置便签', date: '2026-08-10', endDate: '2026-08-01', type: 'range', ...meta },
    ],
  });
  assert.deepEqual(data.lifeMapStages.map((item) => item.id), ['good']);
  assert.equal(data.lifeMapNotes.length, 0);
});

test('长期系统完成记录与周期复盘可规范化，并过滤悬空完成记录', () => {
  const data = normalizeLifeMapData({
    lifeMapSystems: [{ id: 'system-1', areaId: 'health', name: '每周跑步', start: '2026-07-01', status: 'active', frequency: 'weekly', targetCount: 3, durationMinutes: 40, ...meta }],
    lifeMapSystemCheckIns: [
      { id: 'check-1', systemId: 'system-1', date: '2026-07-30', count: 1, ...meta },
      { id: 'check-orphan', systemId: 'missing', date: '2026-07-30', count: 1, ...meta },
    ],
    lifeMapReviews: [{ id: 'review-1', title: '七月复盘', period: 'month', start: '2026-07-01', end: '2026-07-31', reflection: '运动开始稳定', adjustments: '下月保持', snapshot: { goals: [], systems: [{ id: 'system-1', name: '每周跑步', completed: 5, target: 12 }] }, ...meta }],
  });
  assert.equal(data.lifeMapSystemCheckIns.length, 1);
  assert.equal(data.lifeMapSystemCheckIns[0]?.systemId, 'system-1');
  assert.equal(data.lifeMapReviews[0]?.snapshot.systems[0]?.completed, 5);
});

test('多端分别编辑不同人生地图实体时可进行实体级三方合并', () => {
  const baseline = [{ id: 'goal-1', name: '恢复作息', progress: 0 }];
  const pending = [{ id: 'goal-1', name: '恢复作息', progress: 30 }];
  const remote = [{ id: 'goal-1', name: '稳定睡眠', progress: 0 }];
  const result = mergeWorkspaceFieldChanges(
    { lifeMapGoals: pending },
    { lifeMapGoals: baseline },
    { lifeMapGoals: remote },
  );
  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.fields.lifeMapGoals, [{ id: 'goal-1', name: '稳定睡眠', progress: 30 }]);
});

test('目标进度可根据起始值、当前值和目标值自动计算增加型与减少型目标', () => {
  assert.equal(calculateGoalProgress({ progressMode: 'auto', initialValue: 50, currentValue: 60, targetValue: 75 }), 40);
  assert.equal(calculateGoalProgress({ progressMode: 'auto', initialValue: 80, currentValue: 74, targetValue: 70 }), 60);
  assert.equal(calculateGoalProgress({ progressMode: 'manual', progress: 37 }), 37);
});

test('旧的本机人生地图布局会迁移到可同步实体字段且不会覆盖已有云端偏好', () => {
  const source = normalizeLifeMapData({
    lifeMapGoals: [
      { id: 'goal-local', areaId: 'health', name: '运动', start: '2026-07-01', targetDate: '2026-08-01', status: 'active', ...meta },
      { id: 'goal-cloud', areaId: 'health', name: '睡眠', start: '2026-07-01', targetDate: '2026-08-01', status: 'active', placement: 'above', ...meta },
    ],
    lifeMapEvents: [
      { id: 'exam', areaId: 'learning', name: '考试', date: '2026-08-20', ...meta },
    ],
    lifeMapThemes: [
      { id: 'health-theme', areaId: 'health', name: '恢复', start: '2026-07-01', end: '2026-09-01', ...meta },
    ],
  });
  const result = migrateLegacyLifeMapLayouts(source, {
    projectSides: { 'goal:goal-local': 'below', 'goal:goal-cloud': 'below' },
    nodeLayouts: {
      'milestone:exam': { side: 'top', lane: 3 },
      'note:theme:health-theme': { side: 'bottom', lane: 2 },
    },
  }, '2026-07-31T00:00:00.000Z');
  assert.equal(result.changed, true);
  assert.equal(result.data.lifeMapGoals.find((item) => item.id === 'goal-local')?.placement, 'below');
  assert.equal(result.data.lifeMapGoals.find((item) => item.id === 'goal-cloud')?.placement, 'above');
  assert.deepEqual(
    result.data.lifeMapEvents.find((item) => item.id === 'exam') && {
      placement: result.data.lifeMapEvents.find((item) => item.id === 'exam')?.placement,
      lane: result.data.lifeMapEvents.find((item) => item.id === 'exam')?.layoutLane,
    },
    { placement: 'above', lane: 3 },
  );
  assert.equal(result.data.lifeMapThemes.find((item) => item.id === 'health-theme')?.layoutLane, 2);
});

test('长期系统严格按每天、每周和每月各自周期统计，不再换算成本周', () => {
  const base = { id: 'system', areaId: 'health', name: '系统', start: '2026-07-01', status: 'active' as const, targetCount: 1, ...meta };
  const daily = { ...base, frequency: 'daily' as const };
  const weekly = { ...base, frequency: 'weekly' as const, targetCount: 3 };
  const monthly = { ...base, frequency: 'monthly' as const };
  assert.equal(systemTargetForRange(daily, '2026-07-01', '2026-07-31'), 31);
  assert.equal(systemTargetForRange(weekly, '2026-07-01', '2026-07-31'), 15);
  assert.equal(systemTargetForRange(monthly, '2026-07-01', '2026-09-30'), 3);
  const stats = currentSystemStats(daily, [{ id: 'check', systemId: 'system', date: '2026-07-30', count: 1, ...meta }], dayjs('2026-07-30'));
  assert.equal(stats.label, '今天');
  assert.equal(stats.completed, 1);
  assert.equal(stats.target, 1);
});

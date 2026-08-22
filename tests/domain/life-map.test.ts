import test from 'node:test';
import assert from 'node:assert/strict';
import dayjs from 'dayjs';
import {
  activeLifeMapItems,
  canDeleteLifeArea,
  createEmptyLifeMapData,
  hasIndependentLifeMapContent,
  migrateLegacyLifeMapLayouts,
  normalizeLifeMapData,
} from '../../src/lifeMap/data.ts';
import { mergeWorkspaceFieldChanges } from '../../src/services/workspaceSyncCore.ts';
import { calculateGoalProgress, currentSystemStats, systemTargetForRange } from '../../src/lifeMap/metrics.ts';
import { activeMaintenancePeriod, isDateInMaintenance, maintenanceDayCount } from '../../src/lifeMap/maintenance.ts';
import { SUPPORTED_WORKSPACE_SCHEMA_VERSIONS, WORKSPACE_SCHEMA_VERSION } from '../../src/services/workspaceSchema.ts';

const meta = { createdAt: '2026-07-30T00:00:00.000Z', updatedAt: '2026-07-30T00:00:00.000Z', revision: 1 };

test('人生地图默认领域完整，且默认领域不算用户规划内容', () => {
  const data = createEmptyLifeMapData();
  assert.equal(data.lifeMapAreas.length, 6);
  assert.equal(hasIndependentLifeMapContent(data), false);
});

test('默认人生领域映射到固定三大类且大类偏好不算用户内容', () => {
  const data = createEmptyLifeMapData();
  assert.deepEqual(data.lifeMapPlanGroups.map((group) => ({
    id: group.id,
    placement: group.placement,
    order: group.order,
  })), [
    { id: 'learning', placement: 'above', order: 0 },
    { id: 'work', placement: 'below', order: 1 },
    { id: 'life', placement: 'below', order: 2 },
  ]);
  assert.deepEqual(Object.fromEntries(data.lifeMapAreas.map((area) => [area.id, area.planGroupId])), {
    health: 'life',
    learning: 'learning',
    career: 'work',
    finance: 'life',
    relationships: 'life',
    personal: 'life',
  });
  assert.equal(hasIndependentLifeMapContent(data), false);
});

test('已删除的默认二级分类以 tombstone 保留且规范化不会自动补回', () => {
  const deletedAt = '2026-08-09T00:00:00.000Z';
  const initial = createEmptyLifeMapData();
  const normalized = normalizeLifeMapData({
    lifeMapAreas: initial.lifeMapAreas.map((area) => ({ ...area, deletedAt })),
  });

  assert.equal(activeLifeMapItems(normalized.lifeMapAreas).length, 0);
  assert.deepEqual(
    normalized.lifeMapAreas.map((area) => area.id).sort(),
    initial.lifeMapAreas.map((area) => area.id).sort(),
  );
  assert.ok(normalized.lifeMapAreas.every((area) => area.deletedAt === deletedAt));
});

test('规范化修复非法大类配置并为旧自建领域提供安全归属', () => {
  const data = normalizeLifeMapData({
    lifeMapAreas: [
      { id: 'learning', name: '学习成长', color: '#6366F1', order: 0, planGroupId: 'invalid', ...meta },
      { id: 'custom', name: '自定义领域', color: '#64748B', order: 6, ...meta },
    ],
    lifeMapPlanGroups: [
      { id: 'learning', placement: 'sideways', order: 9, ...meta },
      { id: 'work', placement: 'above', order: 7, ...meta },
      { id: 'unknown', placement: 'above', order: 0, ...meta },
    ],
  });

  assert.equal(data.lifeMapAreas.find((area) => area.id === 'learning')?.planGroupId, 'learning');
  assert.equal(data.lifeMapAreas.find((area) => area.id === 'custom')?.planGroupId, 'life');
  assert.deepEqual(data.lifeMapPlanGroups.map((group) => ({
    id: group.id,
    placement: group.placement,
    order: group.order,
  })), [
    { id: 'learning', placement: 'above', order: 0 },
    { id: 'work', placement: 'above', order: 1 },
    { id: 'life', placement: 'below', order: 2 },
  ]);
});

test('规范化会补齐默认领域、去重并保留历史目标数据', () => {
  const data = normalizeLifeMapData({
    lifeMapAreas: [],
    lifeMapGoals: [
      { id: 'goal-1', areaId: 'health', name: '恢复作息', start: '2026-07-30', targetDate: '2026-08-30', status: 'active', ...meta },
      { id: 'goal-1', areaId: 'health', name: '恢复稳定作息', start: '2026-07-30', targetDate: '2026-08-30', status: 'active', ...meta },
      { id: 'goal-orphan', areaId: 'missing', name: '悬空', start: '2026-07-30', targetDate: '2026-08-30', status: 'active', ...meta },
    ],
  });
  assert.equal(data.lifeMapAreas.length, 6);
  assert.equal(data.lifeMapGoals.length, 2);
  assert.equal(data.lifeMapGoals[0]?.name, '恢复稳定作息');
  assert.equal(data.lifeMapGoals[1]?.id, 'goal-orphan');
});

test('主计划与月度阶段沿用目标集合并过滤悬空阶段', () => {
  const data = normalizeLifeMapData({
    lifeMapGoals: [
      { id: 'plan-politics', areaId: 'learning', name: '考研政治', start: '2026-08-01', targetDate: '2026-10-31', status: 'active', kind: 'plan', ...meta },
      { id: 'phase-marxism', areaId: 'learning', name: '完成马原学习', start: '2026-08-01', targetDate: '2026-08-31', status: 'active', kind: 'phase', parentGoalId: 'plan-politics', ...meta },
      { id: 'phase-orphan', areaId: 'learning', name: '悬空阶段', start: '2026-09-01', targetDate: '2026-09-30', status: 'active', kind: 'phase', parentGoalId: 'missing', ...meta },
    ],
  });
  assert.deepEqual(data.lifeMapGoals.map((item) => item.id), ['plan-politics', 'phase-marxism']);
  assert.equal(data.lifeMapGoals[1]?.parentGoalId, 'plan-politics');
});

test('schema 7 保留全局关键日期并清理无效领域和计划引用', () => {
  assert.equal(WORKSPACE_SCHEMA_VERSION, 7);
  assert.deepEqual([...SUPPORTED_WORKSPACE_SCHEMA_VERSIONS], [1, 2, 3, 4, 5, 6, 7]);

  const data = normalizeLifeMapData({
    lifeMapGoals: [
      { id: 'outcome', areaId: 'learning', name: '政治 75 分', start: '2026-08-01', targetDate: '2026-12-20', status: 'active', kind: 'goal', ...meta },
      { id: 'plan-valid', areaId: 'learning', name: '考研政治', start: '2026-08-01', targetDate: '2026-12-20', status: 'active', kind: 'plan', outcomeGoalId: 'outcome', ...meta },
      { id: 'plan-orphan-link', areaId: 'learning', name: '独立项目', start: '2026-08-01', targetDate: '2026-10-01', status: 'active', kind: 'plan', outcomeGoalId: 'missing', ...meta },
    ],
    lifeMapEvents: [
      { id: 'global', name: '报名截止', date: '2026-09-01', ...meta },
      { id: 'invalid-area', areaId: 'missing', name: '全局考试', date: '2026-10-01', ...meta },
      { id: 'related', relatedPlanId: 'plan-valid', name: '模考', date: '2026-11-01', ...meta },
      { id: 'invalid-plan', relatedPlanId: 'missing', name: '待确认', date: '2026-11-10', ...meta },
    ],
  });

  assert.equal(data.lifeMapGoals.find((item) => item.id === 'plan-valid')?.outcomeGoalId, 'outcome');
  assert.equal(data.lifeMapGoals.find((item) => item.id === 'plan-orphan-link')?.outcomeGoalId, 'missing');
  assert.deepEqual(data.lifeMapEvents.map((item) => ({ id: item.id, areaId: item.areaId, relatedPlanId: item.relatedPlanId })), [
    { id: 'global', areaId: undefined, relatedPlanId: undefined },
    { id: 'invalid-area', areaId: undefined, relatedPlanId: undefined },
    { id: 'related', areaId: undefined, relatedPlanId: 'plan-valid' },
    { id: 'invalid-plan', areaId: undefined, relatedPlanId: undefined },
  ]);
});

test('历史目标与删除墓碑在二级分类删除后仍保持原样', () => {
  const deletedAt = '2026-08-09T00:00:00.000Z';
  const initial = createEmptyLifeMapData();
  const data = normalizeLifeMapData({
    lifeMapAreas: initial.lifeMapAreas.map((area) => area.id === 'learning' ? { ...area, deletedAt } : area),
    lifeMapGoals: [
      { id: 'legacy-goal', areaId: 'learning', name: '历史目标', start: '2026-08-01', targetDate: '2026-12-01', status: 'active', outcomeGoalId: 'legacy-link', ...meta },
      { id: 'deleted-phase', areaId: 'learning', name: '已删除子阶段', start: '2026-08-01', targetDate: '2026-08-31', status: 'active', kind: 'phase', parentGoalId: 'deleted-plan', ...meta, deletedAt },
    ],
  });

  assert.equal(data.lifeMapGoals.find((item) => item.id === 'legacy-goal')?.outcomeGoalId, 'legacy-link');
  assert.equal(data.lifeMapGoals.find((item) => item.id === 'deleted-phase')?.deletedAt, deletedAt);
});

test('二级分类删除保护只统计仍可见的规划引用', () => {
  const base = createEmptyLifeMapData();
  const historicalGoal = { id: 'hidden-goal', areaId: 'learning', name: '历史目标', start: '2026-08-01', targetDate: '2026-12-01', status: 'active' as const, kind: 'goal' as const, ...meta };
  assert.equal(canDeleteLifeArea({ ...base, lifeMapGoals: [historicalGoal] }, 'learning'), true);

  const plan = { ...historicalGoal, id: 'plan', name: '项目', kind: 'plan' as const };
  assert.equal(canDeleteLifeArea({ ...base, lifeMapGoals: [plan] }, 'learning'), false);
  assert.equal(canDeleteLifeArea({ ...base, lifeMapGoals: [{ ...plan, deletedAt: '2026-08-09T00:00:00.000Z' }] }, 'learning'), true);
  assert.equal(canDeleteLifeArea({ ...base, lifeMapEvents: [{ id: 'event', areaId: 'learning', name: '关键日期', date: '2026-08-20', ...meta }] }, 'learning'), false);
  assert.equal(canDeleteLifeArea({ ...base, lifeMapNotes: [{ id: 'note', areaId: 'learning', name: '便签', date: '2026-08-20', type: 'note', ...meta }] }, 'learning'), false);
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

test('v13 阶段字段兼容旧数据，并保留描述与重要性', () => {
  const data = normalizeLifeMapData({
    lifeMapStages: [
      { id: 'legacy', name: '旧阶段', start: '2026-08-01', end: '2026-08-31', ...meta },
      { id: 'important', name: '重要阶段', start: '2026-09-01', end: '2026-09-30', description: '需要集中投入', importance: 'important', ...meta },
    ],
  });

  assert.deepEqual(data.lifeMapStages.map((stage) => ({
    id: stage.id,
    description: stage.description,
    importance: stage.importance,
  })), [
    { id: 'legacy', description: '', importance: 'normal' },
    { id: 'important', description: '需要集中投入', importance: 'important' },
  ]);
});

test('阶段导入校验拒绝不合法的重要性与描述', () => {
  const invalidImportance = normalizeLifeMapData({
    lifeMapStages: [{ id: 'bad-importance', name: '阶段', start: '2026-08-01', end: '2026-08-31', importance: 'core', ...meta }],
  });
  const invalidDescription = normalizeLifeMapData({
    lifeMapStages: [{ id: 'bad-description', name: '阶段', start: '2026-08-01', end: '2026-08-31', description: 42, ...meta }],
  });

  assert.equal(invalidImportance.lifeMapStages.length, 0);
  assert.equal(invalidDescription.lifeMapStages.length, 0);
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

test('大类偏好按实体合并，不同大类可并行修改而同一属性冲突会被保护', () => {
  const base = [
    { id: 'learning', placement: 'above', order: 0 },
    { id: 'work', placement: 'below', order: 1 },
    { id: 'life', placement: 'below', order: 2 },
  ];
  const local = base.map((item) => item.id === 'learning' ? { ...item, placement: 'below' } : item);
  const remote = base.map((item) => item.id === 'work' ? { ...item, placement: 'above' } : item);
  const merged = mergeWorkspaceFieldChanges(
    { lifeMapPlanGroups: local },
    { lifeMapPlanGroups: base },
    { lifeMapPlanGroups: remote },
  );
  assert.deepEqual(merged.conflicts, []);
  assert.equal((merged.fields.lifeMapPlanGroups as typeof base).find((item) => item.id === 'learning')?.placement, 'below');
  assert.equal((merged.fields.lifeMapPlanGroups as typeof base).find((item) => item.id === 'work')?.placement, 'above');

  const conflict = mergeWorkspaceFieldChanges(
    { lifeMapPlanGroups: local },
    { lifeMapPlanGroups: base },
    { lifeMapPlanGroups: base.map((item) => item.id === 'learning' ? { ...item, placement: 'sideways' } : item) },
  );
  assert.deepEqual(conflict.conflicts, ['lifeMapPlanGroups[learning].placement']);
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

test('维护期会随人生领域和长期系统数据规范化保留，供多端同步使用', () => {
  const data = normalizeLifeMapData({
    lifeMapAreas: [{
      id: 'health',
      name: '身体健康',
      color: '#22C55E',
      order: 0,
      maintenancePeriods: [{ id: 'area-pause', start: '2026-08-02', reason: '身体恢复' }],
      ...meta,
    }],
    lifeMapSystems: [{
      id: 'sleep',
      areaId: 'health',
      name: '按时睡觉',
      start: '2026-07-01',
      status: 'active',
      frequency: 'daily',
      targetCount: 1,
      maintenancePeriods: [{ id: 'system-pause', start: '2026-07-10', end: '2026-07-13' }],
      ...meta,
    }],
  });
  assert.deepEqual(data.lifeMapAreas.find((area) => area.id === 'health')?.maintenancePeriods, [
    { id: 'area-pause', start: '2026-08-02', reason: '身体恢复' },
  ]);
  assert.deepEqual(data.lifeMapSystems[0]?.maintenancePeriods, [
    { id: 'system-pause', start: '2026-07-10', end: '2026-07-13' },
  ]);
});

test('维护结束日期是恢复日，维护期间不计入长期系统目标', () => {
  const periods = [{ id: 'pause', start: '2026-07-10', end: '2026-07-13' }];
  assert.equal(isDateInMaintenance('2026-07-09', periods), false);
  assert.equal(isDateInMaintenance('2026-07-10', periods), true);
  assert.equal(isDateInMaintenance('2026-07-12', periods), true);
  assert.equal(isDateInMaintenance('2026-07-13', periods), false);
  assert.equal(maintenanceDayCount(periods, '2026-07-01', '2026-07-31'), 3);
  assert.equal(activeMaintenancePeriod(periods, dayjs('2026-07-11'))?.id, 'pause');

  const daily = {
    id: 'sleep', areaId: 'health', name: '按时睡觉', start: '2026-07-01', status: 'active' as const,
    frequency: 'daily' as const, targetCount: 1, maintenancePeriods: periods, ...meta,
  };
  const weekly = {
    ...daily,
    frequency: 'weekly' as const,
    targetCount: 3,
    maintenancePeriods: [{ id: 'full-week', start: '2026-07-06', end: '2026-07-13' }],
  };
  assert.equal(systemTargetForRange(daily, '2026-07-01', '2026-07-31'), 28);
  assert.equal(systemTargetForRange(weekly, '2026-07-06', '2026-07-12'), 0);
});

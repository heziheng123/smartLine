import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyLifeMapData } from '../../src/lifeMap/data.ts';
import { createLifeMapTimeMapper, getLifeMapDateRange } from '../../src/lifeMap/time/lifeMapTime.ts';
import { getStageContents, getStageOverlaps, getStageStats, getStageWorkspaceDefaultZoom, getUnassignedLifeMapContent } from '../../src/lifeMap/selectors/lifeMapSelectors.ts';
import { createLifePathGeometry } from '../../src/lifeMap/geometry/lifePathGeometry.ts';
import { createParallelStageBands, createStageBand, createStageBranchLayout } from '../../src/lifeMap/geometry/stageBandGeometry.ts';

const meta = { createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', revision: 1 };

test('v13 时间映射严格等距且可逆，主路径范围忽略项目', () => {
  const data = createEmptyLifeMapData();
  data.lifeMapStages = [{ id: 'stage', name: '阶段', start: '2026-03-01', end: '2026-03-31', ...meta }];
  data.lifeMapEvents = [{ id: 'event', name: '关键日期', date: '2026-05-10', ...meta }];
  data.lifeMapGoals = [{ id: 'far-plan', areaId: 'learning', name: '远期项目', start: '2030-01-01', targetDate: '2031-01-01', status: 'active', kind: 'plan', ...meta }];
  const range = getLifeMapDateRange(data, '2026-04-01');
  assert.deepEqual(range, { minDate: '2025-12-01', maxDate: '2026-08-08', baseDate: '2025-12-01' });
  const time = createLifeMapTimeMapper(range.baseDate, 8);
  assert.equal(time.dateToWorldY('2026-01-01') - time.dateToWorldY('2025-12-31'), 8);
  assert.equal(time.worldYToDate(time.dateToWorldY('2026-05-10')), '2026-05-10');
});

test('v13 选择器按含首尾日期处理阶段内容、统计与未归属内容', () => {
  const data = createEmptyLifeMapData();
  data.lifeMapStages = [
    { id: 'stage-a', name: 'A', start: '2026-08-01', end: '2026-08-31', ...meta },
    { id: 'stage-b', name: 'B', start: '2026-08-20', end: '2026-09-10', ...meta },
  ];
  data.lifeMapGoals = [
    { id: 'plan', areaId: 'learning', name: '跨界项目', start: '2026-07-20', targetDate: '2026-08-01', status: 'active', kind: 'plan', progress: 50, ...meta },
    { id: 'phase', areaId: 'learning', name: '项目阶段', start: '2026-08-15', targetDate: '2026-08-25', status: 'active', kind: 'phase', parentGoalId: 'plan', progress: 80, ...meta },
    { id: 'unassigned', areaId: 'learning', name: '未归属', start: '2027-01-01', targetDate: '2027-01-02', status: 'active', kind: 'plan', ...meta },
  ];
  data.lifeMapSystems = [{ id: 'system', areaId: 'health', name: '运动', start: '2026-08-31', status: 'active', frequency: 'weekly', targetCount: 3, ...meta }];
  data.lifeMapSystemCheckIns = [{ id: 'check-in', systemId: 'system', date: '2026-08-31', count: 2, ...meta }];
  data.lifeMapNotes = [{ id: 'pin', areaId: 'learning', name: '收尾', date: '2026-08-31', type: 'pin', ...meta }];
  data.lifeMapEvents = [{ id: 'event', name: '节点', date: '2026-08-01', ...meta }];
  const contents = getStageContents(data, 'stage-a');
  assert.ok(contents);
  assert.deepEqual(contents.plans.map((item) => item.id), ['plan']);
  assert.deepEqual(contents.phases.map((item) => item.id), ['phase']);
  assert.equal(contents.systemCheckIns[0]?.count, 2);
  assert.deepEqual(contents.events.map((item) => item.id), ['event']);
  assert.equal(getStageStats(data, 'stage-a')?.completionRate, 65);
  assert.deepEqual(getStageOverlaps(data).map((item) => ({ start: item.start, end: item.end, count: item.stageIds.length })), [{ start: '2026-08-20', end: '2026-08-31', count: 2 }]);
  assert.deepEqual(getUnassignedLifeMapContent(data).plans.map((item) => item.id), ['unassigned']);
  assert.equal(getStageWorkspaceDefaultZoom({ start: '2026-01-01', end: '2027-01-02' }), 'month');
  assert.equal(getStageWorkspaceDefaultZoom({ start: '2026-01-01', end: '2026-04-01' }), 'half-month');
  assert.equal(getStageWorkspaceDefaultZoom({ start: '2026-01-01', end: '2026-01-07' }), 'week');
  assert.equal(getStageWorkspaceDefaultZoom({ start: '2026-01-01', end: '2026-01-06' }), 'day');
});

test('v13 几何层不依赖 DOM，路径连续、切线法线标准且标签保持可读', () => {
  const geometry = createLifePathGeometry({ todayY: 1000, stages: [{ id: 'important', startY: 800, endY: 1200, importance: 'important', isCurrent: true }] });
  for (let y = -2000; y <= 2000; y += 4) {
    const point = geometry.getLifePathPoint(y);
    const next = geometry.getLifePathPoint(y + 4);
    const tangent = geometry.getLifePathTangent(y);
    const normal = geometry.getLifePathNormal(y);
    assert.equal(point.y, y);
    assert.ok(Math.abs(next.x - point.x) < 4);
    assert.ok(Math.abs(Math.hypot(tangent.x, tangent.y) - 1) < 1e-9);
    assert.ok(Math.abs(Math.hypot(normal.x, normal.y) - 1) < 1e-9);
    assert.ok(Math.abs(tangent.x * normal.x + tangent.y * normal.y) < 1e-9);
    assert.ok(Math.abs(geometry.getLabelAngle(y)) <= 10);
    assert.ok(geometry.getAmplitudeAt() <= 72);
  }
});

test('v13 阶段弧带为封闭路径，四重重叠仅展示三条并稳定汇总', () => {
  const time = createLifeMapTimeMapper('2026-01-01', 4);
  const geometry = createLifePathGeometry();
  const stages = [0, 1, 2, 3].map((index) => ({ id: `stage-${index}`, name: `阶段 ${index}`, start: '2026-02-01', end: '2026-03-01', ...meta }));
  const band = createStageBand(stages[0], geometry, { dateToWorldY: time.dateToWorldY });
  assert.ok(band.path.startsWith('M '));
  assert.ok(band.path.endsWith(' Z'));
  assert.ok(band.points.length > 4);
  const parallel = createParallelStageBands(stages, geometry, { dateToWorldY: time.dateToWorldY, today: '2026-02-15', selectedStageId: 'stage-3' });
  assert.equal(parallel.visible.length, 3);
  assert.equal(parallel.overflowCount, 1);
  assert.deepEqual(parallel.visible.map((item) => item.id).sort(), ['stage-0', 'stage-1', 'stage-3']);
});

test('v13 普通时期路径收束，仅在阶段重叠区间平滑分叉并重新汇聚', () => {
  const time = createLifeMapTimeMapper('2026-01-01', 6);
  const stages = [
    { id: 'a', name: '工作', start: '2026-02-01', end: '2026-04-30', ...meta },
    { id: 'b', name: '学习', start: '2026-03-01', end: '2026-03-31', ...meta },
  ];
  const branches = createStageBranchLayout(stages, time.dateToWorldY);
  const beforeOverlap = time.dateToWorldY('2026-02-10');
  const inOverlap = time.dateToWorldY('2026-03-15');
  const afterOverlap = time.dateToWorldY('2026-04-20');
  assert.ok(Math.abs(branches.getOffset('a', time.dateToWorldY('2026-02-01'))) < 1);
  assert.ok(Math.abs(branches.getOffset('a', beforeOverlap)) < 1);
  assert.ok(Math.abs(branches.getOffset('a', inOverlap) - branches.getOffset('b', inOverlap)) > 20);
  assert.ok(Math.abs(branches.getOffset('a', afterOverlap)) < 1);
  assert.ok(Math.abs(branches.getOffset('a', time.dateToWorldY('2026-04-30'))) < 1);
});

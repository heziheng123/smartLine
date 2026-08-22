import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyLifeMapData, normalizeLifeMapData } from '../../src/lifeMap/data.ts';
import { createAnnotationBraceGeometry, createVerticalAnnotationBracePath, resolveAnnotationPresentation } from '../../src/lifeMap/geometry/annotationBraceGeometry.ts';
import { assignAnnotationTracks } from '../../src/lifeMap/geometry/annotationIntervalLayout.ts';
import { resolveAnnotationTextCollisions } from '../../src/lifeMap/geometry/annotationTextCollision.ts';
import { assignVerticalIntervalLanes, assignVerticalIntervalTracks } from '../../src/lifeMap/geometry/verticalIntervalLayout.ts';
import { layoutSystemChips } from '../../src/lifeMap/geometry/systemChipLayout.ts';
import { getCategoryProjectLanes, getProjectStripsByCategory } from '../../src/lifeMap/manuscript/manuscriptSelectors.ts';
import { getManuscriptDateRange, createLifeMapTimeMapper } from '../../src/lifeMap/time/lifeMapTime.ts';

const meta = { createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-01T00:00:00.000Z', revision: 1 };

test('纵向人生地图的范围包含项目和批注，批注大括号严格锚定日期坐标', () => {
  const data = createEmptyLifeMapData();
  data.lifeMapGoals = [{ id: 'plan', areaId: 'learning', name: '远期项目', start: '2027-02-10', targetDate: '2027-02-20', status: 'active', kind: 'plan', ...meta }];
  data.lifeMapNotes = [{ id: 'note', name: '未来批注', date: '2027-03-01', type: 'pin', ...meta }];
  const range = getManuscriptDateRange(data, '2026-08-21');
  assert.equal(range.minDate, '2026-06-07');
  assert.equal(range.maxDate, '2027-05-15');
  const mapper = createLifeMapTimeMapper(range.baseDate, 14);
  const brace = createAnnotationBraceGeometry('2027-03-01', '2027-03-01', mapper);
  assert.equal(brace.height, 0);
  assert.equal(mapper.worldYToDate(mapper.dateToWorldY('2027-02-20')), '2027-02-20');
});

test('v14 日期范围大括号在所有缩放下保持精确端点并生成曲线路径', () => {
  for (const pixelsPerDay of [.7, 4, 14, 38]) {
    const mapper = createLifeMapTimeMapper('2026-01-01', pixelsPerDay);
    const geometry = createAnnotationBraceGeometry('2026-08-18', '2026-08-24', mapper);
    assert.equal(geometry.top, mapper.dateToWorldY('2026-08-18'));
    assert.equal(geometry.bottom, mapper.dateToWorldY('2026-08-24'));
    assert.equal(geometry.height, geometry.bottom - geometry.top);
    const path = createVerticalAnnotationBracePath(20, geometry.top, geometry.bottom);
    assert.match(path, new RegExp(`^M 20 ${geometry.top} C `));
    assert.match(path, new RegExp(` 20 ${geometry.bottom}$`));
    assert.ok(path.includes(` 36 ${geometry.center} C 36 `));
    assert.ok(path.includes(' C ') && path.includes(' L '));
  }
});

test('v14 连续范围复用同一批注轨道，端点上的单日标记保持独立', () => {
  const groups = assignAnnotationTracks([
    { id: 'range-a', name: 'A', date: '2026-08-18', endDate: '2026-08-21', type: 'range', ...meta },
    { id: 'range-b', name: 'B', date: '2026-08-21', endDate: '2026-08-24', type: 'range', ...meta },
    { id: 'pin', name: 'P', date: '2026-08-21', type: 'pin', ...meta },
  ]);
  assert.equal(groups.find((item) => item.id.startsWith('range:2026-08-18'))?.track, 0);
  assert.equal(groups.find((item) => item.id.startsWith('range:2026-08-21'))?.track, 0);
  assert.equal(groups.find((item) => item.id.startsWith('single:2026-08-21'))?.track, 1);
});

test('v14 项目和批注均以含首尾日期进行稳定分轨', () => {
  const tracks = assignVerticalIntervalTracks([
    { id: 'a', start: '2026-08-18', end: '2026-08-21' },
    { id: 'b', start: '2026-08-21', end: '2026-08-24' },
    { id: 'c', start: '2026-08-22', end: '2026-08-25' },
    { id: 'd', start: '2026-08-26', end: '2026-08-27' },
  ]);
  assert.deepEqual(tracks.map(({ item, track }) => [item.id, track]), [['a', 0], ['b', 1], ['c', 0], ['d', 0]]);
  const groups = assignAnnotationTracks([
    { id: 'a', name: 'A', date: '2026-08-18', endDate: '2026-08-21', type: 'range', ...meta },
    { id: 'b', name: 'B', date: '2026-08-20', endDate: '2026-08-24', type: 'range', importance: 'important', ...meta },
    { id: 'c', name: 'C', date: '2026-08-18', endDate: '2026-08-21', type: 'range', ...meta },
  ]);
  assert.equal(groups.length, 2);
  assert.equal(groups.find((item) => item.id === 'range:2026-08-18:2026-08-21')?.notes.length, 2);
  assert.deepEqual(groups.map((item) => item.track).sort(), [0, 1]);
});

test('v14 项目条按局部重叠组分栏，不继承整列历史轨道数', () => {
  const lanes = assignVerticalIntervalLanes([
    { id: 'a', start: '2026-08-18', end: '2026-08-27' },
    { id: 'b', start: '2026-08-20', end: '2026-09-05' },
    { id: 'c', start: '2026-08-23', end: '2026-09-08' },
    { id: 'd', start: '2026-09-12', end: '2026-09-16' },
  ]);
  assert.deepEqual(lanes.map(({ item, laneIndex, laneCount, overlapGroup }) => [item.id, laneIndex, laneCount, overlapGroup]), [
    ['a', 0, 3, 0], ['b', 1, 3, 0], ['c', 2, 3, 0], ['d', 0, 1, 1],
  ]);
});

test('v14 部分重叠的项目条会复用已结束 lane，生命周期内不跳栏', () => {
  const lanes = assignVerticalIntervalLanes([
    { id: 'a', start: '2026-08-01', end: '2026-08-03' },
    { id: 'b', start: '2026-08-02', end: '2026-08-05' },
    { id: 'c', start: '2026-08-04', end: '2026-08-06' },
  ]);
  assert.deepEqual(lanes.map(({ item, laneIndex, laneCount }) => [item.id, laneIndex, laneCount]), [
    ['a', 0, 2], ['b', 1, 2], ['c', 0, 2],
  ]);
});

test('长期系统使用独立布局层：同日聚合且不会影响项目 lane', () => {
  const chips = layoutSystemChips([
    { id: 'a', anchorDate: '2026-08-22' }, { id: 'b', anchorDate: '2026-08-22' },
    { id: 'c', anchorDate: '2026-08-22' }, { id: 'd', anchorDate: '2026-08-22' },
    { id: 'later', anchorDate: '2026-08-23' },
  ], (date) => date === '2026-08-22' ? 100 : 110);
  assert.deepEqual(chips.map((chip) => [chip.kind, chip.item?.id, chip.overflowCount]), [
    ['system', 'a', undefined], ['system', 'b', undefined], ['overflow', undefined, 2], ['system', 'later', undefined],
  ]);
  assert.ok(chips[0].top < 100 && chips[2].top > 100);
  assert.ok(chips[3].top >= chips[2].top + 38);
});

test('v14 有子项目的父项目只作范围说明，子项目与独立项目共用分类 lane', () => {
  const data = createEmptyLifeMapData();
  data.lifeMapGoals = [
    { id: 'exam', areaId: 'learning', name: '考研', start: '2026-08-17', targetDate: '2026-09-08', status: 'active', kind: 'plan', ...meta },
    { id: 'politics', areaId: 'learning', parentGoalId: 'exam', name: '政治', start: '2026-08-18', targetDate: '2026-08-27', status: 'active', kind: 'phase', ...meta },
    { id: 'english', areaId: 'learning', parentGoalId: 'exam', name: '英语', start: '2026-08-20', targetDate: '2026-09-05', status: 'active', kind: 'phase', ...meta },
    { id: 'wrap-up', areaId: 'learning', name: '项目收尾', start: '2026-08-24', targetDate: '2026-08-31', status: 'active', kind: 'plan', ...meta },
    { id: 'work-plan', areaId: 'work', name: '工作项目', start: '2026-08-20', targetDate: '2026-08-30', status: 'active', kind: 'plan', ...meta },
  ];

  const strips = getProjectStripsByCategory(data, 'learning');
  assert.deepEqual(strips.map(({ id }) => id), ['politics', 'english', 'wrap-up']);
  assert.equal(strips.find(({ id }) => id === 'politics')?.parentProject?.id, 'exam');
  assert.equal(strips.find(({ id }) => id === 'wrap-up')?.parentProject, undefined);

  const lanes = getCategoryProjectLanes(data, 'learning');
  assert.deepEqual(lanes.map(({ item, laneIndex, laneCount }) => [item.id, laneIndex, laneCount]), [
    ['politics', 0, 3], ['english', 1, 3], ['wrap-up', 2, 3],
  ]);
});

test('v14 单日、极短范围与完整范围由日期和当前缩放共同决定', () => {
  const expected = new Map([[.7, 'compact-range'], [4, 'compact-range'], [14, 'range'], [38, 'range']]);
  for (const pixelsPerDay of [.7, 4, 14, 38]) {
    const mapper = createLifeMapTimeMapper('2026-01-01', pixelsPerDay);
    const single = resolveAnnotationPresentation('2026-08-18', '2026-08-18', mapper);
    const shortRange = resolveAnnotationPresentation('2026-08-18', '2026-08-20', mapper);
    assert.equal(single.kind, 'single');
    assert.equal(single.center, mapper.dateToWorldY('2026-08-18'));
    assert.equal(shortRange.kind, expected.get(pixelsPerDay));
    assert.equal(shortRange.top, mapper.dateToWorldY('2026-08-18'));
    assert.equal(shortRange.bottom, mapper.dateToWorldY('2026-08-20'));
  }
});

test('v14 规范化会用真实日期关系修复不一致的批注类型', () => {
  const data = normalizeLifeMapData({
    ...createEmptyLifeMapData(),
    lifeMapNotes: [
      { id: 'later-pin', name: '跨日但写成 pin', date: '2026-08-18', endDate: '2026-08-20', type: 'pin', ...meta },
      { id: 'same-range', name: '同日但写成 range', date: '2026-08-18', endDate: '2026-08-18', type: 'range', ...meta },
    ],
  });
  assert.deepEqual(data.lifeMapNotes.map((note) => ({ id: note.id, type: note.type, endDate: note.endDate })), [
    { id: 'later-pin', type: 'range', endDate: '2026-08-20' },
    { id: 'same-range', type: 'pin', endDate: undefined },
  ]);
});

test('v14 批注正文避让不会修改真实大括号锚点，旧便签可无损归一化', () => {
  const anchors = resolveAnnotationTextCollisions([{ id: 'a', anchorY: 100, height: 60 }, { id: 'b', anchorY: 110, height: 60 }]);
  assert.equal(anchors[0].anchorY, 100);
  assert.equal(anchors[1].anchorY, 110);
  assert.ok(anchors[1].y > anchors[0].y);
  const data = normalizeLifeMapData({ ...createEmptyLifeMapData(), lifeMapNotes: [{ id: 'old', areaId: 'learning', name: '旧便签', date: '2026-08-20', type: 'pin', ...meta }] });
  assert.deepEqual(data.lifeMapNotes[0] && { body: data.lifeMapNotes[0].body, importance: data.lifeMapNotes[0].importance, type: data.lifeMapNotes[0].type }, { body: '', importance: 'normal', type: 'pin' });
});

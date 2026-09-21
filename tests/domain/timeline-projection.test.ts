import assert from 'node:assert/strict';
import test from 'node:test';
import { lifeTimelineItems, projectTimelineItems, timelineProjectionItems, timelineVisibleItems } from '../../src/mindMap/timelineProjection.ts';
import { createTimelineSection } from '../../src/mindMap/model.ts';
import { buildTimelineTicks, createTimelineCoordinates, dateToX, formatTimelineRange, recommendedTimelineHeight, timelineRangeForScale, xToDate } from '../../src/mindMap/timelineLayout.ts';
import { buildMindMapTimelineLayer, DEFAULT_TIMELINE_VISIBILITY } from '../../src/mindMap/canvas/timelineLayer.ts';
import { addDays, todayStr } from '../../src/utils/dateSafe.ts';

test('project timeline is a live projection with temporal row culling', () => {
  const projectData = {
    projects: [{
      id: 'project-1', name: '发布', start: '2026-08-01', end: '2026-08-31', color: '#123456', blocks: [{
        id: 'block-1', type: 'smart-task', header: {
          title: '联调', tag: '', tagColor: '#654321', date: '2026-08-10', deadline: '2026-08-12', isCompleted: false,
        }, items: [],
      }],
    }],
    milestones: [{ id: 'milestone-1', name: '上线', date: '2026-08-20', relatedPlanId: 'project-1' }],
  };
  const items = projectTimelineItems('project-1', projectData);

  assert.deepEqual(items.map((item) => item.title), ['发布', '联调', '上线']);
  assert.deepEqual(timelineVisibleItems(items, '2026-08-09', '2026-08-21', 2).map((item) => item.title), ['发布', '联调']);
  const timeline = { ...createTimelineSection({ x: 0, y: 0 }), source: 'project' as const, targetId: 'project-1' };
  const projected = timelineProjectionItems(timeline, projectData, {
    lifeMapAreas: [], lifeMapStages: [], lifeMapThemes: [], lifeMapGoals: [], lifeMapSystems: [],
    lifeMapEvents: [], lifeMapFocuses: [], lifeMapNotes: [], lifeMapReviews: [],
  });
  assert.deepEqual(projected.map((item) => item.kind), ['project', 'task', 'milestone']);
});

test('life timeline only projects active items in the selected area', () => {
  const base = { createdAt: '', updatedAt: '', revision: 1 };
  const items = lifeTimelineItems('work', {
    lifeMapAreas: [{ ...base, id: 'work', name: '工作', color: '#111111', order: 0, planGroupId: 'work' }],
    lifeMapStages: [],
    lifeMapThemes: [{ ...base, id: 'theme-1', areaId: 'work', name: '主题', start: '2026-01-01', end: '2026-03-01' }],
    lifeMapGoals: [{ ...base, id: 'goal-1', areaId: 'work', name: '目标', start: '2026-02-01', targetDate: '2026-04-01', status: 'active' }],
    lifeMapSystems: [], lifeMapEvents: [], lifeMapFocuses: [], lifeMapNotes: [], lifeMapReviews: [],
  });

  assert.deepEqual(items.map((item) => item.title), ['主题', '目标']);
  assert.deepEqual(items.map((item) => item.lifeItemId), ['theme:theme-1', 'goal:goal-1']);

  const timeline = {
    ...createTimelineSection({ x: 0, y: 0 }, { id: 'manual-1', now: 1 }),
    source: 'manual' as const,
    manualItems: [{ source: 'life' as const, contextId: 'work', itemId: 'goal:goal-1' }],
  };
  const manual = timelineProjectionItems(timeline, { projects: [], milestones: [] }, {
    lifeMapAreas: [{ ...base, id: 'work', name: '工作', color: '#111111', order: 0, planGroupId: 'work' }],
    lifeMapStages: [], lifeMapThemes: [{ ...base, id: 'theme-1', areaId: 'work', name: '主题', start: '2026-01-01', end: '2026-03-01' }],
    lifeMapGoals: [{ ...base, id: 'goal-1', areaId: 'work', name: '目标', start: '2026-02-01', targetDate: '2026-04-01', status: 'active' }],
    lifeMapSystems: [], lifeMapEvents: [], lifeMapFocuses: [], lifeMapNotes: [], lifeMapReviews: [],
  });
  assert.deepEqual(manual.map((item) => item.title), ['目标']);
});

test('recommended timeline height accounts for every stage lane and same-day marker stack', () => {
  const compact = recommendedTimelineHeight([{ kind: 'stage', shape: 'range', start: '2026-01-01' }]);
  const expanded = recommendedTimelineHeight([
    ...Array.from({ length: 8 }, (_, index) => ({ kind: 'stage', shape: 'range' as const, start: `2026-01-${String(index + 1).padStart(2, '0')}` })),
    ...Array.from({ length: 7 }, () => ({ kind: 'milestone', shape: 'marker' as const, start: '2026-02-01' })),
  ]);
  assert.ok(expanded > compact);
  assert.ok(expanded >= 480);
});

test('adaptive timeline ticks remain readable across year, season, month, and week ranges', () => {
  const labels = (start: string, end: string, scale: 'long-range' | 'month' | 'week' = 'month') => (
    buildTimelineTicks({ rangeStart: start, rangeEnd: end, plotWidth: 680, scale })
      .filter((tick) => tick.kind === 'major')
      .map((tick) => tick.sublabel ? `${tick.label}:${tick.sublabel}` : tick.label)
  );
  assert.deepEqual(labels('2026-03-01', '2026-12-31', 'long-range'), ['Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']);
  assert.deepEqual(labels('2026-03-01', '2026-06-30', 'week'), ['Mar', 'Apr', 'May', 'Jun']);
  assert.deepEqual(labels('2026-08-01', '2026-08-31'), ['1', '5', '10', '15', '20', '25', '31']);
  assert.deepEqual(labels('2026-08-10', '2026-08-16', 'week'), ['Mon:10', 'Tue:11', 'Wed:12', 'Thu:13', 'Fri:14', 'Sat:15', 'Sun:16']);
  assert.equal(formatTimelineRange('2026-03-01', '2026-06-30'), '2026 年 3–6 月');
  assert.equal(formatTimelineRange('2026-08-01', '2026-08-31'), '2026 年 8 月');
});

test('changing timeline scale changes the visible calendar window', () => {
  assert.deepEqual(timelineRangeForScale('long-range', '2026-09-20'), { start: '2026-01-01', end: '2026-12-31' });
  assert.deepEqual(timelineRangeForScale('month', '2026-09-20'), { start: '2026-09-01', end: '2026-09-30' });
  assert.deepEqual(timelineRangeForScale('week', '2026-09-20'), { start: '2026-09-14', end: '2026-09-20' });
});

test('every timeline element shares one reversible coordinate system after resize', () => {
  const compact = createTimelineCoordinates('2026-08-01', '2026-08-31', 800);
  const wide = createTimelineCoordinates('2026-08-01', '2026-08-31', 1200);
  const firstHalf = dateToX('2026-08-15', compact) - dateToX('2026-08-01', compact);
  const secondHalfStart = dateToX('2026-08-15', compact);
  assert.ok(Math.abs(firstHalf / compact.plotWidth - 14 / 30) < 0.001);
  assert.equal(secondHalfStart, dateToX('2026-08-15', compact));
  assert.ok(Math.abs(dateToX('2026-08-20', compact) - (compact.plotLeft + compact.plotWidth * 19 / 30)) < 0.001);
  assert.equal(xToDate(dateToX('2026-08-20', compact), compact), '2026-08-20');
  assert.equal(wide.rangeStart, compact.rangeStart);
  assert.equal(wide.rangeEnd, compact.rangeEnd);
  assert.ok(dateToX('2026-08-15', wide) - wide.plotLeft > firstHalf);
});

test('timeline semantic zoom groups project swimlanes and aggregates dense milestones', () => {
  const today = todayStr();
  const timeline = {
    ...createTimelineSection({ x: 0, y: 0 }, { id: 'timeline-density', now: 1 }),
    width: 800,
    height: 260,
    scale: 'week' as const,
    rangeStart: addDays(today, -14),
    rangeEnd: addDays(today, 21),
  };
  const items = [
    { id: 'project:p', title: '项目', start: addDays(today, -7), end: addDays(today, 14), color: '#5e5ce6', kind: 'project' as const, shape: 'range' as const, progress: 30 },
    { id: 'task:active', title: '进行中任务', start: addDays(today, -1), end: addDays(today, 2), color: '#5e5ce6', kind: 'task' as const, shape: 'range' as const, parentId: 'project:p', progress: 20 },
    { id: 'task:overdue', title: '逾期任务', start: addDays(today, -8), end: addDays(today, -1), color: '#5e5ce6', kind: 'task' as const, shape: 'range' as const, parentId: 'project:p', progress: 0 },
    { id: 'task:upcoming', title: '即将开始任务', start: addDays(today, 3), end: addDays(today, 5), color: '#5e5ce6', kind: 'task' as const, shape: 'range' as const, parentId: 'project:p', progress: 0 },
    ...Array.from({ length: 6 }, (_, index) => ({ id: `milestone:${index}`, title: `节点 ${index}`, start: addDays(today, 4), end: addDays(today, 4), color: '#af52de', kind: 'milestone' as const, shape: 'marker' as const, parentId: 'project:p' })),
  ];
  const compact = buildMindMapTimelineLayer(timeline, items, 0.68, DEFAULT_TIMELINE_VISIBILITY);
  assert.equal(compact.density, 'compact');
  assert.deepEqual(compact.rowCandidates.map((item) => item.title), ['项目']);

  const detail = buildMindMapTimelineLayer({ ...timeline, height: 460 }, items, 0.9, DEFAULT_TIMELINE_VISIBILITY);
  assert.equal(detail.density, 'detail');
  assert.deepEqual(detail.rowCandidates.map((item) => item.title), ['项目', '进行中任务', '逾期任务', '即将开始任务']);
  assert.deepEqual(detail.lanes.map((lane) => [lane.title, lane.rowCount]), [['项目', 4]]);
  const dense = buildMindMapTimelineLayer(timeline, items, 0.9, DEFAULT_TIMELINE_VISIBILITY);
  assert.ok(dense.milestoneOverflow.reduce((count, item) => count + item.count, 0) > 0);

  const overdue = buildMindMapTimelineLayer({ ...timeline, height: 460 }, items, 0.9, DEFAULT_TIMELINE_VISIBILITY, 'overdue');
  assert.deepEqual(overdue.rowCandidates.map((item) => item.title), ['项目', '逾期任务']);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { lifeTimelineItems, projectTimelineItems, timelineProjectionItems, timelineVisibleItems } from '../../src/mindMap/timelineProjection.ts';
import { createTimelineSection } from '../../src/mindMap/model.ts';
import { buildTimelineTicks, createTimelineCoordinates, dateToX, formatTimelineRange, recommendedTimelineHeight, xToDate } from '../../src/mindMap/timelineLayout.ts';

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

import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHistoryEntry, createHistoryEntry } from '../../src/mindMap/commands.ts';
import {
  createEmptyMindMapDocument,
  createMindMapEdge,
  createMindMapGroup,
  createProjectReferenceCard,
  createTextMindMapNode,
  createTimelineSection,
  duplicateMindMapDocument,
  normalizeMindMapDocument,
} from '../../src/mindMap/model.ts';
import { layoutMindMapBranch } from '../../src/mindMap/layout.ts';
import { applyMindMapSyncPatch, createMindMapSyncPatch } from '../../src/mindMap/syncCore.ts';
import { formatTimelineRange, resizeTimelineRect } from '../../src/mindMap/timelineLayout.ts';
import { timelineStatus, timelineUnscheduledItemCount } from '../../src/mindMap/timelineProjection.ts';

test('canvas objects survive normalization, undo, duplication, and sync patches', () => {
  const before = createEmptyMindMapDocument('地图', { id: 'map-1', now: 1 });
  const reference = createProjectReferenceCard({ x: 20, y: 40 }, { targetType: 'task', targetId: 'task-1' }, { id: 'reference-1', now: 2 });
  const timeline = createTimelineSection({ x: 200, y: 300 }, { id: 'timeline-1', now: 2, title: '八月' });
  const after = {
    ...before,
    updatedAt: 2,
    projectReferences: { [reference.id]: reference },
    timelineSections: { [timeline.id]: timeline },
  };

  assert.deepEqual(normalizeMindMapDocument(after)?.projectReferences, after.projectReferences);
  assert.deepEqual(normalizeMindMapDocument(after)?.timelineSections, after.timelineSections);

  const entry = createHistoryEntry('新增画布对象', before, after);
  assert.ok(entry);
  assert.deepEqual(applyHistoryEntry(after, entry, 'undo').projectReferences, {});
  assert.deepEqual(applyHistoryEntry(after, entry, 'undo').timelineSections, {});

  const patch = createMindMapSyncPatch(before, after);
  assert.deepEqual(applyMindMapSyncPatch(before, patch).projectReferences, after.projectReferences);
  assert.deepEqual(applyMindMapSyncPatch(before, patch).timelineSections, after.timelineSections);

  const duplicate = duplicateMindMapDocument(after, { id: 'map-2', now: 3 });
  assert.equal(Object.keys(duplicate.projectReferences).length, 1);
  assert.equal(Object.keys(duplicate.timelineSections).length, 1);
  assert.notEqual(Object.keys(duplicate.projectReferences)[0], reference.id);
  assert.notEqual(Object.keys(duplicate.timelineSections)[0], timeline.id);
});

test('branch layout only moves descendants connected by tree edges', () => {
  const root = createTextMindMapNode({ x: 500, y: 200 }, { id: 'root', now: 1, text: 'Root' });
  const child = createTextMindMapNode({ x: 40, y: 40 }, { id: 'child', now: 1, text: 'Child' });
  const leaf = createTextMindMapNode({ x: 20, y: 20 }, { id: 'leaf', now: 1, text: 'Leaf' });
  const unrelated = createTextMindMapNode({ x: -300, y: 80 }, { id: 'unrelated', now: 1, text: 'Elsewhere' });
  const treeEdge = createMindMapEdge(root.id, child.id, { id: 'tree', now: 1, relationship: 'tree' });
  const childEdge = createMindMapEdge(child.id, leaf.id, { id: 'child-tree', now: 1, relationship: 'tree' });
  const reference = createMindMapEdge(root.id, unrelated.id, { id: 'reference', now: 1, relationship: 'reference' });
  const document = {
    ...createEmptyMindMapDocument('布局', { id: 'map-branch', now: 1 }),
    nodes: { [root.id]: root, [child.id]: child, [leaf.id]: leaf, [unrelated.id]: unrelated },
    edges: { [treeEdge.id]: treeEdge, [childEdge.id]: childEdge, [reference.id]: reference },
    zOrder: [root.id, child.id, leaf.id, unrelated.id],
  };

  const laidOut = layoutMindMapBranch(document, root.id);
  assert.deepEqual([laidOut.nodes.root.x, laidOut.nodes.root.y], [root.x, root.y]);
  assert.deepEqual([laidOut.nodes.unrelated.x, laidOut.nodes.unrelated.y], [unrelated.x, unrelated.y]);
  assert.ok(laidOut.nodes.child.x > laidOut.nodes.root.x);
});

test('group membership is normalized symmetrically and duplicates do not share node styles', () => {
  const node = createTextMindMapNode({ x: 0, y: 0 }, { id: 'node-1', now: 1 });
  const group = createMindMapGroup([node.id], { id: 'group-1', now: 1 });
  const source = {
    ...createEmptyMindMapDocument('分组', { id: 'map-groups', now: 1 }),
    nodes: { [node.id]: node },
    groups: { [group.id]: group },
    zOrder: [node.id],
  };

  const normalized = normalizeMindMapDocument(source);
  assert.ok(normalized);
  assert.equal(normalized.nodes[node.id].groupId, group.id);
  assert.deepEqual(normalized.groups[group.id].memberIds, [node.id]);

  const duplicate = duplicateMindMapDocument(normalized, { id: 'map-groups-copy', now: 2 });
  const duplicateNode = Object.values(duplicate.nodes)[0];
  assert.notEqual(duplicateNode.style, normalized.nodes[node.id].style);
  duplicateNode.style.fill = '#000000';
  assert.notEqual(normalized.nodes[node.id].style.fill, duplicateNode.style.fill);
});

test('timeline resizing keeps its minimum size and repositions from the center', () => {
  assert.deepEqual(
    resizeTimelineRect({ x: 100, y: 100, width: 840, height: 320 }, -800, -300),
    { x: -160, y: 30, width: 320, height: 180 },
  );
});

test('timeline range labels use the application locale', () => {
  assert.equal(formatTimelineRange('2026-09-04', '2026-10-04'), '2026 年 9–10 月');
});

test('timeline status excludes completed work from active and overdue counts', () => {
  assert.deepEqual(timelineStatus([
    { id: 'active', title: '进行中', start: '2026-09-01', end: '2026-09-05', color: '#000', kind: 'task', shape: 'range', progress: 20 },
    { id: 'overdue', title: '逾期', start: '2026-08-01', end: '2026-09-03', color: '#000', kind: 'task', shape: 'range', progress: 20 },
    { id: 'done', title: '完成', start: '2026-09-01', end: '2026-09-05', color: '#000', kind: 'task', shape: 'range', progress: 100 },
  ], '2026-09-04'), { active: 1, overdue: 1 });
});

test('timeline reports manually selected project tasks without dates', () => {
  const project = { id: 'project-1', name: '项目', start: '2026-09-01', end: '2026-09-30', blocks: [{ type: 'smart-task' as const, id: 'block-1', header: { title: '未排期', tag: '', tagColor: '', duration: 0, isCompleted: false }, body: '' }] };
  const timeline = createTimelineSection({ x: 0, y: 0 }, { id: 'timeline-unscheduled', now: 1 });
  assert.equal(timelineUnscheduledItemCount({ ...timeline, manualItems: [{ source: 'project', contextId: project.id, itemId: 'task:project-1:block-1' }] }, { projects: [project], milestones: [] }), 1);
});

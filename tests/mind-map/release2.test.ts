import assert from 'node:assert/strict';
import test from 'node:test';
import { applyHistoryEntry, createHistoryEntry } from '../../src/mindMap/commands.ts';
import { hitNode } from '../../src/mindMap/canvas/geometry.ts';
import { serializeMindMapSvg } from '../../src/mindMap/importExport.ts';
import {
  MIND_MAP_SCHEMA_VERSION,
  createEmptyMindMapDocument,
  createMindMapEdge,
  createMindMapGroup,
  createMindMapSection,
  createTextMindMapNode,
  maintainMindMapContainers,
  normalizeMindMapDocument,
} from '../../src/mindMap/model.ts';

test('v1 documents migrate to the current schema with containers and safe advanced resources', () => {
  const document = createEmptyMindMapDocument('迁移', { id: 'doc', now: 1 });
  const node = createTextMindMapNode({ x: 20, y: 30 }, { id: 'node', now: 1, text: '内容' });
  const section = createMindMapSection([node], { id: 'section', now: 1, title: '区域 A' });
  const group = createMindMapGroup([node.id], { id: 'group', now: 1, title: '分组 A' });
  document.schemaVersion = 1;
  document.nodes[node.id] = {
    ...node,
    type: 'url',
    link: 'javascript:alert(1)',
    parentSectionId: section.id,
    groupId: group.id,
  };
  document.sections[section.id] = section;
  document.groups[group.id] = group;
  document.zOrder = [node.id];

  const migrated = normalizeMindMapDocument(document);
  assert.ok(migrated);
  assert.equal(migrated.schemaVersion, MIND_MAP_SCHEMA_VERSION);
  assert.equal(migrated.nodes.node.type, 'url');
  assert.equal(migrated.nodes.node.link, null);
  assert.equal(migrated.nodes.node.parentSectionId, 'section');
  assert.deepEqual(migrated.groups.group.memberIds, ['node']);
});

test('container maintenance auto-sizes sections and removes empty groups transactionally', () => {
  const document = createEmptyMindMapDocument('容器', { id: 'doc', now: 1 });
  const node = createTextMindMapNode({ x: 100, y: 80 }, { id: 'node', now: 1 });
  const section = createMindMapSection([node], { id: 'section', now: 1 });
  const group = createMindMapGroup([node.id], { id: 'group', now: 1 });
  document.nodes.node = { ...node, parentSectionId: section.id, groupId: group.id };
  document.sections.section = { ...section, x: 0, y: 0 };
  document.groups.group = group;
  document.zOrder = ['node'];
  const fitted = maintainMindMapContainers(document);
  assert.equal(fitted.sections.section.x, 100);

  const withoutNode = maintainMindMapContainers({ ...fitted, nodes: {}, zOrder: [] });
  assert.deepEqual(withoutNode.groups, {});
});

test('history restores sections groups and document settings', () => {
  const before = createEmptyMindMapDocument('历史', { id: 'doc', now: 1 });
  const node = createTextMindMapNode({ x: 0, y: 0 }, { id: 'node', now: 1 });
  const section = createMindMapSection([node], { id: 'section', now: 1 });
  const group = createMindMapGroup([node.id], { id: 'group', now: 1 });
  const after = {
    ...before,
    nodes: { node },
    sections: { section },
    groups: { group },
    zOrder: ['node'],
    settings: { ...before.settings, grid: 'none' as const },
  };
  const entry = createHistoryEntry('容器事务', before, after);
  assert.ok(entry);
  const undone = applyHistoryEntry(after, entry, 'undo');
  assert.deepEqual(undone.nodes, before.nodes);
  assert.deepEqual(undone.sections, before.sections);
  assert.deepEqual(undone.groups, before.groups);
  assert.deepEqual(undone.settings, before.settings);
  const redone = applyHistoryEntry(before, entry, 'redo');
  assert.equal(redone.sections.section.id, 'section');
  assert.equal(redone.groups.group.id, 'group');
  assert.equal(redone.settings.grid, 'none');
});

test('orthogonal SVG export escapes user text and emits no executable markup', () => {
  const document = createEmptyMindMapDocument('安全 SVG', { id: 'doc', now: 1 });
  const a = createTextMindMapNode({ x: 0, y: 0 }, { id: 'a', now: 1, text: '<script>alert(1)</script>' });
  const b = createTextMindMapNode({ x: 300, y: 100 }, { id: 'b', now: 1, text: 'B' });
  const edge = createMindMapEdge('a', 'b', { id: 'edge', now: 1 });
  document.nodes = { a, b };
  document.edges = { edge: { ...edge, type: 'orthogonal', controlPoints: [{ x: 150, y: 0 }, { x: 150, y: 100 }] } };
  document.zOrder = ['a', 'b'];
  const svg = serializeMindMapSvg(document);
  assert.match(svg, /&lt;script&gt;/);
  assert.doesNotMatch(svg, /<script|foreignObject|\son[a-z]+=/i);
  assert.match(svg, /L 150 0 L 150 100/);
});

test('rotated node hit testing uses its rotated geometry', () => {
  const node = { ...createTextMindMapNode({ x: 0, y: 0 }, { id: 'node', now: 1 }), width: 120, height: 40, rotation: 90 };
  assert.equal(hitNode({ x: 0, y: 50 }, { node }, ['node'])?.id, 'node');
  assert.equal(hitNode({ x: 50, y: 0 }, { node }, ['node']), null);
});

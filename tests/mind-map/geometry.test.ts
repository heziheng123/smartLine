import assert from 'node:assert/strict';
import test from 'node:test';
import {
  edgeIsHiddenInsideCollapsedSection,
  edgeRenderNodes,
  fitMindMapDocument,
  fitNodes,
  hitNode,
  resolveNodeSectionId,
  viewToWorld,
  worldToView,
  zoomCameraAt,
} from '../../src/mindMap/canvas/geometry.ts';
import { MindMapSpatialIndex } from '../../src/mindMap/canvas/spatialIndex.ts';
import {
  createEmptyMindMapDocument,
  createMindMapEdge,
  createMindMapSection,
  createTextMindMapNode,
} from '../../src/mindMap/model.ts';

test('world and view coordinates round-trip', () => {
  const camera = { x: 120, y: -40, scale: 2.5 };
  const world = { x: 33, y: -12 };
  const view = worldToView(world, camera);
  assert.deepEqual(viewToWorld(view, camera), world);
});

test('zoom keeps the world point under the pointer stable', () => {
  const pointer = { x: 500, y: 300 };
  const before = { x: 20, y: 30, scale: 1 };
  const world = viewToWorld(pointer, before);
  const after = zoomCameraAt(before, pointer, 2);
  assert.deepEqual(worldToView(world, after), pointer);
  assert.equal(after.scale, 2);
});

test('hit testing respects z-order and fit centers all nodes', () => {
  const a = createTextMindMapNode({ x: 0, y: 0 }, { id: 'a', now: 1 });
  const b = createTextMindMapNode({ x: 0, y: 0 }, { id: 'b', now: 1 });
  assert.equal(hitNode({ x: 0, y: 0 }, { a, b }, ['a', 'b'])?.id, 'b');
  const fitted = fitNodes([a], { width: 800, height: 600 });
  assert.ok(fitted);
  assert.equal(fitted.scale, 1.5);
  assert.deepEqual(worldToView({ x: 0, y: 0 }, fitted), { x: 400, y: 300 });
});

test('collapsed sections provide proxy edge endpoints and hide only internal edges', () => {
  const document = createEmptyMindMapDocument('区域代理', { id: 'sections', now: 1 });
  const insideA = createTextMindMapNode({ x: 0, y: 0 }, { id: 'inside-a', now: 1 });
  const insideB = createTextMindMapNode({ x: 20, y: 0 }, { id: 'inside-b', now: 1 });
  const outside = createTextMindMapNode({ x: 500, y: 0 }, { id: 'outside', now: 1 });
  const section = createMindMapSection([insideA, insideB], { id: 'section', now: 1 });
  document.sections.section = { ...section, collapsed: true };
  document.nodes = {
    'inside-a': { ...insideA, parentSectionId: section.id },
    'inside-b': { ...insideB, parentSectionId: section.id },
    outside,
  };
  const external = createMindMapEdge('inside-a', 'outside', { id: 'external', now: 1 });
  const internal = createMindMapEdge('inside-a', 'inside-b', { id: 'internal', now: 1 });
  const rendered = edgeRenderNodes(document);
  assert.equal(rendered['inside-a'].x, section.x);
  assert.equal(rendered['inside-a'].height, 42);
  assert.equal(edgeIsHiddenInsideCollapsedSection(external, document), false);
  assert.equal(edgeIsHiddenInsideCollapsedSection(internal, document), true);
});

test('node section membership follows the visible section boundary', () => {
  const document = createEmptyMindMapDocument('区域归属', { id: 'membership', now: 1 });
  const seed = createTextMindMapNode({ x: 0, y: 0 }, { id: 'seed', now: 1 });
  document.sections.section = createMindMapSection([seed], { id: 'section', now: 1 });
  const entering = createTextMindMapNode({ x: 10, y: 10 }, { id: 'entering', now: 1 });
  const leaving = createTextMindMapNode({ x: 500, y: 500 }, { id: 'leaving', now: 1 });
  assert.equal(resolveNodeSectionId(document, entering), 'section');
  assert.equal(resolveNodeSectionId(document, leaving), null);
  document.sections.section = { ...document.sections.section, collapsed: true };
  assert.equal(resolveNodeSectionId(document, entering), null);
});

test('fit all uses a collapsed section boundary instead of hidden member coordinates', () => {
  const document = createEmptyMindMapDocument('折叠适配', { id: 'fit-section', now: 1 });
  const hidden = createTextMindMapNode({ x: 5_000, y: 5_000 }, { id: 'hidden', now: 1 });
  document.nodes.hidden = { ...hidden, parentSectionId: 'section' };
  document.sections.section = {
    ...createMindMapSection([], { id: 'section', now: 1 }),
    x: 0,
    y: 0,
    width: 200,
    height: 200,
    collapsed: true,
  };
  const fitted = fitMindMapDocument(document, { width: 800, height: 600 });
  assert.ok(fitted);
  assert.equal(fitted.scale, 1.5);
  assert.deepEqual(worldToView({ x: 0, y: -79 }, fitted), { x: 400, y: 300 });
});

test('spatial index limits a viewport query to nearby nodes', () => {
  const nodes = Array.from({ length: 5_000 }, (_, index) => createTextMindMapNode({
    x: (index % 100) * 220,
    y: Math.floor(index / 100) * 100,
  }, { id: `node-${index}`, now: 1 }));
  const index = new MindMapSpatialIndex(nodes);
  const nearby = index.query({ x: -100, y: -100, width: 800, height: 600 });
  assert.ok(nearby.length > 0);
  assert.ok(nearby.length < 100);
  assert.ok(nearby.some((node) => node.id === 'node-0'));
  assert.ok(!nearby.some((node) => node.id === 'node-4999'));
});

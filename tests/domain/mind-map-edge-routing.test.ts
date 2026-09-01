import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEdgeRoute, routeTargetTangent } from '../../src/mindMap/canvas/edgeRouting.ts';
import { createMindMapEdge, createEmptyMindMapDocument, createProjectReferenceCard, createTextMindMapNode, duplicateMindMapDocument, normalizeMindMapDocument } from '../../src/mindMap/model.ts';

const source = { x: 0, y: 0, width: 100, height: 40 };

test('relation router chooses sides from actual node positions', () => {
  assert.deepEqual(buildEdgeRoute(source, { x: 300, y: 0, width: 100, height: 40 }, { kind: 'relation' }).sourceSide, 'right');
  assert.deepEqual(buildEdgeRoute(source, { x: -300, y: 0, width: 100, height: 40 }, { kind: 'relation' }).sourceSide, 'left');
  assert.deepEqual(buildEdgeRoute(source, { x: 0, y: 300, width: 100, height: 40 }, { kind: 'relation' }).sourceSide, 'bottom');
  assert.deepEqual(buildEdgeRoute(source, { x: 0, y: -300, width: 100, height: 40 }, { kind: 'relation' }).sourceSide, 'top');
  assert.deepEqual(buildEdgeRoute(source, { x: 300, y: 80, width: 100, height: 40 }, { kind: 'relation' }).sourceSide, 'right');
});

test('relation routing updates when a connected node is moved', () => {
  const rightRoute = buildEdgeRoute(source, { x: 240, y: 0, width: 100, height: 40 }, { kind: 'relation' });
  const belowRoute = buildEdgeRoute(source, { x: 0, y: 180, width: 100, height: 40 }, { kind: 'relation' });

  assert.equal(rightRoute.sourceSide, 'right');
  assert.equal(belowRoute.sourceSide, 'bottom');
});

test('hierarchy router follows layout direction and arrows follow the target tangent', () => {
  const target = { x: 120, y: 300, width: 100, height: 40 };
  const directions = {
    'left-right': ['right', 'left'],
    'right-left': ['left', 'right'],
    'top-bottom': ['bottom', 'top'],
    'bottom-top': ['top', 'bottom'],
  } as const;
  for (const [direction, sides] of Object.entries(directions)) {
    const route = buildEdgeRoute(source, target, { kind: 'hierarchy', hierarchyDirection: direction as keyof typeof directions });
    assert.deepEqual([route.sourceSide, route.targetSide], sides);
  }
  assert.ok(routeTargetTangent(buildEdgeRoute(source, target, { kind: 'hierarchy', hierarchyDirection: 'top-bottom' })).y > 0);
});

test('new relation edges retain the weak, arrowless default semantics', () => {
  const edge = createMindMapEdge('source', 'target');
  assert.equal(edge.relationship, 'reference');
  assert.equal(edge.direction, 'none');
});

test('typed endpoints preserve project references and migrate old node edges', () => {
  const document = createEmptyMindMapDocument('Test', { now: 1 });
  const node = createTextMindMapNode({ x: 0, y: 0 }, 'A', { id: 'node-a', now: 1 });
  const nodeB = createTextMindMapNode({ x: 100, y: 0 }, 'B', { id: 'node-b', now: 1 });
  const reference = createProjectReferenceCard({ x: 200, y: 0 }, { targetType: 'project', targetId: 'project-a' }, { id: 'reference-a', now: 1 });
  const normalized = normalizeMindMapDocument({
    ...document,
    nodes: { [node.id]: node, [nodeB.id]: nodeB },
    projectReferences: { [reference.id]: reference },
    edges: {
      old: { id: 'old', sourceId: node.id, targetId: nodeB.id, type: 'curve', direction: 'none', relationship: 'reference', label: '', controlPoints: [], style: { color: '#aaa', width: 1, dash: 'dashed' }, createdAt: 1, updatedAt: 1 },
      cross: createMindMapEdge({ type: 'node', id: node.id }, { type: 'project-reference', id: reference.id }, { id: 'cross', now: 1 }),
    },
  });
  assert.ok(normalized);
  assert.deepEqual(normalized!.edges.cross.source, { type: 'node', id: node.id });
  assert.deepEqual(normalized!.edges.cross.target, { type: 'project-reference', id: reference.id });
  const duplicate = duplicateMindMapDocument(normalized!, { now: 2 });
  const duplicatedEdge = Object.values(duplicate.edges).find((edge) => edge.target.type === 'project-reference');
  assert.ok(duplicatedEdge);
  assert.equal(duplicatedEdge!.target.type, 'project-reference');
  assert.equal(duplicate.projectReferences[duplicatedEdge!.target.id].targetId, 'project-a');
});

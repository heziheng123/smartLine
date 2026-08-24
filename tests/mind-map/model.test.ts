import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MIND_MAP_SCHEMA_VERSION,
  MindMapVersionError,
  createEmptyMindMapDocument,
  duplicateMindMapDocument,
  normalizeMindMapDocument,
  type MindMapNode,
} from '../../src/mindMap/model.ts';

const node = (id: string, x = 0): MindMapNode => ({
  id,
  type: 'text',
  x,
  y: 0,
  width: 180,
  height: 56,
  rotation: 0,
  text: id,
  link: null,
  imageSrc: null,
  imageAssetId: null,
  sizeMode: 'auto',
  parentSectionId: null,
  groupId: null,
  locked: false,
  participatesInLayout: true,
  style: {
    fill: '#ffffff',
    fillOpacity: 1,
    borderColor: '#c7c7cc',
    borderWidth: 1,
    borderStyle: 'solid',
    borderRadius: 12,
    shadow: true,
    fontSize: 15,
    fontWeight: 500,
    textColor: '#1d1d1f',
    textAlign: 'center',
    lineHeight: 1.45,
  },
  createdAt: 1,
  updatedAt: 1,
});

test('an empty document has a stable independent schema', () => {
  const document = createEmptyMindMapDocument('测试', { id: 'doc-1', now: 10 });
  assert.equal(document.kind, 'smart-line-mind-map');
  assert.equal(document.id, 'doc-1');
  assert.deepEqual(document.nodes, {});
  assert.deepEqual(document.edges, {});
  assert.deepEqual(document.viewport, { x: 0, y: 0, scale: 1 });
});

test('normalization drops dangling edges and repairs z-order and numeric ranges', () => {
  const document = createEmptyMindMapDocument('测试', { id: 'doc-1', now: 10 });
  document.nodes.a = { ...node('a'), width: -5, x: Number.POSITIVE_INFINITY };
  document.nodes.b = node('b', 20);
  document.edges.good = {
    id: 'good',
    sourceId: 'a',
    targetId: 'b',
    type: 'straight',
    direction: 'forward',
    label: '',
    style: { color: '#8e8e93', width: 2, dash: 'solid' },
    createdAt: 1,
    updatedAt: 1,
  };
  document.edges.bad = { ...document.edges.good, id: 'bad', targetId: 'missing' };
  document.zOrder = ['b', 'b', 'missing'];

  const normalized = normalizeMindMapDocument(document);
  assert.ok(normalized);
  assert.equal(normalized.nodes.a?.width, 80);
  assert.equal(normalized.nodes.a?.x, 0);
  assert.deepEqual(Object.keys(normalized.edges), ['good']);
  assert.deepEqual(normalized.zOrder, ['b', 'a']);
});

test('duplicating a document remaps every internal id without retaining references', () => {
  const source = createEmptyMindMapDocument('原图', { id: 'doc-1', now: 10 });
  source.nodes.a = node('a');
  source.nodes.b = node('b');
  source.edges.e = {
    id: 'e',
    sourceId: 'a',
    targetId: 'b',
    type: 'curve',
    direction: 'both',
    label: '关系',
    style: { color: '#8e8e93', width: 2, dash: 'solid' },
    createdAt: 1,
    updatedAt: 1,
  };
  source.zOrder = ['a', 'b'];

  const copy = duplicateMindMapDocument(source, { id: 'doc-2', now: 20 });
  assert.equal(copy.id, 'doc-2');
  assert.equal(copy.title, '原图 副本');
  assert.equal(Object.keys(copy.nodes).length, 2);
  const copiedEdge = Object.values(copy.edges)[0];
  assert.ok(copiedEdge);
  assert.notEqual(copiedEdge.id, 'e');
  assert.notEqual(copiedEdge.sourceId, 'a');
  assert.notEqual(copiedEdge.targetId, 'b');
  assert.ok(copy.nodes[copiedEdge.sourceId]);
  assert.ok(copy.nodes[copiedEdge.targetId]);
});

test('future document schemas fail closed instead of being normalized or overwritten', () => {
  const document = createEmptyMindMapDocument('未来版本', { id: 'future', now: 1 });
  assert.throws(
    () => normalizeMindMapDocument({ ...document, schemaVersion: MIND_MAP_SCHEMA_VERSION + 1 }),
    MindMapVersionError,
  );
});

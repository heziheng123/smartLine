import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEmptyMindMapDocument,
  createMindMapEdge,
  createTextMindMapNode,
  summarizeMindMapDocument,
} from '../../src/mindMap/model.ts';
import {
  applyMindMapSyncPatch,
  buildMindMapCatalogRoomId,
  buildMindMapRoomId,
  createMindMapSyncPatch,
  emptyMindMapSyncBase,
  isMindMapSyncPatchEmpty,
  mergeMindMapCatalogEntries,
  mergeMindMapDocuments,
  mindMapCatalogEntries,
  selectLatestActiveMindMapCatalogEntry,
} from '../../src/mindMap/syncCore.ts';

const documentWithNode = (nodeId: string, updatedAt: number) => {
  const document = createEmptyMindMapDocument('同步图', { id: 'doc-sync', now: 1 });
  const node = createTextMindMapNode({ x: updatedAt, y: 0 }, { id: nodeId, now: updatedAt, text: nodeId });
  document.nodes[node.id] = node;
  document.zOrder = [node.id];
  document.updatedAt = updatedAt;
  return document;
};

test('mind map room ids are stable owner-scoped and bounded', () => {
  assert.equal(buildMindMapRoomId('gh_12345', 'Doc_ABC'), 'workspace-gh_12345-mind-map-doc_abc');
  const room = buildMindMapRoomId('x'.repeat(200), 'y'.repeat(200));
  assert.ok(room.length <= 128);
  assert.match(room, /^workspace-[a-z0-9_-]+-mind-map-[a-z0-9_-]+$/);
  assert.equal(buildMindMapCatalogRoomId('gh_12345'), 'workspace-gh_12345-mind-map-catalog-v1');
});

test('the owner catalog discovers remote documents and preserves explicit deletions', () => {
  const localDocument = documentWithNode('local', 10);
  const remoteDocument = documentWithNode('remote', 20);
  remoteDocument.id = 'remote-document';
  const local = mindMapCatalogEntries([summarizeMindMapDocument(localDocument)]);
  const remote = mindMapCatalogEntries([summarizeMindMapDocument(remoteDocument)]);
  const discovered = mergeMindMapCatalogEntries(local, remote);
  assert.deepEqual(Object.keys(discovered).sort(), ['doc-sync', 'remote-document']);

  const deletedAt = 30;
  const withDeletion = mergeMindMapCatalogEntries(discovered, {
    'remote-document': { ...remote['remote-document'], updatedAt: deletedAt, deletedAt },
  });
  assert.equal(withDeletion['remote-document'].deletedAt, deletedAt);
});

test('a fresh device selects the newest active cloud document before creating a local one', () => {
  const old = { ...summarizeMindMapDocument(documentWithNode('old', 10)), deletedAt: null };
  const latest = { ...summarizeMindMapDocument(documentWithNode('latest', 20)), id: 'latest-document', deletedAt: null };
  const deleted = { ...summarizeMindMapDocument(documentWithNode('deleted', 30)), id: 'deleted-document', deletedAt: 40 };
  assert.equal(selectLatestActiveMindMapCatalogEntry([old, deleted, latest])?.id, 'latest-document');
  assert.equal(selectLatestActiveMindMapCatalogEntry([deleted]), null);
});

test('three-way merge preserves independent entity edits and the local camera', () => {
  const base = createEmptyMindMapDocument('同步图', { id: 'doc-sync', now: 1 });
  const local = documentWithNode('local', 10);
  local.viewport = { x: 90, y: 40, scale: 1.5 };
  const remote = documentWithNode('remote', 20);
  const merged = mergeMindMapDocuments(base, local, remote);
  assert.deepEqual(Object.keys(merged.nodes).sort(), ['local', 'remote']);
  assert.deepEqual(merged.viewport, local.viewport);
});

test('a concurrent delete wins over an edit and normalization removes dangling edges', () => {
  const base = createEmptyMindMapDocument('删除冲突', { id: 'doc-sync', now: 1 });
  const a = createTextMindMapNode({ x: 0, y: 0 }, { id: 'a', now: 1 });
  const b = createTextMindMapNode({ x: 100, y: 0 }, { id: 'b', now: 1 });
  base.nodes = { a, b };
  base.edges.edge = createMindMapEdge('a', 'b', { id: 'edge', now: 1 });
  base.zOrder = ['a', 'b'];
  const local = { ...base, nodes: { b }, zOrder: ['b'], updatedAt: 10 };
  const remote = {
    ...base,
    nodes: { ...base.nodes, a: { ...a, text: '远端修改', updatedAt: 20 } },
    updatedAt: 20,
  };
  const merged = mergeMindMapDocuments(base, local, remote);
  assert.equal(merged.nodes.a, undefined);
  assert.deepEqual(merged.edges, {});
});

test('entity patches exclude viewport state and replay without replacing unrelated entities', () => {
  const base = documentWithNode('a', 1);
  const current = {
    ...base,
    nodes: {
      ...base.nodes,
      a: { ...base.nodes.a, text: '已修改', updatedAt: 5 },
      b: createTextMindMapNode({ x: 80, y: 0 }, { id: 'b', now: 5 }),
    },
    zOrder: ['a', 'b'],
    viewport: { x: 500, y: 300, scale: 2 },
    updatedAt: 5,
  };
  const patch = createMindMapSyncPatch(base, current);
  assert.equal(isMindMapSyncPatchEmpty(patch), false);
  assert.deepEqual(Object.keys(patch.nodes.upserts).sort(), ['a', 'b']);
  assert.equal('viewport' in patch, false);
  const replayed = applyMindMapSyncPatch(base, patch);
  assert.equal(replayed.nodes.a.text, '已修改');
  assert.ok(replayed.nodes.b);
  assert.deepEqual(replayed.viewport, base.viewport);
});

test('an unchanged document produces no queued patch', () => {
  const document = documentWithNode('a', 1);
  const patch = createMindMapSyncPatch(document, document);
  assert.equal(isMindMapSyncPatchEmpty(patch), true);
  assert.equal(emptyMindMapSyncBase(document).id, document.id);
});

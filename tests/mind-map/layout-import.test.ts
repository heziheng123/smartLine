import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMindMapDocumentJson, serializeMindMapDocument } from '../../src/mindMap/importExport.ts';
import { layoutMindMapTree } from '../../src/mindMap/layout.ts';
import { layoutMindMapTreeInWorker } from '../../src/mindMap/layoutWorkerClient.ts';
import {
  createEmptyMindMapDocument,
  createMindMapEdge,
  createTextMindMapNode,
} from '../../src/mindMap/model.ts';

test('tree layout orders connected levels without overlap', () => {
  const document = createEmptyMindMapDocument('布局', { id: 'doc', now: 1 });
  const root = createTextMindMapNode({ x: 0, y: 0 }, { id: 'root', text: 'root', now: 1 });
  const left = createTextMindMapNode({ x: 0, y: 0 }, { id: 'left', text: 'left', now: 1 });
  const right = createTextMindMapNode({ x: 0, y: 0 }, { id: 'right', text: 'right', now: 1 });
  document.nodes = { root, left, right };
  document.edges = {
    a: createMindMapEdge('root', 'left', { id: 'a', now: 1 }),
    b: createMindMapEdge('root', 'right', { id: 'b', now: 1 }),
  };
  document.zOrder = ['root', 'left', 'right'];
  const layout = layoutMindMapTree(document);
  assert.ok(layout.nodes.left.x > layout.nodes.root.x);
  assert.equal(layout.nodes.left.x, layout.nodes.right.x);
  assert.notEqual(layout.nodes.left.y, layout.nodes.right.y);

  const rightToLeft = layoutMindMapTree(document, 'right-left');
  assert.ok(rightToLeft.nodes.left.x < rightToLeft.nodes.root.x);
  const topToBottom = layoutMindMapTree(document, 'top-bottom');
  assert.ok(topToBottom.nodes.left.y > topToBottom.nodes.root.y);
  const bottomToTop = layoutMindMapTree(document, 'bottom-top');
  assert.ok(bottomToTop.nodes.left.y < bottomToTop.nodes.root.y);
});

test('JSON export and import round-trip while invalid data is rejected', () => {
  const document = createEmptyMindMapDocument('往返', { id: 'doc', now: 1 });
  document.nodes.a = createTextMindMapNode({ x: 10, y: 20 }, { id: 'a', text: '节点', now: 1 });
  document.zOrder = ['a'];
  const parsed = parseMindMapDocumentJson(serializeMindMapDocument(document));
  assert.deepEqual(parsed, document);
  assert.throws(() => parseMindMapDocumentJson('{broken'), /有效/);
  assert.throws(() => parseMindMapDocumentJson('{"kind":"other"}'), /支持/);
});

test('layout worker client has a deterministic non-browser fallback', async () => {
  const document = createEmptyMindMapDocument('Worker', { id: 'worker-doc', now: 1 });
  document.nodes.a = createTextMindMapNode({ x: 0, y: 0 }, { id: 'a', now: 1 });
  document.nodes.b = createTextMindMapNode({ x: 0, y: 0 }, { id: 'b', now: 1 });
  document.edges.e = createMindMapEdge('a', 'b', { id: 'e', now: 1 });
  document.zOrder = ['a', 'b'];
  const result = await layoutMindMapTreeInWorker(document);
  assert.ok(result.nodes.b.x > result.nodes.a.x);
});

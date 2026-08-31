import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMindMapDocumentJson, serializeMindMapDocument } from '../../src/mindMap/importExport.ts';
import { layoutMindMapTree } from '../../src/mindMap/layout.ts';
import { layoutMindMapTreeInWorker } from '../../src/mindMap/layoutWorkerClient.ts';
import { resolveBranchThemeColors, resolveTreeEdgeColor } from '../../src/mindMap/visualTheme.ts';
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
    a: createMindMapEdge('root', 'left', { id: 'a', now: 1, relationship: 'tree' }),
    b: createMindMapEdge('root', 'right', { id: 'b', now: 1, relationship: 'tree' }),
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

test('tree layout reserves cross-axis space for complete subtrees', () => {
  const document = createEmptyMindMapDocument('子树布局', { id: 'subtree-doc', now: 1 });
  const ids = ['root', 'english', 'politics', 'reading', 'writing', 'words'];
  document.nodes = Object.fromEntries(ids.map((id) => [id, createTextMindMapNode(
    { x: 0, y: 0 },
    { id, text: id, now: 1 },
  )]));
  document.edges = Object.fromEntries([
    ['root-english', 'root', 'english'],
    ['root-politics', 'root', 'politics'],
    ['english-reading', 'english', 'reading'],
    ['english-writing', 'english', 'writing'],
    ['english-words', 'english', 'words'],
  ].map(([id, source, target]) => [id, createMindMapEdge(source, target, { id, now: 1, relationship: 'tree' })]));
  document.zOrder = ids;

  const layout = layoutMindMapTree(document);
  const englishLeaves = ['reading', 'writing', 'words'].map((id) => layout.nodes[id]);
  assert.deepEqual(englishLeaves.map((node) => node.y), [...englishLeaves.map((node) => node.y)].sort((a, b) => a - b));
  assert.equal(layout.nodes.english.y, (
    englishLeaves[0].y - englishLeaves[0].height / 2
    + englishLeaves[2].y + englishLeaves[2].height / 2
  ) / 2);
  assert.ok(layout.nodes.politics.y - layout.nodes.politics.height / 2
    >= englishLeaves[2].y + englishLeaves[2].height / 2 + 36);
  assert.equal(layout.nodes.root.y, 0);
});

test('tree edges inherit their first-level branch color unless explicitly overridden', () => {
  const document = createEmptyMindMapDocument('分支颜色', { id: 'theme-doc', now: 1 });
  const root = createTextMindMapNode({ x: 0, y: 0 }, { id: 'root', now: 1 });
  const english = createTextMindMapNode({ x: 0, y: 0 }, { id: 'english', now: 1 });
  const reading = createTextMindMapNode({ x: 0, y: 0 }, { id: 'reading', now: 1 });
  const politics = createTextMindMapNode({ x: 0, y: 0 }, { id: 'politics', now: 1 });
  english.style.fill = '#49a66f';
  politics.style.fill = '#d97732';
  document.nodes = { root, english, reading, politics };
  const rootEnglish = createMindMapEdge('root', 'english', { id: 'root-english', now: 1, relationship: 'tree' });
  const englishReading = createMindMapEdge('english', 'reading', { id: 'english-reading', now: 1, relationship: 'tree' });
  const rootPolitics = createMindMapEdge('root', 'politics', { id: 'root-politics', now: 1, relationship: 'tree' });
  document.edges = { rootEnglish, englishReading, rootPolitics };

  const colors = resolveBranchThemeColors(document);
  assert.equal(colors.get('reading'), '#49a66f');
  assert.equal(resolveTreeEdgeColor(rootEnglish, colors), '#49a66f');
  assert.equal(resolveTreeEdgeColor(englishReading, colors), '#49a66f');
  assert.equal(resolveTreeEdgeColor(rootPolitics, colors), '#d97732');
  englishReading.style.color = '#123456';
  assert.equal(resolveTreeEdgeColor(englishReading, colors), '#123456');
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
  document.edges.e = createMindMapEdge('a', 'b', { id: 'e', now: 1, relationship: 'tree' });
  document.zOrder = ['a', 'b'];
  const result = await layoutMindMapTreeInWorker(document);
  assert.ok(result.nodes.b.x > result.nodes.a.x);
});

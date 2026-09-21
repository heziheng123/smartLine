import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseMindMapDocumentJson,
  parseMindMapMarkdownOutline,
  isMindMapMarkdownOutline,
  serializeMindMapDocument,
  serializeMindMapMarkdownOutline,
  serializeMindMapSvg,
} from '../../src/mindMap/importExport.ts';
import { extractMindMapWikiLinks, isMindMapMarkdown, mindMapBacklinks } from '../../src/mindMap/richText.ts';
import { findMindMapTreeRoot, layoutMindMap, layoutMindMapBranch, layoutMindMapTree, treeChildIds } from '../../src/mindMap/layout.ts';
import { layoutMindMapTreeInWorker } from '../../src/mindMap/layoutWorkerClient.ts';
import { repairMindMapTreeForest, validateMindMapTreeForest } from '../../src/mindMap/treeValidation.ts';
import { resolveBranchThemeColors, resolveMindMapNodePresentation, resolveTreeEdgeColor } from '../../src/mindMap/visualTheme.ts';
import {
  createEmptyMindMapDocument,
  createMindMapEdge,
  createMindMapSection,
  createTextMindMapNode,
} from '../../src/mindMap/model.ts';
import { moveMindMapOutlineNode, setMindMapOutlineCollapsed } from '../../src/mindMap/canvas/treeInteractions.ts';

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

test('outline interactions reorder siblings, change hierarchy, and collapse branches', () => {
  const document = createEmptyMindMapDocument('大纲', { id: 'outline', now: 1 });
  for (const id of ['root', 'first', 'second', 'leaf']) document.nodes[id] = createTextMindMapNode({ x: 0, y: 0 }, { id, text: id, now: 1 });
  document.edges = {
    first: createMindMapEdge('root', 'first', { id: 'first', relationship: 'tree', order: 0, now: 1 }),
    second: createMindMapEdge('root', 'second', { id: 'second', relationship: 'tree', order: 1, now: 1 }),
    leaf: createMindMapEdge('first', 'leaf', { id: 'leaf', relationship: 'tree', order: 0, now: 1 }),
  };
  document.zOrder = ['root', 'first', 'second', 'leaf'];
  const reordered = moveMindMapOutlineNode(document, 'second', 'first', 'before');
  assert.deepEqual(Object.values(reordered.edges).filter((edge) => edge.sourceId === 'root').sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((edge) => edge.targetId), ['second', 'first']);
  const nested = moveMindMapOutlineNode(reordered, 'second', 'first', 'inside');
  assert.equal(Object.values(nested.edges).find((edge) => edge.targetId === 'second')?.sourceId, 'first');
  assert.equal(moveMindMapOutlineNode(nested, 'first', 'leaf', 'inside'), nested, 'cycles are rejected');
  const collapsed = setMindMapOutlineCollapsed(nested, true);
  assert.equal(collapsed.nodes.first.collapsed, true);
  assert.equal(collapsed.nodes.second.collapsed, false);
});

test('mind-map mode places ordered first-level branches on both sides of its centre topic', () => {
  const document = createEmptyMindMapDocument('双侧脑图', { id: 'mind-map', now: 1 });
  const root = createTextMindMapNode({ x: 240, y: 160 }, { id: 'root', now: 1 });
  const left = { ...createTextMindMapNode({ x: 0, y: 0 }, { id: 'left', now: 1 }), branchSide: 'left' as const };
  const right = { ...createTextMindMapNode({ x: 0, y: 0 }, { id: 'right', now: 1 }), branchSide: 'right' as const };
  const leaf = createTextMindMapNode({ x: 0, y: 0 }, { id: 'leaf', now: 1 });
  document.nodes = { root, left, right, leaf };
  document.edges = {
    right: createMindMapEdge('root', 'right', { id: 'right', now: 1, relationship: 'tree', order: 1 }),
    left: createMindMapEdge('root', 'left', { id: 'left', now: 1, relationship: 'tree', order: 0 }),
    leaf: createMindMapEdge('left', 'leaf', { id: 'leaf', now: 1, relationship: 'tree', order: 0 }),
  };
  document.zOrder = ['root', 'left', 'right', 'leaf'];
  document.settings.mode = 'mind-map';
  document.mindMapRootId = 'root';

  const layout = layoutMindMap(document);
  assert.deepEqual(treeChildIds(layout, 'root'), ['left', 'right']);
  assert.ok(layout.nodes.left.x < layout.nodes.root.x);
  assert.ok(layout.nodes.right.x > layout.nodes.root.x);
  assert.ok(layout.nodes.leaf.x < layout.nodes.left.x);
  assert.deepEqual([layout.nodes.root.x, layout.nodes.root.y], [240, 160]);
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
    >= englishLeaves[2].y + englishLeaves[2].height / 2 + 48);
  assert.equal(layout.nodes.root.y, 0);
});

test('reflowing the owning tree keeps new leaves clear of adjacent branches', () => {
  const document = createEmptyMindMapDocument('自动新增', { id: 'auto-layout', now: 1 });
  const ids = ['root', 'english', 'politics', 'reading', 'writing', 'wa', 'laugh'];
  document.nodes = Object.fromEntries(ids.map((id) => [id, createTextMindMapNode(
    { x: 0, y: 0 },
    { id, text: id, now: 1 },
  )]));
  const connect = (sourceId: string, targetId: string) => createMindMapEdge(sourceId, targetId, {
    id: `${sourceId}-${targetId}`,
    now: 1,
    relationship: 'tree',
  });
  for (const edge of [
    connect('root', 'english'), connect('root', 'politics'),
    connect('english', 'reading'), connect('english', 'writing'),
    connect('politics', 'wa'), connect('politics', 'laugh'),
  ]) document.edges[edge.id] = edge;
  document.zOrder = ids;

  const before = layoutMindMapTree(document);
  before.nodes.word = createTextMindMapNode({ x: 0, y: 0 }, { id: 'word', text: 'word', now: 1 });
  before.zOrder.push('word');
  const newEdge = connect('english', 'word');
  before.edges[newEdge.id] = newEdge;
  const layout = layoutMindMapBranch(before, findMindMapTreeRoot(before, 'english'));
  const word = layout.nodes.word;
  const wa = layout.nodes.wa;

  assert.equal(findMindMapTreeRoot(before, 'english'), 'root');
  assert.deepEqual([layout.nodes.root.x, layout.nodes.root.y], [before.nodes.root.x, before.nodes.root.y]);
  assert.ok(wa.y - wa.height / 2 >= word.y + word.height / 2 + 48);
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

test('brain-map templates assign distinct stable colors and semantic components', () => {
  const document = createEmptyMindMapDocument('主题模板', { id: 'theme-preset', now: 1 });
  for (const id of ['root', 'first', 'second', 'leaf']) {
    document.nodes[id] = createTextMindMapNode({ x: 0, y: 0 }, { id, text: id, now: 1 });
  }
  document.edges = {
    first: createMindMapEdge('root', 'first', { id: 'first', now: 1, relationship: 'tree', order: 0 }),
    second: createMindMapEdge('root', 'second', { id: 'second', now: 1, relationship: 'tree', order: 1 }),
    leaf: createMindMapEdge('first', 'leaf', { id: 'leaf', now: 1, relationship: 'tree', order: 0 }),
  };
  document.settings.mapTheme = 'rainbow';
  const colors = resolveBranchThemeColors(document);
  assert.notEqual(colors.get('first'), colors.get('second'));
  assert.equal(colors.get('leaf'), colors.get('first'));
  assert.equal(resolveMindMapNodePresentation(document.nodes.root, 0, colors.get('root')!, 'rainbow').fontSize, 17);
  assert.equal(resolveMindMapNodePresentation({ ...document.nodes.leaf, semantic: 'branch' }, 2, colors.get('leaf')!, 'rainbow').topic, false);
  assert.equal(resolveMindMapNodePresentation({ ...document.nodes.leaf, semantic: 'subtopic' }, 1, colors.get('leaf')!, 'professional').topic, true);
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

test('Markdown outlines import as trees and export in a stable outline form', () => {
  const document = parseMindMapMarkdownOutline('# 学习计划\n## 英语\n- 单词\n- 阅读\n## 数学\n');
  const nodes = Object.values(document.nodes);
  assert.deepEqual(nodes.map((node) => node.text), ['学习计划', '英语', '单词', '阅读', '数学']);
  assert.equal(Object.values(document.edges).filter((edge) => edge.relationship === 'tree').length, 4);
  assert.equal(serializeMindMapMarkdownOutline(document), '- 学习计划\n  - 英语\n    - 单词\n    - 阅读\n  - 数学\n');
  assert.throws(() => parseMindMapMarkdownOutline(' \n\t'), /没有可导入/);
  assert.equal(isMindMapMarkdownOutline('# 标题\n- 分支'), true);
  assert.equal(isMindMapMarkdownOutline('只有普通段落'), false);
});

test('Markdown export preserves explicit sibling order', () => {
  const document = parseMindMapMarkdownOutline('# 计划\n- 第一项\n- 第二项\n');
  const edges = Object.values(document.edges).filter((edge) => edge.sourceId === Object.values(document.nodes).find((node) => node.text === '计划')?.id);
  assert.equal(edges.length, 2);
  edges[0].order = 1;
  edges[1].order = 0;
  assert.equal(serializeMindMapMarkdownOutline(document), '- 计划\n  - 第二项\n  - 第一项\n');
});

test('Markdown import preserves task lists, quotes, tables, and code blocks', () => {
  const source = '# 计划\n- [ ] 收集资料\n- [x] 完成初稿\n\n> 这是一段引用\n> 保留第二行\n\n| 名称 | 状态 |\n| --- | --- |\n| 提纲 | 进行中 |\n\n```ts\nconst done = true;\n```\n';
  const document = parseMindMapMarkdownOutline(source);
  const nodes = Object.values(document.nodes);
  assert.deepEqual(nodes.filter((node) => node.taskStatus !== 'none').map((node) => [node.text, node.taskStatus]), [
    ['收集资料', 'todo'], ['完成初稿', 'done'],
  ]);
  assert.deepEqual(nodes.filter((node) => node.type === 'markdown').map((node) => node.text), [
    '> 这是一段引用\n> 保留第二行',
    '| 名称 | 状态 |\n| --- | --- |\n| 提纲 | 进行中 |',
    '```ts\nconst done = true;\n```',
  ]);
  const serialized = serializeMindMapMarkdownOutline(document);
  assert.match(serialized, /- \[ \] 收集资料/);
  assert.match(serialized, /- \[x\] 完成初稿/);
  assert.match(serialized, /> 这是一段引用\n\s*> 保留第二行/);
  assert.match(serialized, /\| 名称 \| 状态 \|\n\s*\| --- \| --- \|\n\s*\| 提纲 \| 进行中 \|/);
  assert.match(serialized, /```ts\n\s*const done = true;\n\s*```/);
});

test('markdown typing shortcuts identify both block and inline syntax', () => {
  for (const source of ['# 一级标题', '### 三级标题', '- [ ] 待办', '> 引用', '```ts\nconst ok = true;', '| 列 | 值 |', '---', '文本 **加粗**', '[链接](https://example.com)', '关联 [[目标节点]]']) {
    assert.equal(isMindMapMarkdown(source), true, source);
  }
  assert.equal(isMindMapMarkdown('普通节点文字'), false);
});

test('wiki links expose stable internal targets and backlinks', () => {
  const target = createTextMindMapNode({ x: 0, y: 0 }, { id: 'target', text: '目标节点', now: 1 });
  const source = { ...createTextMindMapNode({ x: 0, y: 0 }, { id: 'source', text: '来源', now: 1 }), note: '参见 [[目标节点]] 与 [[其他节点]]' };
  assert.deepEqual(extractMindMapWikiLinks(source.note), ['目标节点', '其他节点']);
  assert.deepEqual(mindMapBacklinks([target, source], target).map((node) => node.id), ['source']);
});

test('SVG export preserves structural summaries and semantic boundary shapes', () => {
  const document = createEmptyMindMapDocument('语义导出', { id: 'semantic-export', now: 1 });
  const first = createTextMindMapNode({ x: 0, y: 0 }, { id: 'first', text: '第一项', now: 1 });
  const second = createTextMindMapNode({ x: 0, y: 100 }, { id: 'second', text: '第二项', now: 1 });
  const summary = { ...createTextMindMapNode({ x: 260, y: 50 }, { id: 'summary', text: '摘要', now: 1 }), semantic: 'summary' as const, summarySourceIds: ['first', 'second'] };
  const boundary = createMindMapSection([first, second], { id: 'boundary', title: '云朵边界', shape: 'cloud', now: 1 });
  first.parentSectionId = boundary.id;
  second.parentSectionId = boundary.id;
  document.nodes = { first, second, summary };
  document.sections = { [boundary.id]: boundary };
  document.zOrder = ['first', 'second', 'summary'];
  const svg = serializeMindMapSvg(document);
  assert.match(svg, /云朵边界/);
  assert.match(svg, /stroke-dasharray="3 3"/);
  assert.match(svg, /opacity="0.58"/);
});

test('tree validation downgrades extra parents and cycles to references', () => {
  const document = createEmptyMindMapDocument('校验', { id: 'forest', now: 1 });
  for (const id of ['root', 'other', 'child']) {
    document.nodes[id] = createTextMindMapNode({ x: 0, y: 0 }, { id, now: 1 });
  }
  document.edges = Object.fromEntries([
    createMindMapEdge('root', 'child', { id: 'root-child', now: 1, relationship: 'tree' }),
    createMindMapEdge('other', 'child', { id: 'other-child', now: 1, relationship: 'tree' }),
    createMindMapEdge('child', 'root', { id: 'child-root', now: 1, relationship: 'tree' }),
  ].map((edge) => [edge.id, edge]));
  const validation = validateMindMapTreeForest(document);
  assert.deepEqual(validation.issues.map((issue) => issue.kind).sort(), ['cycle', 'multiple-parents']);
  const repaired = repairMindMapTreeForest(document);
  assert.equal(repaired.edges['root-child'].relationship, 'tree');
  assert.equal(repaired.edges['other-child'].relationship, 'reference');
  assert.equal(repaired.edges['child-root'].relationship, 'reference');
  assert.equal(validateMindMapTreeForest(repaired).isValid, true);
});

test('layout preserves locked nodes and reserves primary space for edge labels', () => {
  const document = createEmptyMindMapDocument('布局约束', { id: 'constraints', now: 1 });
  const root = createTextMindMapNode({ x: 0, y: 0 }, { id: 'root', now: 1 });
  const child = createTextMindMapNode({ x: 777, y: 555 }, { id: 'child', now: 1 });
  child.locked = true;
  document.nodes = { root, child };
  const edge = createMindMapEdge('root', 'child', { id: 'edge', now: 1, relationship: 'tree' });
  edge.label = '这是一条需要预留空间的连线标签';
  document.edges = { edge };
  const layout = layoutMindMapTree(document);
  assert.deepEqual([layout.nodes.child.x, layout.nodes.child.y], [777, 555]);
  assert.ok(layout.nodes.root.x === 0);
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

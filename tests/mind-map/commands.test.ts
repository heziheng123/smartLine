import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyHistoryEntry,
  createHistoryEntry,
  emptyMindMapHistory,
  pushHistory,
} from '../../src/mindMap/commands.ts';
import {
  createEmptyMindMapDocument,
  createMindMapEdge,
  createTextMindMapNode,
} from '../../src/mindMap/model.ts';

test('a node and its edge can be deleted and restored as one history entry', () => {
  const before = createEmptyMindMapDocument('测试', { id: 'doc', now: 1 });
  const first = createTextMindMapNode({ x: 0, y: 0 }, { id: 'a', now: 1 });
  const second = createTextMindMapNode({ x: 100, y: 0 }, { id: 'b', now: 1 });
  const edge = createMindMapEdge('a', 'b', { id: 'e', now: 1 });
  before.nodes = { a: first, b: second };
  before.edges = { e: edge };
  before.zOrder = ['a', 'b'];

  const after = {
    ...before,
    nodes: { b: second },
    edges: {},
    zOrder: ['b'],
  };
  const entry = createHistoryEntry('删除节点', before, after);
  assert.ok(entry);
  const restored = applyHistoryEntry(after, entry, 'undo');
  assert.deepEqual(restored.nodes, before.nodes);
  assert.deepEqual(restored.edges, before.edges);
  assert.deepEqual(restored.zOrder, before.zOrder);
  const deletedAgain = applyHistoryEntry(restored, entry, 'redo');
  assert.deepEqual(deletedAgain.nodes, after.nodes);
  assert.deepEqual(deletedAgain.edges, after.edges);
});

test('new commands clear redo and history keeps only the configured limit', () => {
  const document = createEmptyMindMapDocument('测试', { id: 'doc', now: 1 });
  let history = { ...emptyMindMapHistory(), redo: [{
    label: '旧重做',
    nodes: [],
    edges: [],
    zOrderBefore: null,
    zOrderAfter: null,
  }] };
  for (let index = 0; index < 4; index += 1) {
    const next = {
      ...document,
      nodes: {
        ...document.nodes,
        [String(index)]: createTextMindMapNode({ x: index, y: 0 }, { id: String(index), now: 1 }),
      },
    };
    const entry = createHistoryEntry(String(index), document, next);
    assert.ok(entry);
    history = pushHistory(history, entry, 3);
  }
  assert.equal(history.undo.length, 3);
  assert.deepEqual(history.undo.map((entry) => entry.label), ['1', '2', '3']);
  assert.deepEqual(history.redo, []);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { computeNodeActivationStates } from '@/graph/activation';
import { getReviewActivationChanges } from '@/ebb/reviewGraphActivation';
import type { ReviewTask } from '@/ebb/types';
import type { GraphNode } from '@/graph/types';

const node = (id: string, parentId: string | null, status?: GraphNode['status']): GraphNode => ({
  id,
  name: id,
  parentId,
  createdAt: 1,
  status,
});

const resetActivationCascade = (nodes: GraphNode[], rootIds: string[]): GraphNode[] => {
  const resetIds = new Set<string>();
  const collect = (rootId: string) => {
    if (!nodes.some((item) => item.id === rootId)) return;
    resetIds.add(rootId);
    let changed = true;
    while (changed) {
      changed = false;
      for (const item of nodes) {
        if (item.parentId && resetIds.has(item.parentId) && !resetIds.has(item.id)) {
          resetIds.add(item.id);
          changed = true;
        }
      }
    }
  };
  rootIds.forEach(collect);
  return nodes.map((item) => resetIds.has(item.id)
    ? { ...item, status: nodes.some((child) => !child.isArchived && child.parentId === item.id) ? undefined : 'unactivated' }
    : item);
};

test('归档整棵子树后整条链路恢复为未激活灰色', () => {
  const before = [
    node('root', null, undefined),
    node('middle', 'root', undefined),
    node('leaf-a', 'middle', 'activated'),
    node('leaf-b', 'middle', 'activated'),
  ];
  assert.equal(computeNodeActivationStates(before).get('middle')?.isActivated, true);

  const after = resetActivationCascade(before, ['middle']);
  const states = computeNodeActivationStates(after);
  assert.equal(states.get('leaf-a')?.isActivated, false);
  assert.equal(states.get('leaf-b')?.isActivated, false);
  assert.equal(states.get('middle')?.isActivated, false);
  assert.equal(states.get('root')?.isActivated, false);
});

test('只归档一个分支时兄弟分支保持激活', () => {
  const before = [
    node('root', null, undefined),
    node('branch-a', 'root', undefined),
    node('branch-b', 'root', undefined),
    node('leaf-a', 'branch-a', 'activated'),
    node('leaf-b', 'branch-b', 'activated'),
  ];
  const after = resetActivationCascade(before, ['branch-a']);
  const states = computeNodeActivationStates(after);
  assert.equal(states.get('leaf-a')?.isActivated, false);
  assert.equal(states.get('leaf-b')?.isActivated, true);
  assert.equal(states.get('branch-b')?.isActivated, true);
  assert.equal(states.get('root')?.isActivated, false);
});

const review = (id: string, graphNodeId: string, isArchived = false): ReviewTask => ({
  id, graphNodeId, topicName: graphNodeId, dueDate: '2026-10-05', isCompleted: false, isArchived,
});

test('只删一轮不关闭节点，删掉最后一轮或归档整套计划才关闭', () => {
  const first = review('r1', 'leaf');
  const second = review('r2', 'leaf');
  assert.deepEqual(getReviewActivationChanges([first, second], [second]), []);
  assert.deepEqual(getReviewActivationChanges([second], []), [{ nodeId: 'leaf', active: false }]);
  assert.deepEqual(getReviewActivationChanges([first, second], [
    { ...first, isArchived: true }, { ...second, isArchived: true },
  ]), [{ nodeId: 'leaf', active: false }]);
  assert.deepEqual(getReviewActivationChanges([{ ...first, isArchived: true }], [first]),
    [{ nodeId: 'leaf', active: true }]);
  assert.deepEqual(getReviewActivationChanges([first], [review('new', 'leaf')]), []);
  const oldArchive = { ...first, isArchived: true, archivedReason: 'manual' as const };
  assert.deepEqual(getReviewActivationChanges([oldArchive], []), [{ nodeId: 'leaf', active: false }]);
});

test('历史手动归档造成的假激活不会继续点亮父节点，显式手动激活仍有效', () => {
  const nodes = [node('root', null), node('leaf-a', 'root', 'activated'), node('leaf-b', 'root', 'activated')];
  const oldArchive = [{ ...review('old', 'leaf-a', true), archivedReason: 'manual' as const }];
  assert.equal(computeNodeActivationStates(nodes, oldArchive).get('root')?.isActivated, false);
  assert.equal(computeNodeActivationStates(nodes, oldArchive).get('leaf-a')?.isActivated, false);
  assert.equal(computeNodeActivationStates([
    nodes[0], { ...nodes[1], reviewClosed: false }, nodes[2],
  ], oldArchive).get('root')?.isActivated, true);
  assert.equal(computeNodeActivationStates([
    nodes[0], { ...nodes[1], reviewClosed: true }, nodes[2],
  ]).get('root')?.isActivated, false);
});

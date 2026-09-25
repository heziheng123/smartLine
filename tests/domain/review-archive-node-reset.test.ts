import assert from 'node:assert/strict';
import test from 'node:test';
import { computeNodeActivationStates } from '@/graph/activation';
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

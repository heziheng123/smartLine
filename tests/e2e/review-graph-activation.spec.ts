import { expect, test } from '@playwright/test';

test('复习轮次的归档、删除、恢复和撤销只改变对应叶子及其父节点', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { useEbbStore, useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const { computeNodeActivationStates } = await import('/src/graph/activation.ts');
    await Promise.all([useGraphStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
    useGraphStore.setState({ nodes: [
      { id: 'root', name: '根', parentId: null, createdAt: 1 },
      { id: 'a', name: '甲', parentId: 'root', createdAt: 2, status: 'activated' },
      { id: 'b', name: '乙', parentId: 'root', createdAt: 3, status: 'activated' },
    ] });
    const task = (id: string, graphNodeId: string) => ({
      id, graphNodeId, topicName: graphNodeId, dueDate: '2026-10-05',
      createdAt: '2026-10-05T00:00:00.000Z', isCompleted: false,
    });
    useEbbStore.setState({ reviewTasks: [task('a1', 'a'), task('a2', 'a'), task('b1', 'b')] });
    const snapshot = () => {
      const graph = useGraphStore.getState();
      const reviews = useEbbStore.getState().reviewTasks;
      const activation = computeNodeActivationStates(graph.nodes, reviews);
      return {
        a: graph.nodes.find((node) => node.id === 'a')?.status,
        b: graph.nodes.find((node) => node.id === 'b')?.status,
        root: activation.get('root')?.isActivated,
      };
    };
    const initial = snapshot();
    useEbbStore.getState().deleteReviewTask('a1');
    const oneDeleted = snapshot();
    useEbbStore.getState().deleteReviewTask('a2');
    const lastDeleted = snapshot();
    useEbbStore.getState().popUndo();
    const undoDelete = snapshot();
    const archive = useEbbStore.getState().archiveReviewPlan('graph:a');
    const archived = snapshot();
    useEbbStore.getState().restoreArchivedReviewPlan(archive.archivedTaskIds);
    const restored = snapshot();
    useEbbStore.getState().clearAllTasks();
    const cleared = snapshot();
    useEbbStore.getState().popUndo();
    const undoClear = snapshot();
    useEbbStore.getState().deleteReviewTask('a2');
    useGraphStore.getState().updateNode('a', { status: 'unactivated' });
    useEbbStore.getState().popUndo();
    const manualChangeAfterDelete = snapshot();
    useEbbStore.getState().clearAllTasks();
    useEbbStore.getState().popUndo();
    const manualChangeBeforeClear = snapshot();
    return { initial, oneDeleted, lastDeleted, undoDelete, archived, restored, cleared, undoClear, manualChangeAfterDelete, manualChangeBeforeClear };
  });

  expect(result.initial).toEqual({ a: 'activated', b: 'activated', root: true });
  expect(result.oneDeleted).toEqual(result.initial);
  expect(result.lastDeleted).toEqual({ a: 'unactivated', b: 'activated', root: false });
  expect(result.undoDelete).toEqual(result.initial);
  expect(result.archived).toEqual(result.lastDeleted);
  expect(result.restored).toEqual(result.initial);
  expect(result.cleared).toEqual({ a: 'unactivated', b: 'unactivated', root: false });
  expect(result.undoClear).toEqual(result.initial);
  expect(result.manualChangeAfterDelete).toEqual(result.lastDeleted);
  expect(result.manualChangeBeforeClear).toEqual(result.lastDeleted);
});

test('恢复历史父节点复习记录不会误激活所有后代', async ({ page }) => {
  await page.goto('/');
  const statuses = await page.evaluate(async () => {
    const { useEbbStore, useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    await Promise.all([useGraphStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
    useGraphStore.setState({ nodes: [
      { id: 'parent', name: '阶段', parentId: null, createdAt: 1 },
      { id: 'child', name: '小节', parentId: 'parent', createdAt: 2, status: 'unactivated' },
    ] });
    useEbbStore.setState({ reviewTasks: [{
      id: 'old', graphNodeId: 'parent', topicName: '阶段', dueDate: '2026-10-05',
      createdAt: '2026-10-05T00:00:00.000Z', isCompleted: false, isArchived: true,
      archivedReason: 'manual', archivedAt: '2026-10-05T00:00:00.000Z',
    }] });
    useEbbStore.getState().restoreArchivedReviewPlan(['old']);
    return useGraphStore.getState().nodes.map((node) => [node.id, node.status]);
  });
  expect(statuses).toEqual([['parent', undefined], ['child', 'unactivated']]);
});

test('清空旧归档记录后历史假激活不会重新出现', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { useEbbStore, useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const { computeNodeActivationStates } = await import('/src/graph/activation.ts');
    await Promise.all([useGraphStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
    useGraphStore.setState({ nodes: [
      { id: 'root', name: '根', parentId: null, createdAt: 1 },
      { id: 'leaf', name: '旧节点', parentId: 'root', createdAt: 2, status: 'activated' },
    ] });
    useEbbStore.setState({ reviewTasks: [{
      id: 'old', graphNodeId: 'leaf', topicName: '旧节点', dueDate: '2026-09-24',
      createdAt: '2026-09-01T00:00:00.000Z', isCompleted: false, isArchived: true,
      archivedReason: 'manual', archivedAt: '2026-09-24T00:00:00.000Z',
    }] });
    const before = computeNodeActivationStates(useGraphStore.getState().nodes, useEbbStore.getState().reviewTasks)
      .get('root')?.isActivated;
    useEbbStore.getState().clearAllTasks();
    const leaf = useGraphStore.getState().nodes.find((node) => node.id === 'leaf');
    const after = computeNodeActivationStates(useGraphStore.getState().nodes, useEbbStore.getState().reviewTasks)
      .get('root')?.isActivated;
    return { before, after, status: leaf?.status, reviewClosed: leaf?.reviewClosed };
  });
  expect(result).toEqual({ before: false, after: false, status: 'unactivated', reviewClosed: true });
});

test('清理旧归档历史不撤销之后的手动激活', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { useEbbStore, useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    await Promise.all([useGraphStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
    useGraphStore.setState({ nodes: [{
      id: 'leaf', name: '手动激活节点', parentId: null, createdAt: 1,
      status: 'unactivated', reviewClosed: true,
    }] });
    useEbbStore.setState({ reviewTasks: [{
      id: 'old', graphNodeId: 'leaf', topicName: '手动激活节点', dueDate: '2026-09-24',
      isCompleted: false, isArchived: true, archivedReason: 'manual',
    }] });
    useGraphStore.getState().updateNode('leaf', { status: 'activated' });
    useEbbStore.getState().clearAllTasks();
    const node = useGraphStore.getState().nodes[0];
    return { status: node.status, reviewClosed: node.reviewClosed };
  });
  expect(result).toEqual({ status: 'activated', reviewClosed: false });
});

test('重复完成已归档项目任务不会重新点亮没有活动复习的节点', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { useEbbStore, useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const { commitProjectTaskEffects } = await import('/src/services/projectTaskEffectCommit.ts');
    await Promise.all([useGraphStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
    useGraphStore.setState({ nodes: [{
      id: 'leaf', name: '旧节点', parentId: null, createdAt: 1,
      status: 'unactivated', reviewClosed: true,
    }] });
    useEbbStore.setState({ reviewTasks: [{
      id: 'old', graphNodeId: 'leaf', topicName: '旧节点', dueDate: '2026-09-24',
      createdAt: '2026-09-01T00:00:00.000Z', isCompleted: false, isArchived: true,
      archivedReason: 'manual', archivedAt: '2026-09-24T00:00:00.000Z',
    }] });
    const header = { title: '基础课', tag: '', tagColor: '', duration: 30, isCompleted: true, graphNodeIds: ['leaf'] };
    const report = commitProjectTaskEffects({
      taskId: 'project', blockId: 'block', currentHeader: header, nextHeader: header,
      effectPlan: {
        ebbPayloads: [{ action: 'add', graphNodeId: 'leaf', topicName: '旧节点', triggerSchedule: true }],
        graphNodeIdsToActivate: ['leaf'], graphNodeIdsToDeactivate: [],
      },
    });
    return { activated: report.activatedGraphNodeIds, node: useGraphStore.getState().nodes[0] };
  });
  expect(result.activated).toEqual([]);
  expect(result.node.status).toBe('unactivated');
  expect(result.node.reviewClosed).toBe(true);
});

test('一个绿色子节点不会把有旧归档灰节点的根节点染绿', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('知识大盘').click();
  await page.evaluate(async () => {
    const { useEbbStore, useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    await Promise.all([useGraphStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
    useGraphStore.setState({ nodes: [
      { id: 'root', name: '根', parentId: null, createdAt: 1 },
      { id: 'green', name: '复习中', parentId: 'root', createdAt: 2, status: 'activated' },
      { id: 'old', name: '旧归档', parentId: 'root', createdAt: 3, status: 'activated' },
    ] });
    useEbbStore.setState({ reviewTasks: [
      { id: 'current', graphNodeId: 'green', topicName: '复习中', dueDate: '2026-10-05', isCompleted: false },
      { id: 'archived', graphNodeId: 'old', topicName: '旧归档', dueDate: '2026-09-24',
        isCompleted: false, isArchived: true, archivedReason: 'manual' },
    ] });
  });
  await expect.poll(() => page.locator('[data-node-id="green"] path').first().getAttribute('fill')).toBe('#10b981');
  await expect.poll(() => page.locator('[data-node-id="old"] path').first().getAttribute('fill')).toBe('#64748b');
  await expect.poll(() => page.locator('[data-node-id="root"] path').first().getAttribute('fill')).toBe('#64748b');
});

test('删除最后一轮的灰色状态刷新后仍保留', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('知识大盘').click();
  await expect(page.getByLabel('知识大盘视图')).toBeVisible();
  await page.evaluate(async () => {
    const { useEbbStore, useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    await Promise.all([useGraphStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
    useGraphStore.setState({ nodes: [{
      id: 'leaf', name: '刷新节点', parentId: null, createdAt: 1, status: 'activated',
    }] });
    useEbbStore.setState({ reviewTasks: [{
      id: 'last', graphNodeId: 'leaf', topicName: '刷新节点', dueDate: '2026-10-05', isCompleted: false,
    }] });
    useEbbStore.getState().deleteReviewTask('last');
  });
  await expect.poll(() => page.evaluate(async () => {
    const { createScopedStorage } = await import('/src/utils/persistence.ts');
    const data = await createScopedStorage('graph_data').getItem<{
      nodes: Array<{ id: string; reviewClosed?: boolean }>;
    }>('line-graph-storage');
    return data?.nodes.find((node) => node.id === 'leaf')?.reviewClosed;
  })).toBe(true);
  await page.reload();
  const result = await page.evaluate(async () => {
    const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    await useGraphStore.getState().hydrateStore();
    const node = useGraphStore.getState().nodes.find((item) => item.id === 'leaf');
    return { status: node?.status, reviewClosed: node?.reviewClosed };
  });
  expect(result).toEqual({ status: 'unactivated', reviewClosed: true });
});

test('知识节点归档期间删掉最后一轮，恢复节点后仍是灰色', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { useEbbStore, useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const { computeNodeActivationStates } = await import('/src/graph/activation.ts');
    await Promise.all([useGraphStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
    useGraphStore.setState({ nodes: [
      { id: 'root', name: '根', parentId: null, createdAt: 1 },
      { id: 'leaf', name: '节点', parentId: 'root', createdAt: 2, status: 'activated' },
    ] });
    useEbbStore.setState({ reviewTasks: [{
      id: 'last', graphNodeId: 'leaf', topicName: '节点', dueDate: '2026-10-05', isCompleted: false,
    }] });
    useGraphStore.getState().archiveNodeCascade('leaf', true);
    useEbbStore.getState().deleteReviewTask('last');
    useGraphStore.getState().archiveNodeCascade('leaf', false);
    const node = useGraphStore.getState().nodes.find((item) => item.id === 'leaf');
    return {
      status: node?.status,
      reviewClosed: node?.reviewClosed,
      root: computeNodeActivationStates(useGraphStore.getState().nodes, useEbbStore.getState().reviewTasks)
        .get('root')?.isActivated,
    };
  });
  expect(result).toEqual({ status: 'unactivated', reviewClosed: true, root: false });
});

test('知识节点归档期间恢复复习计划，恢复节点后重新激活', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { useEbbStore, useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    await Promise.all([useGraphStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
    useGraphStore.setState({ nodes: [{
      id: 'leaf', name: '节点', parentId: null, createdAt: 1,
      status: 'unactivated', reviewClosed: true,
    }] });
    useEbbStore.setState({ reviewTasks: [{
      id: 'last', graphNodeId: 'leaf', topicName: '节点', dueDate: '2026-10-05',
      isCompleted: false, isArchived: true, archivedReason: 'manual',
    }] });
    useGraphStore.getState().archiveNodeCascade('leaf', true);
    useEbbStore.getState().restoreArchivedReviewPlan(['last']);
    useGraphStore.getState().archiveNodeCascade('leaf', false);
    const node = useGraphStore.getState().nodes[0];
    return { status: node.status, reviewClosed: node.reviewClosed };
  });
  expect(result).toEqual({ status: 'activated', reviewClosed: false });
});

test('项目任务同步删掉最后一轮时，即使没有显式停用命令，节点也变灰', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { useEbbStore, useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const { commitProjectTaskEffects } = await import('/src/services/projectTaskEffectCommit.ts');
    await Promise.all([useGraphStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
    useGraphStore.setState({ nodes: [{
      id: 'leaf', name: '节点', parentId: null, createdAt: 1, status: 'activated',
    }] });
    const round = {
      id: 'last', graphNodeId: 'leaf', topicName: '节点', dueDate: '2026-10-05', isCompleted: false,
    };
    useEbbStore.setState({ reviewTasks: [round] });
    const header = { title: '任务', tag: '', tagColor: '', duration: 30, isCompleted: true, graphNodeIds: ['leaf'] };
    const report = commitProjectTaskEffects({
      taskId: 'project', blockId: 'block', currentHeader: header, nextHeader: header,
      effectPlan: { ebbPayloads: [], graphNodeIdsToActivate: [], graphNodeIdsToDeactivate: [] },
      ebbPlan: {
        baseReviewTasks: [round], reviewTasks: [], dailySourceIdsToRemove: [],
        nodeResults: [{ graphNodeId: 'leaf', mode: 'continue', changed: true,
          completedOldRoundIds: [], archivedOldRoundIds: [], generatedRoundIds: [] }],
        changed: true,
      },
    });
    const node = useGraphStore.getState().nodes[0];
    return { status: node.status, reviewClosed: node.reviewClosed,
      graphAffected: report.affectedDomains.includes('knowledge-graph') };
  });
  expect(result).toEqual({ status: 'unactivated', reviewClosed: true, graphAffected: true });
});

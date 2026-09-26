import { expect, test, type Page } from '@playwright/test';
import { mathAnalysisOutline } from '../fixtures/knowledge-graph-math';

const graphNodes = (page: Page) => page.evaluate(async () => (
  await import('/src/testing/workspaceStoreAccess.ts')
).useGraphStore.getState().nodes);

const persistedNodes = (page: Page) => page.evaluate(async () => (
  await import('/src/utils/persistence.ts')
).createScopedStorage('graph_data').getItem<{ nodes: Array<{ id: string }> }>('line-graph-storage').then((data) => data?.nodes ?? []));

const importMath = (page: Page) => page.evaluate(async (outline) => {
  const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
  const { parseGraphOutline } = await import('/src/graph/outlineImport.ts');
  return useGraphStore.getState().addNodes(parseGraphOutline(outline));
}, mathAnalysisOutline);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('smart-line-sync-architecture-v1', JSON.stringify({ architecture: 'unified' }));
  });
});

test('deletes the complete math subtree from the UI, undoes once, and stays deleted after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('知识大盘').click();
  await expect(page.getByLabel('知识大盘视图')).toBeVisible();
  const imported = await importMath(page);
  await expect.poll(async () => (await persistedNodes(page)).length).toBe(100);
  const before = await page.evaluate(async (rootId) => {
    const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const { inspectGraphNodes } = await import('/src/graph/integrity.ts');
    return inspectGraphNodes(useGraphStore.getState().nodes, rootId);
  }, imported[0].id);
  expect(before).toMatchObject({ totalNodes: 100, directChildren: 22, reachableNodes: 100,
    uniqueIds: 100, rootNodes: 1, missingParentNodes: 0, duplicateIds: 0, cycleNodes: 0, unreachableNodes: 0 });
  await expect(page.locator('[data-node-id]')).toHaveCount(100);
  await expect(page.getByTestId('knowledge-graph-zoom-cache')).toHaveAttribute('data-zoom-cache-state', 'ready');
  const cacheBefore = await page.evaluate(async () => (
    await import('/src/graph/diagnostics.ts')
  ).getGraphDiagnostics().counters.cacheGeneration);
  await page.locator(`[data-node-id="${imported[0].id}"]`).click();
  const beforeDeleteCounters = await page.evaluate(async () => (
    await import('/src/graph/diagnostics.ts')
  ).getGraphDiagnostics().counters);
  await page.getByRole('button', { name: '删除节点' }).click();
  await expect(page.getByRole('alertdialog')).toContainText('及其全部后代');
  await page.getByRole('alertdialog').getByRole('button', { name: '删除节点' }).click();
  await expect.poll(async () => (await graphNodes(page)).length).toBe(0);
  await expect(page.locator('[data-node-id]')).toHaveCount(0);
  await expect.poll(async () => (await persistedNodes(page)).length).toBe(0);
  const diagnosis = await page.evaluate(async () => (
    await import('/src/graph/diagnostics.ts')
  ).getGraphDiagnostics());
  expect(diagnosis.details.lastDelete).toMatchObject({ totalBefore: 100, directChildren: 22,
    descendantCount: 99, deleteSetCount: 100, totalAfterStore: 0, orphanCountAfter: 0, deletedTreeRemaining: 0 });
  expect(diagnosis.counters.cacheGeneration).toBeGreaterThan(cacheBefore);
  const deleteCounts = Object.fromEntries(['stateCommit', 'historyPush', 'persistenceSchedule', 'syncEnqueue',
    'persistenceWrite', 'layout', 'cacheRebuild'].map((key) => [key,
    (diagnosis.counters[key] ?? 0) - (beforeDeleteCounters[key] ?? 0)]));
  expect(deleteCounts).toMatchObject({ stateCommit: 1, historyPush: 1, persistenceSchedule: 1,
    syncEnqueue: 1, persistenceWrite: 1 });
  expect(await page.locator('canvas[aria-hidden="true"]').evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBe(0);

  expect(await page.evaluate(async () => (
    await import('/src/services/operationHistory.ts')
  ).useOperationHistory.getState().undo())).toBe(true);
  expect((await graphNodes(page)).map((node) => [node.id, node.parentId]))
    .toEqual(imported.map((node) => [node.id, node.parentId]));
  await page.evaluate(async (rootId) => (
    await import('/src/testing/workspaceStoreAccess.ts')
  ).useGraphStore.getState().deleteNode(rootId), imported[0].id);
  await expect.poll(async () => (await persistedNodes(page)).length).toBe(0);
  await page.reload();
  await page.getByTitle('知识大盘').click();
  await expect.poll(async () => (await graphNodes(page)).length).toBe(0);
  await expect(page.locator('[data-node-id]')).toHaveCount(0);
  console.log('GRAPH_DELETE_COUNTS', JSON.stringify({ before, afterStore: 0, afterPersisted: 0, afterReload: 0,
    deleteCounts, diagnosis }));
});

test('diagnoses stale concurrent remote edit during a subtree deletion', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (outline) => {
    const { parseGraphOutline } = await import('/src/graph/outlineImport.ts');
    const { useGraphStore, normalizeGraphNodes } = await import('/src/graph/store.ts');
    const { mergeWorkspaceFieldChangesDetailed } = await import('/src/services/workspaceSyncCore.ts');
    const { buildWorkspaceEntityWrites } = await import('/src/services/workspaceEntityStorage.ts');
    const base = useGraphStore.getState().addNodes(parseGraphOutline(outline));
    const chapter = base.find((node) => node.name === '第三章 函数极限')!;
    const remote = [
      ...base.map((node) => node.id === chapter.id ? { ...node, name: '第三章 函数极限（另一端编辑）' } : node),
      { id: 'remote-new-section', name: '远端新小节', parentId: chapter.id, createdAt: Date.now() },
    ];
    const merged = await mergeWorkspaceFieldChangesDetailed({ nodes: [] }, { nodes: base }, { nodes: remote });
    const entityWrites = buildWorkspaceEntityWrites({ nodes: remote }, merged.fields, 'delete-revision');
    const nodes = normalizeGraphNodes(merged.fields.nodes);
    return { base: base.length, local: 0, remote: remote.length, merged: nodes.length,
      roots: nodes.filter((node) => !node.parentId).length,
      names: nodes.map((node) => node.name), alternates: merged.alternates.length,
      syncedDeletionCount: Object.values(entityWrites).filter((entry) => entry.deletedAt).length };
  }, mathAnalysisOutline);
  console.log('GRAPH_DELETE_SYNC_BASELINE', JSON.stringify(result));
  expect(result).toMatchObject({ base: 100, local: 0, remote: 101, merged: 0, roots: 0, alternates: 2, syncedDeletionCount: 101 });
});

test('concurrent edits to the root and chapters cannot peel away only the leaves', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async (outline) => {
    const { parseGraphOutline } = await import('/src/graph/outlineImport.ts');
    const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const { mergeWorkspaceFieldChangesDetailed } = await import('/src/services/workspaceSyncCore.ts');
    const { buildWorkspaceEntityWrites } = await import('/src/services/workspaceEntityStorage.ts');
    const base = useGraphStore.getState().addNodes(parseGraphOutline(outline));
    const rootId = base[0].id;
    const remote = base.map((node) => !node.parentId || node.parentId === rootId
      ? { ...node, name: `${node.name}（另一端更新）` }
      : node);
    const merged = await mergeWorkspaceFieldChangesDetailed({ nodes: [] }, { nodes: base }, { nodes: remote });
    const entityWrites = buildWorkspaceEntityWrites({ nodes: remote }, merged.fields, 'delete-all');
    const remainingParents = remote.filter((node) => !node.parentId || node.parentId === rootId);
    const secondRemote = remainingParents.map((node) => node.id === rootId
      ? { ...node, name: `${node.name}（再次更新）` }
      : node);
    const secondMerged = await mergeWorkspaceFieldChangesDetailed(
      { nodes: [] }, { nodes: remainingParents }, { nodes: secondRemote });
    return { base: base.length, changedParents: remote.filter((node) => node.name.endsWith('（另一端更新）')).length,
      merged: (merged.fields.nodes as unknown[]).length, alternates: merged.alternates.length,
      syncedDeletionCount: Object.values(entityWrites).filter((entry) => entry.deletedAt).length,
      secondBaseline: remainingParents.length, secondMerged: (secondMerged.fields.nodes as unknown[]).length };
  }, mathAnalysisOutline);
  expect(result).toEqual({ base: 100, changedParents: 23, merged: 0, alternates: 23,
    syncedDeletionCount: 100, secondBaseline: 23, secondMerged: 0 });
});

test('deleting a chapter removes its five sections and preserves other chapters', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('知识大盘').click();
  const imported = await importMath(page);
  const chapter = imported.find((node) => node.name === '第三章 函数极限')!;
  const removedIds = new Set(imported.filter((node) => node.id === chapter.id || node.parentId === chapter.id).map((node) => node.id));
  expect(removedIds.size).toBe(6);
  await page.evaluate(async (id) => (
    await import('/src/testing/workspaceStoreAccess.ts')
  ).useGraphStore.getState().deleteNode(id), chapter.id);
  const remaining = await graphNodes(page);
  expect(remaining).toHaveLength(94);
  expect(remaining.every((node) => !removedIds.has(node.id))).toBe(true);
  expect(remaining.filter((node) => node.parentId === imported[0].id)).toHaveLength(21);
  await expect.poll(async () => (await persistedNodes(page)).length).toBe(94);
});

test('deleting a leaf removes only that section', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('知识大盘').click();
  const imported = await importMath(page);
  const leaf = imported.find((node) => node.name === '§1 函数极限概念')!;
  await page.evaluate(async (id) => (
    await import('/src/testing/workspaceStoreAccess.ts')
  ).useGraphStore.getState().deleteNode(id), leaf.id);
  const remaining = await graphNodes(page);
  expect(remaining).toHaveLength(99);
  expect(remaining.some((node) => node.id === leaf.id)).toBe(false);
  expect(remaining.filter((node) => node.parentId === leaf.parentId)).toHaveLength(4);
});

test('one delete traverses an arbitrary-depth chain even when store order is reversed', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const { parseGraphOutline } = await import('/src/graph/outlineImport.ts');
    const { inspectGraphNodes } = await import('/src/graph/integrity.ts');
    await useGraphStore.getState().hydrateStore();
    const store = useGraphStore.getState();
    const imported = store.addNodes(parseGraphOutline('# A\n## B\n### C\n#### D\n##### E'));
    useGraphStore.setState({ nodes: [...imported].reverse() });
    const before = inspectGraphNodes(useGraphStore.getState().nodes, imported[0].id);
    useGraphStore.getState().deleteNode(imported[0].id);
    return { before, remaining: useGraphStore.getState().nodes.length };
  });
  expect(result.before).toMatchObject({ totalNodes: 5, directChildren: 1, reachableNodes: 5,
    missingParentNodes: 0, unreachableNodes: 0 });
  expect(result.remaining).toBe(0);
  await expect.poll(async () => (await persistedNodes(page)).length).toBe(0);
});

test('deleting math leaves an unrelated knowledge tree intact', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('知识大盘').click();
  const imported = await importMath(page);
  const other = await page.evaluate(async () => {
    const graph = (await import('/src/testing/workspaceStoreAccess.ts')).useGraphStore.getState();
    const root = graph.addNode('其他学科');
    const child = graph.addNode('其他小节', root.id);
    return [root.id, child.id];
  });
  await page.evaluate(async (id) => (
    await import('/src/testing/workspaceStoreAccess.ts')
  ).useGraphStore.getState().deleteNode(id), imported[0].id);
  expect((await graphNodes(page)).map((node) => node.id)).toEqual(other);
  await expect.poll(async () => (await persistedNodes(page)).length).toBe(2);
});

test('one undo restores knowledge links, review rounds, and their daily schedule', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { useDailyScheduleStore, useGraphStore, useTimelineStore, useEbbStore } =
      await import('/src/testing/workspaceStoreAccess.ts');
    await Promise.all([useDailyScheduleStore.getState().hydrateStore(), useGraphStore.getState().hydrateStore(),
      useTimelineStore.getState().hydrateStore(), useEbbStore.getState().hydrateStore()]);
  });
  const result = await page.evaluate(async () => {
    const { useGraphStore, useTimelineStore, useEbbStore, useDailyScheduleStore } =
      await import('/src/testing/workspaceStoreAccess.ts');
    const { useOperationHistory } = await import('/src/services/operationHistory.ts');
    const node = useGraphStore.getState().addNode('绑定节点');
    useTimelineStore.setState({ tasks: [{ id: 'linked-task', name: '学习任务', start: '2026-09-26', end: '2026-09-26',
      blocks: [{ type: 'smart-task', id: 'linked-block', body: '', header: { title: '学习', tag: '', tagColor: '#123456',
        duration: 30, isCompleted: false, graphNodeId: node.id, graphNodeIds: [node.id] } }] }] });
    useEbbStore.setState({ reviewTasks: [{ id: 'linked-review', topicName: '复习', dueDate: '2026-09-26',
      isCompleted: false, graphNodeId: node.id }] });
    useDailyScheduleStore.setState({ schedules: { '2026-09-26': { date: '2026-09-26', blocks: [], items: [{
      id: 'scheduled-review', sourceId: 'review-linked-review', name: '复习', source: 'review', timeSlot: 'morning', order: 0,
    }] } } });
    useGraphStore.getState().deleteNode(node.id);
    const deleted = {
      nodes: useGraphStore.getState().nodes.length,
      linked: useTimelineStore.getState().tasks[0].blocks[0].type === 'smart-task'
        ? useTimelineStore.getState().tasks[0].blocks[0].header.graphNodeId : undefined,
      reviews: useEbbStore.getState().reviewTasks.length,
      scheduled: useDailyScheduleStore.getState().schedules['2026-09-26']?.items.length ?? 0,
    };
    const undone = await useOperationHistory.getState().undo();
    const block = useTimelineStore.getState().tasks[0].blocks[0];
    return { deleted, undone, restored: {
      nodes: useGraphStore.getState().nodes.length,
      linked: block.type === 'smart-task' ? block.header.graphNodeId : undefined,
      reviews: useEbbStore.getState().reviewTasks.length,
      scheduled: useDailyScheduleStore.getState().schedules['2026-09-26']?.items.length ?? 0,
      expectedId: node.id,
    } };
  });
  expect(result.deleted).toEqual({ nodes: 0, linked: undefined, reviews: 0, scheduled: 0 });
  expect(result.undone).toBe(true);
  expect(result.restored).toMatchObject({ nodes: 1, linked: result.restored.expectedId, reviews: 1, scheduled: 1 });
});

test('ten import/delete cycles leave no orphan or resurrected graph nodes', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('知识大盘').click();
  const cdp = await page.context().newCDPSession(page);
  const heapAfterDelete: number[] = [];
  for (let cycle = 0; cycle < 10; cycle += 1) {
    const imported = await importMath(page);
    expect((await graphNodes(page)).length).toBe(100);
    await page.evaluate(async (id) => (
      await import('/src/testing/workspaceStoreAccess.ts')
    ).useGraphStore.getState().deleteNode(id), imported[0].id);
    expect((await graphNodes(page)).length).toBe(0);
    await expect(page.locator('[data-node-id]')).toHaveCount(0);
    await cdp.send('HeapProfiler.collectGarbage');
    heapAfterDelete.push((await cdp.send('Runtime.getHeapUsage')).usedSize);
  }
  expect(heapAfterDelete.at(-1)! - heapAfterDelete[1]).toBeLessThan(2_000_000);
  await expect.poll(async () => (await persistedNodes(page)).length).toBe(0);
  await page.reload();
  await page.getByTitle('知识大盘').click();
  expect((await graphNodes(page)).length).toBe(0);
  console.log('GRAPH_DELETE_REPEAT_HEAP', JSON.stringify(heapAfterDelete));
});

test('diagnostics distinguish disconnected legacy orphans from a connected subtree', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { inspectGraphNodes } = await import('/src/graph/integrity.ts');
    const { normalizeGraphNodes } = await import('/src/graph/store.ts');
    const broken = [
      { id: 'math', name: '数学分析', parentId: null, createdAt: 1 },
      { id: 'chapter', name: '旧章节', parentId: 'missing-parent', createdAt: 2 },
      { id: 'section', name: '旧小节', parentId: 'chapter', createdAt: 3 },
    ];
    return { raw: inspectGraphNodes(broken, 'math'), hydrated: inspectGraphNodes(normalizeGraphNodes(broken), 'math') };
  });
  expect(result.raw).toMatchObject({ totalNodes: 3, missingParentNodes: 1, unreachableNodes: 2, reachableNodes: 1 });
  expect(result.hydrated).toMatchObject({ totalNodes: 3, rootNodes: 2, missingParentNodes: 0, reachableNodes: 1 });
});

import { expect, test, type Page } from '@playwright/test';

test.setTimeout(140_000);

const chapterNames = Array.from({ length: 22 }, (_, index) => `第${index + 1}章`);
const mathAnalysisOutline = [
  '# 数学分析',
  ...chapterNames.flatMap((chapter, chapterIndex) => [
    `## ${chapter}`,
    ...Array.from({ length: chapterIndex < 9 || (chapterIndex >= 13 && chapterIndex < 15) ? 4 : 3 }, (_, sectionIndex) =>
      `### §${sectionIndex + 1} 章节${chapterIndex + 1}小节${sectionIndex + 1}`),
  ]),
].join('\n');

const readGraphDiagnostics = (page: Page) => page.evaluate(async () => (
  await import('/src/graph/diagnostics.ts')
).getGraphDiagnostics());

const resetGraphDiagnostics = (page: Page) => page.evaluate(async () => (
  await import('/src/graph/diagnostics.ts')
).resetGraphDiagnostics());

const graphNodeCount = (page: Page) => page.evaluate(async () => (
  await import('/src/testing/workspaceStoreAccess.ts')
).useGraphStore.getState().nodes.length);

const readPersistedNodes = (page: Page) => page.evaluate(() => new Promise<Array<{ id: string }>>((resolve, reject) => {
  const request = indexedDB.open('smart-timeline');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const database = request.result;
    const transaction = database.transaction('graph_data', 'readonly');
    const getRequest = transaction.objectStore('graph_data').get('line-graph-storage');
    getRequest.onerror = () => reject(getRequest.error);
    getRequest.onsuccess = () => resolve((getRequest.result as { nodes?: Array<{ id: string }> } | undefined)?.nodes ?? []);
    transaction.oncomplete = () => database.close();
  };
}));

const importOutlineThroughUi = async (page: Page, outline: string) => {
  const input = page.getByPlaceholder('新建根节点 (支持 Markdown)');
  await input.fill(outline);
  await input.press('Enter');
};

const addFlatBatch = (page: Page, count: number) => page.evaluate(async (nodeCount) => {
  const [{ useGraphStore }, { parseGraphOutline }] = await Promise.all([
    import('/src/testing/workspaceStoreAccess.ts'),
    import('/src/graph/outlineImport.ts'),
  ]);
  const outline = ['# 压力测试', ...Array.from({ length: nodeCount - 1 }, (_, index) => `## 节点 ${index + 1}`)].join('\n');
  useGraphStore.getState().addNodes(parseGraphOutline(outline), `导入 ${nodeCount} 节点`);
}, count);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (sessionStorage.getItem('knowledge-graph-batch-seeded') === '1') return;
    localStorage.clear();
    sessionStorage.setItem('knowledge-graph-batch-seeded', '1');
    localStorage.setItem('smart-line-sync-architecture-v1', JSON.stringify({ architecture: 'unified' }));
  });
  await page.goto('/');
  await page.getByTitle('知识大盘').click();
  await expect(page.getByLabel('知识大盘视图')).toBeVisible();
  await page.getByTitle('打开节点控制台').click();
  await page.waitForTimeout(1_000);
});

test('imports the complete 1 + 22 + 77 math analysis outline as one durable undoable batch', async ({ page }) => {
  await resetGraphDiagnostics(page);
  await importOutlineThroughUi(page, mathAnalysisOutline);

  await expect.poll(() => graphNodeCount(page)).toBe(100);
  await expect(page.locator('[data-node-id]')).toHaveCount(100);
  await expect(page.locator('[data-node-id] > title')).toHaveCount(100);
  await expect(page.getByTestId('knowledge-graph-zoom-cache')).toHaveAttribute('data-zoom-cache-state', 'ready');
  await expect.poll(async () => (await readPersistedNodes(page)).length).toBe(100);

  const structure = await page.evaluate(async () => {
    const nodes = (await import('/src/testing/workspaceStoreAccess.ts')).useGraphStore.getState().nodes;
    const roots = nodes.filter((node) => node.parentId === null);
    const rootId = roots[0]?.id;
    const chapters = nodes.filter((node) => node.parentId === rootId);
    const chapterIds = new Set(chapters.map((node) => node.id));
    const firstThirteenIds = new Set(chapters.slice(0, 13).map((node) => node.id));
    return {
      roots: roots.length,
      chapters: chapters.length,
      sections: nodes.filter((node) => node.parentId && chapterIds.has(node.parentId)).length,
      firstThirteenCount: 1 + firstThirteenIds.size + nodes.filter((node) => node.parentId && firstThirteenIds.has(node.parentId)).length,
      uniqueIds: new Set(nodes.map((node) => node.id)).size,
      ids: nodes.map((node) => node.id),
    };
  });
  expect(structure).toMatchObject({ roots: 1, chapters: 22, sections: 77, firstThirteenCount: 62, uniqueIds: 100 });
  expect(structure.ids).toHaveLength(100);

  const diagnostics = await readGraphDiagnostics(page);
  expect(diagnostics.counters).toMatchObject({
    sourceItems: 100,
    generatedNodes: 100,
    uniqueNodeIds: 100,
    duplicateIds: 0,
    committedStoreNodes: 100,
    layoutInputNodes: 100,
    layoutOutputNodes: 100,
    renderedNodes: 100,
    persistedNodes: 100,
    stateCommit: 1,
    historyPush: 1,
    syncEnqueue: 1,
    persistenceWrite: 1,
    cacheRebuild: 1,
  });
  expect(diagnostics.counters.layout).toBeLessThanOrEqual(2);
  expect(diagnostics.details.duplicateIdValues).toEqual([]);

  await page.getByLabel('搜索知识').click();
  await page.getByRole('search', { name: '搜索知识节点' }).getByPlaceholder('输入节点标题').fill('章节22小节3');
  await expect(page.locator('[data-node-id]')).toHaveCount(100);
  await page.keyboard.press('Escape');

  await page.getByLabel('知识状态筛选').click();
  await page.getByRole('dialog', { name: '知识状态筛选菜单' }).getByRole('button', { name: /未激活/ }).click();
  await expect(page.locator('[data-node-id]')).toHaveCount(100);

  const lastNode = page.locator('[data-node-id]').last();
  await lastNode.click();
  await expect(lastNode).toHaveAttribute('aria-label', /章节22小节3/);
  const svg = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  const box = await svg.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -120);
  await expect(page.locator('[data-node-id]')).toHaveCount(100);

  await page.getByTitle('项目规划').click();
  await page.getByTitle('知识大盘').click();
  await expect(page.locator('[data-node-id]')).toHaveCount(100);

  const undone = await page.evaluate(async () => (
    await import('/src/services/operationHistory.ts')
  ).useOperationHistory.getState().undo());
  expect(undone).toBe(true);
  await expect.poll(() => graphNodeCount(page)).toBe(0);

  await page.getByTitle('打开节点控制台').click();
  await importOutlineThroughUi(page, mathAnalysisOutline);
  await expect.poll(async () => (await readPersistedNodes(page)).length).toBe(100);
  const idsBeforeReload = await page.evaluate(async () => (
    await import('/src/testing/workspaceStoreAccess.ts')
  ).useGraphStore.getState().nodes.map((node) => node.id));
  await page.reload();
  await page.getByTitle('知识大盘').click();
  await expect(page.locator('[data-node-id]')).toHaveCount(100);
  const idsAfterReload = await page.evaluate(async () => (
    await import('/src/testing/workspaceStoreAccess.ts')
  ).useGraphStore.getState().nodes.map((node) => node.id));
  expect(idsAfterReload).toEqual(idsBeforeReload);
  await expect.poll(async () => (await readGraphDiagnostics(page)).counters.reloadedNodes).toBe(100);
  const reloaded = await page.evaluate(async () => {
    const nodes = (await import('/src/testing/workspaceStoreAccess.ts')).useGraphStore.getState().nodes;
    const rootId = nodes.find((node) => node.parentId === null)?.id;
    const chapters = nodes.filter((node) => node.parentId === rootId);
    const chapterIds = new Set(chapters.map((node) => node.id));
    return { roots: nodes.filter((node) => node.parentId === null).length, chapters: chapters.length,
      sections: nodes.filter((node) => node.parentId && chapterIds.has(node.parentId)).length };
  });
  expect(reloaded).toEqual({ roots: 1, chapters: 22, sections: 77 });
});

for (const count of [100, 500, 1_000, 2_000]) {
  test(`keeps all ${count} batch nodes interactive with one store and sync commit`, async ({ page }) => {
    await resetGraphDiagnostics(page);
    const startedAt = Date.now();
    await addFlatBatch(page, count);
    await expect.poll(() => graphNodeCount(page)).toBe(count);
    await expect(page.locator('[data-node-id]')).toHaveCount(count);
    await expect(page.getByTestId('knowledge-graph-zoom-cache')).toHaveAttribute('data-zoom-cache-state', 'ready');
    await page.getByLabel('搜索知识').click();
    await expect(page.getByRole('search', { name: '搜索知识节点' }).getByPlaceholder('输入节点标题')).toBeFocused();
    await page.keyboard.press('Escape');
    const diagnostics = await readGraphDiagnostics(page);
    expect(diagnostics.counters).toMatchObject({
      generatedNodes: count,
      uniqueNodeIds: count,
      committedStoreNodes: count,
      layoutInputNodes: count,
      layoutOutputNodes: count,
      renderedNodes: count,
      stateCommit: 1,
      historyPush: 1,
      syncEnqueue: 1,
      cacheRebuild: 1,
    });
    console.log('KNOWLEDGE_GRAPH_SCALE', JSON.stringify({ count, elapsedMs: Date.now() - startedAt, diagnostics }));
  });
}

test('repeated import and undo releases graph objects instead of accumulating generations', async ({ page }) => {
  const cdp = await page.context().newCDPSession(page);
  const sample = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const [heap, dom] = await Promise.all([
      cdp.send('Runtime.getHeapUsage'),
      cdp.send('Memory.getDOMCounters'),
    ]);
    return { usedHeap: heap.usedSize, domNodes: dom.nodes, listeners: dom.jsEventListeners };
  };

  const before = await sample();
  const cycleHeaps: number[] = [];
  for (let iteration = 0; iteration < 10; iteration += 1) {
    await addFlatBatch(page, 100);
    await expect.poll(() => graphNodeCount(page)).toBe(100);
    const undone = await page.evaluate(async () => (
      await import('/src/services/operationHistory.ts')
    ).useOperationHistory.getState().undo());
    expect(undone).toBe(true);
    await expect.poll(() => graphNodeCount(page)).toBe(0);
    cycleHeaps.push((await sample()).usedHeap);
  }

  await addFlatBatch(page, 100);
  await expect(page.locator('[data-node-id]')).toHaveCount(100);
  const importedImmediately = await sample();
  await page.waitForTimeout(30_000);
  const importedAfter30Seconds = await sample();
  const finalUndo = await page.evaluate(async () => {
    const { useOperationHistory } = await import('/src/services/operationHistory.ts');
    const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const before = { entries: useOperationHistory.getState().entries, nodes: useGraphStore.getState().nodes.length };
    const undone = await useOperationHistory.getState().undo();
    return { before, undone, after: { entries: useOperationHistory.getState().entries, nodes: useGraphStore.getState().nodes.length } };
  });
  console.log('KNOWLEDGE_GRAPH_FINAL_UNDO', JSON.stringify(finalUndo));
  expect(finalUndo.undone).toBe(true);
  expect(finalUndo.after.nodes).toBe(0);
  await expect.poll(() => graphNodeCount(page)).toBe(0);
  await page.waitForTimeout(30_000);
  const deletedAfter30Seconds = await sample();
  const diagnostics = await readGraphDiagnostics(page);

  expect(deletedAfter30Seconds.domNodes).toBeLessThan(importedAfter30Seconds.domNodes);
  expect(diagnostics.counters.cacheCommandCount ?? 0).toBe(0);
  expect(cycleHeaps.at(-1)! - cycleHeaps[1]).toBeLessThan(1_000_000);
  console.log('KNOWLEDGE_GRAPH_MEMORY', JSON.stringify({
    before,
    cycleHeaps,
    importedImmediately,
    importedAfter30Seconds,
    deletedAfter30Seconds,
    diagnostics,
  }));
});

test('normalization preserves colliding legacy nodes by assigning a fresh id', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { normalizeGraphNodes } = await import('/src/graph/store.ts');
    const nodes = normalizeGraphNodes([
      { id: 'legacy-collision', name: '第一章 §1', parentId: null, createdAt: 1 },
      { id: 'legacy-collision', name: '第二章 §1', parentId: null, createdAt: 2 },
    ]);
    return { count: nodes.length, ids: nodes.map((node) => node.id), names: nodes.map((node) => node.name) };
  });
  expect(result.count).toBe(2);
  expect(new Set(result.ids).size).toBe(2);
  expect(result.names).toEqual(['第一章 §1', '第二章 §1']);
});

test('batch under an existing node restores its status with one undo', async ({ page }) => {
  const before = await page.evaluate(async () => {
    const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const root = useGraphStore.getState().addNode('已有知识');
    useGraphStore.getState().updateNode(root.id, { status: 'activated' });
    return root.id;
  });
  await page.evaluate(async (parentId) => {
    const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const { parseGraphOutline } = await import('/src/graph/outlineImport.ts');
    useGraphStore.getState().addNodes(parseGraphOutline('## 第一章\n### §1\n## 第二章\n### §1', parentId));
  }, before);
  await expect.poll(() => graphNodeCount(page)).toBe(5);
  const statusDuringImport = await page.evaluate(async (id) => (
    await import('/src/testing/workspaceStoreAccess.ts')
  ).useGraphStore.getState().nodes.find((node) => node.id === id)?.status, before);
  expect(statusDuringImport).toBeUndefined();

  expect(await page.evaluate(async () => (
    await import('/src/services/operationHistory.ts')
  ).useOperationHistory.getState().undo())).toBe(true);
  const after = await page.evaluate(async (id) => (
    await import('/src/testing/workspaceStoreAccess.ts')
  ).useGraphStore.getState().nodes.filter((node) => node.id === id), before);
  expect(after).toHaveLength(1);
  expect(after[0].status).toBe('activated');
  await expect.poll(() => graphNodeCount(page)).toBe(1);
});

test('invalid parent references reject the whole batch without a partial commit', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const before = useGraphStore.getState().nodes.length;
    let error = '';
    try {
      useGraphStore.getState().addNodes([{ name: '根' }, { name: '坏节点', parentIndex: 9 }]);
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }
    return { before, after: useGraphStore.getState().nodes.length, error };
  });
  expect(result.after).toBe(result.before);
  expect(result.error).toContain('父节点索引无效');
});

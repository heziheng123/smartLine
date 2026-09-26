import { expect, test } from '@playwright/test';

test('restoring an archived descendant keeps its ancestor path visible after reload', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('知识大盘').click();
  const [root, chapter, leaf, sibling] = await page.evaluate(async () => {
    const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const store = useGraphStore.getState();
    return store.addNodes([
      { name: '归档测试根节点' },
      { name: '归档测试章节', parentIndex: 0 },
      { name: '归档测试叶子', parentIndex: 1 },
      { name: '归档测试同级', parentIndex: 1 },
    ]);
  });
  await expect(page.locator('[data-node-id]')).toHaveCount(4);
  await page.evaluate(async (id) => (
    await import('/src/testing/workspaceStoreAccess.ts')
  ).useGraphStore.getState().archiveNodeCascade(id, true), root.id);
  await expect(page.locator('[data-node-id]')).toHaveCount(0);

  // Archive search exposes descendants, so restoring one must make its full path reachable.
  await page.getByRole('button', { name: '打开归档库' }).click();
  await page.getByLabel('搜索归档知识节点').fill(leaf.name);
  await page.getByRole('button', { name: new RegExp(leaf.name) }).click();
  await page.getByRole('button', { name: '解冻恢复' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '继续' }).click();
  await page.getByLabel('关闭归档库').click();
  await expect(page.locator('[data-node-id]')).toHaveCount(3);
  const visibleIds = await page.locator('[data-node-id]').evaluateAll((elements) =>
    elements.map((element) => element.getAttribute('data-node-id')));
  expect(visibleIds).toEqual(expect.arrayContaining([root.id, chapter.id, leaf.id]));
  expect(visibleIds).not.toContain(sibling.id);

  await expect.poll(async () => page.evaluate(async () => {
    const { createScopedStorage } = await import('/src/utils/persistence.ts');
    const data = await createScopedStorage('graph_data').getItem<{ nodes: Array<{ id: string; isArchived?: boolean }> }>('line-graph-storage');
    return data?.nodes.filter((node) => !node.isArchived).length;
  })).toBe(3);

  await page.reload();
  await page.getByTitle('知识大盘').click();
  await expect(page.locator('[data-node-id]')).toHaveCount(3);
});

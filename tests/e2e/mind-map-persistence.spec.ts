import { expect, test } from '@playwright/test';

const openMindMap = async (page: import('@playwright/test').Page) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
  await page.getByTitle('思维导图').click();
  await expect(page.getByTestId('mind-map-workspace')).toBeVisible();
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');
};

test('documents are saved in the dedicated mind map database and restored after reload', async ({ page }) => {
  await openMindMap(page);
  await page.getByTestId('mind-map-title').fill('产品架构图');
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');

  const databases = await page.evaluate(async () => {
    if (!indexedDB.databases) return [];
    return (await indexedDB.databases()).map((database) => database.name);
  });
  expect(databases).toContain('smart-line-mind-map');

  await page.reload();
  await page.getByTitle('思维导图').click();
  await expect(page.getByTestId('mind-map-title')).toHaveValue('产品架构图');
});

test('multiple documents remain independent and can be switched', async ({ page }) => {
  await openMindMap(page);
  await page.getByTestId('mind-map-title').fill('第一张图');
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');

  await page.getByTestId('mind-map-new-document').click();
  await expect(page.getByTestId('mind-map-title')).toHaveValue('未命名思维导图');
  await page.getByTestId('mind-map-title').fill('第二张图');
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');

  await page.getByTestId('mind-map-catalog-toggle').click();
  const catalog = page.getByTestId('mind-map-catalog');
  await expect(catalog.getByTestId('mind-map-catalog-item')).toHaveCount(2);
  await catalog.getByText('第一张图').click();
  await expect(page.getByTestId('mind-map-title')).toHaveValue('第一张图');
});

test('a pending edit is recovered from the emergency journal after pagehide', async ({ page }) => {
  await openMindMap(page);
  const journalWritten = await page.evaluate(async () => {
    const { useMindMapStore } = await import('/src/mindMap/testing.ts');
    const state = useMindMapStore.getState();
    state.renameDocument('异常关闭恢复图');
    window.dispatchEvent(new PageTransitionEvent('pagehide'));
    const id = useMindMapStore.getState().document!.id;
    return Boolean(localStorage.getItem(`mind-map:emergency:${id}`));
  });
  expect(journalWritten).toBe(true);

  await page.reload();
  await page.getByTitle('思维导图').click();
  await expect(page.getByTestId('mind-map-title')).toHaveValue('异常关闭恢复图');
});

test('a failed IndexedDB save keeps the edit in memory and the emergency journal', async ({ page }) => {
  await openMindMap(page);
  const result = await page.evaluate(async () => {
    const { mindMapRepository } = await import('/src/mindMap/repository.ts');
    const { useMindMapStore } = await import('/src/mindMap/testing.ts');
    const original = mindMapRepository.schedule;
    mindMapRepository.schedule = ((_document, _index, callbacks) => {
      callbacks.onError?.(new Error('forced IndexedDB failure'));
    }) as typeof mindMapRepository.schedule;
    try {
      useMindMapStore.getState().renameDocument('保存失败仍保留');
      useMindMapStore.getState().saveEmergency();
      const state = useMindMapStore.getState();
      return {
        title: state.document?.title,
        status: state.saveStatus,
        journal: state.document
          ? localStorage.getItem(`mind-map:emergency:${state.document.id}`)
          : null,
      };
    } finally {
      mindMapRepository.schedule = original;
    }
  });
  expect(result.title).toBe('保存失败仍保留');
  expect(result.status).toBe('error');
  expect(result.journal).toContain('保存失败仍保留');
});

test('deleting a document keeps the remaining document intact', async ({ page }) => {
  await openMindMap(page);
  await page.getByTestId('mind-map-title').fill('保留图');
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');
  await page.getByTestId('mind-map-new-document').click();
  await page.getByTestId('mind-map-title').fill('待删除图');
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('更多操作', { exact: true }).click();
  await page.getByRole('menuitem', { name: '删除当前导图' }).click();
  await page.getByTestId('mind-map-catalog-toggle').click();
  await expect(page.getByTestId('mind-map-catalog').getByTestId('mind-map-catalog-item')).toHaveCount(1);
  await expect(page.getByTestId('mind-map-title')).toHaveValue('保留图');
});

test('a future schema is reported and remains untouched in the dedicated database', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createDedicatedStorage } = await import('/src/utils/persistence.ts');
    const storage = createDedicatedStorage('smart-line-mind-map', 'mind_map');
    await storage.setItem('mind-map:index', {
      schemaVersion: 999,
      activeDocumentId: 'future',
      documents: [],
    });
  });
  await page.getByTitle('思维导图').click();
  await expect(page.getByRole('alert')).toContainText('版本过高');
  const storedVersion = await page.evaluate(async () => {
    const { createDedicatedStorage } = await import('/src/utils/persistence.ts');
    const storage = createDedicatedStorage('smart-line-mind-map', 'mind_map');
    return (await storage.getItem<{ schemaVersion: number }>('mind-map:index'))?.schemaVersion;
  });
  expect(storedVersion).toBe(999);
});

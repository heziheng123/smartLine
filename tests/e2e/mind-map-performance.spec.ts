import { expect, test } from '@playwright/test';

for (const count of [500, 2_000, 5_000]) {
  test(`${count} nodes open save zoom and locate in the real workspace`, async ({ page }) => {
    test.setTimeout(count === 5_000 ? 60_000 : 30_000);
    await page.goto('/');
  await page.getByTitle('地图工作区').click();
    await expect(page.getByTestId('mind-map-canvas')).toBeVisible();

    const result = await page.evaluate(async (nodeCount) => {
      const { createMindMapBenchmarkDocument } = await import('/src/mindMap/benchmark.ts');
      const { useMindMapStore } = await import('/src/mindMap/testing.ts');
      const startedAt = performance.now();
      const imported = await useMindMapStore.getState().importDocument(createMindMapBenchmarkDocument(nodeCount));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      await useMindMapStore.getState().flushSave();
      return {
        elapsed: performance.now() - startedAt,
        imported,
        nodes: Object.keys(useMindMapStore.getState().document?.nodes ?? {}).length,
      };
    }, count);

    expect(result.imported).toBe(true);
    expect(result.nodes).toBe(count);
    expect(result.elapsed).toBeLessThan(count === 5_000 ? 15_000 : 10_000);
    await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');

    if (count === 5_000) {
      await expect(page.getByTestId('mind-map-canvas')).toHaveAttribute('data-renderer', 'webgl');
      await page.getByTestId('mind-map-layout-menu').click();
      const layoutWorker = page.waitForEvent('worker');
      await page.getByTestId('mind-map-layout-tree').click();
      expect((await layoutWorker).url()).toContain('layout.worker');
      await expect(page.getByTestId('mind-map-layout-menu')).toHaveText('布局中…');
      await expect(page.getByTestId('mind-map-layout-menu')).toHaveText('布局', { timeout: 20_000 });
      await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');
    }

    await page.getByRole('button', { name: '搜索或命令' }).click();
    await page.getByLabel('搜索思维导图').fill(`节点 ${count - 1}`);
    await page.getByRole('option', { name: new RegExp(`节点.*节点 ${count - 1}`) }).click();
    await expect(page.getByLabel('节点属性')).toBeVisible();

    const canvas = page.getByTestId('mind-map-canvas');
    if (count === 5_000) {
      const beforePreview = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
      await canvas.evaluate((element) => (element.parentElement as HTMLElement).focus());
      await page.keyboard.press('Tab');
      await expect(page.getByLabel('新节点文本')).toBeVisible();
      await expect(canvas).toHaveAttribute('data-renderer', 'webgl');
      await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(beforePreview);
      await page.getByLabel('新节点文本').press('Escape');
    }
    const box = await canvas.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.wheel(0, -300);
    await expect(page.locator('footer').getByText(/%/)).not.toHaveText('100%');
  });
}

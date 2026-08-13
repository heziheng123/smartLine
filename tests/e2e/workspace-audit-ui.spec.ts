import { expect, test } from '@playwright/test';

test('workspace audit report can be downloaded from backup settings', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tl-dock')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const stores = await import('/src/testing/workspaceStoreAccess.ts');
    return [
      stores.useTimelineStore,
      stores.useEbbStore,
      stores.useDailyScheduleStore,
      stores.useGraphStore,
      stores.useLifeMapStore,
    ].every((store) => store.getState().isHydrated);
  })).toBe(true);

  await page.getByTitle('更多操作').click();
  await page.getByRole('menuitem', { name: '同步与备份' }).click();
  const dialog = page.getByRole('dialog', { name: '云同步与完整备份' });
  await dialog.getByText('数据、备份与恢复').click();

  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: '导出盘点报告' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toMatch(/^smart-line-audit-.+\.json$/);
  await expect(dialog).toContainText(/数据盘点报告已导出/);
});

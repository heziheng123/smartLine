import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
});

test('the mind map opens as an isolated lazy workspace', async ({ page }) => {
  await page.getByTitle('思维导图').click();
  await expect(page.getByTitle('思维导图')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#view-mind-map')).toBeVisible();
  await expect(page.getByTestId('mind-map-workspace')).toBeVisible();
  await expect(page.getByRole('heading', { name: '思维导图' })).toBeVisible();
});

test('all existing workspaces remain reachable after visiting the mind map', async ({ page }) => {
  await page.getByTitle('思维导图').click();
  await expect(page.getByTestId('mind-map-workspace')).toBeVisible();

  for (const title of ['人生地图', '每日安排', '周矩阵', '艾宾浩斯复习', '知识大盘', '项目规划']) {
    await page.getByTitle(title).click();
    await expect(page.getByTitle(title)).toHaveAttribute('aria-selected', 'true');
  }
});

test('phone layout gives the mind map its own full workspace', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await page.getByTitle('思维导图').click();

  await expect(page.getByTestId('mind-map-workspace')).toBeVisible();
  await expect(page.locator('.phone-workspace')).toHaveCount(0);
});

import { expect, test } from '@playwright/test';

test('restored timeline can scroll through many projects and open the last project', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.tl-year-card')).toBeVisible();
  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const year = new Date().getFullYear();
    useTimelineStore.setState({ groups: [], notes: [], milestones: [], tasks: Array.from({ length: 40 }, (_, index) => ({
      id: `restored-project-${index}`, name: `滚动回归项目${index + 1}`, start: `${year}-08-01`, end: `${year}-08-31`, blocks: [],
    })) });
  });
  await expect(page.locator('.tl-seg')).toHaveCount(40);
  await expect(page.locator('.pl-workspace, .pl-overview, .pl-project-detail')).toHaveCount(0);
  const scroller = page.locator('.project-workspace-content > .tl-app-main');
  const geometry = await scroller.evaluate((element) => ({ height: element.clientHeight, contentHeight: element.scrollHeight }));
  expect(geometry.contentHeight).toBeGreaterThan(geometry.height);
  await scroller.evaluate((element) => { element.scrollTop = 0; });
  await scroller.hover();
  await page.mouse.wheel(0, 1000);
  await expect.poll(() => scroller.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
  const last = page.locator('.tl-seg').filter({ hasText: '滚动回归项目40' });
  await last.scrollIntoViewIfNeeded();
  const bar = await last.boundingBox();
  const viewport = await scroller.boundingBox();
  expect(bar!.y).toBeGreaterThanOrEqual(viewport!.y);
  expect(bar!.y + bar!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height);
  await last.click();
  await expect(page.locator('.tl-project-workspace-drawer')).toBeVisible();
  await expect(page.locator('.tl-project-workspace-drawer')).toContainText('滚动回归项目40');
  await page.getByLabel('关闭项目文档').click();
  await expect(page.locator('.tl-project-workspace-drawer')).toHaveCount(0);
});

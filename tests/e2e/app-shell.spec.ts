import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
});

test('six main views remain reachable through the real interface', async ({ page }) => {
  for (const title of ['任务总览', '每日安排', '周矩阵', '艾宾浩斯复习', '知识大盘', '项目规划']) {
    await page.getByTitle(title).click();
    await expect(page.getByTitle(title)).toHaveAttribute('aria-selected', 'true');
  }
});

test('task overview remains usable on desktop and small screens', async ({ page }) => {
  await page.getByTitle('任务总览').click();
  await expect(page.getByRole('heading', { name: '任务总览' })).toBeVisible();
  await expect(page.getByLabel('搜索全部项目任务')).toBeVisible();
  await expect(page.getByRole('group', { name: '任务分组方式' })).toBeVisible();
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
});

test('global search is removed while archive search remains available', async ({ page }) => {
  await expect(page.getByTitle(/全局搜索/)).toHaveCount(0);
  await page.getByTitle('知识大盘').click();
  await page.getByTitle(/归档库/).click();
  const archiveSearch = page.getByLabel('搜索归档知识节点');
  await expect(archiveSearch).toBeVisible();
  await archiveSearch.fill('不存在的归档节点');
  await expect(page.getByText('没有找到匹配的归档节点')).toBeVisible();
  await page.getByLabel('关闭归档库').click();
  await expect(archiveSearch).toBeHidden();
});

test('daily schedule keeps its controls clickable', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  await expect(page.getByRole('heading', { name: '每日安排' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '时段' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '时间块' })).toBeVisible();
  await page.getByRole('tab', { name: '时间块' }).click();
  await expect(page.getByRole('tab', { name: '时间块' })).toHaveAttribute('aria-selected', 'true');
});

test('operation history opens, closes and does not block navigation', async ({ page }) => {
  await page.getByTitle('最近操作与回收站').click();
  await expect(page.getByLabel('最近操作面板')).toBeVisible();
  await expect(page.getByText('回收站', { exact: true })).toBeVisible();
  await page.getByLabel('关闭最近操作').click();
  await expect(page.getByLabel('最近操作面板')).toBeHidden();
});

test('small screens can scroll the EBB content without the fixed toolbar swallowing the page', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  const result = await page.evaluate(() => {
    const root = document.scrollingElement;
    if (!root) return false;
    const before = root.scrollTop;
    root.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
    return root.scrollHeight <= root.clientHeight || root.scrollTop > before;
  });
  expect(result).toBeTruthy();
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
});

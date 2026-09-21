import { expect, test } from '@playwright/test';

test('timeline visibility controls respond and the header remains draggable', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await page.getByTitle('地图工作区').click();
  await page.getByRole('button', { name: '时间规划', exact: true }).click();

  const timeline = page.locator('[data-testid^="mind-map-timeline-"]').first();
  await timeline.click();
  const scale = page.getByLabel('时间线尺度');
  await scale.selectOption('week');
  await expect(scale).toHaveValue('week');
  const range = await Promise.all([
    page.getByLabel('时间线开始日期').inputValue(),
    page.getByLabel('时间线结束日期').inputValue(),
  ]);
  expect((Date.parse(`${range[1]}T00:00:00Z`) - Date.parse(`${range[0]}T00:00:00Z`)) / 86_400_000).toBe(6);
  const stages = page.getByRole('button', { name: '显示阶段' });
  await expect(stages).toHaveAttribute('aria-pressed', 'true');
  await stages.click();
  await expect(stages).toHaveAttribute('aria-pressed', 'false');

  await page.getByRole('button', { name: /更改/ }).click();
  await page.getByRole('button', { name: '展开产品研发' }).click();
  const group = page.getByRole('checkbox', { name: '整个分组 产品研发' });
  await page.getByText('产品研发', { exact: true }).click();
  await expect(group).toBeChecked();
  await expect(page.getByText('已选择 2 个项目')).toBeVisible();
  const firstProject = page.getByRole('checkbox', { name: /产品规划/ }).first();
  await firstProject.uncheck();
  await expect(firstProject).not.toBeChecked();
  await expect(group).toHaveJSProperty('indeterminate', true);
  await expect(page.getByText('已选择 1 个项目')).toBeVisible();
  await page.getByRole('button', { name: '完成' }).click();

  const handle = page.locator('[data-testid^="mind-map-timeline-drag-handle-"]').first();
  const before = await handle.boundingBox();
  if (!before) throw new Error('Timeline drag handle was not rendered.');
  await page.mouse.move(before.x + 80, before.y + before.height / 2);
  await page.mouse.down();
  await page.mouse.move(before.x + 160, before.y + before.height / 2 + 60, { steps: 5 });
  await page.mouse.up();

  await expect.poll(async () => (await handle.boundingBox())?.x).toBeGreaterThan(before.x + 40);
  await expect.poll(async () => (await handle.boundingBox())?.y).toBeGreaterThan(before.y + 30);
});

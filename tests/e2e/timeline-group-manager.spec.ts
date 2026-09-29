import { expect, test } from '@playwright/test';

test('an empty hidden group can be edited from the group manager', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('项目规划').click();
  await expect(page.locator('.tl-year-stack')).toBeVisible();

  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const year = new Date().getFullYear();
    useTimelineStore.getState().addGroup({
      id: 'manager-empty-group',
      name: '待规划分组',
      start: `${year}-01-01`,
      end: `${year}-01-31`,
      color: '#60A5FA',
      autoDate: false,
      children: [],
    });
  });
  await expect(page.locator('.tl-group-label').filter({ hasText: '待规划分组' })).toHaveCount(0);

  await page.getByTitle('更多').click();
  await page.getByRole('menuitem', { name: '管理项目分组' }).click();
  const manager = page.getByRole('dialog', { name: '管理项目分组' });
  const row = manager.locator('.tl-project-item').filter({ hasText: '待规划分组' });
  await expect(row).toBeVisible();
  await row.getByTitle('隐藏项目').click();
  await row.getByRole('button', { name: '编辑分组：待规划分组' }).click();

  await expect(manager).toHaveCount(0);
  const editor = page.getByRole('dialog', { name: '编辑分组' });
  await editor.getByLabel('分组名称').fill('已更新分组');
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(editor).toHaveCount(0);

  await page.getByTitle('更多').click();
  await page.getByRole('menuitem', { name: '管理项目分组' }).click();
  const updatedRow = page.getByRole('dialog', { name: '管理项目分组' })
    .locator('.tl-project-item').filter({ hasText: '已更新分组' });
  await expect(updatedRow).toBeVisible();
  await expect(updatedRow.getByTitle('显示项目')).toBeVisible();
  await updatedRow.getByRole('button', { name: '编辑分组：已更新分组' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: '编辑分组' })).toBeVisible();
  await page.getByRole('dialog', { name: '编辑分组' }).getByRole('button', { name: '取消' }).click();

  await page.getByTitle('搜索与显示').click();
  await page.getByRole('button', { name: '管理项目分组' }).click();
  const settingsManager = page.getByRole('dialog', { name: '管理项目分组' });
  await expect(settingsManager).toBeVisible();
  await settingsManager.getByTitle('关闭').click();
});

test('the timeline label still opens group editing on double click', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('项目规划').click();
  const label = page.locator('.tl-group-label').filter({ hasText: '产品研发' }).first();
  await expect(label).toBeVisible();
  await label.dblclick();
  await expect(page.getByRole('dialog', { name: '编辑分组' })).toBeVisible();
});

test('phone full view exposes the group manager', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTitle('项目规划').click();
  await page.getByLabel('打开完整视图').click();
  await expect(page.locator('.tl-year-stack')).toBeVisible();

  await page.getByTitle('更多').click();
  await page.getByRole('menuitem', { name: '管理项目分组' }).click();
  const manager = page.getByRole('dialog', { name: '管理项目分组' });
  const editButton = manager.getByRole('button', { name: '编辑分组：产品研发' });
  await expect(editButton).toBeVisible();
  expect((await editButton.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  await editButton.click();
  await expect(page.getByRole('dialog', { name: '编辑分组' })).toBeVisible();
});

test('large group editor keeps later tasks selectable', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const year = new Date().getFullYear();
    useTimelineStore.setState({
      tasks: Array.from({ length: 120 }, (_, index) => ({
        id: `group-picker-task-${index}`,
        name: `待选项目${index}`,
        start: `${year}-01-01`,
        end: `${year}-01-01`,
        blocks: [],
      })),
      groups: [],
    });
  });
  await page.getByTitle('更多').click();
  await page.getByRole('menuitem', { name: '新建项目分组' }).click();
  const editor = page.getByRole('dialog', { name: '新建分组' });
  await expect.poll(() => editor.locator('.tl-dialog-task-item').count()).toBeLessThan(30);
  await editor.locator('.tl-dialog-task-list').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await editor.getByText('待选项目119', { exact: true }).click();
  await expect(editor.getByText('选择任务（1 个已选）')).toBeVisible();
});

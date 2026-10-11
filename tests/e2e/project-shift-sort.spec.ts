import { expect, test } from '@playwright/test';

test('project shift sorts by planned date while search and sort preserve selection', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    const blocks = [
      ['late', 'Late', '2026-10-20'],
      ['early-a', 'Early A', '2026-10-13'],
      ['middle', 'Middle', '2026-10-15'],
      ['early-b', 'Early B', '2026-10-13'],
    ].map(([id, title, date]) => ({
      type: 'smart-task', id, body: '',
      header: { title, tag: 'Default', tagColor: '#6366f1', date, deadline: id === 'early-a' ? date : undefined, duration: 30, isCompleted: false, autoSyncEbb: false },
    }));
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({
      tasks: [{ id: 'sort-project', name: 'Sort Project', start: '2026-10-11', end: '2026-10-21', color: '#6366f1', blocks }],
      groups: [], notes: [], milestones: [],
    }));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify({}));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify({ reviewTasks: [], inboxItems: [], outlineNodes: [], ebbSettings: {} }));
  });
  await page.goto('/');
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: 'Sort Project' }).first().click();
  await page.getByTitle('更多操作').click();
  await page.getByRole('button', { name: '批量调整排期' }).click();

  const dialog = page.getByRole('dialog', { name: '批量调整排期' });
  const titles = dialog.locator('.psd-task-list label strong');
  const sort = dialog.getByRole('combobox', { name: '任务排序' });
  await expect(sort).toHaveValue('date-asc');
  await expect(titles).toHaveText(['Early A', 'Early B', 'Middle', 'Late']);
  expect(await dialog.locator('.psd-task-list').evaluate((list) => list.scrollWidth <= list.clientWidth)).toBe(true);
  expect(await dialog.locator('.psd-footer > span').evaluate((note) => {
    const bounds = note.getBoundingClientRect();
    const top = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
    return top === note || note.contains(top);
  })).toBe(true);

  await sort.selectOption('date-desc');
  await expect(titles).toHaveText(['Late', 'Middle', 'Early A', 'Early B']);
  await sort.selectOption('original');
  await expect(titles).toHaveText(['Late', 'Early A', 'Middle', 'Early B']);

  const search = dialog.getByRole('searchbox', { name: '查找任务' });
  await search.fill('Early');
  await expect(titles).toHaveText(['Early A', 'Early B']);
  await expect(dialog.locator('.psd-task-controls')).toContainText('匹配 2 项');
  await expect(dialog.getByRole('button', { name: '取消全选全部' })).toBeVisible();
  await dialog.locator('.psd-task-list label').filter({ hasText: 'Early A' }).locator('input').uncheck();
  await expect(dialog.locator('.psd-task-list label').filter({ hasText: 'Early A' })).toContainText('2026-10-13（不调整）');
  await expect(dialog.locator('.psd-task-list label').filter({ hasText: 'Early A' })).not.toContainText('超过截止');
  await expect(dialog.locator('.psd-task-section-header')).toContainText('已选 3 / 4');
  await expect(dialog.locator('.psd-summary')).toContainText('3个任务将顺延');

  await search.fill('Nothing');
  await expect(dialog.getByText('没有匹配的任务，已选任务仍会保留。')).toBeVisible();
  await expect(dialog.locator('.psd-task-section-header')).toContainText('已选 3 / 4');
  await search.clear();
  await sort.selectOption('date-asc');
  await expect(titles).toHaveText(['Early A', 'Early B', 'Middle', 'Late']);
  await expect(dialog.locator('.psd-task-list label').filter({ hasText: 'Early A' }).locator('input')).not.toBeChecked();
  await dialog.locator('.psd-task-list label').filter({ hasText: 'Early A' }).locator('input').check();
  await search.fill('Early');
  await page.setViewportSize({ width: 600, height: 600 });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((panel) => panel.scrollWidth <= panel.clientWidth)).toBe(true);
  expect(await dialog.locator('.psd-task-controls').evaluate((controls) => controls.scrollWidth <= controls.clientWidth)).toBe(true);
  expect(await dialog.locator('.psd-task-list label').first().evaluate((row) => row.scrollWidth <= row.clientWidth)).toBe(true);
  await dialog.getByRole('button', { name: '确认顺延 1 天' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status')).toContainText('已顺延 4 个任务');
});

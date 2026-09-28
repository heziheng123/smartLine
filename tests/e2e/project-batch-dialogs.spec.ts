import { expect, test } from '@playwright/test';

const date = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());
const taskCount = 120;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ date, taskCount }) => {
    localStorage.clear();
    sessionStorage.clear();
    const blocks = Array.from({ length: taskCount }, (_, index) => ({
      type: 'smart-task', id: `batch-${index}`, body: '',
      header: {
        title: `Task ${index}`, tag: 'Default', tagColor: '#6366f1',
        date, duration: 30, isCompleted: false, autoSyncEbb: false,
      },
    }));
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({
      tasks: [{ id: 'batch-project', name: 'Batch Project', start: date, end: date, color: '#6366f1', blocks }],
      groups: [], notes: [], milestones: [],
    }));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify({}));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify({
      reviewTasks: [], inboxItems: [], outlineNodes: [], ebbSettings: {},
    }));
  }, { date, taskCount });
  await page.goto('/');
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: 'Batch Project' }).first().click();
});

test('batch editor keeps offscreen rows editable and saves the last row', async ({ page }) => {
  const more = page.locator('.pdv-container .pdv-btn[title="更多操作"]');
  await more.click();
  await page.getByRole('button', { name: '编辑任务详情' }).click();
  const dialog = page.getByRole('dialog', { name: /批量编辑任务/ });
  await expect(dialog.locator('.bi-table')).toHaveAttribute('aria-rowcount', String(taskCount + 1));
  expect(await dialog.locator('tbody tr.bi-row').count()).toBeLessThan(50);

  const edgeIndex = Number(await dialog.locator('tbody tr.bi-row').last().getAttribute('data-index'));
  await dialog.locator('tbody tr.bi-row').last().locator('button[title="删除"]').focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.closest('tr')?.getAttribute('data-index'))))
    .toBe(edgeIndex + 1);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => page.evaluate(() => Number(document.activeElement?.closest('tr')?.getAttribute('data-index'))))
    .toBe(edgeIndex);

  await dialog.locator('.bi-table-wrap').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const lastRow = dialog.locator(`tbody tr[data-index="${taskCount - 1}"]`);
  await expect(lastRow).toBeVisible();
  await lastRow.locator('input').first().fill('Edited last task');
  await dialog.getByRole('button', { name: /确认修改/ }).click();
  await expect(dialog).toHaveCount(0);

  await more.click();
  await page.getByRole('button', { name: '编辑任务详情' }).click();
  const reopened = page.getByRole('dialog', { name: /批量编辑任务/ });
  await reopened.locator('.bi-table-wrap').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(reopened.locator(`tbody tr[data-index="${taskCount - 1}"] input`).first()).toHaveValue('Edited last task');
});

test('batch import renders visible rows and imports the entire file', async ({ page }) => {
  const more = page.locator('.pdv-container .pdv-btn[title="更多操作"]');
  await more.click();
  await page.getByRole('button', { name: '批量导入' }).click();
  const dialog = page.getByRole('dialog', { name: '批量导入任务' });
  const csv = [
    'title,tag,duration,date,deadline,complexity,remark',
    ...Array.from({ length: taskCount }, (_, index) => `Imported ${index},Default,30,${date},,normal,`),
  ].join('\n');
  await dialog.locator('input[type="file"]').setInputFiles({
    name: 'batch.csv', mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await expect(dialog.locator('.bi-table')).toHaveAttribute('aria-rowcount', String(taskCount + 1));
  expect(await dialog.locator('tbody tr.bi-row').count()).toBeLessThan(50);
  await dialog.locator('.bi-table-wrap').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const lastRow = dialog.locator(`tbody tr[data-index="${taskCount - 1}"]`);
  await expect(lastRow).toContainText(`Imported ${taskCount - 1}`);
  await lastRow.getByRole('button', { name: '编辑' }).click();
  await lastRow.locator('input').first().fill('Edited imported last');
  await lastRow.locator('button[title="保存"]').click();
  await dialog.locator('.bi-table-wrap').evaluate((element) => { element.scrollTop = 0; });
  await dialog.locator('.bi-table-wrap').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(dialog.locator(`tbody tr[data-index="${taskCount - 1}"]`)).toContainText('Edited imported last');
  await dialog.getByRole('button', { name: /确认导入/ }).click();
  await expect(dialog).toHaveCount(0);

  await more.click();
  await page.getByRole('button', { name: '编辑任务详情' }).click();
  const editor = page.getByRole('dialog', { name: /批量编辑任务/ });
  await expect(editor.locator('.bi-table'))
    .toHaveAttribute('aria-rowcount', String(taskCount * 2 + 1));
  await editor.locator('.bi-table-wrap').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(editor.locator(`tbody tr[data-index="${taskCount * 2 - 1}"] input`).first())
    .toHaveValue('Edited imported last');
});

test('project shift virtualizes candidates and updates preview after selecting a distant row', async ({ page }) => {
  await page.locator('.pdv-container .pdv-btn[title="更多操作"]').click();
  await page.getByRole('button', { name: '批量调整排期' }).click();
  const dialog = page.getByRole('dialog', { name: '批量调整排期' });
  await expect(dialog.locator('.psd-task-section-header')).toContainText(`已选 ${taskCount} / ${taskCount}`);
  expect(await dialog.locator('.psd-task-list label').count()).toBeLessThan(40);
  await dialog.locator('.psd-task-list').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const lastRow = dialog.locator('.psd-task-list label').filter({ hasText: `Task ${taskCount - 1}` });
  await expect(lastRow).toBeVisible();
  await lastRow.locator('input[type="checkbox"]').uncheck();
  await expect(dialog.locator('.psd-task-section-header')).toContainText(`已选 ${taskCount - 1} / ${taskCount}`);
  await expect(dialog.locator('.psd-summary')).toContainText(`${taskCount - 1}`);
  await expect(dialog.getByRole('button', { name: '确认顺延 1 天' })).toBeEnabled();
});

import { expect, test } from '@playwright/test';

const formatShanghaiDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);
const addTestDays = (date: string, amount: number) => {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return formatShanghaiDate(value);
};
const testDate = formatShanghaiDate(new Date());
const testDayOfWeek = new Date(`${testDate}T12:00:00+08:00`).getUTCDay();
const weekMoveTargetDate = addTestDays(testDate, testDayOfWeek === 0 ? -1 : 1);

const task = {
  id: 'e2e-project', name: 'E2E项目', start: testDate, end: testDate, color: '#ec4899',
  blocks: [{ type: 'smart-task', id: 'e2e-block', header: { title: 'E2E完成撤销任务', tag: '默认', tagColor: '#f59e0b', date: testDate, duration: 30, isCompleted: false, autoSyncEbb: false }, body: '' }],
};
const daily = {
  [testDate]: { date: testDate, items: [{ id: 'e2e-scheduled', sourceId: 'project-blk:e2e-project::e2e-block', name: 'E2E完成撤销任务', source: 'project', timeSlot: 'morning', order: 0, duration: 30 }], blocks: [] },
};
const ebb = { reviewTasks: [{ id: 'e2e-review', topicName: 'E2E复习撤销', dueDate: testDate, originalDueDate: testDate, roundOrder: 1, isCompleted: false, tag: '默认', smStatus: 'scheduled' }], inboxItems: [], outlineNodes: [], ebbSettings: {} };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ taskData, dailyData, ebbData }) => {
    if (sessionStorage.getItem('e2e-seeded') === '1') return;
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({ tasks: [taskData], groups: [], notes: [], milestones: [] }));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify(dailyData));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify(ebbData));
  }, { taskData: task, dailyData: daily, ebbData: ebb });
  await page.goto('/');
});

test('completion from daily schedule creates one unified undo and restores the card', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await expect(card).toBeVisible();
  await card.locator('.ds-item-check').click();
  await expect(card).toHaveClass(/ds-item--completed/);
  await page.getByRole('button', { name: /撤销/ }).first().click();
  await expect(card).not.toHaveClass(/ds-item--completed/);
});

test('task overview aggregates project tasks and edits the original task block', async ({ page }) => {
  await page.getByTitle('任务总览').click();
  const card = page.locator('[data-block-id="e2e-block"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('E2E项目');
  await card.click();
  await expect(page.getByRole('dialog', { name: '任务详情' })).toBeVisible();
  await page.getByLabel('关闭任务详情').click();

  await card.getByRole('button', { name: /完成/ }).click();
  await page.getByRole('button', { name: /已完成/ }).first().click();
  const completedSection = page.locator('.task-overview-section').filter({ hasText: '已完成' });
  await completedSection.locator('.task-overview-section-header').click();
  await expect(card).toHaveClass(/is-completed/);
  await card.getByRole('button', { name: /取消完成/ }).click();
  await page.getByRole('button', { name: /全部任务/ }).first().click();
  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/is-completed/);
});

test('latest undo survives page refresh and remains executable', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await card.locator('.ds-item-check').click();
  await expect(card).toHaveClass(/ds-item--completed/);
  await page.reload();
  await page.getByTitle('每日安排').click();
  const refreshedCard = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await expect(refreshedCard).toHaveClass(/ds-item--completed/);
  await page.getByRole('button', { name: /撤销/ }).first().click();
  await expect(refreshedCard).not.toHaveClass(/ds-item--completed/);
});

test('older operations are not offered after a newer operation is recorded', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await card.locator('.ds-item-check').click();
  await card.locator('.ds-item-check').click();
  await page.getByTitle('最近操作与回收站').click();
  const entries = page.locator('.operation-history-list article');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0).getByRole('button', { name: '撤销' })).toBeVisible();
  await expect(entries.nth(1).getByRole('button', { name: '撤销' })).toHaveCount(0);
});

test('EBB completion from the main matrix uses the same global undo', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.locator('.eb-topic-row-main').filter({ hasText: 'E2E复习撤销' }).click();
  const toggle = page.getByLabel('标记第 1 轮完成');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByLabel('取消第 1 轮完成')).toBeVisible();
  await page.getByRole('button', { name: /撤销/ }).first().click();
  await expect(page.getByLabel('标记第 1 轮完成')).toBeVisible();
});

test('daily schedule drag between slots can be undone precisely', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const afternoon = page.getByTestId('daily-slot-afternoon');
  await page.waitForFunction(() => typeof (window as typeof window & { __e2eDailyDragEnd?: unknown }).__e2eDailyDragEnd === 'function');
  await page.evaluate(() => (window as typeof window & { __e2eDailyDragEnd: (result: unknown) => void }).__e2eDailyDragEnd({
    draggableId: 'e2e-scheduled', type: 'DEFAULT', reason: 'DROP', mode: 'FLUID', combine: null,
    source: { droppableId: 'ds-slot-morning', index: 0 },
    destination: { droppableId: 'ds-slot-afternoon', index: 0 },
  }));
  await expect(afternoon.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' })).toBeVisible();
  await page.getByRole('button', { name: /撤销/ }).first().click();
  await expect(page.getByTestId('daily-slot-morning').locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' })).toBeVisible();
});

test('week matrix drag reschedules through unified undo', async ({ page }) => {
  await page.getByTitle('周矩阵').click();
  const card = page.locator('[data-block-id="e2e-block"]');
  const target = page.locator(`[data-date="${weekMoveTargetDate}"][data-tag="默认"]`);
  await expect(card).toBeVisible();
  await page.evaluate(({ sourceDate, targetDate }) => {
    const source = document.querySelector<HTMLElement>('[data-block-id="e2e-block"]');
    const destination = document.querySelector<HTMLElement>(`[data-date="${targetDate}"][data-tag="默认"]`);
    if (!source || !destination) throw new Error('drag endpoints missing');
    const transfer = new DataTransfer();
    transfer.setData('application/json', JSON.stringify({ type: 'smart-block', source: 'week-matrix', taskId: 'e2e-project', blockId: 'e2e-block', tag: '默认', title: 'E2E完成撤销任务', fromDate: sourceDate }));
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    destination.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    destination.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { sourceDate: testDate, targetDate: weekMoveTargetDate });
  await expect(target.locator('[data-block-id="e2e-block"]')).toBeVisible();
  await page.getByRole('button', { name: /撤销/ }).first().click();
  await expect(page.locator(`[data-date="${testDate}"][data-tag="默认"] [data-block-id="e2e-block"]`)).toBeVisible();
});

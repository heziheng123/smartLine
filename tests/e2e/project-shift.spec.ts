import { expect, test, type Page } from '@playwright/test';

const formatShanghaiDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const addDays = (date: string, amount: number) => {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return formatShanghaiDate(value);
};
const today = formatShanghaiDate(new Date());
const tomorrow = addDays(today, 1);

const readIndexedValue = async <T,>(page: Page, storeName: string, key: string): Promise<T | null> => page.evaluate(
  ({ requestedStore, requestedKey }) => new Promise((resolve, reject) => {
    const openRequest = indexedDB.open('smart-timeline');
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(requestedStore, 'readonly');
      const request = transaction.objectStore(requestedStore).get(requestedKey);
      request.onsuccess = () => resolve(request.result ?? null);
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => database.close();
    };
  }),
  { requestedStore: storeName, requestedKey: key },
) as Promise<T | null>;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ date, taskDate }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({
      tasks: [{
        id: 'shift-project', name: 'Shift Project', start: date, end: date, color: '#6366f1',
        blocks: [
          { type: 'smart-task', id: 'shift-standard', body: '', header: { title: 'Shift Standard', tag: 'Default', tagColor: '#6366f1', date, deadline: date, duration: 30, isCompleted: false, autoSyncEbb: false } },
          { type: 'smart-task', id: 'shift-completed', body: '', header: { title: 'Shift Completed', tag: 'Default', tagColor: '#6366f1', date, duration: 30, isCompleted: true, autoSyncEbb: false } },
          { type: 'smart-task', id: 'shift-quantity', body: '', header: { taskKind: 'quantity', title: 'Shift Quantity', tag: 'Default', tagColor: '#6366f1', date, duration: 30, isCompleted: false, quantityTotal: 100, autoSyncEbb: false } },
        ],
      }], groups: [], notes: [], milestones: [],
    }));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify({
      [date]: { date, items: [{ id: 'shift-item', sourceId: 'project-blk:shift-project::shift-standard', name: 'Shift Standard', source: 'project', timeSlot: 'morning', order: 0, duration: 30 }], blocks: [] },
      [taskDate]: { date: taskDate, items: [], blocks: [] },
    }));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify({ reviewTasks: [], inboxItems: [], outlineNodes: [], ebbSettings: {} }));
  }, { date: today, taskDate: tomorrow });
  await page.goto('/');
});

test('project shift moves eligible tasks and daily placements as one undoable operation', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: 'Shift Project' }).first().click();
  await page.getByTitle('更多操作').click();
  await page.getByRole('button', { name: '项目整体顺延' }).click();

  const dialog = page.getByRole('dialog', { name: '项目整体顺延' });
  await expect(dialog).toContainText('1个任务将顺延');
  await expect(dialog).toContainText('1个每日安排将移动');
  await expect(dialog).toContainText('1个截止日期风险');
  await dialog.getByRole('button', { name: '确认顺延 1 天' }).click();
  await expect(page.getByRole('status')).toContainText('已顺延 1 个任务和 1 个每日安排');

  await expect.poll(async () => {
    const data = await readIndexedValue<{ tasks?: Array<{ id: string; start: string; end: string; blocks: Array<{ id: string; header: { date?: string } }> }> }>(page, 'timeline_data', 'smart-timeline-data');
    const project = data?.tasks?.find((task) => task.id === 'shift-project');
    return {
      start: project?.start,
      dates: project?.blocks.map((block) => [block.id, block.header.date]),
    };
  }).toEqual({
    start: tomorrow,
    dates: [['shift-standard', tomorrow], ['shift-completed', today], ['shift-quantity', today]],
  });

  await expect.poll(async () => {
    const schedules = await readIndexedValue<Record<string, { items: Array<{ sourceId: string }> }>>(page, 'daily_schedule_data', 'daily-schedule-data');
    return {
      old: schedules?.[today]?.items.length ?? 0,
      next: schedules?.[tomorrow]?.items.map((item) => item.sourceId) ?? [],
    };
  }).toEqual({ old: 0, next: ['project-blk:shift-project::shift-standard'] });

  await page.getByRole('status').getByRole('button', { name: '撤销' }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect.poll(async () => {
    const data = await readIndexedValue<{ tasks?: Array<{ id: string; start: string; blocks: Array<{ id: string; header: { date?: string } }> }> }>(page, 'timeline_data', 'smart-timeline-data');
    const project = data?.tasks?.find((task) => task.id === 'shift-project');
    return { start: project?.start, date: project?.blocks.find((block) => block.id === 'shift-standard')?.header.date };
  }).toEqual({ start: today, date: today });
});

import { expect, test, type Page } from '@playwright/test';

const readPersistedStore = async <T,>(page: Page, storeName: string, key: string): Promise<T | null> => page.evaluate(
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

const formatShanghaiDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const addDays = (date: string, amount: number) => {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return formatShanghaiDate(value);
};
const today = formatShanghaiDate(new Date());
const dueDates = [addDays(today, 1), addDays(today, 3), addDays(today, 7), addDays(today, 15)];

const openEbbMoreAction = async (page: Page, name: '批量调整' | '设置') => {
  await page.getByLabel('复习更多操作').click();
  await page.getByRole('menuitem', { name }).click();
};

const projectTask = {
  id: 'batch-project', name: '批量联动项目', start: today, end: today, color: '#6366f1', completed: false,
  blocks: [{
    type: 'smart-task', id: 'batch-project-block', body: '',
    header: {
      title: '完成批量知识学习', tag: '学习', tagColor: '#93c5fd', date: today,
      duration: 30, isCompleted: true, completedDate: today,
      graphNodeId: 'batch-node', graphNodeIds: ['batch-node'], autoSyncEbb: true,
    },
  }],
};

const reviewTasks = dueDates.map((dueDate, index) => ({
  id: `batch-r${index + 1}`,
  topicName: '批量颜色联动知识',
  dueDate,
  originalDueDate: dueDate,
  roundOrder: index + 1,
  isCompleted: index < 2,
  completedDate: index < 2 ? today : undefined,
  graphNodeId: 'batch-node',
  complexity: 'normal' as const,
  smStatus: index < 2 ? 'confirmed' as const : 'scheduled' as const,
}));

const daily = {
  [dueDates[2]]: {
    date: dueDates[2], blocks: [],
    items: [{ id: 'batch-daily-r3', sourceId: 'review-batch-r3', name: '批量颜色联动知识', source: 'review', timeSlot: 'morning', order: 0 }],
  },
  [dueDates[3]]: {
    date: dueDates[3],
    blocks: [{ id: 'batch-block-r4', sourceId: 'review-batch-r4', name: '批量颜色联动知识', source: 'review', startTime: '14:00', endTime: '14:30' }],
    items: [{ id: 'batch-daily-r4', sourceId: 'review-batch-r4', name: '批量颜色联动知识', source: 'review', timeSlot: 'afternoon', order: 0 }],
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ taskData, reviewData, dateData }) => {
    if (sessionStorage.getItem('ebb-batch-test-seeded') === '1') return;
    sessionStorage.setItem('ebb-batch-test-seeded', '1');
    localStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({ tasks: [taskData], groups: [], notes: [], milestones: [] }));
    localStorage.setItem('line-graph-storage:mirror', JSON.stringify({ nodes: [{ id: 'batch-node', name: '批量颜色联动知识', parentId: null, createdAt: 1, status: 'activated' }] }));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify({ reviewTasks: reviewData, inboxItems: [], outlineNodes: [], ebbSettings: {} }));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify(dateData));
  }, { taskData: projectTask, reviewData: reviewTasks, dateData: daily });
  await page.goto('/');
});

test('batch trim updates rounds, daily references, knowledge color and unified undo', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  const totalCard = page.locator('.eb-stat-card').filter({ hasText: '总任务' });
  await expect(totalCard.locator('.eb-stat-value')).toHaveText('4');

  await openEbbMoreAction(page, '批量调整');
  const dialog = page.getByRole('dialog', { name: '批量调整复习计划' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('批量调整预览统计')).toContainText('2 轮删除');
  await dialog.getByRole('button', { name: /确认调整 1 个计划/ }).click();
  await expect(totalCard.locator('.eb-stat-value')).toHaveText('2');

  await page.getByTitle('知识大盘').click();
  const nodeLabel = page.locator('svg text[fill="#0f172a"]').filter({ hasText: '批量颜色联动知识' });
  await expect(nodeLabel).toBeVisible();
  const nodeFill = await nodeLabel.evaluate((element) => element.closest('g')?.querySelector('path')?.getAttribute('fill'));
  expect(nodeFill).toBe('#eab308');
  await nodeLabel.evaluate((element) => element.parentElement?.dispatchEvent(new MouseEvent('click', { bubbles: true })));
  await expect(page.getByLabel('学习状态总览')).toContainText('已掌握');

  await page.getByTitle('每日安排').click();
  await page.locator('.ds-date-input').fill(dueDates[2]);
  await expect(page.locator('.ds-item').filter({ hasText: '批量颜色联动知识' })).toHaveCount(0);

  await page.getByTitle('最近操作与回收站').click();
  const history = page.getByLabel('最近操作面板');
  await expect(history).toContainText('批量精简复习轮次');
  await history.locator('.operation-history-list article').first().getByRole('button', { name: '撤销' }).click();
  await page.getByLabel('关闭最近操作').click();

  await page.locator('.ds-date-input').fill(dueDates[2]);
  await expect(page.locator('.ds-item').filter({ hasText: '批量颜色联动知识' })).toBeVisible();
  await page.getByTitle('艾宾浩斯复习').click();
  await expect(page.locator('.eb-stat-card').filter({ hasText: '总任务' }).locator('.eb-stat-value')).toHaveText('4');
});

test('batch panel previews shift, append and future-template operations', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await openEbbMoreAction(page, '批量调整');
  const dialog = page.getByRole('dialog', { name: '批量调整复习计划' });
  const summary = dialog.getByLabel('批量调整预览统计');
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('batch dialog has no measurable viewport');
  if (viewport.width > 900) {
    expect(box.width).toBeLessThanOrEqual(962);
    expect(box.height).toBeLessThanOrEqual(682);
    expect(Math.abs((box.x + box.width / 2) - viewport.width / 2)).toBeLessThan(3);
    expect(Math.abs((box.y + box.height / 2) - viewport.height / 2)).toBeLessThan(3);
  } else {
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(viewport.width);
  }

  await dialog.getByRole('radio', { name: /整体改期/ }).click();
  await expect(summary).toContainText('2 轮改期');

  await dialog.getByRole('radio', { name: /追加轮次/ }).click();
  await expect(summary).toContainText('1 轮新增');

  await dialog.getByRole('radio', { name: /套用未来模板/ }).click();
  await expect(summary).toContainText('2 轮删除');
  await expect(summary).toContainText('5 轮新增');
  await expect(dialog.locator('.eb-batch-preview-row').filter({ hasText: '批量颜色联动知识' })).toContainText('4 → 7');
});

test('undoing appended rounds preserves existing daily arrangements', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await openEbbMoreAction(page, '批量调整');
  const dialog = page.getByRole('dialog', { name: '批量调整复习计划' });
  await dialog.getByRole('radio', { name: /追加轮次/ }).click();
  await dialog.getByRole('button', { name: /确认调整 1 个计划/ }).click();
  await expect(page.locator('.eb-stat-card').filter({ hasText: '总任务' }).locator('.eb-stat-value')).toHaveText('5');

  await page.getByTitle('最近操作与回收站').click();
  const history = page.getByLabel('最近操作面板');
  await history.locator('.operation-history-list article').first().getByRole('button', { name: '撤销' }).click();
  await page.getByLabel('关闭最近操作').click();

  await page.getByTitle('每日安排').click();
  await page.locator('.ds-date-input').fill(dueDates[2]);
  await expect(page.locator('.ds-item').filter({ hasText: '批量颜色联动知识' })).toBeVisible();
});

test('shifted rounds survive refresh and unified undo restores items and time blocks', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await openEbbMoreAction(page, '批量调整');
  const dialog = page.getByRole('dialog', { name: '批量调整复习计划' });
  await dialog.getByRole('radio', { name: /整体改期/ }).click();
  await dialog.locator('.eb-batch-field input[type="number"]').fill('-2');
  await expect(dialog.getByLabel('批量调整预览统计')).toContainText('2 轮改期');
  await dialog.getByRole('button', { name: /确认调整 1 个计划/ }).click();

  await expect.poll(async () => {
    const data = await readPersistedStore<{ reviewTasks?: Array<{ id: string; dueDate: string }> }>(page, 'ebb_data', 'smart-ebb-data') ?? {};
    return (data.reviewTasks ?? [])
      .filter((task: { id: string }) => task.id === 'batch-r3' || task.id === 'batch-r4')
      .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id))
      .map((task: { dueDate: string }) => task.dueDate);
  }).toEqual([addDays(dueDates[2], -2), addDays(dueDates[3], -2)]);

  await expect.poll(async () => {
    const schedules = await readPersistedStore<Record<string, { items?: Array<{ id: string; sourceId?: string }>; blocks?: Array<{ id: string; sourceId?: string }> }>>(page, 'daily_schedule_data', 'daily-schedule-data') ?? {};
    const days = Object.values(schedules) as Array<{ items?: Array<{ id: string; sourceId?: string }>; blocks?: Array<{ id: string; sourceId?: string }> }>;
    return days.flatMap((day) => [...(day.items ?? []), ...(day.blocks ?? [])])
      .filter((entry: { sourceId?: string }) => entry.sourceId === 'review-batch-r3' || entry.sourceId === 'review-batch-r4').length;
  }).toBe(0);

  await page.reload();
  await page.getByTitle('艾宾浩斯复习').click();
  await expect(page.locator('.eb-stat-card').filter({ hasText: '总任务' }).locator('.eb-stat-value')).toHaveText('4');
  await page.getByTitle('最近操作与回收站').click();
  const history = page.getByLabel('最近操作面板');
  await expect(history).toContainText('批量调整复习日期');
  await history.locator('.operation-history-list article').first().getByRole('button', { name: '撤销' }).click();

  await expect.poll(async () => {
    const data = await readPersistedStore<{ reviewTasks?: Array<{ id: string; dueDate: string }> }>(page, 'ebb_data', 'smart-ebb-data') ?? {};
    return (data.reviewTasks ?? [])
      .filter((task: { id: string }) => task.id === 'batch-r3' || task.id === 'batch-r4')
      .sort((a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id))
      .map((task: { dueDate: string }) => task.dueDate);
  }).toEqual([dueDates[2], dueDates[3]]);
  await expect.poll(async () => {
    const schedules = await readPersistedStore<Record<string, { items?: Array<{ id: string; sourceId?: string }>; blocks?: Array<{ id: string; sourceId?: string }> }>>(page, 'daily_schedule_data', 'daily-schedule-data') ?? {};
    const days = Object.values(schedules) as Array<{ items?: Array<{ id: string; sourceId?: string }>; blocks?: Array<{ id: string; sourceId?: string }> }>;
    return days.flatMap((day) => [...(day.items ?? []), ...(day.blocks ?? [])])
      .filter((entry: { sourceId?: string }) => entry.sourceId === 'review-batch-r3' || entry.sourceId === 'review-batch-r4')
      .map((entry: { id: string }) => entry.id)
      .sort();
  }).toEqual(['batch-block-r4', 'batch-daily-r3', 'batch-daily-r4']);
});

test('future template rejects malformed intervals and preserves completed history when applied', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await openEbbMoreAction(page, '批量调整');
  const dialog = page.getByRole('dialog', { name: '批量调整复习计划' });
  await dialog.getByRole('radio', { name: /套用未来模板/ }).click();
  await dialog.locator('select').selectOption('custom');
  const intervals = dialog.locator('.eb-batch-field--wide input');
  await intervals.fill('1, 错误, 7');
  await expect(dialog.getByRole('button', { name: '确认调整' })).toBeDisabled();

  await intervals.fill('1, 2, 4, 7, 15');
  await expect(dialog.getByLabel('批量调整预览统计')).toContainText('5 轮新增');
  await dialog.getByRole('button', { name: /确认调整 1 个计划/ }).click();

  await expect.poll(async () => {
    const data = await readPersistedStore<{ reviewTasks?: Array<{ id: string; dueDate: string; isCompleted: boolean; roundOrder: number; graphNodeId?: string }> }>(page, 'ebb_data', 'smart-ebb-data') ?? {};
    const tasks = data.reviewTasks ?? [];
    const pending = tasks.filter((task: { isCompleted: boolean }) => !task.isCompleted);
    return {
      total: tasks.length,
      completedIds: tasks.filter((task: { isCompleted: boolean }) => task.isCompleted).map((task: { id: string }) => task.id).sort(),
      oldPendingStillPresent: tasks.some((task: { id: string }) => task.id === 'batch-r3' || task.id === 'batch-r4'),
      pendingCount: pending.length,
      uniquePendingDates: new Set(pending.map((task: { dueDate: string }) => task.dueDate)).size,
      pendingOrders: pending.map((task: { roundOrder: number }) => task.roundOrder).sort((a: number, b: number) => a - b),
      allLinked: pending.every((task: { graphNodeId?: string }) => task.graphNodeId === 'batch-node'),
    };
  }).toEqual({
    total: 7,
    completedIds: ['batch-r1', 'batch-r2'],
    oldPendingStillPresent: false,
    pendingCount: 5,
    uniquePendingDates: 5,
    pendingOrders: [3, 4, 5, 6, 7],
    allLinked: true,
  });

  await expect.poll(async () => {
    const schedules = await readPersistedStore<Record<string, { items?: Array<{ id: string; sourceId?: string }>; blocks?: Array<{ id: string; sourceId?: string }> }>>(page, 'daily_schedule_data', 'daily-schedule-data') ?? {};
    const days = Object.values(schedules) as Array<{ items?: Array<{ id: string; sourceId?: string }>; blocks?: Array<{ id: string; sourceId?: string }> }>;
    return days.flatMap((day) => [...(day.items ?? []), ...(day.blocks ?? [])])
      .filter((entry: { sourceId?: string }) => entry.sourceId === 'review-batch-r3' || entry.sourceId === 'review-batch-r4').length;
  }).toBe(0);
});

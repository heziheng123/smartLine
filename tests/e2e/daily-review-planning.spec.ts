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
const tomorrow = addDays(today, 1);
const dayAfterTomorrow = addDays(today, 2);

const reviewTasks = [
  {
    id: 'auto-source', topicName: '重点关系知识', graphNodeId: 'rolling-node-a',
    dueDate: addDays(today, -2), originalDueDate: addDays(today, -2), roundOrder: 1,
    isCompleted: true, completedDate: today, tag: '政治', complexity: 'hard' as const, smStatus: 'confirmed' as const,
    completionSource: 'project-task' as const,
    completionSourceTaskId: 'source-project',
    completionSourceBlockId: 'source-block',
    previousSchedule: [
      { reviewTaskId: 'rolling-a1', dueDate: today },
      { reviewTaskId: 'rolling-a2', dueDate: addDays(today, 3) },
    ],
  },
  {
    id: 'rolling-a1', topicName: '重点关系知识', graphNodeId: 'rolling-node-a',
    dueDate: today, originalDueDate: today, roundOrder: 2,
    isCompleted: false, tag: '政治', complexity: 'hard' as const, smStatus: 'scheduled' as const,
  },
  {
    id: 'rolling-a2', topicName: '重点关系知识', graphNodeId: 'rolling-node-a',
    dueDate: addDays(today, 3), originalDueDate: addDays(today, 3), roundOrder: 3,
    isCompleted: false, tag: '政治', complexity: 'hard' as const, smStatus: 'scheduled' as const,
  },
  {
    id: 'rolling-b1', topicName: '常规关系知识', graphNodeId: 'rolling-node-b',
    dueDate: tomorrow, originalDueDate: tomorrow, roundOrder: 1,
    isCompleted: false, tag: '英语', complexity: 'normal' as const, smStatus: 'scheduled' as const,
  },
  {
    id: 'rolling-b2', topicName: '常规关系知识', graphNodeId: 'rolling-node-b',
    dueDate: addDays(today, 4), originalDueDate: addDays(today, 4), roundOrder: 2,
    isCompleted: false, tag: '英语', complexity: 'normal' as const, smStatus: 'scheduled' as const,
  },
];

const extraReviewTasks = [
  {
    id: 'rolling-c1', topicName: '额外复习主题C', dueDate: tomorrow, originalDueDate: tomorrow,
    roundOrder: 1, isCompleted: false, tag: '政治', complexity: 'normal' as const, smStatus: 'scheduled' as const,
  },
  {
    id: 'rolling-d1', topicName: '额外复习主题D', dueDate: tomorrow, originalDueDate: tomorrow,
    roundOrder: 1, isCompleted: false, complexity: 'easy' as const, smStatus: 'scheduled' as const,
  },
];

const dailySchedules = {
  [today]: {
    date: today,
    items: [{ id: 'rolling-item-a1', sourceId: 'review-rolling-a1', name: '重点关系知识', source: 'review', timeSlot: 'morning', order: 0 }],
    blocks: [],
  },
  [tomorrow]: {
    date: tomorrow,
    items: [{ id: 'rolling-item-b1', sourceId: 'review-rolling-b1', name: '常规关系知识', source: 'review', timeSlot: 'morning', order: 0 }],
    blocks: [],
  },
  [addDays(today, 3)]: {
    date: addDays(today, 3),
    items: [],
    blocks: [{ id: 'rolling-block-a2', sourceId: 'review-rolling-a2', name: '重点关系知识', source: 'review', startTime: '14:00', endTime: '14:30' }],
  },
  [addDays(today, 4)]: {
    date: addDays(today, 4),
    items: [],
    blocks: [{ id: 'rolling-block-b2', sourceId: 'review-rolling-b2', name: '常规关系知识', source: 'review', startTime: '15:00', endTime: '15:30' }],
  },
};

test.beforeEach(async ({ page }, testInfo) => {
  const seededTasks = testInfo.title.includes('more than the configured daily task limit')
    ? [...reviewTasks, ...extraReviewTasks]
    : reviewTasks;
  await page.addInitScript(({ tasks, schedules }) => {
    if (sessionStorage.getItem('daily-review-plan-seeded') === '1') return;
    sessionStorage.setItem('daily-review-plan-seeded', '1');
    localStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({ tasks: [], groups: [], notes: [], milestones: [] }));
    localStorage.setItem('line-graph-storage:mirror', JSON.stringify({
      nodes: [
        { id: 'rolling-node-a', name: '重点关系知识', parentId: null, createdAt: 1, status: 'activated' },
        { id: 'rolling-node-b', name: '常规关系知识', parentId: null, createdAt: 2, status: 'activated' },
      ],
    }));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify({
      reviewTasks: tasks,
      inboxItems: [],
      outlineNodes: [],
      ebbSettings: { dailyTaskLimit: 3 },
    }));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify(schedules));
  }, { tasks: seededTasks, schedules: dailySchedules });
  await page.goto('/');
});

test('nightly selection keeps tomorrow, rolls the rest one day and preserves every relation', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('button', { name: '明日选择' }).click();
  const dialog = page.getByRole('dialog', { name: '明日复习选择' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.eb-daily-plan-card')).toHaveCount(2);
  await expect(dialog.getByRole('region', { name: '政治标签' })).toContainText('第 2 轮');
  await expect(dialog.getByRole('region', { name: '英语标签' })).toContainText('第 1 轮');
  await expect(dialog).toContainText('后续 1 轮保持间隔联动');

  const important = dialog.locator('.eb-daily-plan-card').filter({ hasText: '重点关系知识' });
  const routine = dialog.locator('.eb-daily-plan-card').filter({ hasText: '常规关系知识' });
  await important.getByRole('button', { name: '保留明天' }).click();
  await expect(important.getByRole('button', { name: '明天保留' })).toBeVisible();
  await expect(routine).toContainText('待选');
  await dialog.getByRole('button', { name: '确认明日选择' }).click();

  await expect.poll(async () => {
    const data = await readPersistedStore<{
      reviewTasks?: Array<{
        id: string;
        dueDate: string;
        graphNodeId?: string;
        rollingDecision?: string;
        rollingDeferralCount?: number;
      }>;
    }>(page, 'ebb_data', 'smart-ebb-data') ?? {};
    return (data.reviewTasks ?? [])
      .filter((task) => task.id !== 'auto-source')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => ({
        id: task.id,
        dueDate: task.dueDate,
        graphNodeId: task.graphNodeId,
        decision: task.rollingDecision,
        count: task.rollingDeferralCount,
      }));
  }).toEqual([
    { id: 'rolling-a1', dueDate: tomorrow, graphNodeId: 'rolling-node-a', decision: 'keep', count: 0 },
    { id: 'rolling-a2', dueDate: addDays(today, 4), graphNodeId: 'rolling-node-a', decision: undefined, count: undefined },
    { id: 'rolling-b1', dueDate: dayAfterTomorrow, graphNodeId: 'rolling-node-b', decision: 'defer', count: 1 },
    { id: 'rolling-b2', dueDate: addDays(today, 5), graphNodeId: 'rolling-node-b', decision: undefined, count: undefined },
  ]);

  await expect.poll(async () => {
    const data = await readPersistedStore<{
      reviewTasks?: Array<{ id: string; previousSchedule?: Array<{ reviewTaskId: string; dueDate: string }> }>;
    }>(page, 'ebb_data', 'smart-ebb-data') ?? {};
    return data.reviewTasks?.find((task) => task.id === 'auto-source')?.previousSchedule;
  }).toEqual([
    { reviewTaskId: 'rolling-a1', dueDate: tomorrow },
    { reviewTaskId: 'rolling-a2', dueDate: addDays(today, 4) },
  ]);

  await expect.poll(async () => {
    const schedules = await readPersistedStore<Record<string, {
      items?: Array<{ sourceId?: string }>;
      blocks?: Array<{ sourceId?: string }>;
    }>>(page, 'daily_schedule_data', 'daily-schedule-data') ?? {};
    return Object.values(schedules)
      .flatMap((day) => [...(day.items ?? []), ...(day.blocks ?? [])])
      .filter((entry) => entry.sourceId?.startsWith('review-rolling-')).length;
  }).toBe(0);

  await page.getByRole('button', { name: '明日选择' }).click();
  await expect(page.getByRole('dialog', { name: '明日复习选择' }).locator('.eb-daily-plan-card')).toHaveCount(2);
  await expect(
    page.getByRole('dialog', { name: '明日复习选择' })
      .locator('.eb-daily-plan-card')
      .filter({ hasText: '重点关系知识' })
      .getByRole('button', { name: '明天保留' }),
  ).toBeVisible();
  await page.getByLabel('关闭明日选择').click();

  await page.reload();
  await page.getByTitle('艾宾浩斯复习').click();
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);

  await expect.poll(async () => {
    const data = await readPersistedStore<{
      reviewTasks?: Array<{
        id: string;
        dueDate: string;
        graphNodeId?: string;
        rollingDecision?: string;
        rollingDeferralCount?: number;
      }>;
    }>(
      page,
      'ebb_data',
      'smart-ebb-data',
    ) ?? {};
    return (data.reviewTasks ?? [])
      .filter((task) => task.id !== 'auto-source')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => ({
        id: task.id,
        dueDate: task.dueDate,
        graphNodeId: task.graphNodeId,
        decision: task.rollingDecision,
        count: task.rollingDeferralCount,
      }));
  }).toEqual([
    { id: 'rolling-a1', dueDate: tomorrow, graphNodeId: 'rolling-node-a', decision: 'keep', count: 0 },
    { id: 'rolling-a2', dueDate: addDays(today, 4), graphNodeId: 'rolling-node-a', decision: undefined, count: undefined },
    { id: 'rolling-b1', dueDate: dayAfterTomorrow, graphNodeId: 'rolling-node-b', decision: 'defer', count: 1 },
    { id: 'rolling-b2', dueDate: addDays(today, 5), graphNodeId: 'rolling-node-b', decision: undefined, count: undefined },
  ]);

  await expect.poll(async () => {
    const schedules = await readPersistedStore<Record<string, {
      items?: Array<{ id: string; sourceId?: string }>;
      blocks?: Array<{ id: string; sourceId?: string }>;
    }>>(page, 'daily_schedule_data', 'daily-schedule-data') ?? {};
    return Object.values(schedules)
      .flatMap((day) => [...(day.items ?? []), ...(day.blocks ?? [])])
      .filter((entry) => entry.sourceId?.startsWith('review-rolling-'))
      .length;
  }).toBe(0);
});

test('nightly selection allows keeping more than the configured daily task limit', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('button', { name: '明日选择' }).click();
  const dialog = page.getByRole('dialog', { name: '明日复习选择' });
  await expect(dialog.locator('.eb-daily-plan-card')).toHaveCount(4);
  const politics = dialog.getByRole('region', { name: '政治标签' });
  await expect(politics.getByRole('region', { name: '政治第1轮' })).toContainText('额外复习主题C');
  await expect(politics.getByRole('region', { name: '政治第2轮' })).toContainText('重点关系知识');
  await expect(dialog.getByRole('region', { name: '未设置标签', exact: true })).toContainText('额外复习主题D');
  await politics.getByRole('region', { name: '政治第1轮' }).getByRole('button', { name: '本轮全选' }).click();
  await expect(politics.getByRole('region', { name: '政治第1轮' }).getByRole('button', { name: '本轮取消' })).toBeVisible();
  const unselectedButtons = dialog.getByRole('button', { name: '保留明天' });
  while (await unselectedButtons.count() > 0) {
    await unselectedButtons.first().click();
  }
  await expect(dialog.getByRole('button', { name: '明天保留' })).toHaveCount(4);
  await expect(dialog).toContainText('4 轮 · 不限数量');
  await expect(dialog).not.toContainText('容量已满');
  await dialog.getByRole('button', { name: '确认明日选择' }).click();

  await expect.poll(async () => {
    const data = await readPersistedStore<{ reviewTasks?: Array<{ rollingPlanDate?: string; rollingDecision?: string }> }>(
      page,
      'ebb_data',
      'smart-ebb-data',
    );
    return data?.reviewTasks?.filter((task) => task.rollingPlanDate === tomorrow && task.rollingDecision === 'keep').length;
  }).toBe(4);
});

test('reopening the same nightly plan does not double-count deferrals and can revise the choice', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('button', { name: '明日选择' }).click();
  let dialog = page.getByRole('dialog', { name: '明日复习选择' });
  await dialog.getByRole('button', { name: '确认明日选择' }).click();

  await page.getByRole('button', { name: '明日选择' }).click();
  dialog = page.getByRole('dialog', { name: '明日复习选择' });
  await expect(dialog.locator('.eb-daily-plan-card')).toHaveCount(2);
  await expect(dialog.locator('.eb-daily-plan-card').filter({ hasText: '重点关系知识' })).toContainText('连续顺延 1 次');
  await dialog.getByRole('button', { name: '确认明日选择' }).click();

  await expect.poll(async () => {
    const data = await readPersistedStore<{
      reviewTasks?: Array<{ id: string; dueDate: string; rollingDeferralCount?: number }>;
    }>(page, 'ebb_data', 'smart-ebb-data') ?? {};
    return (data.reviewTasks ?? [])
      .filter((task) => task.id === 'rolling-a1' || task.id === 'rolling-b1')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => ({ id: task.id, dueDate: task.dueDate, count: task.rollingDeferralCount }));
  }).toEqual([
    { id: 'rolling-a1', dueDate: dayAfterTomorrow, count: 1 },
    { id: 'rolling-b1', dueDate: dayAfterTomorrow, count: 1 },
  ]);

  await page.getByRole('button', { name: '明日选择' }).click();
  dialog = page.getByRole('dialog', { name: '明日复习选择' });
  await dialog.locator('.eb-daily-plan-card').filter({ hasText: '重点关系知识' }).getByRole('button', { name: '保留明天' }).click();
  await dialog.getByRole('button', { name: '确认明日选择' }).click();

  await expect.poll(async () => {
    const data = await readPersistedStore<{
      reviewTasks?: Array<{ id: string; dueDate: string; rollingDecision?: string; rollingDeferralCount?: number }>;
    }>(page, 'ebb_data', 'smart-ebb-data') ?? {};
    return (data.reviewTasks ?? [])
      .filter((task) => task.id === 'rolling-a1' || task.id === 'rolling-a2')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => ({
        id: task.id,
        dueDate: task.dueDate,
        decision: task.rollingDecision,
        count: task.rollingDeferralCount,
      }));
  }).toEqual([
    { id: 'rolling-a1', dueDate: tomorrow, decision: 'keep', count: 0 },
    { id: 'rolling-a2', dueDate: addDays(today, 4), decision: undefined, count: undefined },
  ]);
});

test('daily schedule exposes the same nightly review transaction', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  await page.getByRole('button', { name: '明日复习选择' }).click();
  const dialog = page.getByRole('dialog', { name: '明日复习选择' });
  await expect(dialog.locator('.eb-daily-plan-card')).toHaveCount(2);
  await dialog.locator('.eb-daily-plan-card').filter({ hasText: '重点关系知识' }).getByRole('button', { name: '保留明天' }).click();
  await dialog.getByRole('button', { name: '确认明日选择' }).click();
  await expect(page.getByRole('status')).toContainText('明日保留 1 轮，其余 1 轮顺延一天');

  await expect.poll(async () => {
    const data = await readPersistedStore<{ reviewTasks?: Array<{ id: string; dueDate: string }> }>(
      page,
      'ebb_data',
      'smart-ebb-data',
    ) ?? {};
    return (data.reviewTasks ?? [])
      .filter((task) => task.id === 'rolling-a1' || task.id === 'rolling-b1')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => task.dueDate);
  }).toEqual([tomorrow, dayAfterTomorrow]);
});

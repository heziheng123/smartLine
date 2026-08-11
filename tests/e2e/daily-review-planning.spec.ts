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
    isCompleted: true, completedDate: today, tag: '旧任务标签A', complexity: 'hard' as const, smStatus: 'confirmed' as const,
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
    isCompleted: false, tag: '旧任务标签A', complexity: 'hard' as const, smStatus: 'scheduled' as const,
  },
  {
    id: 'rolling-a2', topicName: '重点关系知识', graphNodeId: 'rolling-node-a',
    dueDate: addDays(today, 3), originalDueDate: addDays(today, 3), roundOrder: 3,
    isCompleted: false, tag: '旧任务标签A', complexity: 'hard' as const, smStatus: 'scheduled' as const,
  },
  {
    id: 'rolling-b1', topicName: '常规关系知识', graphNodeId: 'rolling-node-b',
    dueDate: tomorrow, originalDueDate: tomorrow, roundOrder: 1,
    isCompleted: false, tag: '旧任务标签B', complexity: 'normal' as const, smStatus: 'scheduled' as const,
  },
  {
    id: 'rolling-b2', topicName: '常规关系知识', graphNodeId: 'rolling-node-b',
    dueDate: addDays(today, 4), originalDueDate: addDays(today, 4), roundOrder: 2,
    isCompleted: false, tag: '旧任务标签B', complexity: 'normal' as const, smStatus: 'scheduled' as const,
  },
];

const extraReviewTasks = [
  {
    id: 'rolling-c1', topicName: '额外复习主题C', dueDate: tomorrow, originalDueDate: tomorrow,
    roundOrder: 1, isCompleted: false, tag: '独立手工标签', complexity: 'normal' as const, smStatus: 'scheduled' as const,
  },
  {
    id: 'rolling-d1', topicName: '额外复习主题D', dueDate: tomorrow, originalDueDate: tomorrow,
    roundOrder: 1, isCompleted: false, complexity: 'easy' as const, smStatus: 'scheduled' as const,
  },
];

const denseTabletPoolTasks = Array.from({ length: 18 }, (_, index) => ({
  id: `tablet-pool-${index}`,
  topicName: `平板待安排复习 ${index + 1}`,
  dueDate: today,
  originalDueDate: today,
  roundOrder: 1,
  isCompleted: false,
  complexity: 'normal' as const,
  smStatus: 'scheduled' as const,
}));

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
  const seededTasks = testInfo.title.includes('tablet pending pool')
    ? [...reviewTasks, ...denseTabletPoolTasks]
    : testInfo.title.includes('minute capacity')
      ? [...reviewTasks, ...extraReviewTasks]
      : reviewTasks;
  await page.addInitScript(({ tasks, schedules }) => {
    if (sessionStorage.getItem('daily-review-plan-seeded') === '1') return;
    sessionStorage.setItem('daily-review-plan-seeded', '1');
    localStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({ tasks: [], groups: [], notes: [], milestones: [] }));
    localStorage.setItem('line-graph-storage:mirror', JSON.stringify({
      nodes: [
        { id: 'rolling-root-politics', name: '政治根分类', parentId: null, createdAt: 1, status: 'activated' },
        { id: 'rolling-node-a', name: '重点关系知识', parentId: 'rolling-root-politics', createdAt: 2, status: 'activated' },
        { id: 'rolling-root-english', name: '英语根分类', parentId: null, createdAt: 3, status: 'activated' },
        { id: 'rolling-node-b', name: '常规关系知识', parentId: 'rolling-root-english', createdAt: 4, status: 'activated' },
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

test('tablet pending pool expands into the Today view instead of creating nested scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 1080, height: 900 });
  await page.getByTitle('艾宾浩斯复习').click();
  const poolList = page.locator('.eb-today-pool-list');
  await expect(poolList.locator('.eb-today-pool-card')).toHaveCount(18);

  const poolMetrics = await poolList.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      overflowY: style.overflowY,
      maxHeight: style.maxHeight,
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight,
    };
  });
  expect(poolMetrics.overflowY).toBe('visible');
  expect(poolMetrics.maxHeight).toBe('none');
  expect(Math.abs(poolMetrics.scrollHeight - poolMetrics.clientHeight)).toBeLessThanOrEqual(1);

  const panelMetrics = await page.locator('.eb-today-panel').evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(panelMetrics.overflowY).toBe('auto');
  expect(panelMetrics.scrollHeight).toBeGreaterThan(panelMetrics.clientHeight);
});

test('workload planning assigns concrete dates and preserves every relation', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('button', { name: /明日 \d+\/60 分钟/ }).first().click();
  const dialog = page.getByRole('dialog', { name: '明日负荷规划' });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('.eb-workload-card')).toHaveCount(2);
  await expect(dialog.locator('.eb-workload-card').filter({ hasText: '重点关系知识' })).toContainText('政治根分类 · R2/3');
  await expect(dialog.locator('.eb-workload-card').filter({ hasText: '常规关系知识' })).toContainText('英语根分类 · R1/2');
  await expect(dialog.getByText('旧任务标签A', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('旧任务标签B', { exact: true })).toHaveCount(0);
  await expect(dialog).toContainText('后续 1 轮联动');
  await dialog.getByLabel('安排重点关系知识').selectOption(tomorrow);
  await dialog.getByLabel('安排常规关系知识').selectOption(dayAfterTomorrow);
  await dialog.getByRole('button', { name: '保存负荷规划' }).click();
  await expect(page.getByText(/明天保留 1 轮；另外 1 轮已调整至/)).toBeVisible();
  await expect(page.getByRole('button', { name: '查看这些改期' })).toBeVisible();

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

  await page.getByRole('button', { name: /明日 \d+\/60 分钟/ }).first().click();
  await expect(page.getByRole('dialog', { name: '明日负荷规划' }).locator('.eb-workload-card')).toHaveCount(2);
  await expect(page.getByRole('dialog', { name: '明日负荷规划' }).getByLabel('安排重点关系知识')).toHaveValue(tomorrow);
  await page.getByLabel('关闭明日负荷规划').click();

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

test('workload planning uses minute capacity rather than the legacy task count limit', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('button', { name: /明日 \d+\/60 分钟/ }).first().click();
  const dialog = page.getByRole('dialog', { name: '明日负荷规划' });
  await expect(dialog.locator('.eb-workload-card')).toHaveCount(4);
  await expect(dialog).toContainText('重点关系知识');
  await expect(dialog).toContainText('额外复习主题C');
  await expect(dialog).toContainText('额外复习主题D');
  await dialog.getByRole('button', { name: '全部安排明天' }).click();
  await expect(dialog.getByLabel(/安排/)).toHaveCount(4);
  await expect(dialog).toContainText('明日预计');
  await dialog.getByRole('button', { name: '保存负荷规划' }).click();

  await expect.poll(async () => {
    const data = await readPersistedStore<{ reviewTasks?: Array<{ rollingPlanDate?: string; rollingDecision?: string }> }>(
      page,
      'ebb_data',
      'smart-ebb-data',
    );
    return data?.reviewTasks?.filter((task) => task.rollingPlanDate === tomorrow && task.rollingDecision === 'keep').length;
  }).toBe(4);
});

test('reopening the same workload plan does not double-count deferrals and can revise dates', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('button', { name: /明日 \d+\/60 分钟/ }).first().click();
  let dialog = page.getByRole('dialog', { name: '明日负荷规划' });
  await dialog.getByLabel('安排重点关系知识').selectOption(dayAfterTomorrow);
  await dialog.getByLabel('安排常规关系知识').selectOption(dayAfterTomorrow);
  await dialog.getByRole('button', { name: '保存负荷规划' }).click();

  await page.getByRole('button', { name: /明日 \d+\/60 分钟/ }).first().click();
  dialog = page.getByRole('dialog', { name: '明日负荷规划' });
  await expect(dialog.locator('.eb-workload-card')).toHaveCount(2);
  await expect(dialog.getByLabel('安排重点关系知识')).toHaveValue(dayAfterTomorrow);
  await dialog.getByRole('button', { name: '保存负荷规划' }).click();

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

  await page.getByRole('button', { name: /明日 \d+\/60 分钟/ }).first().click();
  dialog = page.getByRole('dialog', { name: '明日负荷规划' });
  await dialog.getByLabel('安排重点关系知识').selectOption(tomorrow);
  await dialog.getByRole('button', { name: '保存负荷规划' }).click();

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

test('daily schedule exposes the same workload planning transaction', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  await page.getByRole('button', { name: '明日负荷规划' }).click();
  const dialog = page.getByRole('dialog', { name: '明日负荷规划' });
  await expect(dialog.locator('.eb-workload-card')).toHaveCount(2);
  await dialog.getByLabel('安排重点关系知识').selectOption(tomorrow);
  await dialog.getByLabel('安排常规关系知识').selectOption(dayAfterTomorrow);
  await dialog.getByRole('button', { name: '保存负荷规划' }).click();
  await expect(page.getByRole('status')).toContainText(/明天保留 1 轮；另外 1 轮已调整至/);

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

  await page.getByRole('button', { name: '查看这些改期' }).click();
  const adjustment = page.getByRole('dialog', { name: '复习计划调整中心' });
  await expect(adjustment).toBeVisible();
  await expect(adjustment.locator('details.eb-adjust-preview-details')).toHaveAttribute('open', '');
});

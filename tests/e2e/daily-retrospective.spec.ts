import { expect, test, type Page } from '@playwright/test';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

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

const writePersistedStore = async (
  page: Page,
  storeName: string,
  key: string,
  value: unknown,
): Promise<void> => page.evaluate(
  ({ requestedStore, requestedKey, requestedValue }) => new Promise<void>((resolve, reject) => {
    const openRequest = indexedDB.open('smart-timeline');
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction(requestedStore, 'readwrite');
      transaction.objectStore(requestedStore).put(requestedValue, requestedKey);
      transaction.oncomplete = () => { database.close(); resolve(); };
      transaction.onerror = () => reject(transaction.error);
    };
  }),
  { requestedStore: storeName, requestedKey: key, requestedValue: value },
);

const timeline = {
  tasks: [{
    id: 'retro-project',
    name: '复盘测试项目',
    start: today,
    end: today,
    color: '#818cf8',
    blocks: [
      {
        type: 'smart-task',
        id: 'standard-block',
        header: {
          title: '完成核心任务',
          tag: '重点',
          tagColor: '#818cf8',
          date: today,
          duration: 30,
          isCompleted: true,
          completedDate: today,
          graphNodeIds: ['retro-node-a', 'retro-node-b'],
          autoSyncEbb: true,
        },
        body: '',
      },
      {
        type: 'smart-task',
        id: 'quantity-block',
        header: {
          taskKind: 'quantity',
          title: '刷题进度',
          tag: '数量',
          tagColor: '#10b981',
          date: today,
          duration: 0,
          isCompleted: false,
          graphNodeIds: ['retro-node-a'],
          quantityUnit: '题',
          quantityTotal: 100,
          quantityInitialCompleted: 10,
          quantityRecords: { [today]: 20 },
        },
        body: '',
      },
    ],
  }],
  groups: [],
  notes: [],
  milestones: [],
};

const graph = {
  nodes: [
    { id: 'retro-node-a', name: '复盘节点A', parentId: null, createdAt: 1, status: 'activated' },
    { id: 'retro-node-b', name: '复盘节点B', parentId: null, createdAt: 2, status: 'activated' },
  ],
};

const ebb = {
  reviewTasks: [
    {
      id: 'manual-review',
      topicName: '手动复习知识',
      graphNodeId: 'retro-node-a',
      dueDate: today,
      originalDueDate: today,
      roundOrder: 1,
      isCompleted: true,
      completedDate: today,
      completionSource: 'manual',
      smStatus: 'confirmed',
    },
    {
      id: 'auto-review',
      topicName: '自动联动复习',
      graphNodeId: 'retro-node-b',
      dueDate: today,
      originalDueDate: today,
      roundOrder: 1,
      isCompleted: true,
      completedDate: today,
      completionSource: 'project-task',
      completionSourceTaskId: 'retro-project',
      completionSourceBlockId: 'standard-block',
      smStatus: 'confirmed',
    },
  ],
  inboxItems: [],
  outlineNodes: [],
  ebbSettings: {},
};

const schedules = {
  [today]: {
    date: today,
    items: [{
      id: 'free-item',
      sourceId: 'free-retro-life',
      name: '晚间散步',
      source: 'free',
      timeSlot: 'evening',
      order: 0,
      completed: true,
      completedDate: today,
    }],
    blocks: [],
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ timelineData, graphData, ebbData, dailyData }) => {
    if (sessionStorage.getItem('daily-retrospective-seeded') === 'true') return;
    localStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify(timelineData));
    localStorage.setItem('line-graph-storage:mirror', JSON.stringify(graphData));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify(ebbData));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify(dailyData));
    sessionStorage.setItem('daily-retrospective-seeded', 'true');
  }, { timelineData: timeline, graphData: graph, ebbData: ebb, dailyData: schedules });
  await page.goto('/');
});

test('daily retrospective aggregates every completion, saves once and exposes multi-node records', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  await page.getByRole('button', { name: '每日复盘' }).click();

  const dialog = page.getByRole('dialog', { name: '每日复盘' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('已完成 4 项');

  await dialog.getByRole('button', { name: '完成核心任务' }).click();
  await dialog.getByLabel('复盘内容').fill('多节点知识已经形成联系');
  await dialog.getByRole('button', { name: '收获' }).click();

  await dialog.getByRole('button', { name: '待关联' }).click();
  await expect(dialog).toContainText('晚间散步');
  await dialog.getByLabel('为晚间散步选择知识节点').selectOption('retro-node-a');
  await expect(dialog).toContainText('当前没有待关联内容');

  await dialog.getByRole('button', { name: '总体复盘' }).click();
  await expect(dialog).toContainText('1 个复习轮次由项目任务自动联动完成');
  await dialog.getByRole('button', { name: '自动汇总' }).click();
  await expect(dialog.getByLabel('总体复盘')).toContainText('多节点知识已经形成联系');
  await dialog.getByRole('button', { name: '完成复盘' }).click();

  await expect(page.getByRole('button', { name: '每日复盘' })).toContainText('已完成');
  await expect.poll(async () => {
    const persisted = await readPersistedStore<Record<string, {
      status: string;
      entries: Array<{ title: string; nodeIds: string[]; categories: string[]; completionSource?: string }>;
    }>>(page, 'daily_schedule_data', 'daily-retrospective-data');
    const retrospective = persisted?.[today];
    return {
      status: retrospective?.status,
      titles: retrospective?.entries.map((entry) => entry.title).sort(),
      multiNodeCount: retrospective?.entries.find((entry) => entry.title === '完成核心任务')?.nodeIds.length,
      lifeNodeCount: retrospective?.entries.find((entry) => entry.title === '晚间散步')?.nodeIds.length,
      insightCount: retrospective?.entries.find((entry) => entry.title === '完成核心任务')?.categories.length,
      autoCount: retrospective?.entries.filter((entry) => entry.completionSource === 'project-task').length,
    };
  }).toEqual({
    status: 'completed',
    titles: ['刷题进度', '完成核心任务', '手动复习知识', '晚间散步', '自动联动复习'].sort(),
    multiNodeCount: 2,
    lifeNodeCount: 1,
    insightCount: 1,
    autoCount: 1,
  });

  await page.reload();
  await page.getByTitle('每日安排').click();
  await expect(page.getByRole('button', { name: '每日复盘' })).toContainText('已完成');

  const reboundTimeline = await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('smart-timeline-data:mirror') ?? 'null');
    const block = raw?.tasks?.[0]?.blocks?.find((candidate: { id?: string }) => candidate.id === 'standard-block');
    if (block?.header) block.header.graphNodeIds = ['retro-node-b'];
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify(raw));
    return raw;
  });
  await writePersistedStore(page, 'timeline_data', 'smart-timeline-data', reboundTimeline);
  await page.reload();
  await page.getByTitle('每日安排').click();
  await page.getByRole('button', { name: '每日复盘' }).click();
  const historicalDialog = page.getByRole('dialog', { name: '每日复盘' });
  await historicalDialog.getByRole('button', { name: '完成核心任务' }).click();
  await expect(historicalDialog.getByRole('button', { name: '复盘节点A ×' })).toBeVisible();
  await expect(historicalDialog.getByRole('button', { name: '复盘节点B ×' })).toBeVisible();
  await historicalDialog.getByRole('button', { name: '关闭每日复盘' }).click();

  await page.waitForTimeout(800);
  const incompleteTimeline = await page.evaluate((date) => {
    const raw = JSON.parse(localStorage.getItem('smart-timeline-data:mirror') ?? 'null');
    const block = raw?.tasks?.[0]?.blocks?.find((candidate: { id?: string }) => candidate.id === 'quantity-block');
    if (block?.header?.quantityRecords) {
      delete block.header.quantityRecords[date];
    }
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify(raw));
    return raw;
  }, today);
  await writePersistedStore(page, 'timeline_data', 'smart-timeline-data', incompleteTimeline);
  await page.reload();
  await page.getByTitle('每日安排').click();
  await page.getByRole('button', { name: '每日复盘' }).click();
  const changedDialog = page.getByRole('dialog', { name: '每日复盘' });
  await changedDialog.getByRole('button', { name: '刷题进度' }).click();
  await expect(changedDialog.getByText('任务完成状态已变化', { exact: true })).toBeVisible();
  await changedDialog.getByRole('button', { name: '关闭每日复盘' }).click();

  await page.getByTitle('知识大盘').click();
  await page.getByRole('button', { name: '知识节点：复盘节点A' }).click();
  const records = page.getByRole('region', { name: '复盘记录' });
  await expect(records).toBeVisible();
  await expect(records.getByText('完成核心任务', { exact: true })).toBeVisible();
  await expect(records.getByText('多节点知识已经形成联系', { exact: true })).toBeVisible();
  await expect(records.getByText('任务完成状态已变化', { exact: true }).first()).toBeVisible();
  await records.getByRole('button', { name: '收获' }).click();
  await expect(records.getByText('完成核心任务', { exact: true })).toBeVisible();
  await expect(records.getByText('晚间散步', { exact: true })).not.toBeVisible();

  await page.getByRole('button', { name: '归档节点' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '继续' }).click();
  await page.getByTitle(/归档库/).click();
  await page.getByLabel('搜索归档知识节点').fill('复盘节点A');
  await page.getByRole('button', { name: '复盘节点A' }).click();
  const archivedRecords = page.getByRole('region', { name: '复盘记录' });
  await expect(archivedRecords).toBeVisible();
  await expect(archivedRecords.getByText('完成核心任务', { exact: true })).toBeVisible();
  await expect(archivedRecords.getByText('多节点知识已经形成联系', { exact: true })).toBeVisible();
});

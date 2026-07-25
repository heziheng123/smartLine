import { expect, test, type Page } from '@playwright/test';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());
const todayDayOfWeek = new Date(`${today}T12:00:00+08:00`).getDay();
const todayCapacityMinutes = todayDayOfWeek === 0 || todayDayOfWeek === 6 ? 360 : 240;

function addIsoDays(date: string, amount: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function saturdayOfCurrentWeek(date: string): string {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addIsoDays(date, day === 0 ? -1 : 6 - day);
}

const project = {
  id: 'backlog-project',
  name: '机动任务测试项目',
  start: today,
  end: today,
  color: '#3b82f6',
  blocks: [
    {
      type: 'smart-task',
      id: 'scheduled-block',
      header: {
        title: '已排期六十分钟任务',
        tag: '学习',
        tagColor: '#2563eb',
        date: today,
        duration: 60,
        deadline: addIsoDays(today, 10),
        graphNodeIds: ['backlog-knowledge-node'],
        isCompleted: false,
        autoSyncEbb: false,
      },
      body: '',
    },
    {
      type: 'smart-task',
      id: 'backlog-block',
      header: {
        title: '待排期整理错题',
        tag: '学习',
        tagColor: '#2563eb',
        duration: 45,
        deadline: today,
        isCompleted: false,
        autoSyncEbb: false,
      },
      body: '',
    },
    {
      type: 'smart-task',
      id: 'archived-backlog-block',
      header: {
        title: '不应出现的归档任务',
        tag: '学习',
        tagColor: '#2563eb',
        duration: 30,
        isCompleted: false,
        isArchived: true,
      },
      body: '',
    },
    {
      type: 'smart-task',
      id: 'quantity-block',
      header: {
        taskKind: 'quantity',
        title: '不应进入箱子的数量任务',
        tag: '背诵',
        tagColor: '#10b981',
        date: today,
        duration: 0,
        isCompleted: false,
        quantityUnit: '页',
        quantityTotal: 10,
        quantityInitialCompleted: 0,
        quantityRecords: {},
      },
      body: '',
    },
    ...Array.from({ length: 25 }, (_, index) => ({
      type: 'smart-task',
      id: `extra-backlog-${index + 1}`,
      header: {
        title: `额外待排期任务 ${index + 1}`,
        tag: index % 2 === 0 ? '学习' : '默认',
        tagColor: index % 2 === 0 ? '#2563eb' : '#f59e0b',
        duration: 30,
        isCompleted: false,
        autoSyncEbb: false,
      },
      body: '',
    })),
  ],
};

const daily = {
  [today]: {
    date: today,
    items: [{
      id: 'scheduled-item',
      sourceId: 'project-blk:backlog-project::scheduled-block',
      name: '已排期六十分钟任务',
      source: 'project',
      timeSlot: 'morning',
      order: 0,
      duration: 60,
    }],
    blocks: [],
  },
};

const ebb = {
  reviewTasks: [{
    id: 'backlog-review',
    topicName: '三十分钟复习',
    dueDate: today,
    originalDueDate: today,
    roundOrder: 1,
    isCompleted: false,
    smStatus: 'scheduled',
  }],
  inboxItems: [],
  outlineNodes: [],
  ebbSettings: {},
};

async function openDailyBacklog(page: Page) {
  await page.getByTitle('每日安排').click();
  const trigger = page.locator('.ds-task-pool-trigger');
  if (await trigger.isVisible()) await trigger.click();
  await page.getByRole('tab', { name: /待排期箱/ }).click();
}

async function readIndexedValue(page: Page, storeName: string, key: string) {
  return page.evaluate(({ store, storageKey }) => new Promise<unknown>((resolve, reject) => {
    const request = indexedDB.open('smart-timeline');
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(store, 'readonly');
      const getRequest = transaction.objectStore(store).get(storageKey);
      getRequest.onsuccess = () => {
        resolve(getRequest.result ?? null);
        database.close();
      };
      getRequest.onerror = () => {
        reject(getRequest.error);
        database.close();
      };
    };
    request.onerror = () => reject(request.error);
  }), { store: storeName, storageKey: key });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ taskData, dailyData, ebbData }) => {
    if (sessionStorage.getItem('backlog-e2e-seeded') === '1') return;
    sessionStorage.setItem('backlog-e2e-seeded', '1');
    localStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({
      tasks: [taskData],
      groups: [],
      notes: [],
      milestones: [],
    }));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify(dailyData));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify(ebbData));
  }, { taskData: project, dailyData: daily, ebbData: ebb });
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
});

test('week matrix shows de-duplicated workload and the filtered backlog count', async ({ page }) => {
  await page.getByTitle('周矩阵').click();
  const todayHeader = page.locator(`.wmv-row--header [data-date="${today}"]`);
  await expect(todayHeader.locator('.wmv-load-label')).toHaveText(`3项 · 90/${todayCapacityMinutes}m`);
  await expect(page.getByRole('button', { name: '待排期箱，26 个任务' })).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) > 900) {
    const [workspaceBox, contentBox] = await Promise.all([
      page.locator('.week-matrix-workspace').boundingBox(),
      page.locator('.week-matrix-content').boundingBox(),
    ]);
    expect(workspaceBox).not.toBeNull();
    expect(contentBox).not.toBeNull();
    expect(Math.abs(workspaceBox!.width - contentBox!.width)).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: '待排期箱，26 个任务' }).click();
  const backlog = page.getByRole('region', { name: '待排期任务箱' });
  await expect(backlog.getByText('待排期整理错题', { exact: true })).toBeVisible();
  await expect(backlog.getByText('选择日期', { exact: true })).toHaveCount(0);
  await expect(backlog.getByText('不应出现的归档任务')).toHaveCount(0);
  await expect(backlog.getByText('不应进入箱子的数量任务')).toHaveCount(0);
  await backlog.getByLabel('按预计时长筛选').selectOption('short');
  await expect(backlog.getByText('待排期整理错题', { exact: true })).toHaveCount(0);
  await backlog.getByLabel('按预计时长筛选').selectOption('medium');
  await expect(backlog.getByText('待排期整理错题', { exact: true })).toBeVisible();
  await backlog.getByLabel('按截止状态筛选').selectOption('none');
  await expect(backlog.getByText('待排期整理错题', { exact: true })).toHaveCount(0);
});

test('docked backlog leaves Saturday reachable and supports dropping on the date header', async ({ page }) => {
  const saturday = saturdayOfCurrentWeek(today);
  await page.getByTitle('周矩阵').click();
  await page.getByRole('button', { name: '待排期箱，26 个任务' }).click();

  const panel = page.getByRole('region', { name: '待排期任务箱' });
  const saturdayHeader = page.locator(`.wmv-row--header [data-date="${saturday}"]`);
  await expect(panel).toBeVisible();
  await expect(page.locator('.wmv-nav')).toBeVisible();
  await expect(saturdayHeader).toBeVisible();

  if ((page.viewportSize()?.width ?? 0) > 900) {
    const [panelBox, saturdayBox] = await Promise.all([panel.boundingBox(), saturdayHeader.boundingBox()]);
    expect(panelBox).not.toBeNull();
    expect(saturdayBox).not.toBeNull();
    expect(panelBox!.width).toBeLessThanOrEqual(341);
    expect(saturdayBox!.x + saturdayBox!.width).toBeLessThanOrEqual(panelBox!.x + 1);
  }

  const dataTransfer = await page.evaluateHandle((payload) => {
    const transfer = new DataTransfer();
    transfer.setData('application/json', JSON.stringify(payload));
    transfer.effectAllowed = 'move';
    return transfer;
  }, {
    type: 'smart-block',
    source: 'icebox',
    taskId: 'backlog-project',
    blockId: 'backlog-block',
    tag: '学习',
    title: '待排期整理错题',
    fromDate: '',
  });
  await saturdayHeader.dispatchEvent('dragover', { dataTransfer });
  await saturdayHeader.dispatchEvent('drop', { dataTransfer });

  if (saturday > today) {
    const confirmation = page.getByRole('alertdialog');
    await expect(confirmation).toContainText('排期晚于截止日期');
    await confirmation.getByRole('button', { name: '仍然安排' }).click();
  }

  await expect(page.locator(`.wmv-cell[data-date="${saturday}"]`).filter({ hasText: '待排期整理错题' })).toBeVisible();
  await expect(panel.locator('[data-backlog-task-id="backlog:backlog-project::backlog-block"]')).toHaveCount(0);
});

test('daily backlog can schedule directly into a slot and unified undo restores it', async ({ page }) => {
  await openDailyBacklog(page);
  const backlogCard = page.locator('[data-backlog-task-id="backlog:backlog-project::backlog-block"]');
  await expect(backlogCard).toBeVisible();
  await expect(backlogCard.getByText('安排到当天', { exact: true })).toBeVisible();
  await expect(backlogCard.getByText('选择日期', { exact: true })).toHaveCount(0);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('e2e-daily-drag-end', {
      detail: {
        draggableId: 'backlog:backlog-project::backlog-block',
        type: 'DEFAULT',
        source: { droppableId: 'ds-backlog', index: 0 },
        destination: { droppableId: 'ds-slot-morning', index: 1 },
        reason: 'DROP',
        mode: 'FLUID',
        combine: null,
      },
    }));
  });

  await expect(page.locator('.ds-item').filter({ hasText: '待排期整理错题' })).toBeVisible();
  await page.getByTitle('最近操作与回收站').click();
  const latest = page.locator('.operation-history-list article').first();
  await expect(latest).toContainText('安排“待排期整理错题”');
  await latest.getByRole('button', { name: '撤销' }).click();
  await page.getByLabel('关闭最近操作').click();

  await expect(page.locator('.ds-item').filter({ hasText: '待排期整理错题' })).toHaveCount(0);
  await page.getByRole('tab', { name: /待排期箱/ }).click();
  await expect(backlogCard).toBeVisible();
});

test('week task can return to the backlog without losing metadata and inline undo restores every placement', async ({ page }) => {
  await page.getByTitle('周矩阵').click();
  const scheduledCard = page.locator('[data-block-id="scheduled-block"]');
  const backlogCapsule = page.getByRole('button', { name: '待排期箱，26 个任务' });
  await expect(scheduledCard).toBeVisible();
  await expect(backlogCapsule).toBeVisible();

  await page.evaluate((sourceDate) => {
    const source = document.querySelector<HTMLElement>('[data-block-id="scheduled-block"]');
    const destination = document.querySelector<HTMLElement>('[aria-label="待排期箱，26 个任务"]');
    if (!source || !destination) throw new Error('return-to-backlog drag endpoints missing');
    const transfer = new DataTransfer();
    transfer.setData('application/json', JSON.stringify({
      type: 'smart-block',
      source: 'week-matrix',
      taskId: 'backlog-project',
      blockId: 'scheduled-block',
      tag: '学习',
      title: '已排期六十分钟任务',
      fromDate: sourceDate,
    }));
    transfer.effectAllowed = 'move';
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    destination.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    destination.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, today);

  const panel = page.getByRole('region', { name: '待排期任务箱' });
  await expect(panel).toBeVisible();
  await expect(panel.getByText('已将“已排期六十分钟任务”移回待排期箱')).toBeVisible();
  await expect(page.locator('[data-block-id="scheduled-block"]')).toHaveCount(0);
  await expect(panel.locator('[data-backlog-task-id="backlog:backlog-project::scheduled-block"]')).toBeVisible();

  await expect.poll(async () => {
    const timeline = await readIndexedValue(page, 'timeline_data', 'smart-timeline-data') as {
      tasks?: Array<{ id?: string; blocks?: Array<{ id?: string; header?: Record<string, unknown> }> }>;
      groups?: Array<{ children?: Array<{ id?: string; blocks?: Array<{ id?: string; header?: Record<string, unknown> }> }> }>;
    } | null;
    const project = [
      ...(timeline?.tasks ?? []),
      ...(timeline?.groups ?? []).flatMap((group) => group.children ?? []),
    ].find((task) => task.id === 'backlog-project');
    const header = project?.blocks?.find((block: { id?: string }) => block.id === 'scheduled-block')?.header;
    return header ? {
      date: header.date ?? null,
      tag: header.tag,
      duration: header.duration,
      deadline: header.deadline,
      graphNodeIds: header.graphNodeIds,
    } : null;
  }).toEqual({
    date: null,
    tag: '学习',
    duration: 60,
    deadline: addIsoDays(today, 10),
    graphNodeIds: ['backlog-knowledge-node'],
  });
  await expect.poll(async () => {
    const schedules = await readIndexedValue(page, 'daily_schedule_data', 'daily-schedule-data') as Record<string, {
      items?: Array<{ sourceId?: string }>;
      blocks?: Array<{ sourceId?: string }>;
    }> | null;
    return Object.values(schedules ?? {}).flatMap((day) => [
      ...((day as { items?: Array<{ sourceId?: string }> }).items ?? []),
      ...((day as { blocks?: Array<{ sourceId?: string }> }).blocks ?? []),
    ]).filter((item) => item.sourceId === 'project-blk:backlog-project::scheduled-block').length;
  }).toBe(0);

  await panel.getByRole('button', { name: '撤销' }).click();
  await expect(page.locator('[data-block-id="scheduled-block"]')).toHaveCount(1);
  await expect(panel.locator('[data-backlog-task-id="backlog:backlog-project::scheduled-block"]')).toHaveCount(0);
  await expect.poll(async () => {
    const schedules = await readIndexedValue(page, 'daily_schedule_data', 'daily-schedule-data') as Record<string, {
      items?: Array<{ sourceId?: string }>;
    }> | null;
    return Object.values(schedules ?? {}).flatMap((day) =>
      (day as { items?: Array<{ sourceId?: string }> }).items ?? [],
    ).filter((item) => item.sourceId === 'project-blk:backlog-project::scheduled-block').length;
  }).toBe(1);
});

test('daily task menu returns a task to the backlog and persistent undo survives refresh', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: '已排期六十分钟任务' });
  await expect(card).toBeVisible();
  await card.getByLabel('任务菜单：已排期六十分钟任务').click();
  await card.getByRole('menuitem', { name: '移回待排期箱' }).click();

  await expect(page.getByRole('status').filter({ hasText: '已将“已排期六十分钟任务”移回待排期箱' })).toBeVisible();
  await expect(card).toHaveCount(0);

  await page.reload();
  await page.getByTitle('每日安排').click();
  await expect(page.locator('.ds-item').filter({ hasText: '已排期六十分钟任务' })).toHaveCount(0);
  await page.getByTitle('最近操作与回收站').click();
  const latest = page.locator('.operation-history-list article').first();
  await expect(latest).toContainText('将“已排期六十分钟任务”移回待排期箱');
  await expect(latest).toContainText('项目、标签、截止日与时长保持不变');
  await latest.getByRole('button', { name: '撤销' }).click();
  await page.getByLabel('关闭最近操作').click();

  await expect(page.locator('.ds-item').filter({ hasText: '已排期六十分钟任务' })).toBeVisible();
});

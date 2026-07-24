import { expect, test, type Page } from '@playwright/test';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

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

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ taskData, dailyData, ebbData }) => {
    localStorage.clear();
    sessionStorage.clear();
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
  await expect(page.locator('.wmv-load-label').filter({ hasText: '3项 · 90/240m' })).toHaveCount(1);
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

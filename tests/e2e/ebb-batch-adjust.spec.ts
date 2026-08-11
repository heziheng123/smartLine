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

const openEbbMoreAction = async (page: Page, name: '批量管理' | '设置') => {
  if (name === '批量管理') {
    await page.getByRole('button', { name }).click();
    return;
  }
  await page.getByLabel('复习更多操作').click();
  await page.getByRole('menuitem', { name }).click();
};

// 统计卡片（.eb-stat-card）仅在「复习库 / 周计划」标签页下渲染，
// 「今日复习」标签页只显示「今日复习工作台」。需要读取统计卡片时，
// 进入 EBB 后切换到「复习库」标签页（矩阵视图）。
const openEbbLibrary = async (page: Page) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('tab', { name: /复习计划/ }).click();
};

const openAdjustmentCenter = async (page: Page) => {
  await openEbbMoreAction(page, '批量管理');
  const dialog = page.getByRole('dialog', { name: '复习计划调整中心' });
  await expect(dialog).toBeVisible();
  return dialog;
};

const chooseAdvancedAction = async (dialog: ReturnType<Page['getByRole']>, actionName: string) => {
  if (!(await dialog.getByRole('button', { name: /精确调整/ }).isVisible())) {
    await dialog.getByRole('button', { name: /更多调整/ }).click();
  }
  await dialog.getByRole('button', { name: /精确调整/ }).click();
  await dialog.locator('label.eb-batch-action').filter({ hasText: actionName }).click();
};

const openAdjustmentOptions = async (dialog: ReturnType<Page['getByRole']>) => {
  const details = dialog.locator('details.eb-adjust-options');
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.locator('summary').click();
  }
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

test('quick adjustment keeps advanced tools folded and presets update the live rule summary', async ({ page }) => {
  await openEbbLibrary(page);
  const dialog = await openAdjustmentCenter(page);
  await expect(dialog.getByRole('button', { name: /清理逾期与积压/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /平衡未来负荷/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /调整复习节奏/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /管理计划周期/ })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: /温和调整/ })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /均衡调整/ })).toContainText(/轮改期 · 超载 \d+→\d+/);
  await expect(dialog.getByRole('button', { name: /快速清理/ })).toBeVisible();
  await dialog.getByRole('button', { name: /快速清理/ }).click();
  await expect(dialog.locator('details.eb-adjust-options > summary')).toContainText('规划 7 天');
  await openAdjustmentOptions(dialog);
  await expect(dialog.getByLabel('规划范围')).toHaveValue('7');
  await expect(dialog.getByLabel('最大移动范围')).toHaveValue('30');
  await dialog.getByRole('button', { name: /更多调整/ }).click();
  await expect(dialog.getByRole('button', { name: /管理计划周期/ })).toBeVisible();
  await expect(dialog.getByRole('status')).toContainText(/可以安全执行|可以执行，但请注意|当前设置不会改变/);
});

test('batch trim updates rounds, daily references and knowledge color without history-library records', async ({ page }) => {
  await openEbbLibrary(page);
  const totalCard = page.locator('.eb-stat-card').filter({ hasText: '总任务' });
  await expect(totalCard.locator('.eb-stat-value')).toHaveText('4');

  const dialog = await openAdjustmentCenter(page);
  await chooseAdvancedAction(dialog, '精简末尾轮次');
  await openAdjustmentOptions(dialog);
  await dialog.getByLabel('删除轮数').fill('2');
  await expect(dialog.getByLabel('批量调整预览统计')).toContainText('2 轮移除');
  await dialog.getByRole('button', { name: /执行调整 · 1 个计划/ }).click();
  await expect(totalCard.locator('.eb-stat-value')).toHaveText('2');
  await expect(page.getByRole('button', { name: '撤销本次调整' })).toBeVisible();

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
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);
  await openEbbLibrary(page);
  await expect(page.locator('.eb-stat-card').filter({ hasText: '总任务' }).locator('.eb-stat-value')).toHaveText('2');
});

test('batch panel previews shift, append and future-template operations', async ({ page }) => {
  await openEbbLibrary(page);
  const dialog = await openAdjustmentCenter(page);
  await expect(dialog.locator('details.eb-adjust-options')).not.toHaveAttribute('open', '');
  await expect(dialog.locator('details.eb-adjust-disclosure').first()).not.toHaveAttribute('open', '');
  const compactGoalHeights = await dialog.locator('.eb-adjust-goal-grid > button').evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().height));
  expect(Math.max(...compactGoalHeights)).toBeLessThanOrEqual(44);
  await openAdjustmentOptions(dialog);
  const fieldContainment = await dialog.locator('.eb-adjust-form-grid > label').evaluateAll((labels) => labels.map((label) => {
    const field = label.getBoundingClientRect();
    const control = label.querySelector('input,select')?.getBoundingClientRect();
    return !control || (control.left >= field.left && control.right <= field.right && control.top >= field.top && control.bottom <= field.bottom);
  }));
  expect(fieldContainment.every(Boolean)).toBe(true);
  await dialog.locator('details.eb-adjust-options > summary').click();
  await chooseAdvancedAction(dialog, '整体提前或顺延');
  const summary = dialog.getByLabel('批量调整预览统计');
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  if (!box || !viewport) throw new Error('batch dialog has no measurable viewport');
  if (viewport.width > 900) {
    expect(box.width).toBeLessThanOrEqual(1182);
    expect(box.height).toBeLessThanOrEqual(592);
    expect(Math.abs((box.x + box.width / 2) - viewport.width / 2)).toBeLessThan(3);
    expect(Math.abs((box.y + box.height / 2) - viewport.height / 2)).toBeLessThan(3);
    const goalBox = await dialog.locator('.eb-adjust-goals').boundingBox();
    const scopeBox = await dialog.locator('.eb-adjust-scope').boundingBox();
    const previewBox = await dialog.locator('.eb-adjust-preview').boundingBox();
    if (!goalBox || !scopeBox || !previewBox) throw new Error('compact layout regions are not measurable');
    expect(previewBox.x - (goalBox.x + goalBox.width)).toBeGreaterThanOrEqual(12);
    expect(scopeBox.y - (goalBox.y + goalBox.height)).toBeGreaterThanOrEqual(8);
    expect(scopeBox.y - (goalBox.y + goalBox.height)).toBeLessThanOrEqual(14);
  } else if (viewport.width > 720) {
    expect(Math.abs(box.x - 12)).toBeLessThan(2);
    expect(Math.abs(box.width - (viewport.width - 24))).toBeLessThan(2);
    expect(box.height).toBeLessThanOrEqual(592);
    expect(Math.abs((box.y + box.height / 2) - viewport.height / 2)).toBeLessThan(3);
  } else {
    expect(box.x).toBe(0);
    expect(box.y).toBe(0);
    expect(box.width).toBe(viewport.width);
  }

  await expect(summary).toContainText('2 轮改期');

  await chooseAdvancedAction(dialog, '追加轮次');
  await expect(summary).toContainText('1 轮新增');

  await chooseAdvancedAction(dialog, '自定义未来节奏');
  await expect(summary).toContainText('2 轮移除');
  await expect(summary).toContainText('7 轮新增');
  await dialog.locator('details.eb-adjust-preview-details summary').click();
  await expect(dialog.locator('.eb-batch-preview-row').filter({ hasText: '批量颜色联动知识' })).toContainText('4 → 9');

  const sectionLabels = await dialog.locator('.eb-adjust-section-title h4').allTextContents();
  await page.setViewportSize({ width: 820, height: 1180 });
  await expect(dialog).toBeVisible();
  expect(await dialog.locator('.eb-adjust-section-title h4').allTextContents()).toEqual(sectionLabels);
  await expect(dialog.locator('.eb-adjust-page')).toHaveCSS('overflow-x', 'hidden');
});

test('single plan can reanchor all remaining rounds from tomorrow while preserving gaps', async ({ page }) => {
  await openEbbLibrary(page);
  await page.getByLabel('重新安排批量颜色联动知识的剩余轮次').click();
  const panel = page.locator('.eb-panel--rounds');
  await expect(panel).toContainText('重新安排剩余 2 轮');
  await panel.getByRole('button', { name: '重新安排', exact: true }).click();
  await expect(panel.getByLabel('剩余轮次日期预览')).toContainText('R3');
  await expect(panel.getByLabel('剩余轮次日期预览')).toContainText('R4');
  await panel.getByRole('button', { name: '保存调整' }).click();
  await expect(panel.getByRole('status')).toContainText('已从');

  await expect.poll(async () => {
    const data = await readPersistedStore<{ reviewTasks?: Array<{ id: string; dueDate: string }> }>(page, 'ebb_data', 'smart-ebb-data') ?? {};
    return (data.reviewTasks ?? [])
      .filter((task) => task.id === 'batch-r3' || task.id === 'batch-r4')
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => task.dueDate);
  }).toEqual([addDays(today, 1), addDays(today, 9)]);
});

test('appended rounds preserve existing daily arrangements without creating a history entry', async ({ page }) => {
  await openEbbLibrary(page);
  const dialog = await openAdjustmentCenter(page);
  await chooseAdvancedAction(dialog, '追加轮次');
  await dialog.getByRole('button', { name: /执行调整 · 1 个计划/ }).click();
  await expect(page.locator('.eb-stat-card').filter({ hasText: '总任务' }).locator('.eb-stat-value')).toHaveText('5');
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);

  await page.getByTitle('每日安排').click();
  await page.locator('.ds-date-input').fill(dueDates[2]);
  await expect(page.locator('.ds-item').filter({ hasText: '批量颜色联动知识' })).toBeVisible();
});

test('shifted rounds survive refresh and stale daily items stay removed without persistent undo', async ({ page }) => {
  await openEbbLibrary(page);
  const dialog = await openAdjustmentCenter(page);
  await chooseAdvancedAction(dialog, '整体提前或顺延');
  await openAdjustmentOptions(dialog);
  await dialog.getByLabel('移动天数').fill('-2');
  await expect(dialog.getByLabel('批量调整预览统计')).toContainText('2 轮改期');
  await dialog.getByRole('button', { name: /执行调整 · 1 个计划/ }).click();

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
  await openEbbLibrary(page);
  await expect(page.locator('.eb-stat-card').filter({ hasText: '总任务' }).locator('.eb-stat-value')).toHaveText('4');
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);

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
      .filter((entry: { sourceId?: string }) => entry.sourceId === 'review-batch-r3' || entry.sourceId === 'review-batch-r4')
      .length;
  }).toBe(0);
});

test('future template rejects malformed intervals and preserves completed history when applied', async ({ page }) => {
  await openEbbLibrary(page);
  const dialog = await openAdjustmentCenter(page);
  await chooseAdvancedAction(dialog, '自定义未来节奏');
  await openAdjustmentOptions(dialog);
  await dialog.getByLabel('节奏模板').selectOption('custom');
  const intervals = dialog.getByPlaceholder('1, 2, 4, 7, 15');
  await intervals.fill('1, 错误, 7');
  await expect(dialog.getByRole('button', { name: /执行调整/ })).toBeDisabled();

  await intervals.fill('1, 2, 4, 7, 15');
  await expect(dialog.getByLabel('批量调整预览统计')).toContainText('5 轮新增');
  await dialog.getByRole('button', { name: /执行调整 · 1 个计划/ }).click();

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

import { expect, test, type Page } from '@playwright/test';

const formatDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);

const addDays = (date: string, amount: number) => {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return formatDate(value);
};

const today = formatDate(new Date());
const todayValue = new Date(`${today}T12:00:00+08:00`);
const day = todayValue.getUTCDay();
const currentMonday = addDays(today, day === 0 ? -6 : 1 - day);
const nextMonday = addDays(currentMonday, 7);
const movedDate = addDays(nextMonday, 1);

const ebb = {
  reviewTasks: [
    { id: 'matrix-r1', topicName: '矩阵拖拽测试', createdAt: '2026-01-01T00:00:00.000Z', dueDate: addDays(nextMonday, -3), originalDueDate: addDays(nextMonday, -3), roundOrder: 1, isCompleted: true, completedDate: addDays(nextMonday, -3), tag: '政治', complexity: 'normal', smStatus: 'confirmed' },
    { id: 'matrix-r2', topicName: '矩阵拖拽测试', createdAt: '2026-01-01T00:00:00.000Z', dueDate: nextMonday, originalDueDate: nextMonday, roundOrder: 2, isCompleted: false, tag: '政治', complexity: 'normal', smStatus: 'scheduled' },
    { id: 'matrix-r3', topicName: '矩阵拖拽测试', createdAt: '2026-01-01T00:00:00.000Z', dueDate: addDays(nextMonday, 3), originalDueDate: addDays(nextMonday, 3), roundOrder: 3, isCompleted: false, tag: '政治', complexity: 'normal', smStatus: 'scheduled' },
    { id: 'matrix-r4', topicName: '矩阵拖拽测试', createdAt: '2026-01-01T00:00:00.000Z', dueDate: addDays(nextMonday, 10), originalDueDate: addDays(nextMonday, 10), roundOrder: 4, isCompleted: false, tag: '政治', complexity: 'normal', smStatus: 'scheduled' },
    ...Array.from({ length: 14 }, (_, index) => ({
      id: `crowded-${index + 1}`,
      topicName: `高负载日期任务 ${index + 1}`,
      createdAt: new Date(Date.UTC(2026, 1, index + 1)).toISOString(),
      dueDate: nextMonday,
      originalDueDate: nextMonday,
      roundOrder: 1,
      isCompleted: false,
      tag: '其他',
      complexity: 'normal' as const,
      smStatus: 'scheduled' as const,
    })),
  ],
  inboxItems: [], outlineNodes: [], ebbSettings: {},
};

const daily = {
  [nextMonday]: {
    date: nextMonday,
    items: [{ id: 'daily-r2', sourceId: 'review-matrix-r2', name: '矩阵拖拽测试', source: 'review', timeSlot: 'morning', order: 0, duration: 15 }],
    blocks: [],
  },
};

const dragToDay = async (page: Page, cardId: string, date: string) => {
  const source = page.locator(`[data-rfd-draggable-id="${cardId}"]`);
  const target = page.locator(`.eb-week-day[data-date="${date}"]`);
  await source.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('drag target is not visible');
  const sourceY = sourceBox.y + sourceBox.height / 2;
  const targetY = Math.max(190, Math.min(page.viewportSize()?.height ?? 720, sourceY) - 24);
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 4, sourceBox.y + sourceBox.height / 2, { steps: 4 });
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetY, { steps: 12 });
  await page.mouse.up();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ ebbData, dailyData }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify(ebbData));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify(dailyData));
  }, { ebbData: ebb, dailyData: daily });
  await page.goto('/');
  await page.getByTitle('艾宾浩斯复习').click();
  const libraryTab = page.getByRole('tab', { name: '复习计划' });
  if (await libraryTab.count()) await libraryTab.click();
  await page.getByRole('button', { name: '日历' }).click();
  // Calendar navigation lives in the shared plan command bar; BoardView hides
  // its duplicate navigation when embedded here.
  await page.locator('.eb-plan-commands').getByRole('button', { name: '下一周' }).click();
});

test('weekly board shows rounds under dates without topic rows', async ({ page }) => {
  await expect(page.locator('.eb-plan-commands')).toBeVisible();
  await expect(page.locator('.eb-week-board-nav')).toHaveCount(0);
  await expect(page.locator('.eb-cal-sidebar')).toHaveCount(0);
  await expect(page.locator('.eb-week-board-grid')).toBeVisible();
  await expect(page.locator('.eb-week-board-summary')).toContainText('轮');
  await expect(page.locator('.eb-week-day')).toHaveCount(7);
  const card = page.locator('[data-rfd-draggable-id="matrix-r2"]');
  await expect(card).toContainText('R2/4');
  await expect(page.locator(`.eb-week-day[data-date="${nextMonday}"]`)).toContainText('矩阵拖拽测试');
});

test('tablet calendar consolidates duplicate headers and keeps overview controls separate', async ({ page }) => {
  await page.setViewportSize({ width: 1081, height: 898 });

  await expect(page.locator('.eb-week-board-nav')).toHaveCount(0);
  await expect(page.locator('.eb-week-board-toolbar .eb-week-board-summary')).toBeVisible();
  await expect(page.locator('.eb-plan-commands [aria-label="视图切换"]')).toBeVisible();
  await expect(page.locator('[aria-label="视图切换"]')).toHaveCount(1);
});

test('matrix list keeps category statistics and compact filter controls', async ({ page }) => {
  await page.getByRole('button', { name: '列表' }).click();
  await expect(page.locator('.eb-mini-cal')).toHaveCount(0);
  await expect(page.locator('.eb-tag-stats')).toBeVisible();
  await expect(page.locator('.eb-filter-popover-wrap')).toHaveCount(3);
  await expect(page.locator('.eb-topic-row').filter({ hasText: '矩阵拖拽测试' })).toBeVisible();
});

test('matrix sorts plans by generation time in both directions and reveals the basis', async ({ page }) => {
  await page.getByRole('button', { name: '列表' }).click();
  const sortMenu = page.locator('.eb-filter-popover-wrap').nth(2);

  await sortMenu.locator('summary').click();
  await sortMenu.getByRole('button', { name: '按生成时间（新→旧）' }).click();
  await expect(page.locator('.eb-topic-row').first()).toContainText('高负载日期任务 14');
  await expect(page.locator('.eb-topic-row').first().locator('.eb-topic-row-created')).toContainText('生成于');

  await expect(sortMenu).toHaveAttribute('open', '');
  await sortMenu.getByRole('button', { name: '按生成时间（旧→新）' }).click();
  await expect(page.locator('.eb-topic-row').first()).toContainText('矩阵拖拽测试');
});

test('calendar follows the shared weekly navigation', async ({ page }) => {
  const commands = page.locator('.eb-plan-commands');
  const weekLabel = commands.locator('.eb-plan-week-label');
  const initialWeek = await weekLabel.textContent();
  await commands.getByRole('button', { name: '上一周' }).click();
  await expect(weekLabel).not.toHaveText(initialWeek ?? '');
  await expect(page.locator('.eb-week-day')).toHaveCount(7);
  await commands.getByRole('button', { name: '下一周' }).click();
  await expect(weekLabel).toHaveText(initialWeek ?? '');
});

test('dragging a round asks for scope and can shift following rounds atomically', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'small-screen', 'Pointer drag behavior is covered in desktop Chromium; small-screen week/month scrolling is covered separately.');
  await dragToDay(page, 'matrix-r2', movedDate);
  const dialog = page.getByRole('dialog', { name: '选择轮次改期范围' });
  await expect(dialog).toContainText('矩阵拖拽测试 · R2');
  await expect(dialog).toContainText(`${nextMonday}→${movedDate}`);
  await dialog.getByRole('button', { name: /R2 及后续一起移动/ }).click();

  const state = await page.evaluate(async () => {
      const { useEbbStore, useDailyScheduleStore } = await import('/src/testing/workspaceStoreAccess.ts');
    return {
      dates: Object.fromEntries(useEbbStore.getState().reviewTasks.map((task) => [task.id, task.dueDate])),
      mondaySources: useDailyScheduleStore.getState().schedules[Object.keys(useDailyScheduleStore.getState().schedules)[0]]?.items.map((item) => item.sourceId) ?? [],
    };
  });
  expect(state.dates['matrix-r2']).toBe(movedDate);
  expect(state.dates['matrix-r3']).toBe(addDays(nextMonday, 4));
  expect(state.dates['matrix-r4']).toBe(addDays(nextMonday, 11));
  expect(state.mondaySources).not.toContain('review-matrix-r2');
});

test('dragging a round can change only that round without moving later rounds', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'small-screen', 'Pointer drag behavior is covered in desktop Chromium; small-screen week/month scrolling is covered separately.');
  await dragToDay(page, 'matrix-r2', movedDate);
  const dialog = page.getByRole('dialog', { name: '选择轮次改期范围' });
  await dialog.getByRole('button', { name: /仅调整 R2/ }).click();

  const dates = await page.evaluate(async () => {
      const { useEbbStore } = await import('/src/testing/workspaceStoreAccess.ts');
    return Object.fromEntries(useEbbStore.getState().reviewTasks.map((task) => [task.id, task.dueDate]));
  });
  expect(dates['matrix-r2']).toBe(movedDate);
  expect(dates['matrix-r3']).toBe(addDays(nextMonday, 3));
  expect(dates['matrix-r4']).toBe(addDays(nextMonday, 10));
});

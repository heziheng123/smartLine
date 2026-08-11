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
    { id: 'matrix-r1', topicName: '矩阵拖拽测试', dueDate: addDays(nextMonday, -3), originalDueDate: addDays(nextMonday, -3), roundOrder: 1, isCompleted: true, completedDate: addDays(nextMonday, -3), tag: '政治', complexity: 'normal', smStatus: 'confirmed' },
    { id: 'matrix-r2', topicName: '矩阵拖拽测试', dueDate: nextMonday, originalDueDate: nextMonday, roundOrder: 2, isCompleted: false, tag: '政治', complexity: 'normal', smStatus: 'scheduled' },
    { id: 'matrix-r3', topicName: '矩阵拖拽测试', dueDate: addDays(nextMonday, 3), originalDueDate: addDays(nextMonday, 3), roundOrder: 3, isCompleted: false, tag: '政治', complexity: 'normal', smStatus: 'scheduled' },
    { id: 'matrix-r4', topicName: '矩阵拖拽测试', dueDate: addDays(nextMonday, 10), originalDueDate: addDays(nextMonday, 10), roundOrder: 4, isCompleted: false, tag: '政治', complexity: 'normal', smStatus: 'scheduled' },
    ...Array.from({ length: 14 }, (_, index) => ({
      id: `crowded-${index + 1}`,
      topicName: `高负载日期任务 ${index + 1}`,
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
  await page.getByRole('tab', { name: '复习计划' }).click();
  await page.getByRole('button', { name: '日历' }).click();
  await page.locator('.eb-week-board-nav').getByRole('button', { name: '下一周' }).click();
});

test('weekly board shows rounds under dates without topic rows', async ({ page }) => {
  const inlineStats = page.locator('.eb-nav > .eb-stats-bar');
  await expect(inlineStats).toBeVisible();
  await expect(page.locator('.eb-stats-bar--retired')).toBeHidden();
  const statsHeight = await inlineStats.evaluate((element) => element.getBoundingClientRect().height);
  expect(statsHeight).toBeLessThanOrEqual(34);
  await expect(page.locator('.eb-cal-sidebar')).toHaveCount(0);
  await expect(page.locator('.eb-week-board-grid')).toBeVisible();
  await expect(page.locator('.eb-week-board-summary')).toContainText('轮');
  await expect(page.locator('.eb-week-day')).toHaveCount(7);
  const card = page.locator('[data-rfd-draggable-id="matrix-r2"]');
  await expect(card).toContainText('R2/4');
  await expect(page.locator(`.eb-week-day[data-date="${nextMonday}"]`)).toContainText('矩阵拖拽测试');
});

test('matrix replaces the mini calendar with a compact week selector and highlights the selected date', async ({ page }) => {
  await page.getByRole('button', { name: '列表' }).click();
  await expect(page.locator('.eb-mini-cal')).toHaveCount(0);
  const strip = page.locator('.eb-compact-week');
  await expect(strip).toBeVisible();
  await strip.locator('button[title*="15 个复习轮次"]').click();
  await expect(page.locator('.eb-topic-row.is-date-match').filter({ hasText: '矩阵拖拽测试' })).toBeVisible();
});

test('month mode keeps date columns and scrolls horizontally through the whole month', async ({ page }) => {
  await page.getByRole('group', { name: '轮次排期时间范围' }).getByRole('button', { name: '月', exact: true }).click();
  const expectedDays = new Date(Number(nextMonday.slice(0, 4)), Number(nextMonday.slice(5, 7)), 0).getDate();
  await expect(page.locator('.eb-week-day')).toHaveCount(expectedDays);
  const grid = page.locator('.eb-week-board-grid');
  const dimensions = await grid.evaluate((element) => ({ clientWidth: element.clientWidth, scrollWidth: element.scrollWidth }));
  expect(dimensions.scrollWidth).toBeGreaterThan(dimensions.clientWidth);
  const scrolled = await grid.evaluate((element) => {
    element.scrollLeft = element.scrollWidth;
    return element.scrollLeft;
  });
  expect(scrolled).toBeGreaterThan(0);
});

test('dragging a round asks for scope and can shift following rounds atomically', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name === 'small-screen', 'Pointer drag behavior is covered in desktop Chromium; small-screen week/month scrolling is covered separately.');
  await dragToDay(page, 'matrix-r2', movedDate);
  const dialog = page.getByRole('dialog', { name: '选择轮次改期范围' });
  await expect(dialog).toContainText('矩阵拖拽测试 · R2');
  await expect(dialog).toContainText(`${nextMonday}→${movedDate}`);
  await dialog.getByRole('button', { name: /R2 及后续一起移动/ }).click();

  const state = await page.evaluate(async () => {
    const { useEbbStore } = await import('/src/ebb/store.ts');
    const { useDailyScheduleStore } = await import('/src/components/dailySchedule/store.ts');
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
    const { useEbbStore } = await import('/src/ebb/store.ts');
    return Object.fromEntries(useEbbStore.getState().reviewTasks.map((task) => [task.id, task.dueDate]));
  });
  expect(dates['matrix-r2']).toBe(movedDate);
  expect(dates['matrix-r3']).toBe(addDays(nextMonday, 3));
  expect(dates['matrix-r4']).toBe(addDays(nextMonday, 10));
});

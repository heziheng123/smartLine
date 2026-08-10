import { expect, test, type Page } from '@playwright/test';

const formatShanghaiDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);
const addDays = (date: string, amount: number) => {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return formatShanghaiDate(value);
};
const today = formatShanghaiDate(new Date());
const firstDate = addDays(today, -3);
const customNextDate = addDays(today, 12);

const reviewTasks = [
  {
    id: 'final-r1',
    topicName: '末轮提醒测试',
    dueDate: firstDate,
    originalDueDate: firstDate,
    roundOrder: 1,
    isCompleted: true,
    completedDate: firstDate,
    tag: '默认',
    smStatus: 'confirmed',
  },
  {
    id: 'final-r2',
    topicName: '末轮提醒测试',
    dueDate: today,
    originalDueDate: today,
    roundOrder: 2,
    isCompleted: false,
    tag: '默认',
    smStatus: 'scheduled',
  },
  {
    id: 'middle-r1',
    topicName: '非末轮测试',
    dueDate: today,
    originalDueDate: today,
    roundOrder: 1,
    isCompleted: false,
    tag: '默认',
    smStatus: 'scheduled',
  },
  {
    id: 'middle-r2',
    topicName: '非末轮测试',
    dueDate: addDays(today, 4),
    originalDueDate: addDays(today, 4),
    roundOrder: 2,
    isCompleted: false,
    tag: '默认',
    smStatus: 'scheduled',
  },
];

const seed = {
  reviewTasks,
  inboxItems: [],
  outlineNodes: [],
  ebbSettings: {},
};

const daily = {
  [today]: {
    date: today,
    items: [{
      id: 'daily-final-review',
      sourceId: 'review-final-r2',
      name: '末轮提醒测试',
      source: 'review',
      timeSlot: 'morning',
      order: 0,
      duration: 30,
    }],
    blocks: [],
  },
};

const openReviewTopic = async (page: Page, topicName: string) => {
  await page.getByTitle('艾宾浩斯复习').click();
  // 主题行（.eb-topic-row-main）位于「复习库」标签页的矩阵视图中，
  // 「今日复习」标签页不渲染主题行，因此需要先切换到「复习库」。
  await page.getByRole('tab', { name: /复习库/ }).click();
  const row = page.locator('.eb-topic-row-main').filter({ hasText: topicName });
  await expect(row).toBeVisible();
  await row.click();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ ebbData, dailyData }) => {
    if (sessionStorage.getItem('final-review-seeded') === '1') return;
    localStorage.clear();
    sessionStorage.clear();
    sessionStorage.setItem('final-review-seeded', '1');
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify(ebbData));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify(dailyData));
  }, { ebbData: seed, dailyData: daily });
  await page.goto('/');
});

test('review topic base duration and per-round override persist independently', async ({ page }) => {
  await openReviewTopic(page, '末轮提醒测试');
  await page.getByLabel('管理末轮提醒测试的全部轮次').click();
  const panel = page.locator('.eb-panel--rounds');
  await expect(panel).toContainText('当前基础 15 分钟');

  await panel.getByRole('group', { name: '主题基础时长' }).getByRole('button', { name: '30m', exact: true }).click();
  await expect(panel).toContainText('当前基础 30 分钟');
  const secondRoundDuration = panel.getByLabel('第2轮预计时长');
  await expect(secondRoundDuration.locator('option[value="auto"]')).toHaveText('自动 25m');
  await secondRoundDuration.selectOption('45');
  await expect(secondRoundDuration).toHaveValue('45');

  await page.reload();
  await openReviewTopic(page, '末轮提醒测试');
  await page.getByLabel('管理末轮提醒测试的全部轮次').click();
  const reopenedPanel = page.locator('.eb-panel--rounds');
  await expect(reopenedPanel).toContainText('当前基础 30 分钟');
  await expect(reopenedPanel.getByLabel('第2轮预计时长')).toHaveValue('45');
});

test('last round cancel is mutation-free and finishing remains committed without a history library', async ({ page }) => {
  await openReviewTopic(page, '末轮提醒测试');
  const toggle = page.getByLabel('标记第 2 轮完成');
  await toggle.click();

  const dialog = page.getByRole('dialog', { name: '这是当前最后一轮复习' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('第 2 轮');
  await expect(dialog.getByLabel('下一轮日期')).not.toHaveValue('');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(toggle).toBeVisible();
  await expect(page.getByLabel('标记第 3 轮完成')).toHaveCount(0);

  await toggle.click();
  await dialog.getByRole('button', { name: '完成并结束计划' }).click();
  await expect(page.getByLabel('取消第 2 轮完成')).toBeVisible();
  await expect(page.getByLabel('标记第 3 轮完成')).toHaveCount(0);
  await expect(page.getByText('已完成最后一轮，当前复习计划已结束')).toBeVisible();
  await page.reload();
  await openReviewTopic(page, '末轮提醒测试');
  await expect(page.getByLabel('取消第 2 轮完成')).toBeVisible();
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);
});

test('append uses the edited date and persists the whole transaction without history records', async ({ page }) => {
  await openReviewTopic(page, '末轮提醒测试');
  await page.getByLabel('标记第 2 轮完成').click();
  const dialog = page.getByRole('dialog', { name: '这是当前最后一轮复习' });
  await dialog.getByLabel('下一轮日期').fill(customNextDate);
  await dialog.getByRole('button', { name: /完成并增加一轮/ }).click();

  await expect(page.getByLabel('取消第 2 轮完成')).toBeVisible();
  const nextRound = page.getByLabel('标记第 3 轮完成');
  await expect(nextRound).toBeVisible();
  await expect(nextRound).toContainText(customNextDate.slice(5).replace('-', '.'));
  await expect(page.getByText(new RegExp(`已完成第 2 轮，并增加第 3 轮：${customNextDate}`))).toBeVisible();
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);

  await page.reload();
  await openReviewTopic(page, '末轮提醒测试');
  await expect(page.getByLabel('标记第 3 轮完成')).toContainText(customNextDate.slice(5).replace('-', '.'));
  await expect(page.getByLabel('取消第 2 轮完成')).toBeVisible();
});

test('non-final rounds stay direct while daily schedule uses the same final-round decision', async ({ page }) => {
  await openReviewTopic(page, '非末轮测试');
  await page.getByLabel('标记第 1 轮完成').click();
  await expect(page.getByRole('dialog', { name: '这是当前最后一轮复习' })).toHaveCount(0);
  await expect(page.getByLabel('取消第 1 轮完成')).toBeVisible();

  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: '末轮提醒测试' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: '完成：末轮提醒测试' }).click();
  const dialog = page.getByRole('dialog', { name: '这是当前最后一轮复习' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '完成并结束计划' }).click();
  await expect(card).toHaveClass(/ds-item--completed/);
});

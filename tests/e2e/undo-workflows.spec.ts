import { expect, test, type Page } from '@playwright/test';

const formatShanghaiDate = (date: Date) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(date);
const addTestDays = (date: string, amount: number) => {
  const value = new Date(`${date}T12:00:00+08:00`);
  value.setUTCDate(value.getUTCDate() + amount);
  return formatShanghaiDate(value);
};
const testDate = formatShanghaiDate(new Date());
const testDayOfWeek = new Date(`${testDate}T12:00:00+08:00`).getUTCDay();
const weekMoveTargetDate = addTestDays(testDate, testDayOfWeek === 0 ? -1 : 1);

const task = {
  id: 'e2e-project', name: 'E2E项目', start: testDate, end: testDate, color: '#ec4899',
  blocks: [{ type: 'smart-task', id: 'e2e-block', header: { title: 'E2E完成撤销任务', tag: '默认', tagColor: '#f59e0b', date: testDate, duration: 30, isCompleted: false, autoSyncEbb: false }, body: '' }],
};
const daily = {
  [testDate]: { date: testDate, items: [{ id: 'e2e-scheduled', sourceId: 'project-blk:e2e-project::e2e-block', name: 'E2E完成撤销任务', source: 'project', timeSlot: 'morning', order: 0, duration: 30 }], blocks: [] },
};
const ebb = { reviewTasks: [{ id: 'e2e-review', topicName: 'E2E复习撤销', dueDate: testDate, originalDueDate: testDate, roundOrder: 1, isCompleted: false, tag: '默认', smStatus: 'scheduled' }], inboxItems: [], outlineNodes: [], ebbSettings: {} };

const undoLatestFromHistory = async (page: Page) => {
  await page.getByTitle('最近操作与回收站').click();
  const panel = page.getByLabel('最近操作面板');
  await expect(panel).toBeVisible();
  await panel.locator('.operation-history-list article').first().getByRole('button', { name: '撤销' }).click();
  await page.getByLabel('关闭最近操作').click();
};

const openTaskOverview = async (page: Page) => {
  await page.getByTitle('项目规划').click();
  await page.getByRole('menuitemradio', { name: '全部任务' }).click();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ taskData, dailyData, ebbData }) => {
    if (sessionStorage.getItem('e2e-seeded') === '1') return;
    sessionStorage.setItem('e2e-seeded', '1');
    localStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({ tasks: [taskData], groups: [], notes: [], milestones: [] }));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify(dailyData));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify(ebbData));
  }, { taskData: task, dailyData: daily, ebbData: ebb });
  await page.goto('/');
});

test('completion from daily schedule creates one unified undo and restores the card', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await expect(card).toBeVisible();
  await card.locator('.ds-item-check').click();
  await expect(card).toHaveClass(/ds-item--completed/);
  await expect(page.getByRole('button', { name: /^撤销：/ })).toHaveCount(0);
  await undoLatestFromHistory(page);
  await expect(card).not.toHaveClass(/ds-item--completed/);
});

test('task overview aggregates project tasks and edits the original task block', async ({ page }) => {
  await openTaskOverview(page);
  const card = page.locator('[data-block-id="e2e-block"]');
  await expect(card).toBeVisible();
  await expect(card).toContainText('E2E项目');
  await card.click();
  await expect(page.getByRole('dialog', { name: '任务详情' })).toBeVisible();
  await page.getByLabel('关闭任务详情').click();

  await card.getByRole('button', { name: /完成/ }).click();
  await page.getByRole('button', { name: /已完成/ }).first().click();
  const completedSection = page.locator('.task-overview-section').filter({ hasText: '已完成' });
  await completedSection.locator('.task-overview-section-header').click();
  await expect(card).toHaveClass(/is-completed/);
  await card.getByRole('button', { name: /取消完成/ }).click();
  await page.getByRole('button', { name: /全部任务/ }).first().click();
  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/is-completed/);
});

test('batch edit can explicitly clear a schedule date and keep the task unscheduled', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: 'E2E项目' }).first().click();

  await page.getByTitle('更多操作').click();
  await page.getByRole('button', { name: '批量编辑' }).click();
  const dialog = page.locator('.bi-dialog');
  const taskRow = dialog.locator('tbody tr').first();
  const scheduleDate = taskRow.locator('input[type="date"]').first();
  await expect(scheduleDate).toHaveValue(testDate);
  await dialog.getByRole('button', { name: /确认修改/ }).click();

  await page.getByTitle('更多操作').click();
  await page.getByRole('button', { name: '批量编辑' }).click();
  const unchangedDate = page.locator('.bi-dialog tbody tr').first().locator('input[type="date"]').first();
  await expect(unchangedDate).toHaveValue(testDate);
  await unchangedDate.fill('');
  await page.locator('.bi-dialog').getByRole('button', { name: /确认修改/ }).click();

  const projectCard = page.locator('.stb-card').filter({ hasText: 'E2E完成撤销任务' });
  await expect(projectCard).toContainText('未排期');

  await page.getByTitle('更多操作').click();
  await page.getByRole('button', { name: '批量编辑' }).click();
  const reopenedRow = page.locator('.bi-dialog tbody tr').first();
  await expect(reopenedRow.locator('input[type="date"]').first()).toHaveValue('');
  await page.locator('.bi-dialog').getByRole('button', { name: '取消' }).click();

  await page.getByLabel('关闭项目文档').click();
  await page.getByTitle('每日安排').click();
  await expect(page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' })).toHaveCount(0);
});

test('latest undo survives page refresh and remains executable', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await card.locator('.ds-item-check').click();
  await expect(card).toHaveClass(/ds-item--completed/);
  await page.reload();
  await page.getByTitle('每日安排').click();
  const refreshedCard = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await expect(refreshedCard).toHaveClass(/ds-item--completed/);
  await undoLatestFromHistory(page);
  await expect(refreshedCard).not.toHaveClass(/ds-item--completed/);
});

test('older operations are not offered after a newer operation is recorded', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await card.locator('.ds-item-check').click();
  await card.locator('.ds-item-check').click();
  await page.getByTitle('最近操作与回收站').click();
  const entries = page.locator('.operation-history-list article');
  await expect(entries).toHaveCount(2);
  await expect(entries.nth(0).getByRole('button', { name: '撤销' })).toBeVisible();
  await expect(entries.nth(1).getByRole('button', { name: '撤销' })).toHaveCount(0);
});

test('EBB completion from the main matrix uses the same global undo', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.locator('.eb-topic-row-main').filter({ hasText: 'E2E复习撤销' }).click();
  const toggle = page.getByLabel('标记第 1 轮完成');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await expect(page.getByLabel('取消第 1 轮完成')).toBeVisible();
  await undoLatestFromHistory(page);
  await expect(page.getByLabel('标记第 1 轮完成')).toBeVisible();
});

test('daily schedule drag between slots can be undone precisely', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const afternoon = page.getByTestId('daily-slot-afternoon');
  await page.waitForFunction(() => typeof (window as typeof window & { __e2eDailyDragEnd?: unknown }).__e2eDailyDragEnd === 'function');
  await page.evaluate(() => (window as typeof window & { __e2eDailyDragEnd: (result: unknown) => void }).__e2eDailyDragEnd({
    draggableId: 'e2e-scheduled', type: 'DEFAULT', reason: 'DROP', mode: 'FLUID', combine: null,
    source: { droppableId: 'ds-slot-morning', index: 0 },
    destination: { droppableId: 'ds-slot-afternoon', index: 0 },
  }));
  await expect(afternoon.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' })).toBeVisible();
  await undoLatestFromHistory(page);
  await expect(page.getByTestId('daily-slot-morning').locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' })).toBeVisible();
});

test('week matrix drag reschedules through unified undo', async ({ page }) => {
  await page.getByTitle('周矩阵').click();
  const card = page.locator('[data-block-id="e2e-block"]');
  const target = page.locator(`[data-date="${weekMoveTargetDate}"][data-tag="默认"]`);
  await expect(card).toBeVisible();
  await page.evaluate(({ sourceDate, targetDate }) => {
    const source = document.querySelector<HTMLElement>('[data-block-id="e2e-block"]');
    const destination = document.querySelector<HTMLElement>(`[data-date="${targetDate}"][data-tag="默认"]`);
    if (!source || !destination) throw new Error('drag endpoints missing');
    const transfer = new DataTransfer();
    transfer.setData('application/json', JSON.stringify({ type: 'smart-block', source: 'week-matrix', taskId: 'e2e-project', blockId: 'e2e-block', tag: '默认', title: 'E2E完成撤销任务', fromDate: sourceDate }));
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    destination.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    destination.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: transfer }));
  }, { sourceDate: testDate, targetDate: weekMoveTargetDate });
  await expect(target.locator('[data-block-id="e2e-block"]')).toBeVisible();
  await undoLatestFromHistory(page);
  await expect(page.locator(`[data-date="${testDate}"][data-tag="默认"] [data-block-id="e2e-block"]`)).toBeVisible();
});

test('daily schedule keeps the real drag transform and visual feedback', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const mobilePoolTrigger = page.locator('.ds-task-pool-trigger');
  const compactPool = (page.viewportSize()?.width ?? 1200) <= 900;
  if (compactPool) {
    await expect(mobilePoolTrigger).toBeVisible();
    await mobilePoolTrigger.click();
    await expect(page.getByLabel('待安排任务池')).toHaveClass(/ds-right--open/);
    await page.waitForTimeout(400); // wait for the drawer transform before reading drag coordinates
  }
  const card = page.locator('.ds-pool-item').filter({ hasText: 'E2E复习撤销' });
  await expect(card).toBeVisible();
  if (compactPool) {
    await card.focus();
    await page.keyboard.press('Space');
    await expect(card).toHaveClass(/ds-pool-item--dragging/);
    await page.keyboard.press('Escape');
    await expect(card).not.toHaveClass(/ds-pool-item--dragging/);
    return;
  }
  const box = await card.boundingBox();
  if (!box) throw new Error('drag card has no bounding box');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2, { steps: 8 });
  await expect(card).toHaveClass(/ds-pool-item--dragging/);
  await expect.poll(() => card.evaluate((element) => element.style.transform)).toContain('translate');
  await page.mouse.up();
  await expect(card).not.toHaveClass(/ds-pool-item--dragging/);
});

test('project quantity task suggests a daily target and records progress without duration', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: 'E2E项目' }).first().click();
  await page.getByRole('button', { name: '添加任务卡片' }).click();
  const createDialog = page.getByRole('dialog', { name: '新建项目任务' });
  await expect(createDialog).toBeVisible();
  await createDialog.getByRole('button', { name: '按数量推进' }).click();
  await createDialog.getByLabel('任务名称').fill('考研数学题库');
  await createDialog.getByLabel('目标总量').fill('1000');
  await createDialog.locator('summary').click();
  await createDialog.getByLabel('当前已完成').fill('200');
  await createDialog.getByLabel('截止日期（可选）').fill(addTestDays(testDate, 9));
  await expect(createDialog.getByLabel('每日建议预览')).toContainText('建议首日完成 80 题');
  await createDialog.getByRole('button', { name: '创建任务' }).click();

  const projectCard = page.locator('.stb-card').filter({ hasText: '考研数学题库' });
  await expect(projectCard).toBeVisible();
  await expect(projectCard).toContainText('进度 200/1000 题 · 20%');
  await expect(projectCard).toContainText('今日 0/80 题');
  await expect(projectCard).toContainText('剩余 800 题');
  await expect(projectCard).toContainText('建议今天 80 题');
  await expect(projectCard).not.toContainText('min');
  await page.getByRole('button', { name: '关闭项目文档' }).click();

  await page.getByRole('tab', { name: '每日安排' }).click();

  const poolCard = page.locator('.ds-pool-item').filter({ hasText: '考研数学题库' });
  await expect(poolCard).toContainText('剩余 800 题');
  await expect(poolCard).toContainText('今日目标 80 题');
  await expect(poolCard).not.toContainText('min');
  const draggableId = await poolCard.evaluate((element) => {
    const attribute = [...element.attributes].find((candidate) => candidate.name.endsWith('draggable-id'));
    return attribute?.value;
  });
  if (!draggableId) throw new Error('quantity draggable id missing');
  await page.waitForFunction(() => typeof (window as typeof window & { __e2eDailyDragEnd?: unknown }).__e2eDailyDragEnd === 'function');
  await page.evaluate((id) => (window as typeof window & { __e2eDailyDragEnd: (result: unknown) => void }).__e2eDailyDragEnd({
    draggableId: id, type: 'DEFAULT', reason: 'DROP', mode: 'FLUID', combine: null,
    source: { droppableId: 'ds-pool', index: 0 },
    destination: { droppableId: 'ds-slot-afternoon', index: 0 },
  }), draggableId);

  const afternoonCard = page.getByTestId('daily-slot-afternoon').locator('.ds-item').filter({ hasText: '考研数学题库' });
  await expect(afternoonCard).toBeVisible();
  await expect(afternoonCard).toHaveClass(/ds-item--quantity/);
  await expect(afternoonCard).not.toContainText('min');
  const quantityLayout = await afternoonCard.evaluate((element) => {
    const card = element.getBoundingClientRect();
    const name = element.querySelector('.ds-item-name')?.getBoundingClientRect();
    const summary = element.querySelector('.ds-item-quantity-inline')?.getBoundingClientRect();
    const editButton = element.querySelector('.ds-item-quantity-edit')?.getBoundingClientRect();
    return {
      height: card.height,
      nameVisible: Boolean(name && name.top >= card.top && name.bottom <= card.bottom),
      summaryVisible: Boolean(summary && summary.top >= card.top && summary.bottom <= card.bottom),
      editButtonVisible: Boolean(editButton && editButton.top >= card.top && editButton.bottom <= card.bottom),
    };
  });
  expect(quantityLayout.height).toBeGreaterThanOrEqual(54);
  expect(quantityLayout.height).toBeLessThanOrEqual(58);
  expect(quantityLayout.nameVisible).toBeTruthy();
  expect(quantityLayout.summaryVisible).toBeTruthy();
  expect(quantityLayout.editButtonVisible).toBeTruthy();
  await afternoonCard.getByRole('button', { name: '自定义数量' }).click();
  const progressDialog = page.getByRole('dialog', { name: '记录今日完成量' });
  await expect(progressDialog.getByLabel('每日完成建议')).toContainText('建议今日完成 80 题');
  await progressDialog.getByLabel('今日完成了多少题？').fill('35');
  await progressDialog.getByRole('button', { name: '完成记录' }).click();
  await expect(afternoonCard).not.toHaveClass(/ds-item--completed/);
  await expect(afternoonCard).toContainText('今日 35/80 题');
  await expect(afternoonCard).toContainText('235/1000 题');
  await expect(afternoonCard.locator('.ds-item-quantity-inline')).toHaveAttribute('title', /剩余 765 题/);
  await expect(afternoonCard.getByRole('button', { name: '补到 80 题' })).toContainText('补45');

  await page.reload();
  await page.getByRole('tab', { name: '每日安排' }).click();
  const refreshedCard = page.getByTestId('daily-slot-afternoon').locator('.ds-item').filter({ hasText: '考研数学题库' });
  await expect(refreshedCard).not.toHaveClass(/ds-item--completed/);
  await expect(refreshedCard).toContainText('今日 35/80 题');
  await refreshedCard.getByRole('button', { name: '补到 80 题' }).click();
  await expect(refreshedCard).toHaveClass(/ds-item--completed/);
  await expect(refreshedCard).toContainText('今日 80/80 题');
  await undoLatestFromHistory(page);
  await expect(refreshedCard).not.toHaveClass(/ds-item--completed/);
  await expect(refreshedCard).toContainText('今日 35/80 题');
  await expect(refreshedCard).toContainText('235/1000 题');
});

test('project task duration accepts any positive minute value', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: 'E2E项目' }).first().click();
  await page.getByRole('button', { name: '添加任务卡片' }).click();
  const createDialog = page.getByRole('dialog', { name: '新建项目任务' });
  await createDialog.getByLabel('任务名称').fill('任意分钟任务');
  const durationInput = createDialog.getByLabel('预计时长（分钟）');
  await durationInput.fill('17.5');
  expect(await durationInput.evaluate((input: HTMLInputElement) => input.checkValidity())).toBeTruthy();
  await createDialog.getByRole('button', { name: '创建任务' }).click();
  await expect(createDialog).toBeHidden();
  await expect(page.locator('.stb-card').filter({ hasText: '任意分钟任务' })).toBeVisible();
});

test('knowledge binding actions stay inside an iPad Air viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  await openTaskOverview(page);
  await page.locator('[data-block-id="e2e-block"]').click();
  await page.getByRole('button', { name: '未绑定节点' }).click();
  await page.getByRole('button', { name: '去知识大盘选择' }).click();

  const banner = page.getByTestId('graph-binding-banner');
  const confirm = page.getByRole('button', { name: '完成知识节点选择' });
  await expect(banner).toBeVisible();
  await expect(confirm).toBeVisible();
  const confirmBox = await confirm.boundingBox();
  if (!confirmBox) throw new Error('binding confirm button has no bounding box');
  expect(confirmBox.x).toBeGreaterThanOrEqual(0);
  expect(confirmBox.x + confirmBox.width).toBeLessThanOrEqual(1180);
  await page.getByRole('button', { name: '取消' }).click();
  await expect(page.locator('.tl-year-stack')).toBeVisible();
});

test('knowledge node detail summarizes linked tasks, reviews and mastery state', async ({ page }) => {
  await openTaskOverview(page);
  await page.locator('[data-block-id="e2e-block"]').click();
  await page.getByRole('button', { name: '未绑定节点' }).click();
  await page.getByPlaceholder('搜索或创建知识节点...').fill('E2E知识节点');
  await page.getByRole('button', { name: /创建新知识节点："E2E知识节点"/ }).click();
  await page.locator('.stb-tag-picker-overlay').click({ position: { x: 5, y: 5 } });
  await page.getByLabel('关闭任务详情').click();

  await page.getByTitle('知识大盘').click();
  const nodeLabel = page.locator('svg text[fill="#ffffff"]').filter({ hasText: 'E2E知识节点' });
  await expect(nodeLabel).toBeVisible();
  await nodeLabel.evaluate((element) => element.parentElement?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

  const summary = page.getByLabel('学习状态总览');
  await expect(summary).toBeVisible();
  await expect(summary).toContainText('未开始');
  await expect(summary).toContainText('已完成 0/1');
  await expect(summary).toContainText('0/0');
  await expect(page.getByText(/^关联项目任务 1$/)).toBeVisible();
  await expect(page.getByText('E2E完成撤销任务')).toBeVisible();
});

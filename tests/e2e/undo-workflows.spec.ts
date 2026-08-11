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

const openProjectTaskCard = async (page: Page, taskTitle = 'E2E完成撤销任务') => {
  await page.getByTitle('项目规划').click();
  const card = page.locator('.stb-card').filter({ hasText: taskTitle });
  await page.locator('.pdv-container').waitFor({ state: 'visible', timeout: 1_500 }).catch(() => undefined);
  if (!await page.locator('.pdv-container').isVisible()) {
    await page.locator('.tl-seg').filter({ hasText: 'E2E项目' }).first().click();
  }
  await expect(card).toBeVisible();
  return card;
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

test('completion from daily schedule stays committed without creating a history-library entry', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await expect(card).toBeVisible();
  await card.locator('.ds-item-check').click();
  await expect(card).toHaveClass(/ds-item--completed/);
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('line-operation-history-v2'))).toBeNull();
  await page.reload();
  await page.getByTitle('每日安排').click();
  await expect(page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' })).toHaveClass(/ds-item--completed/);
});

test('permanent task deletion requires confirmation and leaves no recycle entry', async ({ page }) => {
  const project = page.locator('.tl-seg').filter({ hasText: 'E2E项目' }).first();
  await expect(project).toBeVisible();
  await project.click({ button: 'right' });
  await page.locator('.tl-context-menu').getByRole('button', { name: '删除', exact: true }).click();

  const dialog = page.getByRole('alertdialog', { name: '永久删除任务' });
  await expect(dialog).toContainText('删除后无法从回收站恢复');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(project).toBeVisible();

  await project.click({ button: 'right' });
  await page.locator('.tl-context-menu').getByRole('button', { name: '删除', exact: true }).click();
  await dialog.getByRole('button', { name: '永久删除' }).click();
  await expect(project).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('line-recycle-bin-v1'))).toBeNull();

  await page.getByTitle('每日安排').click();
  await expect(page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' })).toHaveCount(0);
});

test('project document edits the original task block', async ({ page }) => {
  const card = await openProjectTaskCard(page);
  await expect(card.getByRole('textbox')).toHaveValue('E2E完成撤销任务');
  await card.locator('.stb-check').click();
  await expect(card).toHaveClass(/stb-card--done/);
  await card.locator('.stb-check').click();
  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/stb-card--done/);
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
  await page.getByRole('tab', { name: '每日安排' }).click();
  await expect(page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' })).toHaveCount(0);
});

test('legacy quantity task without a start date is repaired and returns to the daily pool', async ({ page }) => {
  await page.addInitScript(({ recoveredStart }) => {
    const key = 'smart-timeline-data:mirror';
    const data = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (data.tasks?.[0]?.blocks?.some((block: { id?: string }) => block.id === 'legacy-quantity-without-date')) return;
    data.tasks[0].blocks.push({
      type: 'smart-task',
      id: 'legacy-quantity-without-date',
      header: {
        taskKind: 'quantity',
        title: '待恢复背诵任务',
        tag: '背诵',
        tagColor: '#60a5fa',
        duration: 0,
        isCompleted: false,
        quantityUnit: '章',
        quantityTotal: 20,
        quantityInitialCompleted: 0,
        quantityRecords: {},
      },
      body: '',
    });
    data.tasks[0].start = recoveredStart;
    localStorage.setItem(key, JSON.stringify(data));
  }, { recoveredStart: addTestDays(testDate, -10) });
  await page.reload();

  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: 'E2E项目' }).first().click();
  const projectCard = page.locator('.stb-card').filter({ hasText: '待恢复背诵任务' });
  await expect(projectCard).toBeVisible();
  await expect(projectCard).not.toContainText('未排期');
  await page.getByRole('tab', { name: '每日安排' }).click();
  await expect(page.locator('.ds-pool-item').filter({ hasText: '待恢复背诵任务' })).toBeVisible();
});

test('operation history is not persisted across refresh', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await card.locator('.ds-item-check').click();
  await expect(card).toHaveClass(/ds-item--completed/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('line-operation-history-v2'))).toBeNull();
  await page.reload();
  await page.getByTitle('每日安排').click();
  const refreshedCard = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await expect(refreshedCard).toHaveClass(/ds-item--completed/);
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);
});

test('multiple operations never surface a central history list', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' });
  await card.locator('.ds-item-check').click();
  await card.locator('.ds-item-check').click();
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);
  await expect(page.locator('.operation-history-list')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('line-operation-history-v2'))).toBeNull();
});

test('EBB completion remains committed without a global undo library', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('tab', { name: '复习计划' }).click();
  await page.locator('.eb-topic-row-main').filter({ hasText: 'E2E复习撤销' }).click();
  const toggle = page.getByLabel('标记第 1 轮完成');
  await expect(toggle).toBeVisible();
  await toggle.click();
  await page.getByRole('button', { name: '完成并结束计划' }).click();
  await expect(page.getByLabel('取消第 1 轮完成')).toBeVisible();
  await page.reload();
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('tab', { name: '复习计划' }).click();
  await page.locator('.eb-topic-row-main').filter({ hasText: 'E2E复习撤销' }).click();
  await expect(page.getByLabel('取消第 1 轮完成')).toBeVisible();
});

test('daily schedule drag between slots remains committed after refresh', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const afternoon = page.getByTestId('daily-slot-afternoon');
  await page.waitForFunction(() => typeof (window as typeof window & { __e2eDailyDragEnd?: unknown }).__e2eDailyDragEnd === 'function');
  await page.evaluate(() => (window as typeof window & { __e2eDailyDragEnd: (result: unknown) => void }).__e2eDailyDragEnd({
    draggableId: 'e2e-scheduled', type: 'DEFAULT', reason: 'DROP', mode: 'FLUID', combine: null,
    source: { droppableId: 'ds-slot-morning', index: 0 },
    destination: { droppableId: 'ds-slot-afternoon', index: 0 },
  }));
  await expect(afternoon.locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' })).toBeVisible();
  await page.reload();
  await page.getByTitle('每日安排').click();
  await expect(page.getByTestId('daily-slot-afternoon').locator('.ds-item').filter({ hasText: 'E2E完成撤销任务' })).toBeVisible();
});

test('week matrix drag reschedule remains committed after refresh', async ({ page }) => {
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
  await page.reload();
  await page.getByTitle('周矩阵').click();
  await expect(page.locator(`[data-date="${weekMoveTargetDate}"][data-tag="默认"] [data-block-id="e2e-block"]`)).toBeVisible();
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

test('project quantity task suggests a daily target and keeps its daily duration visible', async ({ page }) => {
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
  await expect(projectCard.getByTitle('每日预计投入（分钟）')).toHaveValue('30');
  const projectProgressButton = projectCard.getByRole('button', { name: /^记录今日完成量：考研数学题库/ });
  await expect(projectProgressButton).toBeVisible();
  await expect(projectCard.getByRole('button', { name: '标记完成' })).toHaveCount(0);
  await projectProgressButton.click();
  await expect(page.getByRole('dialog', { name: '记录今日完成量' })).toBeVisible();
  await page.getByRole('dialog', { name: '记录今日完成量' }).getByRole('button', { name: '取消' }).click();

  await page.getByTitle('更多操作').click();
  await page.getByRole('button', { name: '批量编辑' }).click();
  const batchDialog = page.locator('.bi-dialog');
  const batchDialogLayout = await batchDialog.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, right: innerWidth - rect.right, top: rect.top, width: rect.width, viewportWidth: innerWidth };
  });
  expect(Math.abs(batchDialogLayout.left - batchDialogLayout.right)).toBeLessThanOrEqual(2);
  expect(batchDialogLayout.top).toBeGreaterThanOrEqual(0);
  expect(batchDialogLayout.width).toBeLessThanOrEqual(batchDialogLayout.viewportWidth);
  const quantityRow = batchDialog.locator('tbody tr').nth(1);
  await expect(quantityRow.locator('input').first()).toHaveValue('考研数学题库');
  const quantityStartDate = quantityRow.locator('input[type="date"]').first();
  await expect(quantityStartDate).toHaveValue(testDate);
  await expect(quantityStartDate).toHaveAttribute('required', '');
  await expect(quantityStartDate).toHaveAttribute('title', '数量任务从开始日期起每天生效，不能清除');
  await quantityStartDate.fill('');
  await expect(quantityRow).toHaveClass(/bi-row--error/);
  await expect(quantityRow.locator('[title="数量任务必须保留开始日期"]')).toBeVisible();
  await expect(batchDialog.getByRole('button', { name: /确认修改/ })).toBeDisabled();
  await quantityStartDate.fill(testDate);
  await expect(quantityRow).not.toHaveClass(/bi-row--error/);
  await batchDialog.getByRole('button', { name: '取消' }).click();
  await page.getByRole('button', { name: '关闭项目文档' }).click();

  await page.getByRole('tab', { name: '每日安排' }).click();

  const poolCard = page.locator('.ds-pool-item').filter({ hasText: '考研数学题库' });
  await expect(poolCard).toContainText('剩余 800 题');
  await expect(poolCard).toContainText('今日目标 80 题');
  await expect(poolCard).toContainText('每日投入 30 分钟');

  // The two daily presentations must consume the same projection. Continuous
  // quantity tasks used to disappear entirely after switching to time blocks.
  await page.getByRole('tab', { name: '时间块' }).click();
  const timeBlockPoolCard = page.locator('.ds-pool-item').filter({ hasText: '考研数学题库' });
  await expect(timeBlockPoolCard).toBeVisible();
  await expect(timeBlockPoolCard).toContainText('今日 0/80 题');
  await expect(timeBlockPoolCard).toContainText('总进度 200/1000 题');
  await expect(timeBlockPoolCard).toContainText('每日投入 30 分钟');
  await page.getByRole('tab', { name: '时段' }).click();

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
  await expect(afternoonCard).toContainText('30min');
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
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);
  await page.reload();
  await page.getByRole('tab', { name: '每日安排' }).click();
  const completedCard = page.getByTestId('daily-slot-afternoon').locator('.ds-item').filter({ hasText: '考研数学题库' });
  await expect(completedCard).toHaveClass(/ds-item--completed/);
  await expect(completedCard).toContainText('今日 80/80 题');
  await expect(completedCard).toContainText('280/1000 题');
});

test('quantity controls open a real progress entry and future tasks stay locked', async ({ page }) => {
  await page.evaluate(({ today, future }) => {
    const key = 'smart-timeline-data:mirror';
    const data = JSON.parse(localStorage.getItem(key) ?? '{}');
    data.tasks[0].blocks.push(
      {
        type: 'smart-task',
        id: 'compact-quantity-entry',
        header: {
          taskKind: 'quantity',
          title: 'Compact quantity entry',
          tag: '做题',
          tagColor: '#60a5fa',
          date: today,
          duration: 0,
          isCompleted: false,
          autoSyncEbb: false,
          quantityUnit: '题',
          quantityTotal: 100,
          quantityInitialCompleted: 0,
          quantityRecords: {},
        },
        body: '',
      },
      {
        type: 'smart-task',
        id: 'future-quantity-entry',
        header: {
          taskKind: 'quantity',
          title: 'Future quantity',
          tag: '做题',
          tagColor: '#60a5fa',
          date: future,
          duration: 0,
          isCompleted: false,
          autoSyncEbb: false,
          quantityUnit: '题',
          quantityTotal: 100,
          quantityInitialCompleted: 0,
          quantityRecords: {},
        },
        body: '',
      },
    );
    localStorage.setItem(key, JSON.stringify(data));
  }, { today: testDate, future: addTestDays(testDate, 1) });
  await page.reload();

  const projectCard = await openProjectTaskCard(page, 'Compact quantity entry');
  await projectCard.getByRole('button', { name: /^记录今日完成量：Compact quantity entry/ }).click();
  await expect(page.getByRole('dialog', { name: /记录今日完成量/ })).toBeVisible();
  await page.getByLabel('关闭数量记录窗口').click();

  await page.getByTitle('周矩阵').click();
  const weekCard = page.locator('[data-block-id="compact-quantity-entry"]');
  await weekCard.getByRole('button', { name: '记录数量进度：Compact quantity entry' }).click();
  await expect(page.getByRole('dialog', { name: '任务详情' })).toBeVisible();
  await page.getByLabel('关闭任务详情').click();

  const futureCard = await openProjectTaskCard(page, 'Future quantity');
  await expect(futureCard.getByRole('button', { name: /^任务尚未开始：Future quantity/ })).toBeDisabled();
});

test('direct quantity total and cumulative edits persist without creating history records', async ({ page }) => {
  await page.evaluate(({ date }) => {
    const key = 'smart-timeline-data:mirror';
    const data = JSON.parse(localStorage.getItem(key) ?? '{}');
    data.tasks[0].blocks.push({
      type: 'smart-task',
      id: 'direct-quantity-undo',
      header: {
        taskKind: 'quantity',
        title: '直接编辑撤销数量任务',
        tag: '做题',
        tagColor: '#60a5fa',
        date,
        duration: 0,
        isCompleted: false,
        autoSyncEbb: false,
        quantityUnit: '题',
        quantityTotal: 100,
        quantityInitialCompleted: 90,
        quantityRecords: {},
      },
      body: '',
    });
    localStorage.setItem(key, JSON.stringify(data));
  }, { date: testDate });
  await page.reload();

  const openQuantityCard = async () => {
    await page.getByTitle('项目规划').click();
    await page.locator('.tl-seg').filter({ hasText: 'E2E项目' }).first().click();
    const card = page.locator('.stb-card').filter({ hasText: '直接编辑撤销数量任务' });
    await expect(card).toBeVisible();
    await card.getByTitle('展开详情').click();
    return card;
  };

  let card = await openQuantityCard();
  const completedInput = card.getByTitle('累计已完成题数');
  await completedInput.press('Control+A');
  await completedInput.pressSequentially('100');
  await completedInput.press('Enter');
  await expect(card).toHaveClass(/stb-card--done/);
  await expect(card).toContainText('进度 100/100 题');

  await page.reload();
  card = await openQuantityCard();
  await expect(card).toHaveClass(/stb-card--done/);
  await expect(card.getByTitle('累计已完成题数')).toHaveValue('100');
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);

  const restoredCompletedInput = card.getByTitle('累计已完成题数');
  await restoredCompletedInput.press('Control+A');
  await restoredCompletedInput.pressSequentially('90');
  await restoredCompletedInput.press('Enter');
  await expect(card).not.toHaveClass(/stb-card--done/);
  await expect(card.getByTitle('累计已完成题数')).toHaveValue('90');
  await expect(card).toContainText('进度 90/100 题');

  const totalInput = card.getByTitle('目标总量');
  await totalInput.press('Control+A');
  await totalInput.pressSequentially('90');
  await totalInput.press('Enter');
  await expect(card).toHaveClass(/stb-card--done/);
  await expect(card).toContainText('进度 90/90 题');

  await page.reload();
  card = await openQuantityCard();
  await expect(card).toHaveClass(/stb-card--done/);
  await expect(card.getByTitle('目标总量')).toHaveValue('90');
  await expect(card.getByTitle('累计已完成题数')).toHaveValue('90');
  await expect(card).toContainText('进度 90/90 题');
});

test('project task duration uses convenient five-minute presets', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: 'E2E项目' }).first().click();
  await page.getByRole('button', { name: '添加任务卡片' }).click();
  const createDialog = page.getByRole('dialog', { name: '新建项目任务' });
  await createDialog.getByLabel('任务名称').fill('五分钟粒度任务');
  const durationInput = createDialog.getByLabel('预计时长（分钟）');
  await createDialog.getByRole('button', { name: '45 分钟' }).click();
  await expect(durationInput).toHaveValue('45');
  await durationInput.fill('20');
  expect(await durationInput.evaluate((input: HTMLInputElement) => input.checkValidity())).toBeTruthy();
  await createDialog.getByRole('button', { name: '创建任务' }).click();
  await expect(createDialog).toBeHidden();
  await expect(page.locator('.stb-card').filter({ hasText: '五分钟粒度任务' }).getByTitle('预估时长（分钟）')).toHaveValue('20');
});

test('standard project task can be created unscheduled while quantity start remains required', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: 'E2E项目' }).first().click();
  await page.getByRole('button', { name: '添加任务卡片' }).click();
  const createDialog = page.getByRole('dialog', { name: '新建项目任务' });
  await createDialog.getByLabel('任务名称').fill('新建未排期任务');
  const optionalDate = createDialog.getByLabel('计划日期（可选）');
  await optionalDate.fill('');
  await createDialog.getByRole('button', { name: '创建任务' }).click();
  const card = page.locator('.stb-card').filter({ hasText: '新建未排期任务' });
  await expect(card).toContainText('未排期');

  await page.getByRole('button', { name: '添加任务卡片' }).click();
  const quantityDialog = page.getByRole('dialog', { name: '新建项目任务' });
  await quantityDialog.getByRole('button', { name: '按数量推进' }).click();
  await expect(quantityDialog.getByLabel('开始日期（必填）')).toHaveAttribute('required', '');
  await expect(quantityDialog.getByLabel('每日预计投入（分钟）')).toHaveValue('30');
  await quantityDialog.getByRole('button', { name: '取消' }).click();
});

test('knowledge binding actions stay inside an iPad Air viewport', async ({ page }) => {
  await page.setViewportSize({ width: 1180, height: 820 });
  const card = await openProjectTaskCard(page);
  await card.getByRole('button', { name: '未绑定节点', exact: true }).click();
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
  const card = await openProjectTaskCard(page);
  await card.getByRole('button', { name: '未绑定节点', exact: true }).click();
  await page.getByPlaceholder('搜索或创建知识节点...').fill('E2E知识节点');
  await page.getByRole('button', { name: /创建新知识节点："E2E知识节点"/ }).click();
  await page.locator('.stb-tag-picker-overlay').click({ position: { x: 5, y: 5 } });

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
  await expect(page.locator('#view-knowledge-graph').getByText('E2E完成撤销任务', { exact: true })).toBeVisible();
});

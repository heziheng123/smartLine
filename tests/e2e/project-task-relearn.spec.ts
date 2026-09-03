import { expect, test, type Page } from '@playwright/test';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const addDays = (date: string, amount: number) => {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(year, month - 1, day);
  value.setDate(value.getDate() + amount);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
};

const projectSourceId = 'project-blk:relearn-project::relearn-task';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ date, tomorrow, sourceId }) => {
    localStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({
      tasks: [{
        id: 'relearn-project',
        name: '冲刺阶段项目',
        start: date,
        end: tomorrow,
        color: '#818cf8',
        blocks: [{
          type: 'smart-task',
          id: 'relearn-task',
          header: {
            title: '极限强化课',
            tag: '数学',
            tagColor: '#818cf8',
            date,
            duration: 60,
            isCompleted: false,
            graphNodeIds: ['limit-node'],
            autoSyncEbb: true,
            complexity: 'normal',
          },
          body: '',
        }, {
          type: 'smart-task',
          id: 'quantity-task',
          header: {
            taskKind: 'quantity',
            title: '章节题目',
            tag: '数学',
            tagColor: '#14b8a6',
            date,
            duration: 30,
            isCompleted: false,
            graphNodeIds: ['quantity-node'],
            autoSyncEbb: true,
            complexity: 'normal',
            quantityUnit: '道',
            quantityTotal: 10,
            quantityInitialCompleted: 9,
            quantityRecords: {},
          },
          body: '',
        }],
      }],
      groups: [],
      notes: [],
      milestones: [],
    }));
    localStorage.setItem('line-graph-storage:mirror', JSON.stringify({
      nodes: [{
        id: 'limit-node',
        name: '极限',
        parentId: null,
        createdAt: 1,
        status: 'unactivated',
      }, {
        id: 'quantity-node',
        name: '章节题',
        parentId: null,
        createdAt: 2,
        status: 'unactivated',
      }],
    }));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify({
      reviewTasks: [{
        id: 'old-r1',
        topicName: '极限',
        graphNodeId: 'limit-node',
        dueDate: date,
        originalDueDate: date,
        roundOrder: 1,
        isCompleted: false,
        complexity: 'normal',
        smStatus: 'scheduled',
      }, {
        id: 'old-r2',
        topicName: '极限',
        graphNodeId: 'limit-node',
        dueDate: tomorrow,
        originalDueDate: tomorrow,
        roundOrder: 2,
        isCompleted: false,
        complexity: 'normal',
        smStatus: 'scheduled',
      }, {
        id: 'quantity-old-r1',
        topicName: '章节题',
        graphNodeId: 'quantity-node',
        dueDate: date,
        originalDueDate: date,
        roundOrder: 1,
        isCompleted: false,
        complexity: 'normal',
        smStatus: 'scheduled',
      }],
      inboxItems: [],
      outlineNodes: [],
      ebbSettings: {},
    }));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify({
      [date]: {
        date,
        items: [{
          id: 'project-schedule',
          sourceId,
          name: '极限强化课',
          source: 'project',
          timeSlot: 'morning',
          order: 0,
          duration: 60,
        }, {
          id: 'review-schedule',
          sourceId: 'review-old-r1',
          name: '极限',
          source: 'review',
          timeSlot: 'evening',
          order: 0,
          duration: 15,
        }],
        blocks: [],
      },
    }));
  }, { date: today, tomorrow: addDays(today, 1), sourceId: projectSourceId });
  await page.goto('/');
  await expect(page.locator('.tl-dock')).toBeVisible();
});

async function openTask(page: Page) {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: '冲刺阶段项目' }).first().click();
  const card = page.locator('.stb-card').filter({ hasText: '极限强化课' });
  await expect(card).toBeVisible();
  return card;
}

async function completeWithRelearn(page: Page) {
  const card = await openTask(page);
  await card.getByRole('button', { name: '标记完成', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '完成“极限强化课”' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('当天有 R1 待复习');
  await expect(dialog.getByRole('radio', { name: /本次为重新学习/ })).toHaveAttribute('aria-checked', 'true');
  await dialog.getByRole('button', { name: '确认完成' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(card).toHaveClass(/stb-card--done/);
}

async function readState(page: Page) {
  return page.evaluate(async ({ sourceId }) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
    const resolveModule = (fragment: string, fallback: string) => resources.find((name) => name.includes(fragment)) ?? fallback;
    const { useTimelineStore } = await import(/* @vite-ignore */ resolveModule('/src/store/index.ts?t=', '/src/store/index.ts'));
    const { useEbbStore } = await import(/* @vite-ignore */ resolveModule('/src/ebb/store.ts?t=', '/src/ebb/store.ts'));
    const { useGraphStore } = await import(/* @vite-ignore */ resolveModule('/src/graph/store.ts?t=', '/src/graph/store.ts'));
    const { useDailyScheduleStore } = await import(/* @vite-ignore */ resolveModule('/src/components/dailySchedule/store.ts?t=', '/src/components/dailySchedule/store.ts'));
    const project = useTimelineStore.getState().tasks.find((task) => task.id === 'relearn-project');
    const block = project?.blocks.find((item) => item.id === 'relearn-task');
    const reviews = useEbbStore.getState().reviewTasks.filter((task) => task.graphNodeId === 'limit-node');
    const sourceIds = Object.values(useDailyScheduleStore.getState().schedules)
      .flatMap((day) => [...day.items, ...day.blocks])
      .map((item) => item.sourceId);
    return {
      completed: block?.type === 'smart-task' ? block.header.isCompleted : undefined,
      old: reviews.filter((task) => task.id.startsWith('old-')).map((task) => ({
        id: task.id,
        completed: task.isCompleted,
        source: task.completionSource,
        archived: task.isArchived,
        reason: task.archivedReason,
        total: task.cycleTotalRounds,
      })),
      active: reviews.filter((task) => !task.isArchived).map((task) => ({ id: task.id, dueDate: task.dueDate })),
      nodeStatus: useGraphStore.getState().nodes.find((node) => node.id === 'limit-node')?.status,
      hasProjectSchedule: sourceIds.includes(sourceId),
      hasOldReviewSchedule: sourceIds.includes('review-old-r1'),
    };
  }, { sourceId: projectSourceId });
}

test('relearn completion archives old history, starts a full cycle and undoes as one operation', async ({ page }) => {
  await completeWithRelearn(page);
  await expect.poll(() => readState(page)).toMatchObject({
    completed: true,
    old: [{ id: 'old-r1', completed: true, source: 'project-task', archived: true, reason: 'relearned', total: 2 }, {
      id: 'old-r2', completed: false, archived: true, reason: 'relearned', total: 2,
    }],
    nodeStatus: 'activated',
    hasProjectSchedule: true,
    hasOldReviewSchedule: false,
  });
  const completed = await readState(page);
  expect(completed.active).toHaveLength(7);
  expect(completed.active[0].dueDate).toBe(addDays(today, 1));

  const undone = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/services/operationHistory.ts?t='))
      ?? '/src/services/operationHistory.ts';
    const { useOperationHistory } = await import(/* @vite-ignore */ moduleUrl);
    return useOperationHistory.getState().undo();
  });
  expect(undone).toBe(true);
  await expect.poll(() => readState(page)).toEqual({
    completed: false,
    old: [{ id: 'old-r1', completed: false, archived: undefined, reason: undefined, source: undefined, total: undefined }, {
      id: 'old-r2', completed: false, archived: undefined, reason: undefined, source: undefined, total: undefined,
    }],
    active: [{ id: 'old-r1', dueDate: today }, { id: 'old-r2', dueDate: addDays(today, 1) }],
    nodeStatus: 'unactivated',
    hasProjectSchedule: true,
    hasOldReviewSchedule: true,
  });
});

test('task-only completion leaves the existing review chain untouched', async ({ page }) => {
  const card = await openTask(page);
  await card.getByRole('button', { name: '标记完成', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '完成“极限强化课”' });
  await dialog.getByRole('radio', { name: /只完成项目任务/ }).click();
  await dialog.getByRole('button', { name: '确认完成' }).click();

  await expect.poll(() => readState(page)).toMatchObject({
    completed: true,
    old: [{ id: 'old-r1', completed: false }, { id: 'old-r2', completed: false }],
    active: [{ id: 'old-r1' }, { id: 'old-r2' }],
    nodeStatus: 'activated',
    hasOldReviewSchedule: true,
  });

  const undone = await page.evaluate(async () => {
    const moduleUrl = performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .find((name) => name.includes('/src/services/operationHistory.ts?t='))
      ?? '/src/services/operationHistory.ts';
    const { useOperationHistory } = await import(/* @vite-ignore */ moduleUrl);
    return useOperationHistory.getState().undo();
  });
  expect(undone).toBe(true);
  await expect.poll(() => readState(page)).toMatchObject({
    completed: false,
    old: [{ id: 'old-r1', completed: false }, { id: 'old-r2', completed: false }],
    active: [{ id: 'old-r1' }, { id: 'old-r2' }],
    nodeStatus: 'unactivated',
    hasOldReviewSchedule: true,
  });
});

test('unified undo refuses to overwrite a new cycle changed after completion', async ({ page }) => {
  await completeWithRelearn(page);
  const undoResult = await page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
    const ebbUrl = resources.find((name) => name.includes('/src/ebb/store.ts?t=')) ?? '/src/ebb/store.ts';
    const historyUrl = resources.find((name) => name.includes('/src/services/operationHistory.ts?t=')) ?? '/src/services/operationHistory.ts';
    const { useEbbStore } = await import(/* @vite-ignore */ ebbUrl);
    const { useOperationHistory } = await import(/* @vite-ignore */ historyUrl);
    const current = useEbbStore.getState().reviewTasks;
    const target = current.find((task) => !task.isArchived && task.graphNodeId === 'limit-node');
    useEbbStore.setState({
      reviewTasks: current.map((task) => task.id === target?.id ? { ...task, dueDate: '2099-12-31' } : task),
    });
    return useOperationHistory.getState().undo();
  });

  expect(undoResult).toBe(false);
  const state = await readState(page);
  expect(state.completed).toBe(true);
  expect(state.active.some((task) => task.dueDate === '2099-12-31')).toBe(true);
});

test('quantity task asks only when the recorded amount first reaches 100 percent', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: '冲刺阶段项目' }).first().click();
  const card = page.locator('.stb-card').filter({ hasText: '章节题目' });
  await expect(card).toBeVisible();
  await card.locator('.stb-check').click();
  const quantityDialog = page.getByRole('dialog', { name: '记录今日完成量' });
  await quantityDialog.getByRole('spinbutton').fill('1');
  await quantityDialog.getByRole('button', { name: '完成记录' }).click();

  const completionDialog = page.getByRole('dialog', { name: '完成“章节题目”' });
  await expect(completionDialog).toBeVisible();
  await completionDialog.getByRole('button', { name: '确认完成' }).click();
  await expect(quantityDialog).toHaveCount(0);

  const state = await page.evaluate(async (date) => {
    const resources = performance.getEntriesByType('resource').map((entry) => entry.name);
    const timelineUrl = resources.find((name) => name.includes('/src/store/index.ts?t=')) ?? '/src/store/index.ts';
    const ebbUrl = resources.find((name) => name.includes('/src/ebb/store.ts?t=')) ?? '/src/ebb/store.ts';
    const { useTimelineStore } = await import(/* @vite-ignore */ timelineUrl);
    const { useEbbStore } = await import(/* @vite-ignore */ ebbUrl);
    const block = useTimelineStore.getState().tasks[0].blocks.find((item) => item.id === 'quantity-task');
    const reviews = useEbbStore.getState().reviewTasks.filter((task) => task.graphNodeId === 'quantity-node');
    return {
      completed: block?.type === 'smart-task' ? block.header.isCompleted : false,
      completedDate: block?.type === 'smart-task' ? block.header.completedDate : undefined,
      recorded: block?.type === 'smart-task' ? block.header.quantityRecords?.[date] : undefined,
      archivedOld: reviews.find((task) => task.id === 'quantity-old-r1')?.isArchived,
      activeRounds: reviews.filter((task) => !task.isArchived).length,
    };
  }, today);
  expect(state).toEqual({
    completed: true,
    completedDate: today,
    recorded: 1,
    archivedOld: true,
    activeRounds: 7,
  });
});

test('cancelling the completion decision does not change any module', async ({ page }) => {
  const card = await openTask(page);
  await card.getByRole('button', { name: '标记完成', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '完成“极限强化课”' });
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  await expect.poll(() => readState(page)).toMatchObject({
    completed: false,
    old: [{ id: 'old-r1', completed: false }, { id: 'old-r2', completed: false }],
    active: [{ id: 'old-r1' }, { id: 'old-r2' }],
    nodeStatus: 'unactivated',
    hasOldReviewSchedule: true,
  });
});

test('later manual uncompletion keeps the restarted review cycle', async ({ page }) => {
  await completeWithRelearn(page);
  const card = page.locator('.stb-card').filter({ hasText: '极限强化课' });
  await card.locator('.stb-check').click();

  await expect.poll(() => readState(page)).toMatchObject({
    completed: false,
    old: [{ id: 'old-r1', archived: true }, { id: 'old-r2', archived: true }],
    nodeStatus: 'unactivated',
  });
  const state = await readState(page);
  expect(state.active).toHaveLength(7);
});

test('daily schedule completion uses the same decision dialog', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const item = page.locator('.ds-item').filter({ hasText: '极限强化课' });
  await expect(item).toBeVisible();
  await item.getByRole('button', { name: '完成：极限强化课' }).click();
  const dialog = page.getByRole('dialog', { name: '完成“极限强化课”' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /只完成项目任务/ }).click();
  await dialog.getByRole('button', { name: '确认完成' }).click();
  await expect.poll(() => readState(page)).toMatchObject({ completed: true, active: [{ id: 'old-r1' }, { id: 'old-r2' }] });
});

test('week matrix completion uses the same decision dialog', async ({ page }) => {
  await page.getByTitle('周矩阵').click();
  await page.getByRole('button', { name: '标记完成：极限强化课' }).click();
  const dialog = page.getByRole('dialog', { name: '完成“极限强化课”' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /只完成项目任务/ }).click();
  await dialog.getByRole('button', { name: '确认完成' }).click();
  await expect.poll(() => readState(page)).toMatchObject({ completed: true, active: [{ id: 'old-r1' }, { id: 'old-r2' }] });
});

test('phone daily completion uses the same decision dialog', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.getByRole('tabpanel', { name: '今日手机视图' })).toBeVisible();
  await page.getByRole('button', { name: '完成极限强化课' }).click();
  const dialog = page.getByRole('dialog', { name: '完成“极限强化课”' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /只完成项目任务/ }).click();
  await dialog.getByRole('button', { name: '确认完成' }).click();
  await expect.poll(() => readState(page)).toMatchObject({ completed: true, active: [{ id: 'old-r1' }, { id: 'old-r2' }] });
});

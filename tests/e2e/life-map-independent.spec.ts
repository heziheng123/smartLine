import { expect, test } from '@playwright/test';

test.beforeEach(() => test.skip(true, '旧人生地图写入口已在迁移验收后关闭。'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({
      tasks: [], groups: [], notes: [], milestones: [], lifeStages: [],
    }));
  });
  await page.goto('/');
  await expect(page.getByTitle('人生地图')).toBeVisible();
});

test('人生地图创建人生计划只写入人生地图数据源', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('menuitem', { name: '新建人生计划' }).click();

  const editor = page.locator('.life-map-editor form');
  await expect(editor.getByRole('heading', { name: '新建人生计划' })).toBeVisible();
  await editor.getByLabel('名称').fill('健康重启计划');
  await editor.getByLabel('人生领域').selectOption('health');
  await editor.getByLabel('开始日期').fill('2026-08-01');
  await editor.getByLabel('结束日期').fill('2026-09-30');
  await editor.getByRole('button', { name: '保存', exact: true }).click();

  await expect.poll(() => page.evaluate(async () => {
    const [{ useTimelineStore }, { useLifeMapStore }] = await Promise.all([
      import('/src/testing/workspaceStoreAccess.ts'),
      import('/src/testing/workspaceStoreAccess.ts'),
    ]);
    return {
      lifePlan: useLifeMapStore.getState().lifeMapGoals.some((item) => item.name === '健康重启计划'),
      projectTask: useTimelineStore.getState().tasks.some((item) => item.name === '健康重启计划'),
    };
  })).toEqual({ lifePlan: true, projectTask: false });
  const planBand = lifeMap.locator('.life-line__project-band.is-life-plan').filter({ hasText: '健康重启计划' });
  await expect(planBand).toBeVisible();
  await planBand.dblclick();
  const editEditor = page.locator('.life-map-editor form');
  await expect(editEditor.getByRole('heading', { name: '编辑人生计划' })).toBeVisible();
  const editorLayout = await editEditor.evaluate((form) => {
    const phaseButton = form.querySelector<HTMLElement>('.life-map-editor__phases > header > button');
    const classification = form.querySelector<HTMLElement>('.life-map-editor__classification');
    const footer = form.querySelector<HTMLElement>(':scope > footer');
    const buttonRect = phaseButton?.getBoundingClientRect();
    const classificationRect = classification?.getBoundingClientRect();
    const footerRect = footer?.getBoundingClientRect();
    return {
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
      buttonWidth: buttonRect?.width ?? 0,
      buttonHeight: buttonRect?.height ?? 0,
      classificationHeight: classificationRect?.height ?? 0,
      footerBottom: footerRect?.bottom ?? window.innerHeight + 1,
      horizontalOverflow: form.scrollWidth > form.clientWidth,
    };
  });
  expect(editorLayout.buttonHeight).toBeLessThanOrEqual(40);
  expect(editorLayout.buttonWidth).toBeGreaterThan(editorLayout.viewportWidth <= 430 ? 30 : 72);
  expect(editorLayout.classificationHeight).toBeLessThan(90);
  expect(editorLayout.footerBottom).toBeLessThanOrEqual(editorLayout.viewportHeight);
  expect(editorLayout.horizontalOverflow).toBe(false);
});

test('旧版关联字段不会让项目规划任务隐式投影到人生地图', async ({ page }) => {
  await page.evaluate(async () => {
    const [{ useTimelineStore }, { useLifeMapStore }] = await Promise.all([
      import('/src/testing/workspaceStoreAccess.ts'),
      import('/src/testing/workspaceStoreAccess.ts'),
    ]);
    useTimelineStore.getState().addTask({
      id: 'timeline-only', name: '仅项目规划可见', start: '2026-08-01', end: '2026-10-31', blocks: [],
      planningAreaId: 'learning', lifeMapSource: 'timeline-project',
    } as Parameters<ReturnType<typeof useTimelineStore.getState>['addTask']>[0]);
    useLifeMapStore.getState().addGoal({
      id: 'life-only', areaId: 'learning', name: '仅人生地图可见', start: '2026-08-01', targetDate: '2026-10-31', kind: 'plan', status: 'active', progress: 0,
    });
  });
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await expect(lifeMap.locator('.life-line__project-band.is-life-plan').filter({ hasText: '仅人生地图可见' })).toBeVisible();
  await expect(lifeMap.locator('.life-line__project-band').filter({ hasText: '仅项目规划可见' })).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const task = useTimelineStore.getState().tasks.find((item) => item.id === 'timeline-only') as Record<string, unknown> | undefined;
    return task ? ['planningAreaId' in task, 'lifeMapSource' in task] : null;
  })).toEqual([false, false]);
});

test('项目规划任务可显式投影到指定人生类别，并保持项目为唯一数据源', async ({ page }) => {
  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    useTimelineStore.getState().addTask({
      id: 'projected-task',
      name: '健康类别中的项目投影',
      start: '2026-08-01',
      end: '2026-10-31',
      color: '#10B981',
      blocks: [],
    });
    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'timeline', taskId: 'projected-task' } }));
  });

  await page.locator('.pdv-title').click();
  const projectionEditor = page.locator('.tl-meta-life-map');
  await projectionEditor.getByRole('checkbox', { name: /投影到人生地图/ }).check();
  await projectionEditor.getByRole('combobox', { name: '人生类别' }).selectOption('health');
  await expect.poll(() => page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    return useTimelineStore.getState().tasks.find((item) => item.id === 'projected-task')?.lifeMapProjection;
  })).toEqual({ enabled: true, areaId: 'health', placement: 'above' });
  await page.getByRole('button', { name: '关闭项目文档' }).click();

  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  const projectedBand = lifeMap.locator('.life-line__project-band.is-life-plan').filter({ hasText: '健康类别中的项目投影' });
  await expect(projectedBand).toBeVisible();

  await projectedBand.click();
  const focusCard = lifeMap.locator('.life-line__project-focus-card');
  await expect(focusCard).toContainText('项目规划投影');
  await expect(focusCard.getByRole('button', { name: '添加子阶段' })).toHaveCount(0);
  await expect(focusCard.getByRole('button', { name: '维护' })).toHaveCount(0);
  await expect(focusCard.getByRole('button', { name: '打开项目' })).toBeVisible();

  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const task = useTimelineStore.getState().tasks.find((item) => item.id === 'projected-task');
    if (task) useTimelineStore.getState().updateTask({ ...task, name: '原项目改名后同步' });
  });
  await expect(lifeMap.locator('.life-line__project-band.is-life-plan').filter({ hasText: '原项目改名后同步' })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/testing/workspaceStoreAccess.ts');
    return useLifeMapStore.getState().lifeMapGoals.some((item) => item.name === '原项目改名后同步');
  })).toBe(false);

  await expect(focusCard).toContainText('原项目改名后同步');
  await focusCard.getByRole('button', { name: '打开项目' }).click();
  await expect(page.locator('.pdv-container')).toContainText('原项目改名后同步');
});

test('同名数据的编辑和删除互不影响', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const [{ useTimelineStore }, { useLifeMapStore }] = await Promise.all([
      import('/src/testing/workspaceStoreAccess.ts'),
      import('/src/testing/workspaceStoreAccess.ts'),
    ]);
    useTimelineStore.getState().addTask({ id: 'task-same', name: '同名内容', start: '2026-08-01', end: '2026-08-31', blocks: [] });
    useLifeMapStore.getState().addGoal({ id: 'plan-same', areaId: 'learning', name: '同名内容', start: '2026-08-01', targetDate: '2026-12-31', kind: 'plan', status: 'active', progress: 0 });
    useLifeMapStore.getState().updateGoal('plan-same', { name: '人生计划已修改' });
    useTimelineStore.getState().deleteTask('task-same');
    return {
      timelineCount: useTimelineStore.getState().tasks.length,
      lifePlanName: useLifeMapStore.getState().lifeMapGoals.find((item) => item.id === 'plan-same')?.name,
      lifePlanDeleted: Boolean(useLifeMapStore.getState().lifeMapGoals.find((item) => item.id === 'plan-same')?.deletedAt),
    };
  });
  expect(result).toEqual({ timelineCount: 0, lifePlanName: '人生计划已修改', lifePlanDeleted: false });
});

test('人生地图和项目规划持久化到两个独立 IndexedDB 数据库', async ({ page }) => {
  await page.evaluate(async () => {
    const [{ useTimelineStore }, { useLifeMapStore }] = await Promise.all([
      import('/src/testing/workspaceStoreAccess.ts'),
      import('/src/testing/workspaceStoreAccess.ts'),
    ]);
    useTimelineStore.getState().addTask({ id: 'db-task', name: '数据库任务', start: '2026-08-01', end: '2026-08-01', blocks: [] });
    useLifeMapStore.getState().addGoal({ id: 'db-plan', areaId: 'learning', name: '数据库人生计划', start: '2026-08-01', targetDate: '2026-08-01', kind: 'plan', status: 'active', progress: 0 });
    await new Promise((resolve) => window.setTimeout(resolve, 800));
  });
  const databases = await page.evaluate(async () => (await indexedDB.databases()).map((item) => item.name));
  expect(databases).toContain('smart-timeline');
  expect(databases).toContain('line-life-map');
});

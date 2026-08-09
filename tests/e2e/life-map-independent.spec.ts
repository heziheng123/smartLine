import { expect, test } from '@playwright/test';

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

test('添加菜单使用单列五项且关键日期不要求先选领域', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  const toolbar = lifeMap.locator('.life-line__toolbar');
  await expect(toolbar).toHaveCount(1);
  await expect(page.locator('.life-map-domains, .life-map-domains__summary')).toHaveCount(0);

  await toolbar.getByRole('button', { name: /全部人生/ }).click();
  const areaMenu = lifeMap.getByRole('menu', { name: '选择人生领域' });
  await expect(areaMenu).toBeVisible();
  await areaMenu.getByRole('menuitemradio', { name: /身体健康/ }).click();
  await expect(toolbar.getByRole('button', { name: /身体健康/ })).toBeVisible();

  await toolbar.getByRole('button', { name: '添加到时间线' }).click();
  const createMenu = lifeMap.getByTestId('life-map-primary-create');
  await expect(createMenu.getByRole('menuitem')).toHaveCount(5);
  await expect(createMenu.getByRole('button', { name: '新建目标' })).toHaveCount(0);
  await expect(createMenu.getByRole('menuitem', { name: '新建项目' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(createMenu.getByRole('menuitem', { name: '新建长期系统' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(toolbar.getByRole('button', { name: '添加到时间线' })).toBeFocused();
  await toolbar.getByRole('button', { name: '添加到时间线' }).click();
  await expect(createMenu.getByRole('menuitem', { name: '新建关键日期' })).toBeVisible();
  await expect(createMenu.getByRole('menuitem', { name: '添加时期重点' })).toBeVisible();
  await expect(createMenu.getByRole('menuitem', { name: '添加文字便签' })).toBeVisible();
  await expect(createMenu).not.toContainText(/人生时期|人生领域|复盘|批量平移/);

  await createMenu.getByRole('menuitem', { name: '新建关键日期' }).click();
  await expect(lifeMap.locator('.life-line__hint')).toContainText('关键日期');
  await expect(lifeMap.getByRole('menu', { name: '选择人生领域' })).toHaveCount(0);
});

test('顶部只保留下一个关键日期且规划概览按三大类管理二级分类', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await expect(lifeMap.locator('.life-map-planning-summary')).toHaveCount(0);
  await expect(lifeMap.locator('.life-line__status-line')).toHaveCount(0);
  await expect(lifeMap.getByRole('button', { name: /下一关键日期/ })).toBeVisible();
  await expect(lifeMap).not.toContainText('核心目标');

  await lifeMap.getByRole('button', { name: '规划概览' }).click();
  const drawer = page.getByRole('dialog', { name: '规划概览' });
  await expect(drawer).toBeVisible();
  for (const heading of ['进行中', '长期系统', '时期重点', '复盘', '结构设置', '画布工具']) {
    if (heading === '时期重点' || heading === '画布工具') await expect(drawer.getByRole('heading', { name: heading })).toHaveCount(0);
    else await expect(drawer.getByRole('heading', { name: heading })).toBeVisible();
  }
  await expect(drawer.getByRole('button', { name: '新建人生时期' })).toBeVisible();
  for (const group of ['学习', '工作', '生活']) {
    await expect(drawer.getByRole('group', { name: `${group}二级分类` })).toBeVisible();
    await expect(drawer.getByRole('button', { name: `在${group}下添加二级分类` })).toBeVisible();
  }
  await drawer.getByRole('button', { name: '关闭规划概览' }).click();
  await expect(drawer).toHaveCount(0);
});

test('添加菜单提供时期重点时间概述入口且视图设置不再重复提供', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('menuitem', { name: '添加时期重点' }).click();
  await expect(lifeMap.locator('.life-line__hint')).toContainText('在画布上横向拖动选择时间范围');
  await lifeMap.locator('.life-line__hint').getByRole('button', { name: '退出' }).click();
  await lifeMap.getByRole('button', { name: '视图设置' }).click();
  await expect(lifeMap.locator('.life-line__view-menu').getByRole('button', { name: '添加时期重点' })).toHaveCount(0);
});

test('所有一级分类为空时项目创建会引导先添加二级分类', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    useLifeMapStore.setState((state) => ({
      lifeMapAreas: state.lifeMapAreas.map((area) => ({ ...area, deletedAt: '2026-08-09T00:00:00.000Z' })),
    }));
  });
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await expect(lifeMap.getByRole('menuitem', { name: '添加时期重点' })).toBeDisabled();
  await expect(lifeMap.getByRole('menuitem', { name: '添加文字便签' })).toBeDisabled();
  await expect(lifeMap.getByRole('menuitem', { name: '先创建二级分类' })).toBeVisible();
  await lifeMap.getByRole('menuitem', { name: '新建项目' }).click();
  const editor = page.locator('.life-map-editor form');
  await expect(editor.getByRole('button', { name: '先创建二级分类' })).toBeVisible();
  await expect(editor.getByRole('alert')).toContainText('请先创建二级分类');
  await editor.getByLabel('名称').fill('不应保存的项目');
  await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    return useLifeMapStore.getState().lifeMapGoals.filter((item) => item.kind === 'plan' && !item.deletedAt).length;
  })).toBe(0);
});

test('长期系统进入所属领域并固定排在项目轨道上方', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    const state = useLifeMapStore.getState();
    state.addSystem({ areaId: 'learning', name: '每日背词', start: '2026-08-01', end: '2026-10-31', frequency: 'daily', targetCount: 1, status: 'active' });
    state.addSystem({ areaId: 'learning', name: '每周模考', start: '2026-08-15', end: '2026-10-15', frequency: 'weekly', targetCount: 1, status: 'active' });
    state.addGoal({ areaId: 'learning', name: '考研复习项目', start: '2026-08-01', targetDate: '2026-10-31', status: 'active', progress: 0, kind: 'plan' });
  });
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  const systems = lifeMap.locator('.life-line__project-band.is-life-system');
  const plan = lifeMap.locator('.life-line__project-band.is-life-plan').filter({ hasText: '考研复习项目' });
  await expect(systems).toHaveCount(2);
  await expect(systems.nth(0)).toHaveAttribute('data-band-level', '0');
  await expect(systems.nth(1)).toHaveAttribute('data-band-level', '1');
  await expect(plan).toHaveAttribute('data-band-level', '2');
  await expect(systems.nth(0)).toHaveAttribute('data-plan-group', 'learning');
});

test('项目编辑器首屏只显示必填项且不再关联结果目标', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('menuitem', { name: '新建项目' }).click();
  const editor = page.locator('.life-map-editor form');
  await expect(editor.getByRole('heading', { name: '新建项目' })).toBeVisible();
  await expect(editor.getByLabel('名称')).toBeVisible();
  await expect(editor.getByLabel('开始日期')).toBeVisible();
  await expect(editor.getByLabel('结束日期')).toBeVisible();
  await expect(editor.getByLabel('人生领域')).toBeVisible();
  await expect(editor.getByLabel('状态')).toHaveCount(0);
  await expect(editor.getByLabel('项目说明')).toHaveCount(0);

  await editor.getByRole('button', { name: '更多设置' }).click();
  await expect(editor.getByLabel('状态')).toBeVisible();
  await expect(editor.getByLabel('项目说明')).toBeVisible();
  await expect(editor.getByLabel('关联结果目标')).toHaveCount(0);
  await expect(editor.getByLabel('选择识别色')).toBeVisible();
});

test('关键日期默认全局且可选关联项目，切换领域后仍保留', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    useLifeMapStore.getState().addGoal({ id: 'event-plan', areaId: 'learning', name: '报名准备项目', start: '2026-08-01', targetDate: '2026-10-31', status: 'active', progress: 0, kind: 'plan' });
  });
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('menuitem', { name: '新建关键日期' }).click();
  await lifeMap.getByLabel('时间画布绘制区域').click({ position: { x: 520, y: 160 } });
  const editor = page.locator('.life-line__draft-editor');
  await editor.getByLabel('内容').fill('报名截止');
  await editor.getByText('更多设置', { exact: true }).click();
  await editor.getByLabel('关联项目').selectOption('event-plan');
  await expect(editor.getByLabel('关联领域')).toHaveValue('');
  await editor.getByRole('button', { name: '添加到画布' }).click();

  const saved = await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    return useLifeMapStore.getState().lifeMapEvents.find((item) => item.name === '报名截止');
  });
  expect(saved?.areaId).toBeUndefined();
  expect(saved?.relatedPlanId).toBe('event-plan');

  const eventAnchor = lifeMap.locator('.life-line__anchor.is-milestone[title*="报名截止"]');
  await expect(eventAnchor).toBeVisible();
  await lifeMap.getByRole('button', { name: /全部人生/ }).click();
  await lifeMap.getByRole('menuitemradio', { name: /职业发展/ }).click();
  await expect(eventAnchor).toBeVisible();
});

test('跨月项目与子阶段共用一条轨道并在缩放和重载后保持', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('menuitem', { name: '新建项目' }).click();
  let editor = page.locator('.life-map-editor form');
  await editor.getByLabel('名称').fill('考研政治');
  await editor.getByLabel('人生领域').selectOption('learning');
  await editor.getByLabel('开始日期').fill('2026-08-01');
  await editor.getByLabel('结束日期').fill('2026-10-31');
  await editor.getByRole('button', { name: '更多设置' }).click();
  await editor.getByLabel('项目说明').fill('完成一轮学习并进入整卷训练');
  await editor.getByRole('button', { name: '保存', exact: true }).click();

  for (const phase of [
    { name: '完成马原学习', start: '2026-08-01', end: '2026-08-31' },
    { name: '完成试卷训练', start: '2026-09-01', end: '2026-09-30' },
  ]) {
    await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
    await lifeMap.getByRole('menuitem', { name: '给现有项目添加子阶段' }).click();
    editor = page.locator('.life-map-editor form');
    await editor.getByLabel('名称').fill(phase.name);
    await expect(editor.getByLabel('所属项目')).not.toHaveValue('');
    await editor.getByLabel('开始日期').fill(phase.start);
    await editor.getByLabel('子阶段结束').fill(phase.end);
    await editor.getByRole('button', { name: '保存', exact: true }).click();
  }

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('menuitem', { name: '给现有项目添加子阶段' }).click();
  editor = page.locator('.life-map-editor form');
  await editor.getByLabel('名称').fill('日期重叠的阶段');
  await editor.getByLabel('开始日期').fill('2026-08-20');
  await editor.getByLabel('子阶段结束').fill('2026-09-10');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('与子阶段“完成马原学习”重叠');
  await editor.getByRole('button', { name: '取消' }).click();

  const plan = page.locator('.life-line__project-band.is-life-plan').filter({ hasText: '考研政治' });
  const phases = page.locator('.life-line__project-band.is-life-phase');
  const gap = page.getByRole('note', { name: '考研政治未规划区间：2026-10-01至2026-10-31' });
  await expect(plan).toBeVisible();
  await expect(phases).toHaveCount(2);
  await expect(gap).toBeVisible();
  await expect(gap).toContainText('未规划');
  await expect(page.locator('.life-line__plan-row-label')).toHaveCount(0);
  await expect(phases.nth(0)).toHaveAttribute('data-phase-density', 'medium');
  await expect(phases.nth(0)).toContainText('8月 完成马原学习');
  await expect(phases.nth(1)).toContainText('9月 完成试卷训练');
  await expect(phases.nth(0)).toHaveAttribute('title', /考研政治 · 完成马原学习/);
  const lanes = await Promise.all([plan, phases.nth(0), phases.nth(1)].map(async (item) => `${await item.getAttribute('data-band-side')}:${await item.getAttribute('data-band-level')}`));
  expect(new Set(lanes).size).toBe(1);

  await page.getByRole('combobox', { name: '时间尺度' }).click();
  await page.getByRole('option', { name: /^年视图/ }).click();
  await expect(plan).toBeVisible();
  await expect(phases.nth(0)).toBeHidden();
  await expect(phases.nth(1)).toBeHidden();

  await page.waitForTimeout(550);
  await page.reload();
  await page.getByTitle('人生地图').click();
  await expect(page.locator('.life-line__project-band.is-life-plan')).toHaveCount(1);
  await page.getByRole('combobox', { name: '时间尺度' }).click();
  await page.getByRole('option', { name: /^月视图/ }).click();
  await expect(page.locator('.life-line__project-band.is-life-phase')).toHaveCount(2);
});

test('项目和长期系统使用独立数据并在重载后保留', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('menuitem', { name: '新建项目' }).click();
  const planEditor = page.locator('.life-map-editor form');
  await planEditor.getByLabel('名称').fill('恢复体能项目');
  await planEditor.getByLabel('人生领域').selectOption('health');
  await planEditor.getByLabel('结束日期').fill('2026-09-30');
  await planEditor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.life-line__project-band.is-life-plan').filter({ hasText: '恢复体能项目' })).toBeVisible();

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('menuitem', { name: '新建长期系统' }).click();
  const systemEditor = page.locator('.life-map-editor form');
  await expect(systemEditor.getByRole('heading', { name: '新建长期系统' })).toBeVisible();
  await systemEditor.getByLabel('名称').fill('每周跑步');
  await systemEditor.getByLabel('人生领域').selectOption('health');
  await systemEditor.getByRole('button', { name: '更多设置' }).click();
  await systemEditor.getByLabel('目标次数').fill('3');
  await systemEditor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.life-line__project-band.is-life-system')).toBeVisible();

  // 人生地图仍使用独立存储，不得写入普通时间线任务。
  const state = await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    return {
      projectNames: useTimelineStore.getState().tasks.map((item) => item.name),
    };
  });
  expect(state.projectNames).not.toContain('恢复体能项目');
  expect(state.projectNames).not.toContain('每周跑步');

  await page.waitForTimeout(550);
  await page.reload();
  await page.getByTitle('人生地图').click();
  await expect(page.locator('.life-line__project-band.is-life-plan').filter({ hasText: '恢复体能项目' })).toBeVisible();
  await expect(page.locator('.life-line__project-band.is-life-system').filter({ hasText: '每周跑步' })).toBeVisible();
});

test('长期系统打卡纠错和二级分类周期复盘形成独立闭环', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('menuitem', { name: '新建长期系统' }).click();
  let editor = page.locator('.life-map-editor form');
  await editor.getByLabel('名称').fill('每周运动');
  await editor.getByLabel('人生领域').selectOption('health');
  await editor.getByRole('button', { name: '更多设置' }).click();
  await editor.getByLabel('目标次数').fill('3');
  await editor.getByLabel('每次分钟').fill('40');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.life-line__project-band.is-life-system').filter({ hasText: '每周运动' }).dblclick();
  editor = page.locator('.life-map-editor form');
  await editor.locator('.life-map-editor__checkin-row').getByRole('button', { name: '+', exact: true }).click();
  await expect(editor.locator('.life-map-editor__checkin')).toContainText('本周 1/3');
  await editor.locator('.life-map-editor__checkin-row').getByRole('button', { name: '−', exact: true }).click();
  await expect(editor.locator('.life-map-editor__checkin')).toContainText('本周 0/3');
  await editor.getByRole('button', { name: '取消' }).click();

  await lifeMap.getByRole('button', { name: '规划概览' }).click();
  await page.getByRole('dialog', { name: '规划概览' }).getByRole('button', { name: '开始月度复盘' }).click();
  editor = page.locator('.life-map-editor form');
  await editor.getByLabel('复盘范围').selectOption('health');
  await editor.getByLabel('复盘标题').fill('健康规划月度复盘');
  await editor.getByLabel('本周期发生了什么').fill('运动系统已经开始运行。');
  await editor.getByLabel('下一周期如何调整').fill('保持每周三次，避免突然加量。');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await lifeMap.getByRole('button', { name: '规划概览' }).click();
  await expect(page.getByRole('dialog', { name: '规划概览' }).getByRole('button', { name: /健康规划月度复盘/ })).toBeVisible();
});

test('规划概览不再重复提供时期重点创建入口', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await lifeMap.getByRole('button', { name: '规划概览' }).click();
  const drawer = page.getByRole('dialog', { name: '规划概览' });
  await expect(drawer.getByRole('button', { name: '新建时期重点' })).toHaveCount(0);
  await expect(drawer).not.toContainText('画布工具');
});

test('弹性规划会联动平移项目子阶段、保护固定日期，并支持维护与撤销', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    const state = useLifeMapStore.getState();
    const plan = state.addGoal({
      areaId: 'learning', name: '考研政治', start: '2026-08-01', targetDate: '2026-09-30', kind: 'plan',
    });
    state.addGoal({
      areaId: 'learning', name: '完成马原', start: '2026-08-01', targetDate: '2026-08-31', kind: 'phase', parentGoalId: plan.id,
    });
    state.addEvent({ areaId: 'learning', name: '研究生预报名', date: '2026-09-24', importance: 'important' });
    state.addSystem({ areaId: 'learning', name: '每天复盘', start: '2026-08-01', frequency: 'daily', targetCount: 1 });
  });

  await lifeMap.getByRole('button', { name: /全部人生/ }).click();
  await lifeMap.getByRole('menuitemradio', { name: /学习成长/ }).click();
  await lifeMap.getByRole('button', { name: '规划概览' }).click();
  await page.getByRole('dialog', { name: '规划概览' }).getByRole('button', { name: '调整项目日期' }).click();
  const shiftDialog = page.getByRole('region', { name: '批量平移计划' });
  await expect(shiftDialog).toBeVisible();
  await expect(shiftDialog.locator('.life-map-shift-dialog__preview')).toContainText('完成马原');
  await shiftDialog.getByRole('button', { name: '确认平移 7 天' }).click();

  let dates = await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    const state = useLifeMapStore.getState();
    return {
      plan: state.lifeMapGoals.find((item) => item.name === '考研政治'),
      phase: state.lifeMapGoals.find((item) => item.name === '完成马原'),
      event: state.lifeMapEvents.find((item) => item.name === '研究生预报名'),
    };
  });
  expect(dates.plan?.start).toBe('2026-08-08');
  expect(dates.phase?.targetDate).toBe('2026-09-07');
  expect(dates.event?.date).toBe('2026-09-24');

  await page.getByRole('status').getByRole('button', { name: '撤销' }).click();
  dates = await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    const state = useLifeMapStore.getState();
    return {
      plan: state.lifeMapGoals.find((item) => item.name === '考研政治'),
      phase: state.lifeMapGoals.find((item) => item.name === '完成马原'),
      event: state.lifeMapEvents.find((item) => item.name === '研究生预报名'),
    };
  });
  expect(dates.plan?.start).toBe('2026-08-01');
  expect(dates.phase?.targetDate).toBe('2026-08-31');
  expect(dates.event?.date).toBe('2026-09-24');

  await lifeMap.getByRole('button', { name: /学习成长/ }).click();
  await lifeMap.getByRole('button', { name: /“学习成长”进入维护/ }).click();
  const maintenanceDialog = page.getByRole('region', { name: '学习成长维护模式' });
  await maintenanceDialog.getByLabel('原因或说明').fill('身体恢复');
  await maintenanceDialog.getByRole('button', { name: '开始维护' }).click();
  const learningScope = lifeMap.getByRole('button', { name: '查看领域：学习成长' });
  await expect(learningScope).toContainText('维护中');
  await expect(page.locator('.life-line__project-band.is-life-plan.is-maintenance')).toBeVisible();

  await learningScope.click();
  await lifeMap.getByRole('button', { name: /结束“学习成长”维护/ }).click();
  await page.getByRole('region', { name: '学习成长维护模式' }).getByRole('button', { name: '唤醒，日期不变' }).click();
  await expect(page.locator('.life-line__project-band.is-life-plan.is-maintenance')).toHaveCount(0);
});

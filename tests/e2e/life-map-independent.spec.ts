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

test('人生领域与新增入口合并进唯一主工具栏', async ({ page }) => {
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
  await expect(lifeMap.getByRole('button', { name: '新建目标' })).toBeVisible();
  await expect(lifeMap.getByRole('button', { name: '新建主计划' })).toBeVisible();
  await expect(lifeMap.getByRole('button', { name: '新建长期系统' })).toBeVisible();
  await expect(lifeMap.getByRole('button', { name: '关键日期工具' })).toBeVisible();
  await expect(lifeMap.getByRole('button', { name: '区间标注工具' })).toBeVisible();
  await expect(lifeMap.getByRole('button', { name: '文字便签工具' })).toBeVisible();
  await expect(lifeMap.getByRole('button', { name: '新建计划阶段' })).toHaveCount(0);
  await expect(lifeMap.getByRole('button', { name: '新建领域主题' })).toHaveCount(0);
  await lifeMap.getByRole('button', { name: '更多操作' }).click();
  await expect(lifeMap.getByRole('button', { name: '新建计划阶段' })).toBeVisible();
  await expect(lifeMap.getByRole('button', { name: '新建领域主题' })).toBeVisible();
});

test('跨月主计划与阶段共用一条轨道并在缩放和重载后保持', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '新建主计划' }).click();
  let editor = page.locator('.life-map-editor form');
  await editor.getByLabel('名称').fill('考研政治');
  await editor.getByLabel('人生领域').selectOption('learning');
  await editor.getByLabel('开始日期').fill('2026-08-01');
  await editor.getByLabel('结束日期').fill('2026-10-31');
  await editor.getByLabel('计划说明').fill('完成一轮学习并进入整卷训练');
  await editor.getByRole('button', { name: '保存', exact: true }).click();

  for (const phase of [
    { name: '完成马原学习', start: '2026-08-01', end: '2026-08-31' },
    { name: '完成试卷训练', start: '2026-09-01', end: '2026-09-30' },
  ]) {
    await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
    await lifeMap.getByRole('button', { name: '更多操作' }).click();
    await lifeMap.getByRole('button', { name: '新建计划阶段' }).click();
    editor = page.locator('.life-map-editor form');
    await editor.getByLabel('名称').fill(phase.name);
    await expect(editor.getByLabel('所属主计划')).not.toHaveValue('');
    await editor.getByLabel('开始日期').fill(phase.start);
    await editor.getByLabel('阶段结束').fill(phase.end);
    await editor.getByRole('button', { name: '保存', exact: true }).click();
  }

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '更多操作' }).click();
  await lifeMap.getByRole('button', { name: '新建计划阶段' }).click();
  editor = page.locator('.life-map-editor form');
  await editor.getByLabel('名称').fill('日期重叠的阶段');
  await editor.getByLabel('开始日期').fill('2026-08-20');
  await editor.getByLabel('阶段结束').fill('2026-09-10');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(editor.getByRole('alert')).toContainText('与阶段“完成马原学习”重叠');
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

test('人生目标和长期系统使用独立数据并在重载后保留', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '新建目标' }).click();
  const goalEditor = page.locator('.life-map-editor form');
  await expect(goalEditor.getByRole('heading', { name: '新建目标' })).toBeVisible();
  await goalEditor.getByLabel('名称').fill('恢复体能到稳定水平');
  await goalEditor.getByLabel('人生领域').selectOption('health');
  await goalEditor.getByLabel('目标日期').fill('2026-09-30');
  await goalEditor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: /目标：恢复体能到稳定水平/ })).toBeVisible();

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '新建长期系统' }).click();
  const systemEditor = page.locator('.life-map-editor form');
  await expect(systemEditor.getByRole('heading', { name: '新建长期系统' })).toBeVisible();
  await systemEditor.getByLabel('名称').fill('每周跑步');
  await systemEditor.getByLabel('人生领域').selectOption('health');
  await systemEditor.getByLabel('目标次数').fill('3');
  await systemEditor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.locator('.life-line__project-band.is-life-system')).toBeVisible();
  await expect(page.locator('.life-map-system-strip').getByRole('button', { name: /每周跑步/ })).toBeVisible();

  // 目标灯塔和长期系统已经证明两个独立实体进入了当前人生地图。这里仅检查它们
  // 没有被错误写进项目规划；刷新后的断言继续覆盖 IndexedDB 持久化。
  const state = await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    return {
      projectNames: useTimelineStore.getState().tasks.map((item) => item.name),
    };
  });
  expect(state.projectNames).not.toContain('恢复体能到稳定水平');
  expect(state.projectNames).not.toContain('每周跑步');

  await page.waitForTimeout(550);
  await page.reload();
  await page.getByTitle('人生地图').click();
  await expect(page.getByRole('button', { name: /目标：恢复体能到稳定水平/ })).toBeVisible();
  await expect(page.locator('.life-map-system-strip').getByRole('button', { name: /每周跑步/ })).toBeVisible();
});

test('目标状态、长期系统打卡纠错和领域周期复盘形成独立闭环', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '新建目标' }).click();
  let editor = page.locator('.life-map-editor form');
  await editor.getByLabel('名称').fill('建立健康体能基线');
  await editor.getByLabel('人生领域').selectOption('health');
  await editor.getByLabel('目标日期').fill('2026-09-30');
  await editor.locator('input[type="range"]').fill('35');
  await editor.getByLabel('衡量指标').fill('每周运动次数');
  await editor.getByLabel('目标值').fill('3');
  await editor.getByLabel('设为当前核心目标').check();
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.getByRole('button', { name: /目标：建立健康体能基线/ }).click();
  editor = page.locator('.life-map-editor form');
  await expect(editor.locator('input[type="range"]')).toHaveValue('35');
  await expect(editor.getByRole('button', { name: '加入今日安排' })).toHaveCount(0);
  await editor.getByRole('button', { name: '取消' }).click();

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '新建长期系统' }).click();
  editor = page.locator('.life-map-editor form');
  await editor.getByLabel('名称').fill('每周运动');
  await editor.getByLabel('人生领域').selectOption('health');
  await editor.getByLabel('目标次数').fill('3');
  await editor.getByLabel('每次分钟').fill('40');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await page.locator('.life-map-system-strip').getByRole('button', { name: /每周运动/ }).click();
  editor = page.locator('.life-map-editor form');
  await editor.locator('.life-map-editor__checkin-row').getByRole('button', { name: '+', exact: true }).click();
  await expect(editor.locator('.life-map-editor__checkin')).toContainText('本周 1/3');
  await editor.locator('.life-map-editor__checkin-row').getByRole('button', { name: '−', exact: true }).click();
  await expect(editor.locator('.life-map-editor__checkin')).toContainText('本周 0/3');
  await editor.getByRole('button', { name: '取消' }).click();

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '更多操作' }).click();
  await lifeMap.getByRole('button', { name: '新建周期复盘' }).click();
  editor = page.locator('.life-map-editor form');
  await editor.getByLabel('复盘范围').selectOption('health');
  await editor.getByLabel('复盘标题').fill('健康规划月度复盘');
  await editor.getByLabel('本周期发生了什么').fill('目标和运动系统已经开始运行。');
  await editor.getByLabel('下一周期如何调整').fill('保持每周三次，避免突然加量。');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '复盘 · 健康规划月度复盘时间条带' })).toBeVisible();
});

test('全部人生下添加画布标注会要求先明确选择领域', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '区间标注工具' }).click();
  await expect(lifeMap.locator('.life-line__quick-error')).toContainText('请先选择一个人生领域');
  await expect(lifeMap.getByRole('menu', { name: '选择人生领域' })).toBeVisible();
  await lifeMap.getByRole('menuitemradio', { name: /身体健康/ }).click();
  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '区间标注工具' }).click();
  await expect(lifeMap.locator('.life-line__hint')).toContainText('阶段概述');
});

test('弹性规划会联动平移计划阶段、保护固定日期，并支持维护与撤销', async ({ page }) => {
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
  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '更多操作' }).click();
  await lifeMap.getByRole('button', { name: '批量平移计划' }).click();
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
  await expect(page.locator('.life-map-system-strip')).toContainText('维护中');

  await learningScope.click();
  await lifeMap.getByRole('button', { name: /结束“学习成长”维护/ }).click();
  await page.getByRole('region', { name: '学习成长维护模式' }).getByRole('button', { name: '唤醒，日期不变' }).click();
  await expect(page.locator('.life-line__project-band.is-life-plan.is-maintenance')).toHaveCount(0);
});

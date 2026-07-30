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
  await expect(lifeMap.getByRole('button', { name: '新建长期系统' })).toBeVisible();
  await expect(lifeMap.getByRole('button', { name: '新建领域主题' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: '恢复体能到稳定水平时间条带' })).toBeVisible();

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('button', { name: '新建长期系统' }).click();
  const systemEditor = page.locator('.life-map-editor form');
  await expect(systemEditor.getByRole('heading', { name: '新建长期系统' })).toBeVisible();
  await systemEditor.getByLabel('名称').fill('每周跑步');
  await systemEditor.getByLabel('人生领域').selectOption('health');
  await systemEditor.getByLabel('目标次数').fill('3');
  await systemEditor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: /每周跑步.*时间条带/ })).toBeVisible();

  // 时间条带已经证明两个独立实体进入了当前人生地图。这里仅检查它们
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
  await expect(page.getByRole('button', { name: '恢复体能到稳定水平时间条带' })).toBeVisible();
  await expect(page.getByRole('button', { name: /每周跑步.*时间条带/ })).toBeVisible();
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
  await page.getByRole('button', { name: '建立健康体能基线时间条带' }).click();
  await page.locator('.life-line__project-focus-card').getByRole('button', { name: '编辑' }).click();
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
  await page.getByRole('button', { name: /每周运动.*时间条带/ }).click();
  await page.locator('.life-line__project-focus-card').getByRole('button', { name: '编辑' }).click();
  editor = page.locator('.life-map-editor form');
  await editor.locator('.life-map-editor__checkin-row').getByRole('button', { name: '+', exact: true }).click();
  await expect(editor.locator('.life-map-editor__checkin')).toContainText('本周 1/3');
  await editor.locator('.life-map-editor__checkin-row').getByRole('button', { name: '−', exact: true }).click();
  await expect(editor.locator('.life-map-editor__checkin')).toContainText('本周 0/3');
  await editor.getByRole('button', { name: '取消' }).click();

  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
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

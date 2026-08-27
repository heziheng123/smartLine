import { expect, test } from '@playwright/test';

test.beforeEach(() => test.skip(true, '旧人生地图写入口已在迁移验收后关闭。'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.goto('/');
  await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const store = useLifeMapStore.getState();
    store.addStage({ id: 'v13-stage', name: 'v13 验证阶段', start: '2026-08-01', end: '2026-08-31', description: '用于验证阶段工作台内容归属', importance: 'important', color: '#7C6FE6' });
    store.addGoal({ id: 'v13-plan', areaId: 'learning', name: '阶段内项目', start: '2026-08-01', targetDate: '2026-08-31', kind: 'plan', status: 'active', progress: 40, color: '#6366F1' });
    store.addGoal({ id: 'v13-phase', areaId: 'learning', name: '项目子阶段', start: '2026-08-10', targetDate: '2026-08-20', kind: 'phase', parentGoalId: 'v13-plan', status: 'active', progress: 80, color: '#6366F1' });
    store.addSystem({ id: 'v13-system', areaId: 'learning', name: '每日复习', start: '2026-08-01', frequency: 'daily', targetCount: 1, color: '#10B981' });
    store.addSystemCheckIn('v13-system', '2026-08-12', 2);
    store.addFocus({ id: 'v13-focus', areaId: 'learning', name: '重点复习', start: '2026-08-08', end: '2026-08-22', color: '#0EA5E9' });
    store.addNote({ id: 'v13-note', areaId: 'learning', name: '阶段笔记', date: '2026-08-15', type: 'pin', color: '#F59E0B' });
    store.addEvent({ id: 'v13-event', name: '模拟考试', date: '2026-08-18', importance: 'important' });
  });
  await page.getByTitle('人生地图').click();
  await page.getByText('纵向预览', { exact: true }).click();
});

test('v13 vertical life map opens a workspace with projects, phases, systems, focus, notes and events', async ({ page }) => {
  const map = page.getByRole('main', { name: '纵向人生地图' });
  await expect(map.getByRole('button', { name: '新建阶段' })).toBeVisible();
  await page.getByRole('button', { name: '打开阶段：v13 验证阶段' }).click();
  const workspace = page.getByRole('complementary', { name: 'v13 验证阶段阶段工作台' });
  await expect(workspace.getByRole('heading', { name: 'v13 验证阶段' })).toBeVisible();
  await expect(workspace.getByText('阶段时间轴', { exact: true })).toBeVisible();
  await expect(workspace.getByText('阶段内项目', { exact: true })).toBeVisible();
  await expect(workspace.getByText('项目子阶段', { exact: true })).toBeVisible();
  await expect(workspace.getByText('每日复习', { exact: true })).toBeVisible();
  await expect(workspace.getByText('重点复习', { exact: true })).toBeVisible();
  await expect(workspace.getByText('阶段笔记', { exact: true })).toBeVisible();
  await workspace.getByRole('button', { name: '周' }).click();
  await expect(workspace.getByRole('button', { name: '周' })).toHaveAttribute('aria-pressed', 'true');
});

test('v13 new-stage dialog uses the current viewport date and keeps the legacy view available', async ({ page }) => {
  const map = page.getByRole('main', { name: '纵向人生地图' });
  await map.getByRole('button', { name: '新建阶段' }).click();
  const dialog = page.locator('.life-map-editor__panel--stage');
  await expect(dialog.getByRole('heading', { name: '新建阶段' })).toBeVisible();
  await dialog.getByLabel('阶段名称').fill('新阶段');
  await dialog.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.adaptive-life-map__stage')).toHaveCount(2);
  await map.getByRole('button', { name: '旧视图' }).click();
  await expect(page.getByRole('main', { name: '人生地图' })).toBeVisible();
});

import { expect, test } from '@playwright/test';

test.skip(process.env.MIGRATION_UI_TEST !== '1', '仅在认证迁移界面专项回归中运行');

test('legacy inspection reacts immediately and never looks like a dead button', async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, login: 'owner', userId: 'gh_12345' }),
  }));
  await page.route('**/api/storage/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ r2Configured: false }),
  }));
  await page.route('**/api/liveblocks-auth', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'simulated unavailable service' }),
  }));
  await page.addInitScript(() => {
    const enabled = JSON.stringify({ enabled: true, roomCode: 'migration-test-room' });
    localStorage.setItem('smart-timeline-liveblocks', enabled);
    localStorage.setItem('smart-ebb-liveblocks', enabled);
    localStorage.setItem('daily-schedule-liveblocks', enabled);
    localStorage.setItem('line-graph-liveblocks', enabled);
    localStorage.removeItem('smart-line-sync-architecture-v1');
  });

  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
  const syncButton = page.getByRole('button', { name: /打开同步与备份/ });
  await expect(syncButton).toBeVisible();
  await syncButton.click();
  const dialog = page.getByRole('dialog', { name: '云同步与完整备份' });
  await dialog.getByText('同步高级设置', { exact: true }).click();
  await expect(dialog.getByRole('button', { name: '迁移到统一工作区' })).toBeDisabled();
  await dialog.getByRole('button', { name: '检查旧数据' }).click();
  await expect(dialog.getByRole('button', { name: '检查中…' })).toBeDisabled();
  await expect(dialog.locator('[aria-label="旧同步架构迁移"] [role="status"]')).toContainText(/正在连接并读取|Liveblocks|失败|超时/);
});

test('a device can forget the current room and enter a different workspace code', async ({ page }) => {
  await page.route('**/api/auth/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, login: 'owner', userId: 'gh_12345' }),
  }));
  await page.route('**/api/storage/status', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ r2Configured: false }),
  }));
  await page.route('**/api/liveblocks-auth', (route) => route.fulfill({
    status: 503,
    contentType: 'application/json',
    body: JSON.stringify({ error: 'simulated unavailable service' }),
  }));
  await page.addInitScript(() => {
    const enabled = JSON.stringify({ enabled: true, roomCode: 'old-room' });
    localStorage.setItem('smart-timeline-liveblocks', enabled);
    localStorage.setItem('smart-ebb-liveblocks', enabled);
    localStorage.setItem('daily-schedule-liveblocks', enabled);
    localStorage.setItem('line-graph-liveblocks', enabled);
    localStorage.setItem('line-life-map-liveblocks', enabled);
    localStorage.removeItem('smart-line-sync-architecture-v1');
  });

  await page.goto('/');
  await page.getByRole('button', { name: /打开同步与备份/ }).click();
  const dialog = page.getByRole('dialog', { name: '云同步与完整备份' });
  await dialog.getByRole('button', { name: '更换工作区' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认执行' }).click();
  await expect(dialog.getByLabel('房间号（仍然只输入一个）')).toBeEditable();
  await expect(dialog.getByRole('button', { name: '一键连接五个模块' })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('smart-line-sync-auto-discovery-paused-v1'))).toBe('true');
});

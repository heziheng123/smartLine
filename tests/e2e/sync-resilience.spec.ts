import { expect, test, type Page } from '@playwright/test';

async function waitForApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.tl-dock')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const stores = await import('/src/testing/workspaceStoreAccess.ts');
    return [
      stores.useTimelineStore,
      stores.useEbbStore,
      stores.useDailyScheduleStore,
      stores.useGraphStore,
      stores.useLifeMapStore,
    ].every((store) => store.getState().isHydrated);
  })).toBe(true);
  // Let the post-hydration queue and cross-tab effects attach their listeners.
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

test('edits made while first connection is being inspected enter the durable queue', async ({ page }) => {
  await waitForApp(page);

  await page.evaluate(async () => {
    localStorage.removeItem('smart-line-sync-architecture-v1');
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    queue.setWorkspaceConnectionMutationCapture(true);
    try {
      useTimelineStore.getState().addLifeStage({
        id: 'connection-window-stage',
        name: '连接期间编辑',
        start: '2026-08-12',
        end: '2026-08-12',
      });
    } finally {
      queue.setWorkspaceConnectionMutationCapture(false);
    }
  });

  await expect.poll(() => page.evaluate(async () => {
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    const pending = await queue.readPendingWorkspaceSync();
    const stages = pending?.fields.lifeStages as Array<{ id?: string }> | undefined;
    return stages?.some((stage) => stage.id === 'connection-window-stage') ?? false;
  })).toBe(true);
});

test('a follower tab receives cloud-hydrated fields forwarded by the leader tab', async ({ context }) => {
  const [leader, follower] = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([waitForApp(leader), waitForApp(follower)]);

  await leader.evaluate(async () => {
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    queue.broadcastWorkspaceFields({
      lifeStages: [{
        id: 'remote-forwarded-stage',
        name: '另一设备更新',
        start: '2026-08-12',
        end: '2026-08-12',
      }],
    });
  });

  await expect.poll(() => follower.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    return useTimelineStore.getState().lifeStages.some((stage) => stage.id === 'remote-forwarded-stage');
  })).toBe(true);
});

test('tabs without Web Locks serialize simultaneous offline queue writes', async ({ context }) => {
  const disableWebLocks = () => {
    try {
      Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
    } catch { /* older WebKit already has no Web Locks API */ }
  };
  const [first, second] = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([first.addInitScript(disableWebLocks), second.addInitScript(disableWebLocks)]);
  await Promise.all([waitForApp(first), waitForApp(second)]);

  await Promise.all([
    first.evaluate(async () => {
      const queue = await import('/src/services/workspaceSyncQueueCore.ts');
      await queue.queueWorkspaceFields(
        { tasks: [{ id: 'fallback-lock-task', name: '来自标签页 A' }] },
        { tasks: [] },
        { bypassSuppression: true },
      );
    }),
    second.evaluate(async () => {
      const queue = await import('/src/services/workspaceSyncQueueCore.ts');
      await queue.queueWorkspaceFields(
        { nodes: [{ id: 'fallback-lock-node', title: '来自标签页 B' }] },
        { nodes: [] },
        { bypassSuppression: true },
      );
    }),
  ]);

  await expect.poll(() => first.evaluate(async () => {
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    const pending = await queue.readPendingWorkspaceSync();
    return Object.keys(pending?.fields ?? {}).sort();
  })).toEqual(['nodes', 'tasks']);
});

test('restoring an old conflict marks only selected fields for one-way cloud replacement', async ({ page }) => {
  await waitForApp(page);

  const result = await page.evaluate(async () => {
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    const recovery = await import('/src/services/workspaceOfflineQueue.ts');
    await queue.queueWorkspaceFields(
      {
        tasks: [{ id: 'recovered-task', name: '保留本机任务' }],
        nodes: [{ id: 'unselected-node', title: '暂不处理' }],
      },
      { tasks: [], nodes: [] },
      { bypassSuppression: true },
    );
    const pending = await queue.readPendingWorkspaceSync();
    if (!pending) throw new Error('测试冲突队列创建失败');
    await queue.preserveWorkspaceConflict(
      pending,
      '2026-08-12T00:00:00.000Z',
      { tasks: [], nodes: [] },
      ['tasks', 'nodes'],
    );
    const conflict = (await queue.listWorkspaceConflicts())[0];
    await recovery.restoreWorkspaceConflictFields(conflict.id, ['tasks']);
    const restored = await queue.readPendingWorkspaceSync();
    const remaining = await queue.listWorkspaceConflicts();
    return {
      pendingKeys: Object.keys(restored?.fields ?? {}).sort(),
      forceFields: restored?.forceFields?.slice().sort() ?? [],
      remainingKeys: Object.keys(remaining[0]?.pending.fields ?? {}).sort(),
    };
  });

  expect(result).toEqual({
    pendingKeys: ['tasks'],
    forceFields: ['tasks'],
    remainingKeys: ['nodes'],
  });
});

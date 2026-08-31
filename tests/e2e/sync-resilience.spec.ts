import { expect, test, type Page } from '@playwright/test';

test.setTimeout(60_000);

async function waitForApp(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.tl-dock')).toBeVisible({ timeout: 30_000 });
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

test('verification never hides an active conflict; only an explicit choice creates a recovery copy', async ({ page }) => {
  await waitForApp(page);

  const before = await page.evaluate(async () => {
    const stores = await import('/src/testing/workspaceStoreAccess.ts');
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    const currentTasks = stores.useTimelineStore.getState().tasks;
    const roomCode = 'historical-conflict-room';
    const roomId = `workspace-owner-${roomCode}`;

    localStorage.setItem('smart-line-sync-architecture-v1', JSON.stringify({
      architecture: 'unified',
      roomCode,
      unifiedRoomId: roomId,
    }));
    for (const store of [
      stores.useTimelineStore,
      stores.useEbbStore,
      stores.useDailyScheduleStore,
      stores.useGraphStore,
      stores.useLifeMapStore,
    ]) {
      store.setState({ syncEnabled: true, syncStatus: 'connected', syncRoomCode: roomCode });
    }

    await queue.queueWorkspaceFields(
      { tasks: [{ id: 'old-recovery-task', name: '旧恢复副本' }] },
      { tasks: currentTasks },
      { bypassSuppression: true },
    );
    const pending = await queue.readPendingWorkspaceSync();
    if (!pending) throw new Error('测试冲突队列创建失败');
    await queue.preserveWorkspaceConflict(pending, '2026-08-12T11:20:00.000Z', { tasks: [] }, ['tasks']);
    localStorage.setItem('smart-line-sync-last-connected', JSON.stringify({
      workspace: '2099-08-12T14:58:23.000Z',
      workspaceRoomId: roomId,
    }));
    window.dispatchEvent(new CustomEvent('smartline:workspace-verified'));
    window.dispatchEvent(new CustomEvent(queue.WORKSPACE_QUEUE_EVENT));
    return JSON.stringify(currentTasks);
  });

  await expect(page.locator('.workspace-sync-status')).toHaveAttribute('data-sync-state', 'error');
  await page.getByRole('button', { name: /打开同步与备份/ }).click();
  const dialog = page.getByRole('dialog', { name: '云同步与完整备份' });
  await expect(dialog).toBeVisible({ timeout: 30_000 });
  const activeConflict = dialog.getByRole('region', { name: '当前同步冲突' });
  await expect(activeConflict).toContainText('尚未解决的当前冲突');
  await expect(dialog.getByRole('region', { name: '历史恢复副本' })).toHaveCount(0);

  await activeConflict.getByRole('button', { name: '保留当前版本，标记已解决' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '继续' }).click();
  await expect(dialog.getByText(/历史副本 1/)).toBeVisible();
  await expect(dialog.getByRole('region', { name: '当前同步冲突' })).toHaveCount(0);
  const recovery = dialog.getByRole('region', { name: '历史恢复副本' });
  await expect(recovery).toContainText('不代表当前仍有同步故障');
  await expect(recovery.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.workspace-sync-status')).toHaveAttribute('data-sync-state', 'connected');

  await recovery.getByRole('button', { name: '当前内容正常，删除此副本' }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '确认执行' }).click();
  await expect(recovery).toHaveCount(0);

  const after = await page.evaluate(async () => {
    const stores = await import('/src/testing/workspaceStoreAccess.ts');
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    return {
      tasks: JSON.stringify(stores.useTimelineStore.getState().tasks),
      pending: await queue.readPendingWorkspaceSync(),
      conflictCount: (await queue.listWorkspaceConflicts()).length,
    };
  });
  expect(after).toEqual({ tasks: before, pending: null, conflictCount: 0 });
});

test('recovering an old field creates a complete snapshot before replacing current data', async ({ page }) => {
  await waitForApp(page);

  const result = await page.evaluate(async () => {
    const stores = await import('/src/testing/workspaceStoreAccess.ts');
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    const recovery = await import('/src/services/workspaceOfflineQueue.ts');
    const backups = await import('/src/services/workspaceBackup.ts');
    const currentTasks = stores.useTimelineStore.getState().tasks;
    await queue.queueWorkspaceFields(
      { tasks: [{ id: 'old-recovery-task', name: '需要找回的旧任务' }] },
      { tasks: currentTasks },
      { bypassSuppression: true },
    );
    const pending = await queue.readPendingWorkspaceSync();
    if (!pending) throw new Error('测试冲突队列创建失败');
    await queue.preserveWorkspaceConflict(pending, '2026-08-12T11:20:00.000Z', { tasks: [] }, ['tasks']);
    const conflict = (await queue.listWorkspaceConflicts())[0];
    await recovery.restoreWorkspaceConflictFields(conflict.id, ['tasks']);
    const snapshot = (await backups.listLocalSnapshots())[0];
    await backups.restoreLocalSnapshot(snapshot);
    return {
      reason: snapshot.reason,
      restoredCurrentTasks: JSON.stringify(stores.useTimelineStore.getState().tasks),
      expectedCurrentTasks: JSON.stringify(currentTasks),
    };
  });

  expect(result.reason).toContain('恢复冲突副本前');
  expect(result.restoredCurrentTasks).toBe(result.expectedCurrentTasks);
});

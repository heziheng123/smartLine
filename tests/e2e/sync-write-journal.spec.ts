import { expect, test, type Page } from '@playwright/test';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const project = {
  id: 'sync-journal-project',
  name: '同步保护测试项目',
  start: today,
  end: today,
  color: '#93c5fd',
  completed: false,
  blocks: [
    {
      type: 'smart-task',
      id: 'sync-journal-block',
      header: {
        title: '云端加载期间完成切换',
        tag: '默认',
        tagColor: '#f59e0b',
        date: today,
        duration: 30,
        isCompleted: false,
        autoSyncEbb: false,
      },
      body: '',
    },
  ],
};

async function readPendingWorkspaceSync(page: Page) {
  return await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('smart-timeline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains('workspace_sync_queue')) return null;
      return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const transaction = database.transaction('workspace_sync_queue', 'readonly');
        const request = transaction.objectStore('workspace_sync_queue').get('pending-v1');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

async function simulateConnectedStorageLoading(page: Page) {
  await page.evaluate(async () => {
    const storeModuleUrl = '/src/store/index.ts';
    const { useTimelineStore } = await import(storeModuleUrl);
    const current = useTimelineStore.getState();
    useTimelineStore.setState({
      liveblocks: {
        ...current.liveblocks,
        room: { getStatus: () => 'connected' },
        status: 'connected',
        isStorageLoading: true,
      },
    });
  });
}

async function simulateConnectedStorageReady(page: Page) {
  await page.evaluate(async () => {
    const storeModuleUrl = '/src/store/index.ts';
    const { useTimelineStore } = await import(storeModuleUrl);
    const current = useTimelineStore.getState();
    useTimelineStore.setState({
      liveblocks: {
        ...current.liveblocks,
        room: { getStatus: () => 'connected' },
        status: 'connected',
        isStorageLoading: false,
      },
    });
  });
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ projectData }) => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem(
      'smart-timeline-data:mirror',
      JSON.stringify({
        tasks: [projectData],
        groups: [],
        notes: [],
        milestones: [],
      }),
    );
    localStorage.setItem(
      'smart-line-sync-architecture-v1',
      JSON.stringify({
        architecture: 'unified',
        roomCode: 'e2e-journal',
        unifiedRoomId: 'workspace-e2e-journal',
      }),
    );
    for (const key of [
      'smart-timeline-liveblocks',
      'smart-ebb-liveblocks',
      'daily-schedule-liveblocks',
      'line-graph-liveblocks',
    ]) {
      localStorage.setItem(key, JSON.stringify({
        roomCode: 'e2e-journal',
        enabled: true,
      }));
    }
    // Keep this page as a follower so no real Liveblocks room is opened. A
    // follower must still journal every local user operation.
    localStorage.setItem(
      'smart-line-sync-leader-v1',
      JSON.stringify({
        tabId: 'another-e2e-tab',
        expiresAt: Date.now() + 60 * 60 * 1000,
      }),
    );
  }, { projectData: project });
  await page.goto('/');
});

test('rapid completion toggles are journaled while cloud storage is still loading', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.getByRole('menuitemradio', { name: '全部任务' }).click();
  const card = page.locator('[data-block-id="sync-journal-block"]');
  await expect(card).toBeVisible();

  // Reproduce the production race precisely: the room reports connected
  // before Liveblocks has finished loading its storage root.
  await simulateConnectedStorageLoading(page);

  await card.getByRole('button', { name: /^完成：/ }).click();
  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(true);

  await page.locator('.task-overview-stats button').filter({ hasText: '已完成' }).click();
  await page.locator('.task-overview-section-header').filter({ hasText: '已完成' }).click();
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/is-completed/);
  await card.getByRole('button', { name: /^取消完成：/ }).click();
  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(false);

  await page.locator('.task-overview-stats button').filter({ hasText: '全部任务' }).click();
  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/is-completed/);
});

test('late storage hydration cannot overwrite an explicit pending completion', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.getByRole('menuitemradio', { name: '全部任务' }).click();
  const card = page.locator('[data-block-id="sync-journal-block"]');
  await expect(card).toBeVisible();
  await simulateConnectedStorageLoading(page);

  await card.getByRole('button', { name: /^完成：/ }).click();
  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(true);

  await page.evaluate(async () => {
    const storeModuleUrl = '/src/store/index.ts';
    const { useTimelineStore } = await import(storeModuleUrl);
    useTimelineStore.setState((state) => ({
      tasks: state.tasks.map((task) => ({
        ...task,
        blocks: task.blocks.map((block) => block.id === 'sync-journal-block'
          ? { ...block, header: { ...block.header, isCompleted: false } }
          : block),
      })),
    }));
  });

  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(true);
});

test('connected storage journal keeps the newest cancellation instead of an older completion', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.getByRole('menuitemradio', { name: '全部任务' }).click();
  const card = page.locator('[data-block-id="sync-journal-block"]');
  await expect(card).toBeVisible();
  await simulateConnectedStorageReady(page);

  await card.getByRole('button', { name: /^完成：/ }).click();
  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(true);

  await page.locator('.task-overview-stats button').filter({ hasText: '已完成' }).click();
  await page.locator('.task-overview-section-header').filter({ hasText: '已完成' }).click();
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: /^取消完成：/ }).click();

  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(false);
});

test('an in-flight flush restarts with the newest queue revision', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    const {
      clearPendingWorkspaceSync,
      queueWorkspaceFields,
      readPendingWorkspaceSync,
    } = await import('/src/services/workspaceOfflineQueue.ts');
    const { flushWorkspaceQueue } = await import('/src/services/workspaceSync.ts');

    await clearPendingWorkspaceSync();
    const incomplete = [{ id: 'race-task', isCompleted: false }];
    const completed = [{ id: 'race-task', isCompleted: true }];
    const rootData: Record<string, unknown> = { tasks: incomplete };
    let releaseFirstStorage!: () => void;
    const firstStorageGate = new Promise<void>((resolve) => {
      releaseFirstStorage = resolve;
    });
    let storageReads = 0;
    const root = {
      toJSON: () => ({ ...rootData }),
      set: (key: string, value: unknown) => {
        rootData[key] = value;
      },
    };
    const room = {
      getStatus: () => 'connected',
      getStorage: async () => {
        storageReads += 1;
        if (storageReads === 1) await firstStorageGate;
        return { root };
      },
      batch: (callback: () => void) => callback(),
    };
    const current = useTimelineStore.getState();
    useTimelineStore.setState({
      liveblocks: {
        ...current.liveblocks,
        room,
        status: 'connected',
        isStorageLoading: false,
      },
    } as never);

    queueWorkspaceFields({ tasks: completed }, { tasks: incomplete });
    await readPendingWorkspaceSync();
    const flush = flushWorkspaceQueue();
    await new Promise((resolve) => window.setTimeout(resolve, 0));

    // The user cancels while the first flush still holds the older completed
    // snapshot. The second queue revision must supersede it before root.set.
    queueWorkspaceFields({ tasks: incomplete }, { tasks: completed });
    await readPendingWorkspaceSync();
    releaseFirstStorage();
    const report = await flush;
    const pending = await readPendingWorkspaceSync();

    return {
      tasks: rootData.tasks,
      pending,
      report,
      storageReads,
    };
  });

  expect(result.tasks).toEqual([{ id: 'race-task', isCompleted: false }]);
  expect(result.pending).toBeNull();
  expect(result.report).toEqual({ applied: 1, conflict: false });
  expect(result.storageReads).toBe(2);
});

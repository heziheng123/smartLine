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
    const queued = new Promise<void>((resolve) => {
      window.addEventListener('smartline:workspace-queue', () => resolve(), { once: true });
    });
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
    await queued;
  });

  const pending = await readPendingWorkspaceSync(page);
  const fields = pending?.fields as {
    tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
  } | undefined;
  expect(fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted).toBe(true);
});

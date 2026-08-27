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

async function readPersistedTimelineData(page: Page) {
  return await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('smart-timeline');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!database.objectStoreNames.contains('timeline_data')) return null;
      return await new Promise<Record<string, unknown> | null>((resolve, reject) => {
        const transaction = database.transaction('timeline_data', 'readonly');
        const request = transaction.objectStore('timeline_data').get('smart-timeline-data');
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      database.close();
    }
  });
}

async function simulateConnectedStorageLoading(page: Page) {
  await expect.poll(async () => {
    try {
      await page.evaluate(async () => {
        const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
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
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Execution context was destroyed')) return false;
      throw error;
    }
  }).toBe(true);
}

async function simulateConnectedStorageReady(page: Page) {
  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
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

async function openProjectTaskCard(page: Page) {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: project.name }).first().click();
  const card = page.locator('.stb-card').filter({ hasText: project.blocks[0].header.title });
  await expect(card).toBeVisible();
  return card;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ projectData }) => {
    const readiness = window as typeof window & { __smartlineAppReady?: boolean };
    readiness.__smartlineAppReady = false;
    window.addEventListener('smartline:app-ready', () => {
      readiness.__smartlineAppReady = true;
    }, { once: true });
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
      'line-life-map-liveblocks',
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
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __smartlineAppReady?: boolean }
  ).__smartlineAppReady)).toBe(true);
});

test.skip('人生地图创建人生计划只写入 Life Map 离线队列', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await lifeMap.getByRole('button', { name: '添加到时间线' }).click();
  await lifeMap.getByRole('menuitem', { name: '新建人生计划' }).click();
  const editor = page.locator('.life-map-editor form');
  await editor.getByLabel('名称').fill('多端同步健康计划');
  await editor.getByLabel('人生领域').selectOption('health');
  await editor.getByLabel('开始日期').fill(today);
  await editor.getByLabel('结束日期').fill(today);
  await editor.getByRole('button', { name: '保存', exact: true }).click();

  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as { lifeMapGoals?: Array<{ name?: string; areaId?: string }> } | undefined;
    return fields?.lifeMapGoals?.find((item) => item.name === '多端同步健康计划')?.areaId ?? null;
  }).toBe('health');
});

test('远端式人生阶段更新会落盘，并在统一工作区未就绪时进入兜底队列', async ({ page }) => {
  const remoteStage = {
    id: 'remote-life-stage',
    name: '远端人生阶段',
    start: today,
    end: today,
  };

  // Liveblocks hydration updates the outer Zustand store directly rather than
  // calling addLifeStage, so this reproduces the path that relies on the store
  // persistence subscription and the offline fallback subscription.
  await page.evaluate(async (stage) => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    useTimelineStore.setState({ lifeStages: [stage] });
  }, remoteStage);

  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as { lifeStages?: Array<{ id?: string }> } | undefined;
    return fields?.lifeStages?.some((stage) => stage.id === remoteStage.id) ?? false;
  }).toBe(true);

  await expect.poll(async () => {
    const persisted = await readPersistedTimelineData(page);
    const lifeStages = persisted?.lifeStages as Array<{ id?: string }> | undefined;
    return lifeStages?.some((stage) => stage.id === remoteStage.id) ?? false;
  }).toBe(true);
});

test('rapid completion toggles are journaled while cloud storage is still loading', async ({ page }) => {
  const card = await openProjectTaskCard(page);

  // Reproduce the production race precisely: the room reports connected
  // before Liveblocks has finished loading its storage root.
  await simulateConnectedStorageLoading(page);

  await card.locator('.stb-check').click();
  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(true);

  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/stb-card--done/);
  await card.locator('.stb-check').click();
  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(false);

  await expect(card).toBeVisible();
  await expect(card).not.toHaveClass(/stb-card--done/);
});

test('late storage hydration cannot overwrite an explicit pending completion', async ({ page }) => {
  const card = await openProjectTaskCard(page);
  await simulateConnectedStorageLoading(page);

  await card.locator('.stb-check').click();
  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(true);

  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
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
  const card = await openProjectTaskCard(page);
  await simulateConnectedStorageReady(page);

  await card.locator('.stb-check').click();
  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(true);

  await expect(card).toBeVisible();
  await card.locator('.stb-check').click();

  await expect.poll(async () => {
    const pending = await readPendingWorkspaceSync(page);
    const fields = pending?.fields as {
      tasks?: Array<{ blocks?: Array<{ header?: { isCompleted?: boolean } }> }>;
    } | undefined;
    return fields?.tasks?.[0]?.blocks?.[0]?.header?.isCompleted;
  }).toBe(false);
});

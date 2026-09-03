import { expect, test } from '@playwright/test';

const EXPECTED_STORES = [
  'daily_schedule_data',
  'ebb_data',
  'graph_data',
  'life_map_data',
  'local-forage-detect-blob-support',
  'timeline_data',
  'workspace_alternates_v8',
  'workspace_repairs',
  'workspace_snapshot_chunks',
  'workspace_snapshots',
  'workspace_sync_queue',
];

test('concurrent first-load tabs initialize one complete storage schema without warnings', async ({ context }) => {
  const consoleMessages: string[] = [];
  const pages = await Promise.all(Array.from({ length: 4 }, () => context.newPage()));
  for (const page of pages) {
    page.on('console', (message) => {
      if (message.type() === 'warning' || message.type() === 'error') consoleMessages.push(message.text());
    });
    await page.route('**/__storage-schema__', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>storage schema test</title>',
    }));
  }

  await Promise.all(pages.map((page) => page.goto('/__storage-schema__')));
  await Promise.all(pages.map((page, pageIndex) => page.evaluate(async ({ stores, index }) => {
    const { createScopedStorage } = await import('/src/utils/persistence.ts');
    await Promise.all(stores.map((storeName) => createScopedStorage(storeName).setItem(
      `schema-probe-${index}`,
      true,
    )));
  }, { stores: EXPECTED_STORES, index: pageIndex })));

  const stores = await pages[0].evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open('smart-timeline');
    request.onsuccess = () => {
      const database = request.result;
      resolve([...database.objectStoreNames]);
      database.close();
    };
    request.onerror = () => reject(request.error);
  }));

  expect(stores).toEqual(EXPECTED_STORES);
  expect(consoleMessages.filter((message) => message.includes("can't be downgraded"))).toEqual([]);
  expect(consoleMessages.filter((message) => message.includes('`ref` is not a prop'))).toEqual([]);
});

test('simultaneous offline edits from two tabs preserve every changed workspace field', async ({ context }) => {
  const [first, second] = await Promise.all([context.newPage(), context.newPage()]);
  await Promise.all([first.goto('/'), second.goto('/')]);
  await Promise.all([
    expect(first.locator('.tl-dock')).toBeVisible(),
    expect(second.locator('.tl-dock')).toBeVisible(),
  ]);

  await Promise.all([
    first.evaluate(async () => {
      const queue = await import('/src/services/workspaceSyncQueueCore.ts');
      await queue.queueWorkspaceFields(
        { tasks: [{ id: 'tab-a-task', name: 'tab-a-task' }] },
        { tasks: [] },
        { bypassSuppression: true, origin: 'user' },
      );
    }),
    second.evaluate(async () => {
      const queue = await import('/src/services/workspaceSyncQueueCore.ts');
      await queue.queueWorkspaceFields(
        { nodes: [{ id: 'tab-b-node', title: 'tab-b-node' }] },
        { nodes: [] },
        { bypassSuppression: true, origin: 'user' },
      );
    }),
  ]);

  await expect.poll(() => first.evaluate(async () => {
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    const pending = await queue.readPendingWorkspaceSync();
    return Object.keys(pending?.fields ?? {}).sort();
  })).toEqual(['nodes', 'tasks']);

  const pending = await first.evaluate(async () => {
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    return queue.readPendingWorkspaceSync();
  });
  expect(pending?.fields.tasks).toEqual([{ id: 'tab-a-task', name: 'tab-a-task' }]);
  expect(pending?.fields.nodes).toEqual([{ id: 'tab-b-node', title: 'tab-b-node' }]);
});

test('storage schema upgrade preserves data written by an older app version', async ({ page }) => {
  await page.route('**/__storage-seed__', (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html><title>storage seed</title>',
  }));
  await page.goto('/__storage-seed__');
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('smart-timeline', 3);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains('timeline_data')) database.createObjectStore('timeline_data');
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('timeline_data', 'readwrite');
      transaction.objectStore('timeline_data').put({
        tasks: [
          { id: 'legacy-preserved-project', name: 'legacy-preserved-project', blocks: [] },
          {
            id: 'legacy-markdown-project',
            name: 'legacy-markdown-project',
            markdown: '- [ ] legacy migrated task',
          },
        ],
        groups: [{
          id: 'legacy-preserved-group',
          name: 'legacy-preserved-group',
          children: [{ id: 'legacy-preserved-child', name: 'legacy-preserved-child', blocks: [] }],
        }],
        notes: [],
        milestones: [],
      }, 'smart-timeline-data');
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
    request.onerror = () => reject(request.error);
  }));
  await page.unroute('**/__storage-seed__');

  await page.goto('/');
  await expect(page.locator('.tl-dock')).toBeVisible();
  const readStoredData = () => page.evaluate(() => new Promise<{
    stores: string[];
    taskId?: string;
    start?: string;
    end?: string;
    groupId?: string;
    groupStart?: string;
    groupEnd?: string;
    childId?: string;
    childStart?: string;
    childEnd?: string;
    migratedBlockDate?: string;
  }>((resolve, reject) => {
    const request = indexedDB.open('smart-timeline');
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('timeline_data', 'readonly');
      const getRequest = transaction.objectStore('timeline_data').get('smart-timeline-data');
      getRequest.onsuccess = () => {
        const value = getRequest.result as {
          tasks?: Array<{
            id?: string;
            start?: string;
            end?: string;
            blocks?: Array<{ type?: string; header?: { date?: string } }>;
          }>;
          groups?: Array<{
            id?: string;
            start?: string;
            end?: string;
            children?: Array<{ id?: string; start?: string; end?: string }>;
          }>;
        } | undefined;
        const task = value?.tasks?.find((item) => item.id === 'legacy-preserved-project');
        const markdownTask = value?.tasks?.find((item) => item.id === 'legacy-markdown-project');
        const migratedBlock = markdownTask?.blocks?.find((item) => item.type === 'smart-task');
        const group = value?.groups?.find((item) => item.id === 'legacy-preserved-group');
        const child = group?.children?.find((item) => item.id === 'legacy-preserved-child');
        resolve({
          stores: [...database.objectStoreNames],
          taskId: task?.id,
          start: task?.start,
          end: task?.end,
          groupId: group?.id,
          groupStart: group?.start,
          groupEnd: group?.end,
          childId: child?.id,
          childStart: child?.start,
          childEnd: child?.end,
          migratedBlockDate: migratedBlock?.header?.date,
        });
        database.close();
      };
      getRequest.onerror = () => reject(getRequest.error);
    };
    request.onerror = () => reject(request.error);
  }));

  await expect.poll(readStoredData).toMatchObject({
    taskId: 'legacy-preserved-project',
    start: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    end: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    groupId: 'legacy-preserved-group',
    groupStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    groupEnd: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    childId: 'legacy-preserved-child',
    childStart: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    childEnd: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    migratedBlockDate: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
  });
  const result = await readStoredData();
  expect(result.stores).toEqual(EXPECTED_STORES);
  expect(result.taskId).toBe('legacy-preserved-project');
});

import { expect, test } from '@playwright/test';

const EXPECTED_STORES = [
  'daily_schedule_data',
  'ebb_data',
  'graph_data',
  'local-forage-detect-blob-support',
  'timeline_data',
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
  }

  await Promise.all(pages.map((page) => page.goto('/')));
  await Promise.all(pages.map((page) => expect(page.locator('.tl-dock')).toBeVisible()));

  const tabs = pages[0].locator('.tl-dock [role="tab"]');
  for (let index = 0; index < await tabs.count(); index += 1) {
    await tabs.nth(index).click();
  }

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
        tasks: [{ id: 'legacy-preserved-project', name: 'legacy-preserved-project', blocks: [] }],
        groups: [],
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
  const result = await page.evaluate(() => new Promise<{ stores: string[]; taskId?: string }>((resolve, reject) => {
    const request = indexedDB.open('smart-timeline');
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction('timeline_data', 'readonly');
      const getRequest = transaction.objectStore('timeline_data').get('smart-timeline-data');
      getRequest.onsuccess = () => {
        const value = getRequest.result as { tasks?: Array<{ id?: string }> } | undefined;
        resolve({ stores: [...database.objectStoreNames], taskId: value?.tasks?.[0]?.id });
        database.close();
      };
      getRequest.onerror = () => reject(getRequest.error);
    };
    request.onerror = () => reject(request.error);
  }));

  expect(result.stores).toEqual(EXPECTED_STORES);
  expect(result.taskId).toBe('legacy-preserved-project');
});

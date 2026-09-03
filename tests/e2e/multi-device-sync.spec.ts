import { expect, test, type BrowserContext, type Page } from '@playwright/test';

type WorkspaceRoot = Record<string, unknown>;

async function mergeOnDevice(
  page: Page,
  fields: WorkspaceRoot,
  baseFields: WorkspaceRoot,
  remote: WorkspaceRoot,
) {
  return await page.evaluate(async ({ fields: local, baseFields: base, remote: cloud }) => {
    const { mergeWorkspaceFieldChanges } = await import('/src/services/workspaceSyncCore.ts');
    return mergeWorkspaceFieldChanges(local, base, cloud);
  }, { fields, baseFields, remote });
}

test.describe('isolated two-client workspace commits', () => {
  test.setTimeout(60_000);
  let contextA: BrowserContext;
  let contextB: BrowserContext;
  let pageA: Page;
  let pageB: Page;

  test.beforeEach(async ({ browser }) => {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
    [pageA, pageB] = await Promise.all([contextA.newPage(), contextB.newPage()]);
    // Use a minimal same-origin document: both clients still import the real
    // Vite-served production module, without compiling the unrelated app UI.
    await Promise.all([pageA, pageB].map((page) => page.route('**/__sync-client__', (route) => route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<!doctype html><title>isolated sync client</title>',
    }))));
    await Promise.all([
      pageA.goto('/__sync-client__'),
      pageB.goto('/__sync-client__'),
    ]);
  });

  test.afterEach(async () => {
    await Promise.all([contextA?.close(), contextB?.close()]);
  });

  test('clients editing different properties from one cloud revision converge', async () => {
    const baseTasks = [{ id: 'task-1', title: 'before', date: '2026-08-30' }];
    const base = { tasks: baseTasks };
    const commitA = await mergeOnDevice(
      pageA,
      { tasks: [{ id: 'task-1', title: 'device-a', date: '2026-08-30' }] },
      base,
      base,
    );
    expect(commitA.conflicts).toEqual([]);

    const commitB = await mergeOnDevice(
      pageB,
      { tasks: [{ id: 'task-1', title: 'before', date: '2026-09-01' }] },
      base,
      commitA.fields,
    );
    expect(commitB.conflicts).toEqual([]);
    expect(commitB.fields.tasks).toEqual([
      { id: 'task-1', title: 'device-a', date: '2026-09-01' },
    ]);
  });

  test('clients editing the same property keep remote current and preserve a conflict alternate', async () => {
    const baseTasks = [{ id: 'task-1', title: 'before', date: '2026-08-30' }];
    const base = { tasks: baseTasks };
    const localA = { tasks: [{ id: 'task-1', title: 'device-a', date: '2026-08-30' }] };
    const localB = { tasks: [{ id: 'task-1', title: 'device-b', date: '2026-08-30' }] };
    const commitA = await mergeOnDevice(pageA, localA, base, base);
    const commitB = await mergeOnDevice(pageB, localB, base, commitA.fields);

    expect(commitA.conflicts).toEqual([]);
    expect(commitB.conflicts).toEqual(['tasks[task-1].title']);
    expect(commitB.fields.tasks).toEqual(commitA.fields.tasks);
  });

  test('a deletion racing a modification is never silently accepted', async () => {
    const baseTasks = [{ id: 'task-1', title: 'before' }];
    const base = { tasks: baseTasks };
    const deleteCommit = await mergeOnDevice(pageA, { tasks: [] }, base, base);
    const editCommit = await mergeOnDevice(
      pageB,
      { tasks: [{ id: 'task-1', title: 'device-b' }] },
      base,
      deleteCommit.fields,
    );

    expect(deleteCommit.conflicts).toEqual([]);
    expect(editCommit.conflicts).toEqual(['tasks[task-1]']);
  });
});

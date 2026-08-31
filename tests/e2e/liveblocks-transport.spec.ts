import { expect, test, type Page } from '@playwright/test';

test.skip(
  process.env.LIVEBLOCKS_TRANSPORT_TEST !== '1',
  'Set LIVEBLOCKS_TRANSPORT_TEST=1 only when a real Liveblocks test project and network are available.',
);
test.setTimeout(180_000);

const today = '2026-08-30';

async function openIsolatedWorkspace(page: Page, roomCode: string): Promise<void> {
  await page.addInitScript(({ code }) => {
    const ready = window as typeof window & { __smartlineAppReady?: boolean };
    ready.__smartlineAppReady = false;
    window.addEventListener('smartline:app-ready', () => { ready.__smartlineAppReady = true; }, { once: true });
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('smart-line-sync-architecture-v1', JSON.stringify({
      architecture: 'unified',
      roomCode: code,
      unifiedRoomId: `workspace-liveblocks-gate-${code}`,
    }));
  }, { code: roomCode });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & { __smartlineAppReady?: boolean }
  ).__smartlineAppReady), { timeout: 45_000 }).toBe(true);
}

async function activate(page: Page, roomCode: string, identity: string) {
  return await page.evaluate(async ({ code, owner }) => {
    const sync = await import('/src/services/workspaceSync.ts');
    return await sync.activateUnifiedWorkspaceSafely(code, owner);
  }, { code: roomCode, owner: identity });
}

async function addTask(page: Page, id: string, name: string): Promise<void> {
  await page.evaluate(async ({ taskId, taskName, date }) => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    useTimelineStore.getState().addTask({
      id: taskId,
      name: taskName,
      start: date,
      end: date,
      color: '#93c5fd',
      completed: false,
      blocks: [],
    });
  }, { taskId: id, taskName: name, date: today });
}

async function flush(page: Page) {
  return await page.evaluate(async () => {
    const sync = await import('/src/services/workspaceSync.ts');
    return await sync.flushWorkspaceQueue();
  });
}

async function taskNames(page: Page): Promise<Record<string, string>> {
  return await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    return Object.fromEntries(useTimelineStore.getState().tasks.map((task) => [task.id, task.name]));
  });
}

test('real Liveblocks transport preserves offline disjoint edits and surfaces a same-field conflict', async ({ browser }, testInfo) => {
  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();
  const suffix = `${Date.now()}-${testInfo.project.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  const roomCode = `transport-${suffix}`;
  const identity = `liveblocks-gate-${suffix}`;

  try {
    await Promise.all([
      openIsolatedWorkspace(pageA, roomCode),
      openIsolatedWorkspace(pageB, roomCode),
    ]);
    const first = await activate(pageA, roomCode, identity);
    const second = await activate(pageB, roomCode, identity);
    expect(second.roomId).toBe(first.roomId);

    await pageB.evaluate(async () => {
      const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
      useTimelineStore.getState().liveblocks?.room?.disconnect();
    });
    await expect.poll(() => pageB.evaluate(async () => {
      const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
      const status = useTimelineStore.getState().liveblocks?.room?.getStatus();
      return status === 'initial' || status === 'disconnected';
    })).toBe(true);

    await addTask(pageB, 'offline-b', 'device-b-offline');
    await expect.poll(() => pageB.evaluate(async () => {
      const queue = await import('/src/services/workspaceOfflineQueue.ts');
      return Boolean((await queue.readPendingWorkspaceSync())?.fields.tasks);
    })).toBe(true);

    await addTask(pageA, 'online-a', 'device-a-online');
    expect(await flush(pageA)).toMatchObject({ conflict: false });

    const reconnectMessage = await pageB.evaluate(async ({ owner }) => {
      const sync = await import('/src/services/workspaceSync.ts');
      try {
        await sync.reconnectConfiguredWorkspace(owner);
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, { owner: identity });
    expect(reconnectMessage).toBe('');

    await expect.poll(() => taskNames(pageA), { timeout: 30_000 }).toMatchObject({
      'offline-b': 'device-b-offline',
      'online-a': 'device-a-online',
    });
    await expect.poll(() => taskNames(pageB), { timeout: 30_000 }).toMatchObject({
      'offline-b': 'device-b-offline',
      'online-a': 'device-a-online',
    });

    const entityState = await pageA.evaluate(async () => {
      const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
      const room = useTimelineStore.getState().liveblocks?.room;
      if (!room) throw new Error('timeline room missing');
      const { root } = await room.getStorage();
      const raw = root.toJSON() as Record<string, unknown>;
      return {
        schemaVersion: (raw.metadata as { schemaVersion?: number } | undefined)?.schemaVersion,
        taskEntityCount: Object.keys(raw).filter((key) => key.startsWith('workspace-entity:tasks:')).length,
      };
    });
    expect(entityState.schemaVersion).toBe(8);
    expect(entityState.taskEntityCount).toBeGreaterThanOrEqual(2);

    // Simulate the legacy whole-array projection losing one concurrent write.
    // Schema 8 entity keys remain intact and must rebuild both local views.
    await pageA.evaluate(async () => {
      const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
      const room = useTimelineStore.getState().liveblocks?.room;
      if (!room) throw new Error('timeline room missing');
      const { root } = await room.getStorage();
      const offline = useTimelineStore.getState().tasks.find((task) => task.id === 'offline-b');
      if (!offline) throw new Error('offline task missing');
      room.batch(() => root.set('tasks', [offline]));
    });
    await expect.poll(async () => Object.hasOwn(await taskNames(pageB), 'online-a')).toBe(false);
    const projectionRepairMessage = await pageB.evaluate(async ({ owner }) => {
      const sync = await import('/src/services/workspaceSync.ts');
      try {
        await sync.reconnectConfiguredWorkspace(owner);
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, { owner: identity });
    expect(projectionRepairMessage).toBe('');
    await expect.poll(() => taskNames(pageA)).toMatchObject({
      'offline-b': 'device-b-offline',
      'online-a': 'device-a-online',
    });
    await expect.poll(() => taskNames(pageB)).toMatchObject({
      'offline-b': 'device-b-offline',
      'online-a': 'device-a-online',
    });

    await addTask(pageA, 'delete-me', 'delete-me');
    expect(await flush(pageA)).toMatchObject({ conflict: false });
    await expect.poll(async () => Object.hasOwn(await taskNames(pageB), 'delete-me')).toBe(true);
    await pageA.evaluate(async () => {
      const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
      useTimelineStore.getState().deleteTask('delete-me');
    });
    expect(await flush(pageA)).toMatchObject({ conflict: false });
    await expect.poll(async () => Object.hasOwn(await taskNames(pageB), 'delete-me')).toBe(false);
    const tombstoneSaved = await pageA.evaluate(async () => {
      const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
      const room = useTimelineStore.getState().liveblocks?.room;
      if (!room) throw new Error('timeline room missing');
      const { root } = await room.getStorage();
      return Object.entries(root.toJSON() as Record<string, unknown>).some(([key, value]) => (
        key.startsWith('workspace-entity:tasks:')
        && (value as { id?: string; deletedAt?: string })?.id === 'delete-me'
        && typeof (value as { deletedAt?: string }).deletedAt === 'string'
      ));
    });
    expect(tombstoneSaved).toBe(true);

    // Even if a stale projection reintroduces the removed task, the tombstone
    // remains authoritative and convergence removes it again.
    await pageA.evaluate(async ({ date }) => {
      const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
      const room = useTimelineStore.getState().liveblocks?.room;
      if (!room) throw new Error('timeline room missing');
      const { root } = await room.getStorage();
      const raw = root.toJSON() as { tasks?: unknown[] };
      room.batch(() => root.set('tasks', [
        ...(Array.isArray(raw.tasks) ? raw.tasks : []),
        { id: 'delete-me', name: 'stale-delete-me', start: date, end: date, color: '#93c5fd', completed: false, blocks: [] },
      ]));
    }, { date: today });
    await expect.poll(async () => Object.hasOwn(await taskNames(pageB), 'delete-me')).toBe(true);
    const tombstoneRepairMessage = await pageB.evaluate(async ({ owner }) => {
      const sync = await import('/src/services/workspaceSync.ts');
      try {
        await sync.reconnectConfiguredWorkspace(owner);
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, { owner: identity });
    expect(tombstoneRepairMessage).toBe('');
    await expect.poll(async () => Object.hasOwn(await taskNames(pageA), 'delete-me')).toBe(false);
    await expect.poll(async () => Object.hasOwn(await taskNames(pageB), 'delete-me')).toBe(false);

    await addTask(pageA, 'shared-task', 'shared-before');
    expect(await flush(pageA)).toMatchObject({ conflict: false });
    await expect.poll(() => taskNames(pageB)).toMatchObject({ 'shared-task': 'shared-before' });

    await pageB.evaluate(async () => {
      const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
      useTimelineStore.getState().liveblocks?.room?.disconnect();
      const task = useTimelineStore.getState().tasks.find((item) => item.id === 'shared-task');
      if (!task) throw new Error('shared task missing on device B');
      useTimelineStore.getState().updateTask({ ...task, name: 'device-b-conflict' });
    });
    await pageA.evaluate(async () => {
      const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
      const task = useTimelineStore.getState().tasks.find((item) => item.id === 'shared-task');
      if (!task) throw new Error('shared task missing on device A');
      useTimelineStore.getState().updateTask({ ...task, name: 'device-a-conflict' });
    });
    expect(await flush(pageA)).toMatchObject({ conflict: false });

    const conflictMessage = await pageB.evaluate(async ({ owner }) => {
      const sync = await import('/src/services/workspaceSync.ts');
      try {
        await sync.reconnectConfiguredWorkspace(owner);
        return '';
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
    }, { owner: identity });
    expect(conflictMessage).toContain('冲突');
    await expect.poll(() => pageB.evaluate(async () => {
      const queue = await import('/src/services/workspaceOfflineQueue.ts');
      return (await queue.listWorkspaceConflicts()).filter((item) => item.status === 'active').length;
    })).toBe(1);
    await expect.poll(() => taskNames(pageA)).toMatchObject({ 'shared-task': 'device-a-conflict' });
  } finally {
    await Promise.all([contextA.close(), contextB.close()]);
  }
});

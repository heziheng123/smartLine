import { expect, test } from '@playwright/test';
import type { MindMapDocument } from '../../src/mindMap/model';

test('authenticated mind map sync does not require R2', async ({ page }) => {
  test.skip(!process.env.MIND_MAP_STORAGE_GATE_E2E);
  let liveblocksAuthRequests = 0;
  let storageStatusRequests = 0;
  await page.route('**/api/auth/session', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ authenticated: true, login: 'owner', userId: 'gh_12345' }),
  }));
  await page.route('**/api/storage/status', (route) => {
    storageStatusRequests += 1;
    return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"R2 disabled"}' });
  });
  await page.route('**/api/liveblocks-auth', (route) => {
    const room = (route.request().postDataJSON() as { room?: string } | null)?.room ?? '';
    if (room.includes('mind-map')) liveblocksAuthRequests += 1;
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"must not start"}' });
  });
  await page.goto('/');
  await page.getByTitle('地图工作区').click();
  await expect.poll(() => liveblocksAuthRequests).toBeGreaterThan(0);
  expect(storageStatusRequests).toBe(0);
});

test('image assets survive a failed LiveFile upload and hydrate into another device cache', async ({ page }) => {
  await page.goto('/');

  const result = await page.evaluate(async () => {
    const { createEmptyMindMapDocument, createTextMindMapNode } = await import('/src/mindMap/model.ts');
    const { mindMapRepository } = await import('/src/mindMap/repository.ts');
    const { syncMindMapImageAssets } = await import('/src/mindMap/assetSync.ts');
    const assetId = 'asset_browser_1234';
    const document = createEmptyMindMapDocument('图片同步测试', { id: 'image-sync-document', now: 1 });
    const node = {
      ...createTextMindMapNode({ x: 100, y: 100 }, { id: 'image-node', text: '同步图片' }),
      type: 'image' as const,
      imageAssetId: assetId,
    };
    document.nodes[node.id] = node;
    document.zOrder.push(node.id);
    let cloudBlob: Blob | null = null;
    let failFirstUpload = true;
    const cloud = {
      cacheKey: 'liveblocks-room-test',
      upload: async (_id: string, blob: Blob) => {
        if (failFirstUpload) {
          failFirstUpload = false;
          throw new Error('offline');
        }
        cloudBlob = blob;
      },
      download: async () => cloudBlob,
    };
    await mindMapRepository.saveImageAsset(
      new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
      assetId,
      { [document.id]: 1 },
    );
    let error = '';
    try { await syncMindMapImageAssets(document, cloud); } catch (reason) {
      error = reason instanceof Error ? reason.message : String(reason);
    }
    const { createDedicatedStorage } = await import('/src/utils/persistence.ts');
    const localStillExists = Boolean(await mindMapRepository.loadImageAsset(assetId));
    await syncMindMapImageAssets(document, cloud);
    await createDedicatedStorage('smart-line-mind-map', 'mind_map_assets').removeItem(`mind-map:asset:${assetId}`);
    await syncMindMapImageAssets(document, cloud);
    const asset = await mindMapRepository.loadImageAsset(assetId);
    return {
      error,
      localStillExists,
      cloudStored: Boolean(cloudBlob),
      hydrated: { id: asset?.id, size: asset?.size, refCount: asset?.refCount },
    };
  });
  expect(result).toEqual({
    error: 'offline',
    localStillExists: true,
    cloudStored: true,
    hydrated: { id: 'asset_browser_1234', size: 8, refCount: 1 },
  });
});

test('background document merges are cached without switching or overwriting the active map', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');
  const result = await page.evaluate(async () => {
    const { createTextMindMapNode } = await import('/src/mindMap/model.ts');
    const { mindMapRepository } = await import('/src/mindMap/repository.ts');
    const { useMindMapStore } = await import('/src/mindMap/testing.ts');
    const first = useMindMapStore.getState().document!;
    await useMindMapStore.getState().createDocument();
    const active = useMindMapStore.getState().document!;
    const remoteNode = createTextMindMapNode({ x: 180, y: 140 }, { id: 'background-remote-node', text: '后台合并节点' });
    await useMindMapStore.getState().cacheRemoteDocument({
      ...first,
      nodes: { ...first.nodes, [remoteNode.id]: remoteNode },
      zOrder: [...first.zOrder, remoteNode.id],
      updatedAt: Date.now(),
    });
    const cached = await mindMapRepository.loadDocument(first.id);
    const state = useMindMapStore.getState();
    return {
      activeUnchanged: state.document?.id === active.id,
      cachedRemoteNode: Boolean(cached?.nodes[remoteNode.id]),
      catalogUpdated: state.index.documents.some((entry) => entry.id === first.id && entry.nodeCount === 1),
    };
  });
  expect(result).toEqual({ activeUnchanged: true, cachedRemoteNode: true, catalogUpdated: true });
});

test('remote graph updates stay outside local history and the global sync UI', async ({ page }) => {
  await page.goto('/');
  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-canvas')).toBeVisible();
  await expect(page.getByTestId('mind-map-sync-status')).toContainText('仅本地');

  const result = await page.evaluate(async () => {
    const { useMindMapStore } = await import('/src/mindMap/testing.ts');
    const { createTextMindMapNode } = await import('/src/mindMap/model.ts');
    const state = useMindMapStore.getState();
    const current = state.document!;
    const remoteNode = createTextMindMapNode({ x: 240, y: 200 }, { id: 'remote-node', text: '远端节点' });
    const historyBefore = state.history.undo.length;
    state.applyRemoteDocument({
      ...current,
      nodes: { ...current.nodes, [remoteNode.id]: remoteNode },
      zOrder: [...current.zOrder, remoteNode.id],
      updatedAt: Date.now(),
    });
    const after = useMindMapStore.getState();
    return {
      historyBefore,
      historyAfter: after.history.undo.length,
      hasRemoteNode: Boolean(after.document?.nodes[remoteNode.id]),
    };
  });

  expect(result.hasRemoteNode).toBe(true);
  expect(result.historyAfter).toBe(result.historyBefore);
});

test('two browser contexts converge through the independent document room', async ({ browser, request }, testInfo) => {
  test.skip(!process.env.MIND_MAP_LIVE_SYNC_E2E || testInfo.project.name !== 'desktop-chromium');
  const documentId = `e2e-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const firstContext = await browser.newContext();
  const secondContext = await browser.newContext();
  const first = await firstContext.newPage();
  const second = await secondContext.newPage();

  const startCatalog = async (page: typeof first, name: string, seed: boolean) => {
    await page.goto('/');
    await page.evaluate(async ({ documentId, name, seed }) => {
      const { createEmptyMindMapDocument, summarizeMindMapDocument } = await import('/src/mindMap/model.ts');
      const { MindMapCatalogSession } = await import('/src/mindMap/sync.ts');
      const document = createEmptyMindMapDocument('实时同步验收', { id: documentId, now: 1 });
      const state = {
        entries: seed ? [{ ...summarizeMindMapDocument(document), deletedAt: null }] : [],
        session: null as InstanceType<typeof MindMapCatalogSession> | null,
      };
      state.session = new MindMapCatalogSession({
        identity: 'owner',
        name,
        documents: seed ? [summarizeMindMapDocument(document)] : [],
        onEntries: (entries) => { state.entries = entries; },
        onError: (message) => { throw new Error(message); },
      });
      (window as typeof window & { __mindMapCatalog?: typeof state }).__mindMapCatalog = state;
      await state.session.start();
    }, { documentId, name, seed });
  };

  const start = async (page: typeof first, name: string) => {
    await page.evaluate(async ({ name, documentId }) => {
      const { createEmptyMindMapDocument } = await import('/src/mindMap/model.ts');
      const { MindMapSyncSession } = await import('/src/mindMap/sync.ts');
      const catalog = (window as typeof window & {
        __mindMapCatalog?: { entries: Array<{ id: string; deletedAt: number | null }> };
      }).__mindMapCatalog!;
      const discoveredId = catalog.entries.find((entry) => entry.id === documentId && entry.deletedAt === null)?.id;
      if (!discoveredId) throw new Error('新设备没有发现云端思维导图。');
      const state = {
        document: createEmptyMindMapDocument('实时同步验收', { id: discoveredId, now: 1 }),
        status: 'connecting',
        session: null as InstanceType<typeof MindMapSyncSession> | null,
      };
      state.session = new MindMapSyncSession({
        identity: 'owner',
        name,
        document: state.document,
        onDocument: (document) => { state.document = document; },
        onState: (sync) => { state.status = sync.status; },
      });
      (window as typeof window & { __mindMapLiveSync?: typeof state }).__mindMapLiveSync = state;
      await state.session.start();
    }, { name, documentId });
  };

  try {
    await Promise.all([startCatalog(first, '设备 A', true), startCatalog(second, '设备 B', false)]);
    await expect.poll(() => second.evaluate((id) => (
      window as typeof window & { __mindMapCatalog?: { entries: Array<{ id: string; deletedAt: number | null }> } }
    ).__mindMapCatalog?.entries.some((entry) => entry.id === id && entry.deletedAt === null), documentId)).toBe(true);
    await Promise.all([start(first, '设备 A'), start(second, '设备 B')]);
    await expect.poll(() => first.evaluate(() => (
      window as typeof window & { __mindMapLiveSync?: { status: string } }
    ).__mindMapLiveSync?.status)).toBe('connected');
    await expect.poll(() => second.evaluate(() => (
      window as typeof window & { __mindMapLiveSync?: { status: string } }
    ).__mindMapLiveSync?.status)).toBe('connected');

    await first.evaluate(async () => {
      const state = (window as typeof window & {
        __mindMapLiveSync?: { document: MindMapDocument; session: { publish: (document: MindMapDocument) => void } };
      }).__mindMapLiveSync!;
      const { createTextMindMapNode } = await import('/src/mindMap/model.ts');
      const node = createTextMindMapNode({ x: 100, y: 100 }, { id: 'from-device-a', text: '来自设备 A' });
      state.document = {
        ...state.document,
        nodes: { ...state.document.nodes, [node.id]: node },
        zOrder: [...state.document.zOrder, node.id],
        updatedAt: Date.now(),
      };
      state.session.publish(state.document);
    });

    await expect.poll(() => second.evaluate(() => Boolean((window as typeof window & {
      __mindMapLiveSync?: { document: { nodes: Record<string, unknown> } };
    }).__mindMapLiveSync?.document.nodes['from-device-a']))).toBe(true);

    const firstImageState = await first.evaluate(async () => {
      const state = (window as typeof window & {
        __mindMapLiveSync?: {
          document: MindMapDocument;
          session: {
            flush: () => Promise<void>;
            publish: (document: MindMapDocument) => void;
            syncImageAssets: (document: MindMapDocument) => Promise<unknown>;
          };
        };
      }).__mindMapLiveSync!;
      const { createTextMindMapNode } = await import('/src/mindMap/model.ts');
      const { mindMapRepository } = await import('/src/mindMap/repository.ts');
      const assetId = 'asset_livefile_e2e';
      const node = {
        ...createTextMindMapNode({ x: 320, y: 180 }, { id: 'livefile-image-node', text: 'LiveFile 图片' }),
        type: 'image' as const,
        imageAssetId: assetId,
      };
      state.document = {
        ...state.document,
        nodes: { ...state.document.nodes, [node.id]: node },
        zOrder: [...state.document.zOrder, node.id],
        updatedAt: Date.now(),
      };
      await mindMapRepository.saveImageAsset(
        new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
        assetId,
        { [state.document.id]: 1 },
      );
      await state.session.syncImageAssets(state.document);
      state.session.publish(state.document);
      await state.session.flush();
      const internal = state.session as unknown as {
        local: MindMapDocument;
        root: { toJSON: () => Record<string, unknown> };
      };
      return {
        stateHasNode: Boolean(state.document.nodes['livefile-image-node']),
        sessionHasNode: Boolean(internal.local.nodes['livefile-image-node']),
        roomHasNode: Object.values(internal.root.toJSON()).some((value) => (
          Boolean(value && typeof value === 'object' && (value as { id?: string }).id === 'livefile-image-node')
        )),
      };
    });
    expect(firstImageState).toEqual({ stateHasNode: true, sessionHasNode: true, roomHasNode: true });

    await expect.poll(
      () => second.evaluate(() => {
        const state = (window as typeof window & {
          __mindMapLiveSync?: {
            document: { nodes: Record<string, unknown> };
            session: { local: MindMapDocument; root: { toJSON: () => Record<string, unknown> } };
            status: string;
          };
        }).__mindMapLiveSync!;
        return {
          stateHasNode: Boolean(state.document.nodes['livefile-image-node']),
          sessionHasNode: Boolean(state.session.local.nodes['livefile-image-node']),
          roomHasNode: Object.values(state.session.root.toJSON()).some((value) => (
            Boolean(value && typeof value === 'object' && (value as { id?: string }).id === 'livefile-image-node')
          )),
          status: state.status,
        };
      }),
      { timeout: 20_000 },
    ).toMatchObject({ stateHasNode: true, sessionHasNode: true, roomHasNode: true, status: 'connected' });
    const liveFileUrl = await second.evaluate(async () => {
      const session = (window as typeof window & {
        __mindMapLiveSync?: {
          session: {
            room: { getFileUrl: (file: unknown) => Promise<string> };
            root: { get: (key: string) => unknown; toJSON: () => Record<string, unknown> };
          };
        };
      }).__mindMapLiveSync!.session;
      const snapshot = session.root.toJSON();
      const fileKey = Object.keys(snapshot).find((key) => key.startsWith('asset:'));
      const file = fileKey ? session.root.get(fileKey) : null;
      if (!file) throw new Error('第二个浏览器没有收到 LiveFile 引用。');
      return session.room.getFileUrl(file);
    });
    await second.route('**/api/mind-map-files/**', async (route) => {
      const response = await request.get(liveFileUrl);
      await route.fulfill({ response });
    });
    const downloadedSize = await second.evaluate(async () => {
      const state = (window as typeof window & {
        __mindMapLiveSync?: {
          document: MindMapDocument;
          session: { syncImageAssets: (document: MindMapDocument) => Promise<unknown> };
        };
      }).__mindMapLiveSync!;
      const { mindMapRepository } = await import('/src/mindMap/repository.ts');
      await state.session.syncImageAssets(state.document);
      return (await mindMapRepository.loadImageAsset('asset_livefile_e2e'))?.size ?? 0;
    });
    expect(downloadedSize).toBe(8);
  } finally {
    const stop = (page: typeof first) => page.evaluate(() => {
      const target = window as typeof window & {
        __mindMapCatalog?: { session: { stop: () => void } };
        __mindMapLiveSync?: { session: { stop: () => void } };
      };
      target.__mindMapLiveSync?.session.stop();
      target.__mindMapCatalog?.session.stop();
    });
    await Promise.all([stop(first), stop(second)]);
    await Promise.all([firstContext.close(), secondContext.close()]);
  }
});

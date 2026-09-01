import { expect, test, type Page } from '@playwright/test';

const openMindMap = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-canvas')).toBeVisible();
};

const openMoreMenu = async (page: Page) => {
  await page.getByLabel('更多操作', { exact: true }).click();
  await expect(page.getByRole('menu', { name: '更多操作菜单' })).toBeVisible();
};

const graphState = async (page: Page) => page.evaluate(async () => {
  const { useMindMapStore } = await import('/src/mindMap/testing.ts');
  const state = useMindMapStore.getState();
  return {
    document: state.document,
    undo: state.history.undo.length,
  };
});

const addNode = async (page: Page, x: number, y: number, text: string) => {
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x, y } });
  await page.getByLabel('新节点文本').fill(text);
  await page.getByLabel('新节点文本').press('Enter');
  await expect(page.getByLabel('新节点文本')).toHaveValue('');
  await page.getByLabel('新节点文本').press('Escape');
};

test('the node editor continuously creates children and siblings as atomic graph commands', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await addNode(page, 260, 240, '根节点');
  await canvas.click({ position: { x: 260, y: 240 } });

  const canvasBeforeChildPreview = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('新节点文本')).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(canvasBeforeChildPreview);
  await expect.poll(async () => Object.keys((await graphState(page)).document?.edges ?? {}).length).toBe(0);
  await page.getByLabel('新节点文本').fill('子节点');
  const canvasBeforeSiblingPreview = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.getByLabel('新节点文本').press('Enter');
  await expect(page.getByLabel('新节点文本')).toHaveValue('');
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(canvasBeforeSiblingPreview);
  await expect.poll(async () => Object.keys((await graphState(page)).document?.edges ?? {}).length).toBe(1);

  await page.getByLabel('新节点文本').fill('同级节点');
  const canvasBeforeGrandchildPreview = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.getByLabel('新节点文本').press('Tab');
  await expect(page.getByLabel('新节点文本')).toHaveValue('');
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(canvasBeforeGrandchildPreview);
  await expect.poll(async () => Object.keys((await graphState(page)).document?.edges ?? {}).length).toBe(2);
  await page.getByLabel('新节点文本').fill('孙节点');
  await page.getByLabel('新节点文本').press('Shift+Enter');
  await expect(page.getByLabel('新节点文本')).toHaveValue('孙节点\n');
  await page.getByLabel('新节点文本').press('Enter');
  await expect.poll(async () => Object.keys((await graphState(page)).document?.edges ?? {}).length).toBe(3);
  await page.getByLabel('新节点文本').press('Escape');

  const state = await graphState(page);
  expect(Object.keys(state.document?.nodes ?? {})).toHaveLength(4);
  expect(Object.keys(state.document?.edges ?? {})).toHaveLength(3);
  const edges = Object.values(state.document?.edges ?? {});
  expect(edges[0].sourceId).toBe(edges[1].sourceId);
  expect(edges[2].sourceId).toBe(edges[1].targetId);
});

test('tree edge previews follow every layout direction and remain visible after zooming', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await addNode(page, 360, 280, '方向根节点');
  await canvas.click({ position: { x: 360, y: 280 } });

  for (const direction of [
    { label: '左 → 右', axis: 'x', sign: 1 },
    { label: '右 → 左', axis: 'x', sign: -1 },
    { label: '上 → 下', axis: 'y', sign: 1 },
    { label: '下 → 上', axis: 'y', sign: -1 },
  ] as const) {
    await page.getByTestId('mind-map-layout-menu').click();
    await page.getByRole('menuitem', { name: direction.label, exact: true }).click();
    await expect(page.getByTestId('mind-map-layout-menu')).toHaveText('布局');
    await canvas.evaluate((element) => (element.parentElement as HTMLElement).focus());
    const before = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
    await page.keyboard.press('Tab');
    const editor = page.getByLabel('新节点文本');
    await expect(editor).toBeVisible();
    await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(before);

    const [editorBox, canvasBox, state] = await Promise.all([editor.boundingBox(), canvas.boundingBox(), graphState(page)]);
    expect(editorBox && canvasBox && state.document).toBeTruthy();
    const root = Object.values(state.document!.nodes)[0];
    const rootView = {
      x: canvasBox!.x + root.x * state.document!.viewport.scale + state.document!.viewport.x,
      y: canvasBox!.y + root.y * state.document!.viewport.scale + state.document!.viewport.y,
    };
    const editorCenter = { x: editorBox!.x + editorBox!.width / 2, y: editorBox!.y + editorBox!.height / 2 };
    expect(Math.sign(editorCenter[direction.axis] - rootView[direction.axis])).toBe(direction.sign);
    await editor.press('Escape');
  }

  await canvas.evaluate((element) => (element.parentElement as HTMLElement).focus());
  await page.keyboard.press('-');
  await page.keyboard.press('-');
  await expect(page.locator('footer').getByText(/%/)).not.toHaveText('100%');
  const beforeZoomedPreview = await canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL());
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('新节点文本')).toBeVisible();
  await expect.poll(() => canvas.evaluate((element) => (element as HTMLCanvasElement).toDataURL())).not.toBe(beforeZoomedPreview);
  await page.getByLabel('新节点文本').press('Escape');
});

test('the node + action creates a tree child without a keyboard', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await addNode(page, 260, 240, '英语');
  await canvas.click({ position: { x: 260, y: 240 } });
  const state = await graphState(page);
  const parent = Object.values(state.document?.nodes ?? {})[0] as { x: number; y: number; height: number };
  await canvas.click({ position: { x: parent.x - 24, y: parent.y - parent.height / 2 - 16 } });
  await expect(page.getByLabel('新节点文本')).toBeVisible();
  await page.getByLabel('新节点文本').fill('阅读');
  await page.getByLabel('新节点文本').press('Enter');
  const after = await graphState(page);
  const edge = Object.values(after.document?.edges ?? {})[0] as { relationship: string; sourceId: string };
  expect(edge.relationship).toBe('tree');
  expect(edge.sourceId).toBe(Object.keys(after.document?.nodes ?? {}).find((id) => (after.document?.nodes[id] as { text: string }).text === '英语'));
});

test('the visible collapse control works before its node is selected', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await addNode(page, 260, 240, '考研规划');
  await canvas.click({ position: { x: 260, y: 240 } });
  await page.keyboard.press('Tab');
  await page.getByLabel('新节点文本').fill('英语');
  await page.getByLabel('新节点文本').press('Enter');

  const state = await graphState(page);
  const rootEntry = Object.entries(state.document?.nodes ?? {}).find(([, node]) => (node as { text: string }).text === '考研规划');
  expect(rootEntry).toBeTruthy();
  const [rootId, root] = rootEntry! as [string, { x: number; y: number; width: number }];
  await canvas.click({ position: { x: root.x - root.width / 2 - 14, y: root.y } });
  await expect.poll(async () => (await graphState(page)).document?.nodes[rootId]?.collapsed).toBe(true);
});

test('a branch can be selected as a whole and focused without changing the document', async ({ page }) => {
  await openMindMap(page);
  const imported = {
    kind: 'smart-line-mind-map',
    schemaVersion: 1,
    id: 'branch-focus-map',
    title: '分支聚焦测试',
    createdAt: 1,
    updatedAt: 1,
    nodes: {
      root: { id: 'root', type: 'text', x: 240, y: 220, text: '目标分支' },
      child: { id: 'child', type: 'text', x: 480, y: 180, text: '分支子节点' },
      grandchild: { id: 'grandchild', type: 'text', x: 720, y: 180, text: '分支孙节点' },
      other: { id: 'other', type: 'text', x: 240, y: 480, text: '其他根节点' },
    },
    edges: {
      childEdge: { id: 'childEdge', sourceId: 'root', targetId: 'child', relationship: 'tree' },
      grandchildEdge: { id: 'grandchildEdge', sourceId: 'child', targetId: 'grandchild', relationship: 'tree' },
    },
    zOrder: ['root', 'child', 'grandchild', 'other'],
    viewport: { x: 0, y: 0, scale: 1 },
    settings: { grid: 'dots', background: '#f9f9fb', selectionMode: 'contain' },
  };
  await page.getByLabel('选择思维导图 JSON 文件').setInputFiles({
    name: 'branch-focus-map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect.poll(async () => Object.keys((await graphState(page)).document?.nodes ?? {}).length).toBe(4);

  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.click({ button: 'right', position: { x: 240, y: 220 } });
  await page.getByRole('menuitem', { name: '选择整个分支' }).click();
  await expect(page.getByLabel('多选排列')).toContainText('排列 3 个节点');

  await page.getByLabel('关闭属性面板').click();
  await canvas.click({ button: 'right', position: { x: 240, y: 220 } });
  await page.getByRole('menuitem', { name: '仅查看此分支' }).click();
  await expect(page.getByTestId('mind-map-branch-focus')).toContainText('目标分支 · 3 个节点');

  await page.getByRole('button', { name: '搜索或命令' }).click();
  await page.getByLabel('搜索思维导图').fill('其他根节点');
  await expect(page.getByRole('option', { name: /其他根节点/ })).toHaveCount(0);
  await page.getByLabel('搜索思维导图').press('Escape');

  await page.getByLabel('退出分支聚焦').click();
  await expect(page.getByTestId('mind-map-branch-focus')).toHaveCount(0);
  await page.getByRole('button', { name: '搜索或命令' }).click();
  await page.getByLabel('搜索思维导图').fill('其他根节点');
  await expect(page.getByRole('option', { name: /其他根节点/ })).toBeVisible();
  expect(Object.keys((await graphState(page)).document?.nodes ?? {})).toHaveLength(4);
});

test('JSON import, layout, search, JSON export and PNG export stay inside the page', async ({ page }) => {
  await openMindMap(page);
  const imported = {
    kind: 'smart-line-mind-map',
    schemaVersion: 1,
    id: 'imported-map',
    title: '导入的产品图',
    createdAt: 1,
    updatedAt: 1,
    nodes: {
      root: { id: 'root', type: 'text', x: 400, y: 100, text: '产品根节点' },
      child: { id: 'child', type: 'text', x: 100, y: 300, text: '搜索目标' },
    },
    edges: {
      relation: {
        id: 'relation',
        sourceId: 'root',
        targetId: 'child',
        label: '关键连接',
        direction: 'forward',
      },
    },
    zOrder: ['root', 'child'],
    viewport: { x: 0, y: 0, scale: 1 },
    settings: { grid: 'dots', background: '#f9f9fb', selectionMode: 'contain' },
  };
  await page.getByLabel('选择思维导图 JSON 文件').setInputFiles({
    name: 'imported-map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });

  await expect(page.getByTestId('mind-map-title')).toHaveValue('导入的产品图');
  await expect.poll(async () => Object.keys((await graphState(page)).document?.nodes ?? {}).length).toBe(2);
  await page.getByTestId('mind-map-layout-menu').click();
  await page.getByTestId('mind-map-layout-tree').click();
  await expect.poll(async () => (await graphState(page)).document?.nodes.root.x ?? 0).toBeLessThan(200);
  const laidOut = (await graphState(page)).document!;
  expect(laidOut.nodes.root.x).toBeLessThan(laidOut.nodes.child.x);

  await page.getByRole('button', { name: '搜索或命令' }).click();
  await page.getByLabel('搜索思维导图').fill('关键连接');
  await page.getByRole('option', { name: /连线.*关键连接/ }).click();
  await expect(page.getByLabel('连线属性')).toBeVisible();

  const jsonDownloadPromise = page.waitForEvent('download');
  await openMoreMenu(page);
  await page.getByRole('menuitem', { name: '导出 JSON' }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toBe('导入的产品图.json');

  const pngDownloadPromise = page.waitForEvent('download');
  await openMoreMenu(page);
  await page.getByRole('button', { name: '导出 PNG' }).click();
  const pngDownload = await pngDownloadPromise;
  expect(pngDownload.suggestedFilename()).toBe('导入的产品图.png');
});

test('selection and full PNG export plus the local context menu remain functional', async ({ page }) => {
  await openMindMap(page);
  await addNode(page, 300, 250, '右键节点');

  await openMoreMenu(page);
  await page.getByLabel('PNG 导出范围').selectOption('selection');
  const selectionDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG' }).click();
  expect((await selectionDownloadPromise).suggestedFilename()).toMatch(/\.png$/);

  await openMoreMenu(page);
  await page.getByLabel('PNG 导出范围').selectOption('all');
  const fullDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出 PNG' }).click();
  expect((await fullDownloadPromise).suggestedFilename()).toMatch(/\.png$/);

  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.click({ button: 'right', position: { x: 300, y: 250 } });
  await expect(page.getByRole('menu', { name: '节点菜单' })).toBeVisible();
  await page.getByRole('menuitem', { name: '锁定节点' }).click();
  await expect.poll(async () => Object.values((await graphState(page)).document?.nodes ?? {})[0]?.locked).toBe(true);

  await canvas.click({ button: 'right', position: { x: 600, y: 450 } });
  await expect(page.getByRole('menu', { name: '画布菜单' })).toBeVisible();
  await page.getByRole('menuitem', { name: '创建节点' }).click();
  await expect(page.getByLabel('新节点文本')).toBeVisible();
});

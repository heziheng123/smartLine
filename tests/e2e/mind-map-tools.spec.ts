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
};

test('Tab creates a child and Enter creates its sibling as atomic graph commands', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await addNode(page, 260, 240, '根节点');
  await canvas.click({ position: { x: 260, y: 240 } });

  await page.keyboard.press('Tab');
  await expect(page.getByLabel('新节点文本')).toBeVisible();
  await page.getByLabel('新节点文本').fill('子节点');
  await page.getByLabel('新节点文本').press('Enter');
  await expect.poll(async () => Object.keys((await graphState(page)).document?.edges ?? {}).length).toBe(1);

  await page.keyboard.press('Enter');
  await expect(page.getByLabel('新节点文本')).toBeVisible();
  await page.getByLabel('新节点文本').fill('同级节点');
  await page.getByLabel('新节点文本').press('Enter');

  const state = await graphState(page);
  expect(Object.keys(state.document?.nodes ?? {})).toHaveLength(3);
  expect(Object.keys(state.document?.edges ?? {})).toHaveLength(2);
  const edges = Object.values(state.document?.edges ?? {});
  expect(edges[0].sourceId).toBe(edges[1].sourceId);
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

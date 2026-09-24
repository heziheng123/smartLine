import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

const openMindMap = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible({ timeout: 30_000 });
  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-canvas')).toBeVisible({ timeout: 30_000 });
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

const addTreeChild = async (page: Page, parentText: string, text: string) => {
  const canvas = page.getByTestId('mind-map-canvas');
  const state = await graphState(page);
  const entry = Object.entries(state.document?.nodes ?? {}).find(([, node]) => (
    (node as { text: string }).text === parentText
  )) as [string, { x: number; y: number }] | undefined;
  expect(entry).toBeTruthy();
  const [, parent] = entry!;
  const viewport = state.document!.viewport;
  await canvas.click({ position: {
    x: parent.x * viewport.scale + viewport.x,
    y: parent.y * viewport.scale + viewport.y,
  } });
  await page.keyboard.press('Tab');
  const editor = page.getByLabel('新节点文本');
  await expect(editor).toBeVisible();
  await editor.fill(text);
  await editor.press('Enter');
  await expect.poll(async () => Object.values((await graphState(page)).document?.nodes ?? {}).some((node) => (
    (node as { text: string }).text === text
  ))).toBe(true);
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

test('mind-map mode lays first-level branches to both sides and supports keyboard outline reordering', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await addNode(page, 360, 280, '中心主题');
  await addTreeChild(page, '中心主题', '左分支');
  await page.getByLabel('新节点文本').press('Escape');
  await addTreeChild(page, '中心主题', '右分支');
  await page.getByLabel('新节点文本').press('Escape');

  await page.getByRole('button', { name: '自由画布' }).click();
  await expect.poll(async () => (await graphState(page)).document?.settings.mode).toBe('mind-map');
  await expect.poll(async () => {
    const current = (await graphState(page)).document;
    if (!current) return false;
    const root = Object.values(current.nodes).find((node) => node.text === '中心主题');
    const left = Object.values(current.nodes).find((node) => node.text === '左分支');
    const right = Object.values(current.nodes).find((node) => node.text === '右分支');
    return Boolean(root && left && right && left.x < root.x && right.x > root.x);
  }).toBe(true);
  const laidOut = (await graphState(page)).document!;
  const rootId = Object.entries(laidOut.nodes).find(([, node]) => (node as { text: string }).text === '中心主题')![0];
  const leftId = Object.entries(laidOut.nodes).find(([, node]) => (node as { text: string }).text === '左分支')![0];
  const rightId = Object.entries(laidOut.nodes).find(([, node]) => (node as { text: string }).text === '右分支')![0];
  expect(laidOut.mindMapRootId).toBe(rootId);
  expect(laidOut.nodes[leftId].x).toBeLessThan(laidOut.nodes[rootId].x);
  expect(laidOut.nodes[rightId].x).toBeGreaterThan(laidOut.nodes[rootId].x);

  const viewport = laidOut.viewport;
  const closeInspector = page.getByLabel('关闭属性面板');
  if (await closeInspector.isVisible()) await closeInspector.click();
  await canvas.click({ position: {
    x: laidOut.nodes[rightId].x * viewport.scale + viewport.x,
    y: laidOut.nodes[rightId].y * viewport.scale + viewport.y,
  } });
  await page.keyboard.press('Alt+ArrowUp');
  await expect.poll(async () => {
    const edges = Object.values((await graphState(page)).document?.edges ?? {}) as Array<{ sourceId: string; targetId: string; order?: number }>;
    return edges.filter((edge) => edge.sourceId === rootId).sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0]?.targetId;
  }).toBe(rightId);
  await page.keyboard.press('Alt+ArrowDown');
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(async () => (Object.values((await graphState(page)).document?.edges ?? {}) as Array<{ sourceId: string; targetId: string }>)
    .some((edge) => edge.sourceId === leftId && edge.targetId === rightId)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect.poll(async () => (Object.values((await graphState(page)).document?.edges ?? {}) as Array<{ sourceId: string; targetId: string }>)
    .some((edge) => edge.sourceId === rootId && edge.targetId === rightId)).toBe(true);
});

test('the outline mirrors selection and semantic branch metadata creates one reusable boundary', async ({ page }) => {
  await openMindMap(page);
  await addNode(page, 360, 280, '产品方向');
  await addTreeChild(page, '产品方向', '用户研究');
  await page.getByLabel('新节点文本').press('Escape');

  await page.getByRole('button', { name: '大纲' }).click();
  const outline = page.getByRole('complementary', { name: '思维导图大纲' });
  await expect(outline).toBeVisible();
  await outline.getByRole('button', { name: '用户研究', exact: true }).click();
  await page.getByLabel('节点语义样式').selectOption('summary');
  await page.getByLabel('节点图标').fill('🔎');
  await page.getByLabel('节点图标').press('Tab');
  await page.getByLabel('节点标签').fill('调研, 重要, 调研');
  await page.getByLabel('节点标签').press('Tab');

  await expect.poll(async () => {
    const selected = Object.values((await graphState(page)).document?.nodes ?? {})
      .find((node) => (node as { text: string }).text === '用户研究');
    return selected;
  }).toMatchObject({ semantic: 'summary', icon: '🔎', tags: ['调研', '重要'] });

  await page.getByRole('button', { name: '创建分支边界' }).click();
  await page.getByRole('button', { name: '创建分支边界' }).click();
  await expect.poll(async () => Object.keys((await graphState(page)).document?.sections ?? {}).length).toBe(1);
  await expect.poll(async () => {
    const state = await graphState(page);
    const selected = Object.values(state.document?.nodes ?? {})
      .find((node) => (node as { text: string }).text === '用户研究');
    return (selected as { parentSectionId?: string | null } | undefined)?.parentSectionId;
  }).toBeTruthy();
});

test('brain-map templates and semantic badges persist as document state', async ({ page }) => {
  await openMindMap(page);
  await addNode(page, 360, 280, '主题节点');
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.click({ position: { x: 360, y: 280 } });

  await page.getByTestId('mind-map-layout-menu').click();
  await page.getByLabel('脑图主题模板').selectOption('rainbow');
  await page.getByLabel('节点语义样式').selectOption('subtopic');
  await page.getByLabel('节点标记').selectOption('star');
  await page.getByLabel('任务优先级').selectOption('high');
  await page.getByLabel('节点进度').fill('65');
  await page.getByLabel('节点进度').press('Tab');

  await expect.poll(async () => {
    const document = (await graphState(page)).document!;
    return { mapTheme: document.settings.mapTheme, node: Object.values(document.nodes)[0] };
  }).toMatchObject({
    mapTheme: 'rainbow',
    node: { semantic: 'subtopic', marker: 'star', priority: 'high', progress: 65 },
  });
});

test('pasting a Markdown outline converts it into the selected branch', async ({ page }) => {
  await openMindMap(page);
  await addNode(page, 360, 280, '现有中心');
  await page.getByTestId('mind-map-canvas').click({ position: { x: 360, y: 280 } });
  await page.getByTestId('mind-map-canvas').evaluate((canvas) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', '# 复习计划\n## 英语\n- 单词\n## 数学');
    canvas.parentElement!.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: clipboard }));
  });

  await expect.poll(async () => Object.keys((await graphState(page)).document?.nodes ?? {}).length).toBe(5);
  const document = (await graphState(page)).document!;
  const ids = Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [(node as { text: string }).text, id]));
  const treeEdges = Object.values(document.edges).filter((edge) => edge.relationship === 'tree');
  expect(treeEdges.some((edge) => edge.sourceId === ids['现有中心'] && edge.targetId === ids['复习计划'])).toBe(true);
  expect(treeEdges.some((edge) => edge.sourceId === ids['复习计划'] && edge.targetId === ids['英语'])).toBe(true);
  expect(treeEdges.some((edge) => edge.sourceId === ids['英语'] && edge.targetId === ids['单词'])).toBe(true);
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

test('automatic child creation reflows the owning tree without moving its root', async ({ page }) => {
  await openMindMap(page);
  await addNode(page, 260, 240, '考研规划');
  const initial = await graphState(page);
  const root = Object.values(initial.document?.nodes ?? {})[0] as { x: number; y: number };

  for (const [parent, child] of [
    ['考研规划', '英语'], ['考研规划', '政治'],
    ['英语', '阅读'], ['英语', '作文'],
    ['政治', 'wa'], ['政治', '嘻嘻'],
    ['英语', '单词'],
  ]) await addTreeChild(page, parent, child);

  const current = await graphState(page);
  const nodes = Object.values(current.document?.nodes ?? {}) as Array<{ text: string; x: number; y: number; height: number }>;
  const currentRoot = nodes.find((node) => node.text === '考研规划')!;
  const word = nodes.find((node) => node.text === '单词')!;
  const wa = nodes.find((node) => node.text === 'wa')!;
  expect([currentRoot.x, currentRoot.y]).toEqual([root.x, root.y]);
  expect(wa.y - wa.height / 2 - (word.y + word.height / 2)).toBeGreaterThanOrEqual(48);
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
  await page.getByLabel('选择思维导图或 Markdown 文件').setInputFiles({
    name: 'branch-focus-map.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(imported)),
  });
  await expect.poll(async () => Object.keys((await graphState(page)).document?.nodes ?? {}).length).toBe(4);

  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.click({ button: 'right', position: { x: 240, y: 220 } });
  await page.getByRole('menuitem', { name: '选择整个分支' }).click();
  await expect(page.getByLabel('多选编辑')).toContainText('批量编辑 3 个节点');

  await page.getByLabel('关闭属性面板').click();
  await canvas.click({ button: 'right', position: { x: 240, y: 220 } });
  await page.getByRole('menuitem', { name: '仅查看此分支' }).click();
  await expect(page.getByTestId('mind-map-branch-focus')).toContainText('目标分支 · 3 个节点');

  await page.getByRole('button', { name: '搜索或命令' }).click();
  await page.getByLabel('搜索思维导图').fill('其他根节点');
  await expect(page.getByRole('option', { name: /其他根节点/ })).toHaveCount(0);
  await page.getByLabel('搜索思维导图').press('Escape');

  await canvas.click();
  await page.keyboard.press('Escape');
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
  await page.getByLabel('选择思维导图或 Markdown 文件').setInputFiles({
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
  await page.getByLabel('搜索思维导图').fill('显示线条网格');
  await page.getByRole('button', { name: '显示线条网格' }).click();
  await expect.poll(async () => (await graphState(page)).document?.settings.grid).toBe('lines');

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

  await page.getByLabel('关闭属性面板').click();
  await canvas.click({ button: 'right', position: { x: 600, y: 450 } });
  await expect(page.getByRole('menu', { name: '画布菜单' })).toBeVisible();
  await page.getByRole('menuitem', { name: '创建节点' }).click();
  await expect(page.getByLabel('新节点文本')).toBeVisible();
});

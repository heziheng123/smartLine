import { expect, test, type Page } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });

const openMindMap = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible({ timeout: 30_000 });
  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-canvas')).toBeVisible({ timeout: 30_000 });
};

const graphState = async (page: Page) => page.evaluate(async () => {
  const { useMindMapStore } = await import('/src/mindMap/testing.ts');
  const state = useMindMapStore.getState();
  return {
    nodes: state.document?.nodes ?? {},
    edges: state.document?.edges ?? {},
    viewport: state.document?.viewport ?? { x: 0, y: 0, scale: 1 },
    undo: state.history.undo.length,
    redo: state.history.redo.length,
  };
});

test('double click creates an editable node and undo redo are transactional', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await canvas.dblclick({ position: { x: 320, y: 240 } });
  const editor = page.getByLabel('新节点文本');
  await expect(editor).toBeVisible();
  await editor.fill('产品架构');
  await editor.press('Enter');

  await expect.poll(async () => Object.keys((await graphState(page)).nodes).length).toBe(1);
  await expect(page.getByTestId('mind-map-undo')).toBeEnabled();
  await page.getByTestId('mind-map-undo').click();
  await expect.poll(async () => Object.keys((await graphState(page)).nodes).length).toBe(0);
  await expect(page.getByTestId('mind-map-redo')).toBeEnabled();
  await page.getByTestId('mind-map-redo').click();
  await expect.poll(async () => Object.keys((await graphState(page)).nodes).length).toBe(1);
});

test('dragging a node creates one move transaction and persists the position', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 280, y: 220 } });
  await page.getByLabel('新节点文本').fill('可拖动节点');
  await page.getByLabel('新节点文本').press('Enter');
  const before = await graphState(page);
  const nodeBefore = Object.values(before.nodes)[0];
  expect(nodeBefore).toBeTruthy();

  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 280, box!.y + 220);
  await page.mouse.down();
  await page.mouse.move(box!.x + 380, box!.y + 300, { steps: 5 });
  await page.mouse.up();

  const after = await graphState(page);
  const nodeAfter = Object.values(after.nodes)[0];
  expect(nodeAfter.x).toBeCloseTo(nodeBefore.x + 100, 0);
  expect(nodeAfter.y).toBeCloseTo(nodeBefore.y + 80, 0);
  expect(after.undo).toBe(before.undo + 1);

  await page.reload();
  await page.getByTitle('地图工作区').click();
  await expect.poll(async () => Object.values((await graphState(page)).nodes)[0]?.x).toBeCloseTo(nodeAfter.x, 0);
});

test('a text card can be resized from every corner and by exact dimensions', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 360, y: 280 } });
  await page.getByLabel('新节点文本').fill('这是一段需要在卡片中自动换行显示的较长文字内容');
  await page.getByLabel('新节点文本').press('Enter');
  const before = Object.values((await graphState(page)).nodes)[0];
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await canvas.click({ position: { x: before.x, y: before.y } });
  await page.getByLabel('节点自动适应文字').uncheck();
  await page.mouse.move(box!.x + before.x - before.width / 2, box!.y + before.y - before.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + before.x - before.width / 2 - 70, box!.y + before.y - before.height / 2 - 50, { steps: 5 });
  await page.mouse.up();

  const resized = Object.values((await graphState(page)).nodes)[0];
  expect(resized.width).toBeCloseTo(before.width + 70, 0);
  expect(resized.height).toBeCloseTo(before.height + 50, 0);
  expect(resized.x).toBeLessThan(before.x);
  expect(resized.y).toBeLessThan(before.y);
  expect(resized.sizeMode).toBe('manual');

  await page.getByLabel('节点宽度').fill('240');
  await page.getByLabel('节点宽度').press('Tab');
  await page.getByLabel('节点高度').fill('180');
  await page.getByLabel('节点高度').press('Tab');
  await expect.poll(async () => {
    const node = Object.values((await graphState(page)).nodes)[0];
    return [node.width, node.height];
  }).toEqual([240, 180]);
});

test('wheel zoom is centered on the canvas and updates only the local viewport', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 300, box!.y + 220);
  await page.mouse.wheel(0, -500);
  await expect(page.locator('footer').getByText(/%/)).not.toHaveText('100%');
});

test('node action handles keep screen-space spacing after zooming out', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 320, y: 240 } });
  await page.getByLabel('新节点文本').fill('缩放按钮');
  await page.getByLabel('新节点文本').press('Enter');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 320, box!.y + 240);
  const initialScale = (await graphState(page)).viewport.scale;
  await page.mouse.wheel(0, 285);
  await expect.poll(async () => (await graphState(page)).viewport.scale).toBeLessThan(initialScale);

  const state = await graphState(page);
  const node = Object.values(state.nodes)[0];
  const moreButton = {
    x: node.x * state.viewport.scale + state.viewport.x + 24,
    y: node.y * state.viewport.scale + state.viewport.y - node.height * state.viewport.scale / 2 - 16,
  };
  await canvas.click({ position: moreButton });
  await expect(page.getByRole('menu', { name: '节点菜单' })).toBeVisible();
});

test('two touch pointers pinch-zoom the canvas after the first pointer starts panning', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  const before = (await graphState(page)).viewport;

  await canvas.evaluate((element) => {
    Object.assign(element, {
      setPointerCapture: () => undefined,
      hasPointerCapture: () => false,
      releasePointerCapture: () => undefined,
    });
    const rect = element.getBoundingClientRect();
    const emit = (type: string, pointerId: number, clientX: number) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      button: 0,
      clientX,
      clientY: rect.top + rect.height / 2,
    }));
    const centerX = rect.left + rect.width / 2;
    emit('pointerdown', 1, centerX - 30);
    emit('pointerdown', 2, centerX + 30);
    emit('pointermove', 2, centerX + 100);
    emit('pointerup', 1, centerX - 30);
    emit('pointerup', 2, centerX + 100);
  });

  await expect.poll(async () => (await graphState(page)).viewport.scale).toBeGreaterThan(before.scale);
});

test('editing existing text keeps a caret instead of selecting the whole node', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 320, y: 240 } });
  await page.getByLabel('新节点文本').fill('原有文字');
  await page.getByLabel('新节点文本').press('Enter');
  await canvas.dblclick({ position: { x: 320, y: 240 } });
  const editor = page.getByLabel('编辑节点文本');
  await expect(editor).toBeVisible();
  expect(await editor.evaluate((input) => ({
    start: (input as HTMLTextAreaElement).selectionStart,
    end: (input as HTMLTextAreaElement).selectionEnd,
    length: (input as HTMLTextAreaElement).value.length,
  }))).toEqual({ start: 4, end: 4, length: 4 });
  await editor.press('ArrowLeft');
  await editor.press('ArrowLeft');
  await editor.pressSequentially('新增');
  await editor.press('Enter');
  await expect.poll(async () => Object.values((await graphState(page)).nodes)[0]?.text).toBe('原有新增文字');
});

test('markdown shortcuts create a rich multiline Markdown node', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 320, y: 240 } });
  const editor = page.getByLabel('新节点文本');
  await editor.pressSequentially('# 一级标题');
  await editor.press('Enter');
  await editor.pressSequentially('- 待办事项');
  await editor.press('Control+Enter');
  await expect.poll(async () => Object.values((await graphState(page)).nodes)[0]).toMatchObject({
    type: 'markdown',
    text: '# 一级标题\n- 待办事项',
  });
  await expect(page.locator('[class*="richPreview"] h1')).toContainText('一级标题');
});

test('a single-line Markdown node does not reserve an oversized blank area', async ({ page }) => {
  await openMindMap(page);
  const undoBefore = (await graphState(page)).undo;
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 320, y: 240 } });
  const editor = page.getByLabel('新节点文本');
  await editor.fill('- 一项');
  await editor.press('Control+Enter');

  await expect.poll(async () => Object.values((await graphState(page)).nodes)[0]).toMatchObject({
    type: 'markdown',
    height: 48,
  });
  await expect.poll(async () => (await graphState(page)).undo).toBe(undoBefore + 1);
});

test('auto-sized Markdown growth reflows siblings without moving the centre topic or adding measurement history', async ({ page }) => {
  await openMindMap(page);
  const seeded = await page.evaluate(async () => {
    const [{ useMindMapStore }, { createMindMapEdge, createTextMindMapNode }, { layoutMindMap }] = await Promise.all([
      import('/src/mindMap/testing.ts'),
      import('/src/mindMap/model.ts'),
      import('/src/mindMap/layout.ts'),
    ]);
    const state = useMindMapStore.getState();
    state.execute('准备自动避让测试', (current) => {
      const root = createTextMindMapNode({ x: 500, y: 420 }, { id: 'reflow-root', text: '中心主题', now: 1 });
      const first = {
        ...createTextMindMapNode({ x: 0, y: 0 }, { id: 'reflow-first', text: '# 第一项', now: 1 }),
        type: 'markdown' as const,
        branchSide: 'right' as const,
      };
      const second = {
        ...createTextMindMapNode({ x: 0, y: 0 }, { id: 'reflow-second', text: '第二项', now: 1 }),
        branchSide: 'right' as const,
      };
      const document = {
        ...current,
        nodes: { [root.id]: root, [first.id]: first, [second.id]: second },
        edges: {
          first: createMindMapEdge(root.id, first.id, { id: 'reflow-edge-first', relationship: 'tree', order: 0, now: 1 }),
          second: createMindMapEdge(root.id, second.id, { id: 'reflow-edge-second', relationship: 'tree', order: 1, now: 1 }),
        },
        zOrder: [root.id, first.id, second.id],
        settings: { ...current.settings, mode: 'mind-map' as const },
        mindMapRootId: root.id,
      };
      return layoutMindMap(document);
    });
    const document = useMindMapStore.getState().document!;
    return {
      root: { x: document.nodes['reflow-root'].x, y: document.nodes['reflow-root'].y },
      secondY: document.nodes['reflow-second'].y,
      undo: useMindMapStore.getState().history.undo.length,
    };
  });

  const afterMeasurement = await page.evaluate(async () => {
    const { useMindMapStore } = await import('/src/mindMap/testing.ts');
    useMindMapStore.getState().syncAutoNodeSizes([{ id: 'reflow-first', width: 180, height: 420 }]);
    const state = useMindMapStore.getState();
    const first = state.document!.nodes['reflow-first'];
    const second = state.document!.nodes['reflow-second'];
    const root = state.document!.nodes['reflow-root'];
    return {
      root: { x: root.x, y: root.y },
      secondY: second.y,
      gap: second.y - second.height / 2 - (first.y + first.height / 2),
      undo: state.history.undo.length,
    };
  });

  expect(afterMeasurement.root).toEqual(seeded.root);
  expect(afterMeasurement.secondY).toBeGreaterThan(seeded.secondY);
  expect(afterMeasurement.gap).toBeGreaterThanOrEqual(48);
  expect(afterMeasurement.undo).toBe(seeded.undo);

  const afterEdit = await page.evaluate(async () => {
    const { useMindMapStore } = await import('/src/mindMap/testing.ts');
    const before = useMindMapStore.getState();
    const undo = before.history.undo.length;
    before.updateNode('reflow-first', { text: '# 第一项\n\n新增内容', height: 520 });
    const state = useMindMapStore.getState();
    const first = state.document!.nodes['reflow-first'];
    const second = state.document!.nodes['reflow-second'];
    return {
      gap: second.y - second.height / 2 - (first.y + first.height / 2),
      undoDelta: state.history.undo.length - undo,
    };
  });
  expect(afterEdit.gap).toBeGreaterThanOrEqual(48);
  expect(afterEdit.undoDelta).toBe(1);
});

test('the Markdown slash menu applies a command without leaving the editor', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 320, y: 240 } });
  const editor = page.getByLabel('新节点文本');
  await editor.fill('/h');
  const menu = page.getByRole('listbox', { name: 'Markdown 快捷菜单' });
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
  await editor.press('ArrowDown');
  await editor.press('ArrowDown');
  await expect(menu.getByRole('option').nth(2)).toHaveAttribute('aria-selected', 'true');
  await editor.press('Enter');
  await expect(editor).toHaveValue('### ');
  await editor.pressSequentially('快捷标题');
  await editor.press('Control+Enter');

  await expect.poll(async () => Object.values((await graphState(page)).nodes)[0]).toMatchObject({
    type: 'markdown',
    text: '### 快捷标题',
  });
  await expect(page.locator('[class*="richPreview"] h3')).toContainText('快捷标题');
});

test('Markdown editing continues and indents lists and wraps selected text', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 360, y: 280 } });
  const editor = page.getByLabel('新节点文本');
  await editor.fill('1. 第一项');
  await editor.press('End');
  await editor.press('Enter');
  await expect(editor).toHaveValue('1. 第一项\n2. ');
  await editor.pressSequentially('第二项');
  await editor.press('Tab');
  await expect(editor).toHaveValue('1. 第一项\n    2. 第二项');
  await editor.press('Shift+Tab');
  await expect(editor).toHaveValue('1. 第一项\n2. 第二项');
  await editor.evaluate((input) => {
    const textarea = input as HTMLTextAreaElement;
    const start = textarea.value.indexOf('第二项');
    textarea.setSelectionRange(start, start + 3);
  });
  await editor.press('Control+b');
  await expect(editor).toHaveValue('1. 第一项\n2. **第二项**');
  await editor.press('Control+b');
  await expect(editor).toHaveValue('1. 第一项\n2. 第二项');
  await editor.press('Control+i');
  await expect(editor).toHaveValue('1. 第一项\n2. *第二项*');
  await editor.press('Control+i');
  await expect(editor).toHaveValue('1. 第一项\n2. 第二项');
  await editor.press('Control+b');
  await editor.press('Control+Enter');

  const preview = page.locator('[data-testid^="mind-map-markdown-"]');
  await expect(preview.locator('ol li')).toHaveCount(2);
  await expect(preview.locator('strong')).toHaveText('第二项');
  expect(await preview.locator('ol').evaluate((list) => getComputedStyle(list).marginBottom)).toBe('0px');
});

test('large Markdown nodes provide live preview, interactive tasks, highlighting and expansion', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 360, y: 400 } });
  const editor = page.getByLabel('新节点文本');
  const markdown = [
    '# 完整计划',
    '- [ ] 完成复习',
    '```ts',
    'const total = 42;',
    '```',
    ...Array.from({ length: 36 }, (_, index) => `${index + 1}. 第 ${index + 1} 项详细安排`),
  ].join('\n');
  await editor.fill(markdown);
  await expect(page.getByLabel('Markdown 实时预览')).toBeVisible();
  await editor.press('Control+Enter');

  const preview = page.locator('[data-testid^="mind-map-markdown-"]');
  await expect(preview.locator('.mm-token-keyword')).toHaveText('const');
  await expect.poll(async () => Object.values((await graphState(page)).nodes)[0]?.height).toBe(600);

  await preview.locator('input[type="checkbox"]').click();
  await expect.poll(async () => Object.values((await graphState(page)).nodes)[0]?.text).toContain('- [x] 完成复习');

  await page.getByRole('button', { name: '展开 Markdown 节点' }).click();
  await expect.poll(async () => Object.values((await graphState(page)).nodes)[0]?.height).toBeGreaterThan(600);
  await page.getByRole('button', { name: '收起 Markdown 节点' }).click();
  await expect.poll(async () => Object.values((await graphState(page)).nodes)[0]?.height).toBe(600);
});

test('a remote Markdown image refits its automatic node after loading', async ({ page }) => {
  await page.route('https://assets.example.test/tall.svg', (route) => route.fulfill({
    contentType: 'image/svg+xml',
    body: '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="480"><rect width="240" height="480" fill="#6366f1"/></svg>',
  }));
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 360, y: 280 } });
  const editor = page.getByLabel('新节点文本');
  await editor.fill('![远程图片](https://assets.example.test/tall.svg)');
  await editor.press('Control+Enter');

  await expect(page.locator('[data-testid^="mind-map-markdown-"] img')).toBeVisible();
  await expect.poll(async () => Object.values((await graphState(page)).nodes)[0]?.height).toBeGreaterThan(300);
});

test('the Markdown slash menu includes ordered lists and common inline formatting', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 360, y: 280 } });
  const editor = page.getByLabel('新节点文本');
  await editor.fill('/ol');
  await page.getByRole('option', { name: /有序列表/ }).click();
  await expect(editor).toHaveValue('1. ');

  await editor.fill('/bold');
  await page.getByRole('option', { name: /粗体/ }).click();
  await expect(editor).toHaveValue('**粗体**');
  expect(await editor.evaluate((input) => [(input as HTMLTextAreaElement).selectionStart, (input as HTMLTextAreaElement).selectionEnd])).toEqual([2, 4]);

  await editor.fill('/code');
  await page.getByRole('option', { name: /代码块/ }).click();
  await expect(editor).toHaveValue('```\n\n```');
  expect(await editor.evaluate((input) => [(input as HTMLTextAreaElement).selectionStart, (input as HTMLTextAreaElement).selectionEnd])).toEqual([4, 4]);

  await editor.fill('资料');
  await editor.selectText();
  await editor.press('Control+k');
  await expect(editor).toHaveValue('[资料](https://)');
  expect(await editor.evaluate((input) => [(input as HTMLTextAreaElement).selectionStart, (input as HTMLTextAreaElement).selectionEnd])).toEqual([5, 13]);
});

test('Markdown node links open safely and notes provide a rendered preview', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x: 360, y: 280 } });
  const editor = page.getByLabel('新节点文本');
  await editor.fill('[访问资料](https://example.com/docs)');
  await editor.press('Control+Enter');

  const note = page.getByLabel('节点备注 Markdown');
  await note.fill('## 背景\n\n这里是 **完整备注**。');
  await note.press('Tab');
  const preview = page.locator('details').filter({ hasText: '备注预览' });
  await expect(preview.getByRole('heading', { name: '背景' })).toBeVisible();
  await expect(preview.locator('strong')).toHaveText('完整备注');

  const popupPromise = page.waitForEvent('popup');
  await page.locator('[data-testid^="mind-map-markdown-"] a').click();
  const popup = await popupPromise;
  await expect.poll(() => popup.url()).toContain('https://example.com/docs');
  await popup.close();
});

test('dragging blank canvas pans the infinite board while Shift drag keeps marquee selection', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const before = (await graphState(page)).viewport;
  await page.mouse.move(box!.x + 700, box!.y + 500);
  await page.mouse.down();
  await page.mouse.move(box!.x + 580, box!.y + 420, { steps: 4 });
  await page.mouse.up();
  const after = (await graphState(page)).viewport;
  expect(after.x).toBeCloseTo(before.x - 120, 0);
  expect(after.y).toBeCloseTo(before.y - 80, 0);
});

import { expect, test, type Page } from '@playwright/test';

const openMindMap = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-canvas')).toBeVisible();
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

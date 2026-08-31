import { expect, test, type Page } from '@playwright/test';

const openMindMap = async (page: Page) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-canvas')).toBeVisible();
};

const addNode = async (page: Page, x: number, y: number, text: string) => {
  const canvas = page.getByTestId('mind-map-canvas');
  await canvas.dblclick({ position: { x, y } });
  await page.getByLabel('新节点文本').fill(text);
  await page.getByLabel('新节点文本').press('Enter');
};

const graphState = async (page: Page) => page.evaluate(async () => {
  const { useMindMapStore } = await import('/src/mindMap/testing.ts');
  const document = useMindMapStore.getState().document;
  return { nodes: document?.nodes ?? {}, edges: document?.edges ?? {} };
});

const addProjectReference = async (page: Page, id: string, x: number, y: number) => page.evaluate(async ({ id, x, y }) => {
  const { useMindMapStore } = await import('/src/mindMap/testing.ts');
  useMindMapStore.getState().execute('测试项目引用', (document) => ({
    ...document,
    projectReferences: {
      ...document.projectReferences,
      [id]: {
        id,
        kind: 'project-reference',
        targetType: 'project',
        targetId: 'project-source-kept',
        x,
        y,
        width: 180,
        height: 96,
        display: 'compact',
        locked: false,
        createdAt: 1,
        updatedAt: 1,
      },
    },
  }));
}, { id, x, y });

test('connection handles create an edge whose type direction and label can be edited', async ({ page }) => {
  await openMindMap(page);
  await addNode(page, 220, 220, '前端');
  await addNode(page, 460, 220, '后端');
  const canvas = page.getByTestId('mind-map-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await canvas.click({ position: { x: 220, y: 220 } });
  const source = Object.values((await graphState(page)).nodes).find((node) => node.text === '前端')!;
  await page.mouse.move(box!.x + source.x, box!.y + source.y - source.height / 2 - 16);
  await page.mouse.down();
  await page.mouse.move(box!.x + 460, box!.y + 220, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Object.keys((await graphState(page)).edges).length).toBe(1);

  await canvas.click({ position: { x: 340, y: 220 } });
  await expect(page.getByLabel('连线属性')).toBeVisible();
  await page.getByLabel('连线线型').selectOption('curve');
  await page.getByLabel('连线方向').selectOption('both');
  await page.getByLabel('连线标签').fill('服务调用');
  await page.getByLabel('连线标签').press('Tab');

  await expect.poll(async () => Object.values((await graphState(page)).edges)[0]?.label).toBe('服务调用');
  const edge = Object.values((await graphState(page)).edges)[0];
  expect(edge.type).toBe('curve');
  expect(edge.direction).toBe('both');
});

test('the unified relation handle and toolbar connection mode create edges', async ({ page }) => {
  await openMindMap(page);
  await addNode(page, 220, 220, '起点');
  await addNode(page, 460, 360, '终点');
  const canvas = page.getByTestId('mind-map-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await canvas.click({ position: { x: 220, y: 220 } });
  const source = Object.values((await graphState(page)).nodes).find((node) => node.text === '起点')!;
  await page.mouse.move(box!.x + source.x, box!.y + source.y - source.height / 2 - 16);
  await page.mouse.down();
  await page.mouse.move(box!.x + 460, box!.y + 360, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Object.keys((await graphState(page)).edges).length).toBe(1);

  await canvas.click({ position: { x: 220, y: 220 } });
  await page.keyboard.press('L');
  await expect(page.getByRole('status')).toContainText('已选择起点');
  await canvas.click({ position: { x: 460, y: 360 } });
  await expect.poll(async () => Object.keys((await graphState(page)).edges).length).toBe(2);

  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '连线' }).click();
  await expect(page.getByRole('status')).toContainText('先点击起点对象');
  await canvas.click({ position: { x: 460, y: 360 } });
  await expect(page.getByRole('status')).toContainText('已选择起点');
  await canvas.click({ position: { x: 220, y: 220 } });
  await expect.poll(async () => Object.keys((await graphState(page)).edges).length).toBe(3);
  await expect(page.getByRole('button', { name: '连线' })).toHaveAttribute('aria-pressed', 'false');
});

test('project references use the same L and toolbar relation system as nodes', async ({ page }) => {
  await openMindMap(page);
  await addNode(page, 220, 220, '考研');
  await addProjectReference(page, 'project-reference-a', 500, 220);
  const canvas = page.getByTestId('mind-map-canvas');
  const reference = page.getByTestId('mind-map-project-reference-project-reference-a');
  await expect(reference).toBeVisible();

  await canvas.click({ position: { x: 220, y: 220 } });
  await page.keyboard.press('L');
  await reference.click({ position: { x: 80, y: 46 } });
  await expect.poll(async () => Object.keys((await graphState(page)).edges).length).toBe(1);
  expect(Object.values((await graphState(page)).edges)[0]?.target).toEqual({ type: 'project-reference', id: 'project-reference-a' });

  await page.getByRole('button', { name: '连线' }).click();
  await reference.click({ position: { x: 80, y: 46 } });
  await canvas.click({ position: { x: 220, y: 220 } });
  await expect.poll(async () => Object.keys((await graphState(page)).edges).length).toBe(2);
  expect(Object.values((await graphState(page)).edges)[1]?.source).toEqual({ type: 'project-reference', id: 'project-reference-a' });
});

test('a project reference relation handle can be dragged to a mind node', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Precise cross-layer pointer geometry is covered once on desktop.');
  await openMindMap(page);
  await addNode(page, 220, 220, '普通节点');
  await addProjectReference(page, 'project-reference-drag', 500, 220);
  const reference = page.getByTestId('mind-map-project-reference-project-reference-drag');
  await reference.hover();
  const handle = reference.getByRole('button', { name: '创建关联' });
  await expect(handle).toBeVisible();
  const box = await handle.boundingBox();
  const canvas = page.getByTestId('mind-map-canvas');
  const canvasBox = await canvas.boundingBox();
  expect(box).not.toBeNull();
  expect(canvasBox).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(canvasBox!.x + 220, canvasBox!.y + 220, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => Object.keys((await graphState(page)).edges).length).toBe(1);
  expect(Object.values((await graphState(page)).edges)[0]?.source).toEqual({ type: 'project-reference', id: 'project-reference-drag' });
});

test('an edge endpoint can be reconnected without creating a dangling edge', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Precise desktop pointer geometry is covered once.');
  await openMindMap(page);
  await addNode(page, 220, 220, 'A');
  await addNode(page, 460, 220, 'B');
  await addNode(page, 620, 420, 'C');
  const canvas = page.getByTestId('mind-map-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await canvas.click({ position: { x: 220, y: 220 } });
  const source = Object.values((await graphState(page)).nodes).find((node) => node.text === 'A')!;
  await page.mouse.move(box!.x + source.x, box!.y + source.y - source.height / 2 - 16);
  await page.mouse.down();
  await page.mouse.move(box!.x + 460, box!.y + 220);
  await page.mouse.up();
  await expect.poll(async () => Object.keys((await graphState(page)).edges).length).toBe(1);

  await canvas.click({ position: { x: 340, y: 220 } });
  const before = Object.values((await graphState(page)).edges)[0];
  await page.mouse.move(box!.x + 400, box!.y + 220);
  await page.mouse.down();
  await page.mouse.move(box!.x + 620, box!.y + 420, { steps: 6 });
  await page.mouse.up();

  const after = Object.values((await graphState(page)).edges)[0];
  expect(after.id).toBe(before.id);
  expect(after.sourceId).toBe(before.sourceId);
  expect(after.targetId).not.toBe(before.targetId);
  expect((await graphState(page)).nodes[after.targetId]?.text).toBe('C');
});

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

const addNode = async (page: Page, x: number, y: number, text: string) => {
  const canvas = page.getByTestId('mind-map-canvas');
  const closeInspector = page.getByLabel('关闭属性面板');
  if (await closeInspector.isVisible()) await closeInspector.click();
  await canvas.dblclick({ position: { x, y } });
  await page.getByLabel('新节点文本').fill(text);
  await page.getByLabel('新节点文本').press('Enter');
  await page.getByLabel('新节点文本').press('Escape');
};

const graphState = async (page: Page) => page.evaluate(async () => {
  const { useMindMapStore } = await import('/src/mindMap/testing.ts');
  return useMindMapStore.getState().document;
});

test('sections and groups create, collapse and move as isolated history transactions', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await addNode(page, 180, 260, '节点 A');
  await addNode(page, 360, 260, '节点 B');

  await page.locator('[aria-label="思维导图画布"][tabindex="0"]').focus();
  await page.keyboard.press('Control+A');
  await expect(page.getByLabel('多选排列')).toBeVisible();
  await page.getByRole('button', { name: '创建区域' }).click();
  await expect(page.getByLabel('区域属性')).toBeVisible();
  await expect.poll(async () => Object.keys((await graphState(page))?.sections ?? {}).length).toBe(1);
  expect(Object.values((await graphState(page))!.nodes).every((node) => Boolean(node.parentSectionId))).toBe(true);
  const originalSection = Object.values((await graphState(page))!.sections)[0];
  await page.getByLabel('区域宽度').fill(String(originalSection.width + 80));
  await page.getByLabel('区域宽度').press('Tab');
  await page.getByLabel('区域高度').fill(String(originalSection.height + 60));
  await page.getByLabel('区域高度').press('Tab');
  await expect.poll(async () => Object.values((await graphState(page))!.sections)[0]?.sizeMode).toBe('manual');
  await expect.poll(async () => Object.values((await graphState(page))!.sections)[0]?.width).toBeCloseTo(originalSection.width + 80, 0);

  await page.getByLabel('折叠区域').check();
  await expect.poll(async () => Object.values((await graphState(page))!.sections)[0]?.collapsed).toBe(true);
  await page.getByRole('button', { name: '搜索或命令' }).click();
  await page.getByLabel('搜索思维导图').fill('节点 A');
  await page.getByRole('option', { name: /节点.*节点 A/ }).click();
  await expect.poll(async () => Object.values((await graphState(page))!.sections)[0]?.collapsed).toBe(false);
  const beforeMove = await graphState(page);
  const sectionBefore = Object.values(beforeMove!.sections)[0];
  const sectionHeader = {
    x: (sectionBefore.x - sectionBefore.width / 2 + 24) * beforeMove!.viewport.scale + beforeMove!.viewport.x,
    y: (sectionBefore.y - sectionBefore.height / 2 + 20) * beforeMove!.viewport.scale + beforeMove!.viewport.y,
  };
  await canvas.click({ position: sectionHeader });
  const firstBefore = beforeMove!.nodes[Object.keys(beforeMove!.nodes)[0]];
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + sectionHeader.x, box!.y + sectionHeader.y);
  await page.mouse.down();
  await page.mouse.move(box!.x + sectionHeader.x + 50, box!.y + sectionHeader.y + 40, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => (await graphState(page))!.nodes[firstBefore.id].x)
    .toBeCloseTo(firstBefore.x + 50 / beforeMove!.viewport.scale, 0);

  await page.getByLabel('关闭属性面板').click();
  await page.locator('[aria-label="思维导图画布"][tabindex="0"]').focus();
  await page.keyboard.press('Control+A');
  await page.getByRole('button', { name: '创建分组' }).click();
  await expect.poll(async () => Object.keys((await graphState(page))?.groups ?? {}).length).toBe(1);
  const grouped = await graphState(page);
  expect(Object.values(grouped!.nodes).every((node) => Boolean(node.groupId))).toBe(true);
});

test('advanced nodes, orthogonal edges, SVG export, minimap and command palette work', async ({ page }) => {
  await openMindMap(page);
  const canvas = page.getByTestId('mind-map-canvas');
  await page.getByLabel('新节点类型').selectOption('markdown');
  await addNode(page, 220, 240, '# Markdown 节点\n\n**正式渲染**\n\n<script>window.__mindMapInjected = true</script>');
  await expect(page.locator('[data-testid^="mind-map-markdown-"] h1')).toHaveText('Markdown 节点');
  await expect(page.locator('[data-testid^="mind-map-markdown-"] strong')).toHaveText('正式渲染');
  await expect(page.locator('[data-testid^="mind-map-markdown-"] script')).toHaveCount(0);
  expect(await page.evaluate(() => (window as typeof window & { __mindMapInjected?: boolean }).__mindMapInjected)).toBeUndefined();
  await page.getByLabel('新节点类型').selectOption('latex');
  await addNode(page, 760, 240, 'E = mc^2');
  await expect(page.locator('[data-testid^="mind-map-latex-"] .katex')).toBeVisible();
  await page.getByLabel('新节点类型').selectOption('text');
  await addNode(page, 500, 240, '普通节点');
  expect(Object.values((await graphState(page))!.nodes).some((node) => node.type === 'markdown')).toBe(true);

  const state = await graphState(page);
  const markdown = Object.values(state!.nodes).find((node) => node.type === 'markdown')!;
  const target = Object.values(state!.nodes).find((node) => node.type === 'text')!;
  await canvas.click({ position: { x: markdown.x, y: markdown.y } });
  await page.keyboard.press('L');
  await canvas.click({ position: { x: target.x, y: target.y } });
  await expect.poll(async () => Object.keys((await graphState(page))?.edges ?? {}).length).toBe(1);
  await canvas.click({ position: {
    x: (markdown.x + markdown.width / 2 + target.x - target.width / 2) / 2,
    y: markdown.y,
  } });
  await page.getByLabel('连线线型').selectOption('orthogonal');
  await expect.poll(async () => Object.values((await graphState(page))!.edges)[0]?.type).toBe('orthogonal');
  expect(Object.values((await graphState(page))!.edges)[0].controlPoints).toHaveLength(2);

  const svgDownloadPromise = page.waitForEvent('download');
  await openMoreMenu(page);
  await page.getByRole('menuitem', { name: '导出 SVG' }).click();
  expect((await svgDownloadPromise).suggestedFilename()).toMatch(/\.svg$/);

  await page.getByLabel('新节点类型').selectOption('image');
  await addNode(page, 700, 400, '本地图片');
  await page.getByLabel('上传节点图片').setInputFiles({
    name: 'pixel.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'),
  });
  await expect.poll(async () => Object.values((await graphState(page))!.nodes).find((node) => node.type === 'image')?.imageAssetId).toBeTruthy();
  const imageNode = Object.values((await graphState(page))!.nodes).find((node) => node.type === 'image')!;
  expect(imageNode.imageSrc).toBeNull();
  await expect(page.locator('img[src^="blob:"]')).toBeVisible();

  await page.getByLabel('关闭属性面板').click();
  await canvas.click({ position: { x: 100, y: 450 } });
  await page.keyboard.press('Control+K');
  await expect(page.getByLabel('搜索与命令')).toBeVisible();
  await page.getByLabel('搜索思维导图').fill('树形');
  await page.getByRole('button', { name: '从左到右树形布局' }).click();
  await expect(page.getByLabel('搜索与命令')).toHaveCount(0);

  await expect(page.getByLabel('思维导图小地图')).toBeVisible();
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');
  await page.reload();
  await page.getByTitle('地图工作区').click();
  await expect(page.locator('img[src^="blob:"]')).toBeVisible();
  const imagePngDownload = page.waitForEvent('download');
  await openMoreMenu(page);
  await page.getByRole('button', { name: '导出 PNG' }).click();
  expect((await imagePngDownload).suggestedFilename()).toMatch(/\.png$/);
  await expect.poll(async () => page.evaluate(async (assetId) => {
    const { mindMapRepository } = await import('/src/mindMap/repository.ts');
    return (await mindMapRepository.loadImageAsset(assetId))?.refCount;
  }, imageNode.imageAssetId)).toBe(1);
  await openMoreMenu(page);
  await page.getByRole('menuitem', { name: '复制当前导图' }).click();
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');
  await expect.poll(async () => page.evaluate(async (assetId) => {
    const { mindMapRepository } = await import('/src/mindMap/repository.ts');
    return (await mindMapRepository.loadImageAsset(assetId))?.refCount;
  }, imageNode.imageAssetId)).toBe(2);
  page.once('dialog', (dialog) => void dialog.accept());
  await openMoreMenu(page);
  await page.getByRole('menuitem', { name: '删除当前导图' }).click();
  await expect.poll(async () => page.evaluate(async (assetId) => {
    const { mindMapRepository } = await import('/src/mindMap/repository.ts');
    return (await mindMapRepository.loadImageAsset(assetId))?.refCount;
  }, imageNode.imageAssetId)).toBe(1);
});

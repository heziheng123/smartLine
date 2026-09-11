import { expect, test } from '@playwright/test';

const nodes = [
  { id: 'radius-root', name: '教育学', parentId: null, createdAt: 1 },
  { id: 'radius-level-1', name: '中国教育史', parentId: 'radius-root', createdAt: 2 },
  { id: 'radius-level-2', name: '中国近现代教育史', parentId: 'radius-level-1', createdAt: 3 },
  { id: 'radius-level-3', name: '南京国民政府时期教育制度', parentId: 'radius-level-2', createdAt: 4 },
  { id: 'radius-leaf', name: '南京国民政府时期教育制度与杨贤江', parentId: 'radius-level-3', createdAt: 5 },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/*', async (route) => {
    if (route.request().resourceType() !== 'document') {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy': "img-src 'self' data: https://images.unsplash.com https://picsum.photos",
      },
    });
  });
  await page.addInitScript((seedNodes) => {
    localStorage.clear();
    localStorage.setItem('line-graph-storage:mirror', JSON.stringify({ nodes: seedNodes }));
  }, nodes);
  await page.goto('/');
  await expect(page.getByTitle('知识大盘')).toBeVisible();
  await page.getByTitle('知识大盘').click();
  await expect(page.getByLabel('知识大盘视图')).toBeVisible();
  await expect.poll(() => page.locator('.knowledge-graph-view svg[data-radius-mode]').getAttribute('data-island-radius'))
    .not.toBe('0');
});

test('expanded radius recomputes a longer visible node title instead of only scaling the svg', async ({ page }) => {
  const canvas = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  const label = canvas.locator('[data-node-id="radius-leaf"] text');
  const overviewRadius = Number(await canvas.getAttribute('data-island-radius'));
  const overviewTitle = await label.textContent();

  await page.getByLabel('知识大盘视图').click();
  await page.getByRole('group', { name: '知识大盘大小' }).getByRole('button', { name: '展开' }).click();
  await expect(canvas).toHaveAttribute('data-radius-mode', 'expanded');
  await expect.poll(async () => Number(await canvas.getAttribute('data-island-radius'))).toBeGreaterThanOrEqual(880);
  await expect.poll(async () => (await label.textContent())?.length ?? 0)
    .toBeGreaterThan(overviewTitle?.length ?? 0);

  expect(Number(await canvas.getAttribute('data-island-radius'))).toBeGreaterThan(overviewRadius);
});

test('reading and expanded modes automatically focus one disk from the multi-disk overview', async ({ page }) => {
  await page.evaluate(async () => {
      const { useGraphStore } = await import('/src/testing/workspaceStoreAccess.ts');
    useGraphStore.setState({
      nodes: [
        ...useGraphStore.getState().nodes,
        { id: 'second-root', name: '心理学', parentId: null, createdAt: 6 },
      ],
    });
  });

  await page.getByLabel('知识大盘视图').click();
  const sizeGroup = page.getByRole('group', { name: '知识大盘大小' });
  await sizeGroup.getByRole('button', { name: '展开' }).click();
  await expect(page.getByLabel('知识大盘视角')).toHaveValue('radius-root');
  await expect(sizeGroup.getByRole('button', { name: '展开' })).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => Number(await page.locator('.knowledge-graph-view svg[data-radius-mode]').getAttribute('data-island-radius')))
    .toBeGreaterThanOrEqual(880);

  await sizeGroup.getByRole('button', { name: '总览' }).click();
  await expect(page.getByLabel('知识大盘视角')).toHaveValue('all');
  await expect(sizeGroup.getByRole('button', { name: '总览' })).toHaveAttribute('aria-pressed', 'true');

  const canvas = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  await expect.poll(() => canvas.evaluate((svg) => {
    const graphCenter = svg.querySelector(':scope > g > g') as SVGGElement | null;
    const matrix = graphCenter?.getScreenCTM();
    const bounds = svg.getBoundingClientRect();
    if (!matrix) return Number.POSITIVE_INFINITY;
    return Math.hypot(matrix.e - (bounds.left + bounds.width / 2), matrix.f - (bounds.top + bounds.height / 2));
  })).toBeLessThan(2);
});

test('knowledge graph keeps the app dock navigation-only and moves page controls into the header', async ({ page }) => {
  const dockActions = page.getByTestId('knowledge-graph-page-actions');
  const dock = page.locator('.tl-dock');
  const viewportWidth = page.viewportSize()?.width ?? 0;

  await expect(dockActions.getByRole('button')).toHaveCount(5);
  await expect(page.getByRole('banner', { name: '知识大盘工作区' }).getByTestId('knowledge-graph-page-actions')).toBeVisible();
  await expect(dock.getByTestId('knowledge-graph-page-actions')).toHaveCount(0);
  await expect.poll(async () => (await dock.boundingBox())?.width ?? Number.POSITIVE_INFINITY)
    .toBeLessThanOrEqual(viewportWidth - 16);

  await page.getByLabel('知识状态筛选').click();
  await expect(page.getByRole('dialog', { name: '知识状态筛选菜单' })).toBeVisible();
  await page.getByRole('dialog', { name: '知识状态筛选菜单' }).getByRole('button', { name: /未激活/ }).click();
  await expect(page.getByLabel('知识状态筛选').locator('.tl-dock-status-badge')).toHaveText('1');

  await page.getByLabel('搜索知识').click();
  const search = page.getByRole('search', { name: '搜索知识节点' }).getByPlaceholder('输入节点标题');
  await expect(search).toBeFocused();
  await search.fill('南京国民政府');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('search', { name: '搜索知识节点' })).toBeHidden();
  await expect(page.getByLabel('搜索知识').locator('span')).toBeVisible();

  const canvas = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  await canvas.hover();
  await page.mouse.wheel(0, -240);
  await expect(page.getByLabel('视角归中')).toBeVisible();
  await page.getByLabel('知识状态筛选').click();
  await expect(page.getByLabel('视角归中')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByLabel('视角归中').click();
  await expect(page.getByLabel('视角归中')).toBeHidden();
});

test('knowledge graph keeps labels visible while panning', async ({ page }) => {
  const canvas = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  const label = canvas.locator('[data-node-id="radius-leaf"] text');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + box!.height / 2 + 30);
  await expect(label).toBeVisible();
  await page.mouse.up();
  await expect(label).toBeVisible();
});

test('knowledge graph uses canvas while scaling and restores sharp SVG labels', async ({ page }) => {
  const canvas = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  const cache = page.getByTestId('knowledge-graph-zoom-cache');
  const graph = canvas.locator(':scope > g');
  const label = canvas.locator('[data-node-id="radius-leaf"] text');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  const readScale = () => graph.evaluate((element) => {
    const matrix = (element as SVGGElement).getScreenCTM();
    return matrix ? Math.hypot(matrix.a, matrix.b) : 0;
  });
  const initialScale = await readScale();

  await expect(cache).toHaveAttribute('data-zoom-cache-state', 'ready');
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => cache.getAttribute('data-zoom-cache-state')).toBe('active');
  await expect(cache.locator('canvas')).toHaveCSS('opacity', '1');
  await page.waitForTimeout(220);
  const settledScale = await readScale();

  expect(Math.abs(settledScale - initialScale)).toBeGreaterThan(0.01);
  await expect(cache).toHaveAttribute('data-zoom-cache-state', 'ready');
  await expect(label).toBeVisible();
});

test('knowledge graph keeps zoom transforms on the HTML scene layer', async ({ page }) => {
  const canvas = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  const scene = page.locator('.knowledge-graph-view .kg-canvas-scene');
  const graph = canvas.locator(':scope > g');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -240);

  await expect.poll(() => scene.evaluate((element) => element.style.transform))
    .toContain('matrix(');
  await expect(graph).not.toHaveAttribute('transform');
});

test('knowledge graph renders one sustained scale gesture on canvas and restores the SVG afterwards', async ({ page }) => {
  const canvas = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  const scene = page.locator('.knowledge-graph-view .kg-canvas-scene');
  const cache = page.getByTestId('knowledge-graph-zoom-cache');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await expect(cache).toHaveAttribute('data-zoom-cache-state', 'ready');
  await page.evaluate(async ({ x, y }) => {
    const viewport = document.querySelector('.kg-canvas-scene')?.parentElement;
    if (!viewport) throw new Error('知识大盘缩放视口不存在。');
    for (let index = 0; index < 10; index += 1) {
      viewport.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        deltaY: -8,
      }));
      await new Promise((resolve) => window.setTimeout(resolve, 10));
    }
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });

  await expect.poll(() => cache.getAttribute('data-zoom-cache-state')).toBe('active');
  const buildMs = await cache.locator('canvas').getAttribute('data-build-ms');
  await expect(cache.locator('canvas')).toHaveCount(1);

  await page.evaluate(({ x, y }) => {
    const viewport = document.querySelector('.kg-canvas-scene')?.parentElement;
    viewport?.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      deltaY: -8,
    }));
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });
  await page.waitForTimeout(10);
  await expect.poll(() => scene.evaluate((element) => element.style.opacity)).toBe('0');
  await expect(cache.locator('canvas')).toHaveAttribute('data-build-ms', buildMs ?? '');
  await page.waitForTimeout(240);

  await expect(cache).toHaveAttribute('data-zoom-cache-state', 'ready');
  await expect(cache.locator('canvas')).toHaveCount(1);
  await expect.poll(() => scene.evaluate((element) => element.style.opacity)).toBe('');
  await expect.poll(() => scene.evaluate((element) => element.style.transform)).toContain('matrix(');
});

test('knowledge graph accelerates every sparse desktop wheel event', async ({ page }) => {
  const canvas = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  const cache = page.getByTestId('knowledge-graph-zoom-cache');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await expect(cache).toHaveAttribute('data-zoom-cache-state', 'ready');
  const states = await page.evaluate(async ({ x, y }) => {
    const viewport = document.querySelector('.kg-canvas-scene')?.parentElement;
    const layer = document.querySelector<HTMLElement>('[data-testid="knowledge-graph-zoom-cache"]');
    if (!viewport) throw new Error('知识大盘缩放视口不存在。');
    if (!layer) throw new Error('知识大盘 Canvas 不存在。');
    const wheel = () => viewport.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: y,
      deltaY: -100,
    }));
    const results: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      wheel();
      await new Promise((resolve) => window.setTimeout(resolve, 30));
      results.push(layer.dataset.zoomCacheState ?? '');
      await new Promise((resolve) => window.setTimeout(resolve, 170));
    }
    return results;
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });

  expect(states).toEqual(['active', 'active', 'active']);
  await expect(cache.locator('canvas')).toHaveCount(1);
  await expect(cache).toHaveAttribute('data-zoom-cache-state', 'ready');
});

test('knowledge graph keeps canvas active throughout continuous zoom-out', async ({ page }) => {
  const canvas = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  const cache = page.getByTestId('knowledge-graph-zoom-cache');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await expect(cache).toHaveAttribute('data-zoom-cache-state', 'ready');
  const states = await page.evaluate(async ({ x, y }) => {
    const viewport = document.querySelector('.kg-canvas-scene')?.parentElement;
    const layer = document.querySelector<HTMLElement>('[data-testid="knowledge-graph-zoom-cache"]');
    if (!viewport || !layer) throw new Error('知识大盘 Canvas 不存在。');
    const results: string[] = [];
    for (let index = 0; index < 30; index += 1) {
      viewport.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        deltaY: 20,
      }));
      await new Promise((resolve) => window.setTimeout(resolve, 16));
      results.push(layer.dataset.zoomCacheState ?? '');
    }
    return results;
  }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 });

  expect(states.slice(1).every((state) => state === 'active')).toBe(true);
  await page.waitForTimeout(240);
  await expect(cache).toHaveAttribute('data-zoom-cache-state', 'ready');
});

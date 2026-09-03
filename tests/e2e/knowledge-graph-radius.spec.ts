import { expect, test } from '@playwright/test';

const nodes = [
  { id: 'radius-root', name: '教育学', parentId: null, createdAt: 1 },
  { id: 'radius-level-1', name: '中国教育史', parentId: 'radius-root', createdAt: 2 },
  { id: 'radius-level-2', name: '中国近现代教育史', parentId: 'radius-level-1', createdAt: 3 },
  { id: 'radius-level-3', name: '南京国民政府时期教育制度', parentId: 'radius-level-2', createdAt: 4 },
  { id: 'radius-leaf', name: '南京国民政府时期教育制度与杨贤江', parentId: 'radius-level-3', createdAt: 5 },
];

test.beforeEach(async ({ page }) => {
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
  await page.getByLabel('视角归中').click();
  await expect(page.getByLabel('视角归中')).toBeHidden();
});

test('knowledge graph temporarily hides labels while the user is zooming', async ({ page }) => {
  const canvas = page.locator('.knowledge-graph-view svg[data-radius-mode]');
  const label = canvas.locator('[data-node-id="radius-leaf"] text');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();

  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width / 2 + 30, box!.y + box!.height / 2 + 30);
  await expect(label).toBeHidden();
  await page.mouse.up();
  await expect(label).toBeVisible();
});

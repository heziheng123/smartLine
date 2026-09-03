import { expect, test, type Page } from '@playwright/test';

const readTimelineData = async (page: Page) => page.evaluate(() => new Promise<{
  tasks?: Array<{ id: string; blocks: Array<{ id: string; header: { date?: string; deadline?: string } }> }>;
} | null>((resolve, reject) => {
  const openRequest = indexedDB.open('smart-timeline');
  openRequest.onerror = () => reject(openRequest.error);
  openRequest.onsuccess = () => {
    const database = openRequest.result;
    const transaction = database.transaction('timeline_data', 'readonly');
    const request = transaction.objectStore('timeline_data').get('smart-timeline-data');
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
  };
}));

const taskDates = async (page: Page) => {
  const data = await readTimelineData(page);
  const block = data?.tasks?.find((item) => item.id === 'map-project')?.blocks.find((item) => item.id === 'map-task');
  return { start: block?.header.date, end: block?.header.deadline };
};

const mapLifeStage = async (page: Page, name: string) => page.evaluate(async (stageName) => {
  const { useMindMapStore } = await import('/src/mindMap/testing.ts');
  const item = useMindMapStore.getState().document?.lifeMap?.lifeMapStages.find((stage) => stage.name === stageName && !stage.deletedAt);
  return item ? { id: item.id, start: item.start, end: item.end } : null;
}, name);

const fitCanvas = async (page: Page) => {
  await page.getByTestId('mind-map-layout-menu').click();
  await page.getByRole('menuitem', { name: '适合画布' }).click();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({
      tasks: [{
        id: 'map-project', name: 'Map Project', start: '2026-08-01', end: '2026-08-31', color: '#6366f1',
        blocks: [{
          type: 'smart-task', id: 'map-task', body: '',
          header: { title: 'Map Task', tag: 'Default', tagColor: '#6366f1', date: '2026-08-02', deadline: '2026-08-08', duration: 30, isCompleted: false },
        }],
      }],
      groups: [], notes: [], milestones: [],
    }));
    localStorage.setItem('line-life-map-storage-v1:mirror', JSON.stringify({
      lifeMapAreas: [{
        id: 'area-e2e', name: 'E2E 学习', color: '#6366f1', order: 0, planGroupId: 'learning',
        createdAt: '2026-08-01', updatedAt: '2026-08-01', revision: 1,
      }],
      lifeMapPlanGroups: [], lifeMapStages: [], lifeMapThemes: [], lifeMapGoals: [], lifeMapSystems: [],
      lifeMapSystemCheckIns: [], lifeMapEvents: [],
      lifeMapFocuses: [{
        id: 'focus-e2e', areaId: 'area-e2e', name: 'E2E 英语', start: '2026-08-01', end: '2026-08-31',
        createdAt: '2026-08-01', updatedAt: '2026-08-01', revision: 1,
      }],
      lifeMapNotes: [], lifeMapReviews: [],
    }));
  });
  await page.goto('/');
  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-canvas')).toBeVisible();
});

test('project task bars update canonical dates and offer compensation undo', async ({ page }) => {
  await page.getByRole('button', { name: '时间规划', exact: true }).click();
  const timeline = page.locator('[data-testid^="mind-map-timeline-"]').first();
  await timeline.click();
  for (const name of ['时间线开始日期', '时间线结束日期']) {
    const box = await page.getByLabel(name).boundingBox();
    expect(box?.width).toBeGreaterThan(70);
  }
  await page.getByLabel('时间线来源').selectOption('project:map-project');

  const taskBar = page.locator('[title^="Map Task ·"]').first();
  const box = await taskBar.boundingBox();
  if (!box) throw new Error('Task bar was not rendered.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();

  await expect(page.getByRole('status')).toContainText('项目任务日期已更新');
  await expect.poll(() => taskDates(page)).toEqual({ start: '2026-08-06', end: '2026-08-12' });

  await page.getByRole('button', { name: '撤销项目日期' }).click();
  await expect.poll(() => taskDates(page)).toEqual({ start: '2026-08-02', end: '2026-08-08' });

  const endHandle = page.getByRole('button', { name: '调整Map Task结束日期' });
  const handleBox = await endHandle.boundingBox();
  if (!handleBox) throw new Error('Task end handle was not rendered.');
  await page.mouse.move(handleBox.x + 2, handleBox.y + handleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(handleBox.x + 74, handleBox.y + handleBox.height / 2, { steps: 4 });
  await page.mouse.up();

  await expect.poll(() => taskDates(page)).toEqual({ start: '2026-08-02', end: '2026-08-11' });
});

test('moving or deleting a timeline never mutates its projected project data', async ({ page }) => {
  await page.getByRole('button', { name: '时间规划', exact: true }).click();
  const timeline = page.locator('[data-testid^="mind-map-timeline-"]').first();
  await timeline.click();
  await page.getByLabel('时间线来源').selectOption('project:map-project');
  const originalDates = await taskDates(page);
  const box = await timeline.boundingBox();
  if (!box) throw new Error('Timeline was not rendered.');

  await page.mouse.move(box.x + 32, box.y + 24);
  await page.mouse.down();
  await page.mouse.move(box.x + 132, box.y + 84, { steps: 5 });
  await page.mouse.up();
  await expect.poll(() => taskDates(page)).toEqual(originalDates);

  await timeline.click();
  await page.getByRole('button', { name: '删除时间线' }).click();
  await expect(timeline).toHaveCount(0);
  await expect.poll(() => taskDates(page)).toEqual(originalDates);
});

test('life map migration downloads a backup and creates stable timeline projections', async ({ page }) => {
  await page.getByLabel('更多操作', { exact: true }).click();
  page.once('dialog', (dialog) => dialog.accept());
  const download = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: '迁移人生地图' }).click();
  await expect((await download).suggestedFilename()).toMatch(/^smartline-life-map-backup-\d{4}-\d{2}-\d{2}\.json$/);

  await fitCanvas(page);
  await expect(page.getByTestId('mind-map-timeline-life-area:area-e2e')).toBeVisible();
  await page.getByLabel('更多操作', { exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '从旧人生地图恢复' })).toBeVisible();
});

test('map life planning supports CRUD, timeline editing, undo, manual selection, and reload persistence', async ({ page }) => {
  await page.getByRole('button', { name: '人生规划' }).click();
  const panel = page.getByRole('dialog', { name: '人生规划管理' });
  await expect(panel).toBeVisible();
  await panel.getByRole('button', { name: '新建人生阶段' }).click();
  await panel.getByLabel('名称').fill('地图人生阶段');
  await panel.getByLabel('人生领域', { exact: true }).selectOption({ label: '学习成长' });
  await panel.getByLabel('开始日期').fill('2026-08-10');
  await panel.getByLabel('结束日期').fill('2026-08-14');
  await panel.getByRole('button', { name: '保存' }).click();
  await expect(panel.getByRole('listitem').filter({ hasText: '地图人生阶段' })).toBeVisible();

  const row = panel.getByRole('listitem').filter({ hasText: '地图人生阶段' });
  await row.getByRole('button', { name: '编辑' }).click();
  await panel.getByLabel('名称').fill('地图人生阶段（已编辑）');
  await panel.getByRole('button', { name: '保存' }).click();
  await expect(panel.getByText('地图人生阶段（已编辑）', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '关闭人生规划' }).click();

  await page.getByRole('button', { name: '时间规划', exact: true }).click();
  const timeline = page.locator('[data-testid^="mind-map-timeline-"]').first();
  const timelineTestId = await timeline.getAttribute('data-testid');
  if (!timelineTestId) throw new Error('Timeline test id was not available.');
  await timeline.click();
  await page.getByLabel('时间线来源').selectOption('life:learning');

  const lifeBar = page.locator('[title^="地图人生阶段（已编辑） ·"]').first();
  const original = await mapLifeStage(page, '地图人生阶段（已编辑）');
  expect(original).toMatchObject({ start: '2026-08-10', end: '2026-08-14' });
  const box = await lifeBar.boundingBox();
  if (!box) throw new Error('Life planning bar was not rendered.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 100, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByRole('status')).toContainText('人生规划日期已更新');
  await expect.poll(() => mapLifeStage(page, '地图人生阶段（已编辑）')).not.toEqual(original);

  await page.getByTitle('撤销').click();
  await expect.poll(() => mapLifeStage(page, '地图人生阶段（已编辑）')).toEqual(original);

  await timeline.click();
  await page.getByLabel('时间线来源').selectOption('manual:');
  await page.getByText(/已选择 \d+ 项/).click();
  await page.getByLabel('Map Project · Map Task').check();
  await page.getByLabel('学习成长 · 地图人生阶段（已编辑）').check();
  await expect(page.locator('[title^="Map Task ·"]').first()).toBeVisible();
  await expect(page.locator('[title^="地图人生阶段（已编辑） ·"]').first()).toBeVisible();

  await page.evaluate(async () => {
    const { useMindMapStore } = await import('/src/mindMap/testing.ts');
    await useMindMapStore.getState().flushSave();
  });

  await page.reload();
  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-canvas')).toBeVisible();
  await expect.poll(() => mapLifeStage(page, '地图人生阶段（已编辑）')).toEqual(original);
  const restoredTimeline = page.getByTestId(timelineTestId);
  await restoredTimeline.click();
  await expect(page.getByLabel('时间线来源')).toHaveValue('manual:');
  await expect(page.getByLabel('Map Project · Map Task')).toBeChecked();
  await expect(page.getByLabel('学习成长 · 地图人生阶段（已编辑）')).toBeChecked();
});

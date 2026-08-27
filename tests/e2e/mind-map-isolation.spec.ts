import { expect, test, type Page } from '@playwright/test';

const businessSnapshot = async (page: Page) => page.evaluate(async () => {
  const {
    useDailyScheduleStore,
    useEbbStore,
    useGraphStore,
    useLifeMapStore,
    useTimelineStore,
  } = await import('/src/testing/workspaceStoreAccess.ts');
  const timeline = useTimelineStore.getState();
  const daily = useDailyScheduleStore.getState();
  const ebb = useEbbStore.getState();
  const graph = useGraphStore.getState();
  const lifeMap = useLifeMapStore.getState();
  return JSON.stringify({
    timeline: {
      tasks: timeline.tasks,
      groups: timeline.groups,
      notes: timeline.notes,
      milestones: timeline.milestones,
      lifeStages: timeline.lifeStages,
    },
    daily: { schedules: daily.schedules, retrospectives: daily.retrospectives },
    ebb: {
      reviewTasks: ebb.reviewTasks,
      inboxItems: ebb.inboxItems,
      outlineNodes: ebb.outlineNodes,
      ebbSettings: ebb.ebbSettings,
    },
    graph: { nodes: graph.nodes },
    lifeMap: {
      areas: lifeMap.areas,
      themes: lifeMap.themes,
      goals: lifeMap.goals,
      systems: lifeMap.systems,
      systemLogs: lifeMap.systemLogs,
      events: lifeMap.events,
      focuses: lifeMap.focuses,
      notes: lifeMap.notes,
      relations: lifeMap.relations,
      reviews: lifeMap.reviews,
    },
  });
});

const stableBusinessSnapshot = async (page: Page) => {
  let previous = await businessSnapshot(page);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    await page.waitForTimeout(100);
    const current = await businessSnapshot(page);
    if (current === previous) return current;
    previous = current;
  }
  return previous;
};

test('opening and closing the mind map leaves every existing business store unchanged', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
  const before = await stableBusinessSnapshot(page);

  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-workspace')).toBeVisible();
  await page.getByTestId('mind-map-new-document').click();
  await page.getByTestId('mind-map-title').fill('隔离性验证');
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');
  await page.getByTestId('mind-map-canvas').dblclick({ position: { x: 260, y: 200 } });
  await page.getByLabel('新节点文本').fill('只属于思维导图');
  await page.getByLabel('新节点文本').press('Enter');
  await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');
  await page.getByTitle('项目规划').click();
  await expect(page.getByTitle('项目规划')).toHaveAttribute('aria-selected', 'true');

  expect(await stableBusinessSnapshot(page)).toBe(before);
});

for (const viewport of [
  { name: '390px phone', width: 390, height: 844 },
  { name: '820px tablet', width: 820, height: 1180 },
  { name: '1440px desktop', width: 1440, height: 1000 },
]) {
  test(`${viewport.name} keeps every business store unchanged`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop-chromium');
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await page.goto('/');
    const before = await stableBusinessSnapshot(page);
  await page.getByTitle('地图工作区').click();
    await expect(page.getByTestId('mind-map-workspace')).toBeVisible();
    await page.getByTestId('mind-map-title').fill(`隔离验收 ${viewport.width}`);
    await expect(page.getByTestId('mind-map-save-status')).toHaveText('已保存');
    await page.getByTitle('项目规划').click();
    expect(await stableBusinessSnapshot(page)).toBe(before);
  });
}

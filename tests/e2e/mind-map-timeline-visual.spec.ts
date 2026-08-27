import { expect, test } from '@playwright/test';

test('timeline remains readable across annual, season, month, and week ranges', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chromium', 'Screenshot QA uses the desktop canvas.');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({
      tasks: [{
        id: 'visual-project', name: '2026 考研总规划', start: '2026-03-01', end: '2026-12-31', color: '#5b7cfa',
        blocks: [
          { type: 'smart-task', id: 'english', body: '', header: { title: '英语', tag: '', tagColor: '#48a078', date: '2026-03-01', deadline: '2026-09-30', isCompleted: true } },
          { type: 'smart-task', id: 'politics', body: '', header: { title: '政治', tag: '', tagColor: '#d99145', date: '2026-06-01', deadline: '2026-11-30', isCompleted: false } },
          { type: 'smart-task', id: 'major-333', body: '', header: { title: '333 专业课', tag: '', tagColor: '#c36a91', date: '2026-03-15', deadline: '2026-11-25', isCompleted: false } },
          { type: 'smart-task', id: 'math', body: '', header: { title: '数学分析', tag: '', tagColor: '#4f86c6', date: '2026-05-01', deadline: '2026-10-31', isCompleted: false } },
        ],
      }],
      groups: [], notes: [],
      milestones: [
        { id: 'visual-signup', name: '报名', date: '2026-08-20', relatedPlanId: 'visual-project', color: '#9a67c7' },
        { id: 'visual-exam', name: '初试', date: '2026-12-20', relatedPlanId: 'visual-project', color: '#9a67c7' },
      ],
    }));
  });
  await page.goto('/');
  await page.getByTitle('地图工作区').click();
  await expect(page.getByTestId('mind-map-canvas')).toBeVisible();

  await page.evaluate(async () => {
    const [{ useMindMapStore }, { createTimelineSection }, { createEmptyLifeMapData }] = await Promise.all([
      import('/src/mindMap/testing.ts'),
      import('/src/mindMap/model.ts'),
      import('/src/lifeMap/data.ts'),
    ]);
    const now = '2026-03-01T00:00:00.000Z';
    const meta = { createdAt: now, updatedAt: now, revision: 1 };
    const life = createEmptyLifeMapData();
    life.lifeMapAreas = [{ ...meta, id: 'visual-area', name: '学习成长', color: '#8b6bc2', order: 0, planGroupId: 'learning' }];
    life.lifeMapStages = [
      { ...meta, id: 'stage-foundation', name: '基础阶段', start: '2026-03-01', end: '2026-04-30', color: '#82a9d8', areaIds: ['visual-area'] },
      { ...meta, id: 'stage-intensive', name: '强化阶段', start: '2026-05-01', end: '2026-08-31', color: '#b08bc5', areaIds: ['visual-area'] },
      { ...meta, id: 'stage-sprint', name: '冲刺阶段', start: '2026-09-01', end: '2026-12-20', color: '#d69a74', areaIds: ['visual-area'] },
    ];
    const timeline = {
      ...createTimelineSection({ x: 0, y: 0 }, { id: 'timeline-visual', title: '2026 考研总规划' }),
      width: 980,
      height: 420,
      source: 'manual' as const,
      scale: 'week' as const,
      rangeStart: '2026-03-01',
      rangeEnd: '2026-12-31',
      manualItems: [
        { source: 'project' as const, contextId: 'visual-project', itemId: 'project:visual-project' },
        { source: 'project' as const, contextId: 'visual-project', itemId: 'task:visual-project:english' },
        { source: 'project' as const, contextId: 'visual-project', itemId: 'task:visual-project:politics' },
        { source: 'project' as const, contextId: 'visual-project', itemId: 'task:visual-project:major-333' },
        { source: 'project' as const, contextId: 'visual-project', itemId: 'task:visual-project:math' },
        { source: 'project' as const, contextId: 'visual-project', itemId: 'milestone:visual-signup' },
        { source: 'project' as const, contextId: 'visual-project', itemId: 'milestone:visual-exam' },
        { source: 'life' as const, contextId: 'visual-area', itemId: 'stage:stage-foundation' },
        { source: 'life' as const, contextId: 'visual-area', itemId: 'stage:stage-intensive' },
        { source: 'life' as const, contextId: 'visual-area', itemId: 'stage:stage-sprint' },
      ],
    };
    useMindMapStore.getState().execute('创建视觉验收时间线', (document) => ({
      ...document,
      lifeMap: life,
      timelineSections: { [timeline.id]: timeline },
      zOrder: [...document.zOrder.filter((id) => !document.timelineSections[id]), timeline.id],
      viewport: { x: 720, y: 480, scale: 0.86 },
    }));
  });

  const timeline = page.getByTestId('mind-map-timeline-timeline-visual');
  await expect(timeline).toBeVisible();
  await page.getByTitle('适合画布').click();
  await expect(timeline).toBeInViewport();
  const setZoom = async (target: number) => {
    const current = await page.evaluate(async () => {
      const { useMindMapStore } = await import('/src/mindMap/testing.ts');
      return useMindMapStore.getState().document?.viewport.scale ?? 1;
    });
    const box = await timeline.boundingBox();
    if (!box) throw new Error('Timeline left the viewport.');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, Math.log(current / target) / 0.0015);
    await expect.poll(async () => page.evaluate(async () => {
      const { useMindMapStore } = await import('/src/mindMap/testing.ts');
      return useMindMapStore.getState().document?.viewport.scale ?? 1;
    })).toBeCloseTo(target, 2);
  };
  await setZoom(0.86);
  const scenarios = [
    { name: 'annual', start: '2026-03-01', end: '2026-12-31', expected: ['Mar', 'Jun', 'Dec'] },
    { name: 'season', start: '2026-03-01', end: '2026-06-30', expected: ['Mar', 'Apr', 'Jun'] },
    { name: 'month', start: '2026-08-01', end: '2026-08-31', expected: ['1', '15', '31'] },
    { name: 'week', start: '2026-08-10', end: '2026-08-16', expected: ['Mon', 'Thu', 'Sun'] },
  ] as const;

  for (const scenario of scenarios) {
    await page.evaluate(({ start, end }) => {
      void import('/src/mindMap/testing.ts').then(({ useMindMapStore }) => {
        useMindMapStore.getState().execute('切换视觉验收范围', (document) => ({
          ...document,
          timelineSections: {
            ...document.timelineSections,
            'timeline-visual': { ...document.timelineSections['timeline-visual'], rangeStart: start, rangeEnd: end },
          },
        }));
      });
    }, scenario);
    for (const label of scenario.expected) await expect(timeline).toContainText(label);
    await page.screenshot({ path: `test-results/timeline-visual-${scenario.name}.png`, fullPage: true });
  }

  await page.evaluate(() => {
    void import('/src/mindMap/testing.ts').then(({ useMindMapStore }) => {
      useMindMapStore.getState().execute('切换语义缩放验收范围', (document) => ({
        ...document,
        timelineSections: {
          ...document.timelineSections,
          'timeline-visual': { ...document.timelineSections['timeline-visual'], rangeStart: '2026-08-01', rangeEnd: '2026-08-31' },
        },
      }));
    });
  });
  await expect(timeline).toContainText('31');
  await setZoom(0.68);
  await expect(timeline).toContainText('强化阶段');
  await expect(timeline).toContainText('报名');
  await expect(timeline.getByText('英语', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/timeline-visual-zoom-68.png', fullPage: true });

  await setZoom(0.4);
  await expect(timeline).toContainText('1 个项目 · 4 个任务');
});

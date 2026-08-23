import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1536, height: 1024 }, deviceScaleFactor: 1, timezoneId: 'Asia/Shanghai' });

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-21T08:00:00+08:00'));
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByTitle('人生地图').click();
  const template = page.getByRole('button', { name: '学习与生活平衡' });
  await template.waitFor({ state: 'visible' });
  await template.click();
  await expect(page.locator('.life-manuscript')).toBeVisible();
});

test('locks the 1536x1024 manuscript acceptance geometry', async ({ page }, testInfo) => {
  expect(await page.evaluate(() => window.devicePixelRatio)).toBe(1);

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)!.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    };
    const scroller = document.querySelector('.life-manuscript__scroller') as HTMLElement;
    const world = document.querySelector('.life-manuscript__world') as HTMLElement;
    return {
      manuscript: rect('.life-manuscript'),
      toolbar: rect('.life-manuscript__toolbar'),
      laneHeader: rect('.life-manuscript__sticky-headings'),
      worldFlowY: scroller.getBoundingClientRect().y + world.offsetTop,
      ruler: rect('.life-manuscript__ruler'),
      canvas: rect('.life-manuscript__categories'),
      annotations: rect('.life-manuscript__annotation-rail'),
    };
  });

  expect(geometry.manuscript.x).toBeCloseTo(0, 0);
  expect(geometry.manuscript.y).toBeCloseTo(0, 0);
  expect(geometry.manuscript.width).toBeCloseTo(1536, 0);
  expect(geometry.manuscript.height).toBeCloseTo(1024, 0);
  expect(geometry.toolbar.height).toBeCloseTo(79, 0);
  expect(geometry.laneHeader.x).toBeCloseTo(186, 0);
  expect(geometry.laneHeader.y).toBeCloseTo(79, 0);
  expect(geometry.laneHeader.width).toBeCloseTo(1066, 0);
  expect(geometry.laneHeader.height).toBeCloseTo(56, 0);
  expect(geometry.worldFlowY).toBeCloseTo(135, 0);
  expect(geometry.ruler.width).toBeCloseTo(186, 0);
  expect(geometry.canvas.x).toBeCloseTo(186, 0);
  expect(geometry.canvas.width).toBeCloseTo(1066, 0);
  expect(geometry.annotations.x).toBeCloseTo(1252, 0);
  expect(geometry.annotations.width).toBeCloseTo(284, 0);

  await page.screenshot({ path: testInfo.outputPath('life-manuscript-1536x1024.png') });
});

test('month view uses a continuous 37px daily time mapping', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '月', exact: true }).click();
  await expect(page.locator('.life-manuscript')).toHaveClass(/life-manuscript--month/);

  const mapping = await page.evaluate(() => {
    const top = (selector: string) => Number.parseFloat((document.querySelector(selector) as HTMLElement).style.top);
    return {
      day20: top('.life-manuscript__tick[data-date="2026-08-20"]'),
      day21: top('.life-manuscript__tick[data-date="2026-08-21"]'),
      today: top('.life-manuscript__today'),
      todayGrid: top('.life-manuscript__grid-lines i[data-date="2026-08-21"]'),
      event: top('.life-manuscript__ruler-events button[data-date="2026-08-24"]'),
      eventDay: top('.life-manuscript__tick[data-date="2026-08-24"]'),
    };
  });

  expect(mapping.day21 - mapping.day20).toBe(37);
  expect(mapping.today).toBe(mapping.day21);
  expect(mapping.todayGrid).toBe(mapping.day21);
  expect(mapping.event).toBe(mapping.eventDay);
  await expect(page.locator('.life-manuscript__tick[data-date="2026-08-21"]')).toContainText('21');

  await page.screenshot({ path: testInfo.outputPath('life-manuscript-month-37px-day.png') });
});

test('P0 key dates are editable and long-term systems expose current check-ins', async ({ page }) => {
  const event = page.locator('.life-manuscript__ruler-events button[data-date="2026-08-24"]');
  await event.click();
  const eventDrawer = page.getByRole('complementary', { name: /六级成绩公布关键日期检查器/ });
  await expect(eventDrawer).toContainText('2026-08-24');
  await eventDrawer.getByRole('button', { name: '编辑' }).click();
  const eventEditor = page.locator('.life-manuscript__editor').filter({ has: page.getByRole('heading', { name: '编辑关键日期' }) });
  await eventEditor.getByLabel('名称').fill('六级成绩正式公布');
  await eventEditor.getByRole('button', { name: '保存关键日期' }).click();
  await expect(page.locator('.life-manuscript__ruler-events')).toContainText('六级成绩正式公布');
  await page.getByRole('button', { name: '关闭关键日期详情' }).click();

  await page.getByRole('button', { name: '月', exact: true }).click();
  const system = page.locator('.life-manuscript__system-summaries button').filter({ hasText: '保持规律运动' });
  await expect(system).toContainText('本周 0/3');
  await system.click();
  const systemDrawer = page.getByRole('complementary', { name: '保持规律运动长期系统检查器' });
  await expect(systemDrawer).toContainText('本周 0/3');
  await systemDrawer.getByRole('button', { name: '+' }).click();
  await expect(systemDrawer.getByRole('group', { name: '保持规律运动今天打卡' })).toContainText('1');
  await expect(system).toContainText('本周 1/3');
});

test('P1 projections stay read-only while reviews and time notes are editable', async ({ page }) => {
  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    useTimelineStore.getState().addTask({
      id: 'p1-projection', name: '只读项目投影', start: '2026-08-18', end: '2026-08-28',
      color: '#2563EB', blocks: [],
      lifeMapProjection: { enabled: true, areaId: 'health', placement: 'above' },
    });
  });

  const projection = page.locator('[data-project-id="timeline-project:p1-projection"]');
  await expect(projection).toContainText('↗ 只读项目投影');
  await projection.click();
  const projectionActions = page.getByRole('dialog', { name: '只读项目投影快捷操作' });
  await expect(projectionActions).toContainText('项目规划投影');
  await expect(projectionActions.getByRole('button', { name: '完成' })).toHaveCount(0);
  await projectionActions.getByRole('button', { name: '详情' }).click();
  const projectionDrawer = page.getByRole('complementary', { name: '只读项目投影项目检查器' });
  await expect(projectionDrawer).toContainText('只读投影');
  await expect(projectionDrawer.getByRole('button', { name: '打开原项目' })).toBeVisible();
  await projectionDrawer.getByRole('button', { name: '关闭详情' }).click();

  await page.getByRole('button', { name: '更多人生地图选项' }).click();
  await page.getByRole('menuitem', { name: '新建周期复盘' }).click();
  const reviewEditor = page.locator('.life-map-editor').filter({ has: page.getByRole('heading', { name: '新建周期复盘' }) });
  await reviewEditor.getByLabel('本周期发生了什么').fill('完成了 P1 纵向视图迁移');
  await reviewEditor.getByLabel('下一周期如何调整').fill('继续保持只读投影边界');
  await reviewEditor.getByRole('button', { name: '保存' }).click();
  await page.getByRole('button', { name: '月', exact: true }).click();
  const reviewMarker = page.locator('.life-manuscript__ruler-reviews button').filter({ hasText: '2026年8月复盘' });
  await expect(reviewMarker).toBeVisible();
  await reviewMarker.click();
  const savedReview = page.locator('.life-map-editor').filter({ has: page.getByRole('heading', { name: '编辑周期复盘' }) });
  await expect(savedReview).toContainText('保存时快照');
  await savedReview.getByLabel('复盘标题').fill('八月阶段复盘');
  await savedReview.getByRole('button', { name: '保存' }).click();
  await expect(page.locator('.life-manuscript__ruler-reviews')).toContainText('八月阶段复盘');

  await page.getByRole('button', { name: '时间注记' }).click();
  const noteEditor = page.locator('.life-manuscript__editor').filter({ has: page.getByRole('heading', { name: '添加时间点注记' }) });
  await noteEditor.getByLabel('标题').fill('今天的判断');
  await noteEditor.getByLabel('关联人生计划').selectOption({ label: '考研备考' });
  await noteEditor.getByRole('button', { name: '保存' }).click();
  const note = page.locator('.life-manuscript__annotation').filter({ hasText: '今天的判断' });
  await note.click();
  await page.getByRole('dialog', { name: '今天的判断快捷操作' }).getByRole('button', { name: '编辑' }).click();
  const editingNote = page.locator('.life-manuscript__editor').filter({ has: page.getByRole('heading', { name: '编辑时间点注记' }) });
  await editingNote.getByLabel('标题').fill('今天的关键判断');
  await editingNote.getByRole('button', { name: '保存' }).click();
  const updatedNote = page.locator('.life-manuscript__annotation').filter({ hasText: '今天的关键判断' });
  await updatedNote.dblclick();
  const noteDrawer = page.getByRole('complementary', { name: '今天的关键判断时间注记检查器' });
  await expect(noteDrawer).toContainText('关联计划：考研备考');
  page.once('dialog', (dialog) => dialog.accept());
  await noteDrawer.getByRole('button', { name: '删除' }).click();
  await expect(updatedNote).toHaveCount(0);
});

test('P2 maintenance, batch shifting, archives and advanced filters share the existing workflows', async ({ page }) => {
  const archivedId = await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/testing/workspaceStoreAccess.ts');
    return useLifeMapStore.getState().addGoal({
      areaId: 'health', name: '已归档健康计划', start: '2026-08-18', targetDate: '2026-08-28',
      color: '#10B981', kind: 'plan', status: 'archived', progress: 100,
    }).id;
  });
  const archived = page.locator(`[data-project-id="${archivedId}"]`);
  await expect(archived).toHaveCount(0);
  await page.getByRole('button', { name: '更多人生地图选项' }).click();
  await page.getByRole('menuitem', { name: '显示归档内容' }).click();
  await expect(archived).toBeVisible();
  await expect(archived).toHaveClass(/is-archived/);

  await page.getByRole('button', { name: '更多人生地图选项' }).click();
  await page.getByRole('menuitem', { name: '高级筛选' }).click();
  const filters = page.getByRole('dialog', { name: '人生地图高级筛选' });
  await filters.getByRole('checkbox', { name: '人生计划' }).uncheck();
  await expect(page.locator('.life-manuscript__project-strip')).toHaveCount(0);
  await filters.getByRole('checkbox', { name: '人生计划' }).check();
  await expect(archived).toBeVisible();
  await filters.getByRole('button', { name: '关闭高级筛选' }).click();

  const project = page.locator('.life-manuscript__project-strip').filter({ hasText: '项目收尾' });
  await project.click();
  await page.getByRole('dialog', { name: '项目收尾快捷操作' }).getByRole('button', { name: '详情' }).click();
  const projectDrawer = page.getByRole('complementary', { name: '项目收尾项目检查器' });
  await projectDrawer.getByRole('button', { name: '进入维护' }).click();
  const projectMaintenance = page.locator('.life-map-resilience-dialog').filter({ hasText: '项目收尾' });
  await projectMaintenance.getByLabel('原因或说明').fill('降低近期负荷');
  await projectMaintenance.getByRole('button', { name: '开始维护' }).click();
  await expect(projectDrawer).toContainText('维护中');
  await expect(project).toHaveClass(/is-maintenance/);
  await projectDrawer.getByRole('button', { name: '结束维护' }).click();
  await page.locator('.life-map-resilience-dialog').filter({ hasText: '项目收尾' }).getByRole('button', { name: '唤醒，日期不变' }).click();
  await expect(project).not.toHaveClass(/is-maintenance/);
  await projectDrawer.getByRole('button', { name: '关闭详情' }).click();

  await page.getByRole('button', { name: '更多人生地图选项' }).click();
  await page.getByRole('menuitem', { name: '批量调整计划' }).click();
  const shift = page.locator('.life-map-shift-dialog');
  await shift.getByLabel('整体移动天数').fill('2');
  await shift.getByRole('checkbox', { name: /项目收尾/ }).check();
  await shift.getByRole('button', { name: '确认平移 2 天' }).click();
  await expect(page.locator('.life-map-shift-undo')).toContainText('已统一调整');

  await page.getByRole('button', { name: '更多人生地图选项' }).click();
  await page.getByRole('menuitem', { name: '高级筛选' }).click();
  await page.getByRole('dialog', { name: '人生地图高级筛选' }).locator('.life-manuscript__maintenance-filter button').filter({ hasText: '身体健康' }).click();
  const areaMaintenance = page.locator('.life-map-resilience-dialog').filter({ hasText: '身体健康' });
  await areaMaintenance.getByLabel('原因或说明').fill('身体恢复');
  await areaMaintenance.getByRole('button', { name: '开始维护' }).click();
  const system = page.locator('.life-manuscript__system-summaries button').filter({ hasText: '保持规律运动' });
  await expect(system).toContainText('维护中 · 不计失败');
  await system.click();
  const systemDrawer = page.getByRole('complementary', { name: '保持规律运动长期系统检查器' });
  await expect(systemDrawer.getByRole('group', { name: '保持规律运动今天打卡' })).toHaveCount(0);
  await systemDrawer.getByRole('button', { name: '结束领域维护' }).click();
  await page.locator('.life-map-resilience-dialog').filter({ hasText: '身体健康' }).getByRole('button', { name: '唤醒，日期不变' }).click();
  await expect(system).not.toContainText('维护中');
});

test('P3 classic map is a temporary fallback and never becomes the saved life map view', async ({ page }) => {
  await page.getByRole('button', { name: '更多人生地图选项' }).click();
  await page.getByRole('menuitem', { name: '经典人生地图' }).click();

  await expect(page.locator('.life-manuscript')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '返回人生地图' })).toBeVisible();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('life-map-view-mode-v14'))).toBeNull();

  await page.getByTitle('每日安排').click();
  await page.getByTitle('人生地图').click();
  await expect(page.locator('.life-manuscript')).toBeVisible();
  await expect(page.getByRole('button', { name: '返回人生地图' })).toHaveCount(0);
});

test('P4 life areas are managed directly from the vertical map menu', async ({ page }) => {
  await page.getByRole('button', { name: '更多人生地图选项' }).click();
  await page.getByRole('menuitem', { name: '管理人生领域' }).click();

  const areaManagement = page.getByRole('dialog', { name: '领域与分类' });
  await expect(areaManagement).toContainText('身体健康');
  await expect(areaManagement.getByRole('button', { name: '编辑身体健康' })).toBeVisible();
  await expect(areaManagement.getByRole('button', { name: '在生活下添加人生领域' })).toBeVisible();
  await expect(areaManagement.getByRole('button', { name: '生活移到下方' })).toHaveCount(0);
});

test('P5 weighted lanes resize locally without changing life map content', async ({ page }) => {
  const layout = () => page.evaluate(() => {
    const canvas = document.querySelector('.life-manuscript__categories')!.getBoundingClientRect();
    const widths = Object.fromEntries([...document.querySelectorAll<HTMLElement>('[data-manuscript-category]')].map((element) => [element.dataset.manuscriptCategory!, element.getBoundingClientRect().width]));
    return { canvas: canvas.width, widths };
  });
  const goalsBefore = await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/testing/workspaceStoreAccess.ts');
    return JSON.stringify(useLifeMapStore.getState().lifeMapGoals);
  });
  const before = await layout();
  const divider = page.getByRole('separator', { name: '调整学习和工作列宽' });
  const bounds = await divider.boundingBox();
  if (!bounds) throw new Error('学习和工作分隔线未渲染');
  const scrollerBounds = await page.locator('.life-manuscript__scroller').boundingBox();
  if (!scrollerBounds) throw new Error('人生地图画布未渲染');
  const dragY = scrollerBounds.y + Math.min(180, scrollerBounds.height / 2);
  await page.mouse.move(bounds.x + bounds.width / 2, dragY);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 700, dragY, { steps: 5 });
  await page.mouse.up();
  const resized = await layout();
  expect(resized.widths.learning).toBeGreaterThan(before.widths.learning);
  expect(resized.widths.work).toBeLessThan(before.widths.work);
  expect(resized.widths.life).toBeCloseTo(before.widths.life, 0);
  expect(Object.values(resized.widths).reduce((total, width) => total + width, 0)).toBeCloseTo(resized.canvas, 0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('life-map-manuscript-lane-weights-v1'))).not.toBeNull();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('life-map-manuscript-lane-weights-v1') ?? '{}') as Record<string, number>);
  expect(Object.values(stored).reduce((total, width) => total + width, 0)).toBeCloseTo(1, 5);
  Object.values(stored).forEach((width) => expect(width).toBeGreaterThanOrEqual(.18));
  Object.values(stored).forEach((width) => expect(width).toBeLessThanOrEqual(.65));
  await expect.poll(() => page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/testing/workspaceStoreAccess.ts');
    return JSON.stringify(useLifeMapStore.getState().lifeMapGoals);
  })).toBe(goalsBefore);

  await page.getByRole('button', { name: '学习分类布局选项' }).click();
  await page.getByRole('menu', { name: '学习分类布局选项' }).getByRole('menuitem', { name: '聚焦此领域' }).click();
  const focused = await layout();
  expect(focused.widths.learning / focused.canvas).toBeCloseTo(.5, 1);
  expect(focused.widths.work / focused.canvas).toBeCloseTo(.25, 1);
  expect(focused.widths.life / focused.canvas).toBeCloseTo(.25, 1);

  await page.getByRole('button', { name: '月', exact: true }).click();
  const month = await layout();
  expect(month.widths.learning / month.canvas).toBeCloseTo(.5, 1);
  await page.getByRole('button', { name: '学习分类布局选项' }).click();
  await page.getByRole('menu', { name: '学习分类布局选项' }).getByRole('menuitem', { name: '恢复均分' }).click();
  const restored = await layout();
  expect(restored.widths.learning / restored.canvas).toBeCloseTo(.33, 1);
  expect(restored.widths.work / restored.canvas).toBeCloseTo(.33, 1);
  expect(restored.widths.life / restored.canvas).toBeCloseTo(.34, 1);
});

test('P6 long project headers stick below category headings within their own date range', async ({ page }) => {
  const project = page.getByRole('button', { name: /政治，2026-08-18/ });
  const header = project.locator('.life-manuscript__project-strip-header');
  const scroller = page.locator('.life-manuscript__scroller');
  await page.getByRole('button', { name: '学习分类布局选项' }).click();
  await page.getByRole('menu', { name: '学习分类布局选项' }).getByRole('menuitem', { name: '聚焦此领域' }).click();
  const projectMetrics = await project.evaluate((element) => ({ top: Number.parseFloat((element as HTMLElement).style.top), height: element.getBoundingClientRect().height }));
  const headerHeight = await header.evaluate((element) => element.getBoundingClientRect().height);

  await scroller.evaluate((element, scrollTop) => { element.scrollTop = scrollTop; element.dispatchEvent(new Event('scroll')); }, projectMetrics.top + 96);
  await page.waitForTimeout(100);
  const pinned = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)!.getBoundingClientRect();
    const projectRect = document.querySelector('[data-project-id]')!.getBoundingClientRect();
    const headerRect = document.querySelector('[data-project-id] .life-manuscript__project-strip-header')!.getBoundingClientRect();
    const project = document.querySelector('[data-project-id]') as HTMLElement;
    return { headingBottom: rect('.life-manuscript__sticky-headings').bottom, projectBottom: projectRect.bottom, projectContentLeft: projectRect.left + project.clientLeft, projectContentRight: projectRect.left + project.clientLeft + project.clientWidth, projectContentWidth: project.clientWidth, headerTop: headerRect.top, headerBottom: headerRect.bottom, headerLeft: headerRect.left, headerRight: headerRect.right, headerWidth: headerRect.width };
  });
  expect(pinned.headerTop).toBeCloseTo(pinned.headingBottom, 0);
  expect(pinned.headerBottom).toBeLessThanOrEqual(pinned.projectBottom);
  expect(pinned.headerLeft).toBeCloseTo(pinned.projectContentLeft, 0);
  expect(pinned.headerRight).toBeCloseTo(pinned.projectContentRight, 0);
  expect(pinned.headerWidth).toBeCloseTo(pinned.projectContentWidth, 0);

  await scroller.evaluate((element, scrollTop) => { element.scrollTop = scrollTop; element.dispatchEvent(new Event('scroll')); }, projectMetrics.top + projectMetrics.height - headerHeight);
  await page.waitForTimeout(100);
  const pushed = await page.evaluate(() => {
    const projectRect = document.querySelector('[data-project-id]')!.getBoundingClientRect();
    const headerRect = document.querySelector('[data-project-id] .life-manuscript__project-strip-header')!.getBoundingClientRect();
    return { projectBottom: projectRect.bottom, headerBottom: headerRect.bottom };
  });
  expect(pushed.headerBottom).toBeGreaterThanOrEqual(pushed.projectBottom - 1);
  expect(pushed.headerBottom).toBeLessThanOrEqual(pushed.projectBottom);

  await scroller.evaluate((element, scrollTop) => { element.scrollTop = scrollTop; element.dispatchEvent(new Event('scroll')); }, projectMetrics.top + projectMetrics.height + 80);
  await page.waitForTimeout(100);
  await expect(header).not.toBeInViewport();
});

test('stage layer spans the full timeline canvas and clips to the viewport', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '月', exact: true }).click();
  const stages = page.locator('.life-manuscript__stage-layer .life-manuscript__stage');
  await expect(stages).toHaveCount(1);

  const geometry = await page.evaluate(() => {
    const canvas = document.querySelector('.life-manuscript__categories')!.getBoundingClientRect();
    const items = [...document.querySelectorAll('.life-manuscript__stage-layer .life-manuscript__stage')].map((element) => {
      const bounds = element.getBoundingClientRect();
      const label = element.querySelector('.life-manuscript__stage-label') as HTMLElement;
      return {
        left: bounds.left,
        right: bounds.right,
        top: bounds.top,
        labelBackground: getComputedStyle(label).backgroundColor,
        originalTop: Number((element as HTMLElement).dataset.startY),
        renderedTop: Number.parseFloat((element as HTMLElement).style.top),
      };
    });
    return { canvas: { left: canvas.left, right: canvas.right }, items };
  });

  for (const stage of geometry.items) {
    expect(stage.left).toBeCloseTo(geometry.canvas.left + 29, 0);
    expect(stage.right).toBeCloseTo(geometry.canvas.right - 31, 0);
    expect(stage.top).toBeCloseTo(135, 0);
    expect(stage.labelBackground).toBe('rgba(0, 0, 0, 0)');
    expect(stage.renderedTop).toBeGreaterThan(stage.originalTop);
  }
  await expect(page.locator('.life-manuscript__stage-visible-top')).toHaveCount(0);
  const focus = page.locator('.life-manuscript__focus-range');
  await expect(focus).toHaveCount(1);
  const focusGeometry = await focus.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    const canvas = document.querySelector('.life-manuscript__categories')!.getBoundingClientRect();
    return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, canvasLeft: canvas.left, canvasRight: canvas.right };
  });
  expect(focusGeometry.left).toBeCloseTo(focusGeometry.canvasLeft + 49, 0);
  expect(focusGeometry.right).toBeCloseTo(focusGeometry.canvasRight - 60, 0);
  expect(focusGeometry.top).toBeCloseTo(217, 0);
  expect(focusGeometry.bottom).toBeCloseTo(1019, 0);
  await page.screenshot({ path: testInfo.outputPath('life-manuscript-stage-layer.png') });
});

test('project ranges use narrow ink bars without card styling', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '月', exact: true }).click();
  const bars = page.locator('.life-manuscript__track-capsule');
  await expect(bars).toHaveCount(6);

  const presentation = await bars.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const title = element.querySelector('b') as HTMLElement;
    const start = element.querySelector('small') as HTMLElement;
    const end = element.querySelector('em') as HTMLElement;
    return {
      width: bounds.width,
      shadow: style.boxShadow,
      borderWidth: style.borderTopWidth,
      title: title.textContent,
      titleAlign: getComputedStyle(title).textAlign,
      wordBreak: getComputedStyle(title).wordBreak,
      start: start.textContent,
      end: end.textContent,
    };
  }));

  for (const bar of presentation) {
    expect(bar.width).toBeGreaterThanOrEqual(72);
    expect(bar.width).toBeLessThanOrEqual(88);
    expect(bar.shadow).toBe('none');
    expect(bar.borderWidth).toBe('1px');
    expect(bar.titleAlign).toBe('center');
    expect(bar.wordBreak).toBe('keep-all');
    expect(bar.start).toMatch(/^\d{2}-\d{2}$/);
    expect(bar.end).toMatch(/^\d{2}-\d{2}$/);
  }

  const parentGroup = page.locator('.life-manuscript__project-group').first();
  await expect(parentGroup).toBeVisible();
  expect(await parentGroup.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe('0px');
  expect(await page.locator('.life-manuscript__project-heading').first().evaluate((element) => getComputedStyle(element).backgroundColor)).toBe('rgba(0, 0, 0, 0)');

  await page.screenshot({ path: testInfo.outputPath('life-manuscript-project-ranges.png') });
});

test('ruler, month boundaries, events and today share one visible time axis', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '月', exact: true }).click();
  await page.getByRole('button', { name: '定位到今天' }).click();
  await page.waitForTimeout(500);

  const geometry = await page.evaluate(() => {
    const screenY = (selector: string) => document.querySelector(selector)!.getBoundingClientRect().y;
    const styleTop = (selector: string) => Number.parseFloat((document.querySelector(selector) as HTMLElement).style.top);
    const todayLine = document.querySelector('.life-manuscript__today')!.getBoundingClientRect();
    const rail = document.querySelector('.life-manuscript__annotation-rail')!.getBoundingClientRect();
    const todayLabel = document.querySelector('.life-manuscript__tick[data-date="2026-08-21"] .life-manuscript__tick-today-label')!.getBoundingClientRect();
    const monthTick = document.querySelector('.life-manuscript__tick[data-date="2026-09-01"]') as HTMLElement;
    const event = document.querySelector('.life-manuscript__ruler-events button[data-date="2026-08-24"]') as HTMLElement;
    const eventText = event.querySelector('span') as HTMLElement;
    return {
      viewportHeight: window.innerHeight,
      todayLineY: todayLine.y,
      todayLineRight: todayLine.right,
      railLeft: rail.left,
      todayLabelCenter: todayLabel.y + todayLabel.height / 2,
      headerBackground: getComputedStyle(document.querySelector('.life-manuscript__ruler header')!).backgroundColor,
      day15Tick: styleTop('.life-manuscript__tick[data-date="2026-08-15"]'),
      day15Grid: styleTop('.life-manuscript__grid-lines i[data-date="2026-08-15"]'),
      monthTick: Number.parseFloat(monthTick.style.top),
      monthGrid: styleTop('.life-manuscript__grid-lines i[data-date="2026-09-01"]'),
      monthLabel: monthTick.querySelector('.life-manuscript__month-boundary')?.textContent,
      eventY: styleTop('.life-manuscript__ruler-events button[data-date="2026-08-24"]'),
      eventDayY: styleTop('.life-manuscript__tick[data-date="2026-08-24"]'),
      eventTextFits: eventText.scrollWidth <= eventText.clientWidth,
      firstVisibleDayY: screenY('.life-manuscript__tick[data-date="2026-08-15"]'),
    };
  });

  expect(geometry.todayLineY / geometry.viewportHeight).toBeGreaterThanOrEqual(.35);
  expect(geometry.todayLineY / geometry.viewportHeight).toBeLessThanOrEqual(.45);
  expect(geometry.todayLineRight).toBeCloseTo(geometry.railLeft, 0);
  expect(geometry.todayLabelCenter).toBeCloseTo(geometry.todayLineY, 0);
  expect(geometry.headerBackground).toBe('rgb(255, 255, 255)');
  expect(geometry.day15Tick).toBe(geometry.day15Grid);
  expect(geometry.monthTick).toBe(geometry.monthGrid);
  expect(geometry.monthLabel).toBe('09月');
  expect(geometry.eventY).toBe(geometry.eventDayY);
  expect(geometry.eventTextFits).toBe(true);
  expect(geometry.firstVisibleDayY).toBeGreaterThan(130);
  expect(geometry.firstVisibleDayY).toBeLessThan(190);

  await page.screenshot({ path: testInfo.outputPath('life-manuscript-ruler-today.png') });
});

test('fidelity shell and manuscript annotations avoid dashboard chrome', async ({ page }, testInfo) => {
  await page.getByRole('button', { name: '月', exact: true }).click();
  await page.getByRole('button', { name: '定位到今天' }).click();
  await page.waitForTimeout(500);

  await expect(page.locator('.life-manuscript__more')).toHaveCount(0);
  await expect(page.locator('.life-manuscript__sticky-headings small')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '定位到今天' }).locator('svg')).toHaveCount(0);

  const shell = await page.evaluate(() => {
    const create = document.querySelector('.life-manuscript__commands > button')!.getBoundingClientRect();
    const selectedZoom = document.querySelector('.life-manuscript__zoom button[aria-pressed="true"]') as HTMLElement;
    const manuscript = document.querySelector('.life-manuscript') as HTMLElement;
    return {
      createX: create.x,
      createHeight: create.height,
      selectedBackground: getComputedStyle(selectedZoom).backgroundColor,
      fontFamily: getComputedStyle(manuscript).fontFamily,
    };
  });

  expect(shell.createX).toBeGreaterThanOrEqual(395);
  expect(shell.createX).toBeLessThanOrEqual(415);
  expect(shell.createHeight).toBeCloseTo(42, 0);
  expect(shell.selectedBackground).toBe('rgb(255, 255, 255)');
  expect(shell.fontFamily).toContain('Noto Serif SC');

  const annotations = page.locator('.life-manuscript__annotation');
  await expect(annotations).toHaveCount(4);
  const annotationPresentation = await annotations.evaluateAll((elements) => elements.map((element) => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      top: bounds.top,
      bottom: bounds.bottom,
      width: bounds.width,
      background: style.backgroundColor,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
    };
  }).sort((a, b) => a.top - b.top));

  for (const annotation of annotationPresentation) {
    expect(annotation.width).toBeLessThanOrEqual(216);
    expect(annotation.background).toBe('rgba(0, 0, 0, 0)');
  }
  for (let index = 1; index < annotationPresentation.length; index += 1) {
    expect(annotationPresentation[index].top).toBeGreaterThanOrEqual(annotationPresentation[index - 1].bottom);
  }

  const globalRange = page.getByRole('button', { name: /连续几天状态很好/ });
  await expect(globalRange.locator('b')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /英语进入冲刺阶段/ }).locator('b')).toHaveCount(1);
  expect(await page.locator('.life-manuscript__annotation[data-annotation-kind="single"]').first().evaluate((element) => Number.parseFloat((element as HTMLElement).style.left))).toBe(60);
  expect(await page.locator('.life-manuscript__single-note-marker circle:last-child').first().getAttribute('cx')).toBe('30');

  await page.screenshot({ path: testInfo.outputPath('life-manuscript-fidelity-annotations.png') });

  await page.getByRole('button', { name: '更多人生地图选项' }).click();
  await page.getByRole('menuitem', { name: '经典人生地图' }).click();
  await expect(page.locator('.life-manuscript')).toHaveCount(0);
});

test('dragging a category canvas range offers project, stage and annotation creation', async ({ page }) => {
  await page.getByRole('button', { name: '定位到今天' }).click();
  await page.waitForTimeout(500);

  const startDate = '2027-02-01';
  const endDate = '2027-02-04';
  const scroller = page.locator('.life-manuscript__scroller');
  await scroller.evaluate((element) => {
    const todayY = Number.parseFloat((document.querySelector('.life-manuscript__today') as HTMLElement).style.top);
    element.scrollTop = todayY + 164 * 58 - element.clientHeight / 3;
    element.dispatchEvent(new Event('scroll'));
  });

  const start = page.locator(`.life-manuscript__tick[data-date="${startDate}"]`);
  const end = page.locator(`.life-manuscript__tick[data-date="${endDate}"]`);
  const startY = await start.evaluate((element) => element.getBoundingClientRect().y);
  const endY = await end.evaluate((element) => element.getBoundingClientRect().y);
  expect(startY).toBeGreaterThan(135);
  expect(endY).toBeLessThan(1024);
  const learningCanvas = page.locator('[data-manuscript-category="learning"]');
  const learningBounds = await learningCanvas.boundingBox();
  if (!learningBounds) throw new Error('Learning canvas is not visible');
  const canvasX = learningBounds.x + learningBounds.width - 12;

  await page.mouse.move(canvasX, startY);
  await page.mouse.down();
  await page.mouse.move(canvasX, endY, { steps: 4 });
  await page.mouse.up();

  const menu = page.getByRole('dialog', { name: '在学习创建内容' });
  await expect(menu).toContainText('02-01 — 02-04');
  await expect(menu.getByRole('button', { name: '新建项目' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '新建阶段' })).toBeVisible();
  await expect(menu.getByRole('button', { name: '新建批注' })).toBeVisible();
  await menu.getByRole('button', { name: '新建批注' }).click();

  const editor = page.locator('.life-manuscript__editor');
  await expect(editor).toBeVisible();
  await expect(editor.locator('input[type="date"]').nth(0)).toHaveValue(startDate);
  await expect(editor.locator('input[type="date"]').nth(1)).toHaveValue(endDate);
  await expect(editor.getByLabel('关联分类')).toHaveValue('learning');
  await editor.getByLabel('标题').fill('分类画布范围批注');
  await editor.getByRole('button', { name: '保存批注' }).click();

  const saved = await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const state = useLifeMapStore.getState();
    const note = state.lifeMapNotes.find((item) => item.name === '分类画布范围批注');
    const area = state.lifeMapAreas.find((item) => item.id === note?.areaId);
    return { categoryId: area?.planGroupId, startDate: note?.date, endDate: note?.endDate };
  });
  expect(saved).toEqual({ categoryId: 'learning', startDate, endDate });
});

test('system check-ins default to the user local calendar date', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-08-21T00:30:00+08:00'));
  const date = await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/testing/workspaceStoreAccess.ts');
    const store = useLifeMapStore.getState();
    store.addSystem({ id: 'local-date-system', areaId: 'health', name: '本地日期打卡', start: '2026-08-01', frequency: 'daily', targetCount: 1 });
    return store.addSystemCheckIn('local-date-system').date;
  });

  expect(date).toBe('2026-08-21');
});

test('narrow manuscript toolbar keeps grouped actions compact and fully reachable', async ({ page }) => {
  await page.setViewportSize({ width: 752, height: 898 });
  await page.waitForFunction(() => Math.round(document.querySelector('.life-manuscript__toolbar')!.getBoundingClientRect().height) === 58);

  const geometry = await page.evaluate(() => {
    const rect = (selector: string) => {
      const bounds = document.querySelector(selector)!.getBoundingClientRect();
      return { left: bounds.left, right: bounds.right, width: bounds.width, height: bounds.height };
    };
    const commands = [...document.querySelectorAll('.life-manuscript__commands button')].map((element) => ({
      text: element.textContent?.trim(),
      label: element.getAttribute('aria-label') ?? element.getAttribute('title'),
      display: getComputedStyle(element).display,
      height: element.getBoundingClientRect().height,
    }));
    return {
      toolbar: rect('.life-manuscript__toolbar'),
      zoom: rect('.life-manuscript__zoom button'),
      more: rect('.life-manuscript__more'),
      commands,
      title: document.querySelector('.life-manuscript__brand h1')?.textContent,
      groups: [...document.querySelectorAll('.life-manuscript__command-group')].map((element) => getComputedStyle(element).display),
    };
  });

  expect(geometry.toolbar.height).toBe(58);
  expect(geometry.zoom.height).toBe(30);
  expect(geometry.title).toBe('人生地图');
  expect(geometry.groups).toEqual(['flex', 'flex', 'flex']);
  expect(geometry.commands.find((item) => item.text === '新建阶段')?.height).toBe(32);
  expect(geometry.commands.find((item) => item.text === '添加项目')?.display).toBe('flex');
  expect(geometry.commands.find((item) => item.label === '添加关键日期')?.height).toBe(32);
  expect(geometry.commands.find((item) => item.text === '今天')?.height).toBe(32);
  expect(geometry.commands.find((item) => item.label === '更多人生地图选项')?.display).toBe('flex');
  expect(geometry.more.right).toBeLessThanOrEqual(geometry.toolbar.right);
});

import { expect, test, type Page } from '@playwright/test';

const setLifeMapZoom = async (page: Page, zoom: 'year' | 'month' | 'week' | 'day') => {
  const label = { year: '年视图', month: '月视图', week: '周视图', day: '日视图' }[zoom];
  await page.getByRole('combobox', { name: '时间尺度' }).click();
  await page.getByRole('option', { name: new RegExp(`^${label}`) }).click();
};

const selectLifeMapArea = async (page: Page, areaName = '学习成长') => {
  await page.locator('.life-map-scope__trigger').click();
  await page.getByRole('menu', { name: '选择人生领域' }).getByRole('menuitemradio', { name: new RegExp(areaName) }).click();
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('life-map-e2e-seeded') === '1') return;
    localStorage.clear();
    localStorage.setItem('life-map-e2e-seeded', '1');
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify({
      groups: [{
        id: 'exam-group',
        name: '升学考试',
        start: '2026-07-01',
        end: '2027-12-31',
        color: '#5B6AF0',
        autoDate: true,
        children: [],
      }],
      tasks: [{
        id: 'graduate-exam',
        name: '2027考研',
        start: '2026-07-01',
        end: '2027-12-31',
        color: '#5B6AF0',
        groupId: 'exam-group',
        isMain: true,
        blocks: [
          {
            type: 'smart-task',
            id: 'marxism-one',
            header: {
              title: '完成马原第一章',
              tag: '考研政治',
              tagColor: '#5B6AF0',
              date: '2026-08-04',
              deadline: '2026-08-09',
              duration: 180,
              isCompleted: false,
            },
            body: '',
          },
          {
            type: 'smart-task',
            id: 'english-reading',
            header: {
              title: '英语真题阅读2篇',
              tag: '考研英语',
              tagColor: '#6FA3A0',
              date: '2026-08-06',
              duration: 120,
              isCompleted: false,
            },
            body: '',
          },
          {
            type: 'smart-task',
            id: 'politics-review',
            header: {
              title: '政治知识点复盘',
              tag: '考研政治',
              tagColor: '#EC4899',
              date: '2026-08-06',
              duration: 60,
              isCompleted: false,
            },
            body: '',
          },
        ],
      }, {
        id: 'phase-a',
        name: 'Phase A',
        start: '2026-01-01',
        end: '2026-03-31',
        color: '#7C6FE6',
        groupId: 'exam-group',
        blocks: [],
      }, {
        id: 'phase-overlap',
        name: 'Overlap',
        start: '2026-03-01',
        end: '2026-05-31',
        color: '#EC4899',
        groupId: 'exam-group',
        blocks: [],
      }, {
        id: 'phase-b',
        name: 'Phase B',
        start: '2026-04-01',
        end: '2026-06-30',
        color: '#36B997',
        groupId: 'exam-group',
        blocks: [],
      }, {
        id: 'phase-overlap-2',
        name: 'Overlap 2',
        start: '2026-03-01',
        end: '2026-05-31',
        color: '#D97706',
        groupId: 'exam-group',
        blocks: [],
      }, {
        id: 'phase-overlap-3',
        name: 'Overlap 3',
        start: '2026-03-01',
        end: '2026-05-31',
        color: '#0EA5E9',
        groupId: 'exam-group',
        blocks: [],
      }],
      notes: [
        { id: 'physical-exam', name: '年度体检', date: '2026-08-22', type: 'pin', color: '#6FA3A0' },
        { id: 'focus-a', name: '本周重点\n马原复习\n英语错题\n政治背诵\n周末复盘', date: '2026-08-05', endDate: '2026-08-12', type: 'range', color: '#7C6FE6', placement: 'below' },
        { id: 'focus-b', name: '复习安排', date: '2026-08-10', endDate: '2026-08-15', type: 'range', color: '#22C55E', placement: 'below' },
        { id: 'summer-focus', name: '暑期备考主线', date: '2026-07-01', endDate: '2026-09-30', type: 'range', color: '#5B6AF0', placement: 'above' },
        { id: 'week-plan-a', name: '第一周重点\n完成基础复习', date: '2026-09-01', endDate: '2026-09-07', type: 'range', color: '#7C6FE6', placement: 'below' },
        { id: 'week-plan-b', name: '第二周重点\n整理错题', date: '2026-09-08', endDate: '2026-09-14', type: 'range', color: '#5B6AF0', placement: 'below' },
        { id: 'week-plan-c', name: '第三周重点\n阶段复盘', date: '2026-09-15', endDate: '2026-09-21', type: 'range', color: '#22C55E', placement: 'below' },
      ],
      milestones: [
        { id: 'cet-result', name: '六级成绩公布', date: '2026-08-15', color: '#D09A43', placement: 'above' },
        { id: 'cet-certificate', name: '六级证书申请', date: '2026-08-15', color: '#D09A43', placement: 'above' },
        { id: 'mock-exam', name: '阶段模拟考试', date: '2026-09-30', color: '#94A3B8', placement: 'below', importance: 'normal' },
      ],
      lifeStages: [{ id: 'exam-stage', name: '考研准备期', start: '2026-06-01', end: '2027-12-31', color: '#7C6FE6' }],
    }));
    const legacy = JSON.parse(localStorage.getItem('smart-timeline-data:mirror') ?? '{}') as {
      tasks: Array<{ id: string; name: string; start: string; end: string; color?: string }>;
      notes: Array<{ id: string; name: string; date: string; endDate?: string; type: 'pin' | 'range'; color?: string; placement?: 'above' | 'below' }>;
      milestones: Array<{ id: string; name: string; date: string; color?: string; placement?: 'above' | 'below'; importance?: 'normal' | 'important' | 'core' }>;
      lifeStages: Array<{ id: string; name: string; start: string; end: string; color?: string }>;
    };
    const synced = { createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', revision: 1 };
    localStorage.setItem('line-life-map-storage-v1:mirror', JSON.stringify({
      lifeMapAreas: [{ id: 'learning', name: '学习成长', color: '#6366F1', icon: '学', order: 1, ...synced }],
      lifeMapStages: legacy.lifeStages.map((item) => ({ ...item, ...synced })),
      lifeMapThemes: [],
      lifeMapGoals: [{ id: 'study-plan', areaId: 'learning', name: '备战研究生考试', start: '2026-07-01', targetDate: '2027-12-31', status: 'active', isCore: true, progress: 18, ...synced }, ...legacy.tasks.map((item) => ({
        id: item.id,
        areaId: 'learning',
        name: item.name,
        start: item.start,
        targetDate: item.end,
        color: item.color,
        status: 'active',
        progress: 0,
        kind: item.id === 'graduate-exam' ? 'plan' : 'phase',
        parentGoalId: item.id === 'graduate-exam' ? undefined : 'graduate-exam',
        ...synced,
      }))],
      lifeMapSystems: [{ id: 'study-rhythm', areaId: 'learning', name: '保持稳定复习', start: '2026-07-01', status: 'active', frequency: 'daily', targetCount: 1, durationMinutes: 60, ...synced }],
      lifeMapSystemCheckIns: [{ id: 'rhythm-check', systemId: 'study-rhythm', date: '2026-07-30', count: 1, ...synced }],
      lifeMapEvents: legacy.milestones.map((item) => ({ ...item, areaId: 'learning', importance: item.importance ?? 'important', ...synced })),
      lifeMapFocuses: legacy.notes.filter((item) => item.type === 'range' && item.endDate).map((item) => ({ id: item.id, areaId: 'learning', name: item.name, start: item.date, end: item.endDate, color: item.color, placement: item.placement, ...synced })),
      lifeMapNotes: legacy.notes.filter((item) => item.type === 'pin').map((item) => ({ ...item, areaId: 'learning', ...synced })),
      lifeMapRelations: [],
      lifeMapReviews: [],
    }));
  });
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
});

test('life map renders independent goals, systems and fixed events without project tasks', async ({ page }) => {
  await page.getByTitle('人生地图').click();

  const goalMark = page.getByRole('button', { name: /目标：备战研究生考试/ });
  await expect(goalMark).toBeVisible();
  await expect(goalMark).toHaveClass(/life-line__anchor/);
  await expect(goalMark).toHaveAttribute('aria-label', /完成18%/);
  await expect(page.locator('.life-line__node.is-goal')).toHaveCount(0);
  await expect(page.locator('.life-line__project-band.is-life-goal')).toHaveCount(0);
  await expect(page.locator('.life-line__anchor.is-goal').first()).toBeVisible();
  await expect(page.locator('.life-line__node.is-project')).toHaveCount(0);
  const fixedEvent = page.locator('.life-line__node.is-milestone').filter({ hasText: '六级成绩公布' });
  await expect(fixedEvent).toBeVisible();
  await expect(fixedEvent).toHaveClass(/is-importance-important/);
  await expect(page.locator('.life-line__node.is-action')).toHaveCount(0);
  await expect(page.getByLabel('每日任务节奏带')).toHaveCount(0);
  await expect(page.locator('.life-line__task-marker')).toHaveCount(0);
  await expect(page.locator('.life-line__project-band.is-life-system')).toBeVisible();
  await expect(page.locator('.life-map-system-strip').getByRole('button', { name: /保持稳定复习/ })).toBeVisible();

  await setLifeMapZoom(page, 'day');
  const todayPosition = await page.locator('.life-line__today').evaluate((element) => {
    const line = element.getBoundingClientRect();
    const viewport = element.closest('.life-line__scroller')?.getBoundingClientRect();
    return { left: line.left, viewportLeft: viewport?.left ?? 0, viewportRight: viewport?.right ?? 0 };
  });
  expect(todayPosition.left).toBeGreaterThan(todayPosition.viewportLeft + 150);
  expect(todayPosition.left).toBeLessThan(todayPosition.viewportRight);
  expect(await page.locator('.life-line__tick').count()).toBeLessThan(300);

  await setLifeMapZoom(page, 'month');
  await goalMark.click();
  await expect(page.locator('.life-map-editor form').getByRole('heading', { name: '编辑目标' })).toBeVisible();
});

test('month and week views keep systems visible while month uses a compact rail', async ({ page }) => {
  await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    const synced = { createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', revision: 1 };
    useLifeMapStore.setState({
      lifeMapGoals: [{ id: 'compact-plan', areaId: 'learning', name: '下方可见主计划', kind: 'plan', start: '2026-08-01', targetDate: '2026-12-31', status: 'active', progress: 10, placement: 'below', ...synced }],
      lifeMapSystems: [{ id: 'hidden-system', areaId: 'learning', name: '月视图隐藏系统', start: '2026-01-01', status: 'active', frequency: 'daily', targetCount: 1, durationMinutes: 30, placement: 'below', ...synced }],
    });
  });
  await page.getByTitle('人生地图').click();

  const plan = page.locator('[data-project-id="goal:compact-plan"]');
  const system = page.locator('.life-line__project-band.is-life-system');
  await expect(system).toBeVisible();
  await expect(system).toHaveCSS('height', '14px');
  await expect(plan).toHaveAttribute('data-band-level', '1');

  await setLifeMapZoom(page, 'week');
  await expect(system).toBeVisible();
  await expect(system).toHaveCSS('height', '21px');
  await expect(plan).toHaveAttribute('data-band-level', '1');

  await setLifeMapZoom(page, 'month');
  await expect(system).toBeVisible();
  await expect(plan).toHaveAttribute('data-band-level', '1');
});

test('life map keeps fixed events separate from movable actions', async ({ page }) => {
  await page.getByTitle('人生地图').click();

  const milestone = page.locator('.life-line__node.is-milestone').filter({ hasText: '六级成绩公布' });
  await expect(milestone).toBeVisible();
  await expect(page.locator('.life-line__node.is-action').filter({ hasText: '六级成绩公布' })).toHaveCount(0);
  await setLifeMapZoom(page, 'week');
  await expect(milestone).toHaveCSS('height', '48px');
  const milestoneTextBounds = await milestone.evaluate((element) => {
    const card = element.getBoundingClientRect();
    const subtitle = element.querySelector('small')?.getBoundingClientRect();
    return { cardBottom: card.bottom, subtitleBottom: subtitle?.bottom ?? card.bottom };
  });
  expect(milestoneTextBounds.subtitleBottom).toBeLessThanOrEqual(milestoneTextBounds.cardBottom + 0.5);
  const [milestoneBox, stageRailBox] = await Promise.all([
    milestone.boundingBox(),
    page.locator('.life-line__stage-rail').boundingBox(),
  ]);
  expect(milestoneBox && stageRailBox).toBeTruthy();
  if (!milestoneBox || !stageRailBox) return;
  expect(milestoneBox.y).toBeGreaterThanOrEqual(stageRailBox.y + stageRailBox.height + 8);
});

test('life map stacks same-day milestones on one shared leader and one axis anchor', async ({ page }) => {
  await page.getByTitle('人生地图').click();

  const first = page.locator('.life-line__node.is-milestone').filter({ hasText: '六级成绩公布' });
  const second = page.locator('.life-line__node.is-milestone').filter({ hasText: '六级证书申请' });
  const leader = page.locator('.life-line__milestone-leader-group[data-milestone-date="2026-08-15"]');
  const anchor = page.locator('.life-line__anchor.is-milestone[data-anchor-date="2026-08-15"]');
  await expect(first).toBeVisible();
  await expect(second).toBeVisible();
  await expect(leader).toHaveCount(1);
  await expect(leader).toHaveAttribute('data-branch-count', '2');
  await expect(anchor).toHaveCount(1);
  await expect(anchor).toHaveAttribute('data-anchor-count', '2');

  const [firstBox, secondBox] = await Promise.all([first.boundingBox(), second.boundingBox()]);
  expect(firstBox && secondBox).toBeTruthy();
  if (!firstBox || !secondBox) return;
  expect(Math.abs((firstBox.x + firstBox.width / 2) - (secondBox.x + secondBox.width / 2))).toBeLessThanOrEqual(1);
  expect(firstBox.y + firstBox.height <= secondBox.y || secondBox.y + secondBox.height <= firstBox.y).toBeTruthy();
});

test('life map persists a manually chosen card lane across semantic zoom', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const card = page.locator('.life-line__node.is-milestone').filter({ hasText: '六级证书申请' });
  const beforeLane = Number(await card.getAttribute('data-layout-lane'));
  const box = await card.boundingBox();
  expect(box).toBeTruthy();
  if (!box) return;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 62, { steps: 6 });
  await page.mouse.up();

  await expect.poll(() => page.evaluate(() => {
    const data = JSON.parse(localStorage.getItem('line-life-map-storage-v1:mirror') ?? '{}');
    return data.lifeMapEvents?.find((item: { id?: string }) => item.id === 'cet-certificate')?.layoutLane;
  })).toBeGreaterThan(beforeLane);
  await expect(card).toHaveAttribute('data-layout-source', 'manual');
  const manualLane = await card.getAttribute('data-layout-lane');
  await setLifeMapZoom(page, 'week');
  await expect(card).toHaveAttribute('data-layout-source', 'manual');
  await expect(card).toHaveAttribute('data-layout-lane', manualLane ?? '0');
});

test('life map keeps every planning phase visible and moves a plan with its phase rail across the axis', async ({ page }) => {
  await page.getByTitle('人生地图').click();

  const phaseA = page.locator('[data-project-id="goal:phase-a"]');
  const phaseB = page.locator('[data-project-id="goal:phase-b"]');
  const overlap = page.locator('[data-project-id="goal:phase-overlap"]');
  const mainProject = page.locator('[data-project-id="goal:graduate-exam"]');
  const overlapThree = page.locator('[data-project-id="goal:phase-overlap-3"]');

  await expect(phaseA).toBeVisible();
  await expect(phaseB).toBeVisible();
  await expect(mainProject).toBeVisible();
  await expect(phaseA).toHaveAttribute('data-band-side', 'above');
  await expect(overlap).toHaveAttribute('data-band-side', 'above');
  await expect(overlap).toHaveAttribute('data-band-level', /^\d+$/);
  await expect(overlapThree).toBeVisible();
  await expect(page.getByText('项目概览', { exact: true })).toHaveCount(0);

  const axis = page.locator('.life-line__axis');
  const axisTopBeforeMove = await axis.evaluate((element) => (element as HTMLElement).offsetTop);
  const phaseATop = await phaseA.evaluate((element) => (element as HTMLElement).offsetTop);
  expect(phaseATop).toBeLessThan(axisTopBeforeMove);

  await mainProject.click();
  await page.getByRole('button', { name: '放到时间轴下方' }).click();
  await expect(mainProject).toHaveAttribute('data-band-side', 'below');
  await expect(phaseB).toHaveAttribute('data-band-side', 'below');
  await expect(phaseB).toHaveAttribute('data-band-level', /^\d+$/);
  const phaseBTop = await phaseB.evaluate((element) => (element as HTMLElement).offsetTop);
  expect(phaseBTop).toBeGreaterThan(axisTopBeforeMove);
  const axisTopAfterMove = await axis.evaluate((element) => (element as HTMLElement).offsetTop);
  expect(axisTopAfterMove).toBeGreaterThan(0);

  // The localStorage mirror is an emergency journal and is deliberately removed
  // after IndexedDB succeeds. Reloading verifies the durable source instead of
  // racing that short-lived mirror entry.
  await page.waitForTimeout(550);
  await page.reload();
  await page.getByTitle('人生地图').click();
  await expect(page.locator('[data-project-id="goal:graduate-exam"]')).toHaveAttribute('data-band-side', 'below');
  await expect(page.locator('[data-project-id="goal:phase-b"]')).toHaveAttribute('data-band-side', 'below');
});

test('life map keeps the command bar compact and focuses a selected goal', async ({ page }) => {
  await page.getByTitle('人生地图').click();

  const toolbar = page.locator('.life-line__toolbar');
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole('button', { name: '添加到时间线' })).toBeVisible();
  await expect(toolbar.getByRole('textbox', { name: '自然语言快速输入' })).toHaveCount(0);
  await expect(toolbar.getByRole('button', { name: '选择工具' })).toHaveCount(0);
  await toolbar.getByRole('combobox', { name: '时间尺度' }).click();
  const scaleOptions = page.getByRole('listbox', { name: '选择时间尺度' });
  await expect(scaleOptions).toBeVisible();
  await expect(scaleOptions.getByRole('option')).toHaveCount(4);
  await expect(scaleOptions.getByRole('option', { name: /^月视图/ })).toHaveAttribute('aria-selected', 'true');
  await expect(scaleOptions).toContainText('全局规划');
  await expect(scaleOptions).toContainText('当天记录');
  await page.keyboard.press('Escape');
  await toolbar.getByRole('button', { name: '添加到时间线' }).click();
  await expect(toolbar.getByRole('textbox', { name: '自然语言快速输入' })).toBeVisible();
  await page.keyboard.press('Escape');

  const selected = page.locator('[data-project-id="goal:graduate-exam"]');
  const unrelatedVisibleBand = page.locator('[data-project-id="system:study-rhythm"]');
  await selected.hover();
  await expect(selected).toHaveClass(/is-related/);
  await expect(unrelatedVisibleBand).toHaveClass(/is-muted/);
  await page.locator('.life-line__toolbar').hover();
  await expect(unrelatedVisibleBand).not.toHaveClass(/is-muted/);

  await selected.click();
  await expect(selected).toHaveClass(/is-selected/);
  await expect(page.locator('.life-line__project-focus-card')).toContainText('2027考研');
  await expect(page.locator('.life-line__project-focus-card')).toHaveCSS('position', 'fixed');
  await expect(page.locator('.life-line__project-focus-card').getByRole('button', { name: '支撑', exact: true })).toHaveCount(0);
  await expect(page.locator('.life-line__project-focus-card').getByRole('button', { name: '日常', exact: true })).toHaveCount(0);
  await expect(page.locator('.life-line__project-focus-card').getByRole('button', { name: '暂停', exact: true })).toHaveCount(0);
  await expect(unrelatedVisibleBand).toHaveClass(/is-muted/);

  const scroller = page.locator('.life-line__scroller');
  await scroller.evaluate((element) => { element.scrollLeft += 260; });
  await expect(selected.locator('strong')).toBeVisible();
  await expect(page.locator('.life-line__project-focus-card')).toBeVisible();
});

test('life map creates a persistent range annotation directly on the canvas', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await selectLifeMapArea(page);
  await page.getByRole('button', { name: '添加到时间线' }).click();
  await page.getByRole('button', { name: '区间标注工具' }).click();

  const scroller = page.locator('.life-line__scroller');
  const box = await scroller.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  const startX = box.x + Math.min(90, box.width * 0.25);
  const endX = box.x + Math.min(260, box.width * 0.72);
  const drawY = box.y + 90;
  await page.mouse.move(startX, drawY);
  await page.mouse.down();
  await page.mouse.move(endX, drawY, { steps: 6 });
  await page.mouse.up();

  const editor = page.locator('.life-line__draft-editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveCSS('position', 'fixed');
  await editor.getByLabel('内容').fill('本周工作重点\n完成马原复习\n整理英语错题\n背诵政治知识点\n复盘本周进度');
  await editor.getByRole('button', { name: '时间线下方' }).click();
  await editor.getByRole('button', { name: '添加到画布' }).click();

  const annotation = page.locator('.life-line__annotation-callout').filter({ hasText: '本周工作重点' });
  await expect(annotation).toBeVisible();
  await expect(annotation).not.toContainText('完成马原复习');
  await expect(annotation).not.toContainText('整理英语错题');
  await expect(annotation).not.toContainText('背诵政治知识点');
  await expect(annotation.getByRole('button', { name: '展开 4 项' })).toBeVisible();
  await annotation.getByRole('button', { name: '展开 4 项' }).click();
  await expect(annotation).toContainText('完成马原复习');
  await expect(annotation).toContainText('整理英语错题');
  await expect(annotation).toContainText('背诵政治知识点');
  await expect(annotation).toContainText('复盘本周进度');
  await expect(annotation.getByRole('button', { name: '收起' })).toBeVisible();
  await expect(annotation).toHaveClass(/is-below/);
  const noteId = await annotation.getAttribute('data-note-id');
  expect(noteId).toBeTruthy();
  await expect(page.locator(`.life-line__annotation-range-mark[data-note-id="${noteId}"]`)).toBeVisible();
  await expect(page.locator(`.life-line__annotation-anchor[data-note-id="${noteId}"]`)).toBeVisible();
  await expect(page.locator(`.life-line__annotation-leader[data-note-id="${noteId}"]`)).toBeVisible();
  await annotation.locator('strong').click();
  await expect(page.locator('.life-line__draft-editor').getByLabel('内容')).toHaveValue('本周工作重点\n完成马原复习\n整理英语错题\n背诵政治知识点\n复盘本周进度');
  await expect(page.getByRole('button', { name: '本周工作重点开始日期拖动手柄' })).toBeVisible();
});

test('life map gives overlapping ranges separate bracket tracks', async ({ page }) => {
  await page.getByTitle('人生地图').click();

  const first = page.locator('.life-line__annotation-range-mark[data-note-id="focus-a"]');
  const second = page.locator('.life-line__annotation-range-mark[data-note-id="focus-b"]');
  await expect(first).toHaveAttribute('data-annotation-level', '0');
  await expect(second).toHaveAttribute('data-annotation-level', '1');

  const firstCard = page.locator('.life-line__annotation-callout[data-note-id="focus-a"]');
  const secondCard = page.locator('.life-line__annotation-callout[data-note-id="focus-b"]');
  const firstAnchor = page.locator('.life-line__annotation-anchor[data-note-id="focus-a"]');
  const secondAnchor = page.locator('.life-line__annotation-anchor[data-note-id="focus-b"]');
  const [firstCardBox, secondCardBox, firstAnchorBox, secondAnchorBox] = await Promise.all([
    firstCard.boundingBox(),
    secondCard.boundingBox(),
    firstAnchor.boundingBox(),
    secondAnchor.boundingBox(),
  ]);
  expect(firstCardBox && firstAnchorBox).toBeTruthy();
  expect(secondCardBox && secondAnchorBox).toBeTruthy();
  if (!firstCardBox || !secondCardBox || !firstAnchorBox || !secondAnchorBox) return;
  expect(Math.abs(firstCardBox.x + firstCardBox.width / 2 - (firstAnchorBox.x + firstAnchorBox.width / 2))).toBeLessThanOrEqual(24.5);
  expect(Math.abs(secondCardBox.x + secondCardBox.width / 2 - (secondAnchorBox.x + secondAnchorBox.width / 2))).toBeLessThanOrEqual(24.5);
  expect(Math.abs(firstCardBox.y - secondCardBox.y)).toBeGreaterThan(24);
  const [firstTop, secondTop] = await Promise.all([first, second].map((mark) => mark.evaluate((element) => element.getBoundingClientRect().top)));
  expect(secondTop).toBeGreaterThan(firstTop);
  expect(
    firstCardBox.y + firstCardBox.height <= secondCardBox.y
      || secondCardBox.y + secondCardBox.height <= firstCardBox.y,
  ).toBeTruthy();

  await firstCard.click();
  await expect(firstCard).toHaveClass(/is-expanded/);
  const [expandedFirstCardBox, shiftedSecondCardBox, scrollerBox] = await Promise.all([
    firstCard.boundingBox(),
    secondCard.boundingBox(),
    page.locator('.life-line__scroller').boundingBox(),
  ]);
  expect(expandedFirstCardBox && shiftedSecondCardBox && scrollerBox).toBeTruthy();
  if (!expandedFirstCardBox || !shiftedSecondCardBox || !scrollerBox) return;
  expect(
    expandedFirstCardBox.y + expandedFirstCardBox.height <= shiftedSecondCardBox.y
      || shiftedSecondCardBox.y + shiftedSecondCardBox.height <= expandedFirstCardBox.y,
  ).toBeTruthy();
  expect(expandedFirstCardBox.x).toBeGreaterThanOrEqual(scrollerBox.x - 1);
  expect(expandedFirstCardBox.x + expandedFirstCardBox.width).toBeLessThanOrEqual(scrollerBox.x + scrollerBox.width + 1);
  expect(expandedFirstCardBox.y).toBeGreaterThanOrEqual(scrollerBox.y - 1);
  expect(expandedFirstCardBox.y + expandedFirstCardBox.height).toBeLessThanOrEqual(scrollerBox.y + scrollerBox.height + 1);
});

test('life map keeps consecutive weekly plans on one continuous rail', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await setLifeMapZoom(page, 'week');

  const cards = ['week-plan-a', 'week-plan-b', 'week-plan-c'].map((id) => (
    page.locator(`.life-line__annotation-callout[data-note-id="${id}"]`)
  ));
  await Promise.all(cards.map((card) => expect(card).toHaveClass(/is-inline-rail/)));
  const boxes = await Promise.all(cards.map((card) => card.boundingBox()));
  expect(boxes.every(Boolean)).toBeTruthy();
  if (boxes.some((box) => !box)) return;
  const [first, second, third] = boxes as NonNullable<(typeof boxes)[number]>[];
  expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(second.y - third.y)).toBeLessThanOrEqual(1);
  expect(second.x - (first.x + first.width)).toBeGreaterThanOrEqual(2);
  expect(third.x - (second.x + second.width)).toBeGreaterThanOrEqual(2);
  expect(second.x - (first.x + first.width)).toBeLessThanOrEqual(8);
  expect(third.x - (second.x + second.width)).toBeLessThanOrEqual(8);
});

test('life map supports focus, layers, minimap and natural-language creation', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await selectLifeMapArea(page);

  await page.getByRole('button', { name: '视图设置' }).click();
  await page.getByRole('button', { name: '开启聚焦' }).click();
  await expect(page.locator('.life-line__focus-lens')).toBeVisible();
  await page.getByRole('button', { name: '显示小地图' }).click();
  await expect(page.getByRole('slider', { name: '人生地图全局导航' })).toBeVisible();

  await page.locator('.life-line__view-menu button').filter({ hasText: '主计划与目标' }).click();
  await expect(page.locator('.life-line__anchor.is-goal')).toHaveCount(0);
  await expect(page.locator('.life-line__project-band.is-life-system')).toHaveCount(0);

  await page.getByRole('button', { name: '添加到时间线' }).click();
  const quickInput = page.getByRole('textbox', { name: '自然语言快速输入' });
  await quickInput.fill('8月20日查看复试结果');
  await page.getByRole('button', { name: '解析并预览' }).click();
  const editor = page.locator('.life-line__draft-editor');
  await expect(editor).toContainText('关键日期');
  await expect(editor.getByLabel('内容')).toHaveValue('查看复试结果');
  await editor.getByRole('button', { name: '核心事件' }).click();
  await editor.getByRole('button', { name: '添加到画布' }).click();
  const coreMilestone = page.locator('.life-line__node.is-milestone').filter({ hasText: '查看复试结果' });
  await expect(coreMilestone).toBeVisible();
  await expect(coreMilestone).toHaveClass(/is-importance-core/);
});

test('life map rejects impossible and reversed natural-language dates', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await page.getByRole('button', { name: '添加到时间线' }).click();

  const quickInput = page.getByRole('textbox', { name: '自然语言快速输入' });
  const submit = page.getByRole('button', { name: '解析并预览' });

  await quickInput.fill('2月31日考试');
  await submit.click();
  await expect(page.locator('.life-line__quick-error')).toHaveText('没有识别到可创建的内容');
  await expect(page.locator('.life-line__draft-editor')).toHaveCount(0);

  await quickInput.fill('8月20日至8月10日复习计划');
  await submit.click();
  await expect(page.locator('.life-line__quick-error')).toHaveText('没有识别到可创建的内容');
  await expect(page.locator('.life-line__draft-editor')).toHaveCount(0);
});

test('life map directly resizes a range and supports undo', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await setLifeMapZoom(page, 'day');

  const callout = page.locator('.life-line__annotation-callout[data-note-id="focus-a"]');
  await callout.click();
  const handle = page.getByRole('button', { name: '本周重点开始日期拖动手柄' });
  await handle.scrollIntoViewIfNeeded();
  await handle.focus();
  await page.keyboard.press('ArrowRight');

  await expect(page.locator('.life-line__draft-editor').getByLabel('开始')).toHaveValue('2026-08-06');
  await page.getByRole('button', { name: '关闭编辑器' }).click();
  await page.getByRole('button', { name: '视图设置' }).click();
  await page.getByRole('button', { name: '撤销' }).click();
  await callout.click();
  await expect(page.locator('.life-line__draft-editor').getByLabel('开始')).toHaveValue('2026-08-05');
});

test('life map preserves independent planning semantics across zoom levels', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await expect(page.locator('.life-line__today')).toHaveCSS('width', '2px');
  await expect(page.locator('.life-line__task-marker')).toHaveCount(0);
  await expect(page.locator('.life-line__node.is-goal')).toHaveCount(0);
  await expect(page.locator('.life-line__anchor.is-goal').first()).toBeVisible();
  await expect(page.locator('.life-line__anchor.is-goal').first()).toHaveAttribute('aria-label', /目标日期/);
  await expect(page.locator('.life-line__project-band.is-life-system').first()).toBeVisible();
  await expect(page.locator('.life-map-system-strip button').first()).toBeVisible();
  const monthAxisCounts = await Promise.all([
    page.locator('.life-line__anchor.is-goal').count(),
    page.locator('.life-line__anchor.is-milestone').count(),
  ]);
  await setLifeMapZoom(page, 'week');
  await expect(page.locator('.life-line__anchor.is-goal').first()).toBeVisible();
  await expect(page.locator('.life-line__project-band.is-life-system').first()).toBeVisible();
  await expect(page.locator('.life-line__project-band.is-life-system').first()).toHaveClass(/is-open-ended/);
  await expect.poll(async () => Promise.all([
    page.locator('.life-line__anchor.is-goal').count(),
    page.locator('.life-line__anchor.is-milestone').count(),
  ])).toEqual(monthAxisCounts);
  await setLifeMapZoom(page, 'year');
  await expect(page.locator('.life-line__task-marker')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /目标：备战研究生考试/ })).toBeVisible();
  await expect(page.locator('.life-line__node.is-milestone').filter({ hasText: '六级成绩公布' })).toHaveCount(0);
  await expect(page.locator('.life-line__anchor.is-milestone[title*="六级成绩公布"]')).toBeVisible();
  await expect(page.locator('.life-line__anchor.is-milestone.is-importance-normal[title*="阶段模拟考试"]')).toBeVisible();
  await expect(page.locator('.life-line__annotation-callout')).toHaveCount(0);
  await expect(page.locator('.life-line__annotation-year-label').filter({ hasText: '暑期备考主线' })).toBeVisible();
});

test('life map keeps the date under the pointer fixed while wheel zooming', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const scroller = page.locator('.life-line__scroller');
  const today = page.locator('.life-line__today');
  const [before, viewport] = await Promise.all([today.boundingBox(), scroller.boundingBox()]);
  expect(before && viewport).toBeTruthy();
  if (!before || !viewport) return;

  const pointerX = before.x + before.width / 2;
  const pointerY = viewport.y + Math.min(160, viewport.height / 2);
  await scroller.evaluate((element, point) => {
    element.dispatchEvent(new WheelEvent('wheel', {
      bubbles: true,
      cancelable: true,
      clientX: point.x,
      clientY: point.y,
      ctrlKey: true,
      deltaY: -120,
    }));
  }, { x: pointerX, y: pointerY });

  await expect(page.getByRole('combobox', { name: '时间尺度' })).toContainText('周视图');
  await expect.poll(async () => Math.abs(((await today.boundingBox())?.x ?? -1000) - pointerX)).toBeLessThanOrEqual(4);
  await expect(page.locator('main.life-line')).toHaveAttribute('aria-busy', 'false');
});

test('life map continuously accumulates a trackpad wheel burst across semantic levels', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const scroller = page.locator('.life-line__scroller');
  await scroller.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    for (let index = 0; index < 8; index += 1) {
      element.dispatchEvent(new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + 120,
        ctrlKey: true,
        deltaY: -80,
      }));
    }
  });
  await expect(page.getByRole('combobox', { name: '时间尺度' })).toContainText('日视图');
  await expect(page.locator('main.life-line')).toHaveAttribute('aria-busy', 'false');
});

test('life map supports a two-finger semantic pinch without losing the canvas anchor', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const scroller = page.locator('.life-line__scroller');
  await scroller.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + 140;
    const emit = (type: string, pointerId: number, clientX: number) => element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      clientX,
      clientY: centerY,
    }));
    emit('pointerdown', 1, centerX - 30);
    emit('pointerdown', 2, centerX + 30);
    emit('pointermove', 2, centerX + 100);
    emit('pointerup', 1, centerX - 30);
    emit('pointerup', 2, centerX + 100);
  });
  await expect(page.getByRole('combobox', { name: '时间尺度' })).toContainText('周视图');
  await expect(page.locator('main.life-line')).toHaveAttribute('aria-busy', 'false');
});

test('life map recenters today when the toolbar scale changes after browsing another date', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const scroller = page.locator('.life-line__scroller');
  await scroller.evaluate((element) => {
    element.scrollLeft = 0;
    element.dispatchEvent(new Event('scroll'));
  });
  await expect(scroller).not.toHaveClass(/is-scrolling/);

  await setLifeMapZoom(page, 'day');
  await expect(page.locator('main.life-line')).toHaveAttribute('aria-busy', 'false');
  const centeredDistance = await page.locator('.life-line__today').evaluate((element) => {
    const line = element.getBoundingClientRect();
    const viewport = element.closest('.life-line__scroller')?.getBoundingClientRect();
    if (!viewport) return Number.POSITIVE_INFINITY;
    return Math.abs((line.left + line.width / 2) - (viewport.left + viewport.width / 2));
  });
  expect(centeredDistance).toBeLessThanOrEqual(3);
});

test('life map coalesces continuous scrolling while pinned chrome follows every frame', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await setLifeMapZoom(page, 'day');
  const scroller = page.locator('.life-line__scroller');
  const sawScrollingState = await scroller.evaluate(async (element) => {
    for (let index = 0; index < 6; index += 1) {
      element.scrollLeft += 38;
      element.dispatchEvent(new Event('scroll'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    return element.classList.contains('is-scrolling');
  });
  expect(sawScrollingState).toBeTruthy();
  await expect(scroller).not.toHaveClass(/is-scrolling/);

  const [stageTitle, viewport] = await Promise.all([
    page.locator('.life-line__stage-main').first().boundingBox(),
    scroller.boundingBox(),
  ]);
  expect(stageTitle && viewport).toBeTruthy();
  if (!stageTitle || !viewport) return;
  expect(stageTitle.x).toBeGreaterThanOrEqual(viewport.x + 8);
  expect(stageTitle.x + stageTitle.width).toBeLessThanOrEqual(viewport.x + viewport.width);
});

test('life map virtualizes distant planning bands and restores them after command navigation', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    const formatDate = (date: Date) => date.toISOString().slice(0, 10);
    const base = new Date('2022-01-03T12:00:00.000Z');
    const synced = { createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-01T00:00:00.000Z', revision: 1 };
    useLifeMapStore.setState({
      lifeMapGoals: Array.from({ length: 180 }, (_, index) => {
        const start = new Date(base);
        start.setUTCDate(start.getUTCDate() + index * 14);
        const end = new Date(start);
        end.setUTCDate(end.getUTCDate() + 9);
        return {
          id: `performance-plan-${index}`,
          areaId: 'learning',
          name: `性能计划 ${index}`,
          kind: 'plan' as const,
          start: formatDate(start),
          targetDate: formatDate(end),
          status: 'active' as const,
          progress: 0,
          ...synced,
        };
      }),
    });
  });
  await setLifeMapZoom(page, 'week');

  await expect.poll(() => page.locator('.life-line__project-band.is-life-plan').count()).toBeGreaterThan(0);
  await expect.poll(() => page.locator('.life-line__project-band.is-life-plan').count()).toBeLessThan(60);
  await expect.poll(() => page.evaluate(async () => {
    const { useLifeMapStore } = await import('/src/lifeMap/store.ts');
    return useLifeMapStore.getState().lifeMapGoals.length;
  })).toBe(180);

  await page.getByRole('button', { name: '快速跳转' }).click();
  await page.getByRole('textbox', { name: '搜索人生地图' }).fill('性能计划 179');
  await page.locator('.life-line__jump-results').getByRole('button', { name: /性能计划 179/ }).click();
  await expect(page.locator('[data-project-id="goal:performance-plan-179"]')).toBeVisible();
  await expect(page.locator('[data-project-id="goal:performance-plan-179"]')).toHaveClass(/is-selected/);
  await expect(page.locator('[data-project-id="goal:performance-plan-0"]')).toHaveCount(0);
});

test('life map surfaces stages, a core goal and the next milestone without project-planning chrome', async ({ page }) => {
  await page.getByTitle('人生地图').click();

  const summary = page.getByLabel('当前规划摘要');
  await expect(summary).toContainText('阶段');
  await expect(summary).toContainText('考研准备期');
  await expect(summary.getByRole('button', { name: '编辑当前人生阶段' })).toBeVisible();
  await expect(summary).toContainText('核心');
  await expect(summary).toContainText('备战研究生考试');
  await expect(summary).toContainText('六级成绩公布');
  await expect(summary).not.toContainText('本周');

  const stageRail = page.getByLabel('人生阶段');
  await expect(stageRail.locator('.life-line__stage-rail-title')).toHaveCount(0);
  await expect(stageRail.locator('.life-line__stage-empty')).toHaveCount(0);
  await expect(stageRail.getByRole('button', { name: '考研准备期人生阶段', exact: true })).toBeVisible();
  await expect(stageRail.locator('.life-line__stage-band.is-current')).toContainText('当前');
  await expect(stageRail.locator('.life-line__stage-zone.is-current')).toBeVisible();
  await expect(page.getByLabel('计划负荷分布')).toHaveCount(0);
  await page.getByRole('button', { name: '视图设置' }).click();
  await expect(page.locator('.life-line__view-menu')).not.toContainText('计划负荷');
  await expect(page.locator('.life-line__view-menu')).not.toContainText('普通任务');
  await page.getByRole('button', { name: '视图设置' }).click();

  const phaseA = page.locator('[data-project-id="goal:phase-a"]');
  await phaseA.click();
  await expect(page.getByRole('button', { name: '编辑', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '设为核心项目' })).toHaveCount(0);
});

test('life stage rail provides direct create and edit actions', async ({ page }) => {
  await page.getByTitle('人生地图').click();

  await page.getByRole('button', { name: '编辑人生阶段：考研准备期' }).click();
  const stageEditor = page.locator('.life-line__stage-editor');
  await expect(stageEditor).toContainText('编辑人生阶段');
  await expect(stageEditor.getByLabel('阶段名称')).toHaveValue('考研准备期');
  await expect(stageEditor).toContainText('不会自动创建目标或长期系统');
  await stageEditor.getByRole('button', { name: '取消' }).click();

  await page.getByRole('button', { name: '添加到时间线' }).click();
  await page.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('button', { name: '新建人生阶段' }).click();
  await expect(stageEditor).toContainText('新建人生阶段');
  await stageEditor.getByLabel('阶段名称').fill('考研冲刺期');
  await stageEditor.getByLabel('开始日期').fill('2027-09-01');
  await stageEditor.getByLabel('结束日期').fill('2027-12-20');
  await stageEditor.getByRole('button', { name: '保存阶段' }).click();
  await expect(page.getByRole('button', { name: '考研冲刺期人生阶段' })).toBeVisible();
  await expect(page.locator('.life-line__project-band').filter({ hasText: '考研冲刺期' })).toHaveCount(0);
  await page.getByRole('button', { name: '快速跳转' }).click();
  await page.getByRole('textbox', { name: '搜索人生地图' }).fill('考研冲刺期');
  const result = page.locator('.life-line__jump-results').getByRole('button', { name: /考研冲刺期/ });
  await expect(result).toContainText('人生阶段');
  await expect(result).not.toContainText('项目分组');
});

test('life map supports command jump and creates a dedicated planning review', async ({ page }) => {
  await page.getByTitle('人生地图').click();

  await page.getByRole('button', { name: '快速跳转' }).click();
  const search = page.getByRole('textbox', { name: '搜索人生地图' });
  await search.fill('Phase B');
  await page.locator('.life-line__jump-results').getByRole('button', { name: /Phase B/ }).click();
  await expect(page.locator('[data-project-id="goal:phase-b"]')).toHaveClass(/is-selected/);

  await page.getByRole('button', { name: '添加到时间线' }).click();
  await page.getByRole('button', { name: '更多操作' }).click();
  await page.getByRole('button', { name: '新建周期复盘' }).click();
  const editor = page.locator('.life-map-editor form');
  await expect(editor.getByRole('heading', { name: '新建周期复盘' })).toBeVisible();
  await editor.getByLabel('复盘标题').fill('七月计划复盘');
  await editor.getByLabel('本周期发生了什么').fill('本月完成了核心学习任务。');
  await editor.getByLabel('下一周期如何调整').fill('降低并行项目数量。');
  await editor.getByRole('button', { name: '保存', exact: true }).click();
  await expect(page.getByRole('button', { name: '复盘 · 七月计划复盘时间条带' })).toBeVisible();
});

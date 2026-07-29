import { expect, test, type Page } from '@playwright/test';

const setLifeMapZoom = async (page: Page, zoom: 'year' | 'month' | 'week' | 'day') => {
  const label = { year: '年视图', month: '月视图', week: '周视图', day: '日视图' }[zoom];
  await page.getByRole('combobox', { name: '时间尺度' }).click();
  await page.getByRole('option', { name: new RegExp(`^${label}`) }).click();
};

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
});

test('timeline fills the workspace on the initial load before lazy views are opened', async ({ page }) => {
  const workspace = page.locator('.project-workspace-content');
  await expect(workspace).toBeVisible();
  const layout = await workspace.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const parent = element.parentElement?.getBoundingClientRect();
    const style = getComputedStyle(element);
    return {
      display: style.display,
      flexGrow: style.flexGrow,
      width: rect.width,
      parentWidth: parent?.width ?? 0,
    };
  });
  expect(layout.display).toBe('flex');
  expect(layout.flexGrow).toBe('1');
  expect(layout.width).toBeGreaterThanOrEqual(layout.parentWidth - 2);
});

test('six main views remain reachable through the real interface', async ({ page }) => {
  for (const title of ['人生地图', '每日安排', '周矩阵', '艾宾浩斯复习', '知识大盘', '项目规划']) {
    await page.getByTitle(title).click();
    await expect(page.getByTitle(title)).toHaveAttribute('aria-selected', 'true');
  }
  await expect(page.getByTitle('任务总览')).toHaveCount(0);
});

test('life map keeps every planning scale on one literal zoomable line', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  await expect(page.getByRole('heading', { name: '人生地图', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '人生时间线' })).toBeVisible();
  await expect(page.locator('.life-line__axis')).toHaveCount(1);
  await expect(page.locator('.life-line__canvas')).toBeVisible();

  await setLifeMapZoom(page, 'day');
  await expect(page.getByLabel('人生规划日视图时间轴')).toBeVisible();
  await setLifeMapZoom(page, 'week');
  await expect(page.getByLabel('人生规划周视图时间轴')).toBeVisible();
  await page.getByRole('button', { name: '今天', exact: true }).click();
  await expect(page.locator('.life-line__today')).toBeVisible();
});

test('project planning opens the timeline directly without an internal view menu', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  await page.getByTitle('项目规划').click();
  await expect(page.getByTitle('项目规划')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.tl-year-stack')).toBeVisible();
  await page.getByTitle('项目规划').click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(page.locator('.tl-year-stack')).toBeVisible();
});

test('daily schedule and week matrix keep focused planning controls without an all-project task shortcut', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  await expect(page.getByRole('button', { name: '明日复习选择' })).toBeVisible();
  await expect(page.getByRole('button', { name: '新建项目任务' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '查看全部项目任务' })).toHaveCount(0);

  await page.getByTitle('周矩阵').click();
  await expect(page.getByRole('button', { name: '查看全部项目任务' })).toHaveCount(0);
  await expect(page.getByTitle('周矩阵')).toHaveAttribute('aria-selected', 'true');
});

test('retired project overview preferences are cleared after refresh', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('project-workspace-view-v1', 'overview');
    localStorage.setItem('task-overview-preferences-v1', JSON.stringify({ groupBy: 'project' }));
  });
  await page.reload();
  await expect(page.getByTitle('项目规划')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.tl-year-stack')).toBeVisible();
  await expect.poll(() => page.evaluate(() => ({
    workspace: localStorage.getItem('project-workspace-view-v1'),
    preferences: localStorage.getItem('task-overview-preferences-v1'),
  }))).toEqual({ workspace: null, preferences: null });
});

test('global search is removed while archive search remains available', async ({ page }) => {
  await expect(page.getByTitle(/全局搜索/)).toHaveCount(0);
  await page.getByTitle('知识大盘').click();
  await page.getByTitle(/归档库/).click();
  const archiveSearch = page.getByLabel('搜索归档知识节点');
  await expect(archiveSearch).toBeVisible();
  await archiveSearch.fill('不存在的归档节点');
  await expect(page.getByText('没有找到匹配的归档节点')).toBeVisible();
  await page.getByLabel('关闭归档库').click();
  await expect(archiveSearch).toBeHidden();
});

test('daily schedule keeps its controls clickable', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  await expect(page.getByRole('heading', { name: '每日安排' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '时段' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '时间块' })).toBeVisible();
  await page.getByRole('tab', { name: '时间块' }).click();
  await expect(page.getByRole('tab', { name: '时间块' })).toHaveAttribute('aria-selected', 'true');
});

test('daily task pool cards grow to fit wrapped titles and duration metadata', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.id = 'ds-pool-layout-fixture';
    fixture.style.cssText = 'position:fixed;left:8px;top:8px;width:330px;z-index:9999';
    fixture.innerHTML = `
      <div class="ds-pool-item">
        <div class="ds-pool-item-accent"></div>
        <div class="ds-pool-item-content">
          <span class="ds-pool-item-name">南京国民政府时期教育与杨贤江 1000题</span>
          <span class="ds-pool-item-meta"><span>预计 30 分钟</span></span>
        </div>
        <span class="ds-pool-item-tag ds-pool-item-tag--project">中教强化课</span>
      </div>
      <div class="ds-pool-item">
        <div class="ds-pool-item-accent"></div>
        <div class="ds-pool-item-content">
          <span class="ds-pool-item-name">01.导论、新时代坚持和发展中国特色社会主义</span>
          <span class="ds-pool-item-meta"><span>第1/5轮</span><i>·</i><span>预计 30 分钟</span></span>
        </div>
        <span class="ds-pool-item-tag ds-pool-item-tag--review">复习 · 第1/5轮</span>
      </div>`;
    document.body.appendChild(fixture);
  });
  const cards = page.locator('#ds-pool-layout-fixture .ds-pool-item');
  await expect(cards).toHaveCount(2);
  const layout = await cards.evaluateAll((elements) => elements.map((element) => {
    const card = element.getBoundingClientRect();
    const content = element.querySelector('.ds-pool-item-content')?.getBoundingClientRect();
    const tag = element.querySelector('.ds-pool-item-tag')?.getBoundingClientRect();
    const title = element.querySelector('.ds-pool-item-name') as HTMLElement | null;
    return {
      contentFits: !content || content.bottom <= card.bottom + 1,
      tagFits: !tag || tag.bottom <= card.bottom + 1,
      cardFits: element.scrollHeight <= element.clientHeight + 1,
      titleWraps: !title || getComputedStyle(title).whiteSpace === 'normal',
      titleFits: !title || title.scrollHeight <= title.clientHeight + 1,
    };
  }));
  expect(layout.every((item) => item.contentFits && item.tagFits && item.cardFits && item.titleWraps && item.titleFits)).toBeTruthy();
});

test('small screens expose the daily task pool as a closable bottom drawer', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const trigger = page.locator('.ds-task-pool-trigger');
  if ((page.viewportSize()?.width ?? 1200) > 900) return;
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.click();
  await expect(page.getByLabel('待安排任务池')).toHaveClass(/ds-right--open/);
  await page.getByLabel('关闭任务池').click();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
});

test('operation history and recycle library are removed with their legacy storage', async ({ page }) => {
  await page.evaluate(() => {
    localStorage.setItem('line-operation-history-v2', '[{"id":"legacy-operation"}]');
    localStorage.setItem('line-recycle-bin-v1', '[{"id":"legacy-recycled-task"}]');
  });
  await page.reload();
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
  await expect(page.getByTitle('最近操作与回收站')).toHaveCount(0);
  await expect(page.getByLabel('最近操作面板')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => ({
    history: localStorage.getItem('line-operation-history-v2'),
    recycle: localStorage.getItem('line-recycle-bin-v1'),
  }))).toEqual({ history: null, recycle: null });
});

test('small screens can scroll the EBB content without the fixed toolbar swallowing the page', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  const result = await page.evaluate(() => {
    const root = document.scrollingElement;
    if (!root) return false;
    const before = root.scrollTop;
    root.scrollTo({ top: root.scrollHeight, behavior: 'instant' });
    return root.scrollHeight <= root.clientHeight || root.scrollTop > before;
  });
  expect(result).toBeTruthy();
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
});

test('EBB safe mode keeps recovery controls usable and disables the high-load board', async ({ page }) => {
  await page.evaluate(() => sessionStorage.setItem('smart-line-ebb-safe-mode', '1'));
  await page.getByTitle('艾宾浩斯复习').click();
  await expect(page.getByRole('status')).toContainText('安全模式已开启');
  await expect(page.getByRole('tab', { name: '看板视图' })).toBeDisabled();
  await expect(page.getByRole('button', { name: '退出安全模式' })).toBeVisible();
});

test('EBB complexity settings can be edited, saved and reset without closing the panel', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByLabel('复习更多操作').click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();

  const panel = page.locator('.eb-panel--settings');
  const section = panel.locator('.eb-settings-section').filter({ hasText: '复杂度配置' });
  const easyRow = section.locator('.eb-complexity-row').filter({ hasText: '🟢 简单' });

  await easyRow.getByRole('button', { name: '编辑' }).click();
  await expect(panel).toBeVisible();
  const editor = easyRow.getByRole('group', { name: '🟢 简单复杂度编辑器' });
  await expect(editor).toBeVisible();

  await editor.getByLabel('间隔序列').fill('1, 4, 9');
  await editor.getByRole('button', { name: '保存' }).click();
  await expect(easyRow).toContainText('间隔：1, 4, 9');
  await expect(panel).toBeVisible();

  await easyRow.getByRole('button', { name: '重置🟢 简单复杂度配置' }).click();
  const confirmation = page.getByRole('alertdialog');
  await expect(confirmation).toContainText('重置');
  await confirmation.getByRole('button', { name: '继续' }).click();
  await expect(easyRow).toContainText('间隔：1, 3, 7, 15, 30');
  await expect(panel).toBeVisible();
});

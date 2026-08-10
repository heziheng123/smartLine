import { expect, test } from '@playwright/test';

const testDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const graph = {
  nodes: [
    { id: 'root-education', name: '教育学', parentId: null, createdAt: 1 },
    { id: 'child-warring', name: '战国教育', parentId: 'root-education', createdAt: 2 },
  ],
};

const ebb = {
  reviewTasks: [
    {
      id: 'review-linked',
      topicName: '战国教育',
      dueDate: testDate,
      originalDueDate: testDate,
      roundOrder: 1,
      isCompleted: false,
      graphNodeId: 'child-warring',
      tag: '战国后期教育论著 导学',
      complexity: 'normal',
      smStatus: 'scheduled',
    },
    {
      id: 'review-manual',
      topicName: '独立复习主题',
      dueDate: testDate,
      originalDueDate: testDate,
      roundOrder: 1,
      isCompleted: false,
      tag: '手动标签',
      complexity: 'normal',
      smStatus: 'scheduled',
    },
  ],
  inboxItems: [],
  outlineNodes: [],
  ebbSettings: {
    tagColors: {
      'root:root-education': '#A8C4D9',
      'manual:手动标签': '#E0B8B8',
      '战国后期教育论著 导学': '#D9D9B8',
    },
  },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ graphData, ebbData }) => {
    localStorage.clear();
    localStorage.setItem('line-graph-storage:mirror', JSON.stringify(graphData));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify(ebbData));
  }, { graphData: graph, ebbData: ebb });
  await page.goto('/');
  await expect(page.getByRole('tablist', { name: '主导航' })).toBeVisible();
});

test('EBB uses the knowledge root as the category while preserving standalone manual tags', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('tab', { name: /复习库/ }).click();

  const linkedRow = page.locator('.eb-topic-row').filter({ hasText: '战国教育' });
  const manualRow = page.locator('.eb-topic-row').filter({ hasText: '独立复习主题' });
  await expect(linkedRow.locator('.eb-topic-row-tag')).toHaveText('教育学');
  await expect(linkedRow.locator('.eb-topic-row-tag')).toHaveCSS('background-color', 'rgba(168, 196, 217, 0.25)');
  await expect(manualRow.locator('.eb-topic-row-tag')).toHaveText('手动标签');
  await expect(page.getByText('战国后期教育论著 导学', { exact: true })).toHaveCount(0);

  await page.getByLabel('复习更多操作').click();
  await page.getByRole('menuitem', { name: '设置', exact: true }).click();
  const categorySection = page.locator('.eb-settings-section').filter({ hasText: '分类颜色' });
  await expect(categorySection).toContainText('教育学');
  await expect(categorySection).toContainText('手动标签');
  await expect(categorySection).not.toContainText('战国后期教育论著 导学');

  await page.getByRole('button', { name: '将教育学设为#D9B8C4' }).click();
  await expect(page.getByRole('button', { name: '将教育学设为#D9B8C4' })).toHaveClass(/eb-tag-color-swatch--active/);
  await page.locator('.eb-panel-close').click();
  await expect(linkedRow.locator('.eb-topic-row-tag')).toHaveCSS('background-color', 'rgba(217, 184, 196, 0.25)');
});

test('EBB weekly round cards use the same root category as the matrix', async ({ page }) => {
  await page.getByTitle('艾宾浩斯复习').click();
  await page.getByRole('tab', { name: '看板视图' }).click();

  const linkedCard = page.locator('.eb-week-round-card').filter({ hasText: '战国教育' });
  const manualCard = page.locator('.eb-week-round-card').filter({ hasText: '独立复习主题' });
  await expect(linkedCard).toContainText('教育学');
  await expect(linkedCard).toHaveCSS('border-left-color', 'rgb(168, 196, 217)');
  await expect(manualCard).toContainText('手动标签');
  await expect(page.getByText('战国后期教育论著 导学', { exact: true })).toHaveCount(0);
});

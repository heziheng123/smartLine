import { expect, test } from '@playwright/test';

const testDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const timeline = {
  tasks: [{
    id: 'binding-project',
    name: '改绑策略项目',
    start: testDate,
    end: testDate,
    color: '#818cf8',
    blocks: [{
      type: 'smart-task',
      id: 'binding-task',
      header: {
        title: '已完成改绑任务',
        tag: '默认',
        tagColor: '#818cf8',
        date: testDate,
        duration: 30,
        isCompleted: true,
        completedDate: testDate,
        graphNodeIds: ['old-node'],
        autoSyncEbb: true,
      },
      body: '',
    }],
  }],
  groups: [],
  notes: [],
  milestones: [],
};

const graph = {
  nodes: [
    { id: 'old-node', name: '旧知识节点', parentId: null, createdAt: 1, status: 'activated' },
    { id: 'new-node', name: '新知识节点', parentId: null, createdAt: 2, status: 'unactivated' },
  ],
};

const ebb = {
  reviewTasks: [{
    id: 'old-review',
    topicName: '旧知识节点',
    graphNodeId: 'old-node',
    dueDate: testDate,
    originalDueDate: testDate,
    roundOrder: 1,
    isCompleted: false,
    complexity: 'normal',
    smStatus: 'scheduled',
  }],
  inboxItems: [],
  outlineNodes: [],
  ebbSettings: {},
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ timelineData, graphData, ebbData }) => {
    localStorage.clear();
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify(timelineData));
    localStorage.setItem('line-graph-storage:mirror', JSON.stringify(graphData));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify(ebbData));
  }, { timelineData: timeline, graphData: graph, ebbData: ebb });
  await page.goto('/');
});

test('completed task binding asks for a strategy and reuses it during the same selection session', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: '改绑策略项目' }).first().click();
  const card = page.locator('.stb-card').filter({ hasText: '已完成改绑任务' });
  await expect(card).toBeVisible();

  await card.getByRole('button', { name: '旧知识节点' }).click();
  await page.locator('.stb-graph-option').filter({ hasText: '旧知识节点' }).click();

  const decision = page.getByRole('dialog', { name: '如何处理已完成任务的复习关联？' });
  await expect(decision).toBeVisible();
  await expect(decision.getByRole('button', { name: /转移并生成新计划/ })).toBeVisible();
  await expect(decision.getByRole('button', { name: /仅修改关联/ })).toBeVisible();
  await expect(decision.getByRole('button', { name: /保留旧计划，同时生成新计划/ })).toBeVisible();
  await decision.getByRole('button', { name: /仅修改关联/ }).click();

  await page.locator('.stb-graph-option').filter({ hasText: '新知识节点' }).click();
  await expect(decision).toHaveCount(0);
  await expect(card.getByRole('button', { name: '新知识节点' })).toBeVisible();

  await page.locator('.stb-tag-picker-overlay').click({ position: { x: 4, y: 4 } });
  await page.getByTitle('艾宾浩斯复习').click();
  await expect(page.getByText('旧知识节点', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('新知识节点', { exact: true })).toHaveCount(0);
});

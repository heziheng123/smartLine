import { expect, test, type Page } from '@playwright/test';
import type { Task } from '../../src/types';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
}).format(new Date());

const project = {
  id: 'grouped-completion-project',
  name: '分组完成一致性项目',
  start: today,
  end: today,
  color: '#93c5fd',
  groupId: 'completion-group',
  completed: false,
  blocks: [{
    type: 'text',
    id: 'deletable-document-text',
    content: '可删除的项目文档内容',
  }, {
    type: 'smart-task',
    id: 'grouped-completion-block',
    header: {
      title: '分组任务连续完成取消',
      tag: '默认',
      tagColor: '#f59e0b',
      date: today,
      duration: 30,
      isCompleted: true,
      completedDate: today,
      autoSyncEbb: true,
      graphNodeIds: ['completion-node'],
    },
    body: '',
  }],
};

const timeline = {
  tasks: [project],
  groups: [{
    id: 'completion-group',
    name: '一致性分组',
    start: today,
    end: today,
    color: '#60a5fa',
    children: [project],
  }],
  notes: [],
  milestones: [],
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ timelineData }) => {
    if (localStorage.getItem('grouped-completion-seeded') === '1') return;
    localStorage.clear();
    localStorage.setItem('grouped-completion-seeded', '1');
    localStorage.setItem('smart-timeline-data:mirror', JSON.stringify(timelineData));
    localStorage.setItem('line-graph-storage:mirror', JSON.stringify({
      nodes: [{
        id: 'completion-node',
        name: '完成一致性节点',
        parentId: null,
        createdAt: 1,
        status: 'activated',
      }],
    }));
    localStorage.setItem('smart-ebb-data:mirror', JSON.stringify({
      reviewTasks: [],
      inboxItems: [],
      outlineNodes: [],
      ebbSettings: {},
    }));
    localStorage.setItem('daily-schedule-data:mirror', JSON.stringify({
      [timelineData.tasks[0].start]: {
        date: timelineData.tasks[0].start,
        items: [{
          id: 'grouped-completion-scheduled',
          sourceId: 'project-blk:grouped-completion-project::grouped-completion-block',
          name: '分组任务连续完成取消',
          source: 'project',
          timeSlot: 'morning',
          order: 0,
          duration: 30,
        }],
        blocks: [],
      },
    }));
  }, { timelineData: timeline });
  await page.goto('/');
  await expect(page.locator('.tl-dock')).toBeVisible();
  await expect.poll(() => page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    const state = useTimelineStore.getState();
    return state.isHydrated
      && state.tasks.some((task) => task.id === 'grouped-completion-project');
  })).toBe(true);
});

async function openProjectDocument(page: Page) {
  await page.getByTitle('项目规划').click();
  await page.locator('.tl-seg').filter({ hasText: '分组完成一致性项目' }).first().click();
  const card = page.locator('.stb-card').filter({ hasText: '分组任务连续完成取消' });
  await expect(card).toBeVisible();
  return card;
}

async function readCompletionCopies(page: Page) {
  return page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    const task = useTimelineStore.getState().tasks.find((item) => item.id === 'grouped-completion-project');
    const child = useTimelineStore.getState().groups
      .flatMap((group) => group.children)
      .find((item) => item.id === 'grouped-completion-project');
    const taskBlock = task?.blocks.find((block) => block.id === 'grouped-completion-block');
    const childBlock = child?.blocks.find((block) => block.id === 'grouped-completion-block');
    return {
      task: taskBlock?.type === 'smart-task' ? taskBlock.header.isCompleted : undefined,
      group: childBlock?.type === 'smart-task' ? childBlock.header.isCompleted : undefined,
    };
  });
}

async function readNodeStatus(page: Page) {
  return page.evaluate(async () => {
    const { useGraphStore } = await import('/src/graph/store.ts');
    return useGraphStore.getState().nodes
      .find((node) => node.id === 'completion-node')?.status;
  });
}

test('grouped project can complete and cancel repeatedly without refresh', async ({ page }) => {
  const persistenceErrors: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('DataCloneError')) persistenceErrors.push(message.text());
  });
  const card = await openProjectDocument(page);
  await card.locator('.stb-check').click();
  await expect(card).not.toHaveClass(/stb-card--done/);
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: false, group: false });
  await expect.poll(() => readNodeStatus(page)).toBe('unactivated');

  await card.locator('.stb-check').click();
  await expect(card).toHaveClass(/stb-card--done/);
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: true, group: true });
  await expect.poll(() => readNodeStatus(page)).toBe('activated');

  await card.locator('.stb-check').click();
  await expect(card).not.toHaveClass(/stb-card--done/);
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: false, group: false });
  await expect.poll(() => readNodeStatus(page)).toBe('unactivated');
  await page.waitForTimeout(800);
  expect(persistenceErrors).toEqual([]);

  await page.reload();
  const reloadedCard = await openProjectDocument(page);
  await expect(reloadedCard.getByRole('button', { name: '标记完成', exact: true })).toBeVisible();
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: false, group: false });
  await expect.poll(() => readNodeStatus(page)).toBe('unactivated');
});

test('project document text blocks can be deleted and stay deleted after reload', async ({ page }) => {
  await openProjectDocument(page);
  const textCard = page.locator('.tb-card').filter({ hasText: '可删除的项目文档内容' });
  await expect(textCard).toBeVisible();
  await textCard.hover();
  await textCard.getByTitle('删除').click();
  await expect(textCard).toHaveCount(0);

  await expect.poll(() => page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    const state = useTimelineStore.getState();
    const taskHasBlock = state.tasks
      .find((task) => task.id === 'grouped-completion-project')
      ?.blocks.some((block) => block.id === 'deletable-document-text');
    const groupHasBlock = state.groups
      .flatMap((group) => group.children)
      .find((task) => task.id === 'grouped-completion-project')
      ?.blocks.some((block) => block.id === 'deletable-document-text');
    return { taskHasBlock, groupHasBlock };
  })).toEqual({ taskHasBlock: false, groupHasBlock: false });

  await page.reload();
  await openProjectDocument(page);
  await expect(page.locator('.tb-card').filter({ hasText: '可删除的项目文档内容' })).toHaveCount(0);
});

test('completed task without automatic review activates its knowledge node in blue', async ({ page }) => {
  const card = await openProjectDocument(page);

  // Return to an incomplete state, then explicitly opt out of automatic review.
  await card.locator('.stb-check').click();
  await expect.poll(() => readNodeStatus(page)).toBe('unactivated');
  await card.getByRole('button', { name: '完成一致性节点' }).click();
  const autoReview = page.getByLabel('自动同步至复习流');
  await expect(autoReview).toBeChecked();
  await autoReview.uncheck();
  await page.locator('.stb-tag-picker-overlay').click({ position: { x: 4, y: 4 } });

  await card.locator('.stb-check').click();
  await expect(card).toHaveClass(/stb-card--done/);
  await expect.poll(() => readNodeStatus(page)).toBe('activated');

  const reviewCount = await page.evaluate(async () => {
    const { useEbbStore } = await import('/src/ebb/store.ts');
    return useEbbStore.getState().reviewTasks
      .filter((task) => task.graphNodeId === 'completion-node' && !task.isArchived)
      .length;
  });
  expect(reviewCount).toBe(0);

  await page.getByTitle('知识大盘').click();
  const nodeTitle = page.locator('svg title').filter({
    hasText: '完成一致性节点 · 已完成 · 无需复习',
  });
  await expect(nodeTitle).toHaveCount(1);
  const nodeFill = await nodeTitle.evaluate(
    (element) => element.parentElement?.querySelector('path')?.getAttribute('fill'),
  );
  expect(nodeFill).toBe('#3b82f6');

  await nodeTitle.evaluate(
    (element) => element.parentElement?.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  const summary = page.getByLabel('学习状态总览');
  await expect(summary).toContainText('已完成 · 无需复习');
  await expect(summary).toContainText('未开启自动生成复习任务');
});

test('a remote legacy project without blocks cannot break linked-task cancellation', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    const state = useTimelineStore.getState();
    useTimelineStore.setState({
      tasks: [
        ...state.tasks,
        {
          id: 'remote-legacy-without-blocks',
          name: 'Remote legacy project',
          start: '2026-07-01',
          end: '2026-07-31',
          completed: false,
          color: '#e2e8f0',
        } as Task,
      ],
    });
  });

  const card = await openProjectDocument(page);
  await card.locator('.stb-check').click();
  await expect(card).not.toHaveClass(/stb-card--done/);
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: false, group: false });
  await expect.poll(() => readNodeStatus(page)).toBe('unactivated');
  expect(pageErrors).toEqual([]);

  const repairedBlocks = await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    return useTimelineStore.getState().tasks
      .find((task) => task.id === 'remote-legacy-without-blocks')?.blocks;
  });
  expect(repairedBlocks).toEqual([]);
});

test('a divergent Liveblocks batch is repaired before a stale group copy can drive the UI', async ({ page }) => {
  await page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    const setCompleted = (task: Task, value: boolean) => ({
      ...task,
      blocks: task.blocks.map((block) => block.id === 'grouped-completion-block'
        ? { ...block, header: { ...block.header, isCompleted: value } }
        : block),
    });
    const state = useTimelineStore.getState();
    useTimelineStore.setState({
      tasks: state.tasks.map((task) => task.id === 'grouped-completion-project'
        ? setCompleted(task, false)
        : task),
      groups: state.groups.map((group) => ({
        ...group,
        children: group.children.map((child) => child.id === 'grouped-completion-project'
          ? setCompleted(child, true)
          : child),
      })),
    });
  });

  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: false, group: false });

  const projectCard = await openProjectDocument(page);
  await expect(projectCard).toBeVisible();
  await projectCard.locator('.stb-check').click();
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: true, group: true });
  await expect(projectCard).toHaveClass(/stb-card--done/);
  await projectCard.locator('.stb-check').click();
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: false, group: false });
});

test('daily schedule uses the same canonical completion state for a grouped project', async ({ page }) => {
  await page.getByTitle('每日安排').click();
  const card = page.locator('.ds-item').filter({ hasText: '分组任务连续完成取消' });
  await expect(card).toBeVisible();
  await expect(card).toHaveClass(/ds-item--completed/);

  await card.locator('.ds-item-check').click();
  await expect(card).not.toHaveClass(/ds-item--completed/);
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: false, group: false });

  await card.locator('.ds-item-check').click();
  await expect(card).toHaveClass(/ds-item--completed/);
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: true, group: true });

  await card.locator('.ds-item-check').click();
  await expect(card).not.toHaveClass(/ds-item--completed/);
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: false, group: false });
});

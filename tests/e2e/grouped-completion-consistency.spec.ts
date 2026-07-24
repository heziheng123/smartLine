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
      autoSyncEbb: false,
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

  await page.reload();
  const reloadedCard = await openProjectDocument(page);
  await expect(reloadedCard.getByRole('button', { name: '标记完成', exact: true })).toBeVisible();
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: false, group: false });
  await expect.poll(() => readNodeStatus(page)).toBe('unactivated');
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

  await page.getByTitle('项目规划').click();
  await page.getByRole('menuitemradio', { name: '全部任务' }).click();
  const overviewCard = page.locator('[data-block-id="grouped-completion-block"]');
  await expect(overviewCard).toBeVisible();
  await expect(overviewCard.getByRole('button', { name: /^完成：/ })).toBeVisible();
  await overviewCard.getByRole('button', { name: /^完成：/ }).click();
  await expect.poll(() => readCompletionCopies(page)).toEqual({ task: true, group: true });
  await page.locator('.task-overview-stats button').filter({ hasText: '已完成' }).click();
  await page.locator('.task-overview-section-header').filter({ hasText: '已完成' }).click();
  await expect(overviewCard).toBeVisible();
  await overviewCard.getByRole('button', { name: /^取消完成：/ }).click();
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

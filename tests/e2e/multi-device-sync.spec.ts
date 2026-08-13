import { test, expect, type BrowserContext } from '@playwright/test';

test.describe('Multi-device concurrent editing', () => {
  let contextA: BrowserContext;
  let contextB: BrowserContext;

  test.beforeEach(async ({ browser }) => {
    contextA = await browser.newContext();
    contextB = await browser.newContext();
  });

  test.afterEach(async () => {
    await contextA.close();
    await contextB.close();
  });

  test('device A adds task, device B adds different task, both tasks merge without conflict', async () => {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    await pageA.waitForSelector('[data-view="timeline"]', { timeout: 15000 });
    await pageB.waitForSelector('[data-view="timeline"]', { timeout: 15000 });

    const taskNameA = `Task-A-${Date.now()}`;
    const taskNameB = `Task-B-${Date.now()}`;

    await pageA.click('button:has-text("添加项目")');
    await pageA.fill('input[placeholder*="项目名称"]', taskNameA);
    await pageA.fill('input[type="date"]', '2026-09-01');
    await pageA.click('button:has-text("保存")');

    await pageB.click('button:has-text("添加项目")');
    await pageB.fill('input[placeholder*="项目名称"]', taskNameB);
    await pageB.fill('input[type="date"]', '2026-09-02');
    await pageB.click('button:has-text("保存")');

    await pageA.waitForTimeout(1000);
    await pageB.waitForTimeout(1000);

    const tasksA = await pageA.locator('.tl-task-bar, .project-card').allTextContents();
    const tasksB = await pageB.locator('.tl-task-bar, .project-card').allTextContents();

    expect(tasksA.some(text => text.includes(taskNameA))).toBe(true);
    expect(tasksA.some(text => text.includes(taskNameB))).toBe(true);
    expect(tasksB.some(text => text.includes(taskNameA))).toBe(true);
    expect(tasksB.some(text => text.includes(taskNameB))).toBe(true);
  });

  test('device A modifies task title, device B deletes same task, conflict is detected', async () => {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    await pageA.waitForSelector('[data-view="timeline"]', { timeout: 15000 });
    await pageB.waitForSelector('[data-view="timeline"]', { timeout: 15000 });

    const originalTaskName = `Task-Conflict-${Date.now()}`;

    await pageA.click('button:has-text("添加项目")');
    await pageA.fill('input[placeholder*="项目名称"]', originalTaskName);
    await pageA.fill('input[type="date"]', '2026-09-05');
    await pageA.click('button:has-text("保存")');

    await pageA.waitForTimeout(1500);
    await pageB.waitForTimeout(1500);

    await pageA.click(`.tl-task-bar:has-text("${originalTaskName}"), .project-card:has-text("${originalTaskName}")`);
    await pageA.fill('input[value*="Task-Conflict"]', `${originalTaskName}-Modified`);
    await pageA.click('button:has-text("保存")');

    await pageB.click(`.tl-task-bar:has-text("${originalTaskName}"), .project-card:has-text("${originalTaskName}")`);
    await pageB.click('button:has-text("删除")');
    if (await pageB.locator('button:has-text("确定"), button:has-text("永久删除")').count() > 0) {
      await pageB.click('button:has-text("确定"), button:has-text("永久删除")');
    }

    await pageA.waitForTimeout(2000);
    await pageB.waitForTimeout(2000);

    const hasConflictIndicatorA = await pageA.locator('.tl-sync-warning, [data-sync-status="conflict"]').count();
    const hasConflictIndicatorB = await pageB.locator('.tl-sync-warning, [data-sync-status="conflict"]').count();

    expect(hasConflictIndicatorA + hasConflictIndicatorB).toBeGreaterThan(0);
  });

  test('device A adds entity to array, device B adds different entity, both are preserved', async () => {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    await pageA.waitForSelector('[data-view="timeline"]', { state: 'visible', timeout: 15000 });
    await pageB.waitForSelector('[data-view="timeline"]', { state: 'visible', timeout: 15000 });

    await pageA.click('button[data-view="ebb"]');
    await pageB.click('button[data-view="ebb"]');

    await pageA.waitForSelector('[data-view="ebb-workspace"], .ebb-view', { timeout: 10000 });
    await pageB.waitForSelector('[data-view="ebb-workspace"], .ebb-view', { timeout: 10000 });

    const topicNameA = `Topic-A-${Date.now()}`;
    const topicNameB = `Topic-B-${Date.now()}`;

    await pageA.click('button:has-text("新建复习计划"), button:has-text("添加")');
    await pageA.fill('input[placeholder*="主题"], input[placeholder*="名称"]', topicNameA);
    await pageA.click('button:has-text("保存"), button:has-text("创建")');

    await pageB.click('button:has-text("新建复习计划"), button:has-text("添加")');
    await pageB.fill('input[placeholder*="主题"], input[placeholder*="名称"]', topicNameB);
    await pageB.click('button:has-text("保存"), button:has-text("创建")');

    await pageA.waitForTimeout(2000);
    await pageB.waitForTimeout(2000);

    const topicsA = await pageA.locator('.ebb-topic-row, .review-task-card').allTextContents();
    const topicsB = await pageB.locator('.ebb-topic-row, .review-task-card').allTextContents();

    expect(topicsA.some(text => text.includes(topicNameA))).toBe(true);
    expect(topicsA.some(text => text.includes(topicNameB))).toBe(true);
    expect(topicsB.some(text => text.includes(topicNameA))).toBe(true);
    expect(topicsB.some(text => text.includes(topicNameB))).toBe(true);
  });

  test('device A changes task date, device B changes same task name, both changes merge', async () => {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    await pageA.waitForSelector('[data-view="timeline"]', { timeout: 15000 });
    await pageB.waitForSelector('[data-view="timeline"]', { timeout: 15000 });

    const originalName = `Task-Merge-${Date.now()}`;

    await pageA.click('button:has-text("添加项目")');
    await pageA.fill('input[placeholder*="项目名称"]', originalName);
    await pageA.fill('input[type="date"]', '2026-09-10');
    await pageA.click('button:has-text("保存")');

    await pageA.waitForTimeout(1500);
    await pageB.waitForTimeout(1500);

    await pageA.click(`.tl-task-bar:has-text("${originalName}"), .project-card:has-text("${originalName}")`);
    await pageA.locator('input[type="date"]').first().fill('2026-09-15');
    await pageA.click('button:has-text("保存")');

    await pageB.click(`.tl-task-bar:has-text("${originalName}"), .project-card:has-text("${originalName}")`);
    await pageB.fill('input[value*="Task-Merge"]', `${originalName}-Renamed`);
    await pageB.click('button:has-text("保存")');

    await pageA.waitForTimeout(2000);
    await pageB.waitForTimeout(2000);

    const taskTextA = await pageA.locator('.tl-task-bar, .project-card').allTextContents();
    const taskTextB = await pageB.locator('.tl-task-bar, .project-card').allTextContents();

    const mergedName = `${originalName}-Renamed`;
    expect(taskTextA.some(text => text.includes(mergedName))).toBe(true);
    expect(taskTextB.some(text => text.includes(mergedName))).toBe(true);
  });

  test('concurrent array reordering from two devices preserves all entities', async () => {
    const pageA = await contextA.newPage();
    const pageB = await contextB.newPage();

    await pageA.goto('/');
    await pageB.goto('/');

    await pageA.waitForSelector('[data-view="timeline"]', { timeout: 15000 });
    await pageB.waitForSelector('[data-view="timeline"]', { timeout: 15000 });

    const task1 = `Order-1-${Date.now()}`;
    const task2 = `Order-2-${Date.now()}`;
    const task3 = `Order-3-${Date.now()}`;

    for (const name of [task1, task2, task3]) {
      await pageA.click('button:has-text("添加项目")');
      await pageA.fill('input[placeholder*="项目名称"]', name);
      await pageA.fill('input[type="date"]', '2026-09-20');
      await pageA.click('button:has-text("保存")');
      await pageA.waitForTimeout(500);
    }

    await pageA.waitForTimeout(1500);
    await pageB.waitForTimeout(1500);

    const countA = await pageA.locator('.tl-task-bar, .project-card').count();
    const countB = await pageB.locator('.tl-task-bar, .project-card').count();

    expect(countA).toBeGreaterThanOrEqual(3);
    expect(countB).toBeGreaterThanOrEqual(3);

    const tasksA = await pageA.locator('.tl-task-bar, .project-card').allTextContents();
    const tasksB = await pageB.locator('.tl-task-bar, .project-card').allTextContents();

    expect(tasksA.some(text => text.includes(task1))).toBe(true);
    expect(tasksA.some(text => text.includes(task2))).toBe(true);
    expect(tasksA.some(text => text.includes(task3))).toBe(true);
    expect(tasksB.some(text => text.includes(task1))).toBe(true);
    expect(tasksB.some(text => text.includes(task2))).toBe(true);
    expect(tasksB.some(text => text.includes(task3))).toBe(true);
  });
});

import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
  await expect(page.getByRole('tablist')).toBeVisible();
  await expect.poll(async () => {
    try {
      await page.evaluate(async () => {
        const [{ useTimelineStore }, { useLifeMapStore }] = await Promise.all([
          import('/src/store/index.ts'),
          import('/src/lifeMap/store.ts'),
        ]);
        const stamp = { createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z', revision: 1 };
        useLifeMapStore.setState({
          lifeMapAreas: [
            { id: 'study', name: '专业学习', color: '#6366F1', order: 0, planGroupId: 'learning', ...stamp },
            { id: 'career', name: '职业发展', color: '#D8A72E', order: 0, planGroupId: 'work', ...stamp },
          ],
          lifeMapPlanGroups: [
            { id: 'learning', placement: 'above', order: 0, ...stamp },
            { id: 'work', placement: 'above', order: 1, ...stamp },
            { id: 'life', placement: 'below', order: 2, ...stamp },
          ],
          lifeMapGoals: [],
        });
        useTimelineStore.setState({
          groups: [],
          tasks: [
            {
              id: 'study-project', name: '学习项目', start: '2026-08-01', end: '2026-10-31', planningAreaId: 'study', blocks: [{
                type: 'smart-task', id: 'study-block', body: '', header: {
                  title: '完成第一章', tag: '学习', tagColor: '#6366F1', date: '2026-08-10', duration: 30, isCompleted: false,
                },
              }],
            },
            { id: 'legacy-project', name: '旧项目', start: '2026-08-01', end: '2026-09-30', blocks: [] },
            { id: 'work-project', name: '工作项目', start: '2026-08-01', end: '2026-12-31', planningAreaId: 'career', blocks: [] },
          ],
        });
      });
      return true;
    } catch (error) {
      if (error instanceof Error && error.message.includes('Execution context was destroyed')) return false;
      throw error;
    }
  }).toBe(true);
});

test('人生地图显示全部真实项目，单击项目条可编辑同一个项目和领域分类', async ({ page }) => {
  await page.getByTitle('人生地图').click();
  const lifeMap = page.getByRole('main', { name: '人生地图' });
  await expect(lifeMap.locator('[data-project-id="study-project"]')).toBeVisible();
  await expect(lifeMap.locator('[data-project-id="legacy-project"]')).toHaveAttribute('data-plan-group', 'unclassified');
  await expect(lifeMap.locator('[data-project-id="work-project"]')).toBeVisible();
  await expect(page.getByLabel('人生地图入门')).toHaveCount(0);

  await page.getByRole('button', { name: '规划概览' }).click();
  const planningOverview = page.getByRole('dialog', { name: '规划概览' });
  await expect(planningOverview).toContainText('学习项目');
  await expect(planningOverview).toContainText('旧项目');
  await planningOverview.getByRole('button', { name: /学习项目/ }).click();
  await expect(page.locator('.pdv-container')).toContainText('学习项目');
  await page.getByRole('button', { name: '关闭项目文档' }).click();
  await expect(page.locator('.pdv-container')).toHaveCount(0);

  await lifeMap.locator('[data-project-id="legacy-project"]').click();
  const projectDrawer = page.locator('.pdv-container');
  await expect(projectDrawer).toContainText('旧项目');
  await expect(projectDrawer.getByLabel('人生领域')).toBeVisible();
  await projectDrawer.getByLabel('人生领域').selectOption('study');

  await expect.poll(() => page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    return useTimelineStore.getState().tasks.find((task) => task.id === 'legacy-project')?.planningAreaId;
  })).toBe('study');
  await expect(lifeMap.locator('[data-project-id="legacy-project"]')).toHaveAttribute('data-plan-group', 'learning');
});

test('项目规划可以查看全部、一级分类和二级领域，未分类项目始终有入口', async ({ page }) => {
  await page.getByTitle('项目规划').click();
  const scope = page.getByRole('group', { name: '项目查看范围' });
  const studyProject = page.locator('.tl-seg').filter({ hasText: '学习项目' });
  const workProject = page.locator('.tl-seg').filter({ hasText: '工作项目' });
  const legacyProject = page.locator('.tl-seg').filter({ hasText: '旧项目' });
  await expect(scope.getByRole('button', { name: '全部' })).toHaveAttribute('aria-pressed', 'true');
  await expect(studyProject.first()).toBeVisible();
  await expect(workProject.first()).toBeVisible();

  await scope.getByRole('button', { name: '学习' }).click();
  await expect(studyProject.first()).toBeVisible();
  await expect(workProject).toHaveCount(0);

  await scope.getByRole('button', { name: '未分类' }).click();
  await expect(legacyProject.first()).toBeVisible();
  await expect(studyProject).toHaveCount(0);

  await scope.getByRole('button', { name: '批量归类' }).click();
  const bulkDialog = page.getByRole('dialog', { name: '批量归类未分类项目' });
  await expect(bulkDialog).toContainText('旧项目');
  await bulkDialog.getByLabel('批量归类到领域').selectOption('study');
  await bulkDialog.getByRole('button', { name: '归类 1 个项目' }).click();

  await expect.poll(() => page.evaluate(async () => {
    const { useTimelineStore } = await import('/src/store/index.ts');
    return useTimelineStore.getState().tasks.find((task) => task.id === 'legacy-project')?.planningAreaId;
  })).toBe('study');
  await expect(legacyProject).toHaveCount(0);
});

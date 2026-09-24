import { expect, test } from '@playwright/test';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const tomorrow = (() => {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(year, month - 1, day + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
})();

const nextWeek = (() => {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(year, month - 1, day + 8);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
})();

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto('/');
});

test('week date opens that exact daily date and returns to the same week', async ({ page }) => {
  await page.getByTitle('周矩阵').click();
  await page.locator(`.wmv-cell--date[data-date="${tomorrow}"]`).click();

  await expect(page.locator('.ds-date-input')).toHaveValue(tomorrow);
  await page.getByRole('button', { name: '返回本周' }).click();

  await expect(page.locator('#view-week-matrix')).toBeVisible();
  await expect(page.locator(`.wmv-cell--date[data-date="${tomorrow}"]`)).toBeVisible();
});

test('milestones appear on their exact date without becoming schedulable tasks', async ({ page }) => {
  await page.evaluate(async ({ selectedDate, otherDate }) => {
    const { useTimelineStore } = await import('/src/testing/workspaceStoreAccess.ts');
    useTimelineStore.setState({
      tasks: [],
      groups: [],
      milestones: [
        { id: 'milestone-launch', name: '版本上线', date: selectedDate, color: '#F59E0B' },
        { id: 'milestone-review', name: '验收评审', date: selectedDate, color: '#8B5CF6' },
        { id: 'milestone-future', name: '下周节点', date: otherDate, color: '#10B981' },
      ],
    });
  }, { selectedDate: today, otherDate: nextWeek });

  await page.getByTitle('每日安排').click();
  const headerMilestones = page.locator('.ds-header-milestones');
  await expect(headerMilestones).toContainText('版本上线');
  await expect(headerMilestones).toContainText('验收评审');
  await expect(headerMilestones).not.toContainText('下周节点');
  await expect(page.locator('.ds-day-overview')).toContainText('0 项已安排');

  await page.getByTitle('周矩阵').click();
  const todayCell = page.locator(`.wmv-cell--date[data-date="${today}"]`);
  await expect(todayCell).toContainText('版本上线');
  await expect(todayCell).toContainText('+1');
  await expect(todayCell.locator('.wmv-date-milestone')).toHaveAttribute('title', '版本上线、验收评审');
  await expect(page.locator('.wmv-date-milestone')).toHaveCount(1);
  await expect(page.locator('.wmv-block-card')).toHaveCount(0);
  await expect(page.getByText('当前周暂无已排期项目任务')).toBeVisible();

  await page.locator('.wmv-group-switch').getByRole('button', { name: '项目' }).click();
  await expect(todayCell).toContainText('版本上线');
});

import { expect, test } from '@playwright/test';

const today = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

const tomorrow = (() => {
  const [year, month, day] = today.split('-').map(Number);
  const date = new Date(year, month - 1, day + 1);
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

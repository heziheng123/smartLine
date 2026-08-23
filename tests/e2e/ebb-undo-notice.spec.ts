import { expect, test } from '@playwright/test';

test('undo notice disappears without clearing the undo action', async ({ page }) => {
  await page.addInitScript(() => localStorage.clear());
  await page.goto('/');
  await page.getByTitle('艾宾浩斯复习').click();

  await page.evaluate(async () => {
    const { recordOperation } = await import('/src/services/operationHistory.ts');
    recordOperation({
      label: '测试调整 3 个复习轮次',
      detail: '',
      modules: ['EBB'],
    }, () => undefined);
  });

  const notice = page.locator('.eb-undo-bar');
  await expect(notice).toContainText('测试调整 3 个复习轮次');
  await expect(notice).toBeHidden({ timeout: 9000 });

  const canStillUndo = await page.evaluate(async () => {
    const { useOperationHistory } = await import('/src/services/operationHistory.ts');
    return useOperationHistory.getState().entries[0]?.canUndo;
  });
  expect(canStillUndo).toBe(true);
});

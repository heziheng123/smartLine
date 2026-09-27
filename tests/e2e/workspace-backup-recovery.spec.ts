import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect.poll(() => page.evaluate(async () => {
    const stores = await import('/src/testing/workspaceStoreAccess.ts');
    return [stores.useTimelineStore, stores.useEbbStore, stores.useDailyScheduleStore,
      stores.useGraphStore, stores.useLifeMapStore].every((store) => store.getState().isHydrated);
  })).toBe(true);
  await page.getByTitle('每日安排').click();
  await expect(page.getByLabel('每日安排工作区')).toBeVisible();
});

for (const previous of [null, '{"density":"compact"}']) {
  test(`failed backup restore rolls back view preferences (${previous === null ? 'absent' : 'existing'})`, async ({ page }) => {
    const result = await page.evaluate(async (previous) => {
      const key = 'smart-timeline-view-preferences-v2';
      if (previous === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previous);
      const { createWorkspaceBackupWithMindMap, restoreWorkspaceBackup } = await import('/src/services/workspaceBackup.ts');
      const { mindMapRepository } = await import('/src/mindMap/repository.ts');
      const backup = await createWorkspaceBackupWithMindMap();
      backup.settings.timelineViewPreferences = { density: 'detailed' };
      const replace = mindMapRepository.replaceFromBundle.bind(mindMapRepository);
      let fail = true;
      mindMapRepository.replaceFromBundle = async (bundle) => {
        if (fail) { fail = false; throw new Error('simulated map write failure'); }
        return replace(bundle);
      };
      let error = '';
      try { await restoreWorkspaceBackup(backup); }
      catch (reason) { error = reason instanceof Error ? reason.message : String(reason); }
      finally { mindMapRepository.replaceFromBundle = replace; }
      return { error, preferences: localStorage.getItem(key) };
    }, previous);
    expect(result).toEqual({ error: 'simulated map write failure', preferences: previous });
  });
}

test('restoring a legacy backup preserves local reviews and unsaved text drafts', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const { createWorkspaceBackup, restoreWorkspaceBackup } = await import('/src/services/workspaceBackup.ts');
    const { createDailyReview, appendTextSegment } = await import('/src/review/model.ts');
    const repo = await import('/src/review/repository.ts');
    const review = appendTextSegment(createDailyReview('2026-09-27'), 'keep local record');
    await repo.saveDailyReview(review);
    await repo.saveReviewTextDrafts({ '2026-09-27': 'keep local draft' });
    await restoreWorkspaceBackup(createWorkspaceBackup());
    return { reviews: await repo.loadDailyReviews(), drafts: await repo.loadReviewTextDrafts(), id: review.id };
  });
  expect(result.reviews.map((review) => review.id)).toContain(result.id);
  expect(result.drafts).toEqual({ '2026-09-27': 'keep local draft' });
});

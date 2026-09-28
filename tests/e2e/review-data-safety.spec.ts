import { expect, test, type Page } from '@playwright/test';
import type { DailyReview } from '../../src/review/model';

const date = '2026-09-27';
async function openHarness(page: Page) {
  await page.route('**/__regression__', (route) => route.fulfill({ contentType: 'text/html', body: `
    <html><body><div id="probe"></div><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$ = () => {};
      window.$RefreshSig$ = () => type => type;
      window.__vite_plugin_react_preamble_installed__ = true;
    </script></body></html>` }));
  await page.goto('/__regression__');
}
async function mountReview(page: Page, dates: string[], withSections = false, conflict?: { review: DailyReview; serverRevision: number }) {
  await page.evaluate(async ({ dates, date, withSections, conflict }) => {
    const { createElement, createRoot } = await import('/src/testing/reactTestAccess.ts');
    const { AuthContext } = await import('/src/auth/AuthContext.ts');
    const { default: ReviewView } = await import('/src/review/components/ReviewView.tsx');
    const model = await import('/src/review/model.ts');
    const repo = await import('/src/review/repository.ts');
    const reviews = dates.map((day) => {
      let review = model.appendTextSegment(model.createDailyReview(day), 'old record');
      if (withSections) review = model.addReviewItem(review, 'problems', `problem on ${day}`);
      if (withSections && day === '2026-09-26') review = model.addReviewItem(review, 'progress', 'older progress');
      if (withSections && day === '2026-09-26') review = model.addReviewAnnotation(review, 'problem', 0, 3);
      return review;
    });
    await repo.saveDailyReviews(reviews);
    if (conflict) await repo.saveReviewSyncStates({ [reviews[0]!.id]: { serverRevision: conflict.serverRevision, status: 'conflict', remoteReview: conflict.review } });
    createRoot(document.getElementById('probe')!).render(createElement(AuthContext.Provider, {
      value: { enabled: true, status: 'authenticated', userId: 'regression', logout: async () => {}, retry: () => {} },
    }, createElement(ReviewView, { targetDate: date, onClose: () => {} })));
  }, { dates, date, withSections, conflict });
  await expect(page.getByRole('button', { name: '保存为记录', exact: true })).toBeVisible();
}
async function readReviews(page: Page) {
  return page.evaluate(async () => (await import('/src/review/repository.ts')).loadDailyReviews());
}

test('all records shows local days and opens cloud-only days without changing saved local records', async ({ page }) => {
  await openHarness(page);
  const { addReviewItem, appendTextSegment, createDailyReview } = await import('../../src/review/model.ts');
  const remote = addReviewItem(appendTextSegment(createDailyReview('2026-09-25'), 'cloud-only record'), 'problems', 'cloud problem');
  await page.route('**/api/review-list*', (route) => route.fulfill({ json: { entries: [{ reviewDate: remote.reviewDate, revision: 1, status: 'draft', updatedAt: remote.updatedAt, segments: [{ id: remote.inputSegments[0]!.id, type: 'text', capturedAt: remote.inputSegments[0]!.capturedAt, text: 'cloud-only record' }], items: [{ itemId: remote.workingDraft.items[0]!.itemId, section: 'problems', text: 'cloud problem' }], annotations: [], snapshots: [] }], nextCursor: null } }));
  await page.route('**/api/reviews/2026-09-25', (route) => route.fulfill({ json: { review: remote, serverRevision: 1 } }));
  await mountReview(page, ['2026-09-27', '2026-09-26'], true);
  await page.getByRole('button', { name: '所有记录' }).click();
  const localDay = page.locator('.review-archive__day').filter({ hasText: '2026-09-26' });
  await expect(localDay).toContainText('old record');
  await expect(localDay.locator('.review-archive__raw')).toBeVisible();
  await expect(localDay).toContainText('problem on 2026-09-26');
  const cloudDay = page.locator('.review-archive__day').filter({ hasText: '2026-09-25' });
  await expect(cloudDay).toContainText('cloud-only record');
  await expect(cloudDay).toContainText('cloud problem');
  await page.getByRole('button', { name: '按类别汇总' }).click();
  await expect(page.getByText('问题与原因：3 天 · 4 条')).toBeVisible();
  await expect(page.locator('.review-archive__day')).toHaveCount(3);
  await expect(localDay).toContainText('原文标注 · 问题');
  await page.locator('.review-archive__categories').getByRole('button', { name: /今日进展/ }).click();
  await expect(page.locator('.review-archive__day')).toHaveCount(1);
  await expect(page.locator('.review-archive__day')).toContainText('older progress');
  await page.locator('.review-archive__categories').getByRole('button', { name: /问题与原因/ }).click();
  await page.getByLabel('开始日期').fill('2026-09-26');
  await expect(cloudDay).toHaveCount(0);
  await page.getByLabel('开始日期').fill('');
  await expect(cloudDay).toBeVisible();
  expect((await readReviews(page)).map((review) => review.reviewDate)).toEqual(['2026-09-27', '2026-09-26']);
  await cloudDay.getByRole('button', { name: '打开当天复盘' }).click();
  await expect(page.getByText('每日复盘 · 2026-09-25')).toBeVisible();
  await expect(page.locator('.review-paper')).toContainText('cloud-only record');
});

test('all records keeps both local and newer cloud content available for merge', async ({ page }) => {
  await openHarness(page);
  const { appendTextSegment, createDailyReview } = await import('../../src/review/model.ts');
  const remote = appendTextSegment(createDailyReview('2026-09-27'), 'newer cloud record');
  await page.route('**/api/review-list*', (route) => route.fulfill({ json: { entries: [{ reviewDate: remote.reviewDate, revision: 4, status: 'draft', updatedAt: remote.updatedAt, segments: [{ id: remote.inputSegments[0]!.id, type: 'text', capturedAt: remote.inputSegments[0]!.capturedAt, text: 'newer cloud record' }], items: [], annotations: [], snapshots: [] }], nextCursor: null } }));
  await page.route('**/api/reviews/2026-09-27', (route) => route.fulfill({ json: { review: remote, serverRevision: 4 } }));
  await mountReview(page, ['2026-09-27']);
  await page.getByRole('button', { name: '所有记录' }).click();
  const day = page.locator('.review-archive__day').filter({ hasText: '2026-09-27' });
  await expect(day).toContainText('云端版本待核对');
  await expect(day).toContainText('old record');
  await expect(day.locator('.review-archive__cloud')).toContainText('newer cloud record');
  expect((await readReviews(page))[0]?.inputSegments[0]?.type).toBe('text');
  await day.getByRole('button', { name: '打开当天复盘' }).click();
  await expect(page.getByRole('button', { name: '合并两台设备记录' })).toBeVisible();
  await page.getByRole('button', { name: '合并两台设备记录' }).click();
  await expect(page.locator('.review-paper')).toContainText('old record');
  await expect(page.locator('.review-paper')).toContainText('newer cloud record');
});

test('all records shows a saved conflict even when the cloud list is unavailable', async ({ page }) => {
  await openHarness(page);
  const { addReviewItem, appendTextSegment, createDailyReview } = await import('../../src/review/model.ts');
  const remote = addReviewItem(appendTextSegment(createDailyReview(date), 'saved cloud record'), 'problems', 'saved cloud problem');
  const other = addReviewItem(createDailyReview('2026-09-26'), 'problems', 'recovered cloud problem');
  let recovered = false;
  await page.route('**/api/review-list*', (route) => route.fulfill(recovered
    ? { json: { entries: [{ reviewDate: other.reviewDate, revision: 1, status: 'draft', updatedAt: other.updatedAt, segments: [], items: [{ itemId: other.workingDraft.items[0]!.itemId, section: 'problems', text: 'recovered cloud problem' }], annotations: [], snapshots: [] }], nextCursor: null } }
    : { status: 503, json: { error: 'offline' } }));
  await mountReview(page, [date], false, { review: remote, serverRevision: 4 });
  await page.getByRole('button', { name: '所有记录' }).click();
  await expect(page.getByRole('button', { name: '立即同步' })).toHaveCount(0);
  const day = page.locator('.review-archive__day').filter({ hasText: date });
  await expect(day).toContainText('同步冲突');
  await expect(day.locator('.review-archive__cloud')).toContainText('saved cloud record');
  await page.getByRole('button', { name: '按类别汇总' }).click();
  await expect(day).toContainText('saved cloud problem');
  recovered = true;
  await page.getByRole('button', { name: '重试读取云端' }).click();
  await expect(page.locator('.review-archive__day').filter({ hasText: '2026-09-26' })).toContainText('recovered cloud problem');
  await day.getByRole('button', { name: '打开当天复盘' }).click();
  await expect(page.getByRole('button', { name: '合并两台设备记录' })).toBeVisible();
});

test('AI completion preserves records saved while the request is pending', async ({ page }) => {
  await openHarness(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route('**/api/reviews/**', async (route) => {
    if (route.request().url().endsWith('/structure')) {
      requested = true;
      await pending;
      await route.fulfill({ json: { candidates: [], annotations: [] } });
    } else if (route.request().method() === 'GET') await route.fulfill({ status: 404, json: {} });
    else await route.fulfill({ json: { review: route.request().postDataJSON().review, serverRevision: 1 } });
  });
  await mountReview(page, [date]);
  await page.getByRole('button', { name: 'AI 分析原文', exact: true }).click();
  await expect.poll(() => requested).toBe(true);
  await page.locator('.review-card--source textarea').fill('new record during AI request');
  await page.getByRole('button', { name: '保存为记录', exact: true }).click();
  await expect.poll(async () => (await readReviews(page))[0]?.inputSegments.length).toBe(2);
  release();
  await expect(page.getByRole('alert')).toContainText('整理期间内容已更新');
  expect((await readReviews(page))[0].inputSegments).toHaveLength(2);
});

test('cloud records and revision baselines survive editing another date', async ({ page }) => {
  await openHarness(page);
  const remote = await page.evaluate(async () => {
    const model = await import('/src/review/model.ts');
    return { ...model.appendTextSegment(model.createDailyReview('2026-09-27'), 'cloud new date'), revision: 7 };
  });
  let submittedBase: number | null | undefined;
  await page.route('**/api/reviews/**', async (route) => {
    const currentDate = route.request().url().split('/').at(-1);
    if (route.request().method() === 'GET') {
      await route.fulfill(currentDate === date ? { json: { review: remote, serverRevision: 7 } } : { status: 404, json: {} });
    } else {
      const body = route.request().postDataJSON();
      if (currentDate === date) submittedBase = body.baseRevision;
      await route.fulfill({ json: { review: body.review, serverRevision: currentDate === date ? 8 : 1 } });
    }
  });
  await mountReview(page, ['2026-09-26']);
  await expect(page.getByText('cloud new date', { exact: true }).first()).toBeVisible();
  await expect.poll(() => page.evaluate(async (id) => (await (await import('/src/review/repository.ts')).loadReviewSyncStates())[id]?.serverRevision, remote.id)).toBe(7);
  await page.locator('.review-history-drawer > summary').last().click();
  await page.getByRole('button', { name: /2026-09-26/ }).click();
  await page.locator('.review-card--source textarea').fill('edit older date');
  await page.getByRole('button', { name: '保存为记录', exact: true }).click();
  await expect.poll(async () => (await readReviews(page)).map((review) => review.reviewDate)).toEqual([date, '2026-09-26']);
  await page.getByRole('button', { name: /2026-09-27/ }).click();
  await page.locator('.review-card--source textarea').fill('edit cloud date');
  await page.getByRole('button', { name: '保存为记录', exact: true }).click();
  await expect.poll(() => submittedBase).toBe(7);
});

test('StrictMode effect replay allows voice recording to start', async ({ page }) => {
  await openHarness(page);
  await page.evaluate(async () => {
    const { createElement, createRoot, StrictMode } = await import('/src/testing/reactTestAccess.ts');
    const { default: VoiceCaptureButton } = await import('/src/review/components/VoiceCaptureButton.tsx');
    const { LocalOnlyAudioCapture } = await import('/src/review/audio.ts');
    LocalOnlyAudioCapture.prototype.start = async function () {};
    LocalOnlyAudioCapture.prototype.interrupt = function () {};
    createRoot(document.getElementById('probe')!).render(createElement(StrictMode, {}, createElement(VoiceCaptureButton, {
      retention: 'delete_after_transcription', onStarted: () => { document.body.dataset.started = 'yes'; },
      onPaused: () => {}, onFinished: () => {}, onError: (message) => { throw new Error(message); },
    })));
  });
  await page.getByRole('button', { name: '开始说', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停思考', exact: true })).toBeVisible();
  await expect(page.locator('body')).toHaveAttribute('data-started', 'yes');
});

test('pausing a recording after switching dates saves audio on its original review', async ({ page }) => {
  await openHarness(page);
  await page.evaluate(async () => {
    const { createElement, createRoot } = await import('/src/testing/reactTestAccess.ts');
    const { default: ReviewView } = await import('/src/review/components/ReviewView.tsx');
    const { AuthContext } = await import('/src/auth/AuthContext.ts');
    const { LocalOnlyAudioCapture } = await import('/src/review/audio.ts');
    const model = await import('/src/review/model.ts');
    const repo = await import('/src/review/repository.ts');
    localStorage.setItem('smart-line-review-voice-consent-v1', 'accepted');
    await repo.saveDailyReviews(['2026-09-27', '2026-09-26'].map((day) => model.createDailyReview(day)));
    LocalOnlyAudioCapture.prototype.start = async function () {};
    LocalOnlyAudioCapture.prototype.interrupt = function () {};
    LocalOnlyAudioCapture.prototype.stop = async function () {
      return { segmentId: (this as unknown as { segmentId: string }).segmentId,
        mimeType: 'audio/wav', durationMs: 1_000, chunkCount: 1, byteLength: 32_000, sampleRate: 16_000 };
    };
    createRoot(document.getElementById('probe')!).render(createElement(AuthContext.Provider, {
      value: { enabled: false, status: 'authenticated', logout: async () => {}, retry: () => {} },
    }, createElement(ReviewView, { targetDate: '2026-09-27', onClose: () => {} })));
  });
  await page.getByRole('button', { name: '开始说', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停思考', exact: true })).toBeVisible();
  await page.locator('.review-history-drawer > summary').last().click();
  await page.getByRole('button', { name: /2026-09-26/ }).click();
  await page.getByRole('button', { name: '暂停思考', exact: true }).click();
  await expect(page.getByRole('button', { name: '继续说', exact: true })).toBeVisible();
  const reviews = await readReviews(page);
  const segment = reviews.find((review) => review.reviewDate === '2026-09-27')!.inputSegments[0];
  expect(segment).toMatchObject({ type: 'voice', transcriptionState: 'waiting_transcription', audio: { durationMs: 1_000 } });
  expect(reviews.find((review) => review.reviewDate === '2026-09-26')!.inputSegments).toHaveLength(0);
});

test('a delayed server acknowledgement preserves newer locally saved content', async ({ page }) => {
  await openHarness(page);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  let requested = false;
  await page.route('**/api/reviews/**', async (route) => {
    requested = true;
    await pending;
    const body = route.request().postDataJSON();
    await route.fulfill({ json: { review: body.review, serverRevision: 2 } });
  });
  await page.evaluate(async () => {
    const model = await import('/src/review/model.ts');
    const repo = await import('/src/review/repository.ts');
    const sync = await import('/src/review/sync.ts');
    const review = model.appendTextSegment(model.createDailyReview('2026-09-27'), 'old');
    await repo.saveDailyReview(review);
    await sync.enqueueReviewSync(review);
    void sync.flushReviewOutbox();
    await repo.saveDailyReview(model.appendTextSegment(review, 'newer'));
  });
  await expect.poll(() => requested).toBe(true);
  release();
  await expect.poll(() => page.evaluate(async () => (await import('/src/review/repository.ts')).loadReviewOutbox())).toEqual([]);
  expect((await readReviews(page))[0].inputSegments).toHaveLength(2);
});

test('opening a review online retries a locally saved pending voice segment', async ({ page }) => {
  await openHarness(page);
  let requested = false;
  let saved: import('../../src/review/model').DailyReview | undefined;
  await page.route('**/api/reviews/**', async (route) => {
    if (route.request().method() === 'GET') { await route.fulfill({ status: 404, json: {} }); return; }
    if (route.request().url().endsWith('/transcribe')) {
      requested = true;
      const review = await page.evaluate(async (saved) => (await import('/src/review/model.ts'))
        .applyVoiceTranscript(saved, 'voice-reopen', 'recovered transcript', { operationId: 'transcribe-voice-reopen' }), saved!);
      await route.fulfill({ json: { transcript: 'recovered transcript', operationId: 'transcribe-voice-reopen', review, serverRevision: 2 } });
    } else {
      saved = route.request().postDataJSON().review;
      await route.fulfill({ json: { review: saved, serverRevision: 1 } });
    }
  });
  await page.evaluate(async () => {
    const { createElement, createRoot } = await import('/src/testing/reactTestAccess.ts');
    const { default: ReviewView } = await import('/src/review/components/ReviewView.tsx');
    const { AuthContext } = await import('/src/auth/AuthContext.ts');
    const { localReviewDeviceId } = await import('/src/review/audio.ts');
    const { createDedicatedStorage } = await import('/src/utils/persistence.ts');
    const model = await import('/src/review/model.ts');
    const repo = await import('/src/review/repository.ts');
    localStorage.setItem('smart-line-review-voice-consent-v1', 'accepted');
    await createDedicatedStorage('smart-line-review-audio', 'chunks').setItem('voice-chunk:voice-reopen:1', new Blob([new Uint8Array(32)]));
    await repo.saveDailyReviews([model.appendVoiceSegment(model.createDailyReview('2026-09-27'), {
      id: 'voice-reopen', type: 'voice', originDeviceId: localReviewDeviceId(), audioStorageScope: 'local_only',
      audioRetention: 'keep_7_days', transcriptionState: 'waiting_transcription',
      audio: { mimeType: 'audio/wav', durationMs: 1, chunkCount: 1, byteLength: 32, sampleRate: 16_000 },
    })]);
    createRoot(document.getElementById('probe')!).render(createElement(AuthContext.Provider, {
      value: { enabled: true, status: 'authenticated', userId: 'regression', logout: async () => {}, retry: () => {} },
    }, createElement(ReviewView, { targetDate: '2026-09-27', onClose: () => {} })));
  });
  await expect.poll(() => requested).toBe(true);
  await expect(page.getByRole('textbox', { name: '校对语音转写' })).toHaveValue('recovered transcript');
});

for (const succeeds of [true, false]) {
  test(`voice ${succeeds ? 'receipt' : 'failure'} preserves edits made during transcription`, async ({ page }) => {
    await openHarness(page);
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    let requested = false;
    let revision = 0;
    let receipt: import('../../src/review/model').DailyReview | undefined;
    await page.route('**/api/reviews/**', async (route) => {
      if (route.request().method() === 'GET') { await route.fulfill({ status: 404, json: {} }); return; }
      if (route.request().url().endsWith('/transcribe')) {
        const source = receipt!;
        requested = true;
        await pending;
        const review = await page.evaluate(async (source) => (await import('/src/review/model.ts')).applyVoiceTranscript(source, 'voice-test', 'recognized words', { operationId: 'transcribe-voice-test' }), source);
        await route.fulfill(succeeds ? { json: { transcript: 'recognized words', operationId: 'transcribe-voice-test', review, serverRevision: ++revision } }
          : { status: 503, json: { error: 'temporary ASR failure' } });
        return;
      }
      const body = route.request().postDataJSON();
      receipt = body.review;
      await route.fulfill({ json: { review: body.review, serverRevision: ++revision } });
    });
    // Seed actual local PCM storage to exercise the real WAV and
    // transcription path without requesting a physical microphone.
    await page.evaluate(async () => {
      const { createElement, createRoot } = await import('/src/testing/reactTestAccess.ts');
      const { default: ReviewView } = await import('/src/review/components/ReviewView.tsx');
      const { AuthContext } = await import('/src/auth/AuthContext.ts');
      const model = await import('/src/review/model.ts');
      const repo = await import('/src/review/repository.ts');
      const { createDedicatedStorage } = await import('/src/utils/persistence.ts');
      const { localReviewDeviceId } = await import('/src/review/audio.ts');
      await createDedicatedStorage('smart-line-review-audio', 'chunks').setItem('voice-chunk:voice-test:1', new Blob([new Uint8Array(32)]));
      await repo.saveDailyReviews([model.appendVoiceSegment(model.createDailyReview('2026-09-27'), {
        id: 'voice-test', type: 'voice', originDeviceId: localReviewDeviceId(), audioStorageScope: 'local_only',
        audioRetention: 'keep_7_days', transcriptionState: 'waiting_transcription',
        audio: { mimeType: 'audio/wav', durationMs: 1, chunkCount: 1, byteLength: 32, sampleRate: 16_000 },
      })]);
      createRoot(document.getElementById('probe')!).render(createElement(AuthContext.Provider, { value: { enabled: true, status: 'authenticated', userId: 'regression', logout: async () => {}, retry: () => {} } },
        createElement(ReviewView, { targetDate: '2026-09-27', onClose: () => {} })));
    });
    await page.getByRole('button', { name: '完成并识别', exact: true }).click();
    await expect.poll(() => requested).toBe(true);
    await page.locator('.review-card--source textarea').fill('new record during transcription');
    await page.getByRole('button', { name: '保存为记录', exact: true }).click();
    await expect.poll(async () => (await readReviews(page))[0].inputSegments.length).toBe(2);
    release();
    if (succeeds) await expect(page.getByRole('textbox', { name: '校对语音转写' })).toHaveValue('recognized words');
    else await expect(page.getByRole('alert')).toContainText('temporary ASR failure');
    expect((await readReviews(page))[0].inputSegments).toHaveLength(2);
  });
}

test('complete backup and local snapshots restore review records and drafts', async ({ page }) => {
  await openHarness(page);
  const result = await page.evaluate(async () => {
    const repo = await import('/src/review/repository.ts');
    const model = await import('/src/review/model.ts');
    const backup = await import('/src/services/workspaceBackup.ts');
    const stores = await import('/src/testing/workspaceStoreAccess.ts');
    stores.useTimelineStore.setState({ isHydrated: true });
    stores.useEbbStore.setState({ isHydrated: true });
    stores.useDailyScheduleStore.setState({ isHydrated: true });
    stores.useGraphStore.setState({ isHydrated: true });
    stores.useLifeMapStore.setState({ isHydrated: true });
    const original = model.completeDailyReview(model.addReviewItem(model.appendTextSegment(model.createDailyReview('2026-09-27'), 'raw source'), 'progress', 'done'));
    await repo.saveDailyReview(original);
    await repo.saveReviewTextDrafts({ '2026-09-27': 'unsaved draft' });
    const exported = await backup.createWorkspaceBackupWithMindMap();
    const validated = backup.validateWorkspaceBackup(JSON.parse(JSON.stringify(exported)));
    if (!validated.backup || validated.errors.length) throw new Error(validated.errors.join(';'));
    const snapshot = await backup.createWorkspaceSnapshot(validated.backup, 'regression');
    const materialized = await backup.materializeWorkspaceSnapshot(snapshot);
    await repo.saveDailyReviews([]);
    await repo.saveReviewTextDrafts({});
    await backup.restoreWorkspaceBackup(materialized);
    return { bundle: materialized.reviews, reviews: await repo.loadDailyReviews(), drafts: await repo.loadReviewTextDrafts() };
  });
  expect(result.bundle?.reviews).toHaveLength(1);
  expect(result.reviews[0].completedVersions).toHaveLength(1);
  expect(result.reviews[0].inputSegments[0]).toMatchObject({ type: 'text', text: 'raw source' });
  expect(result.drafts[date]).toBe('unsaved draft');
});

for (const phase of ['hash', 'commit'] as const) {
test(`cloud changes during ${phase} keep the pending queue recoverable`, async ({ page }) => {
  await openHarness(page);
  const result = await page.evaluate(async (phase) => {
    const stores = await import('/src/testing/workspaceStoreAccess.ts');
    const backupModule = await import('/src/services/workspaceBackup.ts');
    const sync = await import('/src/services/workspaceSync.ts');
    const queue = await import('/src/services/workspaceSyncQueueCore.ts');
    const entity = await import('/src/services/workspaceEntityStorage.ts');
    const baseNote = { id: 'race-note', name: 'base name', date: '2026-09-27', type: 'pin' as const, color: '#111111' };
    const localNote = { ...baseNote, color: '#222222' };
    stores.useTimelineStore.setState({ isHydrated: true, notes: [localNote] });
    stores.useEbbStore.setState({ isHydrated: true });
    stores.useDailyScheduleStore.setState({ isHydrated: true });
    stores.useGraphStore.setState({ isHydrated: true });
    stores.useLifeMapStore.setState({ isHydrated: true });
    const backup = backupModule.createWorkspaceBackup();
    const rootData: Record<string, unknown> = { ...backup.timeline, ...backup.ebb, ...backup.lifeMap,
      nodes: backup.graph.nodes, schedules: backup.daily.schedules, notes: [baseNote], metadata: { schemaVersion: 10 } };
    let reads = 0;
    let injected = false;
    const injectRemote = () => {
      injected = true;
      const remote = [{ ...baseNote, name: 'new remote name' }];
      Object.assign(rootData, entity.buildWorkspaceEntityWrites(rootData, { notes: remote }, 'remote-write'));
      rootData.notes = remote;
    };
    const root = {
      toJSON() {
        reads++;
        const snapshot = structuredClone(rootData);
        if (reads === 2 && phase === 'commit') queueMicrotask(injectRemote);
        return snapshot;
      },
      set(key: string, value: unknown) { rootData[key] = value; },
    };
    const room = { id: 'regression-room', getStatus: () => 'connected', getStorageStatus: () => 'synchronized',
      getStorage: async () => ({ root }), batch: (callback: () => void) => callback() };
    const state = stores.useTimelineStore.getState();
    stores.useTimelineStore.setState({ liveblocks: { ...state.liveblocks, room: room as unknown as NonNullable<typeof state.liveblocks.room> } });
    await queue.queueWorkspaceFields({ notes: [localNote] }, { notes: [baseNote] }, { origin: 'user' });
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    crypto.subtle.digest = async (algorithm, data) => {
      const value = JSON.parse(new TextDecoder().decode(data)) as Record<string, unknown>;
      // The final submitted hash wraps fields in an object; earlier per-field
      // hashes use arrays. Inject during exactly that asynchronous preparation.
      if (phase === 'hash' && !injected && Object.keys(value).length === 1 && Array.isArray(value.notes)) injectRemote();
      return digest(algorithm, data);
    };
    let failed = false;
    let applied = 0;
    try { applied = (await sync.flushWorkspaceQueue()).applied; } catch { failed = true; }
    finally { crypto.subtle.digest = digest; }
    return { injected, failed, applied, notes: entity.materializeWorkspaceEntityRoot(rootData).notes,
      pending: Boolean(await queue.readPendingWorkspaceSync()) };
  }, phase);
  expect(result.injected).toBe(true);
  expect(result.failed).toBe(phase === 'commit');
  expect(result.applied).toBe(0);
  expect(result.notes).toEqual([expect.objectContaining({ name: 'new remote name' })]);
  expect(result.pending).toBe(true);
});
}

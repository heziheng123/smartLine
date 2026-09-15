import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReview } from '../../functions/_lib/reviews.ts';
import { appendTextSegment, appendVoiceSegment, completeDailyReview, createDailyReview } from '../../src/review/model.ts';
import { validateAiCandidates } from '../../functions/_lib/reviewAi.ts';

test('review persistence contract drops untrusted audio fields', () => {
  const review = createDailyReview('2026-09-14', '2026-09-14T08:00:00.000Z') as unknown as Record<string, unknown>;
  review.audioBase64 = 'must-not-reach-d1';
  const normalized = normalizeReview(review, '2026-09-14');

  assert.ok(normalized);
  assert.equal('audioBase64' in normalized, false);
  assert.equal(normalizeReview({ ...review, reviewDate: '2026-99-99' }, '2026-99-99'), null);
  assert.equal(normalizeReview({ ...review, reviewStatus: 'completed' }, '2026-09-14'), null);
  const completed = completeDailyReview(createDailyReview('2026-09-14', '2026-09-14T08:00:00.000Z'), '2026-09-14T08:01:00.000Z');
  assert.ok(normalizeReview(completed, '2026-09-14'));
});

test('AI result must cite an existing text segment', () => {
  const review = appendTextSegment(createDailyReview('2026-09-14', '2026-09-14T08:00:00.000Z'), '完成方案评审。', '2026-09-14T08:01:00.000Z');
  const normalized = normalizeReview(review, '2026-09-14');
  assert.ok(normalized);
  assert.deepEqual(validateAiCandidates({ items: [{ section: 'progress', text: '完成方案评审。', sourceSegmentIds: [review.inputSegments[0]!.id] }] }, normalized), [{ section: 'progress', text: '完成方案评审。', sourceSegmentIds: [review.inputSegments[0]!.id] }]);
  assert.equal(validateAiCandidates({ items: [{ section: 'progress', text: '凭空补充。', sourceSegmentIds: ['unknown'] }] }, normalized), null);
});

test('voice metadata can sync but original audio cannot enter D1', () => {
  const review = appendVoiceSegment(createDailyReview('2026-09-14', '2026-09-14T08:00:00.000Z'), {
    id: 'voice-segment-123456', type: 'voice', originDeviceId: 'review-device-123456', audioStorageScope: 'local_only', transcriptionState: 'waiting_transcription',
    audio: { mimeType: 'audio/wav', durationMs: 1_000, chunkCount: 1, byteLength: 32_000, sampleRate: 16_000 },
  }, '2026-09-14T08:01:00.000Z') as unknown as { audioBase64?: string; inputSegments: Array<{ audio?: Record<string, unknown> }> };
  review.audioBase64 = 'must-not-reach-d1';
  review.inputSegments[0]!.audio!.data = 'must-not-reach-d1';
  const normalized = normalizeReview(review, '2026-09-14');

  assert.ok(normalized);
  assert.equal(normalized.inputSegments[0]?.type, 'voice');
  assert.equal(JSON.stringify(normalized).includes('audioBase64'), false);
  assert.equal(JSON.stringify(normalized).includes('must-not-reach-d1'), false);
});

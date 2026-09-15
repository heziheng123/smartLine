import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeReview } from '../../functions/_lib/reviews.ts';
import { appendTextSegment, completeDailyReview, createDailyReview } from '../../src/review/model.ts';
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

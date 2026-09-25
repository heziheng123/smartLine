import assert from 'node:assert/strict';
import test from 'node:test';
import { activeReviewItems, addReviewItem, appendTextSegment, applyAiItems, completeDailyReview, createDailyReview, mergeDailyReviews, removeReviewItem, restoreCompletedVersion, updateTextSegment } from '../../src/review/model.ts';

test('daily review preserves source text and completed snapshots after later edits', () => {
  const created = createDailyReview('2026-09-14', '2026-09-14T08:00:00.000Z');
  const withSource = appendTextSegment(created, '完成了方案评审。', '2026-09-14T08:01:00.000Z');
  const withItem = addReviewItem(withSource, 'progress', '完成方案评审。', '2026-09-14T08:02:00.000Z');
  const completed = completeDailyReview(withItem, '2026-09-14T08:03:00.000Z');
  const editedAgain = addReviewItem(completed, 'adjustments', '明天开始文字 Core。', '2026-09-14T08:04:00.000Z');

  assert.equal(editedAgain.inputSegments[0]?.text, '完成了方案评审。');
  assert.equal(editedAgain.completedVersions[0]?.items.length, 1);
  assert.equal(completed.activeCompletedVersionId, completed.completedVersions[0]?.id);
  assert.equal(editedAgain.workingDraft.items.length, 2);
  assert.equal(editedAgain.reviewStatus, 'draft');
});

test('source changes refresh only unlocked AI items', () => {
  const review = appendTextSegment(createDailyReview('2026-09-14', '2026-09-14T08:00:00.000Z'), '完成方案评审。', '2026-09-14T08:01:00.000Z');
  const manual = addReviewItem(review, 'adjustments', '明天开始文字 Core。', '2026-09-14T08:02:00.000Z');
  const structured = applyAiItems(manual, [{ section: 'progress', text: '完成方案评审。', sourceSegmentIds: [review.inputSegments[0]!.id] }], '2026-09-14T08:03:00.000Z');
  const changed = updateTextSegment(structured, review.inputSegments[0]!.id, '完成了两次方案评审。', '2026-09-14T08:04:00.000Z');

  assert.deepEqual(changed.workingDraft.items.map((item) => item.text), ['明天开始文字 Core。']);
  assert.equal(changed.workingDraft.items[0]?.locked, true);
});

test('restoring a completed version creates a new editable draft', () => {
  const review = addReviewItem(createDailyReview('2026-09-14', '2026-09-14T08:00:00.000Z'), 'progress', '完成方案评审。', '2026-09-14T08:01:00.000Z');
  const completed = completeDailyReview(review, '2026-09-14T08:02:00.000Z');
  const restored = restoreCompletedVersion(completed, completed.completedVersions[0]!.id, '2026-09-14T08:03:00.000Z');

  assert.equal(restored.reviewStatus, 'draft');
  assert.equal(restored.workingDraft.items[0]?.text, '完成方案评审。');
  assert.equal(completed.completedVersions[0]?.items[0]?.text, '完成方案评审。');
});

test('deleted review items stay deleted when merged with an older device copy', () => {
  const original = addReviewItem(createDailyReview('2026-09-14', '2026-09-14T08:00:00.000Z'), 'progress', '已完成旧事项。', '2026-09-14T08:01:00.000Z');
  const deleted = removeReviewItem(original, original.workingDraft.items[0]!.itemId, '2026-09-14T08:02:00.000Z');
  const merged = mergeDailyReviews(deleted, original, '2026-09-14T08:03:00.000Z');

  assert.equal(activeReviewItems(deleted).length, 0);
  assert.equal(activeReviewItems(merged).length, 0);
  assert.ok(merged.workingDraft.items[0]?.deletedAt);
  assert.equal(completeDailyReview(merged, '2026-09-14T08:04:00.000Z').completedVersions[0]?.items.length, 0);
});

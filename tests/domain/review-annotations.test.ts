import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { reviewStructureRequest, validateAiAnalysis } from '../../functions/_lib/reviewAi.ts';
import { normalizeReview } from '../../functions/_lib/reviews.ts';
import {
  activeReviewAnnotations,
  activeTextVersion,
  addReviewAnnotation,
  appendTextSegment,
  applyAiAnalysis,
  createDailyReview,
  mergeDailyReviews,
  removeReviewAnnotation,
  updateReviewAnnotation,
  updateTextSegment,
} from '../../src/review/model.ts';
import { normalizeDailyReview } from '../../src/review/repository.ts';
import AnnotatedReviewText from '../../src/review/components/AnnotatedReviewText.tsx';

const createTextReview = (text: string) => appendTextSegment(createDailyReview('2026-09-24', '2026-09-24T08:00:00.000Z'), text, '2026-09-24T08:01:00.000Z');

test('one sentence can produce separate problem and reflection annotation ranges', () => {
  const review = createTextReview('英语没完成，因为刷手机太久。');
  const persisted = normalizeReview(review, review.reviewDate);
  assert.ok(persisted);
  const segmentId = review.inputSegments[0]!.id;
  const analysis = validateAiAnalysis({
    items: [],
    annotations: [
      { type: 'problem', sourceSegmentId: segmentId, quote: '英语没完成', summary: '计划没有完成。' },
      { type: 'reflection', sourceSegmentId: segmentId, quote: '刷手机太久', summary: '识别到用户明确表达的原因。' },
    ],
  }, persisted);

  assert.ok(analysis);
  assert.deepEqual(analysis.annotations.map((annotation) => annotation.type), ['problem', 'reflection']);
  assert.notEqual(analysis.annotations[0]?.start, analysis.annotations[1]?.start);
});

test('deleting or reclassifying an annotation never changes authoritative text', () => {
  const review = createTextReview('今天完成了数学练习。');
  const text = activeTextVersion(review).text;
  const annotated = addReviewAnnotation(review, 'progress', 2, 9, '2026-09-24T08:02:00.000Z');
  const annotationId = activeReviewAnnotations(annotated)[0]!.id;
  const reclassified = updateReviewAnnotation(annotated, annotationId, 'reflection', '2026-09-24T08:03:00.000Z');
  const removed = removeReviewAnnotation(reclassified, annotationId, '2026-09-24T08:04:00.000Z');

  assert.equal(activeTextVersion(reclassified).text, text);
  assert.equal(activeTextVersion(removed).text, text);
  assert.equal(activeReviewAnnotations(removed).length, 0);
});

test('AI reanalysis preserves manual annotations and resolves overlapping AI color', () => {
  const review = createTextReview('今天完成了数学练习。');
  const manual = addReviewAnnotation(review, 'reflection', 2, 9, '2026-09-24T08:02:00.000Z');
  const analyzed = applyAiAnalysis(manual, [], [{ type: 'progress', start: 2, end: 9, sourceSegmentIds: [review.inputSegments[0]!.id] }], '2026-09-24T08:03:00.000Z');
  const annotations = activeReviewAnnotations(analyzed);

  assert.equal(annotations.length, 1);
  assert.equal(annotations[0]?.type, 'reflection');
  assert.equal(annotations[0]?.createdBy, 'user');
});

test('transcript edits migrate only uniquely matched manual ranges and never reuse stale offsets', () => {
  const review = createTextReview('因为刷手机太久，英语没完成。');
  const segmentId = review.inputSegments[0]!.id;
  const start = activeTextVersion(review).text.indexOf('英语没完成');
  const annotated = addReviewAnnotation(review, 'problem', start, start + '英语没完成'.length, '2026-09-24T08:02:00.000Z');
  const shifted = updateTextSegment(annotated, segmentId, '下午因为刷手机太久，英语没完成。', '2026-09-24T08:03:00.000Z');
  const migrated = activeReviewAnnotations(shifted)[0]!;

  assert.notEqual(migrated.start, start);
  assert.equal(activeTextVersion(shifted).text.slice(migrated.start, migrated.end), '英语没完成');

  const ambiguous = updateTextSegment(shifted, segmentId, '英语没完成，晚上仍然英语没完成。', '2026-09-24T08:04:00.000Z');
  assert.equal(activeReviewAnnotations(ambiguous).length, 0);
  assert.equal(ambiguous.annotations.some((annotation) => annotation.id === migrated.id && annotation.stale), true);
});

test('adding another source segment keeps existing manual annotations', () => {
  const review = createTextReview('今天完成了数学练习。');
  const annotated = addReviewAnnotation(review, 'progress', 2, 9, '2026-09-24T08:02:00.000Z');
  const supplemented = appendTextSegment(annotated, '明天继续复习错题。', '2026-09-24T08:03:00.000Z');

  assert.equal(activeReviewAnnotations(supplemented).length, 1);
  assert.equal(activeReviewAnnotations(supplemented)[0]?.quotedText, '完成了数学练习');
  assert.match(activeTextVersion(supplemented).text, /明天继续复习错题/);
});

test('AI prioritizes only appended or edited segments without losing prior analysis context', () => {
  let review = createTextReview('第一段已经分析');
  const firstId = review.inputSegments[0]!.id;
  review = applyAiAnalysis(review, [], [{ type: 'progress', start: 0, end: 7, sourceSegmentIds: [firstId] }], '2026-09-24T08:01:00.000Z');
  const appended = appendTextSegment(review, '第二段刚补充', '2026-09-24T08:02:00.000Z');
  const appendBody = JSON.parse(reviewStructureRequest(appended as Parameters<typeof reviewStructureRequest>[0], 'deepseek-chat').body as string);
  assert.deepEqual(appendBody.input[0].content && JSON.parse(appendBody.input[0].content).newSegmentIds, [appended.inputSegments[1]!.id]);

  const edited = updateTextSegment(appended, firstId, '第一段已经修改', '2026-09-24T08:03:00.000Z');
  const editBody = JSON.parse(reviewStructureRequest(edited as Parameters<typeof reviewStructureRequest>[0], 'deepseek-chat').body as string);
  assert.deepEqual(new Set(JSON.parse(editBody.input[0].content).newSegmentIds), new Set(edited.inputSegments.map((segment) => segment.id)));
});

test('annotations survive JSON persistence normalization', () => {
  const review = addReviewAnnotation(createTextReview('今天完成了数学练习。'), 'progress', 2, 9, '2026-09-24T08:02:00.000Z');
  const restored = normalizeDailyReview(JSON.parse(JSON.stringify(review)));

  assert.ok(restored);
  assert.deepEqual(restored.annotations, review.annotations);
  assert.equal(activeTextVersion(restored).text, activeTextVersion(review).text);
});

test('multi-device merge keeps newer annotation edits and deletion tombstones', () => {
  const base = addReviewAnnotation(createTextReview('今天完成了数学练习。'), 'progress', 2, 9, '2026-09-24T08:02:00.000Z');
  const id = activeReviewAnnotations(base)[0]!.id;
  const oldDevice = updateReviewAnnotation(base, id, 'problem', '2026-09-24T08:03:00.000Z');
  const newDevice = removeReviewAnnotation(base, id, '2026-09-24T08:04:00.000Z');
  const merged = mergeDailyReviews(newDevice, oldDevice, '2026-09-24T08:05:00.000Z');

  assert.equal(activeReviewAnnotations(merged).length, 0);
  assert.equal(merged.annotations.find((annotation) => annotation.id === id)?.deletedAt, '2026-09-24T08:04:00.000Z');
});

test('HTML Markdown and script-like source remain unchanged plain text data', () => {
  const source = '<script>alert(1)</script> **不是粗体** <mark>原文</mark>';
  const review = createTextReview(source);
  const html = renderToStaticMarkup(createElement(AnnotatedReviewText, { review, onChange: () => undefined, onAnalyze: () => undefined, analyzing: false }));
  assert.equal(activeTextVersion(review).text, source);
  assert.equal(review.inputSegments[0]?.type === 'text' && review.inputSegments[0].text, source);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});

test('server rejects a persisted annotation whose offsets no longer match its quote', () => {
  const review = addReviewAnnotation(createTextReview('今天完成了数学练习。'), 'progress', 2, 9, '2026-09-24T08:02:00.000Z');
  const tampered = structuredClone(review);
  tampered.annotations[0]!.start += 1;
  assert.equal(normalizeReview(tampered, tampered.reviewDate), null);
});

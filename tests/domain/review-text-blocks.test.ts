import assert from 'node:assert/strict';
import test from 'node:test';
import { appendTextSegment, createDailyReview, updateTextSegment } from '../../src/review/model.ts';
import { activeTextVersion } from '../../src/review/model.ts';
import { buildReviewTextBlocks, locateQuoteInBlock, markReviewBlocksAnalyzed, planReviewBlockAnalysis, reviewContentHash } from '../../src/review/textBlocks.ts';

test('blocks split deterministically on Chinese punctuation and explicit newlines', () => {
  const blocks = buildReviewTextBlocks([{ id: 'segment-a', text: '英语没完成，因为刷手机太久。明天少安排两个任务；\n先完成数学。', startInDocument: 0 }], 'version-a');
  assert.deepEqual(blocks.map((block) => block.text), ['英语没完成，因为刷手机太久。', '明天少安排两个任务；', '先完成数学。']);
  assert.deepEqual(blocks.map((block) => block.ordinal), [0, 1, 2]);
});

test('prepending a new segment does not change old segment block ids', () => {
  const text = '旧内容第一句。旧内容第二句。';
  const before = buildReviewTextBlocks([{ id: 'old-segment', text, startInDocument: 0 }], 'version-a');
  const next = buildReviewTextBlocks([
    { id: 'new-segment', text: '新增内容。', startInDocument: 0 },
    { id: 'old-segment', text, startInDocument: '新增内容。\n\n'.length },
  ], 'version-b', before);
  assert.deepEqual(next.filter((block) => block.sourceSegmentId === 'old-segment').map((block) => block.blockId), before.map((block) => block.blockId));
});

test('editing block B preserves A and C ids and hashes', () => {
  let review = appendTextSegment(createDailyReview('2026-09-24'), 'A完成了。B背了二十分钟。C准备明天继续。');
  const segmentId = review.inputSegments[0]!.id;
  const before = activeTextVersion(review).blocks;
  review = updateTextSegment(review, segmentId, 'A完成了。B背了四十分钟。C准备明天继续。');
  const after = activeTextVersion(review).blocks;
  assert.equal(after[0]?.blockId, before[0]?.blockId);
  assert.equal(after[0]?.contentHash, before[0]?.contentHash);
  assert.equal(after[1]?.blockId, before[1]?.blockId);
  assert.notEqual(after[1]?.contentHash, before[1]?.contentHash);
  assert.equal(after[2]?.blockId, before[2]?.blockId);
  assert.equal(after[2]?.contentHash, before[2]?.contentHash);
});

test('hash normalizes only newline encoding and Unicode composition', () => {
  assert.equal(reviewContentHash('A\r\nＢ'), reviewContentHash('A\nＢ'));
  assert.notEqual(reviewContentHash('Task.'), reviewContentHash('task.'));
  assert.notEqual(reviewContentHash('任务。'), reviewContentHash('任务'));
});

test('a unique block-local quote converts to document offsets', () => {
  const blocks = buildReviewTextBlocks([{ id: 'segment-a', text: '前文。英语没完成，因为刷手机太久。', startInDocument: 20 }], 'version-a');
  const block = blocks[1]!;
  const located = locateQuoteInBlock(blocks, block.blockId, '英语没完成', 'version-a');
  assert.notEqual(typeof located, 'string');
  if (typeof located !== 'string') {
    assert.equal(located.start, block.startInDocument);
    assert.equal(located.end, block.startInDocument + '英语没完成'.length);
  }
});

test('ambiguous, missing, rewritten and unknown-block quotes are rejected without guessing', () => {
  const blocks = buildReviewTextBlocks([{ id: 'segment-a', text: '数学做了两节，数学做了两节。', startInDocument: 0 }], 'version-a');
  const blockId = blocks[0]!.blockId;
  assert.equal(locateQuoteInBlock(blocks, blockId, '数学做了两节', 'version-a'), 'QUOTE_AMBIGUOUS');
  assert.equal(locateQuoteInBlock(blocks, blockId, '数学完成了两节', 'version-a'), 'QUOTE_NOT_FOUND');
  assert.equal(locateQuoteInBlock(blocks, 'unknown-block', '数学做了两节', 'version-a'), 'BLOCK_NOT_FOUND');
  assert.equal(locateQuoteInBlock(blocks, blockId, '数学做了两节', 'old-version'), 'TEXT_VERSION_MISMATCH');
});

test('appending a segment targets only its new blocks', () => {
  const initial = buildReviewTextBlocks([{ id: 'segment-a', text: 'A完成了。B有问题。', startInDocument: 0 }], 'version-a');
  const analyzed = markReviewBlocksAnalyzed(initial, initial.map((block) => block.blockId), { promptVersion: 'p1', schemaVersion: 's1', modelVersion: 'm1', analyzedAt: '2026-09-24T08:00:00.000Z' });
  const appended = buildReviewTextBlocks([
    { id: 'segment-a', text: 'A完成了。B有问题。', startInDocument: 0 },
    { id: 'segment-b', text: 'C是新内容。', startInDocument: 'A完成了。B有问题。\n\n'.length },
  ], 'version-b', analyzed);
  const plan = planReviewBlockAnalysis(appended);
  assert.deepEqual(plan.targetBlocks.map((block) => block.sourceSegmentId), ['segment-b']);
  assert.equal(plan.contextBlocks.length, 1);
});

test('editing block B targets B while unchanged A and C stay analyzed', () => {
  const initial = buildReviewTextBlocks([{ id: 'segment-a', text: 'A完成了。B背了二十分钟。C继续。', startInDocument: 0 }], 'version-a');
  const analyzed = markReviewBlocksAnalyzed(initial, initial.map((block) => block.blockId), { promptVersion: 'p1', schemaVersion: 's1', modelVersion: 'm1', analyzedAt: '2026-09-24T08:00:00.000Z' });
  const edited = buildReviewTextBlocks([{ id: 'segment-a', text: 'A完成了。B背了四十分钟。C继续。', startInDocument: 0 }], 'version-b', analyzed);
  const plan = planReviewBlockAnalysis(edited);
  assert.deepEqual(plan.targetBlocks.map((block) => block.ordinal), [1]);
  assert.deepEqual(edited.map((block) => block.analysisState), ['analyzed', 'changed', 'analyzed']);
});

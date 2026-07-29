import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDefaultReviewBaseDuration,
  getReviewBaseDuration,
  getReviewRoundDuration,
  normalizeEstimatedMinutes,
  normalizeOptionalEstimatedMinutes,
} from '../../src/ebb/duration.ts';

test('review base duration follows difficulty unless explicitly overridden', () => {
  assert.equal(getDefaultReviewBaseDuration('easy'), 10);
  assert.equal(getDefaultReviewBaseDuration('normal'), 15);
  assert.equal(getDefaultReviewBaseDuration('hard'), 20);
  assert.equal(getReviewBaseDuration({ complexity: 'hard', baseDurationMinutes: 35 }), 35);
});

test('review rounds use 100%, 80%, and 60% bands rounded up to five minutes', () => {
  const task = { complexity: 'normal' as const, baseDurationMinutes: 30 };
  assert.equal(getReviewRoundDuration({ ...task, roundOrder: 1 }), 30);
  assert.equal(getReviewRoundDuration({ ...task, roundOrder: 2 }), 25);
  assert.equal(getReviewRoundDuration({ ...task, roundOrder: 3 }), 25);
  assert.equal(getReviewRoundDuration({ ...task, roundOrder: 4 }), 20);
});

test('a per-round override wins and legacy invalid values stay schedulable', () => {
  assert.equal(getReviewRoundDuration({ complexity: 'easy', roundOrder: 4, durationOverrideMinutes: 45 }), 45);
  assert.equal(normalizeEstimatedMinutes(0, 30), 30);
  assert.equal(normalizeEstimatedMinutes(12), 15);
  assert.equal(normalizeOptionalEstimatedMinutes(0), undefined);
  assert.equal(normalizeOptionalEstimatedMinutes(-5), undefined);
  assert.equal(normalizeOptionalEstimatedMinutes(12), 15);
});

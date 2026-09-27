import assert from 'node:assert/strict';
import test from 'node:test';
import { redactRetiredFocusPayload } from '../../functions/api/archives/redact-focus.ts';

test('archive redaction removes retired focus data without touching unrelated records', () => {
  const archive = {
    data: {
      timeline: { tasks: [{ id: 'task-1' }] },
      focus: { focusSubjects: [{ id: 'subject-1' }], focusSessions: [] },
      nested: { focusWeeklyReviews: [{ weekStart: '2026-09-01' }] },
    },
  };
  assert.equal(redactRetiredFocusPayload(archive), true);
  assert.deepEqual(archive, { data: { timeline: { tasks: [{ id: 'task-1' }] }, nested: {} } });
});

test('archive redaction visits every sibling in objects and arrays', () => {
  const archive = {
    first: { focusSessions: [1] },
    second: [{ focusSubjects: [2] }, { nested: { focusWeeklyReviews: [3], keep: 'safe' } }],
    last: { focusSessions: [4] },
  };
  assert.equal(redactRetiredFocusPayload(archive), true);
  assert.deepEqual(archive, { first: {}, second: [{}, { nested: { keep: 'safe' } }], last: {} });
  assert.equal(redactRetiredFocusPayload(archive), false);
});

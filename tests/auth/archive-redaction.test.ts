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

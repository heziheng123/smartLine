import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnifiedRoomId, hashWorkspaceBackup } from '../../src/services/workspaceSyncCore.ts';
import type { WorkspaceBackup } from '../../src/services/workspaceBackup.ts';

function backup(): WorkspaceBackup {
  return {
    kind: 'smart-line-workspace', schemaVersion: 1, revision: 1,
    exportedAt: '2026-07-21T00:00:00.000Z', deviceId: 'device-a',
    timeline: { tasks: [], groups: [], notes: [], milestones: [] },
    ebb: { reviewTasks: [], inboxItems: [], outlineNodes: [], ebbSettings: { intervals: [1, 2, 4, 7], defaultRoundCount: 4, tagColors: {} } },
    daily: { schedules: {} }, graph: { nodes: [] }, settings: {},
  };
}

test('unified room names are stable and contain only safe characters', () => {
  assert.equal(buildUnifiedRoomId('My_Room-01', 'GitHub.User'), 'workspace-github-user-my_room-01');
  assert.throws(() => buildUnifiedRoomId('***', 'owner'), /不能为空/);
});

test('workspace hashes ignore object key insertion order but detect data changes', async () => {
  const first = backup();
  const reordered = { ...backup(), settings: {}, graph: { nodes: [] } };
  assert.equal(await hashWorkspaceBackup(first), await hashWorkspaceBackup(reordered));
  const changed = backup();
  changed.timeline.notes.push({ id: 'n1', name: 'changed', date: '2026-07-21', type: 'pin' });
  assert.notEqual(await hashWorkspaceBackup(first), await hashWorkspaceBackup(changed));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { buildUnifiedRoomId, findWorkspaceFieldConflicts, hashWorkspaceBackup, hashWorkspaceValue, withTimeout } from '../../src/services/workspaceSyncCore.ts';
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

test('offline field conflicts are detected per field without blocking unrelated device changes', async () => {
  const originalTasks = [{ id: 'one', title: 'before' }];
  const pendingTasks = [{ id: 'one', title: 'offline edit' }];
  const baseHashes = { tasks: await hashWorkspaceValue(originalTasks) };
  assert.deepEqual(await findWorkspaceFieldConflicts(
    { tasks: pendingTasks }, baseHashes, { tasks: originalTasks, nodes: [{ id: 'other-device-change' }] },
  ), []);
  assert.deepEqual(await findWorkspaceFieldConflicts(
    { tasks: pendingTasks }, baseHashes, { tasks: [{ id: 'one', title: 'remote edit' }] },
  ), ['tasks']);
  assert.deepEqual(await findWorkspaceFieldConflicts(
    { tasks: pendingTasks }, baseHashes, { tasks: pendingTasks },
  ), []);
});

test('room inspection timeout reports a visible failure instead of waiting forever', async () => {
  await assert.rejects(withTimeout(new Promise(() => undefined), 5, '读取旧房间超时'), /读取旧房间超时/);
  assert.equal(await withTimeout(Promise.resolve('ok'), 50, '不应超时'), 'ok');
});

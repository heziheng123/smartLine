import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceBackup } from '../../src/services/workspaceBackup.ts';
import { createWorkspaceV9Preflight } from '../../src/services/workspaceV9/workspacePreflight.ts';

function emptyBackup(schemaVersion = 8): WorkspaceBackup {
  return {
    kind: 'smart-line-workspace', schemaVersion, revision: 1,
    exportedAt: '2026-09-03T00:00:00.000Z', deviceId: 'device-a',
    timeline: { tasks: [], groups: [], notes: [], milestones: [], lifeStages: [] },
    lifeMap: {
      lifeMapAreas: [], lifeMapPlanGroups: [], lifeMapStages: [], lifeMapThemes: [],
      lifeMapGoals: [], lifeMapSystems: [], lifeMapSystemCheckIns: [], lifeMapEvents: [],
      lifeMapFocuses: [], lifeMapNotes: [], lifeMapReviews: [],
    },
    ebb: { reviewTasks: [], inboxItems: [], outlineNodes: [], ebbSettings: {} as WorkspaceBackup['ebb']['ebbSettings'] },
    graph: { nodes: [] }, daily: { schedules: {}, retrospectives: {} }, settings: {},
  };
}

test('schema 9 preflight is read-only and permits only a clean verified schema 8 test room', async () => {
  const backup = emptyBackup();
  const before = structuredClone(backup);
  const report = await createWorkspaceV9Preflight({
    workspaceId: 'workspace-owner-primary', backup, realTransportVerified: true,
  });

  assert.deepEqual(backup, before);
  assert.equal(report.status, 'ready');
  assert.equal(report.canCreateTestRoom, true);
  assert.equal(report.source.schemaVersion, 8);
  assert.match(report.source.workspaceHash, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.blockers, []);
});

test('schema 9 preflight blocks every unresolved schema 8 gate without changing the source', async () => {
  const backup = emptyBackup(7);
  const before = structuredClone(backup);
  const report = await createWorkspaceV9Preflight({
    workspaceId: 'workspace-owner-primary',
    backup,
    realTransportVerified: false,
    pendingQueueWriteId: 'queue-1',
    activeConflictIds: ['conflict-1'],
    integrityIssueCount: 1,
  });

  assert.deepEqual(backup, before);
  assert.equal(report.status, 'blocked');
  assert.equal(report.canCreateTestRoom, false);
  assert.deepEqual(report.blockers.map((blocker) => blocker.code).sort(), [
    'active-conflict', 'integrity-issue', 'liveblocks-transport-unverified',
    'pending-queue', 'source-schema-unsupported',
  ]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceBackup } from '../../src/services/workspaceBackup.ts';
import { createWorkspaceAuditReport } from '../../src/services/workspaceAuditCore.ts';

function emptyLifeMap(): WorkspaceBackup['lifeMap'] {
  return {
    lifeMapAreas: [],
    lifeMapPlanGroups: [],
    lifeMapStages: [],
    lifeMapThemes: [],
    lifeMapGoals: [],
    lifeMapSystems: [],
    lifeMapSystemCheckIns: [],
    lifeMapEvents: [],
    lifeMapFocuses: [],
    lifeMapNotes: [],
    lifeMapReviews: [],
  };
}

function emptyBackup(): WorkspaceBackup {
  return {
    kind: 'smart-line-workspace',
    schemaVersion: 7,
    revision: 1,
    exportedAt: '2026-08-12T00:00:00.000Z',
    deviceId: 'device-a',
    timeline: { tasks: [], groups: [], notes: [], milestones: [], lifeStages: [] },
    lifeMap: emptyLifeMap(),
    ebb: {
      reviewTasks: [],
      inboxItems: [],
      outlineNodes: [],
      ebbSettings: {} as WorkspaceBackup['ebb']['ebbSettings'],
    },
    graph: { nodes: [] },
    daily: { schedules: {}, retrospectives: {} },
    settings: {},
  };
}

test('workspace audit produces stable per-collection IDs and a content hash', async () => {
  const backup = emptyBackup();
  backup.graph.nodes.push({ id: 'node-b', name: 'B', parentId: null, createdAt: 2 });
  backup.graph.nodes.push({ id: 'node-a', name: 'A', parentId: null, createdAt: 1 });

  const report = await createWorkspaceAuditReport(backup, { generatedAt: '2026-08-12T01:00:00.000Z' });

  assert.equal(report.integrity.status, 'passed');
  assert.equal(report.workspaceHash.length, 64);
  assert.deepEqual(report.collections['graph.nodes'].ids, ['node-a', 'node-b']);
  assert.equal(report.collections['graph.nodes'].idsHash.length, 64);
  assert.equal(report.source.deviceId, 'device-a');
});

test('workspace audit blocks duplicate IDs and missing references', async () => {
  const backup = emptyBackup();
  backup.graph.nodes.push(
    { id: 'duplicate', name: 'A', parentId: null, createdAt: 1 },
    { id: 'duplicate', name: 'B', parentId: 'missing-parent', createdAt: 2 },
  );

  const report = await createWorkspaceAuditReport(backup);

  assert.equal(report.integrity.status, 'blocked');
  assert.deepEqual(report.collections['graph.nodes'].duplicateIds, ['duplicate']);
  assert.ok(report.findings.some((item) => item.code === 'duplicate-id'));
  assert.ok(report.findings.some((item) => item.code === 'missing-reference'));
});

test('workspace audit counts a grouped task block once when groups mirror canonical tasks', async () => {
  const backup = emptyBackup();
  const task = {
    id: 'project-1', name: '项目', start: '2026-08-12', end: '2026-08-12', groupId: 'group-1',
    blocks: [{ type: 'text' as const, id: 'block-1', content: '正文' }],
  };
  backup.timeline.tasks.push(task);
  backup.timeline.groups.push({ id: 'group-1', name: '分组', children: [task] });

  const report = await createWorkspaceAuditReport(backup);

  assert.equal(report.integrity.status, 'passed');
  assert.equal(report.collections['timeline.blocks'].count, 1);
  assert.deepEqual(report.collections['timeline.blocks'].duplicateIds, []);
});

test('workspace audit still blocks a real duplicate block ID inside one task', async () => {
  const backup = emptyBackup();
  backup.timeline.tasks.push({
    id: 'project-1', name: '项目', start: '2026-08-12', end: '2026-08-12',
    blocks: [
      { type: 'text', id: 'same-block', content: '第一份' },
      { type: 'text', id: 'same-block', content: '第二份' },
    ],
  });

  const report = await createWorkspaceAuditReport(backup);

  assert.equal(report.integrity.status, 'blocked');
  assert.deepEqual(report.collections['timeline.blocks'].duplicateIds, ['project-1:same-block']);
});

test('workspace audit includes local queue and conflict state in migration readiness', async () => {
  const report = await createWorkspaceAuditReport(emptyBackup(), {
    sync: {
      architecture: 'unified',
      pendingFieldCount: 2,
      pendingFields: ['tasks', 'reviewTasks'],
      activeConflictCount: 1,
      historicalConflictCount: 3,
    },
  });

  assert.equal(report.integrity.status, 'blocked');
  assert.equal(report.sync.historicalConflictCount, 3);
  assert.ok(report.findings.some((item) => item.code === 'pending-sync' && item.severity === 'warning'));
  assert.ok(report.findings.some((item) => item.code === 'active-conflict' && item.severity === 'blocker'));
});

test('workspace audit warns before a large entity approaches the D1 row limit', async () => {
  const backup = emptyBackup();
  backup.timeline.notes.push({
    id: 'large-note',
    name: 'x'.repeat(500_000),
    date: '2026-08-12',
    type: 'pin',
  });

  const report = await createWorkspaceAuditReport(backup);

  assert.equal(report.integrity.status, 'warning');
  assert.ok(report.findings.some((item) => item.code === 'large-entity' && item.entityId === 'large-note'));
  assert.ok((report.collections['timeline.notes'].largestEntity?.bytes ?? 0) >= 500_000);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import type { WorkspaceBackup } from '../../src/services/workspaceBackup.ts';
import {
  applyTimelineBlocksRepairPlan,
  createTimelineBlocksRepairPlan,
  verifyTimelineBlocksConservation,
} from '../../src/services/workspaceTimelineRepair.ts';
import {
  canWorkspaceMutationEnqueue,
  type WorkspaceMutationOrigin,
} from '../../src/services/workspaceMutationOrigin.ts';
import {
  buildWorkspaceRepairManifest,
  verifyWorkspaceRepairManifest,
} from '../../src/services/workspaceRepairSafety.ts';
import { mergeWorkspaceFieldChangesDetailed } from '../../src/services/workspaceSyncCore.ts';
import { buildPendingWorkspaceSyncRemainder } from '../../src/services/workspaceSyncQueueCore.ts';
import { assertUniqueBlockIds, genBlockId } from '../../src/utils/blocks.ts';

function backupWithBlocks(blocks: Array<Record<string, unknown>>): WorkspaceBackup {
  return {
    kind: 'smart-line-workspace', schemaVersion: 8, revision: 1,
    exportedAt: '2026-09-03T00:00:00.000Z', deviceId: 'device-a',
    timeline: {
      tasks: [{ id: 'task-1', name: '项目', start: '2026-09-01', end: '2026-09-30', blocks }],
      groups: [], notes: [], milestones: [], lifeStages: [],
    } as WorkspaceBackup['timeline'],
    lifeMap: {
      lifeMapAreas: [], lifeMapPlanGroups: [], lifeMapStages: [], lifeMapThemes: [],
      lifeMapGoals: [], lifeMapSystems: [], lifeMapSystemCheckIns: [], lifeMapEvents: [],
      lifeMapFocuses: [], lifeMapNotes: [], lifeMapReviews: [],
    },
    ebb: { reviewTasks: [], inboxItems: [], outlineNodes: [], ebbSettings: {} as WorkspaceBackup['ebb']['ebbSettings'] },
    graph: { nodes: [] }, daily: { schedules: {}, retrospectives: {} }, settings: {},
  };
}

test('only user and explicit restore origins can create schema 8 queue writes', () => {
  const allowed = new Set<WorkspaceMutationOrigin>(['user', 'restore']);
  const origins: WorkspaceMutationOrigin[] = [
    'user', 'restore', 'remote-hydration', 'indexeddb-hydration', 'repair',
    'migration', 'broadcast', 'convergence', 'system-normalization',
  ];
  for (const origin of origins) assert.equal(canWorkspaceMutationEnqueue(origin), allowed.has(origin), origin);
});
test('new block IDs are cross-tab-safe and duplicate writes are rejected before persistence', () => {
  const ids = new Set(Array.from({ length: 50 }, () => genBlockId()));
  assert.equal(ids.size, 50);
  assert.throws(
    () => assertUniqueBlockIds([
      { type: 'text', id: 'same-id', content: '第一份' },
      { type: 'text', id: 'same-id', content: '第二份' },
    ]),
    /重复内容块 ID/,
  );
  assert.throws(
    () => assertUniqueBlockIds([{ type: 'text', id: '', content: '缺少 ID' }]),
    /缺少 ID/,
  );
});
test('timeline repair keeps different duplicates and archives identical extra copies', async () => {
  const before = backupWithBlocks([
    { type: 'text', id: '', content: 'missing' },
    { type: 'text', id: 'dup', content: 'first' },
    { type: 'text', id: 'dup', content: 'different' },
    { type: 'text', id: 'same', content: 'same' },
    { type: 'text', id: 'same', content: 'same' },
  ]);
  const ids = ['new-missing', 'new-duplicate'];
  const plan = await createTimelineBlocksRepairPlan(before, {
    repairId: 'repair-1', createdAt: '2026-09-03T01:00:00.000Z',
    createId: () => ids.shift()!,
  });
  const applied = await applyTimelineBlocksRepairPlan(before, plan);
  const current = applied.backup.timeline.tasks[0].blocks;

  assert.deepEqual(current.map((block) => block.id), ['new-missing', 'dup', 'new-duplicate', 'same']);
  assert.equal(applied.history.length, 1);
  assert.equal((applied.history[0].originalValue as { content: string }).content, 'same');
  assert.equal(await verifyTimelineBlocksConservation(before, applied), true);
});

test('repair plan retries reuse persisted assignments and reject source drift', async () => {
  const source = backupWithBlocks([{ type: 'text', id: '', content: 'keep me' }]);
  const first = await createTimelineBlocksRepairPlan(source, {
    repairId: 'repair-1', createdAt: '2026-09-03T01:00:00.000Z', createId: () => 'stable-id',
  });
  const retry = await createTimelineBlocksRepairPlan(source, { existingPlan: first, createId: () => 'must-not-run' });
  assert.deepEqual(retry, first);

  const changed = backupWithBlocks([{ type: 'text', id: '', content: 'changed after plan' }]);
  await assert.rejects(() => applyTimelineBlocksRepairPlan(changed, first), /sourceHash/);
});

test('repair manifest covers every pre-repair safety component with SHA-256', async () => {
  const manifest = await buildWorkspaceRepairManifest({
    repairId: 'repair-1', workspaceId: 'workspace-owner-primary',
    createdAt: '2026-09-03T01:00:00.000Z',
    local: { tasks: [] }, queue: { writeId: 'write-1' }, emergencyQueue: null,
    conflicts: [{ id: 'conflict-1' }], remoteRoot: { tasks: [] },
    entitySidecar: { 'workspace-entity:tasks:a': { value: { id: 'a' } } },
  });
  assert.deepEqual(Object.keys(manifest.parts).sort(), [
    'conflicts', 'emergencyQueue', 'entitySidecar', 'local', 'queue', 'remoteRoot',
  ]);
  assert.ok(Object.values(manifest.parts).every((part) => /^[a-f0-9]{64}$/.test(part.sha256)));
  assert.equal(await verifyWorkspaceRepairManifest(manifest), true);
});

test('detailed merge keeps remote conflict leaves and reports complete alternates', async () => {
  const base = [{ id: 'one', title: 'before', date: '2026-09-01' }];
  const local = [{ id: 'one', title: 'local', date: '2026-09-02' }];
  const remote = [{ id: 'one', title: 'remote', date: '2026-09-01', note: 'safe remote addition' }];
  const result = await mergeWorkspaceFieldChangesDetailed({ tasks: local }, { tasks: base }, { tasks: remote });

  assert.deepEqual(result.fields.tasks, [{ id: 'one', title: 'remote', date: '2026-09-02', note: 'safe remote addition' }]);
  assert.equal(result.alternates.length, 1);
  assert.deepEqual(result.alternates[0], {
    path: 'tasks[one].title', baseValue: 'before', localValue: 'local', remoteValue: 'remote',
    baseHash: result.alternates[0].baseHash,
    localHash: result.alternates[0].localHash,
    remoteHash: result.alternates[0].remoteHash,
    resolution: 'remote-current',
  });
  assert.ok([result.alternates[0].baseHash, result.alternates[0].localHash, result.alternates[0].remoteHash]
    .every((hash) => /^[a-f0-9]{64}$/.test(hash)));
});

test('field acknowledgement retains blocked fields and their original baseline', () => {
  const pending = {
    version: 1 as const, writeId: 'write-1', deviceId: 'device-a',
    createdAt: '2026-09-03T01:00:00.000Z', updatedAt: '2026-09-03T01:00:00.000Z',
    fields: { tasks: [{ id: 'safe' }], nodes: [{ id: 'blocked' }] },
    baseFields: { tasks: [], nodes: [] },
    baseHashes: { tasks: 'tasks-base', nodes: 'nodes-base' },
  };
  const remaining = buildPendingWorkspaceSyncRemainder(pending, ['tasks'], 'write-2');
  assert.deepEqual(remaining, {
    ...pending,
    writeId: 'write-2',
    fields: { nodes: [{ id: 'blocked' }] },
    baseFields: { nodes: [] },
    baseHashes: { nodes: 'nodes-base' },
    forceFields: undefined,
  });
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertWorkspaceQueueDrained,
  assertWorkspaceSchemaSupported,
  buildUnifiedRoomCandidates,
  buildUnifiedRoomId,
  buildWorkspaceBindingRoomId,
  collectWorkspaceFieldChanges,
  commitWorkspaceQueueRevisionSafely,
  decideLegacyWorkspaceDiscovery,
  decideUnifiedWorkspaceActivation,
  findWorkspaceFieldConflicts,
  findWorkspaceFieldsSafeToBackfill,
  findWorkspaceFieldMismatches,
  hashWorkspaceBackup,
  hashWorkspaceValue,
  isBundledDemoWorkspace,
  hasWorkspaceFieldSnapshotChanged,
  isWorkspaceStoreStorageReady,
  isWorkspaceRevisionSuperseded,
  mergeWorkspaceFieldChanges,
  shouldBackfillLegacyLifeMapSync,
  withTimeout,
} from '../../src/services/workspaceSyncCore.ts';
import type { WorkspaceBackup } from '../../src/services/workspaceBackup.ts';
import { createEmptyLifeMapData } from '../../src/lifeMap/data.ts';
import { SUPPORTED_WORKSPACE_SCHEMA_VERSIONS, WORKSPACE_SCHEMA_VERSION } from '../../src/services/workspaceSchema.ts';

function backup(): WorkspaceBackup {
  return {
    kind: 'smart-line-workspace',
    schemaVersion: 7,
    revision: 1,
    exportedAt: '2026-07-21T00:00:00.000Z',
    deviceId: 'device-a',
    timeline: { tasks: [], groups: [], notes: [], milestones: [], lifeStages: [] },
    ebb: {
      reviewTasks: [],
      inboxItems: [],
      outlineNodes: [],
      ebbSettings: {
        intervals: [1, 2, 4, 7],
        defaultRoundCount: 4,
        tagColors: {},
      },
    },
    daily: { schedules: {}, retrospectives: {} },
    graph: { nodes: [] },
    lifeMap: {
      areas: [], themes: [], goals: [], systems: [], systemLogs: [],
      events: [], focuses: [], notes: [], relations: [], reviews: [],
    },
    settings: {},
  };
}

const emptyCounts = {
  tasks: 0, groups: 0, lifeStages: 0, lifeMapItems: 0,
  reviewTasks: 0, dailyDays: 0, retrospectiveDays: 0, graphNodes: 0,
};

test('first unified connection never overlays two different non-empty workspaces', () => {
  const nonEmpty = { ...emptyCounts, tasks: 1 };
  assert.equal(decideUnifiedWorkspaceActivation(false, 'local', 'remote', nonEmpty, nonEmpty), 'new');
  assert.equal(decideUnifiedWorkspaceActivation(true, 'same', 'same', nonEmpty, nonEmpty), 'matching');
  assert.equal(decideUnifiedWorkspaceActivation(true, 'local', 'remote', emptyCounts, nonEmpty), 'cloud');
  assert.equal(decideUnifiedWorkspaceActivation(true, 'local', 'remote', nonEmpty, emptyCounts), 'new');
  assert.equal(decideUnifiedWorkspaceActivation(true, 'local', 'remote', nonEmpty, nonEmpty), 'conflict');
});

test('future cloud schemas are rejected before the room can hydrate local stores', () => {
  assert.equal(WORKSPACE_SCHEMA_VERSION, 7);
  assert.deepEqual([...SUPPORTED_WORKSPACE_SCHEMA_VERSIONS], [1, 2, 3, 4, 5, 6, 7]);
  assert.doesNotThrow(() => assertWorkspaceSchemaSupported({ metadata: { schemaVersion: 7 } }, 7));
  assert.throws(
    () => assertWorkspaceSchemaSupported({ metadata: { schemaVersion: 7 } }, 6),
    /7/,
  );
});

test('unified room names are stable and contain only safe characters', () => {
  assert.equal(
    buildUnifiedRoomId('My_Room-01', 'GitHub.User'),
    'workspace-github-user-my_room-01',
  );
  assert.throws(() => buildUnifiedRoomId('***', 'owner'));
});

test('a new authenticated device discovers legacy cloud data before creating an empty unified room', () => {
  const nonEmpty = { ...emptyCounts, tasks: 1 };
  assert.equal(decideLegacyWorkspaceDiscovery(true, true, 'local', 'legacy', emptyCounts), 'unified');
  assert.equal(decideLegacyWorkspaceDiscovery(false, false, 'local', 'legacy', emptyCounts), 'new');
  assert.equal(decideLegacyWorkspaceDiscovery(false, true, 'same', 'same', nonEmpty), 'legacy-matching');
  assert.equal(decideLegacyWorkspaceDiscovery(false, true, 'local', 'legacy', emptyCounts), 'legacy-cloud');
  assert.equal(decideLegacyWorkspaceDiscovery(false, true, 'local', 'legacy', nonEmpty), 'conflict');
});

test('account workspace binding uses a stable owner-scoped room', () => {
  assert.equal(
    buildWorkspaceBindingRoomId('gh_12345'),
    'workspace-gh_12345-__account_binding_v1__',
  );
});

test('a pristine sample workspace may safely adopt an existing cloud workspace', () => {
  const sample = backup();
  sample.timeline.tasks = [{ id: 'demo-task-1' } as never];
  sample.timeline.groups = [{ id: 'demo-group-1' } as never];
  sample.timeline.notes = [{ id: 'demo-note-1' } as never];
  sample.timeline.milestones = [{ id: 'demo-ms-1' } as never];
  assert.equal(isBundledDemoWorkspace(sample), true);

  sample.lifeMap = createEmptyLifeMapData();
  assert.equal(isBundledDemoWorkspace(sample), true);

  sample.timeline.tasks.push({ id: 'real-task' } as never);
  assert.equal(isBundledDemoWorkspace(sample), false);

  const sampleGroup = backup();
  sampleGroup.timeline.groups = [{
    id: 'demo-group-1',
    children: [{ id: 'real-child-task' }],
  } as never];
  assert.equal(isBundledDemoWorkspace(sampleGroup), false);
});

test('new devices probe both stable-id and historical-login unified rooms', () => {
  assert.deepEqual(
    buildUnifiedRoomCandidates('study', 'gh_12345', 'Old.Owner'),
    ['workspace-gh_12345-study', 'workspace-old-owner-study'],
  );
  assert.deepEqual(
    buildUnifiedRoomCandidates('study', 'owner', 'owner'),
    ['workspace-owner-study'],
  );
});

test('queue flush detects a remote field change after its initial snapshot', () => {
  const before = { tasks: [{ id: 'task-1', name: 'before' }], notes: [], metadata: { deviceId: 'a' } };
  assert.equal(hasWorkspaceFieldSnapshotChanged(before, { ...before }, ['tasks', 'metadata']), false);
  assert.equal(hasWorkspaceFieldSnapshotChanged(
    before,
    { ...before, tasks: [{ id: 'task-1', name: 'remote-newer' }] },
    ['tasks', 'metadata'],
  ), true);
  assert.equal(hasWorkspaceFieldSnapshotChanged(
    before,
    { ...before, notes: [{ id: 'note-1' }] },
    ['tasks', 'metadata'],
  ), false);
});

test('workspace convergence compares actual content instead of connection state', () => {
  const remote = {
    tasks: [{ id: 'task-1', name: 'cloud' }],
    reviewTasks: [{ id: 'review-1', dueDate: '2026-08-11' }],
    schedules: { '2026-08-11': { date: '2026-08-11', items: [], blocks: [] } },
  };
  const local = {
    ...remote,
    tasks: [{ id: 'task-1', name: 'stale local copy' }],
  };
  assert.deepEqual(
    findWorkspaceFieldMismatches(local, remote, ['tasks', 'reviewTasks', 'schedules']),
    ['tasks'],
  );
  assert.deepEqual(
    findWorkspaceFieldMismatches(remote, remote, ['tasks', 'reviewTasks', 'schedules']),
    [],
  );
});

test('canonical write-back never overwrites a newer cloud field', () => {
  const snapshot = {
    tasks: [{ id: 'task-1', name: 'legacy value' }],
    nodes: [],
  };
  const canonical = {
    tasks: [{ id: 'task-1', name: 'normalized value' }],
    nodes: [{ id: 'node-1' }],
  };
  assert.deepEqual(
    findWorkspaceFieldsSafeToBackfill(snapshot, { ...snapshot }, canonical, ['tasks', 'nodes']),
    ['tasks', 'nodes'],
  );
  assert.deepEqual(
    findWorkspaceFieldsSafeToBackfill(
      snapshot,
      { ...snapshot, tasks: [{ id: 'task-1', name: 'newer remote value' }] },
      canonical,
      ['tasks', 'nodes'],
    ),
    ['nodes'],
  );
  assert.deepEqual(
    findWorkspaceFieldsSafeToBackfill(snapshot, { tasks: snapshot.tasks }, canonical, ['nodes']),
    ['nodes'],
  );
});

test('a durable queue revision discards the older emergency revision it superseded', () => {
  assert.equal(isWorkspaceRevisionSuperseded('revision-1', 'revision-2', 'revision-1'), true);
  assert.equal(isWorkspaceRevisionSuperseded('revision-3', 'revision-2', 'revision-1'), false);
});

test('workspace hashes ignore object key insertion order but detect data changes', async () => {
  const first = backup();
  const reordered = { ...backup(), settings: {}, graph: { nodes: [] } };
  assert.equal(
    await hashWorkspaceBackup(first),
    await hashWorkspaceBackup(reordered),
  );
  const changed = backup();
  changed.timeline.notes.push({
    id: 'n1',
    name: 'changed',
    date: '2026-07-21',
    type: 'pin',
  });
  assert.notEqual(
    await hashWorkspaceBackup(first),
    await hashWorkspaceBackup(changed),
  );
  const changedStage = backup();
  changedStage.timeline.lifeStages.push({
    id: 'stage-1',
    name: '备考阶段',
    start: '2026-07-01',
    end: '2026-12-31',
  });
  assert.notEqual(
    await hashWorkspaceBackup(first),
    await hashWorkspaceBackup(changedStage),
  );
});

test('offline field conflicts are detected per field without blocking unrelated device changes', async () => {
  const originalTasks = [{ id: 'one', title: 'before' }];
  const pendingTasks = [{ id: 'one', title: 'offline edit' }];
  const baseHashes = { tasks: await hashWorkspaceValue(originalTasks) };
  assert.deepEqual(
    await findWorkspaceFieldConflicts(
      { tasks: pendingTasks },
      baseHashes,
      {
        tasks: originalTasks,
        nodes: [{ id: 'other-device-change' }],
      },
    ),
    [],
  );
  assert.deepEqual(
    await findWorkspaceFieldConflicts(
      { tasks: pendingTasks },
      baseHashes,
      { tasks: [{ id: 'one', title: 'remote edit' }] },
    ),
    ['tasks'],
  );
  assert.deepEqual(
    await findWorkspaceFieldConflicts(
      { tasks: pendingTasks },
      baseHashes,
      { tasks: pendingTasks },
    ),
    [],
  );
});

test('offline collections merge disjoint entity edits and report only same-property conflicts', () => {
  const base = [{ id: 'one', title: 'before' }, { id: 'two', title: 'before' }];
  const local = [{ id: 'one', title: 'offline' }, { id: 'two', title: 'before' }];
  const remote = [{ id: 'one', title: 'before' }, { id: 'two', title: 'remote' }];
  const disjoint = mergeWorkspaceFieldChanges({ tasks: local }, { tasks: base }, { tasks: remote });
  assert.deepEqual(disjoint.conflicts, []);
  assert.deepEqual(disjoint.fields.tasks, [
    { id: 'one', title: 'offline' },
    { id: 'two', title: 'remote' },
  ]);

  const conflicting = mergeWorkspaceFieldChanges(
    { tasks: [{ id: 'one', title: 'offline' }] },
    { tasks: [{ id: 'one', title: 'before' }] },
    { tasks: [{ id: 'one', title: 'remote' }] },
  );
  assert.deepEqual(conflicting.conflicts, ['tasks[one].title']);
});

test('an absent cloud field initializes from local data instead of creating a false deletion conflict', () => {
  const baseTasks = [{ id: 'one', title: 'before' }];
  const localTasks = [{ id: 'one', title: 'offline edit' }];
  const result = mergeWorkspaceFieldChanges(
    { tasks: localTasks },
    { tasks: baseTasks },
    { metadata: { schemaVersion: WORKSPACE_SCHEMA_VERSION } },
  );

  assert.deepEqual(result.conflicts, []);
  assert.deepEqual(result.fields.tasks, localTasks);
});

test('schema 6 project and key-date relationships participate in entity-level merges', () => {
  const baseGoal = { id: 'plan-1', name: '项目', progress: 0 };
  const mergedGoals = mergeWorkspaceFieldChanges(
    { lifeMapGoals: [{ ...baseGoal, outcomeGoalId: 'goal-1' }] },
    { lifeMapGoals: [baseGoal] },
    { lifeMapGoals: [{ ...baseGoal, progress: 40 }] },
  );
  assert.deepEqual(mergedGoals.conflicts, []);
  assert.deepEqual(mergedGoals.fields.lifeMapGoals, [{ ...baseGoal, progress: 40, outcomeGoalId: 'goal-1' }]);

  const baseEvent = { id: 'event-1', name: '报名截止', date: '2026-09-01' };
  const mergedEvents = mergeWorkspaceFieldChanges(
    { lifeMapEvents: [{ ...baseEvent, relatedPlanId: 'plan-1' }] },
    { lifeMapEvents: [baseEvent] },
    { lifeMapEvents: [{ ...baseEvent, importance: 'core' }] },
  );
  assert.deepEqual(mergedEvents.conflicts, []);
  assert.deepEqual(mergedEvents.fields.lifeMapEvents, [{ ...baseEvent, importance: 'core', relatedPlanId: 'plan-1' }]);
});

test('room inspection timeout reports a visible failure instead of waiting forever', async () => {
  await assert.rejects(
    withTimeout(new Promise(() => undefined), 5, 'room read timed out'),
    /room read timed out/,
  );
  assert.equal(
    await withTimeout(Promise.resolve('ok'), 50, 'should not time out'),
    'ok',
  );
});

test('workspace storage is writable only after connection and storage hydration both finish', () => {
  const connectedRoom = { getStatus: () => 'connected' };
  assert.equal(isWorkspaceStoreStorageReady({ syncEnabled: false }), false);
  assert.equal(
    isWorkspaceStoreStorageReady({
      syncEnabled: true,
      liveblocks: {
        room: connectedRoom,
        status: 'connected',
        isStorageLoading: true,
      },
    }),
    false,
  );
  assert.equal(
    isWorkspaceStoreStorageReady({
      syncEnabled: true,
      liveblocks: {
        room: connectedRoom,
        status: 'connecting',
        isStorageLoading: false,
      },
    }),
    false,
  );
  assert.equal(
    isWorkspaceStoreStorageReady({
      syncEnabled: true,
      liveblocks: {
        room: connectedRoom,
        status: 'connected',
        isStorageLoading: false,
      },
    }),
    true,
  );
});

test('a unified connection is successful only after its local queue is fully drained', () => {
  assert.doesNotThrow(() => assertWorkspaceQueueDrained({
    pendingFieldCount: 0,
    conflictDetected: false,
  }));
  assert.throws(
    () => assertWorkspaceQueueDrained({ pendingFieldCount: 10, conflictDetected: false }),
    /10 个数据字段等待补传/,
  );
  assert.throws(
    () => assertWorkspaceQueueDrained({ pendingFieldCount: 0, conflictDetected: true }),
    /多设备同步冲突/,
  );
});

test('offline queue data is cleared only after cloud storage confirms the write', async () => {
  const completed: string[] = [];
  await commitWorkspaceQueueRevisionSafely({
    apply: () => { completed.push('apply'); },
    confirm: async () => { completed.push('confirm'); },
    clear: async () => { completed.push('clear'); },
  });
  assert.deepEqual(completed, ['apply', 'confirm', 'clear']);

  const interrupted: string[] = [];
  await assert.rejects(
    commitWorkspaceQueueRevisionSafely({
      apply: () => { interrupted.push('apply'); },
      confirm: async () => { interrupted.push('confirm'); throw new Error('connection lost'); },
      clear: async () => { interrupted.push('clear'); },
    }),
    /connection lost/,
  );
  assert.deepEqual(interrupted, ['apply', 'confirm']);
});

test('legacy workspaces automatically include Life Map after the module is introduced', () => {
  assert.equal(shouldBackfillLegacyLifeMapSync(true, false), true);
  assert.equal(shouldBackfillLegacyLifeMapSync(true, true), false);
  assert.equal(shouldBackfillLegacyLifeMapSync(false, false), false);
});

test('local write journal captures only changed mapped fields and their baseline', () => {
  const tasksBefore = [{ id: 'task', isCompleted: true }];
  const tasksAfter = [{ id: 'task', isCompleted: false }];
  const groups = [{ id: 'group', children: [] }];
  const changes = collectWorkspaceFieldChanges(
    { tasks: tasksBefore, groups, syncStatus: 'connecting' },
    { tasks: tasksAfter, groups, syncStatus: 'connected' },
    ['tasks', 'groups'],
  );
  assert.deepEqual(changes.fields, { tasks: tasksAfter });
  assert.deepEqual(changes.baseFields, { tasks: tasksBefore });
});

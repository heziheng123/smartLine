import assert from 'node:assert/strict';
import test from 'node:test';
import type { LifeMapData } from '../../src/lifeMap/types.ts';
import { createEmptyLifeMapData, normalizeLifeMapData } from '../../src/lifeMap/data.ts';
import { applyHistoryEntry, createHistoryEntry } from '../../src/mindMap/commands.ts';
import {
  LIFE_MAP_MIGRATION_COLLECTIONS,
  createLifeMapMigrationBackup,
  createLifeMapMigrationPreflight,
  migrateLifeMapIntoDocument,
  reconcileLifeMapProjections,
} from '../../src/mindMap/lifeMapMigration.ts';
import { createEmptyMindMapDocument } from '../../src/mindMap/model.ts';
import { applyMindMapSyncPatch, createMindMapSyncPatch } from '../../src/mindMap/syncCore.ts';
import { addLifeSystemCheckIn, deleteLifePlanningItem, saveLifePlanningItem, updateLifePlanningDates } from '../../src/mindMap/lifePlanning.ts';

const empty = (): LifeMapData => ({
  lifeMapAreas: [], lifeMapPlanGroups: [], lifeMapStages: [], lifeMapThemes: [], lifeMapGoals: [],
  lifeMapSystems: [], lifeMapSystemCheckIns: [], lifeMapEvents: [], lifeMapFocuses: [], lifeMapNotes: [], lifeMapReviews: [],
});

test('life map migration embeds complete data and creates idempotent canvas projections', async () => {
  const data = empty();
  data.lifeMapAreas.push({
    id: 'area-1', name: '学习', color: '#6366f1', order: 0, planGroupId: 'learning',
    createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 1,
  });
  data.lifeMapStages.push({
    id: 'stage-1', name: '强化', start: '2026-08-01', end: '2026-09-01', areaIds: ['area-1'],
    createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 1,
  });
  data.lifeMapFocuses.push({
    id: 'focus-1', areaId: 'area-1', name: '英语', start: '2026-08-01', end: '2026-08-31',
    createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 1,
  });
  data.lifeMapNotes.push({
    id: 'note-1', areaId: 'area-1', name: '八月复盘', body: '保持节奏', date: '2026-08-20', type: 'pin',
    createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 1,
  });
  const before = createEmptyMindMapDocument('人生迁移', { id: 'map-1', now: 1 });

  const migrated = await migrateLifeMapIntoDocument(before, data, 100);
  assert.equal(migrated.changed, true);
  assert.equal(migrated.preflight.canSwitchOwnership, true);
  assert.deepEqual(migrated.document.lifeMap, normalizeLifeMapData(data));
  assert.equal(migrated.document.lifeMapMigration?.fingerprint, migrated.preflight.fingerprint);
  assert.equal(migrated.document.timelineSections['life-area:area-1']?.source, 'life');
  assert.match(migrated.document.nodes['life-focus:focus-1']?.text ?? '', /英语/);
  assert.match(migrated.document.nodes['life-note:note-1']?.text ?? '', /保持节奏/);
  assert.deepEqual(JSON.parse(migrated.backup.payload), JSON.parse(JSON.stringify(normalizeLifeMapData(data))));

  const repeated = await migrateLifeMapIntoDocument(migrated.document, data, 200);
  assert.equal(repeated.changed, false);
  assert.equal(repeated.document, migrated.document);

  const updatedData = structuredClone(data);
  updatedData.lifeMapFocuses[0].deletedAt = '2026-08-27';
  const updated = await migrateLifeMapIntoDocument(migrated.document, updatedData, 300);
  assert.equal(updated.changed, true);
  assert.equal(updated.document.nodes['life-focus:focus-1'], undefined);

  const entry = createHistoryEntry('迁移人生地图', before, migrated.document);
  assert.ok(entry);
  assert.equal(applyHistoryEntry(migrated.document, entry, 'undo').lifeMap, null);
  assert.deepEqual(applyHistoryEntry(before, entry, 'redo').lifeMap, migrated.document.lifeMap);

  const patch = createMindMapSyncPatch(before, migrated.document);
  const synchronized = applyMindMapSyncPatch(before, patch);
  assert.deepEqual(synchronized.lifeMap, migrated.document.lifeMap);
  assert.deepEqual(synchronized.lifeMapMigration, migrated.document.lifeMapMigration);
});

test('life map migration preflight blocks every populated uncovered collection and backs up losslessly', async () => {
  const data = empty();
  data.lifeMapAreas.push({
    id: 'area-1', name: '学习', color: '#6366f1', order: 0, planGroupId: 'learning',
    createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 1,
  });
  data.lifeMapStages.push({
    id: 'stage-1', name: '强化', start: '2026-08-01', end: '2026-09-01',
    createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 1,
  });
  data.lifeMapNotes.push({
    id: 'note-1', name: '复盘', date: '2026-08-20', type: 'pin',
    createdAt: '2026-01-01', updatedAt: '2026-01-01', revision: 1,
  });

  const preflight = await createLifeMapMigrationPreflight(data, ['lifeMapAreas', 'lifeMapStages']);
  assert.equal(preflight.totalActive, 3);
  assert.deepEqual(preflight.blockers, ['lifeMapNotes']);
  assert.equal(preflight.canSwitchOwnership, false);
  assert.equal(preflight.fingerprint.length, 64);

  const backup = await createLifeMapMigrationBackup(data, '2026-08-26T00:00:00.000Z');
  assert.equal(backup.fingerprint, preflight.fingerprint);
  assert.deepEqual(JSON.parse(backup.payload), data);

  const emptyPreflight = await createLifeMapMigrationPreflight(empty(), LIFE_MAP_MIGRATION_COLLECTIONS);
  assert.equal(emptyPreflight.canSwitchOwnership, true);
});

test('map-owned edits reconcile projections and reject destructive area deletes', async () => {
  const data = createEmptyLifeMapData();
  const withNote = saveLifePlanningItem(data, 'note', {
    name: '保留笔记', areaId: 'learning', start: '2026-08-20', end: '2026-08-20', color: '#6366f1', body: '正文',
  }, { now: '2026-08-20T00:00:00.000Z' });
  const migrated = await migrateLifeMapIntoDocument(createEmptyMindMapDocument('投影', { id: 'map-projection', now: 1 }), withNote, 2);
  const edited = saveLifePlanningItem(withNote, 'note', {
    name: '已更新笔记', areaId: 'learning', start: '2026-08-20', end: '2026-08-20', color: '#6366f1', body: '新正文',
  }, { id: withNote.lifeMapNotes.at(-1)?.id, now: '2026-08-21T00:00:00.000Z' });
  const reconciled = reconcileLifeMapProjections({ ...migrated.document, lifeMap: edited }, 3);
  assert.match(reconciled.nodes[`life-note:${edited.lifeMapNotes.at(-1)?.id}`]?.text ?? '', /新正文/);
  const withSecondNote = saveLifePlanningItem(edited, 'note', {
    name: '第二条笔记', areaId: 'learning', start: '2026-08-22', end: '2026-08-22', color: '#6366f1', body: '',
  }, { now: '2026-08-22T00:00:00.000Z' });
  const withSecondProjection = reconcileLifeMapProjections({ ...reconciled, lifeMap: withSecondNote }, 4);
  const secondNote = withSecondNote.lifeMapNotes.find((note) => note.name === '第二条笔记');
  assert.ok(secondNote);
  assert.ok(withSecondProjection.nodes[`life-note:${secondNote.id}`].x < 1_000);
  assert.throws(() => deleteLifePlanningItem(edited, 'area', 'learning'), /不能删除/);
  assert.throws(() => saveLifePlanningItem(edited, 'note', {
    name: '无效日期', areaId: 'learning', start: '2026-02-30', end: '2026-02-30', color: '#6366f1', body: '',
  }), /有效/);
});

test('map-owned life planning supports create, edit, date changes, check-ins, and soft delete', () => {
  let data = createEmptyLifeMapData();
  data = saveLifePlanningItem(data, 'stage', {
    name: '冲刺阶段', areaId: 'learning', start: '2026-08-01', end: '2026-08-31', body: '完成真题', color: '#6366f1',
  }, { now: '2026-08-01T00:00:00.000Z' });
  const stage = data.lifeMapStages.find((item) => item.name === '冲刺阶段');
  assert.ok(stage);
  assert.deepEqual(stage.areaIds, ['learning']);

  data = saveLifePlanningItem(data, 'stage', {
    name: '最终冲刺', areaId: 'learning', start: '2026-08-01', end: '2026-08-31', body: '完成真题', color: '#6366f1',
  }, { id: stage.id, now: '2026-08-02T00:00:00.000Z' });
  assert.equal(data.lifeMapStages.find((item) => item.id === stage.id)?.name, '最终冲刺');

  const moved = updateLifePlanningDates(data, `stage:${stage.id}`, '2026-08-05', '2026-09-04', '2026-08-03T00:00:00.000Z');
  assert.ok(moved);
  data = moved;
  assert.equal(data.lifeMapStages.find((item) => item.id === stage.id)?.start, '2026-08-05');

  data = saveLifePlanningItem(data, 'system', {
    name: '每日复习', areaId: 'learning', start: '2026-08-01', end: '2026-12-31', color: '#10b981', status: 'active', frequency: 'daily', targetCount: 1,
  }, { now: '2026-08-01T00:00:00.000Z' });
  const system = data.lifeMapSystems.find((item) => item.name === '每日复习');
  assert.ok(system);
  data = addLifeSystemCheckIn(data, system.id, '2026-08-26', '2026-08-26T00:00:00.000Z');
  assert.equal(data.lifeMapSystemCheckIns.find((item) => item.systemId === system.id)?.count, 1);

  data = deleteLifePlanningItem(data, 'stage', stage.id, '2026-08-27T00:00:00.000Z');
  assert.equal(data.lifeMapStages.find((item) => item.id === stage.id)?.deletedAt, '2026-08-27T00:00:00.000Z');
});

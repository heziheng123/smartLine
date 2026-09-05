import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmptyMindMapDocument } from '../../src/mindMap/model.ts';
import { parseMindMapBackupBundle } from '../../src/mindMap/repository.ts';
import { validateWorkspaceBackup, type WorkspaceBackup } from '../../src/services/workspaceBackup.ts';
import { createMergedBackup } from '../../src/services/workspaceSync.ts';

function emptyBackup(): WorkspaceBackup {
  return {
    kind: 'smart-line-workspace',
    schemaVersion: 8,
    revision: 1,
    exportedAt: '2026-09-04T00:00:00.000Z',
    deviceId: 'device-a',
    timeline: { tasks: [], groups: [], notes: [], milestones: [], lifeStages: [] },
    lifeMap: {
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
    },
    ebb: {
      reviewTasks: [],
      inboxItems: [],
      outlineNodes: [],
      ebbSettings: { intervals: [1, 2, 4, 7], defaultRoundCount: 4, tagColors: {} },
    },
    graph: { nodes: [] },
    daily: { schedules: {}, retrospectives: {} },
    settings: {},
  };
}

test('old workspace backups remain valid without a mind map field', () => {
  const result = validateWorkspaceBackup(emptyBackup());
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary?.mindMapDocuments, 0);
  assert.equal(result.backup?.mindMap, undefined);
});

test('workspace backups can carry map documents', () => {
  const document = createEmptyMindMapDocument('主图', { id: 'map-doc-1' });
  const result = validateWorkspaceBackup({
    ...emptyBackup(),
    mindMap: {
      version: 1,
      index: {
        schemaVersion: document.schemaVersion,
        activeDocumentId: document.id,
        documents: [{
          id: document.id,
          title: document.title,
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          nodeCount: 0,
          edgeCount: 0,
        }],
      },
      documents: [document],
    },
  });
  assert.equal(result.errors.length, 0);
  assert.equal(result.summary?.mindMapDocuments, 1);
  assert.equal(result.backup?.mindMap?.documents[0]?.id, 'map-doc-1');
});

test('invalid map payloads fail backup validation', () => {
  const result = validateWorkspaceBackup({ ...emptyBackup(), mindMap: { version: 1 } });
  assert.ok(result.errors.some((error) => error.includes('地图')));
});

test('map backups validate embedded image resources', () => {
  const document = createEmptyMindMapDocument('图片图', { id: 'map-with-image' });
  document.nodes.image = {
    id: 'image', type: 'image', text: '', x: 0, y: 0, width: 100, height: 100,
    color: '#fff', parentId: null, isCollapsed: false, link: null,
    imageSrc: null, imageAssetId: 'asset-1', createdAt: 1, updatedAt: 1,
  };
  const baseBundle = {
    version: 1 as const,
    index: { schemaVersion: document.schemaVersion, activeDocumentId: document.id, documents: [] },
    documents: [document],
  };
  assert.ok(parseMindMapBackupBundle({ ...baseBundle, assets: [] }).error);
  assert.equal(parseMindMapBackupBundle({
    ...baseBundle,
    assets: [{ id: 'asset-1', mimeType: 'image/png', dataUrl: 'data:image/png;base64,AA==' }],
  }).bundle?.assets?.length, 1);
});

test('parseMindMapBackupBundle ignores a missing payload', () => {
  assert.deepEqual(parseMindMapBackupBundle(undefined), {});
  assert.equal(parseMindMapBackupBundle({ version: 1, documents: [] }).bundle?.documents.length, 0);
});

test('first connection can keep cloud projects and local daily data by domain', () => {
  const local = emptyBackup();
  local.timeline.tasks = [{ id: 'local-project' }] as WorkspaceBackup['timeline']['tasks'];
  local.daily.schedules = { '2026-09-05': { id: 'local-day' } } as WorkspaceBackup['daily']['schedules'];
  const remote = emptyBackup();
  remote.timeline.tasks = [{ id: 'cloud-project' }] as WorkspaceBackup['timeline']['tasks'];
  remote.daily.schedules = { '2026-09-04': { id: 'cloud-day' } } as WorkspaceBackup['daily']['schedules'];

  const merged = createMergedBackup(local, remote, {
    tasks: 'cloud',
    schedules: 'local',
  });

  assert.equal(merged.timeline.tasks[0]?.id, 'cloud-project');
  assert.deepEqual(Object.keys(merged.daily.schedules), ['2026-09-05']);
});

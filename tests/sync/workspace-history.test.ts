import assert from 'node:assert/strict';
import test from 'node:test';
import { saveWorkspaceDailyHistoryOnce } from '../../src/services/workspaceHistory.ts';
import type { WorkspaceBackup } from '../../src/services/workspaceBackup.ts';
import { DEFAULT_EBB_SETTINGS } from '../../src/ebb/constants.ts';
import { createEmptyLifeMapData } from '../../src/lifeMap/data.ts';

test('daily history retries failures, deduplicates in-flight work and stops after success', async () => {
  const backup: WorkspaceBackup = {
    kind: 'smart-line-workspace', schemaVersion: 10, revision: 1, exportedAt: new Date().toISOString(), deviceId: 'test',
    timeline: { tasks: [], groups: [], notes: [], milestones: [], lifeStages: [] },
    lifeMap: createEmptyLifeMapData(),
    ebb: { reviewTasks: [], inboxItems: [], outlineNodes: [], ebbSettings: DEFAULT_EBB_SETTINGS },
    graph: { nodes: [] }, daily: { schedules: {} }, settings: {},
  };
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;
  globalThis.window = { setTimeout, clearTimeout } as unknown as Window & typeof globalThis;
  let requests = 0;
  globalThis.fetch = async (_input, init) => {
    requests++;
    if (requests === 1) throw new TypeError('temporary network failure');
    return new Response(null, { status: init?.method === 'HEAD' ? 404 : 200 });
  };
  try {
    await assert.rejects(saveWorkspaceDailyHistoryOnce(backup), /temporary network failure/);
    await Promise.all([saveWorkspaceDailyHistoryOnce(backup), saveWorkspaceDailyHistoryOnce(backup)]);
    assert.equal(requests, 3);
    await saveWorkspaceDailyHistoryOnce(backup);
    assert.equal(requests, 3);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.window = originalWindow;
  }
});

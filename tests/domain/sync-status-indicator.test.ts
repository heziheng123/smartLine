import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSyncIndicatorState } from '../../src/components/syncStatusIndicatorState.ts';
import {
  readMindMapSyncRuntimeState,
  reportMindMapSyncRuntimeState,
} from '../../src/mindMap/syncRuntime.ts';

const connected = { enabled: true, status: 'connected' as const };

test('sync indicator distinguishes automatic recovery, user action, and stopped states', () => {
  assert.equal(deriveSyncIndicatorState({
    modules: [{ enabled: false, status: 'disconnected' }],
    online: true,
    pendingCount: 0,
    conflictCount: 0,
    queueError: false,
  }), 'off');

  assert.equal(deriveSyncIndicatorState({
    modules: [{ enabled: true, status: 'connecting' }],
    online: true,
    pendingCount: 0,
    conflictCount: 0,
    queueError: false,
  }), 'connecting');

  assert.equal(deriveSyncIndicatorState({
    modules: [connected, connected],
    online: true,
    pendingCount: 0,
    conflictCount: 0,
    queueError: false,
  }), 'connected');

  assert.equal(deriveSyncIndicatorState({
    modules: [connected],
    online: true,
    pendingCount: 2,
    conflictCount: 0,
    queueError: false,
  }), 'pending');

  assert.equal(deriveSyncIndicatorState({
    modules: [connected],
    online: true,
    pendingCount: 0,
    conflictCount: 1,
    queueError: false,
  }), 'needs-action');
});

test('sync errors take precedence over pending and offline states', () => {
  assert.equal(deriveSyncIndicatorState({
    modules: [{ enabled: true, status: 'error' }],
    online: false,
    pendingCount: 3,
    conflictCount: 0,
    queueError: true,
  }), 'stopped');
});

test('retryable flush failures stay pending instead of looking permanently stopped', () => {
  assert.equal(deriveSyncIndicatorState({
    modules: [connected],
    online: true,
    pendingCount: 0,
    conflictCount: 0,
    queueError: false,
    recoverableError: true,
  }), 'pending');
});

test('a partially enabled workspace is not reported as fully synchronized', () => {
  assert.equal(deriveSyncIndicatorState({
    modules: [
      connected,
      { enabled: false, status: 'disconnected' },
      { enabled: false, status: 'disconnected' },
    ],
    online: true,
    pendingCount: 0,
    conflictCount: 0,
    queueError: false,
  }), 'pending');
});

test('runtime phases prevent a green status while initialization is still running', () => {
  assert.equal(deriveSyncIndicatorState({
    modules: [connected, connected],
    online: true,
    pendingCount: 0,
    conflictCount: 0,
    queueError: false,
    runtimePhase: 'initializing',
  }), 'connecting');

  assert.equal(deriveSyncIndicatorState({
    modules: [connected, connected],
    online: true,
    pendingCount: 0,
    conflictCount: 0,
    queueError: false,
    runtimePhase: 'error',
  }), 'stopped');
});

test('mind map reports its separate room state to the shared sync UI', () => {
  reportMindMapSyncRuntimeState({ status: 'connecting', error: null });
  assert.deepEqual(readMindMapSyncRuntimeState(), { status: 'connecting', error: null });

  reportMindMapSyncRuntimeState({ status: 'error', error: '地图图片上传失败' });
  assert.deepEqual(readMindMapSyncRuntimeState(), { status: 'error', error: '地图图片上传失败' });
});

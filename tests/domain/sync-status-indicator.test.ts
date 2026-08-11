import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveSyncIndicatorState } from '../../src/components/syncStatusIndicatorState.ts';

const connected = { enabled: true, status: 'connected' as const };

test('sync indicator distinguishes the five user-visible states', () => {
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
  }), 'error');
});

test('sync errors take precedence over pending and offline states', () => {
  assert.equal(deriveSyncIndicatorState({
    modules: [{ enabled: true, status: 'error' }],
    online: false,
    pendingCount: 3,
    conflictCount: 0,
    queueError: true,
  }), 'error');
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

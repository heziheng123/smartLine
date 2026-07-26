import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionCookie, SESSION_COOKIE } from '../../functions/_lib/session.ts';
import { onRequestPut as saveArchive } from '../../functions/api/archives/[period].ts';
import type { StorageEnv, SmartLineR2Bucket } from '../../functions/_lib/r2.ts';

const sessionEnv = {
  SMARTLINE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-32-characters',
};

async function cookie(): Promise<string> {
  const value = await createSessionCookie('12345', 'owner', sessionEnv);
  return value.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? '';
}

test('R2 archives are authenticated and scoped to the signed-in user', async () => {
  const writes: Array<{ key: string; metadata?: Record<string, string> }> = [];
  const bucket: SmartLineR2Bucket = {
    async put(key, _value, options) { writes.push({ key, metadata: options?.customMetadata }); },
    async get() { return null; },
    async delete() { return undefined; },
  };
  const env: StorageEnv = { ...sessionEnv, SMARTLINE_R2: bucket };
  const sessionCookie = await cookie();
  const response = await saveArchive({
    env,
    params: { period: '2026-07' },
    request: new Request('https://smartline.example/api/archives/2026-07', {
      method: 'PUT',
      headers: {
        Cookie: `${SESSION_COOKIE}=${sessionCookie}`,
        Origin: 'https://smartline.example',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ version: 1, period: '2026-07', data: {} }),
    }),
  });
  assert.equal(response.status, 200);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].key, 'users/12345/archives/2026-07.json');
  assert.equal(writes[0].metadata?.owner, '12345');

  const crossOrigin = await saveArchive({
    env,
    params: { period: '2026-07' },
    request: new Request('https://smartline.example/api/archives/2026-07', {
      method: 'PUT',
      headers: { Cookie: `${SESSION_COOKIE}=${sessionCookie}`, Origin: 'https://attacker.example' },
      body: JSON.stringify({ version: 1, period: '2026-07', data: {} }),
    }),
  });
  assert.equal(crossOrigin.status, 403);
});

test('R2 archive endpoints fail closed when login or binding is missing', async () => {
  const unauthenticated = await saveArchive({
    env: { ...sessionEnv, SMARTLINE_R2: { put: async () => undefined, get: async () => null, delete: async () => undefined } },
    params: { period: '2026-07' },
    request: new Request('https://smartline.example/api/archives/2026-07', {
      method: 'PUT', headers: { Origin: 'https://smartline.example' }, body: JSON.stringify({ version: 1, period: '2026-07', data: {} }),
    }),
  });
  assert.equal(unauthenticated.status, 401);
  const unavailable = await saveArchive({
    env: sessionEnv,
    params: { period: '2026-07' },
    request: new Request('https://smartline.example/api/archives/2026-07', { method: 'PUT' }),
  });
  assert.equal(unavailable.status, 503);
});

test('R2 archives reject oversized and mismatched payloads before storage', async () => {
  let writeCount = 0;
  const env: StorageEnv = {
    ...sessionEnv,
    SMARTLINE_R2: {
      put: async () => { writeCount += 1; },
      get: async () => null,
      delete: async () => undefined,
    },
  };
  const sessionCookie = await cookie();
  const headers = {
    Cookie: `${SESSION_COOKIE}=${sessionCookie}`,
    Origin: 'https://smartline.example',
    'Content-Type': 'application/json',
  };
  const mismatched = await saveArchive({
    env,
    params: { period: '2026-07' },
    request: new Request('https://smartline.example/api/archives/2026-07', {
      method: 'PUT', headers, body: JSON.stringify({ version: 1, period: '2026-08', data: {} }),
    }),
  });
  assert.equal(mismatched.status, 400);

  const oversized = await saveArchive({
    env,
    params: { period: '2026-07' },
    request: new Request('https://smartline.example/api/archives/2026-07', {
      method: 'PUT', headers: { ...headers, 'Content-Length': String(11 * 1024 * 1024) }, body: '{}',
    }),
  });
  assert.equal(oversized.status, 413);
  assert.equal(writeCount, 0);
});

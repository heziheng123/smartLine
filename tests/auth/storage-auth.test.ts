import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionCookie, SESSION_COOKIE } from '../../functions/_lib/session.ts';
import { onRequestHead as inspectArchive, onRequestPut as saveArchive } from '../../functions/api/archives/[period].ts';
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

test('R2 archives use etags to reject stale writes from another device', async () => {
  let currentEtag = '"archive-v1"';
  const env: StorageEnv = {
    ...sessionEnv,
    SMARTLINE_R2: {
      async get() {
        return {
          body: new ReadableStream<Uint8Array>({ start(controller) { controller.close(); } }),
          httpEtag: currentEtag,
        };
      },
      async put(_key, _value, options) {
        const onlyIf = options?.onlyIf;
        const expected = onlyIf instanceof Headers ? onlyIf.get('If-Match') : onlyIf?.etagMatches;
        if (expected && expected !== currentEtag) return null;
        currentEtag = '"archive-v2"';
        return {};
      },
      async delete() { return undefined; },
    },
  };
  const sessionCookie = await cookie();
  const headers = {
    Cookie: `${SESSION_COOKIE}=${sessionCookie}`,
    Origin: 'https://smartline.example',
    'Content-Type': 'application/json',
  };
  const head = await inspectArchive({
    env,
    params: { period: '2026-07' },
    request: new Request('https://smartline.example/api/archives/2026-07', { method: 'HEAD', headers }),
  });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('ETag'), '"archive-v1"');

  const first = await saveArchive({
    env,
    params: { period: '2026-07' },
    request: new Request('https://smartline.example/api/archives/2026-07', {
      method: 'PUT', headers: { ...headers, 'If-Match': '"archive-v1"' },
      body: JSON.stringify({ version: 1, period: '2026-07', data: { device: 'A' } }),
    }),
  });
  assert.equal(first.status, 200);

  const stale = await saveArchive({
    env,
    params: { period: '2026-07' },
    request: new Request('https://smartline.example/api/archives/2026-07', {
      method: 'PUT', headers: { ...headers, 'If-Match': '"archive-v1"' },
      body: JSON.stringify({ version: 1, period: '2026-07', data: { device: 'B' } }),
    }),
  });
  assert.equal(stale.status, 409);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionCookie, SESSION_COOKIE } from '../../functions/_lib/session.ts';
import { onRequestPost as createUploadToken } from '../../functions/api/files/token.ts';
import { onRequestPut as uploadFile } from '../../functions/api/files/upload.ts';
import type { StorageEnv, SmartLineR2Bucket } from '../../functions/_lib/r2.ts';

const sessionEnv = {
  SMARTLINE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-32-characters',
};

async function cookie(): Promise<string> {
  const value = await createSessionCookie('12345', 'owner', sessionEnv);
  return value.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1] ?? '';
}

test('R2 upload grants are authenticated, scoped and never expose the binding', async () => {
  const writes: Array<{ key: string; metadata?: Record<string, string> }> = [];
  const bucket: SmartLineR2Bucket = {
    async put(key, _value, options) { writes.push({ key, metadata: options?.customMetadata }); },
    async get() { return null; },
    async delete() { return undefined; },
  };
  const env: StorageEnv = { ...sessionEnv, SMARTLINE_R2: bucket };
  const sessionCookie = await cookie();
  const headers = { Cookie: `${SESSION_COOKIE}=${sessionCookie}`, Origin: 'https://smartline.example', 'Content-Type': 'application/json' };
  const grantResponse = await createUploadToken({
    env,
    request: new Request('https://smartline.example/api/files/token', {
      method: 'POST', headers, body: JSON.stringify({ name: 'notes.png', type: 'image/png', size: 4 }),
    }),
  });
  assert.equal(grantResponse.status, 200);
  const grant = await grantResponse.json() as { id: string; token: string; uploadUrl: string };
  assert.equal(grant.uploadUrl, '/api/files/upload');
  assert.ok(grant.token);

  const uploadResponse = await uploadFile({
    env,
    request: new Request('https://smartline.example/api/files/upload', {
      method: 'PUT',
      headers: { Cookie: `${SESSION_COOKIE}=${sessionCookie}`, Origin: 'https://smartline.example', Authorization: `Bearer ${grant.token}`, 'Content-Length': '4' },
      body: new Uint8Array([1, 2, 3, 4]),
    }),
  });
  assert.equal(uploadResponse.status, 200);
  assert.equal(writes.length, 1);
  assert.match(writes[0].key, /^users\/12345\/attachments\//);
  assert.equal(writes[0].metadata?.name, 'notes.png');

  const tampered = await uploadFile({
    env,
    request: new Request('https://smartline.example/api/files/upload', {
      method: 'PUT',
      headers: { Cookie: `${SESSION_COOKIE}=${sessionCookie}`, Origin: 'https://smartline.example', Authorization: `Bearer ${grant.token}x` },
      body: new Uint8Array([1]),
    }),
  });
  assert.equal(tampered.status, 403);
});

test('R2 endpoints fail closed when login or binding is missing', async () => {
  const unauthenticated = await createUploadToken({
    env: { ...sessionEnv, SMARTLINE_R2: { put: async () => undefined, get: async () => null, delete: async () => undefined } },
    request: new Request('https://smartline.example/api/files/token', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'a', size: 1 }),
    }),
  });
  assert.equal(unauthenticated.status, 401);
  const unavailable = await createUploadToken({
    env: sessionEnv,
    request: new Request('https://smartline.example/api/files/token', { method: 'POST' }),
  });
  assert.equal(unavailable.status, 503);
});

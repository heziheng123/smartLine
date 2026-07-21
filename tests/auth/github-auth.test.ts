import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createSessionCookie,
  createOAuthCookies,
  readSession,
  SESSION_COOKIE,
  signValue,
  verifySignedValue,
  type AuthEnv,
} from '../../functions/_lib/session.ts';
import { onRequestGet as startGitHubLogin } from '../../functions/api/auth/github/start.ts';
import { onRequestGet as finishGitHubLogin } from '../../functions/api/auth/github/callback.ts';
import { onRequestPost as authenticateLiveblocks } from '../../functions/api/liveblocks-auth.ts';

const env: AuthEnv = {
  ALLOWED_GITHUB_LOGIN: 'owner',
  GITHUB_CLIENT_ID: 'client-id',
  GITHUB_CLIENT_SECRET: 'client-secret',
  LIVEBLOCKS_SECRET_KEY: 'sk_test_secret',
  SMARTLINE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-32-characters',
};

test('signed values and sessions reject tampering', async () => {
  const signed = await signValue('protected', env);
  assert.equal(await verifySignedValue(signed, env), 'protected');
  assert.equal(await verifySignedValue(`${signed}x`, env), null);

  const setCookie = await createSessionCookie('12345', 'owner', env);
  const sessionValue = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  assert.ok(sessionValue);
  const session = await readSession(new Request('https://smartline.example', {
    headers: { Cookie: `${SESSION_COOKIE}=${sessionValue}` },
  }), env);
  assert.equal(session?.githubUserId, '12345');
  assert.equal(session?.login, 'owner');
});

test('GitHub login start uses state, PKCE and protected temporary cookies', async () => {
  const response = await startGitHubLogin({
    env,
    request: new Request('https://smartline.example/api/auth/github/start'),
  });
  assert.equal(response.status, 302);
  const location = new URL(response.headers.get('location') ?? '');
  assert.equal(location.origin, 'https://github.com');
  assert.equal(location.searchParams.get('client_id'), 'client-id');
  assert.equal(location.searchParams.get('redirect_uri'), 'https://smartline.example/api/auth/github/callback');
  assert.ok(location.searchParams.get('state'));
  assert.ok(location.searchParams.get('code_challenge'));
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  const cookies = response.headers.get('set-cookie') ?? '';
  assert.match(cookies, /smartline_oauth_state=/);
  assert.match(cookies, /smartline_oauth_verifier=/);
  assert.match(cookies, /HttpOnly/);
  assert.match(cookies, /Secure/);
});

test('GitHub callback accepts only the allowed account and creates a session', async (context) => {
  const state = 'expected-state';
  const temporaryCookies = await createOAuthCookies(state, 'pkce-verifier', env);
  const cookieHeader = temporaryCookies.map((value) => value.split(';', 1)[0]).join('; ');
  const originalFetch = globalThis.fetch;
  let requestCount = 0;
  globalThis.fetch = async (input) => {
    requestCount += 1;
    if (String(input).includes('access_token')) return Response.json({ access_token: 'temporary-token' });
    return Response.json({ id: 12345, login: 'OWNER' });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const response = await finishGitHubLogin({
    env,
    request: new Request(`https://smartline.example/api/auth/github/callback?code=one-time-code&state=${state}`, {
      headers: { Cookie: cookieHeader },
    }),
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), 'https://smartline.example/');
  assert.match(response.headers.get('set-cookie') ?? '', /smartline_session=/);
  assert.doesNotMatch(response.headers.get('set-cookie') ?? '', /temporary-token/);
  assert.equal(requestCount, 2);
});

test('Liveblocks endpoint requires a session and uses a stable GitHub identity', async (context) => {
  const originalFetch = globalThis.fetch;
  const requests: Array<{ body: { userId: string }; url: string }> = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ body: JSON.parse(String(init?.body)), url: String(input) });
    return Response.json({ token: 'liveblocks-id-token' });
  };
  context.after(() => { globalThis.fetch = originalFetch; });

  const unauthenticated = await authenticateLiveblocks({
    env,
    request: new Request('https://smartline.example/api/liveblocks-auth', { method: 'POST' }),
  });
  assert.equal(unauthenticated.status, 401);

  const setCookie = await createSessionCookie('12345', 'owner', env);
  const sessionValue = setCookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`))?.[1];
  const authenticated = await authenticateLiveblocks({
    env,
    request: new Request('https://smartline.example/api/liveblocks-auth', {
      method: 'POST',
      headers: { Cookie: `${SESSION_COOKIE}=${sessionValue}`, Origin: 'https://smartline.example' },
    }),
  });
  assert.equal(authenticated.status, 200);
  assert.deepEqual(await authenticated.json(), { token: 'liveblocks-id-token' });
  assert.equal(requests[0].url, 'https://api.liveblocks.io/v2/identify-user');
  assert.equal(requests[0].body.userId, 'gh_12345');

  const crossOrigin = await authenticateLiveblocks({
    env,
    request: new Request('https://smartline.example/api/liveblocks-auth', {
      method: 'POST', headers: { Origin: 'https://attacker.example' },
    }),
  });
  assert.equal(crossOrigin.status, 403);
});

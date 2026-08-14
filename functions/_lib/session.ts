export interface AuthEnv {
  ALLOWED_GITHUB_LOGIN?: string;
  AUTH_ALLOW_DEV_BYPASS?: string;
  DEV_AUTH_USER_ID?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  LIVEBLOCKS_SECRET_KEY?: string;
  SMARTLINE_SESSION_SECRET?: string;
}

export interface SessionPayload {
  expiresAt: number;
  githubUserId: string;
  issuedAt: number;
  login: string;
  version: 1;
}

export const SESSION_COOKIE = 'smartline_session';
export const OAUTH_STATE_COOKIE = 'smartline_oauth_state';
export const OAUTH_VERIFIER_COOKIE = 'smartline_oauth_verifier';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const OAUTH_SECONDS = 10 * 60;

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function requireSessionSecret(env: AuthEnv): string {
  const secret = env.SMARTLINE_SESSION_SECRET?.trim() ?? '';
  if (secret.length < 32) throw new Error('SMARTLINE_SESSION_SECRET must contain at least 32 characters.');
  return secret;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signValue(value: string, env: AuthEnv): Promise<string> {
  const encoded = encodeBase64Url(new TextEncoder().encode(value));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(requireSessionSecret(env)), new TextEncoder().encode(encoded));
  return `${encoded}.${encodeBase64Url(new Uint8Array(signature))}`;
}

export async function verifySignedValue(value: string | undefined, env: AuthEnv): Promise<string | null> {
  if (!value) return null;
  const [encoded, signature, ...extra] = value.split('.');
  if (!encoded || !signature || extra.length > 0) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(requireSessionSecret(env)),
      decodeBase64Url(signature),
      new TextEncoder().encode(encoded),
    );
    return valid ? new TextDecoder().decode(decodeBase64Url(encoded)) : null;
  } catch {
    return null;
  }
}

export function randomUrlSafeValue(byteLength = 32): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function createCodeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return encodeBase64Url(new Uint8Array(digest));
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get('Cookie') ?? '';
  for (const part of cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return undefined;
}

function cookie(name: string, value: string, maxAge: number, path = '/'): string {
  return `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearCookie(name: string, path = '/'): string {
  return cookie(name, '', 0, path);
}

export async function createOAuthCookies(state: string, verifier: string, env: AuthEnv): Promise<string[]> {
  return [
    cookie(OAUTH_STATE_COOKIE, await signValue(state, env), OAUTH_SECONDS, '/api/auth/github'),
    cookie(OAUTH_VERIFIER_COOKIE, await signValue(verifier, env), OAUTH_SECONDS, '/api/auth/github'),
  ];
}

export function clearOAuthCookies(): string[] {
  return [clearCookie(OAUTH_STATE_COOKIE, '/api/auth/github'), clearCookie(OAUTH_VERIFIER_COOKIE, '/api/auth/github')];
}

export async function createSessionCookie(githubUserId: string, login: string, env: AuthEnv): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { version: 1, githubUserId, login, issuedAt, expiresAt: issuedAt + SESSION_SECONDS };
  return cookie(SESSION_COOKIE, await signValue(JSON.stringify(payload), env), SESSION_SECONDS);
}

export async function readSession(request: Request, env: AuthEnv): Promise<SessionPayload | null> {
  const value = await verifySignedValue(readCookie(request, SESSION_COOKIE), env);
  if (!value) return null;
  try {
    const payload = JSON.parse(value) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    if (payload.version !== 1 || !payload.githubUserId || !payload.login || payload.expiresAt <= now) return null;
    return payload;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request): boolean {
  const origin = request.headers.get('Origin');
  // For state-changing requests, if Origin is present it must match.
  // Non-browser clients (curl, etc.) don't send Origin and are not a CSRF vector
  // because SameSite=Lax cookie protection applies to browser-initiated requests.
  // However, to be explicit: if Origin is provided it must be the app origin.
  if (origin && origin !== new URL(request.url).origin) return false;
  return true;
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}

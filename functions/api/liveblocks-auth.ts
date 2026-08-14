import { isSameOriginRequest, jsonResponse, readSession, type AuthEnv } from '../_lib/session.ts';

interface FunctionContext { env: AuthEnv; request: Request }
const LIVEBLOCKS_AUTHORIZE_URL = 'https://api.liveblocks.io/v2/authorize-user';

function isLocalRequest(): boolean {
  // Check NODE_ENV instead of request hostname to prevent Host-header spoofing attacks.
  // AUTH_ALLOW_DEV_BYPASS=true should only be set in non-production environments.
  return process.env.NODE_ENV !== 'production';
}

interface ResolvedIdentity { userId: string; login: string }

function sanitizeRoomIdentity(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

async function resolveIdentity({ env, request }: FunctionContext): Promise<ResolvedIdentity | null> {
  if (env.AUTH_ALLOW_DEV_BYPASS === 'true' && isLocalRequest()) {
    const localId = env.DEV_AUTH_USER_ID?.trim();
    return localId ? { userId: `dev_${localId}`, login: localId } : null;
  }
  const session = await readSession(request, env);
  return session ? { userId: `gh_${session.githubUserId}`, login: session.login } : null;
}

function canAccessRoom(room: string, identity: ResolvedIdentity, env: AuthEnv): boolean {
  // Legacy rooms have no owner encoded in their name, so they cannot be safely
  // authorized in a multi-user deployment. Restrict migration access to the
  // explicitly configured deployment owner (or the localhost-only dev user).
  if (!room.startsWith('workspace-')) {
    const configuredOwner = sanitizeRoomIdentity(env.ALLOWED_GITHUB_LOGIN ?? '');
    return (configuredOwner !== '' && configuredOwner === sanitizeRoomIdentity(identity.login))
      || (env.AUTH_ALLOW_DEV_BYPASS === 'true' && identity.userId.startsWith('dev_'));
  }
  // Unified rooms are owner-scoped and accept both the stable GitHub id and
  // the historical login identity during the room-id transition.
  const allowedPrefixes = [identity.userId, identity.login]
    .map(sanitizeRoomIdentity)
    .filter(Boolean)
    .map((value) => `workspace-${value}-`);
  return allowedPrefixes.some((prefix) => room.startsWith(prefix));
}

async function readRequestedRoom(request: Request): Promise<string | null> {
  try {
    const payload = await request.json() as { room?: unknown };
    const room = typeof payload.room === 'string' ? payload.room.trim() : '';
    const containsControlCharacter = [...room]
      .some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
    if (!room || room.length > 128 || containsControlCharacter) return null;
    return room;
  } catch {
    return null;
  }
}

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  if (!isSameOriginRequest(context.request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  const secret = context.env.LIVEBLOCKS_SECRET_KEY?.trim();
  if (!secret?.startsWith('sk_')) return jsonResponse({ error: 'Liveblocks authentication is not configured.' }, 503);

  let identity: ResolvedIdentity | null = null;
  try { identity = await resolveIdentity(context); } catch (error) {
    console.warn('[liveblocks-auth] Session validation failed:', error instanceof Error ? error.message : error);
  }
  if (!identity) return jsonResponse({ error: 'Authentication required.' }, 401);
  const room = await readRequestedRoom(context.request);
  if (!room) return jsonResponse({ error: 'A valid Liveblocks room is required.' }, 400);
  if (!canAccessRoom(room, identity, context.env)) return jsonResponse({ error: 'The requested room does not belong to this user.' }, 403);

  try {
    // Access tokens carry the exact room permission. This avoids issuing an ID
    // token that reaches the WebSocket server but is rejected because no room
    // permissions were provisioned in advance.
    const response = await fetch(LIVEBLOCKS_AUTHORIZE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: identity.userId,
        permissions: {
          [room]: ['*:write'],
        },
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return jsonResponse({ error: 'Unable to create a Liveblocks session.' }, 502);
    const payload = await response.json() as { token?: string };
    return payload.token ? jsonResponse({ token: payload.token }) : jsonResponse({ error: 'Invalid Liveblocks response.' }, 502);
  } catch (error) {
    console.error('[liveblocks-auth] Request failed:', error instanceof Error ? error.message : error);
    return jsonResponse({ error: 'Liveblocks authentication is temporarily unavailable.' }, 502);
  }
}

export function onRequestOptions(): Response {
  return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store', Allow: 'POST, OPTIONS' } });
}

export function onRequest(): Response {
  return jsonResponse({ error: 'Method not allowed.' }, 405);
}

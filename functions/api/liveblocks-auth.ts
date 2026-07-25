import { isSameOriginRequest, jsonResponse, readSession, type AuthEnv } from '../_lib/session.ts';

interface FunctionContext { env: AuthEnv; request: Request }
const LIVEBLOCKS_AUTHORIZE_URL = 'https://api.liveblocks.io/v2/authorize-user';

function isLocalRequest(request: Request): boolean {
  const hostname = new URL(request.url).hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

async function resolveUserId({ env, request }: FunctionContext): Promise<string | null> {
  if (env.AUTH_ALLOW_DEV_BYPASS === 'true' && isLocalRequest(request)) {
    const localId = env.DEV_AUTH_USER_ID?.trim();
    return localId ? `dev_${localId}` : null;
  }
  const session = await readSession(request, env);
  return session ? `gh_${session.githubUserId}` : null;
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

  let userId: string | null = null;
  try { userId = await resolveUserId(context); } catch (error) {
    console.warn('[liveblocks-auth] Session validation failed:', error instanceof Error ? error.message : error);
  }
  if (!userId) return jsonResponse({ error: 'Authentication required.' }, 401);
  const room = await readRequestedRoom(context.request);
  if (!room) return jsonResponse({ error: 'A valid Liveblocks room is required.' }, 400);

  try {
    // Access tokens carry the exact room permission. This avoids issuing an ID
    // token that reaches the WebSocket server but is rejected because no room
    // permissions were provisioned in advance.
    const response = await fetch(LIVEBLOCKS_AUTHORIZE_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        permissions: {
          [room]: ['*:write'],
        },
      }),
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

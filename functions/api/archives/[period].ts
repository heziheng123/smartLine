import { isSameOriginRequest, jsonResponse, readSession } from '../../_lib/session.ts';
import { archiveKey, readLimitedBody, type StorageEnv } from '../../_lib/r2.ts';

interface FunctionContext { env: StorageEnv; request: Request; params: { period?: string } }
function validPeriod(value: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }

function archiveResponseHeaders(httpEtag?: string): HeadersInit {
  return {
    'Cache-Control': 'private, no-store',
    'Content-Type': 'application/json',
    ...(httpEtag ? { ETag: httpEtag } : {}),
  };
}

export async function onRequestGet({ env, request, params }: FunctionContext): Promise<Response> {
  if (!env.SMARTLINE_R2) return jsonResponse({ error: 'R2 storage is not configured.' }, 503);
  const session = await readSession(request, env);
  const period = params.period ?? '';
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  if (!validPeriod(period)) return jsonResponse({ error: 'Invalid archive period.' }, 400);
  try {
    const object = await env.SMARTLINE_R2.get(archiveKey(session.githubUserId, period));
    if (!object) return jsonResponse({ error: 'Archive not found.' }, 404);
    return new Response(object.body, { headers: archiveResponseHeaders(object.httpEtag) });
  } catch {
    return jsonResponse({ error: 'Archive storage is temporarily unavailable.' }, 502);
  }
}

export async function onRequestHead({ env, request, params }: FunctionContext): Promise<Response> {
  if (!env.SMARTLINE_R2) return jsonResponse({ error: 'R2 storage is not configured.' }, 503);
  const session = await readSession(request, env);
  const period = params.period ?? '';
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  if (!validPeriod(period)) return jsonResponse({ error: 'Invalid archive period.' }, 400);
  try {
    const object = await env.SMARTLINE_R2.get(archiveKey(session.githubUserId, period));
    if (!object) return new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
    return new Response(null, { status: 200, headers: archiveResponseHeaders(object.httpEtag) });
  } catch {
    return jsonResponse({ error: 'Archive storage is temporarily unavailable.' }, 502);
  }
}

export async function onRequestPut({ env, request, params }: FunctionContext): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  if (!env.SMARTLINE_R2) return jsonResponse({ error: 'R2 storage is not configured.' }, 503);
  const session = await readSession(request, env);
  const period = params.period ?? '';
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  if (!validPeriod(period) || !request.body) return jsonResponse({ error: 'Invalid archive request.' }, 400);
  const maxBytes = 10 * 1024 * 1024;
  const declaredLength = Number(request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return jsonResponse({ error: 'Archive is too large.' }, 413);
  try {
    const body = await readLimitedBody(request.body, maxBytes);
    if (!body) return jsonResponse({ error: 'Archive is too large.' }, 413);
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { version?: unknown; period?: unknown };
    if (parsed.version !== 1 || parsed.period !== period) return jsonResponse({ error: 'Invalid archive payload.' }, 400);
    const key = archiveKey(session.githubUserId, period);
    const ifMatch = request.headers.get('If-Match');
    const ifNoneMatch = request.headers.get('If-None-Match');
    const conditions = new Headers();
    if (ifMatch) conditions.set('If-Match', ifMatch);
    if (ifNoneMatch) conditions.set('If-None-Match', ifNoneMatch);
    if (!ifMatch && !ifNoneMatch) {
      const existing = await env.SMARTLINE_R2.get(key);
      if (existing) return jsonResponse({ error: 'Archive has changed on another device. Reload it before saving again.' }, 409);
      conditions.set('If-None-Match', '*');
    }
    const result = await env.SMARTLINE_R2.put(key, body, {
      httpMetadata: { contentType: 'application/json' },
      customMetadata: { owner: session.githubUserId, period, archivedAt: new Date().toISOString() },
      onlyIf: conditions,
    });
    if (result === null) return jsonResponse({ error: 'Archive has changed on another device. Reload it before saving again.' }, 409);
    return jsonResponse({ ok: true, period });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonResponse({ error: 'Archive payload must be valid JSON.' }, 400);
    return jsonResponse({ error: 'Archive storage is temporarily unavailable.' }, 502);
  }
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

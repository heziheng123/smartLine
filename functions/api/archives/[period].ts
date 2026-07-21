import { isSameOriginRequest, jsonResponse, readSession } from '../../_lib/session.ts';
import { archiveKey, type StorageEnv } from '../../_lib/r2.ts';

interface FunctionContext { env: StorageEnv; request: Request; params: { period?: string } }
function validPeriod(value: string): boolean { return /^\d{4}-(0[1-9]|1[0-2])$/.test(value); }

export async function onRequestGet({ env, request, params }: FunctionContext): Promise<Response> {
  if (!env.SMARTLINE_R2) return jsonResponse({ error: 'R2 storage is not configured.' }, 503);
  const session = await readSession(request, env);
  const period = params.period ?? '';
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  if (!validPeriod(period)) return jsonResponse({ error: 'Invalid archive period.' }, 400);
  const object = await env.SMARTLINE_R2.get(archiveKey(session.githubUserId, period));
  if (!object) return jsonResponse({ error: 'Archive not found.' }, 404);
  return new Response(object.body, { headers: { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' } });
}

export async function onRequestPut({ env, request, params }: FunctionContext): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  if (!env.SMARTLINE_R2) return jsonResponse({ error: 'R2 storage is not configured.' }, 503);
  const session = await readSession(request, env);
  const period = params.period ?? '';
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  if (!validPeriod(period) || !request.body) return jsonResponse({ error: 'Invalid archive request.' }, 400);
  const length = Number(request.headers.get('Content-Length') ?? 0);
  if (length > 10 * 1024 * 1024) return jsonResponse({ error: 'Archive is too large.' }, 413);
  await env.SMARTLINE_R2.put(archiveKey(session.githubUserId, period), request.body, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: { owner: session.githubUserId, period, archivedAt: new Date().toISOString() },
  });
  return jsonResponse({ ok: true, period });
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

import { isSameOriginRequest, jsonResponse, readSession } from '../../_lib/session.ts';
import { readLimitedBody, workspaceHistoryKey, type SmartLineR2Bucket, type StorageEnv } from '../../_lib/r2.ts';

interface FunctionContext { env: StorageEnv; request: Request; params: { date?: string } }
const validDate = (value: string) => /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(value);
const headers = (etag?: string): HeadersInit => ({
  'Cache-Control': 'private, no-store',
  'Content-Type': 'application/json',
  ...(etag ? { ETag: etag } : {}),
});

type HistoryAccess = { response: Response } | { bucket: SmartLineR2Bucket; date: string; userId: string };

async function authorize({ env, request, params }: FunctionContext): Promise<HistoryAccess> {
  if (!env.SMARTLINE_R2) return { response: jsonResponse({ error: 'R2 storage is not configured.' }, 503) };
  const session = await readSession(request, env);
  const date = params.date ?? '';
  if (!session) return { response: jsonResponse({ error: 'Authentication required.' }, 401) };
  if (!validDate(date)) return { response: jsonResponse({ error: 'Invalid history date.' }, 400) };
  return { bucket: env.SMARTLINE_R2, date, userId: session.githubUserId };
}

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  const access = await authorize(context);
  if ('response' in access) return access.response;
  try {
    const object = await access.bucket.get(workspaceHistoryKey(access.userId, access.date));
    return object
      ? new Response(object.body, { headers: headers(object.httpEtag) })
      : jsonResponse({ error: 'Workspace history not found.' }, 404);
  } catch {
    return jsonResponse({ error: 'Workspace history is temporarily unavailable.' }, 502);
  }
}

export async function onRequestHead(context: FunctionContext): Promise<Response> {
  const access = await authorize(context);
  if ('response' in access) return access.response;
  try {
    const object = await access.bucket.get(workspaceHistoryKey(access.userId, access.date));
    return object
      ? new Response(null, { status: 200, headers: headers(object.httpEtag) })
      : new Response(null, { status: 404, headers: { 'Cache-Control': 'private, no-store' } });
  } catch {
    return jsonResponse({ error: 'Workspace history is temporarily unavailable.' }, 502);
  }
}

export async function onRequestPut(context: FunctionContext): Promise<Response> {
  if (!isSameOriginRequest(context.request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  const access = await authorize(context);
  if ('response' in access) return access.response;
  if (!context.request.body) return jsonResponse({ error: 'Invalid history request.' }, 400);
  const maxBytes = 10 * 1024 * 1024;
  const declaredLength = Number(context.request.headers.get('Content-Length') ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return jsonResponse({ error: 'Workspace history is too large.' }, 413);
  try {
    const body = await readLimitedBody(context.request.body, maxBytes);
    if (!body) return jsonResponse({ error: 'Workspace history is too large.' }, 413);
    const value = JSON.parse(new TextDecoder().decode(body)) as {
      version?: unknown; date?: unknown; hash?: unknown; backup?: { kind?: unknown; schemaVersion?: unknown };
    };
    if (value.version !== 1
      || value.date !== access.date
      || typeof value.hash !== 'string'
      || value.backup?.kind !== 'smart-line-workspace'
      || typeof value.backup.schemaVersion !== 'number') {
      return jsonResponse({ error: 'Invalid workspace history payload.' }, 400);
    }
    const conditions = new Headers();
    const ifMatch = context.request.headers.get('If-Match');
    if (ifMatch) conditions.set('If-Match', ifMatch);
    else conditions.set('If-None-Match', '*');
    const result = await access.bucket.put(
      workspaceHistoryKey(access.userId, access.date),
      body,
      {
        httpMetadata: { contentType: 'application/json' },
        customMetadata: { owner: access.userId, date: access.date, hash: value.hash },
        onlyIf: conditions,
      },
    );
    return result === null
      ? jsonResponse({ error: 'Workspace history changed on another device.' }, 409)
      : jsonResponse({ ok: true, date: access.date });
  } catch (error) {
    return error instanceof SyntaxError
      ? jsonResponse({ error: 'Workspace history must be valid JSON.' }, 400)
      : jsonResponse({ error: 'Workspace history is temporarily unavailable.' }, 502);
  }
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

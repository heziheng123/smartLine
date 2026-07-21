import { jsonResponse, readSession } from '../../_lib/session.ts';
import { attachmentKey, safeObjectId, type StorageEnv } from '../../_lib/r2.ts';

interface FunctionContext { env: StorageEnv; request: Request; params: { id?: string } }

export async function onRequestGet({ env, request, params }: FunctionContext): Promise<Response> {
  if (!env.SMARTLINE_R2) return jsonResponse({ error: 'R2 storage is not configured.' }, 503);
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  const id = safeObjectId(params.id ?? '');
  if (!id) return jsonResponse({ error: 'Invalid file id.' }, 400);
  const object = await env.SMARTLINE_R2.get(attachmentKey(session.githubUserId, id));
  if (!object) return jsonResponse({ error: 'File not found.' }, 404);
  return new Response(object.body, {
    headers: {
      'Cache-Control': 'private, max-age=3600',
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      ETag: object.httpEtag ?? id,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(object.customMetadata?.name ?? id)}`,
    },
  });
}

export async function onRequestDelete({ env, request, params }: FunctionContext): Promise<Response> {
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  if (!env.SMARTLINE_R2) return jsonResponse({ error: 'R2 storage is not configured.' }, 503);
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  const id = safeObjectId(params.id ?? '');
  if (!id) return jsonResponse({ error: 'Invalid file id.' }, 400);
  await env.SMARTLINE_R2.delete(attachmentKey(session.githubUserId, id));
  return jsonResponse({ ok: true });
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

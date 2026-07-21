import { isSameOriginRequest, jsonResponse, readSession, signValue } from '../../_lib/session.ts';
import type { StorageEnv } from '../../_lib/r2.ts';

interface FunctionContext { env: StorageEnv; request: Request }
const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function onRequestPost({ env, request }: FunctionContext): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  if (!env.SMARTLINE_R2) return jsonResponse({ error: 'R2 storage is not configured.' }, 503);
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  const body = await request.json().catch(() => null) as { name?: string; type?: string; size?: number } | null;
  const size = Number(body?.size);
  if (!body?.name || !Number.isFinite(size) || size <= 0 || size > MAX_FILE_BYTES) {
    return jsonResponse({ error: 'Invalid file metadata.' }, 400);
  }
  const id = crypto.randomUUID();
  const expiresAt = Math.floor(Date.now() / 1000) + 10 * 60;
  const payload = JSON.stringify({ id, userId: session.githubUserId, name: body.name.slice(0, 200), type: body.type || 'application/octet-stream', size, expiresAt });
  return jsonResponse({ id, uploadUrl: '/api/files/upload', token: await signValue(payload, env), expiresAt });
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

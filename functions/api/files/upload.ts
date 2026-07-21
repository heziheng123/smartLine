import { isSameOriginRequest, jsonResponse, readSession, verifySignedValue } from '../../_lib/session.ts';
import { attachmentKey, type StorageEnv } from '../../_lib/r2.ts';

interface FunctionContext { env: StorageEnv; request: Request }
interface UploadGrant { id: string; userId: string; name: string; type: string; size: number; expiresAt: number }

export async function onRequestPut({ env, request }: FunctionContext): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  if (!env.SMARTLINE_R2) return jsonResponse({ error: 'R2 storage is not configured.' }, 503);
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  const bearer = request.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  const verified = await verifySignedValue(bearer, env);
  if (!verified) return jsonResponse({ error: 'Invalid upload token.' }, 403);
  const grant = JSON.parse(verified) as UploadGrant;
  if (grant.userId !== session.githubUserId || grant.expiresAt <= Math.floor(Date.now() / 1000) || !request.body) {
    return jsonResponse({ error: 'Upload token expired or mismatched.' }, 403);
  }
  const contentLength = Number(request.headers.get('Content-Length') ?? grant.size);
  if (contentLength > grant.size || contentLength > 15 * 1024 * 1024) return jsonResponse({ error: 'File is too large.' }, 413);
  await env.SMARTLINE_R2.put(attachmentKey(session.githubUserId, grant.id), request.body, {
    httpMetadata: { contentType: grant.type },
    customMetadata: { name: grant.name, owner: session.githubUserId, uploadedAt: new Date().toISOString() },
  });
  return jsonResponse({ id: grant.id, name: grant.name, type: grant.type, size: grant.size });
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

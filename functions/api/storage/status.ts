import { jsonResponse, readSession } from '../../_lib/session.ts';
import type { StorageEnv } from '../../_lib/r2.ts';

interface FunctionContext { env: StorageEnv; request: Request }

export async function onRequestGet({ env, request }: FunctionContext): Promise<Response> {
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  return jsonResponse({ r2Configured: Boolean(env.SMARTLINE_R2), archiveEnabled: Boolean(env.SMARTLINE_R2) });
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

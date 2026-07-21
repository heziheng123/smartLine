import { jsonResponse, readSession, type AuthEnv } from '../../_lib/session.ts';

interface FunctionContext { env: AuthEnv; request: Request }

export async function onRequestGet({ env, request }: FunctionContext): Promise<Response> {
  try {
    const session = await readSession(request, env);
    return session
      ? jsonResponse({ authenticated: true, login: session.login, userId: `gh_${session.githubUserId}` })
      : jsonResponse({ authenticated: false }, 401);
  } catch (error) {
    console.error('[github-auth] Session validation failed:', error instanceof Error ? error.message : error);
    return jsonResponse({ authenticated: false }, 401);
  }
}

export function onRequest(): Response {
  return jsonResponse({ error: 'Method not allowed.' }, 405);
}

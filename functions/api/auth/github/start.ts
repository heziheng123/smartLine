import {
  createCodeChallenge,
  createOAuthCookies,
  randomUrlSafeValue,
  type AuthEnv,
} from '../../../_lib/session.ts';

interface FunctionContext { env: AuthEnv; request: Request }

export async function onRequestGet({ env, request }: FunctionContext): Promise<Response> {
  const clientId = env.GITHUB_CLIENT_ID?.trim();
  if (!clientId || !env.GITHUB_CLIENT_SECRET || !env.ALLOWED_GITHUB_LOGIN || !env.SMARTLINE_SESSION_SECRET) {
    return new Response('GitHub authentication is not configured.', { status: 503 });
  }

  const state = randomUrlSafeValue();
  const verifier = randomUrlSafeValue(48);
  const authorizeUrl = new URL('https://github.com/login/oauth/authorize');
  authorizeUrl.searchParams.set('client_id', clientId);
  authorizeUrl.searchParams.set('redirect_uri', `${new URL(request.url).origin}/api/auth/github/callback`);
  authorizeUrl.searchParams.set('state', state);
  authorizeUrl.searchParams.set('code_challenge', await createCodeChallenge(verifier));
  authorizeUrl.searchParams.set('code_challenge_method', 'S256');
  authorizeUrl.searchParams.set('allow_signup', 'false');

  const headers = new Headers({ 'Cache-Control': 'no-store', Location: authorizeUrl.toString() });
  for (const value of await createOAuthCookies(state, verifier, env)) headers.append('Set-Cookie', value);
  return new Response(null, { status: 302, headers });
}

export function onRequest(): Response {
  return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET' } });
}

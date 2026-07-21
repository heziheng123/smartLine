import {
  clearOAuthCookies,
  createSessionCookie,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  readCookie,
  verifySignedValue,
  type AuthEnv,
} from '../../../_lib/session.ts';

interface FunctionContext { env: AuthEnv; request: Request }
interface GitHubUser { id?: number; login?: string }

function redirect(origin: string, path: string, cookies: string[] = []): Response {
  const headers = new Headers({ 'Cache-Control': 'no-store', Location: `${origin}${path}` });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 302, headers });
}

export async function onRequestGet({ env, request }: FunctionContext): Promise<Response> {
  const url = new URL(request.url);
  const failed = () => redirect(url.origin, '/?auth=error', clearOAuthCookies());
  const code = url.searchParams.get('code');
  const returnedState = url.searchParams.get('state');
  const expectedState = await verifySignedValue(readCookie(request, OAUTH_STATE_COOKIE), env);
  const verifier = await verifySignedValue(readCookie(request, OAUTH_VERIFIER_COOKIE), env);
  if (!code || !returnedState || returnedState !== expectedState || !verifier) return failed();

  try {
    const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/api/auth/github/callback`,
        code_verifier: verifier,
      }),
    });
    const tokenBody = await tokenResponse.json() as { access_token?: string };
    if (!tokenResponse.ok || !tokenBody.access_token) return failed();

    const userResponse = await fetch('https://api.github.com/user', {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${tokenBody.access_token}`,
        'User-Agent': 'SmartLine',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    const user = await userResponse.json() as GitHubUser;
    const allowedLogin = env.ALLOWED_GITHUB_LOGIN?.trim().toLowerCase();
    if (!userResponse.ok || !user.id || !user.login || user.login.toLowerCase() !== allowedLogin) return failed();

    const cookies = [await createSessionCookie(String(user.id), user.login, env), ...clearOAuthCookies()];
    return redirect(url.origin, '/', cookies);
  } catch (error) {
    console.error('[github-auth] OAuth callback failed:', error instanceof Error ? error.message : error);
    return failed();
  }
}

export function onRequest(): Response {
  return new Response('Method not allowed.', { status: 405, headers: { Allow: 'GET' } });
}

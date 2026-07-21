import { clearCookie, isSameOriginRequest, jsonResponse, SESSION_COOKIE } from '../../_lib/session.ts';

interface FunctionContext { request: Request }

export function onRequestPost({ request }: FunctionContext): Response {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  return Response.json({ ok: true }, {
    headers: { 'Cache-Control': 'no-store', 'Set-Cookie': clearCookie(SESSION_COOKIE) },
  });
}

export function onRequest(): Response {
  return jsonResponse({ error: 'Method not allowed.' }, 405);
}

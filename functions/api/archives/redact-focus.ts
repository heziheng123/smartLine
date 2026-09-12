import { isSameOriginRequest, jsonResponse, readSession } from '../../_lib/session.ts';
import { readLimitedBody, type StorageEnv } from '../../_lib/r2.ts';

interface FunctionContext { env: StorageEnv; request: Request }
const RETIRED_KEYS = new Set(['focusSubjects', 'focusSessions', 'focusWeeklyReviews']);
const MAX_BYTES = 10 * 1024 * 1024;

export function redactRetiredFocusPayload(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.some(redactRetiredFocusPayload);
  const record = value as Record<string, unknown>;
  let changed = false;
  if (record.focus && typeof record.focus === 'object' && !Array.isArray(record.focus)) {
    const focus = record.focus as Record<string, unknown>;
    if ([...RETIRED_KEYS].some((key) => key in focus)) {
      delete record.focus;
      changed = true;
    }
  }
  for (const key of RETIRED_KEYS) {
    if (key in record) {
      delete record[key];
      changed = true;
    }
  }
  return Object.values(record).some(redactRetiredFocusPayload) || changed;
}

export async function onRequestPost({ env, request }: FunctionContext): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  if (!env.SMARTLINE_R2?.list) return jsonResponse({ error: 'R2 storage is not configured.' }, 503);
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  try {
    const prefix = `users/${session.githubUserId}/`;
    let cursor: string | undefined;
    let redacted = 0;
    do {
      const page = await env.SMARTLINE_R2.list({ prefix, cursor });
      cursor = page.truncated ? page.cursor : undefined;
      for (const item of page.objects) {
        const object = await env.SMARTLINE_R2.get(item.key);
        if (!object) continue;
        const body = await readLimitedBody(object.body, MAX_BYTES);
        if (!body) continue;
        const data = JSON.parse(new TextDecoder().decode(body));
        if (!redactRetiredFocusPayload(data)) continue;
        await env.SMARTLINE_R2.put(item.key, JSON.stringify(data), {
          httpMetadata: { contentType: 'application/json' },
          customMetadata: { owner: session.githubUserId, redactedAt: new Date().toISOString() },
        });
        redacted += 1;
      }
    } while (cursor);
    return jsonResponse({ ok: true, redacted });
  } catch (error) {
    if (error instanceof SyntaxError) return jsonResponse({ error: 'Stored archive payload is invalid.' }, 502);
    return jsonResponse({ error: 'Archive storage is temporarily unavailable.' }, 502);
  }
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

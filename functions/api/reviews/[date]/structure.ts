import { isSameOriginRequest, jsonResponse, readSession } from '../../../_lib/session.ts';
import { normalizeReview, type PersistedReview } from '../../../_lib/reviews.ts';
import { responseText, reviewStructureRequest, validateAiCandidates, type ReviewAiEnv } from '../../../_lib/reviewAi.ts';

interface FunctionContext { env: ReviewAiEnv; request: Request; params: { date?: string } }
const MAX_REQUEST_BYTES = 128 * 1024;
const isOperationId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,160}$/.test(value);
interface AiOperationRow { status: string; response_json: string | null }

const isDate = (value: string | undefined): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};

export async function onRequestPost({ env, request, params }: FunctionContext): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  if (!isDate(params.date)) return jsonResponse({ error: 'Invalid review date.' }, 400);
  const key = env.DEEPSEEK_API_KEY?.trim();
  if (!key) return jsonResponse({ error: 'Review AI is not configured.' }, 503);
  if (!env.REVIEW_DB) return jsonResponse({ error: 'Review database is not configured.' }, 503);
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);

  let review: PersistedReview | null;
  let operationId: string | undefined;
  try {
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return jsonResponse({ error: 'Review payload is too large.' }, 413);
    const body = JSON.parse(raw) as { review?: unknown; operationId?: unknown };
    review = normalizeReview(body.review, params.date);
    if (isOperationId(body.operationId)) operationId = body.operationId;
  } catch {
    return jsonResponse({ error: 'Invalid JSON body.' }, 400);
  }
  if (!review || !operationId || review.inputSegments.length === 0) return jsonResponse({ error: 'Review needs at least one text segment or valid operation id.' }, 400);
  const database = env.REVIEW_DB;
  const previous = await database.prepare('SELECT status, response_json FROM review_ai_operations WHERE user_id = ? AND review_date = ? AND operation_id = ?').bind(session.githubUserId, params.date, operationId).first<AiOperationRow>();
  if (previous?.status === 'completed' && previous.response_json) {
    try { return jsonResponse(JSON.parse(previous.response_json)); }
    catch { return jsonResponse({ error: 'Stored AI result is invalid.' }, 502); }
  }
  const now = new Date();
  const leaseExpiresAt = new Date(now.valueOf() + 60_000).toISOString();
  const claimed = await database.prepare(`INSERT INTO review_ai_operations (user_id, review_date, operation_id, review_revision, status, response_json, lease_expires_at, updated_at) VALUES (?, ?, ?, ?, 'processing', NULL, ?, ?)
    ON CONFLICT(user_id, review_date, operation_id) DO UPDATE SET review_revision = excluded.review_revision, status = 'processing', response_json = NULL, lease_expires_at = excluded.lease_expires_at, updated_at = excluded.updated_at
    WHERE review_ai_operations.status <> 'completed' AND review_ai_operations.lease_expires_at < ?`).bind(session.githubUserId, params.date, operationId, review.revision, leaseExpiresAt, now.toISOString(), now.toISOString()).run();
  if (claimed.meta.changes === 0) return jsonResponse({ error: 'Review AI is already processing this version.' }, 409);
  const release = () => database.prepare("DELETE FROM review_ai_operations WHERE user_id = ? AND review_date = ? AND operation_id = ? AND status = 'processing'").bind(session.githubUserId, params.date, operationId).run();
  try {
    const response = await fetch('https://api.deepseek.com/responses', {
      ...reviewStructureRequest(review, env.DEEPSEEK_MODEL?.trim() || 'deepseek-flash'),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    });
    if (!response.ok) { await release(); return jsonResponse({ error: 'Review AI is temporarily unavailable.' }, response.status === 429 ? 429 : 502); }
    const text = responseText(await response.json());
    if (!text) { await release(); return jsonResponse({ error: 'Review AI returned no structured result.' }, 502); }
    const candidates = validateAiCandidates(JSON.parse(text), review);
    if (!candidates) { await release(); return jsonResponse({ error: 'Review AI returned an invalid structured result.' }, 502); }
    const receipt = JSON.stringify({ candidates });
    await database.prepare("UPDATE review_ai_operations SET status = 'completed', response_json = ?, lease_expires_at = NULL, updated_at = ? WHERE user_id = ? AND review_date = ? AND operation_id = ? AND status = 'processing'").bind(receipt, new Date().toISOString(), session.githubUserId, params.date, operationId).run();
    return jsonResponse({ candidates });
  } catch {
    await release().catch(() => undefined);
    return jsonResponse({ error: 'Review AI is temporarily unavailable.' }, 502);
  }
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

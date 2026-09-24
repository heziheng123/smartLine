import { isSameOriginRequest, jsonResponse, readSession } from '../../_lib/session.ts';
import { normalizeReview, type PersistedReview, type ReviewEnv } from '../../_lib/reviews.ts';

interface FunctionContext { env: ReviewEnv; request: Request; params: { date?: string } }
interface ReviewRow { payload: string; revision: number }
interface OperationRow { response_json: string }

const MAX_REQUEST_BYTES = 512 * 1024;
const isDate = (value: string | undefined): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};
const isOperationId = (value: unknown): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,160}$/.test(value);

async function access({ env, request, params }: FunctionContext): Promise<{ env: ReviewEnv; userId: string; date: string } | Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  if (!env.REVIEW_DB) return jsonResponse({ error: 'Review database is not configured.' }, 503);
  if (!isDate(params.date)) return jsonResponse({ error: 'Invalid review date.' }, 400);
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  return { env, userId: session.githubUserId, date: params.date };
}

export async function onRequestGet(context: FunctionContext): Promise<Response> {
  const target = await access(context);
  if (target instanceof Response) return target;
  const row = await target.env.REVIEW_DB!.prepare('SELECT payload, revision FROM review_records WHERE user_id = ? AND review_date = ?').bind(target.userId, target.date).first<ReviewRow>();
  if (!row) return jsonResponse({ error: 'Review not found.' }, 404);
  try {
    const review = normalizeReview(JSON.parse(row.payload), target.date);
    if (!review) return jsonResponse({ error: 'Stored review payload is invalid.' }, 502);
    return jsonResponse({ review, serverRevision: row.revision });
  } catch {
    return jsonResponse({ error: 'Stored review payload is invalid.' }, 502);
  }
}

export async function onRequestPost(context: FunctionContext): Promise<Response> {
  const target = await access(context);
  if (target instanceof Response) return target;
  const size = Number(context.request.headers.get('Content-Length') ?? 0);
  if (!Number.isFinite(size) || size > MAX_REQUEST_BYTES) return jsonResponse({ error: 'Review payload is too large.' }, 413);

  let body: { review?: unknown; baseRevision?: unknown; operationId?: unknown };
  try {
    const raw = await context.request.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_REQUEST_BYTES) return jsonResponse({ error: 'Review payload is too large.' }, 413);
    body = JSON.parse(raw) as typeof body;
  } catch { return jsonResponse({ error: 'Invalid JSON body.' }, 400); }
  if (!isOperationId(body.operationId) || !(body.baseRevision === null || (typeof body.baseRevision === 'number' && Number.isSafeInteger(body.baseRevision) && body.baseRevision >= 0))) return jsonResponse({ error: 'Invalid synchronization metadata.' }, 400);
  const review = normalizeReview(body.review, target.date);
  if (!review) return jsonResponse({ error: 'Invalid review payload.' }, 400);

  const previous = await target.env.REVIEW_DB!.prepare('SELECT response_json FROM review_operations WHERE user_id = ? AND review_date = ? AND operation_id = ?').bind(target.userId, target.date, body.operationId).first<OperationRow>();
  if (previous) return jsonResponse(JSON.parse(previous.response_json));

  const existing = await target.env.REVIEW_DB!.prepare('SELECT revision FROM review_records WHERE user_id = ? AND review_date = ?').bind(target.userId, target.date).first<Pick<ReviewRow, 'revision'>>();
  if ((existing && body.baseRevision !== existing.revision) || (!existing && body.baseRevision !== null)) return jsonResponse({ error: 'Review revision conflict.', serverRevision: existing?.revision ?? null }, 409);

  const serverRevision = (existing?.revision ?? 0) + 1;
  const accepted: PersistedReview = { ...review, revision: serverRevision };
  const response = { review: accepted, serverRevision };
  const payload = JSON.stringify(accepted);
  const receipt = JSON.stringify(response);
  const now = new Date().toISOString();
  const database = target.env.REVIEW_DB!;
  const write = existing
    ? database.prepare('UPDATE review_records SET revision = ?, review_status = ?, payload = ?, updated_at = ? WHERE user_id = ? AND review_date = ? AND revision = ?').bind(serverRevision, accepted.reviewStatus, payload, now, target.userId, target.date, existing.revision)
    : database.prepare('INSERT OR IGNORE INTO review_records (user_id, review_date, revision, review_status, payload, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(target.userId, target.date, serverRevision, accepted.reviewStatus, payload, now);
  const receiptWrite = database.prepare('INSERT INTO review_operations (user_id, review_date, operation_id, response_json, created_at) SELECT ?, ?, ?, ?, ? WHERE changes() = 1').bind(target.userId, target.date, body.operationId, receipt, now);
  await database.batch([write, receiptWrite]);
  const saved = await database.prepare('SELECT response_json FROM review_operations WHERE user_id = ? AND review_date = ? AND operation_id = ?').bind(target.userId, target.date, body.operationId).first<OperationRow>();
  if (!saved) return jsonResponse({ error: 'Review revision conflict.', serverRevision: existing?.revision ?? null }, 409);
  return jsonResponse(JSON.parse(saved.response_json));
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

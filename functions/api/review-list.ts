import { isSameOriginRequest, jsonResponse, readSession } from '../_lib/session.ts';
import { normalizeReview, type ReviewEnv } from '../_lib/reviews.ts';

interface FunctionContext { env: ReviewEnv; request: Request }
interface ReviewRow { review_date: string; revision: number; review_status: string; updated_at: string; payload: string }

const isDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value)
  && !Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

export async function onRequestGet({ env, request }: FunctionContext): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  if (!env.REVIEW_DB) return jsonResponse({ error: 'Review database is not configured.' }, 503);
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);

  const cursor = new URL(request.url).searchParams.get('cursor');
  if (cursor && !isDate(cursor)) return jsonResponse({ error: 'Invalid cursor.' }, 400);
  const limit = 30;
  const query = cursor
    ? 'SELECT review_date, revision, review_status, updated_at, payload FROM review_records WHERE user_id = ? AND review_date < ? ORDER BY review_date DESC LIMIT ?'
    : 'SELECT review_date, revision, review_status, updated_at, payload FROM review_records WHERE user_id = ? ORDER BY review_date DESC LIMIT ?';
  const statement = env.REVIEW_DB.prepare(query);
  const { results } = await (cursor ? statement.bind(session.githubUserId, cursor, limit + 1) : statement.bind(session.githubUserId, limit + 1)).all<ReviewRow>();
  const page = results.slice(0, limit);
  const entries = page.map((row) => {
    let segments: Array<{ id: string; type: 'text' | 'voice'; capturedAt: string; text: string }> = [];
    let items: Array<{ itemId: string; section: string; text: string }> = [];
    let annotations: Array<{ id: string; type: string; quotedText: string }> = [];
    let snapshots: Array<{ id: string; versionNo: number; completedAt: string; items: Array<{ itemId: string; section: string; text: string }> }> = [];
    try {
      const review = normalizeReview(JSON.parse(row.payload), row.review_date);
      if (review) {
        segments = review.inputSegments.map((segment) => ({ id: segment.id, type: segment.type, capturedAt: segment.capturedAt, text: segment.type === 'text' ? segment.text : segment.correctedText ?? segment.asrText ?? '语音待识别；原始录音仅保存在录制设备' }));
        items = review.workingDraft.items.filter((item) => !item.deletedAt).map((item) => ({ itemId: item.itemId, section: item.section, text: item.text }));
        annotations = review.annotations.filter((annotation) => !annotation.deletedAt && !annotation.stale && annotation.textVersionId === review.activeTextVersionId).map((annotation) => ({ id: annotation.id, type: annotation.type, quotedText: annotation.quotedText }));
        snapshots = review.completedVersions.map((version) => ({ id: version.id, versionNo: version.versionNo, completedAt: version.completedAt ?? version.createdAt, items: version.items.filter((item) => !item.deletedAt).map((item) => ({ itemId: item.itemId, section: item.section, text: item.text })) }));
      }
    } catch { /* Metadata remains browsable if an older payload cannot be read. */ }
    return { reviewDate: row.review_date, revision: row.revision, status: row.review_status, updatedAt: row.updated_at, segments, items, annotations, snapshots };
  });
  return jsonResponse({ entries, nextCursor: results.length > limit ? page.at(-1)?.review_date ?? null : null });
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

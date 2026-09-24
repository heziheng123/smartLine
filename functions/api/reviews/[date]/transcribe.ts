import { isSameOriginRequest, jsonResponse, readSession } from '../../../_lib/session.ts';
import { asrRequest, canStartAsr, readAsrResult, VOLCENGINE_FLASH_ASR_ENDPOINT, wavDurationMs, type AsrEnv } from '../../../_lib/asr.ts';
import { normalizeReview, refreshPersistedReviewText, type PersistedInputSegment } from '../../../_lib/reviews.ts';
import { VOICE_MAX_DURATION_MS, VOICE_MAX_WAV_BYTES } from '../../../../src/review/voiceLimits.ts';

interface FunctionContext { env: AsrEnv; request: Request; params: { date?: string } }
interface ReviewRow { payload: string; revision: number }
interface OperationRow { status: string; receipt_json: string | null }
interface CountRow { total: number }
const ASR_WINDOW_MS = 15 * 60_000;
const isDate = (value: string | undefined): value is string => {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};
const isId = (value: FormDataEntryValue | null): value is string => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,160}$/.test(value);
const personalTerms = (value: FormDataEntryValue | null): Array<{ from: string; to: string }> => {
  if (typeof value !== 'string') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.flatMap((item) => item && typeof item === 'object' && typeof item.from === 'string' && typeof item.to === 'string' && item.from.length > 0 && item.from.length <= 80 && item.to.length > 0 && item.to.length <= 80 ? [{ from: item.from, to: item.to }] : []).slice(0, 30) : [];
  } catch { return []; }
};

export async function onRequestPost({ env, request, params }: FunctionContext): Promise<Response> {
  if (!isSameOriginRequest(request)) return jsonResponse({ error: 'Cross-origin request denied.' }, 403);
  if (!isDate(params.date)) return jsonResponse({ error: 'Invalid review date.' }, 400);
  if (!env.REVIEW_DB) return jsonResponse({ error: 'Review database is not configured.' }, 503);
  const session = await readSession(request, env);
  if (!session) return jsonResponse({ error: 'Authentication required.' }, 401);
  let form: FormData;
  try { form = await request.formData(); } catch { return jsonResponse({ error: 'Expected multipart form data.' }, 400); }
  const segmentId = form.get('segmentId'); const operationId = form.get('operationId'); const audio = form.get('audio'); const terms = personalTerms(form.get('terms'));
  if (!isId(segmentId) || !isId(operationId) || !(audio instanceof File) || audio.size === 0 || audio.size > VOICE_MAX_WAV_BYTES) return jsonResponse({ error: 'Invalid transcription request.' }, 400);
  const database = env.REVIEW_DB;
  const reviewRow = await database.prepare('SELECT payload, revision FROM review_records WHERE user_id = ? AND review_date = ?').bind(session.githubUserId, params.date).first<ReviewRow>();
  if (!reviewRow) return jsonResponse({ error: 'Review must sync before transcription.' }, 409);
  let review;
  try { review = normalizeReview(JSON.parse(reviewRow.payload), params.date); } catch { review = null; }
  const segment = review?.inputSegments.find((item): item is Extract<PersistedInputSegment, { type: 'voice' }> => item.id === segmentId && item.type === 'voice');
  if (!review || !segment) return jsonResponse({ error: 'Voice segment was not found.' }, 409);
  const previous = await database.prepare('SELECT status, receipt_json FROM review_transcription_operations WHERE user_id = ? AND review_date = ? AND segment_id = ? AND operation_id = ?').bind(session.githubUserId, params.date, segmentId, operationId).first<OperationRow>();
  if (previous?.status === 'completed' && previous.receipt_json) {
    try { return jsonResponse(JSON.parse(previous.receipt_json)); } catch { return jsonResponse({ error: 'Stored transcript is invalid.' }, 502); }
  }
  const since = new Date(Date.now() - ASR_WINDOW_MS).toISOString();
  const recent = await database.prepare("SELECT COUNT(*) AS total FROM review_transcription_operations WHERE user_id = ? AND updated_at >= ? AND status IN ('processing', 'completed')").bind(session.githubUserId, since).first<CountRow>();
  if (!canStartAsr(recent?.total ?? 0)) return jsonResponse({ error: '语音识别请求过于频繁，请 15 分钟后再试。' }, 429);
  const now = new Date(); const leaseExpiresAt = new Date(now.valueOf() + 90_000).toISOString();
  const claim = await database.prepare(`INSERT INTO review_transcription_operations (user_id, review_date, segment_id, operation_id, status, receipt_json, lease_expires_at, updated_at) VALUES (?, ?, ?, ?, 'processing', NULL, ?, ?)
    ON CONFLICT(user_id, review_date, segment_id, operation_id) DO UPDATE SET status = 'processing', receipt_json = NULL, lease_expires_at = excluded.lease_expires_at, updated_at = excluded.updated_at
    WHERE review_transcription_operations.status <> 'completed' AND review_transcription_operations.lease_expires_at < ?`).bind(session.githubUserId, params.date, segmentId, operationId, leaseExpiresAt, now.toISOString(), now.toISOString()).run();
  if (claim.meta.changes === 0) return jsonResponse({ error: 'Transcription is already processing.' }, 409);
  const release = () => database.prepare("DELETE FROM review_transcription_operations WHERE user_id = ? AND review_date = ? AND segment_id = ? AND operation_id = ? AND status = 'processing'").bind(session.githubUserId, params.date, segmentId, operationId).run();
  try {
    const bytes = new Uint8Array(await audio.arrayBuffer());
    const durationMs = wavDurationMs(bytes);
    if (durationMs === null || durationMs > VOICE_MAX_DURATION_MS || Math.abs(durationMs - segment.audio.durationMs) > 2_000) { await release(); return jsonResponse({ error: 'Unsupported or invalid audio format.' }, 415); }
    const providerRequest = asrRequest(env, bytes, operationId, operationId);
    if (!providerRequest) { await release(); return jsonResponse({ error: 'Speech recognition is not configured.' }, 503); }
    const response = await fetch(VOLCENGINE_FLASH_ASR_ENDPOINT, providerRequest);
    if (!response.ok || response.headers.get('X-Api-Status-Code') !== '20000000') { await release(); return jsonResponse({ error: 'Speech recognition is temporarily unavailable.' }, response.status === 429 ? 429 : 502); }
    const result = readAsrResult(await response.json(), response.headers.get('X-Tt-Logid'));
    if (!result) { await release(); return jsonResponse({ error: 'Speech recognition returned no text.' }, 502); }
    const transcript = terms.reduce((text, term) => text.split(term.from).join(term.to), result.text);
    const completedAt = new Date().toISOString();
    const serverRevision = reviewRow.revision + 1;
    const accepted = refreshPersistedReviewText({
      ...review,
      revision: serverRevision,
      reviewStatus: 'draft',
      updatedAt: completedAt,
      workingDraft: { ...review.workingDraft, baseRevision: serverRevision, items: review.workingDraft.items.filter((item) => item.locked) },
      inputSegments: review.inputSegments.map((item) => item.id === segmentId && item.type === 'voice'
        ? { ...item, transcriptionState: 'transcribed' as const, asrText: transcript, providerReceipt: { operationId, ...(result.providerLogId ? { providerLogId: result.providerLogId } : {}) } }
        : item),
    }, completedAt);
    const receipt = { transcript, operationId, ...(result.providerLogId ? { providerLogId: result.providerLogId } : {}), review: accepted, serverRevision };
    const recordWrite = database.prepare('UPDATE review_records SET revision = ?, review_status = ?, payload = ?, updated_at = ? WHERE user_id = ? AND review_date = ? AND revision = ?').bind(serverRevision, accepted.reviewStatus, JSON.stringify(accepted), completedAt, session.githubUserId, params.date, reviewRow.revision);
    const receiptWrite = database.prepare("UPDATE review_transcription_operations SET status = 'completed', receipt_json = ?, lease_expires_at = NULL, updated_at = ? WHERE user_id = ? AND review_date = ? AND segment_id = ? AND operation_id = ? AND status = 'processing' AND changes() = 1").bind(JSON.stringify(receipt), completedAt, session.githubUserId, params.date, segmentId, operationId);
    await database.batch([recordWrite, receiptWrite]);
    const saved = await database.prepare('SELECT status, receipt_json FROM review_transcription_operations WHERE user_id = ? AND review_date = ? AND segment_id = ? AND operation_id = ?').bind(session.githubUserId, params.date, segmentId, operationId).first<OperationRow>();
    if (saved?.status !== 'completed' || !saved.receipt_json) return jsonResponse({ error: 'Review changed during transcription; the audio remains available for retry.' }, 409);
    return jsonResponse(JSON.parse(saved.receipt_json));
  } catch {
    await release().catch(() => undefined);
    return jsonResponse({ error: 'Speech recognition is temporarily unavailable.' }, 502);
  }
}

export function onRequest(): Response { return jsonResponse({ error: 'Method not allowed.' }, 405); }

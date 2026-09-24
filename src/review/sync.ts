import { mergeDailyReviews, type DailyReview } from './model';
import {
  loadReviewOutbox,
  loadReviewSyncStates,
  saveReviewOutbox,
  saveReviewSyncStates,
  type ReviewOutboxJob,
  type ReviewSyncState,
} from './repository';

let activeFlush: Promise<Record<string, ReviewSyncState>> | null = null;
let mutations = Promise.resolve();
const newOperationId = () => `review-${crypto.randomUUID()}`;

function serialize<T>(operation: () => Promise<T>): Promise<T> {
  const next = mutations.catch(() => undefined).then(operation);
  mutations = next.then(() => undefined, () => undefined);
  return next;
}

function pendingState(current: ReviewSyncState | undefined): ReviewSyncState {
  return { serverRevision: current?.serverRevision ?? null, status: 'sync_pending' };
}

export async function enqueueReviewSync(review: DailyReview): Promise<Record<string, ReviewSyncState>> {
  return serialize(async () => {
  const [jobs, states] = await Promise.all([loadReviewOutbox(), loadReviewSyncStates()]);
  const current = states[review.id];
  const job: ReviewOutboxJob = {
    operationId: newOperationId(), review, baseRevision: current?.serverRevision ?? null, attempts: 0, createdAt: new Date().toISOString(),
  };
  const nextJobs = [...jobs.filter((item) => item.review.id !== review.id), job];
  const nextStates = { ...states, [review.id]: pendingState(current) };
  await Promise.all([saveReviewOutbox(nextJobs), saveReviewSyncStates(nextStates)]);
  return nextStates;
  });
}

export async function resolveReviewConflict(review: DailyReview): Promise<{ states: Record<string, ReviewSyncState>; review: DailyReview }> {
  return serialize(async () => {
  const [jobs, states] = await Promise.all([loadReviewOutbox(), loadReviewSyncStates()]);
  const current = states[review.id];
  if (!current?.remoteReview || current.serverRevision === null) return { states, review };
  const merged = mergeDailyReviews(review, current.remoteReview);
  const job: ReviewOutboxJob = {
    operationId: newOperationId(), review: merged, baseRevision: current.serverRevision, attempts: 0, createdAt: new Date().toISOString(),
  };
  const nextStates = { ...states, [review.id]: { serverRevision: current.serverRevision, status: 'sync_pending' as const } };
  await Promise.all([saveReviewOutbox([...jobs.filter((item) => item.review.id !== review.id), job]), saveReviewSyncStates(nextStates)]);
  return { states: nextStates, review: merged };
  });
}

export async function fetchRemoteReview(reviewDate: string): Promise<{ review: DailyReview; serverRevision: number } | null> {
  const response = await fetch(`/api/reviews/${encodeURIComponent(reviewDate)}`, { headers: { Accept: 'application/json' } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('无法读取云端复盘。');
  return response.json() as Promise<{ review: DailyReview; serverRevision: number }>;
}

async function flush(): Promise<Record<string, ReviewSyncState>> {
  let [jobs, states] = await Promise.all([loadReviewOutbox(), loadReviewSyncStates()]);
  for (const job of jobs) {
    try {
      const response = await fetch(`/api/reviews/${encodeURIComponent(job.review.reviewDate)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ review: job.review, baseRevision: job.baseRevision, operationId: job.operationId }),
      });
      if (response.status === 409) {
        const remote = await fetchRemoteReview(job.review.reviewDate);
        states = { ...states, [job.review.id]: { serverRevision: remote?.serverRevision ?? null, status: 'conflict', error: '云端已有更新，本机内容已保留。', ...(remote ? { remoteReview: remote.review } : {}) } };
        jobs = jobs.filter((item) => item.operationId !== job.operationId);
      } else if (!response.ok) {
        states = { ...states, [job.review.id]: { serverRevision: states[job.review.id]?.serverRevision ?? null, status: 'sync_error', error: '同步失败，将在下次联网时重试。' } };
        jobs = jobs.map((item) => item.operationId === job.operationId ? { ...item, attempts: item.attempts + 1 } : item);
        break;
      } else {
        const accepted = await response.json() as { serverRevision: number };
        states = { ...states, [job.review.id]: { serverRevision: accepted.serverRevision, status: 'synced' } };
        jobs = jobs.filter((item) => item.operationId !== job.operationId).map((item) => item.review.id === job.review.id ? { ...item, baseRevision: accepted.serverRevision } : item);
      }
    } catch {
      states = { ...states, [job.review.id]: { serverRevision: states[job.review.id]?.serverRevision ?? null, status: 'sync_error', error: '网络不可用，本机内容已保留。' } };
      jobs = jobs.map((item) => item.operationId === job.operationId ? { ...item, attempts: item.attempts + 1 } : item);
      break;
    }
  }
  await Promise.all([saveReviewOutbox(jobs), saveReviewSyncStates(states)]);
  return states;
}

export function flushReviewOutbox(): Promise<Record<string, ReviewSyncState>> {
  if (!activeFlush) activeFlush = serialize(flush).finally(() => { activeFlush = null; });
  return activeFlush;
}

export async function structureReview(review: DailyReview): Promise<{ candidates: import('./model').AiReviewItem[]; annotations: import('./model').AiReviewAnnotation[] }> {
  const response = await fetch(`/api/reviews/${encodeURIComponent(review.reviewDate)}/structure`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review, operationId: `ai-${review.id}-${review.revision}` }),
  });
  if (!response.ok) throw new Error('AI 整理暂时不可用。');
  const data = await response.json() as { candidates?: import('./model').AiReviewItem[]; annotations?: import('./model').AiReviewAnnotation[] };
  if (!data.candidates || !data.annotations) throw new Error('AI 未返回可用整理结果。');
  return { candidates: data.candidates, annotations: data.annotations };
}

export interface VoiceTranscriptReceipt { transcript: string; operationId: string; providerLogId?: string; review: DailyReview; serverRevision: number }

export interface PersonalTerm { from: string; to: string }

export async function transcribeVoiceSegment(reviewDate: string, segmentId: string, audio: Blob, force = false, terms: PersonalTerm[] = []): Promise<VoiceTranscriptReceipt> {
  const operationId = force ? `transcribe-${segmentId}-${crypto.randomUUID()}` : `transcribe-${segmentId}`;
  const form = new FormData();
  form.set('segmentId', segmentId); form.set('operationId', operationId); form.set('audio', audio, `${segmentId}.wav`);
  form.set('terms', JSON.stringify(terms.slice(0, 30)));
  const response = await fetch(`/api/reviews/${encodeURIComponent(reviewDate)}/transcribe`, { method: 'POST', body: form });
  const data = await response.json().catch(() => null) as VoiceTranscriptReceipt | { error?: string } | null;
  if (!response.ok || !data || !('transcript' in data) || typeof data.transcript !== 'string' || typeof data.operationId !== 'string' || !('review' in data) || !('serverRevision' in data) || typeof data.serverRevision !== 'number') throw new Error(data && 'error' in data && data.error ? data.error : '语音识别暂时不可用。');
  return data;
}

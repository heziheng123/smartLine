import { mergeDailyReviews, type DailyReview } from './model';
import {
  loadReviewOutbox,
  loadReviewSyncStates,
  updateDailyReviews,
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
  // A newer server copy must be merged explicitly before another full-document
  // write is queued. Otherwise the edit after a 409 can overwrite remote-only data.
  if (current?.status === 'conflict' && current.remoteReview) return states;
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

export function recordReviewServerRevision(reviewId: string, serverRevision: number): Promise<Record<string, ReviewSyncState>> {
  return serialize(async () => {
    const [states, jobs] = await Promise.all([loadReviewSyncStates(), loadReviewOutbox()]);
    const current = states[reviewId];
    if (current && (current.serverRevision ?? -1) >= serverRevision) return states;
    const next = { ...states, [reviewId]: current?.status === 'conflict'
      ? { ...current, serverRevision }
      : { serverRevision, status: jobs.some((job) => job.review.id === reviewId) ? 'sync_pending' as const : 'synced' as const } };
    await Promise.all([
      saveReviewSyncStates(next),
      saveReviewOutbox(jobs.map((job) => job.review.id === reviewId ? { ...job, baseRevision: serverRevision } : job)),
    ]);
    return next;
  });
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
        const accepted = await response.json() as { review?: DailyReview; serverRevision: number };
        if (accepted.review) {
          // Fast path: revision/updatedAt identify the submitted version without
          // serializing large textVersions on every acknowledgement.
          const submitted = job.review;
          await updateDailyReviews((local) => local.map((item) => {
            if (item.id !== job.review.id) return item;
            if (item.revision !== submitted.revision || item.updatedAt !== submitted.updatedAt) return item;
            if (JSON.stringify(item) !== JSON.stringify(submitted)) return item;
            return accepted.review!;
          }));
        }
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

async function reviewApiErrorMessage(response: Response, fallback: string): Promise<string> {
  const data = await response.json().catch(() => null) as { error?: unknown; code?: unknown } | null;
  if (data && typeof data.error === 'string' && data.error.trim()) return data.error;
  if (response.status === 402) return 'DeepSeek 余额不足，整理未执行；充值后重试即可，本地记录不受影响。';
  if (response.status === 401) return '登录已过期或 DeepSeek Key 无效；请重新登录或检查配置后重试。';
  if (response.status === 429) return 'AI 请求太频繁被限流，稍后重试即可，本地记录不受影响。';
  if (response.status === 503) return 'AI 服务尚未配置，请联系管理员；本地记录不受影响。';
  return fallback;
}

export async function structureReview(review: DailyReview): Promise<{ candidates: import('./model').AiReviewItem[]; annotations: import('./model').AiReviewAnnotation[] }> {
  const response = await fetch(`/api/reviews/${encodeURIComponent(review.reviewDate)}/structure`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ review, operationId: `ai-${review.id}-${review.revision}` }),
  });
  if (!response.ok) throw new Error(await reviewApiErrorMessage(response, 'AI 整理暂时不可用，请稍后重试；本地记录不受影响。'));
  const data = await response.json() as { candidates?: import('./model').AiReviewItem[]; annotations?: import('./model').AiReviewAnnotation[] };
  if (!data.candidates || !data.annotations) throw new Error('AI 未返回可用整理结果，请稍后重试；本地记录不受影响。');
  return { candidates: data.candidates, annotations: data.annotations };
}

export interface VoiceTranscriptReceipt { transcript: string; operationId: string; providerLogId?: string; review: DailyReview; serverRevision: number }

export interface PersonalTerm { from: string; to: string }

const FILLER_WORDS = new Set(['嗯', '啊', '呃', '那个', '这个', '然后', '就是', '就是说', '怎么说', '我想一下', '我想想', '这样子', '一下', '对不对', '对吧']);

/** Local-only word processor: folds voice fillers into （） and substitutes personal terms; highlights substituted spans. */
export function sterilizeAsrDraft(text: string, terms: PersonalTerm[] = []): { draft: string; highlights: string[] } {
  const glossary = new Map<string, string>(terms.map((term) => [term.from, term.to]));
  const highlights: string[] = [];
  const chars = Array.from(text);
  const out: string[] = []; let filler: string[] = [];
  const fillerLenAt = (index: number): number => {
    let longest = -1;
    for (const word of FILLER_WORDS) {
      const rest = chars.slice(index, index + word.length).join('');
      if (rest === word) longest = Math.max(longest, word.length);
    }
    return longest;
  };
  let i = 0;
  while (i < chars.length) {
    const len = fillerLenAt(i);
    if (len !== -1) { filler.push(chars.slice(i, i + len).join('')); i += len; continue; }
    let token = '';
    while (i < chars.length && fillerLenAt(i) === -1) { token += chars[i]!; i += 1; }
    const replaced = glossary.get(token) ?? token;
    if (glossary.has(token) && token !== replaced) highlights.push(replaced);
    if (filler.length) { out.push(`（${filler.join('')}）${replaced}`); filler = []; }
    else out.push(replaced);
  }
  if (filler.length) out.push(`（${filler.join('')}）`);
  return { draft: out.join(''), highlights };
}

export async function transcribeVoiceSegment(reviewDate: string, segmentId: string, audio: Blob, force = false, terms: PersonalTerm[] = [], draft = false): Promise<VoiceTranscriptReceipt> {
  const operationId = force ? `transcribe-${segmentId}-${crypto.randomUUID()}` : draft ? `transcribe-${segmentId}-draft` : `transcribe-${segmentId}`;
  const form = new FormData();
  form.set('segmentId', segmentId); form.set('operationId', operationId); form.set('audio', audio, `${segmentId}.wav`);
  form.set('terms', JSON.stringify(terms.slice(0, 30)));
  if (draft) form.set('mode', 'draft');
  const response = await fetch(`/api/reviews/${encodeURIComponent(reviewDate)}/transcribe`, { method: 'POST', body: form });
  const data = await response.json().catch(() => null) as VoiceTranscriptReceipt | { error?: string } | null;
  if (!response.ok || !data || !('transcript' in data) || typeof data.transcript !== 'string' || typeof data.operationId !== 'string') throw new Error(data && 'error' in data && data.error ? data.error : '语音识别暂时不可用。');
  if (draft) return data;
  if (!('review' in data) || !('serverRevision' in data) || typeof data.serverRevision !== 'number') throw new Error('语音识别暂时不可用。');
  return data;
}

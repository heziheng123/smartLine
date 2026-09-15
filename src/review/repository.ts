import { createDedicatedStorage } from '@/utils/persistence';
import type { DailyReview } from './model';

const storage = createDedicatedStorage('smart-line-review', 'reviews');
const REVIEWS_KEY = 'daily-reviews-v1';
const TEXT_DRAFTS_KEY = 'daily-review-text-drafts-v1';
const OUTBOX_KEY = 'daily-review-outbox-v1';
const SYNC_STATES_KEY = 'daily-review-sync-states-v1';
let writes = Promise.resolve();

export interface ReviewSyncState {
  serverRevision: number | null;
  status: 'local_only' | 'sync_pending' | 'synced' | 'sync_error' | 'conflict';
  error?: string;
  remoteReview?: DailyReview;
}

export interface ReviewOutboxJob {
  operationId: string;
  review: DailyReview;
  baseRevision: number | null;
  attempts: number;
  createdAt: string;
}

export async function loadDailyReviews(): Promise<DailyReview[]> {
  const value = await storage.getItem<unknown>(REVIEWS_KEY);
  return Array.isArray(value) ? value as DailyReview[] : [];
}

export function saveDailyReviews(reviews: DailyReview[]): Promise<void> {
  return queueWrite(() => storage.setItem(REVIEWS_KEY, reviews));
}

export async function loadReviewTextDrafts(): Promise<Record<string, string>> {
  const value = await storage.getItem<unknown>(TEXT_DRAFTS_KEY);
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([date, text]) => /^\d{4}-\d{2}-\d{2}$/.test(date) && typeof text === 'string'));
}

export function saveReviewTextDrafts(drafts: Record<string, string>): Promise<void> {
  return queueWrite(() => storage.setItem(TEXT_DRAFTS_KEY, drafts));
}

export async function loadReviewOutbox(): Promise<ReviewOutboxJob[]> {
  const value = await storage.getItem<unknown>(OUTBOX_KEY);
  return Array.isArray(value) ? value as ReviewOutboxJob[] : [];
}

export function saveReviewOutbox(jobs: ReviewOutboxJob[]): Promise<void> {
  return queueWrite(() => storage.setItem(OUTBOX_KEY, jobs));
}

export async function loadReviewSyncStates(): Promise<Record<string, ReviewSyncState>> {
  const value = await storage.getItem<unknown>(SYNC_STATES_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, ReviewSyncState> : {};
}

export function saveReviewSyncStates(states: Record<string, ReviewSyncState>): Promise<void> {
  return queueWrite(() => storage.setItem(SYNC_STATES_KEY, states));
}

function queueWrite(operation: () => Promise<unknown>): Promise<void> {
  const next = writes.catch(() => undefined).then(operation).then(() => undefined);
  writes = next;
  return next;
}

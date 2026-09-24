import { createDedicatedStorage } from '@/utils/persistence';
import { createDailyReview, createInputTextVersion, type DailyReview, type InputTextVersion, type ReviewAnnotation, type ReviewVersion } from './model';

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

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function normalizeVersion(value: unknown, fallback: ReviewVersion): ReviewVersion {
  if (!isRecord(value)) return fallback;
  return { ...fallback, ...value, items: Array.isArray(value.items) ? value.items : [] } as ReviewVersion;
}

/** Older local and cloud records may predate a newly added optional review field. */
export function normalizeDailyReview(value: unknown): DailyReview | null {
  if (!isRecord(value) || typeof value.reviewDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value.reviewDate)) return null;
  const fallback = createDailyReview(value.reviewDate);
  const workingDraft = normalizeVersion(value.workingDraft, fallback.workingDraft);
  const completedVersions = Array.isArray(value.completedVersions)
    ? value.completedVersions.map((version) => normalizeVersion(version, fallback.workingDraft))
    : [];
  const inputSegments = Array.isArray(value.inputSegments) ? value.inputSegments as DailyReview['inputSegments'] : [];
  const legacyTextVersion = createInputTextVersion(inputSegments, typeof value.updatedAt === 'string' ? value.updatedAt : fallback.updatedAt);
  const textVersions = Array.isArray(value.textVersions)
    ? value.textVersions.filter((version): version is InputTextVersion => isRecord(version) && typeof version.id === 'string' && typeof version.text === 'string' && typeof version.createdAt === 'string' && Array.isArray(version.sourceRanges))
    : [];
  const usableTextVersions = textVersions.length ? textVersions : [legacyTextVersion];
  const activeTextVersionId = typeof value.activeTextVersionId === 'string' && usableTextVersions.some((version) => version.id === value.activeTextVersionId)
    ? value.activeTextVersionId
    : usableTextVersions.at(-1)!.id;
  const annotations = Array.isArray(value.annotations)
    ? value.annotations.filter((annotation): annotation is ReviewAnnotation => isRecord(annotation) && typeof annotation.id === 'string' && typeof annotation.textVersionId === 'string' && typeof annotation.start === 'number' && typeof annotation.end === 'number' && typeof annotation.quotedText === 'string')
    : [];
  return {
    ...fallback,
    ...value,
    reviewStatus: value.reviewStatus === 'completed' ? 'completed' : 'draft',
    inputSegments,
    activeTextVersionId,
    textVersions: usableTextVersions,
    annotations,
    workingDraft,
    completedVersions,
    conflictSnapshots: Array.isArray(value.conflictSnapshots) ? value.conflictSnapshots : [],
  } as DailyReview;
}

export async function loadDailyReviews(): Promise<DailyReview[]> {
  const value = await storage.getItem<unknown>(REVIEWS_KEY);
  return Array.isArray(value) ? value.map(normalizeDailyReview).filter((review): review is DailyReview => Boolean(review)) : [];
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

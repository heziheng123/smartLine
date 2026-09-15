import type { AuthEnv } from './session.ts';

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown>;
}

export interface ReviewEnv extends AuthEnv {
  REVIEW_DB?: D1Database;
}

export interface PersistedReview {
  id: string;
  reviewDate: string;
  timezoneAtCreation: string;
  schemaVersion: 1;
  revision: number;
  reviewStatus: 'draft' | 'completed';
  activeCompletedVersionId?: string;
  workingDraftVersionId: string;
  inputSegments: Array<{ id: string; type: 'text'; clientSeq: number; capturedAt: string; text: string }>;
  workingDraft: PersistedReviewVersion;
  completedVersions: PersistedReviewVersion[];
  createdAt: string;
  updatedAt: string;
}

interface PersistedReviewVersion {
  id: string;
  versionNo: number;
  kind: 'working_draft' | 'completed_snapshot';
  baseRevision: number;
  items: Array<{
    itemId: string;
    section: 'progress' | 'problems' | 'adjustments' | 'summary';
    text: string;
    createdBy: 'ai' | 'user';
    userEdited: boolean;
    locked: boolean;
    sourceSegmentIds: string[];
    updatedAt: string;
  }>;
  createdAt: string;
  completedAt?: string;
}

const isText = (value: unknown, max = 10_000): value is string => typeof value === 'string' && value.length <= max;
const isId = (value: unknown): value is string => isText(value, 160) && value.length > 0;
const isDate = (value: unknown): value is string => {
  if (!isText(value, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
};
const isTimestamp = (value: unknown): value is string => isText(value, 40) && !Number.isNaN(Date.parse(value));
const isInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const sections = new Set(['progress', 'problems', 'adjustments', 'summary']);

function normalizeVersion(value: unknown, kind: PersistedReviewVersion['kind']): PersistedReviewVersion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const { id, versionNo, baseRevision, createdAt, items: sourceItems, completedAt } = source;
  if (!isId(id) || !isInteger(versionNo) || !isInteger(baseRevision) || !isTimestamp(createdAt) || !Array.isArray(sourceItems)) return null;
  if (sourceItems.length > 200) return null;
  const items = sourceItems.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (!isId(item.itemId) || !sections.has(item.section as string) || !isText(item.text) || !['ai', 'user'].includes(item.createdBy as string) || typeof item.userEdited !== 'boolean' || typeof item.locked !== 'boolean' || !isTimestamp(item.updatedAt) || !Array.isArray(item.sourceSegmentIds)) return null;
    const sourceSegmentIds = item.sourceSegmentIds.filter(isId);
    if (sourceSegmentIds.length !== item.sourceSegmentIds.length) return null;
    return { itemId: item.itemId, section: item.section as 'progress' | 'problems' | 'adjustments' | 'summary', text: item.text, createdBy: item.createdBy as 'ai' | 'user', userEdited: item.userEdited, locked: item.locked, sourceSegmentIds, updatedAt: item.updatedAt };
  });
  if (items.some((item) => !item)) return null;
  if (kind === 'completed_snapshot' && !isTimestamp(completedAt)) return null;
  return { id, versionNo, kind, baseRevision, items: items as PersistedReviewVersion['items'], createdAt, ...(kind === 'completed_snapshot' ? { completedAt: completedAt as string } : {}) };
}

/** Whitelists review fields so D1 never receives audio bytes or arbitrary client fields. */
export function normalizeReview(value: unknown, expectedDate: string): PersistedReview | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const { id, reviewDate, timezoneAtCreation, schemaVersion, revision, reviewStatus, activeCompletedVersionId, workingDraftVersionId, createdAt, updatedAt, inputSegments: sourceSegments, completedVersions: sourceVersions } = source;
  if (!isId(id) || reviewDate !== expectedDate || !isDate(reviewDate) || !isText(timezoneAtCreation, 100) || schemaVersion !== 1 || !isInteger(revision) || !['draft', 'completed'].includes(reviewStatus as string) || !isId(workingDraftVersionId) || !(activeCompletedVersionId === undefined || isId(activeCompletedVersionId)) || !isTimestamp(createdAt) || !isTimestamp(updatedAt) || !Array.isArray(sourceSegments) || !Array.isArray(sourceVersions)) return null;
  if (sourceSegments.length > 200 || sourceVersions.length > 50) return null;
  const inputSegments = sourceSegments.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const segment = candidate as Record<string, unknown>;
    if (!isId(segment.id) || segment.type !== 'text' || !isInteger(segment.clientSeq) || !isTimestamp(segment.capturedAt) || !isText(segment.text)) return null;
    return { id: segment.id, type: 'text' as const, clientSeq: segment.clientSeq, capturedAt: segment.capturedAt, text: segment.text };
  });
  if (inputSegments.some((segment) => !segment)) return null;
  if (new Set((inputSegments as PersistedReview['inputSegments']).map((segment) => segment.clientSeq)).size !== inputSegments.length) return null;
  const workingDraft = normalizeVersion(source.workingDraft, 'working_draft');
  const completedVersions = sourceVersions.map((version) => normalizeVersion(version, 'completed_snapshot'));
  if (!workingDraft || workingDraft.id !== workingDraftVersionId || completedVersions.some((version) => !version) || (reviewStatus === 'completed' && (!activeCompletedVersionId || !(completedVersions as PersistedReviewVersion[]).some((version) => version?.id === activeCompletedVersionId)))) return null;
  return {
    id,
    reviewDate: expectedDate,
    timezoneAtCreation,
    schemaVersion: 1,
    revision,
    reviewStatus: reviewStatus as PersistedReview['reviewStatus'],
    ...(activeCompletedVersionId ? { activeCompletedVersionId } : {}),
    workingDraftVersionId,
    inputSegments: inputSegments as PersistedReview['inputSegments'],
    workingDraft,
    completedVersions: completedVersions as PersistedReviewVersion[],
    createdAt,
    updatedAt,
  };
}

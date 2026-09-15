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
  inputSegments: PersistedInputSegment[];
  workingDraft: PersistedReviewVersion;
  completedVersions: PersistedReviewVersion[];
  conflictSnapshots: Array<{ id: string; createdAt: string; localItems: PersistedReviewVersion['items']; remoteItems: PersistedReviewVersion['items']; message: string }>;
  createdAt: string;
  updatedAt: string;
}

export type PersistedInputSegment =
  | { id: string; type: 'text'; clientSeq: number; capturedAt: string; text: string }
  | {
    id: string;
    type: 'voice';
    clientSeq: number;
    capturedAt: string;
    originDeviceId: string;
    audioStorageScope: 'local_only';
    transcriptionState: 'recording' | 'interrupted' | 'waiting_transcription' | 'transcribing' | 'transcribed' | 'retryable_failed' | 'audio_unavailable';
    audioRetention: 'delete_after_transcription' | 'keep_7_days' | 'keep_30_days';
    audio: { mimeType: 'audio/wav'; durationMs: number; chunkCount: number; byteLength: number; sampleRate: number };
    asrText?: string;
    correctedText?: string;
    providerReceipt?: { operationId: string; providerLogId?: string };
  };

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
const voiceStates = new Set(['recording', 'interrupted', 'waiting_transcription', 'transcribing', 'transcribed', 'retryable_failed', 'audio_unavailable']);
const audioRetentions = new Set(['delete_after_transcription', 'keep_7_days', 'keep_30_days']);

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
  const { id, reviewDate, timezoneAtCreation, schemaVersion, revision, reviewStatus, activeCompletedVersionId, workingDraftVersionId, createdAt, updatedAt, inputSegments: sourceSegments, completedVersions: sourceVersions, conflictSnapshots: sourceSnapshots = [] } = source;
  if (!isId(id) || reviewDate !== expectedDate || !isDate(reviewDate) || !isText(timezoneAtCreation, 100) || schemaVersion !== 1 || !isInteger(revision) || !['draft', 'completed'].includes(reviewStatus as string) || !isId(workingDraftVersionId) || !(activeCompletedVersionId === undefined || isId(activeCompletedVersionId)) || !isTimestamp(createdAt) || !isTimestamp(updatedAt) || !Array.isArray(sourceSegments) || !Array.isArray(sourceVersions) || !Array.isArray(sourceSnapshots)) return null;
  if (sourceSegments.length > 200 || sourceVersions.length > 50 || sourceSnapshots.length > 20) return null;
  const inputSegments = sourceSegments.map((candidate): PersistedInputSegment | null => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const segment = candidate as Record<string, unknown>;
    if (!isId(segment.id) || !isInteger(segment.clientSeq) || !isTimestamp(segment.capturedAt)) return null;
    if (segment.type === 'text') {
      if (!isText(segment.text)) return null;
      return { id: segment.id, type: 'text', clientSeq: segment.clientSeq, capturedAt: segment.capturedAt, text: segment.text };
    }
    const audioRetention = segment.audioRetention ?? 'delete_after_transcription';
    if (segment.type !== 'voice' || !isId(segment.originDeviceId) || segment.audioStorageScope !== 'local_only' || !audioRetentions.has(audioRetention as string) || !voiceStates.has(segment.transcriptionState as string) || !segment.audio || typeof segment.audio !== 'object' || Array.isArray(segment.audio)) return null;
    const audio = segment.audio as Record<string, unknown>;
    if (audio.mimeType !== 'audio/wav' || !isInteger(audio.durationMs) || !isInteger(audio.chunkCount) || !isInteger(audio.byteLength) || !isInteger(audio.sampleRate) || audio.durationMs > 3_600_000 || audio.byteLength > 8 * 1024 * 1024 || audio.sampleRate < 8_000 || audio.sampleRate > 96_000) return null;
    if (!(segment.asrText === undefined || isText(segment.asrText)) || !(segment.correctedText === undefined || isText(segment.correctedText))) return null;
    let providerReceipt: { operationId: string; providerLogId?: string } | undefined;
    if (segment.providerReceipt !== undefined) {
      if (!segment.providerReceipt || typeof segment.providerReceipt !== 'object' || Array.isArray(segment.providerReceipt)) return null;
      const receipt = segment.providerReceipt as Record<string, unknown>;
      if (!isId(receipt.operationId) || !(receipt.providerLogId === undefined || isText(receipt.providerLogId, 200))) return null;
      providerReceipt = { operationId: receipt.operationId, ...(receipt.providerLogId ? { providerLogId: receipt.providerLogId } : {}) };
    }
    if (segment.transcriptionState === 'transcribed' && !segment.asrText) return null;
    return {
      id: segment.id,
      type: 'voice',
      clientSeq: segment.clientSeq,
      capturedAt: segment.capturedAt,
      originDeviceId: segment.originDeviceId,
      audioStorageScope: 'local_only',
      audioRetention: audioRetention as Extract<PersistedInputSegment, { type: 'voice' }>['audioRetention'],
      transcriptionState: segment.transcriptionState as Extract<PersistedInputSegment, { type: 'voice' }>['transcriptionState'],
      audio: { mimeType: 'audio/wav', durationMs: audio.durationMs, chunkCount: audio.chunkCount, byteLength: audio.byteLength, sampleRate: audio.sampleRate },
      ...(segment.asrText ? { asrText: segment.asrText } : {}),
      ...(segment.correctedText ? { correctedText: segment.correctedText } : {}),
      ...(providerReceipt ? { providerReceipt } : {}),
    };
  });
  if (inputSegments.some((segment) => !segment)) return null;
  if (new Set((inputSegments as PersistedInputSegment[]).map((segment) => segment.clientSeq)).size !== inputSegments.length) return null;
  const workingDraft = normalizeVersion(source.workingDraft, 'working_draft');
  const completedVersions = sourceVersions.map((version) => normalizeVersion(version, 'completed_snapshot'));
  const conflictSnapshots = sourceSnapshots.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const snapshot = candidate as Record<string, unknown>;
    const normalizeItems = (value: unknown): PersistedReviewVersion['items'] | null => {
      if (!Array.isArray(value) || value.length > 20) return null;
      return value.map((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
        const entry = item as Record<string, unknown>;
        if (!isId(entry.itemId) || !sections.has(entry.section as string) || !isText(entry.text) || !['ai', 'user'].includes(entry.createdBy as string) || typeof entry.userEdited !== 'boolean' || typeof entry.locked !== 'boolean' || !isTimestamp(entry.updatedAt) || !Array.isArray(entry.sourceSegmentIds)) return null;
        const sourceSegmentIds = entry.sourceSegmentIds.filter(isId); if (sourceSegmentIds.length !== entry.sourceSegmentIds.length) return null;
        return { itemId: entry.itemId, section: entry.section as 'progress' | 'problems' | 'adjustments' | 'summary', text: entry.text, createdBy: entry.createdBy as 'ai' | 'user', userEdited: entry.userEdited, locked: entry.locked, sourceSegmentIds, updatedAt: entry.updatedAt };
      }).every(Boolean) ? value as PersistedReviewVersion['items'] : null;
    };
    const localItems = normalizeItems(snapshot.localItems); const remoteItems = normalizeItems(snapshot.remoteItems);
    if (!isId(snapshot.id) || !isTimestamp(snapshot.createdAt) || !isText(snapshot.message, 500) || !localItems || !remoteItems) return null;
    return { id: snapshot.id, createdAt: snapshot.createdAt, localItems, remoteItems, message: snapshot.message };
  });
  if (!workingDraft || workingDraft.id !== workingDraftVersionId || completedVersions.some((version) => !version) || conflictSnapshots.some((snapshot) => !snapshot) || (reviewStatus === 'completed' && (!activeCompletedVersionId || !(completedVersions as PersistedReviewVersion[]).some((version) => version?.id === activeCompletedVersionId)))) return null;
  return {
    id,
    reviewDate: expectedDate,
    timezoneAtCreation,
    schemaVersion: 1,
    revision,
    reviewStatus: reviewStatus as PersistedReview['reviewStatus'],
    ...(activeCompletedVersionId ? { activeCompletedVersionId } : {}),
    workingDraftVersionId,
    inputSegments: inputSegments as PersistedInputSegment[],
    workingDraft,
    completedVersions: completedVersions as PersistedReviewVersion[],
    conflictSnapshots: conflictSnapshots as PersistedReview['conflictSnapshots'],
    createdAt,
    updatedAt,
  };
}

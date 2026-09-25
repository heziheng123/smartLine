import type { AuthEnv } from './session.ts';
import { VOICE_MAX_DURATION_MS, VOICE_MAX_PCM_BYTES } from '../../src/review/voiceLimits.ts';
import { buildReviewTextBlocks, reviewContentHash, type ReviewTextBlock } from '../../src/review/textBlocks.ts';

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
  activeTextVersionId: string;
  textVersions: PersistedInputTextVersion[];
  annotations: PersistedReviewAnnotation[];
  workingDraft: PersistedReviewVersion;
  completedVersions: PersistedReviewVersion[];
  conflictSnapshots: Array<{ id: string; createdAt: string; localItems: PersistedReviewVersion['items']; remoteItems: PersistedReviewVersion['items']; message: string }>;
  createdAt: string;
  updatedAt: string;
}

export interface PersistedInputTextVersion {
  id: string;
  text: string;
  sourceRanges: Array<{ segmentId: string; start: number; end: number; contentHash: string }>;
  blocks: ReviewTextBlock[];
  createdAt: string;
}

export interface PersistedReviewAnnotation {
  id: string;
  reviewId: string;
  textVersionId: string;
  type: 'progress' | 'problem' | 'reflection' | 'solution' | 'emphasis';
  start: number;
  end: number;
  sourceSegmentIds: string[];
  sourceBlockId?: string;
  quotedText: string;
  summary?: string;
  createdBy: 'ai' | 'user';
  userEdited: boolean;
  stale: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
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
    deletedAt?: string;
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
const annotationTypes = new Set(['progress', 'problem', 'reflection', 'solution', 'emphasis']);
const voiceStates = new Set(['recording', 'interrupted', 'waiting_transcription', 'transcribing', 'transcribed', 'retryable_failed', 'audio_unavailable']);
const audioRetentions = new Set(['delete_after_transcription', 'keep_7_days', 'keep_30_days']);

const effectiveText = (segment: PersistedInputSegment): string | null => segment.type === 'text' ? segment.text : segment.correctedText ?? segment.asrText ?? null;

function buildTextVersion(inputSegments: PersistedInputSegment[], createdAt: string, id = `review-text-${crypto.randomUUID()}`, previous?: PersistedInputTextVersion): PersistedInputTextVersion {
  let text = '';
  const sourceRanges: PersistedInputTextVersion['sourceRanges'] = [];
  [...inputSegments].sort((left, right) => left.clientSeq - right.clientSeq).forEach((segment) => {
    const source = effectiveText(segment);
    if (!source) return;
    if (text) text += '\n\n';
    const start = text.length;
    text += source;
    sourceRanges.push({ segmentId: segment.id, start, end: text.length, contentHash: reviewContentHash(source) });
  });
  const blocks = buildReviewTextBlocks(sourceRanges.map((range) => ({ id: range.segmentId, text: text.slice(range.start, range.end), startInDocument: range.start })), id, previous?.blocks);
  return { id, text, sourceRanges, blocks, createdAt };
}

function sourceIdsForRange(version: PersistedInputTextVersion, start: number, end: number): string[] {
  return version.sourceRanges.filter((range) => start < range.end && end > range.start).map((range) => range.segmentId);
}

export function refreshPersistedReviewText(review: PersistedReview, now: string): PersistedReview {
  const previous = review.textVersions.find((version) => version.id === review.activeTextVersionId) ?? buildTextVersion(review.inputSegments, review.updatedAt);
  const next = buildTextVersion(review.inputSegments, now, undefined, previous);
  if (previous.text === next.text && JSON.stringify(previous.sourceRanges) === JSON.stringify(next.sourceRanges)) return review;
  const textVersions = [...review.textVersions, next].slice(-20);
  const retainedVersionIds = new Set(textVersions.map((version) => version.id));
  const annotations = review.annotations.map((annotation) => {
    if (annotation.deletedAt || annotation.textVersionId !== previous.id) return annotation;
    if (annotation.createdBy === 'ai' && !annotation.userEdited) {
      const previousBlock = annotation.sourceBlockId
        ? previous.blocks.find((block) => block.blockId === annotation.sourceBlockId)
        : previous.blocks.find((block) => annotation.start >= block.startInDocument && annotation.end <= block.endInDocument);
      const nextBlock = previousBlock && next.blocks.find((block) => block.blockId === previousBlock.blockId && block.contentHash === previousBlock.contentHash);
      if (!previousBlock || !nextBlock) return { ...annotation, stale: true };
      const start = nextBlock.startInDocument + annotation.start - previousBlock.startInDocument;
      const end = start + annotation.quotedText.length;
      return next.text.slice(start, end) === annotation.quotedText ? { ...annotation, textVersionId: next.id, sourceBlockId: nextBlock.blockId, start, end, sourceSegmentIds: [nextBlock.sourceSegmentId], stale: false, updatedAt: now } : { ...annotation, stale: true };
    }
    const matches: number[] = [];
    let offset = next.text.indexOf(annotation.quotedText);
    while (offset >= 0) {
      const ids = sourceIdsForRange(next, offset, offset + annotation.quotedText.length);
      if (ids.length && ids.length === annotation.sourceSegmentIds.length && ids.every((id) => annotation.sourceSegmentIds.includes(id))) matches.push(offset);
      offset = next.text.indexOf(annotation.quotedText, offset + 1);
    }
    if (matches.length !== 1) return { ...annotation, stale: true };
    const start = matches[0]!;
    return { ...annotation, textVersionId: next.id, start, end: start + annotation.quotedText.length, stale: false, updatedAt: now };
  }).filter((annotation) => retainedVersionIds.has(annotation.textVersionId) || annotation.deletedAt || annotation.createdBy === 'user' || annotation.userEdited);
  return { ...review, activeTextVersionId: next.id, textVersions, annotations };
}

function normalizeVersion(value: unknown, kind: PersistedReviewVersion['kind']): PersistedReviewVersion | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const { id, versionNo, baseRevision, createdAt, items: sourceItems, completedAt } = source;
  if (!isId(id) || !isInteger(versionNo) || !isInteger(baseRevision) || !isTimestamp(createdAt) || !Array.isArray(sourceItems)) return null;
  if (sourceItems.length > 200) return null;
  const items = sourceItems.map((candidate) => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (!isId(item.itemId) || !sections.has(item.section as string) || !isText(item.text) || !['ai', 'user'].includes(item.createdBy as string) || typeof item.userEdited !== 'boolean' || typeof item.locked !== 'boolean' || !isTimestamp(item.updatedAt) || !(item.deletedAt === undefined || isTimestamp(item.deletedAt)) || !Array.isArray(item.sourceSegmentIds)) return null;
    const sourceSegmentIds = item.sourceSegmentIds.filter(isId);
    if (sourceSegmentIds.length !== item.sourceSegmentIds.length) return null;
    return { itemId: item.itemId, section: item.section as 'progress' | 'problems' | 'adjustments' | 'summary', text: item.text, createdBy: item.createdBy as 'ai' | 'user', userEdited: item.userEdited, locked: item.locked, sourceSegmentIds, updatedAt: item.updatedAt, ...(item.deletedAt ? { deletedAt: item.deletedAt } : {}) };
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
    if (audio.mimeType !== 'audio/wav' || !isInteger(audio.durationMs) || !isInteger(audio.chunkCount) || !isInteger(audio.byteLength) || !isInteger(audio.sampleRate) || audio.durationMs > VOICE_MAX_DURATION_MS || audio.byteLength > VOICE_MAX_PCM_BYTES || audio.sampleRate < 8_000 || audio.sampleRate > 96_000) return null;
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
  const normalizedSegments = inputSegments as PersistedInputSegment[];
  const canonicalTextVersion = buildTextVersion(normalizedSegments, updatedAt as string, 'review-text-legacy');
  const sourceTextVersions = source.textVersions;
  const textVersions = Array.isArray(sourceTextVersions) ? sourceTextVersions.map((candidate): PersistedInputTextVersion | null => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const version = candidate as Record<string, unknown>;
    if (!isId(version.id) || !isText(version.text, 100_000) || !isTimestamp(version.createdAt) || !Array.isArray(version.sourceRanges) || version.sourceRanges.length > 200) return null;
    const ranges = version.sourceRanges.map((candidateRange) => {
      if (!candidateRange || typeof candidateRange !== 'object' || Array.isArray(candidateRange)) return null;
      const range = candidateRange as Record<string, unknown>;
      if (!isId(range.segmentId) || !isInteger(range.start) || !isInteger(range.end) || range.end <= range.start || range.end > (version.text as string).length) return null;
      const content = (version.text as string).slice(range.start as number, range.end as number);
      if (!(range.contentHash === undefined || range.contentHash === reviewContentHash(content))) return null;
      return { segmentId: range.segmentId, start: range.start, end: range.end, contentHash: reviewContentHash(content) };
    });
    if (ranges.some((range) => !range)) return null;
    const expectedBlocks = buildReviewTextBlocks((ranges as PersistedInputTextVersion['sourceRanges']).map((range) => ({ id: range.segmentId, text: (version.text as string).slice(range.start, range.end), startInDocument: range.start })), version.id as string);
    const blocks = Array.isArray(version.blocks) ? version.blocks.map((candidateBlock): ReviewTextBlock | null => {
      if (!candidateBlock || typeof candidateBlock !== 'object' || Array.isArray(candidateBlock)) return null;
      const block = candidateBlock as Record<string, unknown>;
      const expected = expectedBlocks.find((item) => item.sourceSegmentId === block.sourceSegmentId && item.ordinal === block.ordinal);
      if (!expected || !isId(block.blockId) || block.textVersionId !== version.id || block.text !== expected.text || block.startInDocument !== expected.startInDocument || block.endInDocument !== expected.endInDocument || block.contentHash !== expected.contentHash || !['never', 'analyzed', 'changed', 'stale'].includes(block.analysisState as string)) return null;
      if (!(block.lastAnalyzedHash === undefined || isText(block.lastAnalyzedHash, 100)) || !(block.lastAnalyzedPromptVersion === undefined || isText(block.lastAnalyzedPromptVersion, 100)) || !(block.lastAnalyzedSchemaVersion === undefined || isText(block.lastAnalyzedSchemaVersion, 100)) || !(block.lastAnalyzedModelVersion === undefined || isText(block.lastAnalyzedModelVersion, 160)) || !(block.analyzedAt === undefined || isTimestamp(block.analyzedAt))) return null;
      return { ...expected, blockId: block.blockId, analysisState: block.analysisState as ReviewTextBlock['analysisState'], ...(block.lastAnalyzedHash ? { lastAnalyzedHash: block.lastAnalyzedHash as string } : {}), ...(block.lastAnalyzedPromptVersion ? { lastAnalyzedPromptVersion: block.lastAnalyzedPromptVersion as string } : {}), ...(block.lastAnalyzedSchemaVersion ? { lastAnalyzedSchemaVersion: block.lastAnalyzedSchemaVersion as string } : {}), ...(block.lastAnalyzedModelVersion ? { lastAnalyzedModelVersion: block.lastAnalyzedModelVersion as string } : {}), ...(block.analyzedAt ? { analyzedAt: block.analyzedAt as string } : {}) };
    }) : expectedBlocks;
    if (blocks.some((block) => !block) || blocks.length !== expectedBlocks.length || new Set((blocks as ReviewTextBlock[]).map((block) => block.blockId)).size !== blocks.length) return null;
    return { id: version.id, text: version.text, sourceRanges: ranges as PersistedInputTextVersion['sourceRanges'], blocks: blocks as ReviewTextBlock[], createdAt: version.createdAt };
  }) : [];
  if (textVersions.some((version) => !version) || textVersions.length > 20) return null;
  const normalizedTextVersions = (textVersions.length ? textVersions : [canonicalTextVersion]) as PersistedInputTextVersion[];
  const activeTextVersionId = isId(source.activeTextVersionId) && normalizedTextVersions.some((version) => version.id === source.activeTextVersionId) ? source.activeTextVersionId : normalizedTextVersions.at(-1)!.id;
  const activeVersion = normalizedTextVersions.find((version) => version.id === activeTextVersionId)!;
  if (activeVersion.text !== canonicalTextVersion.text || JSON.stringify(activeVersion.sourceRanges) !== JSON.stringify(canonicalTextVersion.sourceRanges)) return null;
  const sourceAnnotations = source.annotations;
  const annotations = Array.isArray(sourceAnnotations) ? sourceAnnotations.map((candidate): PersistedReviewAnnotation | null => {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return null;
    const annotation = candidate as Record<string, unknown>;
    const version = normalizedTextVersions.find((item) => item.id === annotation.textVersionId);
    const orphanAllowed = !version && (annotation.deletedAt !== undefined || annotation.stale === true && (annotation.createdBy === 'user' || annotation.userEdited === true));
    if ((!version && !orphanAllowed) || !isId(annotation.id) || annotation.reviewId !== id || !isId(annotation.textVersionId) || !annotationTypes.has(annotation.type as string) || !isInteger(annotation.start) || !isInteger(annotation.end) || annotation.end <= annotation.start || version && (annotation.end > version.text.length || version.text.slice(annotation.start, annotation.end) !== annotation.quotedText) || !Array.isArray(annotation.sourceSegmentIds) || !isText(annotation.quotedText) || !(annotation.sourceBlockId === undefined || isId(annotation.sourceBlockId)) || !(annotation.summary === undefined || isText(annotation.summary, 500)) || !['ai', 'user'].includes(annotation.createdBy as string) || typeof annotation.userEdited !== 'boolean' || typeof annotation.stale !== 'boolean' || !isTimestamp(annotation.createdAt) || !isTimestamp(annotation.updatedAt) || !(annotation.deletedAt === undefined || isTimestamp(annotation.deletedAt))) return null;
    const sourceSegmentIds = annotation.sourceSegmentIds.filter(isId);
    const expectedSourceIds = version ? sourceIdsForRange(version, annotation.start, annotation.end) : sourceSegmentIds;
    const sourceBlock = version && annotation.sourceBlockId ? version.blocks.find((block) => block.blockId === annotation.sourceBlockId) : undefined;
    if (!sourceSegmentIds.length || sourceSegmentIds.length !== annotation.sourceSegmentIds.length || sourceSegmentIds.length !== expectedSourceIds.length || !expectedSourceIds.every((sourceId) => sourceSegmentIds.includes(sourceId)) || annotation.sourceBlockId && version && (!sourceBlock || annotation.start < sourceBlock.startInDocument || annotation.end > sourceBlock.endInDocument)) return null;
    return { id: annotation.id, reviewId: id as string, textVersionId: annotation.textVersionId as string, type: annotation.type as PersistedReviewAnnotation['type'], start: annotation.start, end: annotation.end, sourceSegmentIds, ...(annotation.sourceBlockId ? { sourceBlockId: annotation.sourceBlockId as string } : {}), quotedText: annotation.quotedText, ...(annotation.summary ? { summary: annotation.summary } : {}), createdBy: annotation.createdBy as 'ai' | 'user', userEdited: annotation.userEdited, stale: annotation.stale, createdAt: annotation.createdAt, updatedAt: annotation.updatedAt, ...(annotation.deletedAt ? { deletedAt: annotation.deletedAt } : {}) };
  }) : [];
  if (annotations.some((annotation) => !annotation) || annotations.length > 400) return null;
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
        if (!isId(entry.itemId) || !sections.has(entry.section as string) || !isText(entry.text) || !['ai', 'user'].includes(entry.createdBy as string) || typeof entry.userEdited !== 'boolean' || typeof entry.locked !== 'boolean' || !isTimestamp(entry.updatedAt) || !(entry.deletedAt === undefined || isTimestamp(entry.deletedAt)) || !Array.isArray(entry.sourceSegmentIds)) return null;
        const sourceSegmentIds = entry.sourceSegmentIds.filter(isId); if (sourceSegmentIds.length !== entry.sourceSegmentIds.length) return null;
        return { itemId: entry.itemId, section: entry.section as 'progress' | 'problems' | 'adjustments' | 'summary', text: entry.text, createdBy: entry.createdBy as 'ai' | 'user', userEdited: entry.userEdited, locked: entry.locked, sourceSegmentIds, updatedAt: entry.updatedAt, ...(entry.deletedAt ? { deletedAt: entry.deletedAt } : {}) };
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
    inputSegments: normalizedSegments,
    activeTextVersionId,
    textVersions: normalizedTextVersions,
    annotations: annotations as PersistedReviewAnnotation[],
    workingDraft,
    completedVersions: completedVersions as PersistedReviewVersion[],
    conflictSnapshots: conflictSnapshots as PersistedReview['conflictSnapshots'],
    createdAt,
    updatedAt,
  };
}

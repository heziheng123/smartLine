export type ReviewSection = 'progress' | 'problems' | 'adjustments' | 'summary';
export type ReviewStatus = 'draft' | 'completed';
export type ReviewAnnotationType = 'progress' | 'problem' | 'reflection' | 'solution' | 'emphasis';

export interface TextInputSegment {
  id: string;
  type: 'text';
  clientSeq: number;
  capturedAt: string;
  text: string;
}

export type VoiceTranscriptionState = 'recording' | 'interrupted' | 'waiting_transcription' | 'transcribing' | 'transcribed' | 'retryable_failed' | 'audio_unavailable';
export type VoiceAudioRetention = 'delete_after_transcription' | 'keep_7_days' | 'keep_30_days';

export interface VoiceInputSegment {
  id: string;
  type: 'voice';
  clientSeq: number;
  capturedAt: string;
  originDeviceId: string;
  audioStorageScope: 'local_only';
  audioRetention: VoiceAudioRetention;
  transcriptionState: VoiceTranscriptionState;
  audio: { mimeType: 'audio/wav'; durationMs: number; chunkCount: number; byteLength: number; sampleRate: number };
  asrText?: string;
  correctedText?: string;
  /** Local-only interim draft shown grayed while recording/paused; replaced by the final receipt. */
  interimTranscript?: string;
  interimAt?: string;
  providerReceipt?: { operationId: string; providerLogId?: string };
}

export type InputSegment = TextInputSegment | VoiceInputSegment;

export interface InputTextVersion {
  id: string;
  text: string;
  sourceRanges: Array<{ segmentId: string; start: number; end: number; contentHash: string }>;
  blocks: ReviewTextBlock[];
  createdAt: string;
}

export interface ReviewAnnotation {
  id: string;
  reviewId: string;
  textVersionId: string;
  type: ReviewAnnotationType;
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

export interface ReviewItem {
  itemId: string;
  section: ReviewSection;
  text: string;
  createdBy: 'ai' | 'user';
  userEdited: boolean;
  locked: boolean;
  sourceSegmentIds: string[];
  updatedAt: string;
  deletedAt?: string;
}

export interface ReviewVersion {
  id: string;
  versionNo: number;
  kind: 'working_draft' | 'completed_snapshot';
  baseRevision: number;
  items: ReviewItem[];
  createdAt: string;
  completedAt?: string;
}

export interface ReviewConflictSnapshot {
  id: string;
  createdAt: string;
  localItems: ReviewItem[];
  remoteItems: ReviewItem[];
  message: string;
}

export interface DailyReview {
  id: string;
  reviewDate: string;
  timezoneAtCreation: string;
  schemaVersion: 1;
  revision: number;
  reviewStatus: ReviewStatus;
  activeCompletedVersionId?: string;
  workingDraftVersionId: string;
  inputSegments: InputSegment[];
  activeTextVersionId: string;
  textVersions: InputTextVersion[];
  annotations: ReviewAnnotation[];
  workingDraft: ReviewVersion;
  completedVersions: ReviewVersion[];
  conflictSnapshots: ReviewConflictSnapshot[];
  createdAt: string;
  updatedAt: string;
}

export interface AiReviewItem {
  section: ReviewSection;
  text: string;
  sourceSegmentIds: string[];
}

export interface AiReviewAnnotation {
  blockId: string;
  type: ReviewAnnotationType;
  start: number;
  end: number;
  sourceSegmentIds: string[];
  summary?: string;
}

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const annotationTypes = new Set<ReviewAnnotationType>(['progress', 'problem', 'reflection', 'solution', 'emphasis']);

const segmentText = (segment: InputSegment): string | null => segment.type === 'text' ? segment.text : segment.correctedText ?? segment.asrText ?? null;

export function createInputTextVersion(inputSegments: InputSegment[], now = new Date().toISOString(), previous?: InputTextVersion): InputTextVersion {
  const id = newId('review-text');
  let text = '';
  const sourceRanges: InputTextVersion['sourceRanges'] = [];
  [...inputSegments].sort((left, right) => left.clientSeq - right.clientSeq).forEach((segment) => {
    const source = segmentText(segment);
    if (!source) return;
    if (text) text += '\n\n';
    const start = text.length;
    text += source;
    sourceRanges.push({ segmentId: segment.id, start, end: text.length, contentHash: reviewContentHash(source) });
  });
  const blocks = buildReviewTextBlocks(sourceRanges.map((range) => ({ id: range.segmentId, text: text.slice(range.start, range.end), startInDocument: range.start })), id, previous?.blocks);
  return { id, text, sourceRanges, blocks, createdAt: now };
}

export function activeTextVersion(review: DailyReview): InputTextVersion {
  return review.textVersions.find((version) => version.id === review.activeTextVersionId) ?? createInputTextVersion(review.inputSegments, review.updatedAt);
}

function sourceIdsForRange(version: InputTextVersion, start: number, end: number): string[] {
  return version.sourceRanges.filter((range) => start < range.end && end > range.start).map((range) => range.segmentId);
}

function migrateProtectedAnnotation(annotation: ReviewAnnotation, version: InputTextVersion): ReviewAnnotation {
  const matches: number[] = [];
  let offset = version.text.indexOf(annotation.quotedText);
  while (offset >= 0) {
    const ids = sourceIdsForRange(version, offset, offset + annotation.quotedText.length);
    if (ids.length && ids.every((id) => annotation.sourceSegmentIds.includes(id)) && annotation.sourceSegmentIds.every((id) => ids.includes(id))) matches.push(offset);
    offset = version.text.indexOf(annotation.quotedText, offset + 1);
  }
  if (matches.length !== 1) return { ...annotation, stale: true };
  const start = matches[0]!;
  return { ...annotation, textVersionId: version.id, start, end: start + annotation.quotedText.length, stale: false, updatedAt: version.createdAt };
}

function migrateUnchangedAiAnnotation(annotation: ReviewAnnotation, previous: InputTextVersion, next: InputTextVersion): ReviewAnnotation {
  const previousBlock = annotation.sourceBlockId
    ? previous.blocks.find((block) => block.blockId === annotation.sourceBlockId)
    : previous.blocks.find((block) => annotation.start >= block.startInDocument && annotation.end <= block.endInDocument);
  const nextBlock = previousBlock && next.blocks.find((block) => block.blockId === previousBlock.blockId && block.contentHash === previousBlock.contentHash);
  if (!previousBlock || !nextBlock) return { ...annotation, stale: true };
  const start = nextBlock.startInDocument + annotation.start - previousBlock.startInDocument;
  const end = start + annotation.quotedText.length;
  if (next.text.slice(start, end) !== annotation.quotedText) return { ...annotation, stale: true };
  return { ...annotation, textVersionId: next.id, sourceBlockId: nextBlock.blockId, start, end, sourceSegmentIds: [nextBlock.sourceSegmentId], stale: false, updatedAt: next.createdAt };
}

export function refreshReviewTextVersion(review: DailyReview, now = new Date().toISOString()): DailyReview {
  const previous = activeTextVersion(review);
  const next = createInputTextVersion(review.inputSegments, now, previous);
  if (previous.text === next.text && previous.sourceRanges.length === next.sourceRanges.length && previous.sourceRanges.every((range, index) => range.segmentId === next.sourceRanges[index]?.segmentId && range.start === next.sourceRanges[index]?.start && range.end === next.sourceRanges[index]?.end)) return review;
  const textVersions = [...review.textVersions, next].slice(-20);
  const retainedVersionIds = new Set(textVersions.map((version) => version.id));
  const annotations = review.annotations.map((annotation) => {
    if (annotation.deletedAt || annotation.textVersionId !== previous.id) return annotation;
    return annotation.createdBy === 'user' || annotation.userEdited
      ? migrateProtectedAnnotation(annotation, next)
      : migrateUnchangedAiAnnotation(annotation, previous, next);
  }).filter((annotation) => retainedVersionIds.has(annotation.textVersionId) || annotation.deletedAt || annotation.createdBy === 'user' || annotation.userEdited);
  return { ...review, activeTextVersionId: next.id, textVersions, annotations };
}

const overlaps = (left: ReviewAnnotation, right: ReviewAnnotation): boolean => left.start < right.end && left.end > right.start;

export function resolveAnnotationConflicts(annotations: ReviewAnnotation[]): ReviewAnnotation[] {
  const emphasis = annotations.filter((annotation) => annotation.type === 'emphasis');
  const backgrounds = annotations.filter((annotation) => annotation.type !== 'emphasis')
    .sort((left, right) => Number(right.createdBy === 'user' || right.userEdited) - Number(left.createdBy === 'user' || left.userEdited) || (left.end - left.start) - (right.end - right.start) || left.id.localeCompare(right.id));
  const accepted: ReviewAnnotation[] = [];
  for (const annotation of backgrounds) if (!accepted.some((current) => overlaps(current, annotation))) accepted.push(annotation);
  return [...accepted, ...emphasis].sort((left, right) => left.start - right.start || left.end - right.end || left.id.localeCompare(right.id));
}

function cloneVersion(version: ReviewVersion, kind: ReviewVersion['kind'], completedAt?: string): ReviewVersion {
  return {
    ...version,
    id: newId('review-version'),
    kind,
    items: version.items.filter((item) => !item.deletedAt).map((item) => ({ ...item, sourceSegmentIds: [...item.sourceSegmentIds] })),
    completedAt,
  };
}

export function createDailyReview(reviewDate: string, now = new Date().toISOString()): DailyReview {
  const workingDraftId = newId('review-version');
  const textVersion = createInputTextVersion([], now);
  return {
    id: newId('review'),
    reviewDate,
    timezoneAtCreation: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    schemaVersion: 1,
    revision: 0,
    reviewStatus: 'draft',
    workingDraftVersionId: workingDraftId,
    inputSegments: [],
    activeTextVersionId: textVersion.id,
    textVersions: [textVersion],
    annotations: [],
    workingDraft: {
      id: workingDraftId,
      versionNo: 1,
      kind: 'working_draft',
      baseRevision: 0,
      items: [],
      createdAt: now,
    },
    completedVersions: [],
    conflictSnapshots: [],
    createdAt: now,
    updatedAt: now,
  };
}

function change(review: DailyReview, now: string, changeDraft: (draft: ReviewVersion) => ReviewVersion): DailyReview {
  return {
    ...review,
    revision: review.revision + 1,
    reviewStatus: 'draft',
    workingDraft: { ...changeDraft(review.workingDraft), baseRevision: review.revision },
    updatedAt: now,
  };
}

export function appendTextSegment(review: DailyReview, text: string, now = new Date().toISOString()): DailyReview {
  const trimmed = text.trim();
  if (!trimmed) return review;
  const segment: TextInputSegment = {
    id: newId('review-segment'),
    type: 'text',
    clientSeq: review.inputSegments.length + 1,
    capturedAt: now,
    text: trimmed,
  };
  return refreshReviewTextVersion({
    ...change(review, now, (draft) => ({ ...draft })),
    inputSegments: [...review.inputSegments, segment],
  }, now);
}

export function appendVoiceSegment(
  review: DailyReview,
  voice: Omit<VoiceInputSegment, 'clientSeq' | 'capturedAt'>,
  now = new Date().toISOString(),
): DailyReview {
  return {
    ...change(review, now, (draft) => ({ ...draft })),
    inputSegments: [...review.inputSegments, { ...voice, clientSeq: review.inputSegments.length + 1, capturedAt: now }],
  };
}

export function updateVoiceAudio(
  review: DailyReview,
  segmentId: string,
  audio: VoiceInputSegment['audio'],
  transcriptionState: VoiceTranscriptionState,
  now = new Date().toISOString(),
): DailyReview {
  const voice = review.inputSegments.find((segment): segment is VoiceInputSegment => segment.id === segmentId && segment.type === 'voice');
  if (!voice) return review;
  return {
    ...change(review, now, (draft) => ({ ...draft })),
    inputSegments: review.inputSegments.map((segment) => segment.id === segmentId && segment.type === 'voice' ? { ...segment, audio, transcriptionState } : segment),
  };
}

export function setVoiceTranscriptionState(
  review: DailyReview,
  segmentId: string,
  transcriptionState: VoiceTranscriptionState,
  now = new Date().toISOString(),
): DailyReview {
  const voice = review.inputSegments.find((segment): segment is VoiceInputSegment => segment.id === segmentId && segment.type === 'voice');
  if (!voice || voice.transcriptionState === transcriptionState) return review;
  return {
    ...change(review, now, (draft) => ({ ...draft })),
    inputSegments: review.inputSegments.map((segment) => segment.id === segmentId && segment.type === 'voice' ? { ...segment, transcriptionState } : segment),
  };
}

export function applyVoiceTranscript(
  review: DailyReview,
  segmentId: string,
  asrText: string,
  providerReceipt: VoiceInputSegment['providerReceipt'],
  now = new Date().toISOString(),
): DailyReview {
  const text = asrText.trim();
  const voice = review.inputSegments.find((segment): segment is VoiceInputSegment => segment.id === segmentId && segment.type === 'voice');
  if (!voice || !text) return review;
  return refreshReviewTextVersion({
    ...change(review, now, (draft) => ({ ...draft, items: draft.items.filter((item) => item.locked || item.deletedAt) })),
    inputSegments: review.inputSegments.map((segment) => segment.id === segmentId && segment.type === 'voice'
      ? { ...segment, transcriptionState: 'transcribed' as const, asrText: text, providerReceipt }
      : segment),
  }, now);
}

export function updateVoiceTranscript(review: DailyReview, segmentId: string, text: string, now = new Date().toISOString()): DailyReview {
  const correctedText = text.trim();
  const voice = review.inputSegments.find((segment): segment is VoiceInputSegment => segment.id === segmentId && segment.type === 'voice');
  if (!voice || !correctedText || voice.correctedText === correctedText) return review;
  return refreshReviewTextVersion({
    ...change(review, now, (draft) => ({ ...draft, items: draft.items.filter((item) => item.locked || item.deletedAt) })),
    inputSegments: review.inputSegments.map((segment) => segment.id === segmentId && segment.type === 'voice' ? { ...segment, correctedText } : segment),
  }, now);
}

export function setVoiceInterimTranscript(review: DailyReview, segmentId: string, interimTranscript: string, now = new Date().toISOString()): DailyReview {
  const trimmed = interimTranscript.trim().slice(0, 20_000);
  if (!trimmed) return review;
  return {
    ...review,
    inputSegments: review.inputSegments.map((segment) => segment.id === segmentId && segment.type === 'voice'
      ? { ...segment, interimTranscript: trimmed, interimAt: now }
      : segment),
    updatedAt: now,
  };
}

export function effectiveSegmentText(segment: InputSegment): string | null {
  return segmentText(segment);
}

export function addReviewItem(review: DailyReview, section: ReviewSection, text: string, now = new Date().toISOString()): DailyReview {
  const trimmed = text.trim();
  if (!trimmed) return review;
  return change(review, now, (draft) => ({
    ...draft,
    items: [...draft.items, {
      itemId: newId('review-item'),
      section,
      text: trimmed,
      createdBy: 'user',
      userEdited: true,
      locked: true,
      sourceSegmentIds: [],
      updatedAt: now,
    }],
  }));
}

export function updateTextSegment(review: DailyReview, segmentId: string, text: string, now = new Date().toISOString()): DailyReview {
  const trimmed = text.trim();
  const segment = review.inputSegments.find((item): item is TextInputSegment => item.id === segmentId && item.type === 'text');
  if (!segment || !trimmed || segment.text === trimmed) return review;
  return refreshReviewTextVersion({
    ...change(review, now, (draft) => ({ ...draft, items: draft.items.filter((item) => item.locked) })),
    inputSegments: review.inputSegments.map((item) => item.id === segmentId ? { ...item, text: trimmed } : item),
  }, now);
}

export function withdrawLastInputSegment(review: DailyReview, now = new Date().toISOString()): DailyReview {
  const removed = review.inputSegments.at(-1);
  if (!removed) return review;
  return refreshReviewTextVersion({
    ...change(review, now, (draft) => ({ ...draft, items: draft.items.filter((item) => item.locked || !item.sourceSegmentIds.includes(removed.id)) })),
    inputSegments: review.inputSegments.slice(0, -1),
  }, now);
}

export function activeReviewAnnotations(review: DailyReview): ReviewAnnotation[] {
  return resolveAnnotationConflicts(review.annotations.filter((annotation) => !annotation.deletedAt && !annotation.stale && annotation.textVersionId === review.activeTextVersionId));
}

function validAnnotationCandidate(version: InputTextVersion, candidate: Omit<AiReviewAnnotation, 'blockId'> & { blockId?: string }): boolean {
  if (!annotationTypes.has(candidate.type) || !Number.isSafeInteger(candidate.start) || !Number.isSafeInteger(candidate.end) || candidate.start < 0 || candidate.end <= candidate.start || candidate.end > version.text.length) return false;
  const sourceIds = sourceIdsForRange(version, candidate.start, candidate.end);
  const block = candidate.blockId ? version.blocks.find((item) => item.blockId === candidate.blockId) : undefined;
  return sourceIds.length > 0 && sourceIds.length === candidate.sourceSegmentIds.length && sourceIds.every((id) => candidate.sourceSegmentIds.includes(id)) && (!candidate.blockId || Boolean(block && candidate.start >= block.startInDocument && candidate.end <= block.endInDocument));
}

export function addReviewAnnotation(review: DailyReview, type: ReviewAnnotationType, start: number, end: number, now = new Date().toISOString()): DailyReview {
  const version = activeTextVersion(review);
  const sourceSegmentIds = sourceIdsForRange(version, start, end);
  const candidate = { type, start, end, sourceSegmentIds };
  if (!validAnnotationCandidate(version, candidate) || !version.text.slice(start, end).trim()) return review;
  const annotation: ReviewAnnotation = { id: newId('review-annotation'), reviewId: review.id, textVersionId: version.id, ...candidate, quotedText: version.text.slice(start, end), createdBy: 'user', userEdited: true, stale: false, createdAt: now, updatedAt: now };
  const history = review.annotations.filter((item) => item.deletedAt || item.stale || item.textVersionId !== version.id);
  const current = review.annotations.filter((item) => !item.deletedAt && !item.stale && item.textVersionId === version.id);
  return { ...change(review, now, (draft) => ({ ...draft })), annotations: [...history, ...resolveAnnotationConflicts([...current, annotation])] };
}

export function updateReviewAnnotation(review: DailyReview, annotationId: string, type: ReviewAnnotationType, now = new Date().toISOString()): DailyReview {
  if (!annotationTypes.has(type) || !review.annotations.some((annotation) => annotation.id === annotationId && !annotation.deletedAt)) return review;
  return { ...change(review, now, (draft) => ({ ...draft })), annotations: review.annotations.map((annotation) => annotation.id === annotationId ? { ...annotation, type, userEdited: true, updatedAt: now } : annotation) };
}

export function removeReviewAnnotation(review: DailyReview, annotationId: string, now = new Date().toISOString()): DailyReview {
  if (!review.annotations.some((annotation) => annotation.id === annotationId && !annotation.deletedAt)) return review;
  return { ...change(review, now, (draft) => ({ ...draft })), annotations: review.annotations.map((annotation) => annotation.id === annotationId ? { ...annotation, userEdited: true, stale: false, updatedAt: now, deletedAt: now } : annotation) };
}

export function updateReviewItem(review: DailyReview, itemId: string, text: string, now = new Date().toISOString()): DailyReview {
  const trimmed = text.trim();
  if (!trimmed) return review;
  return change(review, now, (draft) => ({
    ...draft,
    items: draft.items.map((item) => item.itemId === itemId && !item.deletedAt
      ? { ...item, text: trimmed, createdBy: 'user', userEdited: true, locked: true, updatedAt: now }
      : item),
  }));
}

export function removeReviewItem(review: DailyReview, itemId: string, now = new Date().toISOString()): DailyReview {
  if (!review.workingDraft.items.some((item) => item.itemId === itemId && !item.deletedAt)) return review;
  return change(review, now, (draft) => ({
    ...draft,
    items: draft.items.map((item) => item.itemId === itemId
      ? { ...item, createdBy: 'user', userEdited: true, locked: true, updatedAt: now, deletedAt: now }
      : item),
  }));
}

export const activeReviewItems = (review: DailyReview): ReviewItem[] =>
  review.workingDraft.items.filter((item) => !item.deletedAt);

export function applyAiItems(review: DailyReview, candidates: AiReviewItem[], now = new Date().toISOString()): DailyReview {
  const segmentIds = new Set(review.inputSegments.map((segment) => segment.id));
  const nextItems = candidates.flatMap((candidate) => {
    const text = candidate.text.trim();
    const sourceSegmentIds = [...new Set(candidate.sourceSegmentIds)].filter((id) => segmentIds.has(id));
    if (!text || !sourceSegmentIds.length) return [];
    return [{
      itemId: newId('review-item'),
      section: candidate.section,
      text,
      createdBy: 'ai' as const,
      userEdited: false,
      locked: false,
      sourceSegmentIds,
      updatedAt: now,
    }];
  });
  return change(review, now, (draft) => ({ ...draft, items: [...draft.items.filter((item) => item.locked || item.deletedAt), ...nextItems] }));
}

export function applyAiAnalysis(review: DailyReview, candidates: AiReviewItem[], annotations: AiReviewAnnotation[], now = new Date().toISOString()): DailyReview {
  const withItems = applyAiItems(review, candidates, now);
  const version = activeTextVersion(withItems);
  const protectedAnnotations = withItems.annotations.filter((annotation) => annotation.deletedAt || annotation.createdBy === 'user' || annotation.userEdited);
  const generated = annotations.flatMap((candidate) => {
    if (!validAnnotationCandidate(version, candidate)) return [];
    const quotedText = version.text.slice(candidate.start, candidate.end);
    if (!quotedText.trim()) return [];
    return [{ id: newId('review-annotation'), reviewId: review.id, textVersionId: version.id, type: candidate.type, start: candidate.start, end: candidate.end, sourceSegmentIds: candidate.sourceSegmentIds, sourceBlockId: candidate.blockId, ...(candidate.summary ? { summary: candidate.summary } : {}), quotedText, createdBy: 'ai' as const, userEdited: false, stale: false, createdAt: now, updatedAt: now }];
  });
  const currentProtected = protectedAnnotations.filter((annotation) => !annotation.deletedAt && !annotation.stale && annotation.textVersionId === version.id);
  const resolvedCurrent = resolveAnnotationConflicts([...currentProtected, ...generated]);
  const preservedHistory = protectedAnnotations.filter((annotation) => annotation.deletedAt || annotation.stale || annotation.textVersionId !== version.id);
  return { ...withItems, annotations: [...preservedHistory, ...resolvedCurrent] };
}

export function restoreCompletedVersion(review: DailyReview, versionId: string, now = new Date().toISOString()): DailyReview {
  const snapshot = review.completedVersions.find((version) => version.id === versionId);
  if (!snapshot) return review;
  return change(review, now, (draft) => ({
    ...draft,
    items: snapshot.items.filter((item) => !item.deletedAt).map((item) => ({ ...item, sourceSegmentIds: [...item.sourceSegmentIds], updatedAt: now })),
  }));
}

export function completeDailyReview(review: DailyReview, now = new Date().toISOString()): DailyReview {
  if (review.reviewStatus === 'completed') return review;
  const versionNo = review.completedVersions.length + 1;
  const snapshot = cloneVersion({ ...review.workingDraft, versionNo }, 'completed_snapshot', now);
  return {
    ...review,
    revision: review.revision + 1,
    reviewStatus: 'completed',
    activeCompletedVersionId: snapshot.id,
    completedVersions: [...review.completedVersions, snapshot],
    workingDraft: { ...review.workingDraft, versionNo: versionNo + 1, baseRevision: review.revision + 1 },
    updatedAt: now,
  };
}

function uniqueById<T extends { id: string }>(items: T[]): T[] {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

/** Merges independent device edits without discarding either device's raw evidence. */
export function mergeDailyReviews(local: DailyReview, remote: DailyReview, now = new Date().toISOString()): DailyReview {
  const localItems = new Map(local.workingDraft.items.map((item) => [item.itemId, item]));
  const remoteItems = new Map(remote.workingDraft.items.map((item) => [item.itemId, item]));
  const winner = local.updatedAt >= remote.updatedAt ? local : remote;
  const overlappingEdits = [...localItems].filter(([id, item]) => {
    const peer = remoteItems.get(id);
    return peer && (peer.text !== item.text || Boolean(peer.deletedAt) !== Boolean(item.deletedAt)) && item.userEdited && peer.userEdited;
  }).map(([id]) => id);
  const segmentIds = new Set([...remote.inputSegments, ...local.inputSegments].map((segment) => segment.id));
  const mergedSegments = [...segmentIds].map((id) => {
    const own = local.inputSegments.find((segment) => segment.id === id);
    const peer = remote.inputSegments.find((segment) => segment.id === id);
    if (!own) return peer!;
    if (!peer) return own;
    if (own.type === 'voice' && peer.type === 'voice' && own.transcriptionState !== peer.transcriptionState) {
      const transcribed = own.transcriptionState === 'transcribed' ? own : peer.transcriptionState === 'transcribed' ? peer : null;
      if (transcribed) {
        const other = transcribed === own ? peer : own;
        return { ...transcribed, ...(other.correctedText && !transcribed.correctedText ? { correctedText: other.correctedText } : {}) };
      }
    }
    return winner === local ? own : peer;
  })
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id))
    .map((segment, index) => ({ ...segment, clientSeq: index + 1 }));
  const mergedItems = [...new Set([...remoteItems.keys(), ...localItems.keys()])].map((id) => {
    const peer = remoteItems.get(id);
    const own = localItems.get(id);
    if (!peer) return own!;
    if (!own) return peer;
    return peer.updatedAt > own.updatedAt ? peer : own;
  });
  const snapshots = [...local.conflictSnapshots, ...remote.conflictSnapshots];
  if (overlappingEdits.length) snapshots.push({ id: newId('review-conflict'), createdAt: now, localItems: overlappingEdits.map((id) => ({ ...localItems.get(id)! })), remoteItems: overlappingEdits.map((id) => ({ ...remoteItems.get(id)! })), message: '两台设备修改了同一条人工编辑；已保留较新的工作稿，另一版本可从冲突快照追溯。' });
  const completedVersions = uniqueById([...remote.completedVersions, ...local.completedVersions]);
  const textVersions = uniqueById([...remote.textVersions, ...local.textVersions]);
  const annotations = [...new Map([...remote.annotations, ...local.annotations].map((annotation) => [annotation.id, annotation])).values()].map((annotation) => {
    const own = local.annotations.find((item) => item.id === annotation.id);
    const peer = remote.annotations.find((item) => item.id === annotation.id);
    return own && peer ? (own.updatedAt >= peer.updatedAt ? own : peer) : annotation;
  });
  return refreshReviewTextVersion({
    ...winner,
    id: local.id,
    revision: Math.max(local.revision, remote.revision) + 1,
    inputSegments: mergedSegments,
    textVersions,
    annotations,
    workingDraft: { ...winner.workingDraft, items: mergedItems, baseRevision: Math.max(local.revision, remote.revision) },
    completedVersions,
    conflictSnapshots: uniqueById(snapshots).slice(-20),
    updatedAt: now,
  }, now);
}
import { buildReviewTextBlocks, reviewContentHash, type ReviewTextBlock } from './textBlocks';

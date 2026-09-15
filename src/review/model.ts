export type ReviewSection = 'progress' | 'problems' | 'adjustments' | 'summary';
export type ReviewStatus = 'draft' | 'completed';

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
  providerReceipt?: { operationId: string; providerLogId?: string };
}

export type InputSegment = TextInputSegment | VoiceInputSegment;

export interface ReviewItem {
  itemId: string;
  section: ReviewSection;
  text: string;
  createdBy: 'ai' | 'user';
  userEdited: boolean;
  locked: boolean;
  sourceSegmentIds: string[];
  updatedAt: string;
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

const newId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;

function cloneVersion(version: ReviewVersion, kind: ReviewVersion['kind'], completedAt?: string): ReviewVersion {
  return {
    ...version,
    id: newId('review-version'),
    kind,
    items: version.items.map((item) => ({ ...item, sourceSegmentIds: [...item.sourceSegmentIds] })),
    completedAt,
  };
}

export function createDailyReview(reviewDate: string, now = new Date().toISOString()): DailyReview {
  const workingDraftId = newId('review-version');
  return {
    id: newId('review'),
    reviewDate,
    timezoneAtCreation: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    schemaVersion: 1,
    revision: 0,
    reviewStatus: 'draft',
    workingDraftVersionId: workingDraftId,
    inputSegments: [],
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
  return {
    ...change(review, now, (draft) => ({ ...draft })),
    inputSegments: [...review.inputSegments, segment],
  };
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
  return {
    ...change(review, now, (draft) => ({ ...draft, items: draft.items.filter((item) => item.locked) })),
    inputSegments: review.inputSegments.map((segment) => segment.id === segmentId && segment.type === 'voice'
      ? { ...segment, transcriptionState: 'transcribed' as const, asrText: text, providerReceipt }
      : segment),
  };
}

export function updateVoiceTranscript(review: DailyReview, segmentId: string, text: string, now = new Date().toISOString()): DailyReview {
  const correctedText = text.trim();
  const voice = review.inputSegments.find((segment): segment is VoiceInputSegment => segment.id === segmentId && segment.type === 'voice');
  if (!voice || !correctedText || voice.correctedText === correctedText) return review;
  return {
    ...change(review, now, (draft) => ({ ...draft, items: draft.items.filter((item) => item.locked) })),
    inputSegments: review.inputSegments.map((segment) => segment.id === segmentId && segment.type === 'voice' ? { ...segment, correctedText } : segment),
  };
}

export function effectiveSegmentText(segment: InputSegment): string | null {
  if (segment.type === 'text') return segment.text;
  return segment.correctedText ?? segment.asrText ?? null;
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
  return {
    ...change(review, now, (draft) => ({ ...draft, items: draft.items.filter((item) => item.locked) })),
    inputSegments: review.inputSegments.map((item) => item.id === segmentId ? { ...item, text: trimmed } : item),
  };
}

export function withdrawLastInputSegment(review: DailyReview, now = new Date().toISOString()): DailyReview {
  const removed = review.inputSegments.at(-1);
  if (!removed) return review;
  return {
    ...change(review, now, (draft) => ({ ...draft, items: draft.items.filter((item) => item.locked || !item.sourceSegmentIds.includes(removed.id)) })),
    inputSegments: review.inputSegments.slice(0, -1),
  };
}

export function updateReviewItem(review: DailyReview, itemId: string, text: string, now = new Date().toISOString()): DailyReview {
  const trimmed = text.trim();
  if (!trimmed) return review;
  return change(review, now, (draft) => ({
    ...draft,
    items: draft.items.map((item) => item.itemId === itemId
      ? { ...item, text: trimmed, createdBy: 'user', userEdited: true, locked: true, updatedAt: now }
      : item),
  }));
}

export function removeReviewItem(review: DailyReview, itemId: string, now = new Date().toISOString()): DailyReview {
  if (!review.workingDraft.items.some((item) => item.itemId === itemId)) return review;
  return change(review, now, (draft) => ({ ...draft, items: draft.items.filter((item) => item.itemId !== itemId) }));
}

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
  return change(review, now, (draft) => ({ ...draft, items: [...draft.items.filter((item) => item.locked), ...nextItems] }));
}

export function restoreCompletedVersion(review: DailyReview, versionId: string, now = new Date().toISOString()): DailyReview {
  const snapshot = review.completedVersions.find((version) => version.id === versionId);
  if (!snapshot) return review;
  return change(review, now, (draft) => ({
    ...draft,
    items: snapshot.items.map((item) => ({ ...item, sourceSegmentIds: [...item.sourceSegmentIds], updatedAt: now })),
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
  const overlappingEdits = [...localItems].filter(([id, item]) => {
    const peer = remoteItems.get(id);
    return peer && peer.text !== item.text && item.userEdited && peer.userEdited;
  }).map(([id]) => id);
  const mergedSegments = uniqueById([...remote.inputSegments, ...local.inputSegments])
    .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt) || left.id.localeCompare(right.id))
    .map((segment, index) => ({ ...segment, clientSeq: index + 1 }));
  const mergedItems = [...new Map([...remote.workingDraft.items, ...local.workingDraft.items].map((item) => [item.itemId, item])).values()].map((item) => {
    const peer = remoteItems.get(item.itemId);
    const own = localItems.get(item.itemId);
    return peer && own && peer.text !== own.text ? (peer.updatedAt > own.updatedAt ? peer : own) : item;
  });
  const snapshots = [...local.conflictSnapshots, ...remote.conflictSnapshots];
  if (overlappingEdits.length) snapshots.push({ id: newId('review-conflict'), createdAt: now, localItems: overlappingEdits.map((id) => ({ ...localItems.get(id)! })), remoteItems: overlappingEdits.map((id) => ({ ...remoteItems.get(id)! })), message: '两台设备修改了同一条人工编辑；已保留较新的工作稿，另一版本可从冲突快照追溯。' });
  const completedVersions = uniqueById([...remote.completedVersions, ...local.completedVersions]);
  const winner = local.updatedAt >= remote.updatedAt ? local : remote;
  return {
    ...winner,
    id: local.id,
    revision: Math.max(local.revision, remote.revision) + 1,
    inputSegments: mergedSegments,
    workingDraft: { ...winner.workingDraft, items: mergedItems, baseRevision: Math.max(local.revision, remote.revision) },
    completedVersions,
    conflictSnapshots: uniqueById(snapshots).slice(-20),
    updatedAt: now,
  };
}

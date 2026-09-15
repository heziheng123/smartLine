export type ReviewSection = 'progress' | 'problems' | 'adjustments' | 'summary';
export type ReviewStatus = 'draft' | 'completed';

export interface TextInputSegment {
  id: string;
  type: 'text';
  clientSeq: number;
  capturedAt: string;
  text: string;
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

export interface DailyReview {
  id: string;
  reviewDate: string;
  timezoneAtCreation: string;
  schemaVersion: 1;
  revision: number;
  reviewStatus: ReviewStatus;
  activeCompletedVersionId?: string;
  workingDraftVersionId: string;
  inputSegments: TextInputSegment[];
  workingDraft: ReviewVersion;
  completedVersions: ReviewVersion[];
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
  const segment = review.inputSegments.find((item) => item.id === segmentId);
  if (!segment || !trimmed || segment.text === trimmed) return review;
  return {
    ...change(review, now, (draft) => ({ ...draft, items: draft.items.filter((item) => item.locked) })),
    inputSegments: review.inputSegments.map((item) => item.id === segmentId ? { ...item, text: trimmed } : item),
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

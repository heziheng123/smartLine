export type ReviewBlockAnalysisState = 'never' | 'analyzed' | 'changed' | 'stale';

export interface ReviewTextBlock {
  blockId: string;
  sourceSegmentId: string;
  textVersionId: string;
  text: string;
  startInDocument: number;
  endInDocument: number;
  contentHash: string;
  ordinal: number;
  analysisState: ReviewBlockAnalysisState;
  lastAnalyzedHash?: string;
  lastAnalyzedPromptVersion?: string;
  lastAnalyzedSchemaVersion?: string;
  lastAnalyzedModelVersion?: string;
  analyzedAt?: string;
}

export interface BlockSourceSegment { id: string; text: string; startInDocument: number }

export type AnnotationRejectedReason = 'BLOCK_NOT_FOUND' | 'BLOCK_NOT_TARGET' | 'QUOTE_NOT_FOUND' | 'QUOTE_AMBIGUOUS' | 'TEXT_VERSION_MISMATCH';
export type LocatedBlockQuote = { block: ReviewTextBlock; start: number; end: number };
export interface BlockAnalysisMetadata { promptVersion: string; schemaVersion: string; modelVersion: string; analyzedAt: string }
export interface ReviewBlockAnalysisPlan { targetBlocks: ReviewTextBlock[]; contextBlocks: ReviewTextBlock[] }

export function normalizeBlockText(text: string): string {
  return text.replace(/\r\n?/g, '\n').normalize('NFC');
}

/** Stable non-cryptographic fingerprint; no dependency or async WebCrypto needed for change detection. */
export function reviewContentHash(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const character of normalizeBlockText(text)) {
    hash ^= BigInt(character.codePointAt(0)!);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return `fnv1a64-${hash.toString(16).padStart(16, '0')}`;
}

function splitSegment(segment: BlockSourceSegment): Array<Omit<ReviewTextBlock, 'blockId' | 'textVersionId' | 'analysisState'>> {
  const blocks: Array<Omit<ReviewTextBlock, 'blockId' | 'textVersionId' | 'analysisState'>> = [];
  let start = 0;
  const emit = (rawEnd: number) => {
    let localStart = start; let localEnd = rawEnd;
    while (localStart < localEnd && /\s/u.test(segment.text[localStart]!)) localStart += 1;
    while (localEnd > localStart && /\s/u.test(segment.text[localEnd - 1]!)) localEnd -= 1;
    if (localEnd > localStart) {
      const text = segment.text.slice(localStart, localEnd);
      blocks.push({ sourceSegmentId: segment.id, text, startInDocument: segment.startInDocument + localStart, endInDocument: segment.startInDocument + localEnd, contentHash: reviewContentHash(text), ordinal: blocks.length });
    }
    start = rawEnd;
  };
  for (let index = 0; index < segment.text.length; index += 1) {
    const character = segment.text[index]!;
    if ('。！？；'.includes(character)) emit(index + 1);
    else if (character === '\n') emit(index);
  }
  emit(segment.text.length);
  return blocks;
}

const initialBlockId = (segmentId: string, contentHash: string, occurrence: number) => `${segmentId}:block:${contentHash.slice(-12)}:${occurrence}`;

export function buildReviewTextBlocks(segments: BlockSourceSegment[], textVersionId: string, previousBlocks: ReviewTextBlock[] = []): ReviewTextBlock[] {
  const result: ReviewTextBlock[] = [];
  for (const segment of segments) {
    const drafts = splitSegment(segment);
    const previous = previousBlocks.filter((block) => block.sourceSegmentId === segment.id);
    const used = new Set<string>();
    const exact = drafts.map((draft) => {
      const match = previous.find((block) => !used.has(block.blockId) && block.contentHash === draft.contentHash && block.text === draft.text);
      if (match) used.add(match.blockId);
      return match;
    });
    const remainingPrevious = previous.filter((block) => !used.has(block.blockId));
    const occurrences = new Map<string, number>();
    drafts.forEach((draft, index) => {
      const prior = exact[index] ?? remainingPrevious.shift();
      const occurrence = occurrences.get(draft.contentHash) ?? 0;
      occurrences.set(draft.contentHash, occurrence + 1);
      const blockId = prior?.blockId ?? initialBlockId(segment.id, draft.contentHash, occurrence);
      const unchanged = prior?.contentHash === draft.contentHash;
      result.push({
        ...draft,
        blockId,
        textVersionId,
        ordinal: index,
        analysisState: unchanged && prior?.lastAnalyzedHash === draft.contentHash ? 'analyzed' : prior?.lastAnalyzedHash ? 'changed' : 'never',
        ...(prior?.lastAnalyzedHash ? { lastAnalyzedHash: prior.lastAnalyzedHash } : {}),
        ...(prior?.lastAnalyzedPromptVersion ? { lastAnalyzedPromptVersion: prior.lastAnalyzedPromptVersion } : {}),
        ...(prior?.lastAnalyzedSchemaVersion ? { lastAnalyzedSchemaVersion: prior.lastAnalyzedSchemaVersion } : {}),
        ...(prior?.lastAnalyzedModelVersion ? { lastAnalyzedModelVersion: prior.lastAnalyzedModelVersion } : {}),
        ...(prior?.analyzedAt ? { analyzedAt: prior.analyzedAt } : {}),
      });
    });
  }
  return result.sort((left, right) => left.startInDocument - right.startInDocument);
}

export function locateQuoteInBlock(blocks: ReviewTextBlock[], blockId: string, quote: string, textVersionId: string): LocatedBlockQuote | AnnotationRejectedReason {
  const block = blocks.find((item) => item.blockId === blockId);
  if (!block) return 'BLOCK_NOT_FOUND';
  if (block.textVersionId !== textVersionId) return 'TEXT_VERSION_MISMATCH';
  const localStart = block.text.indexOf(quote);
  if (localStart < 0) return 'QUOTE_NOT_FOUND';
  if (localStart !== block.text.lastIndexOf(quote)) return 'QUOTE_AMBIGUOUS';
  return { block, start: block.startInDocument + localStart, end: block.startInDocument + localStart + quote.length };
}

export function markReviewBlocksAnalyzed(blocks: ReviewTextBlock[], targetBlockIds: Iterable<string>, metadata: BlockAnalysisMetadata): ReviewTextBlock[] {
  const targets = new Set(targetBlockIds);
  return blocks.map((block) => targets.has(block.blockId) ? { ...block, analysisState: 'analyzed', lastAnalyzedHash: block.contentHash, lastAnalyzedPromptVersion: metadata.promptVersion, lastAnalyzedSchemaVersion: metadata.schemaVersion, lastAnalyzedModelVersion: metadata.modelVersion, analyzedAt: metadata.analyzedAt } : block);
}

export function planReviewBlockAnalysis(blocks: ReviewTextBlock[], force = false): ReviewBlockAnalysisPlan {
  const targetBlocks = blocks.filter((block) => force || block.analysisState !== 'analyzed' || block.lastAnalyzedHash !== block.contentHash);
  const targetIds = new Set(targetBlocks.map((block) => block.blockId));
  const contextIds = new Set<string>();
  for (const target of targetBlocks) {
    const index = blocks.findIndex((block) => block.blockId === target.blockId);
    const before = blocks[index - 1]; const after = blocks[index + 1];
    if (before && !targetIds.has(before.blockId)) contextIds.add(before.blockId);
    if (after && !targetIds.has(after.blockId)) contextIds.add(after.blockId);
  }
  return { targetBlocks, contextBlocks: blocks.filter((block) => contextIds.has(block.blockId)) };
}

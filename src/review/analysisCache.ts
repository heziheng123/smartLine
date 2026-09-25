export interface AnalysisCacheKeyInput {
  reviewId: string;
  textVersionId: string;
  targetHashes: string[];
  promptVersion: string;
  schemaVersion: string;
  modelVersion: string;
}

export interface CachedAnalysis {
  key: string;
  revision: number;
  textVersionId: string;
  annotations: Array<{ blockId: string; type: string; start: number; end: number }>;
  analyzedAt: string;
}

export function buildAnalysisCacheKey(input: AnalysisCacheKeyInput): string {
  const hashes = [...input.targetHashes].sort().join('|');
  return [input.reviewId, input.textVersionId, hashes, input.promptVersion, input.schemaVersion, input.modelVersion].join('::');
}

export function shouldReuseCache(args: {
  cached: CachedAnalysis | null | undefined;
  currentKey: string;
  currentRevision: number;
  currentTextVersionId: string;
  locked: boolean;
  forceReanalysis: boolean;
}): boolean {
  if (!args.cached || args.locked || args.forceReanalysis) return false;
  return args.cached.key === args.currentKey
    && args.cached.revision === args.currentRevision
    && args.cached.textVersionId === args.currentTextVersionId;
}

export function shouldAutoRerunOnVersionChange(persistedPromptVersion: string | undefined, currentPromptVersion: string, userRequestedReanalysis: boolean): boolean {
  if (persistedPromptVersion === currentPromptVersion) return true;
  return userRequestedReanalysis;
}

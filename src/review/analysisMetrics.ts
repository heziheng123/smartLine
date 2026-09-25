import type { AnnotationRejectedReason } from './textBlocks';

export interface ReviewAnalysisInstrumentation {
  reviewBlockCount: number;
  targetBlockCount: number;
  contextBlockCount: number;
  aiRequestCount: number;
  aiLatencyMs: number;
  cacheHit: boolean;
  rejectedAnnotationCount: number;
  rejectedReasons: Partial<Record<AnnotationRejectedReason, number>>;
}

export function createInstrumentation(init: Partial<ReviewAnalysisInstrumentation> = {}): ReviewAnalysisInstrumentation {
  return {
    reviewBlockCount: 0, targetBlockCount: 0, contextBlockCount: 0,
    aiRequestCount: 0, aiLatencyMs: 0, cacheHit: false,
    rejectedAnnotationCount: 0, rejectedReasons: {}, ...init,
  };
}

export function recordRejections(metrics: ReviewAnalysisInstrumentation, reasons: AnnotationRejectedReason[]): ReviewAnalysisInstrumentation {
  const rejectedReasons = { ...metrics.rejectedReasons };
  for (const r of reasons) rejectedReasons[r] = (rejectedReasons[r] ?? 0) + 1;
  return { ...metrics, rejectedAnnotationCount: metrics.rejectedAnnotationCount + reasons.length, rejectedReasons };
}

export function summarizeIncremental(args: { beforeTargetCount: number; afterTargetCount: number; totalBlocks: number }): string {
  return `blocks=${args.totalBlocks} target: ${args.beforeTargetCount} -> ${args.afterTargetCount}`;
}

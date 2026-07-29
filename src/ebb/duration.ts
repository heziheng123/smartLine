import type { ComplexityLevel, ReviewTask } from './types';

export const REVIEW_DURATION_OPTIONS = [5, 10, 15, 20, 30, 45, 60] as const;

export const DEFAULT_REVIEW_BASE_DURATION: Record<ComplexityLevel, number> = {
  easy: 10,
  normal: 15,
  hard: 20,
};

export function normalizeEstimatedMinutes(value: unknown, fallback = 30): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(5, Math.ceil(parsed / 5) * 5);
}

/** Invalid optional values mean “use automatic duration”, not a custom 30m. */
export function normalizeOptionalEstimatedMinutes(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.max(5, Math.ceil(parsed / 5) * 5);
}

export function getDefaultReviewBaseDuration(complexity?: ComplexityLevel): number {
  return DEFAULT_REVIEW_BASE_DURATION[complexity ?? 'normal'];
}

export function getReviewBaseDuration(task: Pick<ReviewTask, 'complexity' | 'baseDurationMinutes'>): number {
  return normalizeEstimatedMinutes(
    task.baseDurationMinutes,
    getDefaultReviewBaseDuration(task.complexity),
  );
}

export function getReviewRoundDuration(
  task: Pick<ReviewTask, 'complexity' | 'baseDurationMinutes' | 'durationOverrideMinutes' | 'roundOrder'>,
  round = task.roundOrder ?? 1,
): number {
  if (task.durationOverrideMinutes !== undefined) {
    return normalizeEstimatedMinutes(task.durationOverrideMinutes);
  }
  const base = getReviewBaseDuration(task);
  const multiplier = round <= 1 ? 1 : round <= 3 ? 0.8 : 0.6;
  return normalizeEstimatedMinutes(base * multiplier, base);
}

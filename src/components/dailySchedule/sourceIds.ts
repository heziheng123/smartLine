// ============================================================
// Daily schedule source identifiers
// ============================================================

/** Builds the stable identifier for a smart-task block scheduled from a project. */
export function getProjectBlockSourceId(taskId: string, blockId: string): string {
  return `project-blk:${taskId}::${blockId}`;
}

/** Builds the stable identifier for a review task scheduled from Ebbinghaus. */
export function getReviewSourceId(reviewTaskId: string): string {
  return `review-${reviewTaskId}`;
}


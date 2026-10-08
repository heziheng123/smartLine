import type { ReviewTask } from './types';

/** Find linked leaves whose effective review plan opened or closed. */
export function getReviewActivationChanges(
  before: readonly ReviewTask[],
  after: readonly ReviewTask[],
): Array<{ nodeId: string; active: boolean }> {
  const activeIds = (tasks: readonly ReviewTask[]) => new Set(
    tasks.filter((task) => task.graphNodeId && !task.isArchived).map((task) => task.graphNodeId!),
  );
  const previous = activeIds(before);
  const current = activeIds(after);
  const allIds = (tasks: readonly ReviewTask[]) => new Set(
    tasks.flatMap((task) => task.graphNodeId ? [task.graphNodeId] : []),
  );
  const beforeAll = allIds(before);
  const afterAll = allIds(after);
  const manualIds = (tasks: readonly ReviewTask[]) => new Set(
    tasks.filter((task) => task.graphNodeId && task.isArchived && task.archivedReason === 'manual')
      .map((task) => task.graphNodeId!),
  );
  const beforeManual = manualIds(before);
  const afterManual = manualIds(after);
  return [...new Set([...beforeAll, ...afterAll])]
    .filter((nodeId) => previous.has(nodeId) !== current.has(nodeId)
      || (!current.has(nodeId) && (
        (beforeAll.has(nodeId) && !afterAll.has(nodeId))
        || (beforeManual.has(nodeId) && !afterManual.has(nodeId))
      )))
    .map((nodeId) => ({ nodeId, active: current.has(nodeId) }));
}

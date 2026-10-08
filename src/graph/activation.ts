import type { GraphNode } from './types';
import type { ReviewTask } from '@/ebb/types';

export interface NodeActivationState {
  isLeaf: boolean;
  isActivated: boolean;
  activatedLeafCount: number;
  totalLeafCount: number;
  blockingChildIds: string[];
}

/**
 * Computes activation for the visible knowledge tree.
 *
 * Leaf nodes use their persisted status, except for closed review plans.
 * Parent nodes activate only when every visible direct child is active.
 */
export function computeNodeActivationStates(
  nodes: GraphNode[],
  reviewTasks: readonly ReviewTask[] = [],
): Map<string, NodeActivationState> {
  const activeReviewIds = new Set<string>();
  const manuallyArchivedReviewIds = new Set<string>();
  for (const task of reviewTasks) {
    if (!task.graphNodeId) continue;
    if (task.isArchived && task.archivedReason === 'manual') manuallyArchivedReviewIds.add(task.graphNodeId);
    else if (!task.isArchived) activeReviewIds.add(task.graphNodeId);
  }
  const visibleNodes = nodes.filter((node) => !node.isArchived);
  const nodeById = new Map(visibleNodes.map((node) => [node.id, node]));
  const childrenByParentId = new Map<string, GraphNode[]>();

  visibleNodes.forEach((node) => {
    if (!node.parentId || !nodeById.has(node.parentId)) return;
    const children = childrenByParentId.get(node.parentId) ?? [];
    children.push(node);
    childrenByParentId.set(node.parentId, children);
  });

  const result = new Map<string, NodeActivationState>();
  const visiting = new Set<string>();

  const visit = (nodeId: string): NodeActivationState => {
    const cached = result.get(nodeId);
    if (cached) return cached;

    const node = nodeById.get(nodeId);
    if (!node || visiting.has(nodeId)) {
      return {
        isLeaf: true,
        isActivated: false,
        activatedLeafCount: 0,
        totalLeafCount: node ? 1 : 0,
        blockingChildIds: [],
      };
    }

    visiting.add(nodeId);
    const children = childrenByParentId.get(nodeId) ?? [];

    let state: NodeActivationState;
    if (children.length === 0) {
      // Old workspaces can have an activated status left behind by archiving a
      // review plan. A later explicit activation records reviewClosed=false.
      const isActivated = node.status === 'activated'
        && node.reviewClosed !== true
        && !(node.reviewClosed === undefined
          && manuallyArchivedReviewIds.has(nodeId)
          && !activeReviewIds.has(nodeId));
      state = {
        isLeaf: true,
        isActivated,
        activatedLeafCount: isActivated ? 1 : 0,
        totalLeafCount: 1,
        blockingChildIds: [],
      };
    } else {
      const childStates = children.map((child) => ({
        id: child.id,
        state: visit(child.id),
      }));
      state = {
        isLeaf: false,
        isActivated: childStates.every(({ state: childState }) => childState.isActivated),
        activatedLeafCount: childStates.reduce(
          (sum, { state: childState }) => sum + childState.activatedLeafCount,
          0,
        ),
        totalLeafCount: childStates.reduce(
          (sum, { state: childState }) => sum + childState.totalLeafCount,
          0,
        ),
        blockingChildIds: childStates
          .filter(({ state: childState }) => !childState.isActivated)
          .map(({ id }) => id),
      };
    }

    visiting.delete(nodeId);
    result.set(nodeId, state);
    return state;
  };

  visibleNodes.forEach((node) => visit(node.id));
  return result;
}

export function isLeafGraphNode(nodes: GraphNode[], nodeId: string): boolean {
  return !nodes.some((node) => !node.isArchived && node.parentId === nodeId);
}

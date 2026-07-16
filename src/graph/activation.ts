import type { GraphNode } from './types';

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
 * Leaf nodes use their persisted status. Parent nodes are activated only when
 * every non-archived direct child is effectively activated.
 */
export function computeNodeActivationStates(nodes: GraphNode[]): Map<string, NodeActivationState> {
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
      const isActivated = node.status === 'activated';
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

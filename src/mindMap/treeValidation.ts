import type { MindMapDocument, MindMapEdge } from './model';

export type MindMapTreeIssueKind = 'multiple-parents' | 'cycle';

export interface MindMapTreeIssue {
  kind: MindMapTreeIssueKind;
  edgeId: string;
}

export interface MindMapTreeValidation {
  issues: MindMapTreeIssue[];
  isValid: boolean;
}

const isTreeNodeEdge = (edge: MindMapEdge, document: MindMapDocument) => (
  edge.relationship === 'tree'
  && edge.source.type === 'node'
  && edge.target.type === 'node'
  && Boolean(document.nodes[edge.sourceId])
  && Boolean(document.nodes[edge.targetId])
);

/** Validates the rooted-forest rules used by the tree layout. */
export function validateMindMapTreeForest(document: MindMapDocument): MindMapTreeValidation {
  const issues: MindMapTreeIssue[] = [];
  const parentByNode = new Map<string, string>();
  const childrenByNode = new Map<string, string[]>();

  for (const edge of Object.values(document.edges)) {
    if (!isTreeNodeEdge(edge, document)) continue;
    if (parentByNode.has(edge.targetId)) {
      issues.push({ kind: 'multiple-parents', edgeId: edge.id });
      continue;
    }
    parentByNode.set(edge.targetId, edge.id);
    const children = childrenByNode.get(edge.sourceId) ?? [];
    children.push(edge.targetId);
    childrenByNode.set(edge.sourceId, children);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (nodeId: string) => {
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    for (const childId of childrenByNode.get(nodeId) ?? []) {
      if (visiting.has(childId)) {
        const edgeId = parentByNode.get(childId);
        if (edgeId) issues.push({ kind: 'cycle', edgeId });
        continue;
      }
      visit(childId);
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  for (const nodeId of Object.keys(document.nodes)) visit(nodeId);

  return { issues, isValid: issues.length === 0 };
}

/**
 * Keeps documents viewable when a malformed import or reconnection violates
 * rooted-forest rules: the problematic link remains visible as a reference.
 */
export function repairMindMapTreeForest(document: MindMapDocument): MindMapDocument {
  const invalidEdgeIds = new Set(validateMindMapTreeForest(document).issues.map((issue) => issue.edgeId));
  if (invalidEdgeIds.size === 0) return document;
  const now = Date.now();
  return {
    ...document,
    edges: Object.fromEntries(Object.entries(document.edges).map(([id, edge]) => [
      id,
      invalidEdgeIds.has(id) ? { ...edge, relationship: 'reference' as const, updatedAt: now } : edge,
    ])),
  };
}

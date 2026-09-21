import { createMindMapEdge, type MindMapDocument } from '../model';
import { nextMindMapBranchSide } from '../layout';
export type OutlineDropPosition = 'before' | 'inside' | 'after';

const parentId = (document: MindMapDocument, nodeId: string) => Object.values(document.edges)
  .find((edge) => edge.relationship === 'tree' && edge.targetId === nodeId)?.sourceId ?? null;

const siblingEdges = (document: MindMapDocument, sourceId: string) => Object.values(document.edges)
  .filter((edge) => edge.relationship === 'tree' && edge.sourceId === sourceId)
  .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.createdAt - right.createdAt || left.id.localeCompare(right.id));

const descendants = (document: MindMapDocument, rootId: string) => {
  const result = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (result.has(id)) continue;
    result.add(id);
    for (const edge of Object.values(document.edges)) if (edge.relationship === 'tree' && edge.sourceId === id) pending.push(edge.targetId);
  }
  return result;
};

export function moveMindMapOutlineNode(document: MindMapDocument, nodeId: string, targetId: string, position: OutlineDropPosition) {
  if (nodeId === targetId || !document.nodes[nodeId] || !document.nodes[targetId] || descendants(document, nodeId).has(targetId)) return document;
  const oldIncoming = Object.values(document.edges).find((edge) => edge.relationship === 'tree' && edge.targetId === nodeId);
  const targetParentId = parentId(document, targetId);
  const nextParentId = position === 'inside' ? targetId : targetParentId;
  const edges = { ...document.edges };
  if (oldIncoming) delete edges[oldIncoming.id];
  const zOrder = document.zOrder.filter((id) => id !== nodeId);
  let branchSide = document.nodes[nodeId].branchSide;
  if (!nextParentId) {
    const targetIndex = Math.max(0, zOrder.indexOf(targetId));
    zOrder.splice(targetIndex + (position === 'after' ? 1 : 0), 0, nodeId);
    branchSide = null;
  } else {
    const siblings = siblingEdges(document, nextParentId).filter((edge) => edge.targetId !== nodeId);
    const targetIndex = position === 'inside' ? siblings.length : siblings.findIndex((edge) => edge.targetId === targetId);
    const insertionIndex = targetIndex < 0 ? siblings.length : targetIndex + (position === 'after' ? 1 : 0);
    const movedEdge = oldIncoming
      ? { ...oldIncoming, source: { type: 'node' as const, id: nextParentId }, sourceId: nextParentId, updatedAt: Date.now() }
      : createMindMapEdge(nextParentId, nodeId, { relationship: 'tree' });
    siblings.splice(insertionIndex, 0, movedEdge);
    for (const [order, edge] of siblings.entries()) edges[edge.id] = { ...edge, order, updatedAt: Date.now() };
    if (document.settings.mode === 'mind-map' && document.mindMapRootId === nextParentId && parentId(document, nodeId) !== nextParentId) {
      branchSide = nextMindMapBranchSide(document, nextParentId);
    }
  }
  return {
    ...document,
    nodes: { ...document.nodes, [nodeId]: { ...document.nodes[nodeId], branchSide, updatedAt: Date.now() } },
    edges,
    zOrder,
  };
}

export function setMindMapOutlineCollapsed(document: MindMapDocument, collapsed: boolean) {
  const parents = new Set(Object.values(document.edges).filter((edge) => edge.relationship === 'tree').map((edge) => edge.sourceId));
  return {
    ...document,
    nodes: Object.fromEntries(Object.entries(document.nodes).map(([id, node]) => [id, {
      ...node,
      collapsed: collapsed && parents.has(id),
      updatedAt: Date.now(),
    }])),
  };
}

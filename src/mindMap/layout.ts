import type { MindMapDocument, MindMapNode } from './model';
import { repairMindMapTreeForest } from './treeValidation';

export type TreeDirection = 'left-right' | 'right-left' | 'top-bottom' | 'bottom-top';

const orderedTreeEdges = (document: MindMapDocument, sourceId?: string) => {
  const edges = Object.values(document.edges)
  .filter((edge) => edge.relationship === 'tree'
    && (sourceId === undefined || edge.sourceId === sourceId)
    && Boolean(document.nodes[edge.sourceId])
    && Boolean(document.nodes[edge.targetId]));
  return edges.some((edge) => edge.order !== undefined) ? edges.sort((left, right) => (left.order ?? 0) - (right.order ?? 0)
    || left.createdAt - right.createdAt
    || left.id.localeCompare(right.id)) : edges;
};

export function treeChildIds(document: MindMapDocument, parentId: string): string[] {
  return orderedTreeEdges(document, parentId).map((edge) => edge.targetId);
}

export function resolveMindMapRootId(document: MindMapDocument): string | null {
  if (document.mindMapRootId && document.nodes[document.mindMapRootId]) return document.mindMapRootId;
  const children = new Set(orderedTreeEdges(document).map((edge) => edge.targetId));
  return document.zOrder.find((id) => document.nodes[id] && !children.has(id))
    ?? Object.keys(document.nodes).find((id) => !children.has(id))
    ?? null;
}

export function nextMindMapBranchSide(document: MindMapDocument, rootId: string): 'left' | 'right' {
  const children = treeChildIds(document, rootId).map((id) => document.nodes[id]);
  const left = children.filter((node) => node?.branchSide === 'left').length;
  const right = children.filter((node) => node?.branchSide === 'right').length;
  return left <= right ? 'left' : 'right';
}

export function prepareMindMapMode(document: MindMapDocument, requestedRootId?: string): MindMapDocument {
  const rootId = requestedRootId && document.nodes[requestedRootId]
    ? requestedRootId
    : resolveMindMapRootId(document);
  if (!rootId) return { ...document, settings: { ...document.settings, mode: 'mind-map' }, mindMapRootId: null };
  let nodes = document.nodes;
  let left = 0;
  let right = 0;
  for (const childId of treeChildIds(document, rootId)) {
    const node = nodes[childId];
    if (!node) continue;
    const side = node.branchSide ?? (left <= right ? 'left' : 'right');
    if (side === 'left') left += 1;
    else right += 1;
    if (node.branchSide !== side) {
      if (nodes === document.nodes) nodes = { ...document.nodes };
      nodes[childId] = { ...node, branchSide: side, updatedAt: Date.now() };
    }
  }
  return { ...document, nodes, settings: { ...document.settings, mode: 'mind-map' }, mindMapRootId: rootId };
}

/** Returns the stable root of the tree containing a node without following reference edges. */
export function findMindMapTreeRoot(document: MindMapDocument, nodeId: string): string {
  const parentByChild = new Map<string, string>();
  for (const edge of orderedTreeEdges(document)) parentByChild.set(edge.targetId, edge.sourceId);
  let rootId = nodeId;
  const seen = new Set<string>();
  while (!seen.has(rootId)) {
    seen.add(rootId);
    const parentId = parentByChild.get(rootId);
    if (!parentId) return rootId;
    rootId = parentId;
  }
  return nodeId;
}

export function layoutMindMapBranch(
  document: MindMapDocument,
  rootId: string,
  direction: TreeDirection = 'left-right',
): MindMapDocument {
  const repaired = repairMindMapTreeForest(document);
  if (repaired !== document) return layoutMindMapBranch(repaired, rootId, direction);
  const root = document.nodes[rootId];
  if (!root) return document;
  const children = new Map<string, string[]>();
  for (const edge of orderedTreeEdges(document)) {
    const list = children.get(edge.sourceId) ?? [];
    list.push(edge.targetId);
    children.set(edge.sourceId, list);
  }
  const ids = new Set<string>();
  const pending = [rootId];
  while (pending.length) {
    const id = pending.pop()!;
    if (ids.has(id) || !document.nodes[id]) continue;
    ids.add(id);
    pending.push(...(children.get(id) ?? []));
  }
  if (ids.size < 2) return document;
  const branch = {
    ...document,
    nodes: Object.fromEntries([...ids].map((id) => [id, document.nodes[id]])),
    edges: Object.fromEntries(Object.entries(document.edges).filter(([, edge]) => (
      ids.has(edge.sourceId) && ids.has(edge.targetId) && edge.relationship !== 'reference'
    ))),
  };
  const laidOut = layoutMindMapTree(branch, direction);
  const laidOutRoot = laidOut.nodes[rootId];
  if (!laidOutRoot) return document;
  const offset = { x: root.x - laidOutRoot.x, y: root.y - laidOutRoot.y };
  return {
    ...document,
    nodes: {
      ...document.nodes,
      ...Object.fromEntries(Object.entries(laidOut.nodes).map(([id, node]) => [id, {
        ...node,
        x: node.x + offset.x,
        y: node.y + offset.y,
      }])),
    },
  };
}

export function layoutMindMapTree(
  document: MindMapDocument,
  direction: TreeDirection = 'left-right',
): MindMapDocument {
  const repaired = repairMindMapTreeForest(document);
  if (repaired !== document) return layoutMindMapTree(repaired, direction);
  const nodeIds = [...new Set([...document.zOrder, ...Object.keys(document.nodes)])]
    .filter((id) => Boolean(document.nodes[id]));
  if (nodeIds.length < 2) return document;
  const adjacency = new Map<string, string[]>();
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  for (const edge of orderedTreeEdges(document)) {
    const list = adjacency.get(edge.sourceId) ?? [];
    list.push(edge.targetId);
    adjacency.set(edge.sourceId, list);
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
  }

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  const visited = new Set<string>();
  const depthById = new Map<string, number>();
  const traversal: string[] = [];
  const growTree = (rootId: string) => {
    if (visited.has(rootId)) return;
    roots.push(rootId);
    const pending: Array<[string, number]> = [[rootId, 0]];
    visited.add(rootId);
    for (let index = 0; index < pending.length; index += 1) {
      const [id, depth] = pending[index];
      traversal.push(id);
      depthById.set(id, depth);
      for (const childId of adjacency.get(id) ?? []) {
        if (visited.has(childId)) continue;
        visited.add(childId);
        const list = children.get(id) ?? [];
        list.push(childId);
        children.set(id, list);
        pending.push([childId, depth + 1]);
      }
    }
  };
  nodeIds.filter((id) => indegree.get(id) === 0).forEach(growTree);
  nodeIds.forEach(growTree);

  const horizontal = direction === 'left-right' || direction === 'right-left';
  const reverse = direction === 'right-left' || direction === 'bottom-top';
  const primaryGap = 96;
  const secondaryGap = 48;

  const maximumDepth = Math.max(...depthById.values());
  const primarySizes = Array.from({ length: maximumDepth + 1 }, () => 0);
  const primaryGaps = Array.from({ length: maximumDepth + 1 }, () => primaryGap);
  for (const id of traversal) {
    const node = document.nodes[id];
    const depth = depthById.get(id) ?? 0;
    primarySizes[depth] = Math.max(primarySizes[depth], horizontal ? node.width : node.height);
  }
  for (const edge of Object.values(document.edges)) {
    if (edge.relationship !== 'tree' || !edge.label.trim()) continue;
    const targetDepth = depthById.get(edge.targetId);
    if (!targetDepth) continue;
    // The label is rendered horizontally, so reserving its estimated width is
    // the safe choice for both horizontal and vertical trees.
    primaryGaps[targetDepth] = Math.max(
      primaryGaps[targetDepth],
      Math.min(320, 32 + [...edge.label.trim()].length * 7),
    );
  }
  const primaryCenters = [0];
  for (let depth = 1; depth <= maximumDepth; depth += 1) {
    primaryCenters[depth] = primaryCenters[depth - 1]
      + primarySizes[depth - 1] / 2
      + primaryGaps[depth]
      + primarySizes[depth] / 2;
  }

  const subtreeSpans = new Map<string, number>();
  for (const id of [...traversal].reverse()) {
    const node = document.nodes[id];
    const childIds = children.get(id) ?? [];
    const childSpan = childIds.reduce((sum, childId) => sum + (subtreeSpans.get(childId) ?? 0), 0)
      + Math.max(0, childIds.length - 1) * secondaryGap;
    subtreeSpans.set(id, Math.max(horizontal ? node.height : node.width, childSpan));
  }

  const totalSpan = roots.reduce((sum, id) => sum + (subtreeSpans.get(id) ?? 0), 0)
    + Math.max(0, roots.length - 1) * secondaryGap;
  const nodes = { ...document.nodes };
  const pending: Array<{ id: string; start: number }> = [];
  let rootStart = -totalSpan / 2;
  for (const rootId of roots) {
    pending.push({ id: rootId, start: rootStart });
    rootStart += (subtreeSpans.get(rootId) ?? 0) + secondaryGap;
  }
  for (let index = 0; index < pending.length; index += 1) {
    const { id, start } = pending[index];
    const node = document.nodes[id];
    const depth = depthById.get(id) ?? 0;
    const span = subtreeSpans.get(id) ?? 0;
    const primary = primaryCenters[depth] * (reverse ? -1 : 1);
    const secondary = start + span / 2;
    if (!node.locked && node.participatesInLayout) {
      nodes[id] = {
        ...node,
        x: horizontal ? primary : secondary,
        y: horizontal ? secondary : primary,
        updatedAt: Date.now(),
      };
    }

    const childIds = children.get(id) ?? [];
    const childSpan = childIds.reduce((sum, childId) => sum + (subtreeSpans.get(childId) ?? 0), 0)
      + Math.max(0, childIds.length - 1) * secondaryGap;
    let childStart = start + (span - childSpan) / 2;
    for (const childId of childIds) {
      pending.push({ id: childId, start: childStart });
      childStart += (subtreeSpans.get(childId) ?? 0) + secondaryGap;
    }
  }
  return { ...document, nodes };
}

/** Lays the direct branches of a centre topic to both sides while preserving every subtree. */
export function layoutMindMap(document: MindMapDocument, requestedRootId?: string): MindMapDocument {
  const prepared = prepareMindMapMode(document, requestedRootId);
  const rootId = prepared.mindMapRootId;
  if (!rootId) return prepared;
  const root = prepared.nodes[rootId];
  if (!root) return prepared;
  const treeEdges = orderedTreeEdges(prepared);
  const children = new Map<string, string[]>();
  for (const edge of treeEdges) {
    const list = children.get(edge.sourceId) ?? [];
    list.push(edge.targetId);
    children.set(edge.sourceId, list);
  }
  const rootChildren = children.get(rootId) ?? [];
  const leftChildren = rootChildren.filter((id) => prepared.nodes[id]?.branchSide === 'left');
  const rightChildren = rootChildren.filter((id) => prepared.nodes[id]?.branchSide !== 'left');
  const nodes = { ...prepared.nodes };
  for (const [childIds, direction] of [[leftChildren, 'right-left'], [rightChildren, 'left-right']] as const) {
    if (!childIds.length) continue;
    const included = new Set<string>([rootId]);
    const pending = [...childIds];
    while (pending.length) {
      const id = pending.pop()!;
      if (included.has(id) || !prepared.nodes[id]) continue;
      included.add(id);
      pending.push(...(children.get(id) ?? []));
    }
    const branch: MindMapDocument = {
      ...prepared,
      nodes: Object.fromEntries([...included].map((id) => [id, id === rootId
        ? { ...prepared.nodes[id], locked: false, participatesInLayout: true }
        : prepared.nodes[id]])),
      edges: Object.fromEntries(treeEdges.filter((edge) => included.has(edge.sourceId)
        && included.has(edge.targetId)
        && (edge.sourceId !== rootId || childIds.includes(edge.targetId))).map((edge) => [edge.id, edge])),
      zOrder: prepared.zOrder.filter((id) => included.has(id)),
    };
    const laidOut = layoutMindMapTree(branch, direction);
    const laidOutRoot = laidOut.nodes[rootId];
    if (!laidOutRoot) continue;
    const offset = { x: root.x - laidOutRoot.x, y: root.y - laidOutRoot.y };
    for (const [id, node] of Object.entries(laidOut.nodes)) {
      if (id === rootId) continue;
      nodes[id] = { ...node, x: node.x + offset.x, y: node.y + offset.y };
    }
  }
  return { ...prepared, nodes };
}

export function layoutActiveMindMap(document: MindMapDocument, direction: TreeDirection = 'left-right'): MindMapDocument {
  return document.settings.mode === 'mind-map' ? layoutMindMap(document) : layoutMindMapTree(document, direction);
}

export function alignMindMapNodes(
  document: MindMapDocument,
  ids: string[],
  alignment: 'left' | 'center-x' | 'right' | 'top' | 'center-y' | 'bottom',
): MindMapDocument {
  const selected = ids.map((id) => document.nodes[id]).filter((node): node is MindMapNode => Boolean(node));
  if (selected.length < 2) return document;
  const left = Math.min(...selected.map((node) => node.x - node.width / 2));
  const right = Math.max(...selected.map((node) => node.x + node.width / 2));
  const top = Math.min(...selected.map((node) => node.y - node.height / 2));
  const bottom = Math.max(...selected.map((node) => node.y + node.height / 2));
  const nodes = { ...document.nodes };
  for (const node of selected) {
    const position = alignment === 'left'
      ? { x: left + node.width / 2 }
      : alignment === 'right'
        ? { x: right - node.width / 2 }
        : alignment === 'center-x'
          ? { x: (left + right) / 2 }
          : alignment === 'top'
            ? { y: top + node.height / 2 }
            : alignment === 'bottom'
              ? { y: bottom - node.height / 2 }
              : { y: (top + bottom) / 2 };
    nodes[node.id] = { ...node, ...position, updatedAt: Date.now() };
  }
  return { ...document, nodes };
}

export function distributeMindMapNodes(
  document: MindMapDocument,
  ids: string[],
  axis: 'horizontal' | 'vertical',
): MindMapDocument {
  const selected = ids.map((id) => document.nodes[id]).filter((node): node is MindMapNode => Boolean(node));
  if (selected.length < 3) return document;
  const sorted = [...selected].sort((a, b) => axis === 'horizontal' ? a.x - b.x : a.y - b.y);
  const start = axis === 'horizontal' ? sorted[0].x : sorted[0].y;
  const end = axis === 'horizontal' ? sorted[sorted.length - 1].x : sorted[sorted.length - 1].y;
  const step = (end - start) / (sorted.length - 1);
  const nodes = { ...document.nodes };
  sorted.forEach((node, index) => {
    nodes[node.id] = {
      ...node,
      ...(axis === 'horizontal' ? { x: start + step * index } : { y: start + step * index }),
      updatedAt: Date.now(),
    };
  });
  return { ...document, nodes };
}

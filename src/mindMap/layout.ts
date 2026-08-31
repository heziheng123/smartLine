import type { MindMapDocument, MindMapNode } from './model';

export type TreeDirection = 'left-right' | 'right-left' | 'top-bottom' | 'bottom-top';

export function layoutMindMapBranch(
  document: MindMapDocument,
  rootId: string,
  direction: TreeDirection = 'left-right',
): MindMapDocument {
  const root = document.nodes[rootId];
  if (!root) return document;
  const children = new Map<string, string[]>();
  for (const edge of Object.values(document.edges)) {
    if (edge.relationship === 'reference') continue;
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
  const nodeIds = [...new Set([...document.zOrder, ...Object.keys(document.nodes)])]
    .filter((id) => Boolean(document.nodes[id]));
  if (nodeIds.length < 2) return document;
  const adjacency = new Map<string, string[]>();
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  for (const edge of Object.values(document.edges)) {
    if (!document.nodes[edge.sourceId] || !document.nodes[edge.targetId] || edge.relationship === 'reference') continue;
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
  const secondaryGap = 36;

  const maximumDepth = Math.max(...depthById.values());
  const primarySizes = Array.from({ length: maximumDepth + 1 }, () => 0);
  for (const id of traversal) {
    const node = document.nodes[id];
    const depth = depthById.get(id) ?? 0;
    primarySizes[depth] = Math.max(primarySizes[depth], horizontal ? node.width : node.height);
  }
  const primaryCenters = [0];
  for (let depth = 1; depth <= maximumDepth; depth += 1) {
    primaryCenters[depth] = primaryCenters[depth - 1]
      + primarySizes[depth - 1] / 2
      + primaryGap
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
    nodes[id] = {
      ...node,
      x: horizontal ? primary : secondary,
      y: horizontal ? secondary : primary,
      updatedAt: Date.now(),
    };

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

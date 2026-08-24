import type { MindMapDocument, MindMapNode } from './model';

export type TreeDirection = 'left-right' | 'right-left' | 'top-bottom' | 'bottom-top';

export function layoutMindMapTree(
  document: MindMapDocument,
  direction: TreeDirection = 'left-right',
): MindMapDocument {
  const nodeIds = Object.keys(document.nodes);
  if (nodeIds.length < 2) return document;
  const children = new Map<string, string[]>();
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  for (const edge of Object.values(document.edges)) {
    if (!document.nodes[edge.sourceId] || !document.nodes[edge.targetId]) continue;
    const list = children.get(edge.sourceId) ?? [];
    list.push(edge.targetId);
    children.set(edge.sourceId, list);
    indegree.set(edge.targetId, (indegree.get(edge.targetId) ?? 0) + 1);
  }
  const roots = nodeIds.filter((id) => indegree.get(id) === 0);
  if (roots.length === 0) roots.push(nodeIds[0]);
  const levels: string[][] = [];
  const visited = new Set<string>();
  let queue = [...roots];
  while (queue.length) {
    const level = queue.filter((id) => !visited.has(id));
    if (level.length === 0) break;
    levels.push(level);
    const next: string[] = [];
    for (const id of level) {
      visited.add(id);
      for (const childId of children.get(id) ?? []) {
        if (!visited.has(childId)) next.push(childId);
      }
    }
    queue = next;
  }
  for (const id of nodeIds) {
    if (!visited.has(id)) levels.push([id]);
  }

  const horizontal = direction === 'left-right' || direction === 'right-left';
  const reverse = direction === 'right-left' || direction === 'bottom-top';
  const primaryGap = 96;
  const secondaryGap = 36;
  const levelOffsets: number[] = [];
  let primary = 0;
  for (const level of levels) {
    const maximum = Math.max(...level.map((id) => {
      const node = document.nodes[id];
      return horizontal ? node.width : node.height;
    }));
    levelOffsets.push(primary + maximum / 2);
    primary += maximum + primaryGap;
  }
  const maximumPrimary = primary - primaryGap;
  const nodes = { ...document.nodes };
  levels.forEach((level, levelIndex) => {
    const secondarySizes = level.map((id) => {
      const node = document.nodes[id];
      return horizontal ? node.height : node.width;
    });
    const totalSecondary = secondarySizes.reduce((sum, value) => sum + value, 0)
      + Math.max(0, level.length - 1) * secondaryGap;
    let secondary = -totalSecondary / 2;
    level.forEach((id, index) => {
      const node = document.nodes[id];
      const secondarySize = secondarySizes[index];
      const primaryPosition = reverse
        ? maximumPrimary - levelOffsets[levelIndex]
        : levelOffsets[levelIndex];
      const secondaryPosition = secondary + secondarySize / 2;
      secondary += secondarySize + secondaryGap;
      nodes[id] = {
        ...node,
        x: horizontal ? primaryPosition : secondaryPosition,
        y: horizontal ? secondaryPosition : primaryPosition,
        updatedAt: Date.now(),
      };
    });
  });
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

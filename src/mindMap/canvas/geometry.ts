import type { MindMapDocument, MindMapEdge, MindMapNode, ViewportState } from '../model';

export interface Point {
  x: number;
  y: number;
}

export interface Rect extends Point {
  width: number;
  height: number;
}

export const worldToView = (point: Point, camera: ViewportState): Point => ({
  x: point.x * camera.scale + camera.x,
  y: point.y * camera.scale + camera.y,
});

export const viewToWorld = (point: Point, camera: ViewportState): Point => ({
  x: (point.x - camera.x) / camera.scale,
  y: (point.y - camera.y) / camera.scale,
});

export function zoomCameraAt(
  camera: ViewportState,
  viewPoint: Point,
  requestedScale: number,
): ViewportState {
  const scale = Math.min(8, Math.max(0.05, requestedScale));
  const worldPoint = viewToWorld(viewPoint, camera);
  return {
    x: viewPoint.x - worldPoint.x * scale,
    y: viewPoint.y - worldPoint.y * scale,
    scale,
  };
}

export const nodeRect = (node: MindMapNode): Rect => {
  const radians = node.rotation * Math.PI / 180;
  const width = Math.abs(Math.cos(radians)) * node.width + Math.abs(Math.sin(radians)) * node.height;
  const height = Math.abs(Math.sin(radians)) * node.width + Math.abs(Math.cos(radians)) * node.height;
  return { x: node.x - width / 2, y: node.y - height / 2, width, height };
};

export const pointInRect = (point: Point, rect: Rect) =>
  point.x >= rect.x
  && point.x <= rect.x + rect.width
  && point.y >= rect.y
  && point.y <= rect.y + rect.height;

export const rectContainsRect = (outer: Rect, inner: Rect) =>
  inner.x >= outer.x
  && inner.y >= outer.y
  && inner.x + inner.width <= outer.x + outer.width
  && inner.y + inner.height <= outer.y + outer.height;

export const rectIntersectsRect = (a: Rect, b: Rect) =>
  a.x <= b.x + b.width
  && a.x + a.width >= b.x
  && a.y <= b.y + b.height
  && a.y + a.height >= b.y;

export function edgeRenderNodes(document: MindMapDocument): Record<string, MindMapNode> {
  const nodes = { ...document.nodes };
  for (const node of Object.values(nodes)) {
    const section = node.parentSectionId ? document.sections[node.parentSectionId] : null;
    if (!section?.collapsed) continue;
    nodes[node.id] = {
      ...node,
      x: section.x,
      y: section.y - section.height / 2 + 21,
      width: section.width,
      height: 42,
      rotation: 0,
    };
  }
  return nodes;
}

export function edgeIsHiddenInsideCollapsedSection(edge: MindMapEdge, document: MindMapDocument): boolean {
  const sourceSectionId = document.nodes[edge.sourceId]?.parentSectionId;
  return Boolean(sourceSectionId
    && sourceSectionId === document.nodes[edge.targetId]?.parentSectionId
    && document.sections[sourceSectionId]?.collapsed);
}

export function resolveNodeSectionId(document: MindMapDocument, node: MindMapNode): string | null {
  const candidates = Object.values(document.sections)
    .filter((section) => !section.collapsed && pointInRect({ x: node.x, y: node.y }, {
      x: section.x - section.width / 2,
      y: section.y - section.height / 2,
      width: section.width,
      height: section.height,
    }))
    .sort((a, b) => {
      if (a.id === node.parentSectionId) return -1;
      if (b.id === node.parentSectionId) return 1;
      return a.width * a.height - b.width * b.height;
    });
  return candidates[0]?.id ?? null;
}

export function normalizedRect(start: Point, end: Point): Rect {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
}

export function visibleWorldRect(size: { width: number; height: number }, camera: ViewportState): Rect {
  const topLeft = viewToWorld({ x: 0, y: 0 }, camera);
  const bottomRight = viewToWorld({ x: size.width, y: size.height }, camera);
  return normalizedRect(topLeft, bottomRight);
}

export function hitNode(
  point: Point,
  nodes: Record<string, MindMapNode>,
  zOrder: string[],
): MindMapNode | null {
  for (let index = zOrder.length - 1; index >= 0; index -= 1) {
    const node = nodes[zOrder[index]];
    if (!node) continue;
    const radians = -node.rotation * Math.PI / 180;
    const dx = point.x - node.x;
    const dy = point.y - node.y;
    const local = {
      x: node.x + dx * Math.cos(radians) - dy * Math.sin(radians),
      y: node.y + dx * Math.sin(radians) + dy * Math.cos(radians),
    };
    if (pointInRect(local, { x: node.x - node.width / 2, y: node.y - node.height / 2, width: node.width, height: node.height })) return node;
  }
  return null;
}

export function fitNodes(
  nodes: MindMapNode[],
  size: { width: number; height: number },
  padding = 72,
): ViewportState | null {
  return fitRects(nodes.map(nodeRect), size, padding);
}

export function fitMindMapDocument(
  document: MindMapDocument,
  size: { width: number; height: number },
  padding = 72,
): ViewportState | null {
  const rects = Object.values(document.nodes)
    .filter((node) => !node.parentSectionId || !document.sections[node.parentSectionId]?.collapsed)
    .map(nodeRect);
  for (const section of Object.values(document.sections)) {
    rects.push({
      x: section.x - section.width / 2,
      y: section.y - section.height / 2,
      width: section.width,
      height: section.collapsed ? 42 : section.height,
    });
  }
  return fitRects(rects, size, padding);
}

function fitRects(
  rects: Rect[],
  size: { width: number; height: number },
  padding: number,
): ViewportState | null {
  if (rects.length === 0 || size.width <= 0 || size.height <= 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  const width = Math.max(1, right - left);
  const height = Math.max(1, bottom - top);
  const scale = Math.min(
    1.5,
    Math.max(0.05, Math.min((size.width - padding * 2) / width, (size.height - padding * 2) / height)),
  );
  return {
    x: size.width / 2 - (left + width / 2) * scale,
    y: size.height / 2 - (top + height / 2) * scale,
    scale,
  };
}

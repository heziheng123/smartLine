export type EdgeSide = 'top' | 'right' | 'bottom' | 'left';
export type EdgePoint = { x: number; y: number };
export type EdgeRect = { x: number; y: number; width: number; height: number };
export type EdgeRouteKind = 'hierarchy' | 'relation';
export type HierarchyDirection = 'left-right' | 'right-left' | 'top-bottom' | 'bottom-top';

export interface EdgeRoute {
  sourceSide: EdgeSide;
  targetSide: EdgeSide;
  start: EdgePoint;
  control1: EdgePoint;
  control2: EdgePoint;
  end: EdgePoint;
}

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const center = (rect: EdgeRect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });

export const oppositeSide = (side: EdgeSide): EdgeSide => ({ top: 'bottom', right: 'left', bottom: 'top', left: 'right' } as const)[side];

export function resolveEdgeSides(source: EdgeRect, target: EdgeRect): [EdgeSide, EdgeSide] {
  const sourceCenter = center(source);
  const targetCenter = center(target);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const horizontalScore = Math.abs(dx) / Math.max(1, (source.width + target.width) / 2);
  const verticalScore = Math.abs(dy) / Math.max(1, (source.height + target.height) / 2);
  if (horizontalScore >= verticalScore) return dx >= 0 ? ['right', 'left'] : ['left', 'right'];
  return dy >= 0 ? ['bottom', 'top'] : ['top', 'bottom'];
}

export function resolveAnchorPoint(rect: EdgeRect, side: EdgeSide, targetCenter: EdgePoint, cornerPadding = 10): EdgePoint {
  const left = rect.x;
  const right = rect.x + rect.width;
  const top = rect.y;
  const bottom = rect.y + rect.height;
  if (side === 'right' || side === 'left') {
    return { x: side === 'right' ? right : left, y: clamp(targetCenter.y, top + cornerPadding, bottom - cornerPadding) };
  }
  return { x: clamp(targetCenter.x, left + cornerPadding, right - cornerPadding), y: side === 'bottom' ? bottom : top };
}

const normal = (side: EdgeSide): EdgePoint => ({ top: { x: 0, y: -1 }, right: { x: 1, y: 0 }, bottom: { x: 0, y: 1 }, left: { x: -1, y: 0 } })[side];

export function buildEdgeRoute(
  source: EdgeRect,
  target: EdgeRect,
  options: { kind: EdgeRouteKind; hierarchyDirection?: HierarchyDirection },
): EdgeRoute {
  const sourceCenter = center(source);
  const targetCenter = center(target);
  const [sourceSide, targetSide] = options.kind === 'hierarchy'
    ? ({
        'left-right': ['right', 'left'],
        'right-left': ['left', 'right'],
        'top-bottom': ['bottom', 'top'],
        'bottom-top': ['top', 'bottom'],
      } as const)[options.hierarchyDirection ?? 'left-right']
    : resolveEdgeSides(source, target);
  const start = resolveAnchorPoint(source, sourceSide, targetCenter);
  const end = resolveAnchorPoint(target, targetSide, sourceCenter);
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const handle = clamp(distance * 0.35, 32, 140);
  const startNormal = normal(sourceSide);
  const endNormal = normal(targetSide);
  return {
    sourceSide,
    targetSide,
    start,
    control1: { x: start.x + startNormal.x * handle, y: start.y + startNormal.y * handle },
    control2: { x: end.x + endNormal.x * handle, y: end.y + endNormal.y * handle },
    end,
  };
}

export function pointOnRoute(route: EdgeRoute, t: number): EdgePoint {
  const u = 1 - t;
  return {
    x: u ** 3 * route.start.x + 3 * u ** 2 * t * route.control1.x + 3 * u * t ** 2 * route.control2.x + t ** 3 * route.end.x,
    y: u ** 3 * route.start.y + 3 * u ** 2 * t * route.control1.y + 3 * u * t ** 2 * route.control2.y + t ** 3 * route.end.y,
  };
}

export const routeTargetTangent = (route: EdgeRoute): EdgePoint => ({ x: route.end.x - route.control2.x, y: route.end.y - route.control2.y });

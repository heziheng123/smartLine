import type { MindMapBoundaryShape, MindMapNode } from '../model';

export function traceMindMapBoundary(
  context: CanvasRenderingContext2D,
  shape: MindMapBoundaryShape,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath();
  if (shape === 'bracket') {
    const arm = Math.min(width * 0.12, 28);
    context.moveTo(x + arm, y);
    context.lineTo(x, y);
    context.lineTo(x, y + height);
    context.lineTo(x + arm, y + height);
    context.moveTo(x + width - arm, y);
    context.lineTo(x + width, y);
    context.lineTo(x + width, y + height);
    context.lineTo(x + width - arm, y + height);
    return;
  }
  if (shape === 'cloud') {
    context.moveTo(x + width * 0.18, y + height * 0.2);
    context.bezierCurveTo(x + width * 0.22, y - height * 0.02, x + width * 0.4, y - height * 0.02, x + width * 0.44, y + height * 0.13);
    context.bezierCurveTo(x + width * 0.54, y - height * 0.02, x + width * 0.72, y + height * 0.02, x + width * 0.73, y + height * 0.19);
    context.bezierCurveTo(x + width * 0.94, y + height * 0.12, x + width * 1.04, y + height * 0.34, x + width * 0.92, y + height * 0.48);
    context.bezierCurveTo(x + width * 1.04, y + height * 0.64, x + width * 0.91, y + height * 0.85, x + width * 0.74, y + height * 0.79);
    context.bezierCurveTo(x + width * 0.68, y + height * 1.01, x + width * 0.48, y + height * 1.02, x + width * 0.42, y + height * 0.86);
    context.bezierCurveTo(x + width * 0.3, y + height * 1.02, x + width * 0.12, y + height * 0.91, x + width * 0.16, y + height * 0.75);
    context.bezierCurveTo(x - width * 0.03, y + height * 0.72, x - width * 0.05, y + height * 0.48, x + width * 0.1, y + height * 0.42);
    context.bezierCurveTo(x - width * 0.01, y + height * 0.29, x + width * 0.06, y + height * 0.14, x + width * 0.18, y + height * 0.2);
    context.closePath();
    return;
  }
  context.roundRect(x, y, width, height, radius);
}

export const mindMapCloudSvgPath = (x: number, y: number, width: number, height: number) => `M ${x + width * 0.18} ${y + height * 0.2}
C ${x + width * 0.22} ${y - height * 0.02} ${x + width * 0.4} ${y - height * 0.02} ${x + width * 0.44} ${y + height * 0.13}
C ${x + width * 0.54} ${y - height * 0.02} ${x + width * 0.72} ${y + height * 0.02} ${x + width * 0.73} ${y + height * 0.19}
C ${x + width * 0.94} ${y + height * 0.12} ${x + width * 1.04} ${y + height * 0.34} ${x + width * 0.92} ${y + height * 0.48}
C ${x + width * 1.04} ${y + height * 0.64} ${x + width * 0.91} ${y + height * 0.85} ${x + width * 0.74} ${y + height * 0.79}
C ${x + width * 0.68} ${y + height * 1.01} ${x + width * 0.48} ${y + height * 1.02} ${x + width * 0.42} ${y + height * 0.86}
C ${x + width * 0.3} ${y + height * 1.02} ${x + width * 0.12} ${y + height * 0.91} ${x + width * 0.16} ${y + height * 0.75}
C ${x - width * 0.03} ${y + height * 0.72} ${x - width * 0.05} ${y + height * 0.48} ${x + width * 0.1} ${y + height * 0.42}
C ${x - width * 0.01} ${y + height * 0.29} ${x + width * 0.06} ${y + height * 0.14} ${x + width * 0.18} ${y + height * 0.2} Z`;

export function mindMapSummaryConnector(summary: MindMapNode, sources: MindMapNode[]) {
  if (!sources.length) return null;
  const left = Math.min(...sources.map((node) => node.x - node.width / 2));
  const right = Math.max(...sources.map((node) => node.x + node.width / 2));
  const top = Math.min(...sources.map((node) => node.y - node.height / 2));
  const bottom = Math.max(...sources.map((node) => node.y + node.height / 2));
  const summaryOnRight = summary.x >= (left + right) / 2;
  return {
    sourceX: summaryOnRight ? right + 12 : left - 12,
    targetX: summary.x + (summaryOnRight ? -summary.width / 2 : summary.width / 2),
    top,
    bottom,
    middleY: (top + bottom) / 2,
  };
}

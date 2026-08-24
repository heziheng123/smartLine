import {
  normalizeMindMapDocument,
  type MindMapDocument,
  type MindMapEdge,
  type MindMapNode,
} from './model';
import { mindMapRepository } from './repository';

const MAX_JSON_BYTES = 10 * 1024 * 1024;

const safeFileName = (title: string) => {
  const normalized = [...title.trim().replace(/[<>:"/\\|?*]/g, '-')]
    .map((character) => character.charCodeAt(0) < 32 ? '-' : character)
    .join('')
    .slice(0, 80);
  return normalized || '思维导图';
};

export function serializeMindMapDocument(document: MindMapDocument) {
  return JSON.stringify(document, null, 2);
}

export function parseMindMapDocumentJson(source: string): MindMapDocument {
  if (new Blob([source]).size > MAX_JSON_BYTES) throw new Error('导入文件不能超过 10 MiB。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('这不是有效的思维导图 JSON 文件。');
  }
  const document = normalizeMindMapDocument(parsed);
  if (!document) throw new Error('文件不是受支持的 SmartLine 思维导图。');
  return document;
}

const blobDataUrl = (blob: Blob) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('图片导出失败。'));
  reader.onerror = () => reject(reader.error ?? new Error('图片导出失败。'));
  reader.readAsDataURL(blob);
});

export async function downloadMindMapJson(document: MindMapDocument) {
  const nodes = { ...document.nodes };
  await Promise.all(Object.values(document.nodes).map(async (node) => {
    if (!node.imageAssetId) return;
    const asset = await mindMapRepository.loadImageAsset(node.imageAssetId);
    if (!asset) return;
    nodes[node.id] = { ...node, imageSrc: await blobDataUrl(asset.blob), imageAssetId: null };
  }));
  const blob = new Blob([serializeMindMapDocument({ ...document, nodes })], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = safeFileName(document.title) + '.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

const escapeXml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&apos;');

export function serializeMindMapSvg(document: MindMapDocument) {
  const nodes = Object.values(document.nodes);
  const sections = Object.values(document.sections);
  const left = Math.min(0, ...nodes.map((node) => node.x - node.width / 2), ...sections.map((section) => section.x - section.width / 2));
  const top = Math.min(0, ...nodes.map((node) => node.y - node.height / 2), ...sections.map((section) => section.y - section.height / 2));
  const right = Math.max(1, ...nodes.map((node) => node.x + node.width / 2), ...sections.map((section) => section.x + section.width / 2));
  const bottom = Math.max(1, ...nodes.map((node) => node.y + node.height / 2), ...sections.map((section) => section.y + section.height / 2));
  const margin = 48;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${left - margin} ${top - margin} ${right - left + margin * 2} ${bottom - top + margin * 2}" role="img" aria-label="${escapeXml(document.title)}">`,
    '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="context-stroke"/></marker></defs>',
    `<rect x="${left - margin}" y="${top - margin}" width="${right - left + margin * 2}" height="${bottom - top + margin * 2}" fill="${document.settings.background}"/>`,
  ];
  for (const section of sections) {
    parts.push(`<rect x="${section.x - section.width / 2}" y="${section.y - section.height / 2}" width="${section.width}" height="${section.collapsed ? 42 : section.height}" rx="14" fill="#f2f2ff" stroke="#7775df" stroke-dasharray="8 5"/>`);
    parts.push(`<text x="${section.x - section.width / 2 + 14}" y="${section.y - section.height / 2 + 24}" font-family="sans-serif" font-size="13" font-weight="600" fill="#4a48b8">${escapeXml(section.title)}</text>`);
  }
  for (const edge of Object.values(document.edges)) {
    const points = edgeEndpoints(edge, document.nodes);
    if (!points) continue;
    let path = `M ${points.start.x} ${points.start.y}`;
    if (edge.type === 'curve') {
      const controlX = (points.start.x + points.end.x) / 2;
      const controlY = (points.start.y + points.end.y) / 2 - Math.min(120, Math.abs(points.end.x - points.start.x) * 0.25 + 30);
      path += ` Q ${controlX} ${controlY} ${points.end.x} ${points.end.y}`;
    } else if (edge.type === 'orthogonal') {
      const middleX = (points.start.x + points.end.x) / 2;
      const controls = edge.controlPoints.length
        ? edge.controlPoints
        : [{ x: middleX, y: points.start.y }, { x: middleX, y: points.end.y }];
      path += controls.map((point) => ` L ${point.x} ${point.y}`).join('') + ` L ${points.end.x} ${points.end.y}`;
    } else {
      path += ` L ${points.end.x} ${points.end.y}`;
    }
    const markerStart = edge.direction === 'backward' || edge.direction === 'both' ? ' marker-start="url(#arrow)"' : '';
    const markerEnd = edge.direction === 'forward' || edge.direction === 'both' ? ' marker-end="url(#arrow)"' : '';
    parts.push(`<path d="${path}" fill="none" stroke="${edge.style.color}" stroke-width="${edge.style.width}"${edge.style.dash === 'dashed' ? ' stroke-dasharray="7 5"' : ''}${markerStart}${markerEnd}/>`);
    if (edge.label) parts.push(`<text x="${(points.start.x + points.end.x) / 2}" y="${(points.start.y + points.end.y) / 2 - 7}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#4a4a4f">${escapeXml(edge.label)}</text>`);
  }
  for (const node of nodes) {
    const x = node.x - node.width / 2;
    const y = node.y - node.height / 2;
    parts.push(`<g transform="rotate(${node.rotation} ${node.x} ${node.y})"><rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="${node.style.borderRadius}" fill="${node.style.fill}" fill-opacity="${node.style.fillOpacity}" stroke="${node.style.borderColor}" stroke-width="${node.style.borderWidth}"${node.style.borderStyle === 'dashed' ? ' stroke-dasharray="7 5"' : ''}/><text x="${node.x}" y="${node.y}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${node.style.fontSize}" font-weight="${node.style.fontWeight}" fill="${node.style.textColor}">${escapeXml(node.text || node.type)}</text></g>`);
  }
  parts.push('</svg>');
  return parts.join('');
}

export function downloadMindMapSvg(document: MindMapDocument) {
  const blob = new Blob([serializeMindMapSvg(document)], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = safeFileName(document.title) + '.svg';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadCanvasPng(canvas: HTMLCanvasElement, title: string) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const anchor = window.document.createElement('a');
    anchor.href = url;
    anchor.download = safeFileName(title) + '.png';
    anchor.click();
    URL.revokeObjectURL(url);
  }, 'image/png');
}

export type MindMapPngScope = 'viewport' | 'all' | 'selection';

const edgeEndpoints = (edge: MindMapEdge, nodes: Record<string, MindMapNode>) => {
  const source = nodes[edge.sourceId];
  const target = nodes[edge.targetId];
  if (!source || !target) return null;
  const angle = Math.atan2(target.y - source.y, target.x - source.x);
  const sourceRadius = Math.abs(Math.cos(angle)) * source.width / 2
    + Math.abs(Math.sin(angle)) * source.height / 2;
  const targetRadius = Math.abs(Math.cos(angle)) * target.width / 2
    + Math.abs(Math.sin(angle)) * target.height / 2;
  return {
    start: {
      x: source.x + Math.cos(angle) * sourceRadius,
      y: source.y + Math.sin(angle) * sourceRadius,
    },
    end: {
      x: target.x - Math.cos(angle) * targetRadius,
      y: target.y - Math.sin(angle) * targetRadius,
    },
  };
};

const drawArrow = (
  context: CanvasRenderingContext2D,
  from: { x: number; y: number },
  to: { x: number; y: number },
  color: string,
) => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - 9 * Math.cos(angle - Math.PI / 6), to.y - 9 * Math.sin(angle - Math.PI / 6));
  context.lineTo(to.x - 9 * Math.cos(angle + Math.PI / 6), to.y - 9 * Math.sin(angle + Math.PI / 6));
  context.closePath();
  context.fillStyle = color;
  context.fill();
};

const wrapNodeText = (context: CanvasRenderingContext2D, text: string, maximumWidth: number) => {
  const lines: string[] = [];
  for (const sourceLine of (text || '空节点').split('\n')) {
    let line = '';
    for (const character of sourceLine) {
      if (line && context.measureText(line + character).width > maximumWidth) {
        lines.push(line);
        line = character;
      } else {
        line += character;
      }
    }
    lines.push(line || ' ');
  }
  return lines.slice(0, 20);
};

export function downloadMindMapPng(
  document: MindMapDocument,
  scope: Exclude<MindMapPngScope, 'viewport'>,
  selectedNodeIds: string[] = [],
) {
  const selected = new Set(selectedNodeIds);
  const nodes = Object.values(document.nodes).filter((node) => scope === 'all' || selected.has(node.id));
  if (nodes.length === 0) return false;
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = Object.values(document.edges).filter((edge) => (
    visibleNodeIds.has(edge.sourceId) && visibleNodeIds.has(edge.targetId)
  ));
  const left = Math.min(...nodes.map((node) => node.x - node.width / 2));
  const top = Math.min(...nodes.map((node) => node.y - node.height / 2));
  const right = Math.max(...nodes.map((node) => node.x + node.width / 2));
  const bottom = Math.max(...nodes.map((node) => node.y + node.height / 2));
  const margin = 48;
  const contentWidth = Math.max(1, right - left + margin * 2);
  const contentHeight = Math.max(1, bottom - top + margin * 2);
  const scale = Math.min(2, 4096 / contentWidth, 4096 / contentHeight);
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(contentWidth * scale));
  canvas.height = Math.max(1, Math.ceil(contentHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) return false;
  context.fillStyle = document.settings.background;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.setTransform(scale, 0, 0, scale, (-left + margin) * scale, (-top + margin) * scale);

  for (const edge of edges) {
    const points = edgeEndpoints(edge, document.nodes);
    if (!points) continue;
    context.beginPath();
    context.moveTo(points.start.x, points.start.y);
    let forwardFrom = points.start;
    let backwardFrom = points.end;
    if (edge.type === 'curve') {
      const control = {
        x: (points.start.x + points.end.x) / 2,
        y: (points.start.y + points.end.y) / 2 - Math.min(120, Math.abs(points.end.x - points.start.x) * 0.25 + 30),
      };
      context.quadraticCurveTo(control.x, control.y, points.end.x, points.end.y);
      forwardFrom = control;
      backwardFrom = control;
    } else if (edge.type === 'orthogonal') {
      const middleX = (points.start.x + points.end.x) / 2;
      const route = edge.controlPoints.length
        ? edge.controlPoints
        : [{ x: middleX, y: points.start.y }, { x: middleX, y: points.end.y }];
      for (const point of route) context.lineTo(point.x, point.y);
      context.lineTo(points.end.x, points.end.y);
      forwardFrom = route.at(-1) ?? points.start;
      backwardFrom = route[0] ?? points.end;
    } else {
      context.lineTo(points.end.x, points.end.y);
    }
    context.strokeStyle = edge.style.color;
    context.lineWidth = edge.style.width;
    context.setLineDash(edge.style.dash === 'dashed' ? [7, 5] : []);
    context.stroke();
    context.setLineDash([]);
    if (edge.direction === 'forward' || edge.direction === 'both') {
      drawArrow(context, forwardFrom, points.end, edge.style.color);
    }
    if (edge.direction === 'backward' || edge.direction === 'both') {
      drawArrow(context, backwardFrom, points.start, edge.style.color);
    }
    if (edge.label) {
      const midpoint = {
        x: (points.start.x + points.end.x) / 2,
        y: (points.start.y + points.end.y) / 2 - 7,
      };
      context.font = '500 12px sans-serif';
      const labelWidth = context.measureText(edge.label).width;
      context.fillStyle = 'rgba(255,255,255,0.94)';
      context.fillRect(midpoint.x - labelWidth / 2 - 4, midpoint.y - 10, labelWidth + 8, 17);
      context.fillStyle = '#4a4a4f';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(edge.label, midpoint.x, midpoint.y - 1);
    }
  }

  for (const node of nodes) {
    const x = node.x - node.width / 2;
    const y = node.y - node.height / 2;
    context.save();
    if (node.style.shadow) {
      context.shadowColor = 'rgba(15, 23, 42, 0.12)';
      context.shadowBlur = 14;
      context.shadowOffsetY = 4;
    }
    context.globalAlpha = node.style.fillOpacity;
    context.fillStyle = node.style.fill;
    context.beginPath();
    context.roundRect(x, y, node.width, node.height, node.style.borderRadius);
    context.fill();
    context.shadowColor = 'transparent';
    context.globalAlpha = 1;
    context.strokeStyle = node.style.borderColor;
    context.lineWidth = node.style.borderWidth;
    context.setLineDash(node.style.borderStyle === 'dashed' ? [7, 5] : []);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = node.style.textColor;
    context.font = `${node.style.fontWeight} ${node.style.fontSize}px sans-serif`;
    context.textAlign = node.style.textAlign;
    context.textBaseline = 'middle';
    const lines = wrapNodeText(context, node.text, Math.max(10, node.width - 32));
    const lineHeight = node.style.fontSize * node.style.lineHeight;
    const textX = node.style.textAlign === 'left'
      ? x + 16
      : node.style.textAlign === 'right'
        ? x + node.width - 16
        : node.x;
    const startY = node.y - (lines.length - 1) * lineHeight / 2;
    lines.forEach((line, index) => context.fillText(line, textX, startY + index * lineHeight));
    context.restore();
  }

  downloadCanvasPng(canvas, document.title);
  return true;
}

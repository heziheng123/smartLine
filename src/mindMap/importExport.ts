import {
  normalizeMindMapDocument,
  type MindMapDocument,
  type MindMapEdge,
} from './model';
import { buildEdgeRoute } from './canvas/edgeRouting';
import { edgeConnectableObjects } from './canvas/connectableObjects';
import { mindMapRepository } from './repository';

const MAX_JSON_BYTES = 32 * 1024 * 1024;

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
  if (new Blob([source]).size > MAX_JSON_BYTES) throw new Error('导入文件不能超过 32 MiB。');
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('这不是有效的思维导图 JSON 文件。');
  }
  const raw = parsed as Record<string, unknown>;
  const collections: Array<[string, number]> = [['nodes', 10_000], ['sections', 2_000], ['groups', 2_000], ['projectReferences', 2_000], ['timelineSections', 2_000], ['edges', 20_000]];
  for (const [name, limit] of collections) {
    const value = raw[name];
    if (value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > limit) {
      throw new Error(`导入文件中的 ${name} 超过 ${limit} 条上限。`);
    }
  }
  if (raw.nodes && typeof raw.nodes === 'object' && !Array.isArray(raw.nodes)) {
    for (const node of Object.values(raw.nodes as Record<string, unknown>)) {
      const imageSrc = node && typeof node === 'object' ? (node as Record<string, unknown>).imageSrc : null;
      if (typeof imageSrc === 'string' && imageSrc.length > 3_000_000) throw new Error('导入图片不能超过 3 MB。');
    }
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
  const projectReferences = Object.values(document.projectReferences);
  const sections = Object.values(document.sections);
  const objects = [...nodes, ...projectReferences];
  const objectBounds = objects.map(exportBounds);
  const left = Math.min(0, ...objectBounds.map((bounds) => bounds.left), ...sections.map((section) => section.x - section.width / 2));
  const top = Math.min(0, ...objectBounds.map((bounds) => bounds.top), ...sections.map((section) => section.y - section.height / 2));
  const right = Math.max(1, ...objectBounds.map((bounds) => bounds.right), ...sections.map((section) => section.x + section.width / 2));
  const bottom = Math.max(1, ...objectBounds.map((bounds) => bounds.bottom), ...sections.map((section) => section.y + section.height / 2));
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
    const route = edgeRouteForExport(edge, document);
    if (!route) continue;
    const points = { start: route.start, end: route.end };
    let path = `M ${points.start.x} ${points.start.y}`;
    if (edge.type === 'curve') {
      path += ` C ${route.control1.x} ${route.control1.y} ${route.control2.x} ${route.control2.y} ${points.end.x} ${points.end.y}`;
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
    parts.push(`<path d="${path}" fill="none" stroke="${edge.relationship === 'reference' ? '#b2bac6' : edge.style.color}" stroke-width="${edge.style.width}"${edge.relationship === 'reference' || edge.style.dash === 'dashed' ? ' stroke-dasharray="7 5"' : ''}${markerStart}${markerEnd}/>`);
    if (edge.label) parts.push(`<text x="${(points.start.x + points.end.x) / 2}" y="${(points.start.y + points.end.y) / 2 - 7}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#4a4a4f">${escapeXml(edge.label)}</text>`);
  }
  for (const node of nodes) {
    const x = node.x - node.width / 2;
    const y = node.y - node.height / 2;
    parts.push(`<g transform="rotate(${node.rotation} ${node.x} ${node.y})"><rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="${node.style.borderRadius}" fill="${node.style.fill}" fill-opacity="${node.style.fillOpacity}" stroke="${node.style.borderColor}" stroke-width="${node.style.borderWidth}"${node.style.borderStyle === 'dashed' ? ' stroke-dasharray="7 5"' : ''}/><text x="${node.x}" y="${node.y}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${node.style.fontSize}" font-weight="${node.style.fontWeight}" fill="${node.style.textColor}">${escapeXml(node.text || node.type)}</text></g>`);
  }
  for (const reference of projectReferences) {
    const x = reference.x - reference.width / 2;
    const y = reference.y - reference.height / 2;
    parts.push(`<rect x="${x}" y="${y}" width="${reference.width}" height="${reference.height}" rx="12" fill="#fff" stroke="#cbd5e1"/>`);
    parts.push(`<text x="${x + 16}" y="${reference.y}" dominant-baseline="middle" font-family="sans-serif" font-size="14" font-weight="600" fill="#1f2937">${escapeXml(reference.targetId)}</text>`);
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

const exportBounds = (object: { x: number; y: number; width: number; height: number; rotation?: number }) => {
  const radians = (object.rotation ?? 0) * Math.PI / 180;
  const width = Math.abs(Math.cos(radians)) * object.width + Math.abs(Math.sin(radians)) * object.height;
  const height = Math.abs(Math.sin(radians)) * object.width + Math.abs(Math.cos(radians)) * object.height;
  return { left: object.x - width / 2, top: object.y - height / 2, right: object.x + width / 2, bottom: object.y + height / 2 };
};

const edgeRouteForExport = (edge: MindMapEdge, document: MindMapDocument) => {
  const endpoints = edgeConnectableObjects(document, edge);
  return endpoints ? buildEdgeRoute(endpoints.source.bounds, endpoints.target.bounds, { kind: edge.relationship === 'tree' ? 'hierarchy' : 'relation' }) : null;
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
  const projectReferences = scope === 'all' ? Object.values(document.projectReferences) : [];
  if (nodes.length === 0 && projectReferences.length === 0) return false;
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const visibleProjectReferenceIds = new Set(projectReferences.map((reference) => reference.id));
  const edges = Object.values(document.edges).filter((edge) => (
    (edge.source.type === 'node' ? visibleNodeIds.has(edge.source.id) : visibleProjectReferenceIds.has(edge.source.id))
    && (edge.target.type === 'node' ? visibleNodeIds.has(edge.target.id) : visibleProjectReferenceIds.has(edge.target.id))
  ));
  const objects = [...nodes, ...projectReferences];
  const objectBounds = objects.map(exportBounds);
  const left = Math.min(...objectBounds.map((bounds) => bounds.left));
  const top = Math.min(...objectBounds.map((bounds) => bounds.top));
  const right = Math.max(...objectBounds.map((bounds) => bounds.right));
  const bottom = Math.max(...objectBounds.map((bounds) => bounds.bottom));
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
    const routeForExport = edgeRouteForExport(edge, document);
    if (!routeForExport) continue;
    const points = { start: routeForExport.start, end: routeForExport.end };
    context.beginPath();
    context.moveTo(points.start.x, points.start.y);
    let forwardFrom = points.start;
    let backwardFrom = points.end;
    if (edge.type === 'curve') {
      context.bezierCurveTo(routeForExport.control1.x, routeForExport.control1.y, routeForExport.control2.x, routeForExport.control2.y, points.end.x, points.end.y);
      forwardFrom = routeForExport.control2;
      backwardFrom = routeForExport.control1;
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
    context.strokeStyle = edge.relationship === 'reference' ? '#b2bac6' : edge.style.color;
    context.lineWidth = edge.style.width;
    context.setLineDash(edge.relationship === 'reference' || edge.style.dash === 'dashed' ? [7, 5] : []);
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
    context.translate(node.x, node.y);
    context.rotate(node.rotation * Math.PI / 180);
    context.translate(-node.x, -node.y);
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

  for (const reference of projectReferences) {
    const x = reference.x - reference.width / 2;
    const y = reference.y - reference.height / 2;
    context.fillStyle = '#ffffff';
    context.strokeStyle = '#cbd5e1';
    context.lineWidth = 1;
    context.beginPath();
    context.roundRect(x, y, reference.width, reference.height, 12);
    context.fill();
    context.stroke();
    context.fillStyle = '#1f2937';
    context.font = '600 14px sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(reference.targetId, x + 16, reference.y);
  }

  downloadCanvasPng(canvas, document.title);
  return true;
}

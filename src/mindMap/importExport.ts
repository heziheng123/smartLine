import {
  createEmptyMindMapDocument,
  createMindMapEdge,
  createMindMapNode,
  createTextMindMapNode,
  normalizeMindMapDocument,
  type MindMapDocument,
  type MindMapEdge,
} from './model';
import { buildEdgeRoute } from './canvas/edgeRouting';
import { edgeConnectableObjects } from './canvas/connectableObjects';
import { mindMapCloudSvgPath, mindMapSummaryConnector, traceMindMapBoundary } from './canvas/semanticGeometry';
import { mindMapRepository } from './repository';
import {
  MIND_MAP_MARKER_ICON,
  MIND_MAP_PRIORITY_COLOR,
  MIND_MAP_PRIORITY_LABEL,
  MIND_MAP_TASK_STATUS_ICON,
  mindMapColorWithAlpha,
  mindMapNodeThemeColor,
  mixMindMapColor,
  resolveBranchThemeColors,
  resolveMindMapNodeDepths,
  resolveMindMapNodePresentation,
  resolveTreeEdgeColor,
} from './visualTheme';
import { layoutMindMapTree } from './layout';
import { repairMindMapTreeForest } from './treeValidation';

const MAX_JSON_BYTES = 32 * 1024 * 1024;

const exportVisuals = (document: MindMapDocument) => {
  const branchColors = resolveBranchThemeColors(document);
  const depths = resolveMindMapNodeDepths(document);
  const presentations = new Map(Object.values(document.nodes).map((node) => [
    node.id,
    resolveMindMapNodePresentation(
      node,
      depths.get(node.id) ?? 0,
      branchColors.get(node.id) ?? mindMapNodeThemeColor(node, document.settings.mapTheme),
      document.settings.mapTheme,
    ),
  ]));
  return { branchColors, presentations };
};

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

type OutlineLine = { level: number; text: string };

const outlineLine = (line: string, headingLevel: number): OutlineLine | null => {
  const heading = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
  if (heading) return { level: heading[1].length, text: heading[2] };
  const list = /^(\s*)(?:[-*+]|\d+[.)])\s+(.+?)\s*$/.exec(line);
  if (list) {
    const indentLevel = Math.floor(list[1].replace(/\t/g, '  ').length / 2);
    return { level: (headingLevel || 0) + indentLevel + 1, text: list[2] };
  }
  return null;
};

export const isMindMapMarkdownOutline = (source: string) => source
  .replace(/^\uFEFF/, '')
  .split(/\r?\n/)
  .some((line) => Boolean(outlineLine(line, 0)));

const fenceStart = (line: string) => /^\s*(`{3,}|~{3,})/.exec(line)?.[1] ?? null;
const isTableDivider = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);

const markdownBlockEnd = (lines: string[], start: number, headingLevel: number) => {
  const fence = fenceStart(lines[start]);
  if (fence) {
    let end = start + 1;
    while (end < lines.length && !new RegExp(`^\\s*${fence[0]}{${fence.length},}`).test(lines[end])) end += 1;
    return Math.min(lines.length, end + 1);
  }
  if (/^\s*>/.test(lines[start])) {
    let end = start + 1;
    while (end < lines.length && (/^\s*>/.test(lines[end]) || lines[end].trim() === '')) end += 1;
    return end;
  }
  if (lines[start + 1] && /\|/.test(lines[start]) && isTableDivider(lines[start + 1])) {
    let end = start + 2;
    while (end < lines.length && lines[end].trim() && /\|/.test(lines[end])) end += 1;
    return end;
  }
  let end = start + 1;
  while (end < lines.length && lines[end].trim() && !outlineLine(lines[end], headingLevel)) end += 1;
  return end;
};

const taskFromOutlineText = (text: string) => {
  const task = /^\[([ xX])\]\s+(.+?)\s*$/.exec(text);
  return task ? { text: task[2], status: task[1].toLowerCase() === 'x' ? 'done' as const : 'todo' as const } : null;
};

const serializeOutlineText = (node: MindMapDocument['nodes'][string]) => {
  const text = node.text.trim().replace(/\s*\n\s*/g, ' ') || '未命名节点';
  return node.taskStatus === 'done' ? `[x] ${text}` : node.taskStatus === 'todo' ? `[ ] ${text}` : text;
};

/** Imports outlines as tree nodes and preserves all remaining Markdown as Markdown nodes. */
export function parseMindMapMarkdownOutline(source: string, title = '导入的 Markdown 大纲'): MindMapDocument {
  if (new Blob([source]).size > MAX_JSON_BYTES) throw new Error('导入文件不能超过 32 MiB。');
  const sourceLines = source.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (!sourceLines.some((line) => line.trim())) throw new Error('Markdown 大纲中没有可导入的内容。');
  let headingLevel = 0;
  const firstHeading = /^#\s+(.+?)\s*$/m.exec(source)?.[1];
  const document = createEmptyMindMapDocument(firstHeading || title);
  const parentAtLevel: string[] = [];
  let index = 0;
  for (let lineIndex = 0; lineIndex < sourceLines.length;) {
    const sourceLine = sourceLines[lineIndex];
    if (!sourceLine.trim()) {
      lineIndex += 1;
      continue;
    }
    const line = outlineLine(sourceLine, headingLevel);
    if (!line) {
      const end = markdownBlockEnd(sourceLines, lineIndex, headingLevel);
      const raw = sourceLines.slice(lineIndex, end).join('\n').trim();
      const parentId = [...parentAtLevel].reverse().find(Boolean);
      const node = createMindMapNode({ x: parentAtLevel.length * 220, y: index * 104 }, 'markdown', { text: raw });
      document.nodes[node.id] = node;
      document.zOrder.push(node.id);
      if (parentId) {
        const edge = createMindMapEdge(parentId, node.id, { relationship: 'tree' });
        document.edges[edge.id] = edge;
      }
      index += 1;
      lineIndex = end;
      continue;
    }
    if (/^#{1,6}\s+/.test(sourceLine)) headingLevel = line.level;
    const task = taskFromOutlineText(line.text);
    const node = createTextMindMapNode(
      { x: (line.level - 1) * 220, y: index * 88 },
      { text: task?.text ?? line.text },
    );
    if (task) node.taskStatus = task.status;
    document.nodes[node.id] = node;
    document.zOrder.push(node.id);
    const parentId = parentAtLevel.slice(0, line.level - 1).reverse().find(Boolean);
    if (parentId) {
      const edge = createMindMapEdge(parentId, node.id, { relationship: 'tree' });
      document.edges[edge.id] = edge;
    }
    parentAtLevel.length = line.level - 1;
    parentAtLevel[line.level - 1] = node.id;
    index += 1;
    lineIndex += 1;
  }
  return layoutMindMapTree(document);
}

/** Serializes tree edges as an indented Markdown outline; reference edges stay visual-only. */
export function serializeMindMapMarkdownOutline(document: MindMapDocument): string {
  const repaired = repairMindMapTreeForest(document);
  const order = new Map(repaired.zOrder.map((id, index) => [id, index]));
  const children = new Map<string, MindMapEdge[]>();
  const childIds = new Set<string>();
  for (const edge of Object.values(repaired.edges)) {
    if (edge.relationship !== 'tree' || edge.source.type !== 'node' || edge.target.type !== 'node') continue;
    const list = children.get(edge.sourceId) ?? [];
    list.push(edge);
    children.set(edge.sourceId, list);
    childIds.add(edge.targetId);
  }
  for (const [parentId, list] of children) {
    const ordered = list.some((edge) => edge.order !== undefined);
    children.set(parentId, list.sort((left, right) => ordered
      ? (left.order ?? Number.MAX_SAFE_INTEGER) - (right.order ?? Number.MAX_SAFE_INTEGER)
        || left.createdAt - right.createdAt
        || left.id.localeCompare(right.id)
      : (order.get(left.targetId) ?? Infinity) - (order.get(right.targetId) ?? Infinity)));
  }
  const roots = [...repaired.zOrder, ...Object.keys(repaired.nodes)]
    .filter((id, index, ids) => ids.indexOf(id) === index && repaired.nodes[id] && !childIds.has(id));
  const output: string[] = [];
  const visited = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (visited.has(id)) return;
    const node = repaired.nodes[id];
    if (!node) return;
    visited.add(id);
    if (node.type === 'markdown') {
      if (output.length) output.push('');
      const indent = '  '.repeat(depth);
      output.push(...node.text.trim().split(/\r?\n/).map((line) => line ? indent + line : ''));
    } else {
      output.push(`${'  '.repeat(depth)}- ${serializeOutlineText(node)}`);
    }
    for (const edge of children.get(id) ?? []) visit(edge.targetId, depth + 1);
  };
  for (const rootId of roots) visit(rootId, 0);
  for (const nodeId of repaired.zOrder) visit(nodeId, 0);
  return output.join('\n') + (output.length ? '\n' : '');
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

export function downloadMindMapMarkdownOutline(document: MindMapDocument) {
  const blob = new Blob([serializeMindMapMarkdownOutline(document)], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = window.document.createElement('a');
  anchor.href = url;
  anchor.download = safeFileName(document.title) + '.md';
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
  const { branchColors, presentations } = exportVisuals(document);
  for (const section of sections) {
    const member = nodes.find((node) => node.parentSectionId === section.id);
    const accent = member ? presentations.get(member.id)?.accent ?? '#7775df' : '#7775df';
    const x = section.x - section.width / 2;
    const y = section.y - section.height / 2;
    const height = section.collapsed ? 42 : section.height;
    const fill = mixMindMapColor(accent, '#ffffff', section.shape === 'fill' ? 0.82 : 0.92);
    if (section.shape === 'bracket') {
      const arm = Math.min(section.width * 0.12, 28);
      parts.push(`<path d="M ${x + arm} ${y} H ${x} V ${y + height} H ${x + arm} M ${x + section.width - arm} ${y} H ${x + section.width} V ${y + height} H ${x + section.width - arm}" fill="none" stroke="${accent}" stroke-width="1.5"/>`);
    } else if (section.shape === 'cloud') {
      parts.push(`<path d="${mindMapCloudSvgPath(x, y, section.width, height)}" fill="${fill}" stroke="${accent}" stroke-dasharray="3 3"/>`);
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${section.width}" height="${height}" rx="14" fill="${fill}" stroke="${accent}"${section.shape === 'fill' ? '' : ' stroke-dasharray="8 5"'}/>`);
    }
    parts.push(`<text x="${section.x - section.width / 2 + 14}" y="${section.y - section.height / 2 + 24}" font-family="sans-serif" font-size="13" font-weight="600" fill="${mixMindMapColor(accent, '#202124', 0.55)}">${escapeXml(section.title)}</text>`);
  }
  const visibleNodes = new Map(nodes.map((node) => [node.id, node]));
  for (const summary of nodes) {
    const sources = (summary.summarySourceIds ?? []).map((id) => visibleNodes.get(id)).filter((node): node is typeof summary => Boolean(node));
    const relation = mindMapSummaryConnector(summary, sources);
    if (!relation || sources.length < 2) continue;
    const accent = presentations.get(summary.id)?.accent ?? '#7775df';
    const direction = Math.sign(relation.targetX - relation.sourceX) || 1;
    parts.push(`<path d="M ${relation.sourceX + direction * 10} ${relation.top} H ${relation.sourceX} V ${relation.bottom} H ${relation.sourceX + direction * 10} M ${relation.sourceX} ${relation.middleY} H ${relation.targetX}" fill="none" stroke="${accent}" stroke-width="2" opacity="0.58"/>`);
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
    const edgeColor = edge.relationship === 'reference' ? '#b2bac6' : resolveTreeEdgeColor(edge, branchColors);
    parts.push(`<path d="${path}" fill="none" stroke="${edgeColor}" stroke-width="${edge.style.width}"${edge.relationship === 'reference' || edge.style.dash === 'dashed' ? ' stroke-dasharray="7 5"' : ''}${markerStart}${markerEnd}/>`);
    if (edge.label) parts.push(`<text x="${(points.start.x + points.end.x) / 2}" y="${(points.start.y + points.end.y) / 2 - 7}" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#4a4a4f">${escapeXml(edge.label)}</text>`);
  }
  for (const node of nodes) {
    const x = node.x - node.width / 2;
    const y = node.y - node.height / 2;
    const presentation = presentations.get(node.id)!;
    const label = `${node.icon ? `${node.icon} ` : ''}${node.type === 'url' ? 'URL · ' : ''}${node.text || node.type}`;
    const marker = MIND_MAP_MARKER_ICON[node.marker ?? 'none'];
    const status = node.taskStatus === 'none' ? '' : MIND_MAP_TASK_STATUS_ICON[node.taskStatus];
    parts.push(`<g transform="rotate(${node.rotation} ${node.x} ${node.y})">`);
    if (presentation.topic) {
      parts.push(`<line x1="${x + 10}" y1="${y + node.height - 5}" x2="${x + node.width - 10}" y2="${y + node.height - 5}" stroke="${presentation.accent}" stroke-width="1.25"/>`);
    } else {
      parts.push(`<rect x="${x}" y="${y}" width="${node.width}" height="${node.height}" rx="${node.style.borderRadius}" fill="${presentation.fill}" fill-opacity="${node.style.fillOpacity}" stroke="${presentation.border}" stroke-width="${Math.min(1, node.style.borderWidth)}"${node.style.borderStyle === 'dashed' ? ' stroke-dasharray="7 5"' : ''}/>`);
    }
    parts.push(`<text x="${node.x}" y="${node.y}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="${presentation.fontSize}" font-weight="${presentation.fontWeight}" fill="${presentation.text}">${escapeXml(label)}</text>`);
    if (marker || status) parts.push(`<text x="${x + 7}" y="${y + 18}" font-family="sans-serif" font-size="13" fill="${presentation.accent}">${escapeXml([marker, status].filter(Boolean).join(' '))}</text>`);
    if (node.priority !== 'none') {
      parts.push(`<rect x="${x + node.width - 30}" y="${y + 5}" width="24" height="15" rx="7" fill="${MIND_MAP_PRIORITY_COLOR[node.priority]}"/><text x="${x + node.width - 18}" y="${y + 12.5}" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif" font-size="9" font-weight="700" fill="#ffffff">${MIND_MAP_PRIORITY_LABEL[node.priority]}</text>`);
    }
    if (node.tags?.length) parts.push(`<text x="${x + node.width - 7}" y="${y + node.height - (node.progress === null || node.progress === undefined ? 7 : 12)}" text-anchor="end" font-family="sans-serif" font-size="9" font-weight="600" fill="${mixMindMapColor(presentation.accent, '#ffffff', 0.28)}">${escapeXml(node.tags.slice(0, 2).map((tag) => `#${tag}`).join(' '))}</text>`);
    if (node.progress !== null && node.progress !== undefined) {
      const width = Math.max(0, node.width - 14);
      parts.push(`<rect x="${x + 7}" y="${y + node.height - 5}" width="${width}" height="3" fill="${mindMapColorWithAlpha(presentation.accent, 0.14)}"/><rect x="${x + 7}" y="${y + node.height - 5}" width="${width * Math.max(0, Math.min(100, node.progress)) / 100}" height="3" fill="${presentation.accent}"/>`);
    }
    parts.push('</g>');
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
  const sections = Object.values(document.sections).filter((section) => scope === 'all'
    || nodes.some((node) => node.parentSectionId === section.id));
  if (nodes.length === 0 && projectReferences.length === 0 && sections.length === 0) return false;
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const visibleProjectReferenceIds = new Set(projectReferences.map((reference) => reference.id));
  const edges = Object.values(document.edges).filter((edge) => (
    (edge.source.type === 'node' ? visibleNodeIds.has(edge.source.id) : visibleProjectReferenceIds.has(edge.source.id))
    && (edge.target.type === 'node' ? visibleNodeIds.has(edge.target.id) : visibleProjectReferenceIds.has(edge.target.id))
  ));
  const objects = [...nodes, ...projectReferences, ...sections.map((section) => ({
    ...section,
    height: section.collapsed ? 42 : section.height,
  }))];
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

  const { branchColors, presentations } = exportVisuals(document);
  for (const section of sections) {
    const member = nodes.find((node) => node.parentSectionId === section.id);
    const accent = member ? presentations.get(member.id)?.accent ?? '#7775df' : '#7775df';
    const height = section.collapsed ? 42 : section.height;
    const x = section.x - section.width / 2;
    const y = section.y - section.height / 2;
    context.fillStyle = mixMindMapColor(accent, '#ffffff', 0.92);
    context.strokeStyle = accent;
    context.lineWidth = 1;
    context.setLineDash(section.shape === 'cloud' ? [3, 3] : section.shape === 'fill' ? [] : [8, 5]);
    traceMindMapBoundary(context, section.shape, x, y, section.width, height, 14);
    if (section.shape !== 'bracket') context.fill();
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = mixMindMapColor(accent, '#202124', 0.55);
    context.font = '600 13px sans-serif';
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(section.title, x + 14, y + 21);
  }
  const visibleNodesById = new Map(nodes.map((node) => [node.id, node]));
  for (const summary of nodes) {
    const sources = (summary.summarySourceIds ?? []).map((id) => visibleNodesById.get(id)).filter((node): node is typeof summary => Boolean(node));
    const relation = mindMapSummaryConnector(summary, sources);
    if (!relation || sources.length < 2) continue;
    const accent = presentations.get(summary.id)?.accent ?? '#7775df';
    const direction = Math.sign(relation.targetX - relation.sourceX) || 1;
    context.beginPath();
    context.moveTo(relation.sourceX + direction * 10, relation.top);
    context.lineTo(relation.sourceX, relation.top);
    context.lineTo(relation.sourceX, relation.bottom);
    context.lineTo(relation.sourceX + direction * 10, relation.bottom);
    context.moveTo(relation.sourceX, relation.middleY);
    context.lineTo(relation.targetX, relation.middleY);
    context.strokeStyle = accent;
    context.globalAlpha = 0.58;
    context.lineWidth = 2;
    context.stroke();
    context.globalAlpha = 1;
  }
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
    const edgeColor = edge.relationship === 'reference' ? '#b2bac6' : resolveTreeEdgeColor(edge, branchColors);
    context.strokeStyle = edgeColor;
    context.lineWidth = edge.style.width;
    context.setLineDash(edge.relationship === 'reference' || edge.style.dash === 'dashed' ? [7, 5] : []);
    context.stroke();
    context.setLineDash([]);
    if (edge.direction === 'forward' || edge.direction === 'both') {
      drawArrow(context, forwardFrom, points.end, edgeColor);
    }
    if (edge.direction === 'backward' || edge.direction === 'both') {
      drawArrow(context, backwardFrom, points.start, edgeColor);
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
    const presentation = presentations.get(node.id)!;
    context.save();
    context.translate(node.x, node.y);
    context.rotate(node.rotation * Math.PI / 180);
    context.translate(-node.x, -node.y);
    if (presentation.shadow) {
      context.shadowColor = 'rgba(15, 23, 42, 0.12)';
      context.shadowBlur = 14;
      context.shadowOffsetY = 4;
    }
    if (presentation.topic) {
      context.shadowColor = 'transparent';
      context.strokeStyle = presentation.accent;
      context.lineWidth = 1.25;
      context.beginPath();
      context.moveTo(x + 10, y + node.height - 5);
      context.lineTo(x + node.width - 10, y + node.height - 5);
      context.stroke();
    } else {
      context.globalAlpha = node.style.fillOpacity;
      context.fillStyle = presentation.fill;
      context.beginPath();
      context.roundRect(x, y, node.width, node.height, node.style.borderRadius);
      context.fill();
      context.shadowColor = 'transparent';
      context.globalAlpha = 1;
      context.strokeStyle = presentation.border;
      context.lineWidth = Math.min(1, node.style.borderWidth);
      context.setLineDash(node.style.borderStyle === 'dashed' ? [7, 5] : []);
      context.stroke();
      context.setLineDash([]);
    }
    context.fillStyle = presentation.text;
    context.font = `${presentation.fontWeight} ${presentation.fontSize}px sans-serif`;
    context.textAlign = node.style.textAlign;
    context.textBaseline = 'middle';
    const label = `${node.icon ? `${node.icon} ` : ''}${node.type === 'url' ? 'URL · ' : ''}${node.text}`;
    const lines = wrapNodeText(context, label, Math.max(10, node.width - 32));
    const lineHeight = presentation.fontSize * node.style.lineHeight;
    const textX = node.style.textAlign === 'left'
      ? x + 16
      : node.style.textAlign === 'right'
        ? x + node.width - 16
        : node.x;
    const startY = node.y - (lines.length - 1) * lineHeight / 2;
    lines.forEach((line, index) => context.fillText(line, textX, startY + index * lineHeight));
    const marker = MIND_MAP_MARKER_ICON[node.marker ?? 'none'];
    const status = node.taskStatus === 'none' ? '' : MIND_MAP_TASK_STATUS_ICON[node.taskStatus];
    if (marker || status) {
      context.fillStyle = presentation.accent;
      context.font = '13px sans-serif';
      context.textAlign = 'left';
      context.textBaseline = 'top';
      context.fillText([marker, status].filter(Boolean).join(' '), x + 7, y + 6);
    }
    if (node.priority !== 'none') {
      context.fillStyle = MIND_MAP_PRIORITY_COLOR[node.priority];
      context.beginPath();
      context.roundRect(x + node.width - 30, y + 5, 24, 15, 7);
      context.fill();
      context.fillStyle = '#ffffff';
      context.font = '700 9px sans-serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(MIND_MAP_PRIORITY_LABEL[node.priority], x + node.width - 18, y + 12.5);
    }
    if (node.tags?.length) {
      context.fillStyle = mixMindMapColor(presentation.accent, '#ffffff', 0.28);
      context.font = '600 9px sans-serif';
      context.textAlign = 'right';
      context.textBaseline = 'alphabetic';
      context.fillText(node.tags.slice(0, 2).map((tag) => `#${tag}`).join(' '), x + node.width - 7, y + node.height - (node.progress === null || node.progress === undefined ? 7 : 12));
    }
    if (node.progress !== null && node.progress !== undefined) {
      const width = Math.max(0, node.width - 14);
      context.fillStyle = mindMapColorWithAlpha(presentation.accent, 0.14);
      context.fillRect(x + 7, y + node.height - 5, width, 3);
      context.fillStyle = presentation.accent;
      context.fillRect(x + 7, y + node.height - 5, width * Math.max(0, Math.min(100, node.progress)) / 100, 3);
    }
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

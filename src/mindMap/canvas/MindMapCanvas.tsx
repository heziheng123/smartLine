import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from 'react';
import { CalendarRange, MoreHorizontal, Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { projectPlanningAdapter, projectReferenceSnapshot, useProjectPlanningSnapshot } from '@/projectPlanning/adapter';
import { addDays, diffDays, todayStr } from '@/utils/dateSafe';
import {
  MIND_MAP_SCHEMA_VERSION,
  createMindMapGroup,
  createMindMapNode,
  createMindMapSection,
  createMindMapEdge,
  createMindMapId,
  normalizeMindMapDocument,
  sanitizeMindMapResourceUrl,
  type MindMapDocument,
  type MindMapEdge,
  type MindMapSection,
  type MindMapNode,
  type MindMapNodeType,
  type CanvasObjectRef,
  edgeSourceRef,
  edgeTargetRef,
  edgeTouchesCanvasObject,
  sameCanvasObjectRef,
  type ProjectReferenceCard,
  type TimelineSection,
  type ViewportState,
} from '../model';
import { useMindMapStore } from '../store';
import { mindMapRepository } from '../repository';
import type { MindMapPresence, MindMapRemotePresence } from '../syncCore';
import {
  downloadCanvasPng,
  downloadMindMapPng,
  type MindMapPngScope,
} from '../importExport';
import { alignMindMapNodes, distributeMindMapNodes, layoutMindMapBranch, type TreeDirection } from '../layout';
import { layoutMindMapTreeInWorker } from '../layoutWorkerClient';
import { renderMindMapLatex, renderMindMapMarkdown } from '../richText';
import { MIND_MAP_VISUAL_TOKENS } from '../styles/visualTokens';
import {
  edgeIsHiddenInsideCollapsedSection,
  edgeRenderNodes,
  fitMindMapDocument,
  fitNodes,
  hitNode,
  nodeRect,
  normalizedRect,
  rectContainsRect,
  rectIntersectsRect,
  resolveNodeSectionId,
  viewToWorld,
  visibleWorldRect,
  worldToView,
  zoomCameraAt,
  type Point,
  type Rect,
} from './geometry';
import { MindMapSpatialIndex } from './spatialIndex';
import { buildEdgeRoute, pointOnRoute, type EdgeRoute } from './edgeRouting';
import { connectableObjects, edgeConnectableObjects, hitConnectableObject, resolveConnectableObject, type ConnectableObject } from './connectableObjects';
import { renderMindMapWebGl } from './webglRenderer';
import { projectTimelineItems, timelineProjectionItems, timelineSelectedProjectIds, timelineStatus, timelineUnscheduledItemCount, timelineVisibleItems, type TimelineProjectionItem } from '../timelineProjection';
import { useLifeTimelineSnapshot } from '../timelineProjectionHooks';
import { updateLifePlanningDates } from '../lifePlanning';
import { buildTimelineTicks, createTimelineCoordinates, dateToX, formatTimelineRange, recommendedTimelineHeight, resizeTimelineRect, timelineScaleLabel } from '../timelineLayout';
import { mindMapNodeThemeColor, resolveBranchThemeColors, resolveTreeEdgeColor } from '../visualTheme';
import 'katex/dist/katex.min.css';
import styles from './MindMapCanvas.module.css';

interface MindMapCanvasProps {
  document: MindMapDocument;
  assetRevision?: number;
  onScaleChange?: (scale: number) => void;
  fitRequest?: number;
  treeLayoutRequest?: number;
  treeDirection?: TreeDirection;
  onLayoutRunningChange?: (running: boolean) => void;
  pngRequest?: number;
  pngScope?: MindMapPngScope;
  onSelectionChange?: (selectedNodeCount: number) => void;
  creationType?: MindMapNodeType;
  connectionMode?: boolean;
  onConnectionModeChange?: (active: boolean) => void;
  remotePresences?: MindMapRemotePresence[];
  onPresenceChange?: (patch: Partial<Pick<MindMapPresence, 'cursor' | 'draggingId' | 'editingId'>>) => void;
}

type ResizeCorner = 'nw' | 'ne' | 'se' | 'sw';

type Interaction =
  | {
    type: 'pan';
    pointerId: number;
    startView: Point;
    startCamera: ViewportState;
  }
  | {
    type: 'drag';
    pointerId: number;
    startWorld: Point;
    currentWorld: Point;
    initial: Record<string, Point>;
  }
  | {
    type: 'section-drag';
    pointerId: number;
    sectionId: string;
    startWorld: Point;
    currentWorld: Point;
    initialSection: Point;
    initialNodes: Record<string, Point>;
  }
  | {
    type: 'section-resize';
    pointerId: number;
    sectionId: string;
    startWorld: Point;
    currentWorld: Point;
    initialSection: Pick<MindMapSection, 'x' | 'y' | 'width' | 'height'>;
  }
  | {
    type: 'project-reference-drag';
    pointerId: number;
    referenceId: string;
    startWorld: Point;
    currentWorld: Point;
    initial: Point;
  }
  | {
    type: 'timeline-drag';
    pointerId: number;
    timelineId: string;
    startWorld: Point;
    currentWorld: Point;
    initial: Point;
  }
  | {
    type: 'timeline-resize';
    pointerId: number;
    timelineId: string;
    startWorld: Point;
    currentWorld: Point;
    initial: Pick<TimelineSection, 'x' | 'y' | 'width' | 'height'>;
  }
  | {
    type: 'resize';
    pointerId: number;
    nodeId: string;
    startWorld: Point;
    currentWorld: Point;
    corner: ResizeCorner;
    x: number;
    y: number;
    width: number;
    height: number;
    rotation: number;
  }
  | {
    type: 'marquee';
    pointerId: number;
    startWorld: Point;
    currentWorld: Point;
  }
  | {
    type: 'connect';
    pointerId: number;
    source: CanvasObjectRef;
    sourcePoint: Point;
    currentWorld: Point;
  }
  | {
    type: 'create-child';
    pointerId: number;
    parentId: string;
    startWorld: Point;
    currentWorld: Point;
  }
  | {
    type: 'reconnect';
    pointerId: number;
    edgeId: string;
    endpoint: 'source' | 'target';
    currentWorld: Point;
  }
  | {
    type: 'edge-control';
    pointerId: number;
    edgeId: string;
    controlIndex: number;
    currentWorld: Point;
  }
  | null;

interface EditingSession {
  nodeId: string | null;
  connectFromId?: string;
  treePlacement?: 'auto' | 'manual';
  x: number;
  y: number;
  width: number;
  height: number;
  draft: string;
  newNodeType?: MindMapNodeType;
}

interface ClipboardGraph {
  nodes: MindMapNode[];
  projectReferences: ProjectReferenceCard[];
  edges: MindMapEdge[];
}

type TimelineVisibility = {
  stages: boolean;
  milestones: boolean;
  progress: boolean;
  today: boolean;
};

const DEFAULT_TIMELINE_VISIBILITY: TimelineVisibility = {
  stages: true,
  milestones: true,
  progress: true,
  today: true,
};

interface ContextMenuState {
  x: number;
  y: number;
  world: Point;
  nodeId?: string;
  edgeId?: string;
  projectReferenceId?: string;
}

interface PinchState {
  distance: number;
  midpoint: Point;
  camera: ViewportState;
}

interface TimelineTaskInteraction {
  pointerId: number;
  itemId: string;
  source: 'project' | 'life';
  mode: 'move' | 'start' | 'end';
  startClientX: number;
  width: number;
  rangeDays: number;
  start: string;
  end: string;
  deltaDays: number;
}

interface ProjectDateUndo {
  taskId: string;
  start: string;
  end: string;
}

const HANDLE_RADIUS = 5;
const NODE_ACTION_OFFSET = 16;
const NODE_ACTION_SPACING = 24;
const NODE_COLLAPSE_OFFSET = 14;
const MINIMAP_WIDTH = 144;
const MINIMAP_HEIGHT = 90;
const CLIPBOARD_PREFIX = 'smart-line-mind-map-clipboard:';

const relationHandlePoint = (object: ConnectableObject): Point => ({
  x: object.bounds.x + object.bounds.width + 12,
  y: object.bounds.y + object.bounds.height / 2,
});
const rotateNodePoint = (node: MindMapNode, point: Point): Point => {
  const radians = node.rotation * Math.PI / 180;
  const x = point.x - node.x;
  const y = point.y - node.y;
  return { x: node.x + x * Math.cos(radians) - y * Math.sin(radians), y: node.y + x * Math.sin(radians) + y * Math.cos(radians) };
};
const nodeActionHandlePoint = (node: MindMapNode, scale: number, slot: -1 | 0 | 1): Point => rotateNodePoint(node, {
  x: node.x + slot * NODE_ACTION_SPACING / scale,
  y: node.y - node.height / 2 - NODE_ACTION_OFFSET / scale,
});
const childHandlePoint = (node: MindMapNode, scale: number): Point => nodeActionHandlePoint(node, scale, -1);
const relationHandlePointForNode = (node: MindMapNode, scale: number): Point => nodeActionHandlePoint(node, scale, 0);
const moreHandlePoint = (node: MindMapNode, scale: number): Point => nodeActionHandlePoint(node, scale, 1);
const collapseHandlePoint = (node: MindMapNode, scale: number): Point => rotateNodePoint(node, {
  x: node.x - node.width / 2 - NODE_COLLAPSE_OFFSET / scale,
  y: node.y,
});

const drawCanvasAction = (
  context: CanvasRenderingContext2D,
  point: Point,
  icon: string,
  primary = false,
  size = 20,
) => {
  const half = size / 2;
  context.save();
  context.fillStyle = primary ? MIND_MAP_VISUAL_TOKENS.color.accentSoft : 'rgba(255,255,255,0.01)';
  context.strokeStyle = primary ? 'rgba(91, 91, 214, 0.22)' : 'rgba(91, 91, 214, 0.08)';
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(point.x - half, point.y - half, size, size, Math.min(7, half));
  context.fill();
  context.stroke();
  context.fillStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
  context.font = `650 ${icon === '•••' ? 10 : 13}px ${MIND_MAP_VISUAL_TOKENS.typography.ui}`;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(icon, point.x, point.y + (icon === '•••' ? -1 : 0.5));
  context.restore();
};

const drawNodeActionRail = (context: CanvasRenderingContext2D, points: Point[]) => {
  if (points.length === 0) return;
  const left = Math.min(...points.map((point) => point.x)) - 12;
  const right = Math.max(...points.map((point) => point.x)) + 12;
  const top = Math.min(...points.map((point) => point.y)) - 12;
  context.save();
  context.shadowColor = 'rgba(27, 31, 39, 0.07)';
  context.shadowBlur = 6;
  context.shadowOffsetY = 2;
  context.fillStyle = 'rgba(255,255,255,0.96)';
  context.strokeStyle = 'rgba(32,33,36,0.10)';
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(left, top, right - left, 24, 8);
  context.fill();
  context.shadowColor = 'transparent';
  context.stroke();
  context.restore();
};

const nodeSupportsManualResize = (node: MindMapNode) => node.sizeMode === 'manual' || node.type === 'image';

interface NodePresentation {
  accent: string;
  fill: string;
  border: string;
  text: string;
  fontSize: number;
  fontWeight: number;
  shadow: boolean;
  topic: boolean;
}

const parseHexColor = (color: string) => {
  const value = color.trim().replace('#', '');
  const expanded = value.length === 3 ? value.split('').map((character) => character + character).join('') : value;
  if (!/^[0-9a-f]{6}$/i.test(expanded)) return null;
  return [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16));
};

const mixHexColor = (source: string, target: string, targetRatio: number) => {
  const from = parseHexColor(source);
  const to = parseHexColor(target);
  if (!from || !to) return source;
  const ratio = Math.max(0, Math.min(1, targetRatio));
  return `#${from.map((channel, index) => Math.round(channel + (to[index] - channel) * ratio).toString(16).padStart(2, '0')).join('')}`;
};

const colorWithAlpha = (color: string, alpha: number) => {
  const channels = parseHexColor(color);
  return channels ? `rgba(${channels.join(',')},${alpha})` : `rgba(91,91,214,${alpha})`;
};

const resolveNodePresentation = (node: MindMapNode, depth: number, accent: string): NodePresentation => {
  const textColor = ['#1d1d1f', '#202124'].includes(node.style.textColor.toLowerCase())
    ? null
    : node.style.textColor;
  const topic = depth > 1
    && node.type === 'text'
    && ['#fff', '#ffffff'].includes(node.style.fill.toLowerCase())
    && node.style.borderColor.toLowerCase() === '#d9dce3'
    && !node.style.shadow;
  if (depth === 0) return {
    accent,
    fill: mixHexColor(accent, '#ffffff', 0.68),
    border: mixHexColor(accent, '#ffffff', 0.34),
    text: textColor ?? mixHexColor(accent, '#202124', 0.62),
    fontSize: Math.max(16, node.style.fontSize),
    fontWeight: Math.max(650, node.style.fontWeight),
    shadow: node.style.shadow,
    topic: false,
  };
  if (depth === 1) return {
    accent,
    fill: mixHexColor(accent, '#ffffff', 0.84),
    border: mixHexColor(accent, '#ffffff', 0.60),
    text: textColor ?? mixHexColor(accent, '#202124', 0.68),
    fontSize: Math.max(14, node.style.fontSize),
    fontWeight: Math.max(560, node.style.fontWeight),
    shadow: false,
    topic: false,
  };
  return {
    accent,
    fill: mixHexColor(accent, '#ffffff', 0.97),
    border: mixHexColor(accent, '#ffffff', 0.86),
    text: textColor ?? mixHexColor(accent, '#202124', 0.78),
    fontSize: node.style.fontSize,
    fontWeight: Math.max(430, Math.min(520, node.style.fontWeight)),
    shadow: false,
    topic,
  };
};

const resizePoints = (node: MindMapNode): Array<{ corner: ResizeCorner; point: Point }> => [
  { corner: 'nw', point: rotateNodePoint(node, { x: node.x - node.width / 2, y: node.y - node.height / 2 }) },
  { corner: 'ne', point: rotateNodePoint(node, { x: node.x + node.width / 2, y: node.y - node.height / 2 }) },
  { corner: 'se', point: rotateNodePoint(node, { x: node.x + node.width / 2, y: node.y + node.height / 2 }) },
  { corner: 'sw', point: rotateNodePoint(node, { x: node.x - node.width / 2, y: node.y + node.height / 2 }) },
];

const resizedNode = (interaction: Extract<Interaction, { type: 'resize' }>) => {
  const horizontal = interaction.corner.includes('e') ? 1 : -1;
  const vertical = interaction.corner.includes('s') ? 1 : -1;
  const radians = interaction.rotation * Math.PI / 180;
  const dx = interaction.currentWorld.x - interaction.startWorld.x;
  const dy = interaction.currentWorld.y - interaction.startWorld.y;
  const localX = dx * Math.cos(radians) + dy * Math.sin(radians);
  const localY = -dx * Math.sin(radians) + dy * Math.cos(radians);
  const width = Math.max(MIND_MAP_VISUAL_TOKENS.node.minWidth, interaction.width + horizontal * localX);
  const height = Math.max(40, interaction.height + vertical * localY);
  const offsetX = horizontal * (width - interaction.width) / 2;
  const offsetY = vertical * (height - interaction.height) / 2;
  return {
    x: interaction.x + offsetX * Math.cos(radians) - offsetY * Math.sin(radians),
    y: interaction.y + offsetX * Math.sin(radians) + offsetY * Math.cos(radians),
    width,
    height,
  };
};

const pointerView = (
  event: ReactPointerEvent<HTMLCanvasElement>,
  canvas: HTMLCanvasElement,
): Point => {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
};

const pointSegmentDistance = (point: Point, start: Point, end: Point) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const ratio = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (start.x + ratio * dx), point.y - (start.y + ratio * dy));
};

function edgeRoute(edge: MindMapEdge, document: MindMapDocument, treeDirection: TreeDirection = 'left-right'): EdgeRoute | null {
  const endpoints = edgeConnectableObjects(document, edge);
  if (!endpoints) return null;
  return buildEdgeRoute(
    endpoints.source.bounds,
    endpoints.target.bounds,
    { kind: edge.relationship === 'tree' ? 'hierarchy' : 'relation', hierarchyDirection: treeDirection },
  );
}

function edgePoints(edge: MindMapEdge, document: MindMapDocument, treeDirection: TreeDirection = 'left-right') {
  const route = edgeRoute(edge, document, treeDirection);
  return route ? { start: route.start, end: route.end } : null;
}

function orthogonalPoints(edge: MindMapEdge, document: MindMapDocument, treeDirection: TreeDirection = 'left-right') {
  const endpoints = edgePoints(edge, document, treeDirection);
  if (!endpoints) return null;
  if (edge.controlPoints.length > 0) return [endpoints.start, ...edge.controlPoints, endpoints.end];
  const middleX = (endpoints.start.x + endpoints.end.x) / 2;
  return [endpoints.start, { x: middleX, y: endpoints.start.y }, { x: middleX, y: endpoints.end.y }, endpoints.end];
}

function hitEdge(point: Point, document: MindMapDocument, tolerance: number, treeDirection: TreeDirection = 'left-right') {
  const edges = Object.values(document.edges);
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    if (edgeIsHiddenInsideCollapsedSection(edge, document)) continue;
    const points = edgePoints(edge, document, treeDirection);
    if (!points) continue;
    if (edge.type === 'straight') {
      if (pointSegmentDistance(point, points.start, points.end) <= tolerance) return edge;
      continue;
    }
    if (edge.type === 'orthogonal') {
      const route = orthogonalPoints(edge, document, treeDirection);
      if (!route) continue;
      for (let routeIndex = 1; routeIndex < route.length; routeIndex += 1) {
        if (pointSegmentDistance(point, route[routeIndex - 1], route[routeIndex]) <= tolerance) return edge;
      }
      continue;
    }
    const route = edgeRoute(edge, document, treeDirection);
    if (!route) continue;
    let previous = route.start;
    for (let step = 1; step <= 16; step += 1) {
      const current = pointOnRoute(route, step / 16);
      if (pointSegmentDistance(point, previous, current) <= tolerance) return edge;
      previous = current;
    }
  }
  return null;
}

function drawArrow(context: CanvasRenderingContext2D, from: Point, to: Point, color: string, size: number) {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  context.beginPath();
  context.moveTo(to.x, to.y);
  context.lineTo(to.x - Math.cos(angle - Math.PI / 6) * size, to.y - Math.sin(angle - Math.PI / 6) * size);
  context.lineTo(to.x - Math.cos(angle + Math.PI / 6) * size, to.y - Math.sin(angle + Math.PI / 6) * size);
  context.closePath();
  context.fillStyle = color;
  context.fill();
}

function wrapText(context: CanvasRenderingContext2D, text: string, maximumWidth: number, maximumLines: number) {
  const paragraphs = text.split('\n');
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const character of paragraph) {
      const candidate = line + character;
      if (line && context.measureText(candidate).width > maximumWidth) {
        lines.push(line);
        line = character;
        if (lines.length >= maximumLines) break;
      } else {
        line = candidate;
      }
    }
    if (lines.length >= maximumLines) break;
    lines.push(line);
    if (lines.length >= maximumLines) break;
  }
  if (lines.length === maximumLines && lines.join('').length < text.replace(/\n/g, '').length) {
    const last = lines[lines.length - 1] ?? '';
    lines[lines.length - 1] = (last.length > 1 ? last.slice(0, -1) : '') + '…';
  }
  return lines;
}

function measuredNodeSize(text: string, node: MindMapNode) {
  const canvas = window.document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return { width: node.width, height: node.height };
  context.font = node.style.fontWeight + ' ' + node.style.fontSize + 'px sans-serif';
  const paragraphs = text.split('\n');
  const longest = Math.max(0, ...paragraphs.map((line) => context.measureText(line).width));
  const width = Math.max(
    MIND_MAP_VISUAL_TOKENS.node.minWidth,
    Math.min(MIND_MAP_VISUAL_TOKENS.node.maxWidth, longest + MIND_MAP_VISUAL_TOKENS.node.paddingX * 2),
  );
  const lines = wrapText(context, text || ' ', width - MIND_MAP_VISUAL_TOKENS.node.paddingX * 2, 20);
  const height = Math.max(48, Math.min(600, lines.length * node.style.fontSize * node.style.lineHeight + 24));
  return { width, height };
}

function previewNode(node: MindMapNode, interaction: Interaction): MindMapNode {
  if (interaction?.type === 'drag') {
    const initial = interaction.initial[node.id];
    if (!initial) return node;
    return {
      ...node,
      x: initial.x + interaction.currentWorld.x - interaction.startWorld.x,
      y: initial.y + interaction.currentWorld.y - interaction.startWorld.y,
    };
  }
  if (interaction?.type === 'section-drag') {
    const initial = interaction.initialNodes[node.id];
    if (!initial) return node;
    return {
      ...node,
      x: initial.x + interaction.currentWorld.x - interaction.startWorld.x,
      y: initial.y + interaction.currentWorld.y - interaction.startWorld.y,
    };
  }
  if (interaction?.type === 'resize' && interaction.nodeId === node.id) {
    return {
      ...node,
      ...resizedNode(interaction),
    };
  }
  return node;
}

const sectionRect = (section: MindMapSection, interaction: Interaction): Rect => {
  if (interaction?.type === 'section-resize' && interaction.sectionId === section.id) {
    const dx = interaction.currentWorld.x - interaction.startWorld.x;
    const dy = interaction.currentWorld.y - interaction.startWorld.y;
    return {
      x: section.x - section.width / 2,
      y: section.y - section.height / 2,
      width: Math.max(160, interaction.initialSection.width + dx),
      height: Math.max(120, interaction.initialSection.height + dy),
    };
  }
  const moving = interaction?.type === 'section-drag' && interaction.sectionId === section.id;
  const dx = moving ? interaction.currentWorld.x - interaction.startWorld.x : 0;
  const dy = moving ? interaction.currentWorld.y - interaction.startWorld.y : 0;
  return {
    x: section.x + dx - section.width / 2,
    y: section.y + dy - section.height / 2,
    width: section.width,
    height: section.collapsed ? 42 : section.height,
  };
};

const hitSection = (point: Point, sections: Record<string, MindMapSection>) => {
  const values = Object.values(sections).reverse();
  return values.find((section) => {
    const rect = sectionRect(section, null);
    return point.x >= rect.x && point.x <= rect.x + rect.width
      && point.y >= rect.y && point.y <= rect.y + rect.height;
  }) ?? null;
};

const previewProjectReference = (reference: ProjectReferenceCard, interaction: Interaction): ProjectReferenceCard => {
  if (interaction?.type !== 'project-reference-drag' || interaction.referenceId !== reference.id) return reference;
  return {
    ...reference,
    x: interaction.initial.x + interaction.currentWorld.x - interaction.startWorld.x,
    y: interaction.initial.y + interaction.currentWorld.y - interaction.startWorld.y,
  };
};

const previewTimeline = (timeline: TimelineSection, interaction: Interaction): TimelineSection => {
  if (interaction?.type === 'timeline-drag' && interaction.timelineId === timeline.id) {
    return {
      ...timeline,
      x: interaction.initial.x + interaction.currentWorld.x - interaction.startWorld.x,
      y: interaction.initial.y + interaction.currentWorld.y - interaction.startWorld.y,
    };
  }
  if (interaction?.type === 'timeline-resize' && interaction.timelineId === timeline.id) {
    return {
      ...timeline,
      ...resizeTimelineRect(
        interaction.initial,
        interaction.currentWorld.x - interaction.startWorld.x,
        interaction.currentWorld.y - interaction.startWorld.y,
      ),
    };
  }
  return timeline;
};

const dateAfter = (start: string, days: number) => {
  const date = new Date(`${start}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

const timelineRange = (timeline: TimelineSection, items: TimelineProjectionItem[]) => {
  const today = todayStr();
  const fallbackDays = timeline.scale === 'week' ? 6 : timeline.scale === 'month' ? 30 : 365;
  const earliestItemStart = items.reduce((earliest, item) => !earliest || item.start < earliest ? item.start : earliest, '');
  const start = (timeline.rangeStart ?? earliestItemStart) || today;
  const end = timeline.rangeEnd
    ?? (items.reduce((latest, item) => item.end > latest ? item.end : latest, '') || dateAfter(start, fallbackDays));
  return { start, end: end >= start ? end : start };
};

const timelineTaskDates = (item: TimelineProjectionItem, edit: TimelineTaskInteraction | null) => {
  const itemId = item.projectTaskId ?? item.lifeItemId;
  if (!itemId || edit?.itemId !== itemId) return { start: item.start, end: item.end };
  const duration = diffDays(edit.end, edit.start);
  const delta = edit.mode === 'start'
    ? Math.min(duration, edit.deltaDays)
    : edit.mode === 'end'
      ? Math.max(-duration, edit.deltaDays)
      : edit.deltaDays;
  return {
    start: edit.mode === 'end' ? edit.start : addDays(edit.start, delta),
    end: edit.mode === 'start' ? edit.end : addDays(edit.end, delta),
  };
};

export default function MindMapCanvas({
  document,
  assetRevision = 0,
  onScaleChange,
  fitRequest = 0,
  treeLayoutRequest = 0,
  treeDirection = 'left-right',
  onLayoutRunningChange,
  pngRequest = 0,
  pngScope = 'viewport',
  onSelectionChange,
  creationType = 'text',
  connectionMode = false,
  onConnectionModeChange,
  remotePresences = [],
  onPresenceChange,
}: MindMapCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const webglCanvasRef = useRef<HTMLCanvasElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const commandInputRef = useRef<HTMLInputElement>(null);
  const minimapRef = useRef<HTMLCanvasElement>(null);
  const minimapBaseRef = useRef<HTMLCanvasElement | null>(null);
  const minimapTransformRef = useRef({ left: 0, top: 0, scale: 1 });
  const spacePressed = useRef(false);
  const composing = useRef(false);
  const cameraSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cameraFrame = useRef<number | null>(null);
  const cameraRef = useRef(document.viewport);
  const interactionFrame = useRef<number | null>(null);
  const interactionRef = useRef<Interaction>(null);
  const presenceCursorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceCursorRef = useRef<Point | null>(null);
  const clipboardRef = useRef<ClipboardGraph | null>(null);
  const richHtmlCacheRef = useRef(new Map<string, { updatedAt: number; html: string }>());
  const handledFitRequest = useRef(0);
  const handledTreeLayoutRequest = useRef(0);
  const layoutGeneration = useRef(0);
  const handledPngRequest = useRef(0);
  const touchPoints = useRef(new Map<number, Point>());
  const pinchRef = useRef<PinchState | null>(null);
  const renderedDocumentId = useRef<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCameraState] = useState(document.viewport);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [selectedProjectReferenceId, setSelectedProjectReferenceId] = useState<string | null>(null);
  const [hoveredProjectReferenceId, setHoveredProjectReferenceId] = useState<string | null>(null);
  const [selectedTimelineId, setSelectedTimelineId] = useState<string | null>(null);
  const [timelineSelectorOpen, setTimelineSelectorOpen] = useState(false);
  const [timelineSelectorSearch, setTimelineSelectorSearch] = useState('');
  const [timelineSelectorFilter, setTimelineSelectorFilter] = useState<'all' | 'selected'>('all');
  const [timelineExpandedGroups, setTimelineExpandedGroups] = useState<Set<string>>(() => new Set());
  const [timelineExpandedProjects, setTimelineExpandedProjects] = useState<Set<string>>(() => new Set());
  const [focusedBranchRootId, setFocusedBranchRootId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null);
  const [connectionSource, setConnectionSource] = useState<CanvasObjectRef | null>(null);
  const [interaction, setInteractionState] = useState<Interaction>(null);
  const [editing, setEditing] = useState<EditingSession | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());
  const [imageAssetUrls, setImageAssetUrls] = useState<Record<string, string>>({});
  const [webglActive, setWebglActive] = useState(false);
  const [timelineTaskInteraction, setTimelineTaskInteraction] = useState<TimelineTaskInteraction | null>(null);
  const [timelineEditError, setTimelineEditError] = useState<string | null>(null);
  const [timelineVisibility, setTimelineVisibility] = useState<Record<string, TimelineVisibility>>({});
  const [projectDateUndo, setProjectDateUndo] = useState<ProjectDateUndo | null>(null);
  const [lifeDateUpdated, setLifeDateUpdated] = useState(false);
  const editingSessionKey = editing ? editing.nodeId ?? 'new' : null;
  const {
    execute,
    createNode,
    updateNode,
    deleteNodes,
    createEdge,
    updateEdge,
    deleteEdges,
    setViewportForDocument,
    undo,
    redo,
    flushSave,
  } = useMindMapStore(useShallow((state) => ({
    execute: state.execute,
    createNode: state.createNode,
    updateNode: state.updateNode,
    deleteNodes: state.deleteNodes,
    createEdge: state.createEdge,
    updateEdge: state.updateEdge,
    deleteEdges: state.deleteEdges,
    setViewportForDocument: state.setViewportForDocument,
    undo: state.undo,
    redo: state.redo,
    flushSave: state.flushSave,
  })));
  const projectPlanning = useProjectPlanningSnapshot();
  const legacyLifeTimeline = useLifeTimelineSnapshot();
  const lifeTimeline = document.lifeMap ?? legacyLifeTimeline;

  const toggleTimelineVisibility = useCallback((timelineId: string, key: keyof TimelineVisibility) => {
    setTimelineVisibility((current) => {
      const value = current[timelineId] ?? DEFAULT_TIMELINE_VISIBILITY;
      return { ...current, [timelineId]: { ...value, [key]: !value[key] } };
    });
  }, []);

  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const treeChildrenById = useMemo(() => {
    const children = new Map<string, string[]>();
    for (const edge of Object.values(document.edges)) {
      if (edge.relationship === 'reference') continue;
      const list = children.get(edge.sourceId) ?? [];
      list.push(edge.targetId);
      children.set(edge.sourceId, list);
    }
    return children;
  }, [document.edges]);
  const branchNodeIds = useCallback((rootId: string) => {
    const ids: string[] = [];
    const pending = [rootId];
    const seen = new Set<string>();
    while (pending.length) {
      const id = pending.pop()!;
      if (seen.has(id) || !document.nodes[id]) continue;
      seen.add(id);
      ids.push(id);
      pending.push(...(treeChildrenById.get(id) ?? []));
    }
    return ids;
  }, [document.nodes, treeChildrenById]);
  const focusedBranchNodeIds = useMemo(() => focusedBranchRootId
    ? new Set(branchNodeIds(focusedBranchRootId))
    : null, [branchNodeIds, focusedBranchRootId]);
  const renderDocument = useMemo(() => {
    if (!focusedBranchNodeIds) return document;
    const nodes = Object.fromEntries(Object.entries(document.nodes).filter(([id]) => focusedBranchNodeIds.has(id)));
    const edges = Object.fromEntries(Object.entries(document.edges).filter(([, edge]) => {
      const source = edgeSourceRef(edge);
      const target = edgeTargetRef(edge);
      return source.type === 'node' && target.type === 'node'
        && focusedBranchNodeIds.has(source.id) && focusedBranchNodeIds.has(target.id);
    }));
    return {
      ...document,
      nodes,
      edges,
      zOrder: document.zOrder.filter((id) => focusedBranchNodeIds.has(id)),
      groups: {},
      sections: {},
      projectReferences: {},
      timelineSections: {},
    };
  }, [document, focusedBranchNodeIds]);
  const hiddenNodeIds = useMemo(() => {
    const hidden = new Set(Object.values(document.nodes)
      .filter((node) => node.parentSectionId && document.sections[node.parentSectionId]?.collapsed)
      .map((node) => node.id));
    const pending = Object.values(document.nodes).filter((node) => node.collapsed).map((node) => node.id);
    while (pending.length) {
      const id = pending.pop()!;
      for (const childId of treeChildrenById.get(id) ?? []) {
        if (!hidden.has(childId)) {
          hidden.add(childId);
          pending.push(childId);
        }
      }
    }
    return hidden;
  }, [document.nodes, document.sections, treeChildrenById]);
  const nodeDepthById = useMemo(() => {
    const depths = new Map<string, number>();
    const childIds = new Set([...treeChildrenById.values()].flat());
    const pending: Array<[string, number]> = Object.keys(document.nodes)
      .filter((id) => !childIds.has(id))
      .map((id) => [id, 0]);
    while (pending.length) {
      const [id, depth] = pending.shift()!;
      if (depths.has(id)) continue;
      depths.set(id, depth);
      for (const childId of treeChildrenById.get(id) ?? []) pending.push([childId, depth + 1]);
    }
    return depths;
  }, [document.nodes, treeChildrenById]);
  const branchThemeColors = useMemo(() => resolveBranchThemeColors(document), [document]);
  const treeEdgePreview = useMemo(() => {
    if (!editing?.connectFromId || editing.nodeId) return null;
    const source = document.nodes[editing.connectFromId];
    if (!source) return null;
    const edge = createMindMapEdge(source.id, '__tree-edge-preview__', {
      id: '__tree-edge-preview__',
      now: 0,
      relationship: 'tree',
    });
    return {
      source,
      edge,
      color: (nodeDepthById.get(source.id) ?? 0) === 0
        ? MIND_MAP_VISUAL_TOKENS.color.accent
        : branchThemeColors.get(source.id) ?? edge.style.color,
      target: {
        x: editing.x - editing.width / 2,
        y: editing.y - editing.height / 2,
        width: editing.width,
        height: editing.height,
      },
    };
  }, [branchThemeColors, document.nodes, editing?.connectFromId, editing?.height, editing?.nodeId, editing?.width, editing?.x, editing?.y, nodeDepthById]);
  const nodePresentationById = useMemo(() => {
    const presentations = new Map<string, NodePresentation>();
    for (const node of Object.values(document.nodes)) {
      const depth = nodeDepthById.get(node.id) ?? 0;
      presentations.set(node.id, resolveNodePresentation(
        node,
        depth,
        branchThemeColors.get(node.id) ?? mindMapNodeThemeColor(node),
      ));
    }
    return presentations;
  }, [branchThemeColors, document.nodes, nodeDepthById]);
  const canvasNodes = useMemo(() => Object.fromEntries(
    Object.entries(renderDocument.nodes).filter(([id]) => !hiddenNodeIds.has(id)),
  ), [hiddenNodeIds, renderDocument.nodes]);
  const visualCanvasNodes = useMemo(() => Object.fromEntries(Object.entries(canvasNodes).map(([id, node]) => {
    const presentation = nodePresentationById.get(id);
    return [id, presentation ? {
      ...node,
      style: {
        ...node.style,
        fill: presentation.fill,
        fillOpacity: presentation.topic ? 0.16 : node.style.fillOpacity,
        borderColor: presentation.border,
        textColor: presentation.text,
      },
    } : node];
  })), [canvasNodes, nodePresentationById]);
  const edgeNodes = useMemo(() => edgeRenderNodes(renderDocument), [renderDocument]);
  const canvasZOrder = useMemo(
    () => renderDocument.zOrder.filter((id) => !hiddenNodeIds.has(id)),
    [hiddenNodeIds, renderDocument.zOrder],
  );
  const spatialIndex = useMemo(() => new MindMapSpatialIndex(Object.values(canvasNodes)), [canvasNodes]);
  const visibleNodes = useMemo(() => spatialIndex.query(visibleWorldRect(size, camera)), [camera, size, spatialIndex]);
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleZOrder = useMemo(() => canvasZOrder.filter((id) => visibleNodeIds.has(id)), [canvasZOrder, visibleNodeIds]);
  const visibleProjectReferences = useMemo(() => {
    const viewport = visibleWorldRect(size, camera);
    return Object.values(renderDocument.projectReferences).filter((reference) => rectIntersectsRect(viewport, {
      x: reference.x - reference.width / 2,
      y: reference.y - reference.height / 2,
      width: reference.width,
      height: reference.height,
    }));
  }, [camera, renderDocument.projectReferences, size]);
  const visibleTimelines = useMemo(() => {
    const viewport = visibleWorldRect(size, camera);
    return Object.values(renderDocument.timelineSections).filter((timeline) => rectIntersectsRect(viewport, {
      x: timeline.x - timeline.width / 2,
      y: timeline.y - timeline.height / 2,
      width: timeline.width,
      height: timeline.collapsed ? 46 : timeline.height,
    }));
  }, [camera, renderDocument.timelineSections, size]);
  const hitIndexedNode = useCallback((point: Point) => {
    const candidates = spatialIndex.query({ x: point.x - 1, y: point.y - 1, width: 2, height: 2 });
    const ids = new Set(candidates.map((node) => node.id));
    return hitNode(point, Object.fromEntries(candidates.map((node) => [node.id, node])), canvasZOrder.filter((id) => ids.has(id)));
  }, [canvasZOrder, spatialIndex]);

  useEffect(() => {
    const cache = richHtmlCacheRef.current;
    for (const id of cache.keys()) {
      const node = document.nodes[id];
      if (!node || (node.type !== 'markdown' && node.type !== 'latex')) cache.delete(id);
    }
  }, [document.nodes]);
  const connectables = useMemo(() => connectableObjects(renderDocument), [renderDocument]);
  const hitConnectable = useCallback((point: Point) => hitConnectableObject(connectables, point), [connectables]);

  useEffect(() => {
    onSelectionChange?.(selectedNodeIds.length);
  }, [onSelectionChange, selectedNodeIds.length]);

  useEffect(() => {
    if (!connectionMode) {
      setConnectionSource(null);
      return;
    }
    if (selectedNodeIds.length === 1) setConnectionSource({ type: 'node', id: selectedNodeIds[0] });
    else if (selectedProjectReferenceId) setConnectionSource({ type: 'project-reference', id: selectedProjectReferenceId });
  }, [connectionMode, selectedNodeIds, selectedProjectReferenceId]);

  const setInteraction = useCallback((next: Interaction) => {
    interactionRef.current = next;
    if (interactionFrame.current !== null) {
      cancelAnimationFrame(interactionFrame.current);
      interactionFrame.current = null;
    }
    setInteractionState(next);
  }, []);

  const scheduleInteraction = useCallback((next: Interaction) => {
    interactionRef.current = next;
    if (interactionFrame.current !== null) return;
    interactionFrame.current = requestAnimationFrame(() => {
      interactionFrame.current = null;
      setInteractionState(interactionRef.current);
    });
  }, []);

  const publishCursor = useCallback((cursor: Point | null, immediate = false) => {
    presenceCursorRef.current = cursor;
    if (immediate) {
      if (presenceCursorTimer.current) clearTimeout(presenceCursorTimer.current);
      presenceCursorTimer.current = null;
      onPresenceChange?.({ cursor });
      return;
    }
    if (presenceCursorTimer.current) return;
    presenceCursorTimer.current = setTimeout(() => {
      presenceCursorTimer.current = null;
      onPresenceChange?.({ cursor: presenceCursorRef.current });
    }, 50);
  }, [onPresenceChange]);

  const updateCamera = useCallback((next: ViewportState, immediate = false) => {
    cameraRef.current = next;
    if (immediate) {
      if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
      cameraFrame.current = null;
      setCameraState(next);
      onScaleChange?.(next.scale);
    } else if (cameraFrame.current === null) {
      cameraFrame.current = requestAnimationFrame(() => {
        cameraFrame.current = null;
        setCameraState(cameraRef.current);
        onScaleChange?.(cameraRef.current.scale);
      });
    }
    if (cameraSaveTimer.current) clearTimeout(cameraSaveTimer.current);
    if (immediate) {
      cameraSaveTimer.current = null;
      setViewportForDocument(document.id, next);
    } else {
      cameraSaveTimer.current = setTimeout(() => {
        cameraSaveTimer.current = null;
        setViewportForDocument(document.id, next);
      }, 180);
    }
  }, [document.id, onScaleChange, setViewportForDocument]);

  useEffect(() => {
    if (renderedDocumentId.current === document.id) return;
    renderedDocumentId.current = document.id;
    const next = document.viewport;
    cameraRef.current = next;
    setCameraState(next);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setSelectedSectionId(null);
    setSelectedProjectReferenceId(null);
    setSelectedTimelineId(null);
    setFocusedBranchRootId(null);
    setInteraction(null);
    setEditing(null);
    onScaleChange?.(next.scale);
  }, [document.id, document.viewport, onScaleChange, setInteraction]);

  useEffect(() => {
    if (focusedBranchRootId && !document.nodes[focusedBranchRootId]) setFocusedBranchRootId(null);
  }, [document.nodes, focusedBranchRootId]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      setSize({
        width: Math.max(1, Math.floor(entry.contentRect.width)),
        height: Math.max(1, Math.floor(entry.contentRect.height)),
      });
    });
    observer.observe(surface);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => {
    if (cameraFrame.current !== null) cancelAnimationFrame(cameraFrame.current);
    if (interactionFrame.current !== null) cancelAnimationFrame(interactionFrame.current);
    if (presenceCursorTimer.current) clearTimeout(presenceCursorTimer.current);
    if (cameraSaveTimer.current) clearTimeout(cameraSaveTimer.current);
    setViewportForDocument(renderedDocumentId.current ?? document.id, cameraRef.current);
  }, [document.id, setViewportForDocument]);

  useEffect(() => {
    if (!editingSessionKey) return;
    editorRef.current?.focus();
    const end = editorRef.current?.value.length ?? 0;
    editorRef.current?.setSelectionRange(end, end);
  }, [editingSessionKey]);

  const imageAssetKey = useMemo(() => Object.values(document.nodes)
    .map((node) => node.imageAssetId)
    .filter((id): id is string => Boolean(id))
    .sort()
    .join('|'), [document.nodes]);

  useEffect(() => {
    let cancelled = false;
    const urls: Record<string, string> = {};
    void Promise.all([...new Set(imageAssetKey.split('|').filter(Boolean))].map(async (id) => {
      const asset = await mindMapRepository.loadImageAsset(id);
      if (asset && !cancelled) urls[id] = URL.createObjectURL(asset.blob);
    })).then(() => {
      if (!cancelled) setImageAssetUrls(urls);
      else Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    });
    return () => {
      cancelled = true;
      Object.values(urls).forEach((url) => URL.revokeObjectURL(url));
    };
  }, [assetRevision, imageAssetKey]);

  useEffect(() => {
    if (!contextMenu) return;
    contextMenuRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
  }, [contextMenu]);

  useEffect(() => {
    if (commandOpen) commandInputRef.current?.focus();
  }, [commandOpen]);

  let presenceDraggingId: string | null = null;
  if (interaction?.type === 'drag') presenceDraggingId = selectedNodeIds[0] ?? null;
  else if (interaction?.type === 'project-reference-drag') presenceDraggingId = interaction.referenceId;
  else if (interaction?.type === 'timeline-drag') presenceDraggingId = interaction.timelineId;
  else if (interaction?.type === 'timeline-resize') presenceDraggingId = interaction.timelineId;
  else if (interaction?.type === 'section-drag' || interaction?.type === 'section-resize') presenceDraggingId = interaction.sectionId;
  else if (interaction?.type === 'resize') presenceDraggingId = interaction.nodeId;
  else if (interaction?.type === 'connect') presenceDraggingId = interaction.source.id;
  else if (interaction?.type === 'reconnect' || interaction?.type === 'edge-control') presenceDraggingId = interaction.edgeId;

  useEffect(() => {
    onPresenceChange?.({ draggingId: presenceDraggingId, editingId: editing?.nodeId ?? null });
  }, [editing?.nodeId, onPresenceChange, presenceDraggingId]);

  useEffect(() => {
    const nodes = Object.values(canvasNodes);
    const logicalWidth = MINIMAP_WIDTH;
    const logicalHeight = MINIMAP_HEIGHT;
    const ratio = window.devicePixelRatio || 1;
    const base = window.document.createElement('canvas');
    base.width = logicalWidth * ratio;
    base.height = logicalHeight * ratio;
    const context = base.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.fillStyle = MIND_MAP_VISUAL_TOKENS.color.surface;
    context.fillRect(0, 0, logicalWidth, logicalHeight);
    if (nodes.length === 0) {
      minimapBaseRef.current = base;
      minimapTransformRef.current = { left: 0, top: 0, scale: 1 };
      return;
    }
    const left = Math.min(...nodes.map((node) => node.x - node.width / 2));
    const top = Math.min(...nodes.map((node) => node.y - node.height / 2));
    const right = Math.max(...nodes.map((node) => node.x + node.width / 2));
    const bottom = Math.max(...nodes.map((node) => node.y + node.height / 2));
    const scale = Math.min((logicalWidth - 16) / Math.max(1, right - left), (logicalHeight - 16) / Math.max(1, bottom - top));
    const offsetX = 8 + (logicalWidth - 16 - (right - left) * scale) / 2;
    const offsetY = 8 + (logicalHeight - 16 - (bottom - top) * scale) / 2;
    minimapTransformRef.current = { left: left - offsetX / scale, top: top - offsetY / scale, scale };
    for (const node of nodes) {
      context.fillStyle = nodePresentationById.get(node.id)?.fill ?? node.style.fill;
      context.fillRect(offsetX + (node.x - node.width / 2 - left) * scale, offsetY + (node.y - node.height / 2 - top) * scale, Math.max(2, node.width * scale), Math.max(2, node.height * scale));
    }
    minimapBaseRef.current = base;
  }, [canvasNodes, nodePresentationById]);

  useEffect(() => {
    const minimap = minimapRef.current;
    const base = minimapBaseRef.current;
    if (!minimap || !base) return;
    const logicalWidth = MINIMAP_WIDTH;
    const logicalHeight = MINIMAP_HEIGHT;
    const ratio = window.devicePixelRatio || 1;
    minimap.width = logicalWidth * ratio;
    minimap.height = logicalHeight * ratio;
    const context = minimap.getContext('2d');
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, logicalWidth, logicalHeight);
    context.drawImage(base, 0, 0, logicalWidth, logicalHeight);
    const visible = visibleWorldRect(size, camera);
    const { scale } = minimapTransformRef.current;
    context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
    context.lineWidth = MIND_MAP_VISUAL_TOKENS.edge.width;
    context.strokeRect(
      (visible.x - minimapTransformRef.current.left) * scale,
      (visible.y - minimapTransformRef.current.top) * scale,
      visible.width * scale,
      visible.height * scale,
    );
  }, [camera, canvasNodes, size]);

  useEffect(() => {
    const canvas = webglCanvasRef.current;
    if (!canvas || Object.keys(canvasNodes).length < 2_500) {
      setWebglActive(false);
      return;
    }
    setWebglActive(renderMindMapWebGl(canvas, renderDocument, visualCanvasNodes, edgeNodes, hiddenNodeIds, treeDirection, camera, size));
  }, [camera, canvasNodes, edgeNodes, hiddenNodeIds, renderDocument, size, treeDirection, visualCanvasNodes]);

  // Timeline interactions are rendered by their own DOM surface. Keeping them out of
  // the canvas draw dependency prevents a full-map redraw on every resize frame.
  const canvasInteraction = interaction?.type === 'timeline-drag' || interaction?.type === 'timeline-resize'
    ? null
    : interaction;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return;
    const frame = requestAnimationFrame(() => {
      const ratio = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(size.width * ratio));
      const height = Math.max(1, Math.floor(size.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      canvas.style.width = size.width + 'px';
      canvas.style.height = size.height + 'px';
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, size.width, size.height);
      if (!webglActive) {
        context.fillStyle = document.settings.background === '#f9f9fb'
          ? MIND_MAP_VISUAL_TOKENS.color.canvas
          : document.settings.background;
        context.fillRect(0, 0, size.width, size.height);
      }

      if (document.settings.grid !== 'none') {
        const spacing = 24 * camera.scale;
        if (spacing >= 8) {
          const offsetX = ((camera.x % spacing) + spacing) % spacing;
          const offsetY = ((camera.y % spacing) + spacing) % spacing;
          context.fillStyle = MIND_MAP_VISUAL_TOKENS.canvas.gridDot;
          for (let x = offsetX; x < size.width; x += spacing) {
            for (let y = offsetY; y < size.height; y += spacing) {
              if (document.settings.grid === 'dots') context.fillRect(x - 0.6, y - 0.6, 1.2, 1.2);
            }
          }
          if (document.settings.grid === 'lines') {
            context.beginPath();
            for (let x = offsetX; x < size.width; x += spacing) {
              context.moveTo(x, 0);
              context.lineTo(x, size.height);
            }
            for (let y = offsetY; y < size.height; y += spacing) {
              context.moveTo(0, y);
              context.lineTo(size.width, y);
            }
            context.strokeStyle = MIND_MAP_VISUAL_TOKENS.canvas.gridLine;
            context.lineWidth = 1;
            context.stroke();
          }
        }
      }

      const renderNodeIds = new Set([...visibleNodeIds, ...selectedNodeIds]);
      const previewNodes: Record<string, MindMapNode> = {};
      for (const id of renderNodeIds) {
        const node = canvasNodes[id];
        if (node) previewNodes[id] = previewNode(node, canvasInteraction);
      }
      const previewsNodeGeometry = canvasInteraction?.type === 'drag'
        || canvasInteraction?.type === 'resize'
        || canvasInteraction?.type === 'section-drag'
        || canvasInteraction?.type === 'section-resize';
      const previewEdgeNodes = previewsNodeGeometry
        ? edgeRenderNodes({ ...renderDocument, nodes: { ...renderDocument.nodes, ...previewNodes } })
        : edgeNodes;
      const movingReference = canvasInteraction?.type === 'project-reference-drag'
        ? document.projectReferences[canvasInteraction.referenceId]
        : null;
      const previewReference = movingReference ? previewProjectReference(movingReference, canvasInteraction) : null;
      const edgeDocument = (previewsNodeGeometry || previewReference)
        ? {
            ...renderDocument,
            nodes: { ...renderDocument.nodes, ...previewEdgeNodes },
            projectReferences: previewReference ? { ...renderDocument.projectReferences, [previewReference.id]: previewReference } : renderDocument.projectReferences,
          }
        : renderDocument;
      const visible = visibleWorldRect(size, camera);

      for (const section of Object.values(renderDocument.sections)) {
        const rect = sectionRect(section, canvasInteraction);
        if (!rectIntersectsRect(visible, rect)) continue;
        const topLeft = worldToView({ x: rect.x, y: rect.y }, camera);
        const width = rect.width * camera.scale;
        const height = rect.height * camera.scale;
        context.save();
        context.globalAlpha = section.collapsed ? 0.09 : 0.035;
        context.fillStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
        context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
        context.lineWidth = selectedSectionId === section.id ? 2 : 1;
        context.setLineDash([8, 5]);
        context.beginPath();
        context.roundRect(topLeft.x, topLeft.y, width, height, 14 * camera.scale);
        context.fill();
        context.globalAlpha = selectedSectionId === section.id ? 1 : 0.42;
        context.stroke();
        context.globalAlpha = 1;
        context.setLineDash([]);
        context.fillStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
        context.font = '600 ' + Math.max(10, 13 * camera.scale) + 'px sans-serif';
        context.textAlign = 'left';
        context.textBaseline = 'middle';
        context.fillText((section.collapsed ? '▸ ' : '▾ ') + section.title, topLeft.x + 14 * camera.scale, topLeft.y + 20 * camera.scale);
        context.restore();
      }

      if (selectedSectionId && document.sections[selectedSectionId]) {
        const rect = sectionRect(document.sections[selectedSectionId], canvasInteraction);
        const handle = worldToView({ x: rect.x + rect.width, y: rect.y + rect.height }, camera);
        context.fillStyle = '#ffffff';
        context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
        context.lineWidth = 2;
        context.fillRect(handle.x - 6, handle.y - 6, 12, 12);
        context.strokeRect(handle.x - 6, handle.y - 6, 12, 12);
      }

      for (const group of Object.values(renderDocument.groups)) {
        const members = group.memberIds.map((id) => previewNodes[id]).filter((node): node is MindMapNode => Boolean(node));
        if (members.length === 0) continue;
        const left = Math.min(...members.map((node) => node.x - node.width / 2)) - 14;
        const top = Math.min(...members.map((node) => node.y - node.height / 2)) - 14;
        const right = Math.max(...members.map((node) => node.x + node.width / 2)) + 14;
        const bottom = Math.max(...members.map((node) => node.y + node.height / 2)) + 14;
        const rect = { x: left, y: top, width: right - left, height: bottom - top };
        if (!rectIntersectsRect(visible, rect)) continue;
        const topLeft = worldToView({ x: left, y: top }, camera);
        context.save();
        context.strokeStyle = 'rgba(10, 132, 255, 0.48)';
        context.lineWidth = 1.5;
        context.setLineDash([4, 4]);
        context.strokeRect(topLeft.x, topLeft.y, rect.width * camera.scale, rect.height * camera.scale);
        context.setLineDash([]);
        context.fillStyle = '#0879c9';
        context.font = '600 ' + Math.max(9, 11 * camera.scale) + 'px sans-serif';
        context.textAlign = 'left';
        context.textBaseline = 'bottom';
        context.fillText(group.title, topLeft.x + 5, topLeft.y - 3);
        context.restore();
      }

      for (const edge of webglActive ? [] : Object.values(renderDocument.edges)) {
        if (edgeIsHiddenInsideCollapsedSection(edge, document)) continue;
        if ((edgeSourceRef(edge).type === 'node' && hiddenNodeIds.has(edgeSourceRef(edge).id))
          || (edgeTargetRef(edge).type === 'node' && hiddenNodeIds.has(edgeTargetRef(edge).id))) continue;
        const renderedEdge = canvasInteraction?.type === 'edge-control' && canvasInteraction.edgeId === edge.id
          ? {
              ...edge,
              controlPoints: edge.controlPoints.map((point, index) => index === canvasInteraction.controlIndex ? canvasInteraction.currentWorld : point),
            }
          : edge;
        const points = edgePoints(renderedEdge, edgeDocument, treeDirection);
        if (!points) continue;
        const bezier = edgeRoute(renderedEdge, edgeDocument, treeDirection);
        const routeWorld = edge.type === 'orthogonal'
          ? orthogonalPoints(renderedEdge, edgeDocument, treeDirection) ?? [points.start, points.end]
          : [points.start, points.end];
        const routeBounds = edge.type === 'curve' && bezier
          ? [bezier.start, bezier.control1, bezier.control2, bezier.end]
          : routeWorld;
        const edgeBounds = {
          x: Math.min(...routeBounds.map((point) => point.x)),
          y: Math.min(...routeBounds.map((point) => point.y)),
          width: Math.max(...routeBounds.map((point) => point.x)) - Math.min(...routeBounds.map((point) => point.x)),
          height: Math.max(...routeBounds.map((point) => point.y)) - Math.min(...routeBounds.map((point) => point.y)),
        };
        edgeBounds.x -= 40;
        edgeBounds.y -= 40;
        edgeBounds.width += 80;
        edgeBounds.height += 80;
        if (!rectIntersectsRect(visible, edgeBounds)) continue;
        const start = worldToView(bezier?.start ?? points.start, camera);
        const end = worldToView(bezier?.end ?? points.end, camera);
        context.beginPath();
        context.moveTo(start.x, start.y);
        let arrowFrom = start;
        let backwardFrom = end;
        if (edge.type === 'curve' && bezier) {
          const control1 = worldToView(bezier.control1, camera);
          const control2 = worldToView(bezier.control2, camera);
          context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
          arrowFrom = control2;
          backwardFrom = control1;
        } else if (edge.type === 'orthogonal') {
          const route = routeWorld.map((point) => worldToView(point, camera));
          for (const point of route.slice(1)) context.lineTo(point.x, point.y);
          arrowFrom = route.at(-2) ?? start;
          backwardFrom = route[1] ?? end;
        } else {
          context.lineTo(end.x, end.y);
        }
        const edgeSelected = selectedEdgeIds.includes(edge.id);
        const edgeHovered = hoveredEdgeId === edge.id;
        context.strokeStyle = edgeSelected
          ? MIND_MAP_VISUAL_TOKENS.color.accent
          : edge.relationship === 'reference' ? '#b2bac6' : resolveTreeEdgeColor(edge, branchThemeColors);
        const edgeWidth = edge.style.width === 2 ? MIND_MAP_VISUAL_TOKENS.edge.width : edge.style.width;
        context.globalAlpha = edge.relationship === 'reference'
          ? edgeSelected ? 1 : edgeHovered ? 0.82 : 0.62
          : 1;
        context.lineWidth = edge.relationship === 'reference'
          ? edgeSelected ? 1.7 : edgeHovered ? 1.45 : 1.15
          : Math.max(1, edgeWidth * camera.scale);
        context.setLineDash(edge.relationship === 'reference' || edge.style.dash === 'dashed' ? [4, 5] : []);
        context.stroke();
        context.setLineDash([]);
        const arrowSize = Math.max(5, MIND_MAP_VISUAL_TOKENS.edge.arrowSize * camera.scale);
        if (edge.direction === 'forward' || edge.direction === 'both') {
          drawArrow(context, arrowFrom, end, context.strokeStyle as string, arrowSize);
        }
        if (edge.direction === 'backward' || edge.direction === 'both') {
          drawArrow(context, backwardFrom, start, context.strokeStyle as string, arrowSize);
        }
        context.globalAlpha = 1;
        if (edge.label && camera.scale >= 0.35) {
          const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 - 6 };
          context.font = '500 ' + Math.max(10, 12 * camera.scale) + 'px sans-serif';
          const textWidth = context.measureText(edge.label).width;
          context.fillStyle = 'rgba(255,255,255,0.92)';
          context.fillRect(midpoint.x - textWidth / 2 - 4, midpoint.y - 11, textWidth + 8, 17);
          context.fillStyle = '#4a4a4f';
          context.textAlign = 'center';
          context.textBaseline = 'middle';
          context.fillText(edge.label, midpoint.x, midpoint.y - 2);
        }
      }

      if (treeEdgePreview && !hiddenNodeIds.has(treeEdgePreview.source.id)) {
        const route = buildEdgeRoute(nodeRect(treeEdgePreview.source), treeEdgePreview.target, {
          kind: 'hierarchy',
          hierarchyDirection: treeDirection,
        });
        const start = worldToView(route.start, camera);
        const control1 = worldToView(route.control1, camera);
        const control2 = worldToView(route.control2, camera);
        const end = worldToView(route.end, camera);
        context.save();
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
        context.strokeStyle = treeEdgePreview.color;
        const edgeWidth = treeEdgePreview.edge.style.width === 2
          ? MIND_MAP_VISUAL_TOKENS.edge.width
          : treeEdgePreview.edge.style.width;
        context.lineWidth = Math.max(1, edgeWidth * camera.scale);
        context.setLineDash(treeEdgePreview.edge.style.dash === 'dashed' ? [4, 5] : []);
        context.stroke();
        context.restore();
      }

      if (canvasInteraction?.type === 'connect') {
        const source = resolveConnectableObject(edgeDocument, canvasInteraction.source);
        if (source) {
          const previewRoute = buildEdgeRoute(
            source.bounds,
            { x: canvasInteraction.currentWorld.x - 1, y: canvasInteraction.currentWorld.y - 1, width: 2, height: 2 },
            { kind: 'relation' },
          );
          const start = worldToView(previewRoute.start, camera);
          const control1 = worldToView(previewRoute.control1, camera);
          const control2 = worldToView(previewRoute.control2, camera);
          const end = worldToView(previewRoute.end, camera);
          context.beginPath();
          context.moveTo(start.x, start.y);
          context.bezierCurveTo(control1.x, control1.y, control2.x, control2.y, end.x, end.y);
          context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
          context.lineWidth = MIND_MAP_VISUAL_TOKENS.selection.ringWidth;
          context.setLineDash([6, 4]);
          context.stroke();
          context.setLineDash([]);
          const target = hitConnectable(canvasInteraction.currentWorld);
          if (target && !sameCanvasObjectRef(target.ref, canvasInteraction.source)) {
            const topLeft = worldToView({ x: target.bounds.x, y: target.bounds.y }, camera);
            context.save();
            context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
            context.lineWidth = 1.5;
            context.strokeRect(topLeft.x - 3, topLeft.y - 3, target.bounds.width * camera.scale + 6, target.bounds.height * camera.scale + 6);
            context.restore();
          }
        }
      }

      if (canvasInteraction?.type === 'reconnect') {
        const edge = document.edges[canvasInteraction.edgeId];
        const points = edge ? edgePoints(edge, edgeDocument, treeDirection) : null;
        if (edge && points) {
          const fixed = canvasInteraction.endpoint === 'source' ? points.end : points.start;
          const start = worldToView(fixed, camera);
          const end = worldToView(canvasInteraction.currentWorld, camera);
          context.beginPath();
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
          context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
          context.lineWidth = MIND_MAP_VISUAL_TOKENS.selection.ringWidth;
          context.setLineDash([6, 4]);
          context.stroke();
          context.setLineDash([]);
        }
      }

      const renderZOrder = [...new Set([...visibleZOrder, ...selectedNodeIds])];
      for (const nodeId of renderZOrder) {
        const node = previewNodes[nodeId];
        if (!node || !rectIntersectsRect(visible, nodeRect(node))) continue;
        const depth = nodeDepthById.get(node.id) ?? 0;
        const presentation = nodePresentationById.get(node.id) ?? resolveNodePresentation(node, depth, mindMapNodeThemeColor(node));
        const topLeft = worldToView({ x: node.x - node.width / 2, y: node.y - node.height / 2 }, camera);
        const width = node.width * camera.scale;
        const height = node.height * camera.scale;
        context.save();
        if (node.rotation !== 0) {
          const center = worldToView({ x: node.x, y: node.y }, camera);
          context.translate(center.x, center.y);
          context.rotate(node.rotation * Math.PI / 180);
          context.translate(-center.x, -center.y);
        }
        if (!webglActive && !selectedSet.has(node.id) && presentation.shadow && camera.scale >= 0.3) {
          context.shadowColor = MIND_MAP_VISUAL_TOKENS.canvas.nodeShadow;
          context.shadowBlur = MIND_MAP_VISUAL_TOKENS.canvas.nodeShadowBlur * camera.scale;
          context.shadowOffsetY = MIND_MAP_VISUAL_TOKENS.canvas.nodeShadowOffsetY * camera.scale;
        }
        const selected = selectedSet.has(node.id);
        const hovered = hoveredNodeId === node.id;
        const showSurface = !presentation.topic || selected || hovered;
        if ((!webglActive || selected) && showSurface) {
          context.globalAlpha = webglActive ? 0 : node.style.fillOpacity;
          context.fillStyle = presentation.fill;
          context.beginPath();
          const radius = (node.style.borderRadius === 12 ? MIND_MAP_VISUAL_TOKENS.radius.node : node.style.borderRadius) * camera.scale;
          context.roundRect(topLeft.x, topLeft.y, width, height, radius);
          context.fill();
          context.shadowColor = 'transparent';
          context.globalAlpha = 1;
          context.beginPath();
          context.roundRect(topLeft.x, topLeft.y, width, height, radius);
          if (selected) {
            context.strokeStyle = colorWithAlpha(presentation.accent, 0.14);
            context.lineWidth = 5;
            context.stroke();
          }
          if (!presentation.topic || selected) {
            context.strokeStyle = selected ? presentation.accent : presentation.border;
            context.lineWidth = selected ? MIND_MAP_VISUAL_TOKENS.selection.ringWidth : Math.min(1, node.style.borderWidth) * Math.max(0.75, camera.scale);
            context.setLineDash(node.style.borderStyle === 'dashed' ? [7, 5] : []);
            context.stroke();
            context.setLineDash([]);
          }
        }
        if (!webglActive && presentation.topic) {
          context.globalAlpha = selected ? 0.9 : hovered ? 0.68 : 0.46;
          context.strokeStyle = presentation.accent;
          context.lineWidth = Math.max(1, 1.25 * camera.scale);
          context.beginPath();
          context.moveTo(topLeft.x + 10 * camera.scale, topLeft.y + height - 5 * camera.scale);
          context.lineTo(topLeft.x + width - 10 * camera.scale, topLeft.y + height - 5 * camera.scale);
          context.stroke();
          context.globalAlpha = 1;
        }
        const semanticHidden = camera.scale < 0.32 && depth > 1;
        if (camera.scale >= 0.2 && !semanticHidden && node.type !== 'markdown' && node.type !== 'latex') {
          context.fillStyle = presentation.text;
          context.font = presentation.fontWeight + ' ' + Math.max(8, presentation.fontSize * camera.scale) + 'px sans-serif';
          context.textAlign = node.style.textAlign;
          context.textBaseline = 'middle';
          const typePrefix = node.type === 'url' ? 'URL · ' : '';
          const lineHeight = presentation.fontSize * node.style.lineHeight * camera.scale;
          const maximumLines = camera.scale < 0.65 ? 1 : node.type === 'image'
            ? 1
            : Math.max(1, Math.min(100, Math.floor((height - 24 * camera.scale) / lineHeight)));
          const lines = wrapText(
            context,
            typePrefix + ((camera.scale < 0.65 ? node.text.split('\n')[0] : node.text) || '双击编辑'),
            Math.max(10, width - MIND_MAP_VISUAL_TOKENS.node.paddingX * 2 * camera.scale),
            maximumLines,
          );
          const textX = node.style.textAlign === 'left'
            ? topLeft.x + MIND_MAP_VISUAL_TOKENS.node.paddingX * camera.scale
            : node.style.textAlign === 'right'
              ? topLeft.x + width - MIND_MAP_VISUAL_TOKENS.node.paddingX * camera.scale
              : topLeft.x + width / 2;
          const startY = node.type === 'image'
            ? topLeft.y + height - 14 * camera.scale
            : topLeft.y + height / 2 - (lines.length - 1) * lineHeight / 2;
          lines.forEach((line, index) => context.fillText(line, textX, startY + index * lineHeight));
        }
        context.restore();
      }

      for (const nodeId of renderZOrder) {
        const node = previewNodes[nodeId];
        if (!node || !(treeChildrenById.get(node.id)?.length)) continue;
        const marker = worldToView(collapseHandlePoint(node, camera.scale), camera);
        drawCanvasAction(context, marker, node.collapsed ? '+' : '−', false, 18);
      }

      const handleNodeIds = [...new Set([
        hoveredNodeId,
        selectedNodeIds.length === 1 ? selectedNodeIds[0] : null,
        connectionSource?.type === 'node' ? connectionSource.id : null,
      ].filter((id): id is string => Boolean(id)))];
      for (const nodeId of handleNodeIds) {
        const object = resolveConnectableObject(edgeDocument, { type: 'node', id: nodeId });
        const node = previewNodes[nodeId];
        const selected = selectedNodeIds.includes(nodeId);
        const showActions = Boolean(node) && camera.scale >= 0.4 && (selected || camera.scale >= 0.65);
        if (object && showActions) {
          const actionPoints = node
            ? [childHandlePoint(node, camera.scale), relationHandlePointForNode(node, camera.scale), ...(camera.scale >= 0.65 ? [moreHandlePoint(node, camera.scale)] : [])]
              .map((point) => worldToView(point, camera))
            : [];
          drawNodeActionRail(context, actionPoints);
          if (node) {
            const childView = worldToView(childHandlePoint(node, camera.scale), camera);
            drawCanvasAction(context, childView, '+', true);
          }
          const view = worldToView(node ? relationHandlePointForNode(node, camera.scale) : relationHandlePoint(object), camera);
          drawCanvasAction(context, view, '↗');
          if (node && camera.scale >= 0.65) {
            const moreView = worldToView(moreHandlePoint(node, camera.scale), camera);
            drawCanvasAction(context, moreView, '•••');
          }
          if (node && selected && nodeSupportsManualResize(node)) {
            for (const { point } of resizePoints(node)) {
              const resizeView = worldToView(point, camera);
              context.fillStyle = '#ffffff';
              context.fillRect(resizeView.x - 4, resizeView.y - 4, 8, 8);
              context.strokeRect(resizeView.x - 4, resizeView.y - 4, 8, 8);
            }
          }
        }
      }

      if (canvasInteraction?.type === 'create-child') {
        const parent = previewNodes[canvasInteraction.parentId];
        if (parent) {
          const start = worldToView({ x: parent.x + parent.width / 2, y: parent.y }, camera);
          const end = worldToView(canvasInteraction.currentWorld, camera);
          context.beginPath();
          context.moveTo(start.x, start.y);
          context.lineTo(end.x, end.y);
          context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
          context.lineWidth = MIND_MAP_VISUAL_TOKENS.selection.ringWidth;
          context.setLineDash([5, 4]);
          context.stroke();
          context.setLineDash([]);
        }
      }

      if (selectedEdgeIds.length === 1) {
        const edge = document.edges[selectedEdgeIds[0]];
        const points = edge ? edgePoints(edge, edgeDocument, treeDirection) : null;
        if (points) {
          context.fillStyle = '#ffffff';
          context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
          context.lineWidth = 2;
          for (const point of [points.start, points.end]) {
            const view = worldToView(point, camera);
            context.beginPath();
            context.arc(view.x, view.y, HANDLE_RADIUS, 0, Math.PI * 2);
            context.fill();
            context.stroke();
          }
          if (edge.type === 'orthogonal') {
            const controls = edge.controlPoints.map((point, index) => canvasInteraction?.type === 'edge-control'
              && canvasInteraction.edgeId === edge.id && canvasInteraction.controlIndex === index
              ? canvasInteraction.currentWorld
              : point);
            for (const point of controls) {
              const view = worldToView(point, camera);
              context.fillRect(view.x - 5, view.y - 5, 10, 10);
              context.strokeRect(view.x - 5, view.y - 5, 10, 10);
            }
          }
        }
      }

      if (canvasInteraction?.type === 'marquee') {
        const start = worldToView(canvasInteraction.startWorld, camera);
        const end = worldToView(canvasInteraction.currentWorld, camera);
        const rect = normalizedRect(start, end);
        context.globalAlpha = 0.08;
        context.fillStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
        context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
        context.lineWidth = 1;
        context.fillRect(rect.x, rect.y, rect.width, rect.height);
        context.globalAlpha = 1;
        context.strokeRect(rect.x, rect.y, rect.width, rect.height);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [branchThemeColors, camera, canvasInteraction, canvasNodes, connectionSource, document, edgeNodes, hiddenNodeIds, hitConnectable, hoveredEdgeId, hoveredNodeId, nodeDepthById, nodePresentationById, renderDocument, selectedEdgeIds, selectedNodeIds, selectedSectionId, selectedSet, size, treeChildrenById, treeDirection, treeEdgePreview, visibleNodeIds, visibleZOrder, webglActive]);

  const startEditingNode = (node: MindMapNode) => {
    setEditing({
      nodeId: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
      draft: node.text,
    });
  };

  const restoreCanvasFocus = () => {
    window.requestAnimationFrame(() => surfaceRef.current?.focus());
  };

  const treeParentId = (nodeId: string, sourceDocument = document) => Object.values(sourceDocument.edges).find((edge) => (
    edge.relationship === 'tree' && edgeTargetRef(edge).type === 'node' && edgeTargetRef(edge).id === nodeId
  ))?.sourceId ?? null;

  const suggestedChildPosition = (parent: MindMapNode, sourceDocument = document) => {
    const siblings = Object.values(sourceDocument.edges).filter((edge) => edge.relationship === 'tree' && edge.sourceId === parent.id).length;
    const cross = (siblings - 0.5) * 76;
    if (treeDirection === 'right-left') return { x: parent.x - parent.width / 2 - 186, y: parent.y + cross };
    if (treeDirection === 'top-bottom') return { x: parent.x + cross, y: parent.y + parent.height / 2 + 88 };
    if (treeDirection === 'bottom-top') return { x: parent.x + cross, y: parent.y - parent.height / 2 - 88 };
    return { x: parent.x + parent.width / 2 + 186, y: parent.y + cross };
  };

  const createChildNode = (parentId: string, position?: Point, sourceDocument = document) => {
    const parent = sourceDocument.nodes[parentId];
    if (!parent || parent.locked) return;
    const next = position ?? suggestedChildPosition(parent, sourceDocument);
    setEditing({ nodeId: null, connectFromId: parentId, treePlacement: position ? 'manual' : 'auto', x: next.x, y: next.y, width: 180, height: 56, draft: '' });
  };

  const createSiblingNode = (nodeId: string, sourceDocument = document) => {
    const node = sourceDocument.nodes[nodeId];
    if (!node || node.locked) return;
    const parentId = treeParentId(nodeId, sourceDocument);
    if (parentId) createChildNode(parentId, undefined, sourceDocument);
    else setEditing({ nodeId: null, x: node.x, y: node.y + node.height / 2 + 88, width: 180, height: 56, draft: '' });
  };

  const moveNodeToParent = (nodeId: string, parentId: string) => {
    if (nodeId === parentId || !document.nodes[nodeId] || !document.nodes[parentId]) return;
    const descendants = new Set<string>([nodeId]);
    const pending = [nodeId];
    while (pending.length) {
      const current = pending.pop()!;
      for (const edge of Object.values(document.edges)) {
        if (edge.relationship === 'tree' && edge.sourceId === current && !descendants.has(edge.targetId)) {
          descendants.add(edge.targetId);
          pending.push(edge.targetId);
        }
      }
    }
    if (descendants.has(parentId)) return;
    execute('移动节点层级', (current) => {
      const edges = Object.fromEntries(Object.entries(current.edges).filter(([, edge]) => !(
        edge.relationship === 'tree' && edgeTargetRef(edge).type === 'node' && edgeTargetRef(edge).id === nodeId
      )));
      const edge = createMindMapEdge(parentId, nodeId, { relationship: 'tree' });
      return { ...current, edges: { ...edges, [edge.id]: edge } };
    });
  };

  const commitEditing = (restoreFocus = false, next?: 'child' | 'sibling') => {
    const session = editing;
    if (!session) return;
    setEditing(null);
    const continueFrom = (nodeId: string) => {
      if (!next) {
        if (restoreFocus) restoreCanvasFocus();
        return;
      }
      window.requestAnimationFrame(() => {
        const latest = useMindMapStore.getState().document;
        if (!latest?.nodes[nodeId]) return;
        if (next === 'child') createChildNode(nodeId, undefined, latest);
        else createSiblingNode(nodeId, latest);
      });
    };
    if (!session.nodeId) {
      if (!session.draft.trim()) {
        if (restoreFocus) restoreCanvasFocus();
        return;
      }
      const nodeType = session.newNodeType ?? 'text';
      if (session.connectFromId && document.nodes[session.connectFromId]) {
        const node = createMindMapNode({ x: session.x, y: session.y }, nodeType, { text: session.draft });
        const edge = createMindMapEdge(session.connectFromId, node.id, { relationship: 'tree' });
        execute('创建子节点', (current) => {
          const next = { ...current, nodes: { ...current.nodes, [node.id]: node }, edges: { ...current.edges, [edge.id]: edge }, zOrder: [...current.zOrder, node.id] };
          return session.treePlacement === 'auto' ? layoutMindMapBranch(next, session.connectFromId!, treeDirection) : next;
        });
        setSelectedNodeIds([node.id]);
        setSelectedEdgeIds([]);
        continueFrom(node.id);
      } else {
        if (nodeType === 'text') {
          const id = createNode({ x: session.x, y: session.y }, session.draft);
          if (id) {
            setSelectedNodeIds([id]);
            continueFrom(id);
          }
        } else {
          const node = createMindMapNode({ x: session.x, y: session.y }, nodeType, { text: session.draft });
          execute('创建高级节点', (current) => ({
            ...current,
            nodes: { ...current.nodes, [node.id]: node },
            zOrder: [...current.zOrder, node.id],
          }));
          setSelectedNodeIds([node.id]);
          continueFrom(node.id);
        }
      }
      return;
    }
    const node = document.nodes[session.nodeId];
    if (!node) return;
    if (node.text !== session.draft) {
      const measured = node.sizeMode === 'auto' ? measuredNodeSize(session.draft, node) : {};
      updateNode(node.id, { text: session.draft, ...measured });
    }
    continueFrom(node.id);
  };

  const cancelEditing = (restoreFocus = false) => {
    setEditing(null);
    if (restoreFocus) restoreCanvasFocus();
  };

  const handleDoubleClick = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const world = viewToWorld(pointerView(event, canvas), cameraRef.current);
    const node = hitIndexedNode(world);
    if (node) {
      startEditingNode(node);
    } else {
      const edge = hitEdge(world, document, 7 / cameraRef.current.scale, treeDirection);
      if (edge) {
        setSelectedNodeIds([]);
        setSelectedEdgeIds([edge.id]);
      } else {
        setEditing({ nodeId: null, x: world.x, y: world.y, width: 180, height: 56, draft: '', newNodeType: creationType });
      }
    }
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setContextMenu(null);
    setSelectedProjectReferenceId(null);
    setSelectedTimelineId(null);
    surfaceRef.current?.focus();
    const view = pointerView(event, canvas);
    const world = viewToWorld(view, cameraRef.current);
    if (event.pointerType === 'touch') {
      touchPoints.current.set(event.pointerId, view);
      if (touchPoints.current.size >= 2) {
        // The first touch has already started a pan or drag. A second touch
        // must still take over as a pinch gesture.
        const [first, second] = [...touchPoints.current.values()];
        pinchRef.current = {
          distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
          camera: cameraRef.current,
        };
        canvas.setPointerCapture(event.pointerId);
        return;
      }
    }
    if (event.button === 1 || (event.button === 0 && spacePressed.current)) {
      canvas.setPointerCapture(event.pointerId);
      setInteraction({
        type: 'pan',
        pointerId: event.pointerId,
        startView: view,
        startCamera: cameraRef.current,
      });
      return;
    }
    if (event.button !== 0) return;

    if (selectedEdgeIds.length === 1) {
      const selectedEdge = document.edges[selectedEdgeIds[0]];
      const points = selectedEdge ? edgePoints(selectedEdge, document, treeDirection) : null;
      if (selectedEdge && points) {
        const tolerance = HANDLE_RADIUS / cameraRef.current.scale;
        if (selectedEdge.type === 'orthogonal') {
          const controlIndex = selectedEdge.controlPoints.findIndex((point) => (
            Math.hypot(world.x - point.x, world.y - point.y) <= tolerance
          ));
          if (controlIndex >= 0) {
            canvas.setPointerCapture(event.pointerId);
            setInteraction({
              type: 'edge-control',
              pointerId: event.pointerId,
              edgeId: selectedEdge.id,
              controlIndex,
              currentWorld: world,
            });
            return;
          }
        }
        const sourceDistance = Math.hypot(world.x - points.start.x, world.y - points.start.y);
        const targetDistance = Math.hypot(world.x - points.end.x, world.y - points.end.y);
        if (sourceDistance <= tolerance || targetDistance <= tolerance) {
          canvas.setPointerCapture(event.pointerId);
          setInteraction({
            type: 'reconnect',
            pointerId: event.pointerId,
            edgeId: selectedEdge.id,
            endpoint: sourceDistance <= targetDistance ? 'source' : 'target',
            currentWorld: world,
          });
          return;
        }
      }
    }

    const collapseHitRadius = (event.pointerType === 'touch' ? 18 : 10) / cameraRef.current.scale;
    for (let index = canvasZOrder.length - 1; index >= 0; index -= 1) {
      const nodeId = canvasZOrder[index];
      if (!visibleNodeIds.has(nodeId)) continue;
      const node = document.nodes[nodeId];
      if (!node || !(treeChildrenById.get(nodeId)?.length)) continue;
      const marker = collapseHandlePoint(node, cameraRef.current.scale);
      if (Math.hypot(world.x - marker.x, world.y - marker.y) <= collapseHitRadius) {
        updateNode(node.id, { collapsed: !node.collapsed });
        return;
      }
    }

    const connectionHandleNodes = [...new Set([
      hoveredNodeId,
      selectedNodeIds.length === 1 ? selectedNodeIds[0] : null,
      connectionSource?.type === 'node' ? connectionSource.id : null,
    ].filter((id): id is string => Boolean(id)))];
    const tolerance = 10 / cameraRef.current.scale;
    for (const nodeId of connectionHandleNodes) {
      const node = document.nodes[nodeId];
      if (!node || cameraRef.current.scale < 0.4) continue;
      const childPoint = childHandlePoint(node, cameraRef.current.scale);
      const morePoint = moreHandlePoint(node, cameraRef.current.scale);
      const touchRadius = 18 / cameraRef.current.scale;
      if (Math.hypot(world.x - childPoint.x, world.y - childPoint.y) <= touchRadius) {
        setSelectedNodeIds([node.id]);
        canvas.setPointerCapture(event.pointerId);
        setInteraction({ type: 'create-child', pointerId: event.pointerId, parentId: node.id, startWorld: world, currentWorld: world });
        return;
      }
      if (cameraRef.current.scale >= 0.65 && Math.hypot(world.x - morePoint.x, world.y - morePoint.y) <= touchRadius) {
        setContextMenu({ x: view.x, y: view.y, world, nodeId: node.id });
        return;
      }
    }
    for (const nodeId of connectionHandleNodes) {
      const object = resolveConnectableObject(document, { type: 'node', id: nodeId });
      const node = document.nodes[nodeId];
      const connectPoint = object && node && relationHandlePointForNode(node, cameraRef.current.scale);
      if (object && connectPoint && Math.hypot(world.x - connectPoint.x, world.y - connectPoint.y) <= 16 / cameraRef.current.scale) {
          setSelectedNodeIds([nodeId]);
          setSelectedEdgeIds([]);
          canvas.setPointerCapture(event.pointerId);
          setInteraction({ type: 'connect', pointerId: event.pointerId, source: object.ref, sourcePoint: connectPoint, currentWorld: world });
          return;
      }
    }

    if (selectedNodeIds.length === 1) {
      const selected = document.nodes[selectedNodeIds[0]];
      if (selected) {
        const resizeHandle = nodeSupportsManualResize(selected) ? resizePoints(selected).find(({ point }) => (
          Math.hypot(world.x - point.x, world.y - point.y) <= tolerance
        )) : undefined;
        if (resizeHandle) {
          canvas.setPointerCapture(event.pointerId);
          setInteraction({
            type: 'resize',
            pointerId: event.pointerId,
            nodeId: selected.id,
            startWorld: world,
            currentWorld: world,
            corner: resizeHandle.corner,
            x: selected.x,
            y: selected.y,
            width: selected.width,
            height: selected.height,
            rotation: selected.rotation,
          });
          return;
        }
      }
    }

    if (selectedSectionId) {
      const section = document.sections[selectedSectionId];
      if (section && !section.collapsed) {
        const resizePoint = { x: section.x + section.width / 2, y: section.y + section.height / 2 };
        if (Math.hypot(world.x - resizePoint.x, world.y - resizePoint.y) <= HANDLE_RADIUS / cameraRef.current.scale) {
          canvas.setPointerCapture(event.pointerId);
          setInteraction({
            type: 'section-resize',
            pointerId: event.pointerId,
            sectionId: section.id,
            startWorld: world,
            currentWorld: world,
            initialSection: { x: section.x, y: section.y, width: section.width, height: section.height },
          });
          return;
        }
      }
    }

    const node = hitIndexedNode(world);
    if (connectionMode) {
      const target = hitConnectable(world);
      if (!target) return;
      if (!connectionSource) {
        setConnectionSource(target.ref);
        setSelectedNodeIds(target.ref.type === 'node' ? [target.ref.id] : []);
        setSelectedProjectReferenceId(target.ref.type === 'project-reference' ? target.ref.id : null);
        setSelectedEdgeIds([]);
        setSelectedSectionId(null);
      } else if (!sameCanvasObjectRef(target.ref, connectionSource)) {
        createEdge(connectionSource, target.ref);
        setSelectedNodeIds(target.ref.type === 'node' ? [target.ref.id] : []);
        setSelectedProjectReferenceId(target.ref.type === 'project-reference' ? target.ref.id : null);
        setSelectedEdgeIds([]);
        setConnectionSource(null);
        onConnectionModeChange?.(false);
      }
      return;
    }
    if (node) {
      let nextSelection = selectedNodeIds;
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        nextSelection = selectedSet.has(node.id)
          ? selectedNodeIds.filter((id) => id !== node.id)
          : [...selectedNodeIds, node.id];
      } else if (!selectedSet.has(node.id)) {
        const group = node.groupId ? document.groups[node.groupId] : null;
        nextSelection = group ? group.memberIds.filter((id) => canvasNodes[id]) : [node.id];
      }
      setSelectedNodeIds(nextSelection);
      setSelectedEdgeIds([]);
      setSelectedSectionId(null);
      if (!nextSelection.includes(node.id) || node.locked) return;
      const initial: Record<string, Point> = {};
      for (const id of nextSelection) {
        const selected = document.nodes[id];
        if (selected && !selected.locked) initial[id] = { x: selected.x, y: selected.y };
      }
      if (Object.keys(initial).length > 0) {
        canvas.setPointerCapture(event.pointerId);
        setInteraction({
          type: 'drag',
          pointerId: event.pointerId,
          startWorld: world,
          currentWorld: world,
          initial,
        });
      }
      return;
    }

    const edge = hitEdge(world, document, 7 / cameraRef.current.scale, treeDirection);
    if (edge) {
      setSelectedNodeIds([]);
      setSelectedEdgeIds([edge.id]);
      setSelectedSectionId(null);
      return;
    }

    const section = hitSection(world, document.sections);
    if (section) {
      const initialNodes: Record<string, Point> = {};
      for (const node of Object.values(document.nodes)) {
        if (node.parentSectionId === section.id) initialNodes[node.id] = { x: node.x, y: node.y };
      }
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setSelectedSectionId(section.id);
      canvas.setPointerCapture(event.pointerId);
      setInteraction({
        type: 'section-drag',
        pointerId: event.pointerId,
        sectionId: section.id,
        startWorld: world,
        currentWorld: world,
        initialSection: { x: section.x, y: section.y },
        initialNodes,
      });
      return;
    }

    if (!event.shiftKey) {
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setSelectedSectionId(null);
    }
    canvas.setPointerCapture(event.pointerId);
    if (event.pointerType === 'touch' || !event.shiftKey) {
      setInteraction({
        type: 'pan',
        pointerId: event.pointerId,
        startView: view,
        startCamera: cameraRef.current,
      });
      return;
    }
    setInteraction({
      type: 'marquee',
      pointerId: event.pointerId,
      startWorld: world,
      currentWorld: world,
    });
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const view = pointerView(event, canvas);
    const world = viewToWorld(view, cameraRef.current);
    publishCursor(world);
    const activeInteraction = interactionRef.current;
    if (!activeInteraction && event.pointerType !== 'touch') {
      const hoveredNode = hitIndexedNode(world);
      setHoveredNodeId(hoveredNode?.id ?? null);
      setHoveredEdgeId(hoveredNode ? null : hitEdge(world, document, 7 / cameraRef.current.scale, treeDirection)?.id ?? null);
    }
    if (event.pointerType === 'touch' && touchPoints.current.has(event.pointerId)) {
      touchPoints.current.set(event.pointerId, view);
      const pinch = pinchRef.current;
      if (pinch && touchPoints.current.size >= 2) {
        const [first, second] = [...touchPoints.current.values()];
        const distance = Math.max(1, Math.hypot(second.x - first.x, second.y - first.y));
        const midpoint = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
        const worldAtStart = viewToWorld(pinch.midpoint, pinch.camera);
        const scale = Math.max(0.05, Math.min(8, pinch.camera.scale * distance / pinch.distance));
        updateCamera({
          x: midpoint.x - worldAtStart.x * scale,
          y: midpoint.y - worldAtStart.y * scale,
          scale,
        });
        return;
      }
    }
    if (!activeInteraction || event.pointerId !== activeInteraction.pointerId) return;
    if (activeInteraction.type === 'pan') {
      updateCamera({
        ...activeInteraction.startCamera,
        x: activeInteraction.startCamera.x + view.x - activeInteraction.startView.x,
        y: activeInteraction.startCamera.y + view.y - activeInteraction.startView.y,
      });
      return;
    }
    const currentWorld = viewToWorld(view, cameraRef.current);
    scheduleInteraction({ ...activeInteraction, currentWorld });
  };

  const finishPointerInteraction = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (event.pointerType === 'touch') {
      touchPoints.current.delete(event.pointerId);
      if (pinchRef.current) {
        pinchRef.current = null;
        if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
        setInteraction(null);
        updateCamera(cameraRef.current, true);
        return;
      }
    }
    const activeInteraction = interactionRef.current;
    if (!activeInteraction || event.pointerId !== activeInteraction.pointerId) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (activeInteraction.type === 'pan') {
      updateCamera(cameraRef.current, true);
    } else if (activeInteraction.type === 'drag') {
      const dx = activeInteraction.currentWorld.x - activeInteraction.startWorld.x;
      const dy = activeInteraction.currentWorld.y - activeInteraction.startWorld.y;
      if (dx !== 0 || dy !== 0) {
        execute('移动节点', (current) => {
          const nodes = { ...current.nodes };
          for (const [id, initial] of Object.entries(activeInteraction.initial)) {
            const node = nodes[id];
            if (node) {
              const moved = { ...node, x: initial.x + dx, y: initial.y + dy, updatedAt: Date.now() };
              nodes[id] = { ...moved, parentSectionId: resolveNodeSectionId(current, moved) };
            }
          }
          return { ...current, nodes };
        });
      }
    } else if (activeInteraction.type === 'section-drag') {
      const dx = activeInteraction.currentWorld.x - activeInteraction.startWorld.x;
      const dy = activeInteraction.currentWorld.y - activeInteraction.startWorld.y;
      if (dx !== 0 || dy !== 0) {
        execute('移动区域', (current) => {
          const section = current.sections[activeInteraction.sectionId];
          if (!section) return current;
          const nodes = { ...current.nodes };
          for (const [id, initial] of Object.entries(activeInteraction.initialNodes)) {
            const node = nodes[id];
            if (node) nodes[id] = { ...node, x: initial.x + dx, y: initial.y + dy, updatedAt: Date.now() };
          }
          return {
            ...current,
            nodes,
            sections: {
              ...current.sections,
              [section.id]: {
                ...section,
                x: activeInteraction.initialSection.x + dx,
                y: activeInteraction.initialSection.y + dy,
                updatedAt: Date.now(),
              },
            },
          };
        });
      }
    } else if (activeInteraction.type === 'section-resize') {
      const dx = activeInteraction.currentWorld.x - activeInteraction.startWorld.x;
      const dy = activeInteraction.currentWorld.y - activeInteraction.startWorld.y;
      if (dx !== 0 || dy !== 0) {
        execute('调整区域尺寸', (current) => {
          const section = current.sections[activeInteraction.sectionId];
          if (!section) return current;
          const width = Math.max(160, activeInteraction.initialSection.width + dx);
          const height = Math.max(120, activeInteraction.initialSection.height + dy);
          return {
            ...current,
            sections: {
              ...current.sections,
              [section.id]: {
                ...section,
                x: activeInteraction.initialSection.x + (width - activeInteraction.initialSection.width) / 2,
                y: activeInteraction.initialSection.y + (height - activeInteraction.initialSection.height) / 2,
                width,
                height,
                sizeMode: 'manual',
                updatedAt: Date.now(),
              },
            },
          };
        });
      }
    } else if (activeInteraction.type === 'resize') {
      const node = document.nodes[activeInteraction.nodeId];
      if (node) {
        updateNode(node.id, {
          ...resizedNode(activeInteraction),
          sizeMode: 'manual',
        });
      }
    } else if (activeInteraction.type === 'marquee') {
      const rect = normalizedRect(activeInteraction.startWorld, activeInteraction.currentWorld);
      const ids = spatialIndex.query(rect)
        .filter((node) => document.settings.selectionMode === 'intersect'
          ? rectIntersectsRect(rect, nodeRect(node))
          : rectContainsRect(rect, nodeRect(node)))
        .map((node) => node.id);
      setSelectedNodeIds(event.shiftKey ? [...new Set([...selectedNodeIds, ...ids])] : ids);
      setSelectedEdgeIds([]);
    } else if (activeInteraction.type === 'create-child') {
      const distance = Math.hypot(activeInteraction.currentWorld.x - activeInteraction.startWorld.x, activeInteraction.currentWorld.y - activeInteraction.startWorld.y);
      const target = hitConnectable(activeInteraction.currentWorld);
      if (distance < 10 / cameraRef.current.scale) createChildNode(activeInteraction.parentId);
      else if (!target) createChildNode(activeInteraction.parentId, activeInteraction.currentWorld);
      else createChildNode(activeInteraction.parentId);
    } else if (activeInteraction.type === 'connect') {
      const target = hitConnectable(activeInteraction.currentWorld);
      if (target && !sameCanvasObjectRef(target.ref, activeInteraction.source)) {
        createEdge(activeInteraction.source, target.ref);
        setSelectedEdgeIds([]);
      }
    } else if (activeInteraction.type === 'edge-control') {
      const edge = document.edges[activeInteraction.edgeId];
      if (edge) {
        updateEdge(edge.id, {
          controlPoints: edge.controlPoints.map((point, index) => index === activeInteraction.controlIndex ? activeInteraction.currentWorld : point),
        });
      }
    } else if (activeInteraction.type === 'reconnect') {
      const edge = document.edges[activeInteraction.edgeId];
      const target = hitConnectable(activeInteraction.currentWorld);
      if (edge && target) {
        const other = activeInteraction.endpoint === 'source' ? edgeTargetRef(edge) : edgeSourceRef(edge);
        if (!sameCanvasObjectRef(target.ref, other)) {
          updateEdge(edge.id, activeInteraction.endpoint === 'source'
            ? { source: target.ref, sourceId: target.ref.id }
            : { target: target.ref, targetId: target.ref.id });
        }
      }
    }
    setInteraction(null);
  };

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const view = {
      x: event.clientX - canvas.getBoundingClientRect().left,
      y: event.clientY - canvas.getBoundingClientRect().top,
    };
    const factor = Math.exp(-event.deltaY * 0.0015);
    updateCamera(zoomCameraAt(cameraRef.current, view, cameraRef.current.scale * factor));
  }, [updateCamera]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.addEventListener('wheel', handleWheel, { passive: false });
    return () => surface.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleProjectReferencePointerDown = (
    event: ReactPointerEvent<HTMLDivElement>,
    reference: ProjectReferenceCard,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    surfaceRef.current?.focus();
    setContextMenu(null);
    setSelectedProjectReferenceId(reference.id);
    setSelectedTimelineId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setSelectedSectionId(null);
    const ref: CanvasObjectRef = { type: 'project-reference', id: reference.id };
    if (connectionMode) {
      if (!connectionSource) setConnectionSource(ref);
      else if (!sameCanvasObjectRef(connectionSource, ref)) {
        createEdge(connectionSource, ref);
        setConnectionSource(null);
        onConnectionModeChange?.(false);
      }
      return;
    }
    if (reference.locked) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const world = viewToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({
      type: 'project-reference-drag',
      pointerId: event.pointerId,
      referenceId: reference.id,
      startWorld: world,
      currentWorld: world,
      initial: { x: reference.x, y: reference.y },
    });
  };

  const handleProjectReferenceRelationPointerDown = (event: ReactPointerEvent<HTMLButtonElement>, reference: ProjectReferenceCard) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const object = resolveConnectableObject(document, { type: 'project-reference', id: reference.id });
    if (!object) return;
    setSelectedProjectReferenceId(reference.id);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({
      type: 'connect',
      pointerId: event.pointerId,
      source: object.ref,
      sourcePoint: relationHandlePoint(object),
      currentWorld: viewToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraRef.current),
    });
  };

  const handleProjectReferenceRelationPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = interactionRef.current;
    const surface = surfaceRef.current;
    if (active?.type !== 'connect' || active.pointerId !== event.pointerId || !surface) return;
    const rect = surface.getBoundingClientRect();
    scheduleInteraction({ ...active, currentWorld: viewToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraRef.current) });
  };

  const finishProjectReferenceRelation = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const active = interactionRef.current;
    const surface = surfaceRef.current;
    if (active?.type !== 'connect' || active.pointerId !== event.pointerId || !surface) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const rect = surface.getBoundingClientRect();
    const target = hitConnectable(viewToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraRef.current));
    if (target && !sameCanvasObjectRef(active.source, target.ref)) createEdge(active.source, target.ref);
    setInteraction(null);
  };

  const handleProjectReferencePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = interactionRef.current;
    const surface = surfaceRef.current;
    if (active?.type !== 'project-reference-drag' || active.pointerId !== event.pointerId || !surface) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = surface.getBoundingClientRect();
    scheduleInteraction({
      ...active,
      currentWorld: viewToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraRef.current),
    });
  };

  const finishProjectReferenceInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    const active = interactionRef.current;
    if (active?.type !== 'project-reference-drag' || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const dx = active.currentWorld.x - active.startWorld.x;
    const dy = active.currentWorld.y - active.startWorld.y;
    if (dx !== 0 || dy !== 0) {
      execute('移动项目引用', (current) => {
        const reference = current.projectReferences[active.referenceId];
        if (!reference || reference.locked) return current;
        return {
          ...current,
          projectReferences: {
            ...current.projectReferences,
            [reference.id]: {
              ...reference,
              x: active.initial.x + dx,
              y: active.initial.y + dy,
              updatedAt: Date.now(),
            },
          },
        };
      });
    }
    setInteraction(null);
  };

  const openProjectReferenceMenu = (reference: ProjectReferenceCard, clientX: number, clientY: number) => {
    const surface = surfaceRef.current?.getBoundingClientRect();
    if (!surface) return;
    setSelectedProjectReferenceId(reference.id);
    setSelectedTimelineId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setSelectedSectionId(null);
    setContextMenu({
      x: Math.min(clientX - surface.left, Math.max(0, size.width - 190)),
      y: Math.min(clientY - surface.top, Math.max(0, size.height - 180)),
      world: { x: reference.x, y: reference.y },
      projectReferenceId: reference.id,
    });
  };

  const handleTimelinePointerDown = (event: ReactPointerEvent<HTMLDivElement>, timeline: TimelineSection) => {
    if (event.button !== 0 || (event.target as HTMLElement).closest('button, input, select, textarea, a')) return;
    event.preventDefault();
    event.stopPropagation();
    surfaceRef.current?.focus();
    setContextMenu(null);
    setSelectedTimelineId(timeline.id);
    setSelectedProjectReferenceId(null);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setSelectedSectionId(null);
    if (timeline.locked) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const world = viewToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({
      type: 'timeline-drag',
      pointerId: event.pointerId,
      timelineId: timeline.id,
      startWorld: world,
      currentWorld: world,
      initial: { x: timeline.x, y: timeline.y },
    });
  };

  const handleTimelinePointerMove = (event: ReactPointerEvent<HTMLElement>) => {
    const active = interactionRef.current;
    const surface = surfaceRef.current;
    if ((active?.type !== 'timeline-drag' && active?.type !== 'timeline-resize') || active.pointerId !== event.pointerId || !surface) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = surface.getBoundingClientRect();
    scheduleInteraction({
      ...active,
      currentWorld: viewToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraRef.current),
    });
  };

  const finishTimelineInteraction = (event: ReactPointerEvent<HTMLElement>) => {
    const active = interactionRef.current;
    if ((active?.type !== 'timeline-drag' && active?.type !== 'timeline-resize') || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const dx = active.currentWorld.x - active.startWorld.x;
    const dy = active.currentWorld.y - active.startWorld.y;
    if (dx !== 0 || dy !== 0) {
      execute(active.type === 'timeline-drag' ? '移动时间线' : '调整时间线尺寸', (current) => {
        const timeline = current.timelineSections[active.timelineId];
        if (!timeline || timeline.locked) return current;
        const resized = active.type === 'timeline-resize'
          ? resizeTimelineRect(active.initial, dx, dy)
          : { x: active.initial.x + dx, y: active.initial.y + dy };
        return {
          ...current,
          timelineSections: {
            ...current.timelineSections,
            [timeline.id]: {
              ...timeline,
              ...resized,
              updatedAt: Date.now(),
            },
          },
        };
      });
    }
    setInteraction(null);
  };

  const handleTimelineResizePointerDown = (event: ReactPointerEvent<HTMLSpanElement>, timeline: TimelineSection) => {
    event.preventDefault();
    event.stopPropagation();
    if (timeline.locked) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const world = viewToWorld({ x: event.clientX - rect.left, y: event.clientY - rect.top }, cameraRef.current);
    event.currentTarget.setPointerCapture(event.pointerId);
    setInteraction({
      type: 'timeline-resize',
      pointerId: event.pointerId,
      timelineId: timeline.id,
      startWorld: world,
      currentWorld: world,
      initial: { x: timeline.x, y: timeline.y, width: timeline.width, height: timeline.height },
    });
  };

  const handleTimelineTaskPointerDown = (
    event: ReactPointerEvent<HTMLSpanElement>,
    item: TimelineProjectionItem,
    timeline: TimelineSection,
    rangeStart: string,
    rangeEnd: string,
    mode: TimelineTaskInteraction['mode'],
  ) => {
    const itemId = item.projectTaskId ?? item.lifeItemId;
    if (!itemId || timeline.locked || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setTimelineEditError(null);
    setTimelineTaskInteraction({
      pointerId: event.pointerId,
      itemId,
      source: item.projectTaskId ? 'project' : 'life',
      mode,
      startClientX: event.clientX,
      width: Math.max(1, createTimelineCoordinates(rangeStart, rangeEnd, timeline.width).plotWidth * cameraRef.current.scale),
      rangeDays: Math.max(1, diffDays(rangeEnd, rangeStart)),
      start: item.start,
      end: item.end,
      deltaDays: 0,
    });
  };

  const handleTimelineTaskPointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (!timelineTaskInteraction || timelineTaskInteraction.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    setTimelineTaskInteraction((current) => {
      if (!current || current.pointerId !== event.pointerId) return current;
      return {
        ...current,
        deltaDays: Math.round((event.clientX - current.startClientX) / current.width * current.rangeDays),
      };
    });
  };

  const finishTimelineTaskInteraction = (event: ReactPointerEvent<HTMLSpanElement>) => {
    const current = timelineTaskInteraction;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const preview = timelineTaskDates({
      id: current.itemId,
      title: '',
      start: current.start,
      end: current.end,
      color: '',
      kind: 'task',
      shape: 'range',
      ...(current.source === 'project' ? { projectTaskId: current.itemId } : { lifeItemId: current.itemId }),
    }, current);
    const isSingleDateLifeItem = current.source === 'life' && current.start === current.end && current.mode === 'end';
    if (!isSingleDateLifeItem && (preview.start !== current.start || preview.end !== current.end)) {
      if (current.source === 'project') {
        if (projectPlanningAdapter.updateTaskDates(current.itemId, preview.start, preview.end)) {
          setProjectDateUndo({ taskId: current.itemId, start: current.start, end: current.end });
        } else setTimelineEditError('项目任务日期更新失败，源任务可能已被删除。');
      } else {
        let changed = false;
        execute('调整人生规划日期', (map) => {
          if (!map.lifeMap) return map;
          const lifeMap = updateLifePlanningDates(map.lifeMap, current.itemId, preview.start, preview.end);
          if (!lifeMap) return map;
          changed = true;
          return { ...map, lifeMap, lifeMapMigration: null };
        });
        if (changed) setLifeDateUpdated(true);
        else setTimelineEditError('人生规划日期更新失败，源对象可能已被删除。');
      }
    }
    setTimelineTaskInteraction(null);
  };

  const copySelection = () => {
    const selectedNodes = new Set(selectedNodeIds);
    const selectedReferences = new Set(selectedProjectReferenceId ? [selectedProjectReferenceId] : []);
    if (selectedNodes.size === 0 && selectedReferences.size === 0) return;
    const selected = (ref: CanvasObjectRef) => ref.type === 'node' ? selectedNodes.has(ref.id) : selectedReferences.has(ref.id);
    const clipboard: ClipboardGraph = {
      nodes: selectedNodeIds.map((id) => document.nodes[id]).filter((node): node is MindMapNode => Boolean(node)),
      projectReferences: [...selectedReferences].map((id) => document.projectReferences[id]).filter((reference): reference is ProjectReferenceCard => Boolean(reference)),
      edges: Object.values(document.edges).filter((edge) => selected(edgeSourceRef(edge)) && selected(edgeTargetRef(edge))),
    };
    clipboardRef.current = clipboard;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(CLIPBOARD_PREFIX + JSON.stringify(clipboard)).catch(() => undefined);
    }
  };

  const pasteSelection = () => {
    const clipboard = clipboardRef.current;
    if (!clipboard || (clipboard.nodes.length === 0 && clipboard.projectReferences.length === 0)) return;
    const nodeIds = new Map<string, string>();
    const referenceIds = new Map<string, string>();
    const nodes: Record<string, MindMapNode> = {};
    const now = Date.now();
    for (const node of clipboard.nodes) {
      const id = createMindMapId();
      nodeIds.set(node.id, id);
      nodes[id] = {
        ...node,
        id,
        x: node.x + 24,
        y: node.y + 24,
        createdAt: now,
        updatedAt: now,
      };
    }
    const projectReferences: Record<string, ProjectReferenceCard> = {};
    for (const reference of clipboard.projectReferences) {
      const id = createMindMapId();
      referenceIds.set(reference.id, id);
      projectReferences[id] = { ...reference, id, x: reference.x + 24, y: reference.y + 24, createdAt: now, updatedAt: now };
    }
    const edges: Record<string, MindMapEdge> = {};
    for (const edge of clipboard.edges) {
      const remap = (ref: CanvasObjectRef) => {
        const id = ref.type === 'node' ? nodeIds.get(ref.id) : referenceIds.get(ref.id);
        return id ? { type: ref.type, id } : null;
      };
      const source = remap(edgeSourceRef(edge));
      const target = remap(edgeTargetRef(edge));
      if (!source || !target) continue;
      const id = createMindMapId();
      edges[id] = { ...edge, id, source, target, sourceId: source.id, targetId: target.id, createdAt: now, updatedAt: now };
    }
    execute('粘贴对象', (current) => ({
      ...current,
      nodes: { ...current.nodes, ...nodes },
      projectReferences: { ...current.projectReferences, ...projectReferences },
      edges: { ...current.edges, ...edges },
      zOrder: [...current.zOrder, ...Object.keys(nodes)],
    }));
    setSelectedNodeIds(Object.keys(nodes));
    setSelectedProjectReferenceId(Object.keys(projectReferences)[0] ?? null);
    setSelectedEdgeIds([]);
  };

  const pasteFromSystem = async () => {
    if (!navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.startsWith(CLIPBOARD_PREFIX) || text.length > 5_000_000) return;
      const value = JSON.parse(text.slice(CLIPBOARD_PREFIX.length)) as { nodes?: unknown; projectReferences?: unknown; edges?: unknown };
      if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return;
      const rawNodes = Object.fromEntries(value.nodes.flatMap((node) => {
        if (!node || typeof node !== 'object' || !('id' in node) || typeof node.id !== 'string') return [];
        return [[node.id, node]];
      }));
      const rawEdges = Object.fromEntries(value.edges.flatMap((edge) => {
        if (!edge || typeof edge !== 'object' || !('id' in edge) || typeof edge.id !== 'string') return [];
        return [[edge.id, edge]];
      }));
      const rawProjectReferences = Array.isArray(value.projectReferences)
        ? Object.fromEntries(value.projectReferences.flatMap((reference) => {
            if (!reference || typeof reference !== 'object' || !('id' in reference) || typeof reference.id !== 'string') return [];
            return [[reference.id, reference]];
          }))
        : {};
      const normalized = normalizeMindMapDocument({
        kind: 'smart-line-mind-map',
        schemaVersion: MIND_MAP_SCHEMA_VERSION,
        id: 'clipboard',
        nodes: rawNodes,
        projectReferences: rawProjectReferences,
        edges: rawEdges,
        zOrder: Object.keys(rawNodes),
      });
      if (!normalized || (Object.keys(normalized.nodes).length === 0 && Object.keys(normalized.projectReferences).length === 0)) return;
      clipboardRef.current = {
        nodes: Object.values(normalized.nodes),
        projectReferences: Object.values(normalized.projectReferences),
        edges: Object.values(normalized.edges),
      };
      pasteSelection();
    } catch {
      // Clipboard permissions and unrelated clipboard content are intentionally ignored.
    }
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const view = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const world = viewToWorld(view, cameraRef.current);
    const node = hitIndexedNode(world);
    const edge = node ? null : hitEdge(world, renderDocument, 7 / cameraRef.current.scale, treeDirection);
    if (node) {
      if (!selectedSet.has(node.id)) setSelectedNodeIds([node.id]);
      setSelectedEdgeIds([]);
      setSelectedSectionId(null);
    } else if (edge) {
      setSelectedNodeIds([]);
      setSelectedEdgeIds([edge.id]);
      setSelectedSectionId(null);
    }
    setContextMenu({
      x: Math.min(view.x, Math.max(0, size.width - 190)),
      y: Math.min(view.y, Math.max(0, size.height - (node ? 360 : 260))),
      world,
      nodeId: node?.id,
      edgeId: edge?.id,
    });
  };

  const fit = useCallback((nodes: MindMapNode[]) => {
    const next = fitNodes(nodes, size);
    if (next) updateCamera(next, true);
  }, [size, updateCamera]);
  const fitAll = useCallback(() => {
    const next = fitMindMapDocument(renderDocument, size);
    if (next) updateCamera(next, true);
  }, [renderDocument, size, updateCamera]);
  const selectBranch = (rootId: string) => {
    setSelectedNodeIds(branchNodeIds(rootId));
    setSelectedEdgeIds([]);
    setSelectedSectionId(null);
    setSelectedProjectReferenceId(null);
    setSelectedTimelineId(null);
    setContextMenu(null);
  };
  const focusBranch = (rootId: string) => {
    const ids = branchNodeIds(rootId);
    if (ids.length === 0) return;
    setFocusedBranchRootId(rootId);
    setSelectedNodeIds([rootId]);
    setSelectedEdgeIds([]);
    setSelectedSectionId(null);
    setSelectedProjectReferenceId(null);
    setSelectedTimelineId(null);
    setContextMenu(null);
    requestAnimationFrame(() => fit(ids.map((id) => document.nodes[id]).filter((node): node is MindMapNode => Boolean(node))));
    restoreCanvasFocus();
  };
  const exitBranchFocus = () => {
    setFocusedBranchRootId(null);
    requestAnimationFrame(() => {
      const next = fitMindMapDocument(document, size);
      if (next) updateCamera(next, true);
    });
    restoreCanvasFocus();
  };
  const runTreeLayout = useCallback(async () => {
    const rootId = selectedNodeIds.length === 1 ? selectedNodeIds[0] : null;
    if (rootId) {
      execute('整理当前分支', (current) => layoutMindMapBranch(current, rootId, treeDirection));
      return;
    }
    const generation = ++layoutGeneration.current;
    const source = document;
    onLayoutRunningChange?.(true);
    try {
      const laidOut = await layoutMindMapTreeInWorker(source, treeDirection);
      if (generation !== layoutGeneration.current) return;
      execute('树形布局', (current) => (
        current.id === source.id
          && current.nodes === source.nodes
          && current.edges === source.edges
          ? { ...laidOut, viewport: current.viewport }
          : current
      ));
    } finally {
      if (generation === layoutGeneration.current) onLayoutRunningChange?.(false);
    }
  }, [document, execute, onLayoutRunningChange, selectedNodeIds, treeDirection]);

  useEffect(() => {
    if (fitRequest <= 0 || fitRequest === handledFitRequest.current) return;
    handledFitRequest.current = fitRequest;
    fitAll();
  }, [fitAll, fitRequest]);

  useEffect(() => {
    if (treeLayoutRequest <= 0 || treeLayoutRequest === handledTreeLayoutRequest.current) return;
    handledTreeLayoutRequest.current = treeLayoutRequest;
    void runTreeLayout();
  }, [runTreeLayout, treeLayoutRequest]);

  useEffect(() => {
    if (pngRequest <= 0 || pngRequest === handledPngRequest.current) return;
    handledPngRequest.current = pngRequest;
    const canvas = canvasRef.current;
    if (pngScope === 'viewport') {
      // The visible 2D canvas intentionally omits graph content while WebGL is
      // active, and WebGL does not retain a readable frame buffer.  Export the
      // same document through the deterministic 2D exporter instead of a blank PNG.
      if (webglActive) downloadMindMapPng(document, 'all');
      else if (canvas) downloadCanvasPng(canvas, document.title);
    } else {
      downloadMindMapPng(document, pngScope, selectedNodeIds);
    }
  }, [document, pngRequest, pngScope, selectedNodeIds, webglActive]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target !== surfaceRef.current && target.matches('input, textarea, select, button, [contenteditable="true"]')) return;
    if (event.key === ' ') {
      spacePressed.current = true;
      event.preventDefault();
      return;
    }
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      setCommandOpen(true);
      setCommandSearch('');
      return;
    }
    if (modifier && event.key.toLowerCase() === 'z') {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelectedNodeIds(Object.keys(canvasNodes));
      setSelectedEdgeIds([]);
      setSelectedSectionId(null);
      setSelectedProjectReferenceId(null);
      setSelectedTimelineId(null);
      return;
    }
    if (modifier && event.key.toLowerCase() === 'c') {
      event.preventDefault();
      copySelection();
      return;
    }
    if (modifier && event.key.toLowerCase() === 'x') {
      event.preventDefault();
      copySelection();
      deleteNodes(selectedNodeIds);
      setSelectedNodeIds([]);
      return;
    }
    if (modifier && event.key.toLowerCase() === 'v') {
      event.preventDefault();
      if (clipboardRef.current) pasteSelection();
      else void pasteFromSystem();
      return;
    }
    if (modifier && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void flushSave();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      if (focusedBranchRootId) exitBranchFocus();
      setContextMenu(null);
      setInteraction(null);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setSelectedSectionId(null);
      setSelectedProjectReferenceId(null);
      setSelectedTimelineId(null);
      setConnectionSource(null);
      onConnectionModeChange?.(false);
      return;
    }
    if (!modifier && !event.altKey && event.key.toLowerCase() === 'l' && (selectedNodeIds.length === 1 || Boolean(selectedProjectReferenceId))) {
      event.preventDefault();
      setConnectionSource(selectedNodeIds.length === 1 ? { type: 'node', id: selectedNodeIds[0] } : { type: 'project-reference', id: selectedProjectReferenceId! });
      onConnectionModeChange?.(true);
      return;
    }
    if (!modifier && !event.altKey && (event.key === 'Tab' || event.key === 'Enter') && selectedNodeIds.length === 1) {
      const selected = document.nodes[selectedNodeIds[0]];
      if (selected) {
        event.preventDefault();
        if (event.key === 'Tab') {
          createChildNode(selected.id);
        } else {
          createSiblingNode(selected.id);
        }
        return;
      }
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      if (selectedNodeIds.length) deleteNodes(selectedNodeIds);
      if (selectedEdgeIds.length) deleteEdges(selectedEdgeIds);
      if (selectedSectionId) {
        execute('删除区域', (current) => {
          const sections = { ...current.sections };
          delete sections[selectedSectionId];
          return {
            ...current,
            sections,
            nodes: Object.fromEntries(Object.entries(current.nodes).map(([id, node]) => [
              id,
              node.parentSectionId === selectedSectionId ? { ...node, parentSectionId: null, updatedAt: Date.now() } : node,
            ])),
          };
        });
      }
      if (selectedProjectReferenceId) {
        execute('删除项目引用', (current) => {
          const projectReferences = { ...current.projectReferences };
          delete projectReferences[selectedProjectReferenceId];
          return {
            ...current,
            projectReferences,
            edges: Object.fromEntries(Object.entries(current.edges).filter(([, edge]) => !edgeTouchesCanvasObject(edge, { type: 'project-reference', id: selectedProjectReferenceId }))),
          };
        });
      }
      if (selectedTimelineId) {
        execute('删除时间线', (current) => {
          const timelineSections = { ...current.timelineSections };
          delete timelineSections[selectedTimelineId];
          return { ...current, timelineSections };
        });
      }
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setSelectedSectionId(null);
      setSelectedProjectReferenceId(null);
      setSelectedTimelineId(null);
      return;
    }
    if (event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (event.shiftKey) {
        fit(selectedNodeIds.map((id) => document.nodes[id]).filter((node): node is MindMapNode => Boolean(node)));
      } else {
        fitAll();
      }
      return;
    }
    if (event.key === '1') {
      event.preventDefault();
      updateCamera({ ...cameraRef.current, scale: 1 }, true);
      return;
    }
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      updateCamera(zoomCameraAt(cameraRef.current, { x: size.width / 2, y: size.height / 2 }, cameraRef.current.scale * 1.15));
      return;
    }
    if (event.key === '-' || event.key === '_') {
      event.preventDefault();
      updateCamera(zoomCameraAt(cameraRef.current, { x: size.width / 2, y: size.height / 2 }, cameraRef.current.scale / 1.15));
    }
  };

  const editingRect: Rect | null = editing ? {
    x: editing.x - editing.width / 2,
    y: editing.y - editing.height / 2,
    width: editing.width,
    height: editing.height,
  } : null;
  const editingTopLeft = editingRect ? worldToView(editingRect, camera) : null;
  const selectedNode = selectedNodeIds.length === 1 ? document.nodes[selectedNodeIds[0]] ?? null : null;
  const selectedEdge = selectedEdgeIds.length === 1 ? document.edges[selectedEdgeIds[0]] ?? null : null;
  const selectedSection = selectedSectionId ? document.sections[selectedSectionId] ?? null : null;
  const selectedProjectReference = selectedProjectReferenceId
    ? document.projectReferences[selectedProjectReferenceId] ?? null
    : null;
  const selectedTimeline = selectedTimelineId ? document.timelineSections[selectedTimelineId] ?? null : null;
  const activeRelationTarget = interaction?.type === 'connect' ? hitConnectable(interaction.currentWorld) : null;
  const normalizedSearch = commandSearch.trim().toLocaleLowerCase();
  const searchResults = normalizedSearch
    ? [
        ...Object.values(renderDocument.nodes)
          .filter((node) => node.text.toLocaleLowerCase().includes(normalizedSearch))
          .map((node) => ({ kind: 'node' as const, id: node.id, label: node.text || '空节点', x: node.x, y: node.y })),
        ...Object.values(renderDocument.edges)
          .filter((edge) => edge.label.toLocaleLowerCase().includes(normalizedSearch))
          .map((edge) => {
            const sourceRef = edgeSourceRef(edge);
            const targetRef = edgeTargetRef(edge);
            const source = sourceRef.type === 'node' ? document.nodes[sourceRef.id] : document.projectReferences[sourceRef.id];
            const target = targetRef.type === 'node' ? document.nodes[targetRef.id] : document.projectReferences[targetRef.id];
            return {
              kind: 'edge' as const,
              id: edge.id,
              label: edge.label,
              x: source && target ? (source.x + target.x) / 2 : 0,
              y: source && target ? (source.y + target.y) / 2 : 0,
            };
          }),
      ].slice(0, 8)
    : [];
  const revealSearchResult = (result: (typeof searchResults)[number]) => {
    const relatedNodeIds = result.kind === 'node'
      ? [result.id]
      : [document.edges[result.id]?.sourceId, document.edges[result.id]?.targetId];
    const sectionIds = [...new Set(relatedNodeIds.flatMap((id) => {
      const sectionId = id ? document.nodes[id]?.parentSectionId : null;
      return sectionId && document.sections[sectionId]?.collapsed ? [sectionId] : [];
    }))];
    if (sectionIds.length > 0) {
      execute('展开搜索结果区域', (current) => ({
        ...current,
        sections: {
          ...current.sections,
          ...Object.fromEntries(sectionIds.map((id) => [id, {
            ...current.sections[id],
            collapsed: false,
            updatedAt: Date.now(),
          }])),
        },
      }));
    }
    setSelectedNodeIds(result.kind === 'node' ? [result.id] : []);
    setSelectedEdgeIds(result.kind === 'edge' ? [result.id] : []);
    setSelectedSectionId(null);
    setSelectedProjectReferenceId(null);
    setSelectedTimelineId(null);
    setCommandSearch('');
    setCommandOpen(false);
    const scale = cameraRef.current.scale;
    updateCamera({
      x: size.width / 2 - result.x * scale,
      y: size.height / 2 - result.y * scale,
      scale,
    }, true);
  };
  const richPreviews = visibleNodes.flatMap((node) => {
    if (node.type !== 'markdown' && node.type !== 'latex') return [];
    let cached = richHtmlCacheRef.current.get(node.id);
    if (!cached || cached.updatedAt !== node.updatedAt) {
      cached = {
        updatedAt: node.updatedAt,
        html: node.type === 'markdown' ? renderMindMapMarkdown(node.text) : renderMindMapLatex(node.text),
      };
      richHtmlCacheRef.current.set(node.id, cached);
      while (richHtmlCacheRef.current.size > 300) {
        const oldest = richHtmlCacheRef.current.keys().next().value;
        if (oldest === undefined) break;
        richHtmlCacheRef.current.delete(oldest);
      }
    }
    return [{ node, html: cached.html }];
  });
  const inspectorOpen = Boolean(selectedNode || selectedEdge || selectedSection || selectedProjectReference || selectedTimeline || selectedNodeIds.length > 1) && !editing;

  return (
    <div
      ref={surfaceRef}
      className={`${styles.surface} ${inspectorOpen ? styles.surfaceWithInspector : ''}`}
      data-renderer={webglActive ? 'webgl' : 'canvas2d'}
      tabIndex={0}
      aria-label="思维导图画布"
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => {
        if (event.key === ' ') spacePressed.current = false;
      }}
      onBlur={() => {
        spacePressed.current = false;
      }}
    >
      <canvas
        ref={webglCanvasRef}
        className={styles.webglCanvas}
        data-testid="mind-map-webgl-canvas"
        aria-hidden="true"
        style={{ visibility: webglActive ? 'visible' : 'hidden' }}
      />
      <canvas
        ref={canvasRef}
        className={`${styles.canvas} ${connectionMode ? styles.connectionCanvas : ''}`}
        data-testid="mind-map-canvas"
        data-renderer={webglActive ? 'webgl' : 'canvas2d'}
        onContextMenu={handleContextMenu}
        onDoubleClick={handleDoubleClick}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishPointerInteraction}
        onPointerCancel={finishPointerInteraction}
        onPointerLeave={() => {
          if (!interaction) {
            setHoveredNodeId(null);
            setHoveredEdgeId(null);
            publishCursor(null, true);
          }
        }}
      />
      {connectionMode && (
        <div className={styles.connectionHint} role="status">
          {connectionSource
            ? '已选择起点，请点击终点对象；按 Esc 取消'
            : '连线模式：先点击起点对象，再点击终点对象'}
        </div>
      )}
      {focusedBranchRootId && focusedBranchNodeIds && document.nodes[focusedBranchRootId] && (
        <div className={styles.branchFocusHint} role="status" data-testid="mind-map-branch-focus" style={{ top: connectionMode ? 104 : 60 }}>
          <span>正在聚焦：{document.nodes[focusedBranchRootId].text || '空节点'} · {focusedBranchNodeIds.size} 个节点</span>
          <button type="button" aria-label="退出分支聚焦" onClick={exitBranchFocus}>退出</button>
        </div>
      )}
      {richPreviews.map(({ node, html }) => {
        const preview = previewNode(node, interaction);
        const presentation = nodePresentationById.get(node.id);
        const topLeft = worldToView({ x: preview.x - preview.width / 2, y: preview.y - preview.height / 2 }, camera);
        return (
          <div
            key={node.id}
            className={`${styles.richPreview} ${node.type === 'markdown' ? styles.markdownPreview : styles.latexPreview}`}
            data-testid={`mind-map-${node.type}-${node.id}`}
            style={{
              left: topLeft.x + 12 * camera.scale,
              top: topLeft.y + 8 * camera.scale,
              width: Math.max(1, (preview.width - 24) * camera.scale),
              height: Math.max(1, (preview.height - 16) * camera.scale),
              fontSize: Math.max(8, (presentation?.fontSize ?? node.style.fontSize) * camera.scale),
              color: presentation?.text ?? node.style.textColor,
              transform: `rotate(${preview.rotation}deg)`,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        );
      })}
      {visibleTimelines.map((sourceTimeline) => {
        const timeline = previewTimeline(sourceTimeline, interaction);
        const allItems = timelineProjectionItems(timeline, projectPlanning, document.lifeMap ?? lifeTimeline);
        const range = timelineRange(timeline, allItems);
        const summaryMode = camera.scale < 0.45;
        const lodItems = summaryMode
          ? []
          : camera.scale < 0.75
            ? allItems.filter((item) => item.kind !== 'task' && item.kind !== 'note')
            : allItems;
        const visibility = timelineVisibility[timeline.id] ?? DEFAULT_TIMELINE_VISIBILITY;
        const visibleItems = timelineVisibleItems(lodItems, range.start, range.end, Number.MAX_SAFE_INTEGER);
        const stageCandidates = visibility.stages ? visibleItems.filter((item) => item.kind === 'stage') : [];
        const milestoneCandidates = visibility.milestones ? visibleItems.filter((item) => item.kind === 'milestone' || item.shape === 'marker') : [];
        const rowCandidates = visibleItems.filter((item) => item.kind !== 'stage' && item.kind !== 'milestone' && item.shape !== 'marker');
        const headerHeight = 48;
        const axisHeight = 52;
        const stageRowHeight = 26;
        const maximumStageRows = Math.max(0, Math.floor((timeline.height - headerHeight - axisHeight - 18 - 80 - 18) / stageRowHeight));
        const stages = stageCandidates.slice(0, maximumStageRows);
        const stageHeight = stages.length ? stages.length * stageRowHeight + 8 : 8;
        const maximumMilestoneStack = Math.max(0, Math.floor((timeline.height - headerHeight - axisHeight - stageHeight - 18 - 80 - 12) / 14));
        const milestoneDates = new Map<string, number>();
        const milestones = milestoneCandidates.filter((item) => {
          const stack = (milestoneDates.get(item.start) ?? 0) + 1;
          milestoneDates.set(item.start, stack);
          return stack <= maximumMilestoneStack;
        });
        const milestoneStackHeight = milestones.reduce((maximum, item, index) => {
          const stack = milestones.slice(0, index).filter((candidate) => candidate.start === item.start).length + 1;
          return Math.max(maximum, stack);
        }, 0);
        const milestoneHeight = milestones.length ? 12 + milestoneStackHeight * 14 : 18;
        const rowAreaHeight = Math.max(32, timeline.height - headerHeight - axisHeight - stageHeight - milestoneHeight - 18);
        const maximumRows = Math.max(1, Math.floor(rowAreaHeight / 34));
        const items = rowCandidates.slice(0, maximumRows);
        const rowStep = items.length ? Math.min(52, Math.max(34, rowAreaHeight / items.length)) : 40;
        const rowsTop = axisHeight + stageHeight + Math.max(0, (rowAreaHeight - rowStep * items.length) / 2);
        const milestoneTop = timeline.height - headerHeight - milestoneHeight;
        const coordinates = createTimelineCoordinates(range.start, range.end, timeline.width);
        const ticks = buildTimelineTicks({ rangeStart: range.start, rangeEnd: range.end, plotWidth: coordinates.plotWidth, scale: timeline.scale });
        const today = todayStr();
        const todayVisible = visibility.today && today >= range.start && today <= range.end;
        const status = timelineStatus(allItems, today);
        const todayLabel = `今天 ${Number(today.slice(5, 7))}/${Number(today.slice(8, 10))}${status.active ? ` · 进行中 ${status.active}` : ''}${status.overdue ? ` · 逾期 ${status.overdue}` : ''}`;
        const topLeft = worldToView({
          x: timeline.x - timeline.width / 2,
          y: timeline.y - timeline.height / 2,
        }, camera);
        const renderedHeight = timeline.collapsed ? headerHeight : timeline.height;
        const rangeSummary = `${formatTimelineRange(range.start, range.end)} · ${timelineScaleLabel(timeline.scale)}`;
        const selectedProjectCount = new Set(timeline.manualItems.filter((item) => item.source === 'project').map((item) => item.contextId)).size;
        const sourceLabel = timeline.source === 'manual'
          ? `已选 ${selectedProjectCount} 个项目`
          : timeline.source === 'project'
            ? `旧版项目 · ${projectPlanning.projects.find((project) => project.id === timeline.targetId)?.name ?? '未选择'}`
            : `旧版人生领域 · ${lifeTimeline.lifeMapAreas.find((area) => area.id === timeline.targetId)?.name ?? '未选择'}`;
        const unscheduledCount = timelineUnscheduledItemCount(timeline, projectPlanning);
        const contentSummary = `${sourceLabel} · ${allItems.length} 项${unscheduledCount ? ` · ${unscheduledCount} 项未排期` : ''}`;
        const automaticRange = !timeline.rangeStart && !timeline.rangeEnd;
        const emptyMessage = unscheduledCount ? `${unscheduledCount} 项尚未排期` : timeline.source === 'manual' ? '尚未选择分组或项目' : '暂无带日期的内容';
        const emptyDescription = unscheduledCount
          ? '为这些项目任务设置开始日期或截止日期后，它们会自动显示在这里'
          : timeline.source === 'manual'
          ? `从“显示范围”中勾选分组或项目${automaticRange ? `；自动显示未来 ${diffDays(range.end, range.start)} 天` : ''}`
          : '为该来源中的项目、任务或人生条目设置日期后，会自动显示在这里';
        const scale = camera.scale;
        const itemColor = (item: TimelineProjectionItem) => ({ '--timeline-item-color': item.color } as CSSProperties);
        return (
          <div
            key={timeline.id}
            className={`${styles.timeline} ${selectedTimelineId === timeline.id ? styles.timelineSelected : ''} ${timeline.locked ? styles.timelineLocked : ''}`}
            data-testid={`mind-map-timeline-${timeline.id}`}
            data-source={timeline.source}
            role="group"
            aria-label={`${timeline.title}，时间线`}
            style={{
              left: topLeft.x,
              top: topLeft.y,
              width: Math.max(1, timeline.width * camera.scale),
              height: Math.max(1, renderedHeight * camera.scale),
              borderRadius: Math.max(7, 15 * camera.scale),
            }}
            onPointerDown={(event) => handleTimelinePointerDown(event, timeline)}
            onPointerMove={handleTimelinePointerMove}
            onPointerUp={finishTimelineInteraction}
            onPointerCancel={finishTimelineInteraction}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              execute(timeline.collapsed ? '展开时间线' : '收起时间线', (current) => {
                const currentTimeline = current.timelineSections[timeline.id];
                return currentTimeline ? {
                  ...current,
                  timelineSections: {
                    ...current.timelineSections,
                    [timeline.id]: { ...currentTimeline, collapsed: !timeline.collapsed, updatedAt: Date.now() },
                  },
                } : current;
              });
            }}
          >
            {!timeline.collapsed && summaryMode ? (
              <div className={styles.timelineSummary} data-testid={`mind-map-timeline-drag-handle-${timeline.id}`} onPointerDown={(event) => handleTimelinePointerDown(event, timeline)} onPointerMove={handleTimelinePointerMove} onPointerUp={finishTimelineInteraction} onPointerCancel={finishTimelineInteraction}>
                <span><CalendarRange size={15} aria-hidden="true" /></span>
                <strong>{timeline.title}</strong>
                <small>{formatTimelineRange(range.start, range.end)}</small>
                <p>{contentSummary}</p>
              </div>
            ) : <>
              <div className={styles.timelineHeader} data-testid={`mind-map-timeline-drag-handle-${timeline.id}`} aria-label="拖动时间线" style={{ height: headerHeight * scale, paddingInline: Math.max(8, 14 * scale) }} onPointerDown={(event) => handleTimelinePointerDown(event, timeline)} onPointerMove={handleTimelinePointerMove} onPointerUp={finishTimelineInteraction} onPointerCancel={finishTimelineInteraction}>
                <div className={styles.timelineHeaderTitle}>
                  <CalendarRange size={Math.max(12, 16 * scale)} aria-hidden="true" />
                  <strong style={{ fontSize: Math.max(11, 15 * scale) }}>{timeline.title}</strong>
                  <span className={styles.timelineSource} title={contentSummary} style={{ fontSize: Math.max(8, 10 * scale) }}>{contentSummary}</span>
                </div>
                <div className={styles.timelineHeaderMeta}>
                  <span title={`${range.start} — ${range.end}`}>{rangeSummary}</span>
                  <button type="button" aria-label="打开时间线属性" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                    event.stopPropagation();
                    setSelectedTimelineId(timeline.id);
                  }}><MoreHorizontal size={Math.max(13, 16 * scale)} aria-hidden="true" /></button>
                </div>
              </div>
              {!timeline.collapsed && (
              <div className={styles.timelineBody} style={{ top: headerHeight * scale }}>
                <span className={styles.timelineLabelDivider} style={{ left: coordinates.plotLeft * scale }} />
                <span className={styles.timelineAxisLine} style={{ left: coordinates.plotLeft * scale, top: 39 * scale, width: coordinates.plotWidth * scale }} />
                {ticks.map((tick) => {
                  const x = dateToX(tick.date, coordinates) * scale;
                  return <span key={`${tick.kind}:${tick.date}`} className={`${styles.timelineTick} ${tick.kind === 'minor' ? styles.timelineTickMinor : ''}`} style={{ left: x }}>
                    {tick.kind === 'major' && <span className={styles.timelineTickLabel} style={{ fontSize: Math.max(9, 11 * scale) }}>{tick.label}{tick.sublabel && <small>{tick.sublabel}</small>}</span>}
                    <span className={styles.timelineGridLine} style={{ top: 39 * scale, height: Math.max(1, (milestoneTop - 39) * scale) }} />
                  </span>;
                })}
                {todayVisible && <span className={styles.timelineToday} style={{ left: dateToX(today, coordinates) * scale, top: 3 * scale, height: Math.max(1, (milestoneTop + 8) * scale) }}>
                  <span style={{ fontSize: Math.max(8, 10 * scale) }}>{todayLabel}</span>
                </span>}
                {allItems.length === 0 && <div className={styles.timelineEmpty} style={{ top: (axisHeight + 18) * scale }}>
                  <strong>{emptyMessage}</strong>
                  <span>{emptyDescription}</span>
                  <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                    event.stopPropagation();
                    setSelectedTimelineId(timeline.id);
                  }}>管理内容</button>
                </div>}
                {stages.map((item, stageRow) => {
                  const renderedDates = timelineTaskDates(item, timelineTaskInteraction);
                  const left = dateToX(renderedDates.start, coordinates) * scale;
                  const width = Math.max(8, (dateToX(renderedDates.end, coordinates) - dateToX(renderedDates.start, coordinates)) * scale);
                  return <span
                    key={item.id}
                    className={`${styles.timelineStageBand} ${item.lifeItemId ? styles.timelineEditable : ''}`}
                    title={`${item.title} · ${renderedDates.start} — ${renderedDates.end}`}
                      style={{ ...itemColor(item), left, top: (axisHeight + 6 + stageRow * stageRowHeight) * scale, width, height: Math.max(13, 23 * scale), fontSize: Math.max(9, 11 * scale) }}
                    onPointerDown={item.lifeItemId ? (event) => handleTimelineTaskPointerDown(event, item, timeline, range.start, range.end, 'move') : undefined}
                    onPointerMove={item.lifeItemId ? handleTimelineTaskPointerMove : undefined}
                    onPointerUp={item.lifeItemId ? finishTimelineTaskInteraction : undefined}
                    onPointerCancel={item.lifeItemId ? finishTimelineTaskInteraction : undefined}
                    onDoubleClick={item.lifeItemId ? (event) => event.stopPropagation() : undefined}
                  >
                    {item.title}
                    {item.lifeItemId && (
                      <>
                        <span
                          className={`${styles.timelineTaskHandle} ${styles.timelineTaskHandleStart}`}
                          role="button"
                          aria-label={`调整${item.title}开始日期`}
                          onPointerDown={(event) => handleTimelineTaskPointerDown(event, item, timeline, range.start, range.end, 'start')}
                          onPointerMove={handleTimelineTaskPointerMove}
                          onPointerUp={finishTimelineTaskInteraction}
                          onPointerCancel={finishTimelineTaskInteraction}
                        />
                        <span
                          className={`${styles.timelineTaskHandle} ${styles.timelineTaskHandleEnd}`}
                          role="button"
                          aria-label={`调整${item.title}结束日期`}
                          onPointerDown={(event) => handleTimelineTaskPointerDown(event, item, timeline, range.start, range.end, 'end')}
                          onPointerMove={handleTimelineTaskPointerMove}
                          onPointerUp={finishTimelineTaskInteraction}
                          onPointerCancel={finishTimelineTaskInteraction}
                        />
                      </>
                    )}
                  </span>;
                })}
                {items.map((item, row) => {
                  const renderedDates = timelineTaskDates(item, timelineTaskInteraction);
                  const left = dateToX(renderedDates.start, coordinates) * scale;
                  const width = Math.max(8, (dateToX(renderedDates.end, coordinates) - dateToX(renderedDates.start, coordinates)) * scale);
                  const rowTop = (rowsTop + row * rowStep) * scale;
                  const project = item.kind === 'project';
                  const task = item.kind === 'task';
                  const barHeight = (project ? 17 : task ? 13 : 14) * scale;
                  const progress = item.progress === undefined ? null : Math.max(0, Math.min(100, item.progress));
                  return (
                    <span key={item.id} className={styles.timelineRow} style={{ top: rowTop, height: rowStep * scale }}>
                      <span className={`${styles.timelineRowLabel} ${project ? styles.timelineProjectLabel : ''} ${task || item.parentId ? styles.timelineTaskLabel : ''}`} style={{ width: (coordinates.plotLeft - 16) * scale, fontSize: Math.max(9, (project ? 12 : 11) * scale) }}>
                        {project && <i style={{ backgroundColor: item.color }} />}{item.title}
                      </span>
                      <span
                        className={`${styles.timelineBar} ${project ? styles.timelineProjectBar : ''} ${task ? styles.timelineTaskBar : ''} ${item.kind === 'system' ? styles.timelineSystemBar : ''} ${item.projectTaskId || item.lifeItemId ? styles.timelineEditable : ''} ${item.progress === undefined ? styles.timelineBarNoProgress : ''}`}
                        title={`${item.title} · ${renderedDates.start}${renderedDates.end !== renderedDates.start ? ` — ${renderedDates.end}` : ''}`}
                        style={{ ...itemColor(item), left, top: (rowStep * scale - Math.max(7, barHeight)) / 2, width, height: Math.max(7, barHeight) }}
                        onPointerDown={item.projectTaskId || item.lifeItemId ? (event) => handleTimelineTaskPointerDown(event, item, timeline, range.start, range.end, 'move') : undefined}
                        onPointerMove={item.projectTaskId || item.lifeItemId ? handleTimelineTaskPointerMove : undefined}
                        onPointerUp={item.projectTaskId || item.lifeItemId ? finishTimelineTaskInteraction : undefined}
                        onPointerCancel={item.projectTaskId || item.lifeItemId ? finishTimelineTaskInteraction : undefined}
                        onDoubleClick={item.projectTaskId || item.lifeItemId ? (event) => event.stopPropagation() : undefined}
                      >
                      {visibility.progress && progress !== null && <span className={styles.timelineBarProgress} style={{ width: `${progress}%` }} />}
                      {visibility.progress && progress !== null && width >= 38 && <b className={styles.timelineProgressLabel} style={{ fontSize: Math.max(7, 9 * scale) }}>{progress}%</b>}
                      {(item.projectTaskId || item.lifeItemId) && (
                        <>
                          <span
                            className={`${styles.timelineTaskHandle} ${styles.timelineTaskHandleStart}`}
                            role="button"
                            aria-label={`调整${item.title}开始日期`}
                            onPointerDown={(event) => handleTimelineTaskPointerDown(event, item, timeline, range.start, range.end, 'start')}
                            onPointerMove={handleTimelineTaskPointerMove}
                            onPointerUp={finishTimelineTaskInteraction}
                            onPointerCancel={finishTimelineTaskInteraction}
                          />
                          <span
                            className={`${styles.timelineTaskHandle} ${styles.timelineTaskHandleEnd}`}
                            role="button"
                            aria-label={`调整${item.title}结束日期`}
                            onPointerDown={(event) => handleTimelineTaskPointerDown(event, item, timeline, range.start, range.end, 'end')}
                            onPointerMove={handleTimelineTaskPointerMove}
                            onPointerUp={finishTimelineTaskInteraction}
                            onPointerCancel={finishTimelineTaskInteraction}
                          />
                        </>
                      )}
                      </span>
                    </span>
                  );
                })}
                {milestones.map((item, index) => {
                  const stack = milestones.slice(0, index).filter((candidate) => candidate.start === item.start).length;
                  return <span
                    key={item.id}
                    className={`${styles.timelineMilestoneItem} ${item.lifeItemId ? styles.timelineEditable : ''}`}
                    title={`${item.title} · ${item.start}`}
                    style={{ ...itemColor(item), left: dateToX(item.start, coordinates) * scale, top: (milestoneTop + stack * 12) * scale, fontSize: Math.max(8, 10 * scale) }}
                    onPointerDown={item.lifeItemId ? (event) => handleTimelineTaskPointerDown(event, item, timeline, range.start, range.end, 'move') : undefined}
                    onPointerMove={item.lifeItemId ? handleTimelineTaskPointerMove : undefined}
                    onPointerUp={item.lifeItemId ? finishTimelineTaskInteraction : undefined}
                    onPointerCancel={item.lifeItemId ? finishTimelineTaskInteraction : undefined}
                    onDoubleClick={item.lifeItemId ? (event) => event.stopPropagation() : undefined}
                  ><i /> <span>{item.title}</span></span>;
                })}
                {rowCandidates.length > items.length && <button type="button" className={styles.timelineOverflow} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => {
                  event.stopPropagation();
                  execute('展开时间线内容', (current) => {
                    const currentTimeline = current.timelineSections[timeline.id];
                    if (!currentTimeline) return current;
                    return {
                      ...current,
                      timelineSections: {
                        ...current.timelineSections,
                        [timeline.id]: {
                          ...currentTimeline,
                          height: Math.max(currentTimeline.height, recommendedTimelineHeight(allItems)),
                          updatedAt: Date.now(),
                        },
                      },
                    };
                  });
                }}>显示其余 {rowCandidates.length - items.length} 项</button>}
              </div>
              )}
            </>}
            {selectedTimelineId === timeline.id && !timeline.locked && !timeline.collapsed && (
              <span
                className={styles.timelineResizeHandle}
                role="button"
                aria-label="调整时间线尺寸"
                onPointerDown={(event) => handleTimelineResizePointerDown(event, timeline)}
                onPointerMove={handleTimelinePointerMove}
                onPointerUp={finishTimelineInteraction}
                onPointerCancel={finishTimelineInteraction}
              />
            )}
          </div>
        );
      })}
      {(timelineEditError || projectDateUndo || lifeDateUpdated) && (
        <div className={styles.timelineEditNotice} role={timelineEditError ? 'alert' : 'status'}>
          <span>{timelineEditError ?? (lifeDateUpdated ? '人生规划日期已更新，可使用地图撤销恢复' : '项目任务日期已更新')}</span>
          {projectDateUndo && !timelineEditError && (
            <button type="button" onClick={() => {
              if (!projectPlanningAdapter.updateTaskDates(projectDateUndo.taskId, projectDateUndo.start, projectDateUndo.end)) {
                setTimelineEditError('无法撤销：源任务可能已被删除。');
                return;
              }
              setProjectDateUndo(null);
            }}>撤销项目日期</button>
          )}
          <button type="button" aria-label="关闭项目日期提示" onClick={() => {
              setTimelineEditError(null);
              setProjectDateUndo(null);
              setLifeDateUpdated(false);
          }}>×</button>
        </div>
      )}
      {visibleProjectReferences.map((sourceReference) => {
        const reference = previewProjectReference(sourceReference, interaction);
        const snapshot = projectReferenceSnapshot(reference, projectPlanning);
        const topLeft = worldToView({
          x: reference.x - reference.width / 2,
          y: reference.y - reference.height / 2,
        }, camera);
        const compact = reference.display === 'compact';
        return (
          <div
            key={reference.id}
            className={`${styles.projectReference} ${selectedProjectReferenceId === reference.id ? styles.projectReferenceSelected : ''} ${activeRelationTarget?.ref.type === 'project-reference' && activeRelationTarget.ref.id === reference.id ? styles.projectReferenceRelationTarget : ''} ${reference.locked ? styles.projectReferenceLocked : ''}`}
            data-testid={`mind-map-project-reference-${reference.id}`}
            data-display={reference.display}
            role="button"
            tabIndex={0}
            aria-label={`${snapshot ? snapshot.title : '引用已失效'}，项目引用`}
            style={{
              left: topLeft.x,
              top: topLeft.y,
              width: Math.max(1, reference.width * camera.scale),
              height: Math.max(1, reference.height * camera.scale),
              borderRadius: Math.max(4, 12 * camera.scale),
              padding: `${Math.max(4, 10 * camera.scale)}px ${Math.max(5, 12 * camera.scale)}px`,
              fontSize: Math.max(8, 14 * camera.scale),
            }}
            onPointerDown={(event) => handleProjectReferencePointerDown(event, reference)}
            onPointerMove={handleProjectReferencePointerMove}
            onPointerUp={finishProjectReferenceInteraction}
            onPointerCancel={finishProjectReferenceInteraction}
            onPointerEnter={() => setHoveredProjectReferenceId(reference.id)}
            onPointerLeave={() => setHoveredProjectReferenceId((current) => current === reference.id ? null : current)}
            onDoubleClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              execute(compact ? '展开项目引用' : '收起项目引用', (current) => {
                const currentReference = current.projectReferences[reference.id];
                return currentReference ? {
                  ...current,
                  projectReferences: {
                    ...current.projectReferences,
                    [reference.id]: { ...currentReference, display: compact ? 'expanded' : 'compact', height: compact ? Math.max(118, currentReference.height) : Math.min(84, currentReference.height), updatedAt: Date.now() },
                  },
                } : current;
              });
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              openProjectReferenceMenu(reference, event.clientX, event.clientY);
            }}
          >
            <span className={styles.projectReferenceAccent} style={{ backgroundColor: snapshot?.color ?? '#9ca3af' }} />
            {(selectedProjectReferenceId === reference.id || hoveredProjectReferenceId === reference.id) && (
              <span className={styles.projectReferenceActions}>
                <button
                  type="button"
                  aria-label="创建关联"
                  title="拖动以创建关联"
                  onPointerDown={(event) => handleProjectReferenceRelationPointerDown(event, reference)}
                  onPointerMove={handleProjectReferenceRelationPointerMove}
                  onPointerUp={finishProjectReferenceRelation}
                  onPointerCancel={finishProjectReferenceRelation}
                >↗</button>
                <button
                  type="button"
                  aria-label="项目引用更多操作"
                  title="更多操作"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openProjectReferenceMenu(reference, event.clientX, event.clientY);
                  }}
                ><MoreHorizontal size={13} aria-hidden="true" /></button>
              </span>
            )}
            <span className={styles.projectReferenceHeader}>
              <span className={styles.projectReferenceKind} aria-hidden="true">▣</span>
              <strong className={styles.projectReferenceTitle}>{snapshot?.title ?? '引用已失效'}</strong>
              {snapshot?.progress !== undefined && <span className={styles.projectReferenceProgressValue}>{Math.round(snapshot.progress)}%</span>}
            </span>
            <span className={styles.projectReferenceSubtitle}>
              {snapshot?.subtitle ?? '源项目、任务或里程碑已不存在'}
            </span>
            {!compact && snapshot?.progress !== undefined && (
              <span className={styles.projectReferenceProgress} aria-label={`进度 ${snapshot.progress}%`}>
                <span style={{ width: `${Math.max(0, Math.min(100, snapshot.progress))}%`, backgroundColor: snapshot.color }} />
              </span>
            )}
          </div>
        );
      })}
      {visibleNodes.flatMap((sourceNode) => {
        const node = previewNode(sourceNode, interaction);
        const source = node.imageAssetId ? imageAssetUrls[node.imageAssetId] : node.imageSrc;
        if (node.type !== 'image' || !source || failedImageIds.has(node.id)) return [];
        const topLeft = worldToView({ x: node.x - node.width / 2, y: node.y - node.height / 2 }, camera);
        return [(
          <img
            key={node.id}
            className={styles.imagePreview}
            src={source}
            alt=""
            draggable={false}
            onLoad={() => setFailedImageIds((current) => {
              if (!current.has(node.id)) return current;
              const next = new Set(current);
              next.delete(node.id);
              return next;
            })}
            onError={() => setFailedImageIds((current) => new Set(current).add(node.id))}
            style={{
              left: topLeft.x + 8 * camera.scale,
              top: topLeft.y + 8 * camera.scale,
              width: Math.max(1, (node.width - 16) * camera.scale),
              height: Math.max(1, (node.height - 34) * camera.scale),
              borderRadius: Math.max(2, (node.style.borderRadius - 3) * camera.scale),
              transform: `rotate(${node.rotation}deg)`,
            }}
          />
        )];
      })}
      {remotePresences.flatMap((presence) => {
        if (!presence.cursor) return [];
        const position = worldToView(presence.cursor, camera);
        if (position.x < -80 || position.y < -40 || position.x > size.width + 80 || position.y > size.height + 40) return [];
        return [(
          <div
            key={presence.connectionId}
            className={styles.remoteCursor}
            style={{ left: position.x, top: position.y, color: presence.color }}
            aria-hidden="true"
          >
            <span className={styles.remoteCursorDot} />
            <span className={styles.remoteCursorName} style={{ backgroundColor: presence.color }}>
              {presence.name}{presence.editingId ? ' · 编辑中' : presence.draggingId ? ' · 移动中' : ''}
            </span>
          </div>
        )];
      })}
      {Object.keys(canvasNodes).length > 0 && (
        <canvas
          ref={minimapRef}
          className={styles.minimap}
          width={MINIMAP_WIDTH}
          height={MINIMAP_HEIGHT}
          aria-label="思维导图小地图"
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            const miniX = (event.clientX - rect.left) * MINIMAP_WIDTH / rect.width;
            const miniY = (event.clientY - rect.top) * MINIMAP_HEIGHT / rect.height;
            const transform = minimapTransformRef.current;
            const world = {
              x: transform.left + miniX / transform.scale,
              y: transform.top + miniY / transform.scale,
            };
            const scale = cameraRef.current.scale;
            updateCamera({ x: size.width / 2 - world.x * scale, y: size.height / 2 - world.y * scale, scale }, true);
          }}
        />
      )}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className={styles.contextMenu}
          role="menu"
          aria-label={contextMenu.projectReferenceId ? '项目引用菜单' : contextMenu.nodeId ? '节点菜单' : contextMenu.edgeId ? '连线菜单' : '画布菜单'}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              setContextMenu(null);
              restoreCanvasFocus();
            }
          }}
        >
          {contextMenu.projectReferenceId && document.projectReferences[contextMenu.projectReferenceId] && (
            <>
              <button type="button" role="menuitem" onClick={() => {
                const id = contextMenu.projectReferenceId!;
                execute('切换项目引用显示', (current) => {
                  const reference = current.projectReferences[id];
                  return reference ? {
                    ...current,
                    projectReferences: {
                      ...current.projectReferences,
                      [id]: { ...reference, display: reference.display === 'compact' ? 'expanded' : 'compact', height: reference.display === 'compact' ? Math.max(120, reference.height) : Math.min(96, reference.height), updatedAt: Date.now() },
                    },
                  } : current;
                });
                setContextMenu(null);
              }}>{document.projectReferences[contextMenu.projectReferenceId].display === 'compact' ? '展开卡片' : '收起卡片'}</button>
              <button type="button" role="menuitem" onClick={() => {
                const id = contextMenu.projectReferenceId!;
                execute('切换项目引用锁定', (current) => {
                  const reference = current.projectReferences[id];
                  return reference ? {
                    ...current,
                    projectReferences: {
                      ...current.projectReferences,
                      [id]: { ...reference, locked: !reference.locked, updatedAt: Date.now() },
                    },
                  } : current;
                });
                setContextMenu(null);
              }}>{document.projectReferences[contextMenu.projectReferenceId].locked ? '解除锁定' : '锁定卡片'}</button>
              <button type="button" role="menuitem" onClick={() => {
                const id = contextMenu.projectReferenceId!;
                execute('删除项目引用', (current) => {
                  const projectReferences = { ...current.projectReferences };
                  delete projectReferences[id];
                  return {
                    ...current,
                    projectReferences,
                    edges: Object.fromEntries(Object.entries(current.edges).filter(([, edge]) => !edgeTouchesCanvasObject(edge, { type: 'project-reference', id }))),
                  };
                });
                setSelectedProjectReferenceId(null);
                setContextMenu(null);
              }}>删除引用</button>
            </>
          )}
          {contextMenu.nodeId && document.nodes[contextMenu.nodeId] && (
            <>
              <button type="button" role="menuitem" onClick={() => {
                startEditingNode(document.nodes[contextMenu.nodeId!]);
                setContextMenu(null);
              }}>编辑文本</button>
              <button type="button" role="menuitem" onClick={() => {
                copySelection();
                setContextMenu(null);
              }}>复制</button>
              <button type="button" role="menuitem" onClick={() => {
                createChildNode(contextMenu.nodeId!);
                setContextMenu(null);
              }}>创建子节点</button>
              <button type="button" role="menuitem" onClick={() => {
                createSiblingNode(contextMenu.nodeId!);
                setContextMenu(null);
              }}>创建同级节点</button>
              <button type="button" role="menuitem" onClick={() => selectBranch(contextMenu.nodeId!)}>选择整个分支</button>
              <button type="button" role="menuitem" onClick={() => focusBranch(contextMenu.nodeId!)}>仅查看此分支</button>
              <button type="button" role="menuitem" onClick={() => {
                const nodeId = contextMenu.nodeId!;
                const candidate = window.prompt('输入目标父节点名称');
                const parent = candidate ? Object.values(document.nodes).find((node) => node.text === candidate.trim()) : null;
                if (parent) moveNodeToParent(nodeId, parent.id);
                setContextMenu(null);
              }}>移动到…</button>
              <button type="button" role="menuitem" onClick={() => {
                const node = document.nodes[contextMenu.nodeId!];
                updateNode(node.id, { locked: !node.locked });
                setContextMenu(null);
              }}>{document.nodes[contextMenu.nodeId].locked ? '解除锁定' : '锁定节点'}</button>
              <button type="button" role="menuitem" onClick={() => {
                const id = contextMenu.nodeId!;
                execute('节点置顶', (current) => ({ ...current, zOrder: [...current.zOrder.filter((item) => item !== id), id] }));
                setContextMenu(null);
              }}>置于顶层</button>
              <button type="button" role="menuitem" onClick={() => {
                deleteNodes([contextMenu.nodeId!]);
                setSelectedNodeIds([]);
                setContextMenu(null);
              }}>删除节点</button>
            </>
          )}
          {contextMenu.edgeId && document.edges[contextMenu.edgeId] && (
            <>
              <button type="button" role="menuitem" onClick={() => {
                const edge = document.edges[contextMenu.edgeId!];
                const source = edgeSourceRef(edge);
                const target = edgeTargetRef(edge);
                updateEdge(edge.id, { source: target, target: source, sourceId: target.id, targetId: source.id });
                setContextMenu(null);
              }}>反转连线</button>
              <button type="button" role="menuitem" onClick={() => {
                deleteEdges([contextMenu.edgeId!]);
                setSelectedEdgeIds([]);
                setContextMenu(null);
              }}>删除连线</button>
            </>
          )}
          {!contextMenu.projectReferenceId && !contextMenu.nodeId && !contextMenu.edgeId && (
            <>
              {focusedBranchRootId && <button type="button" role="menuitem" onClick={() => {
                exitBranchFocus();
                setContextMenu(null);
              }}>退出分支聚焦</button>}
              <button type="button" role="menuitem" onClick={() => {
                setEditing({
                  nodeId: null,
                  x: contextMenu.world.x,
                  y: contextMenu.world.y,
                  width: 180,
                  height: 56,
                  draft: '',
                  newNodeType: creationType,
                });
                setContextMenu(null);
              }}>创建节点</button>
              <button type="button" role="menuitem" disabled={!clipboardRef.current} onClick={() => {
                pasteSelection();
                setContextMenu(null);
              }}>粘贴</button>
              <button type="button" role="menuitem" onClick={() => {
                setSelectedNodeIds(Object.keys(document.nodes));
                setContextMenu(null);
              }}>全选</button>
              <button type="button" role="menuitem" onClick={() => {
                fitAll();
                setContextMenu(null);
              }}>适合画布</button>
              <button type="button" role="menuitem" onClick={() => {
                execute('切换网格', (current) => ({
                  ...current,
                  settings: { ...current.settings, grid: current.settings.grid === 'none' ? 'dots' : 'none' },
                }));
                setContextMenu(null);
              }}>{document.settings.grid === 'none' ? '显示网格' : '隐藏网格'}</button>
            </>
          )}
        </div>
      )}
      <button className={styles.unifiedEntry} type="button" onClick={() => {
        setCommandOpen(true);
        setCommandSearch('');
      }}>
        <Search size={14} aria-hidden="true" />
        <span>搜索或命令</span>
        <kbd>Ctrl K</kbd>
      </button>
      {commandOpen && (
        <div className={styles.commandBackdrop} role="presentation" onPointerDown={() => setCommandOpen(false)}>
          <div
            className={styles.commandPalette}
            role="dialog"
            aria-modal="true"
            aria-label="搜索与命令"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <input
              ref={commandInputRef}
              type="search"
              aria-label="搜索思维导图"
              placeholder="搜索节点、连线或命令"
              value={commandSearch}
              onChange={(event) => setCommandSearch(event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Escape') setCommandOpen(false);
              }}
            />
            {searchResults.length > 0 && (
              <div className={styles.searchResults} role="listbox" aria-label="思维导图搜索结果">
                {searchResults.map((result) => (
                  <button
                    key={result.kind + result.id}
                    type="button"
                    role="option"
                    aria-selected={result.kind === 'node' ? selectedSet.has(result.id) : selectedEdgeIds.includes(result.id)}
                    onClick={() => revealSearchResult(result)}
                  >
                    <span>{result.kind === 'node' ? '节点' : '连线'}</span>
                    {result.label}
                  </button>
                ))}
              </div>
            )}
            <div className={styles.commandList}>
              {[
                { label: '适合全部内容', run: fitAll },
                { label: '适合当前选择', run: () => fit(selectedNodeIds.map((id) => canvasNodes[id]).filter((node): node is MindMapNode => Boolean(node))) },
                { label: '从左到右树形布局', run: () => { void runTreeLayout(); } },
                { label: document.settings.grid === 'none' ? '显示网格' : '隐藏网格', run: () => execute('切换网格', (current) => ({ ...current, settings: { ...current.settings, grid: current.settings.grid === 'none' ? 'dots' : 'none' } })) },
                { label: '选择全部节点', run: () => { setSelectedNodeIds(Object.keys(canvasNodes)); setSelectedEdgeIds([]); setSelectedSectionId(null); } },
                { label: '在视口中心创建节点', run: () => {
                  const world = viewToWorld({ x: size.width / 2, y: size.height / 2 }, cameraRef.current);
                  setEditing({ nodeId: null, x: world.x, y: world.y, width: 180, height: 56, draft: '', newNodeType: creationType });
                } },
              ].filter((command) => command.label.includes(commandSearch.trim())).map((command) => (
                <button key={command.label} type="button" onClick={() => {
                  command.run();
                  setCommandOpen(false);
                }}>{command.label}</button>
              ))}
            </div>
          </div>
        </div>
      )}
      {editing && editingTopLeft && (
        <textarea
          ref={editorRef}
          className={styles.editor}
          aria-label={editing.nodeId ? '编辑节点文本' : '新节点文本'}
          value={editing.draft}
          style={{
            left: editingTopLeft.x,
            top: editingTopLeft.y,
            width: Math.max(80, editing.width * camera.scale),
            height: Math.max(40, editing.height * camera.scale),
            fontSize: Math.max(12, 15 * camera.scale),
          }}
          onChange={(event) => setEditing({ ...editing, draft: event.target.value })}
          onCompositionStart={() => { composing.current = true; }}
          onCompositionEnd={() => { composing.current = false; }}
          onBlur={() => commitEditing()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') {
              event.preventDefault();
              cancelEditing(true);
            } else if (event.key === 'Tab' && !composing.current) {
              event.preventDefault();
              commitEditing(false, 'child');
            } else if (event.key === 'Enter' && !event.shiftKey && !composing.current) {
              event.preventDefault();
              commitEditing(false, 'sibling');
            }
          }}
        />
      )}
      {Object.keys(document.nodes).length === 0
        && Object.keys(document.projectReferences).length === 0
        && Object.keys(document.timelineSections).length === 0
        && !editing && (
        <div className={styles.emptyOverlay} aria-hidden="true">
          <strong>双击画布创建第一个节点</strong>
          <span>空白处拖动平移，Shift 拖动框选，滚轮缩放</span>
        </div>
      )}
      {inspectorOpen && (
        <aside
          className={`${styles.inspector} ${selectedTimeline ? styles.timelineInspector : ''}`}
          aria-label={selectedTimeline ? '时间线属性' : selectedProjectReference ? '项目引用属性' : selectedNode ? '节点属性' : selectedEdge ? '连线属性' : selectedSection ? '区域属性' : '多选排列'}
        >
          <div className={styles.inspectorHeader}>
            <strong>{selectedTimeline ? '时间线' : selectedProjectReference ? '项目引用' : selectedNode ? '节点' : selectedEdge ? '连线' : selectedSection ? '区域' : `排列 ${selectedNodeIds.length} 个节点`}</strong>
            <button
              type="button"
              aria-label="关闭属性面板"
              onClick={() => {
                setSelectedNodeIds([]);
                setSelectedEdgeIds([]);
                setSelectedSectionId(null);
                setSelectedProjectReferenceId(null);
                setSelectedTimelineId(null);
              }}
            >
              ×
            </button>
          </div>
          {selectedTimeline && (
            <div className={styles.inspectorFields}>
              <label>
                <span>名称</span>
                <input
                  type="text"
                  aria-label="时间线名称"
                  defaultValue={selectedTimeline.title}
                  maxLength={120}
                  onBlur={(event) => execute('重命名时间线', (current) => ({
                    ...current,
                    timelineSections: {
                      ...current.timelineSections,
                      [selectedTimeline.id]: { ...selectedTimeline, title: event.target.value.trim() || '时间线', updatedAt: Date.now() },
                    },
                  }))}
                />
              </label>
              {(() => {
                const selectedProjectIds = new Set(timelineSelectedProjectIds(selectedTimeline, projectPlanning));
                const selectedGroups = (projectPlanning.groups ?? []).filter((group) => projectPlanning.projects.some((project) => project.groupId === group.id && selectedProjectIds.has(project.id)));
                const names = selectedGroups.slice(0, 2).map((group) => group.name);
                const summary = names.length && selectedGroups.length <= 2 ? names.join('、') : `${selectedGroups.length} 个分组 · ${selectedProjectIds.size} 个项目`;
                return <section className={styles.timelineSummarySection} aria-label="内容范围">
                  <h3>内容范围</h3>
                  <div className={styles.timelineSummaryRow}>
                    <div><strong>{summary || '尚未选择内容'}</strong><small>{selectedGroups.length} 个分组 · {selectedProjectIds.size} 个项目</small></div>
                    <button type="button" className={styles.timelineChangeButton} onClick={() => {
                      setTimelineSelectorSearch('');
                      setTimelineSelectorFilter('all');
                      setTimelineSelectorOpen(true);
                    }}>更改 <span aria-hidden="true">›</span></button>
                  </div>
                </section>;
              })()}
              <label>
                <span>尺度</span>
                <select
                  aria-label="时间线尺度"
                  value={selectedTimeline.scale}
                  onChange={(event) => execute('设置时间线尺度', (current) => ({
                    ...current,
                    timelineSections: {
                      ...current.timelineSections,
                      [selectedTimeline.id]: { ...selectedTimeline, scale: event.target.value as TimelineSection['scale'], updatedAt: Date.now() },
                    },
                  }))}
                >
                  <option value="long-range">长期</option>
                  <option value="month">月</option>
                  <option value="week">周</option>
                </select>
              </label>
              <div className={styles.timelineRangeFields}>
                <span>时间范围</span>
                <label><input type="date" aria-label="时间线开始日期" value={selectedTimeline.rangeStart ?? ''} onChange={(event) => execute('设置时间线范围', (current) => ({
                  ...current,
                  timelineSections: { ...current.timelineSections, [selectedTimeline.id]: { ...selectedTimeline, rangeStart: event.target.value || null, updatedAt: Date.now() } },
                }))} /></label>
                <b>→</b>
                <label><input type="date" aria-label="时间线结束日期" value={selectedTimeline.rangeEnd ?? ''} onChange={(event) => execute('设置时间线范围', (current) => ({
                  ...current,
                  timelineSections: { ...current.timelineSections, [selectedTimeline.id]: { ...selectedTimeline, rangeEnd: event.target.value || null, updatedAt: Date.now() } },
                }))} /></label>
              </div>
              <section className={styles.timelineDisplaySection} aria-label="显示设置">
                <h3>显示内容</h3>
                <div className={styles.timelineVisibilityChips} aria-label="当前显示内容">
                  {([
                    ['stages', '阶段'],
                    ['milestones', '关键日期'],
                    ['progress', '进度'],
                    ['today', '今天线'],
                  ] as const).map(([key, label]) => {
                    const active = (timelineVisibility[selectedTimeline.id] ?? DEFAULT_TIMELINE_VISIBILITY)[key];
                    return <button type="button" aria-label={`显示${label}`} aria-pressed={active} className={`${styles.timelineVisibilityChip} ${active ? styles.timelineVisibilityChipActive : ''}`} key={key} onClick={() => toggleTimelineVisibility(selectedTimeline.id, key)}>{active ? '✓ ' : ''}{label}</button>;
                  })}
                </div>
              </section>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  aria-label="收起时间线"
                  checked={selectedTimeline.collapsed}
                  onChange={(event) => execute('切换时间线折叠', (current) => ({
                    ...current,
                    timelineSections: {
                      ...current.timelineSections,
                      [selectedTimeline.id]: { ...selectedTimeline, collapsed: event.target.checked, updatedAt: Date.now() },
                    },
                  }))}
                />
                <span>收起</span>
              </label>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  aria-label="锁定时间线"
                  checked={selectedTimeline.locked}
                  onChange={(event) => execute('切换时间线锁定', (current) => ({
                    ...current,
                    timelineSections: {
                      ...current.timelineSections,
                      [selectedTimeline.id]: { ...selectedTimeline, locked: event.target.checked, updatedAt: Date.now() },
                    },
                  }))}
                />
                <span>锁定组件</span>
              </label>
              <button className={styles.dangerAction} type="button" onClick={() => {
                execute('删除时间线', (current) => {
                  const timelineSections = { ...current.timelineSections };
                  delete timelineSections[selectedTimeline.id];
                  return { ...current, timelineSections };
                });
                setSelectedTimelineId(null);
              }}>删除时间线</button>
              <small>拖动组件只改变画布位置，不会修改任何项目日期。</small>
            </div>
          )}
          {timelineSelectorOpen && selectedTimeline && (() => {
            const selectedProjectIds = new Set(selectedTimeline.manualItems.filter((item) => item.source === 'project').map((item) => item.contextId));
            const groups = projectPlanning.groups ?? [];
            const groupProjects = new Map(groups.map((group) => [group.id, projectPlanning.projects.filter((project) => project.groupId === group.id)]));
            const query = timelineSelectorSearch.trim().toLocaleLowerCase();
            const matches = (project: typeof projectPlanning.projects[number], groupName = '') => !query || `${groupName} ${project.name}`.toLocaleLowerCase().includes(query);
            const visibleProject = (project: typeof projectPlanning.projects[number], groupName = '') => (timelineSelectorFilter === 'all' || selectedProjectIds.has(project.id)) && matches(project, groupName);
            const updateProjects = (projectIds: string[], checked: boolean) => execute('设置时间线显示内容', (current) => {
              const timeline = current.timelineSections[selectedTimeline.id];
              if (!timeline) return current;
              const ids = new Set(projectIds);
              const references = timeline.manualItems.filter((item) => !(item.source === 'project' && ids.has(item.contextId)));
              const additions = checked ? projectIds.flatMap((id) => projectTimelineItems(id, projectPlanning).map((item) => ({ source: 'project' as const, contextId: id, itemId: item.id }))) : [];
              const next = { ...timeline, source: 'manual' as const, targetId: null, manualItems: [...references, ...additions] };
              return { ...current, timelineSections: { ...current.timelineSections, [timeline.id]: { ...next, height: recommendedTimelineHeight(timelineProjectionItems(next, projectPlanning, lifeTimeline)), updatedAt: Date.now() } } };
            });
            const projectRow = (project: typeof projectPlanning.projects[number], groupName = '') => <label className={styles.timelineSelectorProject} key={project.id}>
              <input type="checkbox" checked={selectedProjectIds.has(project.id)} onChange={(event) => updateProjects([project.id], event.target.checked)} />
              <span><strong>{project.name}</strong>{(project.start || project.end) && <small>{project.start || '—'} — {project.end || '—'}</small>}</span>
              {query && groupName && <em>{groupName}</em>}
            </label>;
            const renderGroup = (group: typeof groups[number]) => {
              const projects = groupProjects.get(group.id) ?? [];
              const selectedCount = projects.filter((project) => selectedProjectIds.has(project.id)).length;
              const expanded = timelineExpandedGroups.has(group.id) || timelineExpandedProjects.has(group.id) || Boolean(query) || timelineSelectorFilter === 'selected';
              const shown = expanded ? projects.filter((project) => visibleProject(project, group.name)) : projects.filter((project) => selectedProjectIds.has(project.id) || visibleProject(project, group.name)).slice(0, 8);
              if (query && !shown.length) return null;
              return <div className={styles.timelineSelectorGroup} key={group.id}>
                <div className={styles.timelineSelectorGroupHeader}>
                  <button type="button" aria-label={`${expanded ? '收起' : '展开'}${group.name}`} onClick={() => setTimelineExpandedGroups((current) => { const next = new Set(current); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next; })}>{expanded ? '▾' : '›'}</button>
                  <label className={styles.timelineSelectorGroupChoice}>
                    <input type="checkbox" aria-label={`整个分组 ${group.name}`} checked={selectedCount === projects.length && projects.length > 0} ref={(element) => { if (element) element.indeterminate = selectedCount > 0 && selectedCount < projects.length; }} onChange={(event) => updateProjects(projects.map((project) => project.id), event.target.checked)} />
                    <strong>{group.name}</strong>
                  </label>
                  <small>{selectedCount} / {projects.length}</small>
                </div>
                {expanded && <div className={styles.timelineSelectorProjects}>{shown.map((project) => projectRow(project, group.name))}{projects.length > shown.length && <button type="button" className={styles.timelineShowMore} onClick={() => setTimelineExpandedProjects((current) => new Set(current).add(group.id))}>显示其余 {projects.length - shown.length} 个</button>}</div>}
              </div>;
            };
            const ungrouped = projectPlanning.projects.filter((project) => !project.groupId || !groupProjects.has(project.groupId));
            const visibleUngrouped = ungrouped.filter((project) => visibleProject(project));
            const matchingGroups = groups.filter((group) => !query && timelineSelectorFilter === 'all' || (groupProjects.get(group.id) ?? []).some((project) => visibleProject(project, group.name)));
            return <div className={styles.timelineSelectorOverlay} role="dialog" aria-label="选择显示内容">
              <div className={styles.timelineSelectorHeader}><strong>选择显示内容</strong><button type="button" aria-label="关闭选择显示内容" onClick={() => setTimelineSelectorOpen(false)}>×</button></div>
              <div className={styles.timelineSelectorTools}><label><Search size={14} aria-hidden="true" /><input autoFocus type="search" placeholder="搜索分组或项目……" value={timelineSelectorSearch} onChange={(event) => setTimelineSelectorSearch(event.target.value)} /></label><div role="tablist" aria-label="内容筛选"><button type="button" className={timelineSelectorFilter === 'all' ? styles.timelineFilterActive : ''} onClick={() => setTimelineSelectorFilter('all')}>全部</button><button type="button" className={timelineSelectorFilter === 'selected' ? styles.timelineFilterActive : ''} onClick={() => setTimelineSelectorFilter('selected')}>已选择</button></div></div>
              <div className={styles.timelineSelectorList}>{matchingGroups.map(renderGroup)}{ungrouped.length > 0 && visibleUngrouped.length > 0 && <div className={styles.timelineSelectorGroup}><div className={styles.timelineSelectorGroupHeader}><strong>未分组项目</strong><small>{visibleUngrouped.filter((project) => selectedProjectIds.has(project.id)).length} / {ungrouped.length}</small></div>{visibleUngrouped.map((project) => projectRow(project))}</div>}{!projectPlanning.projects.length && <p className={styles.timelineSelectorEmpty}>暂无可显示项目</p>}{projectPlanning.projects.length > 0 && !matchingGroups.length && !visibleUngrouped.length && <p className={styles.timelineSelectorEmpty}>没有找到“{timelineSelectorSearch}”</p>}</div>
              <div className={styles.timelineSelectorFooter}><span>已选择 {selectedProjectIds.size} 个项目</span><button type="button" onClick={() => updateProjects([...selectedProjectIds], false)}>清空选择</button><button type="button" onClick={() => setTimelineSelectorOpen(false)}>完成</button></div>
            </div>;
          })()}
          {selectedProjectReference && (
            <div className={styles.inspectorFields}>
              <p>此卡片实时读取源数据，不保存标题、日期或进度副本。</p>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  aria-label="锁定项目引用"
                  checked={selectedProjectReference.locked}
                  onChange={(event) => execute('切换项目引用锁定', (current) => ({
                    ...current,
                    projectReferences: {
                      ...current.projectReferences,
                      [selectedProjectReference.id]: {
                        ...selectedProjectReference,
                        locked: event.target.checked,
                        updatedAt: Date.now(),
                      },
                    },
                  }))}
                />
                <span>锁定卡片</span>
              </label>
              <button className={styles.dangerAction} type="button" onClick={() => {
                execute('删除项目引用', (current) => {
                  const projectReferences = { ...current.projectReferences };
                  delete projectReferences[selectedProjectReference.id];
                  return {
                    ...current,
                    projectReferences,
                    edges: Object.fromEntries(Object.entries(current.edges).filter(([, edge]) => !edgeTouchesCanvasObject(edge, { type: 'project-reference', id: selectedProjectReference.id }))),
                  };
                });
                setSelectedProjectReferenceId(null);
              }}>删除引用</button>
            </div>
          )}
          {selectedNodeIds.length > 1 && !selectedNode && (
            <div className={styles.arrangeActions}>
              <button type="button" onClick={() => execute('左对齐', (current) => alignMindMapNodes(current, selectedNodeIds, 'left'))}>左对齐</button>
              <button type="button" onClick={() => execute('水平居中', (current) => alignMindMapNodes(current, selectedNodeIds, 'center-x'))}>水平居中</button>
              <button type="button" onClick={() => execute('右对齐', (current) => alignMindMapNodes(current, selectedNodeIds, 'right'))}>右对齐</button>
              <button type="button" onClick={() => execute('顶对齐', (current) => alignMindMapNodes(current, selectedNodeIds, 'top'))}>顶对齐</button>
              <button type="button" onClick={() => execute('垂直居中', (current) => alignMindMapNodes(current, selectedNodeIds, 'center-y'))}>垂直居中</button>
              <button type="button" onClick={() => execute('底对齐', (current) => alignMindMapNodes(current, selectedNodeIds, 'bottom'))}>底对齐</button>
              <button
                type="button"
                disabled={selectedNodeIds.length < 3}
                onClick={() => execute('水平分布', (current) => distributeMindMapNodes(current, selectedNodeIds, 'horizontal'))}
              >
                水平分布
              </button>
              <button
                type="button"
                disabled={selectedNodeIds.length < 3}
                onClick={() => execute('垂直分布', (current) => distributeMindMapNodes(current, selectedNodeIds, 'vertical'))}
              >
                垂直分布
              </button>
              <button type="button" onClick={() => {
                const members = selectedNodeIds.map((id) => document.nodes[id]).filter((node): node is MindMapNode => Boolean(node));
                const section = createMindMapSection(members);
                execute('创建区域', (current) => ({
                  ...current,
                  sections: { ...current.sections, [section.id]: section },
                  nodes: Object.fromEntries(Object.entries(current.nodes).map(([id, node]) => [
                    id,
                    selectedSet.has(id) ? { ...node, parentSectionId: section.id, updatedAt: Date.now() } : node,
                  ])),
                }));
                setSelectedNodeIds([]);
                setSelectedSectionId(section.id);
              }}>创建区域</button>
              <button type="button" onClick={() => {
                const group = createMindMapGroup(selectedNodeIds);
                execute('创建分组', (current) => {
                  const groups = Object.fromEntries(Object.entries(current.groups).flatMap(([id, item]) => {
                    const memberIds = item.memberIds.filter((memberId) => !selectedSet.has(memberId));
                    return memberIds.length ? [[id, { ...item, memberIds }]] : [];
                  }));
                  groups[group.id] = group;
                  return {
                    ...current,
                    groups,
                    nodes: Object.fromEntries(Object.entries(current.nodes).map(([id, node]) => [
                      id,
                      selectedSet.has(id) ? { ...node, groupId: group.id, updatedAt: Date.now() } : node,
                    ])),
                  };
                });
              }}>创建分组</button>
              <button type="button" disabled={!selectedNodeIds.some((id) => document.nodes[id]?.groupId)} onClick={() => {
                execute('解除分组', (current) => {
                  const targetGroups = new Set(selectedNodeIds.map((id) => current.nodes[id]?.groupId).filter(Boolean));
                  const nodes = Object.fromEntries(Object.entries(current.nodes).map(([id, node]) => [
                    id,
                    selectedSet.has(id) ? { ...node, groupId: null, updatedAt: Date.now() } : node,
                  ]));
                  const groups = Object.fromEntries(Object.entries(current.groups).filter(([id]) => !targetGroups.has(id)));
                  return { ...current, nodes, groups };
                });
              }}>解除分组</button>
            </div>
          )}
          {selectedSection && (
            <div className={styles.inspectorFields}>
              <label>
                <span>名称</span>
                <input
                  type="text"
                  aria-label="区域名称"
                  defaultValue={selectedSection.title}
                  maxLength={120}
                  onBlur={(event) => execute('重命名区域', (current) => ({
                    ...current,
                    sections: {
                      ...current.sections,
                      [selectedSection.id]: { ...selectedSection, title: event.target.value.trim() || '区域', updatedAt: Date.now() },
                    },
                  }))}
                />
              </label>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  aria-label="折叠区域"
                  checked={selectedSection.collapsed}
                  onChange={(event) => execute(event.target.checked ? '折叠区域' : '展开区域', (current) => ({
                    ...current,
                    sections: {
                      ...current.sections,
                      [selectedSection.id]: { ...selectedSection, collapsed: event.target.checked, updatedAt: Date.now() },
                    },
                  }))}
                />
                <span>折叠区域</span>
              </label>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  aria-label="区域自动适应内容"
                  checked={selectedSection.sizeMode === 'auto'}
                  onChange={(event) => execute('切换区域尺寸模式', (current) => ({
                    ...current,
                    sections: {
                      ...current.sections,
                      [selectedSection.id]: { ...selectedSection, sizeMode: event.target.checked ? 'auto' : 'manual', updatedAt: Date.now() },
                    },
                  }))}
                />
                <span>自动适应内容</span>
              </label>
              <label>
                <span>宽度</span>
                <input
                  type="number"
                  aria-label="区域宽度"
                  min="160"
                  max="10000"
                  defaultValue={Math.round(selectedSection.width)}
                  onBlur={(event) => execute('调整区域宽度', (current) => ({
                    ...current,
                    sections: {
                      ...current.sections,
                      [selectedSection.id]: {
                        ...selectedSection,
                        width: Math.max(160, Math.min(10_000, Number(event.target.value) || 160)),
                        sizeMode: 'manual',
                        updatedAt: Date.now(),
                      },
                    },
                  }))}
                />
              </label>
              <label>
                <span>高度</span>
                <input
                  type="number"
                  aria-label="区域高度"
                  min="120"
                  max="10000"
                  defaultValue={Math.round(selectedSection.height)}
                  onBlur={(event) => execute('调整区域高度', (current) => ({
                    ...current,
                    sections: {
                      ...current.sections,
                      [selectedSection.id]: {
                        ...selectedSection,
                        height: Math.max(120, Math.min(10_000, Number(event.target.value) || 120)),
                        sizeMode: 'manual',
                        updatedAt: Date.now(),
                      },
                    },
                  }))}
                />
              </label>
              <button className={styles.dangerAction} type="button" onClick={() => {
                execute('删除区域', (current) => {
                  const sections = { ...current.sections };
                  delete sections[selectedSection.id];
                  return {
                    ...current,
                    sections,
                    nodes: Object.fromEntries(Object.entries(current.nodes).map(([id, node]) => [
                      id,
                      node.parentSectionId === selectedSection.id ? { ...node, parentSectionId: null, updatedAt: Date.now() } : node,
                    ])),
                  };
                });
                setSelectedSectionId(null);
              }}>删除区域并保留节点</button>
            </div>
          )}
          {selectedNode && (
            <div className={styles.inspectorFields}>
              <section className={styles.inspectorGroup}>
                <h3>节点</h3>
                <label>
                  <span>类型</span>
                  <select aria-label="节点类型" value={selectedNode.type} onChange={(event) => {
                    const type = event.target.value as MindMapNodeType;
                    updateNode(selectedNode.id, { type, ...(type === 'image' ? { width: Math.max(240, selectedNode.width), height: Math.max(160, selectedNode.height), sizeMode: 'manual' as const } : {}) });
                  }}>
                    <option value="text">文本</option><option value="markdown">Markdown</option><option value="latex">LaTeX</option><option value="url">URL</option><option value="image">图片</option>
                  </select>
                </label>
                <label>
                  <span>文本</span>
                  <input type="text" aria-label="节点文本" defaultValue={selectedNode.text} maxLength={10_000} onBlur={(event) => {
                    const text = event.target.value;
                    if (text === selectedNode.text) return;
                    updateNode(selectedNode.id, { text, ...(selectedNode.sizeMode === 'auto' ? measuredNodeSize(text, selectedNode) : {}) });
                  }} />
                </label>
                {treeChildrenById.get(selectedNode.id)?.length ? <label className={styles.checkboxField}><input type="checkbox" aria-label="折叠子分支" checked={selectedNode.collapsed} onChange={(event) => updateNode(selectedNode.id, { collapsed: event.target.checked })} /><span>折叠子分支</span></label> : null}
                {selectedNode.type === 'url' && <label><span>链接</span><input type="url" aria-label="节点链接" defaultValue={selectedNode.link ?? ''} placeholder="https://" onBlur={(event) => updateNode(selectedNode.id, { link: sanitizeMindMapResourceUrl(event.target.value) })} /></label>}
                {selectedNode.type === 'image' && <>
                  <label><span>上传</span><input type="file" aria-label="上传节点图片" accept="image/png,image/jpeg,image/gif,image/webp" onChange={async (event) => {
                    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
                    const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
                    const currentBytes = Object.values(document.nodes).reduce((sum, node) => sum + (node.imageSrc?.startsWith('data:') ? node.imageSrc.length : 0), 0);
                    if (!allowed.includes(file.type) || file.size > 2 * 1024 * 1024) { setResourceError('仅支持 PNG、JPEG、GIF、WebP，单张图片不能超过 2 MiB。'); return; }
                    if (currentBytes + Math.ceil(file.size * 4 / 3) > 20 * 1024 * 1024) { setResourceError('当前导图的本地图片总量不能超过 20 MiB。'); return; }
                    try {
                      const asset = await mindMapRepository.saveImageAsset(file); setResourceError(null);
                      setFailedImageIds((current) => { const next = new Set(current); next.delete(selectedNode.id); return next; });
                      updateNode(selectedNode.id, { imageAssetId: asset.id, imageSrc: null });
                    } catch (error) { setResourceError(error instanceof Error ? error.message : '图片保存失败，当前节点没有改变。'); }
                  }} /></label>
                  <label><span>HTTPS</span><input type="url" aria-label="节点图片地址" defaultValue={selectedNode.imageSrc?.startsWith('data:') ? '' : selectedNode.imageSrc ?? ''} placeholder="https://" onBlur={(event) => {
                    if (!event.target.value.trim()) return; const imageSrc = sanitizeMindMapResourceUrl(event.target.value, true);
                    if (!imageSrc) { setResourceError('外部图片必须使用 HTTPS 地址。'); return; }
                    setResourceError(null); updateNode(selectedNode.id, { imageSrc, imageAssetId: null });
                  }} /></label>
                  <small>上传图片保存在当前设备；外部图片仅保存 HTTPS 地址。</small>
                  {resourceError && <div className={styles.resourceError} role="alert">{resourceError}</div>}
                </>}
                {selectedNode.link && <a className={styles.linkAction} href={selectedNode.link} target="_blank" rel="noreferrer">打开链接</a>}
              </section>

              <section className={styles.inspectorGroup}>
                <h3>外观</h3>
                <label><span>填充</span><input type="color" aria-label="节点填充颜色" defaultValue={selectedNode.style.fill} onChange={(event) => updateNode(selectedNode.id, { style: { ...selectedNode.style, fill: event.target.value } })} /></label>
                <label><span>文字</span><input type="color" aria-label="节点文字颜色" defaultValue={selectedNode.style.textColor} onChange={(event) => updateNode(selectedNode.id, { style: { ...selectedNode.style, textColor: event.target.value } })} /></label>
                <label><span>字号</span><input type="number" aria-label="节点字号" min="8" max="96" defaultValue={selectedNode.style.fontSize} onBlur={(event) => updateNode(selectedNode.id, { style: { ...selectedNode.style, fontSize: Math.max(8, Math.min(96, Number(event.target.value) || 15)) } })} /></label>
              </section>

              <section className={styles.inspectorGroup}>
                <h3>尺寸</h3>
                <label className={styles.checkboxField}><input type="checkbox" aria-label="节点自动适应文字" checked={selectedNode.sizeMode === 'auto'} onChange={(event) => updateNode(selectedNode.id, event.target.checked ? { ...measuredNodeSize(selectedNode.text, selectedNode), sizeMode: 'auto' } : { sizeMode: 'manual' })} /><span>自动适应文字</span></label>
                {selectedNode.sizeMode === 'auto' ? <div className={styles.automaticSizeSummary}><span>宽度 <strong>自动</strong></span><span>高度 <strong>自动</strong></span></div> : <>
                  <label><span>宽度</span><input key={`${selectedNode.id}-width-${Math.round(selectedNode.width)}`} type="number" aria-label="节点宽度" min={MIND_MAP_VISUAL_TOKENS.node.minWidth} max="1600" defaultValue={Math.round(selectedNode.width)} onBlur={(event) => updateNode(selectedNode.id, { width: Math.max(MIND_MAP_VISUAL_TOKENS.node.minWidth, Math.min(1600, Number(event.target.value) || MIND_MAP_VISUAL_TOKENS.node.preferredWidth)), sizeMode: 'manual' })} /></label>
                  <label><span>高度</span><input key={`${selectedNode.id}-height-${Math.round(selectedNode.height)}`} type="number" aria-label="节点高度" min="40" max="1200" defaultValue={Math.round(selectedNode.height)} onBlur={(event) => updateNode(selectedNode.id, { height: Math.max(40, Math.min(1200, Number(event.target.value) || 40)), sizeMode: 'manual' })} /></label>
                </>}
              </section>

              <section className={styles.inspectorGroup}>
                <h3>排列</h3>
                <label><span>旋转</span><input type="number" aria-label="节点旋转角度" min="-180" max="180" defaultValue={selectedNode.rotation} onBlur={(event) => updateNode(selectedNode.id, { rotation: Math.max(-180, Math.min(180, Number(event.target.value) || 0)) })} /></label>
                <div className={styles.layerActions}>
                  <button type="button" onClick={() => execute('节点置顶', (current) => ({ ...current, zOrder: [...current.zOrder.filter((id) => id !== selectedNode.id), selectedNode.id] }))}>置顶</button>
                  <button type="button" onClick={() => execute('节点置底', (current) => ({ ...current, zOrder: [selectedNode.id, ...current.zOrder.filter((id) => id !== selectedNode.id)] }))}>置底</button>
                </div>
              </section>

              <section className={styles.inspectorGroup}>
                <h3>状态</h3>
                <label className={styles.checkboxField}><input type="checkbox" aria-label="锁定节点" checked={selectedNode.locked} onChange={(event) => updateNode(selectedNode.id, { locked: event.target.checked })} /><span>锁定节点</span></label>
                {(selectedNode.parentSectionId || selectedNode.groupId) && <button className={styles.secondaryAction} type="button" onClick={() => execute('移出容器', (current) => {
                  const node = current.nodes[selectedNode.id]; if (!node) return current;
                  const groups = node.groupId ? Object.fromEntries(Object.entries(current.groups).flatMap(([id, group]) => {
                    if (id !== node.groupId) return [[id, group]]; const memberIds = group.memberIds.filter((memberId) => memberId !== node.id);
                    return memberIds.length ? [[id, { ...group, memberIds, updatedAt: Date.now() }]] : [];
                  })) : current.groups;
                  return { ...current, groups, nodes: { ...current.nodes, [node.id]: { ...node, parentSectionId: null, groupId: null, updatedAt: Date.now() } } };
                })}>移出区域/分组</button>}
              </section>
            </div>
          )}
          {selectedEdge && (
            <div className={styles.inspectorFields}>
              <label>
                <span>标签</span>
                <input
                  type="text"
                  aria-label="连线标签"
                  defaultValue={selectedEdge.label}
                  maxLength={1000}
                  onBlur={(event) => {
                    if (event.target.value !== selectedEdge.label) {
                      updateEdge(selectedEdge.id, { label: event.target.value });
                    }
                  }}
                />
              </label>
              <label>
                <span>线型</span>
                <select
                  aria-label="连线线型"
                  value={selectedEdge.type}
                  onChange={(event) => {
                    const type = event.target.value as MindMapEdge['type'];
                    const points = edgePoints(selectedEdge, document, treeDirection);
                    const middleX = points ? (points.start.x + points.end.x) / 2 : 0;
                    updateEdge(selectedEdge.id, {
                      type,
                      controlPoints: type === 'orthogonal' && points
                        ? [{ x: middleX, y: points.start.y }, { x: middleX, y: points.end.y }]
                        : selectedEdge.controlPoints,
                    });
                  }}
                >
                  <option value="straight">直线</option>
                  <option value="curve">曲线</option>
                  <option value="orthogonal">正交线</option>
                </select>
              </label>
              <label>
                <span>方向</span>
                <select
                  aria-label="连线方向"
                  value={selectedEdge.direction}
                  onChange={(event) => updateEdge(selectedEdge.id, {
                    direction: event.target.value as MindMapEdge['direction'],
                  })}
                >
                  <option value="none">无箭头</option>
                  <option value="forward">单向</option>
                  <option value="backward">反向</option>
                  <option value="both">双向</option>
                </select>
              </label>
              <label>
                <span>颜色</span>
                <input
                  type="color"
                  aria-label="连线颜色"
                  defaultValue={selectedEdge.style.color}
                  onChange={(event) => updateEdge(selectedEdge.id, {
                    style: { ...selectedEdge.style, color: event.target.value },
                  })}
                />
              </label>
            </div>
          )}
        </aside>
      )}
      <div className={styles.accessibility} aria-live="polite">
        已选择 {selectedNodeIds.length} 个节点，{selectedEdgeIds.length} 条连线
      </div>
    </div>
  );
}

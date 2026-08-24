import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { Search } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
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
import { alignMindMapNodes, distributeMindMapNodes } from '../layout';
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
import { renderMindMapWebGl } from './webglRenderer';
import 'katex/dist/katex.min.css';
import styles from './MindMapCanvas.module.css';

interface MindMapCanvasProps {
  document: MindMapDocument;
  assetRevision?: number;
  onScaleChange?: (scale: number) => void;
  fitRequest?: number;
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
    sourceId: string;
    sourcePoint: Point;
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
  x: number;
  y: number;
  width: number;
  height: number;
  draft: string;
  newNodeType?: MindMapNodeType;
}

interface ClipboardGraph {
  nodes: MindMapNode[];
  edges: MindMapEdge[];
}

interface ContextMenuState {
  x: number;
  y: number;
  world: Point;
  nodeId?: string;
  edgeId?: string;
}

interface PinchState {
  distance: number;
  midpoint: Point;
  camera: ViewportState;
}

const HANDLE_RADIUS = 5;
const MINIMAP_WIDTH = 144;
const MINIMAP_HEIGHT = 90;
const CLIPBOARD_PREFIX = 'smart-line-mind-map-clipboard:';

const connectionPoints = (node: MindMapNode): Point[] => [
  { x: node.x, y: node.y - node.height / 2 },
  { x: node.x + node.width / 2, y: node.y },
  { x: node.x, y: node.y + node.height / 2 },
  { x: node.x - node.width / 2, y: node.y },
];

const resizePoints = (node: MindMapNode): Array<{ corner: ResizeCorner; point: Point }> => [
  { corner: 'nw', point: { x: node.x - node.width / 2, y: node.y - node.height / 2 } },
  { corner: 'ne', point: { x: node.x + node.width / 2, y: node.y - node.height / 2 } },
  { corner: 'se', point: { x: node.x + node.width / 2, y: node.y + node.height / 2 } },
  { corner: 'sw', point: { x: node.x - node.width / 2, y: node.y + node.height / 2 } },
];

const resizedNode = (interaction: Extract<Interaction, { type: 'resize' }>) => {
  const horizontal = interaction.corner.includes('e') ? 1 : -1;
  const vertical = interaction.corner.includes('s') ? 1 : -1;
  const width = Math.max(MIND_MAP_VISUAL_TOKENS.node.minWidth, interaction.width + horizontal * (interaction.currentWorld.x - interaction.startWorld.x));
  const height = Math.max(40, interaction.height + vertical * (interaction.currentWorld.y - interaction.startWorld.y));
  return {
    x: interaction.x + horizontal * (width - interaction.width) / 2,
    y: interaction.y + vertical * (height - interaction.height) / 2,
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

function edgePoints(edge: MindMapEdge, nodes: Record<string, MindMapNode>) {
  const source = nodes[edge.sourceId];
  const target = nodes[edge.targetId];
  if (!source || !target) return null;
  const angle = Math.atan2(target.y - source.y, target.x - source.x);
  const sourceRadius = Math.abs(Math.cos(angle)) * source.width / 2 + Math.abs(Math.sin(angle)) * source.height / 2;
  const targetRadius = Math.abs(Math.cos(angle)) * target.width / 2 + Math.abs(Math.sin(angle)) * target.height / 2;
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
}

function orthogonalPoints(edge: MindMapEdge, nodes: Record<string, MindMapNode>) {
  const endpoints = edgePoints(edge, nodes);
  if (!endpoints) return null;
  if (edge.controlPoints.length > 0) return [endpoints.start, ...edge.controlPoints, endpoints.end];
  const middleX = (endpoints.start.x + endpoints.end.x) / 2;
  return [endpoints.start, { x: middleX, y: endpoints.start.y }, { x: middleX, y: endpoints.end.y }, endpoints.end];
}

function hitEdge(point: Point, document: MindMapDocument, tolerance: number, nodes = document.nodes) {
  const edges = Object.values(document.edges);
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const edge = edges[index];
    if (edgeIsHiddenInsideCollapsedSection(edge, document)) continue;
    const points = edgePoints(edge, nodes);
    if (!points) continue;
    if (edge.type === 'straight') {
      if (pointSegmentDistance(point, points.start, points.end) <= tolerance) return edge;
      continue;
    }
    if (edge.type === 'orthogonal') {
      const route = orthogonalPoints(edge, nodes);
      if (!route) continue;
      for (let routeIndex = 1; routeIndex < route.length; routeIndex += 1) {
        if (pointSegmentDistance(point, route[routeIndex - 1], route[routeIndex]) <= tolerance) return edge;
      }
      continue;
    }
    const control = {
      x: (points.start.x + points.end.x) / 2,
      y: (points.start.y + points.end.y) / 2 - Math.min(120, Math.abs(points.end.x - points.start.x) * 0.25 + 30),
    };
    let previous = points.start;
    for (let step = 1; step <= 16; step += 1) {
      const ratio = step / 16;
      const inverse = 1 - ratio;
      const current = {
        x: inverse * inverse * points.start.x + 2 * inverse * ratio * control.x + ratio * ratio * points.end.x,
        y: inverse * inverse * points.start.y + 2 * inverse * ratio * control.y + ratio * ratio * points.end.y,
      };
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

export default function MindMapCanvas({
  document,
  assetRevision = 0,
  onScaleChange,
  fitRequest = 0,
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
  const handledPngRequest = useRef(0);
  const touchPoints = useRef(new Map<number, Point>());
  const pinchRef = useRef<PinchState | null>(null);
  const renderedDocumentId = useRef<string | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [camera, setCameraState] = useState(document.viewport);
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [connectionSourceId, setConnectionSourceId] = useState<string | null>(null);
  const [interaction, setInteractionState] = useState<Interaction>(null);
  const [editing, setEditing] = useState<EditingSession | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandSearch, setCommandSearch] = useState('');
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [failedImageIds, setFailedImageIds] = useState<Set<string>>(() => new Set());
  const [imageAssetUrls, setImageAssetUrls] = useState<Record<string, string>>({});
  const [webglActive, setWebglActive] = useState(false);
  const editingSessionKey = editing ? editing.nodeId ?? 'new' : null;
  const {
    execute,
    createNode,
    updateNode,
    deleteNodes,
    createEdge,
    updateEdge,
    deleteEdges,
    setViewport,
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
    setViewport: state.setViewport,
    undo: state.undo,
    redo: state.redo,
    flushSave: state.flushSave,
  })));

  const selectedSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const hiddenNodeIds = useMemo(() => new Set(
    Object.values(document.nodes)
      .filter((node) => node.parentSectionId && document.sections[node.parentSectionId]?.collapsed)
      .map((node) => node.id),
  ), [document.nodes, document.sections]);
  const canvasNodes = useMemo(() => Object.fromEntries(
    Object.entries(document.nodes).filter(([id]) => !hiddenNodeIds.has(id)),
  ), [document.nodes, hiddenNodeIds]);
  const edgeNodes = useMemo(() => edgeRenderNodes(document), [document]);
  const canvasZOrder = useMemo(
    () => document.zOrder.filter((id) => !hiddenNodeIds.has(id)),
    [document.zOrder, hiddenNodeIds],
  );
  const spatialIndex = useMemo(() => new MindMapSpatialIndex(Object.values(canvasNodes)), [canvasNodes]);
  const visibleNodes = useMemo(() => spatialIndex.query(visibleWorldRect(size, camera)), [camera, size, spatialIndex]);
  const visibleNodeIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes]);
  const visibleZOrder = useMemo(() => canvasZOrder.filter((id) => visibleNodeIds.has(id)), [canvasZOrder, visibleNodeIds]);
  const hitIndexedNode = useCallback((point: Point) => {
    const candidates = spatialIndex.query({ x: point.x - 1, y: point.y - 1, width: 2, height: 2 });
    const ids = new Set(candidates.map((node) => node.id));
    return hitNode(point, Object.fromEntries(candidates.map((node) => [node.id, node])), canvasZOrder.filter((id) => ids.has(id)));
  }, [canvasZOrder, spatialIndex]);

  useEffect(() => {
    onSelectionChange?.(selectedNodeIds.length);
  }, [onSelectionChange, selectedNodeIds.length]);

  useEffect(() => {
    if (!connectionMode) {
      setConnectionSourceId(null);
      return;
    }
    if (selectedNodeIds.length === 1) setConnectionSourceId(selectedNodeIds[0]);
  }, [connectionMode, selectedNodeIds]);

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
      setViewport(next);
    } else {
      cameraSaveTimer.current = setTimeout(() => {
        cameraSaveTimer.current = null;
        setViewport(cameraRef.current);
      }, 180);
    }
  }, [onScaleChange, setViewport]);

  useEffect(() => {
    if (renderedDocumentId.current === document.id) return;
    renderedDocumentId.current = document.id;
    const next = document.viewport;
    cameraRef.current = next;
    setCameraState(next);
    setSelectedNodeIds([]);
    setSelectedEdgeIds([]);
    setSelectedSectionId(null);
    setInteraction(null);
    setEditing(null);
    onScaleChange?.(next.scale);
  }, [document.id, document.viewport, onScaleChange, setInteraction]);

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
    setViewport(cameraRef.current);
  }, [setViewport]);

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
  else if (interaction?.type === 'section-drag' || interaction?.type === 'section-resize') presenceDraggingId = interaction.sectionId;
  else if (interaction?.type === 'resize') presenceDraggingId = interaction.nodeId;
  else if (interaction?.type === 'connect') presenceDraggingId = interaction.sourceId;
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
      context.fillStyle = node.style.fill;
      context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.borderStrong;
      context.fillRect(offsetX + (node.x - node.width / 2 - left) * scale, offsetY + (node.y - node.height / 2 - top) * scale, Math.max(2, node.width * scale), Math.max(2, node.height * scale));
      context.strokeRect(offsetX + (node.x - node.width / 2 - left) * scale, offsetY + (node.y - node.height / 2 - top) * scale, Math.max(2, node.width * scale), Math.max(2, node.height * scale));
    }
    minimapBaseRef.current = base;
  }, [canvasNodes]);

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
    setWebglActive(renderMindMapWebGl(canvas, document, canvasNodes, edgeNodes, camera, size));
  }, [camera, canvasNodes, document, edgeNodes, size]);

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
        if (node) previewNodes[id] = previewNode(node, interaction);
      }
      const previewsNodeGeometry = interaction?.type === 'drag'
        || interaction?.type === 'resize'
        || interaction?.type === 'section-drag'
        || interaction?.type === 'section-resize';
      const previewEdgeNodes = previewsNodeGeometry
        ? edgeRenderNodes({ ...document, nodes: { ...document.nodes, ...previewNodes } })
        : edgeNodes;
      const visible = visibleWorldRect(size, camera);

      for (const section of Object.values(document.sections)) {
        const rect = sectionRect(section, interaction);
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
        const rect = sectionRect(document.sections[selectedSectionId], interaction);
        const handle = worldToView({ x: rect.x + rect.width, y: rect.y + rect.height }, camera);
        context.fillStyle = '#ffffff';
        context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
        context.lineWidth = 2;
        context.fillRect(handle.x - 6, handle.y - 6, 12, 12);
        context.strokeRect(handle.x - 6, handle.y - 6, 12, 12);
      }

      for (const group of Object.values(document.groups)) {
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

      for (const edge of webglActive ? [] : Object.values(document.edges)) {
        if (edgeIsHiddenInsideCollapsedSection(edge, document)) continue;
        const renderedEdge = interaction?.type === 'edge-control' && interaction.edgeId === edge.id
          ? {
              ...edge,
              controlPoints: edge.controlPoints.map((point, index) => index === interaction.controlIndex ? interaction.currentWorld : point),
            }
          : edge;
        const points = edgePoints(renderedEdge, previewEdgeNodes);
        if (!points) continue;
        const routeWorld = edge.type === 'orthogonal'
          ? orthogonalPoints(renderedEdge, previewEdgeNodes) ?? [points.start, points.end]
          : [points.start, points.end];
        const edgeBounds = {
          x: Math.min(...routeWorld.map((point) => point.x)),
          y: Math.min(...routeWorld.map((point) => point.y)),
          width: Math.max(...routeWorld.map((point) => point.x)) - Math.min(...routeWorld.map((point) => point.x)),
          height: Math.max(...routeWorld.map((point) => point.y)) - Math.min(...routeWorld.map((point) => point.y)),
        };
        edgeBounds.x -= 40;
        edgeBounds.y -= 40;
        edgeBounds.width += 80;
        edgeBounds.height += 80;
        if (!rectIntersectsRect(visible, edgeBounds)) continue;
        const start = worldToView(points.start, camera);
        const end = worldToView(points.end, camera);
        context.beginPath();
        context.moveTo(start.x, start.y);
        let arrowFrom = start;
        let backwardFrom = end;
        if (edge.type === 'curve') {
          const controlWorld = {
            x: (points.start.x + points.end.x) / 2,
            y: (points.start.y + points.end.y) / 2 - Math.min(120, Math.abs(points.end.x - points.start.x) * 0.25 + 30),
          };
          const control = worldToView(controlWorld, camera);
          context.quadraticCurveTo(control.x, control.y, end.x, end.y);
          arrowFrom = control;
          backwardFrom = control;
        } else if (edge.type === 'orthogonal') {
          const route = routeWorld.map((point) => worldToView(point, camera));
          for (const point of route.slice(1)) context.lineTo(point.x, point.y);
          arrowFrom = route.at(-2) ?? start;
          backwardFrom = route[1] ?? end;
        } else {
          context.lineTo(end.x, end.y);
        }
        context.strokeStyle = selectedEdgeIds.includes(edge.id) ? MIND_MAP_VISUAL_TOKENS.color.accent : edge.style.color;
        const edgeWidth = edge.style.width === 2 ? MIND_MAP_VISUAL_TOKENS.edge.width : edge.style.width;
        context.lineWidth = Math.max(1, edgeWidth * camera.scale);
        context.setLineDash(edge.style.dash === 'dashed' ? [7, 5] : []);
        context.stroke();
        context.setLineDash([]);
        const arrowSize = Math.max(5, MIND_MAP_VISUAL_TOKENS.edge.arrowSize * camera.scale);
        if (edge.direction === 'forward' || edge.direction === 'both') {
          drawArrow(context, arrowFrom, end, context.strokeStyle as string, arrowSize);
        }
        if (edge.direction === 'backward' || edge.direction === 'both') {
          drawArrow(context, backwardFrom, start, context.strokeStyle as string, arrowSize);
        }
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

      if (interaction?.type === 'connect') {
        const source = previewNodes[interaction.sourceId];
        if (source) {
          const start = worldToView(interaction.sourcePoint, camera);
          const end = worldToView(interaction.currentWorld, camera);
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

      if (interaction?.type === 'reconnect') {
        const edge = document.edges[interaction.edgeId];
        const points = edge ? edgePoints(edge, previewEdgeNodes) : null;
        if (edge && points) {
          const fixed = interaction.endpoint === 'source' ? points.end : points.start;
          const start = worldToView(fixed, camera);
          const end = worldToView(interaction.currentWorld, camera);
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
        if (!webglActive && !selectedSet.has(node.id) && node.style.shadow && camera.scale >= 0.3) {
          context.shadowColor = MIND_MAP_VISUAL_TOKENS.canvas.nodeShadow;
          context.shadowBlur = MIND_MAP_VISUAL_TOKENS.canvas.nodeShadowBlur * camera.scale;
          context.shadowOffsetY = MIND_MAP_VISUAL_TOKENS.canvas.nodeShadowOffsetY * camera.scale;
        }
        if (!webglActive || selectedSet.has(node.id)) {
          context.globalAlpha = webglActive ? 0 : node.style.fillOpacity;
          context.fillStyle = node.style.fill;
          context.beginPath();
          const radius = (node.style.borderRadius === 12 ? MIND_MAP_VISUAL_TOKENS.radius.node : node.style.borderRadius) * camera.scale;
          context.roundRect(topLeft.x, topLeft.y, width, height, radius);
          context.fill();
          context.shadowColor = 'transparent';
          context.globalAlpha = 1;
          context.strokeStyle = selectedSet.has(node.id) ? MIND_MAP_VISUAL_TOKENS.color.accent : node.style.borderColor;
          context.lineWidth = (selectedSet.has(node.id) ? MIND_MAP_VISUAL_TOKENS.selection.ringWidth : Math.min(1.25, node.style.borderWidth)) * Math.max(0.6, camera.scale);
          context.setLineDash(node.style.borderStyle === 'dashed' ? [7, 5] : []);
          context.stroke();
          context.setLineDash([]);
        }
        if (camera.scale >= 0.2 && node.type !== 'markdown' && node.type !== 'latex') {
          context.fillStyle = node.style.textColor;
          context.font = node.style.fontWeight + ' ' + Math.max(8, node.style.fontSize * camera.scale) + 'px sans-serif';
          context.textAlign = node.style.textAlign;
          context.textBaseline = 'middle';
          const typePrefix = node.type === 'url' ? 'URL · ' : '';
          const lineHeight = node.style.fontSize * node.style.lineHeight * camera.scale;
          const maximumLines = node.type === 'image'
            ? 1
            : Math.max(1, Math.min(100, Math.floor((height - 24 * camera.scale) / lineHeight)));
          const lines = wrapText(
            context,
            typePrefix + (node.text || '双击编辑'),
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

      const handleNodeIds = [...new Set([
        hoveredNodeId,
        selectedNodeIds.length === 1 ? selectedNodeIds[0] : null,
        connectionSourceId,
      ].filter((id): id is string => Boolean(id)))];
      for (const nodeId of handleNodeIds) {
        const node = previewNodes[nodeId];
        if (node) {
          context.fillStyle = '#ffffff';
          context.strokeStyle = MIND_MAP_VISUAL_TOKENS.color.accent;
          context.lineWidth = MIND_MAP_VISUAL_TOKENS.selection.ringWidth;
          for (const point of connectionPoints(node)) {
            const view = worldToView(point, camera);
            context.beginPath();
            context.arc(view.x, view.y, HANDLE_RADIUS, 0, Math.PI * 2);
            context.fill();
            context.stroke();
          }
          if (selectedNodeIds.length === 1 && selectedNodeIds[0] === node.id) {
            for (const { point } of resizePoints(node)) {
              const resize = worldToView(point, camera);
              const half = MIND_MAP_VISUAL_TOKENS.selection.handleSize / 2;
              context.fillRect(resize.x - half, resize.y - half, half * 2, half * 2);
              context.strokeRect(resize.x - half, resize.y - half, half * 2, half * 2);
            }
          }
        }
      }

      if (selectedEdgeIds.length === 1) {
        const edge = document.edges[selectedEdgeIds[0]];
        const points = edge ? edgePoints(edge, previewEdgeNodes) : null;
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
            const controls = edge.controlPoints.map((point, index) => interaction?.type === 'edge-control'
              && interaction.edgeId === edge.id && interaction.controlIndex === index
              ? interaction.currentWorld
              : point);
            for (const point of controls) {
              const view = worldToView(point, camera);
              context.fillRect(view.x - 5, view.y - 5, 10, 10);
              context.strokeRect(view.x - 5, view.y - 5, 10, 10);
            }
          }
        }
      }

      if (interaction?.type === 'marquee') {
        const start = worldToView(interaction.startWorld, camera);
        const end = worldToView(interaction.currentWorld, camera);
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
  }, [camera, canvasNodes, connectionSourceId, document, edgeNodes, hoveredNodeId, interaction, selectedEdgeIds, selectedNodeIds, selectedSectionId, selectedSet, size, visibleNodeIds, visibleZOrder, webglActive]);

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

  const commitEditing = (restoreFocus = false) => {
    const session = editing;
    if (!session) return;
    setEditing(null);
    if (restoreFocus) restoreCanvasFocus();
    if (!session.nodeId) {
      if (!session.draft.trim()) return;
      const nodeType = session.newNodeType ?? 'text';
      if (session.connectFromId && document.nodes[session.connectFromId]) {
        const node = createMindMapNode({ x: session.x, y: session.y }, nodeType, { text: session.draft });
        const edge = createMindMapEdge(session.connectFromId, node.id);
        execute('创建关联节点', (current) => ({
          ...current,
          nodes: { ...current.nodes, [node.id]: node },
          edges: { ...current.edges, [edge.id]: edge },
          zOrder: [...current.zOrder, node.id],
        }));
        setSelectedNodeIds([node.id]);
        setSelectedEdgeIds([]);
      } else {
        if (nodeType === 'text') {
          const id = createNode({ x: session.x, y: session.y }, session.draft);
          if (id) setSelectedNodeIds([id]);
        } else {
          const node = createMindMapNode({ x: session.x, y: session.y }, nodeType, { text: session.draft });
          execute('创建高级节点', (current) => ({
            ...current,
            nodes: { ...current.nodes, [node.id]: node },
            zOrder: [...current.zOrder, node.id],
          }));
          setSelectedNodeIds([node.id]);
        }
      }
      return;
    }
    const node = document.nodes[session.nodeId];
    if (!node || node.text === session.draft) return;
    const measured = node.sizeMode === 'auto' ? measuredNodeSize(session.draft, node) : {};
    updateNode(node.id, { text: session.draft, ...measured });
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
      const edge = hitEdge(world, document, 7 / cameraRef.current.scale, edgeNodes);
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
    surfaceRef.current?.focus();
    const view = pointerView(event, canvas);
    const world = viewToWorld(view, cameraRef.current);
    if (event.pointerType === 'touch') {
      touchPoints.current.set(event.pointerId, view);
      if (touchPoints.current.size >= 2) {
        const [first, second] = [...touchPoints.current.values()];
        pinchRef.current = {
          distance: Math.max(1, Math.hypot(second.x - first.x, second.y - first.y)),
          midpoint: { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 },
          camera: cameraRef.current,
        };
        canvas.setPointerCapture(event.pointerId);
        setInteraction(null);
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
      const points = selectedEdge ? edgePoints(selectedEdge, edgeNodes) : null;
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

    const connectionHandleNodes = [...new Set([
      hoveredNodeId,
      selectedNodeIds.length === 1 ? selectedNodeIds[0] : null,
      connectionSourceId,
    ].filter((id): id is string => Boolean(id)))];
    const tolerance = HANDLE_RADIUS / cameraRef.current.scale;
    for (const nodeId of connectionHandleNodes) {
      const node = document.nodes[nodeId];
      const connectPoint = node && connectionPoints(node).find((point) => (
        Math.hypot(world.x - point.x, world.y - point.y) <= tolerance
      ));
      if (node && connectPoint) {
          setSelectedNodeIds([node.id]);
          setSelectedEdgeIds([]);
          canvas.setPointerCapture(event.pointerId);
          setInteraction({ type: 'connect', pointerId: event.pointerId, sourceId: node.id, sourcePoint: connectPoint, currentWorld: world });
          return;
      }
    }

    if (selectedNodeIds.length === 1) {
      const selected = document.nodes[selectedNodeIds[0]];
      if (selected) {
        const resizeHandle = resizePoints(selected).find(({ point }) => (
          Math.hypot(world.x - point.x, world.y - point.y) <= tolerance
        ));
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
      if (!node) return;
      if (!connectionSourceId) {
        setConnectionSourceId(node.id);
        setSelectedNodeIds([node.id]);
        setSelectedEdgeIds([]);
        setSelectedSectionId(null);
      } else if (node.id !== connectionSourceId) {
        createEdge(connectionSourceId, node.id);
        setSelectedNodeIds([node.id]);
        setSelectedEdgeIds([]);
        setConnectionSourceId(null);
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

    const edge = hitEdge(world, document, 7 / cameraRef.current.scale, edgeNodes);
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
    if (!activeInteraction && event.pointerType !== 'touch') setHoveredNodeId(hitIndexedNode(world)?.id ?? null);
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
    } else if (activeInteraction.type === 'connect') {
      const target = hitIndexedNode(activeInteraction.currentWorld);
      if (target && target.id !== activeInteraction.sourceId) {
        createEdge(activeInteraction.sourceId, target.id);
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
      const target = hitIndexedNode(activeInteraction.currentWorld);
      if (edge && target) {
        const otherId = activeInteraction.endpoint === 'source' ? edge.targetId : edge.sourceId;
        if (target.id !== otherId) {
          updateEdge(edge.id, activeInteraction.endpoint === 'source'
            ? { sourceId: target.id }
            : { targetId: target.id });
        }
      }
    }
    setInteraction(null);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const view = {
      x: event.clientX - canvas.getBoundingClientRect().left,
      y: event.clientY - canvas.getBoundingClientRect().top,
    };
    const factor = Math.exp(-event.deltaY * 0.0015);
    updateCamera(zoomCameraAt(cameraRef.current, view, cameraRef.current.scale * factor));
  };

  const copySelection = () => {
    const selected = new Set(selectedNodeIds);
    if (selected.size === 0) return;
    const clipboard: ClipboardGraph = {
      nodes: selectedNodeIds.map((id) => document.nodes[id]).filter((node): node is MindMapNode => Boolean(node)),
      edges: Object.values(document.edges).filter((edge) => selected.has(edge.sourceId) && selected.has(edge.targetId)),
    };
    clipboardRef.current = clipboard;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(CLIPBOARD_PREFIX + JSON.stringify(clipboard)).catch(() => undefined);
    }
  };

  const pasteSelection = () => {
    const clipboard = clipboardRef.current;
    if (!clipboard || clipboard.nodes.length === 0) return;
    const ids = new Map<string, string>();
    const nodes: Record<string, MindMapNode> = {};
    const now = Date.now();
    for (const node of clipboard.nodes) {
      const id = createMindMapId();
      ids.set(node.id, id);
      nodes[id] = {
        ...node,
        id,
        x: node.x + 24,
        y: node.y + 24,
        createdAt: now,
        updatedAt: now,
      };
    }
    const edges: Record<string, MindMapEdge> = {};
    for (const edge of clipboard.edges) {
      const sourceId = ids.get(edge.sourceId);
      const targetId = ids.get(edge.targetId);
      if (!sourceId || !targetId) continue;
      const id = createMindMapId();
      edges[id] = { ...edge, id, sourceId, targetId, createdAt: now, updatedAt: now };
    }
    execute('粘贴对象', (current) => ({
      ...current,
      nodes: { ...current.nodes, ...nodes },
      edges: { ...current.edges, ...edges },
      zOrder: [...current.zOrder, ...Object.keys(nodes)],
    }));
    setSelectedNodeIds(Object.keys(nodes));
    setSelectedEdgeIds([]);
  };

  const pasteFromSystem = async () => {
    if (!navigator.clipboard?.readText) return;
    try {
      const text = await navigator.clipboard.readText();
      if (!text.startsWith(CLIPBOARD_PREFIX) || text.length > 5_000_000) return;
      const value = JSON.parse(text.slice(CLIPBOARD_PREFIX.length)) as { nodes?: unknown; edges?: unknown };
      if (!Array.isArray(value.nodes) || !Array.isArray(value.edges)) return;
      const rawNodes = Object.fromEntries(value.nodes.flatMap((node) => {
        if (!node || typeof node !== 'object' || !('id' in node) || typeof node.id !== 'string') return [];
        return [[node.id, node]];
      }));
      const rawEdges = Object.fromEntries(value.edges.flatMap((edge) => {
        if (!edge || typeof edge !== 'object' || !('id' in edge) || typeof edge.id !== 'string') return [];
        return [[edge.id, edge]];
      }));
      const normalized = normalizeMindMapDocument({
        kind: 'smart-line-mind-map',
        schemaVersion: MIND_MAP_SCHEMA_VERSION,
        id: 'clipboard',
        nodes: rawNodes,
        edges: rawEdges,
        zOrder: Object.keys(rawNodes),
      });
      if (!normalized || Object.keys(normalized.nodes).length === 0) return;
      clipboardRef.current = {
        nodes: Object.values(normalized.nodes),
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
    const edge = node ? null : hitEdge(world, document, 7 / cameraRef.current.scale, edgeNodes);
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
      y: Math.min(view.y, Math.max(0, size.height - 260)),
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
    const next = fitMindMapDocument(document, size);
    if (next) updateCamera(next, true);
  }, [document, size, updateCamera]);
  const runTreeLayout = useCallback(async () => {
    const source = document;
    const laidOut = await layoutMindMapTreeInWorker(source);
    execute('树形布局', (current) => (
      current.id === source.id && current.updatedAt === source.updatedAt
        ? { ...current, nodes: laidOut.nodes }
        : current
    ));
  }, [document, execute]);

  useEffect(() => {
    if (fitRequest <= 0 || fitRequest === handledFitRequest.current) return;
    handledFitRequest.current = fitRequest;
    fitAll();
  }, [fitAll, fitRequest]);

  useEffect(() => {
    if (pngRequest <= 0 || pngRequest === handledPngRequest.current) return;
    handledPngRequest.current = pngRequest;
    const canvas = canvasRef.current;
    if (pngScope === 'viewport') {
      if (canvas) downloadCanvasPng(canvas, document.title);
    } else {
      downloadMindMapPng(document, pngScope, selectedNodeIds);
    }
  }, [document, pngRequest, pngScope, selectedNodeIds]);

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
      setSelectedNodeIds(Object.keys(document.nodes));
      setSelectedEdgeIds([]);
      setSelectedSectionId(null);
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
      setContextMenu(null);
      setInteraction(null);
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setSelectedSectionId(null);
      setConnectionSourceId(null);
      onConnectionModeChange?.(false);
      return;
    }
    if (!modifier && !event.altKey && (event.key === 'Tab' || event.key === 'Enter') && selectedNodeIds.length === 1) {
      const selected = document.nodes[selectedNodeIds[0]];
      if (selected) {
        event.preventDefault();
        if (event.key === 'Tab') {
          setEditing({
            nodeId: null,
            connectFromId: selected.id,
            x: selected.x + selected.width / 2 + 186,
            y: selected.y,
            width: 180,
            height: 56,
            draft: '',
          });
        } else {
          const incoming = Object.values(document.edges).find((edge) => edge.targetId === selected.id);
          setEditing({
            nodeId: null,
            connectFromId: incoming?.sourceId,
            x: selected.x,
            y: selected.y + selected.height / 2 + 88,
            width: 180,
            height: 56,
            draft: '',
          });
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
      setSelectedNodeIds([]);
      setSelectedEdgeIds([]);
      setSelectedSectionId(null);
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
  const normalizedSearch = commandSearch.trim().toLocaleLowerCase();
  const searchResults = normalizedSearch
    ? [
        ...Object.values(document.nodes)
          .filter((node) => node.text.toLocaleLowerCase().includes(normalizedSearch))
          .map((node) => ({ kind: 'node' as const, id: node.id, label: node.text || '空节点', x: node.x, y: node.y })),
        ...Object.values(document.edges)
          .filter((edge) => edge.label.toLocaleLowerCase().includes(normalizedSearch))
          .map((edge) => {
            const source = document.nodes[edge.sourceId];
            const target = document.nodes[edge.targetId];
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
    }
    return [{ node, html: cached.html }];
  });

  return (
    <div
      ref={surfaceRef}
      className={styles.surface}
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
            publishCursor(null, true);
          }
        }}
        onWheel={handleWheel}
      />
      {(connectionMode || hoveredNodeId) && (
        <div className={styles.connectionHint} role="status">
          {connectionMode
            ? connectionSourceId
              ? '已选择起点，请点击终点节点；按 Esc 取消'
              : '连线模式：先点击起点节点，再点击终点节点'
            : '拖动节点四边的圆点到另一个节点，可创建连线'}
        </div>
      )}
      {richPreviews.map(({ node, html }) => {
        const preview = previewNode(node, interaction);
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
              fontSize: Math.max(8, node.style.fontSize * camera.scale),
              color: node.style.textColor,
              transform: `rotate(${preview.rotation}deg)`,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
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
          aria-label={contextMenu.nodeId ? '节点菜单' : contextMenu.edgeId ? '连线菜单' : '画布菜单'}
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
                const source = document.nodes[contextMenu.nodeId!];
                setEditing({
                  nodeId: null,
                  connectFromId: source.id,
                  x: source.x + source.width / 2 + 186,
                  y: source.y,
                  width: 180,
                  height: 56,
                  draft: '',
                });
                setContextMenu(null);
              }}>创建子节点</button>
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
                updateEdge(edge.id, { sourceId: edge.targetId, targetId: edge.sourceId });
                setContextMenu(null);
              }}>反转连线</button>
              <button type="button" role="menuitem" onClick={() => {
                deleteEdges([contextMenu.edgeId!]);
                setSelectedEdgeIds([]);
                setContextMenu(null);
              }}>删除连线</button>
            </>
          )}
          {!contextMenu.nodeId && !contextMenu.edgeId && (
            <>
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
            } else if (event.key === 'Enter' && !event.shiftKey && !composing.current) {
              event.preventDefault();
              commitEditing(true);
            }
          }}
        />
      )}
      {Object.keys(document.nodes).length === 0 && !editing && (
        <div className={styles.emptyOverlay} aria-hidden="true">
          <strong>双击画布创建第一个节点</strong>
          <span>空白处拖动平移，Shift 拖动框选，滚轮缩放</span>
        </div>
      )}
      {(selectedNode || selectedEdge || selectedSection || selectedNodeIds.length > 1) && !editing && (
        <aside
          className={styles.inspector}
          aria-label={selectedNode ? '节点属性' : selectedEdge ? '连线属性' : selectedSection ? '区域属性' : '多选排列'}
        >
          <div className={styles.inspectorHeader}>
            <strong>{selectedNode ? '节点属性' : selectedEdge ? '连线属性' : selectedSection ? '区域属性' : `排列 ${selectedNodeIds.length} 个节点`}</strong>
            <button
              type="button"
              aria-label="关闭属性面板"
              onClick={() => {
                setSelectedNodeIds([]);
                setSelectedEdgeIds([]);
                setSelectedSectionId(null);
              }}
            >
              ×
            </button>
          </div>
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
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  aria-label="节点自动适应文字"
                  checked={selectedNode.sizeMode === 'auto'}
                  onChange={(event) => updateNode(selectedNode.id, event.target.checked
                    ? { ...measuredNodeSize(selectedNode.text, selectedNode), sizeMode: 'auto' }
                    : { sizeMode: 'manual' })}
                />
                <span>自动适应文字</span>
              </label>
              <label>
                <span>宽度</span>
                <input
                  key={`${selectedNode.id}-width-${Math.round(selectedNode.width)}`}
                  type="number"
                  aria-label="节点宽度"
                  min={MIND_MAP_VISUAL_TOKENS.node.minWidth}
                  max="1600"
                  defaultValue={Math.round(selectedNode.width)}
                  onBlur={(event) => updateNode(selectedNode.id, {
                    width: Math.max(MIND_MAP_VISUAL_TOKENS.node.minWidth, Math.min(1600, Number(event.target.value) || MIND_MAP_VISUAL_TOKENS.node.preferredWidth)),
                    sizeMode: 'manual',
                  })}
                />
              </label>
              <label>
                <span>高度</span>
                <input
                  key={`${selectedNode.id}-height-${Math.round(selectedNode.height)}`}
                  type="number"
                  aria-label="节点高度"
                  min="40"
                  max="1200"
                  defaultValue={Math.round(selectedNode.height)}
                  onBlur={(event) => updateNode(selectedNode.id, {
                    height: Math.max(40, Math.min(1200, Number(event.target.value) || 40)),
                    sizeMode: 'manual',
                  })}
                />
              </label>
              <label>
                <span>类型</span>
                <select
                  aria-label="节点类型"
                  value={selectedNode.type}
                  onChange={(event) => {
                    const type = event.target.value as MindMapNodeType;
                    updateNode(selectedNode.id, {
                      type,
                      ...(type === 'image' ? { width: Math.max(240, selectedNode.width), height: Math.max(160, selectedNode.height), sizeMode: 'manual' as const } : {}),
                    });
                  }}
                >
                  <option value="text">文本</option>
                  <option value="markdown">Markdown</option>
                  <option value="latex">LaTeX</option>
                  <option value="url">URL</option>
                  <option value="image">图片</option>
                </select>
              </label>
              {selectedNode.type === 'url' && (
                <label>
                  <span>链接</span>
                  <input
                    type="url"
                    aria-label="节点链接"
                    defaultValue={selectedNode.link ?? ''}
                    placeholder="https://"
                    onBlur={(event) => updateNode(selectedNode.id, { link: sanitizeMindMapResourceUrl(event.target.value) })}
                  />
                </label>
              )}
              {selectedNode.type === 'image' && (
                <>
                  <label>
                    <span>上传</span>
                    <input
                      type="file"
                      aria-label="上传节点图片"
                      accept="image/png,image/jpeg,image/gif,image/webp"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (!file) return;
                        const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
                        const currentBytes = Object.values(document.nodes).reduce((sum, node) => sum + (node.imageSrc?.startsWith('data:') ? node.imageSrc.length : 0), 0);
                        if (!allowed.includes(file.type) || file.size > 2 * 1024 * 1024) {
                          setResourceError('仅支持 PNG、JPEG、GIF、WebP，单张图片不能超过 2 MiB。');
                          return;
                        }
                        if (currentBytes + Math.ceil(file.size * 4 / 3) > 20 * 1024 * 1024) {
                          setResourceError('当前导图的本地图片总量不能超过 20 MiB。');
                          return;
                        }
                        try {
                          const asset = await mindMapRepository.saveImageAsset(file);
                          setResourceError(null);
                          setFailedImageIds((current) => {
                            const next = new Set(current);
                            next.delete(selectedNode.id);
                            return next;
                          });
                          updateNode(selectedNode.id, { imageAssetId: asset.id, imageSrc: null });
                        } catch (error) {
                          setResourceError(error instanceof Error ? error.message : '图片保存失败，当前节点没有改变。');
                        }
                      }}
                    />
                  </label>
                  <label>
                    <span>HTTPS</span>
                    <input
                      type="url"
                      aria-label="节点图片地址"
                      defaultValue={selectedNode.imageSrc?.startsWith('data:') ? '' : selectedNode.imageSrc ?? ''}
                      placeholder="https://"
                      onBlur={(event) => {
                        if (!event.target.value.trim()) return;
                        const imageSrc = sanitizeMindMapResourceUrl(event.target.value, true);
                        if (!imageSrc) {
                          setResourceError('外部图片必须使用 HTTPS 地址。');
                          return;
                        }
                        setResourceError(null);
                        updateNode(selectedNode.id, { imageSrc, imageAssetId: null });
                      }}
                    />
                  </label>
                  <small>上传图片以独立 Blob 保存在当前设备；外部 HTTPS 图片仅保存地址。</small>
                  {resourceError && <div className={styles.resourceError} role="alert">{resourceError}</div>}
                </>
              )}
              <label>
                <span>填充</span>
                <input
                  type="color"
                  aria-label="节点填充颜色"
                  defaultValue={selectedNode.style.fill}
                  onChange={(event) => updateNode(selectedNode.id, {
                    style: { ...selectedNode.style, fill: event.target.value },
                  })}
                />
              </label>
              <label>
                <span>文字</span>
                <input
                  type="color"
                  aria-label="节点文字颜色"
                  defaultValue={selectedNode.style.textColor}
                  onChange={(event) => updateNode(selectedNode.id, {
                    style: { ...selectedNode.style, textColor: event.target.value },
                  })}
                />
              </label>
              <label>
                <span>字号</span>
                <input
                  type="number"
                  aria-label="节点字号"
                  min="8"
                  max="96"
                  defaultValue={selectedNode.style.fontSize}
                  onBlur={(event) => updateNode(selectedNode.id, {
                    style: {
                      ...selectedNode.style,
                      fontSize: Math.max(8, Math.min(96, Number(event.target.value) || 15)),
                    },
                  })}
                />
              </label>
              <label>
                <span>旋转</span>
                <input
                  type="number"
                  aria-label="节点旋转角度"
                  min="-180"
                  max="180"
                  defaultValue={selectedNode.rotation}
                  onBlur={(event) => updateNode(selectedNode.id, {
                    rotation: Math.max(-180, Math.min(180, Number(event.target.value) || 0)),
                  })}
                />
              </label>
              <div className={styles.layerActions}>
                <button type="button" onClick={() => execute('节点置顶', (current) => ({
                  ...current,
                  zOrder: [...current.zOrder.filter((id) => id !== selectedNode.id), selectedNode.id],
                }))}>置顶</button>
                <button type="button" onClick={() => execute('节点置底', (current) => ({
                  ...current,
                  zOrder: [selectedNode.id, ...current.zOrder.filter((id) => id !== selectedNode.id)],
                }))}>置底</button>
              </div>
              <label className={styles.checkboxField}>
                <input
                  type="checkbox"
                  aria-label="锁定节点"
                  checked={selectedNode.locked}
                  onChange={(event) => updateNode(selectedNode.id, { locked: event.target.checked })}
                />
                <span>锁定节点</span>
              </label>
              {selectedNode.link && (
                <a className={styles.linkAction} href={selectedNode.link} target="_blank" rel="noreferrer">打开链接</a>
              )}
              {(selectedNode.parentSectionId || selectedNode.groupId) && (
                <button className={styles.secondaryAction} type="button" onClick={() => {
                  execute('移出容器', (current) => {
                    const node = current.nodes[selectedNode.id];
                    if (!node) return current;
                    const groups = node.groupId
                      ? Object.fromEntries(Object.entries(current.groups).flatMap(([id, group]) => {
                          if (id !== node.groupId) return [[id, group]];
                          const memberIds = group.memberIds.filter((memberId) => memberId !== node.id);
                          return memberIds.length ? [[id, { ...group, memberIds, updatedAt: Date.now() }]] : [];
                        }))
                      : current.groups;
                    return {
                      ...current,
                      groups,
                      nodes: {
                        ...current.nodes,
                        [node.id]: { ...node, parentSectionId: null, groupId: null, updatedAt: Date.now() },
                      },
                    };
                  });
                }}>移出区域/分组</button>
              )}
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
                    const points = edgePoints(selectedEdge, edgeNodes);
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

import { normalizeLifeMapData } from '@/lifeMap/data';
import type { LifeMapData } from '@/lifeMap/types';

export const MIND_MAP_SCHEMA_VERSION = 8;
export const DEFAULT_DOCUMENT_TITLE = '未命名思维导图';

export type MindMapSaveStatus = 'idle' | 'saving' | 'saved' | 'error';
export type NodeSizeMode = 'auto' | 'manual';
export type MindMapNodeType = 'text' | 'markdown' | 'latex' | 'url' | 'image';
export type EdgeType = 'straight' | 'curve' | 'orthogonal';
export type EdgeDirection = 'none' | 'forward' | 'backward' | 'both';
export type EdgeRelationship = 'tree' | 'reference';
export type CanvasObjectType = 'node' | 'project-reference';

export interface CanvasObjectRef {
  type: CanvasObjectType;
  id: string;
}

export interface NodeStyle {
  fill: string;
  fillOpacity: number;
  borderColor: string;
  borderWidth: number;
  borderStyle: 'solid' | 'dashed';
  borderRadius: number;
  shadow: boolean;
  fontSize: number;
  fontWeight: 400 | 500 | 600 | 700;
  textColor: string;
  textAlign: 'left' | 'center' | 'right';
  lineHeight: number;
}

export interface EdgeStyle {
  color: string;
  width: number;
  dash: 'solid' | 'dashed';
}

export interface MindMapNode {
  id: string;
  type: MindMapNodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  text: string;
  link: string | null;
  imageSrc: string | null;
  imageAssetId: string | null;
  sizeMode: NodeSizeMode;
  parentSectionId: string | null;
  groupId: string | null;
  locked: boolean;
  participatesInLayout: boolean;
  collapsed: boolean;
  style: NodeStyle;
  createdAt: number;
  updatedAt: number;
}

export interface MindMapEdge {
  id: string;
  /** Typed endpoints are authoritative. sourceId/targetId remain for old exports and integrations. */
  source: CanvasObjectRef;
  target: CanvasObjectRef;
  sourceId: string;
  targetId: string;
  type: EdgeType;
  direction: EdgeDirection;
  relationship: EdgeRelationship;
  label: string;
  controlPoints: Array<{ x: number; y: number }>;
  style: EdgeStyle;
  createdAt: number;
  updatedAt: number;
}

export interface MindMapSection {
  id: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  sizeMode: NodeSizeMode;
  collapsed: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MindMapGroup {
  id: string;
  title: string;
  memberIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface MindMapCanvasObjectBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  locked: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectReferenceCard extends MindMapCanvasObjectBase {
  kind: 'project-reference';
  targetType: 'project' | 'task' | 'milestone';
  targetId: string;
  display: 'compact' | 'expanded';
}

export interface TimelineSection extends MindMapCanvasObjectBase {
  kind: 'timeline-section';
  title: string;
  source: 'project' | 'life' | 'manual';
  targetId: string | null;
  scale: 'long-range' | 'month' | 'week';
  rangeStart: string | null;
  rangeEnd: string | null;
  collapsed: boolean;
  manualItems: TimelineManualReference[];
}

export interface TimelineManualReference {
  source: 'project' | 'life';
  contextId: string;
  itemId: string;
}

export type MindMapCanvasObject = ProjectReferenceCard | TimelineSection;

export interface ViewportState {
  x: number;
  y: number;
  scale: number;
}

export interface MindMapSettings {
  grid: 'none' | 'dots' | 'lines';
  background: string;
  selectionMode: 'contain' | 'intersect';
}

export interface LifeMapMigrationMeta {
  version: 1;
  fingerprint: string;
  migratedAt: number;
}

export interface MindMapDocument {
  kind: 'smart-line-mind-map';
  schemaVersion: number;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  nodes: Record<string, MindMapNode>;
  edges: Record<string, MindMapEdge>;
  sections: Record<string, MindMapSection>;
  groups: Record<string, MindMapGroup>;
  projectReferences: Record<string, ProjectReferenceCard>;
  timelineSections: Record<string, TimelineSection>;
  lifeMap: LifeMapData | null;
  lifeMapMigration: LifeMapMigrationMeta | null;
  zOrder: string[];
  viewport: ViewportState;
  settings: MindMapSettings;
}

export interface MindMapDocumentSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  nodeCount: number;
  edgeCount: number;
}

export interface MindMapIndex {
  schemaVersion: number;
  activeDocumentId: string | null;
  documents: MindMapDocumentSummary[];
}

export class MindMapVersionError extends Error {
  constructor(readonly version: number) {
    super('思维导图版本过高，请升级 SmartLine 后再打开。');
    this.name = 'MindMapVersionError';
  }
}

const DEFAULT_NODE_STYLE: NodeStyle = {
  fill: '#ffffff',
  fillOpacity: 0.92,
  borderColor: '#d9dce3',
  borderWidth: 0.75,
  borderStyle: 'solid',
  borderRadius: 9,
  shadow: false,
  fontSize: 14,
  fontWeight: 500,
  textColor: '#1d1d1f',
  textAlign: 'center',
  lineHeight: 1.45,
};

const DEFAULT_EDGE_STYLE: EdgeStyle = {
  color: '#9aa3b2',
  width: 1.35,
  dash: 'solid',
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const finite = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const clamp = (value: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, value));

const safeString = (value: unknown, fallback: string, maximum: number) =>
  typeof value === 'string' ? value.slice(0, maximum) : fallback;

const safeId = (value: unknown) =>
  typeof value === 'string' && value.length > 0 && value.length <= 128 ? value : null;

const safeColor = (value: unknown, fallback: string) =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;

const safeTime = (value: unknown, fallback: number) => {
  const time = finite(value, fallback);
  return time >= 0 ? time : fallback;
};

export const sanitizeMindMapResourceUrl = (value: unknown, imageOnly = false) => {
  if (typeof value !== 'string' || value.length > (imageOnly ? 3_000_000 : 2_048)) return null;
  if (imageOnly && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)) return value;
  try {
    const url = new URL(value);
    if (imageOnly) return url.protocol === 'https:' ? url.toString() : null;
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
};

export const createMindMapId = () => globalThis.crypto.randomUUID();

export function createTextMindMapNode(
  position: { x: number; y: number },
  options: { id?: string; now?: number; text?: string } = {},
): MindMapNode {
  return createMindMapNode(position, 'text', options);
}

export function createMindMapNode(
  position: { x: number; y: number },
  type: MindMapNodeType,
  options: { id?: string; now?: number; text?: string; link?: string; imageSrc?: string } = {},
): MindMapNode {
  const now = options.now ?? Date.now();
  const id = options.id ?? createMindMapId();
  const text = options.text ?? '';
  const sourceLines = text.split('\n');
  const longestLine = Math.max(0, ...sourceLines.map((line) => [...line].length));
  const width = type === 'image' ? 240 : Math.max(112, Math.min(280, longestLine * 14 + 28));
  const wrappedLines = sourceLines.reduce(
    (total, line) => total + Math.max(1, Math.ceil((Math.max(1, [...line].length) * 15) / Math.max(1, width - 32))),
    0,
  );
  return {
    id,
    type,
    x: position.x,
    y: position.y,
    width,
    height: type === 'image' ? 160 : Math.max(36, Math.min(96, wrappedLines * 20 + 16)),
    rotation: 0,
    text,
    link: sanitizeMindMapResourceUrl(options.link),
    imageSrc: sanitizeMindMapResourceUrl(options.imageSrc, true),
    imageAssetId: null,
    sizeMode: 'auto',
    parentSectionId: null,
    groupId: null,
    locked: false,
    participatesInLayout: true,
    collapsed: false,
    style: { ...DEFAULT_NODE_STYLE },
    createdAt: now,
    updatedAt: now,
  };
}

const asCanvasObjectRef = (value: CanvasObjectRef | string): CanvasObjectRef => typeof value === 'string'
  ? { type: 'node', id: value }
  : value;

export const edgeSourceRef = (edge: MindMapEdge): CanvasObjectRef => edge.source ?? { type: 'node', id: edge.sourceId };
export const edgeTargetRef = (edge: MindMapEdge): CanvasObjectRef => edge.target ?? { type: 'node', id: edge.targetId };
export const sameCanvasObjectRef = (left: CanvasObjectRef, right: CanvasObjectRef) => left.type === right.type && left.id === right.id;
export const edgeTouchesCanvasObject = (edge: MindMapEdge, ref: CanvasObjectRef) => (
  sameCanvasObjectRef(edgeSourceRef(edge), ref) || sameCanvasObjectRef(edgeTargetRef(edge), ref)
);

export function createMindMapEdge(
  source: CanvasObjectRef | string,
  target: CanvasObjectRef | string,
  options: { id?: string; now?: number; relationship?: EdgeRelationship } = {},
): MindMapEdge {
  const now = options.now ?? Date.now();
  const sourceRef = asCanvasObjectRef(source);
  const targetRef = asCanvasObjectRef(target);
  return {
    id: options.id ?? createMindMapId(),
    source: sourceRef,
    target: targetRef,
    sourceId: sourceRef.id,
    targetId: targetRef.id,
    type: 'curve',
    direction: 'none',
    relationship: options.relationship === 'tree' && sourceRef.type === 'node' && targetRef.type === 'node' ? 'tree' : 'reference',
    label: '',
    controlPoints: [],
    style: { ...DEFAULT_EDGE_STYLE },
    createdAt: now,
    updatedAt: now,
  };
}

export function createMindMapSection(
  nodes: MindMapNode[],
  options: { id?: string; now?: number; title?: string } = {},
): MindMapSection {
  const now = options.now ?? Date.now();
  const left = nodes.length ? Math.min(...nodes.map((node) => node.x - node.width / 2)) : -120;
  const right = nodes.length ? Math.max(...nodes.map((node) => node.x + node.width / 2)) : 120;
  const top = nodes.length ? Math.min(...nodes.map((node) => node.y - node.height / 2)) : -80;
  const bottom = nodes.length ? Math.max(...nodes.map((node) => node.y + node.height / 2)) : 80;
  const padding = 40;
  return {
    id: options.id ?? createMindMapId(),
    title: options.title?.trim().slice(0, 120) || '区域',
    x: (left + right) / 2,
    y: (top + bottom) / 2,
    width: right - left + padding * 2,
    height: bottom - top + padding * 2 + 24,
    sizeMode: 'auto',
    collapsed: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function createMindMapGroup(
  memberIds: string[],
  options: { id?: string; now?: number; title?: string } = {},
): MindMapGroup {
  const now = options.now ?? Date.now();
  return {
    id: options.id ?? createMindMapId(),
    title: options.title?.trim().slice(0, 120) || '分组',
    memberIds: [...new Set(memberIds)],
    createdAt: now,
    updatedAt: now,
  };
}

export function createProjectReferenceCard(
  position: { x: number; y: number },
  target: Pick<ProjectReferenceCard, 'targetType' | 'targetId'>,
  options: { id?: string; now?: number } = {},
): ProjectReferenceCard {
  const now = options.now ?? Date.now();
  return {
    id: options.id ?? createMindMapId(),
    kind: 'project-reference',
    targetType: target.targetType,
    targetId: target.targetId,
    x: position.x,
    y: position.y,
    width: 224,
    height: 84,
    display: 'compact',
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

export function createTimelineSection(
  position: { x: number; y: number },
  options: { id?: string; now?: number; title?: string } = {},
): TimelineSection {
  const now = options.now ?? Date.now();
  return {
    id: options.id ?? createMindMapId(),
    kind: 'timeline-section',
    title: options.title?.trim().slice(0, 120) || '时间线',
    source: 'manual',
    targetId: null,
    scale: 'month',
    rangeStart: null,
    rangeEnd: null,
    x: position.x,
    y: position.y,
    width: 840,
    height: 320,
    collapsed: false,
    manualItems: [],
    locked: false,
    createdAt: now,
    updatedAt: now,
  };
}

export const mindMapCanvasObjects = (document: MindMapDocument): MindMapCanvasObject[] => [
  ...Object.values(document.projectReferences),
  ...Object.values(document.timelineSections),
];

export function maintainMindMapContainers(document: MindMapDocument): MindMapDocument {
  const now = Date.now();
  const sourceGroupIds = new Set(Object.keys(document.groups));
  let nodes = document.nodes;
  const claimedNodeIds = new Set(Object.values(document.nodes)
    .filter((node) => node.groupId && sourceGroupIds.has(node.groupId))
    .map((node) => node.id));
  for (const group of Object.values(document.groups)) {
    for (const memberId of group.memberIds) {
      const node = nodes[memberId];
      if (!node || claimedNodeIds.has(memberId) || node.groupId) continue;
      if (nodes === document.nodes) nodes = { ...document.nodes };
      nodes[memberId] = { ...node, groupId: group.id, updatedAt: now };
      claimedNodeIds.add(memberId);
    }
  }
  for (const node of Object.values(nodes)) {
    if ((node.groupId && !sourceGroupIds.has(node.groupId))
      || (node.parentSectionId && !document.sections[node.parentSectionId])) {
      if (nodes === document.nodes) nodes = { ...document.nodes };
      nodes[node.id] = {
        ...node,
        groupId: node.groupId && sourceGroupIds.has(node.groupId) ? node.groupId : null,
        parentSectionId: node.parentSectionId && document.sections[node.parentSectionId]
          ? node.parentSectionId
          : null,
        updatedAt: now,
      };
    }
  }
  const groups: Record<string, MindMapGroup> = {};
  for (const group of Object.values(document.groups)) {
    const memberIds = Object.values(nodes).filter((node) => node.groupId === group.id).map((node) => node.id);
    if (memberIds.length > 0) {
      const unchanged = memberIds.length === group.memberIds.length
        && memberIds.every((id, index) => id === group.memberIds[index]);
      groups[group.id] = unchanged ? group : { ...group, memberIds, updatedAt: now };
    }
  }
  const groupIds = new Set(Object.keys(groups));
  for (const node of Object.values(nodes)) {
    if (node.groupId && !groupIds.has(node.groupId)) {
      if (nodes === document.nodes) nodes = { ...document.nodes };
      nodes[node.id] = {
        ...node,
        groupId: null,
        updatedAt: now,
      };
    }
  }
  let sections = document.sections;
  for (const section of Object.values(document.sections)) {
    if (section.sizeMode !== 'auto' || section.collapsed) continue;
    const members = Object.values(nodes).filter((node) => node.parentSectionId === section.id);
    if (members.length === 0) continue;
    const fitted = createMindMapSection(members, {
      id: section.id,
      title: section.title,
      now: section.createdAt,
    });
    if (fitted.x === section.x && fitted.y === section.y && fitted.width === section.width && fitted.height === section.height) continue;
    if (sections === document.sections) sections = { ...document.sections };
    sections[section.id] = {
      ...section,
      x: fitted.x,
      y: fitted.y,
      width: fitted.width,
      height: fitted.height,
      updatedAt: Date.now(),
    };
  }
  if (nodes === document.nodes && sections === document.sections && Object.keys(groups).length === Object.keys(document.groups).length) {
    const unchangedGroups = Object.values(groups).every((group) => group === document.groups[group.id]);
    if (unchangedGroups) return document;
  }
  return { ...document, nodes, sections, groups };
}

export function createEmptyMindMapDocument(
  title = DEFAULT_DOCUMENT_TITLE,
  options: { id?: string; now?: number } = {},
): MindMapDocument {
  const now = options.now ?? Date.now();
  return {
    kind: 'smart-line-mind-map',
    schemaVersion: MIND_MAP_SCHEMA_VERSION,
    id: options.id ?? createMindMapId(),
    title: title.trim() || DEFAULT_DOCUMENT_TITLE,
    createdAt: now,
    updatedAt: now,
    nodes: {},
    edges: {},
    sections: {},
    groups: {},
    projectReferences: {},
    timelineSections: {},
    lifeMap: null,
    lifeMapMigration: null,
    zOrder: [],
    viewport: { x: 0, y: 0, scale: 1 },
    settings: { grid: 'dots', background: '#f9f9fb', selectionMode: 'contain' },
  };
}

export function summarizeMindMapDocument(document: MindMapDocument): MindMapDocumentSummary {
  return {
    id: document.id,
    title: document.title,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    nodeCount: Object.keys(document.nodes).length,
    edgeCount: Object.keys(document.edges).length,
  };
}

function normalizeNode(value: unknown, now: number): MindMapNode | null {
  if (!isRecord(value)) return null;
  const id = safeId(value.id);
  const nodeType = value.type;
  if (!id || (nodeType !== 'text' && nodeType !== 'markdown' && nodeType !== 'latex' && nodeType !== 'url' && nodeType !== 'image')) return null;
  const style = isRecord(value.style) ? value.style : {};
  const fontWeight = finite(style.fontWeight, DEFAULT_NODE_STYLE.fontWeight);
  return {
    id,
    type: nodeType,
    x: clamp(finite(value.x, 0), -1_000_000, 1_000_000),
    y: clamp(finite(value.y, 0), -1_000_000, 1_000_000),
    width: clamp(finite(value.width, 180), 80, 1_600),
    height: clamp(finite(value.height, 56), 36, 1_200),
    rotation: clamp(finite(value.rotation, 0), -180, 180),
    text: safeString(value.text, '', 10_000),
    link: sanitizeMindMapResourceUrl(value.link),
    imageSrc: sanitizeMindMapResourceUrl(value.imageSrc, true),
    imageAssetId: safeId(value.imageAssetId),
    sizeMode: value.sizeMode === 'manual' ? 'manual' : 'auto',
    parentSectionId: safeId(value.parentSectionId),
    groupId: safeId(value.groupId),
    locked: value.locked === true,
    participatesInLayout: value.participatesInLayout !== false,
    collapsed: value.collapsed === true,
    style: {
      fill: safeColor(style.fill, DEFAULT_NODE_STYLE.fill),
      fillOpacity: clamp(finite(style.fillOpacity, 1), 0, 1),
      borderColor: safeColor(style.borderColor, DEFAULT_NODE_STYLE.borderColor),
      borderWidth: clamp(finite(style.borderWidth, 1), 0, 12),
      borderStyle: style.borderStyle === 'dashed' ? 'dashed' : 'solid',
      borderRadius: clamp(finite(style.borderRadius, 12), 0, 80),
      shadow: style.shadow === true,
      fontSize: clamp(finite(style.fontSize, 15), 8, 96),
      fontWeight: fontWeight === 400 || fontWeight === 600 || fontWeight === 700 ? fontWeight : 500,
      textColor: safeColor(style.textColor, DEFAULT_NODE_STYLE.textColor),
      textAlign: style.textAlign === 'left' || style.textAlign === 'right' ? style.textAlign : 'center',
      lineHeight: clamp(finite(style.lineHeight, 1.45), 1, 2.5),
    },
    createdAt: safeTime(value.createdAt, now),
    updatedAt: safeTime(value.updatedAt, now),
  };
}

function normalizeEndpoint(value: unknown, legacyId: unknown, nodeIds: Set<string>, projectReferenceIds: Set<string>): CanvasObjectRef | null {
  const raw = isRecord(value) ? value : null;
  const type = raw?.type === 'project-reference' ? 'project-reference' : raw?.type === 'node' ? 'node' : 'node';
  const id = safeId(raw?.id) ?? safeId(legacyId);
  if (!id) return null;
  if (type === 'node' && nodeIds.has(id)) return { type, id };
  if (type === 'project-reference' && projectReferenceIds.has(id)) return { type, id };
  return null;
}

function normalizeEdge(value: unknown, nodeIds: Set<string>, projectReferenceIds: Set<string>, now: number): MindMapEdge | null {
  if (!isRecord(value)) return null;
  const id = safeId(value.id);
  const source = normalizeEndpoint(value.source, value.sourceId, nodeIds, projectReferenceIds);
  const target = normalizeEndpoint(value.target, value.targetId, nodeIds, projectReferenceIds);
  if (!id || !source || !target || sameCanvasObjectRef(source, target)) return null;
  const style = isRecord(value.style) ? value.style : {};
  const direction = value.direction;
  return {
    id,
    source,
    target,
    sourceId: source.id,
    targetId: target.id,
    type: value.type === 'curve' || value.type === 'orthogonal' ? value.type : 'straight',
    direction: direction === 'forward' || direction === 'backward' || direction === 'both' ? direction : 'none',
    relationship: value.relationship === 'reference' || source.type !== 'node' || target.type !== 'node' ? 'reference' : 'tree',
    label: safeString(value.label, '', 1_000),
    controlPoints: Array.isArray(value.controlPoints)
      ? value.controlPoints.slice(0, 12).flatMap((point) => isRecord(point)
        ? [{
            x: clamp(finite(point.x, 0), -1_000_000, 1_000_000),
            y: clamp(finite(point.y, 0), -1_000_000, 1_000_000),
          }]
        : [])
      : [],
    style: {
      color: safeColor(style.color, DEFAULT_EDGE_STYLE.color),
      width: clamp(finite(style.width, 2), 0.5, 12),
      dash: style.dash === 'dashed' ? 'dashed' : 'solid',
    },
    createdAt: safeTime(value.createdAt, now),
    updatedAt: safeTime(value.updatedAt, now),
  };
}

function normalizeSection(value: unknown, now: number): MindMapSection | null {
  if (!isRecord(value)) return null;
  const id = safeId(value.id);
  if (!id) return null;
  return {
    id,
    title: safeString(value.title, '区域', 120).trim() || '区域',
    x: clamp(finite(value.x, 0), -1_000_000, 1_000_000),
    y: clamp(finite(value.y, 0), -1_000_000, 1_000_000),
    width: clamp(finite(value.width, 320), 160, 10_000),
    height: clamp(finite(value.height, 220), 120, 10_000),
    sizeMode: value.sizeMode === 'manual' ? 'manual' : 'auto',
    collapsed: value.collapsed === true,
    createdAt: safeTime(value.createdAt, now),
    updatedAt: safeTime(value.updatedAt, now),
  };
}

function normalizeGroup(value: unknown, nodeIds: Set<string>, now: number): MindMapGroup | null {
  if (!isRecord(value)) return null;
  const id = safeId(value.id);
  if (!id) return null;
  const memberIds = Array.isArray(value.memberIds)
    ? [...new Set(value.memberIds.filter((memberId): memberId is string => typeof memberId === 'string' && nodeIds.has(memberId)))]
    : [];
  return {
    id,
    title: safeString(value.title, '分组', 120).trim() || '分组',
    memberIds,
    createdAt: safeTime(value.createdAt, now),
    updatedAt: safeTime(value.updatedAt, now),
  };
}

function normalizeCanvasObjectBase(value: Record<string, unknown>, now: number): MindMapCanvasObjectBase | null {
  const id = safeId(value.id);
  if (!id) return null;
  return {
    id,
    x: clamp(finite(value.x, 0), -1_000_000, 1_000_000),
    y: clamp(finite(value.y, 0), -1_000_000, 1_000_000),
    width: clamp(finite(value.width, 240), 80, 10_000),
    height: clamp(finite(value.height, 120), 40, 10_000),
    locked: value.locked === true,
    createdAt: safeTime(value.createdAt, now),
    updatedAt: safeTime(value.updatedAt, now),
  };
}

function normalizeProjectReferenceCard(value: unknown, now: number): ProjectReferenceCard | null {
  if (!isRecord(value) || value.kind !== 'project-reference') return null;
  const base = normalizeCanvasObjectBase(value, now);
  const targetId = safeId(value.targetId);
  if (!base || !targetId || !['project', 'task', 'milestone'].includes(String(value.targetType))) return null;
  return {
    ...base,
    kind: 'project-reference',
    targetType: value.targetType as ProjectReferenceCard['targetType'],
    targetId,
    display: value.display === 'expanded' ? 'expanded' : 'compact',
  };
}

function normalizeTimelineSection(value: unknown, now: number): TimelineSection | null {
  if (!isRecord(value) || value.kind !== 'timeline-section') return null;
  const base = normalizeCanvasObjectBase(value, now);
  const source = value.source;
  if (!base || (source !== 'project' && source !== 'life' && source !== 'manual')) return null;
  const targetId = safeId(value.targetId);
  const rangeStart = safeString(value.rangeStart, '', 10) || null;
  const rangeEnd = safeString(value.rangeEnd, '', 10) || null;
  const manualItems: TimelineManualReference[] = [];
  if (Array.isArray(value.manualItems)) {
    const seen = new Set<string>();
    for (const raw of value.manualItems.slice(0, 500)) {
      if (!isRecord(raw) || (raw.source !== 'project' && raw.source !== 'life')) continue;
      const contextId = safeId(raw.contextId);
      const itemId = safeId(raw.itemId);
      const key = `${raw.source}:${contextId}:${itemId}`;
      if (!contextId || !itemId || seen.has(key)) continue;
      seen.add(key);
      manualItems.push({ source: raw.source, contextId, itemId });
    }
  }
  return {
    ...base,
    kind: 'timeline-section',
    title: safeString(value.title, '时间线', 120).trim() || '时间线',
    source,
    targetId,
    scale: value.scale === 'long-range' || value.scale === 'week' ? value.scale : 'month',
    rangeStart,
    rangeEnd,
    collapsed: value.collapsed === true,
    manualItems,
  };
}

export function normalizeMindMapDocument(value: unknown): MindMapDocument | null {
  if (!isRecord(value) || value.kind !== 'smart-line-mind-map') return null;
  const version = finite(value.schemaVersion, 0);
  if (version > MIND_MAP_SCHEMA_VERSION) throw new MindMapVersionError(version);
  if (version < 1) return null;
  const id = safeId(value.id);
  if (!id) return null;
  const now = Date.now();
  const nodes: Record<string, MindMapNode> = {};
  if (isRecord(value.nodes)) {
    for (const rawNode of Object.values(value.nodes).slice(0, 10_000)) {
      const node = normalizeNode(rawNode, now);
      if (node && !nodes[node.id]) nodes[node.id] = node;
    }
  }
  const nodeIds = new Set(Object.keys(nodes));
  const sections: Record<string, MindMapSection> = {};
  if (isRecord(value.sections)) {
    for (const rawSection of Object.values(value.sections).slice(0, 2_000)) {
      const section = normalizeSection(rawSection, now);
      if (section && !sections[section.id]) sections[section.id] = section;
    }
  }
  const groups: Record<string, MindMapGroup> = {};
  if (isRecord(value.groups)) {
    for (const rawGroup of Object.values(value.groups).slice(0, 2_000)) {
      const group = normalizeGroup(rawGroup, nodeIds, now);
      if (group && !groups[group.id]) groups[group.id] = group;
    }
  }
  const projectReferences: Record<string, ProjectReferenceCard> = {};
  if (isRecord(value.projectReferences)) {
    for (const rawReference of Object.values(value.projectReferences).slice(0, 2_000)) {
      const reference = normalizeProjectReferenceCard(rawReference, now);
      if (reference && !projectReferences[reference.id]) projectReferences[reference.id] = reference;
    }
  }
  const timelineSections: Record<string, TimelineSection> = {};
  if (isRecord(value.timelineSections)) {
    for (const rawTimeline of Object.values(value.timelineSections).slice(0, 2_000)) {
      const timeline = normalizeTimelineSection(rawTimeline, now);
      if (timeline && !timelineSections[timeline.id]) timelineSections[timeline.id] = timeline;
    }
  }
  const sectionIds = new Set(Object.keys(sections));
  const groupIds = new Set(Object.keys(groups));
  for (const [nodeId, node] of Object.entries(nodes)) {
    nodes[nodeId] = {
      ...node,
      style: { ...node.style },
      parentSectionId: node.parentSectionId && sectionIds.has(node.parentSectionId) ? node.parentSectionId : null,
      groupId: node.groupId && groupIds.has(node.groupId) ? node.groupId : null,
    };
  }
  const claimedNodeIds = new Set(Object.values(nodes).filter((node) => node.groupId).map((node) => node.id));
  for (const group of Object.values(groups)) {
    for (const memberId of group.memberIds) {
      const node = nodes[memberId];
      if (!node || node.groupId || claimedNodeIds.has(memberId)) continue;
      nodes[memberId] = { ...node, groupId: group.id };
      claimedNodeIds.add(memberId);
    }
  }
  for (const group of Object.values(groups)) {
    group.memberIds = Object.values(nodes).filter((node) => node.groupId === group.id).map((node) => node.id);
  }
  const edges: Record<string, MindMapEdge> = {};
  const projectReferenceIds = new Set(Object.keys(projectReferences));
  if (isRecord(value.edges)) {
    for (const rawEdge of Object.values(value.edges).slice(0, 20_000)) {
      const edge = normalizeEdge(rawEdge, nodeIds, projectReferenceIds, now);
      if (edge && !edges[edge.id]) edges[edge.id] = edge;
    }
  }
  const zOrder: string[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.zOrder)) {
    for (const rawId of value.zOrder) {
      if (typeof rawId === 'string' && nodeIds.has(rawId) && !seen.has(rawId)) {
        seen.add(rawId);
        zOrder.push(rawId);
      }
    }
  }
  for (const nodeId of nodeIds) {
    if (!seen.has(nodeId)) zOrder.push(nodeId);
  }
  const viewport = isRecord(value.viewport) ? value.viewport : {};
  const settings = isRecord(value.settings) ? value.settings : {};
  const createdAt = safeTime(value.createdAt, now);
  const lifeMap = isRecord(value.lifeMap) ? normalizeLifeMapData(value.lifeMap) : null;
  const rawMigration = isRecord(value.lifeMapMigration) ? value.lifeMapMigration : null;
  const lifeMapMigration: LifeMapMigrationMeta | null = rawMigration
    && rawMigration.version === 1
    && typeof rawMigration.fingerprint === 'string'
    && /^[0-9a-f]{64}$/.test(rawMigration.fingerprint)
    ? {
        version: 1,
        fingerprint: rawMigration.fingerprint,
        migratedAt: safeTime(rawMigration.migratedAt, now),
      }
    : null;
  return {
    kind: 'smart-line-mind-map',
    schemaVersion: MIND_MAP_SCHEMA_VERSION,
    id,
    title: safeString(value.title, DEFAULT_DOCUMENT_TITLE, 120).trim() || DEFAULT_DOCUMENT_TITLE,
    createdAt,
    updatedAt: safeTime(value.updatedAt, createdAt),
    nodes,
    edges,
    sections,
    groups,
    projectReferences,
    timelineSections,
    lifeMap,
    lifeMapMigration,
    zOrder,
    viewport: {
      x: clamp(finite(viewport.x, 0), -1_000_000, 1_000_000),
      y: clamp(finite(viewport.y, 0), -1_000_000, 1_000_000),
      scale: clamp(finite(viewport.scale, 1), 0.05, 8),
    },
    settings: {
      grid: settings.grid === 'none' || settings.grid === 'lines' ? settings.grid : 'dots',
      background: safeColor(settings.background, '#f9f9fb'),
      selectionMode: settings.selectionMode === 'intersect' ? 'intersect' : 'contain',
    },
  };
}

export function normalizeMindMapIndex(value: unknown): MindMapIndex | null {
  if (!isRecord(value)) return null;
  const version = finite(value.schemaVersion, 0);
  if (version > MIND_MAP_SCHEMA_VERSION) throw new MindMapVersionError(version);
  if (version < 1 || !Array.isArray(value.documents)) return null;
  const documents: MindMapDocumentSummary[] = [];
  const seen = new Set<string>();
  for (const item of value.documents) {
    if (!isRecord(item)) continue;
    const id = safeId(item.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const createdAt = safeTime(item.createdAt, Date.now());
    documents.push({
      id,
      title: safeString(item.title, DEFAULT_DOCUMENT_TITLE, 120).trim() || DEFAULT_DOCUMENT_TITLE,
      createdAt,
      updatedAt: safeTime(item.updatedAt, createdAt),
      nodeCount: Math.max(0, Math.floor(finite(item.nodeCount, 0))),
      edgeCount: Math.max(0, Math.floor(finite(item.edgeCount, 0))),
    });
  }
  const requestedActive = safeId(value.activeDocumentId);
  return {
    schemaVersion: MIND_MAP_SCHEMA_VERSION,
    activeDocumentId: requestedActive && seen.has(requestedActive) ? requestedActive : documents[0]?.id ?? null,
    documents,
  };
}

export function duplicateMindMapDocument(
  source: MindMapDocument,
  options: { id?: string; now?: number } = {},
): MindMapDocument {
  const now = options.now ?? Date.now();
  const sectionIds = new Map<string, string>();
  const sections: Record<string, MindMapSection> = {};
  for (const section of Object.values(source.sections)) {
    const id = createMindMapId();
    sectionIds.set(section.id, id);
    sections[id] = { ...section, id, createdAt: now, updatedAt: now };
  }
  const groupIds = new Map<string, string>();
  for (const group of Object.values(source.groups)) groupIds.set(group.id, createMindMapId());
  const nodeIds = new Map<string, string>();
  const nodes: Record<string, MindMapNode> = {};
  for (const node of Object.values(source.nodes)) {
    const id = createMindMapId();
    nodeIds.set(node.id, id);
    nodes[id] = {
      ...node,
      id,
      style: { ...node.style },
      parentSectionId: node.parentSectionId ? sectionIds.get(node.parentSectionId) ?? null : null,
      groupId: node.groupId ? groupIds.get(node.groupId) ?? null : null,
      createdAt: now,
      updatedAt: now,
    };
  }
  const groups: Record<string, MindMapGroup> = {};
  for (const group of Object.values(source.groups)) {
    const id = groupIds.get(group.id);
    if (!id) continue;
    groups[id] = {
      ...group,
      id,
      memberIds: group.memberIds.map((memberId) => nodeIds.get(memberId)).filter((memberId): memberId is string => Boolean(memberId)),
      createdAt: now,
      updatedAt: now,
    };
  }
  const projectReferences: Record<string, ProjectReferenceCard> = {};
  const projectReferenceIds = new Map<string, string>();
  for (const reference of Object.values(source.projectReferences)) {
    const id = createMindMapId();
    projectReferenceIds.set(reference.id, id);
    projectReferences[id] = { ...reference, id, createdAt: now, updatedAt: now };
  }
  const remapEndpoint = (ref: CanvasObjectRef): CanvasObjectRef | null => {
    const id = ref.type === 'node' ? nodeIds.get(ref.id) : projectReferenceIds.get(ref.id);
    return id ? { type: ref.type, id } : null;
  };
  const edges: Record<string, MindMapEdge> = {};
  for (const edge of Object.values(source.edges)) {
    const sourceRef = remapEndpoint(edgeSourceRef(edge));
    const targetRef = remapEndpoint(edgeTargetRef(edge));
    if (!sourceRef || !targetRef) continue;
    const id = createMindMapId();
    edges[id] = { ...edge, id, controlPoints: edge.controlPoints.map((point) => ({ ...point })), source: sourceRef, target: targetRef, sourceId: sourceRef.id, targetId: targetRef.id, createdAt: now, updatedAt: now };
  }
  const timelineSections: Record<string, TimelineSection> = {};
  for (const timeline of Object.values(source.timelineSections)) {
    const id = createMindMapId();
    timelineSections[id] = { ...timeline, id, createdAt: now, updatedAt: now };
  }
  return {
    ...source,
    id: options.id ?? createMindMapId(),
    title: source.title + ' 副本',
    createdAt: now,
    updatedAt: now,
    nodes,
    edges,
    sections,
    groups,
    projectReferences,
    timelineSections,
    lifeMap: source.lifeMap ? normalizeLifeMapData(source.lifeMap) : null,
    lifeMapMigration: source.lifeMapMigration ? { ...source.lifeMapMigration } : null,
    zOrder: source.zOrder.map((id) => nodeIds.get(id)).filter((id): id is string => Boolean(id)),
  };
}

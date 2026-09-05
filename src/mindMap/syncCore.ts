import {
  MIND_MAP_SCHEMA_VERSION,
  normalizeMindMapDocument,
  type MindMapDocument,
  type MindMapDocumentSummary,
  type MindMapEdge,
  type MindMapGroup,
  type MindMapNode,
  type MindMapSection,
  type MindMapSettings,
  type LifeMapMigrationMeta,
  type ProjectReferenceCard,
  type TimelineSection,
} from './model';
import type { LifeMapData } from '@/lifeMap/types';

export type MindMapSyncStatus = 'local' | 'connecting' | 'connected' | 'offline' | 'error';

export type MindMapPresence = {
  color: string;
  cursor: { x: number; y: number } | null;
  draggingId: string | null;
  editingId: string | null;
  name: string;
}

export interface MindMapRemotePresence extends MindMapPresence {
  connectionId: number;
}

export interface MindMapSyncPatch {
  version: 1;
  documentId: string;
  title?: string;
  settings?: MindMapSettings;
  zOrder?: string[];
  lifeMap?: LifeMapData | null;
  lifeMapMigration?: LifeMapMigrationMeta | null;
  updatedAt: number;
  nodes: { upserts: Record<string, MindMapNode>; deletes: string[] };
  edges: { upserts: Record<string, MindMapEdge>; deletes: string[] };
  sections: { upserts: Record<string, MindMapSection>; deletes: string[] };
  groups: { upserts: Record<string, MindMapGroup>; deletes: string[] };
  projectReferences: { upserts: Record<string, ProjectReferenceCard>; deletes: string[] };
  timelineSections: { upserts: Record<string, TimelineSection>; deletes: string[] };
}

export interface MindMapSyncState {
  version: 1;
  base: MindMapDocument;
  pending: MindMapSyncPatch | null;
}

export interface MindMapCatalogEntry extends MindMapDocumentSummary {
  deletedAt: number | null;
}

const safeRoomPart = (value: string, limit: number) => value
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, limit);

function safeDocumentRoomPart(value: string): string {
  const safe = value.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
  if (safe.length <= 48) return safe;
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return `${safe.slice(0, 39)}-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export function buildMindMapRoomId(identity: string, documentId: string): string {
  const owner = safeRoomPart(identity, 48);
  const document = safeDocumentRoomPart(documentId);
  if (!owner || !document) throw new Error('无法为思维导图生成安全的云端房间。');
  return `workspace-${owner}-mind-map-${document}`;
}

export function buildMindMapCatalogRoomId(identity: string): string {
  const owner = safeRoomPart(identity, 48);
  if (!owner) throw new Error('无法为思维导图生成安全的云端目录。');
  return `workspace-${owner}-mind-map-catalog-v1`;
}

export function mindMapCatalogEntries(documents: MindMapDocumentSummary[]): Record<string, MindMapCatalogEntry> {
  return Object.fromEntries(documents.map((document) => [document.id, { ...document, deletedAt: null }]));
}

export function selectLatestActiveMindMapCatalogEntry(entries: MindMapCatalogEntry[]): MindMapCatalogEntry | null {
  return [...entries]
    .filter((entry) => entry.deletedAt === null)
    .sort((left, right) => right.updatedAt - left.updatedAt || right.createdAt - left.createdAt || left.id.localeCompare(right.id))[0]
    ?? null;
}

export function mergeMindMapCatalogEntries(
  local: Record<string, MindMapCatalogEntry>,
  remote: Record<string, MindMapCatalogEntry>,
): Record<string, MindMapCatalogEntry> {
  const merged: Record<string, MindMapCatalogEntry> = {};
  for (const id of new Set([...Object.keys(local), ...Object.keys(remote)])) {
    const here = local[id];
    const there = remote[id];
    if (!here) merged[id] = there;
    else if (!there) merged[id] = here;
    else {
      const hereAt = Math.max(here.updatedAt, here.deletedAt ?? 0);
      const thereAt = Math.max(there.updatedAt, there.deletedAt ?? 0);
      merged[id] = hereAt > thereAt || (hereAt === thereAt && here.deletedAt !== null) ? here : there;
    }
  }
  return merged;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => [key, canonical(item)]));
  }
  return value;
}

const same = (a: unknown, b: unknown) => a === b || JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));

function mergeEntities<T extends { updatedAt: number }>(
  base: Record<string, T>,
  local: Record<string, T>,
  remote: Record<string, T>,
): Record<string, T> {
  const merged: Record<string, T> = {};
  const ids = new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)]);
  for (const id of ids) {
    const before = base[id];
    const here = local[id];
    const there = remote[id];
    if (same(here, before)) {
      if (there) merged[id] = there;
      continue;
    }
    if (same(there, before)) {
      if (here) merged[id] = here;
      continue;
    }
    // A concurrent deletion wins over an edit so an object cannot be half-resurrected.
    if (!here || !there) continue;
    merged[id] = here.updatedAt > there.updatedAt ? here : there;
  }
  return merged;
}

function mergeValue<T>(base: T, local: T, remote: T, preferLocal: boolean): T {
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  return preferLocal ? local : remote;
}

function mergeOrder(base: string[], local: string[], remote: string[], preferLocal: boolean): string[] {
  if (same(local, base)) return remote;
  if (same(remote, base)) return local;
  const preferred = preferLocal ? local : remote;
  const secondary = preferLocal ? remote : local;
  return [...new Set([...preferred, ...secondary])];
}

export function emptyMindMapSyncBase(document: MindMapDocument): MindMapDocument {
  // A session may receive local edits before the first room reconciliation.  The
  // loaded document is the only available baseline for turning those edits into
  // deletes; an empty base would make a deleted remote entity indistinguishable
  // from a new remote entity and resurrect it.
  return document;
}

export function mergeMindMapDocuments(
  base: MindMapDocument,
  local: MindMapDocument,
  remote: MindMapDocument,
): MindMapDocument {
  if (base.id !== local.id || local.id !== remote.id) throw new Error('不能合并不同的思维导图。');
  const preferLocal = local.updatedAt > remote.updatedAt;
  const normalized = normalizeMindMapDocument({
    kind: 'smart-line-mind-map',
    schemaVersion: MIND_MAP_SCHEMA_VERSION,
    id: local.id,
    title: mergeValue(base.title, local.title, remote.title, preferLocal),
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Math.max(local.updatedAt, remote.updatedAt),
    nodes: mergeEntities(base.nodes, local.nodes, remote.nodes),
    edges: mergeEntities(base.edges, local.edges, remote.edges),
    sections: mergeEntities(base.sections, local.sections, remote.sections),
    groups: mergeEntities(base.groups, local.groups, remote.groups),
    projectReferences: mergeEntities(base.projectReferences, local.projectReferences, remote.projectReferences),
    timelineSections: mergeEntities(base.timelineSections, local.timelineSections, remote.timelineSections),
    lifeMap: mergeValue(base.lifeMap, local.lifeMap, remote.lifeMap, preferLocal),
    lifeMapMigration: mergeValue(base.lifeMapMigration, local.lifeMapMigration, remote.lifeMapMigration, preferLocal),
    zOrder: mergeOrder(base.zOrder, local.zOrder, remote.zOrder, preferLocal),
    viewport: local.viewport,
    settings: mergeValue(base.settings, local.settings, remote.settings, preferLocal),
  });
  if (!normalized) throw new Error('云端思维导图数据无效。');
  return normalized;
}

function entityDiff<T>(base: Record<string, T>, current: Record<string, T>) {
  const upserts: Record<string, T> = {};
  const deletes: string[] = [];
  for (const [id, value] of Object.entries(current)) {
    if (!same(base[id], value)) upserts[id] = value;
  }
  for (const id of Object.keys(base)) {
    if (!current[id]) deletes.push(id);
  }
  return { upserts, deletes };
}

export function createMindMapSyncPatch(base: MindMapDocument, current: MindMapDocument): MindMapSyncPatch {
  if (base.id !== current.id) throw new Error('不能为不同的思维导图创建同步补丁。');
  return {
    version: 1,
    documentId: current.id,
    ...(same(base.title, current.title) ? {} : { title: current.title }),
    ...(same(base.settings, current.settings) ? {} : { settings: current.settings }),
    ...(same(base.zOrder, current.zOrder) ? {} : { zOrder: current.zOrder }),
    ...(same(base.lifeMap, current.lifeMap) ? {} : { lifeMap: current.lifeMap }),
    ...(same(base.lifeMapMigration, current.lifeMapMigration) ? {} : { lifeMapMigration: current.lifeMapMigration }),
    updatedAt: current.updatedAt,
    nodes: entityDiff(base.nodes, current.nodes),
    edges: entityDiff(base.edges, current.edges),
    sections: entityDiff(base.sections, current.sections),
    groups: entityDiff(base.groups, current.groups),
    projectReferences: entityDiff(base.projectReferences, current.projectReferences),
    timelineSections: entityDiff(base.timelineSections, current.timelineSections),
  };
}

export function isMindMapSyncPatchEmpty(patch: MindMapSyncPatch): boolean {
  return patch.title === undefined
    && patch.settings === undefined
    && patch.zOrder === undefined
    && patch.lifeMap === undefined
    && patch.lifeMapMigration === undefined
    && [patch.nodes, patch.edges, patch.sections, patch.groups, patch.projectReferences, patch.timelineSections]
      .every((change) => change.deletes.length === 0 && Object.keys(change.upserts).length === 0);
}

export function applyMindMapSyncPatch(document: MindMapDocument, patch: MindMapSyncPatch): MindMapDocument {
  if (document.id !== patch.documentId) throw new Error('同步补丁不属于当前思维导图。');
  const applyEntities = <T,>(current: Record<string, T>, change: { upserts: Record<string, T>; deletes: string[] }) => {
    const next = { ...current, ...change.upserts };
    for (const id of change.deletes) delete next[id];
    return next;
  };
  const normalized = normalizeMindMapDocument({
    ...document,
    title: patch.title ?? document.title,
    settings: patch.settings ?? document.settings,
    zOrder: patch.zOrder ?? document.zOrder,
    lifeMap: patch.lifeMap === undefined ? document.lifeMap : patch.lifeMap,
    lifeMapMigration: patch.lifeMapMigration === undefined ? document.lifeMapMigration : patch.lifeMapMigration,
    updatedAt: Math.max(document.updatedAt, patch.updatedAt),
    nodes: applyEntities(document.nodes, patch.nodes),
    edges: applyEntities(document.edges, patch.edges),
    sections: applyEntities(document.sections, patch.sections),
    groups: applyEntities(document.groups, patch.groups),
    projectReferences: applyEntities(document.projectReferences, patch.projectReferences),
    timelineSections: applyEntities(document.timelineSections, patch.timelineSections),
  });
  if (!normalized) throw new Error('同步补丁产生了无效思维导图。');
  return normalized;
}

export function mindMapSyncSignature(document: MindMapDocument): string {
  return JSON.stringify(canonical({
    title: document.title,
    nodes: document.nodes,
    edges: document.edges,
    sections: document.sections,
    groups: document.groups,
    projectReferences: document.projectReferences,
    timelineSections: document.timelineSections,
    lifeMap: document.lifeMap,
    lifeMapMigration: document.lifeMapMigration,
    zOrder: document.zOrder,
    settings: document.settings,
  }));
}

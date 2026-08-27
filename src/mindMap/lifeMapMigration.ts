import { normalizeLifeMapData } from '@/lifeMap/data';
import type { LifeFocus, LifeMapData, LifeMapNote } from '@/lifeMap/types';
import {
  createMindMapNode,
  createTextMindMapNode,
  createTimelineSection,
  type MindMapDocument,
  type MindMapNode,
  type TimelineSection,
} from './model';

export const LIFE_MAP_MIGRATION_COLLECTIONS = [
  'lifeMapAreas',
  'lifeMapPlanGroups',
  'lifeMapStages',
  'lifeMapThemes',
  'lifeMapGoals',
  'lifeMapSystems',
  'lifeMapSystemCheckIns',
  'lifeMapEvents',
  'lifeMapFocuses',
  'lifeMapNotes',
  'lifeMapReviews',
] as const satisfies readonly (keyof LifeMapData)[];

export type LifeMapMigrationCollection = (typeof LIFE_MAP_MIGRATION_COLLECTIONS)[number];

export interface LifeMapMigrationPreflight {
  version: 1;
  fingerprint: string;
  activeCounts: Record<LifeMapMigrationCollection, number>;
  totalActive: number;
  blockers: LifeMapMigrationCollection[];
  canSwitchOwnership: boolean;
}

export interface LifeMapMigrationBackup {
  kind: 'smart-line-life-map-migration-backup';
  version: 1;
  createdAt: string;
  fingerprint: string;
  payload: string;
}

export interface LifeMapMigrationResult {
  document: MindMapDocument;
  preflight: LifeMapMigrationPreflight;
  backup: LifeMapMigrationBackup;
  changed: boolean;
}

function projectLifeMapIntoDocument(source: MindMapDocument, normalized: LifeMapData, now: number): MindMapDocument {
  const baseX = rightEdge(source);
  const activeAreas = normalized.lifeMapAreas.filter((area) => !area.deletedAt);
  const timelineSections = { ...source.timelineSections };
  const areaProjectionIds = new Set(activeAreas.map((area) => projectionId('area', area.id)));
  for (const id of Object.keys(timelineSections)) {
    if (id.startsWith('life-area:') && !areaProjectionIds.has(id)) delete timelineSections[id];
  }
  activeAreas.forEach((area, index) => {
    const id = projectionId('area', area.id);
    const current = timelineSections[id];
    if (current) {
      timelineSections[id] = current.title === area.name && current.source === 'life' && current.targetId === area.id
        ? current
        : { ...current, title: area.name, source: 'life', targetId: area.id, updatedAt: now };
      return;
    }
    timelineSections[id] = {
      ...createTimelineSection({ x: baseX, y: (index - (activeAreas.length - 1) / 2) * 420 }, { id, now, title: area.name }),
      source: 'life',
      targetId: area.id,
      scale: 'long-range',
    } satisfies TimelineSection;
  });

  const nodes = { ...source.nodes };
  const activeFocuses = normalized.lifeMapFocuses.filter((item) => !item.deletedAt);
  const activeNotes = normalized.lifeMapNotes.filter((item) => !item.deletedAt);
  const nodeProjectionIds = new Set([
    ...activeFocuses.map((item) => projectionId('focus', item.id)),
    ...activeNotes.map((item) => projectionId('note', item.id)),
  ]);
  for (const id of Object.keys(nodes)) {
    if ((id.startsWith('life-focus:') || id.startsWith('life-note:')) && !nodeProjectionIds.has(id)) delete nodes[id];
  }
  const zOrder = source.zOrder.filter((id) => nodes[id]);
  [...activeFocuses, ...activeNotes].forEach((item, index) => {
    const kind = 'start' in item ? 'focus' : 'note';
    const id = projectionId(kind, item.id);
    nodes[id] = projectNode(nodes[id], item, { x: baseX + 760, y: index * 110 }, now);
    if (!zOrder.includes(id)) zOrder.push(id);
  });
  return { ...source, nodes, timelineSections, zOrder, lifeMap: normalized };
}

/** Keeps managed canvas projections in lockstep with the map-owned life data. */
export function reconcileLifeMapProjections(source: MindMapDocument, now = Date.now()): MindMapDocument {
  return source.lifeMap ? projectLifeMapIntoDocument(source, normalizeLifeMapData(source.lifeMap), now) : source;
}

const activeCount = (items: Array<{ deletedAt?: string }>) => items.filter((item) => !item.deletedAt).length;

export async function fingerprintLifeMap(data: LifeMapData): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(data));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function createLifeMapMigrationPreflight(
  data: LifeMapData,
  coveredCollections: readonly LifeMapMigrationCollection[] = [],
): Promise<LifeMapMigrationPreflight> {
  const activeCounts = Object.fromEntries(LIFE_MAP_MIGRATION_COLLECTIONS.map((collection) => [
    collection,
    activeCount(data[collection]),
  ])) as Record<LifeMapMigrationCollection, number>;
  const covered = new Set(coveredCollections);
  const blockers = LIFE_MAP_MIGRATION_COLLECTIONS.filter((collection) => activeCounts[collection] > 0 && !covered.has(collection));
  return {
    version: 1,
    fingerprint: await fingerprintLifeMap(data),
    activeCounts,
    totalActive: Object.values(activeCounts).reduce((sum, count) => sum + count, 0),
    blockers,
    canSwitchOwnership: blockers.length === 0,
  };
}

export async function createLifeMapMigrationBackup(data: LifeMapData, createdAt = new Date().toISOString()): Promise<LifeMapMigrationBackup> {
  const payload = JSON.stringify(data);
  return {
    kind: 'smart-line-life-map-migration-backup',
    version: 1,
    createdAt,
    fingerprint: await fingerprintLifeMap(data),
    payload,
  };
}

const projectionId = (kind: 'area' | 'focus' | 'note', id: string) => `life-${kind}:${id}`;

function rightEdge(document: MindMapDocument): number {
  const objects = [
    ...Object.values(document.nodes).filter((node) => !node.id.startsWith('life-focus:') && !node.id.startsWith('life-note:')),
    ...Object.values(document.sections),
    ...Object.values(document.projectReferences),
    ...Object.values(document.timelineSections).filter((timeline) => !timeline.id.startsWith('life-area:')),
  ];
  return objects.length === 0 ? 0 : Math.max(...objects.map((item) => item.x + item.width)) + 160;
}

function projectNode(
  current: MindMapNode | undefined,
  item: LifeFocus | LifeMapNote,
  position: { x: number; y: number },
  now: number,
): MindMapNode {
  const isFocus = 'start' in item;
  const text = isFocus
    ? `${item.name}\n${item.start} — ${item.end}`
    : `${item.name}${item.body ? `\n${item.body}` : ''}\n${item.date}${item.endDate ? ` — ${item.endDate}` : ''}`;
  if (current) return current.text === text ? current : { ...current, text, updatedAt: now };
  return isFocus
    ? createTextMindMapNode(position, { id: projectionId('focus', item.id), now, text })
    : createMindMapNode(position, 'markdown', { id: projectionId('note', item.id), now, text });
}

/**
 * Copies the complete normalized Life Map into one Map document and adds only
 * lightweight canvas projections. The legacy store remains untouched.
 */
export async function migrateLifeMapIntoDocument(
  source: MindMapDocument,
  data: LifeMapData,
  now = Date.now(),
): Promise<LifeMapMigrationResult> {
  const normalized = normalizeLifeMapData(data);
  const preflight = await createLifeMapMigrationPreflight(normalized, LIFE_MAP_MIGRATION_COLLECTIONS);
  const backup = await createLifeMapMigrationBackup(normalized, new Date(now).toISOString());
  if (source.lifeMap && source.lifeMapMigration?.fingerprint === preflight.fingerprint) {
    return { document: source, preflight, backup, changed: false };
  }

  const projected = projectLifeMapIntoDocument(source, normalized, now);

  return {
    document: {
      ...projected,
      updatedAt: now,
      lifeMapMigration: { version: 1, fingerprint: preflight.fingerprint, migratedAt: now },
    },
    preflight,
    backup,
    changed: true,
  };
}

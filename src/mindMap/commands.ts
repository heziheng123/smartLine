import type {
  LifeMapMigrationMeta,
  MindMapDocument,
  MindMapEdge,
  MindMapGroup,
  MindMapNode,
  MindMapSection,
  MindMapSettings,
  ProjectReferenceCard,
  TimelineSection,
} from './model';
import type { LifeMapData } from '@/lifeMap/types';

interface EntityChange<T> {
  id: string;
  before: T | null;
  after: T | null;
}

export interface MindMapHistoryEntry {
  label: string;
  nodes: EntityChange<MindMapNode>[];
  edges: EntityChange<MindMapEdge>[];
  sections: EntityChange<MindMapSection>[];
  groups: EntityChange<MindMapGroup>[];
  projectReferences: EntityChange<ProjectReferenceCard>[];
  timelineSections: EntityChange<TimelineSection>[];
  zOrderBefore: string[] | null;
  zOrderAfter: string[] | null;
  settingsBefore: MindMapSettings | null;
  settingsAfter: MindMapSettings | null;
  lifeMapChanged: boolean;
  lifeMapBefore: LifeMapData | null;
  lifeMapAfter: LifeMapData | null;
  lifeMapMigrationBefore: LifeMapMigrationMeta | null;
  lifeMapMigrationAfter: LifeMapMigrationMeta | null;
}

export interface MindMapHistory {
  undo: MindMapHistoryEntry[];
  redo: MindMapHistoryEntry[];
}

export const emptyMindMapHistory = (): MindMapHistory => ({ undo: [], redo: [] });

function entityChanges<T>(
  before: Record<string, T>,
  after: Record<string, T>,
): EntityChange<T>[] {
  const changes: EntityChange<T>[] = [];
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of ids) {
    if (before[id] === after[id]) continue;
    changes.push({ id, before: before[id] ?? null, after: after[id] ?? null });
  }
  return changes;
}

const sameOrder = (a: string[], b: string[]) =>
  a === b || (a.length === b.length && a.every((id, index) => id === b[index]));

const sameValue = (a: unknown, b: unknown) => a === b || JSON.stringify(a) === JSON.stringify(b);

export function createHistoryEntry(
  label: string,
  before: MindMapDocument,
  after: MindMapDocument,
): MindMapHistoryEntry | null {
  const nodes = entityChanges(before.nodes, after.nodes);
  const edges = entityChanges(before.edges, after.edges);
  const sections = entityChanges(before.sections, after.sections);
  const groups = entityChanges(before.groups, after.groups);
  const projectReferences = entityChanges(before.projectReferences, after.projectReferences);
  const timelineSections = entityChanges(before.timelineSections, after.timelineSections);
  const orderChanged = !sameOrder(before.zOrder, after.zOrder);
  const settingsChanged = before.settings !== after.settings && (
    before.settings.grid !== after.settings.grid
    || before.settings.background !== after.settings.background
    || before.settings.selectionMode !== after.settings.selectionMode
    || before.settings.theme !== after.settings.theme
  );
  const lifeMapChanged = !sameValue(before.lifeMap, after.lifeMap)
    || !sameValue(before.lifeMapMigration, after.lifeMapMigration);
  if (nodes.length === 0 && edges.length === 0 && sections.length === 0 && groups.length === 0 && projectReferences.length === 0 && timelineSections.length === 0 && !orderChanged && !settingsChanged && !lifeMapChanged) return null;
  return {
    label,
    nodes,
    edges,
    sections,
    groups,
    projectReferences,
    timelineSections,
    zOrderBefore: orderChanged ? before.zOrder : null,
    zOrderAfter: orderChanged ? after.zOrder : null,
    settingsBefore: settingsChanged ? before.settings : null,
    settingsAfter: settingsChanged ? after.settings : null,
    lifeMapChanged,
    lifeMapBefore: lifeMapChanged ? before.lifeMap : null,
    lifeMapAfter: lifeMapChanged ? after.lifeMap : null,
    lifeMapMigrationBefore: lifeMapChanged ? before.lifeMapMigration : null,
    lifeMapMigrationAfter: lifeMapChanged ? after.lifeMapMigration : null,
  };
}

function applyEntities<T>(
  current: Record<string, T>,
  changes: EntityChange<T>[],
  direction: 'undo' | 'redo',
) {
  if (changes.length === 0) return current;
  const next = { ...current };
  for (const change of changes) {
    const value = direction === 'undo' ? change.before : change.after;
    if (value) next[change.id] = value;
    else delete next[change.id];
  }
  return next;
}

export function applyHistoryEntry(
  document: MindMapDocument,
  entry: MindMapHistoryEntry,
  direction: 'undo' | 'redo',
): MindMapDocument {
  return {
    ...document,
    nodes: applyEntities(document.nodes, entry.nodes, direction),
    edges: applyEntities(document.edges, entry.edges, direction),
    sections: applyEntities(document.sections, entry.sections, direction),
    groups: applyEntities(document.groups, entry.groups, direction),
    projectReferences: applyEntities(document.projectReferences, entry.projectReferences, direction),
    timelineSections: applyEntities(document.timelineSections, entry.timelineSections, direction),
    zOrder: direction === 'undo'
      ? entry.zOrderBefore ?? document.zOrder
      : entry.zOrderAfter ?? document.zOrder,
    settings: direction === 'undo'
      ? entry.settingsBefore ?? document.settings
      : entry.settingsAfter ?? document.settings,
    lifeMap: entry.lifeMapChanged
      ? (direction === 'undo' ? entry.lifeMapBefore : entry.lifeMapAfter)
      : document.lifeMap,
    lifeMapMigration: entry.lifeMapChanged
      ? (direction === 'undo' ? entry.lifeMapMigrationBefore : entry.lifeMapMigrationAfter)
      : document.lifeMapMigration,
    updatedAt: Date.now(),
  };
}

export function pushHistory(
  history: MindMapHistory,
  entry: MindMapHistoryEntry,
  limit = 100,
): MindMapHistory {
  const undo = [...history.undo, entry];
  if (undo.length > limit) undo.splice(0, undo.length - limit);
  return { undo, redo: [] };
}

import { createDedicatedStorage } from '@/utils/persistence';
import { normalizeMindMapDocument, type MindMapDocument } from './model';

const LEGACY_SNAPSHOT_PREFIX = 'smart-line:mind-map:snapshots:';
const snapshotStorage = createDedicatedStorage('smart-line-mind-map', 'mind_map_snapshots');
const SNAPSHOT_LIMIT = 12;
const AUTO_SNAPSHOT_INTERVAL = 2 * 60_000;
const snapshotCache = new Map<string, MindMapSnapshot[]>();
const snapshotWrites = new Map<string, Promise<unknown>>();

export interface MindMapSnapshot {
  id: string;
  savedAt: number;
  label: string;
  document: MindMapDocument;
}

const snapshotKey = (documentId: string) => `mind-map:snapshots:${documentId}`;
const legacySnapshotKey = (documentId: string) => LEGACY_SNAPSHOT_PREFIX + documentId;

export const trimMindMapSnapshots = (snapshots: MindMapSnapshot[]) => snapshots
  .sort((left, right) => right.savedAt - left.savedAt)
  .slice(0, SNAPSHOT_LIMIT);

const normalizeSnapshots = (value: unknown, documentId: string): MindMapSnapshot[] => {
  if (!Array.isArray(value)) return [];
  return trimMindMapSnapshots(value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const document = normalizeMindMapDocument(record.document);
      return document?.id === documentId && typeof record.id === 'string' && typeof record.savedAt === 'number' && typeof record.label === 'string'
        ? [{ id: record.id, savedAt: record.savedAt, label: record.label, document }]
        : [];
    }));
};

export async function readMindMapSnapshots(documentId: string): Promise<MindMapSnapshot[]> {
  const cached = snapshotCache.get(documentId);
  if (cached) return cached;
  try {
    const stored = normalizeSnapshots(await snapshotStorage.getItem(snapshotKey(documentId)), documentId);
    if (stored.length > 0 || typeof localStorage === 'undefined') {
      snapshotCache.set(documentId, stored);
      return stored;
    }
    const legacyKey = legacySnapshotKey(documentId);
    const legacy = normalizeSnapshots(JSON.parse(localStorage.getItem(legacyKey) ?? '[]'), documentId);
    if (legacy.length > 0) await snapshotStorage.setItem(snapshotKey(documentId), legacy);
    localStorage.removeItem(legacyKey);
    snapshotCache.set(documentId, legacy);
    return legacy;
  } catch {
    return [];
  }
}

export async function saveMindMapSnapshot(
  document: MindMapDocument,
  label: string,
  force = false,
  knownSnapshots?: MindMapSnapshot[],
): Promise<MindMapSnapshot[]> {
  const current = snapshotCache.get(document.id) ?? knownSnapshots ?? await readMindMapSnapshots(document.id);
  const now = Date.now();
  if (!force && current[0] && now - current[0].savedAt < AUTO_SNAPSHOT_INTERVAL) return current;
  const snapshot: MindMapSnapshot = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: now,
    label: label.slice(0, 120),
    document: JSON.parse(JSON.stringify(document)) as MindMapDocument,
  };
  const next = trimMindMapSnapshots([snapshot, ...current]);
  snapshotCache.set(document.id, next);
  try {
    const previousWrite = snapshotWrites.get(document.id) ?? Promise.resolve();
    const write = previousWrite.catch(() => undefined).then(() => snapshotStorage.setItem(snapshotKey(document.id), next));
    snapshotWrites.set(document.id, write);
    await write;
    if (snapshotWrites.get(document.id) === write) snapshotWrites.delete(document.id);
  } catch {
    // Snapshots are an additional safety net; saving the live document must stay reliable.
  }
  return next;
}

export function restoreMindMapSnapshot(snapshot: MindMapSnapshot): MindMapDocument | null {
  return normalizeMindMapDocument(snapshot.document);
}

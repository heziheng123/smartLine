import { normalizeMindMapDocument, type MindMapDocument } from './model';

const SNAPSHOT_PREFIX = 'smart-line:mind-map:snapshots:';
const SNAPSHOT_LIMIT = 12;
const AUTO_SNAPSHOT_INTERVAL = 2 * 60_000;

export interface MindMapSnapshot {
  id: string;
  savedAt: number;
  label: string;
  document: MindMapDocument;
}

const snapshotKey = (documentId: string) => SNAPSHOT_PREFIX + documentId;

export const trimMindMapSnapshots = (snapshots: MindMapSnapshot[]) => snapshots
  .sort((left, right) => right.savedAt - left.savedAt)
  .slice(0, SNAPSHOT_LIMIT);

export function readMindMapSnapshots(documentId: string): MindMapSnapshot[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const value = JSON.parse(localStorage.getItem(snapshotKey(documentId)) ?? '[]');
    if (!Array.isArray(value)) return [];
    return trimMindMapSnapshots(value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const record = item as Record<string, unknown>;
      const document = normalizeMindMapDocument(record.document);
      return document?.id === documentId && typeof record.id === 'string' && typeof record.savedAt === 'number' && typeof record.label === 'string'
        ? [{ id: record.id, savedAt: record.savedAt, label: record.label, document }]
        : [];
    }));
  } catch {
    return [];
  }
}

export function saveMindMapSnapshot(document: MindMapDocument, label: string, force = false): MindMapSnapshot[] {
  const current = readMindMapSnapshots(document.id);
  const now = Date.now();
  if (!force && current[0] && now - current[0].savedAt < AUTO_SNAPSHOT_INTERVAL) return current;
  const snapshot: MindMapSnapshot = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: now,
    label: label.slice(0, 120),
    document: JSON.parse(JSON.stringify(document)) as MindMapDocument,
  };
  const next = trimMindMapSnapshots([snapshot, ...current]);
  if (typeof localStorage === 'undefined') return next;
  try {
    localStorage.setItem(snapshotKey(document.id), JSON.stringify(next));
  } catch {
    // Snapshots are an additional safety net; saving the live document must stay reliable.
  }
  return next;
}

export function restoreMindMapSnapshot(snapshot: MindMapSnapshot): MindMapDocument | null {
  return normalizeMindMapDocument(snapshot.document);
}

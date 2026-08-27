import {
  LiveFile,
  type JsonObject,
  type LiveObject,
  type Room,
  type Status,
  type StorageStatus,
} from '@liveblocks/client';
import { liveblocksClient } from '@/store/client';
import { syncMindMapImageAssets } from './assetSync';
import {
  MIND_MAP_SCHEMA_VERSION,
  normalizeMindMapDocument,
  type MindMapDocument,
  type MindMapDocumentSummary,
} from './model';
import { mindMapRepository } from './repository';
import {
  applyMindMapSyncPatch,
  buildMindMapCatalogRoomId,
  buildMindMapRoomId,
  createMindMapSyncPatch,
  emptyMindMapSyncBase,
  isMindMapSyncPatchEmpty,
  mergeMindMapCatalogEntries,
  mergeMindMapDocuments,
  mindMapCatalogEntries,
  mindMapSyncSignature,
  type MindMapCatalogEntry,
  type MindMapPresence,
  type MindMapRemotePresence,
  type MindMapSyncState,
  type MindMapSyncStatus,
} from './syncCore';

type MindMapRoomStorage = Record<string, number | string | string[] | JsonObject | LiveFile | null>;
type MindMapCatalogRoomStorage = Record<string, number | JsonObject>;

type MindMapRoom = Room<MindMapPresence, MindMapRoomStorage>;
type MindMapCatalogRoom = Room<MindMapPresence, MindMapCatalogRoomStorage>;

export interface MindMapSyncViewState {
  status: MindMapSyncStatus;
  roomId: string | null;
  error: string | null;
  others: MindMapRemotePresence[];
}

interface MindMapSyncSessionOptions {
  identity: string;
  name: string;
  document: MindMapDocument;
  onDocument: (document: MindMapDocument) => void;
  onState: (state: MindMapSyncViewState) => void;
}

interface MindMapCatalogSessionOptions {
  identity: string;
  name: string;
  documents: MindMapDocumentSummary[];
  onEntries: (entries: MindMapCatalogEntry[]) => void;
  onError: (message: string) => void;
}

const PALETTE = ['#5e5ce6', '#007aff', '#34c759', '#ff9500', '#ff2d55', '#af52de'];
const ENTITY_PREFIX = { nodes: 'node:', edges: 'edge:', sections: 'section:', groups: 'group:', projectReferences: 'project-reference:', timelineSections: 'timeline-section:' } as const;
const IMAGE_EXTENSION: Record<string, string> = {
  'image/gif': 'gif',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

const colorFor = (value: string) => PALETTE[[...value].reduce((hash, character) => hash + character.charCodeAt(0), 0) % PALETTE.length];
const jsonObject = (value: object): JsonObject => JSON.parse(JSON.stringify(value)) as JsonObject;

function entityKey(prefix: string, id: string): string {
  let hash = 14695981039346656037n;
  for (const byte of new TextEncoder().encode(id)) hash = BigInt.asUintN(64, (hash ^ BigInt(byte)) * 1099511628211n);
  return prefix + hash.toString(16).padStart(16, '0');
}

function storageEntities(storage: MindMapRoomStorage, prefix: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(storage).flatMap(([key, value]) => {
    if (!key.startsWith(prefix) || !value || typeof value !== 'object' || Array.isArray(value)) return [];
    const id = (value as Record<string, unknown>).id;
    return typeof id === 'string' ? [[id, value]] : [];
  }));
}

function initialStorage(document: MindMapDocument): MindMapRoomStorage {
  const storage: MindMapRoomStorage = {
    schemaVersion: MIND_MAP_SCHEMA_VERSION,
    documentId: document.id,
    title: document.title,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
    settings: jsonObject(document.settings),
    zOrder: [...document.zOrder],
    lifeMap: document.lifeMap ? jsonObject(document.lifeMap) : null,
    lifeMapMigration: document.lifeMapMigration ? jsonObject(document.lifeMapMigration) : null,
  };
  for (const [collection, prefix] of Object.entries(ENTITY_PREFIX)) {
    const entities = document[collection as keyof typeof ENTITY_PREFIX] as Record<string, object>;
    for (const [id, value] of Object.entries(entities)) storage[entityKey(prefix, id)] = jsonObject(value);
  }
  return storage;
}

function documentFromRoot(root: LiveObject<MindMapRoomStorage>, local: MindMapDocument): MindMapDocument {
  const value = root.toJSON() as unknown as Record<string, unknown>;
  const normalized = normalizeMindMapDocument({
    kind: 'smart-line-mind-map',
    schemaVersion: value.schemaVersion,
    id: value.documentId,
    title: value.title,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    settings: value.settings,
    zOrder: value.zOrder,
    lifeMap: value.lifeMap,
    lifeMapMigration: value.lifeMapMigration,
    nodes: storageEntities(value as MindMapRoomStorage, ENTITY_PREFIX.nodes),
    edges: storageEntities(value as MindMapRoomStorage, ENTITY_PREFIX.edges),
    sections: storageEntities(value as MindMapRoomStorage, ENTITY_PREFIX.sections),
    groups: storageEntities(value as MindMapRoomStorage, ENTITY_PREFIX.groups),
    projectReferences: storageEntities(value as MindMapRoomStorage, ENTITY_PREFIX.projectReferences),
    timelineSections: storageEntities(value as MindMapRoomStorage, ENTITY_PREFIX.timelineSections),
    viewport: local.viewport,
  });
  if (!normalized || normalized.id !== local.id) throw new Error('云端房间不属于当前思维导图。');
  return normalized;
}

function applyEntityChanges(
  root: LiveObject<MindMapRoomStorage>,
  prefix: string,
  change: { upserts: Record<string, object>; deletes: string[] },
) {
  for (const id of change.deletes) root.delete(entityKey(prefix, id));
  for (const [id, value] of Object.entries(change.upserts)) root.set(entityKey(prefix, id), jsonObject(value));
}

function normalizeCatalogEntry(value: unknown): MindMapCatalogEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = value as Partial<MindMapCatalogEntry>;
  if (typeof entry.id !== 'string' || !entry.id.trim() || entry.id.length > 160
    || typeof entry.title !== 'string'
    || !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.updatedAt)
    || !Number.isInteger(entry.nodeCount) || !Number.isInteger(entry.edgeCount)
    || (entry.deletedAt !== null && entry.deletedAt !== undefined && !Number.isFinite(entry.deletedAt))) return null;
  return {
    id: entry.id,
    title: entry.title.slice(0, 120),
    createdAt: Math.max(0, Number(entry.createdAt)),
    updatedAt: Math.max(0, Number(entry.updatedAt)),
    nodeCount: Math.max(0, Number(entry.nodeCount)),
    edgeCount: Math.max(0, Number(entry.edgeCount)),
    deletedAt: entry.deletedAt == null ? null : Math.max(0, Number(entry.deletedAt)),
  };
}

function catalogEntriesFromStorage(storage: MindMapCatalogRoomStorage): Record<string, MindMapCatalogEntry> {
  const entries: Record<string, MindMapCatalogEntry> = {};
  for (const value of Object.values(storage)) {
    const entry = normalizeCatalogEntry(value);
    if (entry) entries[entry.id] = entry;
  }
  return entries;
}

function catalogStorage(documents: MindMapDocumentSummary[]): MindMapCatalogRoomStorage {
  const storage: MindMapCatalogRoomStorage = { schemaVersion: 1 };
  for (const entry of Object.values(mindMapCatalogEntries(documents))) {
    storage[entityKey('document:', entry.id)] = jsonObject(entry);
  }
  return storage;
}

export class MindMapCatalogSession {
  private readonly options: MindMapCatalogSessionOptions;
  private readonly roomId: string;
  private local: Record<string, MindMapCatalogEntry>;
  private remote: Record<string, MindMapCatalogEntry> = {};
  private room: MindMapCatalogRoom | null = null;
  private root: LiveObject<MindMapCatalogRoomStorage> | null = null;
  private leave: (() => void) | null = null;
  private unsubscribers: Array<() => void> = [];
  private closed = false;
  private reconcileChain: Promise<void> = Promise.resolve();

  constructor(options: MindMapCatalogSessionOptions) {
    this.options = options;
    this.roomId = buildMindMapCatalogRoomId(options.identity);
    this.local = mindMapCatalogEntries(options.documents);
  }

  async start() {
    try {
      const entered = liveblocksClient.enterRoom<MindMapPresence, MindMapCatalogRoomStorage>(this.roomId, {
        initialPresence: {
          color: colorFor(this.options.identity),
          cursor: null,
          draggingId: null,
          editingId: null,
          name: this.options.name.slice(0, 80),
        },
        initialStorage: catalogStorage(this.options.documents),
      });
      this.room = entered.room;
      this.leave = entered.leave;
      this.unsubscribers.push(this.room.subscribe('error', (error) => {
        if (!this.closed) this.options.onError(error.message || '思维导图云端目录同步失败。');
      }));
      const { root } = await this.room.getStorage();
      if (this.closed) return;
      this.root = root;
      await this.reconcile();
      this.unsubscribers.push(this.room.subscribe(root, () => this.queueReconcile(), { isDeep: true }));
    } catch (error) {
      if (!this.closed) this.options.onError(error instanceof Error ? error.message : '无法连接思维导图云端目录。');
    }
  }

  publish(documents: MindMapDocumentSummary[]) {
    const merged = mergeMindMapCatalogEntries(this.local, mindMapCatalogEntries(documents));
    this.local = merged;
    this.writeEntries(merged, this.remote);
    this.remote = merged;
  }

  deleteDocument(id: string) {
    const current = this.local[id];
    if (!current) return;
    const deletedAt = Date.now();
    const tombstone = { ...current, updatedAt: deletedAt, deletedAt };
    this.local = { ...this.local, [id]: tombstone };
    this.writeEntries({ [id]: tombstone }, this.remote);
    this.remote = { ...this.remote, [id]: tombstone };
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.leave?.();
    this.leave = null;
    this.room = null;
    this.root = null;
  }

  private queueReconcile() {
    this.reconcileChain = this.reconcileChain.then(() => this.reconcile()).catch((error) => {
      if (!this.closed) this.options.onError(error instanceof Error ? error.message : '思维导图云端目录合并失败。');
    });
  }

  private async reconcile() {
    if (this.closed || !this.root) return;
    const remote = catalogEntriesFromStorage(this.root.toJSON() as MindMapCatalogRoomStorage);
    const merged = mergeMindMapCatalogEntries(this.local, remote);
    this.local = merged;
    this.writeEntries(merged, remote);
    this.remote = merged;
    this.options.onEntries(Object.values(merged));
  }

  private writeEntries(
    entries: Record<string, MindMapCatalogEntry>,
    remote: Record<string, MindMapCatalogEntry> = {},
  ) {
    if (!this.root || !this.room) return;
    const changed = Object.values(entries).filter((entry) => (
      JSON.stringify(entry) !== JSON.stringify(remote[entry.id])
    ));
    if (changed.length === 0) return;
    this.room.batch(() => {
      for (const entry of changed) this.root?.set(entityKey('document:', entry.id), jsonObject(entry));
    });
  }
}

export class MindMapSyncSession {
  private readonly options: MindMapSyncSessionOptions;
  private readonly roomId: string;
  private local: MindMapDocument;
  private base: MindMapDocument;
  private room: MindMapRoom | null = null;
  private root: LiveObject<MindMapRoomStorage> | null = null;
  private leave: (() => void) | null = null;
  private unsubscribers: Array<() => void> = [];
  private closed = false;
  private reconcileChain: Promise<void> = Promise.resolve();
  private viewState: MindMapSyncViewState;

  constructor(options: MindMapSyncSessionOptions) {
    this.options = options;
    this.local = options.document;
    this.base = emptyMindMapSyncBase(options.document);
    this.roomId = buildMindMapRoomId(options.identity, options.document.id);
    this.viewState = { status: 'connecting', roomId: this.roomId, error: null, others: [] };
  }

  private emit(patch: Partial<MindMapSyncViewState>) {
    this.viewState = { ...this.viewState, ...patch };
    this.options.onState(this.viewState);
  }

  async start() {
    this.emit({ status: 'connecting', error: null });
    try {
      const saved = await mindMapRepository.loadSyncState(this.local.id);
      if (this.closed) return;
      if (saved) {
        this.base = saved.base;
        if (saved.pending) {
          const queued = applyMindMapSyncPatch(saved.base, saved.pending);
          this.local = mergeMindMapDocuments(saved.base, this.local, queued);
        }
      }
      const entered = liveblocksClient.enterRoom<MindMapPresence, MindMapRoomStorage>(this.roomId, {
        initialPresence: {
          color: colorFor(this.options.identity),
          cursor: null,
          draggingId: null,
          editingId: null,
          name: this.options.name.slice(0, 80),
        },
        initialStorage: initialStorage(this.local),
      });
      this.room = entered.room;
      this.leave = entered.leave;
      this.unsubscribers.push(
        this.room.subscribe('status', (status) => this.handleStatus(status)),
        this.room.subscribe('storage-status', (status) => this.handleStorageStatus(status)),
        this.room.subscribe('others', (others) => this.emit({
          others: others.map((user) => ({ connectionId: user.connectionId, ...user.presence })),
        })),
        this.room.subscribe('error', (error) => this.emit({ status: 'error', error: error.message || '思维导图云同步失败。' })),
      );
      const { root } = await this.room.getStorage();
      if (this.closed) return;
      this.root = root;
      await this.reconcileFromRoom();
      this.unsubscribers.push(this.room.subscribe(root, () => this.queueReconcile(), { isDeep: true }));
      this.handleStatus(this.room.getStatus());
    } catch (error) {
      if (!this.closed) this.emit({
        status: 'error',
        error: error instanceof Error ? error.message : '无法连接思维导图云端房间。',
      });
    }
  }

  publish(document: MindMapDocument) {
    if (this.closed || document.id !== this.local.id) return;
    if (mindMapSyncSignature(document) === mindMapSyncSignature(this.local)) return;
    this.local = document;
    const pending = createMindMapSyncPatch(this.base, document);
    if (isMindMapSyncPatchEmpty(pending)) return;
    void this.persist({ version: 1, base: this.base, pending });
    if (this.root && this.room) {
      try {
        this.writePatch(pending);
      } catch (error) {
        this.emit({ status: 'error', error: error instanceof Error ? error.message : '思维导图云同步写入失败。' });
      }
    }
  }

  updatePresence(patch: Partial<Pick<MindMapPresence, 'cursor' | 'draggingId' | 'editingId'>>) {
    this.room?.updatePresence(patch);
  }

  async syncImageAssets(document: MindMapDocument) {
    const room = this.room;
    const root = this.root;
    if (!room || !root) throw new Error('思维导图云端房间尚未连接。');
    // Publish the node reference before the LiveFile key changes Storage; this
    // keeps an asset-only subscription update from reconciling an older graph.
    this.publish(document);
    return syncMindMapImageAssets(document, {
      cacheKey: this.roomId,
      upload: async (assetId, blob) => {
        const key = entityKey('asset:', assetId);
        if (root.get(key) instanceof LiveFile) return;
        const extension = IMAGE_EXTENSION[blob.type] ?? 'bin';
        const uploaded = await room.uploadFile(
          new File([blob], `${assetId}.${extension}`, { type: blob.type }),
          { signal: AbortSignal.timeout(30_000) },
        );
        room.batch(() => root.set(key, uploaded));
      },
      download: async (assetId) => {
        const file = root.get(entityKey('asset:', assetId));
        if (!(file instanceof LiveFile)) return null;
        const response = await fetch(
          `/api/mind-map-files/${encodeURIComponent(document.id)}/${encodeURIComponent(file.id)}`,
          {
            credentials: 'same-origin',
            cache: 'no-store',
            signal: AbortSignal.timeout(30_000),
          },
        );
        if (!response.ok) throw new Error(`图片“${assetId.slice(0, 8)}”下载失败（${response.status}）。`);
        return response.blob();
      },
    });
  }

  async flush(timeoutMs = 10_000) {
    const room = this.room;
    if (!room || room.getStorageStatus() === 'synchronized') return;
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        unsubscribe();
        reject(new Error('思维导图云同步等待超时。'));
      }, timeoutMs);
      const unsubscribe = room.subscribe('storage-status', (status) => {
        if (status !== 'synchronized') return;
        window.clearTimeout(timer);
        unsubscribe();
        resolve();
      });
    });
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.leave?.();
    this.leave = null;
    this.room = null;
    this.root = null;
  }

  private handleStatus(status: Status) {
    if (status === 'connected') {
      this.emit({ status: this.room?.getStorageStatus() === 'synchronizing' ? 'connecting' : 'connected', error: null });
    } else if (status === 'reconnecting' || status === 'disconnected') {
      this.emit({ status: 'offline' });
    } else {
      this.emit({ status: 'connecting' });
    }
  }

  private handleStorageStatus(status: StorageStatus) {
    if (status === 'synchronizing') this.emit({ status: 'connecting' });
    if (status === 'synchronized') {
      this.emit({ status: this.room?.getStatus() === 'connected' ? 'connected' : 'offline', error: null });
      this.queueReconcile();
    }
  }

  private queueReconcile() {
    this.reconcileChain = this.reconcileChain.then(() => this.reconcileFromRoom()).catch((error) => {
      if (!this.closed) this.emit({
        status: 'error',
        error: error instanceof Error ? error.message : '思维导图云端数据合并失败。',
      });
    });
  }

  private async persist(state: MindMapSyncState) {
    try {
      await mindMapRepository.saveSyncState(this.local.id, state);
    } catch (error) {
      if (!this.closed) this.emit({
        status: 'error',
        error: error instanceof Error ? error.message : '思维导图离线同步队列保存失败。',
      });
    }
  }

  private async reconcileFromRoom() {
    if (this.closed || !this.root || !this.room) return;
    const remote = documentFromRoot(this.root, this.local);
    const merged = mergeMindMapDocuments(this.base, this.local, remote);
    if (mindMapSyncSignature(merged) !== mindMapSyncSignature(this.local)) {
      this.local = merged;
      this.options.onDocument(merged);
    }
    const pending = createMindMapSyncPatch(remote, merged);
    if (!isMindMapSyncPatchEmpty(pending)) {
      this.base = remote;
      await mindMapRepository.saveSyncState(merged.id, { version: 1, base: remote, pending });
      this.writePatch(pending);
      return;
    }
    if (this.room.getStorageStatus() === 'synchronized') {
      this.base = merged;
      const state: MindMapSyncState = { version: 1, base: merged, pending: null };
      await mindMapRepository.saveSyncState(merged.id, state);
    }
  }

  private writePatch(patch: ReturnType<typeof createMindMapSyncPatch>) {
    if (!this.root || !this.room || isMindMapSyncPatchEmpty(patch)) return;
    this.room.batch(() => {
      if (patch.title !== undefined) this.root?.set('title', patch.title);
      if (patch.settings !== undefined) this.root?.set('settings', jsonObject(patch.settings));
      if (patch.zOrder !== undefined) this.root?.set('zOrder', [...patch.zOrder]);
      if (patch.lifeMap !== undefined) this.root?.set('lifeMap', patch.lifeMap ? jsonObject(patch.lifeMap) : null);
      if (patch.lifeMapMigration !== undefined) this.root?.set('lifeMapMigration', patch.lifeMapMigration ? jsonObject(patch.lifeMapMigration) : null);
      this.root?.set('updatedAt', patch.updatedAt);
      if (this.root) {
        applyEntityChanges(this.root, ENTITY_PREFIX.nodes, patch.nodes);
        applyEntityChanges(this.root, ENTITY_PREFIX.edges, patch.edges);
        applyEntityChanges(this.root, ENTITY_PREFIX.sections, patch.sections);
        applyEntityChanges(this.root, ENTITY_PREFIX.groups, patch.groups);
        applyEntityChanges(this.root, ENTITY_PREFIX.projectReferences, patch.projectReferences);
        applyEntityChanges(this.root, ENTITY_PREFIX.timelineSections, patch.timelineSections);
      }
    });
  }
}

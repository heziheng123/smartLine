import { createDedicatedStorage } from '@/utils/persistence';
import {
  normalizeMindMapDocument,
  normalizeMindMapIndex,
  type MindMapDocument,
  type MindMapIndex,
} from './model';
import type { MindMapSyncState } from './syncCore';

const DATABASE_NAME = 'smart-line-mind-map';
const STORE_NAME = 'mind_map';
const ASSET_STORE_NAME = 'mind_map_assets';
const INDEX_KEY = 'mind-map:index';
const DOCUMENT_PREFIX = 'mind-map:document:';
const SYNC_PREFIX = 'mind-map:sync:';
const EMERGENCY_PREFIX = 'mind-map:emergency:';
const ASSET_PREFIX = 'mind-map:asset:';

export interface MindMapImageAsset {
  id: string;
  blob: Blob;
  mimeType: string;
  size: number;
  refCount: number;
  references: Record<string, number>;
  createdAt: number;
}

type Storage = ReturnType<typeof createDedicatedStorage>;
type SaveCallbacks = {
  onSaved?: () => void;
  onError?: (error: unknown) => void;
};
type PendingSave = SaveCallbacks & {
  document: MindMapDocument;
  index: MindMapIndex;
};

const documentKey = (id: string) => DOCUMENT_PREFIX + id;
const syncKey = (id: string) => SYNC_PREFIX + id;
const emergencyKey = (id: string) => EMERGENCY_PREFIX + id;

export class MindMapRepository {
  private storage: Storage | null = null;
  private assetStorage: Storage | null = null;
  private pending: PendingSave | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();

  private getStorage() {
    this.storage ??= createDedicatedStorage(DATABASE_NAME, STORE_NAME);
    return this.storage;
  }

  private getAssetStorage() {
    this.assetStorage ??= createDedicatedStorage(DATABASE_NAME, ASSET_STORE_NAME);
    return this.assetStorage;
  }

  private async syncDocumentAssetReferences(document: MindMapDocument) {
    const counts = new Map<string, number>();
    for (const node of Object.values(document.nodes)) {
      if (node.imageAssetId) counts.set(node.imageAssetId, (counts.get(node.imageAssetId) ?? 0) + 1);
    }
    const storage = this.getAssetStorage();
    const keys = (await storage.keys()).filter((key) => key.startsWith(ASSET_PREFIX));
    await Promise.all(keys.map(async (key) => {
      const asset = await storage.getItem<MindMapImageAsset>(key);
      if (!asset?.id || !(asset.blob instanceof Blob)) return;
      const references = { ...(asset.references ?? {}) };
      const count = counts.get(asset.id) ?? 0;
      if (count > 0) references[document.id] = count;
      else delete references[document.id];
      const refCount = Object.values(references).reduce((sum, value) => sum + Math.max(0, value), 0);
      if (refCount === 0) await storage.removeItem(key);
      else await storage.setItem(key, { ...asset, references, refCount });
    }));
  }

  private async migrateInlineImages(document: MindMapDocument) {
    let nodes = document.nodes;
    for (const node of Object.values(document.nodes)) {
      if (node.imageAssetId || !node.imageSrc?.startsWith('data:image/')) continue;
      try {
        const blob = await (await fetch(node.imageSrc)).blob();
        const asset = await this.saveImageAsset(blob);
        if (nodes === document.nodes) nodes = { ...document.nodes };
        nodes[node.id] = { ...node, imageAssetId: asset.id, imageSrc: null, updatedAt: Date.now() };
      } catch {
        // Keep the legacy inline image if this browser cannot migrate it.
      }
    }
    if (nodes === document.nodes) return document;
    const migrated = { ...document, nodes, updatedAt: Date.now() };
    await this.getStorage().setItem(documentKey(migrated.id), migrated);
    await this.syncDocumentAssetReferences(migrated);
    return migrated;
  }

  private enqueue(operation: () => Promise<void>) {
    const current = this.writeChain.then(operation);
    this.writeChain = current.catch(() => undefined);
    return current;
  }

  async loadIndex(): Promise<MindMapIndex | null> {
    const raw = await this.getStorage().getItem<unknown>(INDEX_KEY);
    return normalizeMindMapIndex(raw);
  }

  async loadDocument(id: string): Promise<MindMapDocument | null> {
    try {
      const emergency = localStorage.getItem(emergencyKey(id));
      if (emergency) {
        const recovered = normalizeMindMapDocument(JSON.parse(emergency));
        if (recovered?.id === id) return this.migrateInlineImages(recovered);
      }
    } catch {
      // IndexedDB remains the source of truth if the emergency journal is invalid.
    }
    const raw = await this.getStorage().getItem<unknown>(documentKey(id));
    const document = normalizeMindMapDocument(raw);
    return document?.id === id ? this.migrateInlineImages(document) : null;
  }

  schedule(document: MindMapDocument, index: MindMapIndex, callbacks: SaveCallbacks = {}) {
    this.pending = { document, index, ...callbacks };
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, 350);
  }

  async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const pending = this.pending;
    this.pending = null;
    if (!pending) return this.writeChain;
    const save = this.enqueue(async () => {
      try {
        await this.getStorage().setItem(documentKey(pending.document.id), pending.document);
        await this.getStorage().setItem(INDEX_KEY, pending.index);
        await this.syncDocumentAssetReferences(pending.document);
        localStorage.removeItem(emergencyKey(pending.document.id));
        pending.onSaved?.();
      } catch (error) {
        pending.onError?.(error);
        throw error;
      }
    });
    return save;
  }

  async saveNow(document: MindMapDocument, index: MindMapIndex) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.pending = null;
    return this.enqueue(async () => {
      await this.getStorage().setItem(documentKey(document.id), document);
      await this.getStorage().setItem(INDEX_KEY, index);
      await this.syncDocumentAssetReferences(document);
      localStorage.removeItem(emergencyKey(document.id));
    });
  }

  async saveSyncedDocument(document: MindMapDocument, index: MindMapIndex) {
    return this.enqueue(async () => {
      await this.getStorage().setItem(documentKey(document.id), document);
      await this.getStorage().setItem(INDEX_KEY, index);
      await this.syncDocumentAssetReferences(document);
    });
  }

  async deleteDocument(id: string) {
    localStorage.removeItem(emergencyKey(id));
    await this.enqueue(async () => {
      await Promise.all([
        this.getStorage().removeItem(documentKey(id)),
        this.getStorage().removeItem(syncKey(id)),
      ]);
      const storage = this.getAssetStorage();
      const keys = (await storage.keys()).filter((key) => key.startsWith(ASSET_PREFIX));
      await Promise.all(keys.map(async (key) => {
        const asset = await storage.getItem<MindMapImageAsset>(key);
        if (!asset?.references?.[id]) return;
        const references = { ...asset.references };
        delete references[id];
        const refCount = Object.values(references).reduce((sum, value) => sum + Math.max(0, value), 0);
        if (refCount === 0) await storage.removeItem(key);
        else await storage.setItem(key, { ...asset, references, refCount });
      }));
    });
  }

  async saveImageAsset(
    blob: Blob,
    id: string = crypto.randomUUID(),
    references: Record<string, number> = {},
  ): Promise<MindMapImageAsset> {
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(blob.type) || blob.size > 2 * 1024 * 1024) {
      throw new Error('仅支持 PNG、JPEG、GIF、WebP，单张图片不能超过 2 MiB。');
    }
    const asset: MindMapImageAsset = {
      id,
      blob,
      mimeType: blob.type,
      size: blob.size,
      refCount: Object.values(references).reduce((sum, value) => sum + Math.max(0, value), 0),
      references,
      createdAt: Date.now(),
    };
    await this.getAssetStorage().setItem(ASSET_PREFIX + asset.id, asset);
    return asset;
  }

  async loadImageAsset(id: string): Promise<MindMapImageAsset | null> {
    const asset = await this.getAssetStorage().getItem<MindMapImageAsset>(ASSET_PREFIX + id);
    return asset?.id === id && asset.blob instanceof Blob ? asset : null;
  }

  async loadSyncState(id: string): Promise<MindMapSyncState | null> {
    const state = await this.getStorage().getItem<MindMapSyncState>(syncKey(id));
    if (state?.version !== 1
      || state.base?.id !== id
      || (state.pending && (state.pending.version !== 1 || state.pending.documentId !== id))) return null;
    const base = normalizeMindMapDocument(state.base);
    return base ? { version: 1, base, pending: state.pending } : null;
  }

  async saveSyncState(id: string, state: MindMapSyncState) {
    if (state.base.id !== id || (state.pending && state.pending.documentId !== id)) {
      throw new Error('拒绝保存不属于当前思维导图的同步状态。');
    }
    await this.getStorage().setItem(syncKey(id), state);
  }

  saveEmergency(document: MindMapDocument) {
    try {
      localStorage.setItem(emergencyKey(document.id), JSON.stringify(document));
    } catch {
      // The in-memory document remains available until the page is closed.
    }
  }
}

export const mindMapRepository = new MindMapRepository();

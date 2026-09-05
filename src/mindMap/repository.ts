import { createDedicatedStorage } from '@/utils/persistence';
import {
  MIND_MAP_SCHEMA_VERSION,
  MindMapVersionError,
  normalizeMindMapDocument,
  normalizeMindMapIndex,
  summarizeMindMapDocument,
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

export interface MindMapBackupBundle {
  version: 1;
  index: MindMapIndex;
  documents: MindMapDocument[];
  assets?: Array<{ id: string; mimeType: string; dataUrl: string }>;
}

const BACKUP_IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=]+$/i;

function blobDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('地图图片读取失败。'));
    reader.readAsDataURL(blob);
  });
}

export function parseMindMapBackupBundle(value: unknown): { bundle?: MindMapBackupBundle; error?: string } {
  if (value == null) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { error: '地图备份格式无效。' };
  }
  try {
    const record = value as Record<string, unknown>;
    if (record.version !== 1 && record.version !== undefined) {
      return { error: '不支持的地图备份版本。' };
    }
    if (!Array.isArray(record.documents)) return { error: '地图备份缺少文档列表。' };
    const documents: MindMapDocument[] = [];
    const seen = new Set<string>();
    for (const item of record.documents) {
      const document = normalizeMindMapDocument(item);
      if (!document) return { error: '地图备份包含无法读取的文档。' };
      if (seen.has(document.id)) return { error: '地图备份包含重复文档。' };
      seen.add(document.id);
      documents.push(document);
    }
    const assets = record.assets === undefined ? undefined : Array.isArray(record.assets)
      ? record.assets.flatMap((item) => {
        if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
        const asset = item as Record<string, unknown>;
        return typeof asset.id === 'string' && asset.id
          && typeof asset.mimeType === 'string'
          && typeof asset.dataUrl === 'string'
          && asset.dataUrl.length <= 3_000_000
          && BACKUP_IMAGE_DATA_URL.test(asset.dataUrl)
          ? [{ id: asset.id, mimeType: asset.mimeType, dataUrl: asset.dataUrl }]
          : [];
      })
      : null;
    if (record.assets !== undefined && (!assets || assets.length !== (record.assets as unknown[]).length)) {
      return { error: '地图备份包含无效图片资源。' };
    }
    if (assets && new Set(assets.map((asset) => asset.id)).size !== assets.length) {
      return { error: '地图备份包含重复图片资源。' };
    }
    if (assets) {
      const assetIds = new Set(assets.map((asset) => asset.id));
      const missingAsset = documents.some((document) => Object.values(document.nodes)
        .some((node) => node.imageAssetId && !assetIds.has(node.imageAssetId)));
      if (missingAsset) return { error: '地图备份缺少节点引用的图片资源。' };
    }
    const index = normalizeMindMapIndex(record.index) ?? {
      schemaVersion: MIND_MAP_SCHEMA_VERSION,
      activeDocumentId: documents[0]?.id ?? null,
      documents: documents.map(summarizeMindMapDocument),
    };
    return { bundle: { version: 1, index, documents, ...(assets ? { assets } : {}) } };
  } catch (error) {
    return { error: error instanceof MindMapVersionError ? error.message : '地图备份无法读取。' };
  }
}

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

  async saveViewport(documentId: string, viewport: MindMapDocument['viewport']) {
    return this.enqueue(async () => {
      const raw = await this.getStorage().getItem<unknown>(documentKey(documentId));
      const document = normalizeMindMapDocument(raw);
      if (!document || document.id !== documentId) return;
      await this.getStorage().setItem(documentKey(documentId), { ...document, viewport });
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

  async exportBundle(): Promise<MindMapBackupBundle> {
    await this.flush();
    const loaded = await this.loadIndex();
    const index = loaded ?? {
      schemaVersion: MIND_MAP_SCHEMA_VERSION,
      activeDocumentId: null,
      documents: [],
    };
    const documents: MindMapDocument[] = [];
    for (const summary of index.documents) {
      const document = await this.loadDocument(summary.id);
      if (document) documents.push(document);
    }
    const assetIds = new Set(documents.flatMap((document) => Object.values(document.nodes)
      .map((node) => node.imageAssetId)
      .filter((id): id is string => Boolean(id))));
    const assets = (await Promise.all([...assetIds].map(async (id) => {
      const asset = await this.loadImageAsset(id);
      return asset ? { id, mimeType: asset.mimeType, dataUrl: await blobDataUrl(asset.blob) } : null;
    }))).filter((asset): asset is NonNullable<typeof asset> => Boolean(asset));
    if (assets.length !== assetIds.size) throw new Error('地图文档引用的本机图片不完整，已停止生成备份。');
    return {
      version: 1,
      index: {
        ...index,
        documents: documents.map(summarizeMindMapDocument),
        activeDocumentId: documents.some((item) => item.id === index.activeDocumentId)
          ? index.activeDocumentId
          : documents[0]?.id ?? null,
      },
      documents,
      assets,
    };
  }

  async replaceFromBundle(bundle: MindMapBackupBundle) {
    await this.flush();
    const existing = await this.loadIndex();
    if (existing) {
      for (const summary of existing.documents) await this.deleteDocument(summary.id);
    }
    const references = new Map<string, Record<string, number>>();
    for (const document of bundle.documents) {
      for (const node of Object.values(document.nodes)) {
        if (!node.imageAssetId) continue;
        const byDocument = references.get(node.imageAssetId) ?? {};
        byDocument[document.id] = (byDocument[document.id] ?? 0) + 1;
        references.set(node.imageAssetId, byDocument);
      }
    }
    for (const asset of bundle.assets ?? []) {
      const blob = await (await fetch(asset.dataUrl)).blob();
      await this.saveImageAsset(blob, asset.id, references.get(asset.id));
    }
    let index: MindMapIndex = {
      schemaVersion: MIND_MAP_SCHEMA_VERSION,
      activeDocumentId: bundle.index.activeDocumentId,
      documents: [],
    };
    for (const document of bundle.documents) {
      index = {
        schemaVersion: MIND_MAP_SCHEMA_VERSION,
        activeDocumentId: index.activeDocumentId ?? document.id,
        documents: [...index.documents, summarizeMindMapDocument(document)],
      };
      await this.saveNow(document, index);
    }
    if (bundle.documents.length === 0) {
      await this.getStorage().setItem(INDEX_KEY, {
        schemaVersion: MIND_MAP_SCHEMA_VERSION,
        activeDocumentId: null,
        documents: [],
      } satisfies MindMapIndex);
    }
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

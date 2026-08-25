import { create } from 'zustand';
import {
  MIND_MAP_SCHEMA_VERSION,
  createEmptyMindMapDocument,
  createMindMapEdge,
  createTextMindMapNode,
  duplicateMindMapDocument,
  maintainMindMapContainers,
  normalizeMindMapDocument,
  summarizeMindMapDocument,
  type MindMapDocument,
  type MindMapEdge,
  type MindMapIndex,
  type MindMapNode,
  type MindMapSaveStatus,
  type ViewportState,
} from './model';
import {
  applyHistoryEntry,
  createHistoryEntry,
  emptyMindMapHistory,
  pushHistory,
  type MindMapHistory,
} from './commands';
import { mindMapRepository } from './repository';
import type { MindMapCatalogEntry } from './syncCore';

interface MindMapStore {
  isHydrated: boolean;
  index: MindMapIndex;
  document: MindMapDocument | null;
  history: MindMapHistory;
  saveStatus: MindMapSaveStatus;
  error: string | null;
  hydrate: () => Promise<void>;
  createDocument: () => Promise<void>;
  renameDocument: (title: string) => void;
  duplicateDocument: (sourceId?: string) => Promise<void>;
  switchDocument: (id: string) => Promise<void>;
  deleteCurrentDocument: () => Promise<boolean>;
  deleteDocument: (id: string) => Promise<boolean>;
  importDocument: (value: unknown) => Promise<boolean>;
  applyRemoteDocument: (document: MindMapDocument) => void;
  cacheRemoteDocument: (document: MindMapDocument) => Promise<void>;
  applyRemoteCatalog: (entries: MindMapCatalogEntry[]) => Promise<void>;
  execute: (label: string, transform: (document: MindMapDocument) => MindMapDocument) => void;
  undo: () => void;
  redo: () => void;
  createNode: (position: { x: number; y: number }, text?: string) => string | null;
  updateNode: (id: string, updates: Partial<Omit<MindMapNode, 'id' | 'createdAt'>>) => void;
  deleteNodes: (ids: string[]) => void;
  createEdge: (sourceId: string, targetId: string) => string | null;
  updateEdge: (id: string, updates: Partial<Omit<MindMapEdge, 'id' | 'createdAt'>>) => void;
  deleteEdges: (ids: string[]) => void;
  setViewport: (viewport: ViewportState) => void;
  flushSave: () => Promise<void>;
  saveEmergency: () => void;
  clearError: () => void;
}

const emptyIndex = (): MindMapIndex => ({
  schemaVersion: MIND_MAP_SCHEMA_VERSION,
  activeDocumentId: null,
  documents: [],
});

const updateSummary = (index: MindMapIndex, document: MindMapDocument): MindMapIndex => {
  const summary = summarizeMindMapDocument(document);
  const exists = index.documents.some((item) => item.id === document.id);
  return {
    ...index,
    activeDocumentId: document.id,
    documents: exists
      ? index.documents.map((item) => item.id === document.id ? summary : item)
      : [summary, ...index.documents],
  };
};

let hydratePromise: Promise<void> | null = null;
let saveGeneration = 0;
const histories = new Map<string, MindMapHistory>();

export const useMindMapStore = create<MindMapStore>((set, get) => {
  const queueSave = (document: MindMapDocument, index: MindMapIndex) => {
    const generation = ++saveGeneration;
    set({ document, index, saveStatus: 'saving', error: null });
    mindMapRepository.schedule(document, index, {
      onSaved: () => {
        if (generation === saveGeneration) set({ saveStatus: 'saved' });
      },
      onError: () => {
        if (generation === saveGeneration) {
          set({ saveStatus: 'error', error: '思维导图保存失败，本次修改仍保留在当前页面。' });
        }
      },
    });
  };

  return {
    isHydrated: false,
    index: emptyIndex(),
    document: null,
    history: emptyMindMapHistory(),
    saveStatus: 'idle',
    error: null,

    hydrate: async () => {
      if (get().isHydrated) return;
      hydratePromise ??= (async () => {
        try {
          let index = await mindMapRepository.loadIndex();
          let document: MindMapDocument | null = null;
          if (index?.activeDocumentId) {
            document = await mindMapRepository.loadDocument(index.activeDocumentId);
          }
          if (!document && index) {
            for (const summary of index.documents) {
              document = await mindMapRepository.loadDocument(summary.id);
              if (document) break;
            }
          }
          if (!document) {
            document = createEmptyMindMapDocument();
            index = updateSummary(emptyIndex(), document);
            await mindMapRepository.saveNow(document, index);
          } else {
            index = updateSummary(index ?? emptyIndex(), document);
          }
          const history = histories.get(document.id) ?? emptyMindMapHistory();
          histories.set(document.id, history);
          set({ isHydrated: true, document, index, history, saveStatus: 'saved', error: null });
        } catch (error) {
          set({
            isHydrated: true,
            document: null,
            index: emptyIndex(),
            history: emptyMindMapHistory(),
            saveStatus: 'error',
            error: error instanceof Error ? error.message : '思维导图数据加载失败。',
          });
        }
      })().finally(() => {
        hydratePromise = null;
      });
      return hydratePromise;
    },

    createDocument: async () => {
      await mindMapRepository.flush();
      const document = createEmptyMindMapDocument();
      const index = updateSummary(get().index, document);
      const history = emptyMindMapHistory();
      histories.set(document.id, history);
      set({ document, index, history, saveStatus: 'saving', error: null });
      try {
        await mindMapRepository.saveNow(document, index);
        set({ saveStatus: 'saved' });
      } catch {
        set({ saveStatus: 'error', error: '新导图暂时无法保存。' });
      }
    },

    renameDocument: (title) => {
      const current = get().document;
      if (!current) return;
      const now = Date.now();
      const document = {
        ...current,
        title: title.slice(0, 120),
        updatedAt: now,
      };
      queueSave(document, updateSummary(get().index, document));
    },

    duplicateDocument: async (sourceId) => {
      const current = get().document;
      if (!current) return;
      await mindMapRepository.flush();
      const loaded = sourceId && sourceId !== current.id
        ? await mindMapRepository.loadDocument(sourceId)
        : null;
      if (sourceId && sourceId !== current.id && !loaded) {
        set({ error: '找不到这张思维导图。' });
        return;
      }
      const source = loaded ?? current;
      const document = duplicateMindMapDocument(source);
      const index = updateSummary(get().index, document);
      const history = emptyMindMapHistory();
      histories.set(document.id, history);
      set({ document, index, history, saveStatus: 'saving', error: null });
      try {
        await mindMapRepository.saveNow(document, index);
        set({ saveStatus: 'saved' });
      } catch {
        set({ saveStatus: 'error', error: '导图副本暂时无法保存。' });
      }
    },

    switchDocument: async (id) => {
      if (id === get().document?.id) return;
      await mindMapRepository.flush();
      try {
        let document = await mindMapRepository.loadDocument(id);
        const summary = get().index.documents.find((item) => item.id === id);
        if (!document && summary) {
          document = createEmptyMindMapDocument(summary.title, { id: summary.id, now: summary.createdAt });
        }
        if (!document) throw new Error('找不到这张思维导图。');
        const index = updateSummary(get().index, document);
        const history = histories.get(document.id) ?? emptyMindMapHistory();
        histories.set(document.id, history);
        set({ document, index, history, saveStatus: 'saved', error: null });
        await mindMapRepository.saveNow(document, index);
      } catch (error) {
        set({ error: error instanceof Error ? error.message : '切换导图失败。' });
      }
    },

    deleteCurrentDocument: async () => {
      const current = get().document;
      if (!current) return false;
      await mindMapRepository.flush();
      histories.delete(current.id);
      const remaining = get().index.documents.filter((item) => item.id !== current.id);
      let document: MindMapDocument | null = null;
      for (const summary of remaining) {
        document = await mindMapRepository.loadDocument(summary.id);
        if (document) break;
      }
      document ??= createEmptyMindMapDocument();
      const index: MindMapIndex = {
        schemaVersion: MIND_MAP_SCHEMA_VERSION,
        activeDocumentId: document.id,
        documents: [
          summarizeMindMapDocument(document),
          ...remaining.filter((item) => item.id !== document.id),
        ],
      };
      const history = histories.get(document.id) ?? emptyMindMapHistory();
      histories.set(document.id, history);
      set({ document, index, history, saveStatus: 'saving', error: null });
      try {
        await mindMapRepository.saveNow(document, index);
        await mindMapRepository.deleteDocument(current.id);
        set({ saveStatus: 'saved' });
        return true;
      } catch {
        set({ saveStatus: 'error', error: '删除导图失败，原数据没有被覆盖。' });
        return false;
      }
    },

    deleteDocument: async (id) => {
      const current = get().document;
      if (!current) return false;
      if (current.id === id) return get().deleteCurrentDocument();
      await mindMapRepository.flush();
      const index: MindMapIndex = {
        ...get().index,
        documents: get().index.documents.filter((item) => item.id !== id),
      };
      try {
        await mindMapRepository.saveNow(current, index);
        await mindMapRepository.deleteDocument(id);
        set({ index, error: null });
        return true;
      } catch {
        set({ error: '删除导图失败，原数据没有被覆盖。' });
        return false;
      }
    },

    importDocument: async (value) => {
      try {
        let document = normalizeMindMapDocument(value);
        if (!document) throw new Error('文件不是受支持的 SmartLine 思维导图。');
        await mindMapRepository.flush();
        if (get().index.documents.some((item) => item.id === document?.id)) {
          document = duplicateMindMapDocument(document);
        }
        const index = updateSummary(get().index, document);
        const history = emptyMindMapHistory();
        histories.set(document.id, history);
        set({ document, index, history, saveStatus: 'saving', error: null });
        await mindMapRepository.saveNow(document, index);
        set({ saveStatus: 'saved' });
        return true;
      } catch (error) {
        set({
          saveStatus: 'error',
          error: error instanceof Error ? error.message : '导入思维导图失败。',
        });
        return false;
      }
    },

    applyRemoteDocument: (remote) => {
      const current = get().document;
      if (!current || current.id !== remote.id) return;
      const normalized = normalizeMindMapDocument({ ...remote, viewport: current.viewport });
      if (!normalized) return;
      // Remote updates are persisted locally but deliberately stay outside local Undo/Redo.
      queueSave(normalized, updateSummary(get().index, normalized));
    },

    cacheRemoteDocument: async (remote) => {
      const current = get().document;
      if (!current || current.id === remote.id) return;
      const normalized = normalizeMindMapDocument(remote);
      if (!normalized) return;
      const summary = summarizeMindMapDocument(normalized);
      const currentIndex = get().index;
      const exists = currentIndex.documents.some((item) => item.id === normalized.id);
      const index: MindMapIndex = {
        ...currentIndex,
        activeDocumentId: current.id,
        documents: exists
          ? currentIndex.documents.map((item) => item.id === normalized.id ? summary : item)
          : [...currentIndex.documents, summary],
      };
      set({ index });
      try {
        await mindMapRepository.flush();
        await mindMapRepository.saveSyncedDocument(normalized, index);
      } catch {
        set({ error: '后台同步的导图暂时无法保存到本机。' });
      }
    },

    applyRemoteCatalog: async (entries) => {
      const current = get().document;
      if (!current) return;
      const remote = new Map(entries.map((entry) => [entry.id, entry]));
      const removedIds: string[] = [];
      const documents = get().index.documents.flatMap((summary) => {
        const entry = remote.get(summary.id);
        if (entry?.deletedAt !== null && entry?.deletedAt !== undefined && entry.deletedAt >= summary.updatedAt) {
          removedIds.push(summary.id);
          return [];
        }
        if (entry && entry.deletedAt === null && entry.updatedAt > summary.updatedAt) {
          return [{
            id: entry.id,
            title: entry.title,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            nodeCount: entry.nodeCount,
            edgeCount: entry.edgeCount,
          }];
        }
        return [summary];
      });
      const knownIds = new Set(documents.map((summary) => summary.id));
      for (const entry of entries) {
        if (entry.deletedAt === null && !knownIds.has(entry.id)) {
          documents.push({
            id: entry.id,
            title: entry.title,
            createdAt: entry.createdAt,
            updatedAt: entry.updatedAt,
            nodeCount: entry.nodeCount,
            edgeCount: entry.edgeCount,
          });
          knownIds.add(entry.id);
        }
      }
      if (removedIds.length === 0
        && JSON.stringify(documents) === JSON.stringify(get().index.documents)) return;
      let document: MindMapDocument = current;
      if (removedIds.includes(current.id)) {
        let nextDocument: MindMapDocument | null = null;
        for (const summary of documents) {
          nextDocument = await mindMapRepository.loadDocument(summary.id);
          if (nextDocument) break;
        }
        document = nextDocument ?? (documents[0]
          ? createEmptyMindMapDocument(documents[0].title, { id: documents[0].id, now: documents[0].createdAt })
          : createEmptyMindMapDocument());
        if (!knownIds.has(document.id)) documents.unshift(summarizeMindMapDocument(document));
      }
      const index: MindMapIndex = {
        schemaVersion: MIND_MAP_SCHEMA_VERSION,
        activeDocumentId: document.id,
        documents,
      };
      const history = histories.get(document.id) ?? emptyMindMapHistory();
      histories.set(document.id, history);
      set({ document, index, history, saveStatus: 'saving', error: null });
      try {
        await mindMapRepository.saveNow(document, index);
        await Promise.all(removedIds.map((id) => mindMapRepository.deleteDocument(id)));
        set({ saveStatus: 'saved' });
      } catch {
        set({ saveStatus: 'error', error: '云端导图目录暂时无法保存到本机。' });
      }
    },

    execute: (label, transform) => {
      const current = get().document;
      if (!current) return;
      const transformed = transform(current);
      if (transformed === current) return;
      const document = { ...maintainMindMapContainers(transformed), updatedAt: Date.now() };
      const entry = createHistoryEntry(label, current, document);
      if (!entry) return;
      const history = pushHistory(get().history, entry);
      histories.set(document.id, history);
      set({ history });
      queueSave(document, updateSummary(get().index, document));
    },

    undo: () => {
      const current = get().document;
      const history = get().history;
      const entry = history.undo.at(-1);
      if (!current || !entry) return;
      const document = applyHistoryEntry(current, entry, 'undo');
      const nextHistory = {
        undo: history.undo.slice(0, -1),
        redo: [...history.redo, entry],
      };
      histories.set(document.id, nextHistory);
      set({ history: nextHistory });
      queueSave(document, updateSummary(get().index, document));
    },

    redo: () => {
      const current = get().document;
      const history = get().history;
      const entry = history.redo.at(-1);
      if (!current || !entry) return;
      const document = applyHistoryEntry(current, entry, 'redo');
      const nextHistory = {
        undo: [...history.undo, entry],
        redo: history.redo.slice(0, -1),
      };
      histories.set(document.id, nextHistory);
      set({ history: nextHistory });
      queueSave(document, updateSummary(get().index, document));
    },

    createNode: (position, text = '') => {
      if (!get().document) return null;
      const node = createTextMindMapNode(position, { text });
      get().execute('创建节点', (document) => ({
        ...document,
        nodes: { ...document.nodes, [node.id]: node },
        zOrder: [...document.zOrder, node.id],
      }));
      return node.id;
    },

    updateNode: (id, updates) => {
      get().execute('修改节点', (document) => {
        const node = document.nodes[id];
        if (!node) return document;
        return {
          ...document,
          nodes: {
            ...document.nodes,
            [id]: { ...node, ...updates, id, createdAt: node.createdAt, updatedAt: Date.now() },
          },
        };
      });
    },

    deleteNodes: (ids) => {
      const targets = new Set(ids);
      if (targets.size === 0) return;
      get().execute(ids.length > 1 ? '删除多个节点' : '删除节点', (document) => {
        if (![...targets].some((id) => document.nodes[id])) return document;
        const nodes = { ...document.nodes };
        const edges = { ...document.edges };
        targets.forEach((id) => delete nodes[id]);
        for (const edge of Object.values(edges)) {
          if (targets.has(edge.sourceId) || targets.has(edge.targetId)) delete edges[edge.id];
        }
        return {
          ...document,
          nodes,
          edges,
          zOrder: document.zOrder.filter((id) => !targets.has(id)),
        };
      });
    },

    createEdge: (sourceId, targetId) => {
      const document = get().document;
      if (!document?.nodes[sourceId] || !document.nodes[targetId] || sourceId === targetId) return null;
      const edge = createMindMapEdge(sourceId, targetId);
      get().execute('创建连线', (current) => ({
        ...current,
        edges: { ...current.edges, [edge.id]: edge },
      }));
      return edge.id;
    },

    updateEdge: (id, updates) => {
      get().execute('修改连线', (document) => {
        const edge = document.edges[id];
        if (!edge) return document;
        return {
          ...document,
          edges: {
            ...document.edges,
            [id]: { ...edge, ...updates, id, createdAt: edge.createdAt, updatedAt: Date.now() },
          },
        };
      });
    },

    deleteEdges: (ids) => {
      const targets = new Set(ids);
      if (targets.size === 0) return;
      get().execute(ids.length > 1 ? '删除多条连线' : '删除连线', (document) => {
        if (![...targets].some((id) => document.edges[id])) return document;
        const edges = { ...document.edges };
        targets.forEach((id) => delete edges[id]);
        return { ...document, edges };
      });
    },

    setViewport: (viewport) => {
      const current = get().document;
      if (!current) return;
      const document = { ...current, viewport, updatedAt: Date.now() };
      queueSave(document, updateSummary(get().index, document));
    },

    flushSave: async () => {
      try {
        await mindMapRepository.flush();
      } catch {
        set({ saveStatus: 'error', error: '思维导图保存失败，本次修改仍保留在当前页面。' });
      }
    },

    saveEmergency: () => {
      const document = get().document;
      if (document && (get().saveStatus === 'saving' || get().saveStatus === 'error')) {
        mindMapRepository.saveEmergency(document);
      }
    },

    clearError: () => set({ error: null }),
  };
});

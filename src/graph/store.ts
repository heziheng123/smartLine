import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import localforage from 'localforage';
import { GraphNode, GraphData } from './types';
import { genId } from '@/ebb/scheduler';
import { liveblocksClient } from '@/store/client';

import { useEbbStore } from '@/ebb/store';

localforage.config({
  name: 'smart-timeline',
  storeName: 'graph_data'
});

const GRAPH_STORAGE_KEY = 'line-graph-storage';
const GRAPH_SYNC_SETTINGS_KEY = 'line-graph-liveblocks';

interface GraphSyncSettings {
  roomCode: string;
  enabled: boolean;
}

function loadGraphSyncSettings(): GraphSyncSettings {
  try {
    const raw = localStorage.getItem(GRAPH_SYNC_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { roomCode: '', enabled: false };
}

function saveGraphSyncSettings(settings: GraphSyncSettings) {
  localStorage.setItem(GRAPH_SYNC_SETTINGS_KEY, JSON.stringify(settings));
}

function getInitialGraphData(): GraphData {
  return { nodes: [] };
}

async function saveGraphDataAsync(data: GraphData) {
  try {
    await localforage.setItem(GRAPH_STORAGE_KEY, data);
  } catch (e) {
    console.warn('[smart-graph] IndexedDB 写入失败：', e);
  }
}

function saveGraphData(data: GraphData) {
  saveGraphDataAsync(data);
}

export type GraphSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface GraphStore extends GraphData {
  isHydrated: boolean;
  hydrateStore: () => Promise<void>;

  syncEnabled: boolean;
  syncRoomCode: string;
  syncStatus: GraphSyncStatus;

  enableSync: (roomCode: string) => void;
  disableSync: () => void;
  setSyncStatus: (status: GraphSyncStatus) => void;

  // Actions
  addNode: (name: string, parentId?: string | null) => GraphNode;
  updateNode: (id: string, updates: Partial<Omit<GraphNode, 'id' | 'createdAt'>>) => void;
  deleteNode: (id: string) => void;
  restoreNode: (node: GraphNode, childrenIds: string[]) => void;
  archiveNodeCascade: (id: string, isArchived: boolean) => void;
  getNodeById: (id: string) => GraphNode | undefined;
  importGraphData: (data: GraphData) => void;
}

export const useGraphStore = create<WithLiveblocks<GraphStore>>()(
  liveblocks(
    (set, get) => {
      const initial = getInitialGraphData();
      const initialSync = loadGraphSyncSettings();

      return {
        ...initial,
        isHydrated: false,
        hydrateStore: async () => {
          try {
            let raw = await localforage.getItem<GraphData>(GRAPH_STORAGE_KEY);
            if (!raw) {
              const lsRaw = localStorage.getItem(GRAPH_STORAGE_KEY);
              if (lsRaw) {
                raw = JSON.parse(lsRaw) as GraphData;
                await localforage.setItem(GRAPH_STORAGE_KEY, raw);
                localStorage.removeItem(GRAPH_STORAGE_KEY);
              }
            } else if (typeof raw === 'string') {
              raw = JSON.parse(raw) as GraphData;
            }

            if (raw) {
              set({
                nodes: raw.nodes ?? [],
                isHydrated: true,
              });
              return;
            }
          } catch (e) {
            console.warn('[smart-graph] IndexedDB数据加载失败：', e);
          }
          set({ isHydrated: true });
        },
        syncEnabled: initialSync.enabled,
        syncRoomCode: initialSync.roomCode,
        syncStatus: 'disconnected' as GraphSyncStatus,

        enableSync: (roomCode) => {
          const settings = { roomCode, enabled: true };
          saveGraphSyncSettings(settings);
          set({ syncEnabled: true, syncRoomCode: roomCode });
        },

        disableSync: () => {
          const settings = { roomCode: '', enabled: false };
          saveGraphSyncSettings(settings);
          set({ syncEnabled: false, syncRoomCode: '', syncStatus: 'disconnected' });
        },

        setSyncStatus: (status) => {
          set({ syncStatus: status });
        },

        addNode: (name: string, parentId: string | null = null) => {
          const newNode: GraphNode = {
            id: genId('gn'),
            name,
            parentId,
            createdAt: Date.now(),
          };

          set((state) => {
            const newData = { nodes: [...state.nodes, newNode] };
            saveGraphData(newData);
            return newData;
          });

          return newNode;
        },

        updateNode: (id: string, updates: Partial<Omit<GraphNode, 'id' | 'createdAt'>>) => {
          set((state) => {
            const newData = {
              nodes: state.nodes.map((node) =>
                node.id === id ? { ...node, ...updates } : node
              ),
            };
            saveGraphData(newData);
            return newData;
          });
          
          // 如果修改了节点名称，同步更新 Ebb 中关联任务的 topicName
          if (updates.name) {
            useEbbStore.getState().updateTopicNameByGraphNodeId(id, updates.name);
          }
        },

        deleteNode: (id: string) => {
          set((state) => {
            // 找到要删除的节点及其所有子孙节点
            const toDelete = new Set<string>([id]);
            let changed = true;
            while (changed) {
              changed = false;
              for (const n of state.nodes) {
                if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
                  toDelete.add(n.id);
                  changed = true;
                }
              }
            }

            const newData = {
              nodes: state.nodes.filter((node) => !toDelete.has(node.id)),
            };
            saveGraphData(newData);
            return newData;
          });
        },

        restoreNode: (node: GraphNode, childrenIds: string[]) => {
          set((state) => {
            // Restore the node and revert the children's parentId
            const newData = {
              nodes: [
                ...state.nodes.map(n => childrenIds.includes(n.id) ? { ...n, parentId: node.id } : n),
                node
              ]
            };
            saveGraphData(newData);
            return newData;
          });
        },

        archiveNodeCascade: (id: string, isArchived: boolean) => {
          set((state) => {
            // 找到所有子孙节点
            const toArchive = new Set<string>([id]);
            let changed = true;
            while (changed) {
              changed = false;
              for (const n of state.nodes) {
                if (n.parentId && toArchive.has(n.parentId) && !toArchive.has(n.id)) {
                  toArchive.add(n.id);
                  changed = true;
                }
              }
            }
            
            const newData = {
              nodes: state.nodes.map(n => 
                toArchive.has(n.id) ? { ...n, isArchived } : n
              )
            };
            saveGraphData(newData);
            return newData;
          });
        },

        getNodeById: (id: string) => {
          return get().nodes.find((node) => node.id === id);
        },

        importGraphData: (data: GraphData) => {
          const isValidGraphNode = (n: unknown): n is GraphNode => {
            if (!n || typeof n !== 'object') return false;
            const r = n as Record<string, unknown>;
            return typeof r.id === 'string'
              && typeof r.name === 'string'
              && (typeof r.parentId === 'string' || r.parentId === null)
              && typeof r.createdAt === 'number'
              && (typeof r.isArchived === 'boolean' || r.isArchived === undefined);
          };

          const normalized: GraphData = {
            nodes: Array.isArray(data?.nodes) ? data.nodes.filter(isValidGraphNode) : [],
          };

          const current = get();
          const importedIds = new Set(normalized.nodes.map((x) => x.id));
          const mergedNodes = [...current.nodes.filter((x) => !importedIds.has(x.id)), ...normalized.nodes];
          
          const merged: GraphData = {
            nodes: mergedNodes,
          };
          
          saveGraphData(merged);
          set(merged);
        },
      };
    },
    {
      client: liveblocksClient,
      storageMapping: {
        nodes: true,
      },
    }
  )
);

// 远端 Liveblocks 推送同步落盘
{
  let lastNodes: unknown = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  useGraphStore.subscribe((state) => {
    if (state.nodes === lastNodes) return;
    lastNodes = state.nodes;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveGraphData({ nodes: state.nodes });
    }, 500);
  });
}

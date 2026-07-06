import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { GraphNode, GraphData } from './types';
import { genId } from '@/ebb/scheduler';
import { liveblocksClient } from '@/store/client';

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

function loadGraphData(): GraphData {
  try {
    const raw = localStorage.getItem(GRAPH_STORAGE_KEY);
    if (raw) {
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn('[smart-graph] 本地数据解析失败：', e);
  }
  return { nodes: [] };
}

function saveGraphData(data: GraphData) {
  try {
    localStorage.setItem(GRAPH_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.warn('[smart-graph] 本地存储写入失败：', e);
  }
}

export type GraphSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface GraphStore extends GraphData {
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
  getNodeById: (id: string) => GraphNode | undefined;
  importGraphData: (data: GraphData) => void;
}

export const useGraphStore = create<WithLiveblocks<GraphStore>>()(
  liveblocks(
    (set, get) => {
      const initial = loadGraphData();
      const initialSync = loadGraphSyncSettings();

      return {
        ...initial,
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
        },

        deleteNode: (id: string) => {
          set((state) => {
            const nodeToDelete = state.nodes.find(n => n.id === id);
            if (!nodeToDelete) return state;

            const newData = {
              nodes: state.nodes
                .filter((node) => node.id !== id)
                .map((node) => 
                  node.parentId === id ? { ...node, parentId: nodeToDelete.parentId } : node
                ),
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
              && typeof r.createdAt === 'number';
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

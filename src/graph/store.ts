import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { GraphNode, GraphData } from './types';
import { genId } from '@/ebb/scheduler';
import { liveblocksClient } from '@/store/client';
import { createScopedStorage, readJsonStorage, writeJsonStorage } from '@/utils/persistence';

import { useEbbStore } from '@/ebb/store';
import { useTimelineStore } from '@/store';

const GRAPH_STORAGE_KEY = 'line-graph-storage';
const GRAPH_SYNC_SETTINGS_KEY = 'line-graph-liveblocks';
const GRAPH_STORAGE_MIRROR_KEY = `${GRAPH_STORAGE_KEY}:mirror`;
const graphStorage = createScopedStorage('graph_data');

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

function isValidGraphNode(node: unknown): node is GraphNode {
  if (!node || typeof node !== 'object') return false;
  const record = node as Record<string, unknown>;
  return typeof record.id === 'string'
    && record.id.trim().length > 0
    && typeof record.name === 'string'
    && (typeof record.parentId === 'string' || record.parentId === null)
    && typeof record.createdAt === 'number'
    && Number.isFinite(record.createdAt)
    && (typeof record.isArchived === 'boolean' || record.isArchived === undefined)
    && (
      record.status === 'activated'
      || record.status === 'unactivated'
      || record.status === undefined
    );
}

function clearPersistedParentStatuses(nodes: GraphNode[]): GraphNode[] {
  const parentIds = new Set(
    nodes.filter((node) => !node.isArchived && node.parentId).map((node) => node.parentId as string),
  );
  return nodes.map((node) =>
    parentIds.has(node.id) && node.status !== undefined
      ? { ...node, status: undefined }
      : node
  );
}

export function normalizeGraphNodes(nodes: GraphNode[]): GraphNode[] {
  const deduplicated = new Map<string, GraphNode>();
  nodes.forEach((node) => deduplicated.set(node.id, node));

  const validIds = new Set(deduplicated.keys());
  const normalized = [...deduplicated.values()].map((node) => ({
    ...node,
    parentId:
      node.parentId
      && node.parentId !== node.id
      && validIds.has(node.parentId)
        ? node.parentId
        : null,
    status:
      node.status === 'activated' || node.status === 'unactivated'
        ? node.status
        : undefined,
  }));
  const nodeById = new Map(normalized.map((node) => [node.id, node]));
  const visitState = new Map<string, 'visiting' | 'visited'>();

  const breakCycles = (nodeId: string) => {
    const node = nodeById.get(nodeId);
    if (!node || visitState.get(nodeId) === 'visited') return;
    visitState.set(nodeId, 'visiting');

    if (node.parentId) {
      const parentState = visitState.get(node.parentId);
      if (parentState === 'visiting') {
        node.parentId = null;
      } else {
        breakCycles(node.parentId);
      }
    }

    visitState.set(nodeId, 'visited');
  };

  normalized.forEach((node) => breakCycles(node.id));
  return clearPersistedParentStatuses(normalized);
}

async function saveGraphDataAsync(data: GraphData) {
  try {
    await graphStorage.setItem(GRAPH_STORAGE_KEY, data);
  } catch (e) {
    console.warn('[smart-graph] IndexedDB 写入失败：', e);
  }
}

function saveGraphData(data: GraphData) {
  writeJsonStorage(GRAPH_STORAGE_MIRROR_KEY, data, 'smart-graph');
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
  replaceGraphData: (data: GraphData) => void;
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
            let raw = readJsonStorage<GraphData>(GRAPH_STORAGE_MIRROR_KEY)
              ?? await graphStorage.getItem<GraphData>(GRAPH_STORAGE_KEY);
            if (!raw) {
              const lsRaw = readJsonStorage<GraphData>(GRAPH_STORAGE_KEY);
              if (lsRaw) {
                raw = lsRaw;
                await graphStorage.setItem(GRAPH_STORAGE_KEY, raw);
                localStorage.removeItem(GRAPH_STORAGE_KEY);
              }
            } else if (typeof raw === 'string') {
              raw = JSON.parse(raw) as GraphData;
            }

            if (raw) {
              const nodes = normalizeGraphNodes(
                Array.isArray(raw.nodes) ? raw.nodes.filter(isValidGraphNode) : [],
              );
              set({
                nodes,
                isHydrated: true,
              });
              saveGraphData({ nodes });
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
            const newData = {
              nodes: [
                ...state.nodes.map((node) =>
                  node.id === parentId ? { ...node, status: 'unactivated' as const } : node
                ),
                newNode,
              ],
            };
            saveGraphData(newData);
            return newData;
          });

          return newNode;
        },

        updateNode: (id: string, updates: Partial<Omit<GraphNode, 'id' | 'createdAt'>>) => {
          set((state) => {
            const currentNode = state.nodes.find((node) => node.id === id);
            const previousParentId = currentNode?.parentId;
            const targetHasChildren = state.nodes.some(
              (node) => !node.isArchived && node.parentId === id,
            );
            const safeUpdates = targetHasChildren && updates.status
              ? { ...updates, status: undefined }
              : updates;
            const nextParentId = safeUpdates.parentId;
            const newData = {
              nodes: state.nodes.map((node) =>
                node.id === id
                  ? { ...node, ...safeUpdates }
                  : node.id === nextParentId || node.id === previousParentId
                    ? { ...node, status: 'unactivated' as const }
                    : node
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
            const deletedNode = state.nodes.find((node) => node.id === id);
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
              nodes: state.nodes
                .filter((node) => !toDelete.has(node.id))
                .map((node) =>
                  node.id === deletedNode?.parentId
                    ? { ...node, status: 'unactivated' as const }
                    : node
                ),
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
                ...state.nodes.map(n =>
                  childrenIds.includes(n.id)
                    ? { ...n, parentId: node.id }
                    : n.id === node.parentId
                      ? { ...n, status: 'unactivated' as const }
                      : n
                ),
                { ...node, status: childrenIds.length > 0 ? undefined : node.status }
              ]
            };
            saveGraphData(newData);
            return newData;
          });
        },

        archiveNodeCascade: (id: string, isArchived: boolean) => {
          set((state) => {
            const targetNode = state.nodes.find((node) => node.id === id);
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
                toArchive.has(n.id)
                  ? { ...n, isArchived }
                  : n.id === targetNode?.parentId
                    ? { ...n, status: 'unactivated' as const }
                    : n
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
          const normalized: GraphData = {
            nodes: Array.isArray(data?.nodes) ? data.nodes.filter(isValidGraphNode) : [],
          };

          const current = get();
          const importedIds = new Set(normalized.nodes.map((x) => x.id));
          const mergedNodes = normalizeGraphNodes([
            ...current.nodes.filter((x) => !importedIds.has(x.id)),
            ...normalized.nodes,
          ]);
          
          const merged: GraphData = {
            nodes: mergedNodes,
          };
          
          saveGraphData(merged);
          set(merged);
        },

        replaceGraphData: (data: GraphData) => {
          const normalized: GraphData = {
            nodes: normalizeGraphNodes(
              Array.isArray(data?.nodes) ? data.nodes.filter(isValidGraphNode) : [],
            ),
          };
          saveGraphData(normalized);
          set(normalized);
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

  useGraphStore.subscribe((state, previousState) => {
    const currentNodeIds = new Set(state.nodes.map((node) => node.id));
    const deletedNodeIds = previousState.nodes
      .map((node) => node.id)
      .filter((nodeId) => !currentNodeIds.has(nodeId));
    if (deletedNodeIds.length > 0) {
      useTimelineStore.getState().removeGraphNodeReferences(deletedNodeIds);
      useEbbStore.getState().removeGraphNodeReferences(deletedNodeIds);
    }

    if (state.nodes === lastNodes) return;
    lastNodes = state.nodes;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const latest = useGraphStore.getState().nodes;
      const normalized = normalizeGraphNodes(latest);
      if (JSON.stringify(latest) !== JSON.stringify(normalized)) {
        useGraphStore.setState({ nodes: normalized });
        return;
      }
      saveGraphData({ nodes: latest });
    }, 500);
  });
}

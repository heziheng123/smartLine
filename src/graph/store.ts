import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { GraphNode, GraphData } from './types';
import { genId } from '@/ebb/scheduler';
import { liveblocksClient } from '@/store/client';
import { createCoalescedPersistence, createScopedStorage, readJsonStorage } from '@/utils/persistence';
import { createWorkspaceTrackedSet } from '@/services/workspaceLocalWriteJournal';
import { recordOperation } from '@/services/operationHistory';
import { recordGraphDiagnostic, setGraphDiagnostic, setGraphDiagnosticDetail } from './diagnostics';
import type { GraphNodeDraft } from './outlineImport';
import { inspectGraphNodes } from './integrity';

import { useEbbStore } from '@/ebb/store';
import { useTimelineStore } from '@/store';
import { getAllGraphNodeIds, getUniqueTasks } from '@/store/timelineData';
import { captureDailySourceSnapshots, useDailyScheduleStore } from '@/components/dailySchedule/store';
import { getReviewSourceId } from '@/components/dailySchedule/sourceIds';
import type { Task } from '@/types';

const GRAPH_STORAGE_KEY = 'line-graph-storage';
const GRAPH_SYNC_SETTINGS_KEY = 'line-graph-liveblocks';
const GRAPH_STORAGE_MIRROR_KEY = `${GRAPH_STORAGE_KEY}:mirror`;
const graphStorage = createScopedStorage('graph_data');
let graphHydrationPromise: Promise<void> | null = null;

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

function collectNodeCascadeIds(nodes: GraphNode[], rootId: string): string[] {
  if (!nodes.some((node) => node.id === rootId)) return [];
  const collected = new Set<string>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of nodes) {
      if (node.parentId && collected.has(node.parentId) && !collected.has(node.id)) {
        collected.add(node.id);
        changed = true;
      }
    }
  }
  return [...collected];
}

function removeDeletedNodeReferences(nodeIds: string[]): void {
  if (nodeIds.length === 0) return;
  useTimelineStore.getState().removeGraphNodeReferences(nodeIds);
  useEbbStore.getState().removeGraphNodeReferences(nodeIds);
}

function captureDeletedNodeReferences(deletedIds: Set<string>): () => void {
  const timeline = useTimelineStore.getState();
  const headers = new Map<string, { graphNodeId: string | undefined; graphNodeIds: string[] | undefined }>();
  for (const task of getUniqueTasks(timeline.tasks, timeline.groups)) {
    for (const block of task.blocks ?? []) {
      if (block.type !== 'smart-task' || !getAllGraphNodeIds(block.header).some((id) => deletedIds.has(id))) continue;
      headers.set(`${task.id}\0${block.id}`, {
        graphNodeId: block.header.graphNodeId,
        graphNodeIds: block.header.graphNodeIds ? [...block.header.graphNodeIds] : undefined,
      });
    }
  }
  const reviews = useEbbStore.getState().reviewTasks;
  const reviewOrder = new Map(reviews.map((task, index) => [task.id, index] as const));
  const removedReviews = reviews.filter((task) => task.graphNodeId && deletedIds.has(task.graphNodeId));
  const dailySnapshots = captureDailySourceSnapshots(
    useDailyScheduleStore.getState().schedules,
    removedReviews.map((task) => getReviewSourceId(task.id)),
  );
  const reviewSourceIds = removedReviews.map((task) => getReviewSourceId(task.id));

  return () => {
    if (headers.size > 0) {
      const restoreTask = (task: Task): Task => {
        let changed = false;
        const blocks = (task.blocks ?? []).map((block) => {
          const header = headers.get(`${task.id}\0${block.id}`);
          if (block.type !== 'smart-task' || !header) return block;
          changed = true;
          return { ...block, header: { ...block.header, ...header } };
        });
        return changed ? { ...task, blocks } : task;
      };
      useTimelineStore.setState((state) => ({
        tasks: state.tasks.map(restoreTask),
        groups: state.groups.map((group) => ({ ...group, children: group.children.map(restoreTask) })),
      }));
    }
    if (removedReviews.length > 0) {
      useEbbStore.setState((state) => {
        const existingIds = new Set(state.reviewTasks.map((task) => task.id));
        return { reviewTasks: [...state.reviewTasks, ...removedReviews.filter((task) => !existingIds.has(task.id))]
          .sort((left, right) => (reviewOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (reviewOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)) };
      });
    }
    useDailyScheduleStore.getState().cancelPendingSourceRemoval(reviewSourceIds);
    if (dailySnapshots.length > 0) useDailyScheduleStore.getState().restoreSourceSnapshots(dailySnapshots);
  };
}

export function normalizeGraphNodes(value: unknown): GraphNode[] {
  const nodes = Array.isArray(value) ? value.filter(isValidGraphNode) : [];
  const usedIds = new Set<string>();
  const duplicateIds: Array<{ id: string; name: string; firstName: string }> = [];
  const firstById = new Map<string, GraphNode>();
  const deduplicated = nodes.map((node) => {
    if (!usedIds.has(node.id)) {
      usedIds.add(node.id);
      firstById.set(node.id, node);
      return node;
    }
    duplicateIds.push({ id: node.id, name: node.name, firstName: firstById.get(node.id)!.name });
    let id = genId('gn');
    while (usedIds.has(id)) id = genId('gn');
    usedIds.add(id);
    return { ...node, id };
  });
  setGraphDiagnostic('normalizationDuplicateIds', duplicateIds.length);
  setGraphDiagnosticDetail('normalizationDuplicateIdValues', duplicateIds);

  const validIds = new Set(deduplicated.map((node) => node.id));
  const normalized = deduplicated.map((node) => ({
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
  recordGraphDiagnostic('persistenceWrite');
  try {
    await graphStorage.setItem(GRAPH_STORAGE_KEY, data);
    setGraphDiagnostic('persistedNodes', data.nodes.length);
  } catch (e) {
    console.warn('[smart-graph] IndexedDB 写入失败：', e);
    throw e;
  }
}

function saveGraphData(data: GraphData) {
  graphPersistence.schedule(data);
}

const graphPersistence = createCoalescedPersistence<GraphData>({
  mirrorKey: GRAPH_STORAGE_MIRROR_KEY,
  label: 'smart-graph',
  writeAsync: saveGraphDataAsync,
});

export async function persistGraphData(data: GraphData): Promise<void> {
  await graphPersistence.writeNow({ nodes: normalizeGraphNodes(data.nodes) });
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
  addNodes: (drafts: GraphNodeDraft[], historyLabel?: string) => GraphNode[];
  removeNodes: (ids: string[], restoreStatuses?: ReadonlyMap<string, GraphNode['status']>) => void;
  updateNode: (id: string, updates: Partial<Omit<GraphNode, 'id' | 'createdAt'>>) => void;
  deleteNode: (id: string) => void;
  restoreNode: (node: GraphNode, childrenIds: string[]) => void;
  archiveNodeCascade: (id: string, isArchived: boolean) => void;
  resetActivationCascade: (rootIds: string[]) => void;
  activateLeafCascade: (rootId: string) => void;
  getNodeById: (id: string) => GraphNode | undefined;
  deleteNodesBatch: (ids: string[], label?: string) => boolean;
  importGraphData: (data: GraphData) => void;
  replaceGraphData: (data: GraphData) => void;
}

export const useGraphStore = create<WithLiveblocks<GraphStore>>()(
  liveblocks(
    (_setState, get, api) => {
      const set = createWorkspaceTrackedSet(api.setState, get, ['nodes']);
      const initial = getInitialGraphData();
      const initialSync = loadGraphSyncSettings();

      return {
        ...initial,
        isHydrated: false,
        hydrateStore: () => {
          if (get().isHydrated) return Promise.resolve();
          if (graphHydrationPromise) return graphHydrationPromise;
          graphHydrationPromise = (async () => {
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
                setGraphDiagnosticDetail('hydrationIntegrityRaw', inspectGraphNodes(Array.isArray(raw.nodes) ? raw.nodes.filter(isValidGraphNode) : []));
                const nodes = normalizeGraphNodes(
                  Array.isArray(raw.nodes) ? raw.nodes.filter(isValidGraphNode) : [],
                );
                setGraphDiagnostic('reloadedNodes', nodes.length);
                setGraphDiagnosticDetail('hydrationIntegrity', inspectGraphNodes(nodes));
                set({
                  nodes,
                  isHydrated: true,
                });
                return;
              }
            } catch (e) {
              console.warn('[smart-graph] IndexedDB数据加载失败：', e);
            }
            set({ isHydrated: true });
          })().finally(() => {
            graphHydrationPromise = null;
          });
          return graphHydrationPromise;
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
          const resolvedParentId = parentId && get().nodes.some((node) => node.id === parentId)
            ? parentId
            : null;
          const newNode: GraphNode = {
            id: genId('gn'),
            name,
            parentId: resolvedParentId,
            createdAt: Date.now(),
          };

          recordGraphDiagnostic('stateCommit');
          set((state) => {
            const newData = {
              nodes: [
                ...state.nodes.map((node) =>
                  node.id === resolvedParentId ? { ...node, status: 'unactivated' as const } : node
                ),
                newNode,
              ],
            };
            return newData;
          });

          return newNode;
        },

        addNodes: (drafts, historyLabel = '导入知识目录') => {
          if (drafts.length === 0) return [];
          const existingNodes = get().nodes;
          const currentIds = new Set(existingNodes.map((node) => node.id));
          const createdAt = Date.now();
          const created: GraphNode[] = [];
          for (const [index, draft] of drafts.entries()) {
            if (draft.parentIndex !== undefined && (!Number.isInteger(draft.parentIndex) || draft.parentIndex < 0 || draft.parentIndex >= index)) {
              throw new Error(`知识目录第 ${index + 1} 行的父节点索引无效`);
            }
            let id = genId('gn');
            while (currentIds.has(id)) id = genId('gn');
            currentIds.add(id);
            const generatedParentId = draft.parentIndex === undefined
              ? draft.parentId ?? null
              : created[draft.parentIndex]?.id ?? null;
            if (generatedParentId && !currentIds.has(generatedParentId)) {
              throw new Error(`知识目录第 ${index + 1} 行的父节点不存在`);
            }
            const parentId = generatedParentId;
            created.push({ id, name: draft.name, parentId, createdAt: createdAt + index });
          }

          // 性能不足时可延迟计算、批处理、减少重复渲染或裁剪屏幕外绘制，绝不能丢弃用户数据。
          const parentIds = new Set(created.map((node) => node.parentId).filter(Boolean));
          const previousStatuses = new Map(existingNodes
            .filter((node) => parentIds.has(node.id))
            .map((node) => [node.id, node.status] as const));
          recordGraphDiagnostic('stateCommit');
          set((state) => ({
            nodes: [
              ...state.nodes.map((node) => parentIds.has(node.id)
                ? { ...node, status: undefined }
                : node),
              ...created.map((node) => parentIds.has(node.id) ? { ...node, status: undefined } : node),
            ],
          }));
          setGraphDiagnostic('generatedNodes', created.length);
          setGraphDiagnostic('uniqueNodeIds', new Set(created.map((node) => node.id)).size);
          setGraphDiagnostic('duplicateIds', created.length - new Set(created.map((node) => node.id)).size);
          setGraphDiagnostic('committedStoreNodes', get().nodes.length);
          // 导入链路不再同步做全图 inspect（O(N*深度)，大目录下直接导致主线程长时间阻塞甚至 OOM）。
          // 只记录轻量计数，完整性检查交给空闲时按需触发。
          setGraphDiagnosticDetail('lastImport', { count: created.length, rootId: created[0].id });

          const ids = created.map((node) => node.id);
          const operationId = recordOperation({
            label: historyLabel,
            detail: `新增 ${created.length} 个知识节点`,
            modules: ['知识大盘'],
          }, () => {
            const state = useGraphStore.getState();
            if (!ids.every((id) => state.nodes.some((node) => node.id === id))) return false;
            state.removeNodes(ids, previousStatuses);
          });
          if (operationId) recordGraphDiagnostic('historyPush');
          return created;
        },

        removeNodes: (ids, restoreStatuses) => {
          const removed = new Set(ids);
          if (removed.size === 0 || !get().nodes.some((node) => removed.has(node.id))) return;
          recordGraphDiagnostic('stateCommit');
          set((state) => ({
            nodes: state.nodes
              .filter((node) => !removed.has(node.id))
              .map((node) => {
                const restored = restoreStatuses?.has(node.id)
                  ? { ...node, status: restoreStatuses.get(node.id) }
                  : node;
                return restored.parentId && removed.has(restored.parentId)
                  ? { ...restored, parentId: null }
                  : restored;
              }),
          }));
          removeDeletedNodeReferences([...removed]);
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
            const hasParentUpdate = Object.prototype.hasOwnProperty.call(safeUpdates, 'parentId');
            const requestedParentId = safeUpdates.parentId;
            const descendantIds = new Set(collectNodeCascadeIds(state.nodes, id));
            const validParentId = requestedParentId
              && state.nodes.some((node) => node.id === requestedParentId)
              && !descendantIds.has(requestedParentId);
            const nextParentId = !hasParentUpdate
              ? currentNode?.parentId
              : requestedParentId === null
                ? null
                : validParentId
                  ? requestedParentId
                  : currentNode?.parentId;
            const nextUpdates = hasParentUpdate && requestedParentId !== nextParentId
              ? { ...safeUpdates, parentId: nextParentId }
              : safeUpdates;
            const newData = {
              nodes: state.nodes.map((node) =>
                node.id === id
                  ? { ...node, ...nextUpdates }
                  : node.id === nextParentId || node.id === previousParentId
                    ? { ...node, status: 'unactivated' as const }
                    : node
              ),
            };
            return newData;
          });
          
          // 如果修改了节点名称，同步更新 Ebb 中关联任务的 topicName
          if (updates.name) {
            useEbbStore.getState().updateTopicNameByGraphNodeId(id, updates.name);
          }
        },

        deleteNode: (id: string) => {
          const currentNodes = get().nodes;
          const deletedIds = collectNodeCascadeIds(currentNodes, id);
          if (deletedIds.length === 0) return;
          const toDelete = new Set(deletedIds);
          const deletedNode = currentNodes.find((node) => node.id === id);
          const deletedNodes = currentNodes.filter((node) => toDelete.has(node.id));
          const previousParent = currentNodes.find((node) => node.id === deletedNode?.parentId);
          const before = inspectGraphNodes(currentNodes, id);
          const restoreReferences = captureDeletedNodeReferences(toDelete);

          set((state) => {
            const newData = {
              nodes: state.nodes
                .filter((node) => !toDelete.has(node.id))
                .map((node) =>
                  node.id === deletedNode?.parentId
                    ? { ...node, status: state.nodes.some((child) => child.parentId === node.id && !toDelete.has(child.id))
                      ? undefined : 'unactivated' as const }
                    : node
                ),
            };
            return newData;
          });
          recordGraphDiagnostic('stateCommit');
          const after = inspectGraphNodes(get().nodes);
          const deleteDiagnostic = {
            selectedId: id,
            selectedTitle: deletedNode?.name,
            sameTitleNodesBefore: currentNodes.filter((node) => node.name === deletedNode?.name).length,
            totalBefore: before.totalNodes,
            directChildren: before.directChildren,
            descendantCount: before.reachableNodes - 1,
            deleteSetCount: deletedIds.length,
            rootsBefore: before.rootNodes,
            orphanCountBefore: before.missingParentNodes,
            unreachableCountBefore: before.unreachableNodes,
            totalAfterStore: after.totalNodes,
            orphanCountAfter: after.missingParentNodes,
            rootsAfter: after.rootNodes,
            deletedTreeRemaining: get().nodes.filter((node) => toDelete.has(node.id)).length,
            sameTitleNodesAfter: get().nodes.filter((node) => node.name === deletedNode?.name).length,
          };
          setGraphDiagnosticDetail('lastDelete', deleteDiagnostic);
          if (import.meta.env.DEV) console.info('[GraphDelete]', deleteDiagnostic);
          const order = new Map(currentNodes.map((node, index) => [node.id, index] as const));
          const operationId = recordOperation({
            label: `删除${deletedNode?.name ?? '知识节点'}子树`,
            detail: `删除 ${deletedIds.length} 个知识节点`,
            modules: ['知识大盘'],
          }, () => {
            if (get().nodes.some((node) => toDelete.has(node.id))) return false;
            set((state) => ({
              nodes: [...state.nodes.map((node) => node.id === previousParent?.id
                ? { ...node, status: previousParent.status }
                : node), ...deletedNodes]
                .sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)),
            }));
            restoreReferences();
          });
          if (operationId) recordGraphDiagnostic('historyPush');

          // Reference cleanup belongs to the explicit local delete command.
          // Never infer deletion from a smaller `nodes` snapshot: Liveblocks
          // hydration and offline reconciliation can temporarily publish such
          // a snapshot before pending local nodes are restored.
          removeDeletedNodeReferences(deletedIds);
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
            return newData;
          });
        },

        archiveNodeCascade: (id: string, isArchived: boolean) => {
          set((state) => {
            const targetNode = state.nodes.find((node) => node.id === id);
            if (!targetNode) return state;
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
            // Restoring a descendant also needs its ancestor path. Otherwise the
            // node exists in the store but has no visible root for layout to reach.
            if (!isArchived) {
              const byId = new Map(state.nodes.map((node) => [node.id, node]));
              let parentId = targetNode.parentId;
              while (parentId && !toArchive.has(parentId)) {
                toArchive.add(parentId);
                parentId = byId.get(parentId)?.parentId ?? null;
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
            return newData;
          });
        },

        resetActivationCascade: (rootIds) => {
          const roots = new Set(rootIds.filter(Boolean));
          if (roots.size === 0) return;
          set((state) => {
            const resetIds = new Set<string>();
            roots.forEach((rootId) => {
              collectNodeCascadeIds(state.nodes, rootId).forEach((nodeId) => resetIds.add(nodeId));
            });
            const visibleResetIds = [...resetIds].filter((nodeId) =>
              state.nodes.some((node) => node.id === nodeId && !node.isArchived));
            if (visibleResetIds.length === 0) return state;
            const visibleReset = new Set(visibleResetIds);
            return {
              nodes: state.nodes.map((node) => visibleReset.has(node.id)
                ? { ...node, status: state.nodes.some((child) => !child.isArchived && child.parentId === node.id)
                  ? undefined
                  : 'unactivated' as const }
                : node),
            };
          });
        },

        activateLeafCascade: (rootId) => {
          if (!rootId) return;
          set((state) => {
            if (!state.nodes.some((node) => node.id === rootId && !node.isArchived)) return state;
            const cascade = new Set(collectNodeCascadeIds(state.nodes, rootId));
            const leaves = state.nodes.filter((node) =>
              !node.isArchived && cascade.has(node.id)
              && !state.nodes.some((child) => !child.isArchived && child.parentId === node.id));
            if (leaves.length === 0) return state;
            const leafIds = new Set(leaves.map((node) => node.id));
            return {
              nodes: state.nodes.map((node) => leafIds.has(node.id)
                ? { ...node, status: 'activated' as const }
                : node),
            };
          });
        },

        getNodeById: (id: string) => {
          return get().nodes.find((node) => node.id === id);
        },

        deleteNodesBatch: (ids, label = '批量删除知识节点') => {
          const requested = new Set(ids.filter(Boolean));
          if (requested.size === 0) return false;
          const currentNodes = get().nodes;
          const toDelete = new Set<string>();
          requested.forEach((id) => {
            collectNodeCascadeIds(currentNodes, id).forEach((nodeId) => toDelete.add(nodeId));
          });
          if (toDelete.size === 0) return false;
          const before = currentNodes;
          const order = new Map(currentNodes.map((node, index) => [node.id, index] as const));
          recordGraphDiagnostic('stateCommit');
          set((state) => ({
            nodes: state.nodes.filter((node) => !toDelete.has(node.id)),
          }));
          removeDeletedNodeReferences([...toDelete]);
          const operationId = recordOperation({
            label,
            detail: `删除 ${toDelete.size} 个知识节点（含子孙）`,
            modules: ['知识大盘'],
          }, () => {
            const state = useGraphStore.getState();
            if (state.nodes.some((node) => toDelete.has(node.id))) return false;
            set({
              nodes: [...state.nodes, ...before.filter((node) => toDelete.has(node.id))]
                .sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER)),
            });
            return true;
          });
          if (operationId) recordGraphDiagnostic('historyPush');
          return true;
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
          
          set(merged);
        },

        replaceGraphData: (data: GraphData) => {
          const normalized: GraphData = {
            nodes: normalizeGraphNodes(
              Array.isArray(data?.nodes) ? data.nodes.filter(isValidGraphNode) : [],
            ),
          };
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

  useGraphStore.subscribe((state) => {
    if (state.nodes === lastNodes) return;
    lastNodes = state.nodes;
    recordGraphDiagnostic('persistenceSchedule');
    saveGraphData({ nodes: state.nodes });

    if (saveTimer) clearTimeout(saveTimer);
    recordGraphDiagnostic('normalizationTimeoutScheduled');
    // 归一化检查放到空闲时执行，且避免 JSON.stringify(全图) 的一次性大字符串开销。
    const runNormalizationCheck = () => {
      const latest = useGraphStore.getState().nodes;
      const normalized = normalizeGraphNodes(latest);
      if (normalized.length !== latest.length) {
        useGraphStore.setState({ nodes: normalized });
        return;
      }
      for (let i = 0; i < latest.length; i += 1) {
        const a = latest[i];
        const b = normalized[i];
        if (a !== b && (a.id !== b.id || a.parentId !== b.parentId || a.status !== b.status || a.name !== b.name)) {
          useGraphStore.setState({ nodes: normalized });
          return;
        }
      }
    };
    saveTimer = setTimeout(() => {
      const win = window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number };
      if (typeof win.requestIdleCallback === 'function') win.requestIdleCallback(runNormalizationCheck, { timeout: 2000 });
      else runNormalizationCheck();
    }, 1500);
  });
}

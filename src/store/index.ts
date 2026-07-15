// ============================================================
// Smart Timeline - zustand 全局状态管理（Liveblocks 同步版）
// ============================================================

import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { liveblocksClient } from './client';
import { createScopedStorage, readJsonStorage } from '@/utils/persistence';

import type { TimelineData, Task, TaskGroup, Note, Milestone, Block, SmartTaskHeader } from '@/types';
import { migrateMarkdownToBlocks, updateBlockHeader, deleteBlock, appendBlock, getValidGraphNodeIds } from '@/utils/blocks';
import { useEbbStore } from '@/ebb/store';
import { useGraphStore } from '@/graph/store';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { getProjectBlockSourceId } from '@/components/dailySchedule/sourceIds';

const STORAGE_KEY = 'smart-timeline-data';
const SYNC_SETTINGS_KEY = 'smart-timeline-liveblocks';
const timelineStorage = createScopedStorage('timeline_data');

interface SyncSettings {
  roomCode: string;
  enabled: boolean;
}

function loadSyncSettings(): SyncSettings {
  try {
    const raw = localStorage.getItem(SYNC_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { roomCode: '', enabled: false };
}

function saveSyncSettings(settings: SyncSettings) {
  localStorage.setItem(SYNC_SETTINGS_KEY, JSON.stringify(settings));
}

function getDefaultData(): TimelineData {
  const y = new Date().getFullYear();
  return {
    tasks: [
      // 蓝色系：产品规划 / 主线
      { id: 'demo-task-1', name: '产品规划', start: `${y}-01-05`, end: `${y}-02-28`, color: '#DBEAFE', blocks: [] },
      { id: 'demo-task-2', name: '设计评审', start: `${y}-03-01`, end: `${y}-04-15`, color: '#DBEAFE', blocks: [] },
      // 紫色系：开发阶段 / 核心业务
      { id: 'demo-task-3', name: '研发冲刺', start: `${y}-02-15`, end: `${y}-05-30`, color: '#EDE9FE', isMain: true, blocks: [] },
      // 绿色系：测试发布 / 已完成
      { id: 'demo-task-4', name: '测试与发布', start: `${y}-06-01`, end: `${y}-07-20`, color: '#D1FAE5', blocks: [] },
      // 橙黄色系：运营 / 里程碑
      { id: 'demo-task-5', name: '暑期运营', start: `${y}-07-10`, end: `${y}-08-25`, color: '#FEF3C7', blocks: [] },
      { id: 'demo-task-6', name: '年度复盘', start: `${y}-11-01`, end: `${y}-12-20`, color: '#DBEAFE', blocks: [] },
    ],
    groups: [
      {
        // 蓝色系：产品研发（分组外框 #60A5FA，内部任务 #DBEAFE）
        id: 'demo-group-1',
        name: '产品研发',
        start: `${y}-01-05`,
        end: `${y}-04-15`,
        color: '#60A5FA',
        autoDate: true,
        children: [
          { id: 'demo-task-1', name: '产品规划', start: `${y}-01-05`, end: `${y}-02-28`, color: '#DBEAFE', groupId: 'demo-group-1', blocks: [] },
          { id: 'demo-task-2', name: '设计评审', start: `${y}-03-01`, end: `${y}-04-15`, color: '#DBEAFE', groupId: 'demo-group-1', blocks: [] },
        ],
      },
      {
        // 紫色系：开发阶段（分组外框 #A78BFA，内部任务 #EDE9FE）
        id: 'demo-group-2',
        name: '开发阶段',
        start: `${y}-02-15`,
        end: `${y}-05-30`,
        color: '#A78BFA',
        autoDate: true,
        children: [
          { id: 'demo-task-3', name: '研发冲刺', start: `${y}-02-15`, end: `${y}-05-30`, color: '#EDE9FE', isMain: true, groupId: 'demo-group-2', blocks: [] },
        ],
      },
      {
        // 绿色系：测试发布（分组外框 #34D399，内部任务 #D1FAE5）
        id: 'demo-group-3',
        name: '测试发布',
        start: `${y}-06-01`,
        end: `${y}-07-20`,
        color: '#34D399',
        autoDate: true,
        children: [
          { id: 'demo-task-4', name: '测试与发布', start: `${y}-06-01`, end: `${y}-07-20`, color: '#D1FAE5', groupId: 'demo-group-3', blocks: [] },
        ],
      },
    ],
    notes: [
      { id: 'demo-note-1', name: '项目启动会', date: `${y}-01-05`, type: 'pin', color: '#F59E0B' },
      { id: 'demo-note-2', name: '春节假期', date: `${y}-01-28`, endDate: `${y}-02-04`, type: 'range', color: '#EF4444' },
      { id: 'demo-note-3', name: '中期检查', date: `${y}-06-15`, type: 'pin', color: '#3B82F6' },
    ],
    milestones: [
      { id: 'demo-ms-1', name: 'V1.0 上线', date: `${y}-05-30`, color: '#F59E0B' },
      { id: 'demo-ms-2', name: '年度总结', date: `${y}-12-20`, color: '#F59E0B' },
    ],
  };
}

function getInitialSyncData(): TimelineData {
  return getDefaultData();
}

function normalizeTask(task: Task): Task {
  const normalizedTask = { ...task } as Task & { markdown?: string };
  if (normalizedTask.markdown && (!normalizedTask.blocks || normalizedTask.blocks.length === 0)) {
    const blocks = migrateMarkdownToBlocks(task);
    delete normalizedTask.markdown;
    return { ...normalizedTask, blocks };
  }

  delete normalizedTask.markdown;
  return {
    ...normalizedTask,
    blocks: Array.isArray(normalizedTask.blocks) ? normalizedTask.blocks : [],
  };
}

function isValidTask(task: unknown): task is Task {
  if (!task || typeof task !== 'object') return false;
  const record = task as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.start === 'string'
    && typeof record.end === 'string';
}

function isValidNote(note: unknown): note is Note {
  if (!note || typeof note !== 'object') return false;
  const record = note as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.date === 'string'
    && (record.type === 'pin' || record.type === 'range');
}

function isValidMilestone(milestone: unknown): milestone is Milestone {
  if (!milestone || typeof milestone !== 'object') return false;
  const record = milestone as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.date === 'string';
}

function isValidGroup(group: unknown): group is TaskGroup {
  if (!group || typeof group !== 'object') return false;
  const record = group as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.start === 'string'
    && typeof record.end === 'string'
    && Array.isArray(record.children);
}

function normalizeTimelineData(data: TimelineData): TimelineData {
  return {
    tasks: Array.isArray(data?.tasks) ? data.tasks.filter(isValidTask).map(normalizeTask) : [],
    notes: Array.isArray(data?.notes) ? data.notes.filter(isValidNote) : [],
    milestones: Array.isArray(data?.milestones) ? data.milestones.filter(isValidMilestone) : [],
    groups: Array.isArray(data?.groups)
      ? data.groups
        .filter(isValidGroup)
        .map((group) => ({
          ...group,
          children: Array.isArray(group.children)
            ? group.children.filter(isValidTask).map((child) => ({
              ...normalizeTask(child),
              groupId: group.id,
            }))
            : [],
        }))
      : [],
  };
}

function getAllGraphNodeIds(header: SmartTaskHeader): string[] {
  const ids = new Set(getValidGraphNodeIds(header));
  if (typeof header.graphNodeId === 'string' && header.graphNodeId.trim()) {
    ids.add(header.graphNodeId);
  }
  return [...ids];
}

async function saveDataAsync(data: TimelineData) {
  try {
    await timelineStorage.setItem(STORAGE_KEY, data);
  } catch (e) {
    console.warn('[smart-timeline] IndexedDB 写入失败：', e);
  }
}

export function saveData(data: TimelineData) {
  saveDataAsync(data);
}

// ── Liveblocks 客户端初始化 ───────────────────────────────────

export { liveblocksClient } from './client';

// ── Store 接口定义 ─────────────────────────────────────────────

export type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface TimelineStore extends TimelineData {
  isHydrated: boolean;
  hydrateStore: () => Promise<void>;

  dockContext: 'none' | 'node-selected' | 'task-selected';
  setDockContext: (ctx: 'none' | 'node-selected' | 'task-selected') => void;
  isDockHovered: boolean;
  setIsDockHovered: (hovered: boolean) => void;

  syncEnabled: boolean;
  syncRoomCode: string;
  syncStatus: SyncStatus;

  enableSync: (roomCode: string) => void;
  disableSync: () => void;
  setSyncStatus: (status: SyncStatus) => void;

  addTask: (task: Task) => void;
  updateTask: (task: Task) => void;
  deleteTask: (taskId: string) => void;
  toggleTaskComplete: (taskId: string) => void;
  /** 更新任务的 blocks 数组（新数据载体） */
  updateTaskBlocks: (taskId: string, blocks: Block[]) => void;
  /** Removes references to graph nodes that no longer exist. */
  removeGraphNodeReferences: (graphNodeIds: string[]) => void;

  /** 更新指定 block 的 header 属性 */
  updateBlockHeader: (taskId: string, blockId: string, headerPatch: Partial<SmartTaskHeader>) => void;

  /** 更新指定 SmartTaskBlock 的 body（局部 patch，避免整体覆盖 blocks） */
  updateBlockBody: (taskId: string, blockId: string, body: string) => void;

  /** 更新指定 TextBlock 的 content（局部 patch，避免整体覆盖 blocks） */
  updateTextBlockContent: (taskId: string, blockId: string, content: string) => void;

  /** 删除指定 block */
  removeBlock: (taskId: string, blockId: string) => void;

  /** 向任务追加 block */
  appendBlock: (taskId: string, block: Block) => void;

  /** 批量追加 blocks（循环 appendBlock，避免整体覆盖 task） */
  extendTaskBlocks: (taskId: string, newBlocks: Block[]) => void;

  addGroup: (group: TaskGroup) => void;
  updateGroup: (group: TaskGroup) => void;
  deleteGroup: (groupId: string) => void;

  addNote: (note: Note) => void;
  updateNote: (note: Note) => void;
  deleteNote: (noteId: string) => void;

  addMilestone: (milestone: Milestone) => void;
  updateMilestone: (milestone: Milestone) => void;
  deleteMilestone: (milestoneId: string) => void;

  importData: (data: TimelineData) => void;
  replaceData: (data: TimelineData) => void;
  exportData: () => string;
}

// ── 创建 Store ─────────────────────────────────────────────────

export const useTimelineStore = create<WithLiveblocks<TimelineStore>>()(
  liveblocks(
    (set, get) => {
      const initialSyncSettings = loadSyncSettings();

      return {
        ...getInitialSyncData(),
        isHydrated: false,
        hydrateStore: async () => {
          try {
            let raw = await timelineStorage.getItem<TimelineData>(STORAGE_KEY);
            if (!raw) {
              const lsRaw = readJsonStorage<TimelineData>(STORAGE_KEY);
              if (lsRaw) {
                raw = lsRaw;
                await timelineStorage.setItem(STORAGE_KEY, raw);
                localStorage.removeItem(STORAGE_KEY);
              }
            } else if (typeof raw === 'string') {
              raw = JSON.parse(raw) as TimelineData;
            }

            if (raw) {
              set({
                ...normalizeTimelineData(raw),
                isHydrated: true,
              });
              return;
            }
          } catch (e) {
            console.warn('[smart-timeline] IndexedDB数据加载失败：', e);
          }
          set({ isHydrated: true });
        },
        syncEnabled: initialSyncSettings.enabled,
        syncRoomCode: initialSyncSettings.roomCode,
        syncStatus: 'disconnected' as SyncStatus,

        enableSync: (roomCode: string) => {
          const settings = { roomCode, enabled: true };
          saveSyncSettings(settings);
          set({ syncEnabled: true, syncRoomCode: roomCode });
        },

        disableSync: () => {
          const settings = { roomCode: '', enabled: false };
          saveSyncSettings(settings);
          set({ syncEnabled: false, syncRoomCode: '', syncStatus: 'disconnected' });
        },

        setSyncStatus: (status) => {
          set({ syncStatus: status });
        },

        dockContext: 'none',
        setDockContext: (ctx) => set({ dockContext: ctx }),
        isDockHovered: false,
        setIsDockHovered: (hovered) => set({ isDockHovered: hovered }),

        addTask: (task) => {
          set((state) => {
            const newData = { ...state, tasks: [...state.tasks, task] };
            saveData(newData);
            return newData;
          });
        },

        updateTask: (task) => {
          set((state) => {
            const tasks = state.tasks.map((t) => (t.id === task.id ? task : t));
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) => (c.id === task.id ? { ...task, groupId: g.id } : c)),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        deleteTask: (taskId) => {
          const state = get();
          const taskToDelete = state.tasks.find((t) => t.id === taskId);
          if (taskToDelete) {
            const sourceIds = taskToDelete.blocks
              .filter((b) => b.type === 'smart-task')
              .map((b) => getProjectBlockSourceId(taskId, b.id));
            if (sourceIds.length > 0) {
              setTimeout(() => {
                useDailyScheduleStore.getState().removeBySourceIds(sourceIds);
              }, 0);
            }
          }

          set((state) => {
            const tasks = state.tasks.filter((t) => t.id !== taskId);
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.filter((c) => c.id !== taskId),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        toggleTaskComplete: (taskId) => {
          set((state) => {
            const tasks = state.tasks.map((t) =>
              t.id === taskId ? { ...t, completed: !t.completed } : t
            );
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) =>
                c.id === taskId ? { ...c, completed: !c.completed } : c
              ),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        updateTaskBlocks: (taskId, blocks) => {
          const state = get();
          const oldTask = state.tasks.find((t) => t.id === taskId);
          if (oldTask) {
            const newBlockIds = new Set(blocks.map((b) => b.id));
            const removedSourceIds = oldTask.blocks
              .filter((b) => b.type === 'smart-task' && !newBlockIds.has(b.id))
              .map((b) => getProjectBlockSourceId(taskId, b.id));
            if (removedSourceIds.length > 0) {
              setTimeout(() => {
                useDailyScheduleStore.getState().removeBySourceIds(removedSourceIds);
              }, 0);
            }
          }

          const now = new Date().toISOString();
          set((state) => {
            const tasks = state.tasks.map((t) =>
              t.id === taskId
                ? { ...t, blocks, blocksUpdatedAt: now }
                : t
            );
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) =>
                c.id === taskId
                  ? { ...c, blocks, blocksUpdatedAt: now }
                  : c
              ),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        removeGraphNodeReferences: (graphNodeIds) => {
          const deletedIds = new Set(graphNodeIds.filter(Boolean));
          if (deletedIds.size === 0) return;

          const now = new Date().toISOString();
          set((state) => {
            let changed = false;
            const stripReferences = (task: Task): Task => {
              let taskChanged = false;
              const blocks = task.blocks.map((block) => {
                if (block.type !== 'smart-task') return block;

                const referencedIds = getAllGraphNodeIds(block.header);
                if (!referencedIds.some((nodeId) => deletedIds.has(nodeId))) return block;

                taskChanged = true;
                const remainingIds = referencedIds.filter((nodeId) => !deletedIds.has(nodeId));
                return {
                  ...block,
                  header: {
                    ...block.header,
                    graphNodeId: remainingIds[0],
                    graphNodeIds: remainingIds,
                  },
                };
              });

              if (!taskChanged) return task;
              changed = true;
              return { ...task, blocks, blocksUpdatedAt: now };
            };

            const tasks = state.tasks.map(stripReferences);
            const groups = state.groups.map((group) => ({
              ...group,
              children: group.children.map(stripReferences),
            }));
            if (!changed) return state;

            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        updateBlockHeader: (taskId, blockId, headerPatch) => {
          const now = new Date().toISOString();
          const syncPayloads: { action?: 'add' | 'remove'; graphNodeId: string; topicName: string; tag?: string; triggerSchedule?: boolean }[] = [];
          const nodesToActivate: string[] = [];
          const nodesToDeactivate: string[] = [];

          set((state) => {
            const tasks = state.tasks.map((t) => {
              if (t.id !== taskId) return t;
              
              const block = t.blocks.find(b => b.type === 'smart-task' && b.id === blockId);
              if (block && block.type === 'smart-task') {
                const header = { ...block.header, ...headerPatch };
                const oldGraphNodeIds = getValidGraphNodeIds(block.header);
                const newGraphNodeIds = getValidGraphNodeIds(header);
                
                const isNewlyCompleted = headerPatch.isCompleted === true && !block.header.isCompleted;
                const isNewlyUncompleted = headerPatch.isCompleted === false && block.header.isCompleted;
                const isAlreadyCompleted = block.header.isCompleted && headerPatch.isCompleted !== false;

                // 1. 如果触发了完成（从 false 变成 true）
                if (isNewlyCompleted && newGraphNodeIds.length > 0) {
                  nodesToActivate.push(...newGraphNodeIds);
                  newGraphNodeIds.forEach(nodeId => {
                    const graphNode = useGraphStore.getState().getNodeById(nodeId);
                    if (!graphNode) return; // 如果节点已被删除，不再生成复习任务
                    const actualTopicName = graphNode.name;
                    syncPayloads.push({
                      action: 'add',
                      graphNodeId: nodeId,
                      topicName: actualTopicName,
                      tag: header.title,
                      triggerSchedule: header.autoSyncEbb !== false
                    });
                  });
                } 
                // 2. 如果取消了完成（从 true 变成 false）
                else if (isNewlyUncompleted && oldGraphNodeIds.length > 0) {
                  oldGraphNodeIds.forEach(nodeId => {
                    // 检查是否还有其他已完成的任务绑定了同一个节点
                    let hasOtherCompleted = false;
                    for (const otherTask of state.tasks) {
                      for (const otherBlock of otherTask.blocks) {
                        if (otherBlock.type !== 'smart-task' || otherBlock.id === blockId) continue;
                        if (!otherBlock.header.isCompleted) continue;
                        
                        const otherGraphNodeIds = getValidGraphNodeIds(otherBlock.header);
                        if (otherGraphNodeIds.includes(nodeId)) {
                          hasOtherCompleted = true;
                          break;
                        }
                      }
                      if (hasOtherCompleted) break;
                    }

                    if (!hasOtherCompleted) {
                      nodesToDeactivate.push(nodeId);
                    }

                    const graphNode = useGraphStore.getState().getNodeById(nodeId);
                    if (!graphNode) return;
                    const actualTopicName = graphNode.name;
                    syncPayloads.push({
                      action: 'remove',
                      graphNodeId: nodeId,
                      topicName: actualTopicName,
                      tag: block.header.title,
                    });
                  });
                }
                // 3. 如果在已完成的状态下，修改了绑定的节点（例如新增或删除了某个节点的绑定）
                else if (isAlreadyCompleted && headerPatch.graphNodeIds) {
                  const addedNodes = newGraphNodeIds.filter(id => !oldGraphNodeIds.includes(id));
                  const removedNodes = oldGraphNodeIds.filter(id => !newGraphNodeIds.includes(id));

                  // 处理新增的绑定
                  if (addedNodes.length > 0) {
                    nodesToActivate.push(...addedNodes);
                    addedNodes.forEach(nodeId => {
                      const graphNode = useGraphStore.getState().getNodeById(nodeId);
                      if (!graphNode) return;
                      const actualTopicName = graphNode.name;
                      syncPayloads.push({
                        action: 'add',
                        graphNodeId: nodeId,
                        topicName: actualTopicName,
                        tag: header.title,
                        triggerSchedule: header.autoSyncEbb !== false
                      });
                    });
                  }

                  // 处理移除的绑定
                  if (removedNodes.length > 0) {
                    removedNodes.forEach(nodeId => {
                      let hasOtherCompleted = false;
                      for (const otherTask of state.tasks) {
                        for (const otherBlock of otherTask.blocks) {
                          if (otherBlock.type !== 'smart-task' || otherBlock.id === blockId) continue;
                          if (!otherBlock.header.isCompleted) continue;
                          const otherGraphNodeIds = getValidGraphNodeIds(otherBlock.header);
                          if (otherGraphNodeIds.includes(nodeId)) {
                            hasOtherCompleted = true;
                            break;
                          }
                        }
                        if (hasOtherCompleted) break;
                      }

                      if (!hasOtherCompleted) {
                        nodesToDeactivate.push(nodeId);
                      }

                      const graphNode = useGraphStore.getState().getNodeById(nodeId);
                      if (!graphNode) return;
                      const actualTopicName = graphNode.name;
                      syncPayloads.push({
                        action: 'remove',
                        graphNodeId: nodeId,
                        topicName: actualTopicName,
                        tag: block.header.title,
                      });
                    });
                  }
                }
              }

              const newBlocks = updateBlockHeader(t.blocks, blockId, headerPatch);
              return { ...t, blocks: newBlocks, blocksUpdatedAt: now };
            });
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) => {
                if (c.id !== taskId) return c;
                const newBlocks = updateBlockHeader(c.blocks, blockId, headerPatch);
                return { ...c, blocks: newBlocks, blocksUpdatedAt: now };
              }),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });

          // 执行 Ebb 拦截同步（在 set 之外调用，避免 store 嵌套更新问题）
          syncPayloads.forEach(payload => {
            useEbbStore.getState().syncTaskToEbb(payload);
          });

          nodesToActivate.forEach(nodeId => {
            useGraphStore.getState().updateNode(nodeId, { status: 'activated' });
          });
          nodesToDeactivate.forEach(nodeId => {
            useGraphStore.getState().updateNode(nodeId, { status: 'unactivated' });
          });
        },

        updateBlockBody: (taskId, blockId, body) => {
          const now = new Date().toISOString();
          set((state) => {
            const tasks = state.tasks.map((t) => {
              if (t.id !== taskId) return t;
              const newBlocks = (t.blocks ?? []).map((b) =>
                b.type === 'smart-task' && b.id === blockId ? { ...b, body } : b,
              );
              return { ...t, blocks: newBlocks, blocksUpdatedAt: now };
            });
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) => {
                if (c.id !== taskId) return c;
                const newBlocks = (c.blocks ?? []).map((b) =>
                  b.type === 'smart-task' && b.id === blockId ? { ...b, body } : b,
                );
                return { ...c, blocks: newBlocks, blocksUpdatedAt: now };
              }),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        updateTextBlockContent: (taskId, blockId, content) => {
          const now = new Date().toISOString();
          set((state) => {
            const tasks = state.tasks.map((t) => {
              if (t.id !== taskId) return t;
              const newBlocks = (t.blocks ?? []).map((b) =>
                b.type === 'text' && b.id === blockId ? { ...b, content } : b,
              );
              return { ...t, blocks: newBlocks, blocksUpdatedAt: now };
            });
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) => {
                if (c.id !== taskId) return c;
                const newBlocks = (c.blocks ?? []).map((b) =>
                  b.type === 'text' && b.id === blockId ? { ...b, content } : b,
                );
                return { ...c, blocks: newBlocks, blocksUpdatedAt: now };
              }),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        removeBlock: (taskId, blockId) => {
          setTimeout(() => {
            useDailyScheduleStore.getState().removeBySourceIds([getProjectBlockSourceId(taskId, blockId)]);
          }, 0);

          const now = new Date().toISOString();
          set((state) => {
            const tasks = state.tasks.map((t) => {
              if (t.id !== taskId) return t;
              return { ...t, blocks: deleteBlock(t.blocks, blockId), blocksUpdatedAt: now };
            });
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) => {
                if (c.id !== taskId) return c;
                return { ...c, blocks: deleteBlock(c.blocks, blockId), blocksUpdatedAt: now };
              }),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        appendBlock: (taskId, block) => {
          const now = new Date().toISOString();
          set((state) => {
            const tasks = state.tasks.map((t) => {
              if (t.id !== taskId) return t;
              return { ...t, blocks: appendBlock(t.blocks, block), blocksUpdatedAt: now };
            });
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) => {
                if (c.id !== taskId) return c;
                return { ...c, blocks: appendBlock(c.blocks, block), blocksUpdatedAt: now };
              }),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        extendTaskBlocks: (taskId, newBlocks) => {
          if (newBlocks.length === 0) return;
          const now = new Date().toISOString();
          set((state) => {
            const tasks = state.tasks.map((t) => {
              if (t.id !== taskId) return t;
              return { ...t, blocks: [...(t.blocks ?? []), ...newBlocks], blocksUpdatedAt: now };
            });
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) => {
                if (c.id !== taskId) return c;
                return { ...c, blocks: [...(c.blocks ?? []), ...newBlocks], blocksUpdatedAt: now };
              }),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        addGroup: (group) => {
          set((state) => {
            const newChildIds = new Set(group.children.map((c) => c.id));
            // 更新 tasks：打上 groupId 标记
            const newTasks = state.tasks.map((t) => {
              if (newChildIds.has(t.id)) {
                return { ...t, groupId: group.id };
              }
              return t;
            });
            // 从其他分组的 children 中移除已纳入本分组的任务（保证单一分组）
            const newGroups = state.groups.map((g) => {
              const conflicting = g.children.some((c) => newChildIds.has(c.id));
              if (!conflicting) return g;
              return { ...g, children: g.children.filter((c) => !newChildIds.has(c.id)) };
            });
            const newData = { ...state, tasks: newTasks, groups: [...newGroups, group] };
            saveData(newData);
            return newData;
          });
        },

        updateGroup: (group) => {
          set((state) => {
            const newChildIds = new Set(group.children.map((c) => c.id));
            // 找出从其他分组移入本分组的任务 ID（之前 groupId 不是当前分组，但现在被选中）
            const movedInIds = new Set<string>();
            for (const childId of newChildIds) {
              const task = state.tasks.find((t) => t.id === childId);
              if (task && task.groupId && task.groupId !== group.id) {
                movedInIds.add(childId);
              }
            }
            // 更新 tasks：本分组移入/移出的任务同步 groupId
            const newTasks = state.tasks.map((t) => {
              if (t.groupId === group.id) {
                // 原本属于此分组：若仍在新的 children 中则保留，否则清除 groupId
                if (newChildIds.has(t.id)) {
                  return { ...t, groupId: group.id };
                }
                return { ...t, groupId: undefined };
              }
              // 非本分组的任务：若出现在新 children 中，则纳入本分组
              if (newChildIds.has(t.id)) {
                return { ...t, groupId: group.id };
              }
              return t;
            });
            // 从其他分组的 children 中移除已移入本分组的任务（保证单一分组）
            const groups = state.groups.map((g) => {
              if (g.id === group.id) return group; // 当前分组用新的替换
              if (movedInIds.size === 0) return g;
              const conflicting = g.children.some((c) => movedInIds.has(c.id));
              if (!conflicting) return g;
              return { ...g, children: g.children.filter((c) => !movedInIds.has(c.id)) };
            });
            const newData = { ...state, tasks: newTasks, groups };
            saveData(newData);
            return newData;
          });
        },

        deleteGroup: (groupId) => {
          set((state) => {
            const groups = state.groups.filter((g) => g.id !== groupId);
            const tasks = state.tasks.map((t) =>
              t.groupId === groupId ? { ...t, groupId: undefined } : t
            );
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
        },

        addNote: (note) => {
          set((state) => {
            const newData = { ...state, notes: [...state.notes, note] };
            saveData(newData);
            return newData;
          });
        },

        updateNote: (note) => {
          set((state) => {
            const notes = state.notes.map((n) => (n.id === note.id ? note : n));
            const newData = { ...state, notes };
            saveData(newData);
            return newData;
          });
        },

        deleteNote: (noteId) => {
          set((state) => {
            const notes = state.notes.filter((n) => n.id !== noteId);
            const newData = { ...state, notes };
            saveData(newData);
            return newData;
          });
        },

        addMilestone: (milestone) => {
          set((state) => {
            const newData = { ...state, milestones: [...state.milestones, milestone] };
            saveData(newData);
            return newData;
          });
        },

        updateMilestone: (milestone) => {
          set((state) => {
            const milestones = state.milestones.map((m) => (m.id === milestone.id ? milestone : m));
            const newData = { ...state, milestones };
            saveData(newData);
            return newData;
          });
        },

        deleteMilestone: (milestoneId) => {
          set((state) => {
            const milestones = state.milestones.filter((m) => m.id !== milestoneId);
            const newData = { ...state, milestones };
            saveData(newData);
            return newData;
          });
        },

        importData: (data) => {
          const normalized = normalizeTimelineData(data);

          // 按 id 合并：保留本地未在导入数据中的条目，避免多端并发场景下
          // 整体覆盖冲掉他端刚刚更新的字段。同 id 时以导入数据为准。
          const current = get();
          const mergeById = <T extends { id: string }>(existing: T[], imported: T[]): T[] => {
            const importedIds = new Set(imported.map((x) => x.id));
            return [...existing.filter((x) => !importedIds.has(x.id)), ...imported];
          };
          const merged: TimelineData = {
            tasks: mergeById(current.tasks, normalized.tasks),
            notes: mergeById(current.notes, normalized.notes),
            milestones: mergeById(current.milestones, normalized.milestones),
            groups: mergeById(current.groups, normalized.groups),
          };
          saveData(merged);
          set(merged);
        },

        replaceData: (data) => {
          const normalized = normalizeTimelineData(data);
          saveData(normalized);
          set(normalized);
        },

        exportData: () => {
          const { tasks, groups, notes, milestones } = get();
          return JSON.stringify({ tasks, groups, notes, milestones }, null, 2);
        },
      };
    },
    {
      client: liveblocksClient,
      storageMapping: {
        tasks: true,
        groups: true,
        notes: true,
        milestones: true,
      },
    }
  )
);

// ── 远端 Liveblocks 推送同步落盘 ──────────────────────────────
// 各 setter 中已主动调用 saveData 落盘本地操作；但 Liveblocks 远端推送
// 仅触发 zustand set()，不会经过本地 saveData，导致 localStorage 落后于
// 实时状态。这里订阅 store 变化，数据切片引用变化时（含远端推送）防抖落盘。
//
// 同时承担 Bug#2 的 groups.children ↔ tasks 一致性修复：
// tasks 与 groups 是两个独立 Liveblocks storage key，按 LWW 合并。
// 当两个客户端同时改同组不同任务时，groups.children 中的某份任务副本可能
// 停留在旧值，与 tasks 中最新值不一致。这里在 tasks 引用变化但 groups
// 未变（典型的"仅远端推送 tasks"信号）时，主动把 groups.children 中
// 与 canonical tasks 不一致的子任务刷新为最新值，写回 groups。
{
  let lastTasks: unknown = null;
  let lastGroups: unknown = null;
  let lastNotes: unknown = null;
  let lastMilestones: unknown = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  useTimelineStore.subscribe((state) => {
    const tasksChanged = state.tasks !== lastTasks;
    const groupsChanged = state.groups !== lastGroups;

    // 仅数据切片引用变化时才落盘，syncStatus 等无关字段变化跳过
    if (
      !tasksChanged &&
      !groupsChanged &&
      state.notes === lastNotes &&
      state.milestones === lastMilestones
    ) {
      return;
    }
    lastTasks = state.tasks;
    lastGroups = state.groups;
    lastNotes = state.notes;
    lastMilestones = state.milestones;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveData({
        tasks: state.tasks,
        groups: state.groups,
        notes: state.notes,
        milestones: state.milestones,
      });
    }, 500);

    // ── Bug#2 一致性修复 ──
    // 仅当 tasks 引用变化但 groups 引用未变（典型的"仅远端推送 tasks"信号）
    // 时触发 reconciliation，避免每次都全量扫描。
    if (tasksChanged && !groupsChanged && state.groups.length > 0 && state.tasks.length > 0) {
      const taskMap = new Map(state.tasks.map((t) => [t.id, t]));
      let needsReconcile = false;
      const newGroups = state.groups.map((g) => {
        let groupChanged = false;
        // 同时处理两类不一致：
        //   1) canonical 存在但与 c 引用不同 → 用 canonical 替换 c（保留 groupId）
        //   2) canonical 不存在（孤儿）→ 返回 null 后过滤掉，避免幽灵分组框
        const newChildren = g.children
          .map((c): Task | null => {
            const canonical = taskMap.get(c.id);
            if (!canonical) {
              groupChanged = true;
              return null;
            }
            if (canonical !== c) {
              groupChanged = true;
              return { ...canonical, groupId: g.id };
            }
            return c;
          })
          .filter((c): c is Task => c !== null);
        if (groupChanged) {
          needsReconcile = true;
          return { ...g, children: newChildren };
        }
        return g;
      });
      if (needsReconcile) {
        // 写回一致后的 groups，下一次 subscribe 调用会发现 tasks/groups 均无变化 → 跳过，无循环风险
        useTimelineStore.setState({ groups: newGroups });
      }
    }
  });
}

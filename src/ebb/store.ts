// ============================================================
// Ebbinghaus 复习模块 - Zustand 全局状态（Liveblocks 同步版）
// 复用现有 liveblocksClient，独立 room 命名空间 ebb-{code}
// 与 Timeline 数据物理隔离
// ============================================================

import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import dayjs from 'dayjs';
import type {
  ReviewTask,
  InboxItem,
  StudyOutlineNode,
  UndoEntry,
  EbbSettings,
  EbbData,
  ComplexityLevel,
} from './types';
import {
  EBB_STORAGE_KEY,
  EBB_SYNC_SETTINGS_KEY,
  EBB_ROOM_PREFIX,
  DEFAULT_EBB_SETTINGS,
  getDefaultEbbData,
  TAG_COLOR_PALETTE,
} from './constants';
import { liveblocksClient } from '@/store';
import { genId, checkCanComplete } from './scheduler';

// ── 同步设置持久化 ──────────────────────────────────────────

interface EbbSyncSettings {
  roomCode: string;
  enabled: boolean;
}

function loadEbbSyncSettings(): EbbSyncSettings {
  try {
    const raw = localStorage.getItem(EBB_SYNC_SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return { roomCode: '', enabled: false };
}

function saveEbbSyncSettings(settings: EbbSyncSettings) {
  localStorage.setItem(EBB_SYNC_SETTINGS_KEY, JSON.stringify(settings));
}

// ── 数据加载/保存 ───────────────────────────────────────────

function loadEbbData(): EbbData {
  try {
    const raw = localStorage.getItem(EBB_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        reviewTasks: parsed.reviewTasks ?? [],
        inboxItems: parsed.inboxItems ?? [],
        outlineNodes: parsed.outlineNodes ?? [],
        ebbSettings: { ...DEFAULT_EBB_SETTINGS, ...(parsed.ebbSettings ?? {}) },
      };
    }
  } catch (e) {
    console.warn('[smart-ebb] 本地数据解析失败，已回退到默认数据：', e);
  }
  return getDefaultEbbData();
}

function saveEbbData(data: EbbData) {
  localStorage.setItem(EBB_STORAGE_KEY, JSON.stringify(data));
}

// ── 标签颜色自动分配 ────────────────────────────────────────

function ensureTagColors(tasks: ReviewTask[], settings: EbbSettings): EbbSettings {
  const existingTags = new Set(Object.keys(settings.tagColors));
  const newColors = { ...settings.tagColors };
  let paletteIdx = existingTags.size % TAG_COLOR_PALETTE.length;
  for (const t of tasks) {
    const tag = t.tag || '';
    if (tag && !newColors[tag]) {
      newColors[tag] = TAG_COLOR_PALETTE[paletteIdx % TAG_COLOR_PALETTE.length];
      paletteIdx++;
    }
  }
  return { ...settings, tagColors: newColors };
}

// ── Store 接口 ──────────────────────────────────────────────

export type EbbSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface EbbStore extends EbbData {
  syncEnabled: boolean;
  syncRoomCode: string;
  syncStatus: EbbSyncStatus;
  undoStack: UndoEntry[];

  enableSync: (roomCode: string) => void;
  disableSync: () => void;
  setSyncStatus: (status: EbbSyncStatus) => void;

  // 复习任务
  addReviewTasks: (tasks: ReviewTask[]) => void;
  updateReviewTask: (id: string, patch: Partial<ReviewTask>) => void;
  updateReviewTasks: (ids: string[], patch: Partial<ReviewTask>) => void;
  deleteReviewTask: (id: string) => void;
  deleteTopicTasks: (topicName: string) => void;
  toggleReviewTask: (id: string) => string | null; // 返回错误消息，null 表示成功
  clearAllTasks: () => void;
  rescheduleOverdue: (taskIds: string[]) => void;

  // 收件箱
  addInboxItem: (item: InboxItem) => void;
  updateInboxItem: (id: string, patch: Partial<InboxItem>) => void;
  deleteInboxItem: (id: string) => void;
  stageInboxItems: (ids: string[]) => void;
  generateTasksFromInbox: (ids: string[]) => ReviewTask[];

  // 大纲
  addOutlineNode: (node: StudyOutlineNode) => void;
  addOutlineNodes: (nodes: StudyOutlineNode[]) => void;
  updateOutlineNode: (id: string, patch: Partial<StudyOutlineNode>) => void;
  deleteOutlineNode: (id: string) => void;

  // 撤销
  pushUndo: (entry: UndoEntry) => void;
  popUndo: () => UndoEntry | null;
  clearUndo: () => void;

  // 设置
  updateSettings: (patch: Partial<EbbSettings>) => void;
  setTagColor: (tag: string, color: string) => void;
  toggleCollapsedGroup: (groupId: string) => void;
  setCalViewMode: (mode: 'month' | 'week') => void;

  // 导入导出
  importEbbData: (data: EbbData) => void;
  exportEbbData: () => string;
}

// ── 创建 Store ──────────────────────────────────────────────

export const useEbbStore = create<WithLiveblocks<EbbStore>>()(
  liveblocks(
    (set, get) => {
      const initial = loadEbbData();
      const initialSync = loadEbbSyncSettings();

      return {
        ...initial,
        ebbSettings: ensureTagColors(initial.reviewTasks, initial.ebbSettings),
        syncEnabled: initialSync.enabled,
        syncRoomCode: initialSync.roomCode,
        syncStatus: 'disconnected' as EbbSyncStatus,
        undoStack: [],

        enableSync: (roomCode) => {
          const settings = { roomCode, enabled: true };
          saveEbbSyncSettings(settings);
          set({ syncEnabled: true, syncRoomCode: roomCode });
        },

        disableSync: () => {
          const settings = { roomCode: '', enabled: false };
          saveEbbSyncSettings(settings);
          set({ syncEnabled: false, syncRoomCode: '', syncStatus: 'disconnected' });
        },

        setSyncStatus: (status) => {
          set({ syncStatus: status });
        },

        // ── 复习任务 ──────────────────────────────────────

        addReviewTasks: (tasks) => {
          set((state) => {
            const reviewTasks = [...state.reviewTasks, ...tasks];
            const ebbSettings = ensureTagColors(reviewTasks, state.ebbSettings);
            const newData: EbbData = {
              reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        updateReviewTask: (id, patch) => {
          set((state) => {
            const reviewTasks = state.reviewTasks.map((t) =>
              t.id === id ? { ...t, ...patch } : t,
            );
            const newData: EbbData = {
              reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        updateReviewTasks: (ids, patch) => {
          const idSet = new Set(ids);
          set((state) => {
            const reviewTasks = state.reviewTasks.map((t) =>
              idSet.has(t.id) ? { ...t, ...patch } : t,
            );
            const newData: EbbData = {
              reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        rescheduleOverdue: (taskIds) => {
          const todayStr = dayjs().format('YYYY-MM-DD');
          const idSet = new Set(taskIds);
          set((state) => {
            const reviewTasks = state.reviewTasks.map((t) =>
              idSet.has(t.id) ? { ...t, dueDate: todayStr, smStatus: 'scheduled' as const } : t,
            );
            const newData: EbbData = {
              reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        deleteReviewTask: (id) => {
          set((state) => {
            const deleted = state.reviewTasks.find((t) => t.id === id);
            const reviewTasks = state.reviewTasks.filter((t) => t.id !== id);
            const undoStack = deleted
              ? [
                  {
                    id: genId('undo'),
                    type: 'delete_topic' as const,
                    description: `删除「${deleted.topicName}」的第 ${getTaskRoundSafe(id, state.reviewTasks)} 轮`,
                    deletedTasks: [deleted],
                    timestamp: Date.now(),
                  },
                  ...state.undoStack,
                ].slice(0, state.ebbSettings.maxUndoStack)
              : state.undoStack;
            const newData: EbbData = {
              reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return { ...newData, undoStack };
          });
        },

        deleteTopicTasks: (topicName) => {
          set((state) => {
            const deleted = state.reviewTasks.filter((t) => t.topicName === topicName);
            const reviewTasks = state.reviewTasks.filter((t) => t.topicName !== topicName);
            const undoStack = deleted.length > 0
              ? [
                  {
                    id: genId('undo'),
                    type: 'delete_topic' as const,
                    description: `删除主题「${topicName}」（${deleted.length} 个任务）`,
                    deletedTasks: deleted,
                    timestamp: Date.now(),
                  },
                  ...state.undoStack,
                ].slice(0, state.ebbSettings.maxUndoStack)
              : state.undoStack;
            const newData: EbbData = {
              reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return { ...newData, undoStack };
          });
        },

        toggleReviewTask: (id) => {
          const state = get();
          const task = state.reviewTasks.find((t) => t.id === id);
          if (!task) return '任务不存在';

          // 取消完成：无需校验
          if (task.isCompleted) {
            set((s) => {
              const reviewTasks = s.reviewTasks.map((t) =>
                t.id === id
                  ? { ...t, isCompleted: false, completedDate: undefined, smStatus: 'scheduled' as const }
                  : t,
              );
              const newData: EbbData = {
                reviewTasks,
                inboxItems: s.inboxItems,
                outlineNodes: s.outlineNodes,
                ebbSettings: s.ebbSettings,
              };
              saveEbbData(newData);
              return newData;
            });
            return null;
          }

          // 完成前校验顺序
          const err = checkCanComplete(id, state.reviewTasks);
          if (err) return err;

          set((s) => {
            const reviewTasks = s.reviewTasks.map((t) =>
              t.id === id
                ? {
                    ...t,
                    isCompleted: true,
                    completedDate: dayjs().format('YYYY-MM-DD'),
                    smStatus: 'confirmed' as const,
                  }
                : t,
            );
            const newData: EbbData = {
              reviewTasks,
              inboxItems: s.inboxItems,
              outlineNodes: s.outlineNodes,
              ebbSettings: s.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
          return null;
        },

        clearAllTasks: () => {
          set((state) => {
            const undoStack = state.reviewTasks.length > 0
              ? [
                  {
                    id: genId('undo'),
                    type: 'delete_all' as const,
                    description: `清空所有任务（${state.reviewTasks.length} 个）`,
                    deletedTasks: [...state.reviewTasks],
                    timestamp: Date.now(),
                  },
                  ...state.undoStack,
                ].slice(0, state.ebbSettings.maxUndoStack)
              : state.undoStack;
            const newData: EbbData = {
              reviewTasks: [],
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return { ...newData, undoStack };
          });
        },

        // ── 收件箱 ────────────────────────────────────────

        addInboxItem: (item) => {
          set((state) => {
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems: [...state.inboxItems, item],
              outlineNodes: state.outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        updateInboxItem: (id, patch) => {
          set((state) => {
            const inboxItems = state.inboxItems.map((i) =>
              i.id === id ? { ...i, ...patch } : i,
            );
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        deleteInboxItem: (id) => {
          set((state) => {
            const inboxItems = state.inboxItems.filter((i) => i.id !== id);
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        stageInboxItems: (ids) => {
          set((state) => {
            const idSet = new Set(ids);
            const inboxItems = state.inboxItems.map((i) =>
              idSet.has(i.id) ? { ...i, status: 'staged' as const } : i,
            );
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        generateTasksFromInbox: (ids) => {
          const state = get();
          const idSet = new Set(ids);
          const items = state.inboxItems.filter((i) => idSet.has(i.id) && i.status === 'staged');
          const allGenerated: ReviewTask[] = [];

          for (const item of items) {
            if (!item.intervals || !item.startDate || item.intervals.length === 0) continue;
            // 临时构建生成输入，复用 scheduler
            const generated: ReviewTask[] = [];
            const start = dayjs(item.startDate);
            const topicDates = new Set<string>();
            for (const t of state.reviewTasks) {
              if (t.topicName === item.topicName) topicDates.add(t.dueDate);
            }
            for (let i = 0; i < item.intervals.length; i++) {
              const interval = item.intervals[i];
              let dueDate = start.add(interval, 'day').format('YYYY-MM-DD');
              while (topicDates.has(dueDate)) {
                dueDate = dayjs(dueDate).add(1, 'day').format('YYYY-MM-DD');
              }
              topicDates.add(dueDate);
              generated.push({
                id: genId('rt'),
                topicName: item.topicName,
                dueDate,
                isCompleted: false,
                tag: item.tag,
                complexity: item.complexity,
                smStatus: 'scheduled',
              });
            }
            allGenerated.push(...generated);
          }

          if (allGenerated.length > 0) {
            set((s) => {
              const reviewTasks = [...s.reviewTasks, ...allGenerated];
              const inboxItems = s.inboxItems.filter((i) => !idSet.has(i.id));
              const ebbSettings = ensureTagColors(reviewTasks, s.ebbSettings);
              const newData: EbbData = {
                reviewTasks,
                inboxItems,
                outlineNodes: s.outlineNodes,
                ebbSettings,
              };
              saveEbbData(newData);
              return newData;
            });
          }
          return allGenerated;
        },

        // ── 大纲 ──────────────────────────────────────────

        addOutlineNode: (node) => {
          set((state) => {
            const outlineNodes = [...state.outlineNodes, node];
            // 若有父节点，更新父节点的 childrenIds
            const updatedNodes = node.parentId
              ? outlineNodes.map((n) =>
                  n.id === node.parentId
                    ? { ...n, childrenIds: [...n.childrenIds, node.id] }
                    : n,
                )
              : outlineNodes;
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: updatedNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        addOutlineNodes: (newNodes) => {
          set((state) => {
            const outlineNodes = [...state.outlineNodes, ...newNodes];
            // 更新所有父节点的 childrenIds
            const parentIdSet = new Set(newNodes.filter((n) => n.parentId).map((n) => n.parentId!));
            const childMap = new Map<string, string[]>();
            for (const n of newNodes) {
              if (n.parentId) {
                const list = childMap.get(n.parentId) ?? [];
                list.push(n.id);
                childMap.set(n.parentId, list);
              }
            }
            const updatedNodes = outlineNodes.map((n) => {
              const children = childMap.get(n.id);
              if (children) return { ...n, childrenIds: [...n.childrenIds, ...children] };
              return n;
            });
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: updatedNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        updateOutlineNode: (id, patch) => {
          set((state) => {
            const outlineNodes = state.outlineNodes.map((n) =>
              n.id === id ? { ...n, ...patch } : n,
            );
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        deleteOutlineNode: (id) => {
          set((state) => {
            // 收集所有后代节点（级联删除）
            const toDelete = new Set<string>([id]);
            let changed = true;
            while (changed) {
              changed = false;
              for (const n of state.outlineNodes) {
                if (n.parentId && toDelete.has(n.parentId) && !toDelete.has(n.id)) {
                  toDelete.add(n.id);
                  changed = true;
                }
              }
            }
            const outlineNodes = state.outlineNodes
              .filter((n) => !toDelete.has(n.id))
              .map((n) => ({
                ...n,
                childrenIds: n.childrenIds.filter((cid) => !toDelete.has(cid)),
              }));
            // 关联任务清除 outlineNodeId
            const reviewTasks = state.reviewTasks.map((t) =>
              t.outlineNodeId && toDelete.has(t.outlineNodeId)
                ? { ...t, outlineNodeId: undefined }
                : t,
            );
            const newData: EbbData = {
              reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
        },

        // ── 撤销 ──────────────────────────────────────────

        pushUndo: (entry) => {
          set((state) => ({
            undoStack: [entry, ...state.undoStack].slice(0, state.ebbSettings.maxUndoStack),
          }));
        },

        popUndo: () => {
          const state = get();
          if (state.undoStack.length === 0) return null;
          const entry = state.undoStack[0];
          set((s) => {
            // 恢复任务
            const reviewTasks = [...s.reviewTasks, ...entry.deletedTasks];
            const newData: EbbData = {
              reviewTasks,
              inboxItems: s.inboxItems,
              outlineNodes: s.outlineNodes,
              ebbSettings: ensureTagColors(reviewTasks, s.ebbSettings),
            };
            saveEbbData(newData);
            return {
              ...newData,
              undoStack: s.undoStack.slice(1),
            };
          });
          return entry;
        },

        clearUndo: () => set({ undoStack: [] }),

        // ── 设置 ──────────────────────────────────────────

        updateSettings: (patch) => {
          set((state) => {
            const ebbSettings = { ...state.ebbSettings, ...patch };
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings,
            };
            saveEbbData(newData);
            return { ebbSettings };
          });
        },

        setTagColor: (tag, color) => {
          set((state) => {
            const ebbSettings = {
              ...state.ebbSettings,
              tagColors: { ...state.ebbSettings.tagColors, [tag]: color },
            };
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings,
            };
            saveEbbData(newData);
            return { ebbSettings };
          });
        },

        toggleCollapsedGroup: (groupId) => {
          set((state) => {
            const collapsed = state.ebbSettings.collapsedGroups.includes(groupId);
            const collapsedGroups = collapsed
              ? state.ebbSettings.collapsedGroups.filter((g) => g !== groupId)
              : [...state.ebbSettings.collapsedGroups, groupId];
            const ebbSettings = { ...state.ebbSettings, collapsedGroups };
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings,
            };
            saveEbbData(newData);
            return { ebbSettings };
          });
        },

        setCalViewMode: (mode) => {
          set((state) => {
            const ebbSettings = { ...state.ebbSettings, calViewMode: mode };
            const newData: EbbData = {
              reviewTasks: state.reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings,
            };
            saveEbbData(newData);
            return { ebbSettings };
          });
        },

        // ── 导入导出 ──────────────────────────────────────

        importEbbData: (data) => {
          const normalized: EbbData = {
            reviewTasks: data.reviewTasks ?? [],
            inboxItems: data.inboxItems ?? [],
            outlineNodes: data.outlineNodes ?? [],
            ebbSettings: { ...DEFAULT_EBB_SETTINGS, ...(data.ebbSettings ?? {}) },
          };
          saveEbbData(normalized);
          set({ ...normalized, undoStack: [] });
        },

        exportEbbData: () => {
          const { reviewTasks, inboxItems, outlineNodes, ebbSettings } = get();
          return JSON.stringify({ reviewTasks, inboxItems, outlineNodes, ebbSettings }, null, 2);
        },
      };
    },
    {
      client: liveblocksClient,
      storageMapping: {
        reviewTasks: true,
        inboxItems: true,
        outlineNodes: true,
        ebbSettings: true,
      },
    },
  ),
);

// ── 工具：安全获取轮次（避免循环依赖） ──────────────────────

function getTaskRoundSafe(taskId: string, tasks: ReviewTask[]): number {
  // 简化版：按 dueDate 排序查找
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return 0;
  const sameTopic = tasks
    .filter((t) => t.topicName === task.topicName)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return sameTopic.findIndex((t) => t.id === taskId) + 1;
}

// ── 派生数据 Hooks（轻量工具函数，避免引入复杂依赖） ─────────

export { EBB_ROOM_PREFIX };

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
  try {
    localStorage.setItem(EBB_STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    // 配额溢出或隐私模式下写入失败：不阻塞 store 更新（内存状态仍正确），
    // 提示用户导出清理。避免一次 setItem 失败导致后续 UI 与存储不一致。
    console.warn('[smart-ebb] 本地存储写入失败，数据可能无法持久化，请导出备份或清理旧数据：', e);
  }
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
  deleteReviewTask: (id: string) => void;
  toggleReviewTask: (id: string) => string | null; // 返回错误消息，null 表示成功
  clearAllTasks: () => void;
  rescheduleOverdue: (taskIds: string[]) => void;

  // 收件箱
  addInboxItem: (item: InboxItem) => void;
  updateInboxItem: (id: string, patch: Partial<InboxItem>) => void;
  deleteInboxItem: (id: string) => void;
  generateTasksFromInbox: (ids: string[]) => ReviewTask[];

  // 大纲
  addOutlineNode: (node: StudyOutlineNode) => void;
  addOutlineNodes: (nodes: StudyOutlineNode[]) => void;
  updateOutlineNode: (id: string, patch: Partial<StudyOutlineNode>) => void;
  deleteOutlineNode: (id: string) => void;

  // 撤销
  popUndo: () => UndoEntry | null;

  // 设置
  updateSettings: (patch: Partial<EbbSettings>) => void;
  setTagColor: (tag: string, color: string) => void;

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
            // 收集被删节点和任务（供撤销使用）
            const deletedNodes = state.outlineNodes.filter((n) => toDelete.has(n.id));
            const deletedTasks = state.reviewTasks.filter(
              (t) => t.outlineNodeId && toDelete.has(t.outlineNodeId),
            );
            const outlineNodes = state.outlineNodes
              .filter((n) => !toDelete.has(n.id))
              .map((n) => ({
                ...n,
                childrenIds: n.childrenIds.filter((cid) => !toDelete.has(cid)),
              }));
            // 级联删除：删除所有关联到被删节点的任务
            const reviewTasks = state.reviewTasks.filter(
              (t) => !t.outlineNodeId || !toDelete.has(t.outlineNodeId),
            );
            const newData: EbbData = {
              reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes,
              ebbSettings: state.ebbSettings,
            };
            saveEbbData(newData);
            // 推入撤销栈
            if (deletedNodes.length > 0 || deletedTasks.length > 0) {
              const rootNode = deletedNodes.find((n) => n.id === id);
              const undoEntry: UndoEntry = {
                id: genId('undo'),
                type: 'delete_node',
                description: `删除节点「${rootNode?.name ?? id}」及 ${deletedTasks.length} 个任务`,
                deletedTasks,
                deletedNodes,
                timestamp: Date.now(),
              };
              return {
                ...newData,
                undoStack: [undoEntry, ...state.undoStack].slice(0, state.ebbSettings.maxUndoStack),
              };
            }
            return newData;
          });
        },

        // ── 撤销 ──────────────────────────────────────────

        popUndo: () => {
          const state = get();
          if (state.undoStack.length === 0) return null;
          const entry = state.undoStack[0];
          set((s) => {
            // 恢复任务
            const reviewTasks = [...s.reviewTasks, ...entry.deletedTasks];
            // 恢复节点（如果有）
            let outlineNodes = s.outlineNodes;
            if (entry.deletedNodes && entry.deletedNodes.length > 0) {
              const existingIds = new Set(outlineNodes.map((n) => n.id));
              const nodesToRestore = entry.deletedNodes.filter((n) => !existingIds.has(n.id));
              // 收集需要重建父节点 childrenIds 的节点：parentId 存在且自身被恢复
              const restoreByParent = new Map<string, string[]>();
              for (const n of nodesToRestore) {
                if (n.parentId) {
                  const list = restoreByParent.get(n.parentId) ?? [];
                  list.push(n.id);
                  restoreByParent.set(n.parentId, list);
                }
              }
              outlineNodes = [...outlineNodes, ...nodesToRestore]
                .map((n) => {
                  // 若该节点是父节点，把恢复的子节点 id 加回 childrenIds（去重）
                  const restoreChildren = restoreByParent.get(n.id);
                  if (!restoreChildren) return n;
                  const existing = new Set(n.childrenIds);
                  const merged = [...n.childrenIds];
                  for (const cid of restoreChildren) {
                    if (!existing.has(cid)) merged.push(cid);
                  }
                  return { ...n, childrenIds: merged };
                })
                .sort((a, b) => a.orderIndex - b.orderIndex);
            }
            const newData: EbbData = {
              reviewTasks,
              inboxItems: s.inboxItems,
              outlineNodes,
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

        // ── 导入导出 ──────────────────────────────────────

        importEbbData: (data) => {
          // Schema 校验：过滤字段缺失/类型错误的条目，避免后续渲染崩溃
          const isValidReviewTask = (t: unknown): t is ReviewTask => {
            if (!t || typeof t !== 'object') return false;
            const r = t as Record<string, unknown>;
            return typeof r.id === 'string'
              && typeof r.topicName === 'string'
              && typeof r.dueDate === 'string'
              && typeof r.isCompleted === 'boolean';
          };
          const isValidInboxItem = (i: unknown): i is InboxItem => {
            if (!i || typeof i !== 'object') return false;
            const r = i as Record<string, unknown>;
            return typeof r.id === 'string'
              && typeof r.topicName === 'string'
              && (r.status === 'draft' || r.status === 'staged');
          };
          const isValidOutlineNode = (n: unknown): n is StudyOutlineNode => {
            if (!n || typeof n !== 'object') return false;
            const r = n as Record<string, unknown>;
            return typeof r.id === 'string'
              && typeof r.name === 'string'
              && (r.type === 'book' || r.type === 'chapter' || r.type === 'section');
          };

          const normalized: EbbData = {
            reviewTasks: Array.isArray(data?.reviewTasks) ? data.reviewTasks.filter(isValidReviewTask) : [],
            inboxItems: Array.isArray(data?.inboxItems) ? data.inboxItems.filter(isValidInboxItem) : [],
            outlineNodes: Array.isArray(data?.outlineNodes) ? data.outlineNodes.filter(isValidOutlineNode) : [],
            ebbSettings: { ...DEFAULT_EBB_SETTINGS, ...(data?.ebbSettings ?? {}) },
          };

          // 按 id 合并：保留本地未在导入数据中的条目，避免多端并发场景下
          // 整体覆盖冲掉他端刚刚更新的字段。同 id 时以导入数据为准。
          const current = get();
          const mergeById = <T extends { id: string }>(existing: T[], imported: T[]): T[] => {
            const importedIds = new Set(imported.map((x) => x.id));
            return [...existing.filter((x) => !importedIds.has(x.id)), ...imported];
          };
          const merged: EbbData = {
            reviewTasks: mergeById(current.reviewTasks, normalized.reviewTasks),
            inboxItems: mergeById(current.inboxItems, normalized.inboxItems),
            outlineNodes: mergeById(current.outlineNodes, normalized.outlineNodes),
            ebbSettings: normalized.ebbSettings,
          };
          saveEbbData(merged);
          set({ ...merged, undoStack: [] });
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
    .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
  return sameTopic.findIndex((t) => t.id === taskId) + 1;
}

// ── 派生数据 Hooks（轻量工具函数，避免引入复杂依赖） ─────────

export { EBB_ROOM_PREFIX };

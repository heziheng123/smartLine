// ============================================================
// Ebbinghaus 复习模块 - Zustand 全局状态（Liveblocks 同步版）
// 复用现有 liveblocksClient，独立 room 命名空间 ebb-{code}
// 与 Timeline 数据物理隔离
// ============================================================

import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { createScopedStorage, readJsonStorage, writeJsonStorage } from '@/utils/persistence';

import { todayStr, addDays, diffDays } from '@/utils/dateSafe';
import type {
  ReviewTask,
  InboxItem,
  StudyOutlineNode,
  UndoEntry,
  EbbSettings,
  EbbData,
  SyncTaskToEbbPayload,
} from './types';
import {
  EBB_STORAGE_KEY,
  EBB_SYNC_SETTINGS_KEY,
  EBB_ROOM_PREFIX,
  DEFAULT_EBB_SETTINGS,
  getDefaultEbbData,
  TAG_COLOR_PALETTE,
} from './constants';
import { liveblocksClient } from '@/store/client';
import { genId, getReviewTopicKey, checkCanComplete, normalizeReviewRoundOrders } from './scheduler';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { getReviewSourceId } from '@/components/dailySchedule/sourceIds';

const ebbStorage = createScopedStorage('ebb_data');

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

function getInitialEbbData(): EbbData {
  return getDefaultEbbData();
}

const EBB_STORAGE_MIRROR_KEY = `${EBB_STORAGE_KEY}:mirror`;

async function saveEbbDataAsync(data: EbbData) {
  try {
    await ebbStorage.setItem(EBB_STORAGE_KEY, data);
  } catch (e) {
    console.warn('[smart-ebb] IndexedDB 写入失败：', e);
  }
}

function saveEbbData(data: EbbData) {
  writeJsonStorage(EBB_STORAGE_MIRROR_KEY, data, 'smart-ebb');
  saveEbbDataAsync(data);
}

function buildAbsoluteScheduleDates(baseDate: string, intervals: number[], count = intervals.length): string[] {
  if (intervals.length === 0 || count <= 0) return [];
  const lastIndex = intervals.length - 1;
  return Array.from({ length: count }, (_, index) => {
    const overflowDays = Math.max(0, index - lastIndex);
    const interval = intervals[Math.min(index, lastIndex)] + overflowDays;
    return addDays(baseDate, interval);
  });
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

function isValidDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function isValidReviewTask(value: unknown): value is ReviewTask {
  if (!value || typeof value !== 'object') return false;
  const task = value as Record<string, unknown>;
  return typeof task.id === 'string' && task.id.trim().length > 0
    && typeof task.topicName === 'string'
    && isValidDateString(task.dueDate)
    && typeof task.isCompleted === 'boolean';
}

function isValidInboxItem(value: unknown): value is InboxItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.trim().length > 0
    && typeof item.topicName === 'string'
    && typeof item.createdAt === 'string'
    && (item.status === 'draft' || item.status === 'staged');
}

function isValidOutlineNode(value: unknown): value is StudyOutlineNode {
  if (!value || typeof value !== 'object') return false;
  const node = value as Record<string, unknown>;
  return typeof node.id === 'string' && node.id.trim().length > 0
    && typeof node.name === 'string'
    && (node.type === 'book' || node.type === 'chapter' || node.type === 'section')
    && (node.parentId === null || typeof node.parentId === 'string')
    && Number.isFinite(node.orderIndex);
}

function deduplicateById<T extends { id: string }>(values: T[]): T[] {
  const byId = new Map<string, T>();
  values.forEach((value) => byId.set(value.id, value));
  return [...byId.values()];
}

function normalizeOutlineNodes(values: unknown[]): StudyOutlineNode[] {
  const nodes = deduplicateById(values.filter(isValidOutlineNode).map((node) => ({ ...node })));
  const ids = new Set(nodes.map((node) => node.id));
  nodes.forEach((node) => {
    if (!node.parentId || node.parentId === node.id || !ids.has(node.parentId)) node.parentId = null;
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const state = new Map<string, 'visiting' | 'visited'>();
  const breakCycles = (id: string) => {
    const node = byId.get(id);
    if (!node || state.get(id) === 'visited') return;
    state.set(id, 'visiting');
    if (node.parentId) {
      if (state.get(node.parentId) === 'visiting') node.parentId = null;
      else breakCycles(node.parentId);
    }
    state.set(id, 'visited');
  };
  nodes.forEach((node) => breakCycles(node.id));
  nodes.forEach((node) => { node.childrenIds = []; });
  nodes.forEach((node) => {
    if (node.parentId) byId.get(node.parentId)?.childrenIds.push(node.id);
  });
  nodes.forEach((node) => {
    node.childrenIds.sort((a, b) => (byId.get(a)?.orderIndex ?? 0) - (byId.get(b)?.orderIndex ?? 0));
  });
  return nodes.sort((a, b) => a.orderIndex - b.orderIndex);
}

export function normalizeEbbData(data: Partial<EbbData> | null | undefined): EbbData {
  const rawTasks = Array.isArray(data?.reviewTasks) ? data.reviewTasks : [];
  let reviewTasks = normalizeReviewRoundOrders(
    deduplicateById(rawTasks.filter(isValidReviewTask).map((task) => ({
      ...task,
      originalDueDate: isValidDateString(task.originalDueDate) ? task.originalDueDate : task.dueDate,
      completedDate: isValidDateString(task.completedDate)
        ? task.completedDate
        : task.isCompleted ? task.dueDate : undefined,
      isCompleted: task.isCompleted,
      scheduleCreatedDate: isValidDateString(task.scheduleCreatedDate) ? task.scheduleCreatedDate : undefined,
      scheduleSourceTaskId: typeof task.scheduleSourceTaskId === 'string' ? task.scheduleSourceTaskId : undefined,
      scheduleSourceBlockId: typeof task.scheduleSourceBlockId === 'string' ? task.scheduleSourceBlockId : undefined,
      completionSource: task.isCompleted && (task.completionSource === 'manual' || task.completionSource === 'project-task')
        ? task.completionSource
        : undefined,
      completionSourceTaskId: task.isCompleted && typeof task.completionSourceTaskId === 'string'
        ? task.completionSourceTaskId
        : undefined,
      completionSourceBlockId: task.isCompleted && typeof task.completionSourceBlockId === 'string'
        ? task.completionSourceBlockId
        : undefined,
      previousSchedule: task.isCompleted && Array.isArray(task.previousSchedule)
        ? task.previousSchedule.filter((entry) =>
            !!entry
            && typeof entry.reviewTaskId === 'string'
            && isValidDateString(entry.dueDate),
          )
        : undefined,
    }))),
  );
  const inboxItems = deduplicateById(
    (Array.isArray(data?.inboxItems) ? data.inboxItems : []).filter(isValidInboxItem),
  );
  const outlineNodes = normalizeOutlineNodes(
    Array.isArray(data?.outlineNodes) ? data.outlineNodes : [],
  );
  const outlineIds = new Set(outlineNodes.map((node) => node.id));
  reviewTasks = reviewTasks.map((task) =>
    task.outlineNodeId && !outlineIds.has(task.outlineNodeId)
      ? { ...task, outlineNodeId: undefined }
      : task,
  );
  const incomingSettings = data?.ebbSettings;
  const ebbSettings: EbbSettings = {
    ...DEFAULT_EBB_SETTINGS,
    ...(incomingSettings ?? {}),
    complexityConfigs: {
      ...DEFAULT_EBB_SETTINGS.complexityConfigs,
      ...(incomingSettings?.complexityConfigs ?? {}),
    },
    tagColors: { ...(incomingSettings?.tagColors ?? {}) },
    collapsedGroups: Array.isArray(incomingSettings?.collapsedGroups)
      ? incomingSettings.collapsedGroups
      : [],
    loadThresholds: Array.isArray(incomingSettings?.loadThresholds)
      && incomingSettings.loadThresholds.length === 4
      ? incomingSettings.loadThresholds
      : DEFAULT_EBB_SETTINGS.loadThresholds,
  };
  return {
    reviewTasks,
    inboxItems,
    outlineNodes,
    ebbSettings: ensureTagColors(reviewTasks, ebbSettings),
  };
}

// ── Store 接口 ──────────────────────────────────────────────

export type EbbSyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface EbbStore extends EbbData {
  isHydrated: boolean;
  hydrateStore: () => Promise<void>;

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
  rescheduleReviewRounds: (updates: Array<{ id: string; dueDate: string }>) => void;
  restartReviewCycle: (topicKey: string, startDate: string) => boolean;
  deleteReviewTask: (id: string) => void;
  toggleReviewTask: (id: string) => string | null; // 返回错误消息，null 表示成功
  clearAllTasks: () => void;
  removeGraphNodeReferences: (graphNodeIds: string[]) => void;
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
  replaceEbbData: (data: EbbData) => void;
  exportEbbData: () => string;

  // 新增：自动同步任务到 Ebb 复习流
  syncTaskToEbb: (payload: SyncTaskToEbbPayload) => void;
  // 新增：同步大盘节点名称修改
  updateTopicNameByGraphNodeId: (graphNodeId: string, newTopicName: string) => void;
}

// ── 创建 Store ──────────────────────────────────────────────

export const useEbbStore = create<WithLiveblocks<EbbStore>>()(
  liveblocks(
    (set, get) => {
      const initial = getInitialEbbData();
      const initialSync = loadEbbSyncSettings();

      return {
        ...initial,
        ebbSettings: ensureTagColors(initial.reviewTasks, initial.ebbSettings),
        isHydrated: false,
        hydrateStore: async () => {
          try {
            let raw = readJsonStorage<EbbData>(EBB_STORAGE_MIRROR_KEY)
              ?? await ebbStorage.getItem<EbbData>(EBB_STORAGE_KEY);
            if (!raw) {
              const lsRaw = readJsonStorage<EbbData>(EBB_STORAGE_KEY);
              if (lsRaw) {
                raw = lsRaw;
                await ebbStorage.setItem(EBB_STORAGE_KEY, raw);
                localStorage.removeItem(EBB_STORAGE_KEY);
              }
            } else if (typeof raw === 'string') {
              raw = JSON.parse(raw) as EbbData;
            }

            if (raw) {
              const normalized = normalizeEbbData(raw);
              set({
                ...normalized,
                isHydrated: true,
              });
              saveEbbData(normalized);
              return;
            }
          } catch (e) {
            console.warn('[smart-ebb] IndexedDB 数据解析失败：', e);
          }
          set({ isHydrated: true });
        },
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
            const reviewTasks = normalizeReviewRoundOrders([...state.reviewTasks, ...tasks]);
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
          const existingTask = get().reviewTasks.find((task) => task.id === id);
          if (patch.dueDate !== undefined && existingTask?.dueDate !== patch.dueDate) {
            setTimeout(() => {
              useDailyScheduleStore.getState().removeBySourceIds([getReviewSourceId(id)]);
            }, 0);
          }
          set((state) => {
            const reviewTasks = state.reviewTasks.map((t) =>
              t.id === id ? {
                ...t,
                ...patch,
                ...(patch.dueDate !== undefined && patch.dueDate !== t.dueDate
                  ? { originalDueDate: t.originalDueDate ?? t.dueDate }
                  : {}),
              } : t,
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

        rescheduleReviewRounds: (updates) => {
          if (updates.length === 0) return;
          const updateMap = new Map(updates.map((item) => [item.id, item.dueDate]));
          setTimeout(() => {
            useDailyScheduleStore.getState().removeBySourceIds(
              updates.map((item) => getReviewSourceId(item.id)),
            );
          }, 0);
          set((state) => {
            const reviewTasks = state.reviewTasks.map((task) => {
              const dueDate = updateMap.get(task.id);
              if (!dueDate || dueDate === task.dueDate) return task;
              return {
                ...task,
                dueDate,
                originalDueDate: task.originalDueDate ?? task.dueDate,
                smStatus: 'scheduled' as const,
              };
            });
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

        restartReviewCycle: (topicKey, startDate) => {
          const state = get();
          const activeTasks = state.reviewTasks
            .filter((task) => !task.isArchived && getReviewTopicKey(task) === topicKey)
            .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
          const template = activeTasks[activeTasks.length - 1];
          if (!template) return false;

          const intervals = template.complexity
            ? state.ebbSettings.complexityConfigs[template.complexity].intervals
            : (state.ebbSettings.customIntervals.split(',').map(Number).filter((value) => Number.isInteger(value) && value > 0));
          if (intervals.length === 0) return false;
          const dates = buildAbsoluteScheduleDates(startDate, intervals);
          const replacementTasks: ReviewTask[] = dates.map((dueDate, index) => ({
            id: genId('rt'),
            topicName: template.topicName,
            dueDate,
            originalDueDate: dueDate,
            roundOrder: index + 1,
            isCompleted: false,
            tag: template.tag,
            outlineNodeId: template.outlineNodeId,
            graphNodeId: template.graphNodeId,
            complexity: template.complexity,
            smStatus: 'scheduled',
          }));

          setTimeout(() => {
            useDailyScheduleStore.getState().removeBySourceIds(
              activeTasks.map((task) => getReviewSourceId(task.id)),
            );
          }, 0);
          set((current) => {
            const activeIds = new Set(activeTasks.map((task) => task.id));
            const reviewTasks = [
              ...current.reviewTasks.map((task) => activeIds.has(task.id) ? { ...task, isArchived: true } : task),
              ...replacementTasks,
            ];
            const newData: EbbData = {
              reviewTasks,
              inboxItems: current.inboxItems,
              outlineNodes: current.outlineNodes,
              ebbSettings: current.ebbSettings,
            };
            saveEbbData(newData);
            return newData;
          });
          return true;
        },

        rescheduleOverdue: (taskIds) => {
          const _today = todayStr();
          const idSet = new Set(taskIds);
          setTimeout(() => {
            useDailyScheduleStore.getState().removeBySourceIds(
              taskIds.map((id) => getReviewSourceId(id)),
            );
          }, 0);
          set((state) => {
            const reviewTasks = state.reviewTasks.map((t) =>
              idSet.has(t.id) ? { ...t, dueDate: _today, originalDueDate: t.originalDueDate ?? t.dueDate, smStatus: 'scheduled' as const } : t,
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
          setTimeout(() => {
            useDailyScheduleStore.getState().removeBySourceIds([getReviewSourceId(id)]);
          }, 0);
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

          // 取消完成：若后续轮次已经完成，则保护顺序，不允许回退中间轮次。
          if (task.isCompleted) {
            const taskOrder = task.roundOrder ?? 0;
            const hasLaterCompletedRound = state.reviewTasks.some((candidate) =>
              !candidate.isArchived
              && getReviewTopicKey(candidate) === getReviewTopicKey(task)
              && candidate.isCompleted
              && (candidate.roundOrder ?? 0) > taskOrder,
            );
            if (hasLaterCompletedRound) return '后续轮次已经完成，不能取消当前轮次';

            const previousSchedule = new Map(
              (task.previousSchedule ?? []).map((entry) => [entry.reviewTaskId, entry.dueDate]),
            );
            set((s) => {
              const reviewTasks = s.reviewTasks.map((t) =>
                t.id === id
                  ? {
                      ...t,
                      isCompleted: false,
                      completedDate: undefined,
                      smStatus: 'scheduled' as const,
                      completionSource: undefined,
                      completionSourceTaskId: undefined,
                      completionSourceBlockId: undefined,
                      previousSchedule: undefined,
                    }
                  : previousSchedule.has(t.id)
                    ? { ...t, dueDate: previousSchedule.get(t.id)! }
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
            if (previousSchedule.size > 0) {
              setTimeout(() => {
                useDailyScheduleStore.getState().removeBySourceIds(
                  [...previousSchedule.keys()].map((reviewTaskId) => getReviewSourceId(reviewTaskId)),
                );
              }, 0);
            }
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
                      completedDate: todayStr(),
                      smStatus: 'confirmed' as const,
                      completionSource: 'manual' as const,
                      completionSourceTaskId: undefined,
                      completionSourceBlockId: undefined,
                      previousSchedule: undefined,
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
          const state = get();
          const allSourceIds = state.reviewTasks.map((t) => getReviewSourceId(t.id));
          if (allSourceIds.length > 0) {
            setTimeout(() => {
              useDailyScheduleStore.getState().removeBySourceIds(allSourceIds);
            }, 0);
          }
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

        removeGraphNodeReferences: (graphNodeIds) => {
          const deletedIds = new Set(graphNodeIds.filter(Boolean));
          if (deletedIds.size === 0) return;

          const scheduledSourceIds = get().reviewTasks
            .filter((task) => task.graphNodeId && deletedIds.has(task.graphNodeId))
            .map((task) => getReviewSourceId(task.id));
          if (scheduledSourceIds.length > 0) {
            setTimeout(() => {
              useDailyScheduleStore.getState().removeBySourceIds(scheduledSourceIds);
            }, 0);
          }

          set((state) => {
            const reviewTasks = state.reviewTasks.filter(
              (task) => !task.graphNodeId || !deletedIds.has(task.graphNodeId),
            );
            if (reviewTasks.length === state.reviewTasks.length) return state;

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
            const topicDates = new Set<string>();
            for (const t of state.reviewTasks) {
              if (t.topicName === item.topicName) topicDates.add(t.dueDate);
            }
            for (let i = 0; i < item.intervals.length; i++) {
              const interval = item.intervals[i];
              let dueDate = addDays(item.startDate, interval);
              while (topicDates.has(dueDate)) {
                dueDate = addDays(dueDate, 1);
              }
              topicDates.add(dueDate);
              const existingTopicTasks = [...state.reviewTasks, ...allGenerated, ...generated]
                .filter((task) => !task.isArchived && task.topicName === item.topicName);
              const nextRoundOrder = Math.max(0, ...existingTopicTasks.map((task) => task.roundOrder ?? 0)) + 1;
              generated.push({
                id: genId('rt'),
                topicName: item.topicName,
                dueDate,
                originalDueDate: dueDate,
                roundOrder: nextRoundOrder,
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

            if (deletedTasks.length > 0) {
              const ids = deletedTasks.map((t) => getReviewSourceId(t.id));
              setTimeout(() => {
                useDailyScheduleStore.getState().removeBySourceIds(ids);
              }, 0);
            }

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
          const normalized = normalizeEbbData(data);

          // 按 id 合并：保留本地未在导入数据中的条目，避免多端并发场景下
          // 整体覆盖冲掉他端刚刚更新的字段。同 id 时以导入数据为准。
          const current = get();
          const mergeById = <T extends { id: string }>(existing: T[], imported: T[]): T[] => {
            const importedIds = new Set(imported.map((x) => x.id));
            return [...existing.filter((x) => !importedIds.has(x.id)), ...imported];
          };
          const merged = normalizeEbbData({
            reviewTasks: mergeById(current.reviewTasks, normalized.reviewTasks),
            inboxItems: mergeById(current.inboxItems, normalized.inboxItems),
            outlineNodes: mergeById(current.outlineNodes, normalized.outlineNodes),
            ebbSettings: normalized.ebbSettings,
          });
          saveEbbData(merged);
          set({ ...merged, undoStack: [] });
        },

        replaceEbbData: (data) => {
          const normalized = normalizeEbbData(data);
          saveEbbData(normalized);
          set({ ...normalized, undoStack: [] });
        },

        exportEbbData: () => {
          const { reviewTasks, inboxItems, outlineNodes, ebbSettings } = get();
          return JSON.stringify({ reviewTasks, inboxItems, outlineNodes, ebbSettings }, null, 2);
        },

        updateTopicNameByGraphNodeId: (graphNodeId, newTopicName) => {
          set((state) => {
            let changed = false;
            const reviewTasks = state.reviewTasks.map((t) => {
              if (t.graphNodeId === graphNodeId && t.topicName !== newTopicName) {
                changed = true;
                return { ...t, topicName: newTopicName };
              }
              return t;
            });
            if (!changed) return state;

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

        // ── 自动同步任务到 Ebb 复习流 ─────────────────────────────────

        syncTaskToEbb: (payload) => {
          const dailySourceIdsToRemove: string[] = [];
          set((state) => {
            const {
              action = 'add',
              graphNodeId,
              topicName,
              tag,
              triggerSchedule = true,
              sourceTaskId,
              sourceBlockId,
            } = payload;
            const existingTasks = state.reviewTasks
              .filter((task) => !task.isArchived && task.graphNodeId === graphNodeId)
              .sort((a, b) =>
                (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER),
              );

            if (action === 'revert-source') {
              if (!sourceTaskId || !sourceBlockId) return state;

              const supplementalIds = new Set(
                existingTasks
                  .filter((task) =>
                    task.isSupplemental
                    && !task.isCompleted
                    && task.scheduleSourceTaskId === sourceTaskId
                    && task.scheduleSourceBlockId === sourceBlockId,
                  )
                  .map((task) => task.id),
              );
              const target = existingTasks.find((task) =>
                task.completionSource === 'project-task'
                && task.completionSourceTaskId === sourceTaskId
                && task.completionSourceBlockId === sourceBlockId,
              );
              const targetOrder = target?.roundOrder ?? Number.MAX_SAFE_INTEGER;
              const hasLaterCompletedRound = !!target && existingTasks.some((task) =>
                task.isCompleted && (task.roundOrder ?? 0) > targetOrder,
              );
              if (!target && supplementalIds.size === 0) return state;

              const previousSchedule = !hasLaterCompletedRound
                ? new Map((target?.previousSchedule ?? []).map((entry) => [entry.reviewTaskId, entry.dueDate]))
                : new Map<string, string>();
              const changedScheduleIds = new Set(previousSchedule.keys());
              supplementalIds.forEach((id) => changedScheduleIds.add(id));
              dailySourceIdsToRemove.push(
                ...[...changedScheduleIds].map((id) => getReviewSourceId(id)),
              );

              const reviewTasks = state.reviewTasks
                .filter((task) => !supplementalIds.has(task.id))
                .map((task) => {
                  if (previousSchedule.has(task.id)) {
                    return { ...task, dueDate: previousSchedule.get(task.id)! };
                  }
                  if (target && task.id === target.id && !hasLaterCompletedRound) {
                    return {
                      ...task,
                      isCompleted: false,
                      completedDate: undefined,
                      smStatus: 'scheduled' as const,
                      completionSource: undefined,
                      completionSourceTaskId: undefined,
                      completionSourceBlockId: undefined,
                      previousSchedule: undefined,
                    };
                  }
                  return task;
                });
              const newData: EbbData = { ...state, reviewTasks };
              saveEbbData(newData);
              return newData;
            }

            if (action === 'remove') {
              const hasCompletedReview = existingTasks.some((task) => task.isCompleted);
              if (!hasCompletedReview) {
                dailySourceIdsToRemove.push(...existingTasks.map((task) => getReviewSourceId(task.id)));
                const newReviewTasks = state.reviewTasks.filter(
                  (task) => task.isArchived || task.graphNodeId !== graphNodeId,
                );
                const newData: EbbData = {
                  ...state,
                  reviewTasks: newReviewTasks,
                };
                saveEbbData(newData);
                return newData;
              }
              return state;
            }

            let newReviewTasks = [...state.reviewTasks];
            const nowStr = todayStr();
            if (!triggerSchedule) return state;

            if (existingTasks.length === 0) {
              const intervals = state.ebbSettings.complexityConfigs['normal'].intervals;
              const dueDates = buildAbsoluteScheduleDates(nowStr, intervals);
              const generated: ReviewTask[] = intervals.map((_, index) => ({
                  id: genId('rt'),
                  topicName,
                  tag,
                  graphNodeId,
                  dueDate: dueDates[index],
                  originalDueDate: dueDates[index],
                  roundOrder: index + 1,
                  isCompleted: false,
                  complexity: 'normal',
                  smStatus: 'scheduled',
                  scheduleCreatedDate: nowStr,
                  scheduleSourceTaskId: sourceTaskId,
                  scheduleSourceBlockId: sourceBlockId,
                }));
              newReviewTasks.push(...generated);
            } else {
              const sourceAlreadyHandled = !!sourceTaskId && !!sourceBlockId && existingTasks.some((task) =>
                (task.completionSourceTaskId === sourceTaskId && task.completionSourceBlockId === sourceBlockId)
                || (task.scheduleSourceTaskId === sourceTaskId && task.scheduleSourceBlockId === sourceBlockId),
              );
              if (sourceAlreadyHandled) return state;

              const hasReviewCompletedToday = existingTasks.some((task) =>
                task.isCompleted && task.completedDate === nowStr,
              );
              const planCreatedToday = existingTasks.some((task) => task.scheduleCreatedDate === nowStr);
              const uncompletedTasks = existingTasks.filter((task) => !task.isCompleted);

              if (uncompletedTasks.length > 0) {
                if (hasReviewCompletedToday || planCreatedToday) return state;
                const candidate = uncompletedTasks[0];
                if (candidate.dueDate > addDays(nowStr, 1)) return state;

                const delayDays = Math.max(0, diffDays(nowStr, candidate.dueDate));
                const laterTasks = uncompletedTasks.slice(1);
                const previousSchedule = delayDays > 0
                  ? laterTasks.map((task) => ({ reviewTaskId: task.id, dueDate: task.dueDate }))
                  : [];
                if (delayDays > 0) {
                  dailySourceIdsToRemove.push(...laterTasks.map((task) => getReviewSourceId(task.id)));
                }
                const laterIds = new Set(laterTasks.map((task) => task.id));
                newReviewTasks = newReviewTasks.map((task) => {
                  if (task.id === candidate.id) {
                    return {
                      ...task,
                      isCompleted: true,
                      completedDate: nowStr,
                      smStatus: 'confirmed' as const,
                      completionSource: 'project-task' as const,
                      completionSourceTaskId: sourceTaskId,
                      completionSourceBlockId: sourceBlockId,
                      previousSchedule: previousSchedule.length > 0 ? previousSchedule : undefined,
                    };
                  }
                  if (delayDays > 0 && laterIds.has(task.id)) {
                    return {
                      ...task,
                      dueDate: addDays(task.dueDate, delayDays),
                      originalDueDate: task.originalDueDate ?? task.dueDate,
                      smStatus: 'scheduled' as const,
                    };
                  }
                  return task;
                });
              } else {
                if (hasReviewCompletedToday || planCreatedToday) return state;
                const nextRoundOrder = Math.max(0, ...existingTasks.map((task) => task.roundOrder ?? 0)) + 1;
                const dueDate = addDays(nowStr, 1);
                newReviewTasks.push({
                  id: genId('rt'),
                  topicName,
                  tag,
                  graphNodeId,
                  dueDate,
                  originalDueDate: dueDate,
                  roundOrder: nextRoundOrder,
                  isCompleted: false,
                  complexity: 'normal',
                  smStatus: 'scheduled',
                  scheduleCreatedDate: nowStr,
                  scheduleSourceTaskId: sourceTaskId,
                  scheduleSourceBlockId: sourceBlockId,
                  isSupplemental: true,
                });
              }
            }

            const newData: EbbData = {
              ...state,
              reviewTasks: newReviewTasks,
            };
            saveEbbData(newData);
            return newData;
          });
          if (dailySourceIdsToRemove.length > 0) {
            setTimeout(() => {
              useDailyScheduleStore.getState().removeBySourceIds(dailySourceIdsToRemove);
            }, 0);
          }
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

// 远端 Liveblocks 推送同步落盘，同时为刷新前的瞬时写入提供本地镜像兜底。
{
  let lastReviewTasks: unknown = null;
  let lastInboxItems: unknown = null;
  let lastOutlineNodes: unknown = null;
  let lastEbbSettings: unknown = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  useEbbStore.subscribe((state) => {
    if (
      state.reviewTasks === lastReviewTasks &&
      state.inboxItems === lastInboxItems &&
      state.outlineNodes === lastOutlineNodes &&
      state.ebbSettings === lastEbbSettings
    ) {
      return;
    }

    lastReviewTasks = state.reviewTasks;
    lastInboxItems = state.inboxItems;
    lastOutlineNodes = state.outlineNodes;
    lastEbbSettings = state.ebbSettings;

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const latest = useEbbStore.getState();
      const current: EbbData = {
        reviewTasks: latest.reviewTasks,
        inboxItems: latest.inboxItems,
        outlineNodes: latest.outlineNodes,
        ebbSettings: latest.ebbSettings,
      };
      const normalized = normalizeEbbData(current);
      if (JSON.stringify(current) !== JSON.stringify(normalized)) {
        useEbbStore.setState({ ...normalized, undoStack: latest.undoStack });
        return;
      }
      saveEbbData(current);
    }, 500);
  });
}

// ── 工具：安全获取轮次（避免循环依赖） ──────────────────────

function getTaskRoundSafe(taskId: string, tasks: ReviewTask[]): number {
  // roundOrder is immutable for a chain; due dates are intentionally mutable.
  const task = tasks.find((t) => t.id === taskId);
  if (!task) return 0;
  const topicKey = getReviewTopicKey(task);
  const sameTopic = tasks
    .filter((t) => !t.isArchived && getReviewTopicKey(t) === topicKey)
    .sort((a, b) =>
      (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER)
      || (a.originalDueDate ?? a.dueDate ?? '').localeCompare(b.originalDueDate ?? b.dueDate ?? '')
      || a.id.localeCompare(b.id),
    );
  const stableRound = sameTopic.find((item) => item.id === taskId)?.roundOrder;
  return stableRound ?? sameTopic.findIndex((t) => t.id === taskId) + 1;
}

// ── 派生数据 Hooks（轻量工具函数，避免引入复杂依赖） ─────────

export { EBB_ROOM_PREFIX };

// ============================================================
// Ebbinghaus 复习模块 - Zustand 全局状态（Liveblocks 同步版）
// 复用现有 liveblocksClient，独立 room 命名空间 ebb-{code}
// 与 Timeline 数据物理隔离
// ============================================================

import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { isOperationRecordingSuppressed, recordOperation, registerUndoExecutor } from '@/services/operationHistory';

import { todayStr, addDays } from '@/utils/dateSafe';
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
  EBB_ROOM_PREFIX,
  getDefaultEbbData,
} from './constants';
import { liveblocksClient } from '@/store/client';
import {
  buildNextRoundTask,
  genId,
  getReviewTopicKey,
  checkCanComplete,
  normalizeReviewRoundOrders,
} from './scheduler';
import {
  captureDailySourceSnapshots,
  useDailyScheduleStore,
  type DailySourceSnapshot,
} from '@/components/dailySchedule/store';
import { getReviewSourceId } from '@/components/dailySchedule/sourceIds';
import {
  planBatchReviewAdjustment,
  type BatchReviewPlan,
  type BatchReviewRequest,
} from './batchAdjust';
import {
  buildAbsoluteScheduleDates,
  ensureTagColors,
  isValidEbbDate,
  normalizeEbbData,
  serializeReviewTasks,
} from './dataNormalization';
export { normalizeEbbData } from './dataNormalization';
import { loadEbbData, loadEbbSyncSettings, saveEbbData, saveEbbSyncSettings } from './persistence';
import { planEbbTaskSync } from './taskSyncPlanner';

// ── 数据加载/保存 ───────────────────────────────────────────

function getInitialEbbData(): EbbData {
  return getDefaultEbbData();
}

interface BatchReviewUndoPayload {
  topicKeys: string[];
  previousTasks: ReviewTask[];
  expectedTasks: ReviewTask[];
  undoSourceIdsToClear: string[];
  dailySnapshots: DailySourceSnapshot[];
}

interface ReviewRescheduleUndoPayload {
  previous: Array<{ id: string; dueDate: string }>;
  expected: Array<{ id: string; dueDate: string }>;
  dailySnapshots: DailySourceSnapshot[];
}

export type FinalReviewRoundDecision = 'finish' | 'append';

export interface CompleteFinalReviewRoundInput {
  taskId: string;
  decision: FinalReviewRoundDecision;
  nextDueDate?: string;
}

export type CompleteFinalReviewRoundResult =
  | {
      ok: true;
      decision: FinalReviewRoundDecision;
      topicName: string;
      completedRound: number;
      nextTask?: ReviewTask;
      operationId: string;
    }
  | { ok: false; error: string };

interface FinalReviewRoundUndoPayload {
  previousTask: ReviewTask;
  expectedCompletedTask: ReviewTask;
  appendedTask?: ReviewTask;
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
  restoreReviewReschedule: (payload: ReviewRescheduleUndoPayload) => string | null;
  applyBatchReviewAdjustment: (request: BatchReviewRequest) => BatchReviewPlan;
  restoreBatchReviewAdjustment: (payload: BatchReviewUndoPayload) => string | null;
  restartReviewCycle: (topicKey: string, startDate: string) => boolean;
  deleteReviewTask: (id: string) => void;
  toggleReviewTask: (id: string) => string | null; // 返回错误消息，null 表示成功
  completeFinalReviewRound: (input: CompleteFinalReviewRoundInput) => CompleteFinalReviewRoundResult;
  restoreFinalReviewRoundCompletion: (payload: FinalReviewRoundUndoPayload) => string | null;
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
            const normalized = await loadEbbData();
            if (normalized) {
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

        applyBatchReviewAdjustment: (request) => {
          const before = get();
          const plan = planBatchReviewAdjustment(before.reviewTasks, before.ebbSettings, request);
          if (plan.affectedTopics === 0) return plan;

          const changedKeys = new Set(
            plan.results.filter((result) => result.status === 'changed').map((result) => result.topicKey),
          );
          const previousTasks = plan.previousTasks.filter((task) => changedKeys.has(getReviewTopicKey(task)));
          const expectedTasks = plan.nextTasks.filter((task) => changedKeys.has(getReviewTopicKey(task)));
          const previousById = new Map(previousTasks.map((task) => [task.id, task]));
          const undoSourceIdsToClear = expectedTasks
            .filter((task) => {
              const previous = previousById.get(task.id);
              return !previous || previous.dueDate !== task.dueDate;
            })
            .map((task) => getReviewSourceId(task.id));
          const sourceIds = plan.sourceIdsToClear.map((id) => getReviewSourceId(id));
          const dailyState = useDailyScheduleStore.getState();
          const dailySnapshots = dailyState.isHydrated
            ? captureDailySourceSnapshots(dailyState.schedules, sourceIds)
            : [];

          set((state) => {
            const reviewTasks = normalizeReviewRoundOrders([
              ...state.reviewTasks.filter((task) => task.isArchived || !changedKeys.has(getReviewTopicKey(task))),
              ...expectedTasks,
            ]);
            const newData: EbbData = {
              reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: ensureTagColors(reviewTasks, state.ebbSettings),
            };
            saveEbbData(newData);
            return newData;
          });
          if (sourceIds.length > 0) dailyState.removeBySourceIds(sourceIds);

          if (!isOperationRecordingSuppressed()) {
            const actionLabel = request.action.kind === 'shift'
              ? '批量调整复习日期'
              : request.action.kind === 'trim'
                ? '批量精简复习轮次'
                : request.action.kind === 'append'
                  ? '批量追加复习轮次'
                  : '批量套用复习模板';
            const detailParts = [
              `${plan.affectedTopics} 个计划`,
              plan.rescheduledRounds > 0 ? `改期 ${plan.rescheduledRounds} 轮` : '',
              plan.removedRounds > 0 ? `删除 ${plan.removedRounds} 轮` : '',
              plan.addedRounds > 0 ? `新增 ${plan.addedRounds} 轮` : '',
              plan.skippedTopics > 0 ? `跳过 ${plan.skippedTopics} 个` : '',
            ].filter(Boolean);
            const payload: BatchReviewUndoPayload = {
              topicKeys: [...changedKeys],
              previousTasks,
              expectedTasks,
              undoSourceIdsToClear,
              dailySnapshots,
            };
            recordOperation({
              label: actionLabel,
              detail: detailParts.join(' · '),
              modules: ['EBB', '每日安排', '知识大盘'],
              undoSpec: { kind: 'ebb-batch-adjust', payload },
            }, () => get().restoreBatchReviewAdjustment(payload) ?? undefined);
          }
          return plan;
        },

        restoreBatchReviewAdjustment: (payload) => {
          const topicKeys = new Set(payload.topicKeys);
          const currentTasks = get().reviewTasks.filter((task) => !task.isArchived && topicKeys.has(getReviewTopicKey(task)));
          if (serializeReviewTasks(currentTasks) !== serializeReviewTasks(payload.expectedTasks)) {
            return '复习计划在此操作后又被修改';
          }
          set((state) => {
            const reviewTasks = normalizeReviewRoundOrders([
              ...state.reviewTasks.filter((task) => task.isArchived || !topicKeys.has(getReviewTopicKey(task))),
              ...payload.previousTasks,
            ]);
            const newData: EbbData = {
              reviewTasks,
              inboxItems: state.inboxItems,
              outlineNodes: state.outlineNodes,
              ebbSettings: ensureTagColors(reviewTasks, state.ebbSettings),
            };
            saveEbbData(newData);
            return newData;
          });
          const dailyState = useDailyScheduleStore.getState();
          dailyState.removeBySourceIds(payload.undoSourceIdsToClear);
          dailyState.restoreSourceSnapshots(payload.dailySnapshots);
          return null;
        },

        restoreReviewReschedule: (payload) => {
          const current = get().reviewTasks;
          if (payload.expected.some((item) => current.find((task) => task.id === item.id)?.dueDate !== item.dueDate)) {
            return '复习轮次在此操作后又被修改';
          }
          const previousById = new Map(payload.previous.map((item) => [item.id, item.dueDate]));
          set((state) => {
            const reviewTasks = state.reviewTasks.map((task) => {
              const dueDate = previousById.get(task.id);
              return dueDate === undefined ? task : { ...task, dueDate };
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
          const dailyState = useDailyScheduleStore.getState();
          dailyState.removeBySourceIds(payload.expected.map((item) => getReviewSourceId(item.id)));
          dailyState.restoreSourceSnapshots(payload.dailySnapshots ?? []);
          return null;
        },

        updateReviewTask: (id, patch) => {
          const existingTask = get().reviewTasks.find((task) => task.id === id);
          const dueDateChanged = Boolean(existingTask && patch.dueDate !== undefined && existingTask.dueDate !== patch.dueDate);
          const sourceIds = dueDateChanged ? [getReviewSourceId(id)] : [];
          const dailyState = useDailyScheduleStore.getState();
          const dailySnapshots = dueDateChanged && dailyState.isHydrated
            ? captureDailySourceSnapshots(dailyState.schedules, sourceIds)
            : [];
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
          if (dueDateChanged) dailyState.removeBySourceIds(sourceIds);
          if (existingTask && patch.dueDate !== undefined && patch.dueDate !== existingTask.dueDate && !isOperationRecordingSuppressed()) {
            const previous = [{ id, dueDate: existingTask.dueDate }];
            const expected = [{ id, dueDate: patch.dueDate }];
            const payload: ReviewRescheduleUndoPayload = { previous, expected, dailySnapshots };
            recordOperation({ label: `改期“${existingTask.topicName}”`, detail: `${existingTask.dueDate} → ${patch.dueDate}`, modules: ['EBB', '每日安排', '知识大盘'], undoSpec: { kind: 'ebb-reschedule', payload } },
              () => get().restoreReviewReschedule(payload) ?? undefined);
          }
        },

        rescheduleReviewRounds: (updates) => {
          if (updates.length === 0) return;
          const previous = updates.map((update) => ({ id: update.id, dueDate: get().reviewTasks.find((task) => task.id === update.id)?.dueDate ?? update.dueDate }));
          const changed = updates.filter((update, index) => update.dueDate !== previous[index]?.dueDate);
          if (changed.length === 0) return;
          const updateMap = new Map(changed.map((item) => [item.id, item.dueDate]));
          const sourceIds = changed.map((item) => getReviewSourceId(item.id));
          const dailyState = useDailyScheduleStore.getState();
          const dailySnapshots = dailyState.isHydrated
            ? captureDailySourceSnapshots(dailyState.schedules, sourceIds)
            : [];
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
          dailyState.removeBySourceIds(sourceIds);
          if (changed.length > 0 && !isOperationRecordingSuppressed()) {
            const expected = changed;
            const oldValues = previous.filter((item) => changed.some((change) => change.id === item.id));
            const payload: ReviewRescheduleUndoPayload = { previous: oldValues, expected, dailySnapshots };
            recordOperation({ label: `调整 ${changed.length} 个复习轮次`, detail: `${oldValues.map((item) => item.dueDate).join('、')} → ${expected.map((item) => item.dueDate).join('、')}`, modules: ['EBB', '每日安排', '知识大盘'], undoSpec: { kind: 'ebb-reschedule', payload } },
              () => get().restoreReviewReschedule(payload) ?? undefined);
          }
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
            tag: template.graphNodeId ? undefined : template.tag,
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
            if (!isOperationRecordingSuppressed()) recordOperation({ label: `取消完成复习“${task.topicName}”`, detail: '复习进度、每日安排和知识节点将统一恢复', modules: ['EBB', '每日安排', '知识大盘'], undoSpec: { kind: 'ebb-toggle', payload: { id, expectedCompleted: false } } }, () => get().toggleReviewTask(id) ?? undefined);
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
          if (!isOperationRecordingSuppressed()) recordOperation({ label: `完成复习“${task.topicName}”`, detail: '复习进度、每日安排和知识节点将统一恢复', modules: ['EBB', '每日安排', '知识大盘'], undoSpec: { kind: 'ebb-toggle', payload: { id, expectedCompleted: true } } }, () => get().toggleReviewTask(id) ?? undefined);
          return null;
        },

        completeFinalReviewRound: (input) => {
          const state = get();
          const task = state.reviewTasks.find((candidate) => candidate.id === input.taskId && !candidate.isArchived);
          if (!task) return { ok: false, error: '复习轮次已经不存在' };
          if (task.isCompleted) return { ok: false, error: '这一轮已经在其他位置完成' };

          const orderError = checkCanComplete(task.id, state.reviewTasks);
          if (orderError) return { ok: false, error: orderError };

          const topicKey = getReviewTopicKey(task);
          const topicTasks = state.reviewTasks
            .filter((candidate) => !candidate.isArchived && getReviewTopicKey(candidate) === topicKey)
            .sort((a, b) =>
              (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER)
              || (a.originalDueDate ?? a.dueDate ?? '').localeCompare(b.originalDueDate ?? b.dueDate ?? '')
              || a.id.localeCompare(b.id),
            );
          const currentIndex = topicTasks.findIndex((candidate) => candidate.id === task.id);
          if (currentIndex !== topicTasks.length - 1) {
            return { ok: false, error: '复习计划已出现新的后续轮次，请重新完成当前轮次' };
          }

          let nextTask: ReviewTask | undefined;
          if (input.decision === 'append') {
            const built = buildNextRoundTask(topicTasks, state.ebbSettings);
            if (!built) return { ok: false, error: '无法生成新的复习轮次' };
            const dueDate = input.nextDueDate ?? built.dueDate;
            if (!isValidEbbDate(dueDate)) {
              return { ok: false, error: '新的复习日期无效' };
            }
            if (dueDate < todayStr()) return { ok: false, error: '新的复习日期不能早于今天' };
            if (topicTasks.some((candidate) => candidate.dueDate === dueDate)) {
              return { ok: false, error: '同一主题在该日期已经有复习轮次' };
            }
            nextTask = {
              ...built,
              dueDate,
              originalDueDate: dueDate,
            };
          }

          const completedTask: ReviewTask = {
            ...task,
            isCompleted: true,
            completedDate: todayStr(),
            smStatus: 'confirmed',
            completionSource: 'manual',
            completionSourceTaskId: undefined,
            completionSourceBlockId: undefined,
            previousSchedule: undefined,
          };
          set((current) => {
            const latest = current.reviewTasks.find((candidate) => candidate.id === task.id);
            if (!latest || latest.isCompleted) return current;
            const reviewTasks = normalizeReviewRoundOrders([
              ...current.reviewTasks.map((candidate) => candidate.id === task.id ? completedTask : candidate),
              ...(nextTask ? [nextTask] : []),
            ]);
            const newData: EbbData = {
              reviewTasks,
              inboxItems: current.inboxItems,
              outlineNodes: current.outlineNodes,
              ebbSettings: ensureTagColors(reviewTasks, current.ebbSettings),
            };
            saveEbbData(newData);
            return newData;
          });

          const payload: FinalReviewRoundUndoPayload = {
            previousTask: task,
            expectedCompletedTask: completedTask,
            appendedTask: nextTask,
          };
          const operationId = isOperationRecordingSuppressed()
            ? ''
            : recordOperation({
                label: input.decision === 'append'
                  ? `完成并追加复习“${task.topicName}”`
                  : `完成最后一轮复习“${task.topicName}”`,
                detail: nextTask
                  ? `完成第 ${topicTasks.length} 轮 · 新增第 ${topicTasks.length + 1} 轮（${nextTask.dueDate}）`
                  : `完成第 ${topicTasks.length} 轮 · 当前复习计划结束`,
                modules: ['EBB', '每日安排', '知识大盘'],
                undoSpec: { kind: 'ebb-final-round', payload },
              }, () => get().restoreFinalReviewRoundCompletion(payload) ?? undefined);

          return {
            ok: true,
            decision: input.decision,
            topicName: task.topicName,
            completedRound: topicTasks.length,
            nextTask,
            operationId,
          };
        },

        restoreFinalReviewRoundCompletion: (payload) => {
          const state = get();
          const currentTask = state.reviewTasks.find((task) => task.id === payload.expectedCompletedTask.id);
          if (!currentTask || serializeReviewTasks([currentTask]) !== serializeReviewTasks([payload.expectedCompletedTask])) {
            return '已完成轮次在此操作后又被修改';
          }
          if (payload.appendedTask) {
            const currentAppended = state.reviewTasks.find((task) => task.id === payload.appendedTask!.id);
            if (!currentAppended || serializeReviewTasks([currentAppended]) !== serializeReviewTasks([payload.appendedTask])) {
              return '新增轮次在此操作后又被修改';
            }
          }

          set((current) => {
            const reviewTasks = normalizeReviewRoundOrders(current.reviewTasks
              .filter((task) => task.id !== payload.appendedTask?.id)
              .map((task) => task.id === payload.previousTask.id ? payload.previousTask : task));
            const newData: EbbData = {
              reviewTasks,
              inboxItems: current.inboxItems,
              outlineNodes: current.outlineNodes,
              ebbSettings: ensureTagColors(reviewTasks, current.ebbSettings),
            };
            saveEbbData(newData);
            return newData;
          });
          if (payload.appendedTask) {
            useDailyScheduleStore.getState().removeBySourceIds([getReviewSourceId(payload.appendedTask.id)]);
          }
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
          const before = get();
          const plan = planEbbTaskSync({
            reviewTasks: before.reviewTasks,
            ebbSettings: before.ebbSettings,
            payload,
          });
          if (!plan.changed) return;

          set((state) => {
            const newData: EbbData = {
              ...state,
              reviewTasks: plan.reviewTasks,
            };
            saveEbbData(newData);
            return newData;
          });
          if (plan.dailySourceIdsToRemove.length > 0) {
            setTimeout(() => {
              useDailyScheduleStore.getState().removeBySourceIds(plan.dailySourceIdsToRemove);
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

registerUndoExecutor('ebb-toggle', (raw) => {
  const payload = raw as { id: string; expectedCompleted: boolean };
  const state = useEbbStore.getState();
  const task = state.reviewTasks.find((item) => item.id === payload.id);
  if (!task) return '复习轮次已经不存在';
  if (task.isCompleted !== payload.expectedCompleted) return '复习轮次在此操作后又被修改';
  return state.toggleReviewTask(payload.id) ?? undefined;
});
registerUndoExecutor('ebb-final-round', (raw) => {
  return useEbbStore.getState().restoreFinalReviewRoundCompletion(raw as FinalReviewRoundUndoPayload) ?? undefined;
});
registerUndoExecutor('ebb-reschedule', (raw) => {
  return useEbbStore.getState().restoreReviewReschedule(raw as ReviewRescheduleUndoPayload) ?? undefined;
});
registerUndoExecutor('ebb-batch-adjust', (raw) => {
  return useEbbStore.getState().restoreBatchReviewAdjustment(raw as BatchReviewUndoPayload) ?? undefined;
});

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

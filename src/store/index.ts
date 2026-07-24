// ============================================================
// Smart Timeline - zustand 全局状态管理（Liveblocks 同步版）
// ============================================================

import { create } from 'zustand';
import { liveblocks } from '@liveblocks/zustand';
import type { WithLiveblocks } from '@liveblocks/zustand';
import { liveblocksClient } from './client';
import type { TimelineData, Task, TaskGroup, Note, Milestone, Block, SmartTaskHeader } from '@/types';
import {
  updateBlockHeader,
  deleteBlock,
  appendBlock,
  isQuantityTask,
  recoverRequiredTaskStartDate,
} from '@/utils/blocks';
import { useGraphStore } from '@/graph/store';
import {
  captureDailySourceSnapshots,
  useDailyScheduleStore,
  type DailySourceSnapshot,
} from '@/components/dailySchedule/store';
import { getProjectBlockSourceId } from '@/components/dailySchedule/sourceIds';
import { todayStr } from '@/utils/dateSafe';
import { isOperationRecordingSuppressed, recordOperation, registerUndoExecutor } from '@/services/operationHistory';
import { createWorkspaceTrackedSet } from '@/services/workspaceLocalWriteJournal';
import {
  planProjectTaskEffects,
  type CompletedTaskBindingStrategy,
} from '@/domain/projectTaskEffects';
import {
  commitProjectTaskEffects,
  EMPTY_PROJECT_TASK_EFFECT_COMMIT,
  type ProjectTaskEffectCommitReport,
} from '@/services/projectTaskEffectCommit';
import {
  getAllGraphNodeIds,
  getUniqueTasks,
  headerValueEquals,
  normalizeTimelineData,
} from './timelineData';
import {
  loadTimelineData,
  loadTimelineSyncSettings,
  saveTimelineData,
  saveTimelineSyncSettings,
} from './timelinePersistence';

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

export function saveData(data: TimelineData) {
  saveTimelineData(data);
}

export { persistTimelineData } from './timelinePersistence';

// ── Liveblocks 客户端初始化 ───────────────────────────────────

export { liveblocksClient } from './client';

// ── Store 接口定义 ─────────────────────────────────────────────

export type SyncStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface ProjectTaskHeaderUpdateResult extends ProjectTaskEffectCommitReport {
  changed: boolean;
  error?: string;
}

export interface ProjectTaskHeaderUpdateOptions {
  bindingStrategy?: CompletedTaskBindingStrategy;
}

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
  restoreTask: (task: Task, groupId?: string) => void;
  toggleTaskComplete: (taskId: string) => void;
  /** 更新任务的 blocks 数组（新数据载体） */
  updateTaskBlocks: (taskId: string, blocks: Block[]) => void;
  /** Removes references to graph nodes that no longer exist. */
  removeGraphNodeReferences: (graphNodeIds: string[]) => void;

  /** 更新指定 block 的 header 属性 */
  updateBlockHeader: (
    taskId: string,
    blockId: string,
    headerPatch: Partial<SmartTaskHeader>,
    options?: ProjectTaskHeaderUpdateOptions,
  ) => ProjectTaskHeaderUpdateResult;

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
    (setState, get) => {
      const set = createWorkspaceTrackedSet(setState, get, [
        'tasks',
        'groups',
        'notes',
        'milestones',
      ]);
      const initialSyncSettings = loadTimelineSyncSettings();

      return {
        ...getInitialSyncData(),
        isHydrated: false,
        hydrateStore: async () => {
          try {
            const normalized = await loadTimelineData();
            if (normalized) {
              set({
                ...normalized,
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
          saveTimelineSyncSettings(settings);
          set({ syncEnabled: true, syncRoomCode: roomCode });
        },

        disableSync: () => {
          const settings = { roomCode: '', enabled: false };
          saveTimelineSyncSettings(settings);
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
          const taskToDelete = state.tasks.find((t) => t.id === taskId)
            ?? state.groups.flatMap((group) => group.children).find((task) => task.id === taskId);
          if (taskToDelete) {
            for (const block of taskToDelete.blocks) {
              if (block.type === 'smart-task' && block.header.isCompleted) {
                get().updateBlockHeader(taskId, block.id, {
                  isCompleted: false,
                  completedDate: undefined,
                });
              }
            }
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
          const oldTask = state.tasks.find((t) => t.id === taskId)
            ?? state.groups.flatMap((group) => group.children).find((task) => task.id === taskId);
          if (!oldTask) return;

          const oldSmartBlocks = new Map(
            oldTask.blocks
              .filter((block) => block.type === 'smart-task')
              .map((block) => [block.id, block]),
          );
          const guardedBlocks = blocks.map((block) => {
            if (block.type !== 'smart-task' || !isQuantityTask(block.header) || block.header.date) {
              return block;
            }
            const previousDate = oldSmartBlocks.get(block.id)?.header.date;
            const recoveredDate = previousDate
              ?? recoverRequiredTaskStartDate(block.header, oldTask.start);
            return recoveredDate
              ? { ...block, header: { ...block.header, date: recoveredDate } }
              : block;
          });
          const newSmartBlocks = new Map(
            guardedBlocks
              .filter((block) => block.type === 'smart-task')
              .map((block) => [block.id, block]),
          );

          // Reuse the single-block action so batch edits and cross-group drags
          // receive exactly the same Daily/Graph/EBB side effects.
          for (const [blockId, oldBlock] of oldSmartBlocks) {
            const nextBlock = newSmartBlocks.get(blockId);
            if (!nextBlock) {
              if (oldBlock.header.isCompleted) {
                get().updateBlockHeader(taskId, blockId, {
                  isCompleted: false,
                  completedDate: undefined,
                });
              }
              useDailyScheduleStore.getState().removeBySourceIds([
                getProjectBlockSourceId(taskId, blockId),
              ]);
              continue;
            }
            if (JSON.stringify(oldBlock.header) !== JSON.stringify(nextBlock.header)) {
              get().updateBlockHeader(taskId, blockId, nextBlock.header);
            }
          }

          // Newly inserted completed rows need a false -> true transition so
          // graph activation and optional EBB scheduling are not skipped.
          const newCompletedIds = new Set(
            [...newSmartBlocks]
              .filter(([blockId, block]) => !oldSmartBlocks.has(blockId) && block.header.isCompleted)
              .map(([blockId]) => blockId),
          );
          const stagedBlocks = guardedBlocks.map((block) =>
            block.type === 'smart-task' && newCompletedIds.has(block.id)
              ? {
                  ...block,
                  header: { ...block.header, isCompleted: false, completedDate: undefined },
                }
              : block,
          );

          const now = new Date().toISOString();
          set((state) => {
            const tasks = state.tasks.map((t) =>
              t.id === taskId
                ? { ...t, blocks: stagedBlocks, blocksUpdatedAt: now }
                : t
            );
            const groups = state.groups.map((g) => ({
              ...g,
              children: g.children.map((c) =>
                c.id === taskId
                  ? { ...c, blocks: stagedBlocks, blocksUpdatedAt: now }
                  : c
              ),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });

          for (const blockId of newCompletedIds) {
            const block = newSmartBlocks.get(blockId);
            if (block) get().updateBlockHeader(taskId, blockId, block.header);
          }
        },

        restoreTask: (task, groupId) => {
          const completedBlocks = task.blocks.filter((block) => block.type === 'smart-task' && block.header.isCompleted);
          const restorableTask: Task = {
            ...task,
            blocks: task.blocks.map((block) => block.type === 'smart-task' && block.header.isCompleted
              ? { ...block, header: { ...block.header, isCompleted: false, completedDate: undefined } }
              : block),
          };
          set((state) => {
            const tasks = state.tasks.filter((item) => item.id !== task.id);
            const groups = state.groups.map((group) => ({
              ...group,
              children: group.children.filter((item) => item.id !== task.id),
            }));
            if (groupId) {
              const target = groups.find((group) => group.id === groupId);
              if (target) target.children.push({ ...restorableTask, groupId });
              else tasks.push(restorableTask);
            } else tasks.push(restorableTask);
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });
          // Replay completed transitions so graph activation, EBB scheduling and
          // derived daily state are restored through the same business path.
          for (const block of completedBlocks) {
            if (block.type !== 'smart-task') continue;
            get().updateBlockHeader(task.id, block.id, {
              isCompleted: true,
              completedDate: block.header.completedDate,
            });
          }
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

        updateBlockHeader: (taskId, blockId, headerPatch, options) => {
          const now = new Date().toISOString();
          const currentTask = getUniqueTasks(get().tasks, get().groups).find((task) => task.id === taskId);
          const currentBlock = currentTask?.blocks.find(
            (candidate) => candidate.type === 'smart-task' && candidate.id === blockId,
          );
          if (currentBlock?.type !== 'smart-task') {
            return {
              ...EMPTY_PROJECT_TASK_EFFECT_COMMIT,
              changed: false,
              error: '任务已经不存在或不再是项目任务。',
            };
          }

          const candidateHeader = { ...currentBlock.header, ...headerPatch };
          if (isQuantityTask(candidateHeader) && !candidateHeader.date) {
            console.warn('[smart-timeline] 数量任务必须保留开始日期，已忽略无效更新。');
            return {
              ...EMPTY_PROJECT_TASK_EFFECT_COMMIT,
              changed: false,
              error: '数量任务必须保留开始日期。',
            };
          }
          if (headerPatch.isCompleted === true && !currentBlock.header.isCompleted && !headerPatch.completedDate) {
            headerPatch = { ...headerPatch, completedDate: todayStr() };
          } else if (headerPatch.isCompleted === false) {
            headerPatch = { ...headerPatch, completedDate: undefined };
          }
          const changed = Object.entries(headerPatch).some(([key, value]) =>
            !headerValueEquals(currentBlock.header[key as keyof SmartTaskHeader], value),
          );
          if (!changed) return { ...EMPTY_PROJECT_TASK_EFFECT_COMMIT, changed: false };

          const datePatched = Object.prototype.hasOwnProperty.call(headerPatch, 'date');
          const nextHeader = { ...currentBlock.header, ...headerPatch };
          const dailySnapshots = datePatched && currentBlock.header.date !== nextHeader.date
            ? captureDailySourceSnapshots(
              useDailyScheduleStore.getState().schedules,
              [getProjectBlockSourceId(taskId, blockId)],
            )
            : [];
          const effectPlan = planProjectTaskEffects({
            tasks: getUniqueTasks(get().tasks, get().groups),
            taskId,
            blockId,
            currentHeader: currentBlock.header,
            nextHeader,
            graphNodes: useGraphStore.getState().nodes,
            bindingStrategy: options?.bindingStrategy,
          });

          set((state) => {
            const tasks = state.tasks.map((task) =>
              task.id === taskId
                ? { ...task, blocks: updateBlockHeader(task.blocks, blockId, headerPatch), blocksUpdatedAt: now }
                : task,
            );
            const groups = state.groups.map((group) => ({
              ...group,
              children: group.children.map((task) =>
                task.id === taskId
                  ? { ...task, blocks: updateBlockHeader(task.blocks, blockId, headerPatch), blocksUpdatedAt: now }
                  : task,
              ),
            }));
            const newData = { ...state, tasks, groups };
            saveData(newData);
            return newData;
          });

          const commitReport = commitProjectTaskEffects({
            taskId,
            blockId,
            currentHeader: currentBlock.header,
            nextHeader,
            effectPlan,
          });

          if (!isOperationRecordingSuppressed()) {
            const completionChanged = headerPatch.isCompleted !== undefined && headerPatch.isCompleted !== currentBlock.header.isCompleted;
            const dateChanged = datePatched && headerPatch.date !== currentBlock.header.date;
            const progressKeys = [
              'vocabularyRecords',
              'vocabularyInitialCompletedWords',
              'vocabularyTotalWords',
              'quantityRecords',
              'quantityInitialCompleted',
              'quantityTotal',
            ] as const satisfies readonly (keyof SmartTaskHeader)[];
            const changedProgressKeys = progressKeys.filter((key) =>
              Object.prototype.hasOwnProperty.call(headerPatch, key)
              && !headerValueEquals(headerPatch[key], currentBlock.header[key]),
            );
            const progressChanged = changedProgressKeys.length > 0;
            if (completionChanged || dateChanged || progressChanged) {
              const returnedToBacklog = dateChanged
                && Boolean(currentBlock.header.date)
                && !nextHeader.date;
              const previousPatch: Partial<SmartTaskHeader> = {};
              const expected: Partial<SmartTaskHeader> = {};
              if (completionChanged) {
                previousPatch.isCompleted = currentBlock.header.isCompleted;
                previousPatch.completedDate = currentBlock.header.completedDate;
                expected.isCompleted = headerPatch.isCompleted;
                expected.completedDate = headerPatch.completedDate;
              }
              if (dateChanged) {
                previousPatch.date = currentBlock.header.date;
                expected.date = headerPatch.date;
                if (Object.prototype.hasOwnProperty.call(headerPatch, 'frozenAt')) {
                  previousPatch.frozenAt = currentBlock.header.frozenAt;
                  expected.frozenAt = headerPatch.frozenAt;
                }
              }
              for (const key of changedProgressKeys) {
                Object.assign(previousPatch, { [key]: currentBlock.header[key] });
                Object.assign(expected, { [key]: headerPatch[key] });
              }
              recordOperation({
                label: progressChanged
                  ? `更新“${currentBlock.header.title}”的数量进度`
                  : completionChanged
                  ? `${headerPatch.isCompleted ? '完成' : '取消完成'}“${currentBlock.header.title}”`
                  : returnedToBacklog
                    ? `将“${currentBlock.header.title}”移回待排期箱`
                    : `改期“${currentBlock.header.title}”`,
                detail: progressChanged
                  ? '数量进度、完成状态与每日安排将作为一次操作统一恢复'
                  : completionChanged
                    ? '项目文档、每日安排、EBB 与知识节点将统一恢复'
                    : returnedToBacklog
                      ? `已清除 ${currentBlock.header.date} 的排期和每日安排；项目、标签、截止日与时长保持不变`
                      : `${currentBlock.header.date ?? '未排期'} → ${headerPatch.date ?? '未排期'}`,
                modules: completionChanged
                  ? ['项目文档', '每日安排', 'EBB', '知识大盘']
                  : dateChanged
                    ? ['项目文档', '周矩阵', '每日安排']
                    : ['项目文档', '每日安排'],
                undoSpec: {
                  kind: 'timeline-header',
                  payload: { taskId, blockId, patch: previousPatch, expected, dailySnapshots },
                },
              }, () => {
                const latestTask = getUniqueTasks(get().tasks, get().groups).find((task) => task.id === taskId);
                const latestBlock = latestTask?.blocks.find((block) => block.id === blockId);
                if (latestBlock?.type !== 'smart-task') return '任务已经不存在';
                if (Object.entries(expected).some(([key, value]) => !headerValueEquals(latestBlock.header[key as keyof SmartTaskHeader], value))) return '任务在此操作后又被修改';
                get().updateBlockHeader(taskId, blockId, previousPatch);
                useDailyScheduleStore.getState().restoreSourceSnapshots(dailySnapshots);
              });
            }
          }
          return { ...commitReport, changed: true };
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
          const currentTask = getUniqueTasks(get().tasks, get().groups).find((task) => task.id === taskId);
          const currentBlock = currentTask?.blocks.find((block) => block.id === blockId);
          if (currentBlock?.type === 'smart-task' && currentBlock.header.isCompleted) {
            get().updateBlockHeader(taskId, blockId, {
              isCompleted: false,
              completedDate: undefined,
            });
          }
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
          if (!isOperationRecordingSuppressed()) {
            const blockTitle = block.type === 'smart-task' ? block.header.title : '文本内容';
            recordOperation({
              label: `创建“${blockTitle}”`,
              detail: '已添加到项目文档，可统一撤销',
              modules: ['项目文档'],
              undoSpec: { kind: 'timeline-remove-created-block', payload: { taskId, blockId: block.id } },
            }, () => {
              const latestState = useTimelineStore.getState();
              const latestTask = getUniqueTasks(latestState.tasks, latestState.groups).find((item) => item.id === taskId);
              if (!latestTask?.blocks.some((item) => item.id === block.id)) return '新建任务已经不存在';
              latestState.removeBlock(taskId, block.id);
            });
          }
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

registerUndoExecutor('timeline-header', (raw) => {
  const payload = raw as {
    taskId: string;
    blockId: string;
    patch: Partial<SmartTaskHeader>;
    expected: Partial<SmartTaskHeader>;
    dailySnapshots?: DailySourceSnapshot[];
  };
  const state = useTimelineStore.getState();
  const task = getUniqueTasks(state.tasks, state.groups).find((item) => item.id === payload.taskId);
  const block = task?.blocks.find((item) => item.id === payload.blockId);
  if (block?.type !== 'smart-task') return '任务已经不存在';
  if (Object.entries(payload.expected).some(([key, value]) => !headerValueEquals(block.header[key as keyof SmartTaskHeader], value))) return '任务在此操作后又被修改';
  state.updateBlockHeader(payload.taskId, payload.blockId, payload.patch);
  useDailyScheduleStore.getState().restoreSourceSnapshots(payload.dailySnapshots ?? []);
});

registerUndoExecutor('timeline-remove-created-block', (raw) => {
  const payload = raw as { taskId: string; blockId: string };
  const state = useTimelineStore.getState();
  const task = getUniqueTasks(state.tasks, state.groups).find((item) => item.id === payload.taskId);
  if (!task?.blocks.some((item) => item.id === payload.blockId)) return '新建任务已经不存在';
  state.removeBlock(payload.taskId, payload.blockId);
});

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

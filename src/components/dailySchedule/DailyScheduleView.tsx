// ============================================================
// 每日任务安排页面 - 主视图
// 左右分栏：左侧 2/3 时间安排区 + 右侧 1/3 任务池
// 固定使用上午、下午、晚上三个时段进行安排
// ============================================================

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import '@/styles/daily-schedule.css';
import { formatDate, todayStr } from '@/utils/dateSafe';
import { projectTasksForDate, reviewTasksForDate } from '@/domain/dailyTaskProjection';
import {
  DragDropContext,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  BookOpenCheck,
  CalendarCheck2,
  CalendarClock,
  RotateCcw,
  Settings2,
  X,
} from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import {
  getQuantityCompleted,
  getQuantityDailySuggestion,
  getQuantityDailyStatus,
  getQuantityRecords,
  getQuantityTotal,
  getQuantityUnit,
  getTaskEstimatedMinutes,
  getValidGraphNodeIds,
  isQuantityTask,
} from '@/utils/blocks';
import { useGraphStore } from '@/graph/store';
import { useShallow } from 'zustand/react/shallow';
import { getReviewTopicKey, computeRounds } from '@/ebb/scheduler';
import { getReviewRoundDuration } from '@/ebb/duration';
import { buildRootNodeMap, getReviewCategoryColor, resolveReviewCategory } from '@/ebb/category';
import { useDailyScheduleStore, EMPTY_DAY_SCHEDULE } from './store';
import { getProjectBlockSourceId, getReviewSourceId } from './sourceIds';
import QuantityProgressDialog from './QuantityProgressDialog';
import {
  DEFAULT_TIME_SLOT_CONFIGS,
  normalizeTimeSlotConfigs,
  type TimeSlot,
  type TaskSource,
  type ScheduledItem,
  type TimeSlotConfig,
} from './types';
import type { SmartTaskBlock } from '@/types';
import { useSmartTaskTodos } from '@/hooks/useSmartTaskTodos';
import { parseSourceId } from './conversion';
import { useTaskCompletionStatus } from './useTaskCompletionStatus';
import { openProjectTaskModal } from '@/components/smartBlock/projectTaskModal';
import SyncStatusIndicator from '@/components/SyncStatusIndicator';
import {
  resolveProjectAppearance,
} from './projectAppearance';
import { recordOperation, useOperationHistory } from '@/services/operationHistory';
import { recordQuantityProgress, removeQuantityProgress, setProjectTaskCompletion } from '@/services/projectTaskCommands';
import { returnProjectTaskToBacklog, scheduleBacklogTaskToDate, scheduleBacklogTaskToSlot } from '@/services/backlogCommands';
import { collectBacklogTasks, type BacklogTask } from '@/domain/taskBacklog';
import { requestConfirmation } from '@/services/confirmation';
import { requestManualReviewToggle } from '@/services/reviewCompletionCommands';
import DailySlotSection from './DailySlotSection';
import DailyTaskPool, { type CompletedDailyPoolItem, type DailyPoolItem } from './DailyTaskPool';
import TimeSlotIcon from './TimeSlotIcon';
import { getUniqueTasks } from '@/store/timelineData';
import {
  DROPPABLE_POOL,
  DROPPABLE_BACKLOG,
  DROPPABLE_REVIEW_POOL,
  DROPPABLE_VOCABULARY_POOL,
  isTaskPoolDroppable,
} from './dndIds';
import DailyReviewPlanner from '@/ebb/components/DailyReviewPlanner';
import DailyRetrospectiveDialog from './DailyRetrospectiveDialog';
import { collectCompletedActivities } from '@/domain/dailyRetrospective';
import WorkspaceHeader from '@/components/WorkspaceHeader';

const formatPlanningMinutes = (minutes: number): string => {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
};

const timeSlotLabel = (slot: TimeSlot): string => (
  slot === 'morning' ? '上午' : slot === 'afternoon' ? '下午' : '晚上'
);

const REVIEW_ADJUSTMENT_INTENT_KEY = 'smart-line-review-adjustment-intent';

// ── 主组件 ───────────────────────────────────────────────────

const DailyScheduleView: React.FC = () => {
  const today = todayStr();
  const [selectedDate, setSelectedDate] = useState(() => {
    try {
      const pending = sessionStorage.getItem('smart-line-daily-target-date');
      if (pending) {
        sessionStorage.removeItem('smart-line-daily-target-date');
        return pending;
      }
    } catch {
      // Session storage is optional; falling back to today keeps navigation usable.
    }
    return today;
  });
  const [showCompletedPool, setShowCompletedPool] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [backlogFeedback, setBacklogFeedback] = useState<{ text: string; operationId?: string } | null>(null);
  const undoOperation = useOperationHistory((state) => state.undo);
  const [progressTask, setProgressTask] = useState<{ taskId: string; block: SmartTaskBlock } | null>(null);
  const [dailyPlanOpen, setDailyPlanOpen] = useState(false);
  const [retrospectiveOpen, setRetrospectiveOpen] = useState(false);
  const [dailyPlanFeedback, setDailyPlanFeedback] = useState<string | null>(null);
  const [poolPreference, setPoolPreference] = useState<'auto' | 'open' | 'closed'>('auto');
  const [isCompactLayout, setIsCompactLayout] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);

  const openReviewAdjustmentDetails = useCallback(() => {
    try { sessionStorage.setItem(REVIEW_ADJUSTMENT_INTENT_KEY, 'daily-plan'); } catch { /* optional storage */ }
    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'ebb' } }));
  }, []);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 900px)');
    const update = () => setIsCompactLayout(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => setPoolPreference('auto'), [selectedDate]);

  useEffect(() => {
    const handleNavigation = (event: Event) => {
      const detail = (event as CustomEvent<{ view?: string }>).detail;
      if (detail?.view !== 'daily-schedule') return;
      try {
        const pending = sessionStorage.getItem('smart-line-daily-target-date');
        if (pending) {
          sessionStorage.removeItem('smart-line-daily-target-date');
          setSelectedDate(pending);
        }
      } catch {
        // Ignore optional session storage failures.
      }
    };
    window.addEventListener('tl-navigate', handleNavigation);
    return () => window.removeEventListener('tl-navigate', handleNavigation);
  }, []);

  const openProjectTaskFromSource = useCallback((sourceId: string) => {
    const parsed = parseSourceId(sourceId);
    if (parsed?.source === 'project' && parsed.blockId) {
      openProjectTaskModal(parsed.parentTaskId, parsed.blockId, { source: 'daily-schedule', sourceDate: selectedDate });
    }
  }, [selectedDate]);

  const { tasks: rawTlTasks, groups: rawTlGroups } = useTimelineStore(
    useShallow((s) => ({ tasks: s.tasks, groups: s.groups })),
  );
  const {
    reviewTasks: rawEbbReviewTasks,
    ebbSettings: ebbSettingsData,
    applyDailyReviewPlan,
    updateSettings: updateEbbSettings,
  } = useEbbStore(
    useShallow((s) => ({
      reviewTasks: s.reviewTasks,
      ebbSettings: s.ebbSettings,
      applyDailyReviewPlan: s.applyDailyReviewPlan,
      updateSettings: s.updateSettings,
    })),
  );

  const graphNodes = useGraphStore((state) => state.nodes);
  const ebbRootByNodeId = useMemo(() => buildRootNodeMap(graphNodes), [graphNodes]);

  // 过滤冷数据（已归档节点关联的任务/块）
  const archivedNodeIds = useMemo(() => new Set(graphNodes.filter(n => n.isArchived).map(n => n.id)), [graphNodes]);

  const ebbReviewTasks = useMemo(() => {
    return rawEbbReviewTasks.filter(t => {
      if (t.isArchived) return false;
      return !t.graphNodeId || !archivedNodeIds.has(t.graphNodeId);
    });
  }, [rawEbbReviewTasks, archivedNodeIds]);

  const tlTasks = useMemo(() => {
    return getUniqueTasks(rawTlTasks, rawTlGroups).map(task => ({
      ...task,
      blocks: task.blocks?.filter(b => {
        if (b.type === 'smart-task') {
          if (b.header.isArchived) return false;
          const ids = getValidGraphNodeIds(b.header);
          return !ids.some(id => archivedNodeIds.has(id));
        }
        return true;
      }) ?? []
    }));
  }, [rawTlTasks, rawTlGroups, archivedNodeIds]);

  const projectSourceById = useMemo(() => {
    const map = new Map<string, { taskId: string; task: (typeof tlTasks)[number]; block: SmartTaskBlock }>();
    for (const task of tlTasks) {
      for (const block of task.blocks ?? []) {
        if (block.type === 'smart-task') map.set(getProjectBlockSourceId(task.id, block.id), { taskId: task.id, task, block });
      }
    }
    return map;
  }, [tlTasks]);
  const backlogTasks = useMemo(() => collectBacklogTasks(tlTasks, rawTlGroups), [rawTlGroups, tlTasks]);
  const ebbReviewById = useMemo(() => new Map(ebbReviewTasks.map((task) => [task.id, task])), [ebbReviewTasks]);

  const { checkIsCompleted } = useTaskCompletionStatus();
  const getProjectBlockFromSource = useCallback(
    (sourceId: string) => projectSourceById.get(sourceId) ?? null,
    [projectSourceById],
  );

  const isQuantitySource = useCallback(
    (sourceId: string) => isQuantityTask(getProjectBlockFromSource(sourceId)?.block.header),
    [getProjectBlockFromSource],
  );

  const scheduleBacklogToDate = useCallback((task: BacklogTask, date: string): boolean => {
    const result = scheduleBacklogTaskToDate(task, date);
    if ('error' in result) {
      setOperationError(result.error);
      return false;
    }
    setOperationError(null);
    return true;
  }, []);

  const openBacklogTask = useCallback((task: BacklogTask) => {
    openProjectTaskModal(task.taskId, task.blockId, { source: 'daily-schedule', sourceDate: selectedDate });
  }, [selectedDate]);
  const {
    isHydrated,
    hydrateStore,
    addScheduledItem,
    reorderScheduledItems,
    moveScheduledItem,
    removeScheduledItem,
    removeTimeBlock,
    updateScheduledItem,
    updateTimeBlock,
    retrospectives,
    upsertRetrospective,
  } = useDailyScheduleStore(
    useShallow((s) => ({
      isHydrated: s.isHydrated,
      hydrateStore: s.hydrateStore,
      addScheduledItem: s.addScheduledItem,
      reorderScheduledItems: s.reorderScheduledItems,
      moveScheduledItem: s.moveScheduledItem,
      removeScheduledItem: s.removeScheduledItem,
      removeTimeBlock: s.removeTimeBlock,
      updateScheduledItem: s.updateScheduledItem,
      updateTimeBlock: s.updateTimeBlock,
      retrospectives: s.retrospectives,
      upsertRetrospective: s.upsertRetrospective,
    })),
  );

  const scheduleForDate = useDailyScheduleStore((s) => s.schedules[selectedDate]);
  const daySchedule = scheduleForDate ?? EMPTY_DAY_SCHEDULE;

  // 时间段配置作为全局工作区设置保存在 ebbSettings 中，因此会随统一工作区跨设备同步。
  const slotConfigs = useMemo(
    () => normalizeTimeSlotConfigs(ebbSettingsData.dailyTimeSlots),
    [ebbSettingsData.dailyTimeSlots],
  );
  const setSlotConfigs = useCallback((configs: TimeSlotConfig[]) => {
    updateEbbSettings({ dailyTimeSlots: normalizeTimeSlotConfigs(configs) });
  }, [updateEbbSettings]);
  const updateSlotConfig = useCallback((slot: TimeSlot, patch: Partial<TimeSlotConfig>) => {
    setSlotConfigs(slotConfigs.map((config) => config.slot === slot ? { ...config, ...patch } : config));
  }, [setSlotConfigs, slotConfigs]);
  const slotSettingsAreDefault = useMemo(
    () => slotConfigs.every((config, index) => {
      const fallback = DEFAULT_TIME_SLOT_CONFIGS[index];
      return config.startHour === fallback.startHour
        && config.endHour === fallback.endHour
        && config.availableMinutes === fallback.availableMinutes;
    }),
    [slotConfigs],
  );
  const totalNaturalMinutes = useMemo(
    () => slotConfigs.reduce((sum, config) => sum + (config.endHour - config.startHour) * 60, 0),
    [slotConfigs],
  );
  const totalAvailableMinutes = useMemo(
    () => slotConfigs.reduce((sum, config) => sum + config.availableMinutes, 0),
    [slotConfigs],
  );
  const [showSlotSettings, setShowSlotSettings] = useState(false);

  // 筛选/排序
  const [filterSource, setFilterSource] = useState<'all' | 'project' | 'review' | 'quantity'>('all');

  // ── 添加自由占位符 ───────────────────────────────────────
  const [addingFreeSlot, setAddingFreeSlot] = useState<TimeSlot | null>(null);
  const [freeItemName, setFreeItemName] = useState('');
  const [freeItemDuration, setFreeItemDuration] = useState(30);
  const freeInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (addingFreeSlot && freeInputRef.current) {
      freeInputRef.current.focus();
    }
  }, [addingFreeSlot]);

  const isCancelingFreeRef = useRef(false);

  const handleAddFreeSubmit = useCallback((slot: TimeSlot) => {
    if (isCancelingFreeRef.current) {
      isCancelingFreeRef.current = false;
      return;
    }
    setFreeItemName((currentName) => {
      const trimmed = currentName.trim();
      if (trimmed) {
        addScheduledItem(selectedDate, {
          sourceId: `free-${Date.now().toString(36)}`,
          name: trimmed,
          source: 'free',
          timeSlot: slot,
          completed: false,
          duration: freeItemDuration,
        });
      }
      return '';
    });
    setAddingFreeSlot(null);
    setFreeItemDuration(30);
  }, [selectedDate, addScheduledItem, freeItemDuration]);

  // ── 获取指定日期的项目任务 ─────────────────────────────
  const allSmartTaskTodos = useSmartTaskTodos(tlTasks, rawTlGroups);
  // 数据来源已统一为 SmartTaskBlock，不再走 markdown 待办
  const mergedTodos = allSmartTaskTodos;

  const projectProjection = useMemo(
    () => projectTasksForDate(mergedTodos, selectedDate),
    [mergedTodos, selectedDate],
  );
  const todayProjectTasks = projectProjection.pending;
  const completedProjectTasks = projectProjection.completed;

  // ── 获取今日复习任务 ─────────────────────────────────────
  const reviewProjection = useMemo(
    () => reviewTasksForDate(ebbReviewTasks, selectedDate, today),
    [ebbReviewTasks, selectedDate, today],
  );
  const todayReviewTasks = reviewProjection.pending;
  const completedReviewTasks = reviewProjection.completed;

  const completedActivities = useMemo(
    () => collectCompletedActivities(
      selectedDate,
      rawTlTasks,
      rawTlGroups,
      rawEbbReviewTasks,
      graphNodes,
      daySchedule,
    ),
    [selectedDate, rawTlTasks, rawTlGroups, rawEbbReviewTasks, graphNodes, daySchedule],
  );
  const selectedRetrospective = retrospectives[selectedDate];
  const retrospectiveNewCount = useMemo(() => {
    if (!selectedRetrospective || selectedRetrospective.status !== 'completed') return 0;
    const savedIds = new Set(selectedRetrospective.entries.map((entry) => entry.id));
    return completedActivities.filter((activity) => !savedIds.has(activity.id)).length;
  }, [completedActivities, selectedRetrospective]);

  // ── 判断是否未绑定节点 ──────────────────────────────────
  const checkIsUnlinkedTask = useCallback((sourceId: string) => {
    const parsed = parseSourceId(sourceId);
    if (!parsed) return false;

    if (parsed.source === 'review') {
      const reviewTask = ebbReviewById.get(parsed.reviewId);
      return reviewTask ? !reviewTask.graphNodeId : false;
    }
    
    if (parsed.source === 'project') {
      const block = getProjectBlockFromSource(sourceId)?.block;
      if (block) return getValidGraphNodeIds(block.header).length === 0;
    }
    return false;
  }, [ebbReviewById, getProjectBlockFromSource]);

  // ── 判断是否已绑定节点 ──────────────────────────────────
  const checkIsLinkedTask = useCallback((sourceId: string) => {
    const parsed = parseSourceId(sourceId);
    if (!parsed) return false;

    if (parsed.source === 'review') {
      const reviewTask = ebbReviewById.get(parsed.reviewId);
      return reviewTask ? !!reviewTask.graphNodeId : false;
    }
    
    if (parsed.source === 'project') {
      const block = getProjectBlockFromSource(sourceId)?.block;
      if (block) return getValidGraphNodeIds(block.header).length > 0;
    }
    return false;
  }, [ebbReviewById, getProjectBlockFromSource]);

  // ── 已安排的 sourceId 集合（items + blocks 合并） ────────
  const scheduledSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of daySchedule.items) ids.add(item.sourceId);
    for (const block of daySchedule.blocks ?? []) ids.add(block.sourceId);
    return ids;
  }, [daySchedule.items, daySchedule.blocks]);

  const allCompletedPoolItems = useMemo(() => {
    const items: CompletedDailyPoolItem[] = [];
    for (const todo of completedProjectTasks) {
      if (!todo._blockId) continue;
      const sourceId = getProjectBlockSourceId(todo.parentTaskId, todo._blockId);
      if (scheduledSourceIds.has(sourceId)) continue;
      const projectSource = getProjectBlockFromSource(sourceId);
      const quantityHeader = projectSource && isQuantityTask(projectSource.block.header) ? projectSource.block.header : undefined;
      const quantityCompleted = quantityHeader ? getQuantityCompleted(quantityHeader) : 0;
      const quantityTotal = quantityHeader ? getQuantityTotal(quantityHeader) : 0;
      const quantityUnit = quantityHeader ? getQuantityUnit(quantityHeader) : '';
      const quantityRecord = quantityHeader ? getQuantityRecords(quantityHeader)[selectedDate] : undefined;
      items.push({
        id: `completed-project-${todo.id}`,
        name: todo.text,
        source: 'project',
        sourceId,
        taskKind: todo._taskKind,
        detail: quantityHeader
          ? `今日完成 ${quantityRecord ?? 0} ${quantityUnit} · 总进度 ${quantityCompleted}/${quantityTotal} ${quantityUnit} · 剩余 ${Math.max(0, quantityTotal - quantityCompleted)} ${quantityUnit}`
          : todo.parentTaskTitle,
        color: todo.parentTaskColor,
        categoryColor: todo._tagColor,
      });
    }
    for (const task of completedReviewTasks) {
      const sourceId = getReviewSourceId(task.id);
      if (scheduledSourceIds.has(sourceId)) continue;
      items.push({
        id: `completed-review-${task.id}`,
        name: task.topicName,
        source: 'review',
        sourceId,
        categoryColor: getReviewCategoryColor(
          resolveReviewCategory(task, ebbRootByNodeId),
          ebbSettingsData.tagColors,
        ),
      });
    }
    return items;
  }, [completedProjectTasks, completedReviewTasks, scheduledSourceIds, ebbSettingsData, selectedDate, getProjectBlockFromSource, ebbRootByNodeId]);

  const completedPoolItems = useMemo(() => filterSource === 'all'
    ? allCompletedPoolItems
    : allCompletedPoolItems.filter((item) => filterSource === 'quantity'
      ? isQuantityTask({ taskKind: item.taskKind })
      : item.source === filterSource && !isQuantityTask({ taskKind: item.taskKind })),
  [allCompletedPoolItems, filterSource]);

  // ── 构建右侧任务池列表（时段模式用） ─────────────────────
  const poolItems = useMemo(() => {
    const items: DailyPoolItem[] = [];

    for (const todo of todayProjectTasks) {
      // 区分 blocks 和 markdown 来源的 sourceId
      const sourceId = todo._blockId
        ? getProjectBlockSourceId(todo.parentTaskId, todo._blockId)
        : `project-md:${todo.id}`;
      if (scheduledSourceIds.has(sourceId)) continue;
      const projectSource = getProjectBlockFromSource(sourceId);
      const quantityHeader = projectSource && isQuantityTask(projectSource.block.header) ? projectSource.block.header : undefined;
      const quantityCompleted = quantityHeader ? getQuantityCompleted(quantityHeader) : 0;
      const quantityTotal = quantityHeader ? getQuantityTotal(quantityHeader) : 0;
      const quantityUnit = quantityHeader ? getQuantityUnit(quantityHeader) : '';
      const suggestion = quantityHeader ? getQuantityDailySuggestion(quantityHeader, selectedDate) : null;
      const dailyStatus = quantityHeader ? getQuantityDailyStatus(quantityHeader, selectedDate) : null;
      items.push({
        id: `pool-project-${todo.id}`,
        name: todo.text,
        source: 'project',
        color: todo.parentTaskColor,
        categoryColor: quantityHeader ? (todo._tagColor ?? '#10B981') : todo._tagColor,
        taskKind: todo._taskKind,
        detail: todo.parentTaskTitle,
        sourceId,
        duration: projectSource
          ? getTaskEstimatedMinutes(projectSource.block.header)
          : Math.max(5, todo._duration ?? 30),
        quantityActual: dailyStatus?.actual,
        quantityTarget: dailyStatus?.target ?? suggestion?.suggested,
        quantityTotal: quantityHeader ? quantityTotal : undefined,
        quantityCompleted: quantityHeader ? quantityCompleted : undefined,
        quantityUnit: quantityHeader ? quantityUnit : undefined,
        quantityState: dailyStatus?.state,
        timingLabel: todo.due
          ? todo.due < selectedDate
            ? '已逾期'
            : todo.due === selectedDate
              ? '今日截止'
              : `截止 ${todo.due.slice(5).replace('-', '/')}`
          : undefined,
        urgency: todo.due && todo.due < selectedDate
          ? 'overdue'
          : todo.due === selectedDate
            ? 'due'
            : 'normal',
      });
    }

    const { roundMap, totalRoundsMap } = computeRounds(ebbReviewTasks);
    for (const task of todayReviewTasks) {
      if (scheduledSourceIds.has(getReviewSourceId(task.id))) continue;
      const round = roundMap.get(task.id) ?? 1;
      const total = totalRoundsMap.get(getReviewTopicKey(task)) ?? 1;
      items.push({
        id: `pool-review-${task.id}`,
        name: task.topicName,
        source: 'review',
        color: getReviewCategoryColor(
          resolveReviewCategory(task, ebbRootByNodeId),
          ebbSettingsData.tagColors,
        ) ?? '#8B9DC3',
        categoryColor: getReviewCategoryColor(
          resolveReviewCategory(task, ebbRootByNodeId),
          ebbSettingsData.tagColors,
        ),
        detail: `第${round}/${total}轮`,
        sourceId: getReviewSourceId(task.id),
        duration: getReviewRoundDuration(task, round),
        timingLabel: task.dueDate < selectedDate ? '复习逾期' : '今日复习',
        urgency: task.dueDate < selectedDate ? 'overdue' : 'due',
      });
    }

    const urgencyRank = { overdue: 0, due: 1, normal: 2 } as const;
    return items.sort((left, right) => (
      urgencyRank[left.urgency ?? 'normal'] - urgencyRank[right.urgency ?? 'normal']
      || (left.duration ?? 30) - (right.duration ?? 30)
    ));
  }, [todayProjectTasks, todayReviewTasks, scheduledSourceIds, ebbReviewTasks, ebbSettingsData, getProjectBlockFromSource, selectedDate, ebbRootByNodeId]);

  const poolOpen = poolPreference === 'open'
    || (poolPreference === 'auto' && !isCompactLayout && poolItems.length > 0);

  // ── 辅助函数：根据用户配置动态划分时段 ──────────────────
  // ── 获取时间段内的已安排任务 ─────────────────────────────
  const getSlotItems = useCallback(
    (slot: TimeSlot): ScheduledItem[] => {
      const normalItems = daySchedule.items
        .filter((i) => i.timeSlot === slot)
        .sort((a, b) => a.order - b.order)
        .map((i) => {
          const appearance = resolveProjectAppearance(i.sourceId, tlTasks, rawTlGroups);
          const parsed = parseSourceId(i.sourceId);
          const reviewTask = parsed?.source === 'review'
            ? ebbReviewById.get(parsed.reviewId)
            : undefined;
          const reviewCategoryColor = reviewTask
            ? getReviewCategoryColor(
                resolveReviewCategory(reviewTask, ebbRootByNodeId),
                ebbSettingsData.tagColors,
              )
            : undefined;
          const projectSource = getProjectBlockFromSource(i.sourceId);
          const quantityHeader = projectSource && isQuantityTask(projectSource.block.header)
            ? projectSource.block.header
            : undefined;
          const quantityRecord = quantityHeader ? getQuantityRecords(quantityHeader)[selectedDate] : undefined;
          const quantityProgress = quantityHeader ? getQuantityCompleted(quantityHeader) : 0;
          const quantityTotal = quantityHeader ? getQuantityTotal(quantityHeader) : 0;
          const quantityUnit = quantityHeader ? getQuantityUnit(quantityHeader) : '';
          const suggestion = quantityHeader ? getQuantityDailySuggestion(quantityHeader, selectedDate) : null;
          const dailyStatus = quantityHeader ? getQuantityDailyStatus(quantityHeader, selectedDate) : null;
          return {
            ...i,
            name: quantityHeader?.title ?? i.name,
            completed: i.source === 'free'
              ? i.completedDate === selectedDate
              : checkIsCompleted(i.source, i.sourceId, selectedDate),
            detail: appearance?.name ?? i.detail,
            color: appearance?.theme.backgroundColor ?? i.color,
            categoryColor: quantityHeader ? (quantityHeader.tagColor || '#10B981') : appearance?.categoryColor ?? reviewCategoryColor ?? i.categoryColor,
            duration: projectSource
              ? getTaskEstimatedMinutes(projectSource.block.header)
              : reviewTask
                ? getReviewRoundDuration(reviewTask)
                : i.duration,
            quantityActual: dailyStatus?.actual ?? quantityRecord,
            quantityTarget: dailyStatus?.target ?? suggestion?.suggested,
            quantityTotal: quantityHeader ? quantityTotal : undefined,
            quantityCompleted: quantityHeader ? quantityProgress : undefined,
            quantityUnit: quantityHeader ? quantityUnit : undefined,
            quantityState: dailyStatus?.state,
          };
        });

      return normalItems;
    },
    [daySchedule.items, checkIsCompleted, tlTasks, rawTlGroups, ebbReviewById, ebbSettingsData, getProjectBlockFromSource, selectedDate, ebbRootByNodeId],
  );

  const schedulePoolItemToSlot = useCallback((poolItem: DailyPoolItem, targetSlot: TimeSlot) => {
    const beforeIds = new Set(
      (useDailyScheduleStore.getState().schedules[selectedDate]?.items ?? []).map((item) => item.id),
    );
    addScheduledItem(selectedDate, {
      sourceId: poolItem.sourceId,
      name: poolItem.name,
      source: poolItem.source,
      timeSlot: targetSlot,
      completed: false,
      color: poolItem.color,
      categoryColor: poolItem.categoryColor,
      detail: poolItem.detail,
      duration: poolItem.duration,
    });
    const created = useDailyScheduleStore.getState().schedules[selectedDate]?.items.find((item) => !beforeIds.has(item.id));
    if (!created) return;
    const operationId = recordOperation({
      label: `安排“${poolItem.name}”`,
      detail: `已安排到${timeSlotLabel(targetSlot)}`,
      modules: ['每日安排'],
      undoSpec: {
        kind: 'daily-remove',
        payload: { date: selectedDate, itemId: created.id, expectedSourceId: created.sourceId },
      },
    }, () => {
      const latest = useDailyScheduleStore.getState().schedules[selectedDate]?.items.find((item) => item.id === created.id);
      if (!latest || latest.sourceId !== created.sourceId) return '安排项已经发生变化';
      useDailyScheduleStore.getState().removeScheduledItem(selectedDate, created.id);
    });
    setBacklogFeedback({
      text: `已将“${poolItem.name}”安排到${timeSlotLabel(targetSlot)}`,
      operationId,
    });
  }, [addScheduledItem, selectedDate]);

  // ── 拖拽处理（时段模式） ─────────────────────────────────
  const handleDragEnd = useCallback(
    async (result: DropResult) => {
      const { source, destination, draggableId } = result;
      if (!destination) return;

      const srcDroppableId = source.droppableId;
      const destDroppableId = destination.droppableId;
      const destIndex = destination.index;

      // 待排期箱 → 当日时段：同时更新原任务日期并创建每日安排。
      if (srcDroppableId === DROPPABLE_BACKLOG && destDroppableId.startsWith('ds-slot-')) {
        const task = backlogTasks.find((item) => item.id === draggableId);
        if (!task) return;
        if (task.deadline && selectedDate > task.deadline) {
          const confirmed = await requestConfirmation({
            title: '排期晚于截止日期',
            message: `“${task.title}”的截止日期是 ${task.deadline}，目标日期是 ${selectedDate}。是否仍然安排？`,
            confirmLabel: '仍然安排',
            cancelLabel: '返回修改',
            tone: 'warning',
          });
          if (!confirmed) return;
        }
        const targetSlot = destDroppableId.replace('ds-slot-', '') as TimeSlot;
        const result = scheduleBacklogTaskToSlot({
          task,
          date: selectedDate,
          slot: targetSlot,
          color: task.projectColor,
          categoryColor: task.tagColor,
        });
        setOperationError('error' in result ? result.error : null);
        return;
      }

      // 今日任务或已安排时段 → 待排期箱：清除原任务日期。
      if (destDroppableId === DROPPABLE_BACKLOG) {
        let sourceId: string | undefined;
        if (srcDroppableId.startsWith('ds-slot-')) {
          const sourceSlot = srcDroppableId.replace('ds-slot-', '') as TimeSlot;
          sourceId = getSlotItems(sourceSlot)[source.index]?.sourceId;
        } else if (
          srcDroppableId === DROPPABLE_POOL
          || srcDroppableId === DROPPABLE_REVIEW_POOL
          || srcDroppableId === DROPPABLE_VOCABULARY_POOL
        ) {
          sourceId = poolItems.find((item) => item.id === draggableId)?.sourceId;
        }
        const parsed = sourceId ? parseSourceId(sourceId) : null;
        if (!parsed || parsed.source !== 'project' || !parsed.parentTaskId || !parsed.blockId) {
          setOperationError('只有普通项目任务可以移回待排期箱。');
          return;
        }
        const projectSource = getProjectBlockFromSource(sourceId!);
        if (!projectSource || isQuantityTask(projectSource.block.header)) {
          setOperationError('数量任务必须保留开始日期，不能移入待排期箱。');
          return;
        }
        const result = returnProjectTaskToBacklog(parsed.parentTaskId, parsed.blockId);
        setOperationError('error' in result ? result.error : null);
        return;
      }

      // 从右侧任务池拖入左侧时间段
      if (
        (srcDroppableId === DROPPABLE_POOL || srcDroppableId === DROPPABLE_REVIEW_POOL || srcDroppableId === DROPPABLE_VOCABULARY_POOL) &&
        destDroppableId.startsWith('ds-slot-')
      ) {
        const targetSlot = destDroppableId.replace('ds-slot-', '') as TimeSlot;
        const poolItem = poolItems.find((i) => i.id === draggableId);
        if (!poolItem) return;
        schedulePoolItemToSlot(poolItem, targetSlot);
        return;
      }

      // 左侧时间段之间的拖拽
      if (srcDroppableId.startsWith('ds-slot-') && destDroppableId.startsWith('ds-slot-')) {
        const srcSlot = srcDroppableId.replace('ds-slot-', '') as TimeSlot;
        const destSlot = destDroppableId.replace('ds-slot-', '') as TimeSlot;

        const srcItems = getSlotItems(srcSlot);
        const draggedItem = srcItems[source.index];
        if (!draggedItem) return;

        if (srcSlot === destSlot) {
          const normalItems = srcItems.filter(i => !i.id.startsWith('virtual-block-'));
          const newOrder = normalItems.map((i) => i.id);
          const [removed] = newOrder.splice(source.index, 1);
          // 限制插入位置，防止拖拽到虚拟块的下方导致乱序
          newOrder.splice(Math.min(destIndex, newOrder.length), 0, removed);
          reorderScheduledItems(selectedDate, srcSlot, newOrder);
          recordOperation({ label: `调整“${draggedItem.name}”顺序`, detail: '已在当前时段内移动位置', modules: ['每日安排'], undoSpec: { kind: 'daily-move', payload: { date: selectedDate, itemId: draggedItem.id, targetSlot: srcSlot, targetIndex: source.index, expectedSlot: destSlot } } },
            () => { const latest = useDailyScheduleStore.getState().schedules[selectedDate]?.items.find((item) => item.id === draggedItem.id); if (!latest || latest.timeSlot !== destSlot) return '任务位置已经发生变化'; useDailyScheduleStore.getState().moveScheduledItem(selectedDate, draggedItem.id, srcSlot, source.index); });
        } else {
          const destItems = getSlotItems(destSlot);
          const normalDestItems = destItems.filter(i => !i.id.startsWith('virtual-block-'));
          const clampedIndex = Math.min(destIndex, normalDestItems.length);
          moveScheduledItem(selectedDate, draggedItem.id, destSlot, clampedIndex);
          recordOperation({ label: `移动“${draggedItem.name}”`, detail: `已从${srcSlot}移动到${destSlot}`, modules: ['每日安排'], undoSpec: { kind: 'daily-move', payload: { date: selectedDate, itemId: draggedItem.id, targetSlot: srcSlot, targetIndex: source.index, expectedSlot: destSlot } } },
            () => { const latest = useDailyScheduleStore.getState().schedules[selectedDate]?.items.find((item) => item.id === draggedItem.id); if (!latest || latest.timeSlot !== destSlot) return '任务位置已经发生变化'; useDailyScheduleStore.getState().moveScheduledItem(selectedDate, draggedItem.id, srcSlot, source.index); });
        }
        return;
      }

      // 从左侧拖回右侧任务池 = 移除 (自由块拖回任务池相当于直接删除)
      if (
        srcDroppableId.startsWith('ds-slot-') &&
        isTaskPoolDroppable(destDroppableId)
      ) {
        const srcSlot = srcDroppableId.replace('ds-slot-', '') as TimeSlot;
        const srcItems = getSlotItems(srcSlot);
        const draggedItem = srcItems[source.index];
        if (!draggedItem) return;
        removeScheduledItem(selectedDate, draggedItem.id);
        recordOperation({ label: `移回任务池“${draggedItem.name}”`, detail: '已从每日安排移除，可撤销恢复原时段与位置', modules: ['每日安排'], undoSpec: { kind: 'daily-restore', payload: { date: selectedDate, item: draggedItem, targetIndex: source.index } } },
          () => { if (useDailyScheduleStore.getState().schedules[selectedDate]?.items.some((item) => item.id === draggedItem.id)) return '任务已经重新安排'; useDailyScheduleStore.getState().restoreScheduledItem(selectedDate, draggedItem, source.index); });
      }
    },
    [
      backlogTasks,
      getProjectBlockFromSource,
      getSlotItems,
      moveScheduledItem,
      poolItems,
      removeScheduledItem,
      reorderScheduledItems,
      schedulePoolItemToSlot,
      selectedDate,
    ],
  );

  // Playwright bridge for deterministic DnD verification. The production
  // bundle removes this DEV-only branch; tests still execute the exact same
  // handleDragEnd command used by @hello-pangea/dnd.
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const testWindow = window as typeof window & { __e2eDailyDragEnd?: (result: DropResult) => void };
    testWindow.__e2eDailyDragEnd = handleDragEnd;
    const listener = (event: Event) => handleDragEnd((event as CustomEvent<DropResult>).detail);
    window.addEventListener('e2e-daily-drag-end', listener);
    return () => { window.removeEventListener('e2e-daily-drag-end', listener); delete testWindow.__e2eDailyDragEnd; };
  }, [handleDragEnd]);

  // ── 完成/删除 操作（时段模式） ──────────────────────────
  const syncProjectTaskCompletion = useCallback((sourceId: string, completed?: boolean) => {
    const parsed = parseSourceId(sourceId);
    if (!parsed || parsed.source !== 'project') return false;
    if (!parsed.blockId) return false;
    const projectSource = getProjectBlockFromSource(sourceId);
    if (!projectSource) return false;
    const desired = completed ?? !projectSource.block.header.isCompleted;
    const result = setProjectTaskCompletion(
      parsed.parentTaskId,
      parsed.blockId,
      desired,
      desired ? todayStr() : undefined,
    );
    if ('error' in result) setOperationError(result.error);
    return result.ok;
  }, [getProjectBlockFromSource]);

  const toggleReviewWithFeedback = useCallback(async (reviewId: string) => {
    const result = await requestManualReviewToggle(reviewId);
    setOperationError(result.cancelled || result.ok ? null : result.message ?? '复习任务操作失败');
    return result.ok;
  }, []);

  const handleUndoCompletedPoolItem = useCallback((source: TaskSource, sourceId: string) => {
    if (source === 'project') {
      const projectSource = getProjectBlockFromSource(sourceId);
      if (projectSource && isQuantityTask(projectSource.block.header)) {
        const result = removeQuantityProgress(projectSource.taskId, projectSource.block.id, selectedDate);
        if ('error' in result) setOperationError(result.error);
        return;
      }
      syncProjectTaskCompletion(sourceId, false);
      return;
    }
    if (source === 'review') {
      const parsed = parseSourceId(sourceId);
      if (parsed?.source === 'review') void toggleReviewWithFeedback(parsed.reviewId);
      return;
    }
  }, [syncProjectTaskCompletion, toggleReviewWithFeedback, selectedDate, getProjectBlockFromSource]);

  // 先校验并写入源 store（ebb/timeline），成功后再同步 schedule，
  // 避免"先写 schedule 后校验失败"导致的 UI 闪烁与短暂不一致。
  const handleToggleItem = useCallback(
    (itemId: string) => {
      if (itemId.startsWith('virtual-block-')) {
        const blockId = itemId.replace('virtual-block-', '');
        const block = daySchedule.blocks?.find(b => b.id === blockId);
        if (!block) return;

        if (block.source === 'review') {
          const reviewId = block.sourceId.replace('review-', '');
          void toggleReviewWithFeedback(reviewId);
        } else if (block.source === 'project') {
          syncProjectTaskCompletion(block.sourceId);
        } else if (block.source === 'free') {
          updateTimeBlock(selectedDate, block.id, {
            completed: block.completedDate !== selectedDate,
            completedDate: block.completedDate === selectedDate ? undefined : selectedDate,
          });
        }
        // toggleTimeBlock 已经被移除，底层数据变化后 computedBlocks 自动重新计算
        return;
      }

      const item = daySchedule.items.find((i) => i.id === itemId);
      if (!item) return;

      if (item.source === 'review') {
        const reviewId = item.sourceId.replace('review-', '');
        void toggleReviewWithFeedback(reviewId);
      } else if (item.source === 'project') {
        const projectSource = getProjectBlockFromSource(item.sourceId);
        if (projectSource && isQuantityTask(projectSource.block.header)) {
          setProgressTask({ taskId: projectSource.taskId, block: projectSource.block });
        } else {
          syncProjectTaskCompletion(item.sourceId);
        }
      } else if (item.source === 'free') {
        updateScheduledItem(selectedDate, item.id, {
          completed: item.completedDate !== selectedDate,
          completedDate: item.completedDate === selectedDate ? undefined : selectedDate,
        });
      }
      // toggleScheduledItem 已经被移除，底层数据变化后 getSlotItems 自动重新计算
    },
    [daySchedule.items, daySchedule.blocks, toggleReviewWithFeedback, syncProjectTaskCompletion, getProjectBlockFromSource, selectedDate, updateScheduledItem, updateTimeBlock],
  );

  const handleRecordQuantityTarget = useCallback((itemId: string, target: number) => {
    const item = daySchedule.items.find((candidate) => candidate.id === itemId);
    if (!item || item.source !== 'project' || !Number.isInteger(target) || target <= 0) return;
    const projectSource = getProjectBlockFromSource(item.sourceId);
    if (!projectSource || !isQuantityTask(projectSource.block.header)) return;
    const result = recordQuantityProgress(projectSource.taskId, projectSource.block.id, selectedDate, target);
    if ('error' in result) setOperationError(result.error);
  }, [daySchedule.items, getProjectBlockFromSource, selectedDate]);

  const handleRemoveItem = useCallback(
    (itemId: string) => {
      if (itemId.startsWith('virtual-block-')) {
        removeTimeBlock(selectedDate, itemId.replace('virtual-block-', ''));
      } else {
        removeScheduledItem(selectedDate, itemId);
      }
    },
    [removeScheduledItem, removeTimeBlock, selectedDate],
  );

  const handleReturnItemToBacklog = useCallback((itemId: string) => {
    const item = daySchedule.items.find((candidate) => candidate.id === itemId);
    const parsed = item ? parseSourceId(item.sourceId) : null;
    if (!item || parsed?.source !== 'project' || !parsed.blockId) {
      setOperationError('无法识别对应的项目任务。');
      return;
    }
    const result = returnProjectTaskToBacklog(parsed.parentTaskId, parsed.blockId);
    if ('error' in result) {
      setOperationError(result.error);
      return;
    }
    setOperationError(null);
    setBacklogFeedback({
      text: `已将“${result.title}”移回待排期箱`,
      operationId: result.operationId,
    });
  }, [daySchedule.items]);

  const undoReturnToBacklog = useCallback(async () => {
    if (!backlogFeedback?.operationId) return;
    const restored = await undoOperation(backlogFeedback.operationId);
    setBacklogFeedback({
      text: restored ? '已撤销刚才的操作' : '撤销失败，任务数据可能已经发生变化',
    });
  }, [backlogFeedback, undoOperation]);

  // ── 时间段统计 ──────────────────────────────────────────
  const getSlotStats = useCallback(
    (config: TimeSlotConfig) => {
      const items = getSlotItems(config.slot);
      const total = items.length;
      const completed = items.filter((i) => i.completed).length;
      const inProgress = items.filter((item) => item.quantityState === 'in-progress').length;
      const totalDuration = items.reduce((sum, item) => sum + (item.duration ?? 30), 0);
      return { total, completed, inProgress, totalDuration, availableMinutes: config.availableMinutes };
    },
    [getSlotItems],
  );

  const dailyOverview = useMemo(() => {
    const items = slotConfigs.flatMap((config) => getSlotItems(config.slot));
    return {
      scheduled: items.length,
      completed: items.filter((item) => item.completed).length,
      plannedMinutes: items.reduce((sum, item) => sum + (item.duration ?? 30), 0),
      availableMinutes: slotConfigs.reduce((sum, config) => sum + config.availableMinutes, 0),
    };
  }, [getSlotItems, slotConfigs]);

  const retrospectiveStatus = retrospectiveNewCount > 0
    ? { label: `待补充 +${retrospectiveNewCount}`, tone: 'attention' }
    : selectedRetrospective?.status === 'completed'
      ? { label: '已完成', tone: 'completed' }
      : selectedRetrospective
        ? { label: '草稿', tone: 'draft' }
        : selectedDate < today || (dailyOverview.scheduled > 0 && dailyOverview.completed === dailyOverview.scheduled)
          ? { label: '可开始', tone: 'ready' }
          : { label: '尚未复盘', tone: 'idle' };

  // 异步加载 IndexedDB 数据
  useEffect(() => {
    if (!isHydrated) {
      hydrateStore();
    }
  }, [isHydrated, hydrateStore]);

  if (!isHydrated) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#FAFAFA]">
        <div className="text-slate-400 text-sm">正在加载日程数据...</div>
      </div>
    );
  }

  return (
    <div className="ds-page">
        {/* ── 顶部栏 ─────────────────────────────────────── */}
        <WorkspaceHeader className="ds-header" aria-label="每日安排工作区">
          <div className="ds-header-left ui-workspace-header__identity">
            <span className="ui-workspace-header__identity-icon"><CalendarClock size={17} aria-hidden="true" /></span>
            <div className="ui-workspace-header__identity-copy">
              <h1 className="ds-title">每日安排</h1>
              <p>当天执行工作台</p>
            </div>
          </div>
          <div className="ui-workspace-header__context">
            <input
              type="date"
              className="ds-date-input"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
            <div className="ds-day-overview" aria-label="今日安排概览">
              <span><strong>{dailyOverview.scheduled}</strong> 项已安排</span>
              <i aria-hidden="true" />
              <span><strong>{poolItems.length}</strong> 项待安排</span>
              <i aria-hidden="true" />
              <span>{formatPlanningMinutes(dailyOverview.plannedMinutes)} / {formatPlanningMinutes(dailyOverview.availableMinutes)}</span>
              {dailyOverview.scheduled > 0 && <span className="ds-day-completion">{dailyOverview.completed}/{dailyOverview.scheduled} 完成</span>}
            </div>
          </div>
          <div className="ds-header-right ui-workspace-header__actions">
            <button
              type="button"
              className="ds-header-btn"
              onClick={() => setRetrospectiveOpen(true)}
              aria-label="每日复盘"
              title={retrospectiveNewCount > 0 ? `新增 ${retrospectiveNewCount} 项待补充` : undefined}
            >
              <BookOpenCheck size={15} />
              每日复盘
              <span className={`ds-review-status ds-review-status--${retrospectiveStatus.tone}`}>{retrospectiveStatus.label}</span>
            </button>
            <button type="button" className="ds-header-btn" onClick={() => setDailyPlanOpen(true)} aria-label="明日负荷规划">
              <CalendarCheck2 size={15} />明日负荷规划
            </button>
            <button
              type="button"
              className={`ds-header-btn ${showSlotSettings ? 'ds-header-btn--active' : ''}`}
              onClick={() => setShowSlotSettings(!showSlotSettings)}
              title="时间段设置"
              aria-expanded={showSlotSettings}
              aria-controls="daily-time-settings"
            >
              <Settings2 size={15} />
              时间与容量
            </button>
            <SyncStatusIndicator />
          </div>
        </WorkspaceHeader>

        {operationError && (
          <div className="mx-5 mt-3 flex items-center justify-between rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800" role="alert">
            <span>{operationError}</span>
            <button
              type="button"
              className="ml-4 text-amber-700 hover:text-amber-900"
              onClick={() => setOperationError(null)}
              aria-label="关闭提示"
            >
              ×
            </button>
          </div>
        )}
        {backlogFeedback && (
          <div className="ds-backlog-feedback" role="status" aria-live="polite">
            <span>{backlogFeedback.text}</span>
            {backlogFeedback.operationId && (
              <button type="button" onClick={() => void undoReturnToBacklog()}>撤销</button>
            )}
            <button type="button" onClick={() => setBacklogFeedback(null)} aria-label="关闭移回提示">×</button>
          </div>
        )}
        {dailyPlanFeedback && (
          <div className="ds-backlog-feedback" role="status" aria-live="polite">
            <span>{dailyPlanFeedback}</span>
            <button type="button" onClick={openReviewAdjustmentDetails}>查看这些改期</button>
            <button type="button" onClick={() => setDailyPlanFeedback(null)} aria-label="关闭明日复习提示">×</button>
          </div>
        )}

        {/* ── 时间段设置面板 ────────────────────────────── */}
        {showSlotSettings && (
          <section id="daily-time-settings" className="ds-slot-settings" aria-label="时间段与可规划时间设置">
            <header className="ds-slot-settings-header">
              <div>
                <strong>时间段与可规划时间</strong>
                <span>时间范围用于划分一天；可规划时间只参与负荷提醒，不会改变任务时长。</span>
              </div>
              <div className="ds-slot-settings-actions">
                <button
                  type="button"
                  className="ds-slot-settings-reset"
                  disabled={slotSettingsAreDefault}
                  onClick={() => setSlotConfigs(DEFAULT_TIME_SLOT_CONFIGS.map((config) => ({ ...config })))}
                >
                  <RotateCcw size={13} />恢复默认
                </button>
                <button type="button" className="ds-slot-settings-close" onClick={() => setShowSlotSettings(false)} aria-label="关闭时间设置">
                  <X size={15} />
                </button>
              </div>
            </header>
            <div className="ds-slot-settings-grid">
              {slotConfigs.map((config) => {
                const maxMinutes = Math.max(15, (config.endHour - config.startHour) * 60);
                const capacityRatio = Math.round(config.availableMinutes / maxMinutes * 100);
                return (
                  <article key={config.slot} className={`ds-slot-setting-card ds-slot-setting-card--${config.slot}`}>
                    <header className="ds-slot-setting-card-header">
                      <span className={`ds-slot-setting-icon ds-slot-icon--${config.slot}`}><TimeSlotIcon slot={config.slot} size={16} /></span>
                      <div><strong>{config.label}</strong><span>{config.endHour - config.startHour} 小时时间范围</span></div>
                    </header>
                    <label className="ds-slot-setting-field">
                      <span>时间范围</span>
                      <span className="ds-slot-setting-range">
                        <select
                          className="ds-slot-setting-select"
                          value={config.startHour}
                          aria-label={`${config.label}开始时间`}
                          onChange={(event) => {
                            const startHour = Number(event.target.value);
                            updateSlotConfig(config.slot, {
                              startHour,
                              endHour: Math.max(startHour + 1, config.endHour),
                            });
                          }}
                        >
                          {Array.from({ length: 23 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
                        </select>
                        <span>至</span>
                        <select
                          className="ds-slot-setting-select"
                          value={config.endHour}
                          aria-label={`${config.label}结束时间`}
                          onChange={(event) => updateSlotConfig(config.slot, { endHour: Number(event.target.value) })}
                        >
                          {Array.from({ length: 23 - config.startHour }, (_, index) => config.startHour + index + 1)
                            .map((hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
                        </select>
                      </span>
                    </label>
                    <label className="ds-slot-setting-field ds-slot-setting-field--capacity">
                      <span>可规划时间 <strong>{formatPlanningMinutes(config.availableMinutes)}</strong></span>
                      <select
                        className="ds-slot-setting-select ds-slot-setting-select--capacity"
                        value={config.availableMinutes}
                        aria-label={`${config.label}可规划时间`}
                        onChange={(event) => updateSlotConfig(config.slot, { availableMinutes: Number(event.target.value) })}
                      >
                        {Array.from({ length: Math.floor(maxMinutes / 15) }, (_, index) => (index + 1) * 15)
                          .map((minutes) => <option key={minutes} value={minutes}>{formatPlanningMinutes(minutes)}</option>)}
                      </select>
                    </label>
                    <div className="ds-slot-setting-capacity-summary">
                      <span><i style={{ width: `${capacityRatio}%` }} /></span>
                      <small>占该时段 {capacityRatio}% · 用于判断余量与超载</small>
                    </div>
                  </article>
                );
              })}
            </div>
            <footer className="ds-slot-settings-footer">
              <span>全天时间范围 {formatPlanningMinutes(totalNaturalMinutes)}</span>
              <strong>可规划 {formatPlanningMinutes(totalAvailableMinutes)}</strong>
              <small>修改后自动保存并随统一工作区同步</small>
            </footer>
          </section>
        )}

        {/* ── 时段安排 ──────────────────────────────────── */}
        <DragDropContext onDragStart={() => setPoolPreference('open')} onDragEnd={handleDragEnd}>
          <div className={`ds-body ui-workspace-content-stage ${poolOpen ? 'ds-body--pool-open' : 'ds-body--pool-collapsed'}`}>
            <div className="ds-left">
              {slotConfigs.map((config) => {
                const slotItems = getSlotItems(config.slot);
                return (
                  <DailySlotSection
                    key={config.slot}
                    config={config}
                    items={slotItems}
                    stats={getSlotStats(config)}
                    addingFree={addingFreeSlot === config.slot}
                    freeItemName={freeItemName}
                    freeItemDuration={freeItemDuration}
                    freeInputRef={freeInputRef}
                    getVirtualTime={(itemId) => {
                      const block = daySchedule.blocks?.find((candidate) => candidate.id === itemId.replace('virtual-block-', ''));
                      return block ? `${block.startTime}-${block.endTime}` : '';
                    }}
                    isQuantitySource={isQuantitySource}
                    checkIsUnlinkedTask={checkIsUnlinkedTask}
                    checkIsLinkedTask={checkIsLinkedTask}
                    onOpenProjectSource={openProjectTaskFromSource}
                    onToggleItem={handleToggleItem}
                    onRecordQuantityTarget={handleRecordQuantityTarget}
                    onRemoveItem={handleRemoveItem}
                    onReturnToBacklog={handleReturnItemToBacklog}
                    onStartAddFree={() => {
                      setFreeItemDuration(30);
                      setAddingFreeSlot(config.slot);
                    }}
                    onFreeItemNameChange={setFreeItemName}
                    onFreeItemDurationChange={setFreeItemDuration}
                    onSubmitFree={() => handleAddFreeSubmit(config.slot)}
                    onCancelFree={() => {
                      isCancelingFreeRef.current = true;
                      setAddingFreeSlot(null);
                      setFreeItemName('');
                      setFreeItemDuration(30);
                    }}
                  />
                );
              })}
            </div>
            <div className="ds-divider" />
            <DailyTaskPool
              open={poolOpen}
              filter={filterSource}
              items={poolItems}
              completedItems={completedPoolItems}
              backlogItems={backlogTasks}
              selectedDate={selectedDate}
              showCompleted={showCompletedPool}
              checkIsUnlinkedTask={checkIsUnlinkedTask}
              checkIsLinkedTask={checkIsLinkedTask}
              onOpenChange={(open) => setPoolPreference(open ? 'open' : 'closed')}
              onFilterChange={setFilterSource}
              onShowCompletedChange={setShowCompletedPool}
              onOpenProjectSource={openProjectTaskFromSource}
              onUndoCompleted={handleUndoCompletedPoolItem}
              onScheduleBacklog={scheduleBacklogToDate}
              onOpenBacklogTask={openBacklogTask}
            />
          </div>
        </DragDropContext>
        {progressTask && (
          <QuantityProgressDialog
            taskId={progressTask.taskId}
            block={progressTask.block}
            date={selectedDate}
            onClose={() => setProgressTask(null)}
          />
        )}
        {retrospectiveOpen && (
          <DailyRetrospectiveDialog
            date={selectedDate}
            activities={completedActivities}
            graphNodes={graphNodes}
            existing={selectedRetrospective}
            onSave={upsertRetrospective}
            onClose={() => setRetrospectiveOpen(false)}
          />
        )}
        {dailyPlanOpen && (
          <DailyReviewPlanner
            reviewTasks={ebbReviewTasks}
            settings={ebbSettingsData}
            onApply={(request) => {
              const result = applyDailyReviewPlan(request);
              const deferredDates = [...new Set(Object.values(result.assignmentsByTaskId).filter((date) => date !== result.planDate))]
                .sort()
                .map((date) => formatDate(date, 'M月D日'));
              setDailyPlanFeedback(`明天保留 ${result.keptCount} 轮；另外 ${result.deferredCount} 轮已调整${deferredDates.length > 0 ? `至 ${deferredDates.join('、')}` : ''}`);
              return result;
            }}
            onClose={() => setDailyPlanOpen(false)}
          />
        )}
      </div>
  );
};

export default DailyScheduleView;

// ============================================================
// 每日任务安排页面 - 主视图
// 左右分栏：左侧 2/3 时间安排区 + 右侧 1/3 任务池
// 支持两种模式：时段模式(slots) / 时间块模式(blocks)
// ============================================================

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import '@/styles/daily-schedule.css';
import { todayStr } from '@/utils/dateSafe';
import { projectTasksForDate, reviewTasksForDate } from '@/domain/dailyTaskProjection';
import {
  DragDropContext,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  Settings2,
  ListTodo,
  Plus,
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
  getValidGraphNodeIds,
  isQuantityTask,
} from '@/utils/blocks';
import { useGraphStore } from '@/graph/store';
import { useShallow } from 'zustand/react/shallow';
import { getReviewTopicKey, computeRounds } from '@/ebb/scheduler';
import { buildRootNodeMap, getReviewCategoryColor, resolveReviewCategory } from '@/ebb/category';
import { useDailyScheduleStore, EMPTY_DAY_SCHEDULE } from './store';
import { getProjectBlockSourceId, getReviewSourceId } from './sourceIds';
import BlockModeView from './BlockModeView';
import QuantityProgressDialog from './QuantityProgressDialog';
import {
  DEFAULT_TIME_SLOT_CONFIGS,
  type TimeSlot,
  type TaskSource,
  type ScheduledItem,
  type TimeSlotConfig,
  type ScheduleViewMode,
} from './types';
import type { SmartTaskBlock } from '@/types';
import { useSmartTaskTodos } from '@/hooks/useSmartTaskTodos';
import { parseSourceId } from './conversion';
import { useTaskCompletionStatus } from './useTaskCompletionStatus';
import { openProjectTaskModal } from '@/components/smartBlock/projectTaskModal';
import {
  resolveProjectAppearance,
} from './projectAppearance';
import { recordOperation, useOperationHistory } from '@/services/operationHistory';
import { recordQuantityProgress, removeQuantityProgress, rescheduleProjectTask, setProjectTaskCompletion } from '@/services/projectTaskCommands';
import { returnProjectTaskToBacklog, scheduleBacklogTaskToSlot } from '@/services/backlogCommands';
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
import { openProjectTaskCreate } from '@/components/smartBlock/projectTaskCreate';

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
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('slots');
  const [showCompletedPool, setShowCompletedPool] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [backlogFeedback, setBacklogFeedback] = useState<{ text: string; operationId?: string } | null>(null);
  const undoOperation = useOperationHistory((state) => state.undo);
  const [progressTask, setProgressTask] = useState<{ taskId: string; block: SmartTaskBlock } | null>(null);
  const [poolPreference, setPoolPreference] = useState<'auto' | 'open' | 'closed'>('auto');
  const [isCompactLayout, setIsCompactLayout] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 900px)').matches);

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

  const openAllProjectTasks = useCallback(() => {
    window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'task-overview' } }));
  }, []);

  const { tasks: rawTlTasks, groups: rawTlGroups } = useTimelineStore(
    useShallow((s) => ({ tasks: s.tasks, groups: s.groups })),
  );
  const {
    reviewTasks: rawEbbReviewTasks,
    ebbSettings: ebbSettingsData,
  } = useEbbStore(
    useShallow((s) => ({
      reviewTasks: s.reviewTasks,
      ebbSettings: s.ebbSettings,
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
  const backlogTasks = useMemo(() => collectBacklogTasks(tlTasks), [tlTasks]);
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
    const result = rescheduleProjectTask(task.taskId, task.blockId, date);
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
  } = useDailyScheduleStore(
    useShallow((s) => ({
      isHydrated: s.isHydrated,
      hydrateStore: s.hydrateStore,
      addScheduledItem: s.addScheduledItem,
      reorderScheduledItems: s.reorderScheduledItems,
      moveScheduledItem: s.moveScheduledItem,
      removeScheduledItem: s.removeScheduledItem,
      removeTimeBlock: s.removeTimeBlock,
    })),
  );

  const scheduleForDate = useDailyScheduleStore((s) => s.schedules[selectedDate]);
  const daySchedule = scheduleForDate ?? EMPTY_DAY_SCHEDULE;

  // 时间段配置（可自定义）
  const [slotConfigs, setSlotConfigs] = useState<TimeSlotConfig[]>(DEFAULT_TIME_SLOT_CONFIGS);
  const [showSlotSettings, setShowSlotSettings] = useState(false);

  // 筛选/排序
  const [filterSource, setFilterSource] = useState<'all' | 'project' | 'review' | 'quantity'>('all');

  // ── 添加自由占位符 ───────────────────────────────────────
  const [addingFreeSlot, setAddingFreeSlot] = useState<TimeSlot | null>(null);
  const [freeItemName, setFreeItemName] = useState('');
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
        });
      }
      return '';
    });
    setAddingFreeSlot(null);
  }, [selectedDate, addScheduledItem]);

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
        duration: quantityHeader ? undefined : todo._duration,
        quantityActual: dailyStatus?.actual,
        quantityTarget: dailyStatus?.target ?? suggestion?.suggested,
        quantityTotal: quantityHeader ? quantityTotal : undefined,
        quantityCompleted: quantityHeader ? quantityCompleted : undefined,
        quantityUnit: quantityHeader ? quantityUnit : undefined,
        quantityState: dailyStatus?.state,
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
        duration: 30,
      });
    }

    return items;
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
            completed: checkIsCompleted(i.source, i.sourceId, selectedDate),
            detail: appearance?.name ?? i.detail,
            color: appearance?.theme.backgroundColor ?? i.color,
            categoryColor: quantityHeader ? (quantityHeader.tagColor || '#10B981') : appearance?.categoryColor ?? reviewCategoryColor ?? i.categoryColor,
            duration: quantityHeader ? undefined : i.duration,
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
        const beforeIds = new Set((useDailyScheduleStore.getState().schedules[selectedDate]?.items ?? []).map((item) => item.id));

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
        if (created) recordOperation({
          label: `安排“${poolItem.name}”`, detail: `已拖入${targetSlot === 'morning' ? '上午' : targetSlot === 'afternoon' ? '下午' : '晚上'}`, modules: ['每日安排'],
          undoSpec: { kind: 'daily-remove', payload: { date: selectedDate, itemId: created.id, expectedSourceId: created.sourceId } },
        }, () => {
          const latest = useDailyScheduleStore.getState().schedules[selectedDate]?.items.find((item) => item.id === created.id);
          if (!latest || latest.sourceId !== created.sourceId) return '安排项已经发生变化';
          useDailyScheduleStore.getState().removeScheduledItem(selectedDate, created.id);
        });
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
      addScheduledItem,
      backlogTasks,
      getProjectBlockFromSource,
      getSlotItems,
      moveScheduledItem,
      poolItems,
      removeScheduledItem,
      reorderScheduledItems,
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
      }
      // toggleScheduledItem 已经被移除，底层数据变化后 getSlotItems 自动重新计算
    },
    [daySchedule.items, daySchedule.blocks, toggleReviewWithFeedback, syncProjectTaskCompletion, getProjectBlockFromSource],
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
      text: restored ? '已撤销，任务已恢复到原排期和时段' : '撤销失败，请在最近操作中查看原因',
    });
  }, [backlogFeedback, undoOperation]);

  // ── 时间段统计 ──────────────────────────────────────────
  const getSlotStats = useCallback(
    (slot: TimeSlot) => {
      const items = getSlotItems(slot).filter(i => i.source !== 'free');
      const total = items.length;
      const completed = items.filter((i) => i.completed).length;
      const inProgress = items.filter((item) => item.quantityState === 'in-progress').length;
      const totalDuration = items.reduce((sum, item) => sum + (isQuantitySource(item.sourceId) ? 0 : (item.duration ?? 30)), 0);
      return { total, completed, inProgress, totalDuration };
    },
    [getSlotItems, isQuantitySource],
  );

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
        <header className="ds-header">
          <div className="ds-header-left">
            <h1 className="ds-title">每日安排</h1>
            <input
              type="date"
              className="ds-date-input"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
            />
          </div>
          <div className="ds-header-right">
            <button type="button" className="ds-header-btn" onClick={() => openProjectTaskCreate({ date: selectedDate, source: 'daily-schedule' })} aria-label="新建项目任务">
              <Plus size={15} />新建任务
            </button>
            <button type="button" className="ds-header-btn" onClick={openAllProjectTasks} aria-label="查看全部项目任务">
              <ListTodo size={15} />全部任务
            </button>
            {/* 视图模式切换 */}
            <div className="ds-mode-switch" role="tablist" aria-label="排期模式切换">
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'slots'}
                aria-controls="slots-view"
                className={`ds-mode-btn ${viewMode === 'slots' ? 'ds-mode-btn--active' : ''}`}
                onClick={() => setViewMode('slots')}
              >
                时段
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={viewMode === 'blocks'}
                aria-controls="blocks-view"
                className={`ds-mode-btn ${viewMode === 'blocks' ? 'ds-mode-btn--active' : ''}`}
                onClick={() => setViewMode('blocks')}
              >
                时间块
              </button>
            </div>
            {viewMode === 'slots' && (
              <button
                type="button"
                className="ds-header-btn"
                onClick={() => setShowSlotSettings(!showSlotSettings)}
                title="时间段设置"
              >
                <Settings2 size={15} />
                时间段设置
              </button>
            )}
          </div>
        </header>

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

        {/* ── 时间段设置面板（仅时段模式） ──────────────── */}
        {viewMode === 'slots' && showSlotSettings && (
          <div className="ds-slot-settings">
            {slotConfigs.map((config, idx) => (
              <div key={config.slot} className="ds-slot-setting-row">
                <span className={`ds-slot-setting-icon ds-slot-icon--${config.slot}`}><TimeSlotIcon slot={config.slot} size={14} /></span>
                <span className="ds-slot-setting-label">{config.label}</span>
                <input
                  type="number"
                  className="ds-slot-setting-input"
                  value={config.startHour}
                  min={0}
                  max={23}
                  onChange={(e) => {
                    const newConfigs = [...slotConfigs];
                    newConfigs[idx] = { ...config, startHour: parseInt(e.target.value) || 0 };
                    setSlotConfigs(newConfigs);
                  }}
                />
                <span className="ds-slot-setting-sep">-</span>
                <input
                  type="number"
                  className="ds-slot-setting-input"
                  value={config.endHour}
                  min={0}
                  max={23}
                  onChange={(e) => {
                    const newConfigs = [...slotConfigs];
                    newConfigs[idx] = { ...config, endHour: parseInt(e.target.value) || 0 };
                    setSlotConfigs(newConfigs);
                  }}
                />
                <span className="ds-slot-setting-unit">时</span>
              </div>
            ))}
          </div>
        )}

        {/* ── 时段模式 ──────────────────────────────────── */}
        {viewMode === 'slots' && (
        <DragDropContext onDragStart={() => setPoolPreference('open')} onDragEnd={handleDragEnd}>
          <div className={`ds-body ${poolOpen ? 'ds-body--pool-open' : 'ds-body--pool-collapsed'}`}>
            <div className="ds-left">
              {slotConfigs.map((config) => {
                const slotItems = getSlotItems(config.slot);
                return (
                  <DailySlotSection
                    key={config.slot}
                    config={config}
                    items={slotItems}
                    stats={getSlotStats(config.slot)}
                    addingFree={addingFreeSlot === config.slot}
                    freeItemName={freeItemName}
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
                    onStartAddFree={() => setAddingFreeSlot(config.slot)}
                    onFreeItemNameChange={setFreeItemName}
                    onSubmitFree={() => handleAddFreeSubmit(config.slot)}
                    onCancelFree={() => {
                      isCancelingFreeRef.current = true;
                      setAddingFreeSlot(null);
                      setFreeItemName('');
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
        )}

        {/* ── 时间块模式 ────────────────────────────────── */}
        {viewMode === 'blocks' && (
          <BlockModeView
            selectedDate={selectedDate}
            poolItems={poolItems}
            completedPoolItems={allCompletedPoolItems}
            backlogItems={backlogTasks}
            onScheduleBacklog={scheduleBacklogToDate}
            onOpenBacklogTask={openBacklogTask}
            onReviewToggleError={setOperationError}
            onOpenQuantityProgress={(taskId, block) => setProgressTask({ taskId, block })}
          />
        )}
        {progressTask && (
          <QuantityProgressDialog
            taskId={progressTask.taskId}
            block={progressTask.block}
            date={selectedDate}
            onClose={() => setProgressTask(null)}
          />
        )}
      </div>
  );
};

export default DailyScheduleView;

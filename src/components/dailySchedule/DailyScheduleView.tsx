// ============================================================
// 每日任务安排页面 - 主视图
// 左右分栏：左侧 2/3 时间安排区 + 右侧 1/3 任务池
// 支持两种模式：时段模式(slots) / 时间块模式(blocks)
// ============================================================

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { todayStr } from '@/utils/dateSafe';
import {
  DragDropContext,
  Droppable,
  Draggable,
  type DropResult,
} from '@hello-pangea/dnd';
import {
  Check,
  GripVertical,
  Clock,
  X,
  Settings2,
  CircleDashed,
  Link as LinkIcon,
} from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { getValidGraphNodeIds } from '@/utils/blocks';
import { useGraphStore } from '@/graph/store';
import { useShallow } from 'zustand/react/shallow';
import { isOverdue, computeRounds } from '@/ebb/scheduler';
import { useDailyScheduleStore, EMPTY_DAY_SCHEDULE } from './store';
import BlockModeView from './BlockModeView';
import {
  DEFAULT_TIME_SLOT_CONFIGS,
  type TimeSlot,
  type TaskSource,
  type ScheduledItem,
  type TimeSlotConfig,
  type ScheduleViewMode,
} from './types';
import { useSmartTaskTodos } from '@/hooks/useSmartTaskTodos';
import { parseSourceId } from './conversion';
import { useTaskCompletionStatus } from './useTaskCompletionStatus';

// ── Droppable IDs ────────────────────────────────────────────

const DROPPABLE_POOL = 'ds-pool';
const droppableIdForSlot = (slot: TimeSlot) => `ds-slot-${slot}`;

// ── 主组件 ───────────────────────────────────────────────────

const DailyScheduleView: React.FC = () => {
  const today = todayStr();
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('slots');

  const { tasks: rawTlTasks, updateBlockHeader: tlUpdateBlockHeader } = useTimelineStore(
    useShallow((s) => ({ tasks: s.tasks, updateBlockHeader: s.updateBlockHeader })),
  );
  const {
    reviewTasks: rawEbbReviewTasks,
    ebbSettings: ebbSettingsData,
    toggleReviewTask: ebbToggleReviewTask,
  } = useEbbStore(
    useShallow((s) => ({
      reviewTasks: s.reviewTasks,
      ebbSettings: s.ebbSettings,
      toggleReviewTask: s.toggleReviewTask,
    })),
  );

  const { nodes: graphNodes } = useGraphStore();

  // 过滤冷数据（已归档节点关联的任务/块）
  const archivedNodeIds = useMemo(() => new Set(graphNodes.filter(n => n.isArchived).map(n => n.id)), [graphNodes]);

  const ebbReviewTasks = useMemo(() => {
    return rawEbbReviewTasks.filter(t => {
      if (t.isArchived) return false;
      const ids = getValidGraphNodeIds(t as any); // t is ReviewTask which shares structure
      return !ids.some(id => archivedNodeIds.has(id));
    });
  }, [rawEbbReviewTasks, archivedNodeIds]);

  const tlTasks = useMemo(() => {
    return rawTlTasks.map(task => ({
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
  }, [rawTlTasks, archivedNodeIds]);

  const { checkIsCompleted } = useTaskCompletionStatus();
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
  const [filterSource, setFilterSource] = useState<'all' | TaskSource>('all');

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
  const allSmartTaskTodos = useSmartTaskTodos(tlTasks);
  // 数据来源已统一为 SmartTaskBlock，不再走 markdown 待办
  const mergedTodos = allSmartTaskTodos;

  const todayProjectTasks = useMemo(() => {
    return mergedTodos.filter((todo) => {
      if (todo.checked) return false;
      // 只有精确指定了排期日或截止日为当天的任务才会被纳入任务池
      if (todo.scheduled && todo.scheduled === selectedDate) return true;
      if (todo.due && todo.due === selectedDate) return true;
      return false;
    });
  }, [mergedTodos, selectedDate]);

  // ── 获取今日复习任务 ─────────────────────────────────────
  const todayReviewTasks = useMemo(() => {
    return ebbReviewTasks.filter((t) => {
      if (t.isCompleted) return false;
      return t.dueDate === selectedDate || (isOverdue(t) && selectedDate === today);
    });
  }, [ebbReviewTasks, selectedDate, today]);

  // ── 判断是否未绑定节点 ──────────────────────────────────
  const checkIsUnlinkedTask = useCallback((sourceId: string) => {
    const parsed = parseSourceId(sourceId);
    if (!parsed) return false;

    if (parsed.source === 'review') {
      const reviewTask = ebbReviewTasks.find((t) => t.id === parsed.reviewId);
      return reviewTask ? !reviewTask.graphNodeId : false;
    }
    
    if (parsed.source === 'project') {
      const parentTask = tlTasks.find((t) => t.id === parsed.parentTaskId);
      if (!parentTask || !parentTask.blocks) return false;
      
      if (parsed.blockId) {
        const block = parentTask.blocks.find(b => b.id === parsed.blockId);
        if (block?.type === 'smart-task') {
          const ids = getValidGraphNodeIds(block.header);
          return ids.length === 0; // 如果没有 graphNodeIds，说明未绑定
        }
      }
    }
    return false;
  }, [tlTasks, ebbReviewTasks]);

  // ── 判断是否已绑定节点 ──────────────────────────────────
  const checkIsLinkedTask = useCallback((sourceId: string) => {
    const parsed = parseSourceId(sourceId);
    if (!parsed) return false;

    if (parsed.source === 'review') {
      const reviewTask = ebbReviewTasks.find((t) => t.id === parsed.reviewId);
      return reviewTask ? !!reviewTask.graphNodeId : false;
    }
    
    if (parsed.source === 'project') {
      const parentTask = tlTasks.find((t) => t.id === parsed.parentTaskId);
      if (!parentTask || !parentTask.blocks) return false;
      
      if (parsed.blockId) {
        const block = parentTask.blocks.find(b => b.id === parsed.blockId);
        if (block?.type === 'smart-task') {
          const ids = getValidGraphNodeIds(block.header);
          return ids.length > 0; // 如果有 graphNodeIds，说明已绑定
        }
      }
    }
    return false;
  }, [tlTasks, ebbReviewTasks]);

  // ── 已安排的 sourceId 集合（items + blocks 合并） ────────
  const scheduledSourceIds = useMemo(() => {
    const ids = new Set<string>();
    for (const item of daySchedule.items) ids.add(item.sourceId);
    for (const block of daySchedule.blocks ?? []) ids.add(block.sourceId);
    return ids;
  }, [daySchedule.items, daySchedule.blocks]);

  // ── 构建右侧任务池列表（时段模式用） ─────────────────────
  const poolItems = useMemo(() => {
    const items: {
      id: string;
      name: string;
      source: TaskSource;
      color?: string;
      detail?: string;
      duration?: number;
      sourceId: string;
    }[] = [];

    for (const todo of todayProjectTasks) {
      // 区分 blocks 和 markdown 来源的 sourceId
      const sourceId = todo._blockId
        ? `project-blk:${todo.parentTaskId}::${todo._blockId}`
        : `project-md:${todo.id}`;
      if (scheduledSourceIds.has(sourceId)) continue;
      items.push({
        id: `pool-project-${todo.id}`,
        name: todo.text,
        source: 'project',
        color: todo.parentTaskColor,
        detail: todo.parentTaskTitle,
        sourceId,
        duration: todo._duration,
      });
    }

    const { roundMap, totalRoundsMap } = computeRounds(ebbReviewTasks);
    for (const task of todayReviewTasks) {
      if (scheduledSourceIds.has(`review-${task.id}`)) continue;
      const round = roundMap.get(task.id) ?? 1;
      const total = totalRoundsMap.get(task.topicName) ?? 1;
      items.push({
        id: `pool-review-${task.id}`,
        name: task.topicName,
        source: 'review',
        color: ebbSettingsData.tagColors[task.tag ?? ''] ?? '#8B9DC3',
        detail: `第${round}/${total}轮`,
        sourceId: `review-${task.id}`,
      });
    }

    let filtered = items;
    if (filterSource !== 'all') {
      filtered = filtered.filter((i) => i.source === filterSource);
    }

    return filtered;
  }, [todayProjectTasks, todayReviewTasks, scheduledSourceIds, filterSource, ebbReviewTasks, ebbSettingsData]);

  // ── 辅助函数：根据用户配置动态划分时段 ──────────────────
  // ── 获取时间段内的已安排任务 ─────────────────────────────
  const getSlotItems = useCallback(
    (slot: TimeSlot): ScheduledItem[] => {
      const normalItems = daySchedule.items
        .filter((i) => i.timeSlot === slot)
        .sort((a, b) => a.order - b.order)
        .map((i) => ({ ...i, completed: checkIsCompleted(i.source, i.sourceId) }));

      return normalItems;
    },
    [daySchedule.items, checkIsCompleted],
  );

  // ── 拖拽处理（时段模式） ─────────────────────────────────
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { source, destination, draggableId } = result;
      if (!destination) return;

      const srcDroppableId = source.droppableId;
      const destDroppableId = destination.droppableId;
      const destIndex = destination.index;

      // 从右侧任务池拖入左侧时间段
      if (
        (srcDroppableId === DROPPABLE_POOL || srcDroppableId === `${DROPPABLE_POOL}-review`) &&
        destDroppableId.startsWith('ds-slot-')
      ) {
        const targetSlot = destDroppableId.replace('ds-slot-', '') as TimeSlot;
        const poolItem = poolItems.find((i) => i.id === draggableId);
        if (!poolItem) return;

        addScheduledItem(selectedDate, {
          sourceId: poolItem.sourceId,
          name: poolItem.name,
          source: poolItem.source,
          timeSlot: targetSlot,
          completed: false,
          color: poolItem.color,
          detail: poolItem.detail,
          duration: poolItem.duration,
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
        } else {
          const destItems = getSlotItems(destSlot);
          const normalDestItems = destItems.filter(i => !i.id.startsWith('virtual-block-'));
          const clampedIndex = Math.min(destIndex, normalDestItems.length);
          moveScheduledItem(selectedDate, draggedItem.id, destSlot, clampedIndex);
        }
        return;
      }

      // 从左侧拖回右侧任务池 = 移除 (自由块拖回任务池相当于直接删除)
      if (
        srcDroppableId.startsWith('ds-slot-') &&
        (destDroppableId === DROPPABLE_POOL || destDroppableId === `${DROPPABLE_POOL}-review` || destDroppableId === 'ds-pool-container')
      ) {
        const srcSlot = srcDroppableId.replace('ds-slot-', '') as TimeSlot;
        const srcItems = getSlotItems(srcSlot);
        const draggedItem = srcItems[source.index];
        if (!draggedItem) return;
        removeScheduledItem(selectedDate, draggedItem.id);
      }
    },
    [poolItems, selectedDate, addScheduledItem, reorderScheduledItems, moveScheduledItem, removeScheduledItem, getSlotItems],
  );

  // ── 完成/删除 操作（时段模式） ──────────────────────────
  const syncProjectTaskCompletion = useCallback((sourceId: string) => {
    const parsed = parseSourceId(sourceId);
    if (!parsed || parsed.source !== 'project') return false;
    const parentTask = tlTasks.find((t) => t.id === parsed.parentTaskId);
    if (!parentTask) return false;

    if (parsed.blockId) {
      const now = todayStr();
      const currentBlock = (parentTask.blocks ?? []).find(b => b.id === parsed.blockId);
      const isCurrentlyDone = currentBlock?.type === 'smart-task' && currentBlock.header.isCompleted;
      tlUpdateBlockHeader(parsed.parentTaskId, parsed.blockId, {
        isCompleted: !isCurrentlyDone,
        completedDate: !isCurrentlyDone ? now : undefined,
      });
      return true;
    }
    return false;
  }, [tlTasks, tlUpdateBlockHeader]);

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
          ebbToggleReviewTask(reviewId);
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
        ebbToggleReviewTask(reviewId);
      } else if (item.source === 'project') {
        syncProjectTaskCompletion(item.sourceId);
      }
      // toggleScheduledItem 已经被移除，底层数据变化后 getSlotItems 自动重新计算
    },
    [daySchedule.items, daySchedule.blocks, ebbToggleReviewTask, syncProjectTaskCompletion],
  );

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

  // ── 时间段统计 ──────────────────────────────────────────
  const getSlotStats = useCallback(
    (slot: TimeSlot) => {
      const items = getSlotItems(slot).filter(i => i.source !== 'free');
      const total = items.length;
      const completed = items.filter((i) => i.completed).length;
      const totalDuration = items.reduce((sum, i) => sum + (i.duration ?? 30), 0);
      return { total, completed, totalDuration };
    },
    [getSlotItems],
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

        {/* ── 时间段设置面板（仅时段模式） ──────────────── */}
        {viewMode === 'slots' && showSlotSettings && (
          <div className="ds-slot-settings">
            {slotConfigs.map((config, idx) => (
              <div key={config.slot} className="ds-slot-setting-row">
                <span className="ds-slot-setting-icon">{config.icon}</span>
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
        <DragDropContext onDragEnd={handleDragEnd}>
          <div className="ds-body">
            {/* 左侧：时间安排区 */}
            <div className="ds-left">
              {slotConfigs.map((config) => {
                const slotItems = getSlotItems(config.slot);
                const stats = getSlotStats(config.slot);
                return (
                  <div key={config.slot} className="ds-slot-section">
                    <div className="ds-slot-header">
                      <div className="ds-slot-title">
                        <span className="ds-slot-icon">{config.icon}</span>
                        <span>{config.label}</span>
                        <span className="ds-slot-time">
                          {String(config.startHour).padStart(2, '0')}:00 – {String(config.endHour).padStart(2, '0')}:00
                        </span>
                      </div>
                      <div className="ds-slot-stats">
                        {stats.completed}/{stats.total} 完成
                        {stats.totalDuration > 0 && (
                          <span className="ds-slot-duration">~{stats.totalDuration}分钟</span>
                        )}
                      </div>
                    </div>
                    <Droppable droppableId={droppableIdForSlot(config.slot)}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`ds-slot-dropzone ${
                            snapshot.isDraggingOver ? 'ds-slot-dropzone--active' : ''
                          } ${slotItems.length === 0 ? 'ds-slot-dropzone--empty' : ''}`}
                        >
                          {slotItems.length === 0 && !snapshot.isDraggingOver && (
                            <div className="ds-slot-placeholder">
                              拖拽右侧任务到此处
                            </div>
                          )}
                          {slotItems.map((item, index) => (
                            <Draggable key={item.id} draggableId={item.id} index={index} isDragDisabled={item.id.startsWith('virtual-block-')}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className={`ds-item ${item.completed ? 'ds-item--completed' : ''} ${
                                    snapshot.isDragging ? 'ds-item--dragging' : ''
                                  } ${item.id.startsWith('virtual-block-') ? 'ds-item--virtual' : ''} ${
                                    checkIsUnlinkedTask(item.sourceId) ? 'ds-item--unlinked' : ''
                                  } ${item.source === 'free' ? 'ds-item--free' : ''}`}
                                >
                                  {item.source !== 'free' && (
                                    <div
                                      className="ds-item-accent"
                                      style={{ backgroundColor: item.color ?? '#8B9DC3' }}
                                    />
                                  )}
                                  {!item.id.startsWith('virtual-block-') && (
                                    <div className="ds-item-grip" {...provided.dragHandleProps}>
                                      <GripVertical size={14} />
                                    </div>
                                  )}
                                  <div className="ds-item-content">
                                    <span className="ds-item-name" title={item.name}>
                                        {item.name}
                                        {item.source !== 'free' && (
                                          <>
                                            {checkIsUnlinkedTask(item.sourceId) ? (
                                              <span title="未绑定节点" className="ml-1 inline-flex items-center">
                                                <CircleDashed size={12} className="opacity-40" />
                                              </span>
                                            ) : checkIsLinkedTask(item.sourceId) && (
                                              <span title="已绑定节点" className="ml-1 inline-flex items-center text-blue-500">
                                                <LinkIcon size={12} className="opacity-60" />
                                              </span>
                                            )}
                                          </>
                                        )}
                                      </span>
                                    {item.detail && (
                                      <span className="ds-item-detail">{item.detail}</span>
                                    )}
                                  </div>

                                  {item.id.startsWith('virtual-block-') && (
                                    <div className="ds-item-duration ds-item-duration--virtual">
                                      <Clock size={11} />
                                      {(() => {
                                        const b = daySchedule.blocks?.find(x => x.id === item.id.replace('virtual-block-', ''));
                                        return b ? `${b.startTime}-${b.endTime}` : '';
                                      })()}
                                    </div>
                                  )}

                                  {item.duration && !item.id.startsWith('virtual-block-') && (
                                    <span className="ds-item-duration">
                                      <Clock size={11} />
                                      {item.duration}min
                                    </span>
                                  )}

                                  <span
                                    className={`ds-item-source ds-item-source--${item.source}`}
                                  >
                                    {item.source === 'project' ? '项目' : item.source === 'review' ? '复习' : '占位'}
                                  </span>

                                  {item.source !== 'free' && (
                                    <button
                                      type="button"
                                      className={`ds-item-check ${item.completed ? 'ds-item-check--done' : ''}`}
                                      onClick={() => handleToggleItem(item.id)}
                                    >
                                      <Check size={13} />
                                    </button>
                                  )}

                                  <button
                                    type="button"
                                    className="ds-item-delete"
                                    onClick={() => handleRemoveItem(item.id)}
                                  >
                                    <X size={13} />
                                  </button>
                                </div>
                              )}
                            </Draggable>
                          ))}
                          {provided.placeholder}

                          {/* 添加生活占位符的入口 */}
                          {addingFreeSlot === config.slot ? (
                            <div className="ds-slot-add-free-input-wrap">
                              <input
                                ref={freeInputRef}
                                type="text"
                                className="ds-slot-add-free-input"
                                placeholder="输入生活安排..."
                                value={freeItemName}
                                onChange={(e) => setFreeItemName(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') handleAddFreeSubmit(config.slot);
                                  if (e.key === 'Escape') {
                                    isCancelingFreeRef.current = true;
                                    setAddingFreeSlot(null);
                                    setFreeItemName('');
                                  }
                                }}
                                onBlur={() => handleAddFreeSubmit(config.slot)}
                              />
                            </div>
                          ) : (
                            <button
                              type="button"
                              className="ds-slot-add-free-btn"
                              onClick={() => setAddingFreeSlot(config.slot)}
                            >
                              + 添加生活占位
                            </button>
                          )}
                        </div>
                      )}
                    </Droppable>
                  </div>
                );
              })}
            </div>

            {/* 分隔线 */}
            <div className="ds-divider" />

            {/* 右侧：任务池 */}
            <Droppable droppableId="ds-pool-container" isDropDisabled={false}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={`ds-right ${snapshot.isDraggingOver ? 'ds-right--drop-target' : ''}`}
                >
                  <div className="ds-pool-header">
                    <h2 className="ds-pool-title">任务池</h2>
                    <div className="ds-pool-filters">
                      {(['all', 'project', 'review'] as const).map((f) => (
                        <button
                          key={f}
                          type="button"
                          className={`ds-filter-btn ${filterSource === f ? 'ds-filter-btn--active' : ''}`}
                          onClick={() => setFilterSource(f)}
                        >
                          {f === 'all' ? '全部' : f === 'project' ? '项目' : '复习'}
                        </button>
                      ))}
                    </div>
                  </div>

              {/* 项目任务 */}
              {poolItems.filter((i) => i.source === 'project').length > 0 && (
                <div className="ds-pool-group">
                  <div className="ds-pool-group-header">
                    <div className="ds-pool-group-dot ds-pool-group-dot--project" />
                    <span className="ds-pool-group-label">项目任务</span>
                    <span className="ds-pool-group-count">
                      {poolItems.filter((i) => i.source === 'project').length}
                    </span>
                  </div>
                  <Droppable droppableId={DROPPABLE_POOL}>
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className="ds-pool-list"
                      >
                        {poolItems
                          .filter((i) => i.source === 'project')
                          .map((item, idx) => (
                            <Draggable key={item.id} draggableId={item.id} index={idx}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`ds-pool-item ${snapshot.isDragging ? 'ds-pool-item--dragging' : ''} ${
                                    checkIsUnlinkedTask(item.sourceId) ? 'ds-pool-item--unlinked' : ''
                                  }`}
                                >
                                  <div
                                    className="ds-pool-item-accent"
                                    style={{ backgroundColor: item.color ?? '#8B9DC3' }}
                                  />
                                  <div className="ds-pool-item-content">
                                    <span className="ds-pool-item-name" title={item.name}>
                                      {item.name}
                                      {checkIsUnlinkedTask(item.sourceId) ? (
                                        <span title="未绑定节点" className="ml-1 inline-flex items-center">
                                          <CircleDashed size={12} className="opacity-40" />
                                        </span>
                                      ) : checkIsLinkedTask(item.sourceId) && (
                                        <span title="已绑定节点" className="ml-1 inline-flex items-center text-blue-500">
                                          <LinkIcon size={12} className="opacity-60" />
                                        </span>
                                      )}
                                    </span>
                                    {item.detail && (
                                      <span className="ds-pool-item-detail">{item.detail}</span>
                                    )}
                                  </div>
                                  <span className="ds-pool-item-tag ds-pool-item-tag--project">项目</span>
                                </div>
                              )}
                            </Draggable>
                          ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              )}

              {/* 复习任务 */}
              {poolItems.filter((i) => i.source === 'review').length > 0 && (
                <div className="ds-pool-group">
                  <div className="ds-pool-group-header">
                    <div className="ds-pool-group-dot ds-pool-group-dot--review" />
                    <span className="ds-pool-group-label">复习任务</span>
                    <span className="ds-pool-group-count">
                      {poolItems.filter((i) => i.source === 'review').length}
                    </span>
                  </div>
                  <Droppable droppableId={`${DROPPABLE_POOL}-review`}>
                    {(provided) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className="ds-pool-list"
                      >
                        {poolItems
                          .filter((i) => i.source === 'review')
                          .map((item, idx) => (
                            <Draggable key={item.id} draggableId={item.id} index={idx}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  {...provided.dragHandleProps}
                                  className={`ds-pool-item ${snapshot.isDragging ? 'ds-pool-item--dragging' : ''} ${
                                    checkIsUnlinkedTask(item.sourceId) ? 'ds-pool-item--unlinked' : ''
                                  }`}
                                >
                                  <div
                                    className="ds-pool-item-accent"
                                    style={{ backgroundColor: item.color ?? '#8B9DC3' }}
                                  />
                                  <div className="ds-pool-item-content">
                                    <span className="ds-pool-item-name" title={item.name}>
                                      {item.name}
                                      {checkIsUnlinkedTask(item.sourceId) ? (
                                        <span title="未绑定节点" className="ml-1 inline-flex items-center">
                                          <CircleDashed size={12} className="opacity-40" />
                                        </span>
                                      ) : checkIsLinkedTask(item.sourceId) && (
                                        <span title="已绑定节点" className="ml-1 inline-flex items-center text-blue-500">
                                          <LinkIcon size={12} className="opacity-60" />
                                        </span>
                                      )}
                                    </span>
                                    {item.detail && (
                                      <span className="ds-pool-item-detail">{item.detail}</span>
                                    )}
                                  </div>
                                  <span className="ds-pool-item-tag ds-pool-item-tag--review">复习</span>
                                </div>
                              )}
                            </Draggable>
                          ))}
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                </div>
              )}

              {poolItems.length === 0 && (
                <div className="ds-pool-empty">今日暂无待安排任务</div>
              )}
              {provided.placeholder}
            </div>
            )}
          </Droppable>
          </div>
        </DragDropContext>
        )}

        {/* ── 时间块模式 ────────────────────────────────── */}
        {viewMode === 'blocks' && (
          <BlockModeView
            selectedDate={selectedDate}
            scheduledSourceIds={scheduledSourceIds}
          />
        )}
      </div>
  );
};

export default DailyScheduleView;

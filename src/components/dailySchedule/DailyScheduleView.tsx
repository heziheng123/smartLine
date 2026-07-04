// ============================================================
// 每日任务安排页面 - 主视图
// 左右分栏：左侧 2/3 时间安排区 + 右侧 1/3 任务池
// 支持两种模式：时段模式(slots) / 时间块模式(blocks)
// ============================================================

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import dayjs from 'dayjs';
import isBetween from 'dayjs/plugin/isBetween';
dayjs.extend(isBetween);
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
} from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { isOverdue, computeRounds } from '@/ebb/scheduler';
import { useDailyScheduleStore } from './store';
import { toggleTodoLine } from '@/utils/markdown';
import BlockModeView from './BlockModeView';
import {
  DEFAULT_TIME_SLOT_CONFIGS,
  type TimeSlot,
  type TaskSource,
  type ScheduledItem,
  type TimeSlotConfig,
  type ScheduleViewMode,
} from './types';
import { useTodos } from '@/hooks/useTodos';
import { useSmartTaskTodos } from '@/hooks/useSmartTaskTodos';

// ── Droppable IDs ────────────────────────────────────────────

const DROPPABLE_POOL = 'ds-pool';
const droppableIdForSlot = (slot: TimeSlot) => `ds-slot-${slot}`;

// ── SourceId 解析工具 ────────────────────────────────────────

interface ParsedSourceId {
  source: 'project' | 'review';
  reviewId?: string;
  parentTaskId?: string;
  line?: number;
  /** 来源为 SmartTaskBlock 时，存储 blockId */
  blockId?: string;
}

/**
 * 解析 sourceId 格式：
 * - review: `review-{reviewId}`
 * - project (markdown): `project-md:{parentTaskId}-{line}`
 * - project (block): `project-blk:{parentTaskId}-{blockId}`
 * - project (legacy): `project-{parentTaskId}-{line}`（向后兼容）
 */
function parseSourceId(sourceId: string): ParsedSourceId | null {
  if (sourceId.startsWith('review-')) {
    return { source: 'review', reviewId: sourceId.slice(7) };
  }

  if (sourceId.startsWith('project-')) {
    const fullId = sourceId.slice(8);

    // 新格式：blk:{taskId}-{blockId}
    if (fullId.startsWith('blk:')) {
      const rest = fullId.slice(4);
      const firstDash = rest.indexOf('-');
      if (firstDash === -1) return null;
      return {
        source: 'project',
        parentTaskId: rest.slice(0, firstDash),
        blockId: rest.slice(firstDash + 1),
      };
    }

    // 新格式：md:{taskId}-{line}
    if (fullId.startsWith('md:')) {
      const rest = fullId.slice(3);
      const lastDash = rest.lastIndexOf('-');
      if (lastDash === -1) return null;
      const parentTaskId = rest.slice(0, lastDash);
      const line = parseInt(rest.slice(lastDash + 1), 10);
      if (isNaN(line)) return null;
      return { source: 'project', parentTaskId, line };
    }

    // 旧格式兼容：{taskId}-{line}
    const lastDash = fullId.lastIndexOf('-');
    if (lastDash === -1) return null;
    const parentTaskId = fullId.slice(0, lastDash);
    const line = parseInt(fullId.slice(lastDash + 1), 10);
    if (isNaN(line)) return null;
    return { source: 'project', parentTaskId, line };
  }

  return null;
}

// ── 主组件 ───────────────────────────────────────────────────

const DailyScheduleView: React.FC = () => {
  const today = dayjs().format('YYYY-MM-DD');
  const [selectedDate, setSelectedDate] = useState(today);
  const [viewMode, setViewMode] = useState<ScheduleViewMode>('slots');

  const timelineStore = useTimelineStore();
  const ebbStore = useEbbStore();
  const scheduleStore = useDailyScheduleStore();

  const daySchedule = scheduleStore.getDaySchedule(selectedDate);

  // 时间段配置（可自定义）
  const [slotConfigs, setSlotConfigs] = useState<TimeSlotConfig[]>(DEFAULT_TIME_SLOT_CONFIGS);
  const [showSlotSettings, setShowSlotSettings] = useState(false);

  // 筛选/排序
  const [filterSource, setFilterSource] = useState<'all' | TaskSource>('all');

  // ── 获取指定日期的项目任务 ─────────────────────────────
  const allTodos = useTodos(timelineStore.tasks);
  const allSmartTaskTodos = useSmartTaskTodos(timelineStore.tasks);
  // 合并：blocks 待办优先，markdown 待办兜底（去重）
  const mergedTodos = useMemo(() => {
    // 如果任何任务有 blocks，优先用 blocks 的待办
    const tasksWithBlocks = new Set(
      timelineStore.tasks
        .filter(t => t.blocks && t.blocks.length > 0 && t.blocks.some(b => b.type === 'smart-task'))
        .map(t => t.id),
    );
    const blockTodos = allSmartTaskTodos.filter(t => tasksWithBlocks.has(t.parentTaskId));
    const mdTodos = allTodos.filter(t => !tasksWithBlocks.has(t.parentTaskId));
    return [...blockTodos, ...mdTodos];
  }, [allTodos, allSmartTaskTodos, timelineStore.tasks]);

  const todayProjectTasks = useMemo(() => {
    const selDate = dayjs(selectedDate);
    return mergedTodos.filter((todo) => {
      if (todo.checked) return false;
      // 优先检查 scheduled（SmartTaskBlock 的 header.date）和 due（header.deadline）
      if (todo.scheduled && todo.scheduled === selectedDate) return true;
      if (todo.due && todo.due === selectedDate) return true;
      // 无明确排期时，回退到父任务日期范围
      const parentTask = timelineStore.tasks.find((t) => t.id === todo.parentTaskId);
      if (parentTask && !todo.scheduled && !todo.due) {
        const taskStart = dayjs(parentTask.start);
        const taskEnd = dayjs(parentTask.end);
        if (selDate.isBetween(taskStart, taskEnd, 'day', '[]')) return true;
      }
      return false;
    });
  }, [mergedTodos, timelineStore.tasks, selectedDate]);

  // ── 获取今日复习任务 ─────────────────────────────────────
  const todayReviewTasks = useMemo(() => {
    return ebbStore.reviewTasks.filter((t) => {
      if (t.isCompleted) return false;
      return t.dueDate === selectedDate || (isOverdue(t) && selectedDate === today);
    });
  }, [ebbStore.reviewTasks, selectedDate, today]);

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
        ? `project-blk:${todo.parentTaskId}-${todo._blockId}`
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

    const { roundMap, totalRoundsMap } = computeRounds(ebbStore.reviewTasks);
    for (const task of todayReviewTasks) {
      if (scheduledSourceIds.has(`review-${task.id}`)) continue;
      const round = roundMap.get(task.id) ?? 1;
      const total = totalRoundsMap.get(task.topicName) ?? 1;
      items.push({
        id: `pool-review-${task.id}`,
        name: task.topicName,
        source: 'review',
        color: ebbStore.ebbSettings.tagColors[task.tag ?? ''] ?? '#8B9DC3',
        detail: `第${round}/${total}轮`,
        sourceId: `review-${task.id}`,
      });
    }

    let filtered = items;
    if (filterSource !== 'all') {
      filtered = filtered.filter((i) => i.source === filterSource);
    }

    return filtered;
  }, [todayProjectTasks, todayReviewTasks, scheduledSourceIds, filterSource, ebbStore]);

  // ── 获取时间段内的已安排任务 ─────────────────────────────
  const getSlotItems = useCallback(
    (slot: TimeSlot): ScheduledItem[] => {
      return daySchedule.items
        .filter((i) => i.timeSlot === slot)
        .sort((a, b) => a.order - b.order);
    },
    [daySchedule.items],
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

        scheduleStore.addScheduledItem(selectedDate, {
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
          const newOrder = srcItems.map((i) => i.id);
          const [removed] = newOrder.splice(source.index, 1);
          newOrder.splice(destIndex, 0, removed);
          scheduleStore.reorderScheduledItems(selectedDate, srcSlot, newOrder);
        } else {
          scheduleStore.moveScheduledItem(selectedDate, draggedItem.id, destSlot, destIndex);
        }
        return;
      }

      // 从左侧拖回右侧任务池 = 移除
      if (
        srcDroppableId.startsWith('ds-slot-') &&
        (destDroppableId === DROPPABLE_POOL || destDroppableId === `${DROPPABLE_POOL}-review`)
      ) {
        const srcSlot = srcDroppableId.replace('ds-slot-', '') as TimeSlot;
        const srcItems = getSlotItems(srcSlot);
        const draggedItem = srcItems[source.index];
        if (!draggedItem) return;
        scheduleStore.removeScheduledItem(selectedDate, draggedItem.id);
      }
    },
    [poolItems, selectedDate, scheduleStore, getSlotItems],
  );

  // ── 完成/删除 操作（时段模式） ──────────────────────────
  const handleToggleItem = useCallback(
    (itemId: string) => {
      scheduleStore.toggleScheduledItem(selectedDate, itemId);
      const item = daySchedule.items.find((i) => i.id === itemId);
      if (!item) return;

      if (item.source === 'review') {
        const reviewId = item.sourceId.replace('review-', '');
        ebbStore.toggleReviewTask(reviewId);
      } else if (item.source === 'project') {
        const parsed = parseSourceId(item.sourceId);
        if (!parsed || parsed.source !== 'project') return;
        const parentTask = timelineStore.tasks.find((t) => t.id === parsed.parentTaskId);
        if (!parentTask) return;

        if (parsed.blockId) {
          // blocks 来源：更新 SmartTaskBlock 的 isCompleted
          const now = dayjs().format('YYYY-MM-DD');
          const currentBlock = (parentTask.blocks ?? []).find(b => b.id === parsed.blockId);
          const isCurrentlyDone = currentBlock?.type === 'smart-task' && currentBlock.header.isCompleted;
          timelineStore.updateBlockHeader(parsed.parentTaskId, parsed.blockId!, {
            isCompleted: !isCurrentlyDone,
            completedDate: !isCurrentlyDone ? now : undefined,
          });
        } else if (parsed.line !== undefined) {
          // markdown 来源：切换待办行
          const newMarkdown = toggleTodoLine(parentTask.markdown ?? '', parsed.line);
          timelineStore.updateTaskMarkdown(parsed.parentTaskId, newMarkdown);
        }
      }
    },
    [scheduleStore, selectedDate, daySchedule.items, ebbStore, timelineStore],
  );

  const handleRemoveItem = useCallback(
    (itemId: string) => {
      scheduleStore.removeScheduledItem(selectedDate, itemId);
    },
    [scheduleStore, selectedDate],
  );

  // ── 时间段统计 ──────────────────────────────────────────
  const getSlotStats = useCallback(
    (slot: TimeSlot) => {
      const items = getSlotItems(slot);
      const total = items.length;
      const completed = items.filter((i) => i.completed).length;
      const totalDuration = items.reduce((sum, i) => sum + (i.duration ?? 30), 0);
      return { total, completed, totalDuration };
    },
    [getSlotItems],
  );

  // ── 双向同步 ─────────────────────────────────────────────
  useEffect(() => {
    for (const item of daySchedule.items) {
      if (item.source !== 'review') continue;
      const reviewId = item.sourceId.replace('review-', '');
      const reviewTask = ebbStore.reviewTasks.find((t) => t.id === reviewId);
      if (!reviewTask) continue;
      if (item.completed !== reviewTask.isCompleted) {
        scheduleStore.updateScheduledItem(selectedDate, item.id, {
          completed: reviewTask.isCompleted,
        });
      }
    }
  }, [ebbStore.reviewTasks, daySchedule.items, selectedDate, scheduleStore]);

  useEffect(() => {
    for (const item of daySchedule.items) {
      if (item.source !== 'project') continue;
      const parsed = parseSourceId(item.sourceId);
      if (!parsed || parsed.source !== 'project') continue;

      const parentTask = timelineStore.tasks.find((t) => t.id === parsed.parentTaskId);
      if (!parentTask) continue;

      let isActuallyCompleted: boolean;

      if (parsed.blockId) {
        // blocks 来源：从 SmartTaskBlock 获取完成状态
        const block = (parentTask.blocks ?? []).find(b => b.id === parsed.blockId);
        isActuallyCompleted = block?.type === 'smart-task' ? block.header.isCompleted : false;
      } else if (parsed.line !== undefined) {
        // markdown 来源：从待办行获取完成状态
        const md = parentTask.markdown ?? '';
        const lines = md.split(/\r?\n/);
        if (parsed.line < 0 || parsed.line >= lines.length) continue;
        const todoLine = lines[parsed.line];
        isActuallyCompleted = todoLine.match(/^[-*]\s*\[x\]/i) !== null;
      } else {
        continue;
      }

      if (item.completed !== isActuallyCompleted) {
        scheduleStore.updateScheduledItem(selectedDate, item.id, {
          completed: isActuallyCompleted,
        });
      }
    }
  }, [timelineStore.tasks, daySchedule.items, selectedDate, scheduleStore]);

  // ── 时间块模式双向同步 ──────────────────────────────────
  useEffect(() => {
    const timeBlocks = daySchedule.blocks ?? [];
    for (const tb of timeBlocks) {
      if (tb.source === 'review') {
        const reviewId = tb.sourceId.replace('review-', '');
        const reviewTask = ebbStore.reviewTasks.find((t) => t.id === reviewId);
        if (!reviewTask) continue;
        if (tb.completed !== reviewTask.isCompleted) {
          scheduleStore.updateTimeBlock(selectedDate, tb.id, {
            completed: reviewTask.isCompleted,
          });
        }
      } else if (tb.source === 'project') {
        const parsed = parseSourceId(tb.sourceId);
        if (!parsed || parsed.source !== 'project') continue;
        const parentTask = timelineStore.tasks.find((t) => t.id === parsed.parentTaskId);
        if (!parentTask) continue;

        let isActuallyCompleted: boolean;
        if (parsed.blockId) {
          const block = (parentTask.blocks ?? []).find(b => b.id === parsed.blockId);
          isActuallyCompleted = block?.type === 'smart-task' ? block.header.isCompleted : false;
        } else if (parsed.line !== undefined) {
          const md = parentTask.markdown ?? '';
          const lines = md.split(/\r?\n/);
          if (parsed.line < 0 || parsed.line >= lines.length) continue;
          const todoLine = lines[parsed.line];
          isActuallyCompleted = todoLine.match(/^[-*]\s*\[x\]/i) !== null;
        } else {
          continue;
        }

        if (tb.completed !== isActuallyCompleted) {
          scheduleStore.updateTimeBlock(selectedDate, tb.id, {
            completed: isActuallyCompleted,
          });
        }
      }
    }
  }, [ebbStore.reviewTasks, timelineStore.tasks, daySchedule.blocks, selectedDate, scheduleStore]);

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
            <div className="ds-mode-switch">
              <button
                type="button"
                className={`ds-mode-btn ${viewMode === 'slots' ? 'ds-mode-btn--active' : ''}`}
                onClick={() => setViewMode('slots')}
              >
                时段
              </button>
              <button
                type="button"
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
                            <Draggable key={item.id} draggableId={item.id} index={index}>
                              {(provided, snapshot) => (
                                <div
                                  ref={provided.innerRef}
                                  {...provided.draggableProps}
                                  className={`ds-item ${item.completed ? 'ds-item--completed' : ''} ${
                                    snapshot.isDragging ? 'ds-item--dragging' : ''
                                  }`}
                                >
                                  <div
                                    className="ds-item-accent"
                                    style={{ backgroundColor: item.color ?? '#8B9DC3' }}
                                  />
                                  <div className="ds-item-grip" {...provided.dragHandleProps}>
                                    <GripVertical size={14} />
                                  </div>
                                  <div className="ds-item-content">
                                    <span className="ds-item-name">
                                      {item.name}
                                    </span>
                                    {item.detail && (
                                      <span className="ds-item-detail">{item.detail}</span>
                                    )}
                                  </div>
                                  {item.duration && (
                                    <span className="ds-item-duration">
                                      <Clock size={11} />
                                      {item.duration}min
                                    </span>
                                  )}
                                  <span
                                    className={`ds-item-source ds-item-source--${item.source}`}
                                  >
                                    {item.source === 'project' ? '项目' : '复习'}
                                  </span>
                                  <button
                                    type="button"
                                    className={`ds-item-check ${item.completed ? 'ds-item-check--done' : ''}`}
                                    onClick={() => handleToggleItem(item.id)}
                                  >
                                    <Check size={13} />
                                  </button>
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
            <div className="ds-right">
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
                                  className={`ds-pool-item ${snapshot.isDragging ? 'ds-pool-item--dragging' : ''}`}
                                >
                                  <div
                                    className="ds-pool-item-accent"
                                    style={{ backgroundColor: item.color ?? '#8B9DC3' }}
                                  />
                                  <div className="ds-pool-item-content">
                                    <span className="ds-pool-item-name">{item.name}</span>
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
                                  className={`ds-pool-item ${snapshot.isDragging ? 'ds-pool-item--dragging' : ''}`}
                                >
                                  <div
                                    className="ds-pool-item-accent"
                                    style={{ backgroundColor: item.color ?? '#8B9DC3' }}
                                  />
                                  <div className="ds-pool-item-content">
                                    <span className="ds-pool-item-name">{item.name}</span>
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
            </div>
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

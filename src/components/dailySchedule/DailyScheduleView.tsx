// ============================================================
// 每日任务安排页面 - 主视图
// 左右分栏：左侧 2/3 时间安排区 + 右侧 1/3 任务池
// 支持拖拽安排、时间段排序、完成标记、数据持久化
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
import {
  DEFAULT_TIME_SLOT_CONFIGS,
  type TimeSlot,
  type TaskSource,
  type ScheduledItem,
  type TimeSlotConfig,
} from './types';
import { useTodos } from '@/hooks/useTodos';

// ── Droppable IDs ────────────────────────────────────────────

const DROPPABLE_POOL = 'ds-pool';
const droppableIdForSlot = (slot: TimeSlot) => `ds-slot-${slot}`;

// ── SourceId 解析工具 ────────────────────────────────────────

interface ParsedSourceId {
  source: 'project' | 'review';
  reviewId?: string;
  parentTaskId?: string;
  line?: number;
}

/**
 * 解析 sourceId 格式：
 * - review: `review-{reviewId}`
 * - project: `project-{parentTaskId}-{line}`（line 为 0-based）
 */
function parseSourceId(sourceId: string): ParsedSourceId | null {
  if (sourceId.startsWith('review-')) {
    return { source: 'review', reviewId: sourceId.slice(7) };
  }

  if (sourceId.startsWith('project-')) {
    const fullId = sourceId.slice(8);
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

  const timelineStore = useTimelineStore();
  const ebbStore = useEbbStore();
  const scheduleStore = useDailyScheduleStore();

  const daySchedule = scheduleStore.getDaySchedule(selectedDate);

  // 时间段配置（可自定义）
  const [slotConfigs, setSlotConfigs] = useState<TimeSlotConfig[]>(DEFAULT_TIME_SLOT_CONFIGS);
  const [showSlotSettings, setShowSlotSettings] = useState(false);

  // 筛选/排序
  const [filterSource, setFilterSource] = useState<'all' | TaskSource>('all');

  // ── 获取指定日期的项目任务（筛选：今天需要完成的待办）───
  const allTodos = useTodos(timelineStore.tasks);
  const todayProjectTasks = useMemo(() => {
    const selDate = dayjs(selectedDate);
    return allTodos.filter((todo) => {
      // 已完成的待办不显示
      if (todo.checked) return false;

      // 1. 有明确日期的待办：只显示日期等于 selectedDate 的
      if (todo.date) {
        return todo.date === selectedDate;
      }

      // 2. 无日期的待办：在任务持续期间（start 到 end）范围内显示
      //    让用户可以自由安排到任意日期
      const parentTask = timelineStore.tasks.find((t) => t.id === todo.parentTaskId);
      if (parentTask) {
        const taskStart = dayjs(parentTask.start);
        const taskEnd = dayjs(parentTask.end);
        // 当前日期在任务范围内（含边界）
        if (selDate.isBetween(taskStart, taskEnd, 'day', '[]')) {
          return true;
        }
      }

      return false;
    });
  }, [allTodos, timelineStore.tasks, selectedDate]);

  // ── 获取今日复习任务 ─────────────────────────────────────
  const todayReviewTasks = useMemo(() => {
    return ebbStore.reviewTasks.filter((t) => {
      if (t.isCompleted) return false;
      return t.dueDate === selectedDate || (isOverdue(t) && selectedDate === today);
    });
  }, [ebbStore.reviewTasks, selectedDate, today]);

  // ── 已安排的 sourceId 集合（右侧池中不显示已安排的任务） ──
  const scheduledSourceIds = useMemo(
    () => new Set(daySchedule.items.map((i) => i.sourceId)),
    [daySchedule.items],
  );

  // ── 构建右侧任务池列表 ───────────────────────────────────
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

    // 项目任务
    for (const todo of todayProjectTasks) {
      if (scheduledSourceIds.has(`project-${todo.id}`)) continue;
      items.push({
        id: `pool-project-${todo.id}`,
        name: todo.text,
        source: 'project',
        color: todo.parentTaskColor,
        detail: todo.parentTaskTitle,
        sourceId: `project-${todo.id}`,
      });
    }

    // 复习任务
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

    // 筛选
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

  // ── 拖拽处理 ─────────────────────────────────────────────
  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { source, destination, draggableId } = result;
      if (!destination) return;

      const srcDroppableId = source.droppableId;
      const destDroppableId = destination.droppableId;
      const destIndex = destination.index;

      // 从右侧任务池拖入左侧时间段（兼容两种 pool droppableId）
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

      // 左侧时间段之间的拖拽（跨时间段 或 同时间段排序）
      if (srcDroppableId.startsWith('ds-slot-') && destDroppableId.startsWith('ds-slot-')) {
        const srcSlot = srcDroppableId.replace('ds-slot-', '') as TimeSlot;
        const destSlot = destDroppableId.replace('ds-slot-', '') as TimeSlot;

        // 找到拖拽的 item
        const srcItems = getSlotItems(srcSlot);
        const draggedItem = srcItems[source.index];
        if (!draggedItem) return;

        if (srcSlot === destSlot) {
          // 同时间段内排序
          const newOrder = srcItems.map((i) => i.id);
          const [removed] = newOrder.splice(source.index, 1);
          newOrder.splice(destIndex, 0, removed);
          scheduleStore.reorderScheduledItems(selectedDate, srcSlot, newOrder);
        } else {
          // 跨时间段移动
          scheduleStore.moveScheduledItem(selectedDate, draggedItem.id, destSlot, destIndex);
        }
        return;
      }

      // 从左侧拖回右侧任务池 = 移除（兼容两种 pool droppableId）
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

  // ── 完成/删除 操作 ──────────────────────────────────────
  const handleToggleItem = useCallback(
    (itemId: string) => {
      scheduleStore.toggleScheduledItem(selectedDate, itemId);
      // 同步完成状态到源数据
      const item = daySchedule.items.find((i) => i.id === itemId);
      if (!item) return;

      if (item.source === 'review') {
        // 同步到 Ebb store
        const reviewId = item.sourceId.replace('review-', '');
        ebbStore.toggleReviewTask(reviewId);
      } else if (item.source === 'project') {
        // 同步到 Timeline Markdown
        const parsed = parseSourceId(item.sourceId);
        if (!parsed || parsed.source !== 'project') return;

        const parentTask = timelineStore.tasks.find((t) => t.id === parsed.parentTaskId);
        if (!parentTask) return;

        const newMarkdown = toggleTodoLine(parentTask.markdown ?? '', parsed.line);
        timelineStore.updateTaskMarkdown(parsed.parentTaskId, newMarkdown);
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

  // ── 双向同步：监听源 store 变化，更新每日安排中的完成状态 ───
  // TODO: 优化点 - 当前每次 store 变化都遍历所有 items
  //       可用 useRef 缓存上一次状态，只对差异项更新
  //       但正常使用场景（几十个任务）性能影响不大，暂保持当前实现
  useEffect(() => {
    // 同步复习任务完成状态（从 Ebb store → 每日安排）
    for (const item of daySchedule.items) {
      if (item.source !== 'review') continue;
      const reviewId = item.sourceId.replace('review-', '');
      const reviewTask = ebbStore.reviewTasks.find((t) => t.id === reviewId);
      if (!reviewTask) continue;
      // 状态不一致时更新
      if (item.completed !== reviewTask.isCompleted) {
        scheduleStore.updateScheduledItem(selectedDate, item.id, {
          completed: reviewTask.isCompleted,
        });
      }
    }
  }, [ebbStore.reviewTasks, daySchedule.items, selectedDate, scheduleStore]);

  useEffect(() => {
    // 同步项目任务完成状态（从 Timeline Markdown → 每日安排）
    for (const item of daySchedule.items) {
      if (item.source !== 'project') continue;
      const parsed = parseSourceId(item.sourceId);
      if (!parsed || parsed.source !== 'project') continue;

      const parentTask = timelineStore.tasks.find((t) => t.id === parsed.parentTaskId);
      if (!parentTask) continue;

      // 从 Markdown 中提取该行待办的完成状态
      // 注意：line 为 0-based 索引（与 extractTodos / toggleTodoLine 保持一致）
      const md = parentTask.markdown ?? '';
      const lines = md.split(/\r?\n/);
      if (parsed.line < 0 || parsed.line >= lines.length) continue;
      const todoLine = lines[parsed.line];
      const isLineChecked = todoLine.match(/^[-*]\s*\[x\]/i) !== null;

      // 状态不一致时更新
      if (item.completed !== isLineChecked) {
        scheduleStore.updateScheduledItem(selectedDate, item.id, {
          completed: isLineChecked,
        });
      }
    }
  }, [timelineStore.tasks, daySchedule.items, selectedDate, scheduleStore]);

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
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
            <button
              type="button"
              className="ds-header-btn"
              onClick={() => setShowSlotSettings(!showSlotSettings)}
              title="时间段设置"
            >
              <Settings2 size={15} />
              时间段设置
            </button>
          </div>
        </header>

        {/* ── 时间段设置面板 ──────────────────────────────── */}
        {showSlotSettings && (
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

        {/* ── 主体区域：左右分栏 ──────────────────────────── */}
        <div className="ds-body">
          {/* ── 左侧：时间安排区 (2/3) ────────────────────── */}
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
                                  onMouseDown={(e) => e.stopPropagation()}
                                  title={item.completed ? '标记未完成' : '标记完成'}
                                >
                                  <Check size={13} />
                                </button>
                                <button
                                  type="button"
                                  className="ds-item-delete"
                                  onClick={() => handleRemoveItem(item.id)}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  title="移除"
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

          {/* ── 分隔线 ────────────────────────────────────── */}
          <div className="ds-divider" />

          {/* ── 右侧：任务池 (1/3) ────────────────────────── */}
          <div className="ds-right">
            <div className="ds-pool-header">
              <h2 className="ds-pool-title">待安排任务</h2>
              <div className="ds-pool-filters">
                <button
                  type="button"
                  className={`ds-filter-btn ${filterSource === 'all' ? 'ds-filter-btn--active' : ''}`}
                  onClick={() => setFilterSource('all')}
                >
                  全部
                </button>
                <button
                  type="button"
                  className={`ds-filter-btn ${filterSource === 'project' ? 'ds-filter-btn--active' : ''}`}
                  onClick={() => setFilterSource('project')}
                >
                  项目
                </button>
                <button
                  type="button"
                  className={`ds-filter-btn ${filterSource === 'review' ? 'ds-filter-btn--active' : ''}`}
                  onClick={() => setFilterSource('review')}
                >
                  复习
                </button>
              </div>
            </div>

            {/* ── 项目任务组 ──────────────────────────────── */}
            {filterSource !== 'review' && (
              <div className="ds-pool-group">
                <div className="ds-pool-group-header">
                  <span className="ds-pool-group-dot ds-pool-group-dot--project" />
                  <span className="ds-pool-group-label">项目任务</span>
                  <span className="ds-pool-group-count">
                    {poolItems.filter((i) => i.source === 'project').length}
                  </span>
                </div>
                <Droppable droppableId={DROPPABLE_POOL} isDropDisabled={false}>
                  {(provided) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className="ds-pool-list"
                    >
                      {poolItems
                        .filter((i) => i.source === 'project')
                        .map((item, index) => (
                          <Draggable key={item.id} draggableId={item.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`ds-pool-item ${
                                  snapshot.isDragging ? 'ds-pool-item--dragging' : ''
                                }`}
                              >
                                <div
                                  className="ds-pool-item-accent"
                                  style={{ backgroundColor: item.color ?? '#93A8C8' }}
                                />
                                <div className="ds-pool-item-content">
                                  <span className="ds-pool-item-name">{item.name}</span>
                                  {item.detail && (
                                    <span className="ds-pool-item-detail">{item.detail}</span>
                                  )}
                                </div>
                                <span className="ds-pool-item-tag ds-pool-item-tag--project">
                                  项目
                                </span>
                              </div>
                            )}
                          </Draggable>
                        ))}
                      {poolItems.filter((i) => i.source === 'project').length === 0 && (
                        <div className="ds-pool-empty">暂无项目任务</div>
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            )}

            {/* ── 复习任务组 ──────────────────────────────── */}
            {filterSource !== 'project' && (
              <div className="ds-pool-group">
                <div className="ds-pool-group-header">
                  <span className="ds-pool-group-dot ds-pool-group-dot--review" />
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
                        .map((item, index) => (
                          <Draggable key={item.id} draggableId={item.id} index={index}>
                            {(provided, snapshot) => (
                              <div
                                ref={provided.innerRef}
                                {...provided.draggableProps}
                                {...provided.dragHandleProps}
                                className={`ds-pool-item ${
                                  snapshot.isDragging ? 'ds-pool-item--dragging' : ''
                                }`}
                              >
                                <div
                                  className="ds-pool-item-accent"
                                  style={{ backgroundColor: item.color ?? '#A8B5C8' }}
                                />
                                <div className="ds-pool-item-content">
                                  <span className="ds-pool-item-name">{item.name}</span>
                                  {item.detail && (
                                    <span className="ds-pool-item-detail">{item.detail}</span>
                                  )}
                                </div>
                                <span className="ds-pool-item-tag ds-pool-item-tag--review">
                                  复习
                                </span>
                              </div>
                            )}
                          </Draggable>
                        ))}
                      {poolItems.filter((i) => i.source === 'review').length === 0 && (
                        <div className="ds-pool-empty">暂无复习任务</div>
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </div>
            )}
          </div>
        </div>
      </div>
    </DragDropContext>
  );
};

export default DailyScheduleView;

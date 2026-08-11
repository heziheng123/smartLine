import React, { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useState } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, ListChecks, Search } from 'lucide-react';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { getReviewSourceId } from '@/components/dailySchedule/sourceIds';
import { DEFAULT_TIME_SLOT_CONFIGS, type TimeSlot } from '@/components/dailySchedule/types';
import { useShallow } from 'zustand/react/shallow';
import { addDays, formatDate, getDayOfWeek, todayStr } from '@/utils/dateSafe';
import { useGraphStore } from '@/graph/store';
import type { EbbSettings, ReviewTask } from '../types';
import { computeRounds, getDateLabel, getReviewTopicKey, isOverdue } from '../scheduler';
import { getReviewRoundDuration } from '../duration';
import { buildRootNodeMap, getReviewCategoryColor, resolveReviewCategory } from '../category';
import type { TaskActions } from './MatrixView';

class BoardErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(_error: Error, info: ErrorInfo) { void info; }
  render() {
    if (this.state.error) return <div className="eb-week-board-error">轮次排期加载失败：{this.state.error.message}</div>;
    return this.props.children;
  }
}

interface BoardViewProps {
  tasks: ReviewTask[];
  settings: EbbSettings;
  taskActions: TaskActions;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

const getWeekStart = (date: string) => {
  const weekday = getDayOfWeek(date);
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
};

const shiftMonth = (date: string, amount: number) => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const totalMonths = year * 12 + month - 1 + amount;
  const targetYear = Math.floor(totalMonths / 12);
  const targetMonth = totalMonths % 12 + 1;
  const maxDay = new Date(targetYear, targetMonth, 0).getDate();
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
};

const BoardView: React.FC<BoardViewProps> = ({ tasks, settings, taskActions, selectedDate, onSelectDate }) => {
  const [cursor, setCursor] = useState(selectedDate || todayStr());
  const [rangeMode, setRangeMode] = useState<'week' | 'month'>('week');
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [pendingOnly, setPendingOnly] = useState(false);
  const graphNodes = useGraphStore((state) => state.nodes);
  const { schedules, isDailyHydrated, hydrateDailyStore } = useDailyScheduleStore(useShallow((state) => ({
    schedules: state.schedules,
    isDailyHydrated: state.isHydrated,
    hydrateDailyStore: state.hydrateStore,
  })));
  const rootByNodeId = useMemo(() => buildRootNodeMap(graphNodes), [graphNodes]);
  const { roundMap, totalRoundsMap } = useMemo(() => computeRounds(tasks), [tasks]);
  const weekStart = useMemo(() => getWeekStart(cursor), [cursor]);
  const dates = useMemo(() => {
    if (rangeMode === 'week') return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    const monthStart = `${cursor.slice(0, 7)}-01`;
    const daysInMonth = new Date(Number(cursor.slice(0, 4)), Number(cursor.slice(5, 7)), 0).getDate();
    return Array.from({ length: daysInMonth }, (_, index) => addDays(monthStart, index));
  }, [cursor, rangeMode, weekStart]);
  const today = todayStr();

  const timeSlotLabel = (slot: TimeSlot | 'unscheduled') => slot === 'unscheduled'
    ? '待安排'
    : DEFAULT_TIME_SLOT_CONFIGS.find((config) => config.slot === slot)?.label ?? slot;

  useEffect(() => setCursor(selectedDate), [selectedDate]);
  useEffect(() => {
    if (!isDailyHydrated) hydrateDailyStore();
  }, [hydrateDailyStore, isDailyHydrated]);

  const decorated = useMemo(() => tasks.filter((task) => !task.isArchived).map((task) => {
    const category = resolveReviewCategory(task, rootByNodeId);
    return {
      task,
      category,
      categoryLabel: category?.label ?? '未分类',
      categoryColor: getReviewCategoryColor(category, settings.tagColors) ?? '#94A3B8',
      round: roundMap.get(task.id) ?? task.roundOrder ?? 1,
      totalRounds: totalRoundsMap.get(getReviewTopicKey(task)) ?? 1,
    };
  }), [rootByNodeId, roundMap, settings.tagColors, tasks, totalRoundsMap]);

  const categories = useMemo(() => [...new Set(decorated.map((item) => item.categoryLabel))]
    .sort((a, b) => a.localeCompare(b, 'zh-CN')), [decorated]);

  const tasksByDate = useMemo(() => {
    const result = new Map<string, typeof decorated>();
    dates.forEach((date) => result.set(date, []));
    const normalizedQuery = query.trim().toLowerCase();
    decorated.forEach((item) => {
      if (!result.has(item.task.dueDate)) return;
      if (pendingOnly && item.task.isCompleted) return;
      if (categoryFilter && item.categoryLabel !== categoryFilter) return;
      if (normalizedQuery && !item.task.topicName.toLowerCase().includes(normalizedQuery)
        && !item.categoryLabel.toLowerCase().includes(normalizedQuery)) return;
      result.get(item.task.dueDate)!.push(item);
    });
    result.forEach((items) => items.sort((left, right) =>
      Number(left.task.isCompleted) - Number(right.task.isCompleted)
      || left.task.topicName.localeCompare(right.task.topicName, 'zh-CN')
      || left.round - right.round));
    return result;
  }, [categoryFilter, dates, decorated, pendingOnly, query]);

  const selectedSummary = useMemo(() => {
    const items = decorated.filter((item) => item.task.dueDate === selectedDate);
    const completed = items.filter((item) => item.task.isCompleted).length;
    const overdue = items.filter((item) => isOverdue(item.task)).length;
    const totalMinutes = items.reduce((sum, item) => sum + getReviewRoundDuration(item.task, item.round), 0);
    const remainingMinutes = items
      .filter((item) => !item.task.isCompleted)
      .reduce((sum, item) => sum + getReviewRoundDuration(item.task, item.round), 0);
    return { total: items.length, completed, overdue, totalMinutes, remainingMinutes };
  }, [decorated, selectedDate]);

  return <div className="eb-week-board">
    <div className="eb-week-board-toolbar">
      <div className="eb-week-board-nav">
        <button type="button" onClick={() => {
          const nextDate = rangeMode === 'week' ? addDays(selectedDate, -7) : shiftMonth(selectedDate, -1);
          setCursor(nextDate);
          onSelectDate(nextDate);
        }} aria-label={rangeMode === 'week' ? '上一周' : '上个月'}><ChevronLeft size={16} /></button>
        <strong>{rangeMode === 'week' ? `${formatDate(weekStart, 'M月D日')}—${formatDate(addDays(weekStart, 6), 'M月D日')}` : formatDate(`${cursor.slice(0, 7)}-01`, 'YYYY年MM月')}</strong>
        <button type="button" onClick={() => {
          const nextDate = rangeMode === 'week' ? addDays(selectedDate, 7) : shiftMonth(selectedDate, 1);
          setCursor(nextDate);
          onSelectDate(nextDate);
        }} aria-label={rangeMode === 'week' ? '下一周' : '下个月'}><ChevronRight size={16} /></button>
        <button type="button" className="is-today" onClick={() => { setCursor(today); onSelectDate(today); }}>今天</button>
        <div className="eb-week-board-range" role="group" aria-label="轮次排期时间范围">
          <button type="button" className={rangeMode === 'week' ? 'is-active' : ''} onClick={() => setRangeMode('week')}>周</button>
          <button type="button" className={rangeMode === 'month' ? 'is-active' : ''} onClick={() => setRangeMode('month')}>月</button>
        </div>
      </div>
      <div className="eb-week-board-filters">
        <label className="eb-week-board-search"><Search size={14} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索复习主题" /></label>
        <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)} aria-label="筛选复习分类">
          <option value="">全部分类</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <button type="button" className={pendingOnly ? 'is-active' : ''} onClick={() => setPendingOnly((value) => !value)} aria-pressed={pendingOnly}>只看未完成</button>
      </div>
    </div>

    <div className="eb-week-board-summary" aria-live="polite">
      <div>
        <strong>{formatDate(selectedDate, 'M月D日')} · {WEEKDAY_LABELS[getDayOfWeek(selectedDate)]}</strong>
        {selectedDate === today && <em>今天</em>}
      </div>
      <span>{selectedSummary.total} 轮 · {selectedSummary.totalMinutes} 分钟</span>
      <span>已完成 {selectedSummary.completed}/{selectedSummary.total}</span>
      {selectedSummary.overdue > 0 && <span className="is-overdue">逾期 {selectedSummary.overdue}</span>}
      <span>预计剩余 {selectedSummary.remainingMinutes} 分钟</span>
    </div>

    <div
      className={`eb-week-board-grid ${rangeMode === 'month' ? 'is-month' : ''}`}
    >
      <div
        className="eb-week-board-columns"
        style={rangeMode === 'month' ? { gridTemplateColumns: `repeat(${dates.length}, minmax(136px, 150px))` } : undefined}
      >
        {dates.map((date, dateIndex) => {
        const items = tasksByDate.get(date) ?? [];
        const minutes = items.reduce((sum, item) => sum + getReviewRoundDuration(item.task, item.round), 0);
        const completedCount = items.filter((item) => item.task.isCompleted).length;
        const overdueCount = items.filter((item) => isOverdue(item.task)).length;
        const allDone = items.length > 0 && completedCount === items.length;
        const thresholds = settings.loadThresholds ?? [2, 4, 6, 9];
        const loadLevel = items.length === 0 ? 0
          : items.length <= thresholds[0] ? 1
            : items.length <= thresholds[1] ? 2
              : items.length <= thresholds[2] ? 3
                : items.length <= thresholds[3] ? 4 : 5;
        const isToday = date === today;
        const isSelected = date === selectedDate;
        const scheduledSlotBySource = new Map(
          (schedules[date]?.items ?? [])
            .filter((entry) => entry.source === 'review')
            .map((entry) => [entry.sourceId, entry.timeSlot]),
        );
        const groupedItems = (['morning', 'afternoon', 'evening', 'unscheduled'] as const)
          .map((slot) => ({
            slot,
            items: items
              .map((item, index) => ({ item, index }))
              .filter(({ item }) => (scheduledSlotBySource.get(getReviewSourceId(item.task.id)) ?? 'unscheduled') === slot),
          }))
          .filter((group) => group.items.length > 0);
        return <Droppable droppableId={`ebb-day-${date}`} key={date}>
          {(provided, snapshot) => <section
            ref={provided.innerRef}
            {...provided.droppableProps}
            data-date={date}
            className={`eb-week-day ${isToday ? 'is-today' : ''} ${isSelected ? 'is-selected' : ''} ${snapshot.isDraggingOver ? 'is-drag-over' : ''} ${dateIndex > 0 && getDayOfWeek(date) === 1 ? 'is-week-start' : ''}`}
            onClick={() => onSelectDate(date)}
          >
            <header>
              <span>{WEEKDAY_LABELS[getDayOfWeek(date)]}</span>
              <strong>{Number(date.slice(8))}</strong>
              <small>{items.length}轮 · {minutes}m</small>
              <i className={`eb-week-day-load is-level-${loadLevel} ${overdueCount > 0 ? 'has-overdue' : ''} ${allDone ? 'is-done' : ''}`} aria-hidden="true" />
            </header>
            <div className="eb-week-day-cards">
              {groupedItems.map((group) => (
                <div className="eb-week-day-slot-group" key={group.slot}>
                  <div className="eb-week-day-slot-label">{timeSlotLabel(group.slot)}</div>
                  {group.items.map(({ item, index }) => {
                const dateLabel = getDateLabel(item.task.dueDate, item.task.isCompleted);
                const changed = Boolean(item.task.originalDueDate && item.task.originalDueDate !== item.task.dueDate);
                return <Draggable draggableId={item.task.id} index={index} key={item.task.id} isDragDisabled={item.task.isCompleted}>
                  {(dragProvided, dragSnapshot) => <article
                    ref={dragProvided.innerRef}
                    {...dragProvided.draggableProps}
                    {...dragProvided.dragHandleProps}
                    className={`eb-week-round-card ${item.task.isCompleted ? 'is-completed' : ''} ${isOverdue(item.task) ? 'is-overdue' : ''} ${dragSnapshot.isDragging ? 'is-dragging' : ''}`}
                    style={{ ...dragProvided.draggableProps.style, '--round-color': item.categoryColor } as unknown as React.CSSProperties}
                    onClick={(event) => { event.stopPropagation(); taskActions.onOpenTimeline(getReviewTopicKey(item.task)); }}
                    title={item.task.isCompleted
                      ? '已完成轮次不能直接改期；如需调整，请先取消完成'
                      : changed
                        ? `原计划 ${item.task.originalDueDate}，当前 ${item.task.dueDate}；拖到其他日期可再次改期`
                        : `${item.task.topicName} · 第${item.round}轮；拖到其他日期改期`}
                  >
                    <div className="eb-week-round-card-title"><span>{item.task.topicName}</span>{changed && <i aria-label="日期已调整" />}</div>
                    <div className="eb-week-round-card-meta">
                      <b>{item.task.isCompleted && <Check size={11} />}R{item.round}/{item.totalRounds}</b>
                      <span><Clock3 size={11} />{getReviewRoundDuration(item.task, item.round)}m</span>
                      <em>{dateLabel.text}</em>
                    </div>
                    <div className="eb-week-round-card-footer">
                      <span style={{ color: item.categoryColor }}>{item.categoryLabel}</span>
                      <button type="button" onClick={(event) => { event.stopPropagation(); taskActions.onOpenRounds(item.task); }} aria-label={`重新安排${item.task.topicName}的剩余轮次`}><ListChecks size={13} /></button>
                      <button type="button" onClick={(event) => { event.stopPropagation(); void taskActions.onToggle(item.task.id); }} aria-label={item.task.isCompleted ? `取消第${item.round}轮完成` : `标记第${item.round}轮完成`}><Check size={13} /></button>
                    </div>
                  </article>}
                </Draggable>;
                  })}
                </div>
              ))}
              {items.length === 0 && <div className="eb-week-day-empty"><CalendarDays size={18} /><span>暂无轮次</span></div>}
              {provided.placeholder}
            </div>
          </section>}
        </Droppable>;
        })}
      </div>
    </div>
  </div>;
};

const BoardViewWithBoundary: React.FC<BoardViewProps> = (props) => <BoardErrorBoundary><BoardView {...props} /></BoardErrorBoundary>;

export default BoardViewWithBoundary;

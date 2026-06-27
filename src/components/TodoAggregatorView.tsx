// ============================================================
// Smart Timeline - 待办汇总视图（莫兰迪风格 + DnD + 状态指示）
// 将所有任务 Markdown 中的带日期待办，按 日/周/月 集中展示
// 卡片左边缘高亮继承所属大任务颜色，与主应用视觉风格统一
// 支持拖拽改期 & 从待规划箱排期
// ============================================================

import React, { useCallback, useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd';
import type { AggregatedTodo, TodoViewMode } from '@/types';

interface TodoAggregatorViewProps {
  todos: AggregatedTodo[];
  onTaskClick: (parentTaskId: string) => void;
  /** 拖拽改期回调：todoId → 将该待办的日期改为 newDate（undefined 表示移除日期） */
  onTodoDateChange?: (todoId: string, newDate: string | undefined) => void;
}

const WEEKDAY_FULL = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const WEEKDAY_BY_DAYJS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

/** droppableId 格式约定：`day-{YYYY-MM-DD}` 或 `backlog` */
const DAY_PREFIX = 'day-';

function isOverdue(dateStr: string): boolean {
  return dayjs(dateStr).isBefore(dayjs(), 'day');
}

function getWeekStart(date: dayjs.Dayjs): dayjs.Dayjs {
  const d = date.day();
  const offset = d === 0 ? -6 : 1 - d;
  return date.add(offset, 'day');
}

const TodoAggregatorView: React.FC<TodoAggregatorViewProps> = ({
  todos,
  onTaskClick,
  onTodoDateChange,
}) => {
  const [mode, setMode] = useState<TodoViewMode>('week');
  const [cursor, setCursor] = useState(() => dayjs());
  const [backlogOpen, setBacklogOpen] = useState(false);

  const datedTodos = useMemo(() => todos.filter((t) => t.date), [todos]);
  const undatedTodos = useMemo(() => todos.filter((t) => !t.date), [todos]);

  const todosByDate = useMemo(() => {
    const map = new Map<string, AggregatedTodo[]>();
    for (const todo of datedTodos) {
      const key = todo.date!;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(todo);
    }
    return map;
  }, [datedTodos]);

  const todayStr = dayjs().format('YYYY-MM-DD');

  const handlePrev = useCallback(() => {
    if (mode === 'day') setCursor((c) => c.subtract(1, 'day'));
    else if (mode === 'week') setCursor((c) => c.subtract(1, 'week'));
    else setCursor((c) => c.subtract(1, 'month'));
  }, [mode]);

  const handleNext = useCallback(() => {
    if (mode === 'day') setCursor((c) => c.add(1, 'day'));
    else if (mode === 'week') setCursor((c) => c.add(1, 'week'));
    else setCursor((c) => c.add(1, 'month'));
  }, [mode]);

  const handleToday = useCallback(() => setCursor(dayjs()), []);

  const rangeLabel = useMemo(() => {
    if (mode === 'day') return `${cursor.format('YYYY年M月D日')} ${WEEKDAY_BY_DAYJS[cursor.day()]}`;
    if (mode === 'week') {
      const start = getWeekStart(cursor);
      const end = start.add(6, 'day');
      if (start.month() === end.month()) {
        return `${start.format('YYYY年M月D日')} - ${end.format('D日')}`;
      }
      return `${start.format('YYYY年M月D日')} - ${end.format('M月D日')}`;
    }
    return cursor.format('YYYY年M月');
  }, [mode, cursor]);

  // ── DnD 处理 ──────────────────────────────────────────────

  const handleDragEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination } = result;
      if (!destination) return; // 拖出边界，取消

      const destId = destination.droppableId;
      if (destId === 'backlog') {
        // 拖回待规划箱 → 移除日期
        onTodoDateChange?.(draggableId, undefined);
      } else if (destId.startsWith(DAY_PREFIX)) {
        // 拖到某天列 → 设置日期
        const newDate = destId.slice(DAY_PREFIX.length);
        onTodoDateChange?.(draggableId, newDate);
      }
    },
    [onTodoDateChange],
  );

  // ── 卡片渲染 ──────────────────────────────────────────────

  const renderDraggableCard = useCallback(
    (todo: AggregatedTodo, index: number) => {
      const overdue = !todo.checked && todo.date && isOverdue(todo.date);
      const isTodayCard = todo.date === todayStr && !todo.checked;

      return (
        <Draggable key={todo.id} draggableId={todo.id} index={index}>
          {(provided, snapshot) => (
            <div
              ref={provided.innerRef}
              {...provided.draggableProps}
              {...provided.dragHandleProps}
              onClick={() => onTaskClick(todo.parentTaskId)}
              className={[
                'tl-todo-card',
                todo.checked ? 'tl-todo-card--done' : '',
                overdue ? 'tl-todo-card--overdue' : '',
                isTodayCard ? 'tl-todo-card--today' : '',
                snapshot.isDragging ? 'tl-todo-card--dragging' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                '--task-color': todo.parentTaskColor || '#E5E7EB',
                ...provided.draggableProps.style,
              } as React.CSSProperties & Record<string, unknown>}
            >
              <div className="tl-todo-card-accent" />
              <div className="tl-todo-card-body">
                <div className="tl-todo-card-meta">
                  <span className="tl-todo-card-dot" />
                  <span className="tl-todo-card-parent">{todo.parentTaskTitle}</span>
                  {overdue && <span className="tl-todo-card-overdue-badge">逾期</span>}
                </div>
                <div className="tl-todo-card-content">
                  <input
                    type="checkbox"
                    checked={todo.checked}
                    className="tl-todo-card-check"
                    onClick={(e) => e.stopPropagation()}
                    readOnly
                  />
                  <span className="tl-todo-card-text">{todo.text}</span>
                </div>
              </div>
            </div>
          )}
        </Draggable>
      );
    },
    [onTaskClick, todayStr],
  );

  const renderEmpty = (hint: string) => (
    <div className="tl-todo-empty">
      <div className="tl-todo-empty-icon">✦</div>
      <div className="tl-todo-empty-text">{hint}</div>
    </div>
  );

  // ── 周视图（带 DnD） ──────────────────────────────────────

  const renderWeek = () => {
    const weekStart = getWeekStart(cursor);
    const days = Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));

    return (
      <DragDropContext onDragEnd={handleDragEnd}>
        <div className="tl-todo-week-wrapper">
          <div className="tl-todo-week-view">
            {days.map((day) => {
              const dateStr = day.format('YYYY-MM-DD');
              const isToday = dateStr === todayStr;
              const isWeekend = day.day() === 0 || day.day() === 6;
              const dayTodos = todosByDate.get(dateStr) ?? [];

              return (
                <div
                  key={dateStr}
                  className={`tl-todo-week-col ${isWeekend ? 'tl-todo-week-col--weekend' : ''}`}
                >
                  <div
                    className={`tl-todo-week-header ${isToday ? 'tl-todo-week-header--today' : ''} ${isWeekend ? 'tl-todo-week-header--weekend' : ''}`}
                  >
                    <span className="tl-todo-week-weekday">
                      {WEEKDAY_FULL[(day.day() + 6) % 7]}
                    </span>
                    <span className={`tl-todo-week-date ${isToday ? 'tl-todo-week-date--today' : ''}`}>
                      {day.date()}
                    </span>
                    {dayTodos.length > 0 && (
                      <span className="tl-todo-week-count">{dayTodos.length}</span>
                    )}
                  </div>
                  <Droppable droppableId={`${DAY_PREFIX}${dateStr}`}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={`tl-todo-week-body ${snapshot.isDraggingOver ? 'tl-todo-week-body--drag-over' : ''}`}
                      >
                        {dayTodos.length === 0 ? (
                          <div className="tl-todo-week-empty" />
                        ) : (
                          dayTodos.map((t, idx) => renderDraggableCard(t, idx))
                        )}
                        {provided.placeholder}
                        <button type="button" className="tl-todo-week-ghost-btn">
                          + 添加待办
                        </button>
                      </div>
                    )}
                  </Droppable>
                </div>
              );
            })}
          </div>

          <aside className={`tl-todo-backlog ${backlogOpen ? 'tl-todo-backlog--open' : ''}`}>
            {backlogOpen ? (
              <>
                <div className="tl-todo-backlog-header">
                  <div className="tl-todo-backlog-title">
                    <span className="tl-todo-backlog-name">待规划任务箱</span>
                    <span className="tl-todo-backlog-badge">{undatedTodos.length}</span>
                  </div>
                  <button
                    type="button"
                    className="tl-todo-backlog-toggle"
                    onClick={() => setBacklogOpen(false)}
                    title="收起"
                  >
                    ›
                  </button>
                </div>
                <Droppable droppableId="backlog">
                  {(provided, snapshot) => (
                    <div
                      ref={provided.innerRef}
                      {...provided.droppableProps}
                      className={`tl-todo-backlog-body ${snapshot.isDraggingOver ? 'tl-todo-backlog-body--drag-over' : ''}`}
                    >
                      {undatedTodos.length === 0 ? (
                        <div className="tl-todo-backlog-empty">
                          <span>暂无未排期待办</span>
                        </div>
                      ) : (
                        undatedTodos.map((t, idx) => renderDraggableCard(t, idx))
                      )}
                      {provided.placeholder}
                    </div>
                  )}
                </Droppable>
              </>
            ) : (
              <button
                type="button"
                className="tl-todo-backlog-collapsed"
                onClick={() => setBacklogOpen(true)}
                title="展开待规划任务箱"
              >
                <span className="tl-todo-backlog-collapsed-label">待规划任务箱</span>
                {undatedTodos.length > 0 && (
                  <span className="tl-todo-backlog-collapsed-count">{undatedTodos.length}</span>
                )}
                <span className="tl-todo-backlog-collapsed-arrow">‹</span>
              </button>
            )}
          </aside>
        </div>
      </DragDropContext>
    );
  };

  // ── 月视图 ────────────────────────────────────────────────

  const renderMonth = () => {
    const monthStart = cursor.startOf('month');
    const gridStart = getWeekStart(monthStart);
    const gridDays = Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
    const currentMonth = cursor.month();

    return (
      <div className="tl-todo-month-view">
        <div className="tl-todo-month-header-row">
          {WEEKDAY_FULL.map((w) => (
            <div key={w} className="tl-todo-month-weekday">
              {w}
            </div>
          ))}
        </div>
        <div className="tl-todo-month-grid">
          {gridDays.map((day) => {
            const dateStr = day.format('YYYY-MM-DD');
            const isToday = dateStr === todayStr;
            const inMonth = day.month() === currentMonth;
            const dayTodos = todosByDate.get(dateStr) ?? [];

            return (
              <div
                key={dateStr}
                className={`tl-todo-month-cell ${!inMonth ? 'tl-todo-month-cell--other' : ''}`}
              >
                <div className={`tl-todo-month-date ${isToday ? 'tl-todo-month-date--today' : ''}`}>
                  {day.date()}
                </div>
                {dayTodos.length > 0 && (
                  <div className="tl-todo-month-content">
                    {dayTodos.slice(0, 3).map((t) => (
                      <div
                        key={t.id}
                        onClick={() => onTaskClick(t.parentTaskId)}
                        className={`tl-todo-month-item ${t.checked ? 'tl-todo-month-item--done' : ''}`}
                        style={{ '--task-color': t.parentTaskColor || '#E5E7EB' } as React.CSSProperties}
                      >
                        <span className="tl-todo-month-dot" />
                        <span className="tl-todo-month-text">{t.text}</span>
                      </div>
                    ))}
                    {dayTodos.length > 3 && (
                      <div className="tl-todo-month-more">+{dayTodos.length - 3}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  // ── 日视图 ────────────────────────────────────────────────

  const renderDay = () => {
    const dateStr = cursor.format('YYYY-MM-DD');
    const dayTodos = todosByDate.get(dateStr) ?? [];

    return (
      <div className="tl-todo-day-view">
        <div className="tl-todo-day-list">
          {dayTodos.length === 0
            ? renderEmpty('当日无待办')
            : dayTodos.map((t) => (
                <div
                  key={t.id}
                  onClick={() => onTaskClick(t.parentTaskId)}
                  className={`tl-todo-card tl-todo-card--wide ${t.checked ? 'tl-todo-card--done' : ''}`}
                  style={{ '--task-color': t.parentTaskColor || '#E5E7EB' } as React.CSSProperties}
                >
                  <div className="tl-todo-card-accent" />
                  <div className="tl-todo-card-body">
                    <div className="tl-todo-card-meta">
                      <span className="tl-todo-card-dot" />
                      <span className="tl-todo-card-parent">{t.parentTaskTitle}</span>
                    </div>
                    <div className="tl-todo-card-content">
                      <input
                        type="checkbox"
                        checked={t.checked}
                        className="tl-todo-card-check"
                        onClick={(e) => e.stopPropagation()}
                        readOnly
                      />
                      <span className="tl-todo-card-text">{t.text}</span>
                    </div>
                  </div>
                </div>
              ))}
        </div>
      </div>
    );
  };

  if (todos.length === 0) {
    return (
      <div className="tl-todo-no-data">
        <div className="tl-todo-no-data-icon">✧</div>
        <div className="tl-todo-no-data-title">暂无待办事项</div>
        <div className="tl-todo-no-data-hint">
          在任务详情中添加带日期的待办（如 - [ ] 背单词 @2026-06-15）
        </div>
      </div>
    );
  }

  return (
    <div className="tl-todo-container">
      <div className="tl-todo-toolbar">
        <div className="tl-todo-toolbar-left">
          <button type="button" className="tl-todo-nav-btn" onClick={handlePrev} title="上一个">
            ‹
          </button>
          <button
            type="button"
            className="tl-todo-nav-btn tl-todo-nav-btn--today"
            onClick={handleToday}
            title="回到今天"
          >
            今天
          </button>
          <button type="button" className="tl-todo-nav-btn" onClick={handleNext} title="下一个">
            ›
          </button>
          <span className="tl-todo-range">{rangeLabel}</span>
        </div>

        <div className="tl-todo-toolbar-right">
          <div className="tl-todo-mode-switch">
            {(['day', 'week', 'month'] as TodoViewMode[]).map((m) => (
              <button
                key={m}
                type="button"
                className={`tl-todo-mode-btn ${mode === m ? 'tl-todo-mode-btn--active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'day' ? '日' : m === 'week' ? '周' : '月'}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="tl-todo-content">
        {mode === 'week' && renderWeek()}
        {mode === 'month' && renderMonth()}
        {mode === 'day' && renderDay()}
      </div>
    </div>
  );
};

export default TodoAggregatorView;

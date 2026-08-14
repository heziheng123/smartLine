// ============================================================
// Ebbinghaus 复习模块 - 批量改期面板 (全新设计)
// 核心理念：所见即所做，直接拖入即可批量调整复习日期
// ============================================================

import React, { Component, type ErrorInfo, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { DragDropContext, Draggable, Droppable, type DropResult } from '@hello-pangea/dnd';
import {
  AlertTriangle,
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  RotateCcw,
  X,
} from 'lucide-react';
import { addDays, diffDays, formatDate, getDayOfWeek, todayStr } from '@/utils/dateSafe';
import { buildRootNodeMap, getReviewCategoryColor, resolveReviewCategory } from '../category';
import { computeRounds, getReviewTopicKey } from '../scheduler';
import { getReviewRoundDuration } from '../duration';
import { planReviewRoundReschedule, type ReviewRoundReschedulePlan } from '../reschedulePlanning';
import { useEbbStore } from '../store';
import { useGraphStore } from '@/graph/store';
import type { EbbSettings, ReviewTask } from '../types';

type ViewRange = 'week' | 'month';

const WEEKDAY_SHORT = ['日', '一', '二', '三', '四', '五', '六'];

const shiftMonth = (date: string, amount: number) => {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const totalMonths = year * 12 + month - 1 + amount;
  const targetYear = Math.trunc(totalMonths / 12);
  const targetMonth = (totalMonths % 12) + 1;
  const maxDay = new Date(targetYear, targetMonth, 0).getDate();
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
};

const getWeekStart = (date: string) => {
  const weekday = getDayOfWeek(date);
  return addDays(date, weekday === 0 ? -6 : 1 - weekday);
};

interface BatchRescheduleBoardProps {
  reviewTasks: ReviewTask[];
  settings: EbbSettings;
  initialTopicKeys: string[];
  onClose: () => void;
  onCommitted?: () => void;
}

interface TopicMove {
  topicKey: string;
  topicName: string;
  firstTaskId: string;
  fromDate: string;
  toDate: string;
  delta: number;
  pendingCount: number;
  totalMinutes: number;
  categoryColor: string;
  taskSchedules: Array<{
    taskId: string;
    round: number;
    originalDate: string;
    newDate: string;
    minutes: number;
  }>;
}

interface MoveValidationError {
  topicName: string;
  reason: string;
}

const sortRounds = (tasks: ReviewTask[]) => [...tasks].sort((a, b) =>
  (a.roundOrder ?? Number.MAX_SAFE_INTEGER) - (b.roundOrder ?? Number.MAX_SAFE_INTEGER)
  || (a.originalDueDate ?? a.dueDate ?? '').localeCompare(b.originalDueDate ?? b.dueDate ?? '')
  || a.id.localeCompare(b.id),
);

class BoardErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[batch-reschedule]', error, info);
  }
  render() {
    if (this.state.error) {
      return <div className="ebb-new-error">批量改期加载失败</div>;
    }
    return this.props.children;
  }
}

const BatchRescheduleBoard: React.FC<BatchRescheduleBoardProps> = ({
  reviewTasks,
  settings,
  onClose,
  onCommitted,
}) => {
  const rescheduleReviewRounds = useEbbStore((state) => state.rescheduleReviewRounds);
  const graphNodes = useGraphStore((state) => state.nodes);
  const rootByNodeId = useMemo(() => buildRootNodeMap(graphNodes), [graphNodes]);

  const today = todayStr();
  const activeTasks = useMemo(() => reviewTasks.filter((task) => !task.isArchived), [reviewTasks]);
  const { roundMap, totalRoundsMap } = useMemo(() => computeRounds(activeTasks), [activeTasks]);

  // 所有未完成的主题
  const topics = useMemo(() => {
    const grouped = new Map<string, ReviewTask[]>();
    activeTasks.forEach((task) => {
      const key = getReviewTopicKey(task);
      const list = grouped.get(key) ?? [];
      list.push(task);
      grouped.set(key, list);
    });
    return [...grouped.entries()].map(([topicKey, group]) => {
      const sorted = sortRounds(group);
      const pending = sorted.filter((task) => !task.isCompleted);
      const first = pending[0];
      const minutes = pending.reduce((sum, task) => sum + getReviewRoundDuration(task, roundMap.get(task.id) ?? task.roundOrder ?? 1), 0);
      const category = first ? resolveReviewCategory(first, rootByNodeId) : null;
      const categoryColor = category ? getReviewCategoryColor(category, settings.tagColors) ?? '#94A3B8' : '#94A3B8';
      return {
        topicKey,
        topicName: sorted[0]?.topicName ?? topicKey,
        pending,
        firstTaskId: first?.id,
        firstDueDate: first?.dueDate,
        pendingCount: pending.length,
        totalRounds: totalRoundsMap.get(topicKey) ?? sorted.length,
        overdueCount: pending.filter((task) => task.dueDate < today).length,
        minutes,
        categoryColor,
        firstRound: first ? roundMap.get(first.id) ?? first.roundOrder ?? 1 : 0,
      };
    });
  }, [activeTasks, rootByNodeId, roundMap, settings.tagColors, today, totalRoundsMap]);

  const [rangeMode, setRangeMode] = useState<ViewRange>('week');
  const [cursor, setCursor] = useState<string>(addDays(today, 1));
  const [moves, setMoves] = useState<Record<string, TopicMove>>({});
  const [toast, setToast] = useState<MoveValidationError | null>(null);
  const [dragPreview, setDragPreview] = useState<{ topicKey: string; targetDate: string } | null>(null);

  const moveList = Object.values(moves);
  const totalTopics = topics.length;
  const arrangedCount = moveList.length;

  // 按日期分组的已安排项
  const movesByDate = useMemo(() => {
    const map = new Map<string, TopicMove[]>();
    moveList.forEach((move) => {
      const list = map.get(move.toDate) ?? [];
      list.push(move);
      map.set(move.toDate, list);
    });
    return map;
  }, [moveList]);

  const dates = useMemo(() => {
    if (rangeMode === 'week') {
      const weekStart = getWeekStart(cursor);
      return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
    }
    const monthStart = `${cursor.slice(0, 7)}-01`;
    const yearCursor = Number(cursor.slice(0, 4));
    const monthCursor = Number(cursor.slice(5, 7));
    const daysInMonth = new Date(yearCursor, monthCursor, 0).getDate();
    return Array.from({ length: daysInMonth }, (_, index) => addDays(monthStart, index));
  }, [cursor, rangeMode]);

  const navigateCursor = (direction: -1 | 1) => {
    if (rangeMode === 'week') {
      setCursor((value) => addDays(value, 7 * direction));
    } else {
      setCursor((value) => shiftMonth(value, direction));
    }
  };

  const removeMove = (topicKey: string) => {
    setMoves((current) => {
      const next = { ...current };
      delete next[topicKey];
      return next;
    });
  };

  const clearMoves = () => setMoves({});

  const validateDrop = useCallback((topicKey: string, targetDate: string): { ok: true; topic: typeof topics[0] } | { ok: false; reason: string } => {
    const topic = topics.find((item) => item.topicKey === topicKey);
    if (!topic || !topic.firstTaskId || topic.firstDueDate === undefined) {
      return { ok: false, reason: '该主题没有可改期的轮次' };
    }
    if (targetDate < today) {
      return { ok: false, reason: '不能安排到过去的日期' };
    }
    const delta = diffDays(targetDate, topic.firstDueDate);
    const upcoming = topic.pending;
    const shifted = upcoming.map((task) => addDays(task.dueDate, delta));
    for (let index = 1; index < shifted.length; index += 1) {
      if (shifted[index] <= shifted[index - 1]) {
        return { ok: false, reason: '会打乱复习顺序' };
      }
    }
    return { ok: true, topic };
  }, [topics, today]);

  const handleDragUpdate = (_dragId: string, targetDate: string | null) => {
    if (targetDate) {
      setDragPreview({ topicKey: _dragId, targetDate });
    } else {
      setDragPreview(null);
    }
  };

  const handleDragEnd = (result: DropResult) => {
    setDragPreview(null);
    const { draggableId, destination } = result;
    if (!destination) return;

    const targetDate = destination.droppableId.startsWith('ebb-day-')
      ? destination.droppableId.replace('ebb-day-', '')
      : null;
    if (!targetDate) return;

    const validation = validateDrop(draggableId, targetDate);
    if (!validation.ok) {
      setToast({ topicName: '当前主题', reason: validation.reason });
      window.setTimeout(() => setToast(null), 3000);
      return;
    }

    const topic = validation.topic;
    let plan: ReviewRoundReschedulePlan | null = null;
    try {
      plan = planReviewRoundReschedule(reviewTasks, topic.firstTaskId, targetDate, 'following');
    } catch {
      setToast({ topicName: topic.topicName, reason: '改期冲突，请选择其他日期' });
      window.setTimeout(() => setToast(null), 3000);
      return;
    }

    if (!plan) {
      setToast({ topicName: topic.topicName, reason: '调整会打乱复习顺序' });
      window.setTimeout(() => setToast(null), 3000);
      return;
    }

    const firstIdToDate = new Map(plan.updates.map((update) => [update.id, update.dueDate]));
    const taskSchedules = topic.pending.map((task) => {
      const newDate = firstIdToDate.get(task.id) ?? task.dueDate;
      const round = roundMap.get(task.id) ?? task.roundOrder ?? 1;
      return {
        taskId: task.id,
        round,
        originalDate: task.dueDate,
        newDate,
        minutes: getReviewRoundDuration(task, round),
      };
    });

    const nextMove: TopicMove = {
      topicKey: draggableId,
      topicName: topic.topicName,
      firstTaskId: plan.taskId,
      fromDate: plan.fromDate,
      toDate: targetDate,
      delta: plan.deltaDays,
      pendingCount: plan.updates.length,
      totalMinutes: topic.minutes,
      categoryColor: topic.categoryColor,
      taskSchedules,
    };

    setMoves((current) => ({ ...current, [draggableId]: nextMove }));
  };

  const handleClose = useCallback(() => {
    if (moveList.length === 0) {
      onClose();
      return;
    }
    if (typeof window !== 'undefined' && typeof window.confirm === 'function') {
      if (window.confirm(`已有 ${moveList.length} 个主题改期未保存，确定关闭？`)) {
        onClose();
      }
    } else {
      onClose();
    }
  }, [moveList, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [handleClose]);

  const handleCommit = () => {
    if (moveList.length === 0) return;
    const planned: Array<{ updates: Array<{ id: string; dueDate: string }> }> = [];
    for (const move of moveList) {
      try {
        const plan = planReviewRoundReschedule(reviewTasks, move.firstTaskId, move.toDate, 'following');
        if (plan) planned.push({ updates: plan.updates });
      } catch {
        // skip
      }
    }
    const flatUpdates = planned.flatMap((entry) => entry.updates);
    if (flatUpdates.length > 0) rescheduleReviewRounds(flatUpdates);
    onCommitted?.();
    onClose();
  };

  const boardSummary = rangeMode === 'week'
    ? `${formatDate(getWeekStart(cursor), 'M月D日')} - ${formatDate(addDays(getWeekStart(cursor), 6), 'M月D日')}`
    : formatDate(`${cursor.slice(0, 7)}-01`, 'YYYY年MM月');

  // 计算每日负载
  const dayLoad = useMemo(() => {
    const map = new Map<string, { minutes: number; count: number }>();
    dates.forEach((date) => {
      const dayMoves = movesByDate.get(date) ?? [];
      const minutes = dayMoves.reduce((sum, m) => sum + m.totalMinutes, 0);
      const count = dayMoves.length;
      map.set(date, { minutes, count });
    });
    return map;
  }, [dates, movesByDate]);

  // 过载日期
  const overloadDates = useMemo(() => {
    const set = new Set<string>();
    dayLoad.forEach((value, date) => {
      if (value.minutes > settings.dailyReviewMinutes || value.count > settings.dailyTaskLimit) {
        set.add(date);
      }
    });
    return set;
  }, [dayLoad, settings.dailyReviewMinutes, settings.dailyTaskLimit]);

  const progress = totalTopics > 0 ? (arrangedCount / totalTopics) * 100 : 0;

  return createPortal(
    <div className="ebb-new-overlay" onClick={handleClose}>
      <div className="ebb-new-panel" role="dialog" aria-modal="true" aria-label="复习批量改期" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <header className="ebb-new-header">
          <div className="ebb-new-header-left">
            <div className="ebb-new-icon">
              <Calendar size={18} />
            </div>
            <h2 className="ebb-new-title">批量改期</h2>
          </div>
          <button type="button" className="ebb-new-close" onClick={handleClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <DragDropContext onDragUpdate={(update) => {
          if (update.destination) {
            const targetDate = update.destination.droppableId.replace('ebb-day-', '');
            handleDragUpdate(update.draggableId, targetDate);
          }
        }} onDragEnd={handleDragEnd}>
          {/* Calendar Area */}
          <section className="ebb-new-calendar">
            {/* Calendar Nav */}
            <div className="ebb-new-cal-nav">
              <div className="ebb-new-cal-nav-left">
                <button type="button" onClick={() => navigateCursor(-1)} className="ebb-new-nav-btn">
                  <ChevronLeft size={16} />
                </button>
                <span className="ebb-new-cal-range">{boardSummary}</span>
                <button type="button" onClick={() => navigateCursor(1)} className="ebb-new-nav-btn">
                  <ChevronRight size={16} />
                </button>
                <button type="button" className="ebb-new-today-btn" onClick={() => setCursor(addDays(today, 1))}>明天</button>
              </div>
              <div className="ebb-new-cal-tabs">
                <button
                  type="button"
                  className={rangeMode === 'week' ? 'is-active' : ''}
                  onClick={() => setRangeMode('week')}
                >周</button>
                <button
                  type="button"
                  className={rangeMode === 'month' ? 'is-active' : ''}
                  onClick={() => setRangeMode('month')}
                >月</button>
              </div>
            </div>

            {/* Calendar Grid */}
            <div className={`ebb-new-cal-grid ${rangeMode === 'month' ? 'is-month' : ''}`}>
              {dates.map((date) => {
                const load = dayLoad.get(date) ?? { minutes: 0, count: 0 };
                const isToday = date === today;
                const isPast = date < today;
                const isOverload = overloadDates.has(date);
                const dayMoves = movesByDate.get(date) ?? [];
                const isPreviewTarget = dragPreview?.targetDate === date;

                return (
                  <Droppable droppableId={`ebb-day-${date}`} key={date} isDropDisabled={isPast}>
                    {(provided, snapshot) => (
                      <div
                        ref={provided.innerRef}
                        {...provided.droppableProps}
                        className={[
                          'ebb-new-day',
                          isToday ? 'is-today' : '',
                          isPast ? 'is-past' : '',
                          isOverload ? 'is-overload' : '',
                          dayMoves.length > 0 ? 'has-drops' : '',
                          snapshot.isDraggingOver ? 'is-drag-over' : '',
                        ].join(' ')}
                      >
                        <div className="ebb-new-day-header">
                          <span className="ebb-new-day-week">{WEEKDAY_SHORT[getDayOfWeek(date)]}</span>
                          <span className="ebb-new-day-num">{Number(date.slice(8))}</span>
                          {isToday && <span className="ebb-new-day-today">今天</span>}
                          {dayMoves.length > 0 && <Check size={12} className="ebb-new-day-check" />}
                          {isOverload && <AlertTriangle size={12} className="ebb-new-day-warn" />}
                        </div>
                        <div className="ebb-new-day-body">
                          {dayMoves.map((move) => (
                            <div
                              key={move.topicKey}
                              className="ebb-new-drop-card"
                              style={{ '--drop-color': move.categoryColor } as React.CSSProperties}
                            >
                              <div className="ebb-new-drop-header">
                                <span className="ebb-new-drop-name">{move.topicName}</span>
                                <button
                                  type="button"
                                  className="ebb-new-drop-remove"
                                  onClick={() => removeMove(move.topicKey)}
                                  aria-label="移除"
                                >
                                  <X size={10} />
                                </button>
                              </div>
                              <div className="ebb-new-drop-meta">
                                <span>R{move.taskSchedules[0]?.round}-{move.taskSchedules[move.taskSchedules.length - 1]?.round}</span>
                                <span><Clock3 size={10} />{move.totalMinutes}m</span>
                              </div>
                            </div>
                          ))}
                          {isPreviewTarget && dragPreview && (() => {
                            const previewTopic = topics.find((t) => t.topicKey === dragPreview.topicKey);
                            if (!previewTopic) return null;
                            return (
                              <div
                                className="ebb-new-preview-card"
                                style={{ '--drop-color': previewTopic.categoryColor } as React.CSSProperties}
                              >
                                <span>{previewTopic.topicName}</span>
                                <span>R{previewTopic.firstRound} · {previewTopic.minutes}m</span>
                              </div>
                            );
                          })()}
                          {dayMoves.length === 0 && !isPreviewTarget && (
                            <div className="ebb-new-day-empty">拖入主题</div>
                          )}
                        </div>
                        <div className="ebb-new-day-footer">
                          <span>{load.minutes}m · {load.count}个</span>
                        </div>
                        {provided.placeholder}
                      </div>
                    )}
                  </Droppable>
                );
              })}
            </div>
          </section>

          {/* Topic List (Source) */}
          <aside className="ebb-new-sidebar">
            <div className="ebb-new-sidebar-header">
              <span>待安排主题</span>
              <span className="ebb-new-sidebar-count">{totalTopics - arrangedCount}</span>
            </div>
            <Droppable droppableId="ebb-topics-source" isDropDisabled>
              {(provided) => (
                <div ref={provided.innerRef} {...provided.droppableProps} className="ebb-new-topic-list">
                  {topics.filter((t) => !moves[t.topicKey]).length === 0 && (
                    <div className="ebb-new-sidebar-empty">
                      所有主题已安排
                    </div>
                  )}
                  {topics.filter((t) => !moves[t.topicKey]).map((topic, index) => (
                    <Draggable
                      key={topic.topicKey}
                      draggableId={topic.topicKey}
                      index={index}
                      isDragDisabled={!topic.firstTaskId}
                    >
                      {(dragProvided, snapshot) => {
                        const dragStyle = dragProvided.draggableProps.style;
                        const combinedStyle = {
                          ...(typeof dragStyle === 'object' ? dragStyle : {}),
                          '--topic-color': topic.categoryColor,
                        };
                        return (
                        <div
                          ref={dragProvided.innerRef}
                          {...dragProvided.draggableProps}
                          {...dragProvided.dragHandleProps}
                          className={[
                            'ebb-new-topic',
                            snapshot.isDragging ? 'is-dragging' : '',
                          ].join(' ')}
                          style={combinedStyle as React.CSSProperties}
                        >
                          <div className="ebb-new-topic-dot" />
                          <div className="ebb-new-topic-content">
                            <span className="ebb-new-topic-name">{topic.topicName}</span>
                            <div className="ebb-new-topic-meta">
                              <span>R{topic.firstRound}/{topic.totalRounds}</span>
                              <span>{topic.minutes}m</span>
                              {topic.overdueCount > 0 && (
                                <span className="ebb-new-topic-overdue">{topic.overdueCount}逾期</span>
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      }}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          </aside>
        </DragDropContext>

        {/* Footer Progress */}
        <footer className="ebb-new-footer">
          <div className="ebb-new-progress-section">
            <div className="ebb-new-progress-bar">
              <div
                className="ebb-new-progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="ebb-new-progress-text">
              {arrangedCount}/{totalTopics} 个已安排 · 共 {moveList.reduce((sum, m) => sum + m.totalMinutes, 0)} 分钟
            </span>
          </div>
          <div className="ebb-new-footer-actions">
            <button type="button" className="ebb-new-btn is-ghost" onClick={clearMoves} disabled={arrangedCount === 0}>
              <RotateCcw size={14} /> 重置
            </button>
            <button type="button" className="ebb-new-btn is-primary" onClick={handleCommit} disabled={arrangedCount === 0}>
              保存改期 {arrangedCount > 0 && `(${arrangedCount})`}
            </button>
          </div>
        </footer>

        {/* Toast */}
        {toast && (
          <div className="ebb-new-toast" role="alert">
            <AlertTriangle size={14} />
            <span>{toast.reason}</span>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

const BatchRescheduleBoardWithBoundary: React.FC<BatchRescheduleBoardProps> = (props) => (
  <BoardErrorBoundary><BatchRescheduleBoard {...props} /></BoardErrorBoundary>
);

export default BatchRescheduleBoardWithBoundary;

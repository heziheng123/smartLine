import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, CalendarDays, CircleDashed, ListTodo, BookMarked, Hash, Clock3, Settings2 } from 'lucide-react';
import type { Task, SmartTaskBlock, SmartBlockDragPayload } from '@/types';
import { getQuantityCompleted, getQuantityDailyStatus, getQuantityProgressPercent, getQuantityTotal, getQuantityUnit, getSmartTaskBlocks, getTagColor, getValidGraphNodeIds, isQuantityTask } from '@/utils/blocks';
import { sanitizeHtml } from '@/utils/sanitize';
import { openProjectTaskModal } from './projectTaskModal';
import { resolveTaskCategoryTheme } from '@/utils/taskCategoryTheme';
import { isTaskOverdueOnDate } from '@/domain/taskRules';
import { rescheduleProjectTask, setProjectTaskCompletion } from '@/services/projectTaskCommands';
import { useEbbStore } from '@/ebb/store';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import {
  calculateDateWorkloads,
  getWorkloadTone,
  type WorkloadPreferences,
} from '@/domain/taskBacklog';
import {
  loadWorkloadPreferences,
  saveWorkloadPreferences,
  WORKLOAD_PREFERENCES_EVENT,
} from '@/services/workloadPreferences';
import { requestConfirmation } from '@/services/confirmation';
import {
  todayStr,
  addDays,
  isBeforeDay,
  isAfterDay,
  formatDate,
  getDayOfWeek,
  splitDate,
} from '@/utils/dateSafe';

interface WeekMatrixViewProps {
  tasks: Task[];
}

interface ViewBlock extends SmartTaskBlock {
  _taskId: string;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function getWeekStartStr(dateStr: string): string {
  const dow = getDayOfWeek(dateStr);
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDays(dateStr, offset);
}

function addMonths(dateStr: string, months: number): string {
  const { year, month, day } = splitDate(dateStr);
  const totalMonths = year * 12 + (month - 1) + months;
  const nextYear = Math.floor(totalMonths / 12);
  const nextMonth = (totalMonths % 12) + 1;
  const maxDay = new Date(nextYear, nextMonth, 0).getDate();
  return `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(Math.min(day, maxDay)).padStart(2, '0')}`;
}

const WeekMatrixView: React.FC<WeekMatrixViewProps> = ({ tasks }) => {
  const [cursor, setCursor] = useState(() => todayStr());
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverCell, setHoverCell] = useState<{ tag: string; date: string } | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [showLoadSettings, setShowLoadSettings] = useState(false);
  const [workloadPreferences, setWorkloadPreferences] = useState<WorkloadPreferences>(
    loadWorkloadPreferences,
  );
  const toastTimerRef = useRef<number | null>(null);
  const suppressCardOpenRef = useRef(false);
  const reviewTasks = useEbbStore((state) => state.reviewTasks);
  const schedules = useDailyScheduleStore((state) => state.schedules);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const dateRange = useMemo(() => {
    if (mode === 'week') {
      const start = getWeekStartStr(cursor);
      return Array.from({ length: 7 }, (_, index) => addDays(start, index));
    }

    const { year, month } = splitDate(cursor);
    const daysInMonth = new Date(year, month, 0).getDate();
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    return Array.from({ length: daysInMonth }, (_, index) => addDays(start, index));
  }, [cursor, mode]);

  const todayString = todayStr();

  const allBlocks = useMemo(() => {
    const result: ViewBlock[] = [];
    for (const task of tasks) {
      const blocks = getSmartTaskBlocks(task.blocks ?? []);
      for (const block of blocks) {
        if (block.header.isArchived) continue;
        result.push({ ...block, _taskId: task.id });
      }
    }
    return result;
  }, [tasks]);

  const tags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const block of allBlocks) {
      tagSet.add(block.header.tag);
    }
    return Array.from(tagSet);
  }, [allBlocks]);

  const matrix = useMemo(() => {
    const map = new Map<string, ViewBlock[]>();
    for (const block of allBlocks) {
      const key = `${block.header.tag}::${block.header.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(block);
    }

    for (const blocks of map.values()) {
      blocks.sort((a, b) => {
        if (a.header.isCompleted !== b.header.isCompleted) return Number(a.header.isCompleted) - Number(b.header.isCompleted);
        return a.header.title.localeCompare(b.header.title);
      });
    }

    return map;
  }, [allBlocks]);

  const workloads = useMemo(
    () => calculateDateWorkloads({
      dates: dateRange,
      tasks,
      reviewTasks,
      schedules,
      preferences: workloadPreferences,
    }),
    [dateRange, reviewTasks, schedules, tasks, workloadPreferences],
  );

  const offRangeInfo = useMemo(() => {
    const rangeStartStr = dateRange[0];
    const rangeEndStr = dateRange[dateRange.length - 1];
    const beforeBlocks: { date: string; count: number }[] = [];
    const afterBlocks: { date: string; count: number }[] = [];
    const tally = new Map<string, number>();

    for (const block of allBlocks) {
      const date = block.header.date;
      if (!date) continue;
      tally.set(date, (tally.get(date) ?? 0) + 1);
    }

    for (const [date, count] of tally) {
      if (isBeforeDay(date, rangeStartStr)) beforeBlocks.push({ date, count });
      else if (isAfterDay(date, rangeEndStr)) afterBlocks.push({ date, count });
    }

    beforeBlocks.sort((a, b) => b.date.localeCompare(a.date));
    afterBlocks.sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalBefore: beforeBlocks.reduce((sum, item) => sum + item.count, 0),
      totalAfter: afterBlocks.reduce((sum, item) => sum + item.count, 0),
      nearestBefore: beforeBlocks[0]?.date,
      nearestAfter: afterBlocks[0]?.date,
      beforeDates: beforeBlocks.map((item) => item.date),
      afterDates: afterBlocks.map((item) => item.date),
    };
  }, [allBlocks, dateRange]);

  const hasOffRangeBlocks = offRangeInfo.totalBefore > 0 || offRangeInfo.totalAfter > 0;

  const showToast = useCallback((message: string) => {
    setToastMessage(message);
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToastMessage(null);
    }, 4500);
  }, []);

  const clearDragState = useCallback(() => {
    setDraggingId(null);
    setHoverCell(null);
  }, []);

  const handleToggle = useCallback(
    (taskId: string, blockId: string, isCompleted: boolean) => {
      const now = todayStr();
      const result = setProjectTaskCompletion(taskId, blockId, !isCompleted, now);
      if ('error' in result) showToast(result.error);
    },
    [showToast],
  );

  const handleDragStart = useCallback((block: ViewBlock) => {
    suppressCardOpenRef.current = false;
    setDraggingId(block.id);
  }, []);

  useEffect(() => {
    const handlePreferences = (event: Event) => {
      const detail = (event as CustomEvent<WorkloadPreferences>).detail;
      setWorkloadPreferences(detail ?? loadWorkloadPreferences());
    };
    window.addEventListener(WORKLOAD_PREFERENCES_EVENT, handlePreferences);
    return () => window.removeEventListener(WORKLOAD_PREFERENCES_EVENT, handlePreferences);
  }, []);

  const handleDragEnd = useCallback(() => {
    suppressCardOpenRef.current = true;
    clearDragState();
    window.setTimeout(() => { suppressCardOpenRef.current = false; }, 120);
  }, [clearDragState]);

  const handleCellDragOver = useCallback(
    (event: React.DragEvent<HTMLDivElement>, tag: string, date: string) => {
      // 允许所有拖拽（包括来自外部的 Icebox）
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!hoverCell || hoverCell.tag !== tag || hoverCell.date !== date) {
        setHoverCell({ tag, date });
      }
    },
    [hoverCell],
  );

  const handleCellDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>, tag: string, date: string) => {
      // 避免由于进入子元素而触发的意外 leave 导致闪烁
      if (event.currentTarget.contains(event.relatedTarget as Node)) {
        return;
      }
      if (hoverCell?.tag === tag && hoverCell.date === date) {
        setHoverCell(null);
      }
    },
    [hoverCell],
  );

  const handleCellDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>, _tag: string, targetDate: string) => {
      event.preventDefault();
      
      let draggedData: SmartBlockDragPayload | null = null;
      
      try {
        const jsonStr = event.dataTransfer.getData('application/json');
        if (jsonStr) {
          const parsed = JSON.parse(jsonStr);
          if (parsed.type === 'smart-block') {
            draggedData = parsed as SmartBlockDragPayload;
          }
        }
      } catch {
        // 解析失败，忽略
      }

      if (!draggedData) {
        clearDragState();
        return;
      }

      if (draggedData.fromDate === targetDate) {
        clearDragState();
        return;
      }

      const current = allBlocks.find(
        (block) => block._taskId === draggedData.taskId && block.id === draggedData.blockId,
      );
      if (current?.header.deadline && targetDate > current.header.deadline) {
        const confirmed = await requestConfirmation({
          title: '排期晚于截止日期',
          message: `“${draggedData.title}”的截止日期是 ${current.header.deadline}，目标日期是 ${targetDate}。是否仍然安排？`,
          confirmLabel: '仍然安排',
          cancelLabel: '返回修改',
          tone: 'warning',
        });
        if (!confirmed) {
          clearDragState();
          return;
        }
      }
      const result = rescheduleProjectTask(draggedData.taskId, draggedData.blockId, targetDate);
      showToast('error' in result ? result.error : `已将“${draggedData.title}”改期到 ${targetDate}`);
      clearDragState();
    },
    [allBlocks, clearDragState, showToast],
  );

  const jumpTo = useCallback((dateStr: string) => {
    setCursor(dateStr);
  }, []);

  const rangeLabel =
    mode === 'week'
      ? `${formatDate(dateRange[0], 'M.D')} - ${formatDate(dateRange[6], 'M.D')}`
      : (() => {
          const { year, month } = splitDate(cursor);
          return `${year}年${month}月`;
        })();
  const matrixColumnTemplate = `100px repeat(${dateRange.length}, minmax(${mode === 'week' ? '88px' : '120px'}, 1fr))`;

  return (
    <div className="wmv-container">
      <div className="wmv-nav">
        <button
          type="button"
          className="wmv-nav-btn"
          onClick={() => setCursor((current) => (mode === 'week' ? addDays(current, -7) : addMonths(current, -1)))}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="wmv-nav-label">{rangeLabel}</span>
        <button
          type="button"
          className="wmv-nav-btn"
          onClick={() => setCursor((current) => (mode === 'week' ? addDays(current, 7) : addMonths(current, 1)))}
        >
          <ChevronRight size={16} />
        </button>
        <button type="button" className="wmv-nav-btn" onClick={() => setCursor(todayStr())}>
          今天
        </button>

        {draggingId && (
          <div className="wmv-drag-hint">
            正在拖动任务，可放到任意日期；任务标签不会改变
          </div>
        )}

        <div className="wmv-nav-right">
          <button
            type="button"
            className="wmv-nav-btn wmv-all-tasks-btn"
            onClick={() => window.dispatchEvent(new CustomEvent('tl-navigate', { detail: { view: 'task-overview' } }))}
            aria-label="查看全部项目任务"
          >
            <ListTodo size={15} />全部任务
          </button>
          {hasOffRangeBlocks && (
            <div
              className="wmv-offrange-capsule"
              title="存在不在当前显示范围内的任务块，悬停可查看最近日期"
            >
              <span className="wmv-offrange-capsule-icon"><BookMarked size={14} aria-hidden="true" /></span>
              <span className="wmv-offrange-capsule-count">{offRangeInfo.totalBefore + offRangeInfo.totalAfter}</span>
              <div className="wmv-offrange-popover">
                <div className="wmv-offrange-popover-text">
                  共有 {offRangeInfo.totalBefore + offRangeInfo.totalAfter} 个智能任务块不在当前{mode === 'week' ? '周' : '月'}视图中
                </div>
                <div className="wmv-offrange-popover-actions">
                  {offRangeInfo.nearestBefore && (
                    <button
                      type="button"
                      className="wmv-offrange-btn wmv-offrange-btn--before"
                      onClick={() => jumpTo(offRangeInfo.nearestBefore!)}
                      title={`跳到最近的早期日期：${offRangeInfo.nearestBefore}`}
                    >
                      ◀ 早期 {offRangeInfo.totalBefore} 项 · {offRangeInfo.beforeDates.length} 天
                    </button>
                  )}
                  {offRangeInfo.nearestAfter && (
                    <button
                      type="button"
                      className="wmv-offrange-btn wmv-offrange-btn--after"
                      onClick={() => jumpTo(offRangeInfo.nearestAfter!)}
                      title={`跳到最近的后期日期：${offRangeInfo.nearestAfter}`}
                    >
                      后期 {offRangeInfo.totalAfter} 项 · {offRangeInfo.afterDates.length} 天 ▶
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="wmv-mode-switch">
            <button
              type="button"
              className={`wmv-mode-btn ${mode === 'week' ? 'wmv-mode-btn--active' : ''}`}
              onClick={() => setMode('week')}
            >
              周
            </button>
            <button
              type="button"
              className={`wmv-mode-btn ${mode === 'month' ? 'wmv-mode-btn--active' : ''}`}
              onClick={() => setMode('month')}
            >
              月
            </button>
          </div>
          <div className="wmv-load-settings-wrap">
            <button
              type="button"
              className="wmv-nav-btn"
              onClick={() => setShowLoadSettings((value) => !value)}
              aria-expanded={showLoadSettings}
              aria-label="每日负载设置"
            >
              <Settings2 size={15} />
            </button>
            {showLoadSettings && (
              <div className="wmv-load-settings">
                <strong>每日可用容量</strong>
                <label>
                  <span>工作日</span>
                  <input
                    type="number"
                    min={30}
                    max={1440}
                    step={30}
                    value={workloadPreferences.weekdayCapacityMinutes}
                    onChange={(event) => {
                      const next = {
                        ...workloadPreferences,
                        weekdayCapacityMinutes: Math.max(30, Number(event.target.value) || 30),
                      };
                      setWorkloadPreferences(next);
                      saveWorkloadPreferences(next);
                    }}
                  />
                  <span>分钟</span>
                </label>
                <label>
                  <span>周末</span>
                  <input
                    type="number"
                    min={30}
                    max={1440}
                    step={30}
                    value={workloadPreferences.weekendCapacityMinutes}
                    onChange={(event) => {
                      const next = {
                        ...workloadPreferences,
                        weekendCapacityMinutes: Math.max(30, Number(event.target.value) || 30),
                      };
                      setWorkloadPreferences(next);
                      saveWorkloadPreferences(next);
                    }}
                  />
                  <span>分钟</span>
                </label>
                <label className="wmv-load-checkbox">
                  <input
                    type="checkbox"
                    checked={workloadPreferences.showTaskCount}
                    onChange={(event) => {
                      const next = { ...workloadPreferences, showTaskCount: event.target.checked };
                      setWorkloadPreferences(next);
                      saveWorkloadPreferences(next);
                    }}
                  />
                  显示任务数
                </label>
                <label className="wmv-load-checkbox">
                  <input
                    type="checkbox"
                    checked={workloadPreferences.showDuration}
                    onChange={(event) => {
                      const next = { ...workloadPreferences, showDuration: event.target.checked };
                      setWorkloadPreferences(next);
                      saveWorkloadPreferences(next);
                    }}
                  />
                  显示分钟负载
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="wmv-matrix">
        <div className="wmv-row wmv-row--header" style={{ display: 'grid', gridTemplateColumns: matrixColumnTemplate }}>
          <div className="wmv-cell wmv-cell--tag" />
          {dateRange.map((dateStr) => {
            const isToday = dateStr === todayString;
            const dow = getDayOfWeek(dateStr);
            const isWeekend = dow === 0 || dow === 6;
            const workload = workloads.get(dateStr);
            const ratio = workload?.ratio ?? 0;
            const tone = getWorkloadTone(ratio);
            return (
              <div
                key={dateStr}
                className={`wmv-cell wmv-cell--date ${isToday ? 'wmv-cell--today' : ''} ${
                  isWeekend ? 'wmv-cell--weekend' : ''
                } ${hoverCell?.tag === '' && hoverCell.date === dateStr ? 'wmv-cell--drop-target' : ''}`}
                data-date={dateStr}
                onDragOver={(event) => handleCellDragOver(event, '', dateStr)}
                onDragLeave={(event) => handleCellDragLeave(event, '', dateStr)}
                onDrop={(event) => handleCellDrop(event, '', dateStr)}
              >
                <span className="wmv-date-weekday">{WEEKDAY_LABELS[dow === 0 ? 6 : dow - 1]}</span>
                <span className="wmv-date-num">{splitDate(dateStr).day}</span>
                {(workloadPreferences.showTaskCount || workloadPreferences.showDuration) && (
                  <div className={`wmv-load wmv-load--${tone}`}>
                    <span className="wmv-load-label">
                      {workloadPreferences.showTaskCount && `${workload?.taskCount ?? 0}项`}
                      {workloadPreferences.showTaskCount && workloadPreferences.showDuration && ' · '}
                      {workloadPreferences.showDuration && `${workload?.totalMinutes ?? 0}/${workload?.capacityMinutes ?? 0}m`}
                    </span>
                    <span className="wmv-load-track" aria-label={`负载 ${Math.round(ratio * 100)}%`}>
                      <span style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {tags.map((tag) => {
          const tagColor = getTagColor(tag);
          return (
            <div key={tag} className="wmv-row" style={{ display: 'grid', gridTemplateColumns: matrixColumnTemplate }}>
              <div className="wmv-cell wmv-cell--tag">
                <span className="wmv-tag-badge" style={{ backgroundColor: tagColor }}>
                  {tag}
                </span>
              </div>

              {dateRange.map((dateStr) => {
                const key = `${tag}::${dateStr}`;
                const blocks = matrix.get(key) ?? [];
                const dow = getDayOfWeek(dateStr);
                const isWeekend = dow === 0 || dow === 6;
                const isDropTarget = hoverCell?.tag === tag && hoverCell.date === dateStr;

                return (
                  <div
                    key={dateStr}
                    className={`wmv-cell ${isWeekend ? 'wmv-cell--weekend' : ''} ${
                      blocks.length > 0 ? 'wmv-cell--has-data' : ''
                    } ${isDropTarget ? 'wmv-cell--drop-target' : ''}`}
                    data-date={dateStr}
                    data-tag={tag}
                    onDragOver={(event) => handleCellDragOver(event, tag, dateStr)}
                    onDragLeave={(event) => handleCellDragLeave(event, tag, dateStr)}
                    onDrop={(event) => handleCellDrop(event, tag, dateStr)}
                  >
                    <AnimatePresence mode="popLayout">
                    {blocks.map((block) => {
                      const header = block.header;
                      const isOverdue = isTaskOverdueOnDate(header, todayString);
                      const isDragging = draggingId === block.id;

                      return (
                        <motion.div
                          layout
                          initial={{ opacity: 0, scale: 0.9, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.8, y: 30, filter: 'blur(4px)' }}
                          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                          key={block.id}
                          draggable
                          tabIndex={0}
                          // @ts-expect-error framer-motion type collision
                          onDragStart={(event: React.DragEvent<HTMLDivElement>) => {
                            const dragData: SmartBlockDragPayload = {
                              type: 'smart-block',
                              source: 'week-matrix',
                              taskId: block._taskId,
                              blockId: block.id,
                              tag: block.header.tag,
                              title: block.header.title,
                              fromDate: block.header.date || ''
                            };
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('application/json', JSON.stringify(dragData));
                            handleDragStart(block);
                          }}
                          onDragEnd={handleDragEnd}
                          className={`wmv-block-card ${header.isCompleted ? 'wmv-block-card--done' : ''} ${
                            isOverdue ? 'wmv-block-card--overdue' : ''
                          } ${(() => {
                            const ids = getValidGraphNodeIds(header);
                            return ids.length === 0 ? 'wmv-block-card--unlinked' : '';
                          })()} ${
                            isDragging ? 'wmv-block-card--dragging' : ''
                          }`}
                          data-block-id={block.id}
                          style={{
                            backgroundColor: resolveTaskCategoryTheme(tagColor).backgroundColor,
                            borderLeftColor: resolveTaskCategoryTheme(tagColor).accentColor,
                          }}
                          onClick={() => { if (!suppressCardOpenRef.current) openProjectTaskModal(block._taskId, block.id, { source: 'week-matrix', sourceDate: header.date }); }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openProjectTaskModal(block._taskId, block.id, { source: 'week-matrix', sourceDate: header.date });
                            }
                          }}
                          title="拖动到同标签的其他日期列即可直接改期"
                        >
                          <div className="wmv-block-header">
                            <button
                              type="button"
                              className={`wmv-check ${isQuantityTask(header) ? 'wmv-check--quantity' : ''} ${header.isCompleted ? 'wmv-check--done' : ''}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (isQuantityTask(header)) {
                                  openProjectTaskModal(block._taskId, block.id, { source: 'week-matrix', sourceDate: header.date });
                                } else {
                                  handleToggle(block._taskId, block.id, header.isCompleted);
                                }
                              }}
                              title={isQuantityTask(header) ? '打开任务并记录数量进度' : header.isCompleted ? '取消完成' : '标记完成'}
                              aria-label={isQuantityTask(header) ? `记录数量进度：${header.title}` : header.isCompleted ? `取消完成：${header.title}` : `标记完成：${header.title}`}
                            >
                              {isQuantityTask(header) ? <Hash size={12} /> : header.isCompleted && '✓'}
                            </button>
                            <span
                              className={`wmv-block-title ${header.isCompleted ? 'wmv-block-title--done' : ''}`}
                              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                              {header.title}
                              {(() => {
                                const ids = getValidGraphNodeIds(header);
                                return ids.length === 0 ? (
                                  <span title="未绑定知识节点" className="inline-flex items-center flex-shrink-0 opacity-40">
                                    <CircleDashed size={12} />
                                  </span>
                                ) : null;
                              })()}
                            </span>
                          </div>

                          <div className="wmv-block-meta">
                            <span>{isQuantityTask(header) && header.date ? <><Hash size={12} />{getQuantityCompleted(header)}/{getQuantityTotal(header)} {getQuantityUnit(header)} · {getQuantityProgressPercent(header)}% · 当日 {getQuantityDailyStatus(header, header.date).actual}/{getQuantityDailyStatus(header, header.date).target}</> : <><Clock3 size={12} />{header.duration}m</>}</span>
                          </div>

                          {block.body && (
                            <div className="wmv-block-body">
                              <div
                                dangerouslySetInnerHTML={{
                                  __html: sanitizeHtml(block.body),
                                }}
                              />
                            </div>
                          )}
                        </motion.div>
                      );
                    })}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          );
        })}

        {tags.length === 0 && (
          <div className="wmv-empty">
            <CalendarDays size={48} />
            <p>暂无智能任务块</p>
            <p className="wmv-empty-hint">在项目文档中添加智能任务块后，它们会自动出现在这里</p>
          </div>
        )}
      </div>

      <AnimatePresence>
        {toastMessage && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            className="wmv-toast"
          >
            <span className="wmv-toast-text">{toastMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default WeekMatrixView;

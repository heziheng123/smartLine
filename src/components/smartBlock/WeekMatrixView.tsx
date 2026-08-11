import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, CalendarDays, CircleDashed, BookMarked, Hash, Clock3, Settings2, FolderOpen, Tag } from 'lucide-react';
import type { Task, TaskGroup, SmartTaskBlock, SmartBlockDragPayload } from '@/types';
import { getQuantityCompleted, getQuantityDailyStatus, getQuantityProgressPercent, getQuantityTotal, getQuantityUnit, getSmartTaskBlocks, getTagColor, getTaskEstimatedMinutes, getValidGraphNodeIds, isQuantityTask } from '@/utils/blocks';
import { sanitizeHtml } from '@/utils/sanitize';
import { openProjectTaskModal } from './projectTaskModal';
import { resolveTaskCategoryTheme } from '@/utils/taskCategoryTheme';
import { isTaskOverdueOnDate } from '@/domain/taskRules';
import { resolveProjectTask, rescheduleProjectTask, setProjectTaskCompletion } from '@/services/projectTaskCommands';
import { scheduleBacklogTaskToDate } from '@/services/backlogCommands';
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
import { buildProjectDescriptorMap } from '@/domain/projectDescriptor';
import SyncStatusIndicator from '@/components/SyncStatusIndicator';
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
  groups: TaskGroup[];
}

interface ViewBlock extends SmartTaskBlock {
  _taskId: string;
  _projectLabel: string;
  _projectColor: string;
  _projectTextColor: string;
}

type MatrixGroupMode = 'tag' | 'project';

interface MatrixRow {
  key: string;
  label: string;
  color: string;
  textColor?: string;
  kind: MatrixGroupMode;
  projectId?: string;
  tag?: string;
}

const GROUP_MODE_STORAGE_KEY = 'week-matrix-group-mode-v1';

function loadGroupMode(): MatrixGroupMode {
  try {
    return localStorage.getItem(GROUP_MODE_STORAGE_KEY) === 'project' ? 'project' : 'tag';
  } catch {
    return 'tag';
  }
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

const sanitizedBodyCache = new Map<string, string>();
function getSanitizedTaskBody(body: string): string {
  const cached = sanitizedBodyCache.get(body);
  if (cached !== undefined) return cached;
  const sanitized = sanitizeHtml(body);
  if (sanitizedBodyCache.size >= 500) {
    const oldest = sanitizedBodyCache.keys().next().value;
    if (oldest !== undefined) sanitizedBodyCache.delete(oldest);
  }
  sanitizedBodyCache.set(body, sanitized);
  return sanitized;
}

const WeekMatrixView: React.FC<WeekMatrixViewProps> = ({ tasks, groups }) => {
  const [cursor, setCursor] = useState(() => todayStr());
  const [mode, setMode] = useState<'week' | 'month'>('week');
  const [groupMode, setGroupMode] = useState<MatrixGroupMode>(loadGroupMode);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [hoverCell, setHoverCell] = useState<{ rowKey: string; date: string } | null>(null);
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

  useEffect(() => {
    try {
      localStorage.setItem(GROUP_MODE_STORAGE_KEY, groupMode);
    } catch {
      // Display preferences are optional and must never block task planning.
    }
  }, [groupMode]);

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
    const projectDescriptors = buildProjectDescriptorMap(tasks, groups);
    const result: ViewBlock[] = [];
    for (const task of tasks) {
      const descriptor = projectDescriptors.get(task.id);
      const blocks = getSmartTaskBlocks(task.blocks ?? []);
      for (const block of blocks) {
        if (block.header.isArchived || block.header.frozenAt) continue;
        result.push({
          ...block,
          _taskId: task.id,
          _projectLabel: descriptor?.label ?? task.name,
          _projectColor: descriptor?.backgroundColor ?? '#e5e7eb',
          _projectTextColor: descriptor?.textColor ?? '#1f2937',
        });
      }
    }
    return result;
  }, [groups, tasks]);

  const rows = useMemo(() => {
    const rowMap = new Map<string, MatrixRow>();
    const visibleDates = new Set(dateRange);
    for (const block of allBlocks) {
      if (!block.header.date || !visibleDates.has(block.header.date)) continue;
      if (groupMode === 'project') {
        const key = `project:${block._taskId}`;
        if (!rowMap.has(key)) {
          rowMap.set(key, {
            key,
            label: block._projectLabel,
            color: block._projectColor,
            textColor: block._projectTextColor,
            kind: 'project',
            projectId: block._taskId,
          });
        }
      } else {
        const tag = block.header.tag || '未分类';
        const key = `tag:${tag}`;
        if (!rowMap.has(key)) {
          rowMap.set(key, { key, label: tag, color: getTagColor(tag), kind: 'tag', tag });
        }
      }
    }
    return [...rowMap.values()];
  }, [allBlocks, dateRange, groupMode]);

  const matrix = useMemo(() => {
    const map = new Map<string, Map<string, ViewBlock[]>>();
    for (const block of allBlocks) {
      if (!block.header.date) continue;
      const normalizedTag = block.header.tag || '未分类';
      const rowKey = groupMode === 'project'
        ? `project:${block._taskId}`
        : `tag:${normalizedTag}`;
      if (!map.has(rowKey)) map.set(rowKey, new Map());
      const row = map.get(rowKey)!;
      if (!row.has(block.header.date)) row.set(block.header.date, []);
      row.get(block.header.date)!.push(block);
    }

    for (const row of map.values()) {
      for (const blocks of row.values()) {
        blocks.sort((a, b) => {
          if (a.header.isCompleted !== b.header.isCompleted) return Number(a.header.isCompleted) - Number(b.header.isCompleted);
          return a.header.title.localeCompare(b.header.title, 'zh-CN');
        });
      }
    }

    return map;
  }, [allBlocks, groupMode]);

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
    setDraggingId(`${block._taskId}::${block.id}`);
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
    (event: React.DragEvent<HTMLDivElement>, rowKey: string, date: string) => {
      // 允许所有拖拽（包括来自外部的 Icebox）
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      if (!hoverCell || hoverCell.rowKey !== rowKey || hoverCell.date !== date) {
        setHoverCell({ rowKey, date });
      }
    },
    [hoverCell],
  );

  const handleCellDragLeave = useCallback(
    (event: React.DragEvent<HTMLDivElement>, rowKey: string, date: string) => {
      // 避免由于进入子元素而触发的意外 leave 导致闪烁
      if (event.currentTarget.contains(event.relatedTarget as Node)) {
        return;
      }
      if (hoverCell?.rowKey === rowKey && hoverCell.date === date) {
        setHoverCell(null);
      }
    },
    [hoverCell],
  );

  const handleCellDrop = useCallback(
    async (event: React.DragEvent<HTMLDivElement>, targetRowKey: string, targetDate: string) => {
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

      if (
        groupMode === 'project'
        && targetRowKey.startsWith('project:')
        && targetRowKey !== `project:${draggedData.taskId}`
      ) {
        const current = allBlocks.find(
          (block) => block._taskId === draggedData.taskId && block.id === draggedData.blockId,
        );
        showToast(`不能通过周矩阵更改所属项目，请拖到日期表头或“${current?._projectLabel ?? '原项目'}”行`);
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
      const canonicalHeader = resolveProjectTask(draggedData.taskId, draggedData.blockId)?.block.header;
      const deadline = current?.header.deadline ?? canonicalHeader?.deadline;
      if (deadline && targetDate > deadline) {
        const confirmed = await requestConfirmation({
          title: '排期晚于截止日期',
          message: `“${draggedData.title}”的截止日期是 ${deadline}，目标日期是 ${targetDate}。是否仍然安排？`,
          confirmLabel: '仍然安排',
          cancelLabel: '返回修改',
          tone: 'warning',
        });
        if (!confirmed) {
          clearDragState();
          return;
        }
      }
      const result = draggedData.source === 'icebox' || draggedData.source === 'backlog_river'
        ? scheduleBacklogTaskToDate(draggedData, targetDate)
        : rescheduleProjectTask(draggedData.taskId, draggedData.blockId, targetDate);
      showToast('error' in result ? result.error : `已将“${draggedData.title}”改期到 ${targetDate}`);
      clearDragState();
    },
    [allBlocks, clearDragState, groupMode, showToast],
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
  const rowLabelWidth = groupMode === 'project' ? '180px' : '100px';
  const matrixColumnTemplate = `${rowLabelWidth} repeat(${dateRange.length}, minmax(${mode === 'week' ? '88px' : '120px'}, 1fr))`;

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
            正在拖动任务；只调整日期，不改变所属项目和任务类型
          </div>
        )}

        <div className="wmv-nav-right">
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

          <div className="wmv-group-switch" role="group" aria-label="周矩阵分组方式">
            <span className="wmv-group-switch-label">分组</span>
            <button
              type="button"
              className={`wmv-mode-btn ${groupMode === 'tag' ? 'wmv-mode-btn--active' : ''}`}
              onClick={() => setGroupMode('tag')}
              aria-pressed={groupMode === 'tag'}
            >
              <Tag size={13} />类型
            </button>
            <button
              type="button"
              className={`wmv-mode-btn ${groupMode === 'project' ? 'wmv-mode-btn--active' : ''}`}
              onClick={() => setGroupMode('project')}
              aria-pressed={groupMode === 'project'}
            >
              <FolderOpen size={13} />项目
            </button>
          </div>
          <div className="wmv-mode-switch" role="group" aria-label="周矩阵时间范围">
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
                        weekdayCapacityMinutes: Math.min(1440, Math.max(30, Number(event.target.value) || 30)),
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
                        weekendCapacityMinutes: Math.min(1440, Math.max(30, Number(event.target.value) || 30)),
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
          <SyncStatusIndicator />
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
                } ${hoverCell?.rowKey === '' && hoverCell.date === dateStr ? 'wmv-cell--drop-target' : ''}`}
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

        {rows.map((row) => {
          return (
            <div key={row.key} className="wmv-row" style={{ display: 'grid', gridTemplateColumns: matrixColumnTemplate }}>
              <div className="wmv-cell wmv-cell--tag">
                <span
                  className={`wmv-tag-badge ${row.kind === 'project' ? 'wmv-project-badge' : ''}`}
                  style={{ backgroundColor: row.color, color: row.textColor }}
                  title={row.label}
                >
                  {row.kind === 'project' && <FolderOpen size={13} aria-hidden="true" />}
                  <span>{row.label}</span>
                </span>
              </div>

              {dateRange.map((dateStr) => {
                const blocks = matrix.get(row.key)?.get(dateStr) ?? [];
                const dow = getDayOfWeek(dateStr);
                const isWeekend = dow === 0 || dow === 6;
                const isDropTarget = hoverCell?.rowKey === row.key && hoverCell.date === dateStr;

                return (
                  <div
                    key={dateStr}
                    className={`wmv-cell ${isWeekend ? 'wmv-cell--weekend' : ''} ${
                      blocks.length > 0 ? 'wmv-cell--has-data' : ''
                    } ${isDropTarget ? 'wmv-cell--drop-target' : ''}`}
                    data-date={dateStr}
                    data-row-key={row.key}
                    data-tag={row.kind === 'tag' ? row.tag : undefined}
                    data-project-id={row.kind === 'project' ? row.projectId : undefined}
                    onDragOver={(event) => handleCellDragOver(event, row.key, dateStr)}
                    onDragLeave={(event) => handleCellDragLeave(event, row.key, dateStr)}
                    onDrop={(event) => handleCellDrop(event, row.key, dateStr)}
                  >
                    <AnimatePresence mode="popLayout">
                    {blocks.map((block) => {
                      const header = block.header;
                      const isOverdue = isTaskOverdueOnDate(header, todayString);
                      const isDragging = draggingId === `${block._taskId}::${block.id}`;
                      const taskTag = header.tag || '未分类';
                      const tagColor = groupMode === 'tag'
                        ? row.color
                        : header.tagColor || getTagColor(taskTag);
                      const categoryTheme = resolveTaskCategoryTheme(tagColor);
                      const hasGraphNode = getValidGraphNodeIds(header).length > 0;
                      const quantityTask = isQuantityTask(header);
                      const quantityDailyStatus = quantityTask && header.date
                        ? getQuantityDailyStatus(header, header.date)
                        : null;

                      return (
                        <motion.div
                          layout
                          initial={{ opacity: 0, scale: 0.9, y: 10 }}
                          animate={{ opacity: 1, scale: 1, y: 0 }}
                          exit={{ opacity: 0, scale: 0.8, y: 30, filter: 'blur(4px)' }}
                          transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                          key={`${block._taskId}::${block.id}`}
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
                          } ${!hasGraphNode ? 'wmv-block-card--unlinked' : ''} ${
                            isDragging ? 'wmv-block-card--dragging' : ''
                          }`}
                          data-block-id={block.id}
                          data-task-id={block._taskId}
                          style={{
                            backgroundColor: categoryTheme.backgroundColor,
                            borderLeftColor: categoryTheme.accentColor,
                          }}
                          onClick={() => { if (!suppressCardOpenRef.current) openProjectTaskModal(block._taskId, block.id, { source: 'week-matrix', sourceDate: header.date }); }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              openProjectTaskModal(block._taskId, block.id, { source: 'week-matrix', sourceDate: header.date });
                            }
                          }}
                          title={groupMode === 'project' ? '拖动到同项目的其他日期列即可直接改期' : '拖动到其他日期列即可直接改期，任务类型不会改变'}
                        >
                          <div className="wmv-block-header">
                            <button
                              type="button"
                              className={`wmv-check ${quantityTask ? 'wmv-check--quantity' : ''} ${header.isCompleted ? 'wmv-check--done' : ''}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                if (quantityTask) {
                                  openProjectTaskModal(block._taskId, block.id, { source: 'week-matrix', sourceDate: header.date });
                                } else {
                                  handleToggle(block._taskId, block.id, header.isCompleted);
                                }
                              }}
                              title={quantityTask ? '打开任务并记录数量进度' : header.isCompleted ? '取消完成' : '标记完成'}
                              aria-label={quantityTask ? `记录数量进度：${header.title}` : header.isCompleted ? `取消完成：${header.title}` : `标记完成：${header.title}`}
                            >
                              {quantityTask ? <Hash size={12} /> : header.isCompleted && '✓'}
                            </button>
                            <span
                              className={`wmv-block-title ${header.isCompleted ? 'wmv-block-title--done' : ''}`}
                              style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                            >
                              {header.title}
                              {!hasGraphNode ? (
                                  <span title="未绑定知识节点" className="inline-flex items-center flex-shrink-0 opacity-40">
                                    <CircleDashed size={12} />
                                  </span>
                                ) : null}
                            </span>
                          </div>

                          <div className="wmv-block-meta">
                            <span>{quantityTask && quantityDailyStatus ? <><Hash size={12} />{getQuantityCompleted(header)}/{getQuantityTotal(header)} {getQuantityUnit(header)} · {getQuantityProgressPercent(header)}% · 当日 {quantityDailyStatus.actual}/{quantityDailyStatus.target} · <Clock3 size={12} />每日 {getTaskEstimatedMinutes(header)}m</> : <><Clock3 size={12} />{getTaskEstimatedMinutes(header)}m</>}</span>
                          </div>
                          <div className="wmv-block-context">
                            {groupMode === 'project' ? (
                              <span style={{ borderColor: categoryTheme.accentColor, color: categoryTheme.accentColor }}>
                                <Tag size={10} />{taskTag}
                              </span>
                            ) : (
                              <span title={block._projectLabel}><FolderOpen size={10} />{block._projectLabel}</span>
                            )}
                          </div>

                          {block.body && (
                            <div className="wmv-block-body">
                              <div
                                dangerouslySetInnerHTML={{
                                  __html: getSanitizedTaskBody(block.body),
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

        {rows.length === 0 && (
          <div className="wmv-empty">
            <CalendarDays size={48} />
            <p>{groupMode === 'project' ? `当前${mode === 'week' ? '周' : '月'}暂无已排期项目任务` : '暂无智能任务块'}</p>
            <p className="wmv-empty-hint">{groupMode === 'project' ? '可从待排期箱拖到上方日期表头进行安排' : '在项目文档中添加智能任务块后，它们会自动出现在这里'}</p>
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

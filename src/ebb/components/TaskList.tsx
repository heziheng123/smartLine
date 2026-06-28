// ============================================================
// Ebb - 任务列表
// 双模式（今日及逾期 / 指定日期）· 搜索 · 标签分组 · 日负载摘要
// ============================================================

import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import dayjs from 'dayjs';
import { Search, ClipboardList } from 'lucide-react';
import { Droppable } from '@hello-pangea/dnd';
import type { ReviewTask, EbbSettings } from '../types';
import {
  isOverdue,
  isDueToday,
  computeRounds,
} from '../scheduler';
import { getPointWeight } from '../complexity';
import { useEbbStore } from '../store';
import TaskCard from './TaskCard';

interface TaskListProps {
  tasks: ReviewTask[];
  settings: EbbSettings;
  selectedDate: string;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onReschedule: (id: string) => void;
  onAddRound: (task: ReviewTask) => void;
  onOpenRounds: (task: ReviewTask) => void;
  onOpenTimeline: (topicName: string) => void;
  onDragEnd: (taskId: string, newDate: string) => void;
  onExportDay: (date: string) => void;
}

type ListMode = 'today' | 'date';

const TaskList: React.FC<TaskListProps> = ({
  tasks,
  settings,
  selectedDate,
  onToggle,
  onDelete,
  onReschedule,
  onAddRound,
  onOpenRounds,
  onOpenTimeline,
  onDragEnd,
  onExportDay,
}) => {
  const [mode, setMode] = useState<ListMode>('today');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const composingRef = useRef(false);
  const debounceTimer = useRef<number | null>(null);

  // 防抖搜索（400ms）+ 中文输入法兼容
  useEffect(() => {
    if (composingRef.current) return;
    if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    debounceTimer.current = window.setTimeout(() => {
      setDebouncedQuery(query.trim());
    }, 400);
    return () => {
      if (debounceTimer.current) window.clearTimeout(debounceTimer.current);
    };
  }, [query]);

  const handleCompositionStart = () => { composingRef.current = true; };
  const handleCompositionEnd = (e: React.CompositionEvent) => {
    composingRef.current = false;
    setQuery((e.target as HTMLInputElement).value);
  };

  // 筛选今日及逾期
  const todayAndOverdue = useMemo(() => {
    const today = dayjs().format('YYYY-MM-DD');
    return tasks
      .filter((t) => !t.isCompleted && (isDueToday(t) || isOverdue(t) || t.dueDate < today))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [tasks]);

  // 筛选指定日期
  const dayTasks = useMemo(() => {
    return tasks
      .filter((t) => t.dueDate === selectedDate)
      .sort((a, b) => {
        // 未完成在前
        if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
        return a.topicName.localeCompare(b.topicName);
      });
  }, [tasks, selectedDate]);

  const baseList = mode === 'today' ? todayAndOverdue : dayTasks;

  // 搜索过滤
  const filtered = useMemo(() => {
    if (!debouncedQuery) return baseList;
    const q = debouncedQuery.toLowerCase();
    return baseList.filter(
      (t) =>
        t.topicName.toLowerCase().includes(q) ||
        (t.tag || '').toLowerCase().includes(q),
    );
  }, [baseList, debouncedQuery]);

  // 日负载摘要
  const daySummary = useMemo(() => {
    if (mode !== 'date') return null;
    const { roundMap } = computeRounds(tasks);
    const dayList = tasks.filter((t) => t.dueDate === selectedDate);
    const points = dayList.reduce((sum, t) => {
      if (!t.complexity) return sum;
      const r = roundMap.get(t.id) ?? 0;
      return sum + getPointWeight(r, t.complexity, settings.complexityConfigs);
    }, 0);
    const done = dayList.filter((t) => t.isCompleted).length;
    return {
      count: dayList.length,
      done,
      points,
      pointLimit: settings.dailyPointLimit,
      taskLimit: settings.dailyTaskLimit,
    };
  }, [mode, tasks, selectedDate, settings]);

  // 按标签分组
  const grouped = useMemo(() => {
    const map = new Map<string, ReviewTask[]>();
    for (const t of filtered) {
      const key = t.tag || '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    // 无标签组排最后
    const entries = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === '' && b[0] !== '') return 1;
      if (a[0] !== '' && b[0] === '') return -1;
      return a[0].localeCompare(b[0]);
    });
    return entries;
  }, [filtered]);

  const toggleCollapsedGroup = useEbbStore((s) => s.toggleCollapsedGroup);

  const toggleGroup = useCallback((tag: string) => {
    const groupId = `tag-${tag || 'untagged'}`;
    toggleCollapsedGroup(groupId);
  }, [toggleCollapsedGroup]);

  const handleExport = useCallback(() => {
    onExportDay(mode === 'today' ? dayjs().format('YYYY-MM-DD') : selectedDate);
  }, [mode, selectedDate, onExportDay]);

  const dateLabel = useMemo(() => {
    if (mode === 'today') return '今日及逾期待办';
    const d = dayjs(selectedDate);
    const today = dayjs().format('YYYY-MM-DD');
    if (selectedDate === today) return '今天';
    return d.format('YYYY年M月D日');
  }, [mode, selectedDate]);

  return (
    <div className="eb-task-list">
      <div className="eb-task-list-toolbar">
        <div className="eb-task-list-mode">
          <button
            type="button"
            className={`eb-mode-btn ${mode === 'today' ? 'eb-mode-btn--active' : ''}`}
            onClick={() => setMode('today')}
          >
            🎯 今日及逾期
          </button>
          <button
            type="button"
            className={`eb-mode-btn ${mode === 'date' ? 'eb-mode-btn--active' : ''}`}
            onClick={() => setMode('date')}
          >
            📅 指定日期
          </button>
        </div>

        <div className="eb-task-list-search">
          <Search size={14} className="eb-task-list-search-icon" />
          <input
            type="text"
            className="eb-task-list-search-input"
            placeholder="搜索主题或标签..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
          />
        </div>

        {mode === 'today' && (
          <button
            type="button"
            className="eb-task-list-export"
            onClick={handleExport}
            title="导出今日到剪贴板"
          >
            <ClipboardList size={13} />
            导出
          </button>
        )}
      </div>

      <div className="eb-task-list-title">
        <span className="eb-task-list-title-text">{dateLabel}</span>
        <span className="eb-task-list-count">{filtered.length}</span>
      </div>

      {daySummary && (
        <div className="eb-day-summary">
          <div className="eb-day-summary-bar">
            <div className="eb-day-summary-bar-fill" style={{ width: `${Math.min(100, (daySummary.points / daySummary.pointLimit) * 100)}%` }} />
          </div>
          <span className="eb-day-summary-text">
            {daySummary.done}/{daySummary.count} 完成 · {daySummary.points}/{daySummary.pointLimit} 分
          </span>
        </div>
      )}

      <div className="eb-task-list-body">
          {filtered.length === 0 ? (
            <div className="eb-task-list-empty">
              <div className="eb-task-list-empty-icon">✦</div>
              <div className="eb-task-list-empty-text">
                {mode === 'today' ? '今日无待办，开启新复习吧' : '该日无任务'}
              </div>
            </div>
          ) : (
            grouped.map(([tag, group]) => {
              const groupId = `tag-${tag || 'untagged'}`;
              const collapsed = settings.collapsedGroups.includes(groupId);
              const tagColor = tag ? settings.tagColors[tag] : undefined;
              return (
                <div key={groupId} className="eb-task-group">
                  <div
                    className="eb-task-group-header"
                    onClick={() => toggleGroup(tag)}
                  >
                    <span className={`eb-task-group-caret ${collapsed ? 'eb-task-group-caret--collapsed' : ''}`}>▾</span>
                    <span className="eb-task-group-name">
                      {tag || '未分组'}
                      {tagColor && (
                        <span className="eb-task-group-dot" style={{ backgroundColor: tagColor }} />
                      )}
                    </span>
                    <span className="eb-task-group-count">
                      {group.length} 个任务 · {new Set(group.map((t) => t.topicName)).size} 个主题
                    </span>
                  </div>
                  {!collapsed && (
                    <Droppable droppableId={`eb-group-${groupId}`}>
                      {(provided) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className="eb-task-group-body"
                        >
                          {group.map((t, idx) => (
                            <TaskCard
                              key={t.id}
                              task={t}
                              allTasks={tasks}
                              settings={settings}
                              index={idx}
                              onToggle={onToggle}
                              onDelete={onDelete}
                              onReschedule={onReschedule}
                              onAddRound={onAddRound}
                              onOpenRounds={onOpenRounds}
                              onOpenTimeline={onOpenTimeline}
                            />
                          ))}
                          {provided.placeholder}
                        </div>
                      )}
                    </Droppable>
                  )}
                </div>
              );
            })
          )}
        </div>
    </div>
  );
};

export default TaskList;

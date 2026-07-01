// ============================================================
// Ebb - 迷你日历
// 月/周切换 · 负载热力图 · 点击选日 · 拖拽改期落点
// ============================================================

import React, { useMemo, useState, useCallback } from 'react';
import dayjs from 'dayjs';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Droppable } from '@hello-pangea/dnd';
import type { ReviewTask, EbbSettings } from '../types';
import {
  getHeatmapLevel,
  computeRounds,
} from '../scheduler';
import { getPointWeight } from '../complexity';
import { HEATMAP_LEVELS } from '../constants';

interface MiniCalendarProps {
  tasks: ReviewTask[];
  settings: EbbSettings;
  selectedDate: string;
  onSelectDate: (date: string) => void;
}

const WEEKDAY_SHORT = ['一', '二', '三', '四', '五', '六', '日'];

function getWeekStart(date: dayjs.Dayjs): dayjs.Dayjs {
  const d = date.day();
  const offset = d === 0 ? -6 : 1 - d;
  return date.add(offset, 'day');
}

const MiniCalendar: React.FC<MiniCalendarProps> = ({
  tasks,
  settings,
  selectedDate,
  onSelectDate,
}) => {
  const [mode, setMode] = useState<'month' | 'week'>(settings.calViewMode);
  const [cursor, setCursor] = useState(() => dayjs(selectedDate));
  const todayStr = dayjs().format('YYYY-MM-DD');

  // 日负载映射
  const dayLoadMap = useMemo(() => {
    const map = new Map<string, { taskCount: number; points: number; maxRound: number }>();
    const { roundMap } = computeRounds(tasks);
    for (const t of tasks) {
      if (!map.has(t.dueDate)) {
        map.set(t.dueDate, { taskCount: 0, points: 0, maxRound: 0 });
      }
      const entry = map.get(t.dueDate)!;
      entry.taskCount += 1;
      if (t.complexity) {
        const r = roundMap.get(t.id) ?? 0;
        entry.points += getPointWeight(r, t.complexity, settings.complexityConfigs);
      }
      entry.maxRound = Math.max(entry.maxRound, roundMap.get(t.id) ?? 0);
    }
    return map;
  }, [tasks, settings]);

  const maxPoints = useMemo(() => {
    let max = 0;
    for (const v of dayLoadMap.values()) {
      if (v.points > max) max = v.points;
    }
    return Math.max(max, settings.dailyPointLimit);
  }, [dayLoadMap, settings.dailyPointLimit]);

  const handlePrev = useCallback(() => {
    setCursor((c) => (mode === 'month' ? c.subtract(1, 'month') : c.subtract(1, 'week')));
  }, [mode]);

  const handleNext = useCallback(() => {
    setCursor((c) => (mode === 'month' ? c.add(1, 'month') : c.add(1, 'week')));
  }, [mode]);

  const handleToday = useCallback(() => setCursor(dayjs()), []);

  const days = useMemo(() => {
    if (mode === 'month') {
      const monthStart = cursor.startOf('month');
      const gridStart = getWeekStart(monthStart);
      return Array.from({ length: 42 }, (_, i) => gridStart.add(i, 'day'));
    }
    const weekStart = getWeekStart(cursor);
    return Array.from({ length: 7 }, (_, i) => weekStart.add(i, 'day'));
  }, [mode, cursor]);

  const rangeLabel = useMemo(() => {
    if (mode === 'month') return cursor.format('YYYY年M月');
    const start = getWeekStart(cursor);
    const end = start.add(6, 'day');
    if (start.month() === end.month()) {
      return `${start.format('M月D日')} - ${end.format('D日')}`;
    }
    return `${start.format('M月D日')} - ${end.format('M月D日')}`;
  }, [mode, cursor]);

  const currentMonth = cursor.month();

  const handleModeChange = (m: 'month' | 'week') => {
    setMode(m);
  };

  return (
    <div className="eb-mini-cal">
      <div className="eb-mini-cal-header">
        <div className="eb-mini-cal-nav">
          <button type="button" className="eb-mini-cal-nav-btn" onClick={handlePrev} title="上一个">
            <ChevronLeft size={14} />
          </button>
          <span className="eb-mini-cal-range">{rangeLabel}</span>
          <button type="button" className="eb-mini-cal-nav-btn" onClick={handleNext} title="下一个">
            <ChevronRight size={14} />
          </button>
        </div>
        <div className="eb-mini-cal-controls">
          <button
            type="button"
            className={`eb-mini-cal-mode ${mode === 'month' ? 'eb-mini-cal-mode--active' : ''}`}
            onClick={() => handleModeChange('month')}
          >
            月
          </button>
          <button
            type="button"
            className={`eb-mini-cal-mode ${mode === 'week' ? 'eb-mini-cal-mode--active' : ''}`}
            onClick={() => handleModeChange('week')}
          >
            周
          </button>
          <button type="button" className="eb-mini-cal-today-btn" onClick={handleToday}>
            今天
          </button>
        </div>
      </div>

      <div className="eb-mini-cal-weekday-row">
        {WEEKDAY_SHORT.map((w) => (
          <div key={w} className="eb-mini-cal-weekday">{w}</div>
        ))}
      </div>

      <div className={`eb-mini-cal-grid ${mode === 'week' ? 'eb-mini-cal-grid--week' : ''}`}>
        {days.map((day) => {
          const dateStr = day.format('YYYY-MM-DD');
          const isToday = dateStr === todayStr;
          const isSelected = dateStr === selectedDate;
          const inMonth = mode === 'week' || day.month() === currentMonth;
          const load = dayLoadMap.get(dateStr);
          const heatLevel = load ? getHeatmapLevel(load.points, maxPoints) : 0;
          const bg = HEATMAP_LEVELS[heatLevel];
          const isWeekend = day.day() === 0 || day.day() === 6;

          return (
            <Droppable key={dateStr} droppableId={`ebb-day-${dateStr}`}>
              {(provided, snapshot) => (
                <div
                  ref={provided.innerRef}
                  {...provided.droppableProps}
                  className={[
                    'eb-mini-cal-cell',
                    !inMonth ? 'eb-mini-cal-cell--other' : '',
                    isToday ? 'eb-mini-cal-cell--today' : '',
                    isSelected ? 'eb-mini-cal-cell--selected' : '',
                    isWeekend ? 'eb-mini-cal-cell--weekend' : '',
                    snapshot.isDraggingOver ? 'eb-mini-cal-cell--drag-over' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ backgroundColor: bg }}
                  onClick={() => onSelectDate(dateStr)}
                  title={load ? `${dateStr} · ${load.taskCount} 个任务 · ${load.points} 分` : dateStr}
                >
                  <span className="eb-mini-cal-date">{day.date()}</span>
                  {load && load.taskCount > 0 && (
                    <span className="eb-mini-cal-badge">{load.taskCount}</span>
                  )}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          );
        })}
      </div>

      <div className="eb-mini-cal-legend">
        <span className="eb-mini-cal-legend-label">负载</span>
        {HEATMAP_LEVELS.map((color, i) => (
          <span
            key={i}
            className="eb-mini-cal-legend-swatch"
            style={{ backgroundColor: color }}
            title={i === 0 ? '无' : `等级 ${i}`}
          />
        ))}
        <span className="eb-mini-cal-legend-hint">轻 → 重</span>
      </div>
    </div>
  );
};

export default MiniCalendar;

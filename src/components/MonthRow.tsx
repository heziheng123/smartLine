// ============================================================
// Smart Timeline - 月份行
// ============================================================

import React, { useMemo, useState, useCallback } from 'react';
import dayjs from 'dayjs';
import type { MonthLayout, SmartBlockDragPayload } from '@/types';
import { isWeekend, MONTH_NAMES, ROW_HEIGHT, getGroupBorderColor, getGroupLabelTextColor } from '@/utils/timeline-utils';
import SegmentBar from './SegmentBar';

const MonthRow: React.FC<{
  monthLayout: MonthLayout;
  year: number;
  onTaskClick?: (taskId: string) => void;
  onTaskContextMenu?: (e: React.MouseEvent, taskId: string) => void;
  onNoteDoubleClick?: (noteId: string) => void;
  onNoteContextMenu?: (e: React.MouseEvent, noteId: string) => void;
  onMilestoneDoubleClick?: (milestoneId: string) => void;
  onMilestoneContextMenu?: (e: React.MouseEvent, milestoneId: string) => void;
  onGroupDoubleClick?: (groupId: string) => void;
  onSmartBlockDrop?: (dragData: import('@/types').SmartBlockDragPayload, targetDate: string) => void;
}> = ({ monthLayout, year, onTaskClick, onTaskContextMenu, onNoteDoubleClick, onNoteContextMenu, onMilestoneDoubleClick, onMilestoneContextMenu, onGroupDoubleClick, onSmartBlockDrop }) => {
  const { month, daysInMonth, segments, noteSegments, milestones, groupRanges, totalRows: taskRows } = monthLayout;

  // 画布总行数：取任务行和分组范围行的最大值（用 reduce 避免 spread 大数组栈溢出）
  const totalRows = groupRanges.reduce(
    (max, g) => Math.max(max, g.rowEnd + 1),
    taskRows
  );

  const hasTasks = totalRows > 0;
  const canvasHeight = hasTasks ? totalRows * ROW_HEIGHT + 12 : 20;

  const today = dayjs();
  const isCurrentMonth = today.year() === year && today.month() === month;
  const todayDay = isCurrentMonth ? today.date() : -1;

  // 预计算周末列索引
  const weekendSet = useMemo(() => {
    const s = new Set<number>();
    for (let d = 1; d <= daysInMonth; d++) {
      if (isWeekend(year, month, d)) s.add(d - 1);
    }
    return s;
  }, [year, month, daysInMonth]);

  const canvasRef = React.useRef<HTMLDivElement>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);

  const getDayFromEvent = useCallback((e: React.DragEvent) => {
    if (!canvasRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const ratio = x / rect.width;
    const day = Math.floor(ratio * daysInMonth) + 1;
    return Math.max(1, Math.min(day, daysInMonth));
  }, [daysInMonth]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const day = getDayFromEvent(e);
    if (day !== null && dragOverDay !== day) {
      setDragOverDay(day);
    }
  }, [dragOverDay, getDayFromEvent]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    // 如果鼠标移出 canvas 区域，才清除
    if (!canvasRef.current?.contains(e.relatedTarget as Node)) {
      setDragOverDay(null);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const day = getDayFromEvent(e);
    setDragOverDay(null);
    
    if (!day || !onSmartBlockDrop) return;
    
    try {
      const jsonStr = e.dataTransfer.getData('application/json');
      if (jsonStr) {
        const parsed = JSON.parse(jsonStr);
        if (parsed.type === 'smart-block') {
          const targetDate = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          onSmartBlockDrop(parsed as SmartBlockDragPayload, targetDate);
        }
      }
    } catch {
      // 解析失败，忽略
    }
  }, [getDayFromEvent, onSmartBlockDrop, year, month]);

  return (
    <div className={`tl-month-row ${!hasTasks ? 'tl-month-row--empty' : ''}`}>
      {/* 左侧月份标签 */}
      <div className="tl-month-label">{MONTH_NAMES[month]}</div>

      {/* 右侧日历区 */}
      <div className="tl-month-body">
        {/* 全高周末列 */}
        {Array.from({ length: daysInMonth }, (_, i) =>
          weekendSet.has(i) ? (
            <div
              key={`we-${i}`}
              className="tl-weekend-col"
              style={{
                left: `${(i / daysInMonth) * 100}%`,
                width: `${(1 / daysInMonth) * 100}%`,
              }}
            />
          ) : null
        )}

        {/* 日期刻度行 */}
        <div
          className="tl-day-ticks"
          style={{ gridTemplateColumns: `repeat(${daysInMonth}, 1fr)` }}
        >
          {Array.from({ length: daysInMonth }, (_, i) => {
            const d = i + 1;
            const isToday = d === todayDay;
            const isWe = weekendSet.has(i);
            const showNum = d === 1 || d % 5 === 0 || d === daysInMonth;
            return (
              <span
                key={d}
                className={`tl-day-tick ${isToday ? 'tl-day-tick--today' : ''} ${isWe ? 'tl-day-tick--weekend' : ''} ${showNum ? '' : 'tl-day-tick--muted'}`}
              >
                {showNum ? d : ''}
              </span>
            );
          })}
        </div>

        {/* 任务画布 */}
        <div
          ref={canvasRef}
          className="tl-month-canvas"
          style={{ minHeight: canvasHeight }}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          {/* 全高垂直日线 */}
          {Array.from({ length: daysInMonth + 1 }, (_, i) => (
            <div
              key={`gl-${i}`}
              className="tl-grid-line"
              style={{ left: `${(i / daysInMonth) * 100}%` }}
            />
          ))}

          {/* 拖拽放置感应区（高亮显示当前悬停的日期列，不再响应事件，仅作视觉反馈） */}
          {dragOverDay && (
            <div
              className="tl-drop-zone tl-drop-zone--active"
              style={{
                position: 'absolute',
                top: 0,
                bottom: 0,
                left: `${((dragOverDay - 1) / daysInMonth) * 100}%`,
                width: `${(1 / daysInMonth) * 100}%`,
                zIndex: 4, // 放置在背景之下，任务之上
                backgroundColor: 'rgba(59, 130, 246, 0.15)',
                borderLeft: '2px solid #3B82F6',
                borderRight: '2px solid #3B82F6',
                pointerEvents: 'none', // 不阻挡事件
              }}
            />
          )}

          {/* 今日竖线 */}
          {todayDay > 0 && (
            <div
              className="tl-today-line"
              style={{ left: `${((todayDay - 0.5) / daysInMonth) * 100}%` }}
            />
          )}

          {/* 分组范围（虚线边框，置于任务条下方） */}
          {groupRanges.map((gr) => {
            const leftPct = ((gr.startDay - 1) / daysInMonth) * 100;
            const widthPct = ((gr.endDay - gr.startDay + 1) / daysInMonth) * 100;
            // 虚线框上下各内缩 3px，相邻分组框之间留出 6px 视觉间隔，避免边框重叠
            const GAP = 3;
            const topPx = gr.rowStart * ROW_HEIGHT + GAP;
            const heightPx = (gr.rowEnd - gr.rowStart + 1) * ROW_HEIGHT - GAP * 2;
            const borderColor = getGroupBorderColor(gr.color);
            return (
              <div
                key={`group-${gr.groupId}`}
                className="tl-group-range"
                style={{
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  top: topPx,
                  height: heightPx,
                  backgroundColor: `${gr.color}40`,
                  borderColor,
                }}
                title={gr.groupName}
              />
            );
          })}

          {/* 便签渲染 */}
          {noteSegments.map((ns) => {
            if (ns.type === 'pin') {
              // pin 类型：小圆点
              const leftPct = ((ns.startDay - 0.5) / daysInMonth) * 100;
              return (
                <div
                  key={`note-${ns.noteId}`}
                  className="tl-note-pin"
                  style={{ left: `${leftPct}%`, backgroundColor: ns.color }}
                  title={ns.noteName}
                  onDoubleClick={() => onNoteDoubleClick?.(ns.noteId)}
                  onContextMenu={(e) => { e.preventDefault(); onNoteContextMenu?.(e, ns.noteId); }}
                />
              );
            } else {
              // range 类型：彩色横条
              const leftPct = ((ns.startDay - 1) / daysInMonth) * 100;
              const widthPct = ((ns.endDay - ns.startDay + 1) / daysInMonth) * 100;
              return (
                <div
                  key={`note-${ns.noteId}`}
                  className="tl-note-range"
                  style={{ left: `${leftPct}%`, width: `${widthPct}%`, backgroundColor: ns.color }}
                  title={ns.noteName}
                  onDoubleClick={() => onNoteDoubleClick?.(ns.noteId)}
                  onContextMenu={(e) => { e.preventDefault(); onNoteContextMenu?.(e, ns.noteId); }}
                >
                  <span className="tl-note-range-label">{ns.noteName}</span>
                </div>
              );
            }
          })}

          {/* 里程碑渲染 */}
          {milestones.map((ms) => {
            const leftPct = ((ms.day - 0.5) / daysInMonth) * 100;
            return (
              <div
                key={`ms-${ms.milestoneId}`}
                className="tl-milestone"
                style={{ left: `${leftPct}%`, borderColor: ms.color }}
                title={ms.milestoneName}
                onDoubleClick={() => onMilestoneDoubleClick?.(ms.milestoneId)}
                onContextMenu={(e) => { e.preventDefault(); onMilestoneContextMenu?.(e, ms.milestoneId); }}
              >
                <span className="tl-milestone-diamond" style={{ backgroundColor: ms.color }} />
                <span className="tl-milestone-label">{ms.milestoneName}</span>
              </div>
            );
          })}

          {/* 任务片段 */}
          {segments.map((seg) => (
            <SegmentBar
              key={`${seg.taskId}-${seg.month}`}
              segment={seg}
              daysInMonth={daysInMonth}
              onClick={() => onTaskClick?.(seg.taskId)}
              onContextMenu={(e) => onTaskContextMenu?.(e, seg.taskId)}
            />
          ))}

          {/* 分组标签（独立渲染在任务条之上，避免被任务条遮挡） */}
          {groupRanges.map((gr) => {
            const leftPct = ((gr.startDay - 1) / daysInMonth) * 100;
            const GAP = 3;
            const topPx = gr.rowStart * ROW_HEIGHT + GAP;
            const labelTextColor = getGroupLabelTextColor(gr.color);
            return (
              <span
                key={`grouplabel-${gr.groupId}`}
                className="tl-group-label"
                style={{
                  left: `${leftPct}%`,
                  top: topPx - 10,
                  backgroundColor: gr.color,
                  color: labelTextColor,
                }}
                onDoubleClick={() => onGroupDoubleClick?.(gr.groupId)}
                title={gr.groupName}
              >
                {gr.groupName}
              </span>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default MonthRow;

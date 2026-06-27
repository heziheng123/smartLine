// ============================================================
// Smart Timeline - 月份行
// ============================================================

import React, { useMemo } from 'react';
import dayjs from 'dayjs';
import type { MonthLayout } from '@/types';
import { isWeekend, MONTH_NAMES, ROW_HEIGHT, getBorderColor } from '@/utils/timeline-utils';
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
}> = ({ monthLayout, year, onTaskClick, onTaskContextMenu, onNoteDoubleClick, onNoteContextMenu, onMilestoneDoubleClick, onMilestoneContextMenu, onGroupDoubleClick }) => {
  const { month, daysInMonth, segments, noteSegments, milestones, groupRanges, totalRows: taskRows } = monthLayout;

  // 画布总行数：取任务行和分组范围行的最大值
  const totalRows = Math.max(
    taskRows,
    ...groupRanges.map((g) => g.rowEnd + 1),
    0
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
          className="tl-month-canvas"
          style={{ minHeight: canvasHeight }}
        >
          {/* 全高垂直日线 */}
          {Array.from({ length: daysInMonth + 1 }, (_, i) => (
            <div
              key={`gl-${i}`}
              className="tl-grid-line"
              style={{ left: `${(i / daysInMonth) * 100}%` }}
            />
          ))}

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
            const borderColor = getBorderColor(gr.color);
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
            const borderColor = getBorderColor(gr.color);
            return (
              <span
                key={`grouplabel-${gr.groupId}`}
                className="tl-group-label"
                style={{
                  left: `${leftPct}%`,
                  top: topPx - 10,
                  backgroundColor: gr.color,
                  color: borderColor,
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

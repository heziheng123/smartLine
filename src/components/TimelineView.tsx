// ============================================================
// Smart Timeline - 全年垂直堆叠日历视图
// ============================================================

import React, { useMemo, useCallback } from 'react';
import dayjs from 'dayjs';
import type { Task, TaskGroup, Note, Milestone } from '@/types';
import { calculateLayout } from '@/utils/layout';
import {
  sliceTasksForYear,
  sliceNotesForYear,
  mapMilestonesForYear,
  computeGroupRangesForYear,
} from '@/utils/timeline-utils';
import MonthRow from './MonthRow';

// ── Props ──────────────────────────────────────────────────

interface TimelineViewProps {
  tasks: Task[];
  groups: TaskGroup[];
  notes: Note[];
  milestones: Milestone[];
  displayYear: number;
  onTaskClick?: (task: Task) => void;
  onTaskDoubleClick?: (task: Task) => void;
  onTaskContextMenu?: (e: React.MouseEvent, taskId: string) => void;
  onNoteDoubleClick?: (note: Note) => void;
  onNoteContextMenu?: (e: React.MouseEvent, noteId: string) => void;
  onMilestoneDoubleClick?: (milestone: Milestone) => void;
  onMilestoneContextMenu?: (e: React.MouseEvent, milestoneId: string) => void;
  onGroupDoubleClick?: (group: TaskGroup) => void;
}

// ── 主组件 ─────────────────────────────────────────────────

const TimelineView: React.FC<TimelineViewProps> = ({
  tasks,
  groups,
  notes,
  milestones,
  displayYear,
  onTaskClick,
  onTaskDoubleClick,
  onTaskContextMenu,
  onNoteDoubleClick,
  onNoteContextMenu,
  onMilestoneDoubleClick,
  onMilestoneContextMenu,
  onGroupDoubleClick,
}) => {
  const layout = useMemo(() => {
    const yearStart = dayjs(`${displayYear}-01-01`);
    const yearEnd = dayjs(`${displayYear}-12-31`);
    const yearTasks = tasks.filter((t) => {
      const s = dayjs(t.start);
      const e = dayjs(t.end);
      return !e.isBefore(yearStart) && !s.isAfter(yearEnd);
    });
    return calculateLayout({ tasks: yearTasks, groups: [], notes: [], milestones: [] });
  }, [tasks, displayYear]);

  const monthLayouts = useMemo(
    () => sliceTasksForYear(layout.tasks, displayYear),
    [layout.tasks, displayYear],
  );

  const noteSegmentsByMonth = useMemo(
    () => sliceNotesForYear(notes, displayYear),
    [notes, displayYear],
  );

  const milestonesByMonth = useMemo(
    () => mapMilestonesForYear(milestones, displayYear),
    [milestones, displayYear],
  );

  const groupRangesByMonth = useMemo(
    () => computeGroupRangesForYear(groups, layout.tasks, displayYear),
    [groups, layout.tasks, displayYear],
  );

  // 合并所有数据到 monthLayouts
  const mergedMonthLayouts = useMemo(() => {
    return monthLayouts.map((ml, idx) => ({
      ...ml,
      noteSegments: noteSegmentsByMonth[idx] || [],
      milestones: milestonesByMonth[idx] || [],
      groupRanges: groupRangesByMonth[idx] || [],
    }));
  }, [monthLayouts, noteSegmentsByMonth, milestonesByMonth, groupRangesByMonth]);

  const handleSegmentClick = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task) onTaskClick?.(task);
    },
    [tasks, onTaskClick],
  );

  const handleSegmentDoubleClick = useCallback(
    (taskId: string) => {
      const task = tasks.find((t) => t.id === taskId);
      if (task) onTaskDoubleClick?.(task);
    },
    [tasks, onTaskDoubleClick],
  );

  const handleNoteDoubleClick = useCallback(
    (noteId: string) => {
      const note = notes.find((n) => n.id === noteId);
      if (note) onNoteDoubleClick?.(note);
    },
    [notes, onNoteDoubleClick],
  );

  const handleMilestoneDoubleClick = useCallback(
    (milestoneId: string) => {
      const ms = milestones.find((m) => m.id === milestoneId);
      if (ms) onMilestoneDoubleClick?.(ms);
    },
    [milestones, onMilestoneDoubleClick],
  );

  const handleGroupDoubleClick = useCallback(
    (groupId: string) => {
      const group = groups.find((g) => g.id === groupId);
      if (group) onGroupDoubleClick?.(group);
    },
    [groups, onGroupDoubleClick],
  );

  const hasContent = layout.tasks.length > 0 || notes.length > 0 || milestones.length > 0;

  if (!hasContent) {
    return (
      <div className="tl-empty">
        <div className="tl-empty-icon">📋</div>
        <div className="tl-empty-text">{displayYear} 年暂无数据</div>
        <div className="tl-empty-hint">点击上方按钮添加任务、便签或里程碑</div>
      </div>
    );
  }

  return (
    <div className="tl-year-stack">
      <div className="tl-year-card">
        {mergedMonthLayouts.map((ml) => (
          <MonthRow
            key={ml.month}
            monthLayout={ml}
            year={displayYear}
            onTaskClick={handleSegmentClick}
            onTaskDoubleClick={handleSegmentDoubleClick}
            onTaskContextMenu={onTaskContextMenu}
            onNoteDoubleClick={handleNoteDoubleClick}
            onNoteContextMenu={onNoteContextMenu}
            onMilestoneDoubleClick={handleMilestoneDoubleClick}
            onMilestoneContextMenu={onMilestoneContextMenu}
            onGroupDoubleClick={handleGroupDoubleClick}
          />
        ))}
      </div>
    </div>
  );
};

export default TimelineView;

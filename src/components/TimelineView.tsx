// ============================================================
// Smart Timeline - 全年垂直堆叠日历视图
// ============================================================

import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BookmarkPlus,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  Cloud,
  Flag,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Plus,
  Search,
  Settings2,
  X,
} from 'lucide-react';
import { makeLocalDayjs } from '@/utils/dateSafe';
import { readJsonStorage, writeJsonStorage } from '@/utils/persistence';
import type {
  GroupRange,
  GroupSummary,
  MonthLayout,
  SmartBlockDragPayload,
  Task,
  TaskGroup,
  Note,
  Milestone,
} from '@/types';
import { calculateLayout } from '@/utils/layout';
import type { TimelineDensity } from '@/utils/timeline-utils';
import {
  computeGroupRangesForYear,
  getTaskBgForGroupColor,
  mapMilestonesForYear,
  sliceNotesForYear,
  sliceTasksForYear,
} from '@/utils/timeline-utils';
import MonthRow from './MonthRow';
import SyncStatusIndicator from './SyncStatusIndicator';

interface TimelinePreferences {
  density: TimelineDensity;
  groupOrder: string[];
  collapsedGroupIds: string[];
  compactExpandedGroupIds: string[];
  hiddenGroupIds: string[];
  hideCompleted: boolean;
}

const PREFERENCES_KEY = 'smart-timeline-view-preferences-v2';
const DEFAULT_PREFERENCES: TimelinePreferences = {
  density: 'standard',
  groupOrder: [],
  collapsedGroupIds: [],
  compactExpandedGroupIds: [],
  hiddenGroupIds: [],
  hideCompleted: false,
};

function loadPreferences(): TimelinePreferences {
  const stored = readJsonStorage<Partial<TimelinePreferences>>(PREFERENCES_KEY);
  return {
    ...DEFAULT_PREFERENCES,
    ...stored,
    density: stored?.density === 'compact' || stored?.density === 'detailed'
      ? stored.density
      : 'standard',
    groupOrder: Array.isArray(stored?.groupOrder) ? stored.groupOrder : [],
    collapsedGroupIds: Array.isArray(stored?.collapsedGroupIds) ? stored.collapsedGroupIds : [],
    compactExpandedGroupIds: Array.isArray(stored?.compactExpandedGroupIds) ? stored.compactExpandedGroupIds : [],
    hiddenGroupIds: Array.isArray(stored?.hiddenGroupIds) ? stored.hiddenGroupIds : [],
  };
}

function normalizeOrder(savedOrder: string[], groups: TaskGroup[]): string[] {
  const validIds = new Set(groups.map((group) => group.id));
  const retained = savedOrder.filter((id, index) => validIds.has(id) && savedOrder.indexOf(id) === index);
  const retainedSet = new Set(retained);
  return [...retained, ...groups.map((group) => group.id).filter((id) => !retainedSet.has(id))];
}

function remapMonthLayout(
  monthLayout: MonthLayout,
  ranges: GroupRange[],
  collapsedGroupIds: Set<string>,
): MonthLayout {
  const rangeByGroup = new Map(ranges.map((range) => [range.groupId, range]));
  const coveredRows = new Set<number>();
  for (const range of ranges) {
    for (let row = range.rowStart; row <= range.rowEnd; row++) coveredRows.add(row);
  }

  const tokens: Array<
    | { kind: 'group'; sourceRow: number; range: GroupRange }
    | { kind: 'row'; sourceRow: number }
  > = ranges.map((range) => ({ kind: 'group', sourceRow: range.rowStart, range }));

  for (const row of new Set(monthLayout.segments.map((segment) => segment.row))) {
    if (!coveredRows.has(row)) tokens.push({ kind: 'row', sourceRow: row });
  }
  tokens.sort((a, b) => a.sourceRow - b.sourceRow);

  const rowMap = new Map<number, number>();
  const summaries: GroupSummary[] = [];
  const remappedRanges: GroupRange[] = [];
  let nextRow = 0;

  for (const token of tokens) {
    if (token.kind === 'row') {
      rowMap.set(token.sourceRow, nextRow++);
      continue;
    }

    const range = token.range;
    const groupSegments = monthLayout.segments.filter((segment) => segment.groupId === range.groupId);
    if (groupSegments.length === 0) continue;

    if (collapsedGroupIds.has(range.groupId)) {
      const taskIds = new Set(groupSegments.map((segment) => segment.taskId));
      const completedIds = new Set(
        groupSegments.filter((segment) => segment.completed).map((segment) => segment.taskId),
      );
      const summaryRow = nextRow++;
      for (let row = range.rowStart; row <= range.rowEnd; row++) rowMap.set(row, summaryRow);
      summaries.push({
        groupId: range.groupId,
        groupName: range.groupName,
        color: range.color,
        taskColor: getTaskBgForGroupColor(range.color),
        startDay: range.startDay,
        endDay: range.endDay,
        row: summaryRow,
        taskCount: taskIds.size,
        completedCount: completedIds.size,
      });
      remappedRanges.push({ ...range, rowStart: summaryRow, rowEnd: summaryRow });
      continue;
    }

    const sourceRows = Array.from(new Set(groupSegments.map((segment) => segment.row))).sort((a, b) => a - b);
    const rowStart = nextRow;
    for (const sourceRow of sourceRows) rowMap.set(sourceRow, nextRow++);
    remappedRanges.push({ ...range, rowStart, rowEnd: nextRow - 1 });
  }

  const segments = monthLayout.segments
    .filter((segment) => !segment.groupId || !collapsedGroupIds.has(segment.groupId) || !rangeByGroup.has(segment.groupId))
    .map((segment) => ({ ...segment, row: rowMap.get(segment.row) ?? segment.row }));

  return {
    ...monthLayout,
    segments,
    groupRanges: remappedRanges,
    groupSummaries: summaries,
    totalRows: nextRow,
  };
}

interface TimelineViewProps {
  tasks: Task[];
  groups: TaskGroup[];
  notes: Note[];
  milestones: Milestone[];
  displayYear: number;
  onYearChange: (year: number) => void;
  onAddTask: () => void;
  onAddGroup: () => void;
  onAddNote: () => void;
  onAddMilestone: () => void;
  onOpenSync: () => void;
  onTaskClick?: (task: Task) => void;
  onTaskContextMenu?: (e: React.MouseEvent, taskId: string) => void;
  onNoteDoubleClick?: (note: Note) => void;
  onNoteContextMenu?: (e: React.MouseEvent, noteId: string) => void;
  onMilestoneDoubleClick?: (milestone: Milestone) => void;
  onMilestoneContextMenu?: (e: React.MouseEvent, milestoneId: string) => void;
  onGroupDoubleClick?: (group: TaskGroup) => void;
  onSmartBlockDrop?: (dragData: SmartBlockDragPayload, targetDate: string) => void;
}

const TimelineView: React.FC<TimelineViewProps> = ({
  tasks,
  groups,
  notes,
  milestones,
  displayYear,
  onYearChange,
  onAddTask,
  onAddGroup,
  onAddNote,
  onAddMilestone,
  onOpenSync,
  onTaskClick,
  onTaskContextMenu,
  onNoteDoubleClick,
  onNoteContextMenu,
  onMilestoneDoubleClick,
  onMilestoneContextMenu,
  onGroupDoubleClick,
  onSmartBlockDrop,
}) => {
  const [preferences, setPreferences] = useState<TimelinePreferences>(loadPreferences);
  const [query, setQuery] = useState('');
  const [projectQuery, setProjectQuery] = useState('');
  const [isProjectPanelOpen, setIsProjectPanelOpen] = useState(false);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isViewMenuOpen && !isMoreMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!viewMenuRef.current?.contains(target)) setIsViewMenuOpen(false);
      if (!moreMenuRef.current?.contains(target)) setIsMoreMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsViewMenuOpen(false);
        setIsMoreMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isMoreMenuOpen, isViewMenuOpen]);

  useEffect(() => {
    if (!isProjectPanelOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsProjectPanelOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isProjectPanelOpen]);

  const orderedGroupIds = useMemo(
    () => normalizeOrder(preferences.groupOrder, groups),
    [preferences.groupOrder, groups],
  );
  const orderedGroups = useMemo(() => {
    const byId = new Map(groups.map((group) => [group.id, group]));
    return orderedGroupIds.map((id) => byId.get(id)).filter((group): group is TaskGroup => !!group);
  }, [groups, orderedGroupIds]);
  const projectListGroups = useMemo(() => {
    const normalized = projectQuery.trim().toLocaleLowerCase();
    return normalized
      ? orderedGroups.filter((group) => group.name.toLocaleLowerCase().includes(normalized))
      : orderedGroups;
  }, [orderedGroups, projectQuery]);

  useEffect(() => {
    writeJsonStorage(PREFERENCES_KEY, { ...preferences, groupOrder: orderedGroupIds }, '时间线视图偏好');
  }, [preferences, orderedGroupIds]);

  const hiddenGroupIds = useMemo(() => new Set(preferences.hiddenGroupIds), [preferences.hiddenGroupIds]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const matchingGroupIds = useMemo(() => {
    if (!normalizedQuery) return null;
    return new Set(groups.filter((group) => {
      if (group.name.toLocaleLowerCase().includes(normalizedQuery)) return true;
      return tasks.some((task) => task.groupId === group.id && task.name.toLocaleLowerCase().includes(normalizedQuery));
    }).map((group) => group.id));
  }, [groups, tasks, normalizedQuery]);

  const filteredTasks = useMemo(() => tasks.filter((task) => {
    if (preferences.hideCompleted && task.completed) return false;
    if (task.groupId && hiddenGroupIds.has(task.groupId)) return false;
    if (!normalizedQuery) return true;
    if (task.groupId && matchingGroupIds?.has(task.groupId)) return true;
    return task.name.toLocaleLowerCase().includes(normalizedQuery);
  }), [tasks, preferences.hideCompleted, hiddenGroupIds, normalizedQuery, matchingGroupIds]);

  const filteredGroups = useMemo(() => orderedGroups.filter((group) => {
    if (hiddenGroupIds.has(group.id)) return false;
    if (matchingGroupIds && !matchingGroupIds.has(group.id)) return false;
    return true;
  }), [orderedGroups, hiddenGroupIds, matchingGroupIds]);

  const layout = useMemo(() => {
    const yearStart = makeLocalDayjs(`${displayYear}-01-01`);
    const yearEnd = makeLocalDayjs(`${displayYear}-12-31`);
    const yearTasks = filteredTasks.filter((task) => {
      const start = makeLocalDayjs(task.start);
      const end = makeLocalDayjs(task.end);
      return !end.isBefore(yearStart) && !start.isAfter(yearEnd);
    });
    return calculateLayout({ tasks: yearTasks, groups: [], notes: [], milestones: [] }, orderedGroupIds);
  }, [filteredTasks, displayYear, orderedGroupIds]);

  const groupColors = useMemo(
    () => new Map(groups.filter((group) => group.color).map((group) => [group.id, group.color!])),
    [groups],
  );
  const monthLayouts = useMemo(
    () => sliceTasksForYear(layout.tasks, displayYear, groupColors),
    [layout.tasks, displayYear, groupColors],
  );
  const noteSegmentsByMonth = useMemo(() => sliceNotesForYear(notes, displayYear), [notes, displayYear]);
  const milestonesByMonth = useMemo(() => mapMilestonesForYear(milestones, displayYear), [milestones, displayYear]);
  const groupRangesByMonth = useMemo(
    () => computeGroupRangesForYear(filteredGroups, layout.tasks, displayYear),
    [filteredGroups, layout.tasks, displayYear],
  );

  const effectiveCollapsedGroupIds = useMemo(() => {
    if (preferences.density === 'detailed') return new Set<string>();
    if (preferences.density === 'compact') {
      const expanded = new Set(preferences.compactExpandedGroupIds);
      return new Set(filteredGroups.map((group) => group.id).filter((id) => !expanded.has(id)));
    }
    return new Set(preferences.collapsedGroupIds);
  }, [preferences.density, preferences.collapsedGroupIds, preferences.compactExpandedGroupIds, filteredGroups]);

  const mergedMonthLayouts = useMemo(() => monthLayouts.map((monthLayout, index) => remapMonthLayout(
    {
      ...monthLayout,
      noteSegments: noteSegmentsByMonth[index] ?? [],
      milestones: milestonesByMonth[index] ?? [],
    },
    groupRangesByMonth[index] ?? [],
    effectiveCollapsedGroupIds,
  )), [monthLayouts, noteSegmentsByMonth, milestonesByMonth, groupRangesByMonth, effectiveCollapsedGroupIds]);

  const updatePreferences = useCallback((patch: Partial<TimelinePreferences>) => {
    setPreferences((current) => ({ ...current, ...patch }));
  }, []);

  const toggleGroupCollapsed = useCallback((groupId: string) => {
    setPreferences((current) => {
      if (current.density === 'detailed') {
        return { ...current, density: 'standard', collapsedGroupIds: [groupId] };
      }
      if (current.density === 'compact') {
        const expanded = new Set(current.compactExpandedGroupIds);
        if (expanded.has(groupId)) expanded.delete(groupId); else expanded.add(groupId);
        return { ...current, compactExpandedGroupIds: [...expanded] };
      }
      const collapsed = new Set(current.collapsedGroupIds);
      if (collapsed.has(groupId)) collapsed.delete(groupId); else collapsed.add(groupId);
      return { ...current, collapsedGroupIds: [...collapsed] };
    });
  }, []);

  const toggleGroupVisible = useCallback((groupId: string) => {
    setPreferences((current) => {
      const hidden = new Set(current.hiddenGroupIds);
      if (hidden.has(groupId)) hidden.delete(groupId); else hidden.add(groupId);
      return { ...current, hiddenGroupIds: [...hidden] };
    });
  }, []);

  const moveGroup = useCallback((groupId: string, direction: -1 | 1) => {
    const currentIndex = orderedGroupIds.indexOf(groupId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= orderedGroupIds.length) return;
    const next = [...orderedGroupIds];
    [next[currentIndex], next[targetIndex]] = [next[targetIndex], next[currentIndex]];
    updatePreferences({ groupOrder: next });
  }, [orderedGroupIds, updatePreferences]);

  const dropGroupBefore = useCallback((targetGroupId: string) => {
    if (!draggedGroupId || draggedGroupId === targetGroupId) return;
    const next = orderedGroupIds.filter((id) => id !== draggedGroupId);
    const targetIndex = next.indexOf(targetGroupId);
    next.splice(targetIndex < 0 ? next.length : targetIndex, 0, draggedGroupId);
    updatePreferences({ groupOrder: next });
    setDraggedGroupId(null);
  }, [draggedGroupId, orderedGroupIds, updatePreferences]);

  const handleSegmentClick = useCallback((taskId: string) => {
    const task = tasks.find((item) => item.id === taskId);
    if (task) onTaskClick?.(task);
  }, [tasks, onTaskClick]);
  const handleNoteDoubleClick = useCallback((noteId: string) => {
    const note = notes.find((item) => item.id === noteId);
    if (note) onNoteDoubleClick?.(note);
  }, [notes, onNoteDoubleClick]);
  const handleMilestoneDoubleClick = useCallback((milestoneId: string) => {
    const milestone = milestones.find((item) => item.id === milestoneId);
    if (milestone) onMilestoneDoubleClick?.(milestone);
  }, [milestones, onMilestoneDoubleClick]);
  const handleGroupDoubleClick = useCallback((groupId: string) => {
    const group = groups.find((item) => item.id === groupId);
    if (group) onGroupDoubleClick?.(group);
  }, [groups, onGroupDoubleClick]);

  const hasFilteredContent = layout.tasks.length > 0 || notes.length > 0 || milestones.length > 0;
  const activeFilterCount = preferences.hiddenGroupIds.length
    + (preferences.hideCompleted ? 1 : 0)
    + (normalizedQuery ? 1 : 0);

  const clearFilters = () => {
    setQuery('');
    updatePreferences({ hiddenGroupIds: [], hideCompleted: false });
  };

  const viewControl = (
    <div className="tl-workspace-menu-wrap" ref={viewMenuRef}>
      <button
        className={`tl-workspace-icon-btn ${isViewMenuOpen || activeFilterCount > 0 || preferences.density !== 'standard' ? 'tl-workspace-icon-btn--active' : ''}`}
        type="button"
        onClick={() => {
          setIsMoreMenuOpen(false);
          setIsViewMenuOpen((open) => !open);
        }}
        title="搜索与显示"
        aria-haspopup="dialog"
        aria-expanded={isViewMenuOpen}
      >
        <Settings2 size={18} />
        {activeFilterCount > 0 && <span className="tl-workspace-status-badge">{activeFilterCount}</span>}
      </button>
      {isViewMenuOpen && (
        <div className="tl-workspace-menu-panel tl-view-menu" role="dialog" aria-label="时间线视图设置">
          <div className="tl-view-menu-title">时间线视图</div>
          <div className="tl-density-switch" role="group" aria-label="显示密度">
            {(['compact', 'standard', 'detailed'] as const).map((density) => (
              <button
                key={density}
                className={`tl-density-btn ${preferences.density === density ? 'tl-density-btn--active' : ''}`}
                type="button"
                onClick={() => updatePreferences({ density })}
              >
                {{ compact: '紧凑', standard: '标准', detailed: '详细' }[density]}
              </button>
            ))}
          </div>

          <label className="tl-view-search">
            <Search size={15} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目或任务" />
            {query && <button type="button" onClick={() => setQuery('')} title="清除搜索"><X size={14} /></button>}
          </label>

          <label className="tl-view-check-row">
            <span>隐藏已完成</span>
            <input
              type="checkbox"
              checked={preferences.hideCompleted}
              onChange={(event) => updatePreferences({ hideCompleted: event.target.checked })}
            />
          </label>

          <div className="tl-view-command-row">
            <button
              type="button"
              onClick={() => updatePreferences({ density: 'standard', collapsedGroupIds: groups.map((group) => group.id) })}
            ><ChevronsDownUp size={15} />全部折叠</button>
            <button
              type="button"
              onClick={() => updatePreferences({ density: 'standard', collapsedGroupIds: [], compactExpandedGroupIds: [] })}
            ><ChevronsUpDown size={15} />全部展开</button>
          </div>

          <button
            className="tl-view-project-button"
            type="button"
            onClick={() => { setIsViewMenuOpen(false); setIsProjectPanelOpen(true); }}
          >
            <Settings2 size={15} />
            <span>项目显示与排序</span>
            <ChevronRight size={15} />
          </button>

        </div>
      )}
    </div>
  );

  const runMoreAction = (action: () => void) => {
    setIsMoreMenuOpen(false);
    action();
  };

  const workspaceHeader = (
    <header className="tl-workspace-bar">
      <div className="tl-workspace-heading">
        <CalendarDays size={17} aria-hidden="true" />
        <h1>项目规划</h1>
      </div>

      <div className="tl-workspace-actions">
        <div className="tl-workspace-year" aria-label="时间线年份">
          <button type="button" onClick={() => onYearChange(displayYear - 1)} title="上一年"><ChevronLeft size={16} /></button>
          <span>{displayYear}</span>
          <button type="button" onClick={() => onYearChange(displayYear + 1)} title="下一年"><ChevronRight size={16} /></button>
        </div>

        <button type="button" className="tl-workspace-primary-btn" onClick={onAddTask}>
          <Plus size={17} />
          <span>新建项目</span>
        </button>

        {viewControl}

        <SyncStatusIndicator />

        <div className="tl-workspace-menu-wrap" ref={moreMenuRef}>
          <button
            type="button"
            className={`tl-workspace-icon-btn ${isMoreMenuOpen ? 'tl-workspace-icon-btn--active' : ''}`}
            onClick={() => {
              setIsViewMenuOpen(false);
              setIsMoreMenuOpen((open) => !open);
            }}
            title="更多"
            aria-haspopup="menu"
            aria-expanded={isMoreMenuOpen}
          >
            <MoreHorizontal size={18} />
          </button>
          {isMoreMenuOpen && (
            <div className="tl-workspace-menu-panel tl-create-menu" role="menu">
              <button type="button" role="menuitem" onClick={() => runMoreAction(onAddGroup)}><FolderPlus size={16} /><span>新建项目分组</span></button>
              <button type="button" role="menuitem" onClick={() => runMoreAction(onAddNote)}><BookmarkPlus size={16} /><span>新建便签</span></button>
              <button type="button" role="menuitem" onClick={() => runMoreAction(onAddMilestone)}><Flag size={16} /><span>新建里程碑</span></button>
              <button type="button" role="menuitem" onClick={() => runMoreAction(onOpenSync)}><Cloud size={16} /><span>同步与备份</span></button>
            </div>
          )}
        </div>
      </div>
    </header>
  );

  const projectDrawer = isProjectPanelOpen ? createPortal(
    <div className="tl-project-drawer-overlay" onPointerDown={(event) => {
      if (event.target === event.currentTarget) setIsProjectPanelOpen(false);
    }}>
      <aside className="tl-project-drawer" role="dialog" aria-modal="true" aria-label="项目显示与排序">
        <div className="tl-project-drawer-header">
          <span>项目显示与排序</span>
          <button type="button" onClick={() => setIsProjectPanelOpen(false)} title="关闭"><X size={18} /></button>
        </div>
        <label className="tl-project-drawer-search">
          <Search size={15} />
          <input value={projectQuery} onChange={(event) => setProjectQuery(event.target.value)} placeholder="搜索项目" autoFocus />
          {projectQuery && <button type="button" onClick={() => setProjectQuery('')} title="清除"><X size={14} /></button>}
        </label>
        <div className="tl-project-list">
          {projectListGroups.map((group) => {
            const visible = !hiddenGroupIds.has(group.id);
            const orderIndex = orderedGroupIds.indexOf(group.id);
            return (
              <div
                key={group.id}
                className={`tl-project-item ${draggedGroupId === group.id ? 'tl-project-item--dragging' : ''}`}
                draggable
                onDragStart={() => setDraggedGroupId(group.id)}
                onDragEnd={() => setDraggedGroupId(null)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropGroupBefore(group.id)}
              >
                <GripVertical size={16} className="tl-project-grip" aria-label="拖动排序" />
                <button
                  className={`tl-project-visible ${visible ? 'tl-project-visible--active' : ''}`}
                  type="button"
                  onClick={() => toggleGroupVisible(group.id)}
                  title={visible ? '隐藏项目' : '显示项目'}
                >{visible && <Check size={12} />}</button>
                <span className="tl-project-color" style={{ backgroundColor: group.color || '#9CA3AF' }} />
                <span className="tl-project-name">{group.name}</span>
                <button type="button" onClick={() => moveGroup(group.id, -1)} disabled={orderIndex === 0} title="上移"><ChevronUp size={15} /></button>
                <button type="button" onClick={() => moveGroup(group.id, 1)} disabled={orderIndex === orderedGroupIds.length - 1} title="下移"><ChevronDown size={15} /></button>
              </div>
            );
          })}
          {projectListGroups.length === 0 && <div className="tl-project-list-empty">没有匹配的项目</div>}
        </div>
        <div className="tl-project-drawer-footer">
          <button type="button" onClick={() => updatePreferences({ hiddenGroupIds: [] })} disabled={preferences.hiddenGroupIds.length === 0}>显示全部</button>
          <button className="tl-project-drawer-done" type="button" onClick={() => setIsProjectPanelOpen(false)}>完成</button>
        </div>
      </aside>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`tl-year-stack tl-year-stack--${preferences.density}`}>
      {workspaceHeader}

      {activeFilterCount > 0 && (
        <div className="tl-filter-status">
          {preferences.hideCompleted && <span>隐藏已完成</span>}
          {preferences.hiddenGroupIds.length > 0 && <span>隐藏{preferences.hiddenGroupIds.length}个项目</span>}
          {normalizedQuery && <span>搜索“{query.trim()}”</span>}
          <button type="button" onClick={clearFilters}>清除</button>
        </div>
      )}

      {!hasFilteredContent ? (
        <div className="tl-empty tl-empty--filtered">
          <div className="tl-empty-text">没有符合当前筛选条件的内容</div>
          <button type="button" onClick={clearFilters}>
            清除筛选
          </button>
        </div>
      ) : (
        <div className="tl-year-card">
          {mergedMonthLayouts.map((monthLayout) => (
            <MonthRow
              key={monthLayout.month}
              monthLayout={monthLayout}
              year={displayYear}
              density={preferences.density}
              collapsedGroupIds={effectiveCollapsedGroupIds}
              onTaskClick={handleSegmentClick}
              onTaskContextMenu={onTaskContextMenu}
              onNoteDoubleClick={handleNoteDoubleClick}
              onNoteContextMenu={onNoteContextMenu}
              onMilestoneDoubleClick={handleMilestoneDoubleClick}
              onMilestoneContextMenu={onMilestoneContextMenu}
              onGroupClick={toggleGroupCollapsed}
              onGroupDoubleClick={handleGroupDoubleClick}
              onSmartBlockDrop={onSmartBlockDrop}
            />
          ))}
        </div>
      )}

      {projectDrawer}
    </div>
  );
};

export default React.memo(TimelineView);

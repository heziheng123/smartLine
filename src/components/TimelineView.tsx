// ============================================================
// Smart Timeline - 全年垂直堆叠日历视图
// ============================================================

import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  ChevronsDownUp,
  ChevronsUpDown,
  GripVertical,
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
import type { LifeArea } from '@/lifeMap/types';
import { LIFE_MAP_PLAN_GROUP_META } from '@/lifeMap/data';
import { filterProjectsByPlanningScope, type ProjectPlanningGroupId } from '@/lifeMap/projectPlanning';
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

interface TimelinePreferences {
  density: TimelineDensity;
  groupOrder: string[];
  collapsedGroupIds: string[];
  compactExpandedGroupIds: string[];
  hiddenGroupIds: string[];
  hideCompleted: boolean;
  planningGroupId: 'all' | ProjectPlanningGroupId;
  planningAreaId?: string;
}

const PREFERENCES_KEY = 'smart-timeline-view-preferences-v2';
const DEFAULT_PREFERENCES: TimelinePreferences = {
  density: 'standard',
  groupOrder: [],
  collapsedGroupIds: [],
  compactExpandedGroupIds: [],
  hiddenGroupIds: [],
  hideCompleted: false,
  planningGroupId: 'all',
  planningAreaId: undefined,
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
    planningGroupId: stored?.planningGroupId === 'learning'
      || stored?.planningGroupId === 'work'
      || stored?.planningGroupId === 'life'
      || stored?.planningGroupId === 'unclassified'
      ? stored.planningGroupId
      : 'all',
    planningAreaId: typeof stored?.planningAreaId === 'string' ? stored.planningAreaId : undefined,
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
  planningAreas?: LifeArea[];
  planningAreaReadOnly?: boolean;
  onBulkAssignPlanningArea?: (taskIds: string[], areaId: string) => void;
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
  planningAreas = [],
  planningAreaReadOnly = false,
  onBulkAssignPlanningArea,
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
  const [isBulkPlanningOpen, setIsBulkPlanningOpen] = useState(false);
  const [bulkPlanningAreaId, setBulkPlanningAreaId] = useState('');
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [dockPortalTarget, setDockPortalTarget] = useState<HTMLElement | null>(null);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setDockPortalTarget(document.getElementById('tl-dock-portal-target'));
  }, []);

  useEffect(() => {
    if (!isViewMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!viewMenuRef.current?.contains(event.target as Node)) setIsViewMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsViewMenuOpen(false);
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isViewMenuOpen]);

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

  const planningScopedTasks = useMemo(() => filterProjectsByPlanningScope(tasks, planningAreas, {
    groupId: preferences.planningGroupId,
    areaId: preferences.planningAreaId,
  }), [planningAreas, preferences.planningAreaId, preferences.planningGroupId, tasks]);
  const unclassifiedTasks = useMemo(
    () => filterProjectsByPlanningScope(tasks, planningAreas, { groupId: 'unclassified' }),
    [planningAreas, tasks],
  );

  const filteredTasks = useMemo(() => planningScopedTasks.filter((task) => {
    if (preferences.hideCompleted && task.completed) return false;
    if (task.groupId && hiddenGroupIds.has(task.groupId)) return false;
    if (!normalizedQuery) return true;
    if (task.groupId && matchingGroupIds?.has(task.groupId)) return true;
    return task.name.toLocaleLowerCase().includes(normalizedQuery);
  }), [planningScopedTasks, preferences.hideCompleted, hiddenGroupIds, normalizedQuery, matchingGroupIds]);

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
    + (normalizedQuery ? 1 : 0)
    + (preferences.planningGroupId !== 'all' || preferences.planningAreaId ? 1 : 0);

  const clearFilters = () => {
    setQuery('');
    updatePreferences({ hiddenGroupIds: [], hideCompleted: false, planningGroupId: 'all', planningAreaId: undefined });
  };

  const dockViewControl = dockPortalTarget ? createPortal(
    <div className="tl-dock-popover-wrap" ref={viewMenuRef}>
      <button
        className={`tl-dock-btn ${isViewMenuOpen || activeFilterCount > 0 || preferences.density !== 'standard' ? 'tl-dock-btn--view-active' : ''}`}
        type="button"
        onClick={() => setIsViewMenuOpen((open) => !open)}
        title="时间线视图"
        aria-haspopup="dialog"
        aria-expanded={isViewMenuOpen}
      >
        <Settings2 size={18} />
        {activeFilterCount > 0 && <span className="tl-dock-status-badge">{activeFilterCount}</span>}
      </button>
      {isViewMenuOpen && (
        <div className="tl-dock-popover tl-view-menu" role="dialog" aria-label="时间线视图设置">
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
    </div>,
    dockPortalTarget,
  ) : null;

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

  const bulkPlanningDialog = isBulkPlanningOpen ? createPortal(
    <div className="tl-project-drawer-overlay" onPointerDown={(event) => {
      if (event.target === event.currentTarget) setIsBulkPlanningOpen(false);
    }}>
      <aside className="tl-bulk-planning-dialog" role="dialog" aria-modal="true" aria-label="批量归类未分类项目">
        <div className="tl-project-drawer-header">
          <span>批量归类未分类项目</span>
          <button type="button" onClick={() => setIsBulkPlanningOpen(false)} title="关闭"><X size={18} /></button>
        </div>
        <p>下列 {unclassifiedTasks.length} 个项目还没有人生领域。一次归类后，人生地图和所有项目视图会同步更新。</p>
        <div className="tl-bulk-planning-projects">
          {unclassifiedTasks.map((task) => <span key={task.id}>{task.name}</span>)}
        </div>
        <label>
          <span>归入领域</span>
          <select
            aria-label="批量归类到领域"
            value={bulkPlanningAreaId}
            onChange={(event) => setBulkPlanningAreaId(event.target.value)}
          >
            <option value="">请选择领域</option>
            {planningAreas.filter((area) => !area.deletedAt && !area.isHidden).map((area) => (
              <option key={area.id} value={area.id}>{LIFE_MAP_PLAN_GROUP_META[area.planGroupId].name} · {area.name}</option>
            ))}
          </select>
        </label>
        <div className="tl-project-drawer-footer">
          <button type="button" onClick={() => setIsBulkPlanningOpen(false)}>取消</button>
          <button
            className="tl-project-drawer-done"
            type="button"
            disabled={!bulkPlanningAreaId || unclassifiedTasks.length === 0}
            onClick={() => {
              onBulkAssignPlanningArea?.(unclassifiedTasks.map((task) => task.id), bulkPlanningAreaId);
              setIsBulkPlanningOpen(false);
              setBulkPlanningAreaId('');
            }}
          >
            归类 {unclassifiedTasks.length} 个项目
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  ) : null;

  return (
    <div className={`tl-year-stack tl-year-stack--${preferences.density}`}>
      {dockViewControl}

      <div className="tl-planning-scope" role="group" aria-label="项目查看范围">
        {(['all', 'learning', 'work', 'life', 'unclassified'] as const).map((groupId) => (
          <button
            type="button"
            key={groupId}
            aria-pressed={preferences.planningGroupId === groupId && !preferences.planningAreaId}
            className={preferences.planningGroupId === groupId && !preferences.planningAreaId ? 'is-active' : ''}
            onClick={() => updatePreferences({ planningGroupId: groupId, planningAreaId: undefined })}
          >
            {groupId === 'all' ? '全部' : groupId === 'unclassified' ? '未分类' : LIFE_MAP_PLAN_GROUP_META[groupId].name}
          </button>
        ))}
        <select
          aria-label="二级领域"
          value={preferences.planningAreaId ?? ''}
          onChange={(event) => {
            const areaId = event.target.value || undefined;
            const area = planningAreas.find((item) => item.id === areaId);
            updatePreferences({ planningAreaId: areaId, planningGroupId: area?.planGroupId ?? 'all' });
          }}
        >
          <option value="">选择二级领域</option>
          {planningAreas.filter((area) => !area.deletedAt && !area.isHidden).map((area) => (
            <option key={area.id} value={area.id}>{LIFE_MAP_PLAN_GROUP_META[area.planGroupId].name} · {area.name}</option>
          ))}
        </select>
        {unclassifiedTasks.length > 0 && planningAreas.some((area) => !area.deletedAt && !area.isHidden) && (
          <button
            type="button"
            className="is-bulk"
            disabled={planningAreaReadOnly}
            title={planningAreaReadOnly ? '请先迁移到统一工作区，以避免旧版本设备覆盖项目分类' : undefined}
            onClick={() => setIsBulkPlanningOpen(true)}
          >批量归类</button>
        )}
      </div>

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
      {bulkPlanningDialog}
    </div>
  );
};

export default React.memo(TimelineView);

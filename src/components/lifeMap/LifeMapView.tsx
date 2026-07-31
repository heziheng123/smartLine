import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import { BookOpenCheck, CalendarRange, Check, ChevronDown, Diamond, Eye, EyeOff, Focus, Highlighter, Layers3, LocateFixed, MousePointer2, Pencil, Plus, Redo2, Repeat2, Search, Sparkles, StickyNote, Target, Trash2, Undo2, X } from 'lucide-react';
import type { LifeStage, Milestone, Note, Task, TaskGroup } from '@/types';
import { getSmartTaskBlocks } from '@/utils/blocks';
import { isValidCalendarDate } from '@/utils/dateSafe';
import { getTaskBorderColor, getTaskTextColor, resolveTaskTheme } from '@/utils/timeline-utils';
import '@/styles/life-map.css';

interface LifeMapViewProps {
  tasks: Task[];
  groups: TaskGroup[];
  notes: Note[];
  milestones: Milestone[];
  lifeStages: LifeStage[];
  onCreateLifeStage: (stage: LifeStage) => void;
  onUpdateLifeStage: (stage: LifeStage) => void;
  onDeleteLifeStage: (stageId: string) => void;
  onOpenTask: (taskId: string, blockId?: string) => void;
  onCreateNote: (note: Note) => void;
  onUpdateNote: (note: Note) => void;
  onDeleteNote: (noteId: string) => void;
  onCreateMilestone: (milestone: Milestone) => void;
  onUpdateMilestone: (milestone: Milestone) => void;
  onDeleteMilestone: (milestoneId: string) => void;
  onUpdateProjectPlacement?: (taskId: string, placement: ProjectSide) => void;
  toolbarScope?: React.ReactNode;
  onCreateGoal?: () => void;
  onCreateSystem?: () => void;
  onCreateTheme?: () => void;
  onCreateArea?: () => void;
  onCreateReview?: () => void;
  annotationAreaRequired?: boolean;
  onRequireAnnotationArea?: () => void;
}

type ZoomLevel = 'year' | 'month' | 'week' | 'day';
type NodeSide = 'top' | 'bottom';
type NodeKind = 'action' | 'deadline' | 'milestone' | 'note';
type CanvasTool = 'select' | 'range' | 'note' | 'milestone';
type FocusMode = 'off' | 'week' | 'month';
type ProjectSide = 'above' | 'below';
type ProjectRank = 'core' | 'support' | 'routine' | 'paused';
type MilestoneImportance = NonNullable<Milestone['importance']>;

interface LayerState {
  projects: boolean;
  annotations: boolean;
  milestones: boolean;
  notes: boolean;
  tasks: boolean;
  completed: boolean;
}

interface Tick {
  date: Dayjs;
  label: string;
  sublabel?: string;
  major: boolean;
}

interface LineNode {
  id: string;
  kind: NodeKind;
  title: string;
  subtitle: string;
  date: Dayjs;
  color: string;
  taskId?: string;
  projectTitle?: string;
  blockId?: string;
  noteId?: string;
  milestoneId?: string;
  placement?: 'above' | 'below';
  completed?: boolean;
  duration?: number;
  isReview?: boolean;
  importance?: MilestoneImportance;
  layoutLane?: number;
}

interface RangeSegment {
  id: string;
  title: string;
  start: Dayjs;
  end: Dayjs;
  color: string;
  kind: 'project' | 'note';
  progress: number;
  groupName?: string;
  groupId?: string;
  taskId?: string;
  rank?: ProjectRank;
  noteId?: string;
  placement?: 'above' | 'below';
  lifeMapKind?: Task['lifeMapKind'];
  meta?: string;
  openEnded?: boolean;
  preferredSide?: ProjectSide;
  placementIsManual?: boolean;
  annotationKind?: 'theme' | 'focus';
  layoutLane?: number;
}

interface PositionedProjectBand extends RangeSegment {
  left: number;
  width: number;
  level: number;
  side: ProjectSide;
}

interface PositionedNode extends LineNode {
  anchorX: number;
  x: number;
  y: number;
  width: number;
  side: NodeSide;
  lane: number;
  layoutSource: 'manual' | 'auto';
}

type NodePlacement = Omit<PositionedNode, 'y'>;

interface PositionedAnnotation extends RangeSegment {
  left: number;
  width: number;
  anchorX: number;
  cardX: number;
  cardWidth: number;
  level: number;
  markLevel: number;
  cardHeight: number;
  laneOffset: number;
  compactSummary: boolean;
}

interface CanvasDraft {
  kind: 'range' | 'note' | 'milestone';
  id?: string;
  name: string;
  start: string;
  end?: string;
  color: string;
  x: number;
  placement: 'above' | 'below';
  importance?: MilestoneImportance;
}

interface TaskMarkerCluster {
  key: string;
  date: Dayjs;
  nodes: LineNode[];
  color: string;
  label: string;
  aggregate: boolean;
  minutes: number;
}

interface StageBand {
  id: string;
  title: string;
  color: string;
  start: Dayjs;
  end: Dayjs;
  left: number;
  width: number;
  level: number;
}

interface GoalLink {
  id: string;
  from: PositionedProjectBand;
  to: PositionedProjectBand;
}

interface HistoryAction {
  label: string;
  undo: () => void;
  redo: () => void;
}

interface DirectDrag {
  kind: 'note-card' | 'milestone-card' | 'range-start' | 'range-end';
  id: string;
  startClientX: number;
  startClientY: number;
  currentClientX: number;
  currentClientY: number;
  startSide?: NodeSide;
  startLane?: number;
}

interface MilestoneLeaderGroup {
  key: string;
  date: Dayjs;
  side: NodeSide;
  anchorX: number;
  color: string;
  importance: MilestoneImportance;
  nodes: PositionedNode[];
}

const ZOOM_LEVELS: ZoomLevel[] = ['year', 'month', 'week', 'day'];
const ZOOM_META: Record<ZoomLevel, { label: string; pixelsPerDay: number }> = {
  year: { label: '年', pixelsPerDay: 0.66 },
  month: { label: '月', pixelsPerDay: 4.8 },
  week: { label: '周', pixelsPerDay: 17 },
  day: { label: '日', pixelsPerDay: 46 },
};
const ZOOM_HINTS: Record<ZoomLevel, string> = {
  year: '全局规划',
  month: '目标与节点',
  week: '重点与节奏',
  day: '当天记录',
};
const NODE_GAP_Y = 54;
const PROJECT_LANE_GAP = 30;
const PROJECT_ABOVE_OFFSET = 30;
const PROJECT_BELOW_OFFSET = 72;
const STAGE_RAIL_BASE_HEIGHT = 38;
const STAGE_RAIL_BAND_TOP = 10;
const STAGE_RAIL_LANE_GAP = 24;
const STAGE_CONTENT_GAP = 12;
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const WEEKLY_FOCUS_COLOR = '#6D63E8';
const MILESTONE_COLOR = '#E58A2B';
const NOTE_COLOR = '#64748B';

function clampCardCenterToViewport(
  anchorX: number,
  width: number,
  canvasWidth: number,
  viewport: { scrollLeft: number; width: number },
): number {
  const canvasMin = width / 2 + 4;
  const canvasMax = canvasWidth - width / 2 - 4;
  if (viewport.width <= width + 24) return Math.max(canvasMin, Math.min(canvasMax, anchorX));

  const viewportMin = Math.max(canvasMin, viewport.scrollLeft + width / 2 + 10);
  const viewportMax = Math.min(canvasMax, viewport.scrollLeft + viewport.width - width / 2 - 10);
  const anchorIsNearViewport = anchorX >= viewport.scrollLeft - width / 2
    && anchorX <= viewport.scrollLeft + viewport.width + width / 2;
  if (!anchorIsNearViewport || viewportMin > viewportMax) return Math.max(canvasMin, Math.min(canvasMax, anchorX));
  return Math.max(viewportMin, Math.min(viewportMax, anchorX));
}

function milestoneCountdown(date: Dayjs, today: Dayjs): string {
  const days = date.startOf('day').diff(today, 'day');
  if (days === 0) return '就是今天';
  if (days > 0) return `还有 ${days} 天`;
  return `已过去 ${Math.abs(days)} 天`;
}

const validDate = (value?: string): value is string => Boolean(value && isValidCalendarDate(value));

function mondayOf(date: Dayjs): Dayjs {
  const weekday = date.day();
  return date.subtract(weekday === 0 ? 6 : weekday - 1, 'day').startOf('day');
}

function midpoint(start: Dayjs, end: Dayjs): Dayjs {
  return start.add(end.diff(start, 'day', true) / 2, 'day');
}

function buildTicks(start: Dayjs, end: Dayjs, zoom: ZoomLevel): Tick[] {
  const result: Tick[] = [];
  if (zoom === 'day') {
    let cursor = start.startOf('day');
    while (!cursor.isAfter(end, 'day')) {
      result.push({ date: cursor, label: cursor.format('D'), sublabel: `周${WEEKDAYS[cursor.day()]}`, major: cursor.date() === 1 });
      cursor = cursor.add(1, 'day');
    }
    return result;
  }
  if (zoom === 'week') {
    let cursor = mondayOf(start);
    while (!cursor.isAfter(end, 'day')) {
      result.push({ date: cursor, label: cursor.format('M月D日'), sublabel: cursor.date() <= 7 ? cursor.format('YYYY年M月') : '周一', major: cursor.date() <= 7 });
      cursor = cursor.add(7, 'day');
    }
    return result;
  }
  if (zoom === 'month') {
    let cursor = start.startOf('month');
    while (!cursor.isAfter(end, 'month')) {
      result.push({ date: cursor, label: cursor.format('M月'), sublabel: cursor.month() === 0 ? cursor.format('YYYY年') : undefined, major: cursor.month() === 0 });
      cursor = cursor.add(1, 'month');
    }
    return result;
  }
  let cursor = start.startOf('year');
  while (!cursor.isAfter(end, 'year')) {
    result.push({ date: cursor, label: cursor.format('YYYY年'), major: true });
    cursor = cursor.add(1, 'year');
  }
  return result;
}

function shouldShowNodeCard(node: LineNode, zoom: ZoomLevel): boolean {
  if (node.kind === 'milestone') {
    const importance = node.importance ?? 'important';
    if (zoom === 'year') return importance === 'core';
    if (zoom === 'month') return importance !== 'normal';
    return true;
  }
  if (node.kind === 'note') return zoom !== 'year';
  return zoom === 'week' || zoom === 'day';
}

function getNodeCardHeight(node: LineNode, zoom: ZoomLevel): number {
  if (node.kind !== 'milestone') return zoom === 'week' || zoom === 'day' ? 34 : 28;
  const importance = node.importance ?? 'important';
  const detailed = zoom === 'week' || zoom === 'day' || importance === 'core';
  if (importance === 'core') return 54;
  if (importance === 'normal') return detailed ? 40 : 32;
  return detailed ? 48 : 36;
}

function getAnnotationCardMetrics(title: string, expanded: boolean) {
  const lines = title.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines[0] || '每周重点';
  const items = lines.slice(1);
  const visibleItems = expanded ? items : [];
  return {
    heading,
    items,
    visibleItems,
    canExpand: items.length > 0,
    hiddenCount: items.length,
    height: expanded ? Math.min(184, 48 + items.length * 15 + 20) : 40,
  };
}

function getTaskProgress(task: Task): number {
  const blocks = getSmartTaskBlocks(task.blocks ?? []).filter((block) => !block.header.isArchived);
  if (blocks.length === 0) return task.completed ? 1 : 0;
  return blocks.filter((block) => block.header.isCompleted).length / blocks.length;
}

function chineseNumber(value: string): number | null {
  const digits: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  if (value === '十') return 10;
  if (value.startsWith('十')) return 10 + (digits[value[1]] ?? 0);
  if (value.endsWith('十')) return (digits[value[0]] ?? 0) * 10;
  if (value.includes('十')) return (digits[value[0]] ?? 0) * 10 + (digits[value[2]] ?? 0);
  return digits[value] ?? null;
}

function normalizeNaturalDates(value: string): string {
  return value.replace(/([一二三四五六七八九十]{1,3})月份?/g, (match, number: string) => {
    const parsed = chineseNumber(number);
    return parsed ? `${parsed}月` : match;
  });
}

function parseNaturalPlan(value: string, reference: Dayjs): Omit<CanvasDraft, 'x'> | null {
  const text = normalizeNaturalDates(value.trim());
  if (!text) return null;
  const year = reference.year();
  let start: Dayjs | null = null;
  let end: Dayjs | null = null;

  if (text.includes('下周')) {
    start = mondayOf(reference).add(7, 'day');
    end = start.add(6, 'day');
  } else if (text.includes('本周') || text.includes('这周')) {
    start = mondayOf(reference);
    end = start.add(6, 'day');
  } else if (text.includes('本月') || text.includes('这个月')) {
    start = reference.startOf('month');
    end = reference.endOf('month');
  } else {
    const matches = [...text.matchAll(/(?:(\d{4})年)?(\d{1,2})月(?:(\d{1,2})[日号])?/g)];
    if (matches.length > 0) {
      const dates = matches.map((match) => {
        const matchedYear = Number(match[1] ?? year);
        const month = Number(match[2]);
        const day = match[3] ? Number(match[3]) : 1;
        const isoDate = `${matchedYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        return { date: dayjs(isoDate), isoDate, monthOnly: !match[3] };
      }).filter((item) => validDate(item.isoDate));
      if (dates.length === 0) return null;
      if (dates.length > 0) {
        start = dates[0].date;
        end = dates.length > 1 ? dates[1].date : dates[0].monthOnly ? dates[0].date.endOf('month') : null;
      }
    }
  }

  start ??= reference.startOf('day');
  if (end?.isBefore(start, 'day')) return null;
  const isRange = Boolean(end && !end.isSame(start, 'day')) || /重点|阶段|计划|完成|学习|复习|概述/.test(text);
  const isMilestone = !isRange && /关键|成绩|结果|考试|截止|发布|上线|纪念|生日/.test(text);
  const cleanedName = text.replace(/(?:(?:\d{4})年)?\d{1,2}月(?:\d{1,2}[日号])?/g, '').replace(/本周|这周|下周|本月|这个月/g, '').replace(/^[，,：:\s]+|[，,：:\s]+$/g, '') || text;
  return {
    kind: isMilestone ? 'milestone' : isRange ? 'range' : 'note',
    name: cleanedName,
    start: start.format('YYYY-MM-DD'),
    end: isRange ? (end ?? start.add(6, 'day')).format('YYYY-MM-DD') : undefined,
      color: isMilestone ? '#EF8354' : isRange ? '#7C6FE6' : '#F59E0B',
    placement: isMilestone ? 'below' : 'above',
  };
}

const LifeMapView: React.FC<LifeMapViewProps> = ({
  tasks,
  groups,
  notes,
  milestones,
  lifeStages,
  onCreateLifeStage,
  onUpdateLifeStage,
  onDeleteLifeStage,
  onOpenTask,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onCreateMilestone,
  onUpdateMilestone,
  onDeleteMilestone,
  onUpdateProjectPlacement,
  toolbarScope,
  onCreateGoal,
  onCreateSystem,
  onCreateTheme,
  onCreateArea,
  onCreateReview,
  annotationAreaRequired = false,
  onRequireAnnotationArea,
}) => {
  const today = useMemo(() => dayjs().startOf('day'), []);
  const mainRef = useRef<HTMLElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const projectLabelMetricsRef = useRef<Array<{ label: HTMLElement; left: number; width: number }>>([]);
  const pendingFocusRef = useRef<Dayjs | null>(today);
  const pendingZoomAnchorRef = useRef<{ date: Dayjs; viewportX: number } | null>(null);
  const scrollFrameRef = useRef<number | null>(null);
  const scrollIdleTimerRef = useRef<number | null>(null);
  const zoomAnimationTimerRef = useRef<number | null>(null);
  const lastWheelZoomAtRef = useRef(0);
  const minimapWindowRef = useRef<HTMLSpanElement>(null);
  const [zoom, setZoom] = useState<ZoomLevel>('month');
  const [centerDate, setCenterDate] = useState(today);
  const [canvasTool, setCanvasTool] = useState<CanvasTool>('select');
  const [dragSelection, setDragSelection] = useState<{ startX: number; currentX: number } | null>(null);
  const [draft, setDraft] = useState<CanvasDraft | null>(null);
  const [stageDraft, setStageDraft] = useState<LifeStage | null>(null);
  const [layers, setLayers] = useState<LayerState>({ projects: true, annotations: true, milestones: true, notes: true, tasks: true, completed: true });
  const [showAddMenu, setShowAddMenu] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [showJumpMenu, setShowJumpMenu] = useState(false);
  const [showScaleMenu, setShowScaleMenu] = useState(false);
  const [jumpQuery, setJumpQuery] = useState('');
  const [showMinimap, setShowMinimap] = useState(false);
  const [focusMode, setFocusMode] = useState<FocusMode>('off');
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [hoveredProjectId, setHoveredProjectId] = useState<string | null>(null);
  const [viewport, setViewport] = useState({ scrollLeft: 0, width: 1 });
  const [canvasViewportHeight, setCanvasViewportHeight] = useState(560);
  const [quickInput, setQuickInput] = useState('');
  const [quickInputError, setQuickInputError] = useState('');
  const [selectedTaskDate, setSelectedTaskDate] = useState<string | null>(null);
  const [expandedAnnotationId, setExpandedAnnotationId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryAction[]>([]);
  const [redoHistory, setRedoHistory] = useState<HistoryAction[]>([]);
  const [directDrag, setDirectDrag] = useState<DirectDrag | null>(null);
  const [minimapDragging, setMinimapDragging] = useState(false);
  const suppressClickRef = useRef(false);

  const setProjectSide = useCallback((taskId: string, side: ProjectSide) => {
    onUpdateProjectPlacement?.(taskId, side);
  }, [onUpdateProjectPlacement]);

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, {
    name: group.name,
    color: group.color,
  }])), [groups]);

  const { nodes, ranges } = useMemo(() => {
    const nextNodes: LineNode[] = [];
    const nextRanges: RangeSegment[] = [];

    tasks.forEach((task) => {
      if (!validDate(task.start) || !validDate(task.end)) return;
      const start = dayjs(task.start);
      const end = dayjs(task.end);
      const group = groupById.get(task.groupId ?? '');
      const color = resolveTaskTheme(task, group?.color).backgroundColor;
      const rank = task.lifeMapKind
        ? task.isMain ? 'core' : task.lifeMapKind === 'goal' ? 'support' : task.lifeMapKind === 'review' ? 'paused' : 'routine'
        : task.isMain ? 'core' : task.groupId ? 'support' : 'routine';
      nextRanges.push({
        id: `range:${task.id}`,
        title: task.name,
        start,
        end,
        color,
        kind: 'project',
        progress: task.lifeMapProgress === undefined ? getTaskProgress(task) : task.lifeMapProgress / 100,
        groupName: group?.name ?? '未分组计划',
        groupId: task.groupId,
        taskId: task.id,
        rank,
        lifeMapKind: task.lifeMapKind,
        meta: task.lifeMapMeta,
        openEnded: task.lifeMapOpenEnded,
        preferredSide: task.lifeMapPlacement ?? (task.lifeMapKind === 'goal' ? 'above' : task.lifeMapKind === 'system' ? 'below' : undefined),
        placementIsManual: task.lifeMapPlacement !== undefined,
      });

      getSmartTaskBlocks(task.blocks ?? []).filter((block) => !block.header.isArchived).forEach((block) => {
        const actionDate = block.header.date ?? block.header.deadline;
        if (validDate(actionDate)) {
          nextNodes.push({
            id: `action:${task.id}:${block.id}`,
            kind: 'action',
            title: block.header.title,
            subtitle: `${task.name} · ${actionDate}`,
            date: dayjs(actionDate),
            color: block.header.tagColor || color,
            taskId: task.id,
            projectTitle: task.name,
            blockId: block.id,
            completed: block.header.isCompleted,
            duration: block.header.duration,
          });
        }
        if (validDate(block.header.deadline) && block.header.deadline !== actionDate) {
          nextNodes.push({
            id: `deadline:${task.id}:${block.id}`,
            kind: 'deadline',
            title: `${block.header.title} · 截止`,
            subtitle: `${task.name} · ${block.header.deadline}`,
            date: dayjs(block.header.deadline),
      color: '#C97373',
            taskId: task.id,
            projectTitle: task.name,
            blockId: block.id,
            completed: block.header.isCompleted,
            duration: block.header.duration,
          });
        }
      });
    });

    milestones.filter((item) => validDate(item.date)).forEach((item) => nextNodes.push({
      id: `milestone:${item.id}`, kind: 'milestone', title: item.name, subtitle: `${item.date} · ${milestoneCountdown(dayjs(item.date), today)}`,
        date: dayjs(item.date), color: MILESTONE_COLOR, milestoneId: item.id, placement: item.placement ?? 'below', importance: item.importance ?? 'important', layoutLane: item.layoutLane,
    }));

    notes.filter((item) => validDate(item.date)).forEach((item) => {
      const start = dayjs(item.date);
      const end = validDate(item.endDate) ? dayjs(item.endDate) : start;
      if (item.type === 'range' && validDate(item.endDate)) {
        nextRanges.push({ id: `note-range:${item.id}`, noteId: item.id, title: item.name, start, end, color: item.color ?? WEEKLY_FOCUS_COLOR, kind: 'note', progress: 0, placement: item.placement ?? 'above', annotationKind: item.id.startsWith('theme:') ? 'theme' : 'focus', layoutLane: item.layoutLane });
      } else {
        const isReview = /^复盘[：:·\s]/.test(item.name);
        nextNodes.push({
          id: `note:${item.id}`, kind: 'note', title: item.name,
          subtitle: `${isReview ? '规划复盘' : '文字便签'} · ${item.date}`,
          date: start,
          color: NOTE_COLOR,
          noteId: item.id,
          placement: item.placement ?? 'above',
          layoutLane: item.layoutLane,
          isReview,
        });
      }
    });

    return { nodes: nextNodes.sort((left, right) => left.date.valueOf() - right.date.valueOf()), ranges: nextRanges };
  }, [groupById, milestones, notes, tasks, today]);

  const bounds = useMemo(() => {
    const dates = [
      today,
      ...nodes.map((node) => node.date),
      ...ranges.flatMap((range) => [range.start, range.end]),
      ...lifeStages.filter((stage) => validDate(stage.start) && validDate(stage.end)).flatMap((stage) => [dayjs(stage.start), dayjs(stage.end)]),
    ];
    const values = dates.map((date) => date.valueOf());
    return {
      start: dayjs(Math.min(...values)).subtract(1, 'year').startOf('year'),
      end: dayjs(Math.max(...values)).add(2, 'year').endOf('year'),
    };
  }, [lifeStages, nodes, ranges, today]);

  const pixelsPerDay = ZOOM_META[zoom].pixelsPerDay;
  const totalDays = bounds.end.diff(bounds.start, 'day') + 1;
  const canvasWidth = Math.max(1200, Math.ceil(totalDays * pixelsPerDay));
  const ticks = useMemo(() => buildTicks(bounds.start, bounds.end, zoom), [bounds.end, bounds.start, zoom]);

  const dateToX = useCallback((date: Dayjs) => (
    Math.max(0, Math.min(canvasWidth, date.diff(bounds.start, 'day', true) * pixelsPerDay))
  ), [bounds.start, canvasWidth, pixelsPerDay]);

  const xToDate = useCallback((x: number) => (
    bounds.start.add(Math.max(0, Math.min(canvasWidth, x)) / pixelsPerDay, 'day').startOf('day')
  ), [bounds.start, canvasWidth, pixelsPerDay]);

  const renderedTicks = useMemo(() => {
    if (zoom !== 'day') return ticks;
    const centerX = Math.max(0, Math.min(canvasWidth, centerDate.diff(bounds.start, 'day', true) * pixelsPerDay));
    const halfWindow = Math.max(1600, viewport.width * 3);
    return ticks.filter((tick) => {
      const x = tick.date.diff(bounds.start, 'day', true) * pixelsPerDay;
      return x >= centerX - halfWindow && x <= centerX + halfWindow;
    });
  }, [bounds.start, canvasWidth, centerDate, pixelsPerDay, ticks, viewport.width, zoom]);

  const stageBands = useMemo<StageBand[]>(() => {
    const levelRightEdges: number[] = [];
    return lifeStages
      .filter((stage) => validDate(stage.start) && validDate(stage.end))
      .map((stage) => {
        const start = dayjs(stage.start);
        const end = dayjs(stage.end);
        return {
          stage,
          start,
          end,
          left: dateToX(start),
          width: Math.max(20, dateToX(end.add(1, 'day')) - dateToX(start)),
        };
      })
      .sort((left, right) => left.start.valueOf() - right.start.valueOf())
      .map(({ stage, start, end, left, width }) => {
        const right = left + width;
        let level = levelRightEdges.findIndex((rightEdge) => rightEdge <= left + 0.5);
        if (level === -1) {
          level = levelRightEdges.length;
          levelRightEdges.push(right);
        } else {
          levelRightEdges[level] = right;
        }
        return { id: stage.id, title: stage.name, color: stage.color ?? '#818CF8', start, end, left, width, level };
      });
  }, [dateToX, lifeStages]);
  const stageLaneCount = stageBands.reduce((count, stage) => Math.max(count, stage.level + 1), 0);
  const stageRailHeight = stageLaneCount > 0
    ? Math.max(STAGE_RAIL_BASE_HEIGHT, STAGE_RAIL_BAND_TOP + stageLaneCount * STAGE_RAIL_LANE_GAP + 4)
    : 0;

  const projectBands = useMemo<PositionedProjectBand[]>(() => {
    const levelRightEdges: Record<ProjectSide, number[]> = { above: [], below: [] };
    return ranges
      .filter((range) => range.kind === 'project')
      .sort((left, right) => left.start.valueOf() - right.start.valueOf() || right.end.valueOf() - left.end.valueOf() || left.id.localeCompare(right.id))
      .map((range) => {
        const left = dateToX(range.start);
        const width = Math.max(6, dateToX(range.end.add(1, 'day')) - left);
        const right = left + width;
        const preferredSide = range.preferredSide;
        const nextLevel = (side: ProjectSide) => {
          const availableLevel = levelRightEdges[side].findIndex((rightEdge) => rightEdge <= left + 0.5);
          return availableLevel === -1 ? levelRightEdges[side].length : availableLevel;
        };
        const side = preferredSide ?? (nextLevel('above') <= nextLevel('below') ? 'above' : 'below');
        const sideLevels = levelRightEdges[side];
        // The lane represents real time overlap only. Consecutive projects share
        // one lane, even when their labels would have been close together.
        let level = sideLevels.findIndex((rightEdge) => rightEdge <= left + 0.5);
        if (level === -1) {
          level = sideLevels.length;
          sideLevels.push(right);
        } else {
          sideLevels[level] = right;
        }
        return { ...range, left, width, level, side };
      });
  }, [dateToX, ranges]);

  const goalLinks = useMemo<GoalLink[]>(() => {
    const byGroup = new Map<string, PositionedProjectBand[]>();
    projectBands.forEach((band) => {
      if (!band.groupId) return;
      const groupBands = byGroup.get(band.groupId) ?? [];
      groupBands.push(band);
      byGroup.set(band.groupId, groupBands);
    });
    return [...byGroup.entries()].flatMap(([groupId, groupBands]) => {
      const sorted = [...groupBands].sort((left, right) => left.start.valueOf() - right.start.valueOf());
      return sorted.flatMap((from, index) => {
        const to = sorted.slice(index + 1).find((candidate) => candidate.start.isAfter(from.end, 'day'));
        return to ? [{ id: `${groupId}:${from.id}:${to.id}`, from, to }] : [];
      });
    });
  }, [projectBands]);

  const annotations = useMemo<PositionedAnnotation[]>(() => {
    const cardRows: Record<'above' | 'below', Array<Array<{ left: number; right: number }>>> = { above: [], below: [] };
    const markRightEdges: Record<'above' | 'below', number[]> = { above: [], below: [] };
    const cardGap = zoom === 'month' ? 2 : zoom === 'week' ? 4 : 12;
    const candidateOffsets = zoom === 'month' || zoom === 'week'
      ? [0]
      : [0, cardGap, -cardGap, cardGap * 2, -cardGap * 2];
    const positioned = ranges
      .filter((range) => range.kind === 'note')
      .sort((left, right) => (right.layoutLane === undefined ? 0 : 1) - (left.layoutLane === undefined ? 0 : 1)
        || left.start.valueOf() - right.start.valueOf())
      .map((range) => {
        const left = dateToX(range.start);
        const width = Math.max(16, dateToX(range.end.add(1, 'day')) - left);
        const isExpanded = expandedAnnotationId === range.noteId;
        const compactSummary = zoom === 'month' && range.end.diff(range.start, 'day') <= 14 && !isExpanded;
        const cardWidth = isExpanded
          ? 220
          : zoom === 'week'
            ? Math.min(260, Math.max(72, width - 4))
            : zoom === 'day'
              ? 176
              : zoom === 'month'
                ? compactSummary ? Math.min(72, Math.max(28, width - 4)) : 132
                : Math.min(160, Math.max(72, width));
        const halfCard = cardWidth / 2;
        const anchorX = Math.max(halfCard, Math.min(canvasWidth - halfCard, left + width / 2));
        const placement = range.placement ?? 'above';
        let level = 0;
        let cardX = anchorX;
        let placed = false;
        const laneOrder: number[] = [];
        if (range.layoutLane !== undefined) laneOrder.push(range.layoutLane);
        for (let candidateLane = 0; candidateLane <= cardRows[placement].length + 1; candidateLane += 1) {
          if (!laneOrder.includes(candidateLane)) laneOrder.push(candidateLane);
        }
        for (const candidateLane of laneOrder) {
          const row = cardRows[placement][candidateLane] ?? [];
          for (const offset of candidateOffsets) {
            const candidateX = Math.max(halfCard + 4, Math.min(canvasWidth - halfCard - 4, anchorX + offset));
            const box = { left: candidateX - halfCard, right: candidateX + halfCard };
            if (row.every((existing) => box.right + cardGap <= existing.left || box.left >= existing.right + cardGap)) {
              if (!cardRows[placement][candidateLane]) cardRows[placement][candidateLane] = row;
              row.push(box);
              cardX = candidateX;
              level = candidateLane;
              placed = true;
              break;
            }
          }
          if (placed) break;
        }
        const markLevels = markRightEdges[placement];
        let markLevel = markLevels.findIndex((rightEdge) => rightEdge <= left + 0.5);
        if (markLevel === -1) {
          markLevel = markLevels.length;
          markLevels.push(left + width);
        } else {
          markLevels[markLevel] = left + width;
        }
        const cardHeight = zoom === 'year'
          ? 0
          : compactSummary
            ? 22
            : getAnnotationCardMetrics(range.title, isExpanded).height;
        return { ...range, left, width, anchorX, cardX, cardWidth, level, markLevel, placement, cardHeight, compactSummary };
      });

    const rowHeights: Record<'above' | 'below', number[]> = { above: [], below: [] };
    positioned.forEach((annotation) => {
      rowHeights[annotation.placement][annotation.level] = Math.max(
        rowHeights[annotation.placement][annotation.level] ?? 0,
        annotation.cardHeight,
      );
    });
    return positioned.map((annotation) => ({
      ...annotation,
      laneOffset: rowHeights[annotation.placement]
        .slice(0, annotation.level)
        .reduce((offset, height) => offset + height + 12, 0),
    }));
  }, [canvasWidth, dateToX, expandedAnnotationId, ranges, zoom]);

  const visibleProjectBands = layers.projects ? projectBands : [];
  const projectAboveLaneCount = visibleProjectBands.filter((band) => band.side === 'above').reduce((count, band) => Math.max(count, band.level + 1), 0);
  const projectBelowLaneCount = visibleProjectBands.filter((band) => band.side === 'below').reduce((count, band) => Math.max(count, band.level + 1), 0);
  const projectAboveExtent = projectAboveLaneCount > 0 ? PROJECT_ABOVE_OFFSET + (projectAboveLaneCount - 1) * PROJECT_LANE_GAP : 0;
  const projectBelowExtent = projectBelowLaneCount > 0 ? PROJECT_BELOW_OFFSET + (projectBelowLaneCount - 1) * PROJECT_LANE_GAP : 0;
  const selectedProjectBand = selectedProjectId ? projectBands.find((band) => band.taskId === selectedProjectId) : undefined;
  const activeProjectId = selectedProjectId ?? hoveredProjectId;
  const visibleAnnotations = useMemo(() => annotations.filter((annotation) => {
    if (!layers.annotations) return false;
    if (zoom === 'year') return annotation.end.diff(annotation.start, 'day') >= 21;
    return true;
  }), [annotations, layers.annotations, zoom]);
  const aboveAnnotations = visibleAnnotations.filter((item) => item.placement === 'above');
  const belowAnnotations = visibleAnnotations.filter((item) => item.placement === 'below');
  const aboveAnnotationBracketDistance = projectAboveLaneCount > 0 ? projectAboveExtent + 38 : 34;
  const belowAnnotationBracketDistance = projectBelowLaneCount > 0 ? projectBelowExtent + 38 : 92;
  const aboveAnnotationOuterDistance = aboveAnnotations.reduce((extent, annotation) => {
    const cardExtent = zoom === 'year' ? 10 : 22 + annotation.cardHeight + annotation.laneOffset;
    return Math.max(extent, aboveAnnotationBracketDistance + annotation.markLevel * 12 + cardExtent);
  }, projectAboveLaneCount > 0 ? projectAboveExtent + 24 : 30);
  const belowAnnotationOuterDistance = belowAnnotations.reduce((extent, annotation) => {
    const cardExtent = zoom === 'year' ? 10 : 24 + annotation.laneOffset + annotation.cardHeight;
    return Math.max(extent, belowAnnotationBracketDistance + annotation.markLevel * 12 + cardExtent);
  }, Math.max(68, projectBelowLaneCount > 0 ? projectBelowExtent + 24 : 68));

  const nodePlacements = useMemo<NodePlacement[]>(() => {
    const nodeWidth = zoom === 'year' ? 108 : zoom === 'month' ? 132 : 152;
    const cardGap = 10;
    const rowBoxes: Record<string, Array<Array<{ left: number; right: number }>>> = {};
    const candidates = nodes
      .filter((node) => node.kind !== 'action' && node.kind !== 'deadline')
      .filter((node) => (layers.completed || !node.completed) && (node.kind === 'milestone' ? layers.milestones : layers.notes))
      .filter((node) => shouldShowNodeCard(node, zoom))
      .sort((left, right) => (right.layoutLane === undefined ? 0 : 1) - (left.layoutLane === undefined ? 0 : 1)
        || left.date.valueOf() - right.date.valueOf()
        || left.id.localeCompare(right.id));

    return candidates.map((node) => {
      const anchorX = dateToX(node.date);
      const width = nodeWidth;
      const side: NodeSide = node.placement === 'above' ? 'top' : 'bottom';
      const zone = node.kind === 'milestone' ? 'milestone' : 'note';
      const key = `${side}:${zone}`;
      const rows = rowBoxes[key] ?? [];
      const x = clampCardCenterToViewport(anchorX, width, canvasWidth, viewport);
      const box = { left: x - width / 2, right: x + width / 2 };
      const laneOrder: number[] = [];
      if (node.layoutLane !== undefined) laneOrder.push(node.layoutLane);
      for (let candidateLane = 0; candidateLane <= rows.length + 1; candidateLane += 1) {
        if (!laneOrder.includes(candidateLane)) laneOrder.push(candidateLane);
      }
      const lane = laneOrder.find((candidateLane) => {
        const row = rows[candidateLane] ?? [];
        return row.every((existing) => box.right + cardGap <= existing.left || box.left >= existing.right + cardGap);
      }) ?? rows.length;
      if (!rows[lane]) rows[lane] = [];
      rows[lane].push(box);
      rowBoxes[key] = rows;
      return { ...node, anchorX, x, width, side, lane, layoutSource: node.layoutLane === undefined ? 'auto' : 'manual' };
    });
  }, [canvasWidth, dateToX, layers.completed, layers.milestones, layers.notes, nodes, viewport, zoom]);
  const nodeLaneCount = (side: NodeSide, kind: 'note' | 'milestone') => nodePlacements
    .filter((node) => node.side === side && node.kind === kind)
    .reduce((count, node) => Math.max(count, node.lane + 1), 0);
  const topNoteLaneCount = nodeLaneCount('top', 'note');
  const bottomNoteLaneCount = nodeLaneCount('bottom', 'note');
  const topMilestoneLaneCount = nodeLaneCount('top', 'milestone');
  const bottomMilestoneLaneCount = nodeLaneCount('bottom', 'milestone');
  const topNoteInnerDistance = aboveAnnotationOuterDistance + 18;
  const topNoteOuterDistance = topNoteInnerDistance + (topNoteLaneCount > 0 ? (topNoteLaneCount - 1) * NODE_GAP_Y + 34 : 0);
  const topMilestoneInnerDistance = topNoteLaneCount > 0 ? topNoteOuterDistance + 16 : aboveAnnotationOuterDistance + 18;
  const topMilestoneOuterDistance = topMilestoneInnerDistance + (topMilestoneLaneCount > 0 ? (topMilestoneLaneCount - 1) * NODE_GAP_Y + 54 : 0);
  const bottomNoteInnerDistance = belowAnnotationOuterDistance + 18;
  const bottomNoteOuterDistance = bottomNoteInnerDistance + (bottomNoteLaneCount > 0 ? (bottomNoteLaneCount - 1) * NODE_GAP_Y + 34 : 0);
  const bottomMilestoneInnerDistance = bottomNoteLaneCount > 0 ? bottomNoteOuterDistance + 16 : belowAnnotationOuterDistance + 18;
  const bottomMilestoneOuterDistance = bottomMilestoneInnerDistance + (bottomMilestoneLaneCount > 0 ? (bottomMilestoneLaneCount - 1) * NODE_GAP_Y + 54 : 0);
  const topRequired = Math.max(210, topMilestoneOuterDistance + stageRailHeight + STAGE_CONTENT_GAP);
  const bottomRequired = Math.max(280, bottomMilestoneOuterDistance + 28);
  const axisY = Math.round(Math.max(topRequired, canvasViewportHeight * .46, 320));
  const canvasHeight = Math.max(520, canvasViewportHeight, axisY + bottomRequired);
  const positionedNodes = useMemo<PositionedNode[]>(() => nodePlacements.map((node) => {
    const cardHeight = getNodeCardHeight(node, zoom);
    let y: number;
    if (node.side === 'top' && node.kind === 'note') y = axisY - topNoteInnerDistance - cardHeight - node.lane * NODE_GAP_Y;
    else if (node.side === 'top') y = axisY - topMilestoneInnerDistance - cardHeight - node.lane * NODE_GAP_Y;
    else if (node.kind === 'note') y = axisY + bottomNoteInnerDistance + node.lane * NODE_GAP_Y;
    else y = axisY + bottomMilestoneInnerDistance + node.lane * NODE_GAP_Y;
    return { ...node, y };
  }), [axisY, bottomMilestoneInnerDistance, bottomNoteInnerDistance, nodePlacements, topMilestoneInnerDistance, topNoteInnerDistance, zoom]);

  const milestoneLeaderGroups = useMemo<MilestoneLeaderGroup[]>(() => {
    const groupsByDateAndSide = new Map<string, MilestoneLeaderGroup>();
    const importanceWeight: Record<MilestoneImportance, number> = { normal: 0, important: 1, core: 2 };
    positionedNodes.filter((node) => node.kind === 'milestone').forEach((node) => {
      const key = `${node.date.format('YYYY-MM-DD')}:${node.side}`;
      const existing = groupsByDateAndSide.get(key);
      if (existing) {
        existing.nodes.push(node);
        if (importanceWeight[node.importance ?? 'important'] > importanceWeight[existing.importance]) {
          existing.importance = node.importance ?? 'important';
        }
        return;
      }
      groupsByDateAndSide.set(key, {
        key,
        date: node.date,
        side: node.side,
        anchorX: node.anchorX,
        color: node.color,
        importance: node.importance ?? 'important',
        nodes: [node],
      });
    });
    return [...groupsByDateAndSide.values()].map((group) => ({
      ...group,
      nodes: [...group.nodes].sort((left, right) => left.lane - right.lane || left.id.localeCompare(right.id)),
    }));
  }, [positionedNodes]);

  const taskMarkerClusters = useMemo<TaskMarkerCluster[]>(() => {
    if (!layers.tasks || zoom === 'year') return [];
    const byDate = new Map<string, TaskMarkerCluster>();
    nodes.filter((node) => (node.kind === 'action' || node.kind === 'deadline') && (layers.completed || !node.completed)).forEach((node) => {
      const periodStart = node.date.startOf('day');
      const key = `day:${periodStart.format('YYYY-MM-DD')}`;
      const minutes = node.duration ?? 30;
      const existing = byDate.get(key);
      if (existing) {
        existing.nodes.push(node);
        existing.minutes += minutes;
      }
      else byDate.set(key, {
        key,
        date: periodStart,
        nodes: [node],
        color: node.color,
        label: periodStart.format('M月D日'),
        aggregate: false,
        minutes,
      });
    });
    return [...byDate.values()].sort((left, right) => left.date.valueOf() - right.date.valueOf());
  }, [layers.completed, layers.tasks, nodes, zoom]);

  const anchorEntries = useMemo(() => {
    const visible = nodes.filter((node) => {
      if (node.kind === 'action' || node.kind === 'deadline') return false;
      if (!layers.completed && node.completed) return false;
      if (node.kind === 'milestone') return layers.milestones;
      return layers.notes && zoom !== 'year';
    });
    const entries: Array<{ key: string; node: LineNode; count: number; titles: string[] }> = [];
    const milestonesByDate = new Map<string, LineNode[]>();
    visible.forEach((node) => {
      if (node.kind !== 'milestone') {
        entries.push({ key: node.id, node, count: 1, titles: [node.title] });
        return;
      }
      const key = node.date.format('YYYY-MM-DD');
      const group = milestonesByDate.get(key) ?? [];
      group.push(node);
      milestonesByDate.set(key, group);
    });
    milestonesByDate.forEach((group, date) => {
      const representative = [...group].sort((left, right) => {
        const weight: Record<MilestoneImportance, number> = { normal: 0, important: 1, core: 2 };
        return weight[right.importance ?? 'important'] - weight[left.importance ?? 'important'];
      })[0];
      entries.push({ key: `milestones:${date}`, node: representative, count: group.length, titles: group.map((item) => item.title) });
    });
    return entries.sort((left, right) => left.node.date.valueOf() - right.node.date.valueOf());
  }, [layers.completed, layers.milestones, layers.notes, nodes, zoom]);

  const focusRange = useMemo(() => {
    if (focusMode === 'off') return null;
    if (focusMode === 'week') {
      const start = mondayOf(centerDate);
      return { start, end: start.add(6, 'day'), label: `${start.format('M月D日')}—${start.add(6, 'day').format('M月D日')}` };
    }
    const start = centerDate.startOf('month');
    return { start, end: centerDate.endOf('month'), label: centerDate.format('YYYY年M月') };
  }, [centerDate, focusMode]);
  const selectedTaskCluster = taskMarkerClusters.find((cluster) => cluster.key === selectedTaskDate);
  const currentStage = stageBands.find((stage) => !today.isBefore(stage.start, 'day') && !today.isAfter(stage.end, 'day'));
  const currentStageSource = currentStage ? lifeStages.find((stage) => stage.id === currentStage.id) : undefined;
  const currentCoreGoal = ranges
    .filter((range) => range.kind === 'project' && range.lifeMapKind === 'goal' && range.rank === 'core' && !range.end.isBefore(today, 'day'))
    .sort((left, right) => {
      const leftActive = !today.isBefore(left.start, 'day') && !today.isAfter(left.end, 'day');
      const rightActive = !today.isBefore(right.start, 'day') && !today.isAfter(right.end, 'day');
      return Number(rightActive) - Number(leftActive) || left.start.valueOf() - right.start.valueOf();
    })[0];
  const nextMilestone = nodes
    .filter((node) => node.kind === 'milestone' && !node.date.isBefore(today, 'day'))
    .sort((left, right) => left.date.valueOf() - right.date.valueOf())[0];
  const jumpResults = useMemo(() => {
    const query = jumpQuery.trim().toLowerCase();
    if (!query) return [];
    const dateMatch = dayjs(query);
    const results: Array<{ id: string; title: string; meta: string; date: Dayjs; taskId?: string }> = [];
    if (dateMatch.isValid() && /\d/.test(query)) results.push({ id: `date:${query}`, title: `跳到 ${dateMatch.format('YYYY年M月D日')}`, meta: '日期', date: dateMatch });
    tasks.filter((task) => task.name.toLowerCase().includes(query)).slice(0, 4).forEach((task) => results.push({
      id: `task:${task.id}`, title: task.name, meta: task.lifeMapKind === 'goal' ? '人生目标' : task.lifeMapKind === 'system' ? '长期系统' : task.lifeMapKind === 'review' ? '周期复盘' : '规划', date: midpoint(dayjs(task.start), dayjs(task.end)), taskId: task.id,
    }));
    groups.filter((group) => group.name.toLowerCase().includes(query)).slice(0, 3).forEach((group) => results.push({
      id: `group:${group.id}`, title: group.name, meta: '人生领域', date: midpoint(dayjs(group.start), dayjs(group.end)),
    }));
    lifeStages.filter((stage) => stage.name.toLowerCase().includes(query)).slice(0, 3).forEach((stage) => results.push({
      id: `stage:${stage.id}`, title: stage.name, meta: '人生阶段', date: midpoint(dayjs(stage.start), dayjs(stage.end)),
    }));
    milestones.filter((milestone) => milestone.name.toLowerCase().includes(query)).slice(0, 3).forEach((milestone) => results.push({
      id: `milestone:${milestone.id}`, title: milestone.name, meta: milestoneCountdown(dayjs(milestone.date), today), date: dayjs(milestone.date),
    }));
    return results.slice(0, 8);
  }, [groups, jumpQuery, lifeStages, milestones, tasks, today]);

  const dateAtCenter = useCallback(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return centerDate;
    return bounds.start.add((scroller.scrollLeft + scroller.clientWidth / 2) / pixelsPerDay, 'day');
  }, [bounds.start, centerDate, pixelsPerDay]);

  const focusDate = useCallback((date: Dayjs, behavior: ScrollBehavior = 'smooth') => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.scrollTo({ left: Math.max(0, dateToX(date) - scroller.clientWidth / 2), behavior });
    setCenterDate((current) => current.isSame(date, 'millisecond') ? current : date);
  }, [dateToX]);

  const beginZoomTransition = useCallback(() => {
    const main = mainRef.current;
    main?.classList.add('is-zooming');
    main?.setAttribute('aria-busy', 'true');
    if (zoomAnimationTimerRef.current !== null) window.clearTimeout(zoomAnimationTimerRef.current);
    zoomAnimationTimerRef.current = window.setTimeout(() => {
      zoomAnimationTimerRef.current = null;
      const currentMain = mainRef.current;
      currentMain?.classList.remove('is-zooming');
      currentMain?.setAttribute('aria-busy', 'false');
    }, 180);
  }, []);

  const syncScrollChrome = useCallback((scroller: HTMLDivElement) => {
    const scrollLeft = scroller.scrollLeft;
    const canvas = canvasRef.current;
    canvas?.style.setProperty('--life-map-scroll-left', `${scrollLeft}px`);
    projectLabelMetricsRef.current.forEach(({ label, left, width }) => {
      const labelWidth = Math.min(220, width);
      const labelOffset = Math.max(0, Math.min(
        Math.max(0, width - labelWidth),
        scrollLeft + 12 - left,
      ));
      label.style.transform = `translate3d(${labelOffset}px,0,0)`;
    });
    if (minimapWindowRef.current) {
      minimapWindowRef.current.style.left = `${(scrollLeft / canvasWidth) * 100}%`;
    }
  }, [canvasWidth]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    projectLabelMetricsRef.current = canvas
      ? Array.from(canvas.querySelectorAll<HTMLElement>('.life-line__project-band')).flatMap((band) => {
          const label = band.querySelector<HTMLElement>(':scope > span');
          if (!label) return [];
          return [{
            label,
            left: Number.parseFloat(band.style.left) || 0,
            width: Number.parseFloat(band.style.width) || 0,
          }];
        })
      : [];
    const scroller = scrollerRef.current;
    if (scroller) syncScrollChrome(scroller);
  }, [layers.projects, projectBands, syncScrollChrome]);

  useLayoutEffect(() => {
    const zoomAnchor = pendingZoomAnchorRef.current;
    if (zoomAnchor) {
      pendingZoomAnchorRef.current = null;
      const scroller = scrollerRef.current;
      if (scroller) {
        scroller.scrollTo({ left: Math.max(0, dateToX(zoomAnchor.date) - zoomAnchor.viewportX), behavior: 'auto' });
        setCenterDate(zoomAnchor.date);
      }
      return;
    }
    const target = pendingFocusRef.current ?? today;
    pendingFocusRef.current = null;
    focusDate(target, 'auto');
  }, [dateToX, focusDate, today, zoom]);

  const changeZoom = useCallback((next: ZoomLevel) => {
    if (next === zoom) return;
    if (scrollIdleTimerRef.current !== null) {
      window.clearTimeout(scrollIdleTimerRef.current);
      scrollIdleTimerRef.current = null;
      scrollerRef.current?.classList.remove('is-scrolling');
    }
    pendingZoomAnchorRef.current = null;
    pendingFocusRef.current = today;
    beginZoomTransition();
    React.startTransition(() => setZoom(next));
  }, [beginZoomTransition, today, zoom]);

  const handleScroll = () => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    scroller.classList.add('is-scrolling');
    if (scrollIdleTimerRef.current !== null) window.clearTimeout(scrollIdleTimerRef.current);
    scrollIdleTimerRef.current = window.setTimeout(() => {
      scrollIdleTimerRef.current = null;
      const currentScroller = scrollerRef.current;
      if (!currentScroller) return;
      currentScroller.classList.remove('is-scrolling');
      const nextViewport = { scrollLeft: currentScroller.scrollLeft, width: currentScroller.clientWidth };
      const nextCenter = dateAtCenter().startOf('day');
      React.startTransition(() => {
        setViewport((current) => (
          current.scrollLeft === nextViewport.scrollLeft && current.width === nextViewport.width ? current : nextViewport
        ));
        setCenterDate((current) => current.isSame(nextCenter, 'day') ? current : nextCenter);
      });
    }, 96);
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const currentScroller = scrollerRef.current;
      if (currentScroller) syncScrollChrome(currentScroller);
    });
  };

  useLayoutEffect(() => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const updateViewport = () => {
      syncScrollChrome(scroller);
      setViewport({ scrollLeft: scroller.scrollLeft, width: scroller.clientWidth });
      setCanvasViewportHeight(scroller.clientHeight);
    };
    updateViewport();
    const observer = new ResizeObserver(updateViewport);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [canvasWidth, syncScrollChrome]);

  useLayoutEffect(() => () => {
    if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    if (scrollIdleTimerRef.current !== null) window.clearTimeout(scrollIdleTimerRef.current);
    if (zoomAnimationTimerRef.current !== null) window.clearTimeout(zoomAnimationTimerRef.current);
  }, []);

  const handleWheel: React.WheelEventHandler<HTMLDivElement> = (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const now = performance.now();
    if (now - lastWheelZoomAtRef.current < 140) return;
    const index = ZOOM_LEVELS.indexOf(zoom);
    const nextIndex = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + (event.deltaY < 0 ? 1 : -1)));
    if (nextIndex === index) return;
    const scroller = event.currentTarget;
    const viewportX = Math.max(0, Math.min(scroller.clientWidth, event.clientX - scroller.getBoundingClientRect().left));
    const canvasX = scroller.scrollLeft + viewportX;
    const anchorDate = bounds.start.add((canvasX / pixelsPerDay) * 86_400_000, 'millisecond');
    pendingFocusRef.current = null;
    pendingZoomAnchorRef.current = { date: anchorDate, viewportX };
    lastWheelZoomAtRef.current = now;
    beginZoomTransition();
    React.startTransition(() => setZoom(ZOOM_LEVELS[nextIndex]));
  };

  const openNoteDraft = useCallback((note: Note) => {
    const end = validDate(note.endDate) ? dayjs(note.endDate) : dayjs(note.date);
    setDraft({
      kind: note.type === 'range' ? 'range' : 'note',
      id: note.id,
      name: note.name,
      start: note.date,
      end: note.endDate,
      color: note.color ?? '#F59E0B',
      x: dateToX(midpoint(dayjs(note.date), end)),
      placement: note.placement ?? (note.type === 'range' ? 'above' : 'above'),
    });
    setCanvasTool('select');
    setSelectedTaskDate(null);
  }, [dateToX]);

  const openMilestoneDraft = useCallback((milestone: Milestone) => {
    setDraft({ kind: 'milestone', id: milestone.id, name: milestone.name, start: milestone.date, color: MILESTONE_COLOR, x: dateToX(dayjs(milestone.date)), placement: milestone.placement ?? 'below', importance: milestone.importance ?? 'important' });
    setCanvasTool('select');
    setSelectedTaskDate(null);
  }, [dateToX]);

  const openNode = (node: LineNode) => {
    if (node.noteId) {
      const note = notes.find((item) => item.id === node.noteId);
      if (note) openNoteDraft(note);
      return;
    }
    if (node.milestoneId) {
      const milestone = milestones.find((item) => item.id === node.milestoneId);
      if (milestone) openMilestoneDraft(milestone);
      return;
    }
    if (node.taskId) onOpenTask(node.taskId, node.blockId);
  };

  const canvasPointerX = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    return Math.max(0, Math.min(canvasWidth, event.clientX - (rect?.left ?? 0)));
  };

  const startCanvasAction: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (canvasTool === 'select') return;
    if (annotationAreaRequired) {
      setQuickInputError('请先选择一个人生领域，再添加时间线内容');
      setCanvasTool('select');
      onRequireAnnotationArea?.();
      return;
    }
    const x = canvasPointerX(event);
    if (canvasTool === 'range') {
      event.currentTarget.setPointerCapture(event.pointerId);
      setDragSelection({ startX: x, currentX: x });
      return;
    }
    const date = xToDate(x).format('YYYY-MM-DD');
    setDraft({ kind: canvasTool, name: '', start: date, color: canvasTool === 'milestone' ? MILESTONE_COLOR : NOTE_COLOR, x, placement: canvasTool === 'milestone' ? 'below' : 'above', importance: canvasTool === 'milestone' ? 'important' : undefined });
    setCanvasTool('select');
  };

  const moveCanvasAction: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!dragSelection) return;
    setDragSelection((current) => current ? { ...current, currentX: canvasPointerX(event) } : current);
  };

  const finishCanvasAction: React.PointerEventHandler<HTMLDivElement> = (event) => {
    if (!dragSelection) return;
    const currentX = canvasPointerX(event);
    const left = Math.min(dragSelection.startX, currentX);
    const right = Math.max(dragSelection.startX, currentX);
    const start = xToDate(left);
    const end = xToDate(Math.max(left, right)).endOf('day');
      setDraft({ kind: 'range', name: '', start: start.format('YYYY-MM-DD'), end: end.format('YYYY-MM-DD'), color: WEEKLY_FOCUS_COLOR, x: left + (right - left) / 2, placement: 'above' });
    setDragSelection(null);
    setCanvasTool('select');
  };

  const handleCanvasDoubleClick: React.MouseEventHandler<HTMLDivElement> = (event) => {
    if (canvasTool !== 'select' || (event.target as HTMLElement).closest('button, form')) return;
    if (annotationAreaRequired) {
      setQuickInputError('请先选择一个人生领域，再添加时间线内容');
      onRequireAnnotationArea?.();
      return;
    }
    const rect = canvasRef.current?.getBoundingClientRect();
    const x = Math.max(0, Math.min(canvasWidth, event.clientX - (rect?.left ?? 0)));
    const date = xToDate(x).format('YYYY-MM-DD');
    setDraft({ kind: 'note', name: '', start: date, color: NOTE_COLOR, x, placement: event.clientY < (rect?.top ?? 0) + axisY ? 'above' : 'below' });
  };

  const pushHistory = useCallback((action: HistoryAction) => {
    setHistory((current) => [...current.slice(-39), action]);
    setRedoHistory([]);
  }, []);

  const undoLast = useCallback(() => {
    setHistory((current) => {
      const action = current[current.length - 1];
      if (!action) return current;
      action.undo();
      setRedoHistory((redo) => [...redo, action]);
      return current.slice(0, -1);
    });
  }, []);

  const redoLast = useCallback(() => {
    setRedoHistory((current) => {
      const action = current[current.length - 1];
      if (!action) return current;
      action.redo();
      setHistory((undo) => [...undo, action]);
      return current.slice(0, -1);
    });
  }, []);

  const commitNoteUpdate = useCallback((before: Note, after: Note, label = '移动批注') => {
    onUpdateNote(after);
    setDraft((current) => current?.id === after.id ? {
      ...current,
      name: after.name,
      start: after.date,
      end: after.endDate,
      color: after.color ?? current.color,
      placement: after.placement ?? current.placement,
    } : current);
    pushHistory({ label, undo: () => onUpdateNote(before), redo: () => onUpdateNote(after) });
  }, [onUpdateNote, pushHistory]);

  const commitMilestoneUpdate = useCallback((before: Milestone, after: Milestone, label = '移动关键日期') => {
    onUpdateMilestone(after);
    setDraft((current) => current?.id === after.id ? {
      ...current,
      name: after.name,
      start: after.date,
      color: after.color ?? current.color,
      placement: after.placement ?? current.placement,
      importance: after.importance ?? current.importance,
    } : current);
    pushHistory({ label, undo: () => onUpdateMilestone(before), redo: () => onUpdateMilestone(after) });
  }, [onUpdateMilestone, pushHistory]);

  const saveDraft = () => {
    if (!draft || !draft.name.trim() || !validDate(draft.start)) return;
    if (draft.kind === 'range' && (!validDate(draft.end) || draft.end < draft.start)) return;
    if (draft.kind === 'milestone') {
      const existingMilestone = draft.id ? milestones.find((item) => item.id === draft.id) : undefined;
      const milestone: Milestone = { id: draft.id ?? crypto.randomUUID(), name: draft.name.trim(), date: draft.start, color: MILESTONE_COLOR, placement: draft.placement, importance: draft.importance ?? 'important', layoutLane: existingMilestone?.layoutLane };
      if (draft.id) {
        const before = existingMilestone;
        if (before) commitMilestoneUpdate(before, milestone, '编辑关键日期'); else onUpdateMilestone(milestone);
      } else {
        onCreateMilestone(milestone);
        pushHistory({ label: '创建关键日期', undo: () => onDeleteMilestone(milestone.id), redo: () => onCreateMilestone(milestone) });
      }
    } else {
      const existingNote = draft.id ? notes.find((item) => item.id === draft.id) : undefined;
      const note: Note = {
        id: draft.id ?? crypto.randomUUID(),
        name: draft.name.trim(),
        date: draft.start,
        endDate: draft.kind === 'range' ? draft.end : undefined,
        type: draft.kind === 'range' ? 'range' : 'pin',
        color: draft.kind === 'range' ? WEEKLY_FOCUS_COLOR : NOTE_COLOR,
        placement: draft.placement,
        layoutLane: existingNote?.layoutLane,
      };
      if (draft.id) {
        const before = existingNote;
        if (before) commitNoteUpdate(before, note, '编辑批注'); else onUpdateNote(note);
      } else {
        onCreateNote(note);
        pushHistory({ label: '创建批注', undo: () => onDeleteNote(note.id), redo: () => onCreateNote(note) });
      }
    }
    setDraft(null);
  };

  const deleteDraft = () => {
    if (!draft?.id) return;
    if (draft.kind === 'milestone') {
      const before = milestones.find((item) => item.id === draft.id);
      onDeleteMilestone(draft.id);
      if (before) pushHistory({ label: '删除关键日期', undo: () => onCreateMilestone(before), redo: () => onDeleteMilestone(before.id) });
    } else {
      const before = notes.find((item) => item.id === draft.id);
      onDeleteNote(draft.id);
      if (before) pushHistory({ label: '删除批注', undo: () => onCreateNote(before), redo: () => onDeleteNote(before.id) });
    }
    setDraft(null);
  };

  const startDirectDrag = (kind: DirectDrag['kind'], id: string, event: React.PointerEvent<HTMLElement>) => {
    if (canvasTool !== 'select') return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const positioned = positionedNodes.find((node) => (
      kind === 'note-card' ? node.noteId === id : kind === 'milestone-card' ? node.milestoneId === id : false
    ));
    setDirectDrag({
      kind,
      id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      currentClientX: event.clientX,
      currentClientY: event.clientY,
      startSide: positioned?.side,
      startLane: positioned?.lane,
    });
  };

  const moveDirectDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!directDrag) return;
    setDirectDrag((current) => current ? { ...current, currentClientX: event.clientX, currentClientY: event.clientY } : current);
  };

  const finishDirectDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (!directDrag) return;
    const deltaDays = Math.round((event.clientX - directDrag.startClientX) / pixelsPerDay);
    const deltaY = event.clientY - directDrag.startClientY;
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    const placement: 'above' | 'below' = event.clientY < (canvasRect?.top ?? 0) + axisY ? 'above' : 'below';
    const side: NodeSide = placement === 'above' ? 'top' : 'bottom';
    const moved = Math.abs(event.clientX - directDrag.startClientX) > 3 || Math.abs(deltaY) > 3;

    if (directDrag.kind === 'milestone-card') {
      const before = milestones.find((item) => item.id === directDrag.id);
      if (before && moved) {
        const sameSide = directDrag.startSide === side;
        const laneDelta = sameSide ? Math.round((side === 'top' ? -deltaY : deltaY) / NODE_GAP_Y) : 0;
        const preferredLane = Math.max(0, Math.min(8, (sameSide ? directDrag.startLane ?? 0 : 0) + laneDelta));
        commitMilestoneUpdate(before, {
          ...before,
          date: dayjs(before.date).add(deltaDays, 'day').format('YYYY-MM-DD'),
          placement,
          layoutLane: preferredLane,
        });
      }
    } else {
      const before = notes.find((item) => item.id === directDrag.id);
      if (before) {
        if (directDrag.kind === 'note-card') {
          if (moved) {
            const sameSide = directDrag.startSide === side;
            const laneDelta = sameSide ? Math.round((side === 'top' ? -deltaY : deltaY) / NODE_GAP_Y) : 0;
            const preferredLane = Math.max(0, Math.min(8, (sameSide ? directDrag.startLane ?? 0 : 0) + laneDelta));
            commitNoteUpdate(before, {
              ...before,
              date: dayjs(before.date).add(deltaDays, 'day').format('YYYY-MM-DD'),
              endDate: before.endDate ? dayjs(before.endDate).add(deltaDays, 'day').format('YYYY-MM-DD') : undefined,
              placement,
              layoutLane: preferredLane,
            });
          }
        } else if (before.endDate) {
          const candidate = dayjs(directDrag.kind === 'range-start' ? before.date : before.endDate).add(deltaDays, 'day');
          const start = directDrag.kind === 'range-start' ? candidate : dayjs(before.date);
          const end = directDrag.kind === 'range-end' ? candidate : dayjs(before.endDate);
          if (!end.isBefore(start, 'day') && deltaDays !== 0) {
            commitNoteUpdate(before, { ...before, date: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') }, '调整区间');
          }
        }
      }
    }
    suppressClickRef.current = moved;
    if (moved) window.setTimeout(() => { suppressClickRef.current = false; }, 0);
    setDirectDrag(null);
  };

  const nudgeRangeHandle = (noteId: string, edge: 'start' | 'end', deltaDays: number) => {
    const before = notes.find((item) => item.id === noteId);
    if (!before?.endDate) return;
    const start = edge === 'start' ? dayjs(before.date).add(deltaDays, 'day') : dayjs(before.date);
    const end = edge === 'end' ? dayjs(before.endDate).add(deltaDays, 'day') : dayjs(before.endDate);
    if (end.isBefore(start, 'day')) return;
    commitNoteUpdate(before, { ...before, date: start.format('YYYY-MM-DD'), endDate: end.format('YYYY-MM-DD') }, '调整区间');
  };

  useLayoutEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setCanvasTool('select');
        setDraft(null);
        setSelectedTaskDate(null);
        setSelectedProjectId(null);
        setShowAddMenu(false);
        setShowViewMenu(false);
        setShowJumpMenu(false);
        setShowScaleMenu(false);
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      if (event.shiftKey) redoLast(); else undoLast();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [redoLast, undoLast]);

  const submitQuickInput = () => {
    const parsed = parseNaturalPlan(quickInput, centerDate);
    if (!parsed) {
      setQuickInputError('没有识别到可创建的内容');
      return;
    }
    if (/^(跳转|定位|查看)/.test(quickInput.trim())) {
      focusDate(dayjs(parsed.start));
      setQuickInput('');
      setShowAddMenu(false);
      return;
    }
    if (annotationAreaRequired) {
      setQuickInputError('请先选择一个人生领域，再创建规划内容');
      onRequireAnnotationArea?.();
      return;
    }
    const end = parsed.end ? dayjs(parsed.end) : dayjs(parsed.start);
    setDraft({ ...parsed, x: dateToX(midpoint(dayjs(parsed.start), end)) });
    setQuickInput('');
    setQuickInputError('');
    setShowAddMenu(false);
    setShowViewMenu(false);
    setCanvasTool('select');
  };

  const openNewLifeStage = () => {
    const start = centerDate.startOf('month');
    setStageDraft({
      id: crypto.randomUUID(),
      name: '',
      start: start.format('YYYY-MM-DD'),
      end: start.add(5, 'month').endOf('month').format('YYYY-MM-DD'),
      color: '#7C6FE6',
    });
  };

  const saveLifeStageDraft = () => {
    if (!stageDraft || !stageDraft.name.trim() || !validDate(stageDraft.start) || !validDate(stageDraft.end) || stageDraft.end < stageDraft.start) return;
    const next = { ...stageDraft, name: stageDraft.name.trim() };
    if (lifeStages.some((stage) => stage.id === next.id)) onUpdateLifeStage(next);
    else onCreateLifeStage(next);
    setStageDraft(null);
  };

  const centerLabel = zoom === 'year' ? centerDate.format('YYYY年') : zoom === 'month' ? centerDate.format('YYYY年M月') : centerDate.format('YYYY年M月D日');

  return (
    <main ref={mainRef} className={`life-line is-zoom-${zoom}`} aria-label="人生地图" aria-busy="false">
      <section className="life-line__frame" aria-label="人生时间线">
        <h2 className="life-line__sr-heading">人生时间线</h2>
        <div className="life-line__toolbar">
          <div className="life-line__brand"><CalendarRange size={16} /><h1>人生地图</h1><span>{centerLabel}</span></div>
          <div className="life-line__toolbar-scope" onClickCapture={() => { setShowScaleMenu(false); setShowJumpMenu(false); setShowAddMenu(false); setShowViewMenu(false); }}>{toolbarScope}</div>
          <div className="life-line__controls">
            <button type="button" className="life-line__today-button" onClick={() => focusDate(today)}><LocateFixed size={15} /> 今天</button>
            <div className="life-line__menu-control">
              <button
                type="button"
                role="combobox"
                className={`life-line__scale-button ${showScaleMenu ? 'is-active' : ''}`}
                onClick={() => {
                  setShowScaleMenu((open) => !open);
                  setShowJumpMenu(false);
                  setShowAddMenu(false);
                  setShowViewMenu(false);
                }}
                aria-label="时间尺度"
                aria-controls="life-line-scale-options"
                aria-haspopup="listbox"
                aria-expanded={showScaleMenu}
              >
                <span>{ZOOM_META[zoom].label}视图</span><ChevronDown size={12} />
              </button>
              {showScaleMenu && <div id="life-line-scale-options" className="life-line__command-menu life-line__scale-menu" role="listbox" aria-label="选择时间尺度">
                {ZOOM_LEVELS.map((level) => <button
                  type="button"
                  role="option"
                  aria-selected={zoom === level}
                  className={zoom === level ? 'is-selected' : ''}
                  key={level}
                  onClick={() => {
                    changeZoom(level);
                    setShowScaleMenu(false);
                  }}
                >
                  <span><strong>{ZOOM_META[level].label}视图</strong><small>{ZOOM_HINTS[level]}</small></span>
                  {zoom === level && <Check size={13} />}
                </button>)}
              </div>}
            </div>
            <div className="life-line__menu-control">
              <button type="button" className={`life-line__jump-button ${showJumpMenu ? 'is-active' : ''}`} onClick={() => { setShowJumpMenu((open) => !open); setShowScaleMenu(false); setShowAddMenu(false); setShowViewMenu(false); }} aria-expanded={showJumpMenu} aria-label="快速跳转"><Search size={15} /><span>跳转</span></button>
              {showJumpMenu && <div className="life-line__command-menu life-line__jump-menu">
                <label><Search size={14} /><input autoFocus value={jumpQuery} onChange={(event) => setJumpQuery(event.target.value)} placeholder="目标、系统、阶段、关键日期或日期" aria-label="搜索人生地图" /></label>
                <div className="life-line__jump-results">
                  {jumpQuery.trim() && jumpResults.length === 0 && <small>没有找到匹配内容</small>}
                  {jumpResults.map((result) => <button type="button" key={result.id} onClick={() => {
                    focusDate(result.date);
                    setSelectedProjectId(result.taskId ?? null);
                    setShowJumpMenu(false);
                    setJumpQuery('');
                  }}><span><strong>{result.title}</strong><small>{result.meta}</small></span><LocateFixed size={13} /></button>)}
                </div>
              </div>}
            </div>
            <div className="life-line__menu-control">
            <button type="button" className={`life-line__add-button ${canvasTool !== 'select' ? 'is-active' : ''}`} onClick={() => { setShowAddMenu((open) => !open); setShowScaleMenu(false); setShowViewMenu(false); setShowJumpMenu(false); }} aria-expanded={showAddMenu} aria-label="添加到时间线"><Plus size={15} /><span>添加</span></button>
            {showAddMenu && <div className="life-line__command-menu life-line__add-menu">
              <form className="life-line__quick-entry" onSubmit={(event) => { event.preventDefault(); submitQuickInput(); }}>
                <Sparkles size={15} />
                <input autoFocus value={quickInput} onChange={(event) => { setQuickInput(event.target.value); setQuickInputError(''); }} placeholder="如：八月完成马原学习…" aria-label="自然语言快速输入" />
                <button type="submit" className="life-line__quick-submit" aria-label="解析并预览"><Search size={14} /></button>
              </form>
              {quickInputError && <div className="life-line__quick-error">{quickInputError}</div>}
              {(onCreateGoal || onCreateSystem) && <div className="life-line__add-section-label">人生规划</div>}
              {onCreateGoal && <button type="button" onClick={() => { onCreateGoal(); setShowAddMenu(false); }} aria-label="新建目标"><Target size={15} /><span><strong>目标</strong><small>有明确结果和目标日期</small></span></button>}
              {onCreateSystem && <button type="button" onClick={() => { onCreateSystem(); setShowAddMenu(false); }} aria-label="新建长期系统"><Repeat2 size={15} /><span><strong>长期系统</strong><small>需要持续重复的生活规律</small></span></button>}
              <div className="life-line__add-section-label">时间标注</div>
              <button type="button" onClick={() => {
                openNewLifeStage();
                setShowAddMenu(false);
              }} aria-label="新建人生阶段"><CalendarRange size={15} /><span><strong>人生阶段</strong><small>独立设置人生周期，不创建项目</small></span></button>
              {!onCreateReview && <button type="button" onClick={() => {
                setDraft({ kind: 'note', name: `复盘：${centerDate.format('YYYY年M月')}`, start: centerDate.format('YYYY-MM-DD'), color: '#64748B', x: dateToX(centerDate), placement: 'above' });
                setCanvasTool('select');
                setShowAddMenu(false);
              }} aria-label="添加规划复盘"><BookOpenCheck size={15} /><span><strong>规划复盘</strong><small>记录当前阶段的计划快照与调整</small></span></button>}
              {([
                ['select', '选择与移动', '编辑、拖动已有内容', <MousePointer2 size={15} />],
                ['range', '阶段概述', '圈出一周、一个月或任意阶段', <Highlighter size={15} />],
                ['note', '自由文字', '在某个日期添加说明', <StickyNote size={15} />],
                ['milestone', '关键日期', '标记考试、截止或纪念日', <Diamond size={15} />],
              ] as Array<[CanvasTool, string, string, React.ReactNode]>).map(([tool, label, description, icon]) => (
                <button type="button" key={tool} className={canvasTool === tool ? 'is-active' : ''} onClick={() => {
                  if (tool !== 'select' && annotationAreaRequired) {
                    setQuickInputError('请先选择一个人生领域，再添加时间线内容');
                    onRequireAnnotationArea?.();
                    return;
                  }
                  setCanvasTool(tool); setShowAddMenu(false);
                }} aria-label={tool === 'range' ? '区间标注工具' : tool === 'note' ? '文字便签工具' : tool === 'milestone' ? '关键日期工具' : '选择工具'}>
                  {icon}<span><strong>{label}</strong><small>{description}</small></span>{canvasTool === tool && <Check size={13} />}
                </button>
              ))}
              {(onCreateTheme || onCreateReview || onCreateArea) && <div className="life-line__add-section-label">更多规划</div>}
              {onCreateTheme && <button type="button" className="is-secondary" onClick={() => { onCreateTheme(); setShowAddMenu(false); }} aria-label="新建领域主题"><Sparkles size={15} /><span><strong>领域主题</strong><small>一段时期内的总体方向</small></span></button>}
              {onCreateReview && <button type="button" className="is-secondary" onClick={() => { onCreateReview(); setShowAddMenu(false); }} aria-label="新建周期复盘"><BookOpenCheck size={15} /><span><strong>周期复盘</strong><small>保存月度或季度快照并记录调整</small></span></button>}
              {onCreateArea && <button type="button" className="is-secondary" onClick={() => { onCreateArea(); setShowAddMenu(false); }} aria-label="新建自定义领域"><Plus size={15} /><span><strong>自定义领域</strong><small>仅在默认领域不够用时添加</small></span></button>}
            </div>}
          </div>
            <div className="life-line__menu-control">
              <button type="button" className={`life-line__view-button ${showViewMenu ? 'is-active' : ''}`} onClick={() => { setShowViewMenu((open) => !open); setShowScaleMenu(false); setShowAddMenu(false); setShowJumpMenu(false); }} aria-expanded={showViewMenu} aria-label="视图设置"><Layers3 size={15} /><span>视图</span><ChevronDown size={12} /></button>
              {showViewMenu && <div className="life-line__command-menu life-line__view-menu">
                <section><header><strong>显示内容</strong></header>
                  {([['projects', '目标与长期系统'], ['annotations', '主题与阶段概述'], ['milestones', '关键日期'], ['notes', '自由文字'], ['completed', '已完成内容']] as Array<[keyof LayerState, string]>).map(([key, label]) => <button type="button" className="life-line__toggle-row" key={key} onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}>{layers[key] ? <Eye size={13} /> : <EyeOff size={13} />}<span>{label}</span><i className={layers[key] ? 'is-on' : ''} /></button>)}
                </section>
                <section className="life-line__view-actions">
                  <button type="button" className={focusMode !== 'off' ? 'is-active' : ''} onClick={() => setFocusMode((current) => current === 'off' ? 'week' : current === 'week' ? 'month' : 'off')}><Focus size={14} /><span>{focusMode === 'week' ? '聚焦本周' : focusMode === 'month' ? '聚焦本月' : '开启聚焦'}</span></button>
                  <button type="button" className={showMinimap ? 'is-active' : ''} onClick={() => setShowMinimap((visible) => !visible)}><Layers3 size={14} /><span>{showMinimap ? '隐藏小地图' : '显示小地图'}</span></button>
                </section>
                <section className="life-line__history-controls" aria-label="撤销与重做">
                  <button type="button" onClick={undoLast} disabled={history.length === 0} aria-label="撤销"><Undo2 size={14} />撤销</button>
                  <button type="button" onClick={redoLast} disabled={redoHistory.length === 0} aria-label="重做"><Redo2 size={14} />重做</button>
                </section>
              </div>}
            </div>
          </div>
        </div>
        <div className="life-line__status-line" aria-label="当前规划摘要">
          <button
            type="button"
            className="is-stage"
            onClick={() => currentStageSource ? setStageDraft({ ...currentStageSource }) : openNewLifeStage()}
            aria-label={currentStageSource ? '编辑当前人生阶段' : '添加人生阶段'}
          >
            <small>阶段</small><strong>{currentStage?.title ?? '添加人生阶段'}</strong>
          </button>
          <span className="is-core"><small>核心目标</small><strong>{currentCoreGoal?.title ?? '暂无核心目标'}</strong></span>
          <button type="button" className="is-milestone" disabled={!nextMilestone} onClick={() => nextMilestone && focusDate(nextMilestone.date)}><small>下一节点</small><strong>{nextMilestone ? `${nextMilestone.title} · ${milestoneCountdown(nextMilestone.date, today)}` : '暂无关键日期'}</strong></button>
        </div>
        {canvasTool !== 'select' && <div className="life-line__hint"><span>{canvasTool === 'range' ? '阶段概述' : canvasTool === 'note' ? '自由文字' : '关键日期'}</span>{canvasTool === 'range' ? '在画布上横向拖动选择时间范围' : '在画布对应日期单击放置'}<button type="button" onClick={() => setCanvasTool('select')}>退出</button></div>}

        <div className="life-line__scroller" ref={scrollerRef} onScroll={handleScroll} onWheel={handleWheel} tabIndex={0} aria-label={`人生规划${ZOOM_META[zoom].label}视图时间轴`}>
          <div className="life-line__canvas" ref={canvasRef} style={{ width: canvasWidth, height: canvasHeight }} onDoubleClick={handleCanvasDoubleClick}>
            {focusRange && <div className="life-line__focus-lens" style={{ left: dateToX(focusRange.start), width: Math.max(8, dateToX(focusRange.end.add(1, 'day')) - dateToX(focusRange.start)) }}><span>{focusMode === 'week' ? '本周' : '本月'} · {focusRange.label}</span></div>}
            <div className="life-line__past-shade" style={{ width: dateToX(today) }} aria-hidden="true" />
            <div className="life-line__stages" aria-label="人生阶段">
              {stageBands.map((stage) => (
                <div
                  key={`stage-zone:${stage.id}`}
                  className={`life-line__stage-zone ${!today.isBefore(stage.start, 'day') && !today.isAfter(stage.end, 'day') ? 'is-current' : ''}`}
                  style={{ left: stage.left, width: stage.width, height: canvasHeight, '--stage-color': stage.color } as React.CSSProperties}
                  aria-hidden="true"
                />
              ))}
              {stageLaneCount > 0 && <div className="life-line__stage-rail" style={{ height: stageRailHeight }} aria-hidden="true" />}
              {stageBands.map((stage) => {
                const isCurrent = !today.isBefore(stage.start, 'day') && !today.isAfter(stage.end, 'day');
                const sourceStage = lifeStages.find((item) => item.id === stage.id);
                return <div
                  key={stage.id}
                  className={`life-line__stage-band ${isCurrent ? 'is-current' : ''}`}
                  style={{ left: stage.left, width: stage.width, top: STAGE_RAIL_BAND_TOP + stage.level * STAGE_RAIL_LANE_GAP, '--stage-color': stage.color } as React.CSSProperties}
                  title={`${stage.title} · ${stage.start.format('YYYY-MM-DD')} 至 ${stage.end.format('YYYY-MM-DD')}`}
                >
                  <button type="button" className="life-line__stage-main" onClick={() => focusDate(midpoint(stage.start, stage.end))} aria-label={`${stage.title}人生阶段`}>
                    <span>{stage.title}</span>
                    <small>{stage.start.format('YYYY年M月')}—{stage.end.format('YYYY年M月')}</small>
                    {isCurrent && <em>当前</em>}
                  </button>
                  {sourceStage && <button type="button" className="life-line__stage-edit" onClick={() => setStageDraft({ ...sourceStage })} aria-label={`编辑人生阶段：${stage.title}`}><Pencil size={11} /></button>}
                </div>;
              })}
            </div>
            <div className="life-line__axis" style={{ top: axisY }} aria-hidden="true" />
            {renderedTicks.map((tick) => <div className={`life-line__tick ${tick.major ? 'is-major' : ''}`} key={tick.date.format('YYYY-MM-DD')} style={{ left: dateToX(tick.date), top: axisY }}><i /><strong>{tick.label}</strong>{tick.sublabel && <span>{tick.sublabel}</span>}</div>)}
            <div className="life-line__today" style={{ left: dateToX(today), height: canvasHeight, '--axis-y': `${axisY}px` } as React.CSSProperties}><i /><span>今天 · {today.format('M月D日')}</span></div>
            {projectAboveLaneCount > 0 && <div className="life-line__project-lane-zone is-above" style={{ top: axisY - projectAboveExtent - 4, height: projectAboveExtent + 2 }} aria-hidden="true" />}
            {projectBelowLaneCount > 0 && <div className="life-line__project-lane-zone is-below" style={{ top: axisY + PROJECT_BELOW_OFFSET - 4, height: 32 + (projectBelowLaneCount - 1) * PROJECT_LANE_GAP }} aria-hidden="true" />}

            {layers.projects && activeProjectId && <svg className="life-line__goal-links" width={canvasWidth} height={canvasHeight} aria-label="目标链">
              <defs><marker id="life-line-goal-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 z" /></marker></defs>
              {goalLinks.filter((link) => link.from.taskId === activeProjectId || link.to.taskId === activeProjectId).map((link) => {
                const fromY = link.from.side === 'above'
                  ? axisY - PROJECT_ABOVE_OFFSET - link.from.level * PROJECT_LANE_GAP + 12
                  : axisY + PROJECT_BELOW_OFFSET + link.from.level * PROJECT_LANE_GAP + 12;
                const toY = link.to.side === 'above'
                  ? axisY - PROJECT_ABOVE_OFFSET - link.to.level * PROJECT_LANE_GAP + 12
                  : axisY + PROJECT_BELOW_OFFSET + link.to.level * PROJECT_LANE_GAP + 12;
                const fromX = link.from.left + link.from.width;
                const toX = link.to.left;
                const middleX = fromX + Math.max(4, (toX - fromX) / 2);
                return <path key={link.id} className="is-highlighted" d={`M ${fromX} ${fromY} L ${middleX} ${fromY} L ${middleX} ${toY} L ${toX - 3} ${toY}`} markerEnd="url(#life-line-goal-arrow)" />;
              })}
            </svg>}

            {visibleProjectBands.map((band) => {
              const labelWidth = Math.min(220, band.width);
              const labelOffset = Math.max(0, Math.min(
                Math.max(0, band.width - labelWidth),
                viewport.scrollLeft + 12 - band.left,
              ));
              return (
              <button
                type="button"
                className={`life-line__project-band is-${band.side} is-rank-${band.rank ?? 'routine'} ${band.lifeMapKind ? `is-life-${band.lifeMapKind}` : ''} ${band.openEnded ? 'is-open-ended' : ''} ${band.end.isBefore(today, 'day') ? 'is-past' : band.start.isAfter(today, 'day') ? 'is-future' : 'is-current'} ${band.progress >= 1 ? 'is-complete' : ''} ${activeProjectId && activeProjectId !== band.taskId ? 'is-muted' : ''} ${activeProjectId === band.taskId ? 'is-related' : ''} ${selectedProjectId === band.taskId ? 'is-selected' : ''}`}
                key={band.id}
                style={{
                  left: band.left,
                  width: band.width,
                  top: band.side === 'above' ? axisY - PROJECT_ABOVE_OFFSET - band.level * PROJECT_LANE_GAP : axisY + PROJECT_BELOW_OFFSET + band.level * PROJECT_LANE_GAP,
                  '--band-color': band.color,
                  '--band-border-color': getTaskBorderColor(band.color),
                  '--band-text-color': getTaskTextColor(band.color),
                  '--band-progress': `${Math.round(band.progress * 100)}%`,
                } as React.CSSProperties}
                title={`${band.title} · ${band.groupName} · ${band.start.format('YYYY-MM-DD')}${band.openEnded ? '起长期持续' : ` 至 ${band.end.format('YYYY-MM-DD')}`} · ${band.meta ?? `${Math.round(band.progress * 100)}%`}`}
                onClick={() => setSelectedProjectId((current) => current === band.taskId ? null : band.taskId ?? null)}
                onMouseEnter={() => setHoveredProjectId(band.taskId ?? null)}
                onMouseLeave={() => setHoveredProjectId((current) => current === band.taskId ? null : current)}
                onDoubleClick={() => band.taskId && onOpenTask(band.taskId)}
                aria-pressed={selectedProjectId === band.taskId}
                aria-label={`${band.title}时间条带${band.lifeMapKind === 'goal' ? ' · 目标进度线' : band.lifeMapKind === 'system' ? ' · 长期系统节奏线' : ''}`}
                data-project-id={band.taskId}
                data-band-level={band.level}
                data-band-side={band.side}
                data-project-rank={band.rank}
                  data-layout-source={band.placementIsManual ? 'manual' : 'auto'}
              >
                <span style={{ width: labelWidth, transform: `translateX(${labelOffset}px)` }}><strong>{band.title}</strong><em>{band.meta ?? `${Math.round(band.progress * 100)}%`}</em></span>
                <i className="life-line__project-progress" style={{ width: `${Math.round(band.progress * 100)}%` }} aria-hidden="true" />
                {band.lifeMapKind === 'goal' && <i className="life-line__goal-endpoint" aria-hidden="true" />}
              </button>
              );
            })}

            {selectedProjectBand && <aside className="life-line__project-focus-card">
              <header>
                <i style={{ '--project-color': selectedProjectBand.color } as React.CSSProperties} />
                <span><small>{selectedProjectBand.groupName} · {selectedProjectBand.lifeMapKind === 'system' ? '长期保持' : `${selectedProjectBand.start.format('M月D日')}—${selectedProjectBand.end.format('M月D日')}`}</small><strong>{selectedProjectBand.title}</strong></span>
                <em>{selectedProjectBand.meta ?? `${Math.round(selectedProjectBand.progress * 100)}%`}</em>
                <button type="button" className="is-close" onClick={() => setSelectedProjectId(null)} aria-label="退出规划聚焦"><X size={13} /></button>
              </header>
              <div className="life-line__project-focus-actions">
                <div className="life-line__project-side-switch" role="group" aria-label="规划线位置">
                  <button type="button" className={selectedProjectBand.side === 'above' ? 'is-active' : ''} aria-label="放到时间轴上方" aria-pressed={selectedProjectBand.side === 'above'} onClick={() => selectedProjectBand.taskId && setProjectSide(selectedProjectBand.taskId, 'above')}>上方</button>
                  <button type="button" className={selectedProjectBand.side === 'below' ? 'is-active' : ''} aria-label="放到时间轴下方" aria-pressed={selectedProjectBand.side === 'below'} onClick={() => selectedProjectBand.taskId && setProjectSide(selectedProjectBand.taskId, 'below')}>下方</button>
                </div>
                <button type="button" className="is-open" onClick={() => selectedProjectBand.taskId && onOpenTask(selectedProjectBand.taskId)}>编辑</button>
              </div>
            </aside>}

            {visibleAnnotations.map((annotation) => {
              const isAbove = annotation.placement === 'above';
              const isExpanded = expandedAnnotationId === annotation.noteId;
              const annotationMetrics = getAnnotationCardMetrics(annotation.title, isExpanded);
              const annotationTitle = annotationMetrics.heading;
              const visibleAnnotationItems = annotationMetrics.visibleItems;
              const collapsedItemCount = annotationMetrics.hiddenCount;
              const canExpand = annotationMetrics.canExpand;
              const annotationCardHeight = annotation.cardHeight;
              const annotationAriaTitle = annotationTitle;
              const displayAnnotationTitle = annotation.compactSummary
                ? canExpand ? `重点·${collapsedItemCount}` : '重点'
                : annotationTitle;
              const bracketY = isAbove ? axisY - aboveAnnotationBracketDistance - annotation.markLevel * 12 : axisY + belowAnnotationBracketDistance + annotation.markLevel * 12;
              const railGap = (zoom === 'week' && !isExpanded) || annotation.compactSummary ? 8 : isAbove ? 22 : 24;
              const textY = isAbove ? bracketY - railGap - annotationCardHeight - annotation.laneOffset : bracketY + railGap + annotation.laneOffset;
              const cardConnectY = isAbove ? textY + annotationCardHeight : textY;
              const leaderLeft = Math.min(annotation.anchorX, annotation.cardX);
              const leaderTop = Math.min(bracketY, cardConnectY);
              const leaderWidth = Math.abs(annotation.cardX - annotation.anchorX);
              const leaderHeight = Math.abs(cardConnectY - bracketY);
              const isEditing = draft?.id === annotation.noteId;
              const activateAnnotation = () => {
                if (annotation.compactSummary && canExpand) {
                  setExpandedAnnotationId(annotation.noteId ?? null);
                  requestAnimationFrame(() => requestAnimationFrame(() => {
                    const callout = [...(scrollerRef.current?.querySelectorAll<HTMLElement>('.life-line__annotation-callout') ?? [])]
                      .find((element) => element.dataset.noteId === annotation.noteId);
                    callout?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                  }));
                  return;
                }
                const note = notes.find((item) => item.id === annotation.noteId);
                if (note) openNoteDraft(note);
              };
              return (
                <React.Fragment key={annotation.id}>
                  <div className={`life-line__annotation-range-mark ${isEditing ? 'is-editing' : ''}`} data-note-id={annotation.noteId} data-annotation-level={annotation.markLevel} style={{ left: annotation.left, width: annotation.width, top: bracketY, '--annotation-color': annotation.color } as React.CSSProperties} />
                  <div className="life-line__annotation-anchor" data-note-id={annotation.noteId} style={{ left: annotation.anchorX, top: bracketY, '--annotation-color': annotation.color } as React.CSSProperties} />
                  {zoom === 'year' && <div
                    className="life-line__annotation-year-label"
                    style={{ left: annotation.anchorX, top: isAbove ? bracketY - 18 : bracketY + 8, maxWidth: Math.max(72, Math.min(160, annotation.width)), '--annotation-color': annotation.color } as React.CSSProperties}
                    title={annotation.title}
                  >{annotationTitle}</div>}
                  {zoom !== 'year' && <div
                    className={`life-line__annotation-leader is-${annotation.placement}`}
                    data-note-id={annotation.noteId}
                    style={{ left: leaderLeft, top: leaderTop, width: Math.max(1, leaderWidth), height: Math.max(1, leaderHeight), '--annotation-color': annotation.color } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    <i className="is-vertical" style={{ left: annotation.anchorX - leaderLeft, top: Math.min(bracketY, cardConnectY) - leaderTop, height: Math.max(1, leaderHeight) }} />
                    <i className="is-horizontal" style={{ left: Math.min(annotation.anchorX, annotation.cardX) - leaderLeft, top: cardConnectY - leaderTop, width: Math.max(1, leaderWidth) }} />
                  </div>}
                  {isEditing && annotation.noteId && <>
                    <button type="button" className="life-line__range-handle is-start" style={{ left: annotation.left, top: bracketY, '--annotation-color': annotation.color } as React.CSSProperties} onPointerDown={(event) => startDirectDrag('range-start', annotation.noteId!, event)} onPointerMove={moveDirectDrag} onPointerUp={finishDirectDrag} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); nudgeRangeHandle(annotation.noteId!, 'start', event.key === 'ArrowRight' ? 1 : -1); } }} aria-label={`${annotationAriaTitle}开始日期拖动手柄`} />
                    <button type="button" className="life-line__range-handle is-end" style={{ left: annotation.left + annotation.width, top: bracketY, '--annotation-color': annotation.color } as React.CSSProperties} onPointerDown={(event) => startDirectDrag('range-end', annotation.noteId!, event)} onPointerMove={moveDirectDrag} onPointerUp={finishDirectDrag} onKeyDown={(event) => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); nudgeRangeHandle(annotation.noteId!, 'end', event.key === 'ArrowRight' ? 1 : -1); } }} aria-label={`${annotationAriaTitle}结束日期拖动手柄`} />
                  </>}
                  {zoom !== 'year' && <div
                    className={`life-line__annotation-callout is-${annotation.placement} is-${annotation.annotationKind ?? 'focus'} ${zoom === 'week' ? 'is-rail-unit' : ''} ${zoom === 'week' && !isExpanded ? 'is-inline-rail' : ''} ${annotation.compactSummary ? 'is-scale-summary' : ''} ${isEditing ? 'is-editing' : ''} ${isExpanded ? 'is-expanded' : ''}`}
                    data-note-id={annotation.noteId}
                    data-layout-lane={annotation.level}
                    data-layout-policy={zoom === 'week' && !isExpanded ? 'weekly-rail' : 'annotation-zone'}
                    style={{ left: annotation.cardX, top: textY, width: annotation.cardWidth, height: annotationCardHeight, '--annotation-color': annotation.color } as React.CSSProperties}
                    onClick={activateAnnotation}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' && event.key !== ' ') return;
                      event.preventDefault();
                      activateAnnotation();
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`${annotationTitle}，${annotation.start.format('M月D日')}至${annotation.end.format('M月D日')}`}
                    title={`${annotation.title} · ${annotation.start.format('YYYY-MM-DD')} 至 ${annotation.end.format('YYYY-MM-DD')}`}
                  >
                    <span>
                      <strong>{displayAnnotationTitle}</strong>
                      {visibleAnnotationItems.length > 0 && <span className="life-line__annotation-items">
                        {visibleAnnotationItems.map((item, index) => <em key={`${annotation.id}:item:${index}`}><i />{item}</em>)}
                      </span>}
                      {!annotation.compactSummary && <small>{annotation.start.format('M月D日')}—{annotation.end.format('M月D日')}</small>}
                      {canExpand && !annotation.compactSummary && <button
                        type="button"
                        className="life-line__annotation-more"
                        aria-label={isExpanded ? '收起' : `展开 ${collapsedItemCount} 项`}
                        onClick={(event) => {
                          event.stopPropagation();
                          const isOpening = expandedAnnotationId !== annotation.noteId;
                          setExpandedAnnotationId(isOpening ? annotation.noteId ?? null : null);
                          if (isOpening) {
                            const callout = event.currentTarget.closest<HTMLElement>('.life-line__annotation-callout');
                            requestAnimationFrame(() => callout?.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
                          }
                        }}
                      >{isExpanded ? '收起' : `${collapsedItemCount} 项`}</button>}
                    </span>
                  </div>}
                </React.Fragment>
              );
            })}

            {anchorEntries.map(({ key, node, count, titles }) => (
              <button
                type="button"
                className={`life-line__anchor is-${node.kind} ${node.kind === 'milestone' ? `is-importance-${node.importance ?? 'important'}` : ''} ${count > 1 ? 'is-cluster' : ''} ${node.isReview ? 'is-review' : ''} ${node.completed ? 'is-complete' : ''}`}
                key={`anchor:${key}`}
                style={{ left: dateToX(node.date), top: axisY, '--node-color': node.color } as React.CSSProperties}
                onClick={() => openNode(node)}
                title={`${node.date.format('YYYY-MM-DD')} · ${titles.join('、')}`}
                aria-label={`${titles.join('、')}，${node.date.format('YYYY年M月D日')}${count > 1 ? `，共${count}个关键日期` : ''}`}
                data-anchor-count={count}
                data-anchor-date={node.date.format('YYYY-MM-DD')}
              />
            ))}

            {taskMarkerClusters.length > 0 && <div className="life-line__task-rhythm-rail" style={{ top: axisY + 37 }} aria-label="每日任务节奏带" />}
            {taskMarkerClusters.map((cluster) => (
              <button
                type="button"
                className={`life-line__task-marker ${selectedTaskDate === cluster.key ? 'is-selected' : ''} ${cluster.nodes.some((node) => node.kind === 'deadline') ? 'has-deadline' : ''} ${activeProjectId && !cluster.nodes.some((node) => node.taskId === activeProjectId) ? 'is-muted' : ''} ${activeProjectId && cluster.nodes.some((node) => node.taskId === activeProjectId) ? 'is-related' : ''}`}
                key={`task-marker:${cluster.key}`}
                style={{ left: dateToX(cluster.date), top: axisY + 65, '--task-color': cluster.color, '--task-rhythm-height': `${Math.min(24, Math.max(5, Math.round(cluster.minutes / 60 * 4)))}px` } as React.CSSProperties}
                onClick={() => setSelectedTaskDate((current) => current === cluster.key ? null : cluster.key)}
                onDoubleClick={() => { const node = cluster.nodes[0]; if (node?.taskId) onOpenTask(node.taskId, node.blockId); }}
                aria-label={cluster.nodes.length === 1 && !cluster.aggregate ? `${cluster.nodes[0].title}，${cluster.date.format('YYYY年M月D日')}` : `${cluster.label}，${cluster.nodes.length}项任务`}
                title={`${cluster.label} · ${cluster.nodes.length} 项任务`}
                data-preview={cluster.nodes.length === 1 ? cluster.nodes[0].title : `${cluster.nodes.length} 项任务`}
              >
                {cluster.nodes.length > 1 && (zoom === 'week' || zoom === 'day') && <b className="life-line__task-count">{cluster.nodes.length}</b>}
                <span
                  className="life-line__task-pulse"
                  aria-hidden="true"
                >
                  {cluster.nodes.slice(0, zoom === 'week' ? 2 : 4).map((node) => (
                    <i key={`pulse:${node.id}`} style={{ '--pulse-color': node.color } as React.CSSProperties} />
                  ))}
                </span>
                <span className="life-line__task-tooltip" aria-hidden="true">
                  <small>{cluster.label} · {cluster.nodes.length}项任务</small>
                  {cluster.nodes.slice(0, 5).map((node) => <span key={`preview:${node.id}`}><i style={{ '--dot-color': node.color } as React.CSSProperties} />{node.title}</span>)}
                  {cluster.nodes.length > 5 && <em>还有 {cluster.nodes.length - 5} 项，点击查看全部</em>}
                </span>
              </button>
            ))}

            {milestoneLeaderGroups.map((group) => {
              const connections = group.nodes.map((node) => ({
                node,
                y: node.side === 'top' ? node.y + getNodeCardHeight(node, zoom) : node.y,
              }));
              const outerY = group.side === 'top'
                ? Math.min(...connections.map((connection) => connection.y))
                : Math.max(...connections.map((connection) => connection.y));
              const left = Math.min(group.anchorX, ...connections.map((connection) => connection.node.x));
              const right = Math.max(group.anchorX, ...connections.map((connection) => connection.node.x));
              const top = Math.min(axisY, outerY);
              return <div
                key={`milestone-leader:${group.key}`}
                className={`life-line__milestone-leader-group is-${group.side} is-importance-${group.importance}`}
                style={{ left, top, width: Math.max(2, right - left), height: Math.max(2, Math.abs(axisY - outerY)), '--node-color': group.color } as React.CSSProperties}
                data-milestone-date={group.date.format('YYYY-MM-DD')}
                data-branch-count={group.nodes.length}
                aria-hidden="true"
              >
                <i className="is-trunk" style={{ left: group.anchorX - left, top: 0, height: Math.max(2, Math.abs(axisY - outerY)) }} />
                {connections.map(({ node, y }) => <i
                  key={`branch:${node.id}`}
                  className="is-branch"
                  style={{ left: Math.min(group.anchorX, node.x) - left, top: y - top, width: Math.max(2, Math.abs(node.x - group.anchorX)) }}
                />)}
              </div>;
            })}

            {positionedNodes.filter((node) => node.kind === 'milestone' ? layers.milestones : node.kind === 'note' ? layers.notes : true).map((node) => {
              const milestoneImportance = node.importance ?? 'important';
              const isDirectlyDragging = directDrag
                && ((node.noteId && directDrag.kind === 'note-card' && directDrag.id === node.noteId)
                  || (node.milestoneId && directDrag.kind === 'milestone-card' && directDrag.id === node.milestoneId));
              const directDragOffset = isDirectlyDragging && directDrag
                ? { x: directDrag.currentClientX - directDrag.startClientX, y: directDrag.currentClientY - directDrag.startClientY }
                : null;
              const nodeCardHeight = getNodeCardHeight(node, zoom);
              const cardConnectY = node.side === 'top' ? node.y + nodeCardHeight : node.y;
              const leaderLeft = Math.min(node.anchorX, node.x);
              const leaderTop = Math.min(axisY, cardConnectY);
              const leaderWidth = Math.abs(node.x - node.anchorX);
              const leaderHeight = Math.abs(cardConnectY - axisY);
              return (
                <React.Fragment key={node.id}>
                  {node.kind !== 'milestone' && <div
                    className={`life-line__node-leader is-${node.side} is-${node.kind}`}
                    style={{ left: leaderLeft, top: leaderTop, width: Math.max(1, leaderWidth), height: Math.max(1, leaderHeight), '--node-color': node.color } as React.CSSProperties}
                    aria-hidden="true"
                  >
                    <i className="is-vertical" style={{ left: node.anchorX - leaderLeft, top: Math.min(axisY, cardConnectY) - leaderTop, height: Math.max(1, leaderHeight) }} />
                    <i className="is-horizontal" style={{ left: Math.min(node.anchorX, node.x) - leaderLeft, top: cardConnectY - leaderTop, width: Math.max(1, leaderWidth) }} />
                  </div>}
                  <button
                    type="button"
                    className={`life-line__node is-${node.kind} is-${node.side} ${(zoom === 'week' || zoom === 'day' || (node.kind === 'milestone' && milestoneImportance === 'core')) ? 'is-detailed' : 'is-summary'} ${node.kind === 'milestone' ? `is-importance-${milestoneImportance}` : ''} ${node.isReview ? 'is-review' : ''} ${node.completed ? 'is-complete' : ''}`}
                    style={{
                      left: node.x,
                      top: node.y,
                      width: node.width,
                      '--node-color': node.color,
                      ...(directDragOffset ? {
                        transform: `translateX(calc(-50% + ${directDragOffset.x}px)) translateY(${directDragOffset.y}px)`,
                        zIndex: 30,
                      } : {}),
                    } as React.CSSProperties}
                    data-layout-source={node.layoutSource}
                    data-layout-lane={node.lane}
                    onPointerDown={(event) => node.noteId ? startDirectDrag('note-card', node.noteId, event) : node.milestoneId ? startDirectDrag('milestone-card', node.milestoneId, event) : undefined}
                    onPointerMove={moveDirectDrag}
                    onPointerUp={finishDirectDrag}
                    onClick={() => { if (suppressClickRef.current) { suppressClickRef.current = false; return; } openNode(node); }}
                    title={`${node.date.format('YYYY-MM-DD')} · ${node.title}`}
                  >
                    <strong><i />{node.title}</strong>
                    {(zoom === 'week' || zoom === 'day' || (node.kind === 'milestone' && milestoneImportance === 'core')) && <small>{node.subtitle}</small>}
                  </button>
                </React.Fragment>
              );
            })}

            {dragSelection && (
              <div
                className="life-line__selection-preview"
                style={{ left: Math.min(dragSelection.startX, dragSelection.currentX), width: Math.max(2, Math.abs(dragSelection.currentX - dragSelection.startX)), top: 14, height: axisY - 30 }}
              />
            )}

            {canvasTool !== 'select' && (
              <div
                className={`life-line__interaction-layer is-${canvasTool}`}
                onPointerDown={startCanvasAction}
                onPointerMove={moveCanvasAction}
                onPointerUp={finishCanvasAction}
                aria-label="时间画布绘制区域"
              />
            )}

            {nodes.length === 0 && ranges.length === 0 && lifeStages.length === 0 && <div className="life-line__empty"><CalendarRange size={28} /><strong>这张人生地图还没有内容</strong><span>先添加一个目标、长期系统、人生阶段或关键日期。</span></div>}
          </div>
        </div>

        {showMinimap && <div
          className="life-line__minimap"
          role="slider"
          aria-label="人生地图全局导航"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(((viewport.scrollLeft + viewport.width / 2) / canvasWidth) * 100)}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            setMinimapDragging(true);
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            focusDate(xToDate(ratio * canvasWidth));
          }}
          onPointerMove={(event) => {
            if (!minimapDragging) return;
            const rect = event.currentTarget.getBoundingClientRect();
            const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
            focusDate(xToDate(ratio * canvasWidth), 'auto');
          }}
          onPointerUp={() => setMinimapDragging(false)}
          onPointerCancel={() => setMinimapDragging(false)}
        >
          <div className="life-line__minimap-track">
            {layers.projects && projectBands.map((band) => <i key={`mini:${band.id}`} style={{ left: `${(band.left / canvasWidth) * 100}%`, width: `${Math.max(.3, (band.width / canvasWidth) * 100)}%`, '--mini-color': band.color } as React.CSSProperties} />)}
            <span className="life-line__minimap-today" style={{ left: `${(dateToX(today) / canvasWidth) * 100}%` }} />
            <span ref={minimapWindowRef} className="life-line__minimap-window" style={{ left: `${(viewport.scrollLeft / canvasWidth) * 100}%`, width: `${Math.min(100, (viewport.width / canvasWidth) * 100)}%` }} />
          </div>
          <small>{bounds.start.format('YYYY')}—{bounds.end.format('YYYY')}</small>
        </div>}
      </section>

      {stageDraft && (
        <form className="life-line__stage-editor" onSubmit={(event) => { event.preventDefault(); saveLifeStageDraft(); }}>
          <header>
            <div><span>独立人生规划</span><strong>{lifeStages.some((stage) => stage.id === stageDraft.id) ? '编辑人生阶段' : '新建人生阶段'}</strong></div>
            <button type="button" onClick={() => setStageDraft(null)} aria-label="关闭人生阶段编辑器"><X size={15} /></button>
          </header>
          <label><span>阶段名称</span><input autoFocus value={stageDraft.name} onChange={(event) => setStageDraft({ ...stageDraft, name: event.target.value })} placeholder="例如：考研强化期 / 职业探索期" /></label>
          <div className="life-line__stage-editor-dates">
            <label><span>开始日期</span><input type="date" value={stageDraft.start} onChange={(event) => setStageDraft({ ...stageDraft, start: event.target.value })} /></label>
            <label><span>结束日期</span><input type="date" min={stageDraft.start} value={stageDraft.end} onChange={(event) => setStageDraft({ ...stageDraft, end: event.target.value })} /></label>
            <label className="life-line__stage-editor-color"><span>颜色</span><input type="color" value={stageDraft.color ?? '#7C6FE6'} onChange={(event) => setStageDraft({ ...stageDraft, color: event.target.value })} /></label>
          </div>
          <p>人生阶段只表达一段人生时期，不会自动创建目标或长期系统。</p>
          <footer>
            {lifeStages.some((stage) => stage.id === stageDraft.id)
              ? <button type="button" className="is-danger" onClick={() => { onDeleteLifeStage(stageDraft.id); setStageDraft(null); }}><Trash2 size={13} />删除阶段</button>
              : <span />}
            <div><button type="button" onClick={() => setStageDraft(null)}>取消</button><button type="submit" className="is-primary" disabled={!stageDraft.name.trim() || !validDate(stageDraft.start) || !validDate(stageDraft.end) || stageDraft.end < stageDraft.start}>保存阶段</button></div>
          </footer>
        </form>
      )}

      {draft && (
        <form className="life-line__draft-editor" onSubmit={(event) => { event.preventDefault(); saveDraft(); }}>
          <header>
            <div><span>时间画布</span><strong>{draft.kind === 'range' ? '阶段概述' : draft.kind === 'milestone' ? '关键日期' : '自由文字'}</strong></div>
            <button type="button" onClick={() => setDraft(null)} aria-label="关闭编辑器"><X size={15} /></button>
          </header>
          <label>
            <span>内容</span>
            {draft.kind === 'range'
              ? <textarea autoFocus rows={4} value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={'例如：本周重点\n完成马原复习\n整理英语错题'} />
              : <input autoFocus value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={draft.kind === 'milestone' ? '例如：六级成绩公布' : '写下一条说明'} />}
          </label>
          <div className={`life-line__draft-dates ${draft.kind === 'range' ? '' : 'is-single'}`}>
            <label><span>{draft.kind === 'range' ? '开始' : '日期'}</span><input type="date" value={draft.start} onChange={(event) => setDraft({ ...draft, start: event.target.value })} /></label>
            {draft.kind === 'range' && <label><span>结束</span><input type="date" value={draft.end ?? draft.start} min={draft.start} onChange={(event) => setDraft({ ...draft, end: event.target.value })} /></label>}
          </div>
          <div className={`life-line__draft-role is-${draft.kind}`}>
            <span>视觉角色</span>
            <strong>{draft.kind === 'range' ? '蓝紫色 · 每周重点' : draft.kind === 'milestone' ? '橙色 · 关键日期' : '中性灰 · 普通说明'}</strong>
          </div>
          {draft.kind === 'milestone' && <div className="life-line__draft-importance">
            <span>重要程度</span>
            <div role="group" aria-label="关键日期重要程度">
              {([['normal', '普通提醒'], ['important', '重要节点'], ['core', '核心事件']] as Array<[MilestoneImportance, string]>).map(([importance, label]) => (
                <button type="button" key={importance} className={(draft.importance ?? 'important') === importance ? 'is-active' : ''} onClick={() => setDraft({ ...draft, importance })}>{label}</button>
              ))}
            </div>
          </div>}
          <div className="life-line__draft-placement" role="group" aria-label="文字位置">
            <span>画布位置</span>
            <button type="button" className={draft.placement === 'above' ? 'is-active' : ''} onClick={() => setDraft({ ...draft, placement: 'above' })}>时间线上方</button>
            <button type="button" className={draft.placement === 'below' ? 'is-active' : ''} onClick={() => setDraft({ ...draft, placement: 'below' })}>时间线下方</button>
          </div>
          <div className="life-line__drawer-tip">在画布中选中阶段后，可以直接拖动两端调整日期。</div>
          <footer>
            {draft.id ? <button type="button" className="is-danger" onClick={deleteDraft}><Trash2 size={13} />删除</button> : <span />}
            <div><button type="button" onClick={() => setDraft(null)}>取消</button><button type="submit" className="is-primary" disabled={!draft.name.trim() || !validDate(draft.start) || (draft.kind === 'range' && (!validDate(draft.end) || draft.end < draft.start))}>{draft.id ? '保存' : '添加到画布'}</button></div>
          </footer>
        </form>
      )}

      {selectedTaskCluster && (
        <aside className="life-line__task-inspector" aria-label={`${selectedTaskCluster.label}任务详情`}>
          <header><div><span>{selectedTaskCluster.aggregate ? '本周任务' : '日期任务'}</span><strong>{selectedTaskCluster.aggregate ? selectedTaskCluster.label : `${selectedTaskCluster.date.format('M月D日 · 周')}${WEEKDAYS[selectedTaskCluster.date.day()]}`}</strong></div><button type="button" onClick={() => setSelectedTaskDate(null)} aria-label="关闭任务详情"><X size={15} /></button></header>
          <div className="life-line__task-inspector-list">
            {selectedTaskCluster.nodes.map((node) => (
              <button type="button" key={`inspect:${node.id}`} onClick={() => node.taskId && onOpenTask(node.taskId, node.blockId)}>
                <i style={{ '--item-color': node.color } as React.CSSProperties} />
                <span><strong>{node.title}</strong><small>{selectedTaskCluster.aggregate ? `${node.date.format('M月D日')} · ` : ''}{node.projectTitle}{node.duration ? ` · 预计 ${node.duration} 分钟` : ''}</small></span>
                <em>{node.completed ? '已完成' : node.kind === 'deadline' ? '截止' : '待完成'}</em>
              </button>
            ))}
          </div>
          <footer>双击任务节奏柱可直接进入项目</footer>
        </aside>
      )}
    </main>
  );
};

export default LifeMapView;

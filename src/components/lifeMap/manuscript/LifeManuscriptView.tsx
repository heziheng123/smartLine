import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Diamond, Map as MapIcon, MoreHorizontal, Pin, PinOff, Plus, StickyNote, X } from 'lucide-react';
import WorkspaceHeader from '@/components/WorkspaceHeader';
import { Card } from '@/design/components/Card';
import type { LifeEvent, LifeGoal, LifeMapData, LifeMapNote, LifeMapPlanGroupId, LifeMapStage, LifeReview, LifeSystem } from '@/lifeMap/types';
import { currentSystemStats } from '@/lifeMap/metrics';
import { activeMaintenancePeriod, mergeMaintenancePeriods } from '@/lifeMap/maintenance';
import { createLifeMapTimeMapper, getManuscriptDateRange } from '@/lifeMap/time/lifeMapTime';
import { createVerticalAnnotationBracePath, resolveAnnotationPresentation } from '@/lifeMap/geometry/annotationBraceGeometry';
import { assignAnnotationTracks } from '@/lifeMap/geometry/annotationIntervalLayout';
import { resolveAnnotationTextCollisions } from '@/lifeMap/geometry/annotationTextCollision';
import { getCategoryProjectLanes, getCategoryProjectTracks, getManuscriptAreas, MANUSCRIPT_CATEGORIES, type ManuscriptProjectStrip } from '@/lifeMap/manuscript/manuscriptSelectors';
import { addDays, diffDays, formatDate, getDayOfWeek, splitDate, todayStr } from '@/utils/dateSafe';
import '@/styles/life-manuscript.css';
import '@/styles/life-manuscript-projects.css';
import '@/styles/life-manuscript-ruler.css';
import '@/styles/life-manuscript-fidelity.css';

type Zoom = 'year' | 'month' | 'week' | 'day';
type ContentLayer = 'stages' | 'projects' | 'systems' | 'events' | 'notes' | 'reviews';
type SelectedEntity = { type: 'stage' | 'project' | 'system' | 'event' | 'annotation'; id: string } | null;
type InspectorEntity = Exclude<SelectedEntity, null>;
type QuickPopoverState = InspectorEntity & { x: number; y: number };
/** Zoom controls both spatial scale and information policy. Never use it as
 * a pixels-per-day switch alone: each level deliberately answers a different
 * planning question. */
const pixelsPerDay: Record<Zoom, number> = { year: 4, month: 13, week: 40, day: 58 };
const ZOOM_POLICY: Record<Zoom, {
  ruler: 'month' | 'month-week' | 'day';
  projects: 'summary' | 'compact' | 'standard' | 'detailed';
  annotations: 'aggregate' | 'anchor' | 'full';
  systems: boolean;
}> = {
  year: { ruler: 'month', projects: 'summary', annotations: 'aggregate', systems: false },
  month: { ruler: 'month-week', projects: 'compact', annotations: 'anchor', systems: true },
  week: { ruler: 'day', projects: 'standard', annotations: 'full', systems: true },
  day: { ruler: 'day', projects: 'detailed', annotations: 'full', systems: true },
};
const DESKTOP_RULER_WIDTH = 220;
const DESKTOP_RAIL_WIDTH = 260;
const CATEGORY_PADDING = 14;
const PROJECT_GAP = 12;
const PROJECT_RESIZE_EDGE = 9;
const LANE_WEIGHT_STORAGE_KEY = 'life-map-manuscript-lane-weights-v1';
const LANE_WEIGHT_MIN = .18;
const LANE_WEIGHT_MAX = .65;
const DEFAULT_LANE_WEIGHTS: Record<LifeMapPlanGroupId, number> = { learning: .33, work: .33, life: .34 };

type ProjectDrag = {
  id: string;
  mode: 'move' | 'start' | 'end';
  pointerId: number;
  pointerDate: string;
  start: string;
  end: string;
  moved: boolean;
};

type ProjectHistoryAction = {
  id: string;
  before: Partial<Pick<LifeGoal, 'start' | 'targetDate' | 'status'>>;
  after: Partial<Pick<LifeGoal, 'start' | 'targetDate' | 'status'>>;
};

type CanvasCreateDraft = {
  categoryId: LifeMapPlanGroupId;
  start: string;
  end: string;
  moved: boolean;
};

type CanvasCreatePointer = {
  categoryId: LifeMapPlanGroupId;
  date: string;
  pointerId: number;
  y: number;
};

type LaneResize = {
  index: number;
  pointerId: number;
  startX: number;
  canvasWidth: number;
  weights: Record<LifeMapPlanGroupId, number>;
};

function readLaneWeights(): Record<LifeMapPlanGroupId, number> {
  try {
    const value = JSON.parse(localStorage.getItem(LANE_WEIGHT_STORAGE_KEY) ?? '') as Partial<Record<LifeMapPlanGroupId, number>>;
    const weights = MANUSCRIPT_CATEGORIES.map((category) => value[category.id]);
    const total = weights.reduce<number>((sum, weight) => sum + (weight ?? 0), 0);
    if (weights.every((weight) => typeof weight === 'number' && weight >= LANE_WEIGHT_MIN && weight <= LANE_WEIGHT_MAX) && Math.abs(total - 1) < .001) return value as Record<LifeMapPlanGroupId, number>;
  } catch { /* use the default layout */ }
  return { ...DEFAULT_LANE_WEIGHTS };
}

function resizeLaneBoundary(weights: Record<LifeMapPlanGroupId, number>, index: number, delta: number): Record<LifeMapPlanGroupId, number> {
  const leftId = MANUSCRIPT_CATEGORIES[index].id;
  const rightId = MANUSCRIPT_CATEGORIES[index + 1].id;
  const pairTotal = weights[leftId] + weights[rightId];
  const minimum = Math.max(LANE_WEIGHT_MIN, pairTotal - LANE_WEIGHT_MAX);
  const maximum = Math.min(LANE_WEIGHT_MAX, pairTotal - LANE_WEIGHT_MIN);
  const nextLeft = Math.min(maximum, Math.max(minimum, weights[leftId] + delta));
  return { ...weights, [leftId]: nextLeft, [rightId]: pairTotal - nextLeft };
}

interface Props {
  data: LifeMapData;
  selectedStageId: string | null;
  onSelectStage: (id: string | null) => void;
  onEditStage: (stage: LifeMapStage) => void;
  inspectorPinned: boolean;
  onToggleInspectorPin: () => void;
  onCreateStageAtDate: (date: string, endDate?: string, categoryId?: LifeMapPlanGroupId) => void;
  onCreateProjectAtDate: (date: string, endDate?: string, categoryId?: LifeMapPlanGroupId) => void;
  onOpenProject: (id: string) => void;
  onUpdateProject: (id: string, updates: Partial<LifeGoal>) => void;
  onAddNote: (note: Pick<LifeMapNote, 'name' | 'date' | 'type'> & Partial<LifeMapNote>) => void;
  onUpdateNote: (id: string, updates: Partial<LifeMapNote>) => void;
  onDeleteNote: (id: string) => void;
  onAddEvent: (event: Pick<LifeEvent, 'name' | 'date'> & Partial<LifeEvent>) => void;
  onUpdateEvent: (id: string, updates: Partial<LifeEvent>) => void;
  onDeleteEvent: (id: string) => void;
  onSetSystemCheckIn: (systemId: string, date: string, count: number) => void;
  onCreateReview: (date: string) => void;
  onOpenReview: (id: string) => void;
  showArchived: boolean;
  onToggleArchived: () => void;
  onManageProjectMaintenance: (id: string, name: string) => void;
  onManageAreaMaintenance: (id: string, name: string) => void;
  onOpenAreaManagement: () => void;
  onOpenBatchShift: (ids?: string[]) => void;
  onOpenClassicView: () => void;
}

function isVisible(y: number, top: number, bottom: number) { return y >= top && y <= bottom; }

function firstDayOfMonth(date: string) {
  const { year, month } = splitDate(date);
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

function firstMonthOnOrAfter(date: string) {
  return splitDate(date).day === 1 ? date : firstDayOfMonth(addDays(date, 32 - splitDate(date).day));
}

function nextMonthStart(date: string) {
  const { year, month } = splitDate(date);
  return `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
}

function firstDayOfWeek(date: string) { return addDays(date, -((getDayOfWeek(date) + 6) % 7)); }
function isQuarterStart(date: string) { const { month, day } = splitDate(date); return day === 1 && [1, 4, 7, 10].includes(month); }
function monthKey(date: string) { return date.slice(0, 7); }

function snapProjectDate(date: string, zoom: Zoom) {
  if (zoom !== 'week') return date;
  return addDays(date, -((getDayOfWeek(date) + 6) % 7));
}

function createRulerMarks(first: string, last: string, policy: typeof ZOOM_POLICY[Zoom]['ruler']) {
  if (policy === 'month') {
    const marks: string[] = [];
    for (let date = firstMonthOnOrAfter(first); date <= last; date = nextMonthStart(date)) marks.push(date);
    return marks;
  }
  if (policy === 'month-week') {
    const marks = new Set<string>();
    for (let date = firstDayOfWeek(first); date <= last; date = addDays(date, 7)) if (date >= first) marks.add(date);
    for (let date = firstDayOfMonth(first); date <= last; date = nextMonthStart(date)) {
      if (date >= first) marks.add(date);
      const middle = date.slice(0, 8) + '15';
      if (middle >= first && middle <= last) marks.add(middle);
    }
    return [...marks].sort();
  }
  const step = 1;
  const offset = 0;
  const marks: string[] = [];
  for (let date = addDays(first, offset); date <= last; date = addDays(date, step)) marks.push(date);
  return marks;
}

function formatRulerMonth(date: string, includeYear = true) {
  const { year, month } = splitDate(date);
  return includeYear ? `${year}年 ${String(month).padStart(2, '0')}月` : `${String(month).padStart(2, '0')}月`;
}

const LifeManuscriptView: React.FC<Props> = ({ data, selectedStageId, onSelectStage, onEditStage, inspectorPinned, onToggleInspectorPin, onCreateStageAtDate, onCreateProjectAtDate, onOpenProject, onUpdateProject, onAddNote, onUpdateNote, onDeleteNote, onAddEvent, onUpdateEvent, onDeleteEvent, onSetSystemCheckIn, onCreateReview, onOpenReview, showArchived, onToggleArchived, onManageProjectMaintenance, onManageAreaMaintenance, onOpenAreaManagement, onOpenBatchShift, onOpenClassicView }) => {
  const today = todayStr();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const worldRef = useRef<HTMLDivElement>(null);
  const pointerRef = useRef<CanvasCreatePointer | null>(null);
  const projectDragRef = useRef<ProjectDrag | null>(null);
  const laneResizeRef = useRef<LaneResize | null>(null);
  const suppressProjectClickRef = useRef<string | null>(null);
  const frameRef = useRef<number | null>(null);
  const initialFocus = useRef(true);
  const previousRange = useRef('');
  const pendingAnchor = useRef<string | null>(null);
  const [zoom, setZoom] = useState<Zoom>('day');
  const [laneWeights, setLaneWeights] = useState<Record<LifeMapPlanGroupId, number>>(readLaneWeights);
  const [laneMenu, setLaneMenu] = useState<LifeMapPlanGroupId | null>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 1, width: 1440 });
  const [filter, setFilter] = useState<LifeMapPlanGroupId | 'all'>('all');
  const [selected, setSelected] = useState<SelectedEntity>(null);
  const [quickPopover, setQuickPopover] = useState<QuickPopoverState | null>(null);
  const [inspectorTarget, setInspectorTarget] = useState<InspectorEntity | null>(null);
  const [noteEditor, setNoteEditor] = useState<{ id?: string; date: string; endDate: string; name: string; body: string; areaId: string; relatedGoalId: string; relatedStageId: string; importance: 'normal' | 'important' } | null>(null);
  const [eventEditor, setEventEditor] = useState<{ id?: string; date: string; name: string; areaId: string; relatedPlanId: string; importance: NonNullable<LifeEvent['importance']>; color: string } | null>(null);
  const [canvasCreateDraft, setCanvasCreateDraft] = useState<CanvasCreateDraft | null>(null);
  const [projectPreview, setProjectPreview] = useState<{ id: string; start: string; end: string } | null>(null);
  const [projectHistory, setProjectHistory] = useState<ProjectHistoryAction[]>([]);
  const [projectRedoHistory, setProjectRedoHistory] = useState<ProjectHistoryAction[]>([]);
  const [showOverflowNotes, setShowOverflowNotes] = useState(false);
  const [showClassicViewMenu, setShowClassicViewMenu] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [layers, setLayers] = useState<Record<ContentLayer, boolean>>({ stages: true, projects: true, systems: true, events: true, notes: true, reviews: true });
  const [statuses, setStatuses] = useState({ active: true, completed: true, paused: true, archived: true });
  const viewData = useMemo<LifeMapData>(() => ({
    ...data,
    lifeMapStages: layers.stages ? data.lifeMapStages : [],
    lifeMapGoals: layers.projects ? data.lifeMapGoals.filter((item) => statuses[item.status] && (showArchived || item.status !== 'archived')) : [],
    lifeMapSystems: layers.systems ? data.lifeMapSystems.filter((item) => statuses[item.status] && (showArchived || item.status !== 'archived')) : [],
    lifeMapEvents: layers.events ? data.lifeMapEvents : [],
    lifeMapNotes: layers.notes ? data.lifeMapNotes : [],
    lifeMapReviews: layers.reviews ? data.lifeMapReviews : [],
  }), [data, layers, showArchived, statuses]);
  const zoomPolicy = ZOOM_POLICY[zoom];
  const range = useMemo(() => getManuscriptDateRange(data, today), [data, today]);
  const mapper = useMemo(() => createLifeMapTimeMapper(range.baseDate, pixelsPerDay[zoom]), [range.baseDate, zoom]);
  const worldHeight = mapper.dateToWorldY(addDays(range.maxDate, 1));
  const visible = useMemo(() => ({ top: Math.max(0, viewport.top - viewport.height), bottom: Math.min(worldHeight, viewport.top + viewport.height * 2) }), [viewport, worldHeight]);
  const categories = useMemo(() => filter === 'all' ? MANUSCRIPT_CATEGORIES : MANUSCRIPT_CATEGORIES.filter((item) => item.id === filter), [filter]);
  const canResizeLanes = categories.length === MANUSCRIPT_CATEGORIES.length;
  const narrow = viewport.width < 1180;
  const compact = viewport.width < 840;
  const laneHeaderHeight = 52;
  const rulerWidth = compact ? 82 : narrow ? 196 : DESKTOP_RULER_WIDTH;
  const railWidth = narrow ? 0 : DESKTOP_RAIL_WIDTH;
  const availableCanvasWidth = Math.max(0, viewport.width - rulerWidth - railWidth);
  const categoryWidths = useMemo(() => {
    if (categories.length !== MANUSCRIPT_CATEGORIES.length) return categories.map(() => availableCanvasWidth / categories.length);
    const widths = categories.slice(0, -1).map((category) => availableCanvasWidth * laneWeights[category.id]);
    return [...widths, availableCanvasWidth - widths.reduce((total, width) => total + width, 0)];
  }, [availableCanvasWidth, categories, laneWeights]);
  const canvasWidth = availableCanvasWidth;
  const worldMinWidth = rulerWidth + railWidth + canvasWidth;
  const stages = useMemo(() => viewData.lifeMapStages.filter((stage) => !stage.deletedAt && mapper.dateToWorldY(addDays(stage.end, 1)) >= visible.top && mapper.dateToWorldY(stage.start) <= visible.bottom), [mapper, viewData.lifeMapStages, visible]);
  const notes = useMemo(() => viewData.lifeMapNotes.filter((note) => !note.deletedAt && mapper.dateToWorldY(addDays(note.endDate ?? note.date, 1)) >= visible.top && mapper.dateToWorldY(note.date) <= visible.bottom), [mapper, viewData.lifeMapNotes, visible]);
  const annotationGroups = useMemo(() => assignAnnotationTracks(notes), [notes]);
  const displayedAnnotationGroups = useMemo(() => {
    if (zoomPolicy.annotations === 'aggregate') return [];
    return annotationGroups.filter((item) => showOverflowNotes || item.track < 3);
  }, [annotationGroups, showOverflowNotes, zoomPolicy.annotations]);
  const annotationPresentations = useMemo(() => new Map(displayedAnnotationGroups.map((item) => [item.id, resolveAnnotationPresentation(item.start, item.end, mapper)])), [displayedAnnotationGroups, mapper]);
  const annotationText = useMemo(() => resolveAnnotationTextCollisions(displayedAnnotationGroups.map((item) => {
    const presentation = annotationPresentations.get(item.id)!;
    const first = item.notes[0];
    const showHeading = !first?.body || Boolean(first.relatedGoalId) || item.notes.length > 1;
    const bodyLines = (first?.body ?? '').split('\n').reduce((count, line) => count + Math.max(1, Math.ceil(line.length / 12)), 0);
    const lineCount = (showHeading ? 1 : 0) + bodyLines;
    const textHeight = Math.max(26, (presentation.kind === 'range' ? Math.min(5, lineCount) : Math.min(2, lineCount)) * 26);
    return { id: item.id, anchorY: presentation.center, height: textHeight };
  }), 12, 120), [annotationPresentations, displayedAnnotationGroups]);
  const textById = useMemo(() => new Map(annotationText.map((item) => [item.id, item])), [annotationText]);
  const todayY = mapper.dateToWorldY(today);
  const rangeKey = `${range.baseDate}:${range.maxDate}`;

  const updateViewport = useCallback(() => {
    const element = scrollerRef.current;
    if (element) setViewport({ top: element.scrollTop, height: element.clientHeight || 1, width: element.clientWidth || 1440 });
  }, []);
  const locateToday = useCallback((behavior: ScrollBehavior = 'smooth') => {
    const element = scrollerRef.current;
    if (!element) return;
    const reducedMotion = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    element.scrollTo({
      top: Math.max(0, todayY - element.clientHeight * .253),
      behavior: reducedMotion && behavior === 'smooth' ? 'auto' : behavior,
    });
  }, [todayY]);
  useLayoutEffect(() => {
    const element = scrollerRef.current;
    if (!element) return;
    const rangeChanged = previousRange.current !== '' && previousRange.current !== rangeKey;
    previousRange.current = rangeKey;
    if (initialFocus.current || rangeChanged) { initialFocus.current = false; locateToday('auto'); }
    else if (pendingAnchor.current) { element.scrollTop = Math.max(0, mapper.dateToWorldY(pendingAnchor.current) - (element.clientHeight - laneHeaderHeight) / 2); pendingAnchor.current = null; }
    updateViewport();
  }, [laneHeaderHeight, locateToday, mapper, rangeKey, updateViewport, worldHeight]);
  useEffect(() => {
    const element = scrollerRef.current;
    if (!element) return undefined;
    const observer = new ResizeObserver(updateViewport); observer.observe(element);
    const onScroll = () => { if (frameRef.current !== null) return; frameRef.current = requestAnimationFrame(() => { frameRef.current = null; updateViewport(); }); };
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => { observer.disconnect(); element.removeEventListener('scroll', onScroll); if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); };
  }, [updateViewport]);
  useEffect(() => {
    localStorage.setItem(LANE_WEIGHT_STORAGE_KEY, JSON.stringify(laneWeights));
  }, [laneWeights]);
  const changeZoom = (next: Zoom) => {
    const element = scrollerRef.current;
    pendingAnchor.current = element ? mapper.worldYToDate(element.scrollTop + (element.clientHeight - laneHeaderHeight) / 2) : today;
    setZoom(next);
  };
  const beginLaneResize = (event: React.PointerEvent<HTMLDivElement>, index: number) => {
    if (event.button !== 0) return;
    laneResizeRef.current = { index, pointerId: event.pointerId, startX: event.clientX, canvasWidth: availableCanvasWidth, weights: laneWeights };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
    event.stopPropagation();
  };
  const moveLaneResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const resize = laneResizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    setLaneWeights(resizeLaneBoundary(resize.weights, resize.index, (event.clientX - resize.startX) / Math.max(1, resize.canvasWidth)));
    event.preventDefault();
    event.stopPropagation();
  };
  const finishLaneResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (laneResizeRef.current?.pointerId !== event.pointerId) return;
    laneResizeRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    event.stopPropagation();
  };
  const focusLane = (id: LifeMapPlanGroupId) => {
    setLaneWeights({ learning: id === 'learning' ? .5 : .25, work: id === 'work' ? .5 : .25, life: id === 'life' ? .5 : .25 });
    setLaneMenu(null);
  };
  const dateFromClientY = useCallback((clientY: number) => {
    const bounds = worldRef.current?.getBoundingClientRect();
    return mapper.worldYToDate(bounds ? clientY - bounds.top : 0);
  }, [mapper]);
  const dateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => dateFromClientY(event.clientY);
  const updateProjectWithHistory = useCallback((id: string, updates: Partial<Pick<LifeGoal, 'start' | 'targetDate' | 'status'>>) => {
    if (id.startsWith('timeline-project:')) return;
    const current = data.lifeMapGoals.find((item) => !item.deletedAt && item.id === id);
    if (!current) return;
    const before: ProjectHistoryAction['before'] = {};
    const after: ProjectHistoryAction['after'] = {};
    if (updates.start !== undefined && updates.start !== current.start) {
      before.start = current.start;
      after.start = updates.start;
    }
    if (updates.targetDate !== undefined && updates.targetDate !== current.targetDate) {
      before.targetDate = current.targetDate;
      after.targetDate = updates.targetDate;
    }
    if (updates.status !== undefined && updates.status !== current.status) {
      before.status = current.status;
      after.status = updates.status;
    }
    if (Object.keys(after).length === 0) return;
    onUpdateProject(id, after);
    setProjectHistory((history) => [...history.slice(-49), { id, before, after }]);
    setProjectRedoHistory([]);
  }, [data.lifeMapGoals, onUpdateProject]);
  const undoProjectUpdate = useCallback(() => {
    const action = projectHistory.at(-1);
    if (!action) return;
    onUpdateProject(action.id, action.before);
    setProjectHistory((history) => history.slice(0, -1));
    setProjectRedoHistory((history) => [...history.slice(-49), action]);
  }, [onUpdateProject, projectHistory]);
  const redoProjectUpdate = useCallback(() => {
    const action = projectRedoHistory.at(-1);
    if (!action) return;
    onUpdateProject(action.id, action.after);
    setProjectRedoHistory((history) => history.slice(0, -1));
    setProjectHistory((history) => [...history.slice(-49), action]);
  }, [onUpdateProject, projectRedoHistory]);
  useEffect(() => {
    const handleUndoRedo = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      if (event.shiftKey) redoProjectUpdate(); else undoProjectUpdate();
    };
    addEventListener('keydown', handleUndoRedo);
    return () => removeEventListener('keydown', handleUndoRedo);
  }, [redoProjectUpdate, undoProjectUpdate]);
  const beginProjectDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>, project: Pick<LifeGoal, 'id' | 'start' | 'targetDate'>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const offset = event.clientY - rect.top;
    const mode: ProjectDrag['mode'] = offset <= PROJECT_RESIZE_EDGE ? 'start' : rect.height - offset <= PROJECT_RESIZE_EDGE ? 'end' : 'move';
    projectDragRef.current = { id: project.id, mode, pointerId: event.pointerId, pointerDate: snapProjectDate(dateFromClientY(event.clientY), zoom), start: project.start, end: project.targetDate, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
  }, [dateFromClientY, zoom]);
  const moveProjectDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = projectDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const date = snapProjectDate(dateFromClientY(event.clientY), zoom);
    const offset = diffDays(date, drag.pointerDate);
    const start = drag.mode === 'move' ? addDays(drag.start, offset) : drag.mode === 'start' ? (date > drag.end ? drag.end : date) : drag.start;
    const end = drag.mode === 'move' ? addDays(drag.end, offset) : drag.mode === 'end' ? (date < drag.start ? drag.start : date) : drag.end;
    drag.moved ||= start !== drag.start || end !== drag.end;
    setProjectPreview({ id: drag.id, start, end });
    event.stopPropagation();
  }, [dateFromClientY, zoom]);
  const finishProjectDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const drag = projectDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const date = snapProjectDate(dateFromClientY(event.clientY), zoom);
    const offset = diffDays(date, drag.pointerDate);
    const preview = {
      id: drag.id,
      start: drag.mode === 'move' ? addDays(drag.start, offset) : drag.mode === 'start' ? (date > drag.end ? drag.end : date) : drag.start,
      end: drag.mode === 'move' ? addDays(drag.end, offset) : drag.mode === 'end' ? (date < drag.start ? drag.start : date) : drag.end,
    };
    projectDragRef.current = null;
    setProjectPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved) {
      suppressProjectClickRef.current = drag.id;
      updateProjectWithHistory(drag.id, { start: preview.start, targetDate: preview.end });
      event.preventDefault();
    }
    event.stopPropagation();
  }, [dateFromClientY, updateProjectWithHistory, zoom]);
  const cancelProjectDrag = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (projectDragRef.current?.pointerId !== event.pointerId) return;
    projectDragRef.current = null;
    setProjectPreview(null);
  }, []);
  const openInspector = useCallback((target: InspectorEntity) => {
    setQuickPopover(null);
    if (target.type === 'stage') {
      setInspectorTarget(null);
      onSelectStage(target.id);
      return;
    }
    onSelectStage(null);
    setInspectorTarget(target);
  }, [onSelectStage]);
  const selectEntity = useCallback((target: InspectorEntity, anchor: Element) => {
    const rect = anchor.getBoundingClientRect();
    const width = 248;
    const x = rect.right + 10 <= window.innerWidth - width - 12 ? rect.right + 10 : Math.max(12, rect.left - width - 10);
    const y = Math.max(12, Math.min(rect.top, window.innerHeight - 170));
    setSelected(target);
    setQuickPopover({ ...target, x, y });
    if (inspectorPinned) openInspector(target);
    else {
      // A temporary inspector belongs to its original object. Selecting something
      // else returns to the unobstructed canvas instead of showing stale details.
      if (inspectorTarget) setInspectorTarget(null);
      if (selectedStageId) onSelectStage(null);
    }
  }, [inspectorPinned, inspectorTarget, onSelectStage, openInspector, selectedStageId]);
  const showProjectDetails = useCallback((id: string, anchor: Element) => {
    if (suppressProjectClickRef.current === id) { suppressProjectClickRef.current = null; return; }
    selectEntity({ type: 'project', id }, anchor);
  }, [selectEntity]);
  const showAnnotationDetails = useCallback((id: string, anchor: Element) => {
    selectEntity({ type: 'annotation', id }, anchor);
  }, [selectEntity]);
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showAdvancedFilters) { setShowAdvancedFilters(false); return; }
      if (showClassicViewMenu) { setShowClassicViewMenu(false); return; }
      if (quickPopover) { setQuickPopover(null); setSelected(null); return; }
      if (inspectorTarget) { setInspectorTarget(null); return; }
      if (selectedStageId) onSelectStage(null);
      else if (eventEditor) setEventEditor(null);
      else if (noteEditor) setNoteEditor(null);
      else setSelected(null);
    };
    addEventListener('keydown', handleEscape);
    return () => removeEventListener('keydown', handleEscape);
  }, [eventEditor, inspectorTarget, noteEditor, onSelectStage, quickPopover, selectedStageId, showAdvancedFilters, showClassicViewMenu]);
  const beginCanvasCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    const interactiveTarget = target.closest<HTMLElement>('button, input, textarea, select, a, [role="button"], .life-manuscript__annotation-rail');
    if (interactiveTarget) return;
    const categoryElement = target.closest<HTMLElement>('[data-manuscript-category]');
    const categoryIdFromElement = categoryElement?.dataset.manuscriptCategory as LifeMapPlanGroupId | undefined;
    const categoriesElement = target.closest<HTMLElement>('.life-manuscript__categories');
    const categoryX = categoriesElement ? event.clientX - categoriesElement.getBoundingClientRect().left : -1;
    const categoryIndexFromX = categoriesElement ? categoryWidths.findIndex((width, index) => {
      const left = categoryWidths.slice(0, index).reduce((total, value) => total + value, 0);
      return categoryX >= left && categoryX < left + width;
    }) : -1;
    const categoryId = categoryIdFromElement ?? categories[categoryIndexFromX]?.id;
    if (!categoryId) return;
    const date = dateFromPointer(event);
    pointerRef.current = { y: event.clientY, date, pointerId: event.pointerId, categoryId };
    setCanvasCreateDraft({ categoryId, start: date, end: date, moved: false });
    setSelected(null);
    setQuickPopover(null);
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveCanvasCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const current = dateFromPointer(event);
    setCanvasCreateDraft({
      categoryId: start.categoryId,
      start: start.date < current ? start.date : current,
      end: start.date < current ? current : start.date,
      moved: Math.abs(event.clientY - start.y) >= 5,
    });
  };
  const finishCanvasCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = pointerRef.current; pointerRef.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const endDate = dateFromPointer(event);
    if (Math.abs(event.clientY - start.y) < 5) {
      setCanvasCreateDraft(null);
      return;
    }
    setCanvasCreateDraft({
      categoryId: start.categoryId,
      start: start.date < endDate ? start.date : endDate,
      end: start.date < endDate ? endDate : start.date,
      moved: true,
    });
  };
  const cancelCanvasCreate = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pointerRef.current?.pointerId !== event.pointerId) return;
    pointerRef.current = null;
    setCanvasCreateDraft(null);
  };
  const submitNote = (event: React.FormEvent) => {
    event.preventDefault(); if (!noteEditor?.name.trim()) return;
    const changes = { name: noteEditor.name.trim(), body: noteEditor.body.trim(), date: noteEditor.date, endDate: noteEditor.endDate === noteEditor.date ? undefined : noteEditor.endDate, type: noteEditor.endDate === noteEditor.date ? 'pin' as const : 'range' as const, areaId: noteEditor.areaId || undefined, relatedGoalId: noteEditor.relatedGoalId || undefined, relatedStageId: noteEditor.relatedStageId || undefined, importance: noteEditor.importance };
    if (noteEditor.id) onUpdateNote(noteEditor.id, changes); else onAddNote(changes);
    setNoteEditor(null);
  };
  const openNote = (note: LifeMapNote) => setNoteEditor({ id: note.id, date: note.date, endDate: note.endDate ?? note.date, name: note.name, body: note.body ?? '', areaId: note.areaId ?? '', relatedGoalId: note.relatedGoalId ?? '', relatedStageId: note.relatedStageId ?? '', importance: note.importance ?? 'normal' });
  const openEvent = (item: LifeEvent) => setEventEditor({ id: item.id, date: item.date, name: item.name, areaId: item.areaId ?? '', relatedPlanId: item.relatedPlanId ?? '', importance: item.importance ?? 'normal', color: item.color ?? '#E58A2B' });
  const createEvent = (date = mapper.worldYToDate(viewport.top + viewport.height / 2)) => setEventEditor({ date, name: '', areaId: '', relatedPlanId: '', importance: 'important', color: '#E58A2B' });
  const createNote = (date = mapper.worldYToDate(viewport.top + viewport.height / 2), endDate = date) => setNoteEditor({ date, endDate, name: '', body: '', areaId: '', relatedGoalId: '', relatedStageId: '', importance: 'normal' });
  const submitEvent = (event: React.FormEvent) => {
    event.preventDefault();
    if (!eventEditor?.name.trim()) return;
    const changes = { name: eventEditor.name.trim(), date: eventEditor.date, areaId: eventEditor.areaId || undefined, relatedPlanId: eventEditor.relatedPlanId || undefined, importance: eventEditor.importance, color: eventEditor.color };
    if (eventEditor.id) onUpdateEvent(eventEditor.id, changes); else onAddEvent(changes);
    setEventEditor(null);
  };
  const visibleStartDate = mapper.worldYToDate(visible.top);
  const visibleEndDate = mapper.worldYToDate(visible.bottom);
  const marks = useMemo(() => createRulerMarks(visibleStartDate, visibleEndDate, zoomPolicy.ruler), [visibleEndDate, visibleStartDate, zoomPolicy.ruler]);
  const gridMarks = useMemo(() => createRulerMarks(visibleStartDate, visibleEndDate, zoomPolicy.ruler), [visibleEndDate, visibleStartDate, zoomPolicy.ruler]);
  const overflowCount = annotationGroups.filter((item) => item.track >= 3).reduce((count, item) => count + item.notes.length, 0);
  const rulerLabel = (date: string) => {
    if (zoomPolicy.ruler === 'month') return formatRulerMonth(date, false);
    if (zoomPolicy.ruler === 'month-week') return splitDate(date).day === 1 ? formatRulerMonth(date, false) : splitDate(date).day === 15 ? '月中' : `W${Math.ceil(splitDate(date).day / 7)}`;
    if (zoom === 'week' || zoom === 'day') return `${['日', '一', '二', '三', '四', '五', '六'][getDayOfWeek(date)]} ${splitDate(date).day}`;
    return String(splitDate(date).day).padStart(2, '0');
  };
  const rulerFocusDate = mapper.worldYToDate(Math.max(0, viewport.top + pixelsPerDay[zoom] / 2));
  const gridStep = pixelsPerDay[zoom] * (zoomPolicy.ruler === 'month' ? 30 : 1);
  const canvasDraftAreaId = canvasCreateDraft ? getManuscriptAreas(data, canvasCreateDraft.categoryId)[0]?.id ?? '' : '';
  const canvasDraftCategory = canvasCreateDraft ? MANUSCRIPT_CATEGORIES.find((item) => item.id === canvasCreateDraft.categoryId) : undefined;
  const canvasDraftColumnIndex = canvasCreateDraft ? categories.findIndex((item) => item.id === canvasCreateDraft.categoryId) : -1;
  const closeCanvasCreate = () => setCanvasCreateDraft(null);
  const createProjectFromCanvas = () => {
    if (!canvasCreateDraft) return;
    onCreateProjectAtDate(canvasCreateDraft.start, canvasCreateDraft.end, canvasCreateDraft.categoryId);
    closeCanvasCreate();
  };
  const createStageFromCanvas = () => {
    if (!canvasCreateDraft) return;
    onCreateStageAtDate(canvasCreateDraft.start, canvasCreateDraft.end, canvasCreateDraft.categoryId);
    closeCanvasCreate();
  };
  const createNoteFromCanvas = () => {
    if (!canvasCreateDraft) return;
    setNoteEditor({ date: canvasCreateDraft.start, endDate: canvasCreateDraft.end, name: '', body: '', areaId: canvasDraftAreaId, relatedGoalId: '', relatedStageId: '', importance: 'normal' });
    closeCanvasCreate();
  };

  return <main className={`life-manuscript life-manuscript--${zoom}${narrow ? ' is-compact' : ''}${compact ? ' is-phone' : ''}`} aria-label="人生地图" style={{ '--manuscript-ruler': `${rulerWidth}px`, '--manuscript-canvas': `${canvasWidth}px`, '--manuscript-rail': `${railWidth}px`, '--manuscript-grid-step': `${gridStep}px` } as React.CSSProperties}>
    <div className="life-manuscript__page">
    <Card bare className="life-manuscript__panel">
    <WorkspaceHeader className="life-manuscript__toolbar" aria-label="人生地图工作区">
      <div className="ui-workspace-header__identity">
        <span className="ui-workspace-header__identity-icon"><MapIcon size={17} aria-hidden="true" /></span>
        <div className="ui-workspace-header__identity-copy"><h1>人生地图</h1><p>长期规划与回顾</p></div>
      </div>
      <div className="life-manuscript__commands ui-workspace-header__actions">
        <button type="button" className="ds-header-btn" onClick={() => onCreateStageAtDate(mapper.worldYToDate(viewport.top + viewport.height / 2))}><Plus size={16} />新建阶段</button>
        <button type="button" className="tl-workspace-primary-btn" onClick={() => onCreateProjectAtDate(mapper.worldYToDate(viewport.top + viewport.height / 2))}><Plus size={17} /><span>添加项目</span></button>
        <button type="button" className="ds-header-btn" onClick={() => createEvent()}><Diamond size={15} />关键日期</button>
        <button type="button" className="ds-header-btn" onClick={() => createNote()}><StickyNote size={15} />时间注记</button>
        <div className="tl-workspace-year life-manuscript__zoom" role="group" aria-label="时间缩放">{(['year', 'month', 'week', 'day'] as Zoom[]).map((item) => <button key={item} type="button" aria-pressed={zoom === item} onClick={() => changeZoom(item)}>{{ year: '年', month: '月', week: '周', day: '日' }[item]}</button>)}</div>
        <button type="button" className="ds-header-btn life-manuscript__today-button" aria-label="定位到今天" onClick={() => locateToday()}>今天</button>
        <button type="button" className="ds-header-btn" aria-label="更多人生地图选项" aria-expanded={showClassicViewMenu} onClick={() => setShowClassicViewMenu((open) => !open)}><MoreHorizontal size={18} /></button>
        {showClassicViewMenu && <div className="life-manuscript__fallback-menu" role="menu" aria-label="更多人生地图选项"><section role="group" aria-label="时间规划"><b>时间规划</b><button type="button" role="menuitem" onClick={() => { setShowClassicViewMenu(false); const date = mapper.worldYToDate(viewport.top + viewport.height / 2); createNote(date, addDays(date, 30)); }}>添加时期重点</button><button type="button" role="menuitem" onClick={() => { setShowClassicViewMenu(false); onCreateReview(mapper.worldYToDate(viewport.top + viewport.height / 2)); }}>新建周期复盘</button></section><section role="group" aria-label="管理视图"><b>管理视图</b><button type="button" role="menuitem" onClick={() => { setShowClassicViewMenu(false); onOpenAreaManagement(); }}>管理人生领域</button><button type="button" role="menuitem" onClick={() => { setShowClassicViewMenu(false); onOpenBatchShift(); }}>批量调整计划</button><button type="button" role="menuitem" onClick={() => { setShowClassicViewMenu(false); onToggleArchived(); }}>{showArchived ? '隐藏归档内容' : '显示归档内容'}</button><button type="button" role="menuitem" onClick={() => { setShowClassicViewMenu(false); setShowAdvancedFilters(true); }}>高级筛选</button></section><section className="life-manuscript__fallback-legacy" role="group" aria-label="兼容选项"><button type="button" role="menuitem" onClick={onOpenClassicView}><span>经典人生地图</span><small>旧版布局，临时保留</small></button></section></div>}
      </div>
    </WorkspaceHeader>
    {showAdvancedFilters && <aside className="life-manuscript__advanced-filters" role="dialog" aria-label="人生地图高级筛选"><header><span><b>高级筛选</b><small>只改变当前视图，不修改数据</small></span><button type="button" aria-label="关闭高级筛选" onClick={() => setShowAdvancedFilters(false)}><X size={15} /></button></header><section><b>显示内容</b>{([['stages', '人生时期'], ['projects', '人生计划'], ['systems', '长期系统'], ['events', '关键日期'], ['notes', '时间注记'], ['reviews', '周期复盘']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={layers[key]} onChange={() => setLayers((current) => ({ ...current, [key]: !current[key] }))} />{label}</label>)}</section><section><b>项目与系统状态</b>{([['active', '进行中'], ['completed', '已完成'], ['paused', '已暂停']] as const).map(([key, label]) => <label key={key}><input type="checkbox" checked={statuses[key]} onChange={() => setStatuses((current) => ({ ...current, [key]: !current[key] }))} />{label}</label>)}<label><input type="checkbox" checked={showArchived && statuses.archived} onChange={() => { if (!showArchived) onToggleArchived(); else setStatuses((current) => ({ ...current, archived: !current.archived })); }} />已归档</label></section><section className="life-manuscript__maintenance-filter"><b>领域维护</b>{data.lifeMapAreas.filter((area) => !area.deletedAt && !area.isHidden).map((area) => { const active = activeMaintenancePeriod(area.maintenancePeriods); return <button type="button" key={area.id} className={active ? 'is-active' : ''} onClick={() => { setShowAdvancedFilters(false); onManageAreaMaintenance(area.id, area.name); }}><span style={{ background: area.color }} /><b>{area.name}</b><small>{active ? `维护中 · ${active.start}` : '正常运行'}</small></button>; })}</section></aside>}
    <div className="life-manuscript__filters" role="tablist" aria-label="分类筛选"><button type="button" role="tab" aria-selected={filter === 'all'} onClick={() => setFilter('all')}>全部</button>{MANUSCRIPT_CATEGORIES.map((category) => <button key={category.id} type="button" role="tab" aria-selected={filter === category.id} onClick={() => setFilter(category.id)}>{category.name}</button>)}</div>
    <div ref={scrollerRef} className={`life-manuscript__scroller${canvasCreateDraft ? ' is-drafting-canvas' : ''}`} onPointerDown={beginCanvasCreate} onPointerMove={moveCanvasCreate} onPointerUp={finishCanvasCreate} onPointerCancel={cancelCanvasCreate}>
      <div className="life-manuscript__sticky-headings" style={{ marginLeft: rulerWidth, width: canvasWidth, gridTemplateColumns: categoryWidths.map((width) => `${width}px`).join(' ') }}>{categories.map((category) => <div key={category.id} className="life-manuscript__lane-heading"><b>{category.name}</b>{canResizeLanes && <><button type="button" className="life-manuscript__lane-menu-trigger" aria-label={`${category.name}分类布局选项`} aria-expanded={laneMenu === category.id} onClick={() => setLaneMenu((open) => open === category.id ? null : category.id)}><MoreHorizontal size={15} /></button>{laneMenu === category.id && <div className="life-manuscript__lane-menu" role="menu" aria-label={`${category.name}分类布局选项`}><button type="button" role="menuitem" onClick={() => focusLane(category.id)}>聚焦此领域</button><button type="button" role="menuitem" onClick={() => { setLaneWeights({ ...DEFAULT_LANE_WEIGHTS }); setLaneMenu(null); }}>恢复均分</button></div>}</>}</div>)}</div>
      <div ref={worldRef} className="life-manuscript__world" style={{ height: worldHeight, minWidth: worldMinWidth, gridTemplateColumns: `${rulerWidth}px ${canvasWidth}px${railWidth ? ` ${railWidth}px` : ''}` }}>
        <aside className={`life-manuscript__ruler is-${zoomPolicy.ruler}`} aria-label="日期刻度"><header>{formatRulerMonth(rulerFocusDate)}</header>{marks.map((date) => { const isMonthStart = splitDate(date).day === 1; const isToday = date === today; const quarterStart = isQuarterStart(date); return <div key={date} data-date={date} className={`life-manuscript__tick${isMonthStart ? ' is-month-start' : ''}${quarterStart ? ' is-quarter-start' : ''}${isToday ? ' is-today' : ''}`} style={{ top: mapper.dateToWorldY(date) }}>{isMonthStart && zoomPolicy.ruler === 'day' && <strong className="life-manuscript__month-boundary">{formatRulerMonth(date, splitDate(date).month === 1)}</strong>}<i className="life-manuscript__tick-rule" aria-hidden="true" /><time>{rulerLabel(date)}</time>{isToday && <span className="life-manuscript__tick-today-label">今天</span>}</div>; })}<RulerEventLayer data={viewData} mapper={mapper} visible={visible} today={today} zoom={zoom} onSelect={(id) => { setSelected({ type: 'event', id }); openInspector({ type: 'event', id }); }} /><RulerReviewLayer reviews={viewData.lifeMapReviews} mapper={mapper} visible={visible} onOpen={onOpenReview} /></aside>
        <section className="life-manuscript__categories" style={{ gridTemplateColumns: categoryWidths.map((width) => `${width}px`).join(' ') }}>
          <div className="life-manuscript__grid-lines" aria-hidden="true">{gridMarks.map((date) => <i key={date} data-date={date} style={{ top: mapper.dateToWorldY(date) }} />)}</div>
          <GlobalStageLayer stages={stages.filter((stage) => !stage.areaIds?.length)} mapper={mapper} canvasWidth={canvasWidth} selectedStageId={selected?.type === 'stage' ? selected.id : selectedStageId} today={today} zoom={zoom} onSelectStage={(id, anchor) => selectEntity({ type: 'stage', id }, anchor)} onOpenStageInspector={(id) => openInspector({ type: 'stage', id })} />
          {categories.map((category, index) => <CategoryColumn key={category.id} data={viewData} groupId={category.id} stages={stages} mapper={mapper} visible={visible} viewportTop={viewport.top} columnWidth={categoryWidths[index]} selectedStageId={selected?.type === 'stage' ? selected.id : selectedStageId} selectedProjectId={selected?.type === 'project' ? selected.id : null} today={today} zoom={zoom} projectPreview={projectPreview} canvasCreateDraft={canvasCreateDraft?.categoryId === category.id ? canvasCreateDraft : null} onSelectStage={(id, anchor) => selectEntity({ type: 'stage', id }, anchor)} onOpenStageInspector={(id) => openInspector({ type: 'stage', id })} onShowProject={showProjectDetails} onOpenProjectInspector={(id) => openInspector({ type: 'project', id })} onOpenSystem={(id) => openInspector({ type: 'system', id })} onProjectPointerDown={beginProjectDrag} onProjectPointerMove={moveProjectDrag} onProjectPointerUp={finishProjectDrag} onProjectPointerCancel={cancelProjectDrag} />)}
          {canResizeLanes && [0, 1].map((index) => <div key={index} className="life-manuscript__lane-resizer" data-lane-boundary={index === 0 ? 'learning-work' : 'work-life'} role="separator" aria-orientation="vertical" aria-label={`调整${categories[index].name}和${categories[index + 1].name}列宽`} style={{ left: categoryWidths.slice(0, index + 1).reduce((total, width) => total + width, 0) }} onPointerDown={(event) => beginLaneResize(event, index)} onPointerMove={moveLaneResize} onPointerUp={finishLaneResize} onPointerCancel={finishLaneResize} />)}
        </section>
        {railWidth > 0 && zoomPolicy.annotations === 'aggregate' && <YearAnnotationSummary notes={notes} mapper={mapper} />}
        {railWidth > 0 && zoomPolicy.annotations !== 'aggregate' && <section className="life-manuscript__annotation-rail" aria-label="时间注记">
          <svg className="life-manuscript__braces" width="100%" height={worldHeight} aria-label="时间注记日期标记">{displayedAnnotationGroups.map((group) => {
            const presentation = annotationPresentations.get(group.id)!; const x = 22 + (presentation.kind === 'single' ? 0 : group.track * 20); const markerX = x + 8; const first = group.notes[0]; const color = first.color ?? (group.importance === 'important' ? '#2f9a61' : '#5d36bd'); const label = group.start === group.end ? `${group.start} · ${first.name}` : `${group.start} 至 ${group.end} · ${first.name}`; const open = (target: Element) => showAnnotationDetails(first.id, target);
            if (presentation.kind === 'single') return <g key={group.id} className="life-manuscript__single-note-marker" role="button" tabIndex={0} aria-label={label} onClick={(event) => open(event.currentTarget)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') open(event.currentTarget); }}><title>{label}</title><circle className="life-manuscript__marker-hit" cx={markerX} cy={presentation.center} r="12" /><circle cx={markerX} cy={presentation.center} r="5" fill={color} data-anchor-y={presentation.center} /></g>;
            if (presentation.kind === 'compact-range') return <g key={group.id} className="life-manuscript__compact-range" role="button" tabIndex={0} aria-label={label} onClick={(event) => open(event.currentTarget)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') open(event.currentTarget); }}><title>{label}</title><line className="life-manuscript__compact-hit" x1={markerX} y1={presentation.top} x2={markerX} y2={presentation.bottom} /><line x1={markerX} y1={presentation.top} x2={markerX} y2={presentation.bottom} stroke={color} strokeWidth="1.5" /><circle cx={markerX} cy={presentation.top} r="2.5" fill={color} data-start-y={presentation.top} /><circle cx={markerX} cy={presentation.bottom} r="2.5" fill={color} data-end-y={presentation.bottom} /></g>;
            return <path key={group.id} d={createVerticalAnnotationBracePath(x, presentation.top, presentation.bottom)} data-start-y={presentation.top} data-end-y={presentation.bottom} className={`life-manuscript__brace${group.importance === 'important' ? ' is-important' : ''}`} style={{ stroke: color }} />;
          })}</svg>
          {displayedAnnotationGroups.map((group) => { const placement = textById.get(group.id); const presentation = annotationPresentations.get(group.id); const first = group.notes[0]; if (!placement || !presentation) return null; const braceX = 22 + (presentation.kind === 'single' ? 0 : group.track * 20); const textLeft = braceX + 38; const preferredTextWidth = presentation.kind === 'single' ? 212 : 204; const textWidth = Math.min(preferredTextWidth, Math.max(120, railWidth - textLeft - 12)); const showHeading = zoomPolicy.annotations === 'anchor' || !first.body || Boolean(first.relatedGoalId) || group.notes.length > 1; return <button key={group.id} type="button" data-annotation-kind={presentation.kind} className={`life-manuscript__annotation is-${presentation.kind}${zoomPolicy.annotations === 'anchor' ? ' is-anchor' : ''}${placement.collapsed ? ' is-collapsed' : ''}${selected?.type === 'annotation' && selected.id === first.id ? ' is-selected' : ''}`} style={{ top: placement.y, left: textLeft, width: textWidth, color: first.color ?? (first.importance === 'important' ? '#2f8f5b' : '#5632b6') }} onClick={(event) => showAnnotationDetails(first.id, event.currentTarget)} onDoubleClick={() => openInspector({ type: 'annotation', id: first.id })}><small>{group.start === group.end ? formatDate(group.start, 'M.D') : `${formatDate(group.start, 'M.D')} — ${formatDate(group.end, 'M.D')}`}</small>{showHeading && <b>{group.notes.length > 1 ? `${first.name} · ${group.notes.length} 条注记` : first.name}</b>}{zoomPolicy.annotations === 'full' && !placement.collapsed && first.body && <span>{first.body}</span>}</button>; })}
          {overflowCount > 0 && <button type="button" className="life-manuscript__annotation-overflow" style={{ top: Math.max(24, viewport.top + 14) }} onClick={() => setShowOverflowNotes((value) => !value)}>{showOverflowNotes ? '收起额外注记' : `+${overflowCount} 条注记`}</button>}
        </section>}
        {canvasCreateDraft?.moved && canvasDraftCategory && canvasDraftColumnIndex >= 0 && <section className="life-manuscript__canvas-create-menu" role="dialog" aria-label={`在${canvasDraftCategory.name}创建内容`} style={{ top: mapper.dateToWorldY(canvasCreateDraft.end) + 10, left: rulerWidth + categoryWidths.slice(0, canvasDraftColumnIndex).reduce((total, width) => total + width, 0) + 12 }} onPointerDown={(event) => event.stopPropagation()}><header><b>{canvasDraftCategory.name} · {canvasCreateDraft.start.slice(5)} — {canvasCreateDraft.end.slice(5)}</b><button type="button" aria-label="取消创建" onClick={closeCanvasCreate}><X size={14} /></button></header><div><button type="button" onClick={createProjectFromCanvas}>新建项目</button><button type="button" onClick={createStageFromCanvas}>新建阶段</button><button type="button" onClick={createNoteFromCanvas}>新建时期重点</button></div></section>}
        {isVisible(todayY, visible.top, visible.bottom) && <><div className="life-manuscript__today-band" style={{ top: todayY }} aria-hidden="true" /><div className="life-manuscript__today" style={{ top: todayY }} aria-hidden="true" /></>}
      </div>
    </div>
    </Card>
    </div>
    {quickPopover && <QuickPopover target={quickPopover} data={data} onClose={() => { setQuickPopover(null); setSelected(null); }} onOpenDetails={() => openInspector(quickPopover)} onEditStage={onEditStage} onEditProject={onOpenProject} onEditNote={openNote} onCompleteProject={(id) => updateProjectWithHistory(id, { status: 'completed' })} />}
    {inspectorTarget?.type === 'project' && <ProjectDetailDrawer project={data.lifeMapGoals.find((item) => !item.deletedAt && item.id === inspectorTarget.id)} parentProject={data.lifeMapGoals.find((item) => !item.deletedAt && item.id === data.lifeMapGoals.find((goal) => goal.id === inspectorTarget.id)?.parentGoalId)} pinned={inspectorPinned} onTogglePin={onToggleInspectorPin} onClose={() => setInspectorTarget(null)} onEdit={onOpenProject} onComplete={(id) => updateProjectWithHistory(id, { status: 'completed' })} onManageMaintenance={onManageProjectMaintenance} onBatchShift={(id) => onOpenBatchShift([id])} />}
    {inspectorTarget?.type === 'annotation' && <AnnotationDetailDrawer note={data.lifeMapNotes.find((item) => !item.deletedAt && item.id === inspectorTarget.id)} data={data} pinned={inspectorPinned} onTogglePin={onToggleInspectorPin} onClose={() => setInspectorTarget(null)} onEdit={openNote} onDelete={(id) => { onDeleteNote(id); setInspectorTarget(null); setSelected(null); }} />}
    {inspectorTarget?.type === 'event' && <EventDetailDrawer item={data.lifeMapEvents.find((entry) => !entry.deletedAt && entry.id === inspectorTarget.id)} data={data} onClose={() => setInspectorTarget(null)} onEdit={openEvent} onDelete={(id) => { onDeleteEvent(id); setInspectorTarget(null); setSelected(null); }} />}
    {inspectorTarget?.type === 'system' && <SystemDetailDrawer system={data.lifeMapSystems.find((item) => !item.deletedAt && item.id === inspectorTarget.id)} data={data} today={today} onClose={() => setInspectorTarget(null)} onSetCheckIn={onSetSystemCheckIn} onManageAreaMaintenance={onManageAreaMaintenance} />}
    {noteEditor && <form className="life-manuscript__editor" onSubmit={submitNote}><section><header><span><small>人生地图 · 时间注记</small><h2>{noteEditor.id ? '编辑' : '添加'}{noteEditor.endDate === noteEditor.date ? '时间点注记' : '时期重点'}</h2></span><button type="button" onClick={() => setNoteEditor(null)} aria-label="关闭"><X /></button></header><label>标题<input autoFocus required value={noteEditor.name} onChange={(event) => setNoteEditor({ ...noteEditor, name: event.target.value })} placeholder="这段时间最值得记住什么？" /></label><label>正文<textarea rows={5} value={noteEditor.body} onChange={(event) => setNoteEditor({ ...noteEditor, body: event.target.value })} placeholder="记录事实、感受或你想如何理解这段时间…" /></label><div><label>开始日期<input required type="date" value={noteEditor.date} onChange={(event) => setNoteEditor({ ...noteEditor, date: event.target.value, endDate: event.target.value > noteEditor.endDate ? event.target.value : noteEditor.endDate })} /></label><label>结束日期<input required type="date" min={noteEditor.date} value={noteEditor.endDate} onChange={(event) => setNoteEditor({ ...noteEditor, endDate: event.target.value })} /></label></div><label>关联分类<select value={noteEditor.areaId} onChange={(event) => setNoteEditor({ ...noteEditor, areaId: event.target.value })}><option value="">全局人生记录</option>{data.lifeMapAreas.filter((area) => !area.deletedAt).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>关联人生计划<select value={noteEditor.relatedGoalId} onChange={(event) => setNoteEditor({ ...noteEditor, relatedGoalId: event.target.value })}><option value="">不关联</option>{data.lifeMapGoals.filter((goal) => !goal.deletedAt && goal.kind === 'plan' && !goal.id.startsWith('timeline-project:')).map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}</select></label><label>关联人生时期<select value={noteEditor.relatedStageId} onChange={(event) => setNoteEditor({ ...noteEditor, relatedStageId: event.target.value })}><option value="">不关联</option>{data.lifeMapStages.filter((stage) => !stage.deletedAt).map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></label><label>重要性<select value={noteEditor.importance} onChange={(event) => setNoteEditor({ ...noteEditor, importance: event.target.value as 'normal' | 'important' })}><option value="normal">普通</option><option value="important">重要</option></select></label><footer>{noteEditor.id && <button type="button" className="is-danger" onClick={() => { if (window.confirm(`删除“${noteEditor.name}”时间注记？`)) { onDeleteNote(noteEditor.id!); setNoteEditor(null); } }}>删除</button>}<span /><button type="button" onClick={() => setNoteEditor(null)}>取消</button><button className="is-primary" type="submit">保存</button></footer></section></form>}
    {eventEditor && <form className="life-manuscript__editor" onSubmit={submitEvent}><section><header><span><small>人生地图</small><h2>{eventEditor.id ? '编辑关键日期' : '添加关键日期'}</h2></span><button type="button" onClick={() => setEventEditor(null)} aria-label="关闭"><X /></button></header><label>名称<input autoFocus required value={eventEditor.name} onChange={(event) => setEventEditor({ ...eventEditor, name: event.target.value })} placeholder="例如：考试、纪念日或结果公布" /></label><label>日期<input required type="date" value={eventEditor.date} onChange={(event) => setEventEditor({ ...eventEditor, date: event.target.value })} /></label><label>重要性<select value={eventEditor.importance} onChange={(event) => setEventEditor({ ...eventEditor, importance: event.target.value as NonNullable<LifeEvent['importance']> })}><option value="normal">普通</option><option value="important">重要</option><option value="core">核心</option></select></label><label>关联分类<select value={eventEditor.areaId} onChange={(event) => setEventEditor({ ...eventEditor, areaId: event.target.value })}><option value="">全部人生</option>{data.lifeMapAreas.filter((area) => !area.deletedAt).map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>关联人生计划<select value={eventEditor.relatedPlanId} onChange={(event) => setEventEditor({ ...eventEditor, relatedPlanId: event.target.value })}><option value="">不关联</option>{data.lifeMapGoals.filter((goal) => !goal.deletedAt && goal.kind === 'plan').map((goal) => <option key={goal.id} value={goal.id}>{goal.name}</option>)}</select></label><label>识别色<input type="color" value={eventEditor.color} onChange={(event) => setEventEditor({ ...eventEditor, color: event.target.value })} /></label><footer><button type="button" onClick={() => setEventEditor(null)}>取消</button><button className="is-primary" type="submit">保存关键日期</button></footer></section></form>}
  </main>;
};

interface CategoryColumnProps {
  data: LifeMapData;
  groupId: LifeMapPlanGroupId;
  stages: LifeMapStage[];
  mapper: ReturnType<typeof createLifeMapTimeMapper>;
  visible: { top: number; bottom: number };
  viewportTop: number;
  columnWidth: number;
  selectedStageId: string | null;
  selectedProjectId: string | null;
  today: string;
  zoom: Zoom;
  projectPreview: { id: string; start: string; end: string } | null;
  canvasCreateDraft: CanvasCreateDraft | null;
  onSelectStage: (id: string, anchor: Element) => void;
  onOpenStageInspector: (id: string) => void;
  onShowProject: (id: string, anchor: Element) => void;
  onOpenProjectInspector: (id: string) => void;
  onOpenSystem: (id: string) => void;
  onProjectPointerDown: (event: React.PointerEvent<HTMLButtonElement>, project: Pick<LifeGoal, 'id' | 'start' | 'targetDate'>) => void;
  onProjectPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onProjectPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onProjectPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
}

const CategoryColumn: React.FC<CategoryColumnProps> = ({ data, groupId, stages, mapper, visible, viewportTop, columnWidth, selectedStageId, selectedProjectId, today, zoom, projectPreview, canvasCreateDraft, onSelectStage, onOpenStageInspector, onShowProject, onOpenProjectInspector, onOpenSystem, onProjectPointerDown, onProjectPointerMove, onProjectPointerUp, onProjectPointerCancel }) => {
  const category = MANUSCRIPT_CATEGORIES.find((item) => item.id === groupId)!;
  const areas = useMemo(() => getManuscriptAreas(data, groupId), [data, groupId]);
  const areaIds = useMemo(() => new Set(areas.map((area) => area.id)), [areas]);
  const projectLanes = useMemo(() => getCategoryProjectLanes(data, groupId), [data, groupId]);
  const visibleProjects = projectLanes.filter(({ item }) => mapper.dateToWorldY(addDays(item.targetDate, 1)) >= visible.top && mapper.dateToWorldY(item.start) <= visible.bottom);
  const categoryStages = stages.filter((stage) => stage.areaIds?.length && stage.areaIds.some((areaId) => areaIds.has(areaId)));
  const parentProjects = [...new Map(projectLanes.flatMap(({ item }) => item.parentProject ? [[item.parentProject.id, item.parentProject] as const] : []).filter(([, project]) => mapper.dateToWorldY(addDays(project.targetDate, 1)) >= visible.top && mapper.dateToWorldY(project.start) <= visible.bottom)).values()];

  const draftTop = canvasCreateDraft ? mapper.dateToWorldY(canvasCreateDraft.start) : 0;
  const draftBottom = canvasCreateDraft ? mapper.dateToWorldY(addDays(canvasCreateDraft.end, 1)) : 0;

  const projectDisplay = ZOOM_POLICY[zoom].projects;
  return <article className={`life-manuscript__category is-${projectDisplay}-projects`} data-manuscript-category={groupId} aria-label={category.name}>
    <div className="life-manuscript__category-stage-layer" aria-label={`${category.name}阶段背景`}>
      {categoryStages.map((stage) => {
        const top = mapper.dateToWorldY(stage.start);
        const bottom = mapper.dateToWorldY(addDays(stage.end, 1));
        return <button key={stage.id} type="button" data-stage-id={stage.id} data-start-y={top} data-end-y={bottom} className={`life-manuscript__stage is-${zoom}${selectedStageId === stage.id ? ' is-selected' : ''}${stage.start <= today && stage.end >= today ? ' is-current' : ''}`} style={{ top, height: bottom - top, left: 0, width: columnWidth, '--stage-color': stage.color ?? '#7c6fe6' } as React.CSSProperties} onClick={(event) => onSelectStage(stage.id, event.currentTarget)} onDoubleClick={() => onOpenStageInspector(stage.id)}><span className="life-manuscript__stage-label"><b>{stage.name}</b>{zoom !== 'year' && <small>{stage.start.slice(5)} — {stage.end.slice(5)}</small>}</span></button>;
      })}
    </div>
    <div className="life-manuscript__parent-project-layer" aria-label={`${category.name}父项目范围`}>
      {parentProjects.map((project) => {
        const top = mapper.dateToWorldY(project.start);
        const projectColor = project.color ?? (groupId === 'learning' ? '#6840c6' : groupId === 'work' ? '#3971cf' : '#ee6272');
        const children = projectLanes.filter(({ item }) => item.parentProject?.id === project.id);
        const bounds = children.map(({ laneIndex, laneCount }) => {
          const width = Math.min(100, (columnWidth - CATEGORY_PADDING * 2 - PROJECT_GAP * (laneCount - 1)) / laneCount);
          const left = CATEGORY_PADDING + laneIndex * (width + PROJECT_GAP);
          return { left, right: left + width };
        });
        const left = Math.min(...bounds.map((item) => item.left));
        const right = Math.max(...bounds.map((item) => item.right));
        return <button key={project.id} type="button" title={`${project.name} · ${project.start} — ${project.targetDate}`} aria-label={`${project.name}，父项目分组：${project.start} 至 ${project.targetDate}`} data-parent-project-id={project.id} className="life-manuscript__parent-project-range" style={{ top: Math.max(0, top - 23), height: 23, left, width: right - left, '--project-color': projectColor } as React.CSSProperties} onClick={(event) => onShowProject(project.id, event.currentTarget)} onDoubleClick={() => onOpenProjectInspector(project.id)}><span className="life-manuscript__parent-project-label">{project.name} · {project.start.slice(5)}—{project.targetDate.slice(5)}</span></button>;
      })}
    </div>
    <div className="life-manuscript__project-layer" aria-label={`${category.name}项目`}>
      {projectDisplay === 'summary' ? <YearProjectSummaries data={data} groupId={groupId} mapper={mapper} visible={visible} onShowProject={onShowProject} onOpenProjectInspector={onOpenProjectInspector} /> : visibleProjects.map(({ item: project, laneIndex, laneCount, overlapGroup }) => {
        const dates = projectPreview?.id === project.id ? projectPreview : project;
        const top = mapper.dateToWorldY(dates.start);
        const bottom = mapper.dateToWorldY(addDays(dates.end, 1));
        const height = bottom - top;
        const availableWidth = columnWidth - CATEGORY_PADDING * 2 - PROJECT_GAP * (laneCount - 1);
        const projectWidth = Math.min(100, availableWidth / laneCount);
        const left = CATEGORY_PADDING + laneIndex * (projectWidth + PROJECT_GAP);
        const projectColor = project.color ?? (groupId === 'learning' ? '#6840c6' : groupId === 'work' ? '#3971cf' : '#ee6272');
        const heightDensity = height < 24 ? ' is-tiny' : height < 40 ? ' is-name-only' : height < 72 ? ' is-start-only' : ' is-full';
        const widthDensity = projectWidth < 60 ? ' is-ultra-narrow' : projectWidth < 80 ? ' is-compact-width' : '';
        const todayMaskTop = mapper.dateToWorldY(today) - top;
        const hasTodayMask = dates.start <= today && dates.end >= today;
        const sharedProps = { project, dates, top, height, left, projectWidth, projectColor, heightDensity, widthDensity, hasTodayMask, todayMaskTop, selected: selectedProjectId === project.id, dragging: projectPreview?.id === project.id, overlapGroup, interactive: zoom === 'day' && !project.id.startsWith('timeline-project:'), onShowProject, onOpenProjectInspector, onProjectPointerDown, onProjectPointerMove, onProjectPointerUp, onProjectPointerCancel };
        return projectDisplay === 'compact' ? <MonthCompactProjectBar key={project.id} {...sharedProps} /> : projectDisplay === 'detailed' ? <DayDetailedProjectBar key={project.id} {...sharedProps} /> : <WeekProjectBar key={project.id} {...sharedProps} />;
      })}
    </div>
    {ZOOM_POLICY[zoom].systems && <SystemSummaries data={data} areas={areas.map((area) => area.id)} mapper={mapper} visible={visible} viewportTop={viewportTop} onOpen={onOpenSystem} />}
    {ZOOM_POLICY[zoom].systems && <SystemDots data={data} areas={areas.map((area) => area.id)} mapper={mapper} visible={visible} zoom={zoom} />}
    {canvasCreateDraft && <i className="life-manuscript__canvas-create-range" aria-hidden="true" style={{ top: draftTop, height: Math.max(1, draftBottom - draftTop) }} />}
  </article>;
};

type ProjectBarProps = {
  project: ManuscriptProjectStrip;
  dates: { start: string; end: string };
  top: number; height: number; left: number; projectWidth: number; projectColor: string;
  heightDensity: string; widthDensity: string; hasTodayMask: boolean; todayMaskTop: number;
  selected: boolean; dragging: boolean; overlapGroup: number; interactive: boolean;
  onShowProject: (id: string, anchor: Element) => void;
  onOpenProjectInspector: (id: string) => void;
  onProjectPointerDown: (event: React.PointerEvent<HTMLButtonElement>, project: Pick<LifeGoal, 'id' | 'start' | 'targetDate'>) => void;
  onProjectPointerMove: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onProjectPointerUp: (event: React.PointerEvent<HTMLButtonElement>) => void;
  onProjectPointerCancel: (event: React.PointerEvent<HTMLButtonElement>) => void;
};

const projectBarProps = (props: ProjectBarProps, variant: 'month' | 'week' | 'day') => ({
  type: 'button' as const,
  title: `${props.project.name} · ${props.dates.start} — ${props.dates.end}${props.project.parentProject ? ` · 所属：${props.project.parentProject.name}` : ''}`,
  'aria-label': `${props.project.name}，${props.dates.start} 至 ${props.dates.end}`,
  'data-project-id': props.project.id,
  'data-parent-project-id': props.project.parentProject?.id,
  'data-overlap-group': props.overlapGroup,
  className: `life-manuscript__project-strip life-manuscript__${variant}-project${props.project.id.startsWith('timeline-project:') ? ' is-projection' : ''}${props.project.status === 'archived' ? ' is-archived' : ''}${activeMaintenancePeriod(props.project.maintenancePeriods) ? ' is-maintenance' : ''}${props.heightDensity}${props.widthDensity}${props.hasTodayMask ? ' is-current' : ''}${props.selected ? ' is-selected' : ''}${props.dragging ? ' is-dragging' : ''}`,
  style: { top: props.top, height: props.height, left: props.left, width: props.projectWidth, '--project-color': props.projectColor } as React.CSSProperties,
  onPointerDown: props.interactive ? (event: React.PointerEvent<HTMLButtonElement>) => props.onProjectPointerDown(event, props.project) : undefined,
  onPointerMove: props.interactive ? props.onProjectPointerMove : undefined,
  onPointerUp: props.interactive ? props.onProjectPointerUp : undefined,
  onPointerCancel: props.interactive ? props.onProjectPointerCancel : undefined,
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => props.onShowProject(props.project.id, event.currentTarget),
  onDoubleClick: () => props.onOpenProjectInspector(props.project.id),
});

const MonthCompactProjectBar: React.FC<ProjectBarProps> = (props) => <button {...projectBarProps(props, 'month')}>
  <span className="life-manuscript__project-strip-header"><b>{props.project.id.startsWith('timeline-project:') ? '↗ ' : ''}{props.project.name}</b><small>{props.dates.start.slice(5)}</small></span>
</button>;

const WeekProjectBar: React.FC<ProjectBarProps> = (props) => <button {...projectBarProps(props, 'week')}>
  {props.hasTodayMask && <i className="life-manuscript__project-today-mask" style={{ top: props.todayMaskTop - 2 }} aria-hidden="true" />}
  <span className="life-manuscript__project-strip-header"><b>{props.project.id.startsWith('timeline-project:') ? '↗ ' : ''}{props.project.name}</b><small>{props.dates.start.slice(5)}</small></span><span className="life-manuscript__project-strip-body" aria-hidden="true" /><em>{props.dates.end.slice(5)}</em>
</button>;

const DayDetailedProjectBar: React.FC<ProjectBarProps> = (props) => <button {...projectBarProps(props, 'day')}>
  {props.hasTodayMask && <i className="life-manuscript__project-today-mask" style={{ top: props.todayMaskTop - 2 }} aria-hidden="true" />}
  <span className="life-manuscript__project-strip-header"><b>{props.project.id.startsWith('timeline-project:') ? '↗ ' : ''}{props.project.name}</b><small>{props.dates.start.slice(5)} · {props.project.id.startsWith('timeline-project:') ? '项目规划' : props.project.status === 'completed' ? '已完成' : props.project.status === 'paused' ? '已暂停' : props.project.status === 'archived' ? '已归档' : activeMaintenancePeriod(props.project.maintenancePeriods) ? '维护中' : '进行中'}</small></span><span className="life-manuscript__project-strip-body" aria-hidden="true" /><em>{props.dates.end.slice(5)}</em>
</button>;

const YearProjectSummaries: React.FC<{ data: LifeMapData; groupId: LifeMapPlanGroupId; mapper: ReturnType<typeof createLifeMapTimeMapper>; visible: { top: number; bottom: number }; onShowProject: (id: string, anchor: Element) => void; onOpenProjectInspector: (id: string) => void }> = ({ data, groupId, mapper, visible, onShowProject, onOpenProjectInspector }) => {
  const summaries = getCategoryProjectTracks(data, groupId).filter(({ item }) => mapper.dateToWorldY(addDays(item.targetDate, 1)) >= visible.top && mapper.dateToWorldY(item.start) <= visible.bottom);
  const childCounts = new Map(data.lifeMapGoals.filter((goal) => !goal.deletedAt && goal.kind === 'phase' && goal.parentGoalId).map((goal) => [goal.parentGoalId!, 0]));
  data.lifeMapGoals.filter((goal) => !goal.deletedAt && goal.kind === 'phase' && goal.parentGoalId).forEach((goal) => childCounts.set(goal.parentGoalId!, (childCounts.get(goal.parentGoalId!) ?? 0) + 1));
  return <>{summaries.map(({ item: project, track }) => {
    const top = mapper.dateToWorldY(project.start);
    const bottom = mapper.dateToWorldY(addDays(project.targetDate, 1));
    const count = childCounts.get(project.id) ?? 0;
    const color = project.color ?? (groupId === 'learning' ? '#6840c6' : groupId === 'work' ? '#3971cf' : '#ee6272');
    const projected = project.id.startsWith('timeline-project:');
    return <button key={project.id} type="button" data-project-id={project.id} className={`life-manuscript__year-project-summary${projected ? ' is-projection' : ''}${project.status === 'archived' ? ' is-archived' : ''}${activeMaintenancePeriod(project.maintenancePeriods) ? ' is-maintenance' : ''}`} style={{ top, height: Math.max(18, bottom - top), left: 14 + track * 52, '--project-color': color } as React.CSSProperties} title={`${project.name} · ${project.start} — ${project.targetDate}`} onClick={(event) => onShowProject(project.id, event.currentTarget)} onDoubleClick={() => onOpenProjectInspector(project.id)}><b>{projected ? '↗ ' : ''}{project.name}</b><small>{projected ? '项目规划' : project.status === 'archived' ? '已归档' : activeMaintenancePeriod(project.maintenancePeriods) ? '维护中' : count > 0 ? `${count} 项推进` : `${monthKey(project.start)} 重点`}</small></button>;
  })}</>;
};

const YearAnnotationSummary: React.FC<{ notes: LifeMapNote[]; mapper: ReturnType<typeof createLifeMapTimeMapper> }> = ({ notes, mapper }) => {
  const grouped = new Map<string, LifeMapNote[]>();
  notes.forEach((note) => grouped.set(monthKey(note.date), [...(grouped.get(monthKey(note.date)) ?? []), note]));
  return <section className="life-manuscript__year-annotation-summary" aria-label="年度时间注记摘要">{[...grouped.entries()].map(([month, entries]) => <span key={month} style={{ top: mapper.dateToWorldY(`${month}-01`) }}>+{entries.length} 条注记</span>)}</section>;
};

const GlobalStageLayer: React.FC<{ stages: LifeMapStage[]; mapper: ReturnType<typeof createLifeMapTimeMapper>; canvasWidth: number; selectedStageId: string | null; today: string; zoom: Zoom; onSelectStage: (id: string, anchor: Element) => void; onOpenStageInspector: (id: string) => void }> = ({ stages, mapper, canvasWidth, selectedStageId, today, zoom, onSelectStage, onOpenStageInspector }) => <div className="life-manuscript__global-stage-layer" aria-label="全局阶段背景">{stages.map((stage) => {
  const top = mapper.dateToWorldY(stage.start);
  const bottom = mapper.dateToWorldY(addDays(stage.end, 1));
  return <button key={stage.id} type="button" data-stage-id={stage.id} data-start-y={top} data-end-y={bottom} className={`life-manuscript__stage is-${zoom}${selectedStageId === stage.id ? ' is-selected' : ''}${stage.start <= today && stage.end >= today ? ' is-current' : ''}`} style={{ top, height: bottom - top, left: 0, width: canvasWidth, '--stage-color': stage.color ?? '#7c6fe6' } as React.CSSProperties} onClick={(event) => onSelectStage(stage.id, event.currentTarget)} onDoubleClick={() => onOpenStageInspector(stage.id)}><span className="life-manuscript__stage-label"><b>{stage.name}</b>{zoom !== 'year' && <small>{stage.start.slice(5)} — {stage.end.slice(5)}</small>}</span></button>;
})}</div>;

const QuickPopover: React.FC<{
  target: QuickPopoverState;
  data: LifeMapData;
  onClose: () => void;
  onOpenDetails: () => void;
  onEditStage: (stage: LifeMapStage) => void;
  onEditProject: (id: string) => void;
  onEditNote: (note: LifeMapNote) => void;
  onCompleteProject: (id: string) => void;
}> = ({ target, data, onClose, onOpenDetails, onEditStage, onEditProject, onEditNote, onCompleteProject }) => {
  const stage = target.type === 'stage' ? data.lifeMapStages.find((item) => !item.deletedAt && item.id === target.id) : undefined;
  const project = target.type === 'project' ? data.lifeMapGoals.find((item) => !item.deletedAt && item.id === target.id) : undefined;
  const note = target.type === 'annotation' ? data.lifeMapNotes.find((item) => !item.deletedAt && item.id === target.id) : undefined;
  if (!stage && !project && !note) return null;
  const projected = Boolean(project?.id.startsWith('timeline-project:'));
  const title = stage?.name ?? project?.name ?? note!.name;
  const dates = stage ? `${stage.start} — ${stage.end}` : project ? `${project.start} — ${project.targetDate}` : `${note!.date}${note!.endDate && note!.endDate !== note!.date ? ` — ${note!.endDate}` : ''}`;
  const kind = stage ? '人生阶段' : project ? (projected ? '↗ 项目规划投影' : project.kind === 'phase' ? '子项目' : '项目') : '时间注记';
  const status = project ? (project.status === 'completed' ? '已完成' : project.status === 'paused' ? '已暂停' : project.status === 'archived' ? '已归档' : activeMaintenancePeriod(project.maintenancePeriods) ? '维护中' : '进行中') : stage ? (stage.start <= todayStr() && stage.end >= todayStr() ? '进行中' : stage.end < todayStr() ? '已结束' : '未开始') : undefined;
  return <aside className="life-manuscript__quick-popover" role="dialog" aria-label={`${title}快捷操作`} style={{ left: target.x, top: target.y }} onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" className="life-manuscript__quick-popover-close" onClick={onClose} aria-label="关闭快捷操作"><X size={14} /></button>
    <small>{kind}</small>
    <h3>{title}</h3>
    <p>{dates}{status ? ` · ${status}` : ''}</p>
    <footer>
      <button type="button" onClick={onOpenDetails}>详情</button>
      {stage && <button type="button" onClick={() => onEditStage(stage)}>编辑</button>}
      {project && <button type="button" onClick={() => onEditProject(project.id)}>{projected ? '打开原项目' : '编辑'}</button>}
      {note && <button type="button" onClick={() => onEditNote(note)}>编辑</button>}
      {project && !projected && project.status !== 'completed' && <button type="button" className="is-primary" onClick={() => onCompleteProject(project.id)}>完成</button>}
    </footer>
  </aside>;
};

const ProjectDetailDrawer: React.FC<{ project?: LifeGoal; parentProject?: LifeGoal; pinned: boolean; onTogglePin: () => void; onClose: () => void; onEdit: (id: string) => void; onComplete: (id: string) => void; onManageMaintenance: (id: string, name: string) => void; onBatchShift: (id: string) => void }> = ({ project, parentProject, pinned, onTogglePin, onClose, onEdit, onComplete, onManageMaintenance, onBatchShift }) => {
  if (!project) return null;
  const projected = project.id.startsWith('timeline-project:');
  const maintenanceProject = parentProject ?? (project.kind === 'plan' ? project : undefined);
  const maintenance = activeMaintenancePeriod(maintenanceProject?.maintenancePeriods);
  return <aside className="context-inspector life-manuscript__project-detail" aria-label={`${project.name}项目检查器`}>
    <button type="button" className={`life-manuscript__project-detail-pin${pinned ? ' is-active' : ''}`} aria-label={pinned ? '取消固定检查器' : '固定检查器'} title={pinned ? '取消固定' : '固定'} onClick={onTogglePin}>{pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
    <button type="button" className="life-manuscript__project-detail-close" aria-label="关闭详情" onClick={onClose}><X size={16} /></button>
    <small>{projected ? '↗ 项目规划 · 只读投影' : project.kind === 'phase' ? '子项目' : '项目'}</small>
    <h2>{project.name}</h2>
    <p>{project.start} — {project.targetDate}</p>
    {parentProject && <p>所属：{parentProject.name}</p>}
    <p>状态：{project.status === 'completed' ? '已完成' : project.status === 'paused' ? '已暂停' : project.status === 'archived' ? '已归档' : maintenance ? `维护中 · ${maintenance.start}` : '进行中'}</p>
    <footer>{!projected && maintenanceProject && <button type="button" onClick={() => onManageMaintenance(maintenanceProject.id, maintenanceProject.name)}>{maintenance ? '结束维护' : '进入维护'}</button>}{!projected && <button type="button" onClick={() => onBatchShift(project.id)}>调整日期</button>}<button type="button" className={projected ? 'is-primary' : ''} onClick={() => onEdit(project.id)}>{projected ? '打开原项目' : '编辑'}</button>{!projected && project.status !== 'completed' && project.status !== 'archived' && <button type="button" className="is-primary" onClick={() => onComplete(project.id)}>完成</button>}</footer>
  </aside>;
};

const AnnotationDetailDrawer: React.FC<{ note?: LifeMapNote; data: LifeMapData; pinned: boolean; onTogglePin: () => void; onClose: () => void; onEdit: (note: LifeMapNote) => void; onDelete: (id: string) => void }> = ({ note, data, pinned, onTogglePin, onClose, onEdit, onDelete }) => {
  if (!note) return null;
  const plan = note.relatedGoalId ? data.lifeMapGoals.find((item) => !item.deletedAt && item.id === note.relatedGoalId) : undefined;
  const stage = note.relatedStageId ? data.lifeMapStages.find((item) => !item.deletedAt && item.id === note.relatedStageId) : undefined;
  return <aside className="context-inspector life-manuscript__project-detail life-manuscript__note-detail" aria-label={`${note.name}时间注记检查器`}>
    <button type="button" className={`life-manuscript__project-detail-pin${pinned ? ' is-active' : ''}`} aria-label={pinned ? '取消固定检查器' : '固定检查器'} title={pinned ? '取消固定' : '固定'} onClick={onTogglePin}>{pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
    <button type="button" className="life-manuscript__project-detail-close" aria-label="关闭时间注记检查器" onClick={onClose}><X size={16} /></button>
    <small>时间注记 · {note.endDate && note.endDate !== note.date ? '时期重点' : '时间点'}</small>
    <h2>{note.name}</h2>
    <p>{note.date}{note.endDate && note.endDate !== note.date ? ` — ${note.endDate}` : ''}</p>
    {note.body ? <p className="life-manuscript__note-detail-body">{note.body}</p> : <p>暂无补充说明</p>}
    {plan && <p>关联计划：{plan.name}</p>}{stage && <p>关联时期：{stage.name}</p>}
    <footer><button type="button" className="is-danger" onClick={() => { if (window.confirm(`删除“${note.name}”时间注记？`)) onDelete(note.id); }}>删除</button><button type="button" className="is-primary" onClick={() => onEdit(note)}>编辑</button></footer>
  </aside>;
};

const EventDetailDrawer: React.FC<{ item?: LifeEvent; data: LifeMapData; onClose: () => void; onEdit: (item: LifeEvent) => void; onDelete: (id: string) => void }> = ({ item, data, onClose, onEdit, onDelete }) => {
  if (!item) return null;
  const area = item.areaId ? data.lifeMapAreas.find((entry) => !entry.deletedAt && entry.id === item.areaId) : undefined;
  const plan = item.relatedPlanId ? data.lifeMapGoals.find((entry) => !entry.deletedAt && entry.id === item.relatedPlanId) : undefined;
  return <aside className="context-inspector life-manuscript__project-detail life-manuscript__event-detail" aria-label={`${item.name}关键日期检查器`}>
    <button type="button" className="life-manuscript__project-detail-close" aria-label="关闭关键日期详情" onClick={onClose}><X size={16} /></button>
    <small>关键日期 · {item.importance === 'core' ? '核心' : item.importance === 'important' ? '重要' : '普通'}</small>
    <h2>{item.name}</h2>
    <p>{item.date}</p>
    <p>范围：{area?.name ?? '全部人生'}</p>
    {plan && <p>关联计划：{plan.name}</p>}
    <footer><button type="button" className="is-danger" onClick={() => { if (window.confirm(`删除“${item.name}”关键日期？`)) onDelete(item.id); }}>删除</button><button type="button" className="is-primary" onClick={() => onEdit(item)}>编辑</button></footer>
  </aside>;
};

const SystemDetailDrawer: React.FC<{ system?: LifeSystem; data: LifeMapData; today: string; onClose: () => void; onSetCheckIn: (systemId: string, date: string, count: number) => void; onManageAreaMaintenance: (id: string, name: string) => void }> = ({ system, data, today, onClose, onSetCheckIn, onManageAreaMaintenance }) => {
  if (!system) return null;
  const area = data.lifeMapAreas.find((item) => !item.deletedAt && item.id === system.areaId);
  const maintenance = activeMaintenancePeriod(mergeMaintenancePeriods(system.maintenancePeriods, area?.maintenancePeriods));
  const stats = currentSystemStats({ ...system, maintenancePeriods: mergeMaintenancePeriods(system.maintenancePeriods, area?.maintenancePeriods) }, data.lifeMapSystemCheckIns);
  const todayCount = data.lifeMapSystemCheckIns.find((item) => !item.deletedAt && item.systemId === system.id && item.date === today)?.count ?? 0;
  return <aside className="context-inspector life-manuscript__project-detail life-manuscript__system-detail" aria-label={`${system.name}长期系统检查器`}>
    <button type="button" className="life-manuscript__project-detail-close" aria-label="关闭长期系统详情" onClick={onClose}><X size={16} /></button>
    <small>长期系统 · {area?.name ?? '未分类'}</small>
    <h2>{system.name}</h2>
    <p>{system.start}{system.end ? ` — ${system.end}` : ' 起长期持续'}</p>
    <p>状态：{system.status === 'completed' ? '已完成' : system.status === 'paused' ? '已暂停' : system.status === 'archived' ? '已归档' : maintenance ? `维护中 · ${maintenance.start}` : '进行中'}</p>
    <p>频率：{system.frequency === 'daily' ? '每天' : system.frequency === 'weekly' ? '每周' : '每月'} · 目标 {system.targetCount}{system.unit ?? '次'}</p>
    <p className="life-manuscript__system-progress"><b>{stats.label} {stats.completed}/{stats.target}{system.unit ?? '次'}</b><span><i style={{ width: `${stats.target > 0 ? Math.min(100, stats.completed / stats.target * 100) : 0}%` }} /></span></p>
    {system.status === 'active' && !maintenance && <div className="life-manuscript__system-checkin" role="group" aria-label={`${system.name}今天打卡`}><span>今天</span><button type="button" disabled={todayCount <= 0} onClick={() => onSetCheckIn(system.id, today, todayCount - 1)}>−</button><b>{todayCount}</b><button type="button" onClick={() => onSetCheckIn(system.id, today, todayCount + 1)}>+</button></div>}
    {area && <footer><button type="button" onClick={() => onManageAreaMaintenance(area.id, area.name)}>{activeMaintenancePeriod(area.maintenancePeriods) ? '结束领域维护' : '领域进入维护'}</button></footer>}
  </aside>;
};

const SystemSummaries: React.FC<{ data: LifeMapData; areas: string[]; mapper: ReturnType<typeof createLifeMapTimeMapper>; visible: { top: number; bottom: number }; viewportTop: number; onOpen: (id: string) => void }> = ({ data, areas, mapper, visible, viewportTop, onOpen }) => {
  const systems = data.lifeMapSystems.filter((system) => !system.deletedAt && areas.includes(system.areaId) && (!system.end || mapper.dateToWorldY(system.end) >= visible.top) && mapper.dateToWorldY(system.start) <= visible.bottom);
  return <div className="life-manuscript__system-summaries">{systems.map((system, index) => {
    const area = data.lifeMapAreas.find((item) => !item.deletedAt && item.id === system.areaId);
    const maintenance = activeMaintenancePeriod(mergeMaintenancePeriods(system.maintenancePeriods, area?.maintenancePeriods));
    const stats = currentSystemStats({ ...system, maintenancePeriods: mergeMaintenancePeriods(system.maintenancePeriods, area?.maintenancePeriods) }, data.lifeMapSystemCheckIns);
    const reached = stats.target > 0 && stats.completed >= stats.target;
    const meta = system.status === 'completed' ? '已完成' : system.status === 'paused' ? '已暂停' : system.status === 'archived' ? '已归档' : maintenance ? '维护中 · 不计失败' : `${stats.label} ${stats.completed}/${stats.target}`;
    return <button key={system.id} type="button" className={`${reached ? 'is-reached' : ''}${system.status === 'archived' ? ' is-archived' : ''}${maintenance ? ' is-maintenance' : ''}`} style={{ top: Math.max(mapper.dateToWorldY(system.start), viewportTop + 10) + index * 36 }} onClick={() => onOpen(system.id)} title={`${system.name} · ${meta}`}><b>{system.name}</b><small>{meta}</small></button>;
  })}</div>;
};

const SystemDots: React.FC<{ data: LifeMapData; areas: string[]; mapper: ReturnType<typeof createLifeMapTimeMapper>; visible: { top: number; bottom: number }; zoom: Zoom }> = ({ data, areas, mapper, visible, zoom }) => {
  const ids = new Set(data.lifeMapSystems.filter((system) => !system.deletedAt && areas.includes(system.areaId)).map((system) => system.id));
  const dots = data.lifeMapSystemCheckIns.filter((item) => !item.deletedAt && ids.has(item.systemId) && isVisible(mapper.dateToWorldY(item.date), visible.top, visible.bottom));
  return <div className={`life-manuscript__system-dots is-${zoom}`}>{dots.map((item) => <i key={item.id} title={`打卡 ${item.date} · ${item.count}`} style={{ top: mapper.dateToWorldY(item.date) + pixelsPerDay[zoom] / 2 }} />)}</div>;
};

const RulerReviewLayer: React.FC<{ reviews: LifeReview[]; mapper: ReturnType<typeof createLifeMapTimeMapper>; visible: { top: number; bottom: number }; onOpen: (id: string) => void }> = ({ reviews, mapper, visible, onOpen }) => <div className="life-manuscript__ruler-reviews">{reviews.filter((item) => !item.deletedAt && isVisible(mapper.dateToWorldY(item.end), visible.top, visible.bottom)).map((item) => <button key={item.id} type="button" data-review-id={item.id} style={{ top: mapper.dateToWorldY(item.end) }} title={`${item.title} · ${item.start} — ${item.end}`} onClick={() => onOpen(item.id)}><span>复盘</span><b>{item.title}</b></button>)}</div>;

const RulerEventLayer: React.FC<{ data: LifeMapData; mapper: ReturnType<typeof createLifeMapTimeMapper>; visible: { top: number; bottom: number }; today: string; zoom: Zoom; onSelect: (id: string) => void }> = ({ data, mapper, visible, today, zoom, onSelect }) => {
  const events = data.lifeMapEvents;
  const groups = useMemo(() => { const map = new Map<string, typeof events>(); events.filter((item) => !item.deletedAt && (zoom !== 'year' || item.importance === 'important' || item.importance === 'core') && isVisible(mapper.dateToWorldY(item.date), visible.top, visible.bottom)).forEach((item) => map.set(item.date, [...(map.get(item.date) ?? []), item])); return [...map.entries()]; }, [events, mapper, visible, zoom]);
  return <div className="life-manuscript__ruler-events">{groups.map(([date, items]) => { const names = items.map((item) => item.name).join('、'); return <button key={date} type="button" data-date={date} className={date === today ? 'is-today' : ''} style={{ top: mapper.dateToWorldY(date) }} title={names} aria-label={`${date} · ${names}`} onClick={() => onSelect(items[0].id)}><i aria-hidden="true" /><span>{items[0].name}</span>{items.length > 1 && <em>+{items.length - 1}</em>}</button>; })}</div>;
};

export default LifeManuscriptView;

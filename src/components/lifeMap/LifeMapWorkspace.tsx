import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { ChevronDown, Eye, EyeOff, FastForward, Layers3, ListFilter, Palette, PauseCircle, Play, Plus, Settings2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { LifeStage, Milestone, Note, Task, TaskGroup } from '@/types';
import { activeLifeMapItems, LIFE_MAP_PLAN_GROUP_META } from '@/lifeMap/data';
import { calculateGoalProgress, currentSystemStats, systemCompletedForRange, systemTargetForRange } from '@/lifeMap/metrics';
import { useLifeMapStore, type LifeMapShiftSnapshot } from '@/lifeMap/store';
import { activeMaintenancePeriod, mergeMaintenancePeriods } from '@/lifeMap/maintenance';
import { findFirstAvailablePhaseRange, resolveLifeMapCreationDefaults, type LifeMapPrimaryIntent } from '@/lifeMap/lifeMapCreationContext';
import { createLifeMapPeriodFocusItems } from '@/lifeMap/lifeMapPeriodFocus';
import type { LifeGoal, LifeMaintenancePeriod, LifeMapPlanGroupId, LifeMapStatus, LifeReview, LifeSystem } from '@/lifeMap/types';
import LifeMapView from './LifeMapView';
import LifeMapPlanningDrawer from './LifeMapPlanningDrawer';
import LifeMapEntityEditor from './LifeMapEntityEditor';
import '@/styles/life-map-workspace.css';

type EditorKind = 'plan' | 'phase' | 'system' | 'theme' | 'focus' | 'range-note' | 'area' | 'review';
type EditorState = { kind: EditorKind; id?: string } | null;
type ToolbarMenu = 'areas' | null;
type MaintenanceEditor = { scope: 'area' | 'plan'; id: string; name: string } | null;

const defaultDate = () => dayjs().format('YYYY-MM-DD');
const futureDate = () => dayjs().add(1, 'month').format('YYYY-MM-DD');
const maintenanceId = () => `maintenance-${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const readLastUsedAreaIds = (): Partial<Record<LifeMapPrimaryIntent, string>> => {
  try { return JSON.parse(localStorage.getItem('life-map-last-used-areas-v1') ?? '{}') as Partial<Record<LifeMapPrimaryIntent, string>>; }
  catch { return {}; }
};
const AREA_COLOR_PALETTES: Record<LifeMapPlanGroupId, string[]> = {
  learning: ['#6366F1', '#3B82F6', '#8B5CF6', '#0EA5E9'],
  work: ['#D8A72E', '#B7791F', '#EA8C55', '#C08457'],
  life: ['#10B981', '#22C55E', '#EC4899', '#8B5CF6'],
};
const PLAN_GROUP_ORDER: Record<LifeMapPlanGroupId, number> = { learning: 0, work: 1, life: 2 };
const compareAreas = (left: { planGroupId: LifeMapPlanGroupId; order: number; id: string }, right: { planGroupId: LifeMapPlanGroupId; order: number; id: string }) => (
  PLAN_GROUP_ORDER[left.planGroupId] - PLAN_GROUP_ORDER[right.planGroupId]
  || left.order - right.order
  || left.id.localeCompare(right.id)
);

const LifeMapWorkspace: React.FC = () => {
  const store = useLifeMapStore(useShallow((state) => ({
    isHydrated: state.isHydrated,
    lifeMapAreas: state.lifeMapAreas,
    lifeMapPlanGroups: state.lifeMapPlanGroups,
    lifeMapStages: state.lifeMapStages,
    lifeMapThemes: state.lifeMapThemes,
    lifeMapGoals: state.lifeMapGoals,
    lifeMapSystems: state.lifeMapSystems,
    lifeMapSystemCheckIns: state.lifeMapSystemCheckIns,
    lifeMapEvents: state.lifeMapEvents,
    lifeMapFocuses: state.lifeMapFocuses,
    lifeMapNotes: state.lifeMapNotes,
    lifeMapReviews: state.lifeMapReviews,
    addArea: state.addArea,
    updateArea: state.updateArea,
    updatePlanGroupPlacement: state.updatePlanGroupPlacement,
    deleteArea: state.deleteArea,
    addStage: state.addStage,
    updateStage: state.updateStage,
    deleteStage: state.deleteStage,
    addTheme: state.addTheme,
    updateTheme: state.updateTheme,
    deleteTheme: state.deleteTheme,
    addGoal: state.addGoal,
    updateGoal: state.updateGoal,
    deleteGoal: state.deleteGoal,
    shiftPlanningItems: state.shiftPlanningItems,
    restorePlanningItems: state.restorePlanningItems,
    addSystem: state.addSystem,
    updateSystem: state.updateSystem,
    deleteSystem: state.deleteSystem,
    addSystemCheckIn: state.addSystemCheckIn,
    setSystemCheckIn: state.setSystemCheckIn,
    addEvent: state.addEvent,
    updateEvent: state.updateEvent,
    deleteEvent: state.deleteEvent,
    addFocus: state.addFocus,
    updateFocus: state.updateFocus,
    deleteFocus: state.deleteFocus,
    addNote: state.addNote,
    updateNote: state.updateNote,
    deleteNote: state.deleteNote,
    addReview: state.addReview,
    updateReview: state.updateReview,
    deleteReview: state.deleteReview,
    migrateLegacyLayouts: state.migrateLegacyLayouts,
  })));
  const [selectedAreaId, setSelectedAreaId] = useState<string>('all');
  const [editor, setEditor] = useState<EditorState>(null);
  const [name, setName] = useState('');
  const [start, setStart] = useState(defaultDate);
  const [end, setEnd] = useState(futureDate);
  const [targetCount, setTargetCount] = useState(3);
  const [frequency, setFrequency] = useState<LifeSystem['frequency']>('weekly');
  const [color, setColor] = useState('#6366F1');
  const [draftAreaId, setDraftAreaId] = useState('learning');
  const [draftPlanGroupId, setDraftPlanGroupId] = useState<LifeMapPlanGroupId>('life');
  const [status, setStatus] = useState<LifeMapStatus>('active');
  const [progress, setProgress] = useState(0);
  const [unit, setUnit] = useState('');
  const [parentGoalId, setParentGoalId] = useState('');
  const [summary, setSummary] = useState('');
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [hasEnd, setHasEnd] = useState(false);
  const [reviewPeriod, setReviewPeriod] = useState<LifeReview['period']>('month');
  const [reviewAreaId, setReviewAreaId] = useState('all');
  const [reflection, setReflection] = useState('');
  const [adjustments, setAdjustments] = useState('');
  const [formError, setFormError] = useState('');
  const [showEditorMore, setShowEditorMore] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => localStorage.getItem('life-map-onboarding-v1') === 'done');
  const [toolbarMenu, setToolbarMenu] = useState<ToolbarMenu>(null);
  const [checkInDate, setCheckInDate] = useState(defaultDate);
  const [maintenanceEditor, setMaintenanceEditor] = useState<MaintenanceEditor>(null);
  const [maintenanceStart, setMaintenanceStart] = useState(defaultDate);
  const [maintenanceEnd, setMaintenanceEnd] = useState('');
  const [maintenanceReason, setMaintenanceReason] = useState('');
  const [shiftEditorOpen, setShiftEditorOpen] = useState(false);
  const [shiftSelection, setShiftSelection] = useState<string[]>([]);
  const [shiftDays, setShiftDays] = useState(7);
  const [lastShift, setLastShift] = useState<LifeMapShiftSnapshot[]>([]);
  const [planningDrawerOpen, setPlanningDrawerOpen] = useState(false);
  const [lifeStageEditorRequest, setLifeStageEditorRequest] = useState<{ stage?: LifeStage; token: number } | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const lastUsedAreaIdsRef = useRef<Partial<Record<LifeMapPrimaryIntent, string>>>(readLastUsedAreaIds());

  useEffect(() => {
    if (!store.isHydrated) return;
    store.migrateLegacyLayouts();
  }, [store]);

  const areas = useMemo(
    () => activeLifeMapItems(store.lifeMapAreas).filter((area) => !area.isHidden).sort(compareAreas),
    [store.lifeMapAreas],
  );
  const allAreas = useMemo(
    () => activeLifeMapItems(store.lifeMapAreas).sort(compareAreas),
    [store.lifeMapAreas],
  );
  const planGroups = useMemo(
    () => activeLifeMapItems(store.lifeMapPlanGroups).sort((left, right) => left.order - right.order),
    [store.lifeMapPlanGroups],
  );
  const visibleAreaIds = useMemo(
    () => new Set(selectedAreaId === 'all' ? areas.map((area) => area.id) : [selectedAreaId]),
    [areas, selectedAreaId],
  );
  const areaById = useMemo(() => new Map(areas.map((area) => [area.id, area])), [areas]);
  const selectedArea = selectedAreaId === 'all' ? null : areaById.get(selectedAreaId) ?? null;
  useEffect(() => {
    if (selectedAreaId !== 'all' && !areaById.has(selectedAreaId)) setSelectedAreaId('all');
  }, [areaById, selectedAreaId]);
  const allGoals = useMemo(() => activeLifeMapItems(store.lifeMapGoals), [store.lifeMapGoals]);
  const allGoalById = useMemo(() => new Map(allGoals.map((item) => [item.id, item])), [allGoals]);
  const goals = useMemo(() => allGoals.filter((item) => visibleAreaIds.has(item.areaId) && (showArchived || item.status !== 'archived')), [allGoals, showArchived, visibleAreaIds]);
  const planningItems = useMemo(() => goals.filter((item) => item.kind === 'plan' || item.kind === 'phase'), [goals]);
  const plans = useMemo(() => planningItems.filter((item) => item.kind === 'plan'), [planningItems]);
  const phases = useMemo(() => planningItems.filter((item) => item.kind === 'phase'), [planningItems]);
  const planningIndex = useMemo(() => {
    const planById = new Map<string, LifeGoal>();
    const phasesByPlanId = new Map<string, LifeGoal[]>();
    planningItems.forEach((item) => {
      if (item.kind === 'plan') planById.set(item.id, item);
      else if (item.parentGoalId) {
        const children = phasesByPlanId.get(item.parentGoalId) ?? [];
        children.push(item);
        phasesByPlanId.set(item.parentGoalId, children);
      }
    });
    return { planById, phasesByPlanId };
  }, [planningItems]);
  const systems = useMemo(() => activeLifeMapItems(store.lifeMapSystems).filter((item) => visibleAreaIds.has(item.areaId) && (showArchived || item.status !== 'archived')), [showArchived, store.lifeMapSystems, visibleAreaIds]);
  const themes = useMemo(() => activeLifeMapItems(store.lifeMapThemes).filter((item) => visibleAreaIds.has(item.areaId)), [store.lifeMapThemes, visibleAreaIds]);
  const events = useMemo(() => activeLifeMapItems(store.lifeMapEvents).filter((item) => {
    if (item.areaId) return visibleAreaIds.has(item.areaId);
    return true;
  }), [store.lifeMapEvents, visibleAreaIds]);
  const focuses = useMemo(() => activeLifeMapItems(store.lifeMapFocuses).filter((item) => visibleAreaIds.has(item.areaId)), [store.lifeMapFocuses, visibleAreaIds]);
  const lifeNotes = useMemo(() => activeLifeMapItems(store.lifeMapNotes).filter((item) => visibleAreaIds.has(item.areaId)), [store.lifeMapNotes, visibleAreaIds]);
  const periodFocusItems = useMemo(() => createLifeMapPeriodFocusItems(store).filter((item) => visibleAreaIds.has(item.areaId)), [store, visibleAreaIds]);
  const areaItemCounts = useMemo(() => {
    const counts = new Map<string, number>();
    const count = (areaId?: string) => { if (areaId) counts.set(areaId, (counts.get(areaId) ?? 0) + 1); };
    activeLifeMapItems(store.lifeMapGoals).filter((item) => item.kind === 'plan' || item.kind === 'phase').forEach((item) => count(item.areaId));
    activeLifeMapItems(store.lifeMapSystems).forEach((item) => count(item.areaId));
    activeLifeMapItems(store.lifeMapThemes).forEach((item) => count(item.areaId));
    activeLifeMapItems(store.lifeMapEvents).forEach((item) => count(item.areaId));
    activeLifeMapItems(store.lifeMapFocuses).forEach((item) => count(item.areaId));
    activeLifeMapItems(store.lifeMapNotes).forEach((item) => count(item.areaId));
    return counts;
  }, [store.lifeMapEvents, store.lifeMapFocuses, store.lifeMapGoals, store.lifeMapNotes, store.lifeMapSystems, store.lifeMapThemes]);
  const reviews = useMemo(() => activeLifeMapItems(store.lifeMapReviews), [store.lifeMapReviews]);
  const checkIns = useMemo(() => activeLifeMapItems(store.lifeMapSystemCheckIns), [store.lifeMapSystemCheckIns]);
  const hasVisibleLifeMapContent = useMemo(() => (
    activeLifeMapItems(store.lifeMapGoals).some((item) => item.kind === 'plan' || item.kind === 'phase')
    || activeLifeMapItems(store.lifeMapSystems).length > 0
    || activeLifeMapItems(store.lifeMapEvents).length > 0
    || activeLifeMapItems(store.lifeMapStages).length > 0
    || activeLifeMapItems(store.lifeMapThemes).length > 0
    || activeLifeMapItems(store.lifeMapFocuses).length > 0
    || activeLifeMapItems(store.lifeMapNotes).length > 0
    || activeLifeMapItems(store.lifeMapReviews).length > 0
  ), [store.lifeMapEvents, store.lifeMapFocuses, store.lifeMapGoals, store.lifeMapNotes, store.lifeMapReviews, store.lifeMapStages, store.lifeMapSystems, store.lifeMapThemes]);
  const activeSystems = systems.filter((item) => item.status === 'active');
  const systemStats = useMemo(() => new Map(systems.map((item) => [item.id, currentSystemStats({
    ...item,
    maintenancePeriods: mergeMaintenancePeriods(item.maintenancePeriods, areaById.get(item.areaId)?.maintenancePeriods),
  }, checkIns)])), [areaById, checkIns, systems]);
  const reachedSystemCount = activeSystems.filter((item) => {
    const stats = systemStats.get(item.id);
    return stats && stats.target > 0 && stats.completed >= stats.target;
  }).length;
  const areaScopeStats = useMemo(() => {
    const result = new Map<string, { plans: number; systems: number; reached: number; theme?: string }>();
    areas.forEach((area) => result.set(area.id, { plans: 0, systems: 0, reached: 0 }));
    allGoals.forEach((item) => {
      if (item.kind !== 'plan') return;
      const stat = result.get(item.areaId);
      if (stat) stat.plans += 1;
    });
    activeLifeMapItems(store.lifeMapSystems).forEach((item) => {
      const stat = result.get(item.areaId);
      const area = areaById.get(item.areaId);
      if (!stat || !area) return;
      stat.systems += 1;
      if (item.status === 'active') {
        const current = currentSystemStats({ ...item, maintenancePeriods: mergeMaintenancePeriods(item.maintenancePeriods, area.maintenancePeriods) }, checkIns);
        if (current.target > 0 && current.completed >= current.target) stat.reached += 1;
      }
    });
    activeLifeMapItems(store.lifeMapThemes).forEach((item) => {
      const stat = result.get(item.areaId);
      if (stat && !stat.theme) stat.theme = item.name;
    });
    return result;
  }, [allGoals, areaById, areas, checkIns, store.lifeMapSystems, store.lifeMapThemes]);

  const rangesByArea = useMemo(() => {
    const result = new Map<string, Array<[string, string]>>();
    const append = (areaId: string, range: [string, string]) => {
      const ranges = result.get(areaId) ?? [];
      ranges.push(range);
      result.set(areaId, ranges);
    };
    planningItems.forEach((item) => append(item.areaId, [item.start, item.targetDate]));
    systems.forEach((item) => append(item.areaId, [item.start, item.end ?? dayjs().add(5, 'year').format('YYYY-MM-DD')]));
    themes.forEach((item) => append(item.areaId, [item.start, item.end]));
    return result;
  }, [planningItems, systems, themes]);

  const groups = useMemo<TaskGroup[]>(() => areas.filter((area) => selectedAreaId === 'all' || visibleAreaIds.has(area.id)).map((area) => {
    const ranges = rangesByArea.get(area.id) ?? [];
    const dates = ranges.flat().sort();
    return {
      id: area.id,
      name: area.name,
      color: area.color,
      start: dates[0] ?? defaultDate(),
      end: dates.at(-1) ?? futureDate(),
      children: [],
    };
  }), [areas, rangesByArea, selectedAreaId, visibleAreaIds]);

  const lifeMapTasks = useMemo<Task[]>(() => [
    ...planningItems.map((item) => {
      const childPhases = item.kind === 'plan' ? planningIndex.phasesByPlanId.get(item.id) ?? [] : [];
      const parentPlan = item.kind === 'phase' && item.parentGoalId ? planningIndex.planById.get(item.parentGoalId) : undefined;
      const maintenancePeriods = mergeMaintenancePeriods(item.maintenancePeriods, parentPlan?.maintenancePeriods, areaById.get(item.areaId)?.maintenancePeriods);
      const currentMaintenance = activeMaintenancePeriod(maintenancePeriods);
      const resolvedProgress = childPhases.length > 0
        ? Math.round(childPhases.reduce((total, phase) => total + calculateGoalProgress(phase), 0) / childPhases.length)
        : calculateGoalProgress(item);
      const metricLabel = item.metric && item.currentValue !== undefined && item.targetValue !== undefined
        ? `${item.metric} ${item.currentValue}${item.unit ?? ''} → ${item.targetValue}${item.unit ?? ''}`
        : item.kind === 'plan'
          ? `${childPhases.length} 个子阶段 · ${resolvedProgress}%`
          : item.kind === 'phase'
            ? item.summary || `${resolvedProgress}%`
            : `${resolvedProgress}%`;
      return {
      id: `goal:${item.id}`, name: item.name, start: item.start, end: item.targetDate,
      color: item.color ?? areaById.get(item.areaId)?.color, groupId: item.areaId,
      isMain: item.kind === 'plan', completed: item.status === 'completed', blocks: [], lifeMapKind: item.kind as NonNullable<Task['lifeMapKind']>,
      lifeMapMeta: metricLabel, lifeMapProgress: resolvedProgress, lifeMapPlacement: item.placement,
      lifeMapParentId: item.parentGoalId ? `goal:${item.parentGoalId}` : undefined,
      lifeMapMaintenanceActive: Boolean(currentMaintenance), lifeMapMaintenanceReason: currentMaintenance?.reason,
      };
    }),
    ...systems.map((item) => {
      const maintenancePeriods = mergeMaintenancePeriods(item.maintenancePeriods, areaById.get(item.areaId)?.maintenancePeriods);
      const currentMaintenance = activeMaintenancePeriod(maintenancePeriods);
      const stats = systemStats.get(item.id) ?? currentSystemStats({ ...item, maintenancePeriods }, checkIns);
      return {
      id: `system:${item.id}`, name: item.name,
      start: item.start, end: item.end ?? dayjs().add(5, 'year').format('YYYY-MM-DD'),
      color: item.color ?? areaById.get(item.areaId)?.color, groupId: item.areaId,
      completed: item.status === 'completed', blocks: [], lifeMapKind: 'system' as const,
      lifeMapMeta: currentMaintenance ? `维护中 · ${currentMaintenance.reason || '暂停统计'}` : `${stats.label} ${stats.completed}/${stats.target}${item.unit ?? '次'}`,
      lifeMapProgress: stats.target > 0 ? Math.min(100, Math.round(stats.completed / stats.target * 100)) : 0,
      lifeMapOpenEnded: !item.end, lifeMapPlacement: item.placement,
      lifeMapMaintenanceActive: Boolean(currentMaintenance), lifeMapMaintenanceReason: currentMaintenance?.reason,
      };
    }),
    ...reviews.map((item) => ({
      id: `review:${item.id}`, name: `复盘 · ${item.title}`, start: item.start, end: item.end,
      color: '#64748B', groupId: item.areaIds?.[0] ?? groups[0]?.id, completed: true, blocks: [],
      lifeMapKind: 'review' as const, lifeMapMeta: item.period === 'month' ? '月度复盘' : '季度复盘', lifeMapPlacement: 'below' as const,
    })),
  ], [areaById, checkIns, groups, planningIndex, planningItems, reviews, systemStats, systems]);
  const tasks = lifeMapTasks;

  const notes = useMemo<Note[]>(() => [
    ...periodFocusItems.map((item) => ({ id: item.sourceKind === 'theme' ? `theme:${item.sourceId}` : item.sourceId, name: item.name, date: item.start, endDate: item.end, type: 'range' as const, color: item.color, placement: item.placement, layoutLane: item.layoutLane })),
    ...lifeNotes.filter((item) => item.type !== 'range' || !item.endDate).map((item) => ({ id: item.id, name: item.name, date: item.date, endDate: item.endDate, type: item.type, color: item.color, placement: item.placement, layoutLane: item.layoutLane })),
  ], [lifeNotes, periodFocusItems]);
  const milestones = useMemo<Milestone[]>(() => events.map((item) => {
    const relatedCandidate = item.relatedPlanId ? allGoalById.get(item.relatedPlanId) : undefined;
    const relatedPlan = relatedCandidate?.kind === 'plan' ? relatedCandidate : undefined;
    const relatedAreaId = item.areaId ?? relatedPlan?.areaId;
    return {
      id: item.id, name: item.name, date: item.date,
      color: item.color ?? (relatedAreaId ? areaById.get(relatedAreaId)?.color : undefined) ?? '#D97706',
      placement: item.placement, importance: item.importance, layoutLane: item.layoutLane, areaId: item.areaId, relatedPlanId: item.relatedPlanId, customColor: item.color,
    };
  }), [allGoalById, areaById, events]);
  const stages = useMemo<LifeStage[]>(() => activeLifeMapItems(store.lifeMapStages).map((item) => ({
    id: item.id, name: item.name, start: item.start, end: item.end, color: item.color,
  })), [store.lifeMapStages]);

  const editorAreaId = selectedAreaId !== 'all'
    ? selectedAreaId
    : areas.find((area) => area.id === 'learning')?.id ?? areas[0]?.id ?? 'learning';
  const applyPhaseParentDefaults = (parent: LifeGoal, excludePhaseId?: string) => {
    const siblingPhases = activeLifeMapItems(store.lifeMapGoals).filter((item) => item.kind === 'phase' && item.parentGoalId === parent.id && item.id !== excludePhaseId);
    const available = findFirstAvailablePhaseRange(parent, siblingPhases);
    setParentGoalId(parent.id);
    setDraftAreaId(parent.areaId);
    setColor(parent.color ?? areaById.get(parent.areaId)?.color ?? '#6366F1');
    if (available) {
      setStart(available.start);
      setEnd(available.end);
      setFormError('');
    } else {
      setStart(parent.start);
      setEnd(parent.targetDate);
      setFormError('该项目的日期已被现有子阶段完整覆盖。请先调整子阶段，或扩大项目日期。');
    }
  };
  const openCreate = (kind: EditorKind, context?: { planId?: string }) => {
    setToolbarMenu(null);
    setName(''); setStart(defaultDate()); setEnd(futureDate()); setTargetCount(3); setFrequency('weekly');
    setStatus('active'); setProgress(0); setUnit('');
    setParentGoalId(''); setSummary(''); setDurationMinutes(30); setHasEnd(false); setCheckInDate(defaultDate());
    setReviewPeriod('month'); setReviewAreaId(selectedAreaId); setReflection(''); setAdjustments(''); setFormError('');
    const primaryIntent = (kind === 'plan' || kind === 'system') ? kind : undefined;
    const defaults = primaryIntent ? resolveLifeMapCreationDefaults(primaryIntent, {
      source: context?.planId ? 'plan' : selectedAreaId === 'all' ? 'global' : 'lane',
      planId: context?.planId,
      areaId: selectedAreaId === 'all' ? undefined : selectedAreaId,
    }, store, lastUsedAreaIdsRef.current) : {};
    const resolvedAreaId = defaults.areaId ?? editorAreaId;
    setColor(areaById.get(resolvedAreaId)?.color ?? '#6366F1');
    setDraftAreaId(resolvedAreaId);
    setDraftPlanGroupId('life');
    setShowEditorMore(false);
    if (kind === 'phase') {
      const parent = plans.find((item) => item.id === context?.planId) ?? plans.find((item) => item.areaId === editorAreaId) ?? plans[0];
      if (parent) applyPhaseParentDefaults(parent);
      else setFormError('请先新建项目，再添加子阶段。');
    }
    if (kind === 'review') {
      setName(`${dayjs().format('YYYY年M月')}复盘`);
      setStart(dayjs().startOf('month').format('YYYY-MM-DD'));
      setEnd(dayjs().endOf('month').format('YYYY-MM-DD'));
    }
    setEditor({ kind });
  };
  useEffect(() => {
    if (!toolbarMenu) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!toolbarRef.current?.contains(event.target as Node)) setToolbarMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setToolbarMenu(null);
    };
    document.addEventListener('pointerdown', closeOnOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [toolbarMenu]);
  const openEntity = (taskId: string) => {
    const [kind, id] = taskId.split(':');
    if (!id || !['goal', 'system', 'theme', 'review'].includes(kind)) return;
    if (kind === 'review') {
      const item = reviews.find((entry) => entry.id === id);
      if (!item) return;
      setName(item.title); setStart(item.start); setEnd(item.end); setReviewPeriod(item.period); setReviewAreaId(item.areaIds?.[0] ?? 'all');
      setReflection(item.reflection); setAdjustments(item.adjustments); setFormError('');
      setEditor({ kind: 'review', id });
      return;
    }
    const item = kind === 'goal' ? planningItems.find((entry) => entry.id === id)
      : kind === 'system' ? systems.find((entry) => entry.id === id)
        : themes.find((entry) => entry.id === id);
    if (!item) return;
    setName(item.name); setStart(item.start);
    setEnd('targetDate' in item ? item.targetDate : item.end ?? futureDate());
    setColor(item.color ?? areaById.get(item.areaId)?.color ?? '#6366F1');
    setDraftAreaId(item.areaId);
    setStatus('status' in item ? item.status : 'active');
    if ('progress' in item) {
      setProgress(calculateGoalProgress(item)); setUnit(item.unit ?? '');
      setParentGoalId(item.parentGoalId ?? ''); setSummary(item.summary ?? '');
    }
    if ('targetCount' in item) {
      setTargetCount(item.targetCount); setFrequency(item.frequency); setUnit(item.unit ?? '');
      setDurationMinutes(item.durationMinutes ?? 30); setHasEnd(Boolean(item.end));
    }
    setCheckInDate(defaultDate());
    setFormError('');
    if (kind === 'goal' && 'kind' in item && (item.kind === 'plan' || item.kind === 'phase')) setEditor({ kind: item.kind, id });
    else if (kind !== 'goal') setEditor({ kind: kind as EditorKind, id });
  };
  const openAreaEditor = (id: string) => {
    const area = allAreas.find((item) => item.id === id);
    if (!area) return;
    setName(area.name); setColor(area.color); setDraftPlanGroupId(area.planGroupId); setFormError(''); setEditor({ kind: 'area', id });
  };
  const openAreaCreate = (groupId: LifeMapPlanGroupId) => {
    const siblingCount = allAreas.filter((area) => area.planGroupId === groupId).length;
    openCreate('area');
    setDraftPlanGroupId(groupId);
    setColor(AREA_COLOR_PALETTES[groupId][siblingCount % AREA_COLOR_PALETTES[groupId].length]);
  };
  const moveAreaWithinGroup = (id: string, direction: 'up' | 'down') => {
    const area = allAreas.find((item) => item.id === id);
    if (!area) return;
    const siblings = allAreas.filter((item) => item.planGroupId === area.planGroupId).sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
    const index = siblings.findIndex((item) => item.id === id);
    const other = siblings[index + (direction === 'up' ? -1 : 1)];
    if (!other) return;
    store.updateArea(area.id, { order: other.order });
    store.updateArea(other.id, { order: area.order });
  };
  const validDateRange = () => /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && dayjs(start).isValid() && dayjs(end).isValid() && !dayjs(end).isBefore(dayjs(start), 'day');
  const createReviewSnapshot = (): LifeReview['snapshot'] => {
    const scopedAreaIds = reviewAreaId === 'all' ? null : new Set([reviewAreaId]);
    const scopedPlans = activeLifeMapItems(store.lifeMapGoals).filter((item) => item.kind === 'plan' && item.status !== 'archived' && (!scopedAreaIds || scopedAreaIds.has(item.areaId)));
    const scopedSystems = activeLifeMapItems(store.lifeMapSystems).filter((item) => item.status !== 'archived' && (!scopedAreaIds || scopedAreaIds.has(item.areaId)));
    return {
      goals: scopedPlans.map((item) => ({ id: item.id, name: item.name, status: item.status, progress: calculateGoalProgress(item) })),
      systems: scopedSystems.map((item) => ({
        id: item.id, name: item.name,
        completed: systemCompletedForRange(checkIns, item.id, start, end),
        target: systemTargetForRange({ ...item, maintenancePeriods: mergeMaintenancePeriods(item.maintenancePeriods, areaById.get(item.areaId)?.maintenancePeriods) }, start, end),
        frequency: item.frequency,
      })),
    };
  };
  const saveEditor = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    setFormError('');
    if (!trimmed) { setFormError('请输入名称。'); return; }
    if (editor && !['area', 'review'].includes(editor.kind) && !areas.some((area) => area.id === draftAreaId)) {
      setFormError('请先创建二级分类，再保存这项内容。'); return;
    }
    const onlyStartRequired = editor?.kind === 'system' && !hasEnd;
    const startIsValid = /^\d{4}-\d{2}-\d{2}$/.test(start) && dayjs(start).isValid();
    if (editor?.kind !== 'area' && (onlyStartRequired ? !startIsValid : !validDateRange())) { setFormError('请选择完整日期，且结束日期不能早于开始日期。'); return; }
    const selectedParent = editor?.kind === 'phase' ? activeLifeMapItems(store.lifeMapGoals).find((item) => item.id === parentGoalId && item.kind === 'plan') : undefined;
    if (editor?.kind === 'phase' && !selectedParent) { setFormError('请先选择一个项目。'); return; }
    if (selectedParent && (start < selectedParent.start || end > selectedParent.targetDate)) {
      setFormError(`项目子阶段必须位于项目 ${selectedParent.start} 至 ${selectedParent.targetDate} 内。`); return;
    }
    if (selectedParent) {
      const overlappingPhase = activeLifeMapItems(store.lifeMapGoals).find((item) => item.kind === 'phase'
        && item.parentGoalId === selectedParent.id
        && item.id !== editor?.id
        && item.start <= end
        && item.targetDate >= start);
      if (overlappingPhase) {
        setFormError(`当前日期与子阶段“${overlappingPhase.name}”重叠，请调整起止日期后再保存。`); return;
      }
    }
    if (editor?.kind === 'plan' && editor.id) {
      const outsideChild = activeLifeMapItems(store.lifeMapGoals).find((item) => item.kind === 'phase' && item.parentGoalId === editor.id && (item.start < start || item.targetDate > end));
      if (outsideChild) { setFormError(`日期范围尚未包含子阶段“${outsideChild.name}”。`); return; }
    }
    if (editor?.kind === 'area') {
      if (editor.id) store.updateArea(editor.id, { name: trimmed, color, planGroupId: draftPlanGroupId });
      else store.addArea({ name: trimmed, color, planGroupId: draftPlanGroupId });
    } else if (editor && ['plan', 'phase'].includes(editor.kind)) {
      const goalKind = editor.kind as NonNullable<LifeGoal['kind']>;
      const value: Omit<LifeGoal, 'id' | 'createdAt' | 'updatedAt' | 'revision'> = {
        areaId: selectedParent?.areaId ?? draftAreaId,
        name: trimmed,
        start,
        targetDate: end,
        color: selectedParent?.color ?? color,
        status,
        progress,
        progressMode: 'manual',
        isCore: false,
        kind: goalKind,
        parentGoalId: goalKind === 'phase' ? parentGoalId : undefined,
        summary: summary.trim() || undefined,
      };
      const id = editor.id ?? store.addGoal(value).id;
      if (editor.id) store.updateGoal(editor.id, value);
      if (editor.kind === 'plan') {
        activeLifeMapItems(store.lifeMapGoals)
          .filter((item) => item.kind === 'phase' && item.parentGoalId === id)
          .forEach((item) => store.updateGoal(item.id, { areaId: draftAreaId, color }));
      }
    } else if (editor?.kind === 'system') {
      const value = { areaId: draftAreaId, name: trimmed, start, end: hasEnd ? end : undefined, frequency, targetCount: Math.max(1, targetCount), durationMinutes: Math.max(5, durationMinutes), unit: unit.trim() || undefined, color, status };
      if (editor.id) store.updateSystem(editor.id, value); else store.addSystem(value);
    } else if (editor?.kind === 'theme') {
      const value = { areaId: draftAreaId, name: trimmed, start, end, color };
      if (editor.id) store.updateTheme(editor.id, value); else store.addTheme(value);
    } else if (editor?.kind === 'focus') {
      const value = { areaId: draftAreaId, name: trimmed, start, end, color };
      if (editor.id) store.updateFocus(editor.id, value); else store.addFocus(value);
    } else if (editor?.kind === 'range-note') {
      if (editor.id) store.updateNote(editor.id, { areaId: draftAreaId, name: trimmed, date: start, endDate: end, type: 'range', color });
    } else if (editor?.kind === 'review') {
      const value = { title: trimmed, period: reviewPeriod, start, end, reflection: reflection.trim(), adjustments: adjustments.trim(), areaIds: reviewAreaId === 'all' ? undefined : [reviewAreaId] };
      if (editor.id) store.updateReview(editor.id, value); else store.addReview({ ...value, snapshot: createReviewSnapshot() });
    }
    if (editor && ['plan', 'system'].includes(editor.kind)) {
      const intent = editor.kind as LifeMapPrimaryIntent;
      lastUsedAreaIdsRef.current = { ...lastUsedAreaIdsRef.current, [intent]: draftAreaId };
      localStorage.setItem('life-map-last-used-areas-v1', JSON.stringify(lastUsedAreaIdsRef.current));
    }
    setEditor(null);
  };
  const deleteEditorItem = () => {
    if (!editor?.id) return;
    if (['plan', 'phase'].includes(editor.kind)) store.deleteGoal(editor.id);
    if (editor.kind === 'system') store.deleteSystem(editor.id);
    if (editor.kind === 'theme') store.deleteTheme(editor.id);
    if (editor.kind === 'focus') store.deleteFocus(editor.id);
    if (editor.kind === 'range-note') store.deleteNote(editor.id);
    if (editor.kind === 'review') store.deleteReview(editor.id);
    if (editor.kind === 'area') {
      const inUse = [...store.lifeMapGoals, ...store.lifeMapSystems, ...store.lifeMapThemes, ...store.lifeMapEvents, ...store.lifeMapFocuses, ...store.lifeMapNotes]
        .some((item) => !item.deletedAt && 'areaId' in item && item.areaId === editor.id);
      if (inUse) { setFormError('该领域仍有规划内容，请先移动或删除这些内容。'); return; }
      store.deleteArea(editor.id);
      if (selectedAreaId === editor.id) setSelectedAreaId('all');
    }
    setEditor(null);
  };
  const dismissOnboarding = () => {
    localStorage.setItem('life-map-onboarding-v1', 'done');
    setOnboardingDismissed(true);
  };
  const applyTemplate = (kind: 'balanced' | 'health') => {
    const learning = allAreas.find((area) => area.id === 'learning') ?? allAreas[0];
    const health = allAreas.find((area) => area.id === 'health') ?? allAreas[0];
    if (!learning || !health) return;
    if (kind === 'balanced') {
      store.addStage({ name: '学习与生活平衡期', start: defaultDate(), end: dayjs().add(3, 'month').endOf('month').format('YYYY-MM-DD'), color: '#7C6FE6' });
      store.addTheme({ areaId: learning.id, name: '推进当前最重要的学习项目', start: defaultDate(), end: dayjs().add(3, 'month').format('YYYY-MM-DD'), color: learning.color });
      store.addGoal({ areaId: learning.id, name: '完成本阶段核心学习项目', start: defaultDate(), targetDate: dayjs().add(3, 'month').format('YYYY-MM-DD'), color: learning.color, kind: 'plan', status: 'active', progress: 0 });
      store.addSystem({ areaId: health.id, name: '保持规律运动', start: defaultDate(), frequency: 'weekly', targetCount: 3, durationMinutes: 40, color: health.color });
      store.addSystem({ areaId: health.id, name: '稳定睡眠节奏', start: defaultDate(), frequency: 'daily', targetCount: 1, durationMinutes: 10, color: health.color });
    } else {
      store.addTheme({ areaId: health.id, name: '恢复精力与稳定作息', start: defaultDate(), end: dayjs().add(2, 'month').format('YYYY-MM-DD'), color: health.color });
      store.addGoal({ areaId: health.id, name: '完成健康检查并建立基线', start: defaultDate(), targetDate: dayjs().add(1, 'month').format('YYYY-MM-DD'), color: health.color, kind: 'plan', status: 'active', progress: 0 });
      store.addSystem({ areaId: health.id, name: '每周运动', start: defaultDate(), frequency: 'weekly', targetCount: 3, durationMinutes: 40, color: health.color });
      store.addSystem({ areaId: health.id, name: '按时入睡', start: defaultDate(), frequency: 'daily', targetCount: 1, durationMinutes: 10, color: health.color });
    }
    setSelectedAreaId(kind === 'health' ? health.id : 'all');
    dismissOnboarding();
  };
  const editingReview = editor?.kind === 'review' && editor.id ? reviews.find((item) => item.id === editor.id) : undefined;
  const editingSystem = editor?.kind === 'system' && editor.id ? systems.find((item) => item.id === editor.id) : undefined;
  const editingSystemStats = editingSystem ? currentSystemStats({ ...editingSystem, maintenancePeriods: mergeMaintenancePeriods(editingSystem.maintenancePeriods, areaById.get(editingSystem.areaId)?.maintenancePeriods) }, checkIns) : undefined;
  const selectedDateCheckIn = editingSystem
    ? checkIns.find((item) => item.systemId === editingSystem.id && item.date === checkInDate)?.count ?? 0
    : 0;
  const reviewPlanSnapshots = editingReview?.snapshot.goals.filter((before) => (
    store.lifeMapGoals.find((item) => item.id === before.id)?.kind === 'plan'
  )) ?? [];
  const reviewChanges = editingReview ? [
    ...reviewPlanSnapshots.flatMap((before) => {
      const current = activeLifeMapItems(store.lifeMapGoals).find((item) => item.id === before.id);
      if (!current || current.kind !== 'plan') return [`项目“${before.name}”已移除或归档`];
      const beforeProgress = before.progress ?? 0;
      const currentProgress = calculateGoalProgress(current);
      return before.status !== current.status || beforeProgress !== currentProgress ? [`项目“${before.name}”：${beforeProgress}% → ${currentProgress}%（${before.status} → ${current.status}）`] : [];
    }),
    ...editingReview.snapshot.systems.flatMap((before) => {
      const currentDone = checkIns.filter((item) => item.systemId === before.id && item.date >= editingReview.start && item.date <= editingReview.end).reduce((sum, item) => sum + item.count, 0);
      return currentDone !== before.completed ? [`系统“${before.name}”：${before.completed} → ${currentDone} 次`] : [];
    }),
  ] : [];
  const maintenanceTarget = maintenanceEditor?.scope === 'area'
    ? allAreas.find((item) => item.id === maintenanceEditor.id)
    : goals.find((item) => item.id === maintenanceEditor?.id && item.kind === 'plan');
  const currentMaintenance = activeMaintenancePeriod(maintenanceTarget?.maintenancePeriods);
  const selectedAreaMaintenance = activeMaintenancePeriod(selectedArea?.maintenancePeriods);
  const shiftCandidates = goals.filter((item) => (item.kind === 'plan' || item.kind === 'phase') && item.status !== 'archived');
  const expandedShiftIds = useMemo(() => {
    const ids = new Set(shiftSelection);
    shiftCandidates.filter((item) => item.kind === 'phase' && item.parentGoalId && ids.has(item.parentGoalId)).forEach((item) => ids.add(item.id));
    return ids;
  }, [shiftCandidates, shiftSelection]);
  const shiftPreview = shiftCandidates.filter((item) => expandedShiftIds.has(item.id)).map((item) => ({
    ...item,
    shiftedStart: dayjs(item.start).add(shiftDays, 'day').format('YYYY-MM-DD'),
    shiftedEnd: dayjs(item.targetDate).add(shiftDays, 'day').format('YYYY-MM-DD'),
  }));
  const openMaintenance = (scope: 'area' | 'plan', id: string, name: string) => {
    setMaintenanceEditor({ scope, id, name });
    setMaintenanceStart(defaultDate());
    setMaintenanceEnd('');
    setMaintenanceReason('');
    setToolbarMenu(null);
  };
  const saveMaintenance = () => {
    if (!maintenanceEditor || !maintenanceTarget) return;
    if (!dayjs(maintenanceStart).isValid() || (maintenanceEnd && (!dayjs(maintenanceEnd).isValid() || dayjs(maintenanceEnd).isBefore(maintenanceStart, 'day')))) return;
    const period: LifeMaintenancePeriod = {
      id: maintenanceId(),
      start: maintenanceStart,
      end: maintenanceEnd || undefined,
      reason: maintenanceReason.trim() || undefined,
    };
    const maintenancePeriods = [...(maintenanceTarget.maintenancePeriods ?? []), period];
    if (maintenanceEditor.scope === 'area') store.updateArea(maintenanceEditor.id, { maintenancePeriods });
    else store.updateGoal(maintenanceEditor.id, { maintenancePeriods });
    setMaintenanceEditor(null);
  };
  const finishMaintenance = (shiftAfterWake: boolean) => {
    if (!maintenanceEditor || !maintenanceTarget || !currentMaintenance) return;
    const todayDate = defaultDate();
    const maintenancePeriods = (maintenanceTarget.maintenancePeriods ?? []).map((period) => period.id === currentMaintenance.id ? { ...period, end: todayDate } : period);
    if (maintenanceEditor.scope === 'area') store.updateArea(maintenanceEditor.id, { maintenancePeriods });
    else store.updateGoal(maintenanceEditor.id, { maintenancePeriods });
    if (shiftAfterWake) {
      const days = Math.max(0, dayjs(todayDate).diff(dayjs(currentMaintenance.start), 'day'));
      const ids = maintenanceEditor.scope === 'area'
        ? activeLifeMapItems(store.lifeMapGoals).filter((item) => item.areaId === maintenanceEditor.id && item.kind === 'plan' && item.status !== 'archived').map((item) => item.id)
        : [maintenanceEditor.id];
      const snapshot = days > 0 ? store.shiftPlanningItems(ids, days) : [];
      setLastShift(snapshot);
    }
    setMaintenanceEditor(null);
  };
  const openShiftEditor = (initialIds?: string[]) => {
    const availablePlans = shiftCandidates.filter((item) => item.kind === 'plan');
    setShiftSelection(initialIds?.length ? initialIds : selectedAreaId === 'all' ? [] : availablePlans.filter((item) => item.areaId === selectedAreaId).map((item) => item.id));
    setShiftDays(7);
    setShiftEditorOpen(true);
  };
  const commitShift = () => {
    const snapshot = store.shiftPlanningItems(shiftSelection, shiftDays);
    setLastShift(snapshot);
    setShiftEditorOpen(false);
  };
  const selectedPhaseParent = editor?.kind === 'phase' ? plans.find((item) => item.id === parentGoalId) : undefined;
  const phaseCreationHasAvailability = editor?.kind !== 'phase' || Boolean(editor.id) || Boolean(selectedPhaseParent && findFirstAvailablePhaseRange(
    selectedPhaseParent,
    activeLifeMapItems(store.lifeMapGoals).filter((item) => item.kind === 'phase' && item.parentGoalId === selectedPhaseParent.id),
  ));
  const editorRequiresArea = Boolean(editor && !['area', 'review'].includes(editor.kind));
  const editorHasArea = !editorRequiresArea || areas.some((area) => area.id === draftAreaId);
  const editorMoreVisible = Boolean(editor?.id) || showEditorMore;

  if (!store.isHydrated) {
    return <div className="life-map-workspace__loading" role="status" aria-live="polite">正在安全恢复人生地图…</div>;
  }

  return <div className="life-map-workspace">
    <LifeMapView
      tasks={tasks}
      groups={groups}
      notes={notes}
      milestones={milestones}
      lifeStages={stages}
      planGoals={[...plans, ...phases]}
      planSystems={systems}
      planAreas={areas}
      planGroups={planGroups}
      toolbarScope={<div className="life-map-scope" ref={toolbarRef} aria-label="人生领域">
        <button
          className="life-map-scope__trigger"
          type="button"
          aria-label={`查看领域：${selectedArea?.name ?? '全部人生'}`}
          aria-haspopup="menu"
          aria-expanded={toolbarMenu === 'areas'}
          onClick={() => setToolbarMenu((value) => value === 'areas' ? null : 'areas')}
        >
          {selectedArea ? <span className="life-map-scope__dot" style={{ background: selectedArea.color }} /> : <ListFilter size={14} />}
          <span>{selectedArea?.name ?? '全部人生'}</span>
          <small>{selectedAreaMaintenance ? '维护中' : selectedArea ? `${plans.length}个人生计划${phases.length ? ` · ${phases.length}个阶段` : ''}` : `${activeLifeMapItems(store.lifeMapGoals).filter((item) => item.kind === 'plan').length}个人生计划 · ${reachedSystemCount}/${activeSystems.length}系统达标`}</small>
          <ChevronDown size={13} />
        </button>
        {toolbarMenu === 'areas' && <div className="life-map-scope__menu" role="menu" aria-label="选择人生领域">
          <header><strong>查看范围</strong><small>一次聚焦一个领域，时间坐标保持不变</small></header>
          {selectedArea && <button type="button" className="life-map-scope__maintenance" onClick={() => openMaintenance('area', selectedArea.id, selectedArea.name)}>{selectedAreaMaintenance ? <Play size={16} /> : <PauseCircle size={16} />}<span><b>{selectedAreaMaintenance ? `结束“${selectedArea.name}”维护` : `“${selectedArea.name}”进入维护`}</b><small>{selectedAreaMaintenance ? `${selectedAreaMaintenance.start} 起暂停统计，唤醒时可顺延计划` : '维护期间长期系统不计算未完成'}</small></span></button>}
          <button type="button" role="menuitemradio" aria-checked={selectedAreaId === 'all'} onClick={() => { setSelectedAreaId('all'); setToolbarMenu(null); }}>
            <ListFilter size={16} /><span><b>全部人生</b><small>{areas.length} 个二级分类 · {activeLifeMapItems(store.lifeMapGoals).filter((item) => item.kind === 'plan').length} 个人生计划 · {activeLifeMapItems(store.lifeMapSystems).length} 个长期系统</small></span>
          </button>
          {(['learning', 'work', 'life'] as const).map((groupId) => {
            const groupAreas = areas.filter((area) => area.planGroupId === groupId);
            return <section className="life-map-scope__group" key={groupId} aria-label={`${LIFE_MAP_PLAN_GROUP_META[groupId].name}二级分类`}>
              <strong className="life-map-scope__group-title">{LIFE_MAP_PLAN_GROUP_META[groupId].name}</strong>
              {groupAreas.length === 0 && <small className="life-map-scope__group-empty">暂无可见二级分类</small>}
              {groupAreas.map((area) => {
                const stats = areaScopeStats.get(area.id) ?? { plans: 0, systems: 0, reached: 0 };
                return <button key={area.id} type="button" role="menuitemradio" aria-checked={selectedAreaId === area.id} onClick={() => { setSelectedAreaId(area.id); setToolbarMenu(null); }}>
                  <span className="life-map-scope__dot" style={{ background: area.color }} /><span><b>{area.name}</b><small>{stats.theme ?? `${stats.plans} 个项目 · ${stats.systems} 个系统`}{stats.systems > 0 ? ` · ${stats.reached}/${stats.systems}达标` : ''}</small></span>
                </button>;
              })}
            </section>;
          })}
          <button type="button" className="life-map-scope__manage" onClick={() => setShowArchived((value) => !value)}>{showArchived ? <EyeOff size={15} /> : <Eye size={15} />}<span><b>{showArchived ? '隐藏归档内容' : '显示归档内容'}</b><small>归档只收起，不会删除数据</small></span></button>
          <button type="button" className="life-map-scope__manage" onClick={() => { setToolbarMenu(null); setPlanningDrawerOpen(true); }}><Settings2 size={15} /><span><b>管理二级分类</b><small>按学习、工作、生活分组管理</small></span></button>
        </div>}
      </div>}
      onCreatePlan={() => openCreate('plan')}
      onCreatePhase={plans.length > 0 ? () => openCreate('phase') : undefined}
      onCreatePhaseForPlan={(taskId) => {
        if (taskId.startsWith('goal:')) openCreate('phase', { planId: taskId.slice('goal:'.length) });
      }}
      onCreateSystem={() => openCreate('system')}
      onOpenPlanning={() => setPlanningDrawerOpen(true)}
      lifeStageEditorRequest={lifeStageEditorRequest}
      onManageProjectMaintenance={(taskId) => {
        const id = taskId.replace(/^goal:/, '');
        const plan = goals.find((item) => item.id === id && item.kind === 'plan');
        if (plan) openMaintenance('plan', plan.id, plan.name);
      }}
      onUpdateProjectPlacement={(id, placement) => {
        if (id.startsWith('goal:')) {
          const goalId = id.slice('goal:'.length);
          const goal = activeLifeMapItems(store.lifeMapGoals).find((item) => item.id === goalId);
          store.updateGoal(goal?.kind === 'phase' && goal.parentGoalId ? goal.parentGoalId : goalId, { placement });
        }
        else if (id.startsWith('system:')) store.updateSystem(id.slice('system:'.length), { placement });
      }}
      onUpdatePlanGroupPlacement={(groupId, placement) => {
        store.updatePlanGroupPlacement(groupId, placement);
      }}
      annotationAreaRequired={areas.length === 0}
      onRequireAnnotationArea={() => openAreaCreate('learning')}
      onCreateLifeStage={(item) => store.addStage({ id: item.id.replace(/^stage:/, ''), name: item.name, start: item.start, end: item.end, color: item.color })}
      onUpdateLifeStage={(item) => store.updateStage(item.id.replace(/^stage:/, ''), item)}
      onDeleteLifeStage={(id) => store.deleteStage(id.replace(/^stage:/, ''))}
      onCreateNote={(item) => item.type === 'range' && item.endDate
        ? store.addFocus({ id: item.id.replace(/^focus:/, ''), areaId: editorAreaId, name: item.name, start: item.date, end: item.endDate, color: item.color, placement: item.placement })
        : store.addNote({ id: item.id.replace(/^note:/, ''), areaId: editorAreaId, name: item.name, date: item.date, endDate: item.endDate, type: item.type, color: item.color, placement: item.placement })}
      onUpdateNote={(item) => {
        if (item.id.startsWith('theme:') && item.endDate) {
          store.updateTheme(item.id.replace(/^theme:/, ''), { name: item.name.replace(/^主题\s*[·・]\s*/, ''), start: item.date, end: item.endDate, color: item.color, placement: item.placement, layoutLane: item.layoutLane });
        } else if (focuses.some((focus) => focus.id === item.id) && item.endDate) {
          store.updateFocus(item.id, { name: item.name, start: item.date, end: item.endDate, color: item.color, placement: item.placement, layoutLane: item.layoutLane });
        } else {
          store.updateNote(item.id, { name: item.name, date: item.date, endDate: item.endDate, type: item.type, color: item.color, placement: item.placement, layoutLane: item.layoutLane });
        }
      }}
      onDeleteNote={(id) => id.startsWith('theme:') ? store.deleteTheme(id.replace(/^theme:/, '')) : focuses.some((focus) => focus.id === id) ? store.deleteFocus(id) : store.deleteNote(id)}
      onCreateMilestone={(item) => store.addEvent({ id: item.id.replace(/^event:/, ''), name: item.name, date: item.date, color: item.customColor, placement: item.placement, importance: item.importance, areaId: item.areaId, relatedPlanId: item.relatedPlanId })}
      onUpdateMilestone={(item) => store.updateEvent(item.id.replace(/^event:/, ''), { name: item.name, date: item.date, color: item.customColor, placement: item.placement, importance: item.importance, layoutLane: item.layoutLane, areaId: item.areaId, relatedPlanId: item.relatedPlanId })}
      onDeleteMilestone={(id) => store.deleteEvent(id.replace(/^event:/, ''))}
      onOpenTask={(taskId) => openEntity(taskId)}
    />
    <LifeMapPlanningDrawer
      open={planningDrawerOpen}
      plans={plans.filter((item) => item.status === 'active').map((item) => ({ id: item.id, name: item.name, meta: `${item.start} — ${item.targetDate}${activeMaintenancePeriod(item.maintenancePeriods) ? ' · 维护中' : ''}` }))}
      systems={activeSystems.map((item) => ({ id: item.id, name: item.name, meta: systemStats.get(item.id) ? `${systemStats.get(item.id)!.label} ${systemStats.get(item.id)!.completed}/${systemStats.get(item.id)!.target}` : undefined }))}
      reviews={reviews.slice().sort((left, right) => right.end.localeCompare(left.end)).slice(0, 5).map((item) => ({ id: item.id, name: item.title, meta: `${item.period === 'month' ? '月度' : '季度'} · ${item.end}` }))}
      periods={activeLifeMapItems(store.lifeMapStages).map((item) => ({ id: item.id, name: item.name, meta: `${item.start} — ${item.end}` }))}
      areas={allAreas.map((item) => ({ id: item.id, name: item.name, color: item.color, planGroupId: item.planGroupId, order: item.order, isHidden: item.isHidden, itemCount: areaItemCounts.get(item.id) ?? 0 }))}
      planGroups={activeLifeMapItems(store.lifeMapPlanGroups).sort((left, right) => left.order - right.order)}
      onClose={() => setPlanningDrawerOpen(false)}
      onEdit={(kind, item) => {
        setPlanningDrawerOpen(false);
        if (kind === 'plan') openEntity(`goal:${item.id}`);
        else if (kind === 'system') openEntity(`system:${item.id}`);
        else if (kind === 'review') openEntity(`review:${item.id}`);
        else {
          const period = activeLifeMapItems(store.lifeMapStages).find((periodItem) => periodItem.id === item.id);
          if (period) setLifeStageEditorRequest({ stage: { id: period.id, name: period.name, start: period.start, end: period.end, color: period.color }, token: Date.now() });
        }
      }}
      onCreateReview={(period) => {
        setPlanningDrawerOpen(false); openCreate('review'); setReviewPeriod(period);
        const base = dayjs(); const periodStart = period === 'month' ? base.startOf('month') : base.month(Math.floor(base.month() / 3) * 3).startOf('month');
        setStart(periodStart.format('YYYY-MM-DD')); setEnd(periodStart.add(period === 'month' ? 1 : 3, 'month').subtract(1, 'day').format('YYYY-MM-DD'));
      }}
      onCreatePeriod={() => { setPlanningDrawerOpen(false); setLifeStageEditorRequest({ token: Date.now() }); }}
      onCreateArea={(groupId) => { setPlanningDrawerOpen(false); openAreaCreate(groupId); }}
      onEditArea={(id) => { setPlanningDrawerOpen(false); openAreaEditor(id); }}
      onMoveArea={moveAreaWithinGroup}
      onToggleArea={(id) => {
        const area = allAreas.find((item) => item.id === id);
        if (!area) return;
        store.updateArea(id, { isHidden: !area.isHidden });
        if (!area.isHidden && selectedAreaId === id) setSelectedAreaId('all');
      }}
      onDeleteArea={(id) => {
        if ((areaItemCounts.get(id) ?? 0) > 0) return;
        if (!store.deleteArea(id)) return;
        if (selectedAreaId === id) setSelectedAreaId('all');
      }}
      onShiftPlans={plans.length > 0 ? () => { setPlanningDrawerOpen(false); openShiftEditor(); } : undefined}
      onUpdateGroupPlacement={store.updatePlanGroupPlacement}
    />
    {lastShift.length > 0 && <div className="life-map-shift-undo" role="status"><FastForward size={15} /><span>已统一调整 {lastShift.length} 个计划或阶段</span><button type="button" onClick={() => { store.restorePlanningItems(lastShift); setLastShift([]); }}>撤销</button><button type="button" aria-label="关闭调整提示" onClick={() => setLastShift([])}><X size={13} /></button></div>}
    {maintenanceEditor && maintenanceTarget && <div className="life-map-editor" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMaintenanceEditor(null); }}>
      <section className="life-map-editor__panel life-map-resilience-dialog" aria-label={`${maintenanceEditor.name}维护模式`}>
        <header><div><small>弹性规划</small><h2>{currentMaintenance ? '结束维护模式' : '进入维护模式'}</h2></div><button type="button" onClick={() => setMaintenanceEditor(null)} aria-label="关闭"><X /></button></header>
        <div className="life-map-resilience-dialog__subject"><PauseCircle size={18} /><span><b>{maintenanceEditor.name}</b><small>{maintenanceEditor.scope === 'area' ? '人生领域' : '项目'}</small></span></div>
        {currentMaintenance ? <>
          <div className="life-map-resilience-dialog__notice"><b>维护开始于 {currentMaintenance.start}</b><span>{currentMaintenance.reason || '没有填写原因'}</span><small>维护期间的长期系统不会被计入未完成，项目和日期保持不变。</small></div>
          <footer><button type="button" onClick={() => finishMaintenance(false)}>唤醒，日期不变</button><button type="button" className="is-primary" onClick={() => finishMaintenance(true)}>唤醒并顺延计划</button></footer>
        </> : <>
          <div className="life-map-editor__dates"><label>开始日期<input type="date" value={maintenanceStart} onChange={(event) => setMaintenanceStart(event.target.value)} /></label><label>预计恢复（可不填）<input type="date" min={maintenanceStart} value={maintenanceEnd} onChange={(event) => setMaintenanceEnd(event.target.value)} /></label></div>
          <label>原因或说明<textarea rows={3} value={maintenanceReason} onChange={(event) => setMaintenanceReason(event.target.value)} placeholder="例如：生病恢复、紧急出差、主动降低负荷" /></label>
          <div className="life-map-resilience-dialog__notice"><b>维护不是失败记录</b><span>长期系统暂停统计，项目保留原位置；恢复时可以选择是否整体顺延。</span></div>
          <footer><span /><button type="button" onClick={() => setMaintenanceEditor(null)}>取消</button><button type="button" className="is-primary" onClick={saveMaintenance}>开始维护</button></footer>
        </>}
      </section>
    </div>}
    {shiftEditorOpen && <div className="life-map-editor" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShiftEditorOpen(false); }}>
      <section className="life-map-editor__panel life-map-resilience-dialog life-map-shift-dialog" aria-label="批量平移计划">
        <header><div><small>弹性规划</small><h2>批量平移计划</h2></div><button type="button" onClick={() => setShiftEditorOpen(false)} aria-label="关闭"><X /></button></header>
        <label>整体移动天数<input type="number" min={-365} max={365} value={shiftDays} onChange={(event) => setShiftDays(Math.max(-365, Math.min(365, Number(event.target.value))))} /></label>
        <div className="life-map-shift-dialog__columns">
          <section><b>选择项目或子阶段</b><small>选择项目会自动包含所属子阶段</small><div className="life-map-shift-dialog__list">{shiftCandidates.map((item) => <label key={item.id} className={item.kind === 'phase' ? 'is-phase' : ''}><input type="checkbox" checked={shiftSelection.includes(item.id)} onChange={(event) => setShiftSelection((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} /><span><b>{item.name}</b><small>{item.start}—{item.targetDate}</small></span></label>)}{shiftCandidates.length === 0 && <small>当前范围没有可调整的项目或子阶段。</small>}</div></section>
          <section><b>调整预览</b><small>关键日期和人生时期保持不变</small><div className="life-map-shift-dialog__preview">{shiftPreview.map((item) => <div key={item.id}><span><b>{item.name}</b><small>{item.kind === 'plan' ? '项目' : '项目子阶段'}</small></span><em>{item.start} → {item.shiftedStart}<br />{item.targetDate} → {item.shiftedEnd}</em></div>)}{shiftPreview.length === 0 && <small>请选择至少一个项目。</small>}</div></section>
        </div>
        <div className="life-map-resilience-dialog__notice"><b>固定事实不会移动</b><span>考试、报名截止、成绩公布、生日等关键日期不参与本次调整。提交后可以立即撤销。</span></div>
        <footer><span /><button type="button" onClick={() => setShiftEditorOpen(false)}>取消</button><button type="button" className="is-primary" disabled={shiftPreview.length === 0 || shiftDays === 0} onClick={commitShift}>确认平移 {shiftDays} 天</button></footer>
      </section>
    </div>}
      {!onboardingDismissed && !hasVisibleLifeMapContent && <aside className="life-map-onboarding" aria-label="人生地图入门">
      <button type="button" className="life-map-onboarding__close" onClick={dismissOnboarding} aria-label="关闭引导"><X size={16} /></button>
      <small>第一次使用</small><h2>先建立一张真实可维护的人生地图</h2>
      <p>人生计划记录长期方向，长期系统记录持续规律，关键日期记录不能忽略的节点；项目规划中的任务不会出现在这里。</p>
      <div><button type="button" className="is-primary" onClick={() => applyTemplate('balanced')}>学习与生活平衡</button><button type="button" onClick={() => applyTemplate('health')}>健康重启</button><button type="button" onClick={dismissOnboarding}>从空白开始</button></div>
    </aside>}
    {editor && <LifeMapEntityEditor kind={editor.kind} onSubmit={saveEditor} onDismiss={() => setEditor(null)}>
        <header><div><small>人生地图</small><h2>{editor.id ? '编辑' : '新建'}{editor.kind === 'plan' ? '人生计划' : editor.kind === 'phase' ? '计划阶段' : editor.kind === 'system' ? '长期系统' : ['theme', 'focus', 'range-note'].includes(editor.kind) ? '时期重点' : editor.kind === 'review' ? '周期复盘' : '二级分类'}</h2></div><button type="button" onClick={() => setEditor(null)} aria-label="关闭"><X /></button></header>
        <label className="life-map-editor__name-field">{editor.kind === 'review' ? '复盘标题' : '名称'}<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={editor.kind === 'plan' ? '例如：考研政治' : editor.kind === 'phase' ? '例如：完成马原学习' : editor.kind === 'system' ? '例如：每周跑步' : editor.kind === 'review' ? '例如：七月复盘' : '写下真正重要的方向'} /></label>
        {['plan', 'phase'].includes(editor.kind) && <div className="life-map-editor__type-guide"><Layers3 size={15} /><span><b>这里设计人生地图中的长期推进方向</b><small>人生计划及其阶段只保存在人生地图数据库，不会生成项目规划任务。</small></span></div>}
        {editor.kind === 'phase' && <label>所属项目<select required value={parentGoalId} onChange={(event) => {
          const parent = plans.find((item) => item.id === event.target.value);
          setParentGoalId(event.target.value);
          if (parent) applyPhaseParentDefaults(parent, editor.id);
        }}><option value="">请选择项目</option>{plans.filter((item) => !editor.id || item.id !== editor.id).map((item) => <option key={item.id} value={item.id}>{areaById.get(item.areaId)?.name ?? '未分类'} · {item.name}</option>)}</select>{plans.length === 0 && <small className="life-map-editor__hint">请先新建项目，再添加子阶段。</small>}</label>}
        {!['area', 'review'].includes(editor.kind) && (areas.length > 0
          ? <label className="life-map-editor__classification">二级分类<select aria-label="人生领域" required disabled={editor.kind === 'phase'} value={draftAreaId} onChange={(event) => { const areaId = event.target.value; setDraftAreaId(areaId); setColor(areaById.get(areaId)?.color ?? color); }}>{areas.map((area) => <option key={area.id} value={area.id}>{LIFE_MAP_PLAN_GROUP_META[area.planGroupId].name} · {area.name}</option>)}</select><small>{editor.kind === 'phase' ? '自动继承所属项目' : '已根据当前视图自动选择，可直接修改'}</small></label>
          : <div className="life-map-editor__error" role="alert"><span>请先创建二级分类，再保存这项内容。</span><button type="button" onClick={() => openAreaCreate('learning')} aria-label="先创建二级分类">先创建二级分类</button></div>)}
        {editor.kind === 'review' && <><label>复盘范围<select value={reviewAreaId} onChange={(event) => setReviewAreaId(event.target.value)}><option value="all">全部人生</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>周期<select value={reviewPeriod} onChange={(event) => { const period = event.target.value as LifeReview['period']; const base = dayjs(); const periodStart = period === 'month' ? base.startOf('month') : base.month(Math.floor(base.month() / 3) * 3).startOf('month'); setReviewPeriod(period); setStart(periodStart.format('YYYY-MM-DD')); setEnd(periodStart.add(period === 'month' ? 1 : 3, 'month').subtract(1, 'day').format('YYYY-MM-DD')); }}><option value="month">月度复盘</option><option value="quarter">季度复盘</option></select></label></>}
        {editor.kind === 'area' && <label>所属一级分类<select value={draftPlanGroupId} onChange={(event) => setDraftPlanGroupId(event.target.value as LifeMapPlanGroupId)}>{(['learning', 'work', 'life'] as const).map((id) => <option key={id} value={id}>{LIFE_MAP_PLAN_GROUP_META[id].name}</option>)}</select><small className="life-map-editor__hint">决定项目、子阶段和长期系统显示在哪个一级泳道，不改变任何日期。</small></label>}
        {['plan', 'phase'].includes(editor.kind) && <div className="life-map-editor__dates"><label>开始日期<input required type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>{editor.kind === 'phase' ? '子阶段结束' : '结束日期'}<input required type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label></div>}
        {editor.kind === 'system' && <><div className="life-map-editor__dates"><label>频率<select value={frequency} onChange={(event) => setFrequency(event.target.value as LifeSystem['frequency'])}><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label><label>开始日期<input required type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>{editorMoreVisible && hasEnd && <label>结束日期<input required type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label>}</div></>}
        {!['plan', 'phase', 'system', 'area'].includes(editor.kind) && <div className="life-map-editor__dates"><label>开始日期<input required type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label><label>结束日期<input required type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label></div>}
        {!editor.id && ['plan', 'phase', 'system'].includes(editor.kind) && <button className="life-map-editor__more-toggle" type="button" aria-expanded={showEditorMore} onClick={() => setShowEditorMore((visible) => !visible)}><span><b>更多设置</b><small>状态、进度、颜色等</small></span><ChevronDown size={15} /></button>}
        {editorMoreVisible && editor.kind === 'system' && <label className="life-map-editor__check"><input type="checkbox" checked={hasEnd} onChange={(event) => setHasEnd(event.target.checked)} />设置结束日期（不勾选表示长期持续）</label>}
        {editorMoreVisible && ['plan', 'phase', 'system'].includes(editor.kind) && <label>状态<select value={status} onChange={(event) => setStatus(event.target.value as LifeMapStatus)}><option value="active">进行中</option><option value="completed">已完成</option><option value="paused">已暂停</option><option value="archived">已归档</option></select></label>}
        {editorMoreVisible && ['plan', 'phase'].includes(editor.kind) && <><label className="life-map-editor__summary-field">{editor.kind === 'plan' ? '计划说明' : '阶段成果'}<textarea rows={3} value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={editor.kind === 'plan' ? '例如：完成政治一轮学习并进入整卷训练' : '例如：完成课程、章节练习和一次复盘'} /></label>{editor.kind === 'phase' && <label>完成进度 <b>{progress}%</b><input type="range" min={0} max={100} value={progress} onChange={(event) => setProgress(Number(event.target.value))} /></label>}</>}
        {editor.kind === 'plan' && editor.id && <section className="life-map-editor__phases" aria-label="人生计划阶段">
          <header><span><b>计划阶段</b><small>把人生计划拆成清晰的推进区间</small></span><button type="button" onClick={() => openCreate('phase', { planId: editor.id })}><Plus size={14} /><span>添加阶段</span></button></header>
          {activeLifeMapItems(store.lifeMapGoals).filter((item) => item.kind === 'phase' && item.parentGoalId === editor.id).sort((left, right) => left.start.localeCompare(right.start)).map((phase) => <button type="button" key={phase.id} onClick={() => openEntity(`goal:${phase.id}`)}><span><b>{phase.name}</b><small>{phase.start} — {phase.targetDate}</small></span><em>{calculateGoalProgress(phase)}%</em></button>)}
          {activeLifeMapItems(store.lifeMapGoals).every((item) => item.kind !== 'phase' || item.parentGoalId !== editor.id) && <p>尚无子阶段。系统会自动选择第一段未覆盖日期。</p>}
        </section>}
        {editorMoreVisible && editor.kind === 'system' && <div className="life-map-editor__dates"><label>目标次数<input type="number" min={1} value={targetCount} onChange={(event) => setTargetCount(Number(event.target.value))} /></label><label>每次分钟<input type="number" min={5} step={5} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} /></label></div>}
        {editorMoreVisible && editor.kind === 'system' && <label>单位<input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="次、公里、分、元…" /></label>}
        {editor.kind === 'review' && <><label>本周期发生了什么<textarea rows={5} value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="结果、感受、意外和原因…" /></label><label>下一周期如何调整<textarea rows={4} value={adjustments} onChange={(event) => setAdjustments(event.target.value)} placeholder="保留什么、停止什么、开始什么…" /></label>{editor.id && <div className="life-map-review-snapshot"><b>保存时快照</b><span>{reviewPlanSnapshots.length} 个项目 · {editingReview?.snapshot.systems.length ?? 0} 个长期系统</span>{reviewChanges.length ? <ul>{reviewChanges.slice(0, 6).map((change) => <li key={change}>{change}</li>)}</ul> : <small>与保存快照相比，暂无新的状态变化。</small>}</div>}</>}
        {(editorMoreVisible || !['plan', 'phase', 'system'].includes(editor.kind)) && editor.kind !== 'review' && <label className="life-map-editor__color-field">识别色<span className="life-map-editor__color-control"><span className="life-map-editor__color-swatch" style={{ background: color }}><Palette size={16} /></span><span><b>{color.toUpperCase()}</b><small>{editor.kind === 'phase' ? '自动继承项目颜色' : '用于时间线上的快速识别'}</small></span><input aria-label="选择识别色" disabled={editor.kind === 'phase'} type="color" value={color} onChange={(event) => setColor(event.target.value)} /></span></label>}
        {editor.kind === 'system' && editor.id && editingSystemStats && <div className="life-map-editor__checkin"><span><b>{editingSystemStats.label} {editingSystemStats.completed}/{editingSystemStats.target}{unit || '次'}</b><small>按自己的周期统计，不再强制折算成本周</small></span><div className="life-map-editor__checkin-row"><input aria-label="打卡日期" type="date" value={checkInDate} onChange={(event) => setCheckInDate(event.target.value)} /><button type="button" disabled={selectedDateCheckIn <= 0} onClick={() => store.setSystemCheckIn(editor.id!, checkInDate, selectedDateCheckIn - 1)}>−</button><b>{selectedDateCheckIn}</b><button type="button" onClick={() => store.addSystemCheckIn(editor.id!, checkInDate)}>+</button></div><small>可补记过去日期，也可以用减号纠正误操作；记录会多端同步。</small></div>}
        {formError && <div className={formError.startsWith('已') ? 'life-map-editor__success' : 'life-map-editor__error'} role="alert">{formError}</div>}
        <footer>{editor.id && <button className="is-danger" type="button" onClick={deleteEditorItem}>删除</button>}<span /><button type="button" onClick={() => setEditor(null)}>取消</button><button className="is-primary" type="submit" disabled={!phaseCreationHasAvailability || !editorHasArea}>保存</button></footer>
    </LifeMapEntityEditor>}
  </div>;
};

export default LifeMapWorkspace;

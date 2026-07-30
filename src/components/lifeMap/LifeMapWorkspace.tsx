import React, { useEffect, useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import { ArrowDown, ArrowUp, ChevronDown, Eye, EyeOff, ListFilter, Settings2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { LifeStage, Milestone, Note, Task, TaskGroup } from '@/types';
import { activeLifeMapItems, hasIndependentLifeMapContent } from '@/lifeMap/data';
import { calculateGoalProgress, currentSystemStats, systemCompletedForRange, systemTargetForRange } from '@/lifeMap/metrics';
import { useLifeMapStore } from '@/lifeMap/store';
import type { LifeMapStatus, LifeReview, LifeSystem } from '@/lifeMap/types';
import LifeMapView from './LifeMapView';
import '@/styles/life-map-workspace.css';

type EditorKind = 'goal' | 'system' | 'theme' | 'area' | 'review';
type EditorState = { kind: EditorKind; id?: string } | null;
type ToolbarMenu = 'areas' | null;

const defaultDate = () => dayjs().format('YYYY-MM-DD');
const futureDate = () => dayjs().add(1, 'month').format('YYYY-MM-DD');

const LifeMapWorkspace: React.FC = () => {
  const store = useLifeMapStore(useShallow((state) => ({
    isHydrated: state.isHydrated,
    lifeMapAreas: state.lifeMapAreas,
    lifeMapStages: state.lifeMapStages,
    lifeMapThemes: state.lifeMapThemes,
    lifeMapGoals: state.lifeMapGoals,
    lifeMapSystems: state.lifeMapSystems,
    lifeMapSystemCheckIns: state.lifeMapSystemCheckIns,
    lifeMapEvents: state.lifeMapEvents,
    lifeMapFocuses: state.lifeMapFocuses,
    lifeMapNotes: state.lifeMapNotes,
    lifeMapRelations: state.lifeMapRelations,
    lifeMapReviews: state.lifeMapReviews,
    addArea: state.addArea,
    updateArea: state.updateArea,
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
  const [status, setStatus] = useState<LifeMapStatus>('active');
  const [progress, setProgress] = useState(0);
  const [metric, setMetric] = useState('');
  const [initialValue, setInitialValue] = useState<number | ''>('');
  const [currentValue, setCurrentValue] = useState<number | ''>('');
  const [targetValue, setTargetValue] = useState<number | ''>('');
  const [progressMode, setProgressMode] = useState<'manual' | 'auto'>('manual');
  const [unit, setUnit] = useState('');
  const [isCore, setIsCore] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [hasEnd, setHasEnd] = useState(false);
  const [reviewPeriod, setReviewPeriod] = useState<LifeReview['period']>('month');
  const [reviewAreaId, setReviewAreaId] = useState('all');
  const [reflection, setReflection] = useState('');
  const [adjustments, setAdjustments] = useState('');
  const [formError, setFormError] = useState('');
  const [showAreaManager, setShowAreaManager] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => localStorage.getItem('life-map-onboarding-v1') === 'done');
  const [toolbarMenu, setToolbarMenu] = useState<ToolbarMenu>(null);
  const [checkInDate, setCheckInDate] = useState(defaultDate);
  const toolbarRef = useRef<HTMLDivElement>(null);

  const areas = useMemo(
    () => activeLifeMapItems(store.lifeMapAreas).filter((area) => !area.isHidden).sort((a, b) => a.order - b.order),
    [store.lifeMapAreas],
  );
  const allAreas = useMemo(
    () => activeLifeMapItems(store.lifeMapAreas).sort((a, b) => a.order - b.order),
    [store.lifeMapAreas],
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
  const goals = useMemo(() => activeLifeMapItems(store.lifeMapGoals).filter((item) => visibleAreaIds.has(item.areaId) && (showArchived || item.status !== 'archived')), [showArchived, store.lifeMapGoals, visibleAreaIds]);
  const systems = useMemo(() => activeLifeMapItems(store.lifeMapSystems).filter((item) => visibleAreaIds.has(item.areaId) && (showArchived || item.status !== 'archived')), [showArchived, store.lifeMapSystems, visibleAreaIds]);
  const themes = useMemo(() => activeLifeMapItems(store.lifeMapThemes).filter((item) => visibleAreaIds.has(item.areaId)), [store.lifeMapThemes, visibleAreaIds]);
  const events = useMemo(() => activeLifeMapItems(store.lifeMapEvents).filter((item) => visibleAreaIds.has(item.areaId)), [store.lifeMapEvents, visibleAreaIds]);
  const focuses = useMemo(() => activeLifeMapItems(store.lifeMapFocuses).filter((item) => visibleAreaIds.has(item.areaId)), [store.lifeMapFocuses, visibleAreaIds]);
  const lifeNotes = useMemo(() => activeLifeMapItems(store.lifeMapNotes).filter((item) => visibleAreaIds.has(item.areaId)), [store.lifeMapNotes, visibleAreaIds]);
  const reviews = useMemo(() => activeLifeMapItems(store.lifeMapReviews), [store.lifeMapReviews]);
  const checkIns = useMemo(() => activeLifeMapItems(store.lifeMapSystemCheckIns), [store.lifeMapSystemCheckIns]);
  const activeSystems = systems.filter((item) => item.status === 'active');
  const systemStats = useMemo(() => new Map(systems.map((item) => [item.id, currentSystemStats(item, checkIns)])), [checkIns, systems]);
  const reachedSystemCount = activeSystems.filter((item) => {
    const stats = systemStats.get(item.id);
    return stats && stats.completed >= stats.target;
  }).length;

  const groups = useMemo<TaskGroup[]>(() => areas.filter((area) => visibleAreaIds.has(area.id)).map((area) => {
    const ranges = [
      ...goals.filter((item) => item.areaId === area.id).map((item) => [item.start, item.targetDate]),
      ...systems.filter((item) => item.areaId === area.id).map((item) => [item.start, item.end ?? dayjs().add(5, 'year').format('YYYY-MM-DD')]),
      ...themes.filter((item) => item.areaId === area.id).map((item) => [item.start, item.end]),
    ];
    const dates = ranges.flat().sort();
    return {
      id: area.id,
      name: area.name,
      color: area.color,
      start: dates[0] ?? defaultDate(),
      end: dates.at(-1) ?? futureDate(),
      children: [],
    };
  }), [areas, goals, systems, themes, visibleAreaIds]);

  const tasks = useMemo<Task[]>(() => [
    ...goals.map((item) => {
      const resolvedProgress = calculateGoalProgress(item);
      const metricLabel = item.metric && item.currentValue !== undefined && item.targetValue !== undefined
        ? `${item.metric} ${item.currentValue}${item.unit ?? ''} → ${item.targetValue}${item.unit ?? ''}`
        : `${resolvedProgress}%`;
      return {
      id: `goal:${item.id}`, name: item.name, start: item.start, end: item.targetDate,
      color: item.color ?? areaById.get(item.areaId)?.color, groupId: item.areaId,
      isMain: item.isCore, completed: item.status === 'completed', blocks: [], lifeMapKind: 'goal' as const,
      lifeMapMeta: metricLabel, lifeMapProgress: resolvedProgress, lifeMapPlacement: 'above' as const,
      };
    }),
    ...systems.map((item) => {
      const stats = systemStats.get(item.id) ?? currentSystemStats(item, checkIns);
      return {
      id: `system:${item.id}`, name: item.name,
      start: item.start, end: item.end ?? dayjs().add(5, 'year').format('YYYY-MM-DD'),
      color: item.color ?? areaById.get(item.areaId)?.color, groupId: item.areaId,
      completed: item.status === 'completed', blocks: [], lifeMapKind: 'system' as const,
      lifeMapMeta: `${stats.label} ${stats.completed}/${stats.target}${item.unit ?? '次'}`,
      lifeMapProgress: stats.target > 0 ? Math.min(100, Math.round(stats.completed / stats.target * 100)) : 0,
      lifeMapOpenEnded: !item.end, lifeMapPlacement: 'below' as const,
      };
    }),
    ...reviews.map((item) => ({
      id: `review:${item.id}`, name: `复盘 · ${item.title}`, start: item.start, end: item.end,
      color: '#64748B', groupId: item.areaIds?.[0] ?? groups[0]?.id, completed: true, blocks: [],
      lifeMapKind: 'review' as const, lifeMapMeta: item.period === 'month' ? '月度复盘' : '季度复盘', lifeMapPlacement: 'below' as const,
    })),
  ], [areaById, checkIns, goals, groups, reviews, systemStats, systems]);

  const notes = useMemo<Note[]>(() => [
    ...themes.map((item) => ({ id: `theme:${item.id}`, name: `主题 · ${item.name}`, date: item.start, endDate: item.end, type: 'range' as const, color: item.color, placement: item.placement ?? 'above' })),
    ...focuses.map((item) => ({ id: item.id, name: item.name, date: item.start, endDate: item.end, type: 'range' as const, color: item.color, placement: item.placement })),
    ...lifeNotes.map((item) => ({ id: item.id, name: item.name, date: item.date, endDate: item.endDate, type: item.type, color: item.color, placement: item.placement })),
  ], [focuses, lifeNotes, themes]);
  const milestones = useMemo<Milestone[]>(() => events.map((item) => ({
    id: item.id, name: item.name, date: item.date,
    color: item.color ?? areaById.get(item.areaId)?.color, placement: item.placement, importance: item.importance,
  })), [areaById, events]);
  const stages = useMemo<LifeStage[]>(() => activeLifeMapItems(store.lifeMapStages).map((item) => ({
    id: item.id, name: item.name, start: item.start, end: item.end, color: item.color,
  })), [store.lifeMapStages]);

  const editorAreaId = selectedAreaId !== 'all'
    ? selectedAreaId
    : areas.find((area) => area.id === 'learning')?.id ?? areas[0]?.id ?? 'learning';
  const openCreate = (kind: EditorKind) => {
    setToolbarMenu(null);
    setName(''); setStart(defaultDate()); setEnd(futureDate()); setTargetCount(3); setFrequency('weekly');
    setStatus('active'); setProgress(0); setMetric(''); setInitialValue(''); setCurrentValue(''); setTargetValue(''); setProgressMode('manual'); setUnit('');
    setIsCore(false); setDurationMinutes(30); setHasEnd(false); setCheckInDate(defaultDate());
    setReviewPeriod('month'); setReviewAreaId(selectedAreaId); setReflection(''); setAdjustments(''); setFormError('');
    setColor(areaById.get(editorAreaId)?.color ?? '#6366F1');
    setDraftAreaId(editorAreaId);
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
    const item = kind === 'goal' ? goals.find((entry) => entry.id === id)
      : kind === 'system' ? systems.find((entry) => entry.id === id)
        : themes.find((entry) => entry.id === id);
    if (!item) return;
    setName(item.name); setStart(item.start);
    setEnd('targetDate' in item ? item.targetDate : item.end ?? futureDate());
    setColor(item.color ?? areaById.get(item.areaId)?.color ?? '#6366F1');
    setDraftAreaId(item.areaId);
    setStatus('status' in item ? item.status : 'active');
    if ('progress' in item) {
      setProgress(calculateGoalProgress(item)); setMetric(item.metric ?? ''); setInitialValue(item.initialValue ?? ''); setCurrentValue(item.currentValue ?? '');
      setTargetValue(item.targetValue ?? ''); setProgressMode(item.progressMode ?? 'manual'); setUnit(item.unit ?? ''); setIsCore(Boolean(item.isCore));
    }
    if ('targetCount' in item) {
      setTargetCount(item.targetCount); setFrequency(item.frequency); setUnit(item.unit ?? '');
      setDurationMinutes(item.durationMinutes ?? 30); setHasEnd(Boolean(item.end));
    }
    setCheckInDate(defaultDate());
    setFormError('');
    setEditor({ kind: kind as EditorKind, id });
  };
  const openAreaEditor = (id: string) => {
    const area = allAreas.find((item) => item.id === id);
    if (!area) return;
    setName(area.name); setColor(area.color); setFormError(''); setEditor({ kind: 'area', id }); setShowAreaManager(false);
  };
  const validDateRange = () => /^\d{4}-\d{2}-\d{2}$/.test(start) && /^\d{4}-\d{2}-\d{2}$/.test(end) && dayjs(start).isValid() && dayjs(end).isValid() && !dayjs(end).isBefore(dayjs(start), 'day');
  const createReviewSnapshot = (): LifeReview['snapshot'] => {
    const scopedAreaIds = reviewAreaId === 'all' ? null : new Set([reviewAreaId]);
    const scopedGoals = activeLifeMapItems(store.lifeMapGoals).filter((item) => item.status !== 'archived' && (!scopedAreaIds || scopedAreaIds.has(item.areaId)));
    const scopedSystems = activeLifeMapItems(store.lifeMapSystems).filter((item) => item.status !== 'archived' && (!scopedAreaIds || scopedAreaIds.has(item.areaId)));
    return {
      goals: scopedGoals.map((item) => ({ id: item.id, name: item.name, status: item.status, progress: calculateGoalProgress(item) })),
      systems: scopedSystems.map((item) => ({
        id: item.id, name: item.name,
        completed: systemCompletedForRange(checkIns, item.id, start, end),
        target: systemTargetForRange(item, start, end),
        frequency: item.frequency,
      })),
    };
  };
  const saveEditor = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    setFormError('');
    if (!trimmed) { setFormError('请输入名称。'); return; }
    if (editor?.kind === 'goal' && progressMode === 'auto' && [initialValue, currentValue, targetValue].some((value) => value === '')) {
      setFormError('自动计算进度需要完整填写起始值、当前值和目标值。'); return;
    }
    const onlyStartRequired = editor?.kind === 'system' && !hasEnd;
    const startIsValid = /^\d{4}-\d{2}-\d{2}$/.test(start) && dayjs(start).isValid();
    if (editor?.kind !== 'area' && (onlyStartRequired ? !startIsValid : !validDateRange())) { setFormError('请选择完整日期，且结束日期不能早于开始日期。'); return; }
    if (editor?.kind === 'area') {
      if (editor.id) store.updateArea(editor.id, { name: trimmed, color });
      else store.addArea({ name: trimmed, color });
    } else if (editor?.kind === 'goal') {
      const numericValues = { initialValue: initialValue === '' ? undefined : initialValue, currentValue: currentValue === '' ? undefined : currentValue, targetValue: targetValue === '' ? undefined : targetValue };
      const resolvedProgress = calculateGoalProgress({ progress, progressMode, ...numericValues });
      const value = { areaId: draftAreaId, name: trimmed, start, targetDate: end, color, status, progress: resolvedProgress, progressMode, metric: metric.trim() || undefined, ...numericValues, unit: unit.trim() || undefined, isCore };
      const id = editor.id ?? store.addGoal(value).id;
      if (editor.id) store.updateGoal(editor.id, value);
      if (isCore) activeLifeMapItems(store.lifeMapGoals).filter((item) => item.id !== id && item.isCore).forEach((item) => store.updateGoal(item.id, { isCore: false }));
    } else if (editor?.kind === 'system') {
      const value = { areaId: draftAreaId, name: trimmed, start, end: hasEnd ? end : undefined, frequency, targetCount: Math.max(1, targetCount), durationMinutes: Math.max(5, durationMinutes), unit: unit.trim() || undefined, color, status };
      if (editor.id) store.updateSystem(editor.id, value); else store.addSystem(value);
    } else if (editor?.kind === 'theme') {
      const value = { areaId: draftAreaId, name: trimmed, start, end, color };
      if (editor.id) store.updateTheme(editor.id, value); else store.addTheme(value);
    } else if (editor?.kind === 'review') {
      const value = { title: trimmed, period: reviewPeriod, start, end, reflection: reflection.trim(), adjustments: adjustments.trim(), areaIds: reviewAreaId === 'all' ? undefined : [reviewAreaId] };
      if (editor.id) store.updateReview(editor.id, value); else store.addReview({ ...value, snapshot: createReviewSnapshot() });
    }
    setEditor(null);
  };
  const deleteEditorItem = () => {
    if (!editor?.id) return;
    if (editor.kind === 'goal') store.deleteGoal(editor.id);
    if (editor.kind === 'system') store.deleteSystem(editor.id);
    if (editor.kind === 'theme') store.deleteTheme(editor.id);
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
      store.addStage({ name: '重要目标与生活平衡期', start: defaultDate(), end: dayjs().add(3, 'month').endOf('month').format('YYYY-MM-DD'), color: '#7C6FE6' });
      store.addTheme({ areaId: learning.id, name: '推进当前最重要的学习目标', start: defaultDate(), end: dayjs().add(3, 'month').format('YYYY-MM-DD'), color: learning.color });
      store.addGoal({ areaId: learning.id, name: '完成本阶段核心学习成果', start: defaultDate(), targetDate: dayjs().add(3, 'month').format('YYYY-MM-DD'), color: learning.color, isCore: true });
      store.addSystem({ areaId: health.id, name: '保持规律运动', start: defaultDate(), frequency: 'weekly', targetCount: 3, durationMinutes: 40, color: health.color });
      store.addSystem({ areaId: health.id, name: '稳定睡眠节奏', start: defaultDate(), frequency: 'daily', targetCount: 1, durationMinutes: 10, color: health.color });
    } else {
      store.addTheme({ areaId: health.id, name: '恢复精力与稳定作息', start: defaultDate(), end: dayjs().add(2, 'month').format('YYYY-MM-DD'), color: health.color });
      store.addGoal({ areaId: health.id, name: '完成一次健康检查并建立基线', start: defaultDate(), targetDate: dayjs().add(1, 'month').format('YYYY-MM-DD'), color: health.color, isCore: true });
      store.addSystem({ areaId: health.id, name: '每周运动', start: defaultDate(), frequency: 'weekly', targetCount: 3, durationMinutes: 40, color: health.color });
      store.addSystem({ areaId: health.id, name: '按时入睡', start: defaultDate(), frequency: 'daily', targetCount: 1, durationMinutes: 10, color: health.color });
    }
    setSelectedAreaId(kind === 'health' ? health.id : 'all');
    dismissOnboarding();
  };
  const editingReview = editor?.kind === 'review' && editor.id ? reviews.find((item) => item.id === editor.id) : undefined;
  const editingSystem = editor?.kind === 'system' && editor.id ? systems.find((item) => item.id === editor.id) : undefined;
  const editingSystemStats = editingSystem ? currentSystemStats(editingSystem, checkIns) : undefined;
  const selectedDateCheckIn = editingSystem
    ? checkIns.find((item) => item.systemId === editingSystem.id && item.date === checkInDate)?.count ?? 0
    : 0;
  const reviewChanges = editingReview ? [
    ...editingReview.snapshot.goals.flatMap((before) => {
      const current = activeLifeMapItems(store.lifeMapGoals).find((item) => item.id === before.id);
      if (!current) return [`目标“${before.name}”已移除或归档`];
      const beforeProgress = before.progress ?? 0;
      const currentProgress = calculateGoalProgress(current);
      return before.status !== current.status || beforeProgress !== currentProgress ? [`目标“${before.name}”：${beforeProgress}% → ${currentProgress}%（${before.status} → ${current.status}）`] : [];
    }),
    ...editingReview.snapshot.systems.flatMap((before) => {
      const currentDone = checkIns.filter((item) => item.systemId === before.id && item.date >= editingReview.start && item.date <= editingReview.end).reduce((sum, item) => sum + item.count, 0);
      return currentDone !== before.completed ? [`系统“${before.name}”：${before.completed} → ${currentDone} 次`] : [];
    }),
  ] : [];

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
          <small>{selectedArea ? `${goals.length}目标 · ${systems.length}系统` : `${areas.length}领域 · ${reachedSystemCount}/${activeSystems.length}系统达标`}</small>
          <ChevronDown size={13} />
        </button>
        {toolbarMenu === 'areas' && <div className="life-map-scope__menu" role="menu" aria-label="选择人生领域">
          <header><strong>查看范围</strong><small>一次聚焦一个领域，时间坐标保持不变</small></header>
          <button type="button" role="menuitemradio" aria-checked={selectedAreaId === 'all'} onClick={() => { setSelectedAreaId('all'); setToolbarMenu(null); }}>
            <ListFilter size={16} /><span><b>全部人生</b><small>{areas.length} 个领域 · {activeLifeMapItems(store.lifeMapGoals).length} 个目标 · {activeLifeMapItems(store.lifeMapSystems).length} 个长期系统</small></span>
          </button>
          {areas.map((area) => {
            const areaGoals = activeLifeMapItems(store.lifeMapGoals).filter((item) => item.areaId === area.id).length;
            const areaSystems = activeLifeMapItems(store.lifeMapSystems).filter((item) => item.areaId === area.id).length;
            const theme = activeLifeMapItems(store.lifeMapThemes).find((item) => item.areaId === area.id);
            const reached = activeLifeMapItems(store.lifeMapSystems).filter((item) => item.areaId === area.id && item.status === 'active').filter((item) => {
              const stats = currentSystemStats(item, checkIns);
              return stats.completed >= stats.target;
            }).length;
            return <button key={area.id} type="button" role="menuitemradio" aria-checked={selectedAreaId === area.id} onClick={() => { setSelectedAreaId(area.id); setToolbarMenu(null); }}>
              <span className="life-map-scope__dot" style={{ background: area.color }} /><span><b>{area.name}</b><small>{theme?.name ?? `${areaGoals} 个目标 · ${areaSystems} 个长期系统`}{areaSystems > 0 ? ` · ${reached}/${areaSystems}达标` : ''}</small></span>
            </button>;
          })}
          <button type="button" className="life-map-scope__manage" onClick={() => setShowArchived((value) => !value)}>{showArchived ? <EyeOff size={15} /> : <Eye size={15} />}<span><b>{showArchived ? '隐藏归档内容' : '显示归档内容'}</b><small>归档只收起，不会删除数据</small></span></button>
          <button type="button" className="life-map-scope__manage" onClick={() => { setToolbarMenu(null); setShowAreaManager(true); }}><Settings2 size={15} /><span><b>管理人生领域</b><small>编辑、排序、隐藏或删除</small></span></button>
        </div>}
      </div>}
      onCreateGoal={() => openCreate('goal')}
      onCreateSystem={() => openCreate('system')}
      onCreateTheme={() => openCreate('theme')}
      onCreateArea={() => openCreate('area')}
      onCreateReview={() => openCreate('review')}
      annotationAreaRequired={selectedAreaId === 'all'}
      onRequireAnnotationArea={() => setToolbarMenu('areas')}
      onCreateLifeStage={(item) => store.addStage({ id: item.id.replace(/^stage:/, ''), name: item.name, start: item.start, end: item.end, color: item.color })}
      onUpdateLifeStage={(item) => store.updateStage(item.id.replace(/^stage:/, ''), item)}
      onDeleteLifeStage={(id) => store.deleteStage(id.replace(/^stage:/, ''))}
      onCreateNote={(item) => item.type === 'range' && item.endDate
        ? store.addFocus({ id: item.id.replace(/^focus:/, ''), areaId: editorAreaId, name: item.name, start: item.date, end: item.endDate, color: item.color, placement: item.placement })
        : store.addNote({ id: item.id.replace(/^note:/, ''), areaId: editorAreaId, name: item.name, date: item.date, endDate: item.endDate, type: item.type, color: item.color, placement: item.placement })}
      onUpdateNote={(item) => {
        if (item.id.startsWith('theme:') && item.endDate) {
          store.updateTheme(item.id.replace(/^theme:/, ''), { name: item.name.replace(/^主题\s*[·・]\s*/, ''), start: item.date, end: item.endDate, color: item.color, placement: item.placement });
        } else if (focuses.some((focus) => focus.id === item.id) && item.endDate) {
          store.updateFocus(item.id, { name: item.name, start: item.date, end: item.endDate, color: item.color, placement: item.placement });
        } else {
          store.updateNote(item.id, { name: item.name, date: item.date, endDate: item.endDate, type: item.type, color: item.color, placement: item.placement });
        }
      }}
      onDeleteNote={(id) => id.startsWith('theme:') ? store.deleteTheme(id.replace(/^theme:/, '')) : focuses.some((focus) => focus.id === id) ? store.deleteFocus(id) : store.deleteNote(id)}
      onCreateMilestone={(item) => store.addEvent({ id: item.id.replace(/^event:/, ''), areaId: editorAreaId, name: item.name, date: item.date, color: item.color, placement: item.placement, importance: item.importance })}
      onUpdateMilestone={(item) => store.updateEvent(item.id.replace(/^event:/, ''), { name: item.name, date: item.date, color: item.color, placement: item.placement, importance: item.importance })}
      onDeleteMilestone={(id) => store.deleteEvent(id.replace(/^event:/, ''))}
      onOpenTask={openEntity}
    />
    {!onboardingDismissed && !hasIndependentLifeMapContent(store) && <aside className="life-map-onboarding" aria-label="人生地图入门">
      <button type="button" className="life-map-onboarding__close" onClick={dismissOnboarding} aria-label="关闭引导"><X size={16} /></button>
      <small>第一次使用</small><h2>先建立一张真实可维护的人生地图</h2>
      <p>模板只创建少量示例，你可以随时编辑或删除。目标回答“想得到什么”，长期系统回答“平时如何保持”。</p>
      <div><button type="button" className="is-primary" onClick={() => applyTemplate('balanced')}>重要目标与生活平衡</button><button type="button" onClick={() => applyTemplate('health')}>健康重启</button><button type="button" onClick={dismissOnboarding}>从空白开始</button></div>
    </aside>}
    {showAreaManager && <div className="life-map-editor" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowAreaManager(false); }}>
      <section className="life-map-area-manager" role="dialog" aria-modal="true" aria-label="管理人生领域">
        <header><div><small>人生结构</small><h2>管理人生领域</h2></div><button type="button" onClick={() => setShowAreaManager(false)} aria-label="关闭"><X /></button></header>
        <p>隐藏不会删除数据；有规划内容的领域不能直接删除。</p>
        <div className="life-map-area-manager__list">{allAreas.map((area, index) => {
          const itemCount = [...store.lifeMapGoals, ...store.lifeMapSystems, ...store.lifeMapThemes, ...store.lifeMapEvents, ...store.lifeMapFocuses, ...store.lifeMapNotes].filter((item) => !item.deletedAt && 'areaId' in item && item.areaId === area.id).length;
          return <div key={area.id}><span className="life-map-scope__dot" style={{ background: area.color }} /><span><b>{area.name}</b><small>{itemCount} 项内容{area.isHidden ? ' · 已隐藏' : ''}</small></span><button type="button" disabled={index === 0} onClick={() => { const before = allAreas[index - 1]; store.updateArea(area.id, { order: before.order }); store.updateArea(before.id, { order: area.order }); }} aria-label="上移"><ArrowUp size={15} /></button><button type="button" disabled={index === allAreas.length - 1} onClick={() => { const after = allAreas[index + 1]; store.updateArea(area.id, { order: after.order }); store.updateArea(after.id, { order: area.order }); }} aria-label="下移"><ArrowDown size={15} /></button><button type="button" disabled={!area.isHidden && areas.length === 1} onClick={() => { store.updateArea(area.id, { isHidden: !area.isHidden }); if (!area.isHidden && selectedAreaId === area.id) setSelectedAreaId('all'); }} aria-label={area.isHidden ? '显示' : '隐藏'}>{area.isHidden ? <Eye size={15} /> : <EyeOff size={15} />}</button><button type="button" onClick={() => openAreaEditor(area.id)}>编辑</button></div>;
        })}</div>
        <footer><button type="button" onClick={() => { setShowAreaManager(false); openCreate('area'); }}>新增领域</button><span /><button className="is-primary" type="button" onClick={() => setShowAreaManager(false)}>完成</button></footer>
      </section>
    </div>}
    {editor && <div className="life-map-editor" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setEditor(null); }}>
      <form onSubmit={saveEditor}>
        <header><div><small>独立人生规划</small><h2>{editor.id ? '编辑' : '新建'}{editor.kind === 'goal' ? '目标' : editor.kind === 'system' ? '长期系统' : editor.kind === 'theme' ? '领域主题' : editor.kind === 'review' ? '周期复盘' : '人生领域'}</h2></div><button type="button" onClick={() => setEditor(null)} aria-label="关闭"><X /></button></header>
        <label>{editor.kind === 'review' ? '复盘标题' : '名称'}<input autoFocus required value={name} onChange={(event) => setName(event.target.value)} placeholder={editor.kind === 'goal' ? '例如：体重稳定到 70kg' : editor.kind === 'system' ? '例如：每周跑步' : editor.kind === 'review' ? '例如：七月复盘' : '写下真正重要的方向'} /></label>
        {!['area', 'review'].includes(editor.kind) && <label>人生领域<select required value={draftAreaId} onChange={(event) => { const areaId = event.target.value; setDraftAreaId(areaId); setColor(areaById.get(areaId)?.color ?? color); }}>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label>}
        {editor.kind === 'review' && <><label>复盘范围<select value={reviewAreaId} onChange={(event) => setReviewAreaId(event.target.value)}><option value="all">全部人生</option>{areas.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}</select></label><label>周期<select value={reviewPeriod} onChange={(event) => { const period = event.target.value as LifeReview['period']; const base = dayjs(); const periodStart = period === 'month' ? base.startOf('month') : base.month(Math.floor(base.month() / 3) * 3).startOf('month'); setReviewPeriod(period); setStart(periodStart.format('YYYY-MM-DD')); setEnd(periodStart.add(period === 'month' ? 1 : 3, 'month').subtract(1, 'day').format('YYYY-MM-DD')); }}><option value="month">月度复盘</option><option value="quarter">季度复盘</option></select></label></>}
        {editor.kind !== 'area' && <div className="life-map-editor__dates"><label>开始日期<input required type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>{(editor.kind !== 'system' || hasEnd) && <label>{editor.kind === 'goal' ? '目标日期' : '结束日期'}<input required type="date" value={end} min={start} onChange={(event) => setEnd(event.target.value)} /></label>}</div>}
        {editor.kind === 'system' && <label className="life-map-editor__check"><input type="checkbox" checked={hasEnd} onChange={(event) => setHasEnd(event.target.checked)} />设置结束日期（不勾选表示长期持续）</label>}
        {['goal', 'system'].includes(editor.kind) && <label>状态<select value={status} onChange={(event) => setStatus(event.target.value as LifeMapStatus)}><option value="active">进行中</option><option value="completed">已完成</option><option value="paused">已暂停</option><option value="archived">已归档</option></select></label>}
        {editor.kind === 'goal' && <><label className="life-map-editor__check"><input type="checkbox" checked={isCore} onChange={(event) => setIsCore(event.target.checked)} />设为当前核心目标</label><label>衡量指标<input value={metric} onChange={(event) => setMetric(event.target.value)} placeholder="例如：体重、存款、模拟成绩" /></label><div className="life-map-editor__dates">{progressMode === 'auto' && <label>起始值<input type="number" value={initialValue} onChange={(event) => setInitialValue(event.target.value === '' ? '' : Number(event.target.value))} /></label>}<label>当前值<input type="number" value={currentValue} onChange={(event) => setCurrentValue(event.target.value === '' ? '' : Number(event.target.value))} /></label><label>目标值<input type="number" value={targetValue} onChange={(event) => setTargetValue(event.target.value === '' ? '' : Number(event.target.value))} /></label></div><label className="life-map-editor__check"><input type="checkbox" checked={progressMode === 'auto'} onChange={(event) => setProgressMode(event.target.checked ? 'auto' : 'manual')} />自动计算进度</label>{progressMode === 'auto' ? <div className="life-map-editor__computed">自动进度 <b>{calculateGoalProgress({ progress, progressMode, initialValue: initialValue === '' ? undefined : initialValue, currentValue: currentValue === '' ? undefined : currentValue, targetValue: targetValue === '' ? undefined : targetValue })}%</b></div> : <label>完成进度 <b>{progress}%</b><input type="range" min={0} max={100} value={progress} onChange={(event) => setProgress(Number(event.target.value))} /></label>}</>}
        {editor.kind === 'system' && <div className="life-map-editor__dates"><label>频率<select value={frequency} onChange={(event) => setFrequency(event.target.value as LifeSystem['frequency'])}><option value="daily">每天</option><option value="weekly">每周</option><option value="monthly">每月</option></select></label><label>目标次数<input type="number" min={1} value={targetCount} onChange={(event) => setTargetCount(Number(event.target.value))} /></label><label>每次分钟<input type="number" min={5} step={5} value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} /></label></div>}
        {['goal', 'system'].includes(editor.kind) && <label>单位<input value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="次、公里、分、元…" /></label>}
        {editor.kind === 'review' && <><label>本周期发生了什么<textarea rows={5} value={reflection} onChange={(event) => setReflection(event.target.value)} placeholder="结果、感受、意外和原因…" /></label><label>下一周期如何调整<textarea rows={4} value={adjustments} onChange={(event) => setAdjustments(event.target.value)} placeholder="保留什么、停止什么、开始什么…" /></label>{editor.id && <div className="life-map-review-snapshot"><b>保存时快照</b><span>{editingReview?.snapshot.goals.length ?? 0} 个目标 · {editingReview?.snapshot.systems.length ?? 0} 个长期系统</span>{reviewChanges.length ? <ul>{reviewChanges.slice(0, 6).map((change) => <li key={change}>{change}</li>)}</ul> : <small>与保存快照相比，暂无新的状态变化。</small>}</div>}</>}
        {editor.kind !== 'review' && <label>识别色<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>}
        {editor.kind === 'system' && editor.id && editingSystemStats && <div className="life-map-editor__checkin"><span><b>{editingSystemStats.label} {editingSystemStats.completed}/{editingSystemStats.target}{unit || '次'}</b><small>按自己的周期统计，不再强制折算成本周</small></span><div className="life-map-editor__checkin-row"><input aria-label="打卡日期" type="date" value={checkInDate} onChange={(event) => setCheckInDate(event.target.value)} /><button type="button" disabled={selectedDateCheckIn <= 0} onClick={() => store.setSystemCheckIn(editor.id!, checkInDate, selectedDateCheckIn - 1)}>−</button><b>{selectedDateCheckIn}</b><button type="button" onClick={() => store.addSystemCheckIn(editor.id!, checkInDate)}>+</button></div><small>可补记过去日期，也可以用减号纠正误操作；记录会多端同步。</small></div>}
        {formError && <div className={formError.startsWith('已') ? 'life-map-editor__success' : 'life-map-editor__error'} role="alert">{formError}</div>}
        <footer>{editor.id && <button className="is-danger" type="button" onClick={deleteEditorItem}>删除</button>}<span /><button type="button" onClick={() => setEditor(null)}>取消</button><button className="is-primary" type="submit">保存</button></footer>
      </form>
    </div>}
  </div>;
};

export default LifeMapWorkspace;

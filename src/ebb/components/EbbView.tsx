// ============================================================
// Ebb - 主视图容器（重构版）
// 单页全宽布局：顶部导航栏 + 统计区 + 三视图Tab切换
// 视图：矩阵视图 / 目录视图 / 看板视图
// ============================================================

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { requestConfirmation } from '@/services/confirmation';
import { requestManualReviewToggle } from '@/services/reviewCompletionCommands';
import '@/styles/ebb.css';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import { todayStr, addDays, formatDate, getDayOfWeek, makeLocalDayjs } from '@/utils/dateSafe';
import {
  Plus,
  Settings as SettingsIcon,
  RotateCcw,
  X,
  LayoutGrid,
  Columns3,
  Download,
  Upload,
  Trash2,
  ChevronLeft,
  ChevronRight,
  BrainCircuit,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  MoreHorizontal,
  CalendarCheck2,
  Calendar,
  CalendarArrowDown,
  CalendarRange,
  Inbox,
  ListChecks,
} from 'lucide-react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { useEbbStore } from '../store';
import { useGraphStore } from '@/graph/store';
import { useShallow } from 'zustand/react/shallow';
import { buildNextRoundTask, getReviewTopicKey, computeRounds, isOverdue, isDueToday, calcTodayPoints, calcWeekPoints } from '../scheduler';
import { getPointWeight } from '../complexity';
import { ROUND_COLORS } from '../constants';
import { buildRootNodeMap, getReviewCategoryColor, resolveReviewCategory } from '../category';
import { normalizeLegacyEbbData } from '../migration';
import { getDateLabel } from '../scheduler';
import type { ReviewTask, EbbSettings } from '../types';
import AddContentModal from './AddContentModal';
import SettingsPanel from './SettingsPanel';
import EbbDatePicker from './EbbDatePicker';
import RoundsPanel from './RoundsPanel';
import MatrixView from './MatrixView';
import BoardView from './BoardView';
import InboxPanel from './InboxPanel';
import BatchAdjustPanel from './BatchAdjustPanel';
import BatchRescheduleBoard from './BatchRescheduleBoard';
import DailyReviewPlanner from './DailyReviewPlanner';
import SyncStatusIndicator from '@/components/SyncStatusIndicator';
import WorkspaceHeader from '@/components/WorkspaceHeader';
import { planReviewRoundReschedule, type ReviewRescheduleMode } from '../reschedulePlanning';
import { buildBalancedDailyReviewPlan } from '../dailyReviewPlanning';
import { useOperationHistory } from '@/services/operationHistory';
import { MOTION_DURATION, MOTION_EASE_ENTER } from '@/motion/system';
import { takeReviewPlanFocus } from '@/services/actionBridge';

type PlanViewMode = 'list' | 'calendar';
const REVIEW_ADJUSTMENT_INTENT_KEY = 'smart-line-review-adjustment-intent';

const EbbView: React.FC = () => {
  const [bridgeReviewTaskId] = useState(() => takeReviewPlanFocus());
  const prefersReducedMotion = useReducedMotion();
  const safeMode = useMemo(() => {
    try { return sessionStorage.getItem('smart-line-ebb-safe-mode') === '1'; }
    catch { return false; }
  }, []);
  // 选择性订阅: 只关心 reviewTasks/inboxItems/outlineNodes/ebbSettings/undoStack
  // + 各 CRUD 方法（方法引用稳定）。避免 syncStatus 等无关切片变化触发本组件重渲染。
  const {
    isHydrated,
    hydrateStore,
    reviewTasks: rawReviewTasks,
    inboxItems,
    outlineNodes,
    ebbSettings,
    undoStack,
    deleteReviewTask,
    updateReviewTask,
    addReviewTasks,
    exportEbbData,
    importEbbData,
    clearAllTasks,
    popUndo,
    applyBatchReviewAdjustment,
    applyDailyReviewPlan,
    rescheduleReviewRounds,
  } = useEbbStore(
    useShallow((s) => ({
      isHydrated: s.isHydrated,
      hydrateStore: s.hydrateStore,
      reviewTasks: s.reviewTasks,
      inboxItems: s.inboxItems,
      outlineNodes: s.outlineNodes,
      ebbSettings: s.ebbSettings,
      undoStack: s.undoStack,
      deleteReviewTask: s.deleteReviewTask,
      updateReviewTask: s.updateReviewTask,
      addReviewTasks: s.addReviewTasks,
      exportEbbData: s.exportEbbData,
      importEbbData: s.importEbbData,
      clearAllTasks: s.clearAllTasks,
      popUndo: s.popUndo,
      applyBatchReviewAdjustment: s.applyBatchReviewAdjustment,
      applyDailyReviewPlan: s.applyDailyReviewPlan,
      rescheduleReviewRounds: s.rescheduleReviewRounds,
    })),
  );

  const graphNodes = useGraphStore((state) => state.nodes);
  
  // 过滤掉已归档节点关联的复习任务，确保冷数据不出现在 Ebb 矩阵和排期中
  const reviewTasks = useMemo(() => {
    const archivedNodeIds = new Set(graphNodes.filter(n => n.isArchived).map(n => n.id));
    const active = rawReviewTasks.filter(t => !t.isArchived && (!t.graphNodeId || !archivedNodeIds.has(t.graphNodeId)));
    if (!safeMode || active.length <= 700) return active;
    return [...active]
      .sort((a, b) => Number(a.isCompleted) - Number(b.isCompleted) || a.dueDate.localeCompare(b.dueDate))
      .slice(0, 700);
  }, [rawReviewTasks, graphNodes, safeMode]);
  const highLoadMode = !safeMode && reviewTasks.length > 1500;

  const exitSafeMode = useCallback(() => {
    try { sessionStorage.removeItem('smart-line-ebb-safe-mode'); } catch { /* optional storage */ }
    window.location.reload();
  }, []);

  // 重构 store 视图供下游代码以 `store.X` 形式访问
  const store = useMemo(
    () => ({
      reviewTasks,
      inboxItems,
      outlineNodes,
      ebbSettings,
      undoStack,
      deleteReviewTask,
      updateReviewTask,
      addReviewTasks,
      exportEbbData,
      importEbbData,
      clearAllTasks,
      popUndo,
      applyBatchReviewAdjustment,
      applyDailyReviewPlan,
      rescheduleReviewRounds,
    }),
    [
      reviewTasks,
      inboxItems,
      outlineNodes,
      ebbSettings,
      undoStack,
      deleteReviewTask,
      updateReviewTask,
      addReviewTasks,
      exportEbbData,
      importEbbData,
      clearAllTasks,
      popUndo,
      applyBatchReviewAdjustment,
      applyDailyReviewPlan,
      rescheduleReviewRounds,
    ],
  );
  const [planViewMode, setPlanViewMode] = useState<PlanViewMode>('list');
  const [addOpen, setAddOpen] = useState(false);
  const [inboxOpen, setInboxOpen] = useState(false);
  const [modal, setModal] = useState<'none' | 'settings'>('none');
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [datePicker, setDatePicker] = useState<{ taskId: string; anchor: HTMLElement | null } | null>(null);
  const [roundsTopic, setRoundsTopic] = useState<string | null>(null);
  const [toast, setToast] = useState<string>('');
  const [toastCanUndo, setToastCanUndo] = useState(false);
  const [toastCanReviewChanges, setToastCanReviewChanges] = useState(false);
  const [timelineTopic, setTimelineTopic] = useState<string | null>(null);
  const [batchAdjustOpen, setBatchAdjustOpen] = useState(false);
  const [adjustmentPreset, setAdjustmentPreset] = useState<'default' | 'backlog'>('default');
  const [adjustmentPreviewExpanded, setAdjustmentPreviewExpanded] = useState(false);
  const [batchRescheduleOpen, setBatchRescheduleOpen] = useState(false);
  const [batchRescheduleKeys, setBatchRescheduleKeys] = useState<string[]>([]);
  const [selectedTopicKeys, setSelectedTopicKeys] = useState<Set<string>>(() => new Set());
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const toggleTopicSelection = useCallback((topicKey: string) => {
    setSelectedTopicKeys((current) => {
      const next = new Set(current);
      if (next.has(topicKey)) next.delete(topicKey);
      else next.add(topicKey);
      return next;
    });
  }, []);
  const multiSelectSelection = useMemo(
    () => (multiSelectMode
      ? { selectedKeys: selectedTopicKeys, onToggle: toggleTopicSelection }
      : undefined),
    [multiSelectMode, selectedTopicKeys, toggleTopicSelection],
  );
  const [dailyPlanOpen, setDailyPlanOpen] = useState(false);
  const [pendingDragReschedule, setPendingDragReschedule] = useState<{ taskId: string; targetDate: string } | null>(null);

  useEffect(() => {
    const task = bridgeReviewTaskId
      ? rawReviewTasks.find((candidate) => candidate.id === bridgeReviewTaskId)
      : undefined;
    if (!task) return;
    setSelectedDate(task.dueDate);
    setRoundsTopic(getReviewTopicKey(task));
  }, [bridgeReviewTaskId, rawReviewTasks]);
  const toastTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const latestOperation = useOperationHistory((state) => state.entries[0]);
  const undoOperation = useOperationHistory((state) => state.undo);

  // 异步加载 IndexedDB 数据
  useEffect(() => {
    if (!isHydrated) {
      hydrateStore();
    }
  }, [isHydrated, hydrateStore]);

  const showToast = useCallback((msg: string, canUndo = false, canReviewChanges = false) => {
    setToast(msg);
    setToastCanUndo(canUndo);
    setToastCanReviewChanges(canReviewChanges);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => {
      setToast('');
      setToastCanUndo(false);
      setToastCanReviewChanges(false);
    }, canUndo || canReviewChanges ? 8000 : 2500);
  }, []);

  const openAdjustmentDetails = useCallback(() => {
    setToast('');
    setToastCanReviewChanges(false);
    setAdjustmentPreset('default');
    setAdjustmentPreviewExpanded(true);
    setBatchAdjustOpen(true);
  }, []);

  useEffect(() => {
    try {
      if (sessionStorage.getItem(REVIEW_ADJUSTMENT_INTENT_KEY) !== 'daily-plan') return;
      sessionStorage.removeItem(REVIEW_ADJUSTMENT_INTENT_KEY);
      openAdjustmentDetails();
    } catch {
      // Session storage is optional; direct in-module navigation remains available.
    }
  }, [openAdjustmentDetails]);

  // Clean up any pending toast timer when the component unmounts.
  useEffect(() => {
    return () => {
      if (toastTimer.current !== null) {
        window.clearTimeout(toastTimer.current);
        toastTimer.current = null;
      }
    };
  }, []);

  const handleUndoLatestOperation = useCallback(async () => {
    if (!latestOperation) return;
    const undone = await undoOperation(latestOperation.id);
    showToast(undone ? `已撤销：${latestOperation.label}` : latestOperation.error ?? '撤销失败');
  }, [latestOperation, showToast, undoOperation]);

  // ── 统计数据 ──────────────────────────────────────────────
  const stats = useMemo(() => {
    const tasks = store.reviewTasks.filter((task) => !task.isArchived);
    const topicCount = new Set(tasks.map(getReviewTopicKey)).size;
    const todayDue = tasks.filter((t) => isDueToday(t) && !t.isCompleted).length;
    const overdueCount = tasks.filter(isOverdue).length;
    const todayPoints = calcTodayPoints(tasks, store.ebbSettings);
    const weekPoints = calcWeekPoints(tasks, store.ebbSettings);
    const completed = tasks.filter((t) => t.isCompleted).length;
    return {
      topicCount,
      total: tasks.length,
      todayDue,
      overdue: overdueCount,
      todayPoints,
      weekPoints,
      completed,
      ratio: tasks.length > 0 ? completed / tasks.length : 0,
    };
  }, [store.reviewTasks, store.ebbSettings]);

  const tomorrowWorkload = useMemo(() => buildBalancedDailyReviewPlan(
    reviewTasks,
    addDays(todayStr(), 1),
    store.ebbSettings.dailyReviewMinutes,
    3,
  ), [reviewTasks, store.ebbSettings.dailyReviewMinutes]);

  const hasUndo = store.undoStack.length > 0;
  // 注意：store 把最新撤销项放在 index 0（[entry, ...stack]），故读 [0]
  const lastUndo = store.undoStack[0];

  // ── 任务操作回调 ──────────────────────────────────────────
  const handleToggle = useCallback(
    async (id: string) => {
      const result = await requestManualReviewToggle(id);
      if (result.message) showToast(result.message);
    },
    [showToast],
  );

  const handleDelete = useCallback(
    (id: string) => {
      store.deleteReviewTask(id);
      showToast('已删除（可撤销）');
    },
    [store, showToast],
  );

  const handleReschedule = useCallback((id: string) => {
    setDatePicker({ taskId: id, anchor: null });
  }, []);

  const handleDateSelect = useCallback(
    (newDate: string | undefined) => {
      if (!datePicker) return;
      if (newDate) {
        try {
          const plan = planReviewRoundReschedule(store.reviewTasks, datePicker.taskId, newDate, 'single');
          store.rescheduleReviewRounds(plan.updates);
          showToast('已安全改期');
        } catch (cause) {
          showToast(cause instanceof Error ? cause.message : '轮次改期失败');
        }
      }
      setDatePicker(null);
    },
    [datePicker, store, showToast],
  );

  const handleAddRound = useCallback(
    (task: ReviewTask) => {
      const { totalRoundsMap } = computeRounds(store.reviewTasks);
      const topicKey = getReviewTopicKey(task);
      const sameTopic = store.reviewTasks
        .filter((t) => getReviewTopicKey(t) === topicKey)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
      const nextRound = buildNextRoundTask(sameTopic, store.ebbSettings);
      if (!nextRound) return;
      store.addReviewTasks([nextRound]);
      showToast(`已追加第 ${(totalRoundsMap.get(topicKey) ?? 0) + 1} 轮`);
    },
    [store, showToast],
  );

  const handleOpenRounds = useCallback((task: ReviewTask) => {
    setRoundsTopic(getReviewTopicKey(task));
  }, []);

  const handleOpenTimeline = useCallback((topicKey: string) => {
    setTimelineTopic(topicKey);
  }, []);

  const rescheduleTask = useCallback(
    (taskId: string, dueDate: string, patch: Partial<ReviewTask> = {}) => {
      try {
        const plan = planReviewRoundReschedule(store.reviewTasks, taskId, dueDate, 'single');
        store.rescheduleReviewRounds(plan.updates);
        const remainingPatch = { ...patch };
        delete remainingPatch.dueDate;
        if (Object.keys(remainingPatch).length > 0) store.updateReviewTask(taskId, remainingPatch);
        return true;
      } catch (cause) {
        showToast(cause instanceof Error ? cause.message : '轮次改期失败');
        return false;
      }
    },
    [store, showToast],
  );

  const applyDraggedReschedule = useCallback((mode: ReviewRescheduleMode) => {
    if (!pendingDragReschedule) return;
    try {
      const plan = planReviewRoundReschedule(
        store.reviewTasks,
        pendingDragReschedule.taskId,
        pendingDragReschedule.targetDate,
        mode,
      );
      store.rescheduleReviewRounds(plan.updates);
      showToast(mode === 'single'
        ? `已将“${plan.topicName}”R${plan.round}改期到 ${plan.targetDate}`
        : `已调整“${plan.topicName}”R${plan.round}及后续 ${plan.updates.length} 轮`);
      setSelectedDate(plan.targetDate);
      setPendingDragReschedule(null);
    } catch (cause) {
      showToast(cause instanceof Error ? cause.message : '轮次改期失败');
    }
  }, [pendingDragReschedule, showToast, store]);

  // 拖拽改期（看板视图）
  const handleDndEnd = useCallback(
    async (result: DropResult) => {
      const { draggableId, destination } = result;
      if (!destination) return;
      const destId = destination.droppableId;
      // 看板列拖拽：board-col-today / board-col-future / board-col-done
      // 标签泳道模式下 droppableId 形如 `${colId}::${tag}`，取列前缀即可
      const colId = destId.split('::')[0];
      // 校验拖拽源任务存在（避免并发删除后误操作）
      const taskExists = store.reviewTasks.some((t) => t.id === draggableId);
      if (!taskExists) return;
      if (colId === 'board-col-done') {
        const completion = await requestManualReviewToggle(draggableId);
        if (completion.message) showToast(completion.message);
      } else if (colId === 'board-col-today') {
        if (rescheduleTask(draggableId, todayStr(), { isCompleted: false })) {
          showToast('已改期到今天');
        }
      } else if (colId === 'board-col-future') {
        if (rescheduleTask(draggableId, addDays(todayStr(), 7), { isCompleted: false })) {
          showToast('已改期到下周');
        }
      } else if (colId.startsWith('ebb-day-')) {
        const newDate = colId.replace('ebb-day-', '');
        const selectedTask = store.reviewTasks.find((task) => task.id === draggableId);
        if (!selectedTask || selectedTask.dueDate === newDate) return;
        setPendingDragReschedule({ taskId: draggableId, targetDate: newDate });
      }
    },
    [store, showToast, rescheduleTask],
  );

  // 导出/导入
  const handleExport = useCallback(() => {
    const json = store.exportEbbData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-ebb-${todayStr()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [store]);

  const handleImport = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const parsed = JSON.parse(ev.target?.result as string);
        const normalized = normalizeLegacyEbbData(parsed);
        store.importEbbData(normalized);
        showToast('导入成功');
      } catch {
        showToast('导入失败：JSON 格式无效');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [store, showToast]);

  const handleClearAll = useCallback(async () => {
    if (!await requestConfirmation({
      title: '清空全部复习任务？',
      message: `即将清空 ${store.reviewTasks.length} 个复习任务。`,
      impact: ['复习轮次会从当前列表移除', '完成后仍可通过撤销恢复'],
      confirmLabel: '清空任务',
      tone: 'danger',
    })) return;
    store.clearAllTasks();
    showToast('已清空（可撤销）');
  }, [store, showToast]);

  const handleUndo = useCallback(() => {
    const entry = store.popUndo();
    if (entry) showToast(`已撤销：${entry.description}`);
  }, [store, showToast]);

  // 共享的任务操作 props（memo 化：所有依赖均 useCallback 稳定，避免每次渲染产生新对象传递给子组件）
  const taskActions = useMemo(
    () => ({
      onToggle: handleToggle,
      onDelete: handleDelete,
      onReschedule: handleReschedule,
      onAddRound: handleAddRound,
      onOpenRounds: handleOpenRounds,
      onOpenTimeline: handleOpenTimeline,
    }),
    [handleToggle, handleDelete, handleReschedule, handleAddRound, handleOpenRounds, handleOpenTimeline],
  );

  if (!isHydrated) {
    return (
      <div className="w-full h-full flex items-center justify-center bg-[#FAFAFA]">
        <div className="text-slate-400 text-sm">正在加载数据...</div>
      </div>
    );
  }

  return (
    <DragDropContext onDragEnd={handleDndEnd}>
      <div className="eb-app">
        {/* ── 顶部导航栏 ──────────────────────────────────── */}
        <WorkspaceHeader className="eb-nav" aria-label="艾宾浩斯复习工作区">
          <div className="eb-nav-left ui-workspace-header__identity">
            <span className="ui-workspace-header__identity-icon"><BrainCircuit size={18} aria-hidden="true" /></span>
            <div className="ui-workspace-header__identity-copy">
              <h1 className="eb-nav-brand">艾宾浩斯复习</h1>
              <p>记忆与复习工作台</p>
            </div>
          </div>
          <div className="eb-nav-context"><span>复习计划</span></div>
          <div className="eb-nav-right ui-workspace-header__actions">
            <button
              type="button"
              className="eb-nav-btn eb-nav-btn--primary"
              onClick={() => setAddOpen(true)}
              aria-label="快速添加复习内容"
              title="快速添加复习内容"
            >
              <Plus size={15} />
              <span className="eb-nav-btn-label">快速添加</span>
            </button>
                        {(
              <button
                type="button"
                className="eb-nav-btn eb-nav-tomorrow"
                onClick={() => setDailyPlanOpen(true)}
                aria-label={`明日 ${tomorrowWorkload.totalMinutes}/${store.ebbSettings.dailyReviewMinutes} 分钟，打开复习负荷规划`}
              >
                <CalendarCheck2 size={15} />
                <span>明日</span>
                <strong>{tomorrowWorkload.totalMinutes}/{store.ebbSettings.dailyReviewMinutes}</strong>
                <span className="eb-nav-tomorrow-unit">分钟</span>
              </button>
            )}
            <SyncStatusIndicator />
            <details className="eb-more-menu">
              <summary className="eb-nav-btn" aria-label="复习更多操作">
                <MoreHorizontal size={15} />
                <span className="eb-nav-btn-label">更多</span>
              </summary>
              <div className="eb-more-menu-popover" role="menu">
                <div className="eb-more-menu-overview" aria-label="已收纳的积分概览">
                  <span>今日积分<strong>{stats.todayPoints}</strong></span>
                  <span>本周积分<strong>{stats.weekPoints}</strong></span>
                </div>
                <button type="button" role="menuitem" onClick={() => setInboxOpen(true)}>
                  <Inbox size={15} />
                  暂存内容
                </button>
                <button type="button" role="menuitem" onClick={() => setModal('settings')}>
                  <SettingsIcon size={15} />
                  设置
                </button>
                <button type="button" role="menuitem" onClick={handleExport}>
                  <Download size={15} />
                  导出数据
                </button>
                <button type="button" role="menuitem" onClick={() => fileInputRef.current?.click()}>
                  <Upload size={15} />
                  导入数据
                </button>
                <button type="button" role="menuitem" className="is-danger" onClick={handleClearAll}>
                  <Trash2 size={15} />
                  清空所有任务
                </button>
                <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} hidden />
              </div>
            </details>
          </div>
        </WorkspaceHeader>

        {(safeMode || highLoadMode) && (
          <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            <span className="flex items-center gap-2"><ShieldCheck size={16} />{safeMode
              ? '安全模式已开启：优先显示最多 700 条复习轮次，并暂停高负载看板。'
              : `当前有 ${reviewTasks.length} 条复习轮次：矩阵会分批呈现，看板暂时停用以防止页面卡死。`}</span>
            {safeMode && <button type="button" onClick={exitSafeMode} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold hover:bg-amber-100">退出安全模式</button>}
          </div>
        )}

                {stats.overdue > 0 && store.ebbSettings.autoProcessOverdue && (
          <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900" role="status">
            <span className="flex items-center gap-2"><TriangleAlert size={16} />{stats.overdue} 个逾期轮次需要处理；不会再在启动时自动改期。</span>
            <button type="button" onClick={() => { setAdjustmentPreset('backlog'); setAdjustmentPreviewExpanded(false); setBatchAdjustOpen(true); }} className="rounded-lg border border-rose-300 bg-white px-3 py-1.5 text-xs font-bold hover:bg-rose-100">处理逾期</button>
          </div>
        )}

        {/* ── 统计区 ──────────────────────────────────────── */}
        {/* ── 撤销条（统一：优先 Ebb undoStack，其次 OperationHistory） ──── */}
        {(hasUndo && lastUndo) || latestOperation ? (
          <div className="eb-undo-bar" role="status" aria-live="polite">
            <RotateCcw size={14} />
            {hasUndo && lastUndo ? (
              <>
                <span>可撤销（艾宾浩斯）：{lastUndo.description}</span>
                <button type="button" className="eb-undo-btn" onClick={handleUndo}>撤销</button>
              </>
            ) : latestOperation ? (
              <>
                <span>可撤销（全局）：{latestOperation.label}</span>
                {latestOperation.canUndo && (
                  <button type="button" className="eb-undo-btn" onClick={() => void handleUndoLatestOperation()}>撤销</button>
                )}
              </>
            ) : null}
          </div>
        ) : null}

        {/* ── 全宽视图内容 ─────────────────────────────── */}
        <div className="eb-main-wrap ui-workspace-content-stage">
          <main className="eb-main">
            <AnimatePresence mode="wait" initial={false}>
                        {(
              <motion.div
                key="plans"
                id="plans-panel"
                role="tabpanel"
                aria-labelledby="tab-plans"
                className="h-full eb-matrix-panel"
                initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -2 }}
                transition={{
                  duration: prefersReducedMotion ? MOTION_DURATION.instant : MOTION_DURATION.fast,
                  ease: MOTION_EASE_ENTER,
                }}
              >
                <PlanCommands
                  tasks={store.reviewTasks}
                  selectedDate={selectedDate}
                  onSelectDate={setSelectedDate}
                  planViewMode={planViewMode}
                  onViewModeChange={setPlanViewMode}
                  onBatchAdjust={() => { setAdjustmentPreset('default'); setAdjustmentPreviewExpanded(false); setBatchAdjustOpen(true); }}
                  onBatchReschedule={() => {
                    // 进入多选模式（如果还没开），并打开批量改期面板
                    if (!multiSelectMode) {
                      setMultiSelectMode(true);
                    }
                    // 钩选集合以"已选 > 所有未完成主题"为先后顺序；
                    // 首次使用 fallback 预选所有未完成主题，方便用户直接拖
                    const initialKeys = selectedTopicKeys.size > 0
                      ? [...selectedTopicKeys]
                      : [...collectAllPendingTopicKeys(store.reviewTasks)];
                    if (selectedTopicKeys.size === 0) {
                      setSelectedTopicKeys(new Set(initialKeys));
                    }
                    setBatchRescheduleKeys(initialKeys);
                    setBatchRescheduleOpen(true);
                  }}
                  onBatchReschedulePanel={() => {
                    setBatchRescheduleKeys([...selectedTopicKeys]);
                    setBatchRescheduleOpen(true);
                  }}
                  onSelectAll={() => {
                    setSelectedTopicKeys(collectAllPendingTopicKeys(store.reviewTasks));
                  }}
                  onClearSelection={() => setSelectedTopicKeys(new Set())}
                  onToggleMultiSelect={() => {
                    setMultiSelectMode((current) => {
                      if (current) setSelectedTopicKeys(new Set());
                      return !current;
                    });
                  }}
                  safeMode={safeMode}
                  highLoadMode={highLoadMode}
                  selectedTopicCount={selectedTopicKeys.size}
                  multiSelectMode={multiSelectMode}
                />
                <div className={`eb-matrix-panel-content ${planViewMode === 'calendar' ? 'is-calendar' : ''}`}>
                  {planViewMode === 'list' ? (
                    <MatrixView
                      tasks={store.reviewTasks}
                      settings={store.ebbSettings}
                      taskActions={taskActions}
                      selectedDate={selectedDate}
                      selection={multiSelectSelection}
                      stats={stats}
                    />
                  ) : (
                    <BoardView tasks={store.reviewTasks} settings={store.ebbSettings} taskActions={taskActions} selectedDate={selectedDate} onSelectDate={setSelectedDate} hideNav />
                  )}
                </div>
                {multiSelectMode && planViewMode === 'list' && (
                  <div className="eb-plan-multi-banner" role="status">
                    <span>多选模式已开启，勾选需要的复习主题后点击"批量改期"。</span>
                    <button type="button" onClick={() => setMultiSelectMode(false)} aria-label="退出多选模式">退出</button>
                  </div>
                )}
              </motion.div>
            )}
            </AnimatePresence>
          </main>
        </div>

        {/* ── 模态弹窗 ────────────────────────────────────── */}
        {modal === 'settings' && (
          <SettingsPanel onClose={() => setModal('none')} />
        )}

        {batchAdjustOpen && (
          <BatchAdjustPanel
            reviewTasks={reviewTasks}
            settings={store.ebbSettings}
            initialGoal={adjustmentPreset === 'backlog' ? 'backlog' : undefined}
            initialScope={adjustmentPreset === 'backlog' ? 'overdue' : 'all'}
            initialPreviewExpanded={adjustmentPreviewExpanded}
            onApply={(request) => {
              const result = applyBatchReviewAdjustment(request);
              showToast(`已调整 ${result.affectedTopics} 个复习计划，关联日程已同步更新`, true);
              return result;
            }}
            onClose={() => setBatchAdjustOpen(false)}
          />
        )}

        {dailyPlanOpen && (
          <DailyReviewPlanner
            reviewTasks={reviewTasks}
            settings={store.ebbSettings}
            onApply={(request) => {
              const result = applyDailyReviewPlan(request);
              const deferredDates = [...new Set(Object.values(result.assignmentsByTaskId).filter((date) => date !== result.planDate))]
                .sort()
                .map((date) => formatDate(date, 'M月D日'));
              showToast(`明天保留 ${result.keptCount} 轮；另外 ${result.deferredCount} 轮已调整${deferredDates.length > 0 ? `至 ${deferredDates.join('、')}` : ''}`, false, result.deferredCount > 0);
              return result;
            }}
            onClose={() => setDailyPlanOpen(false)}
          />
        )}

        {batchRescheduleOpen && (
          <BatchRescheduleBoard
            reviewTasks={reviewTasks}
            settings={store.ebbSettings}
            initialTopicKeys={batchRescheduleKeys}
            onClose={() => {
              setBatchRescheduleOpen(false);
              setBatchRescheduleKeys([]);
            }}
            onCommitted={() => {
              setMultiSelectMode(false);
              setSelectedTopicKeys(new Set());
              showToast('已批量改期');
            }}
          />
        )}

        {/* 添加内容弹窗 */}
        <AddContentModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onGenerated={() => showToast('复习任务已生成')}
        />

        {inboxOpen && <InboxPanel onClose={() => setInboxOpen(false)} />}

        {/* 日期选择器（改期） */}
        {datePicker && (
          <EbbDatePicker
            anchorEl={datePicker.anchor}
            value={store.reviewTasks.find((t) => t.id === datePicker.taskId)?.dueDate}
            onSelect={handleDateSelect}
            onClose={() => setDatePicker(null)}
          />
        )}

        {/* 轮次管理弹窗 */}
        {roundsTopic && (
          <RoundsPanel topicKey={roundsTopic} onClose={() => setRoundsTopic(null)} />
        )}

        {/* 时间线浮层 */}
        {timelineTopic && (
          <TimelineStripModal
            topicName={store.reviewTasks.find((t) => getReviewTopicKey(t) === timelineTopic)?.topicName ?? ''}
            tasks={store.reviewTasks.filter((t) => getReviewTopicKey(t) === timelineTopic)}
            allTasks={store.reviewTasks}
            settings={store.ebbSettings}
            onClose={() => setTimelineTopic(null)}
            onToggle={handleToggle}
          />
        )}

        {pendingDragReschedule && (() => {
          const task = store.reviewTasks.find((item) => item.id === pendingDragReschedule.taskId);
          if (!task) return null;
          const topicRounds = store.reviewTasks
            .filter((item) => !item.isArchived && getReviewTopicKey(item) === getReviewTopicKey(task))
            .sort((left, right) => (left.roundOrder ?? 0) - (right.roundOrder ?? 0));
          const targetIndex = topicRounds.findIndex((item) => item.id === task.id);
          const followingCount = topicRounds.slice(targetIndex).filter((item) => !item.isCompleted).length;
          const round = task.roundOrder ?? targetIndex + 1;
          return <div className="eb-drag-reschedule-overlay" onClick={() => setPendingDragReschedule(null)}>
            <div className="eb-drag-reschedule" role="dialog" aria-modal="true" aria-label="选择轮次改期范围" onClick={(event) => event.stopPropagation()}>
              <div className="eb-drag-reschedule-head">
                <span>拖拽改期</span>
                <button type="button" onClick={() => setPendingDragReschedule(null)} aria-label="取消改期"><X size={16} /></button>
              </div>
              <h3>{task.topicName} · R{round}</h3>
              <p><b>{task.dueDate}</b><span>→</span><b>{pendingDragReschedule.targetDate}</b></p>
              <div className="eb-drag-reschedule-options">
                <button type="button" onClick={() => applyDraggedReschedule('single')}>
                  <span><Calendar size={17} /></span><strong>仅调整 R{round}</strong><small>其他轮次保持原日期</small>
                </button>
                {followingCount > 1 && <button type="button" onClick={() => applyDraggedReschedule('following')}>
                  <span><CalendarRange size={17} /></span><strong>R{round} 及后续一起移动</strong><small>保持间隔，共影响 {followingCount} 轮</small>
                </button>}
              </div>
              <button type="button" className="eb-drag-reschedule-cancel" onClick={() => setPendingDragReschedule(null)}>取消</button>
            </div>
          </div>;
        })()}

        {/* Toast */}
        {toast && <div className="eb-toast">{toast}{toastCanReviewChanges && <button type="button" onClick={openAdjustmentDetails}>查看这些改期</button>}{toastCanUndo && latestOperation?.canUndo && <button type="button" onClick={() => void handleUndoLatestOperation()}>撤销本次调整</button>}</div>}
      </div>
    </DragDropContext>
  );
};

// ── 当日任务列表（左侧栏用） ────────────────────────────────

const collectAllPendingTopicKeys = (tasks: ReviewTask[]): Set<string> => {
  const earliestByTopic = new Map<string, string>();
  tasks
    .filter((task) => !task.isArchived && !task.isCompleted)
    .forEach((task) => {
      const key = getReviewTopicKey(task);
      if (!earliestByTopic.has(key)) earliestByTopic.set(key, task.dueDate);
    });
  const result = new Set<string>();
  tasks
    .filter((task) => !task.isArchived && !task.isCompleted)
    .forEach((task) => {
      const key = getReviewTopicKey(task);
      const earliest = earliestByTopic.get(key);
      if (earliest !== undefined && task.dueDate === earliest) result.add(key);
    });
  return result;
};

const PlanCommands: React.FC<{
  tasks: ReviewTask[];
  selectedDate: string;
  onSelectDate: (date: string) => void;
  planViewMode: 'list' | 'calendar';
  onViewModeChange: (mode: 'list' | 'calendar') => void;
  onBatchAdjust: () => void;
  onBatchReschedule: () => void;
  safeMode: boolean;
  highLoadMode: boolean;
  selectedTopicCount: number;
  multiSelectMode: boolean;
  onToggleMultiSelect: () => void;
  onBatchReschedulePanel: () => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}> = ({ tasks, selectedDate, onSelectDate, planViewMode, onViewModeChange, onBatchAdjust, onBatchReschedule, safeMode, highLoadMode, selectedTopicCount, multiSelectMode, onToggleMultiSelect, onBatchReschedulePanel, onSelectAll, onClearSelection }) => {
  const today = todayStr();
  const weekday = getDayOfWeek(selectedDate);
  const weekStart = addDays(selectedDate, weekday === 0 ? -6 : 1 - weekday);

  return (
    <div className={`eb-plan-commands ${planViewMode === 'calendar' ? 'is-calendar' : ''}`}>
      <div className="eb-plan-commands-left">
        <button type="button" className="eb-plan-nav-btn" onClick={() => onSelectDate(addDays(selectedDate, -7))} aria-label="上一周"><ChevronLeft size={14} /></button>
        <strong className="eb-plan-week-label">{formatDate(weekStart, 'M月D日')}—{formatDate(addDays(weekStart, 6), 'M月D日')}</strong>
        <button type="button" className="eb-plan-nav-btn" onClick={() => onSelectDate(addDays(selectedDate, 7))} aria-label="下一周"><ChevronRight size={14} /></button>
        <button type="button" className="eb-plan-today-btn" onClick={() => onSelectDate(today)}>今天</button>
      </div>
      <div className="eb-plan-commands-right">
        <div className="eb-plan-view-switch" role="group" aria-label="视图切换">
          <button type="button" className={planViewMode === 'list' ? 'is-active' : ''} onClick={() => onViewModeChange('list')}><LayoutGrid size={13} />列表</button>
          <button type="button" className={planViewMode === 'calendar' ? 'is-active' : ''} disabled={safeMode || highLoadMode} title={safeMode || highLoadMode ? '当前数据量较大，暂不启用日历拖拽' : undefined} onClick={() => onViewModeChange('calendar')}><Columns3 size={13} />日历</button>
        </div>
        {multiSelectMode ? (
          <>
            <button type="button" className="eb-plan-link-btn" onClick={onSelectAll} title="勾选所有未完成主题"><ListChecks size={13} />全选</button>
            <button type="button" className="eb-plan-link-btn" disabled={selectedTopicCount === 0} onClick={onClearSelection} title="清空已选择主题">清空</button>
            <button
              type="button"
              className="eb-plan-batch-btn eb-plan-reschedule-btn"
              disabled={selectedTopicCount === 0}
              onClick={onBatchReschedulePanel}
              title={`基于已选中的 ${selectedTopicCount} 个主题进入批量改期面板`}
            >
              <CalendarArrowDown size={13} />批量改期
              <em>{selectedTopicCount}</em>
            </button>
            <button type="button" className="eb-plan-exit-multi" onClick={onToggleMultiSelect} aria-label="退出多选模式"><X size={13} /></button>
          </>
        ) : (
          <>
            <button type="button" className="eb-plan-batch-btn" disabled={tasks.length === 0} onClick={onBatchAdjust}><SlidersHorizontal size={13} />批量管理</button>
            <button
              type="button"
              className="eb-plan-batch-btn eb-plan-reschedule-btn"
              disabled={tasks.length === 0}
              onClick={onBatchReschedule}
              title="进入多选模式后可勾选主题，再批量改期"
            >
              <CalendarArrowDown size={13} />批量改期
            </button>
          </>
        )}
      </div>
    </div>
  );
};

interface DayTaskListProps {
  tasks: ReviewTask[];
  settings: EbbSettings;
  selectedDate: string;
  taskActions: {
    onToggle: (id: string) => void;
    onDelete: (id: string) => void;
    onAddRound: (task: ReviewTask) => void;
    onOpenRounds: (task: ReviewTask) => void;
    onOpenTimeline: (topicKey: string) => void;
    onReschedule: (id: string) => void;
  };
}

export const DayTaskList: React.FC<DayTaskListProps> = ({ tasks, settings, selectedDate, taskActions }) => {
  const graphNodes = useGraphStore((state) => state.nodes);
  const rootByNodeId = useMemo(() => buildRootNodeMap(graphNodes), [graphNodes]);
  const dayTasks = useMemo(
    () => tasks.filter((t) => t.dueDate === selectedDate).sort((a, b) => {
      if (a.isCompleted !== b.isCompleted) return a.isCompleted ? 1 : -1;
      return a.topicName.localeCompare(b.topicName);
    }),
    [tasks, selectedDate],
  );
  const { roundMap, totalRoundsMap } = useMemo(() => computeRounds(tasks), [tasks]);

  const totalPoints = useMemo(() => dayTasks.reduce((sum, t) => {
    const round = roundMap.get(t.id) ?? 0;
    return sum + (t.complexity ? getPointWeight(round, t.complexity, settings.complexityConfigs) : 0);
  }, 0), [dayTasks, roundMap, settings.complexityConfigs]);

  const completedCount = dayTasks.filter(t => t.isCompleted).length;
  const today = todayStr();
  const isToday = selectedDate === today;
  const isPast = selectedDate < today;

  const getAccentColor = (t: ReviewTask) => {
    if (t.isCompleted) return '#10B981';
    if (isOverdue(t)) return '#EF4444';
    if (isDueToday(t)) return '#F59E0B';
    return '#6B7FD7';
  };

  if (dayTasks.length === 0) {
    return (
      <div className="eb-cal-empty">
        <div className="eb-cal-empty-icon">📭</div>
        <p className="eb-cal-empty-text">{isToday ? '今日无任务，享受清闲' : isPast ? '当日无任务' : '当日暂无安排'}</p>
      </div>
    );
  }

  const completedPoints = dayTasks.filter(t => t.isCompleted).reduce((sum, t) => {
    const round = roundMap.get(t.id) ?? 0;
    return sum + (t.complexity ? getPointWeight(round, t.complexity, settings.complexityConfigs) : 0);
  }, 0);

  return (
    <div className="eb-cal-day-content">
      {/* 当日进度摘要 */}
      <div className="eb-cal-day-summary">
        <div className="eb-cal-day-stats">
          <span className="eb-cal-day-stat">
            <span className="eb-cal-day-stat-num" style={{ color: '#10B981' }}>{completedCount}</span>
            <span className="eb-cal-day-stat-label">/{dayTasks.length} 完成</span>
          </span>
          <span className="eb-cal-day-stat">
            <span className="eb-cal-day-stat-num" style={{ color: '#6B7FD7' }}>{completedPoints}</span>
            <span className="eb-cal-day-stat-label">/{totalPoints} 积分</span>
          </span>
        </div>
        <div className="eb-cal-day-progress">
          <div className="eb-cal-day-progress-fill" style={{
            width: `${dayTasks.length > 0 ? (completedCount / dayTasks.length) * 100 : 0}%`,
            background: completedCount === dayTasks.length ? '#10B981' : '#6B7FD7',
          }} />
        </div>
      </div>

      {/* 任务卡片列表 */}
      <div className="eb-cal-task-cards">
        {dayTasks.map((t) => {
          const round = roundMap.get(t.id) ?? 0;
          const total = totalRoundsMap.get(getReviewTopicKey(t)) ?? 0;
          const points = t.complexity ? getPointWeight(round, t.complexity, settings.complexityConfigs) : 0;
          const accent = getAccentColor(t);
          const ratio = total > 0 ? round / total : 0;
          const dateLabel = isOverdue(t) ? { text: '逾期', cls: 'overdue' }
            : isDueToday(t) ? { text: '今日', cls: 'today' }
            : t.isCompleted ? { text: '完成', cls: 'done' }
            : { text: '待复习', cls: 'pending' };

          return (
            <div
              key={t.id}
              className={`eb-cal-task-card ${t.isCompleted ? 'eb-cal-task-card--done' : ''} ${isOverdue(t) ? 'eb-cal-task-card--overdue' : ''}`}
              style={{ '--card-accent': accent } as React.CSSProperties}
            >
              <div className="eb-cal-task-card-bar" style={{ backgroundColor: accent }} />
              <div className="eb-cal-task-card-body">
                <div className="eb-cal-task-card-top">
                  <input
                    type="checkbox"
                    className="eb-cal-task-check"
                    checked={t.isCompleted}
                    onChange={() => taskActions.onToggle(t.id)}
                  />
                  <span className="eb-cal-task-card-name" onClick={() => taskActions.onOpenTimeline(getReviewTopicKey(t))}>
                    {t.topicName}
                  </span>
                </div>
                <div className="eb-cal-task-card-meta">
                  <span className="eb-cal-task-round-badge" style={{
                    color: ROUND_COLORS[(round - 1) % ROUND_COLORS.length],
                    background: ROUND_COLORS[(round - 1) % ROUND_COLORS.length] + '15',
                  }}>
                    R{round}/{total}
                  </span>
                  <span className={`eb-cal-task-date-badge eb-cal-task-date-badge--${dateLabel.cls}`}>
                    {dateLabel.text}
                  </span>
                  {(() => {
                    const category = resolveReviewCategory(t, rootByNodeId);
                    const color = getReviewCategoryColor(category, settings.tagColors);
                    return category ? (
                      <span
                        className="eb-cal-task-card-tag"
                        style={color ? { backgroundColor: `${color}40`, color: '#374151' } : undefined}
                      >
                        {category.label}
                      </span>
                    ) : null;
                  })()}
                  <span className="eb-cal-task-card-points">+{points}分</span>
                </div>
                <div className="eb-cal-task-card-progress">
                  <div className="eb-cal-task-card-progress-bar">
                    <div
                      className="eb-cal-task-card-progress-fill"
                      style={{ width: `${ratio * 100}%`, backgroundColor: accent }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// 内联迷你日历（增强版）
export const MiniCalendarInline: React.FC<{
  tasks: ReviewTask[];
  settings: EbbSettings;
  selectedDate: string;
  onSelectDate: (d: string) => void;
}> = ({ tasks, settings, selectedDate, onSelectDate }) => {
  const [viewMonth, setViewMonth] = useState(() => makeLocalDayjs(selectedDate));
  const today = todayStr();
  const monthStart = viewMonth.startOf('month');
  const monthEnd = viewMonth.endOf('month');
  const startWeekday = monthStart.day();
  const days: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) days.push(null);
  for (let d = monthStart; d.isBefore(monthEnd) || d.isSame(monthEnd); d = d.add(1, 'day')) {
    days.push(`${d.year()}-${String(d.month() + 1).padStart(2, '0')}-${String(d.date()).padStart(2, '0')}`);
  }
  while (days.length % 7 !== 0) days.push(null);

  const dayTaskMap = useMemo(() => {
    const map = new Map<string, { total: number; completed: number; overdue: number; pending: number }>();
    for (const t of tasks) {
      const entry = map.get(t.dueDate) ?? { total: 0, completed: 0, overdue: 0, pending: 0 };
      entry.total++;
      if (t.isCompleted) entry.completed++;
      else if (isOverdue(t)) entry.overdue++;
      else entry.pending++;
      map.set(t.dueDate, entry);
    }
    return map;
  }, [tasks]);

  const goToday = () => {
    setViewMonth(dayjs());
    onSelectDate(today);
  };

  const isCurrentMonth = viewMonth.isSame(dayjs(), 'month'); // dayjs() 取本地时间，无偏移

  return (
    <div className="eb-mini-cal">
      <div className="eb-mini-cal-header">
        <div className="eb-mini-cal-nav">
          <button type="button" className="eb-mini-cal-nav-btn" onClick={() => setViewMonth(viewMonth.subtract(1, 'month'))}>
            <ChevronLeft size={14} />
          </button>
          <span className="eb-mini-cal-title">{`${viewMonth.year()}年${String(viewMonth.month() + 1).padStart(2, '0')}月`}</span>
          <button type="button" className="eb-mini-cal-nav-btn" onClick={() => setViewMonth(viewMonth.add(1, 'month'))}>
            <ChevronRight size={14} />
          </button>
        </div>
        {!isCurrentMonth && (
          <button type="button" className="eb-mini-cal-today" onClick={goToday}>今天</button>
        )}
      </div>
      <div className="eb-mini-cal-grid">
        {['日', '一', '二', '三', '四', '五', '六'].map((w, i) => (
          <span key={`wd-${w}`} className={`eb-mini-cal-weekday-header ${i === 0 || i === 6 ? 'eb-mini-cal-weekday--weekend' : ''}`}>{w}</span>
        ))}
        {days.map((d, i) => {
          if (!d) return <div key={i} className="eb-mini-cal-cell eb-mini-cal-cell--empty" />;
          const info = dayTaskMap.get(d);
          const count = info?.total ?? 0;
          const completedCount = info?.completed ?? 0;
          const overdueCount = info?.overdue ?? 0;
          const pendingCount = info?.pending ?? 0;
          const isSelected = d === selectedDate;
          const isToday = d === today;
          const isWeekend = getDayOfWeek(d) === 0 || getDayOfWeek(d) === 6;
          const allDone = count > 0 && completedCount === count;

          // 任务量分级（仅未全完成时着色）
          const th = settings.loadThresholds ?? [2, 4, 6, 9];
          let loadLevel = 0;
          if (count > 0 && !allDone) {
            if (count <= th[0]) loadLevel = 1;
            else if (count <= th[1]) loadLevel = 2;
            else if (count <= th[2]) loadLevel = 3;
            else if (count <= th[3]) loadLevel = 4;
            else loadLevel = 5;
          }
          const hasOverdue = overdueCount > 0;

          const dotColors: string[] = [];
          if (allDone) {
            // 全完成：只显示淡绿色圆点
            for (let di = 0; di < Math.min(count, 4); di++) dotColors.push('#A7F3D0');
          } else {
            if (overdueCount > 0) dotColors.push('#EF4444');
            if (pendingCount > 0) dotColors.push('#6B7FD7');
            if (completedCount > 0 && dotColors.length < 4) dotColors.push('#10B981');
            while (dotColors.length < Math.min(count, 4)) dotColors.push('#D1D5DB');
          }

          return (
            <button
              key={i}
              type="button"
              className={`eb-mini-cal-cell ${isSelected ? 'eb-mini-cal-cell--selected' : ''} ${isToday ? 'eb-mini-cal-cell--today' : ''} ${isWeekend ? 'eb-mini-cal-cell--weekend' : ''} ${loadLevel > 0 && !isSelected ? `eb-mini-cal-cell--load-${loadLevel}` : ''} ${hasOverdue && !isSelected ? 'eb-mini-cal-cell--overdue' : ''} ${allDone && !isSelected ? 'eb-mini-cal-cell--alldone' : ''}`}
              onClick={() => onSelectDate(d)}
              title={count > 0 ? `${count} 个任务（${completedCount} 已完成 / ${overdueCount} 逾期 / ${pendingCount} 待办）` : '无任务'}
            >
              <span className="eb-mini-cal-day">{parseInt(d.slice(-2))}</span>
              {count > 0 && (
                <span className="eb-mini-cal-dots">
                  {dotColors.slice(0, 4).map((c, di) => (
                    <span key={di} className="eb-mini-cal-dot-item" style={{ backgroundColor: c }} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <CalendarLegend settings={settings} />
    </div>
  );
};

// ── 日历图例 ────────────────────────────────────────────────
const CalendarLegend: React.FC<{ settings: EbbSettings }> = ({ settings }) => {
  const th = settings.loadThresholds ?? [2, 4, 6, 9];
  const items = [
    { color: '#FFFFFF', border: '#E5E7EB', label: '无' },
    { color: '#ECFDF5', label: `≤${th[0]}` },
    { color: '#A7F3D0', label: `≤${th[1]}` },
    { color: '#FDE68A', label: `≤${th[2]}` },
    { color: '#FDBA74', label: `≤${th[3]}` },
    { color: '#FCA5A5', label: `>${th[3]}` },
    { color: '#FFFFFF', border: '#D1D5DB', label: '已结清' },
  ];
  return (
    <div className="eb-mini-cal-legend">
      {items.map((it, i) => (
        <span key={i} className="eb-mini-cal-legend-item">
          <span
            className="eb-mini-cal-legend-swatch"
            style={{ backgroundColor: it.color, borderColor: it.border || 'transparent' }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
};

// ── 时间线浮层组件 ──────────────────────────────────────────
interface TimelineStripModalProps {
  topicName: string;
  tasks: ReviewTask[];
  allTasks: ReviewTask[];
  settings: EbbSettings;
  onClose: () => void;
  onToggle: (id: string) => void;
}

const TimelineStripModal: React.FC<TimelineStripModalProps> = ({
  topicName,
  tasks,
  allTasks,
  settings,
  onClose,
  onToggle,
}) => {
  const sorted = useMemo(() => [...tasks].sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '')), [tasks]);
  const { roundMap } = useMemo(() => computeRounds(allTasks), [allTasks]);
  const completedCount = sorted.filter((t) => t.isCompleted).length;
  const ratio = sorted.length > 0 ? completedCount / sorted.length : 0;

  return createPortal(
    <div className="eb-modal-overlay" onClick={onClose}>
      <div className="eb-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="eb-modal-header">
          <h3 className="eb-modal-title">{topicName} · 复习时间线</h3>
          <button type="button" className="eb-modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="eb-modal-body">
          <div className="eb-timeline-summary">
            <span>共 {sorted.length} 轮 · 已完成 {completedCount}</span>
            <div className="eb-timeline-progress">
              <div className="eb-timeline-progress-bar">
                <div className="eb-timeline-progress-fill" style={{ width: `${ratio * 100}%` }} />
              </div>
              <span>{Math.round(ratio * 100)}%</span>
            </div>
          </div>
          <div className="eb-timeline-strip">
            {sorted.map((t, i) => {
              const round = roundMap.get(t.id) ?? i + 1;
              const color = ROUND_COLORS[(round - 1) % ROUND_COLORS.length];
              const dateLabel = getDateLabel(t.dueDate, t.isCompleted);
              const points = t.complexity ? getPointWeight(round, t.complexity, settings.complexityConfigs) : 0;
              const prevDone = i === 0 || sorted[i - 1].isCompleted;
              const connectorClass = t.isCompleted
                ? 'eb-timeline-connector--done'
                : dateLabel.variant === 'overdue'
                  ? 'eb-timeline-connector--overdue'
                  : prevDone
                    ? 'eb-timeline-connector--soon'
                    : 'eb-timeline-connector--transition';
              return (
                <div key={t.id} className="eb-timeline-node-wrap">
                  {i > 0 && <div className={`eb-timeline-connector ${connectorClass}`} />}
                  <button
                    type="button"
                    className={`eb-timeline-node ${t.isCompleted ? 'eb-timeline-node--done' : ''}`}
                    style={{ '--node-color': color } as React.CSSProperties}
                    onClick={() => onToggle(t.id)}
                    title={t.isCompleted ? '取消完成' : '标记完成'}
                  >
                    <span className="eb-timeline-node-round">{round}</span>
                    <span className="eb-timeline-node-date">{dateLabel.text}</span>
                    <span className="eb-timeline-node-points">{points}分</span>
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
};

export default EbbView;

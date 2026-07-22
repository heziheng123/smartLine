// ============================================================
// Ebb - 主视图容器（重构版）
// 单页全宽布局：顶部导航栏 + 统计区 + 三视图Tab切换
// 视图：矩阵视图 / 目录视图 / 看板视图
// ============================================================

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
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
  LibraryBig,
  ListChecks,
  AlarmClock,
  TriangleAlert,
  Target,
  ChartNoAxesColumn,
  ShieldCheck,
  SlidersHorizontal,
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
import OverdueAlertModal from './OverdueAlertModal';
import MatrixView from './MatrixView';
import BoardView from './BoardView';
import BatchAdjustPanel from './BatchAdjustPanel';

type ViewTab = 'matrix' | 'board';

const EbbView: React.FC = () => {
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
    toggleReviewTask,
    deleteReviewTask,
    updateReviewTask,
    addReviewTasks,
    exportEbbData,
    importEbbData,
    clearAllTasks,
    popUndo,
    applyBatchReviewAdjustment,
  } = useEbbStore(
    useShallow((s) => ({
      isHydrated: s.isHydrated,
      hydrateStore: s.hydrateStore,
      reviewTasks: s.reviewTasks,
      inboxItems: s.inboxItems,
      outlineNodes: s.outlineNodes,
      ebbSettings: s.ebbSettings,
      undoStack: s.undoStack,
      toggleReviewTask: s.toggleReviewTask,
      deleteReviewTask: s.deleteReviewTask,
      updateReviewTask: s.updateReviewTask,
      addReviewTasks: s.addReviewTasks,
      exportEbbData: s.exportEbbData,
      importEbbData: s.importEbbData,
      clearAllTasks: s.clearAllTasks,
      popUndo: s.popUndo,
      applyBatchReviewAdjustment: s.applyBatchReviewAdjustment,
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
      toggleReviewTask,
      deleteReviewTask,
      updateReviewTask,
      addReviewTasks,
      exportEbbData,
      importEbbData,
      clearAllTasks,
      popUndo,
      applyBatchReviewAdjustment,
    }),
    [
      reviewTasks,
      inboxItems,
      outlineNodes,
      ebbSettings,
      undoStack,
      toggleReviewTask,
      deleteReviewTask,
      updateReviewTask,
      addReviewTasks,
      exportEbbData,
      importEbbData,
      clearAllTasks,
      popUndo,
      applyBatchReviewAdjustment,
    ],
  );
  const [activeTab, setActiveTab] = useState<ViewTab>('matrix');
  const [addOpen, setAddOpen] = useState(false);
  const [modal, setModal] = useState<'none' | 'settings'>('none');
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [datePicker, setDatePicker] = useState<{ taskId: string; anchor: HTMLElement | null } | null>(null);
  const [roundsTopic, setRoundsTopic] = useState<string | null>(null);
  const [toast, setToast] = useState<string>('');
  const [overdueAlertOpen, setOverdueAlertOpen] = useState(false);
  const [timelineTopic, setTimelineTopic] = useState<string | null>(null);
  const [batchAdjustOpen, setBatchAdjustOpen] = useState(false);
  const toastTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 异步加载 IndexedDB 数据
  useEffect(() => {
    if (!isHydrated) {
      hydrateStore();
    }
  }, [isHydrated, hydrateStore]);

  // 启动时检测逾期任务
  useEffect(() => {
    const hasOverdue = store.reviewTasks.some((t) => !t.isCompleted && isOverdue(t));
    if (hasOverdue && store.ebbSettings.autoProcessOverdue) {
      setOverdueAlertOpen(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(''), 2500);
  }, []);

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

  const hasUndo = store.undoStack.length > 0;
  // 注意：store 把最新撤销项放在 index 0（[entry, ...stack]），故读 [0]
  const lastUndo = store.undoStack[0];

  // ── 任务操作回调 ──────────────────────────────────────────
  const handleToggle = useCallback(
    (id: string) => {
      const err = store.toggleReviewTask(id);
      if (err) showToast(err);
    },
    [store, showToast],
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
        const selectedTask = store.reviewTasks.find((task) => task.id === datePicker.taskId);
        if (selectedTask) {
          const topicKey = getReviewTopicKey(selectedTask);
          const hasConflict = store.reviewTasks.some(
            (task) =>
              task.id !== selectedTask.id
              && getReviewTopicKey(task) === topicKey
              && task.dueDate === newDate,
          );
          if (hasConflict) {
            showToast('同一主题在该日期已经有复习轮次');
            setDatePicker(null);
            return;
          }
        }
        store.updateReviewTask(datePicker.taskId, { dueDate: newDate });
        showToast('已改期');
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
      const selectedTask = store.reviewTasks.find((task) => task.id === taskId);
      if (!selectedTask) return false;
      const topicKey = getReviewTopicKey(selectedTask);
      const hasConflict = store.reviewTasks.some(
        (task) =>
          task.id !== taskId
          && getReviewTopicKey(task) === topicKey
          && task.dueDate === dueDate,
      );
      if (hasConflict) {
        showToast('同一主题在该日期已经有复习轮次');
        return false;
      }
      store.updateReviewTask(taskId, { ...patch, dueDate });
      return true;
    },
    [store, showToast],
  );

  // 拖拽改期（看板视图）
  const handleDndEnd = useCallback(
    (result: DropResult) => {
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
        // 校验轮次顺序（与 toggleReviewTask 一致）
        const err = store.toggleReviewTask(draggableId);
        if (err) {
          showToast(err);
        } else {
          showToast('已标记完成');
        }
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
        if (rescheduleTask(draggableId, newDate)) showToast('已改期');
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

  const handleClearAll = useCallback(() => {
    if (!confirm(`确认清空所有 ${store.reviewTasks.length} 个复习任务？可通过撤销恢复。`)) return;
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
        <header className="eb-nav">
          <div className="eb-nav-left">
            <span className="eb-nav-brand"><BrainCircuit size={18} aria-hidden="true" />艾宾浩斯复习</span>
            <button
              type="button"
              className="eb-nav-btn eb-nav-btn--primary"
              onClick={() => setAddOpen(true)}
            >
              <Plus size={15} />
              快速添加
            </button>
          </div>
          <div className="eb-nav-right">
            <button
              type="button"
              className="eb-nav-btn"
              onClick={() => setBatchAdjustOpen(true)}
              disabled={reviewTasks.length === 0}
            >
              <SlidersHorizontal size={15} />
              批量调整
            </button>
            <button
              type="button"
              className="eb-nav-btn"
              onClick={() => setModal('settings')}
            >
              <SettingsIcon size={15} />
              设置
            </button>
          </div>
        </header>

        {(safeMode || highLoadMode) && (
          <div className="mx-4 mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
            <span className="flex items-center gap-2"><ShieldCheck size={16} />{safeMode
              ? '安全模式已开启：优先显示最多 700 条复习轮次，并暂停高负载看板。'
              : `当前有 ${reviewTasks.length} 条复习轮次：矩阵会分批呈现，看板暂时停用以防止页面卡死。`}</span>
            {safeMode && <button type="button" onClick={exitSafeMode} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-bold hover:bg-amber-100">退出安全模式</button>}
          </div>
        )}

        {/* ── 统计区 ──────────────────────────────────────── */}
        <section className="eb-stats-bar">
          <div className="eb-stats-cards">
            <div className="eb-stat-card">
              <span className="eb-stat-icon"><LibraryBig size={15} aria-hidden="true" /></span>
              <span className="eb-stat-value">{stats.topicCount}</span>
              <span className="eb-stat-label">学习内容</span>
            </div>
            <div className="eb-stat-card">
              <span className="eb-stat-icon"><ListChecks size={15} aria-hidden="true" /></span>
              <span className="eb-stat-value">{stats.total}</span>
              <span className="eb-stat-label">总任务</span>
            </div>
            <div className={`eb-stat-card ${stats.todayDue > 0 ? 'eb-stat-card--warn' : ''}`}>
              <span className="eb-stat-icon"><AlarmClock size={15} aria-hidden="true" /></span>
              <span className="eb-stat-value">{stats.todayDue}</span>
              <span className="eb-stat-label">今日到期</span>
            </div>
            <div className={`eb-stat-card ${stats.overdue > 0 ? 'eb-stat-card--danger' : ''}`}>
              <span className="eb-stat-icon"><TriangleAlert size={15} aria-hidden="true" /></span>
              <span className="eb-stat-value">{stats.overdue}</span>
              <span className="eb-stat-label">逾期</span>
            </div>
            <div className="eb-stat-card">
              <span className="eb-stat-icon"><Target size={15} aria-hidden="true" /></span>
              <span className="eb-stat-value">{stats.todayPoints}</span>
              <span className="eb-stat-label">今日积分</span>
            </div>
            <div className="eb-stat-card">
              <span className="eb-stat-icon"><ChartNoAxesColumn size={15} aria-hidden="true" /></span>
              <span className="eb-stat-value">{stats.weekPoints}</span>
              <span className="eb-stat-label">本周积分</span>
            </div>
          </div>
          <div className="eb-stats-progress">
            <div className="eb-stats-progress-info">
              <span>整体完成率</span>
              <span className="eb-stats-progress-num">
                {stats.completed}/{stats.total} · {Math.round(stats.ratio * 100)}%
              </span>
            </div>
            <div className="eb-stats-progress-bar">
              <div className="eb-stats-progress-fill" style={{ width: `${stats.ratio * 100}%` }} />
            </div>
          </div>
          <div className="eb-stats-actions">
            <button type="button" className="eb-stats-action" onClick={handleExport} title="导出数据">
              <Download size={14} />
            </button>
            <button type="button" className="eb-stats-action" onClick={() => fileInputRef.current?.click()} title="导入数据">
              <Upload size={14} />
            </button>
            <input ref={fileInputRef} type="file" accept=".json" onChange={handleImport} style={{ display: 'none' }} />
            <button type="button" className="eb-stats-action eb-stats-action--danger" onClick={handleClearAll} title="清空所有任务">
              <Trash2 size={14} />
            </button>
          </div>
        </section>

        {/* ── 撤销条 ──────────────────────────────────────── */}
        {hasUndo && lastUndo && (
          <div className="eb-undo-bar">
            <RotateCcw size={14} />
            <span>可撤销：{lastUndo.description}</span>
            <button type="button" className="eb-undo-btn" onClick={handleUndo}>撤销</button>
          </div>
        )}

        {/* ── 视图Tab ─────────────────────────────────────── */}
        <nav className="eb-tabs" role="tablist" aria-label="复习视图切换">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'matrix'}
            aria-controls="matrix-panel"
            id="tab-matrix"
            className={`eb-tab ${activeTab === 'matrix' ? 'eb-tab--active' : ''}`}
            onClick={() => setActiveTab('matrix')}
          >
            <LayoutGrid size={14} aria-hidden="true" />
            矩阵视图
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'board'}
            aria-controls="board-panel"
            id="tab-board"
            className={`eb-tab ${activeTab === 'board' ? 'eb-tab--active' : ''}`}
            onClick={() => { if (!safeMode && !highLoadMode) setActiveTab('board'); }}
            disabled={safeMode || highLoadMode}
            title={safeMode || highLoadMode ? '当前数据量较大，暂不启用看板拖拽' : undefined}
          >
            <Columns3 size={14} aria-hidden="true" />
            看板视图
          </button>
        </nav>

        {/* ── 视图内容（左日历栏 + 右视图） ─────────────── */}
        <div className="eb-main-wrap">
          <aside className="eb-cal-sidebar">
            <MiniCalendarInline
              tasks={store.reviewTasks}
              settings={store.ebbSettings}
              selectedDate={selectedDate}
              onSelectDate={setSelectedDate}
            />
            <div className="eb-cal-sidebar-tasks">
              <div className="eb-cal-sidebar-date-header">
                <div className="eb-cal-sidebar-date-main">
                  <span className="eb-cal-sidebar-date-num">{Number(selectedDate.split('-')[2])}</span>
                  <div className="eb-cal-sidebar-date-info">
                    <span className="eb-cal-sidebar-date-month">{formatDate(selectedDate, 'YYYY年MM月')}</span>
                    <span className="eb-cal-sidebar-date-week">
                      {selectedDate === todayStr() ? '今天' :
                       selectedDate === addDays(todayStr(), -1) ? '昨天' :
                       selectedDate === addDays(todayStr(), 1) ? '明天' :
                       ['周日','周一','周二','周三','周四','周五','周六'][getDayOfWeek(selectedDate)]}
                    </span>
                  </div>
                </div>
              </div>
              <DayTaskList
                tasks={store.reviewTasks}
                settings={store.ebbSettings}
                selectedDate={selectedDate}
                taskActions={taskActions}
              />
            </div>
          </aside>
          <main className="eb-main">
            {activeTab === 'matrix' && (
              <div id="matrix-panel" role="tabpanel" aria-labelledby="tab-matrix" className="h-full">
                <MatrixView
                  tasks={store.reviewTasks}
                  settings={store.ebbSettings}
                  taskActions={taskActions}
                />
              </div>
            )}
            {activeTab === 'board' && (
              <div id="board-panel" role="tabpanel" aria-labelledby="tab-board" className="h-full">
                <BoardView
                  tasks={store.reviewTasks}
                  settings={store.ebbSettings}
                  taskActions={taskActions}
                />
              </div>
            )}
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
            onApply={(request) => {
              const result = applyBatchReviewAdjustment(request);
              showToast(`已调整 ${result.affectedTopics} 个复习计划，可在最近操作中撤销`);
              return result;
            }}
            onClose={() => setBatchAdjustOpen(false)}
          />
        )}

        {/* 添加内容弹窗 */}
        <AddContentModal
          open={addOpen}
          onClose={() => setAddOpen(false)}
          onGenerated={() => showToast('复习任务已生成')}
        />

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

        {/* 逾期提醒弹窗 */}
        {overdueAlertOpen && (
          <OverdueAlertModal onClose={() => setOverdueAlertOpen(false)} />
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

        {/* Toast */}
        {toast && <div className="eb-toast">{toast}</div>}
      </div>
    </DragDropContext>
  );
};

// ── 当日任务列表（左侧栏用） ────────────────────────────────
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

const DayTaskList: React.FC<DayTaskListProps> = ({ tasks, settings, selectedDate, taskActions }) => {
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
const MiniCalendarInline: React.FC<{
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

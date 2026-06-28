// ============================================================
// Ebb - 主视图容器（重构版）
// 单页全宽布局：顶部导航栏 + 统计区 + 三视图Tab切换
// 视图：矩阵视图 / 目录视图 / 看板视图
// ============================================================

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import dayjs from 'dayjs';
import {
  Plus,
  Settings as SettingsIcon,
  Inbox as InboxIcon,
  RotateCcw,
  X,
  LayoutGrid,
  FolderTree,
  Columns3,
  Download,
  Upload,
  Trash2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { useEbbStore } from '../store';
import { genId, suggestNextInterval, computeRounds, isOverdue, isDueToday, calcTodayPoints, calcWeekPoints } from '../scheduler';
import { getPointWeight, parseIntervals } from '../complexity';
import { ROUND_COLORS } from '../constants';
import { getDateLabel } from '../scheduler';
import type { ReviewTask, EbbSettings } from '../types';
import AddContentModal from './AddContentModal';
import SettingsPanel from './SettingsPanel';
import InboxPanel from './InboxPanel';
import EbbDatePicker from './EbbDatePicker';
import RoundsPanel from './RoundsPanel';
import OverdueAlertModal from './OverdueAlertModal';
import MatrixView from './MatrixView';
import DirectoryView from './DirectoryView';
import BoardView from './BoardView';

type ViewTab = 'matrix' | 'directory' | 'board';

const EbbView: React.FC = () => {
  const store = useEbbStore();
  const [activeTab, setActiveTab] = useState<ViewTab>('matrix');
  const [addOpen, setAddOpen] = useState(false);
  const [modal, setModal] = useState<'none' | 'settings' | 'inbox'>('none');
  const [selectedDate, setSelectedDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [datePicker, setDatePicker] = useState<{ taskId: string; anchor: HTMLElement | null } | null>(null);
  const [roundsTopic, setRoundsTopic] = useState<string | null>(null);
  const [toast, setToast] = useState<string>('');
  const [overdueAlertOpen, setOverdueAlertOpen] = useState(false);
  const [timelineTopic, setTimelineTopic] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const tasks = store.reviewTasks;
    const topicCount = new Set(tasks.map((t) => t.topicName)).size;
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
  const lastUndo = store.undoStack[store.undoStack.length - 1];

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
      const completedRounds = store.reviewTasks
        .filter((t) => t.topicName === task.topicName && t.isCompleted)
        .length;
      const nextInterval = suggestNextInterval(
        completedRounds,
        task.complexity,
        parseIntervals(store.ebbSettings.customIntervals) ?? undefined,
      );
      const sameTopic = store.reviewTasks
        .filter((t) => t.topicName === task.topicName)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
      const lastTask = sameTopic[sameTopic.length - 1];
      const baseDate = lastTask ? dayjs(lastTask.dueDate) : dayjs();
      let newDate = baseDate.add(nextInterval, 'day').format('YYYY-MM-DD');
      const topicDates = new Set(sameTopic.map((t) => t.dueDate));
      while (topicDates.has(newDate)) {
        newDate = dayjs(newDate).add(1, 'day').format('YYYY-MM-DD');
      }
      store.addReviewTasks([{
        id: genId('rt'),
        topicName: task.topicName,
        dueDate: newDate,
        isCompleted: false,
        tag: task.tag,
        complexity: task.complexity,
        smStatus: 'scheduled',
      }]);
      showToast(`已追加第 ${(totalRoundsMap.get(task.topicName) ?? 0) + 1} 轮`);
    },
    [store, showToast],
  );

  const handleOpenRounds = useCallback((task: ReviewTask) => {
    setRoundsTopic(task.topicName);
  }, []);

  const handleOpenTimeline = useCallback((topicName: string) => {
    setTimelineTopic(topicName);
  }, []);

  // 拖拽改期（看板视图）
  const handleDndEnd = useCallback(
    (result: DropResult) => {
      const { draggableId, destination } = result;
      if (!destination) return;
      const destId = destination.droppableId;
      // 看板列拖拽：board-col-today / board-col-future / board-col-done
      if (destId === 'board-col-done') {
        // 校验轮次顺序（与 toggleReviewTask 一致）
        const err = store.toggleReviewTask(draggableId);
        if (err) {
          showToast(err);
        } else {
          showToast('已标记完成');
        }
      } else if (destId === 'board-col-today') {
        store.updateReviewTask(draggableId, { dueDate: dayjs().format('YYYY-MM-DD'), isCompleted: false });
        showToast('已改期到今天');
      } else if (destId === 'board-col-future') {
        store.updateReviewTask(draggableId, {
          dueDate: dayjs().add(7, 'day').format('YYYY-MM-DD'),
          isCompleted: false,
        });
        showToast('已改期到下周');
      } else if (destId.startsWith('ebb-day-')) {
        const newDate = destId.replace('ebb-day-', '');
        store.updateReviewTask(draggableId, { dueDate: newDate });
        showToast('已改期');
      }
    },
    [store, showToast],
  );

  // 导出/导入
  const handleExport = useCallback(() => {
    const json = store.exportEbbData();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `smart-ebb-${dayjs().format('YYYY-MM-DD')}.json`;
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
        store.importEbbData(parsed);
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

  // 共享的任务操作 props
  const taskActions = {
    onToggle: handleToggle,
    onDelete: handleDelete,
    onReschedule: handleReschedule,
    onAddRound: handleAddRound,
    onOpenRounds: handleOpenRounds,
    onOpenTimeline: handleOpenTimeline,
  };

  return (
    <DragDropContext onDragEnd={handleDndEnd}>
      <div className="eb-app">
        {/* ── 顶部导航栏 ──────────────────────────────────── */}
        <header className="eb-nav">
          <div className="eb-nav-left">
            <span className="eb-nav-brand">🧠 艾宾浩斯复习</span>
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
              onClick={() => setModal('inbox')}
            >
              <InboxIcon size={15} />
              收件箱
              {store.inboxItems.length > 0 && (
                <span className="eb-nav-badge">{store.inboxItems.length}</span>
              )}
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

        {/* ── 统计区 ──────────────────────────────────────── */}
        <section className="eb-stats-bar">
          <div className="eb-stats-cards">
            <div className="eb-stat-card">
              <span className="eb-stat-icon">📚</span>
              <span className="eb-stat-value">{stats.topicCount}</span>
              <span className="eb-stat-label">学习内容</span>
            </div>
            <div className="eb-stat-card">
              <span className="eb-stat-icon">📋</span>
              <span className="eb-stat-value">{stats.total}</span>
              <span className="eb-stat-label">总任务</span>
            </div>
            <div className={`eb-stat-card ${stats.todayDue > 0 ? 'eb-stat-card--warn' : ''}`}>
              <span className="eb-stat-icon">⏰</span>
              <span className="eb-stat-value">{stats.todayDue}</span>
              <span className="eb-stat-label">今日到期</span>
            </div>
            <div className={`eb-stat-card ${stats.overdue > 0 ? 'eb-stat-card--danger' : ''}`}>
              <span className="eb-stat-icon">⚠️</span>
              <span className="eb-stat-value">{stats.overdue}</span>
              <span className="eb-stat-label">逾期</span>
            </div>
            <div className="eb-stat-card">
              <span className="eb-stat-icon">🎯</span>
              <span className="eb-stat-value">{stats.todayPoints}</span>
              <span className="eb-stat-label">今日积分</span>
            </div>
            <div className="eb-stat-card">
              <span className="eb-stat-icon">📊</span>
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
        <nav className="eb-tabs">
          <button
            type="button"
            className={`eb-tab ${activeTab === 'matrix' ? 'eb-tab--active' : ''}`}
            onClick={() => setActiveTab('matrix')}
          >
            <LayoutGrid size={14} />
            矩阵视图
          </button>
          <button
            type="button"
            className={`eb-tab ${activeTab === 'directory' ? 'eb-tab--active' : ''}`}
            onClick={() => setActiveTab('directory')}
          >
            <FolderTree size={14} />
            目录视图
          </button>
          <button
            type="button"
            className={`eb-tab ${activeTab === 'board' ? 'eb-tab--active' : ''}`}
            onClick={() => setActiveTab('board')}
          >
            <Columns3 size={14} />
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
                  <span className="eb-cal-sidebar-date-num">{dayjs(selectedDate).date()}</span>
                  <div className="eb-cal-sidebar-date-info">
                    <span className="eb-cal-sidebar-date-month">{dayjs(selectedDate).format('YYYY年MM月')}</span>
                    <span className="eb-cal-sidebar-date-week">
                      {selectedDate === dayjs().format('YYYY-MM-DD') ? '今天' :
                       selectedDate === dayjs().subtract(1, 'day').format('YYYY-MM-DD') ? '昨天' :
                       selectedDate === dayjs().add(1, 'day').format('YYYY-MM-DD') ? '明天' :
                       ['周日','周一','周二','周三','周四','周五','周六'][dayjs(selectedDate).day()]}
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
              <MatrixView
                tasks={store.reviewTasks}
                settings={store.ebbSettings}
                taskActions={taskActions}
              />
            )}
            {activeTab === 'directory' && (
              <DirectoryView
                tasks={store.reviewTasks}
                nodes={store.outlineNodes}
                settings={store.ebbSettings}
                taskActions={taskActions}
              />
            )}
            {activeTab === 'board' && (
              <BoardView
                tasks={store.reviewTasks}
                settings={store.ebbSettings}
                taskActions={taskActions}
              />
            )}
          </main>
        </div>

        {/* ── 模态弹窗 ────────────────────────────────────── */}
        {modal === 'settings' && (
          <SettingsPanel onClose={() => setModal('none')} />
        )}
        {modal === 'inbox' && (
          <InboxPanel onClose={() => setModal('none')} />
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
          <RoundsPanel topicName={roundsTopic} onClose={() => setRoundsTopic(null)} />
        )}

        {/* 逾期提醒弹窗 */}
        {overdueAlertOpen && (
          <OverdueAlertModal onClose={() => setOverdueAlertOpen(false)} />
        )}

        {/* 时间线浮层 */}
        {timelineTopic && (
          <TimelineStripModal
            topicName={timelineTopic}
            tasks={store.reviewTasks.filter((t) => t.topicName === timelineTopic)}
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
    onOpenTimeline: (topicName: string) => void;
    onReschedule: (id: string) => void;
  };
}

const DayTaskList: React.FC<DayTaskListProps> = ({ tasks, settings, selectedDate, taskActions }) => {
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
  const today = dayjs().format('YYYY-MM-DD');
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
          const total = totalRoundsMap.get(t.topicName) ?? 0;
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
                  <span className="eb-cal-task-card-name" onClick={() => taskActions.onOpenTimeline(t.topicName)}>
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
                  {t.tag && <span className="eb-cal-task-card-tag">{t.tag}</span>}
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
  const [viewMonth, setViewMonth] = useState(dayjs(selectedDate));
  const today = dayjs().format('YYYY-MM-DD');
  const monthStart = viewMonth.startOf('month');
  const monthEnd = viewMonth.endOf('month');
  const startWeekday = monthStart.day();
  const days: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) days.push(null);
  for (let d = monthStart; d.isBefore(monthEnd) || d.isSame(monthEnd); d = d.add(1, 'day')) {
    days.push(d.format('YYYY-MM-DD'));
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

  const isCurrentMonth = viewMonth.isSame(dayjs(), 'month');

  return (
    <div className="eb-mini-cal">
      <div className="eb-mini-cal-header">
        <div className="eb-mini-cal-nav">
          <button type="button" className="eb-mini-cal-nav-btn" onClick={() => setViewMonth(viewMonth.subtract(1, 'month'))}>
            <ChevronLeft size={14} />
          </button>
          <span className="eb-mini-cal-title">{viewMonth.format('YYYY年MM月')}</span>
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
          const isWeekend = new Date(d).getDay() === 0 || new Date(d).getDay() === 6;
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
          if (overdueCount > 0) dotColors.push('#EF4444');
          if (pendingCount > 0) dotColors.push('#6B7FD7');
          if (completedCount > 0 && dotColors.length < 4) dotColors.push('#10B981');
          while (dotColors.length < Math.min(count, 4)) dotColors.push('#D1D5DB');

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
  const sorted = useMemo(() => [...tasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate)), [tasks]);
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

// ============================================================
// Smart Timeline - React App 根组件（独立网页版）
// ============================================================

import React, { Suspense, useState, useCallback, useMemo } from 'react';
import dayjs from 'dayjs';
import { splitDate } from '@/utils/dateSafe';
import type { Task, TaskGroup, Note, Milestone, ContextMenuItem } from '@/types';
import { useTimelineStore } from '@/store';
import { useShallow } from 'zustand/react/shallow';
// import TimelineView from '@/components/TimelineView';
import Toolbar, { type AppModule } from '@/components/Toolbar';
import TaskDialog from '@/components/TaskDialog';
import GroupDialog from '@/components/GroupDialog';
import NoteDialog from '@/components/NoteDialog';
import MilestoneDialog from '@/components/MilestoneDialog';
import SyncDialog from '@/components/SyncDialog';
import ContextMenu from '@/components/ContextMenu';
import { IceboxPalette } from '@/components/smartBlock/IceboxPalette';
import ProjectTaskBlockModal from '@/components/smartBlock/ProjectTaskBlockModal';
import { useIceboxMonitor } from '@/hooks/useIceboxMonitor';
import { AnimatePresence, motion } from 'framer-motion';

import '@/styles/timeline.css';
import '@/styles/ebb.css';
import '@/styles/daily-schedule.css';
import '@/styles/smart-block.css';
import '@/styles/task-overview.css';

type DialogType = 'task' | 'group' | 'note' | 'milestone' | 'sync' | null;
type TimelineNavigateDetail = {
  view?: AppModule;
  taskId?: string;
  blockId?: string;
};

function mapLiveblocksStatus(status: string | undefined) {
  if (status === 'connected') return 'connected' as const;
  if (status === 'connecting' || status === 'reconnecting') return 'connecting' as const;
  if (status === 'disconnected' || status === 'initial') return 'disconnected' as const;
  return 'error' as const;
}

const TimelineView = React.lazy(() => import('@/components/TimelineView'));
const EbbView = React.lazy(() => import('@/ebb/components/EbbView'));
const DailyScheduleView = React.lazy(() => import('@/components/dailySchedule/DailyScheduleView'));
const ProjectDocumentView = React.lazy(() => import('@/components/smartBlock/ProjectDocumentView'));
const WeekMatrixView = React.lazy(() => import('@/components/smartBlock/WeekMatrixView'));
const TaskOverviewView = React.lazy(() => import('@/components/smartBlock/TaskOverviewView'));
const KnowledgeGraphView = React.lazy(() =>
  import('@/graph/components/KnowledgeGraphView').then((module) => ({ default: module.KnowledgeGraphView })),
);

import { useGraphStore } from '@/graph/store';
import { useEbbStore, EBB_ROOM_PREFIX } from '@/ebb/store';
import { useDailyScheduleStore, DAILY_ROOM_PREFIX } from '@/components/dailySchedule/store';
import { createLocalSnapshot } from '@/services/workspaceBackup';
import OperationHistoryPanel from '@/components/OperationHistoryPanel';
import { recordOperation } from '@/services/operationHistory';
import { useRecycleBin } from '@/services/recycleBin';

const ViewFallback: React.FC = () => (
  <div className="tl-app-split tl-app-split--ebb">
    <div className="tl-app-main flex items-center justify-center text-sm text-slate-500">
      正在加载视图...
    </div>
  </div>
);

const App: React.FC = () => {
  const { isHydrated: isGraphHydrated, hydrateStore: hydrateGraphStore } = useGraphStore();
  const { isHydrated: isEbbHydrated, hydrateStore: hydrateEbbStore } = useEbbStore();
  const {
    isHydrated: isDailyHydrated,
    hydrateStore: hydrateDailyStore,
  } = useDailyScheduleStore();
  const timelineLiveStatus = useTimelineStore((state) => state.liveblocks?.status);
  const ebbLiveStatus = useEbbStore((state) => state.liveblocks?.status);
  const dailyLiveStatus = useDailyScheduleStore((state) => state.liveblocks?.status);
  const graphLiveStatus = useGraphStore((state) => state.liveblocks?.status);

  // 选择性订阅：只关心 tasks/groups/notes/milestones 数据切片 + 各 CRUD 方法。
  // CRUD 方法在 zustand 中是 store 创建时一次性定义的稳定引用，
  // 故即便 syncStatus 等其它切片变化，本组件也不会重渲染。
  const {
    isHydrated,
    hydrateStore,
    tasks,
    groups,
    notes,
    milestones,
    updateTask,
    deleteTask,
    restoreTask,
    toggleTaskComplete,
    addTask,
    updateGroup,
    addGroup,
    deleteGroup,
    addNote,
    updateNote,
    deleteNote,
    addMilestone,
    updateMilestone,
    deleteMilestone,
    importData,
    exportData,
    updateBlockHeader,
  } = useTimelineStore(
    useShallow((s) => ({
      isHydrated: s.isHydrated,
      hydrateStore: s.hydrateStore,
      tasks: s.tasks,
      groups: s.groups,
      notes: s.notes,
      milestones: s.milestones,
      updateTask: s.updateTask,
      deleteTask: s.deleteTask,
      restoreTask: s.restoreTask,
      toggleTaskComplete: s.toggleTaskComplete,
      addTask: s.addTask,
      updateGroup: s.updateGroup,
      addGroup: s.addGroup,
      deleteGroup: s.deleteGroup,
      addNote: s.addNote,
      updateNote: s.updateNote,
      deleteNote: s.deleteNote,
      addMilestone: s.addMilestone,
      updateMilestone: s.updateMilestone,
      deleteMilestone: s.deleteMilestone,
      importData: s.importData,
      exportData: s.exportData,
      updateBlockHeader: s.updateBlockHeader,
    })),
  );

  // 重构 store 视图供下游代码以 `store.X` 形式访问。
  // 由于 zustand 中方法引用是稳定的，本对象仅在数据切片变化时重建。
  const store = useMemo(
    () => ({
      tasks,
      groups,
      notes,
      milestones,
      updateTask,
      deleteTask,
      restoreTask,
      toggleTaskComplete,
      addTask,
      updateGroup,
      addGroup,
      deleteGroup,
      addNote,
      updateNote,
      deleteNote,
      addMilestone,
      updateMilestone,
      deleteMilestone,
      importData,
      exportData,
      updateBlockHeader,
    }),
    [
      tasks,
      groups,
      notes,
      milestones,
      updateTask,
      deleteTask,
      restoreTask,
      toggleTaskComplete,
      addTask,
      updateGroup,
      addGroup,
      deleteGroup,
      addNote,
      updateNote,
      deleteNote,
      addMilestone,
      updateMilestone,
      deleteMilestone,
      importData,
      exportData,
      updateBlockHeader,
    ],
  );

  // The week matrix is a task-block view, so it must receive both standalone
  // projects and projects nested inside groups. IDs are unique in Timeline;
  // de-duplicate defensively to avoid rendering a block twice on imported data.
  const weekMatrixTasks = useMemo(() => {
    const uniqueTasks = new Map<string, Task>();
    [...store.tasks, ...store.groups.flatMap((group) => group.children)].forEach((task) => {
      uniqueTasks.set(task.id, task);
    });
    return [...uniqueTasks.values()];
  }, [store.groups, store.tasks]);

  // 对话框状态
  const [dialogType, setDialogType] = useState<DialogType>(null);
  const [dialogMode, setDialogMode] = useState<'add' | 'edit'>('add');
  const [editingTask, setEditingTask] = useState<Task | undefined>();
  const [editingGroup, setEditingGroup] = useState<TaskGroup | undefined>();
  const [editingNote, setEditingNote] = useState<Note | undefined>();
  const [editingMilestone, setEditingMilestone] = useState<Milestone | undefined>();

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    taskId: string;
    noteId?: string;
    milestoneId?: string;
  } | null>(null);

  // 任务详情抽屉状态：只存 id，task 对象从 store 派生（自动跟随远端更新 + 任务删除自动关闭）
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [drawerBlockId, setDrawerBlockId] = useState<string | null>(null);
  const [drawerFocusRequest, setDrawerFocusRequest] = useState(0);
  const drawerTask = useMemo(
    () => (drawerTaskId ? store.tasks.find((t) => t.id === drawerTaskId) ?? null : null),
    [drawerTaskId, store.tasks],
  );

  // 视图切换：timeline（甘特图） / ebb（艾宾浩斯复习） / daily-schedule（每日安排） / week-matrix（周矩阵）
  const [currentView, setCurrentView] = useState<AppModule>('timeline');

  // 年份显示
  const [displayYear, setDisplayYear] = useState(() => {
    if (store.tasks.length > 0) {
      const years = store.tasks.map((t) => splitDate(t.start).year);
      return Math.min(...years);
    }
    return dayjs().year();
  });
  const hasAlignedDisplayYear = React.useRef(false);
  const hasAttemptedAutoReconnect = React.useRef(false);
  const hasStartedHydration = React.useRef(false);
  const previousLiveStatuses = React.useRef<Record<string, string | undefined>>({});

  // 异步加载 IndexedDB 数据
  React.useEffect(() => {
    if (hasStartedHydration.current) return;
    hasStartedHydration.current = true;
    if (!isHydrated) {
      hydrateStore();
    }
    if (!isGraphHydrated) {
      hydrateGraphStore();
    }
    if (!isEbbHydrated) {
      hydrateEbbStore();
    }
    if (!isDailyHydrated) {
      hydrateDailyStore();
    }
  }, [
    isHydrated,
    hydrateStore,
    isGraphHydrated,
    hydrateGraphStore,
    isEbbHydrated,
    hydrateEbbStore,
    isDailyHydrated,
    hydrateDailyStore,
  ]);

  React.useEffect(() => {
    if (!isHydrated || hasAlignedDisplayYear.current) return;
    const years = tasks
      .map((task) => splitDate(task.start).year)
      .filter(Number.isFinite);
    if (years.length === 0) return;
    hasAlignedDisplayYear.current = true;
    setDisplayYear(Math.min(...years));
  }, [isHydrated, tasks]);

  React.useEffect(() => {
    if (
      !isHydrated
      || !isGraphHydrated
      || !isEbbHydrated
      || !isDailyHydrated
      || hasAttemptedAutoReconnect.current
    ) {
      return;
    }

    hasAttemptedAutoReconnect.current = true;

    const connectWorkspace = () => {
      const timelineState = useTimelineStore.getState();
      const ebbState = useEbbStore.getState();
      const dailyState = useDailyScheduleStore.getState();
      const graphState = useGraphStore.getState();
      const configuredCodes = [timelineState, ebbState, dailyState, graphState]
        .filter((state) => state.syncEnabled && state.syncRoomCode)
        .map((state) => state.syncRoomCode);
      const code = timelineState.syncRoomCode || configuredCodes[0] || '';
      const wasEnabled = timelineState.syncEnabled || ebbState.syncEnabled || dailyState.syncEnabled || graphState.syncEnabled;
      if (!code || !wasEnabled) return;

      const distinctCodes = new Set(configuredCodes);
      if (distinctCodes.size > 1) {
        console.warn('[sync] 检测到历史模块使用不同房间号，已保留各模块原房间，不进行静默改写。');
        if (timelineState.syncEnabled && timelineState.syncRoomCode) timelineState.liveblocks?.enterRoom?.(timelineState.syncRoomCode);
        if (ebbState.syncEnabled && ebbState.syncRoomCode) ebbState.liveblocks?.enterRoom?.(`${EBB_ROOM_PREFIX}${ebbState.syncRoomCode}`);
        if (dailyState.syncEnabled && dailyState.syncRoomCode) dailyState.liveblocks?.enterRoom?.(`${DAILY_ROOM_PREFIX}${dailyState.syncRoomCode}`);
        if (graphState.syncEnabled && graphState.syncRoomCode) graphState.liveblocks?.enterRoom?.(`graph-${graphState.syncRoomCode}`);
        return;
      }

      timelineState.enableSync(code);
      ebbState.enableSync(code);
      dailyState.enableSync(code);
      graphState.enableSync(code);
      timelineState.liveblocks?.enterRoom?.(code);
      ebbState.liveblocks?.enterRoom?.(`${EBB_ROOM_PREFIX}${code}`);
      dailyState.liveblocks?.enterRoom?.(`${DAILY_ROOM_PREFIX}${code}`);
      graphState.liveblocks?.enterRoom?.(`graph-${code}`);
    };

    connectWorkspace();
  }, [isHydrated, isGraphHydrated, isEbbHydrated, isDailyHydrated]);

  React.useEffect(() => {
    if (!isHydrated || !isGraphHydrated || !isEbbHydrated || !isDailyHydrated) return;
    const reconnect = () => {
      const timelineState = useTimelineStore.getState();
      const ebbState = useEbbStore.getState();
      const dailyState = useDailyScheduleStore.getState();
      const graphState = useGraphStore.getState();
      if (timelineState.syncEnabled && timelineState.syncRoomCode) timelineState.liveblocks?.enterRoom?.(timelineState.syncRoomCode);
      if (ebbState.syncEnabled && ebbState.syncRoomCode) ebbState.liveblocks?.enterRoom?.(`${EBB_ROOM_PREFIX}${ebbState.syncRoomCode}`);
      if (dailyState.syncEnabled && dailyState.syncRoomCode) dailyState.liveblocks?.enterRoom?.(`${DAILY_ROOM_PREFIX}${dailyState.syncRoomCode}`);
      if (graphState.syncEnabled && graphState.syncRoomCode) graphState.liveblocks?.enterRoom?.(`graph-${graphState.syncRoomCode}`);
    };
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [isHydrated, isGraphHydrated, isEbbHydrated, isDailyHydrated]);

  React.useEffect(() => {
    if (!isHydrated || !isGraphHydrated || !isEbbHydrated || !isDailyHydrated) return;
    const stores = [
      useTimelineStore.getState(),
      useEbbStore.getState(),
      useDailyScheduleStore.getState(),
      useGraphStore.getState(),
    ];
    const syncEnabled = stores.some((state) => state.syncEnabled);
    const allConnected = [timelineLiveStatus, ebbLiveStatus, dailyLiveStatus, graphLiveStatus]
      .every((status) => status === 'connected');
    if (syncEnabled && !allConnected) return;
    const today = dayjs().format('YYYY-MM-DD');
    const key = 'smart-line-last-auto-snapshot-date';
    if (localStorage.getItem(key) === today) return;
    createLocalSnapshot('每日自动快照')
      .then(() => localStorage.setItem(key, today))
      .catch((error) => console.warn('[workspace] 自动快照失败：', error));
  }, [isHydrated, isGraphHydrated, isEbbHydrated, isDailyHydrated, timelineLiveStatus, ebbLiveStatus, dailyLiveStatus, graphLiveStatus]);

  React.useEffect(() => {
    if (timelineLiveStatus) {
      useTimelineStore.getState().setSyncStatus(mapLiveblocksStatus(timelineLiveStatus));
    }
  }, [timelineLiveStatus]);

  React.useEffect(() => {
    if (ebbLiveStatus) {
      useEbbStore.getState().setSyncStatus(mapLiveblocksStatus(ebbLiveStatus));
    }
  }, [ebbLiveStatus]);

  React.useEffect(() => {
    if (dailyLiveStatus) {
      useDailyScheduleStore.getState().setSyncStatus(mapLiveblocksStatus(dailyLiveStatus));
    }
  }, [dailyLiveStatus]);

  React.useEffect(() => {
    if (graphLiveStatus) {
      useGraphStore.getState().setSyncStatus(mapLiveblocksStatus(graphLiveStatus));
    }
  }, [graphLiveStatus]);

  React.useEffect(() => {
    const statuses = {
      timeline: timelineLiveStatus,
      ebb: ebbLiveStatus,
      daily: dailyLiveStatus,
      graph: graphLiveStatus,
    };
    let current: Record<string, string> = {};
    try { current = JSON.parse(localStorage.getItem('smart-line-sync-last-connected') ?? '{}') as Record<string, string>; }
    catch { current = {}; }
    const now = new Date().toISOString();
    let changed = false;
    for (const [key, status] of Object.entries(statuses)) {
      if (status === 'connected' && previousLiveStatuses.current[key] !== 'connected') {
        current[key] = now;
        changed = true;
      }
      previousLiveStatuses.current[key] = status;
    }
    if (changed) localStorage.setItem('smart-line-sync-last-connected', JSON.stringify(current));
  }, [timelineLiveStatus, ebbLiveStatus, dailyLiveStatus, graphLiveStatus]);

  // 全局漫游导航监听
  React.useEffect(() => {
    const handleNav = (event: Event) => {
      const e = event as CustomEvent<TimelineNavigateDetail>;
      const detail = e.detail;
      if (detail?.view) {
        setCurrentView(detail.view);
      }
      if (detail?.taskId) {
        setDrawerTaskId(detail.taskId);
      }
      setDrawerBlockId(detail?.blockId ?? null);
      if (detail?.blockId) setDrawerFocusRequest((value) => value + 1);
    };
    window.addEventListener('tl-navigate', handleNav);
    return () => window.removeEventListener('tl-navigate', handleNav);
  }, []);

  // 挂载冷冻库自动监控
  useIceboxMonitor();

  // ── 任务操作 ──────────────────────────────────────────────

  // 抽屉：打开任务详情（单击入口，元信息折叠）
  const handleOpenDrawer = useCallback((task: Task) => {
    setDrawerTaskId(task.id);
  }, []);

  // 抽屉：打开任务详情并展开元信息（右键"编辑"入口）
  const handleOpenDrawerWithMeta = useCallback((task: Task) => {
    setDrawerTaskId(task.id);
  }, []);

  // 抽屉：关闭
  const handleCloseDrawer = useCallback(() => {
    setDrawerTaskId(null);
  }, []);

  // 抽屉：即时更新元信息（drawerTask 已从 store 派生，无需手动同步）
  const handleUpdateTaskMeta = useCallback((taskId: string, patch: Partial<Task>) => {
    const existing = store.tasks.find((t) => t.id === taskId);
    if (!existing) return;
    store.updateTask({ ...existing, ...patch });
  }, [store]);

  // 抽屉：删除任务
  const handleDeleteTaskFromDrawer = useCallback((taskId: string) => {
    const task = [...store.tasks, ...store.groups.flatMap((group) => group.children)].find((item) => item.id === taskId);
    const groupId = store.groups.find((group) => group.children.some((item) => item.id === taskId))?.id;
    if (task) {
      const sourcePrefix = `project-blk:${taskId}::`;
      const placements = Object.entries(useDailyScheduleStore.getState().schedules).map(([date, day]) => ({
        date,
        items: day.items.filter((item) => item.sourceId.startsWith(sourcePrefix)),
        blocks: day.blocks.filter((block) => block.sourceId.startsWith(sourcePrefix)),
      })).filter((entry) => entry.items.length > 0 || entry.blocks.length > 0);
      const recycled = useRecycleBin.getState().recycle(task, groupId, placements);
      store.deleteTask(taskId);
      recordOperation({ label: `删除“${task.name}”`, detail: '任务及其每日安排位置已移入回收站，保留 30 天', modules: ['项目文档', '每日安排', 'EBB', '知识大盘'], undoSpec: { kind: 'restore-recycled', payload: { recycledId: recycled.id } } });
    }
    setDrawerTaskId(null);
  }, [store]);

  const handleAddTask = useCallback(() => {
    setEditingTask(undefined);
    setDialogMode('add');
    setDialogType('task');
  }, []);

  const handleSaveTask = useCallback((task: Task) => {
    if (dialogMode === 'edit') {
      store.updateTask(task);
    } else {
      store.addTask(task);
    }
    setDialogType(null);
    setEditingTask(undefined);
  }, [dialogMode, store]);

  const handleDeleteTask = useCallback((taskId: string) => {
    handleDeleteTaskFromDrawer(taskId);
    setDialogType(null);
    setEditingTask(undefined);
  }, [handleDeleteTaskFromDrawer]);

  // ── 分组操作 ──────────────────────────────────────────────

  const handleAddGroup = useCallback(() => {
    setEditingGroup(undefined);
    setDialogMode('add');
    setDialogType('group');
  }, []);

  const handleEditGroup = useCallback((group: TaskGroup) => {
    setEditingGroup(group);
    setDialogMode('edit');
    setDialogType('group');
  }, []);

  const handleSaveGroup = useCallback((group: TaskGroup) => {
    if (dialogMode === 'edit') {
      store.updateGroup(group);
    } else {
      store.addGroup(group);
    }
    setDialogType(null);
    setEditingGroup(undefined);
  }, [dialogMode, store]);

  const handleDeleteGroup = useCallback((groupId: string) => {
    store.deleteGroup(groupId);
    setDialogType(null);
    setEditingGroup(undefined);
  }, [store]);

  // ── 便签操作 ──────────────────────────────────────────────

  const handleAddNote = useCallback(() => {
    setEditingNote(undefined);
    setDialogMode('add');
    setDialogType('note');
  }, []);

  const handleEditNote = useCallback((note: Note) => {
    setEditingNote(note);
    setDialogMode('edit');
    setDialogType('note');
  }, []);

  const handleSaveNote = useCallback((note: Note) => {
    if (dialogMode === 'edit') {
      store.updateNote(note);
    } else {
      store.addNote(note);
    }
    setDialogType(null);
    setEditingNote(undefined);
  }, [dialogMode, store]);

  const handleDeleteNote = useCallback((noteId: string) => {
    store.deleteNote(noteId);
    setDialogType(null);
    setEditingNote(undefined);
  }, [store]);

  // ── 里程碑操作 ────────────────────────────────────────────

  const handleAddMilestone = useCallback(() => {
    setEditingMilestone(undefined);
    setDialogMode('add');
    setDialogType('milestone');
  }, []);

  const handleEditMilestone = useCallback((milestone: Milestone) => {
    setEditingMilestone(milestone);
    setDialogMode('edit');
    setDialogType('milestone');
  }, []);

  const handleSaveMilestone = useCallback((milestone: Milestone) => {
    if (dialogMode === 'edit') {
      store.updateMilestone(milestone);
    } else {
      store.addMilestone(milestone);
    }
    setDialogType(null);
    setEditingMilestone(undefined);
  }, [dialogMode, store]);

  const handleDeleteMilestone = useCallback((milestoneId: string) => {
    store.deleteMilestone(milestoneId);
    setDialogType(null);
    setEditingMilestone(undefined);
  }, [store]);

  // ── 右键菜单 ──────────────────────────────────────────────

  const handleTaskContextMenu = useCallback((e: React.MouseEvent, taskId: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, taskId });
  }, []);

  const handleNoteContextMenu = useCallback((e: React.MouseEvent, noteId: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, taskId: '', noteId });
  }, []);

  const handleMilestoneContextMenu = useCallback((e: React.MouseEvent, milestoneId: string) => {
    setContextMenu({ x: e.clientX, y: e.clientY, taskId: '', milestoneId });
  }, []);

  const contextMenuItems = useMemo((): ContextMenuItem[] => {
    if (!contextMenu) return [];

    // 任务右键菜单
    if (contextMenu.taskId) {
      const task = store.tasks.find((t) => t.id === contextMenu.taskId);
      if (!task) return [];
      return [
        { label: '📝 查看详情', action: () => handleOpenDrawer(task) },
        { label: '✏️ 编辑', action: () => handleOpenDrawerWithMeta(task) },
        { label: task.completed ? '标记未完成' : '标记完成', action: () => store.toggleTaskComplete(task.id) },
        { label: '', action: () => {}, divider: true },
        { label: '删除', action: () => handleDeleteTaskFromDrawer(task.id), danger: true },
      ];
    }

    // 便签右键菜单
    if (contextMenu.noteId) {
      const note = store.notes.find((n) => n.id === contextMenu.noteId);
      if (!note) return [];
      return [
        { label: '编辑', action: () => handleEditNote(note) },
        { label: '', action: () => {}, divider: true },
        { label: '删除', action: () => store.deleteNote(note.id), danger: true },
      ];
    }

    // 里程碑右键菜单
    if (contextMenu.milestoneId) {
      const ms = store.milestones.find((m) => m.id === contextMenu.milestoneId);
      if (!ms) return [];
      return [
        { label: '编辑', action: () => handleEditMilestone(ms) },
        { label: '', action: () => {}, divider: true },
        { label: '删除', action: () => store.deleteMilestone(ms.id), danger: true },
      ];
    }

    return [];
  }, [contextMenu, store, handleDeleteTaskFromDrawer, handleEditNote, handleEditMilestone, handleOpenDrawer, handleOpenDrawerWithMeta]);

  // ── 导入/导出 ──────────────────────────────────────────────

  // const handleImport = useCallback((data: string) => {
  //   try {
  //     const parsed = JSON.parse(data);
  //     store.importData({
  //       tasks: parsed.tasks ?? [],
  //       groups: parsed.groups ?? [],
  //       notes: parsed.notes ?? [],
  //       milestones: parsed.milestones ?? [],
  //     });
  //   } catch {
  //     alert('导入失败：JSON 格式无效');
  //   }
  // }, [store]);

  // const handleExport = useCallback(() => {
  //   const jsonStr = store.exportData();
  //   const blob = new Blob([jsonStr], { type: 'application/json' });
  //   const url = URL.createObjectURL(blob);
  //   const a = document.createElement('a');
  //   a.href = url;
  //   a.download = `smart-timeline-${todayStr()}.json`;
  //   a.click();
  //   URL.revokeObjectURL(url);
  // }, [store]);

  // ── 关闭对话框 ──────────────────────────────────────────────

  const closeDialog = useCallback(() => {
    setDialogType(null);
    setEditingTask(undefined);
    setEditingGroup(undefined);
    setEditingNote(undefined);
    setEditingMilestone(undefined);
  }, []);

  const handleOpenSync = useCallback(() => {
    setDialogType('sync');
  }, []);

  if (!isHydrated || !isGraphHydrated || !isEbbHydrated || !isDailyHydrated) {
    return (
      <div className="tl-app flex items-center justify-center">
        <div className="text-slate-400 text-sm">正在加载数据...</div>
      </div>
    );
  }

  return (
    <div className={`tl-app ${(currentView === 'ebb' || currentView === 'daily-schedule' || currentView === 'week-matrix' || currentView === 'task-overview' || currentView === 'knowledge-graph') ? 'tl-app--ebb' : ''}`}>
      <OperationHistoryPanel />
      <Toolbar
        currentView={currentView}
        onViewChange={setCurrentView}
        displayYear={displayYear}
        onYearChange={setDisplayYear}
        onAddTask={handleAddTask}
        onAddGroup={handleAddGroup}
        onAddNote={handleAddNote}
        onAddMilestone={handleAddMilestone}
        onOpenSync={handleOpenSync}
      />

      {/* 提升并统一的 Suspense 边界，避免视图切换时频繁销毁重建导致闪烁 */}
      <AnimatePresence mode="wait">
        {currentView === 'ebb' && (
          <motion.div 
            key="ebb"
            id="view-ebb"
            role="tabpanel"
            className="tl-app-split tl-app-split--ebb"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="tl-app-main">
              <Suspense fallback={<ViewFallback />}>
                <EbbView />
              </Suspense>
            </div>
          </motion.div>
        )}

        {currentView === 'daily-schedule' && (
          <motion.div 
            key="daily-schedule"
            id="view-daily-schedule"
            role="tabpanel"
            className="tl-app-split tl-app-split--ebb"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="tl-app-main">
              <Suspense fallback={<ViewFallback />}>
                <DailyScheduleView />
              </Suspense>
            </div>
          </motion.div>
        )}

        {currentView === 'week-matrix' && (
          <motion.div 
            key="week-matrix"
            id="view-week-matrix"
            role="tabpanel"
            className="tl-app-split tl-app-split--ebb"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="tl-app-main">
              <Suspense fallback={<ViewFallback />}>
                <WeekMatrixView
                  tasks={weekMatrixTasks}
                  onUpdateBlockHeader={store.updateBlockHeader}
                />
              </Suspense>
            </div>
          </motion.div>
        )}

        {currentView === 'task-overview' && (
          <motion.div
            key="task-overview"
            id="view-task-overview"
            role="tabpanel"
            className="tl-app-split tl-app-split--ebb"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="tl-app-main">
              <Suspense fallback={<ViewFallback />}>
                <TaskOverviewView />
              </Suspense>
            </div>
          </motion.div>
        )}

        {currentView === 'knowledge-graph' && (
          <motion.div 
            key="knowledge-graph"
            id="view-knowledge-graph"
            role="tabpanel"
            className="tl-app-split tl-app-split--ebb"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="tl-app-main">
              <Suspense fallback={<ViewFallback />}>
                <KnowledgeGraphView />
              </Suspense>
            </div>
          </motion.div>
        )}

        {currentView === 'timeline' && (
          <motion.div 
            key="timeline"
            id="view-timeline"
            role="tabpanel"
            className="tl-app-split"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="tl-app-main">
              <Suspense fallback={<ViewFallback />}>
                <TimelineView
                  tasks={store.tasks}
                  groups={store.groups}
                  notes={store.notes}
                  milestones={store.milestones}
                  displayYear={displayYear}
                  onTaskClick={handleOpenDrawer}
                  onTaskContextMenu={handleTaskContextMenu}
                  onNoteDoubleClick={handleEditNote}
                  onNoteContextMenu={handleNoteContextMenu}
                  onMilestoneDoubleClick={handleEditMilestone}
                  onMilestoneContextMenu={handleMilestoneContextMenu}
                  onGroupDoubleClick={handleEditGroup}
                  onSmartBlockDrop={(dragData, targetDate) => {
                    store.updateBlockHeader(dragData.taskId, dragData.blockId, { date: targetDate });
                  }}
                />
              </Suspense>
            </div>

            {/* 项目文档视图面板（仅 open 时渲染，挤压左侧甘特图） */}
            <AnimatePresence mode="popLayout">
              {drawerTask && (
                <motion.div
                  key={drawerTask.id}
                  initial={{ width: 0, opacity: 0, x: 20 }}
                  animate={{ width: 450, opacity: 1, x: 0 }}
                  exit={{ width: 0, opacity: 0, x: 20 }}
                  transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden', borderLeft: '1px solid #E5E7EB', background: '#fff', flexShrink: 0 }}
                >
                  <Suspense fallback={<ViewFallback />}>
                    <ProjectDocumentView
                      task={drawerTask}
                      focusBlockId={drawerBlockId}
                      focusRequest={drawerFocusRequest}
                      onClose={handleCloseDrawer}
                      onUpdateTask={handleUpdateTaskMeta}
                      onDeleteTask={handleDeleteTaskFromDrawer}
                    />
                  </Suspense>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 对话框 */}
      {dialogType === 'task' && (
        <TaskDialog
          task={dialogMode === 'edit' ? editingTask : undefined}
          onSave={handleSaveTask}
          onDelete={dialogMode === 'edit' ? handleDeleteTask : undefined}
          onCancel={closeDialog}
        />
      )}
      {dialogType === 'group' && (
        <GroupDialog
          group={dialogMode === 'edit' ? editingGroup : undefined}
          allTasks={store.tasks}
          groups={store.groups}
          onSave={handleSaveGroup}
          onDelete={dialogMode === 'edit' ? handleDeleteGroup : undefined}
          onCancel={closeDialog}
        />
      )}
      {dialogType === 'note' && (
        <NoteDialog
          note={dialogMode === 'edit' ? editingNote : undefined}
          onSave={handleSaveNote}
          onDelete={dialogMode === 'edit' ? handleDeleteNote : undefined}
          onCancel={closeDialog}
        />
      )}
      {dialogType === 'milestone' && (
        <MilestoneDialog
          milestone={dialogMode === 'edit' ? editingMilestone : undefined}
          onSave={handleSaveMilestone}
          onDelete={dialogMode === 'edit' ? handleDeleteMilestone : undefined}
          onCancel={closeDialog}
        />
      )}
      {dialogType === 'sync' && (
        <SyncDialog onClose={closeDialog} />
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* 悬浮磁吸面板：冷冻库 (Icebox) - 在周矩阵与项目规划视图中显示 */}
      <AnimatePresence>
        {(currentView === 'week-matrix' || currentView === 'timeline') && (
          <IceboxPalette />
        )}
      </AnimatePresence>
      <ProjectTaskBlockModal />
    </div>
  );
};

export default App;

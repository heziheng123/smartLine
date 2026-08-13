// ============================================================
// Smart Timeline - React App 根组件（独立网页版）
// ============================================================

import React, { Suspense, useState, useCallback, useMemo } from 'react';
import dayjs from 'dayjs';
import { splitDate } from '@/utils/dateSafe';
import type { Task, TaskGroup, Note, Milestone, ContextMenuItem } from '@/types';
import { useTimelineStore } from '@/store';
import { getUniqueTasks } from '@/store/timelineData';
import { useShallow } from 'zustand/react/shallow';
// import TimelineView from '@/components/TimelineView';
import Toolbar, { type AppModule } from '@/components/Toolbar';
import PhoneWorkspace from '@/components/mobile/PhoneWorkspace';
import { OPEN_WORKSPACE_SYNC_EVENT } from '@/components/SyncStatusIndicator';
import ContextMenu from '@/components/ContextMenu';
import ProjectTaskBlockModal from '@/components/smartBlock/ProjectTaskBlockModal';
import ProjectTaskCreateDialog from '@/components/smartBlock/ProjectTaskCreateDialog';
import ViewErrorBoundary from '@/components/ViewErrorBoundary';
import ConfirmationDialogHost from '@/components/ConfirmationDialogHost';
import ChoiceDialogHost from '@/components/ChoiceDialogHost';
import FinalReviewRoundDialogHost from '@/components/FinalReviewRoundDialogHost';
import { useIceboxMonitor } from '@/hooks/useIceboxMonitor';
import { isPhoneLayoutViewport, usePhoneLayout } from '@/hooks/usePhoneLayout';
import { AnimatePresence, motion, useReducedMotion, type Variants } from 'framer-motion';
import {
  MOTION_DURATION,
  MOTION_EASE_ENTER,
  MOTION_EASE_EXIT,
} from '@/motion/system';

import '@/styles/design-tokens.css';
import '@/styles/confirmation.css';
import '@/styles/timeline.css';
import '@/styles/smart-block.css';
import '@/styles/lazy-dialog.css';
import '@/styles/motion-system.css';

type DialogType = 'task' | 'group' | 'note' | 'milestone' | 'sync' | null;
type TimelineNavigateDetail = {
  view?: AppModule;
  taskId?: string;
  blockId?: string;
};

const RETIRED_PROJECT_VIEW_STORAGE_KEYS = [
  'project-workspace-view-v1',
  'task-overview-preferences-v1',
] as const;

function mapLiveblocksStatus(status: string | undefined, isStorageLoading = false) {
  if (status === 'connected' && !isStorageLoading) return 'connected' as const;
  if (status === 'connected' && isStorageLoading) return 'connecting' as const;
  if (status === 'connecting' || status === 'reconnecting') return 'connecting' as const;
  if (status === 'disconnected' || status === 'initial') return 'disconnected' as const;
  return 'error' as const;
}

const loadTimelineView = () => import('@/components/TimelineView');
const loadLifeMapView = () => import('@/components/lifeMap/LifeMapWorkspace');
const loadEbbView = () => import('@/ebb/components/EbbView');
const loadDailyScheduleView = () => import('@/components/dailySchedule/DailyScheduleView');
const loadProjectDocumentView = () => import('@/components/smartBlock/ProjectDocumentView');
const loadWeekMatrixView = () => import('@/components/smartBlock/WeekMatrixView');
const loadKnowledgeGraphView = () => import('@/graph/components/KnowledgeGraphView').then((module) => ({ default: module.KnowledgeGraphView }));
const loadTaskDialog = () => import('@/components/TaskDialog');
const loadGroupDialog = () => import('@/components/GroupDialog');
const loadNoteDialog = () => import('@/components/NoteDialog');
const loadMilestoneDialog = () => import('@/components/MilestoneDialog');
const loadSyncDialog = () => import('@/components/SyncDialog');
const loadIceboxPalette = () => import('@/components/smartBlock/IceboxPalette')
  .then((module) => ({ default: module.IceboxPalette }));

const TimelineView = React.lazy(loadTimelineView);
const LifeMapView = React.lazy(loadLifeMapView);
const EbbView = React.lazy(async () => {
  const retryKey = 'smart-line-lazy-retry-ebb';
  try {
    const module = await loadEbbView();
    try { sessionStorage.removeItem(retryKey); } catch { /* optional storage */ }
    return module;
  } catch (error) {
    try {
      if (sessionStorage.getItem(retryKey) !== '1') {
        sessionStorage.setItem(retryKey, '1');
        window.location.reload();
      }
    } catch {
      // The view boundary below remains available when storage cannot be used.
    }
    throw error;
  }
});
const DailyScheduleView = React.lazy(loadDailyScheduleView);
const ProjectDocumentView = React.lazy(loadProjectDocumentView);
const WeekMatrixView = React.lazy(loadWeekMatrixView);
const KnowledgeGraphView = React.lazy(loadKnowledgeGraphView);
const TaskDialog = React.lazy(loadTaskDialog);
const GroupDialog = React.lazy(loadGroupDialog);
const NoteDialog = React.lazy(loadNoteDialog);
const MilestoneDialog = React.lazy(loadMilestoneDialog);
const SyncDialog = React.lazy(loadSyncDialog);
const IceboxPalette = React.lazy(loadIceboxPalette);

const DialogLoadingFallback = () => (
  <div className="lazy-dialog-loading" role="status" aria-live="polite">
    <div className="lazy-dialog-loading__card">
      <span className="lazy-dialog-loading__spinner" aria-hidden="true" />
      正在打开…
    </div>
  </div>
);

import { useGraphStore } from '@/graph/store';
import { useEbbStore } from '@/ebb/store';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { useLifeMapStore } from '@/lifeMap/store';
import { createLocalSnapshot } from '@/services/workspaceBackup';
import { reconnectConfiguredWorkspace, WORKSPACE_CONFLICT_EVENT } from '@/services/workspaceSync';
import { startWorkspaceCrossTabDataSync, startWorkspaceQueueTracking, WORKSPACE_QUEUE_ERROR_EVENT } from '@/services/workspaceOfflineQueue';
import { disconnectWorkspace } from '@/services/workspaceSync';
import { isCurrentTabSyncLeader, startWorkspaceTabCoordinator } from '@/services/workspaceTabCoordinator';
import { requestConfirmation } from '@/services/confirmation';
import { useAuth } from '@/auth/AuthContext';
import { resolveProjectTask, rescheduleProjectTask } from '@/services/projectTaskCommands';
import '@/services/backlogCommands';

const ViewFallback: React.FC = () => (
  <div className="tl-app-split tl-app-split--ebb">
    <div className="tl-app-main flex items-center justify-center text-sm text-slate-500">
      <div className="ui-view-loading" role="status" aria-live="polite">
        <span className="ui-view-loading__copy">正在加载视图…</span>
        <span className="ui-view-loading__line" aria-hidden="true" />
        <span className="ui-view-loading__line" aria-hidden="true" />
        <span className="ui-view-loading__line" aria-hidden="true" />
      </div>
    </div>
  </div>
);

const APP_VIEW_ORDER: AppModule[] = [
  'life-map',
  'timeline',
  'daily-schedule',
  'week-matrix',
  'ebb',
  'knowledge-graph',
];

const PHONE_LAST_VIEW_STORAGE_KEY = 'smart-line-phone-last-view-v1';

function getInitialAppView(): AppModule {
  if (!isPhoneLayoutViewport()) return 'timeline';
  try {
    const saved = localStorage.getItem(PHONE_LAST_VIEW_STORAGE_KEY) as AppModule | null;
    if (saved && APP_VIEW_ORDER.includes(saved)) return saved;
  } catch {
    // Storage is optional; the phone execution view remains the safe default.
  }
  return 'daily-schedule';
}

interface ViewMotionContext {
  direction: number;
  reducedMotion: boolean;
}

interface PanelMotionContext {
  reducedMotion: boolean;
}

const VIEW_MOTION_VARIANTS: Variants = {
  initial: ({ direction, reducedMotion }: ViewMotionContext) => (
    reducedMotion ? { opacity: 0 } : { opacity: 0, x: direction * 10 }
  ),
  animate: ({ reducedMotion }: ViewMotionContext) => ({
    opacity: 1,
    x: 0,
    transition: reducedMotion
      ? { duration: MOTION_DURATION.instant }
      : { duration: MOTION_DURATION.standard, ease: MOTION_EASE_ENTER },
  }),
  exit: ({ direction, reducedMotion }: ViewMotionContext) => ({
    opacity: 0,
    x: reducedMotion ? 0 : direction * -4,
    transition: reducedMotion
      ? { duration: MOTION_DURATION.instant }
      : { duration: MOTION_DURATION.exit, ease: MOTION_EASE_EXIT },
  }),
};

const PANEL_MOTION_VARIANTS: Variants = {
  initial: ({ reducedMotion }: PanelMotionContext) => (
    reducedMotion ? { opacity: 0 } : { opacity: 0, x: 24 }
  ),
  animate: ({ reducedMotion }: PanelMotionContext) => ({
    opacity: 1,
    x: 0,
    transition: reducedMotion
      ? { duration: MOTION_DURATION.instant }
      : { duration: MOTION_DURATION.panel, ease: MOTION_EASE_ENTER },
  }),
  exit: ({ reducedMotion }: PanelMotionContext) => ({
    opacity: 0,
    x: reducedMotion ? 0 : 16,
    transition: reducedMotion
      ? { duration: MOTION_DURATION.instant }
      : { duration: MOTION_DURATION.fast, ease: MOTION_EASE_EXIT },
  }),
};

const App: React.FC = () => {
  const auth = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const isPhoneLayout = usePhoneLayout();
  const { isHydrated: isGraphHydrated, hydrateStore: hydrateGraphStore } = useGraphStore(
    useShallow((state) => ({ isHydrated: state.isHydrated, hydrateStore: state.hydrateStore })),
  );
  const { isHydrated: isEbbHydrated, hydrateStore: hydrateEbbStore } = useEbbStore(
    useShallow((state) => ({ isHydrated: state.isHydrated, hydrateStore: state.hydrateStore })),
  );
  const {
    isHydrated: isDailyHydrated,
    hydrateStore: hydrateDailyStore,
  } = useDailyScheduleStore(
    useShallow((state) => ({ isHydrated: state.isHydrated, hydrateStore: state.hydrateStore })),
  );
  const timelineLive = useTimelineStore(useShallow((state) => ({ status: state.liveblocks?.status, storageLoading: state.liveblocks?.isStorageLoading })));
  const ebbLive = useEbbStore(useShallow((state) => ({ status: state.liveblocks?.status, storageLoading: state.liveblocks?.isStorageLoading })));
  const dailyLive = useDailyScheduleStore(useShallow((state) => ({ status: state.liveblocks?.status, storageLoading: state.liveblocks?.isStorageLoading })));
  const graphLive = useGraphStore(useShallow((state) => ({ status: state.liveblocks?.status, storageLoading: state.liveblocks?.isStorageLoading })));
  const lifeMapLive = useLifeMapStore(useShallow((state) => ({ status: state.liveblocks?.status, storageLoading: state.liveblocks?.isStorageLoading })));
  const timelineLiveStatus = timelineLive.status;
  const ebbLiveStatus = ebbLive.status;
  const dailyLiveStatus = dailyLive.status;
  const graphLiveStatus = graphLive.status;
  const lifeMapLiveStatus = lifeMapLive.status;
  const {
    isHydrated: isLifeMapHydrated,
    hydrateStore: hydrateLifeMapStore,
  } = useLifeMapStore(
    useShallow((state) => ({
      isHydrated: state.isHydrated,
      hydrateStore: state.hydrateStore,
    })),
  );

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
    lifeStages,
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
    addLifeStage,
    updateLifeStage,
    deleteLifeStage,
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
      lifeStages: s.lifeStages,
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
      addLifeStage: s.addLifeStage,
      updateLifeStage: s.updateLifeStage,
      deleteLifeStage: s.deleteLifeStage,
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
      lifeStages,
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
      addLifeStage,
      updateLifeStage,
      deleteLifeStage,
      importData,
      exportData,
      updateBlockHeader,
    }),
    [
      tasks,
      groups,
      notes,
      milestones,
      lifeStages,
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
      addLifeStage,
      updateLifeStage,
      deleteLifeStage,
      importData,
      exportData,
      updateBlockHeader,
    ],
  );
  // The week matrix is a task-block view, so it must receive both standalone
  // projects and projects nested inside groups. IDs are unique in Timeline;
  // de-duplicate defensively to avoid rendering a block twice on imported data.
  const weekMatrixTasks = useMemo(() => {
    return getUniqueTasks(store.tasks, store.groups);
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
  const [currentView, setCurrentView] = useState<AppModule>(getInitialAppView);
  const [phoneFullView, setPhoneFullView] = useState(false);
  const [viewDirection, setViewDirection] = useState(1);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const viewMotionContext = useMemo<ViewMotionContext>(() => ({
    direction: viewDirection,
    reducedMotion: Boolean(prefersReducedMotion),
  }), [prefersReducedMotion, viewDirection]);
  const panelMotionContext = useMemo<PanelMotionContext>(() => ({
    reducedMotion: Boolean(prefersReducedMotion),
  }), [prefersReducedMotion]);

  const handleViewChange = useCallback((view: AppModule) => {
    if (view !== currentView) {
      const currentIndex = APP_VIEW_ORDER.indexOf(currentView);
      const nextIndex = APP_VIEW_ORDER.indexOf(view);
      setViewDirection(nextIndex >= currentIndex ? 1 : -1);
      setDrawerTaskId(null);
      setDrawerBlockId(null);
      setPhoneFullView(false);
    }
    setCurrentView(view);
    if (isPhoneLayout) {
      try { localStorage.setItem(PHONE_LAST_VIEW_STORAGE_KEY, view); } catch { /* optional preference */ }
    }
  }, [currentView, isPhoneLayout]);

  React.useEffect(() => {
    try {
      RETIRED_PROJECT_VIEW_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch {
      // Retired UI preferences never contain project or task data.
    }
  }, []);

  React.useEffect(() => {
    const handleConflict = () => setSyncNotice('检测到多设备同步冲突，本地修改已保留。请打开同步设置处理。');
    const handleQueueError = (event: Event) => {
      const detail = (event as CustomEvent<{ message?: string }>).detail;
      setSyncNotice(detail?.message ?? '本地修改尚未安全写入同步队列，请勿关闭页面。');
    };
    window.addEventListener(WORKSPACE_CONFLICT_EVENT, handleConflict);
    window.addEventListener(WORKSPACE_QUEUE_ERROR_EVENT, handleQueueError);
    return () => {
      window.removeEventListener(WORKSPACE_CONFLICT_EVENT, handleConflict);
      window.removeEventListener(WORKSPACE_QUEUE_ERROR_EVENT, handleQueueError);
    };
  }, []);

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
  const handleViewChangeRef = React.useRef(handleViewChange);
  React.useEffect(() => {
    handleViewChangeRef.current = handleViewChange;
  }, [handleViewChange]);

  // 异步加载 IndexedDB 数据
  React.useEffect(() => {
    if (hasStartedHydration.current) return;
    hasStartedHydration.current = true;
    if (!isHydrated) {
      hydrateStore();
    }
    // 人生地图允许独立编辑，必须尽早恢复本地数据。若延迟到空闲阶段，
    // 用户可能先写入默认状态，随后又被 IndexedDB 中的真实数据覆盖。
    if (!isLifeMapHydrated) {
      hydrateLifeMapStore();
    }
    const hydrateSecondaryStores = () => {
      if (!isGraphHydrated) hydrateGraphStore();
      if (!isEbbHydrated) hydrateEbbStore();
      if (!isDailyHydrated) hydrateDailyStore();
    };
    const requestIdle = window.requestIdleCallback;
    if (typeof requestIdle === 'function') {
      requestIdle(hydrateSecondaryStores, { timeout: 800 });
    } else {
      globalThis.setTimeout(hydrateSecondaryStores, 50);
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
    isLifeMapHydrated,
    hydrateLifeMapStore,
  ]);

  React.useEffect(() => {
    // “应用已就绪”意味着所有可编辑数据域均已恢复，避免自动化或用户操作
    // 与任一模块的异步 hydration 发生竞争。
    if (!isHydrated || !isGraphHydrated || !isEbbHydrated || !isDailyHydrated || !isLifeMapHydrated) return;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        window.dispatchEvent(new Event('smartline:app-ready'));
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [isHydrated, isGraphHydrated, isEbbHydrated, isDailyHydrated, isLifeMapHydrated]);

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
      || !isLifeMapHydrated
      || hasAttemptedAutoReconnect.current
    ) {
      return;
    }

    hasAttemptedAutoReconnect.current = true;
    const stopCoordinator = startWorkspaceTabCoordinator({
      onLeader: () => {
        void reconnectConfiguredWorkspace(auth.userId || auth.login, auth.login).catch((error) => {
          setSyncNotice(error instanceof Error ? error.message : '云端工作区自动连接失败。');
        });
      },
      onFollower: () => disconnectWorkspace(false),
    });
    const reconnect = () => {
      if (!isCurrentTabSyncLeader()) return;
      void reconnectConfiguredWorkspace(auth.userId || auth.login, auth.login).catch((error) => {
        setSyncNotice(error instanceof Error ? error.message : '云端工作区重新连接失败。');
      });
    };
    window.addEventListener('online', reconnect);
    return () => {
      window.removeEventListener('online', reconnect);
      stopCoordinator();
    };
  }, [isHydrated, isGraphHydrated, isEbbHydrated, isDailyHydrated, isLifeMapHydrated, auth.login, auth.userId]);

  React.useEffect(() => {
    if (!isHydrated || !isGraphHydrated || !isEbbHydrated || !isDailyHydrated || !isLifeMapHydrated) return;
    const stopTracking = startWorkspaceQueueTracking();
    const stopCrossTab = startWorkspaceCrossTabDataSync();
    return () => { stopTracking(); stopCrossTab(); };
  }, [isHydrated, isGraphHydrated, isEbbHydrated, isDailyHydrated, isLifeMapHydrated]);

  React.useEffect(() => {
    if (!isHydrated || !isGraphHydrated || !isEbbHydrated || !isDailyHydrated || !isLifeMapHydrated) return;
    const stores = [
      useTimelineStore.getState(),
      useEbbStore.getState(),
      useDailyScheduleStore.getState(),
      useGraphStore.getState(),
      useLifeMapStore.getState(),
    ];
    const syncEnabled = stores.some((state) => state.syncEnabled);
    const allConnected = [timelineLiveStatus, ebbLiveStatus, dailyLiveStatus, graphLiveStatus, lifeMapLiveStatus]
      .every((status) => status === 'connected');
    if (syncEnabled && !allConnected) return;
    const today = dayjs().format('YYYY-MM-DD');
    const key = 'smart-line-last-auto-snapshot-date';
    if (localStorage.getItem(key) === today) return;
    createLocalSnapshot('每日自动快照')
      .then(() => localStorage.setItem(key, today))
      .catch((error) => console.warn('[workspace] 自动快照失败：', error));
  }, [isHydrated, isGraphHydrated, isEbbHydrated, isDailyHydrated, isLifeMapHydrated, timelineLiveStatus, ebbLiveStatus, dailyLiveStatus, graphLiveStatus, lifeMapLiveStatus]);

  React.useEffect(() => {
    if (timelineLiveStatus) {
      useTimelineStore.getState().setSyncStatus(mapLiveblocksStatus(timelineLiveStatus, timelineLive.storageLoading));
    }
  }, [timelineLiveStatus, timelineLive.storageLoading]);

  React.useEffect(() => {
    if (ebbLiveStatus) {
      useEbbStore.getState().setSyncStatus(mapLiveblocksStatus(ebbLiveStatus, ebbLive.storageLoading));
    }
  }, [ebbLiveStatus, ebbLive.storageLoading]);

  React.useEffect(() => {
    if (dailyLiveStatus) {
      useDailyScheduleStore.getState().setSyncStatus(mapLiveblocksStatus(dailyLiveStatus, dailyLive.storageLoading));
    }
  }, [dailyLiveStatus, dailyLive.storageLoading]);

  React.useEffect(() => {
    if (graphLiveStatus) {
      useGraphStore.getState().setSyncStatus(mapLiveblocksStatus(graphLiveStatus, graphLive.storageLoading));
    }
  }, [graphLiveStatus, graphLive.storageLoading]);

  React.useEffect(() => {
    if (lifeMapLiveStatus) useLifeMapStore.getState().setSyncStatus(mapLiveblocksStatus(lifeMapLiveStatus, lifeMapLive.storageLoading));
  }, [lifeMapLiveStatus, lifeMapLive.storageLoading]);

  // 全局漫游导航监听
  React.useEffect(() => {
    const handleNav = (event: Event) => {
      const e = event as CustomEvent<TimelineNavigateDetail>;
      const detail = e.detail;
      if (detail?.view) {
        handleViewChangeRef.current(detail.view);
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
  const handleDeleteTaskFromDrawer = useCallback(async (taskId: string) => {
    const task = [...store.tasks, ...store.groups.flatMap((group) => group.children)].find((item) => item.id === taskId);
    if (task) {
      const confirmed = await requestConfirmation({
        title: '永久删除任务',
        message: `确定永久删除“${task.name}”吗？关联的每日安排、复习进度和知识节点关系会同步清理，删除后无法从回收站恢复。`,
        confirmLabel: '永久删除',
        cancelLabel: '取消',
        tone: 'danger',
      });
      if (!confirmed) return;
      store.deleteTask(taskId);
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

  React.useEffect(() => {
    window.addEventListener(OPEN_WORKSPACE_SYNC_EVENT, handleOpenSync);
    return () => window.removeEventListener(OPEN_WORKSPACE_SYNC_EVENT, handleOpenSync);
  }, [handleOpenSync]);

  const preloadView = useCallback((view: AppModule) => {
    if (view === 'life-map') { void loadLifeMapView(); return; }
    if (view === 'timeline') { void loadTimelineView(); return; }
    if (view === 'ebb') { void loadEbbView(); return; }
    if (view === 'daily-schedule') { void loadDailyScheduleView(); return; }
    if (view === 'week-matrix') { void loadWeekMatrixView(); return; }
    if (view === 'knowledge-graph') void loadKnowledgeGraphView();
  }, []);

  if (!isHydrated) {
    return (
      <div className="tl-app flex items-center justify-center">
        <div className="text-slate-400 text-sm">正在加载数据...</div>
      </div>
    );
  }

  return (
    <div className={`tl-app ${isPhoneLayout ? 'tl-app--phone' : ''} ${(currentView === 'life-map' || currentView === 'ebb' || currentView === 'daily-schedule' || currentView === 'week-matrix' || currentView === 'knowledge-graph') ? 'tl-app--ebb' : ''} ${currentView === 'timeline' && drawerTask ? 'tl-app--project-split-open' : ''}`}>
      <Toolbar
        currentView={currentView}
        onViewChange={handleViewChange}
        onViewPreload={preloadView}
      />

      {syncNotice && (
        <div className="tl-sync-warning" role="alert">
          <span>{syncNotice}</span>
          <button type="button" onClick={() => setDialogType('sync')}>查看同步</button>
          <button type="button" aria-label="关闭同步警告" onClick={() => setSyncNotice(null)}>×</button>
        </div>
      )}

      {/* 提升并统一的 Suspense 边界，避免视图切换时频繁销毁重建导致闪烁 */}
      <ViewErrorBoundary
        viewName={currentView === 'life-map' ? '人生地图' : currentView === 'ebb' ? '艾宾浩斯复习' : currentView === 'daily-schedule' ? '每日安排' : currentView === 'knowledge-graph' ? '知识大盘' : currentView === 'week-matrix' ? '周矩阵' : '项目规划'}
        resetKey={currentView}
        safeModeKey={currentView === 'ebb' ? 'smart-line-ebb-safe-mode' : undefined}
        onExit={currentView === 'timeline' ? undefined : () => handleViewChange('timeline')}
      >
      {isPhoneLayout && !phoneFullView ? (
        <PhoneWorkspace
          currentView={currentView}
          tasks={weekMatrixTasks}
          groups={store.groups}
          onAddProject={handleAddTask}
          onOpenProject={(taskId, blockId) => {
            setDrawerTaskId(taskId);
            setDrawerBlockId(blockId ?? null);
            setDrawerFocusRequest((value) => value + 1);
          }}
          onOpenFullView={() => setPhoneFullView(true)}
        />
      ) : (
      <AnimatePresence mode="popLayout" initial={false} custom={viewMotionContext}>
        {currentView === 'life-map' && (
          <motion.div
            key="life-map"
            id="view-life-map"
            role="tabpanel"
            className="tl-app-split tl-app-split--ebb"
            custom={viewMotionContext}
            variants={VIEW_MOTION_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <div className="tl-app-main">
              <Suspense fallback={<ViewFallback />}>
                <LifeMapView />
              </Suspense>
            </div>
          </motion.div>
        )}

        {currentView === 'ebb' && (
          <motion.div 
            key="ebb"
            id="view-ebb"
            role="tabpanel"
            className="tl-app-split tl-app-split--ebb"
            custom={viewMotionContext}
            variants={VIEW_MOTION_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
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
            custom={viewMotionContext}
            variants={VIEW_MOTION_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
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
            custom={viewMotionContext}
            variants={VIEW_MOTION_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <div className="tl-app-main week-matrix-workspace">
              <div className="week-matrix-content">
                <Suspense fallback={<ViewFallback />}>
                  <WeekMatrixView
                    tasks={weekMatrixTasks}
                    groups={store.groups}
                  />
                </Suspense>
              </div>
              <Suspense fallback={null}>
                <IceboxPalette layout="docked" />
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
            custom={viewMotionContext}
            variants={VIEW_MOTION_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
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
            className="tl-app-split project-workspace"
            custom={viewMotionContext}
            variants={VIEW_MOTION_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <div className="project-workspace-content">
              <>
                <div className="tl-app-main">
                  <Suspense fallback={<ViewFallback />}>
                    <TimelineView
                        tasks={store.tasks}
                        groups={store.groups}
                        notes={store.notes}
                        milestones={store.milestones}
                        displayYear={displayYear}
                        onYearChange={setDisplayYear}
                        onAddTask={handleAddTask}
                        onAddGroup={handleAddGroup}
                        onAddNote={handleAddNote}
                        onAddMilestone={handleAddMilestone}
                        onOpenSync={handleOpenSync}
                        onTaskClick={handleOpenDrawer}
                        onTaskContextMenu={handleTaskContextMenu}
                        onNoteDoubleClick={handleEditNote}
                        onNoteContextMenu={handleNoteContextMenu}
                        onMilestoneDoubleClick={handleEditMilestone}
                        onMilestoneContextMenu={handleMilestoneContextMenu}
                        onGroupDoubleClick={handleEditGroup}
                        onSmartBlockDrop={async (dragData, targetDate) => {
                          const current = resolveProjectTask(dragData.taskId, dragData.blockId);
                          if (current?.block.header.deadline && targetDate > current.block.header.deadline) {
                            const confirmed = await requestConfirmation({
                              title: '排期晚于截止日期',
                              message: `“${current.block.header.title}”的截止日期是 ${current.block.header.deadline}，目标日期是 ${targetDate}。是否仍然安排？`,
                              confirmLabel: '仍然安排',
                              cancelLabel: '返回修改',
                              tone: 'warning',
                            });
                            if (!confirmed) return;
                          }
                          rescheduleProjectTask(dragData.taskId, dragData.blockId, targetDate);
                        }}
                    />
                  </Suspense>
                </div>

                <AnimatePresence>
                  {drawerTask && (
                    <motion.aside
                      className="tl-project-workspace-drawer"
                      key={`workspace-project:${drawerTask.id}`}
                      custom={panelMotionContext}
                      variants={PANEL_MOTION_VARIANTS}
                      initial="initial"
                      animate="animate"
                      exit="exit"
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
                    </motion.aside>
                  )}
                </AnimatePresence>

              </>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      )}

      {isPhoneLayout && phoneFullView && (
        <button type="button" className="phone-full-view-return" onClick={() => setPhoneFullView(false)}>
          ← 返回手机视图
        </button>
      )}

      <AnimatePresence>
        {drawerTask && (currentView !== 'timeline' || isPhoneLayout) && (
          <motion.aside
            className="tl-global-project-drawer"
            key={`global-project:${drawerTask.id}`}
            custom={panelMotionContext}
            variants={PANEL_MOTION_VARIANTS}
            initial="initial"
            animate="animate"
            exit="exit"
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
          </motion.aside>
        )}
      </AnimatePresence>

      {/* 对话框 */}
      <Suspense fallback={<DialogLoadingFallback />}>
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
      </Suspense>

      {/* 右键菜单 */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* 项目时间线保留悬浮入口；周矩阵使用不遮挡日期列的内嵌右侧抽屉。 */}
      <AnimatePresence>
        {currentView === 'timeline' && (!isPhoneLayout || phoneFullView) && (
          <Suspense fallback={null}>
            <IceboxPalette />
          </Suspense>
        )}
      </AnimatePresence>
      </ViewErrorBoundary>
      <ProjectTaskCreateDialog />
      <ProjectTaskBlockModal />
      <ConfirmationDialogHost />
      <ChoiceDialogHost />
      <FinalReviewRoundDialogHost />
    </div>
  );
};

export default App;

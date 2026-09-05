import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Cloud, CloudOff, LoaderCircle, TriangleAlert } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';
import { useLifeMapStore } from '@/lifeMap/store';
import {
  listWorkspaceConflicts,
  readPendingWorkspaceSync,
  WORKSPACE_QUEUE_ERROR_EVENT,
  WORKSPACE_QUEUE_EVENT,
} from '@/services/workspaceOfflineQueue';
import type { WorkspaceQueueErrorDetail, WorkspaceQueueErrorKind } from '@/services/workspaceSyncQueueCore';
import {
  readWorkspaceSyncRuntimeState,
  readWorkspaceSyncSettings,
  WORKSPACE_SYNC_RUNTIME_EVENT,
  WORKSPACE_VERIFIED_EVENT,
  type WorkspaceSyncRuntimeState,
} from '@/services/workspaceSync';
import { useAuth } from '@/auth/AuthContext';
import { liveblocksAuthMode } from '@/auth/config';
import { MIND_MAP_ENABLED, MIND_MAP_SYNC_ENABLED } from '@/mindMap/config';
import {
  MIND_MAP_SYNC_RUNTIME_EVENT,
  readMindMapSyncRuntimeState,
  type MindMapSyncRuntimeState,
} from '@/mindMap/syncRuntime';
import {
  deriveSyncIndicatorState,
  type ModuleSyncState,
} from './syncStatusIndicatorState';

export const OPEN_WORKSPACE_SYNC_EVENT = 'smartline:open-sync-settings';
const LAST_CONNECTED_KEY = 'smart-line-sync-last-connected';

function readLastConnectedAt(): string | null {
  try {
    const value = (JSON.parse(localStorage.getItem(LAST_CONNECTED_KEY) ?? '{}') as Record<string, unknown>).workspace;
    return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

function readLastVerifiedWorkspace(): { at: string | null; roomId: string | null } {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_CONNECTED_KEY) ?? '{}') as Record<string, unknown>;
    return {
      at: typeof value.workspace === 'string' && !Number.isNaN(Date.parse(value.workspace)) ? value.workspace : null,
      roomId: typeof value.workspaceRoomId === 'string' ? value.workspaceRoomId : null,
    };
  } catch {
    return { at: null, roomId: null };
  }
}

function formatLastConnected(value: string | null): string {
  if (!value) return '暂无完整校验记录';
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `完整校验 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : `完整校验 ${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

const SyncStatusIndicator: React.FC<{ className?: string }> = ({ className = '' }) => {
  const timeline = useTimelineStore(useShallow((state) => ({ enabled: state.syncEnabled, status: state.syncStatus })));
  const ebb = useEbbStore(useShallow((state) => ({ enabled: state.syncEnabled, status: state.syncStatus })));
  const daily = useDailyScheduleStore(useShallow((state) => ({ enabled: state.syncEnabled, status: state.syncStatus })));
  const graph = useGraphStore(useShallow((state) => ({ enabled: state.syncEnabled, status: state.syncStatus })));
  const lifeMap = useLifeMapStore(useShallow((state) => ({ enabled: state.syncEnabled, status: state.syncStatus })));
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [activeConflictCount, setActiveConflictCount] = useState(0);
  const [historicalConflictCount, setHistoricalConflictCount] = useState(0);
  const [queueErrorKind, setQueueErrorKind] = useState<WorkspaceQueueErrorKind | null>(null);
  const [queueErrorMessage, setQueueErrorMessage] = useState<string | null>(null);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [lastConnectedAt, setLastConnectedAt] = useState<string | null>(readLastConnectedAt);
  const [unifiedArchitecture, setUnifiedArchitecture] = useState(
    () => readWorkspaceSyncSettings().architecture === 'unified',
  );
  const [runtimeState, setRuntimeState] = useState(readWorkspaceSyncRuntimeState);
  const [mindMapRuntimeState, setMindMapRuntimeState] = useState(readMindMapSyncRuntimeState);

  const modules = useMemo<ModuleSyncState[]>(
    () => [timeline, ebb, daily, graph, lifeMap],
    [daily, ebb, graph, lifeMap, timeline],
  );
  const enabledModules = modules.filter((module) => module.enabled);
  const errorCount = enabledModules.filter((module) => module.status === 'error').length;
  const connectedCount = enabledModules.filter((module) => module.status === 'connected').length;

  const refreshQueueState = useCallback(async () => {
    try {
      const [pending, conflicts] = await Promise.all([
        readPendingWorkspaceSync(),
        listWorkspaceConflicts(),
      ]);
      const verification = readLastVerifiedWorkspace();
      setPendingCount(pending ? Object.keys(pending.fields ?? {}).length : 0);
      const activeConflicts = conflicts.filter((conflict) => conflict.status !== 'resolved');
      setActiveConflictCount(activeConflicts.length);
      setHistoricalConflictCount(conflicts.length - activeConflicts.length);
      setLastConnectedAt(verification.at);
      if (!pending) {
        setQueueErrorKind(null);
        setQueueErrorMessage(null);
      }
    } catch {
      setQueueErrorKind('flush_failed');
      setQueueErrorMessage(null);
    } finally {
      setQueueLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshQueueState();
    const handleOnline = () => { setOnline(true); void refreshQueueState(); };
    const handleOffline = () => setOnline(false);
    const handleQueue = () => void refreshQueueState();
    const handleQueueError = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceQueueErrorDetail | undefined>).detail;
      setQueueErrorKind(detail?.kind ?? 'flush_failed');
      setQueueErrorMessage(detail?.message ?? null);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'smart-line-sync-last-connected') setLastConnectedAt(readLastConnectedAt());
      if (event.key === 'smart-line-sync-architecture-v1') {
        setUnifiedArchitecture(readWorkspaceSyncSettings().architecture === 'unified');
      }
    };
    const handleVerified = () => {
      setLastConnectedAt(readLastConnectedAt());
      setUnifiedArchitecture(readWorkspaceSyncSettings().architecture === 'unified');
      void refreshQueueState();
    };
    const handleRuntime = (event: Event) => {
      setRuntimeState((event as CustomEvent<WorkspaceSyncRuntimeState>).detail ?? readWorkspaceSyncRuntimeState());
    };
    const handleMindMapRuntime = (event: Event) => {
      setMindMapRuntimeState((event as CustomEvent<MindMapSyncRuntimeState>).detail ?? readMindMapSyncRuntimeState());
    };
    const interval = window.setInterval(() => void refreshQueueState(), 15_000);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('storage', handleStorage);
    window.addEventListener(WORKSPACE_VERIFIED_EVENT, handleVerified);
    window.addEventListener(WORKSPACE_QUEUE_EVENT, handleQueue);
    window.addEventListener(WORKSPACE_QUEUE_ERROR_EVENT, handleQueueError);
    window.addEventListener(WORKSPACE_SYNC_RUNTIME_EVENT, handleRuntime);
    window.addEventListener(MIND_MAP_SYNC_RUNTIME_EVENT, handleMindMapRuntime);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(WORKSPACE_VERIFIED_EVENT, handleVerified);
      window.removeEventListener(WORKSPACE_QUEUE_EVENT, handleQueue);
      window.removeEventListener(WORKSPACE_QUEUE_ERROR_EVENT, handleQueueError);
      window.removeEventListener(WORKSPACE_SYNC_RUNTIME_EVENT, handleRuntime);
      window.removeEventListener(MIND_MAP_SYNC_RUNTIME_EVENT, handleMindMapRuntime);
    };
  }, [refreshQueueState]);

  const auth = useAuth();
  const mapHint = !MIND_MAP_ENABLED
    ? ''
    : MIND_MAP_SYNC_ENABLED && auth.enabled && auth.status === 'authenticated'
      ? ` · 地图${{
        local: '仅本机', connecting: '正在连接', connected: '已同步', offline: '离线', error: '需要重试',
      }[mindMapRuntimeState.status]}`
      : ' · 地图仅本机';
  const derivedIndicatorState = !queueLoaded && enabledModules.length > 0
    ? 'connecting'
    : deriveSyncIndicatorState({
      modules,
      online,
      pendingCount,
      conflictCount: activeConflictCount,
      queueError: queueErrorKind === 'storage_write_failed' || queueErrorKind === 'system_origin_blocked',
      recoverableError: queueErrorKind !== null
        && queueErrorKind !== 'storage_write_failed'
        && queueErrorKind !== 'system_origin_blocked',
      runtimePhase: runtimeState.phase,
    });
  const requiresUnifiedMigration = liveblocksAuthMode === 'authenticated' && !unifiedArchitecture;
  const indicatorState = requiresUnifiedMigration && derivedIndicatorState === 'connected'
    ? 'pending'
    : derivedIndicatorState;

  const issueCount = activeConflictCount + errorCount;
  const historicalHint = historicalConflictCount > 0
    ? `（另有 ${historicalConflictCount} 项可恢复历史）`
    : '';
  const errorHint = queueErrorMessage ?? (
      queueErrorKind === 'storage_write_failed'
        ? '本机写入暂时降级，请勿关闭页面并尽快重试。'
        : queueErrorKind === 'system_origin_blocked'
          ? '系统更新已被阻止进入用户同步队列，请导出诊断并重试。'
        : queueErrorKind === 'flush_restart_exhausted'
          ? '本机同步队列持续变化，请稍候片刻。'
          : queueErrorKind === 'cloud_drift_exhausted'
            ? '云端工作区持续变化，请等待其他设备完成同步。'
            : queueErrorKind === 'flush_failed'
              ? '待同步数据补传失败，请保持页面开启。'
              : null
    );
  const description = indicatorState === 'off'
    ? '同步未开启'
    : requiresUnifiedMigration
      ? '旧同步架构已连接，需要迁移到统一工作区'
      : indicatorState === 'connecting'
      ? runtimeState.message || `正在同步 ${connectedCount}/${enabledModules.length} 个数据模块`
      : indicatorState === 'connected'
        ? `已同步 ${connectedCount} 个数据模块 · ${formatLastConnected(lastConnectedAt)}`
        : indicatorState === 'pending'
          ? `${online ? '正在上传' : '网络离线，改动保存在本机'}${pendingCount > 0 ? ` · 待上传 ${pendingCount} 个数据字段` : ''}${errorHint ? ` · ${errorHint}` : ''}`
          : indicatorState === 'needs-action'
            ? `需要你选择如何合并 · ${activeConflictCount} 处冲突已保留双方数据${historicalHint}`
            : `同步已暂停${issueCount > 0 ? ` · ${issueCount} 项已暂停并保留` : ''}${errorHint || runtimeState.error ? ` · ${errorHint ?? runtimeState.error}` : ''}${historicalHint}`;
  const labeledDescription = `${description}${indicatorState === 'off' ? '' : mapHint}`;

  return (
    <button
      type="button"
      className={`workspace-sync-status workspace-sync-status--${indicatorState} ${className}`.trim()}
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_SYNC_EVENT))}
      aria-label={`${labeledDescription}，打开同步与备份`}
      title={`${labeledDescription}。点击打开同步与备份。`}
      data-sync-state={indicatorState}
    >
      {indicatorState === 'connected' && <span className="workspace-sync-status__connected-icon"><Cloud size={17} /><Check size={9} /></span>}
      {(indicatorState === 'connecting' || indicatorState === 'pending') && <LoaderCircle className="workspace-sync-status__spinner" size={17} />}
      {(indicatorState === 'needs-action' || indicatorState === 'stopped') && <TriangleAlert size={17} />}
      {indicatorState === 'off' && <CloudOff size={17} />}
      {(activeConflictCount > 0 || pendingCount > 0) && (
        <span className="workspace-sync-status__badge">{Math.min(99, activeConflictCount || pendingCount)}</span>
      )}
    </button>
  );
};

export default SyncStatusIndicator;

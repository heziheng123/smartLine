import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import {
  deriveSyncIndicatorState,
  type ModuleSyncState,
} from './syncStatusIndicatorState';

export const OPEN_WORKSPACE_SYNC_EVENT = 'smartline:open-sync-settings';
const LAST_CONNECTED_KEY = 'smart-line-sync-last-connected';

function readLastConnectedAt(): string | null {
  try {
    const values = Object.values(JSON.parse(localStorage.getItem(LAST_CONNECTED_KEY) ?? '{}'))
      .filter((value): value is string => typeof value === 'string' && !Number.isNaN(Date.parse(value)));
    return values.sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;
  } catch {
    return null;
  }
}

function persistLastSynchronizedAt(value: string): void {
  try {
    const current = JSON.parse(localStorage.getItem(LAST_CONNECTED_KEY) ?? '{}') as Record<string, string>;
    localStorage.setItem(LAST_CONNECTED_KEY, JSON.stringify({ ...current, workspace: value }));
  } catch {
    // The in-memory status remains accurate when optional localStorage fails.
  }
}

function formatLastConnected(value: string | null): string {
  if (!value) return '暂无成功同步记录';
  const date = new Date(value);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `最后同步 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : `最后同步 ${date.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
}

const SyncStatusIndicator: React.FC<{ className?: string }> = ({ className = '' }) => {
  const timeline = useTimelineStore(useShallow((state) => ({ enabled: state.syncEnabled, status: state.syncStatus })));
  const ebb = useEbbStore(useShallow((state) => ({ enabled: state.syncEnabled, status: state.syncStatus })));
  const daily = useDailyScheduleStore(useShallow((state) => ({ enabled: state.syncEnabled, status: state.syncStatus })));
  const graph = useGraphStore(useShallow((state) => ({ enabled: state.syncEnabled, status: state.syncStatus })));
  const lifeMap = useLifeMapStore(useShallow((state) => ({ enabled: state.syncEnabled, status: state.syncStatus })));
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [queueError, setQueueError] = useState(false);
  const [queueLoaded, setQueueLoaded] = useState(false);
  const [lastConnectedAt, setLastConnectedAt] = useState<string | null>(readLastConnectedAt);
  const wasFullySynchronized = useRef(false);

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
      setPendingCount(pending ? Object.keys(pending.fields ?? {}).length : 0);
      setConflictCount(conflicts.length);
      if (!pending) setQueueError(false);
    } catch {
      setQueueError(true);
    } finally {
      setQueueLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refreshQueueState();
    const handleOnline = () => { setOnline(true); void refreshQueueState(); };
    const handleOffline = () => setOnline(false);
    const handleQueue = () => void refreshQueueState();
    const handleQueueError = () => setQueueError(true);
    const handleStorage = (event: StorageEvent) => {
      if (event.key === 'smart-line-sync-last-connected') setLastConnectedAt(readLastConnectedAt());
    };
    const interval = window.setInterval(() => void refreshQueueState(), 15_000);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('storage', handleStorage);
    window.addEventListener(WORKSPACE_QUEUE_EVENT, handleQueue);
    window.addEventListener(WORKSPACE_QUEUE_ERROR_EVENT, handleQueueError);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(WORKSPACE_QUEUE_EVENT, handleQueue);
      window.removeEventListener(WORKSPACE_QUEUE_ERROR_EVENT, handleQueueError);
    };
  }, [refreshQueueState]);

  useEffect(() => {
    const fullySynchronized = queueLoaded
      && online
      && enabledModules.length > 0
      && connectedCount === enabledModules.length
      && pendingCount === 0
      && conflictCount === 0
      && !queueError;
    if (fullySynchronized && !wasFullySynchronized.current) {
      const now = new Date().toISOString();
      setLastConnectedAt(now);
      persistLastSynchronizedAt(now);
    }
    wasFullySynchronized.current = fullySynchronized;
  }, [connectedCount, conflictCount, enabledModules.length, online, pendingCount, queueError, queueLoaded]);

  const indicatorState = deriveSyncIndicatorState({
    modules,
    online,
    pendingCount,
    conflictCount,
    queueError,
  });

  const issueCount = conflictCount + errorCount;
  const description = indicatorState === 'off'
    ? '同步未开启'
    : indicatorState === 'connecting'
      ? `正在同步 ${connectedCount}/${enabledModules.length} 个数据模块`
      : indicatorState === 'connected'
        ? `已同步 ${connectedCount} 个数据模块 · ${formatLastConnected(lastConnectedAt)}`
        : indicatorState === 'pending'
          ? `${online ? '等待上传' : '网络离线'}${pendingCount > 0 ? ` · ${pendingCount} 个数据字段待同步` : ''}`
          : `同步存在问题${issueCount > 0 ? ` · ${issueCount} 项需要处理` : ''}`;

  return (
    <button
      type="button"
      className={`workspace-sync-status workspace-sync-status--${indicatorState} ${className}`.trim()}
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_SYNC_EVENT))}
      aria-label={`${description}，打开同步与备份`}
      title={`${description}。点击打开同步与备份。`}
      data-sync-state={indicatorState}
    >
      {indicatorState === 'connected' && <span className="workspace-sync-status__connected-icon"><Cloud size={17} /><Check size={9} /></span>}
      {indicatorState === 'connecting' && <LoaderCircle className="workspace-sync-status__spinner" size={17} />}
      {indicatorState === 'pending' && <CloudOff size={17} />}
      {indicatorState === 'error' && <TriangleAlert size={17} />}
      {indicatorState === 'off' && <CloudOff size={17} />}
      {(issueCount > 0 || pendingCount > 0) && (
        <span className="workspace-sync-status__badge">{Math.min(99, issueCount || pendingCount)}</span>
      )}
    </button>
  );
};

export default SyncStatusIndicator;

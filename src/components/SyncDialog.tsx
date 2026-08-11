import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestConfirmation } from '@/services/confirmation';
import { ArrowRightLeft, Check, Cloud, Copy, Database, Download, Eye, EyeOff, Link, LogOut, RefreshCw, Unlink, Upload } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useEbbStore, EBB_ROOM_PREFIX } from '@/ebb/store';
import { useDailyScheduleStore, DAILY_ROOM_PREFIX } from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';
import { LIFE_MAP_ROOM_PREFIX, useLifeMapStore } from '@/lifeMap/store';
import { liveblocksAuthMode } from '@/store/client';
import { useAuth } from '@/auth/AuthContext';
import {
  downloadWorkspaceBackup,
  createWorkspaceBackup,
  listLocalSnapshots,
  getSnapshotStorageStats,
  restoreLocalSnapshot,
  restoreWorkspaceBackup,
  validateWorkspaceBackup,
  type WorkspaceBackupSummary,
  type WorkspaceSnapshot,
  type SnapshotStorageStats,
} from '@/services/workspaceBackup';
import {
  activateUnifiedWorkspaceSafely,
  disconnectWorkspace,
  downloadMigrationReport,
  inspectLegacyWorkspace,
  migrateLegacyWorkspace,
  readWorkspaceSyncSettings,
  reconnectConfiguredWorkspace,
  resetToLegacyArchitecture,
  type WorkspaceMigrationReport,
} from '@/services/workspaceSync';
import { listWorkspaceConflicts, readPendingWorkspaceSync, restoreWorkspaceConflictFields, type WorkspaceConflictRecord, type WorkspaceStorageField } from '@/services/workspaceOfflineQueue';
import { loadWorkspacePeriodArchive, saveWorkspacePeriodArchive } from '@/services/workspaceArchive';
import { isCurrentTabSyncLeader } from '@/services/workspaceTabCoordinator';
import { useShallow } from 'zustand/react/shallow';

interface SyncDialogProps { onClose: () => void }
type ModuleKey = 'timeline' | 'ebb' | 'daily' | 'graph' | 'lifeMap';
type DisplayStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

const LAST_CONNECTED_KEY = 'smart-line-sync-last-connected';
const WORKSPACE_FIELD_LABELS: Partial<Record<WorkspaceStorageField, string>> = {
  lifeMapAreas: '人生领域', lifeMapPlanGroups: '项目展示大类', lifeMapStages: '人生时期', lifeMapThemes: '时期重点（历史主题）', lifeMapGoals: '目标与项目',
  lifeMapSystems: '长期系统', lifeMapSystemCheckIns: '系统完成记录', lifeMapEvents: '关键日期', lifeMapFocuses: '阶段重点',
  lifeMapNotes: '人生便签', lifeMapReviews: '周期复盘', tasks: '项目任务', groups: '项目分组',
  schedules: '每日安排', retrospectives: '每日复盘', reviewTasks: '复习任务', nodes: '知识节点',
};

function readLastConnected(): Partial<Record<ModuleKey, string>> {
  try {
    return JSON.parse(localStorage.getItem(LAST_CONNECTED_KEY) ?? '{}') as Partial<Record<ModuleKey, string>>;
  } catch {
    return {};
  }
}

function formatTime(value?: string): string {
  if (!value) return '暂无记录';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '暂无记录' : date.toLocaleString('zh-CN');
}

function summarizeConflictValue(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} 项`;
  if (value && typeof value === 'object') return `${Object.keys(value as Record<string, unknown>).length} 项`;
  if (value === undefined) return '无数据';
  return String(value).slice(0, 24);
}

const SyncDialog: React.FC<SyncDialogProps> = ({ onClose }) => {
  const auth = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timeline = useTimelineStore(useShallow((state) => ({
    syncRoomCode: state.syncRoomCode,
    syncEnabled: state.syncEnabled,
    syncStatus: state.syncStatus,
    enableSync: state.enableSync,
    liveblocks: state.liveblocks,
  })));
  const ebb = useEbbStore(useShallow((state) => ({
    syncRoomCode: state.syncRoomCode,
    syncEnabled: state.syncEnabled,
    syncStatus: state.syncStatus,
    enableSync: state.enableSync,
    liveblocks: state.liveblocks,
  })));
  const daily = useDailyScheduleStore(useShallow((state) => ({
    syncRoomCode: state.syncRoomCode,
    syncEnabled: state.syncEnabled,
    syncStatus: state.syncStatus,
    enableSync: state.enableSync,
    liveblocks: state.liveblocks,
  })));
  const graph = useGraphStore(useShallow((state) => ({
    syncRoomCode: state.syncRoomCode,
    syncEnabled: state.syncEnabled,
    syncStatus: state.syncStatus,
    enableSync: state.enableSync,
    liveblocks: state.liveblocks,
  })));
  const lifeMap = useLifeMapStore(useShallow((state) => ({
    syncRoomCode: state.syncRoomCode,
    syncEnabled: state.syncEnabled,
    syncStatus: state.syncStatus,
    enableSync: state.enableSync,
    liveblocks: state.liveblocks,
  })));
  const [roomCode, setRoomCode] = useState(timeline.syncRoomCode || '');
  const [showRoomCode, setShowRoomCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastConnected, setLastConnected] = useState(readLastConnected);
  const [restoreSummary, setRestoreSummary] = useState<WorkspaceBackupSummary | null>(null);
  const [restoreMessage, setRestoreMessage] = useState('');
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>([]);
  const [snapshotStats, setSnapshotStats] = useState<SnapshotStorageStats | null>(null);
  const [architecture, setArchitecture] = useState(readWorkspaceSyncSettings);
  const [migrationCheck, setMigrationCheck] = useState<{ summary: WorkspaceBackupSummary; hash: string } | null>(null);
  const [migrationReport, setMigrationReport] = useState<WorkspaceMigrationReport | null>(null);
  const [migrationBusy, setMigrationBusy] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState('');
  const [r2Configured, setR2Configured] = useState<boolean | null>(null);
  const [pendingFieldCount, setPendingFieldCount] = useState<number | null>(null);
  const [syncConflicts, setSyncConflicts] = useState<WorkspaceConflictRecord[]>([]);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [selectedConflictFields, setSelectedConflictFields] = useState<WorkspaceStorageField[]>([]);
  const [archivePeriod, setArchivePeriod] = useState(() => new Date().toISOString().slice(0, 7));

  useEffect(() => {
    listLocalSnapshots().then(setSnapshots).catch(() => setSnapshots([]));
    getSnapshotStorageStats().then(setSnapshotStats).catch(() => setSnapshotStats(null));
  }, [restoreMessage]);

  useEffect(() => {
    if (!auth.enabled) return;
    fetch('/api/storage/status', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
      .then(async (response) => response.ok ? await response.json() as { r2Configured?: boolean } : null)
      .then((result) => setR2Configured(Boolean(result?.r2Configured)))
      .catch(() => setR2Configured(false));
  }, [auth.enabled]);

  useEffect(() => {
    const refresh = () => {
      readPendingWorkspaceSync().then((pending) => setPendingFieldCount(Object.keys(pending?.fields ?? {}).length)).catch(() => setPendingFieldCount(null));
      listWorkspaceConflicts().then((items) => {
        setSyncConflicts(items);
        if (items[0]) setSelectedConflictFields((current) => {
          const available = Object.keys(items[0].pending.fields) as WorkspaceStorageField[];
          const retained = current.filter((field) => available.includes(field));
          return retained.length ? retained : available;
        });
      }).catch(() => setSyncConflicts([]));
    };
    refresh();
    const timer = window.setInterval(refresh, 2_000);
    return () => window.clearInterval(timer);
  }, [restoreMessage]);

  useEffect(() => {
    const refresh = () => setLastConnected(readLastConnected());
    refresh();
    const timer = window.setInterval(refresh, 2000);
    return () => window.clearInterval(timer);
  }, []);

  const modules = useMemo(() => [
    { key: 'timeline' as const, label: '时间轴与项目文档', enabled: timeline.syncEnabled, status: timeline.syncStatus as DisplayStatus },
    { key: 'ebb' as const, label: 'EBB 复习', enabled: ebb.syncEnabled, status: ebb.syncStatus as DisplayStatus },
    { key: 'daily' as const, label: '每日安排', enabled: daily.syncEnabled, status: daily.syncStatus as DisplayStatus },
    { key: 'graph' as const, label: '知识大盘', enabled: graph.syncEnabled, status: graph.syncStatus as DisplayStatus },
    { key: 'lifeMap' as const, label: '人生地图', enabled: lifeMap.syncEnabled, status: lifeMap.syncStatus as DisplayStatus },
  ], [timeline.syncEnabled, timeline.syncStatus, ebb.syncEnabled, ebb.syncStatus, daily.syncEnabled, daily.syncStatus, graph.syncEnabled, graph.syncStatus, lifeMap.syncEnabled, lifeMap.syncStatus]);

  const activeCode = timeline.syncRoomCode || ebb.syncRoomCode || daily.syncRoomCode || graph.syncRoomCode || lifeMap.syncRoomCode || roomCode;
  const enabledCount = modules.filter((module) => module.enabled).length;
  const connectedCount = modules.filter((module) => module.enabled && module.status === 'connected').length;
  const allConnected = enabledCount === 5 && connectedCount === 5;
  const fullySynchronized = allConnected && pendingFieldCount === 0 && syncConflicts.length === 0;

  const connectModule = useCallback((key: ModuleKey, code: string) => {
    if (!code) return;
    if (architecture.architecture === 'unified') {
      void reconnectConfiguredWorkspace().catch((error) => {
        setRestoreMessage(error instanceof Error ? error.message : '统一工作区连接失败。');
      });
      return;
    }
    if (key === 'timeline') {
      timeline.enableSync(code);
      timeline.liveblocks?.enterRoom?.(code);
    } else if (key === 'ebb') {
      ebb.enableSync(code);
      ebb.liveblocks?.enterRoom?.(`${EBB_ROOM_PREFIX}${code}`);
    } else if (key === 'daily') {
      daily.enableSync(code);
      daily.liveblocks?.enterRoom?.(`${DAILY_ROOM_PREFIX}${code}`);
    } else if (key === 'graph') {
      graph.enableSync(code);
      graph.liveblocks?.enterRoom?.(`graph-${code}`);
    } else {
      lifeMap.enableSync(code);
      lifeMap.liveblocks?.enterRoom?.(`${LIFE_MAP_ROOM_PREFIX}${code}`);
    }
  }, [timeline, ebb, daily, graph, lifeMap, architecture]);

  const handleConnectAll = useCallback(async () => {
    if (!isCurrentTabSyncLeader()) {
      setRestoreMessage('另一个标签页正在负责云同步。请在主标签页执行连接或迁移。');
      return;
    }
    const enteredCode = roomCode.trim();
    const fallbackCode = enteredCode
      || timeline.syncRoomCode
      || ebb.syncRoomCode
      || daily.syncRoomCode
      || graph.syncRoomCode
      || lifeMap.syncRoomCode;
    if (!fallbackCode) return;

    setConnectionBusy(true);
    setRestoreMessage('正在连接云端并处理本机待同步数据…');

    try {
      if (architecture.architecture === 'unified') {
        if (enabledCount === 0 && liveblocksAuthMode === 'authenticated') {
          const result = await activateUnifiedWorkspaceSafely(
            fallbackCode,
            auth.userId || auth.login || 'owner',
            auth.login || undefined,
          );
          setArchitecture(readWorkspaceSyncSettings());
          setRestoreMessage(result.source === 'cloud'
            ? '本机没有规划内容，已安全连接并完成云端数据加载。'
            : result.source === 'matching'
              ? '本机与云端数据一致，连接及云端确认均已完成。'
              : '云端为空，已安全连接并完成本机工作区上传。');
        } else {
          const result = await reconnectConfiguredWorkspace();
          setRestoreMessage(result && result.applied > 0
            ? `连接及云端确认已完成，已补传 ${result.applied} 个数据字段。`
            : '连接及云端确认已完成，待同步队列为空。');
        }
        return;
      }

      if (enabledCount === 0 && liveblocksAuthMode === 'authenticated') {
        setRestoreMessage('正在检查本机与云端数据，连接前会先创建本地快照…');
      const result = await activateUnifiedWorkspaceSafely(
        fallbackCode,
        auth.userId || auth.login || 'owner',
        auth.login || undefined,
      );
        setArchitecture(readWorkspaceSyncSettings());
        setRestoreMessage(result.source === 'cloud'
          ? '本机没有规划内容，已安全连接并完成云端数据加载。'
          : result.source === 'matching'
            ? '本机与云端数据一致，连接及云端确认均已完成。'
            : '云端为空，已安全连接并完成本机工作区上传。');
        return;
      }

      // Existing workspaces may still use five historical room codes. Reconnect
      // each module to its saved room instead of silently moving it to the first
      // code shown in the dialog. A brand-new connection still uses one code for
      // all five modules.
      const savedCodes: Record<ModuleKey, string> = {
        timeline: timeline.syncRoomCode,
        ebb: ebb.syncRoomCode,
        daily: daily.syncRoomCode,
        graph: graph.syncRoomCode,
        lifeMap: lifeMap.syncRoomCode,
      };
      const reconnectingExisting = timeline.syncEnabled || ebb.syncEnabled || daily.syncEnabled || graph.syncEnabled || lifeMap.syncEnabled;
      (['timeline', 'ebb', 'daily', 'graph', 'lifeMap'] as ModuleKey[]).forEach((key) => {
        const moduleCode = reconnectingExisting ? (savedCodes[key] || fallbackCode) : fallbackCode;
        connectModule(key, moduleCode);
      });
      setRestoreMessage('旧房间重新连接已启动，请等待五个模块全部变为“已连接”。');
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '统一工作区连接或补传失败。');
    } finally {
      setConnectionBusy(false);
    }
  }, [roomCode, timeline.syncRoomCode, timeline.syncEnabled, ebb.syncRoomCode, ebb.syncEnabled, daily.syncRoomCode, daily.syncEnabled, graph.syncRoomCode, graph.syncEnabled, lifeMap.syncRoomCode, lifeMap.syncEnabled, connectModule, architecture, enabledCount, auth.login, auth.userId]);

  const handleDisconnectAll = useCallback(() => {
    disconnectWorkspace(true);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!activeCode) return;
    try {
      await navigator.clipboard.writeText(activeCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setRestoreMessage('复制失败，请手动选择房间号复制。');
    }
  }, [activeCode]);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const result = validateWorkspaceBackup(JSON.parse(String(reader.result)));
        if (!result.backup || !result.summary || result.errors.length > 0) {
          setRestoreMessage(result.errors.join('\n') || '备份文件无效。');
          return;
        }
        setRestoreSummary(result.summary);
        const issueText = result.summary.issues.length > 0
          ? `\n检测到 ${result.summary.issues.length} 个数据问题，恢复后可运行健康检查。`
          : '';
        const confirmed = await requestConfirmation(
          `即将恢复完整工作区：\n时间轴任务 ${result.summary.tasks}\n旧人生时期 ${result.summary.lifeStages}\n独立人生地图 ${result.summary.lifeMapItems} 项（${result.summary.lifeMapAreas} 个领域）\n项目文档 ${result.summary.projectDocuments}\nEBB 轮次 ${result.summary.reviewTasks}\n每日安排 ${result.summary.dailyDays} 天\n每日复盘 ${result.summary.retrospectiveDays} 天（${result.summary.retrospectiveEntries} 条）\n知识节点 ${result.summary.graphNodes}${issueText}\n\n恢复前会自动保存当前工作区快照。当前若已连接云同步，恢复内容也会同步到原房间。是否继续？`,
        );
        if (!confirmed) return;
        await restoreWorkspaceBackup(result.backup);
        setRestoreMessage('完整工作区恢复成功。已自动保存恢复前快照。');
      } catch {
        setRestoreMessage('恢复失败：文件不是有效的 JSON 备份。');
      }
    };
    reader.onerror = () => setRestoreMessage('备份文件读取失败，请重新选择文件。');
    reader.readAsText(file);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await auth.logout();
      onClose();
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '退出登录失败，请重试。');
    }
  }, [auth, onClose]);

  const handleExport = useCallback(() => {
    try {
      downloadWorkspaceBackup();
      setRestoreMessage('完整工作区备份已导出。');
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '完整备份导出失败。');
    }
  }, []);

  const handleHealthCheck = useCallback(() => {
    try {
      const result = validateWorkspaceBackup(createWorkspaceBackup());
      setRestoreSummary(result.summary ?? null);
      const issues = result.summary?.issues ?? [];
      setRestoreMessage(issues.length === 0 ? '数据健康检查通过，未发现孤儿绑定、重复 ID 或无效日期。' : `数据健康检查发现 ${issues.length} 个问题：${issues.slice(0, 3).join('；')}`);
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '数据健康检查失败。');
    }
  }, []);

  const handleRestoreSnapshot = useCallback(async (snapshot: WorkspaceSnapshot) => {
    if (!await requestConfirmation(`确定恢复 ${new Date(snapshot.createdAt).toLocaleString('zh-CN')} 的本地快照吗？当前工作区会先自动保存快照。`)) return;
    try {
      await restoreLocalSnapshot(snapshot);
      setRestoreMessage('本地快照恢复成功。');
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '本地快照恢复失败。');
    }
  }, []);

  const handleInspectLegacy = useCallback(async () => {
    if (!activeCode) {
      setMigrationStatus('没有找到旧房间号，请先确认同步房间号。');
      return;
    }
    setMigrationCheck(null);
    setMigrationStatus('正在连接并读取旧模块房间，请稍候（最长约15秒）…');
    setMigrationBusy(true);
    try {
      const result = await inspectLegacyWorkspace(activeCode);
      setMigrationCheck({ summary: result.summary, hash: result.hash });
      setMigrationStatus('检查完成。请核对下方数量，然后执行迁移。');
      setRestoreMessage('旧模块房间检查完成。请核对数量后再执行复制迁移。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '旧房间检查失败。';
      setMigrationStatus(message);
      setRestoreMessage(message);
    } finally {
      setMigrationBusy(false);
    }
  }, [activeCode]);

  const handleMigrate = useCallback(async () => {
    if (!activeCode || !migrationCheck) {
      setMigrationStatus('请先完成“检查旧数据”。');
      return;
    }
    if (!isCurrentTabSyncLeader()) {
      const message = '另一个标签页正在负责云同步。请关闭其他标签页，或在负责同步的标签页执行迁移。';
      setMigrationStatus(message);
      setRestoreMessage(message);
      return;
    }
    const summary = migrationCheck.summary;
    if (!await requestConfirmation(`将旧模块房间复制到一个认证工作区：\n项目任务 ${summary.tasks}\n人生规划 ${summary.lifeMapItems}\nEBB ${summary.reviewTasks}\n每日安排 ${summary.dailyDays} 天\n每日复盘 ${summary.retrospectiveDays} 天\n知识节点 ${summary.graphNodes}\n\n旧房间不会删除。是否继续？`)) return;
    setMigrationBusy(true);
    setMigrationStatus('正在创建快照、复制并校验数据；完成前请不要刷新或关闭页面…');
    try {
      const report = await migrateLegacyWorkspace(activeCode, auth.userId || auth.login || 'owner');
      setMigrationReport(report);
      setArchitecture(readWorkspaceSyncSettings());
      downloadMigrationReport(report);
      setMigrationStatus('迁移成功：数量和 SHA-256 哈希均一致，旧房间未删除。');
      setRestoreMessage('统一工作区迁移完成，前后数量和哈希一致；迁移报告已下载，旧房间保持不变。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '统一工作区迁移失败，已返回旧房间。';
      setMigrationStatus(message);
      setRestoreMessage(message);
    } finally {
      setMigrationBusy(false);
    }
  }, [activeCode, auth.login, auth.userId, migrationCheck]);

  const handleLegacyFallback = useCallback(async () => {
    if (!activeCode || !await requestConfirmation('确定暂时返回旧模块房间吗？统一工作区数据不会删除。')) return;
    try {
      resetToLegacyArchitecture(activeCode);
      setArchitecture(readWorkspaceSyncSettings());
      setRestoreMessage('已切回旧模块房间恢复通道。');
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '无法返回旧模块房间。');
    }
  }, [activeCode]);

  const handleArchivePeriod = useCallback(async () => {
    try {
      const backup = createWorkspaceBackup();
      await saveWorkspacePeriodArchive(archivePeriod, {
        daily: Object.fromEntries(Object.entries(backup.daily.schedules).filter(([date]) => date.startsWith(archivePeriod))),
        completedTasks: backup.timeline.tasks.filter((task) => task.completed && task.end.slice(0, 7) === archivePeriod),
      });
      setRestoreMessage(`${archivePeriod} 历史副本已保存到R2，当前工作区数据未删除。`);
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '历史归档失败。');
    }
  }, [archivePeriod]);

  const handleDownloadArchive = useCallback(async () => {
    try {
      const archive = await loadWorkspacePeriodArchive(archivePeriod);
      const blob = new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `smart-line-archive-${archivePeriod}.json`; anchor.click();
      URL.revokeObjectURL(url);
      setRestoreMessage(`${archivePeriod} 历史归档已下载。`);
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '历史归档读取失败。');
    }
  }, [archivePeriod]);

  return (
    <div className="tl-dialog-overlay" onClick={onClose}>
      <div className="tl-dialog tl-dialog--standard" role="dialog" aria-modal="true" aria-label="云同步与完整备份" onClick={(event) => event.stopPropagation()}>
        <h3 className="tl-dialog-title"><Cloud size={18} />云同步与完整备份</h3>

        <div className="tl-sync-status">
          <span className="tl-sync-dot" style={{ backgroundColor: fullySynchronized ? '#059669' : enabledCount > 0 ? '#D97706' : '#9CA3AF' }} />
          <strong>{fullySynchronized
            ? (architecture.architecture === 'unified' ? '统一工作区已同步' : '旧房间同步 5/5')
            : allConnected && syncConflicts.length > 0
              ? `已连接，存在 ${syncConflicts.length} 个冲突副本`
              : allConnected && pendingFieldCount !== null && pendingFieldCount > 0
                ? `已连接，等待补传 ${pendingFieldCount} 个字段`
                : enabledCount > 0 ? `部分同步 ${connectedCount}/5` : '尚未连接'}</strong>
        </div>
        <p className="tl-dialog-hint">
          认证方式：{liveblocksAuthMode === 'authenticated' ? '用户身份认证' : '公钥兼容模式'}
          {auth.login ? ` · GitHub：${auth.login}` : ''}
        </p>
        <p className="tl-dialog-hint">待补传字段：{pendingFieldCount ?? '检查中'} · 冲突副本：{syncConflicts.length}</p>
        {restoreMessage && <p className="tl-sync-backup-hint" role="status" aria-live="polite">{restoreMessage}</p>}
        {syncConflicts[0] && <section className="tl-sync-conflict-fields" aria-label="选择冲突数据">
          <strong>最近冲突 · {formatTime(syncConflicts[0].detectedAt)}</strong>
          <small>仅勾选你确认要用本机版本覆盖云端的部分；未选择的字段会继续保留在冲突副本中。</small>
          <div>{(Object.keys(syncConflicts[0].pending.fields) as WorkspaceStorageField[]).map((field) => <label key={field}><input type="checkbox" checked={selectedConflictFields.includes(field)} onChange={(event) => setSelectedConflictFields((current) => event.target.checked ? [...new Set([...current, field])] : current.filter((item) => item !== field))} /><span><b>{WORKSPACE_FIELD_LABELS[field] ?? field}{syncConflicts[0].conflictingFields?.includes(field) ? ' · 同字段冲突' : ''}</b><small>本机 {summarizeConflictValue(syncConflicts[0].pending.fields[field])} · 云端 {summarizeConflictValue(syncConflicts[0].remoteFields?.[field])}</small></span></label>)}</div>
          <button type="button" className="tl-sync-backup-btn" disabled={selectedConflictFields.length === 0} onClick={async () => {
            if (!await requestConfirmation(`恢复已选择的 ${selectedConflictFields.length} 个数据字段吗？这些内容会重新进入待同步队列。`)) return;
            void restoreWorkspaceConflictFields(syncConflicts[0].id, selectedConflictFields)
              .then(() => { setRestoreMessage('所选冲突字段已恢复并进入待同步队列。'); setSelectedConflictFields([]); })
              .catch((error) => setRestoreMessage(error instanceof Error ? error.message : '冲突恢复失败。'));
          }}><RefreshCw size={14} />恢复所选字段</button>
        </section>}
        {auth.enabled && auth.login && (
          <button type="button" className="tl-sync-backup-btn" onClick={() => void handleLogout()} style={{ marginBottom: 12 }}>
            <LogOut size={14} />退出当前账号
          </button>
        )}

        <label className="tl-dialog-label">
          房间号（仍然只输入一个）
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="tl-dialog-input"
              type={showRoomCode ? 'text' : 'password'}
              value={enabledCount > 0 ? activeCode : roomCode}
              readOnly={enabledCount > 0}
              onChange={(event) => setRoomCode(event.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
              maxLength={64}
              autoComplete="off"
            />
            <button type="button" className="tl-sync-copy-btn" onClick={() => setShowRoomCode((value) => !value)} title={showRoomCode ? '隐藏房间号' : '显示房间号'}>
              {showRoomCode ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button type="button" className="tl-sync-copy-btn" onClick={handleCopy} title="复制房间号">
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
          <span className="tl-dialog-hint">{architecture.architecture === 'unified' ? `当前使用一个认证工作区房间：${architecture.unifiedRoomId}` : '当前仍使用旧模块房间；完成检查后可复制迁移到统一工作区。'}</span>
        </label>

        {enabledCount > 0 && (
          <details className="tl-settings-disclosure" style={{ marginBottom: 14 }}>
            <summary><Database size={15} />同步高级设置</summary>
          <div className="tl-sync-backup-section tl-settings-disclosure-content">
            <h4 className="tl-sync-backup-title"><Database size={15} />同步架构</h4>
            {architecture.architecture === 'legacy' ? <>
              <p className="tl-sync-backup-hint">迁移采用“读取旧房间 → 本地快照 → 复制 → 数量和 SHA-256 校验 → 切换”，不会删除旧数据。</p>
              <div className="tl-sync-backup-actions">
                <button type="button" className="tl-sync-backup-btn" onClick={handleInspectLegacy} disabled={migrationBusy}><Check size={14} />{migrationBusy && !migrationCheck ? '检查中…' : '检查旧数据'}</button>
                <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--import" onClick={handleMigrate} disabled={migrationBusy || !migrationCheck}><ArrowRightLeft size={14} />{migrationBusy && migrationCheck ? '迁移中…' : '迁移到统一工作区'}</button>
              </div>
              {migrationStatus && <p className="tl-sync-backup-hint" role="status" aria-live="polite">{migrationStatus}</p>}
              {migrationCheck && <p className="tl-sync-backup-hint">待迁移：{migrationCheck.summary.groups} 个项目组、{migrationCheck.summary.tasks} 个任务、{migrationCheck.summary.lifeMapItems} 项独立人生规划、{migrationCheck.summary.projectDocuments} 份项目文档、{migrationCheck.summary.reviewTasks} 个轮次、{migrationCheck.summary.dailyDays} 天安排、{migrationCheck.summary.retrospectiveDays} 天复盘、{migrationCheck.summary.graphNodes} 个节点。</p>}
            </> : <>
              <p className="tl-sync-backup-hint">五个数据域共享同一底层房间连接，人生地图作为独立数据域同步。旧模块房间保持不变，仅在主动回退时重新连接。</p>
              <button type="button" className="tl-sync-backup-btn" onClick={handleLegacyFallback}><RefreshCw size={14} />暂时返回旧房间</button>
              {migrationReport && <button type="button" className="tl-sync-backup-btn" onClick={() => downloadMigrationReport(migrationReport)} style={{ marginLeft: 8 }}><Download size={14} />下载迁移报告</button>}
            </>}
          </div>
          </details>
        )}

        <div className="tl-sync-info">
          {modules.map((module) => (
            <div className="tl-sync-info-row" key={module.key}>
              <span className="tl-sync-info-label">{module.label}</span>
              <span className="tl-sync-info-value">
                <span style={{ color: module.status === 'connected' ? '#059669' : module.status === 'connecting' ? '#D97706' : '#9CA3AF' }}>
                  {module.status === 'connected' ? '已连接' : module.status === 'connecting' ? '连接中' : module.status === 'error' ? '连接异常' : '未连接'}
                </span>
                <small style={{ marginLeft: 8 }}>上次：{formatTime(lastConnected[module.key])}</small>
                {enabledCount > 0 && module.status !== 'connected' && (
                  <button
                    type="button"
                    className="tl-sync-copy-btn"
                    onClick={() => connectModule(module.key, ({
                      timeline: timeline.syncRoomCode,
                      ebb: ebb.syncRoomCode,
                      daily: daily.syncRoomCode,
                      graph: graph.syncRoomCode,
                      lifeMap: lifeMap.syncRoomCode,
                    }[module.key] || activeCode))}
                    title={`重新连接${module.label}`}
                  >
                    <RefreshCw size={13} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        {enabledCount > 0 && (
          <button type="button" className="tl-sync-backup-btn" onClick={handleConnectAll} disabled={connectionBusy} style={{ marginBottom: 12 }}>
            <RefreshCw size={14} />{connectionBusy ? '正在连接并补传…' : '全部重新连接'}
          </button>
        )}

        <div className="tl-sync-divider" />
        <details className="tl-settings-disclosure">
          <summary><Database size={15} />数据、备份与恢复</summary>
        <div className="tl-sync-backup-section tl-settings-disclosure-content">
          <h4 className="tl-sync-backup-title">完整工作区备份与恢复</h4>
          <div className="tl-sync-backup-actions">
            <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--import" onClick={() => fileInputRef.current?.click()}>
              <Upload size={14} />恢复完整备份
            </button>
            <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--export" onClick={handleExport}>
              <Download size={14} />导出完整备份
            </button>
            <button type="button" className="tl-sync-backup-btn" onClick={handleHealthCheck}>
              <Check size={14} />数据健康检查
            </button>
          </div>
          <p className="tl-sync-backup-hint">包含时间轴、项目文档、EBB、每日安排、知识大盘和应用设置。恢复前会校验数据并自动创建本地快照。</p>
          {snapshotStats && <p className="tl-sync-backup-hint">快照：{snapshotStats.snapshotCount} 份、{snapshotStats.chunkCount} 个去重数据块、约 {(snapshotStats.snapshotBytes / 1024).toFixed(1)} KB。</p>}
          {auth.enabled && <p className="tl-sync-backup-hint">R2历史归档：{r2Configured === null ? '检测中' : r2Configured ? '已启用' : '尚未绑定 SMARTLINE_R2（不影响现有数据）'}。</p>}
          {r2Configured && <div className="tl-sync-backup-actions">
            <input className="tl-dialog-input" type="month" value={archivePeriod} onChange={(event) => setArchivePeriod(event.target.value)} style={{ maxWidth: 150 }} />
            <button type="button" className="tl-sync-backup-btn" onClick={() => void handleArchivePeriod()}><Upload size={14} />保存月度归档</button>
            <button type="button" className="tl-sync-backup-btn" onClick={() => void handleDownloadArchive()}><Download size={14} />下载月度归档</button>
          </div>}
          {restoreSummary && <p className="tl-sync-backup-hint">最近检查：{restoreSummary.tasks} 个项目任务、{restoreSummary.lifeMapItems} 项人生规划、{restoreSummary.reviewTasks} 个轮次、{restoreSummary.retrospectiveEntries} 条复盘、{restoreSummary.graphNodes} 个节点。</p>}
          {snapshots.length > 0 && (
            <div className="tl-sync-info" style={{ marginTop: 10 }}>
              {snapshots.slice(0, 5).map((snapshot) => (
                <div className="tl-sync-info-row" key={snapshot.id}>
                  <span className="tl-sync-info-label">{snapshot.reason}</span>
                  <span className="tl-sync-info-value">
                    {new Date(snapshot.createdAt).toLocaleString('zh-CN')}
                    <button type="button" className="tl-sync-copy-btn" onClick={() => handleRestoreSnapshot(snapshot)} title="恢复此快照">
                      <RefreshCw size={13} />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
        </details>

        <div className="tl-dialog-actions">
          <button type="button" className="tl-dialog-btn tl-dialog-btn--cancel" onClick={onClose}>关闭</button>
          {enabledCount === 0 ? (
            <button type="button" className="tl-dialog-btn tl-dialog-btn--primary" onClick={handleConnectAll} disabled={!roomCode.trim() || connectionBusy}><Link size={14} />{connectionBusy ? '正在连接并确认云端…' : '一键连接五个模块'}</button>
          ) : (
            <button type="button" className="tl-dialog-btn tl-dialog-btn--danger" onClick={handleDisconnectAll} disabled={connectionBusy}><Unlink size={14} />断开全部同步</button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={handleFileChange} />
      </div>
    </div>
  );
};

export default SyncDialog;

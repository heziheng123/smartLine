import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestConfirmation } from '@/services/confirmation';
import { ArrowRightLeft, Check, Cloud, Copy, Database, Download, Eye, EyeOff, FileSearch, Link, LogOut, RefreshCw, Unlink, Upload } from 'lucide-react';
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
  activateWorkspaceWithLegacyDiscovery,
  disconnectWorkspace,
  downloadMigrationReport,
  inspectLegacyWorkspace,
  migrateLegacyWorkspace,
  readWorkspaceSyncSettings,
  reconnectConfiguredWorkspace,
  readPendingWorkspaceActivationConflict,
  clearPendingWorkspaceActivationConflict,
  resolveUnifiedWorkspaceConflict,
  resetToLegacyArchitecture,
  isWorkspaceConnectionInProgress,
  readWorkspaceSyncRuntimeState,
  WORKSPACE_SYNC_RUNTIME_EVENT,
  WORKSPACE_CONFLICT_EVENT,
  WORKSPACE_VERIFIED_EVENT,
  UnifiedWorkspaceConflictError,
  type WorkspaceMigrationReport,
  type WorkspaceSyncRuntimeState,
} from '@/services/workspaceSync';
import { listWorkspaceConflicts, readPendingWorkspaceSync, restoreWorkspaceConflictFields, WORKSPACE_QUEUE_EVENT, type WorkspaceConflictRecord, type WorkspaceStorageField } from '@/services/workspaceOfflineQueue';
import { loadWorkspacePeriodArchive, saveWorkspacePeriodArchive } from '@/services/workspaceArchive';
import { currentWorkspaceHistoryDate, loadWorkspaceDailyHistory } from '@/services/workspaceHistory';
import { createCurrentWorkspaceAuditReport, downloadCurrentWorkspaceAuditReport } from '@/services/workspaceAudit';
import type { WorkspaceAuditReport } from '@/services/workspaceAuditCore';
import { isCurrentTabSyncLeader } from '@/services/workspaceTabCoordinator';
import { useShallow } from 'zustand/react/shallow';
import { summarizeAllConflicts, type FieldConflictSummary } from '@/services/workspaceConflictDiff';

interface SyncDialogProps { onClose: () => void }
type ModuleKey = 'timeline' | 'ebb' | 'daily' | 'graph' | 'lifeMap';
type DisplayStatus = 'connected' | 'connecting' | 'disconnected' | 'error';
type LastConnectedRecord = Partial<Record<ModuleKey | 'workspace', string>> & { workspaceRoomId?: string };

const LAST_CONNECTED_KEY = 'smart-line-sync-last-connected';
const LAST_MANUAL_EXPORT_KEY = 'smart-line-last-manual-export';
const WORKSPACE_FIELD_LABELS: Partial<Record<WorkspaceStorageField, string>> = {
  lifeMapAreas: '人生领域', lifeMapPlanGroups: '项目展示大类', lifeMapStages: '人生时期', lifeMapThemes: '时期重点（历史主题）', lifeMapGoals: '目标与项目',
  lifeMapSystems: '长期系统', lifeMapSystemCheckIns: '系统完成记录', lifeMapEvents: '关键日期', lifeMapFocuses: '阶段重点',
  lifeMapNotes: '人生便签', lifeMapReviews: '周期复盘', tasks: '项目任务', groups: '项目分组',
  schedules: '每日安排', retrospectives: '每日复盘', reviewTasks: '复习任务', nodes: '知识节点',
};

function readLastConnected(): LastConnectedRecord {
  try {
    return JSON.parse(localStorage.getItem(LAST_CONNECTED_KEY) ?? '{}') as LastConnectedRecord;
  } catch {
    return {};
  }
}

function readLastManualExport(): string | null {
  try {
    const value = localStorage.getItem(LAST_MANUAL_EXPORT_KEY);
    return value && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

function describeLastManualExport(): string {
  const value = readLastManualExport();
  if (!value) return '尚未手动导出过';
  const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
  if (days <= 0) return '今天刚刚导出过';
  if (days === 1) return '昨天导出过';
  if (days < 7) return `${days} 天前导出过`;
  if (days < 30) return `${days} 天前导出过（约 ${Math.floor(days / 7)} 周）`;
  return `${days} 天前导出过（建议尽快重新导出）`;
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

function describeConflictPath(field: WorkspaceStorageField, entityId: string): string {
  const kindLabels: Partial<Record<WorkspaceStorageField, string>> = {
    tasks: '项目任务',
    groups: '项目分组',
    notes: '时间轴便签',
    milestones: '里程碑',
    schedules: '每日安排',
    retrospectives: '每日复盘',
    reviewTasks: '复习轮次',
    nodes: '知识节点',
    lifeMapAreas: '人生领域',
    lifeMapPlanGroups: '人生规划分组',
    lifeMapStages: '人生时期',
    lifeMapThemes: '时期主题',
    lifeMapGoals: '人生目标',
    lifeMapSystems: '长期系统',
    lifeMapSystemCheckIns: '系统打卡',
    lifeMapEvents: '关键日期',
    lifeMapFocuses: '阶段重点',
    lifeMapNotes: '人生便签',
    lifeMapReviews: '周期复盘',
  };
  return `${kindLabels[field] ?? field}[${entityId.slice(0, 12)}]`;
}

function formatConflictScalar(value: unknown): string {
  if (value === undefined) return '（无）';
  if (value === null) return '（空）';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function describeConflictKind(fieldPath: string): { label: string; tone: 'create' | 'delete' | 'modify' | 'bulk' } {
  if (fieldPath === '(新建)') return { label: '新增', tone: 'create' };
  if (fieldPath === '(删除)') return { label: '删除', tone: 'delete' };
  if (fieldPath === '(整体内容)') return { label: '整体差异', tone: 'bulk' };
  return { label: fieldPath, tone: 'modify' };
}

const CONFLICT_TONE_COLORS: Record<'create' | 'delete' | 'modify' | 'bulk', { fg: string; bg: string; border: string }> = {
  create: { fg: '#065F46', bg: '#D1FAE5', border: '#6EE7B7' },
  delete: { fg: '#991B1B', bg: '#FEE2E2', border: '#FCA5A5' },
  modify: { fg: '#92400E', bg: '#FEF3C7', border: '#FCD34D' },
  bulk: { fg: '#3730A3', bg: '#E0E7FF', border: '#A5B4FC' },
};

function ConflictFieldDetail({ summary }: { summary: FieldConflictSummary }) {
  const [expanded, setExpanded] = useState(false);
  const visibleEntities = expanded ? summary.entities : summary.entities.slice(0, 5);
  const hiddenCount = summary.entities.length - visibleEntities.length;
  return (
    <div className="tl-sync-conflict-detail" style={{ marginTop: 8 }}>
      <strong style={{ display: 'block', marginBottom: 6, fontSize: 12 }}>
        {summary.fieldLabel} · {summary.totalEntities} 个条目 · {summary.totalDiffs} 处差异
      </strong>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
        {visibleEntities.map((entity) => (
          <li key={`${summary.field}:${entity.entityId}`} style={{ border: '1px solid #E5E7EB', borderRadius: 4, padding: '6px 8px', backgroundColor: '#FAFAFA' }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
              {describeConflictPath(summary.field, entity.entityId)} · <span style={{ color: '#1F2937' }}>{entity.entityLabel}</span>
            </div>
            {entity.diffs.map((diff, idx) => {
              const kind = describeConflictKind(diff.fieldPath);
              const tone = CONFLICT_TONE_COLORS[kind.tone];
              return (
                <div key={`${entity.entityId}-${diff.fieldPath}-${idx}`} style={{ fontSize: 11, lineHeight: 1.5, marginTop: 2 }}>
                  <span
                    title={diff.summary}
                    style={{
                      display: 'inline-block',
                      padding: '0 6px',
                      marginRight: 6,
                      borderRadius: 3,
                      color: tone.fg,
                      backgroundColor: tone.bg,
                      border: `1px solid ${tone.border}`,
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    {kind.label}
                  </span>
                  {kind.tone === 'modify' && <span style={{ color: '#6B7280' }}>📍 {diff.fieldPath}</span>}
                  {kind.tone === 'modify' && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 8px', marginTop: 2, marginLeft: 12 }}>
                      <span style={{ color: '#047857' }}>本机：</span>
                      <span style={{ wordBreak: 'break-word' }}>{formatConflictScalar(diff.localValue)}</span>
                      <span style={{ color: '#1D4ED8' }}>云端：</span>
                      <span style={{ wordBreak: 'break-word' }}>{formatConflictScalar(diff.remoteValue)}</span>
                    </div>
                  )}
                  {kind.tone !== 'modify' && (
                    <span style={{ color: '#4B5563', marginLeft: 4 }}>{diff.summary}</span>
                  )}
                </div>
              );
            })}
          </li>
        ))}
        {hiddenCount > 0 && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(true)}
              style={{
                fontSize: 11,
                color: '#1D4ED8',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              展开剩余 {hiddenCount} 个条目
            </button>
          </li>
        )}
        {expanded && summary.entities.length > 5 && (
          <li>
            <button
              type="button"
              onClick={() => setExpanded(false)}
              style={{
                fontSize: 11,
                color: '#6B7280',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                padding: 0,
              }}
            >
              收起
            </button>
          </li>
        )}
      </ul>
    </div>
  );
}

function WorkspaceHealthPanel({ report, onShowOrphans }: { report: WorkspaceAuditReport | null; onShowOrphans: () => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!report) {
    return (
      <details className="tl-settings-disclosure" style={{ marginBottom: 12 }}>
        <summary><FileSearch size={15} />当前数据状况</summary>
        <div className="tl-sync-backup-section tl-settings-disclosure-content" style={{ fontSize: 12, color: '#6B7280' }}>
          正在生成盘点报告…
        </div>
      </details>
    );
  }
  const status = report.integrity.status;
  const palette = {
    passed: { fg: '#065F46', bg: '#D1FAE5', label: '数据整合' },
    warning: { fg: '#92400E', bg: '#FEF3C7', label: '需要复核' },
    blocked: { fg: '#991B1B', bg: '#FEE2E2', label: '存在阻断' },
  }[status];
  const totalCount = Object.values(report.collections).reduce((sum, item) => sum + item.count, 0);
  const largestEntry = Object.values(report.collections)
    .filter((entry) => entry.largestEntity)
    .sort((a, b) => (b.largestEntity?.bytes ?? 0) - (a.largestEntity?.bytes ?? 0))[0];
  const collectionsWithIssues = Object.entries(report.collections)
    .filter(([, entry]) => entry.duplicateIds.length > 0 || entry.missingIdCount > 0)
    .map(([name]) => name);
  return (
    <details className="tl-settings-disclosure" style={{ marginBottom: 12 }} open={expanded} onToggle={(event) => setExpanded(event.currentTarget.open)}>
      <summary><FileSearch size={15} />当前数据状况</summary>
      <div className="tl-sync-backup-section tl-settings-disclosure-content" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ padding: '2px 8px', borderRadius: 4, backgroundColor: palette.bg, color: palette.fg, fontSize: 12, fontWeight: 600 }}>
            {palette.label}
          </span>
          <span style={{ fontSize: 12, color: '#374151' }}>
            {report.integrity.blockerCount} 个阻断 · {report.integrity.warningCount} 个警告
          </span>
          <span style={{ fontSize: 12, color: '#6B7280' }}>
            共 {totalCount.toLocaleString('zh-CN')} 条记录 · {(report.backupBytes / 1024).toFixed(1)} KB
          </span>
        </div>
        {largestEntry?.largestEntity && (
          <small style={{ fontSize: 11, color: '#6B7280' }}>
            最大单条：{largestEntry.largestEntity.id}（{(largestEntry.largestEntity.bytes / 1024).toFixed(1)} KB）
          </small>
        )}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="tl-sync-backup-btn"
            onClick={onShowOrphans}
            disabled={report.findings.filter((finding) => finding.code === 'missing-reference').length === 0}
          >
            <FileSearch size={14} />查看孤儿引用
            {report.findings.filter((finding) => finding.code === 'missing-reference').length > 0
              && `（${report.findings.filter((finding) => finding.code === 'missing-reference').length}）`}
          </button>
        </div>
        {collectionsWithIssues.length > 0 && (
          <small style={{ fontSize: 11, color: '#92400E' }}>
            集合中存在重复或缺失 ID：{collectionsWithIssues.join('、')}
          </small>
        )}
      </div>
    </details>
  );
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
  const initialActivationConflict = useRef(readPendingWorkspaceActivationConflict()).current;
  const [roomCode, setRoomCode] = useState(timeline.syncRoomCode || initialActivationConflict?.roomCode || '');
  const [showRoomCode, setShowRoomCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastConnected, setLastConnected] = useState(readLastConnected);
  const [restoreSummary, setRestoreSummary] = useState<WorkspaceBackupSummary | null>(null);
  const [restoreMessage, setRestoreMessage] = useState(() => (
    isWorkspaceConnectionInProgress() ? '连接任务仍在后台进行，请等待当前步骤完成。' : ''
  ));
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
  const [connectionBusy, setConnectionBusy] = useState(isWorkspaceConnectionInProgress);
  const [runtimeState, setRuntimeState] = useState(readWorkspaceSyncRuntimeState);
  const [activationConflict, setActivationConflict] = useState<{
    roomCode: string;
    remoteSource: 'unified' | 'legacy';
  } | null>(initialActivationConflict);
  const [selectedConflictFields, setSelectedConflictFields] = useState<WorkspaceStorageField[]>([]);
  const [showConflictRecovery, setShowConflictRecovery] = useState(false);
  const [archivePeriod, setArchivePeriod] = useState(() => new Date().toISOString().slice(0, 7));
  const [historyDate, setHistoryDate] = useState(currentWorkspaceHistoryDate);
  const [dataPanelOpen, setDataPanelOpen] = useState(false);
  const supportsWebLocks = typeof navigator !== 'undefined' && 'locks' in navigator;
  const [auditBusy, setAuditBusy] = useState(false);
  const [crossTabCheck, setCrossTabCheck] = useState<{
    status: 'idle' | 'running' | 'success' | 'fallback' | 'failed';
    message: string;
    detail: string[];
  }>({ status: 'idle', message: '', detail: [] });
  const [healthReport, setHealthReport] = useState<WorkspaceAuditReport | null>(null);
  const [healthReportBusy, setHealthReportBusy] = useState(false);

  const runCrossTabDetection = useCallback(async () => {
    setCrossTabCheck({ status: 'running', message: '正在打开第二个标签页…', detail: [] });
    const detail: string[] = [];
    try {
      const supportsBroadcast = typeof BroadcastChannel !== 'undefined';
      const supportsStorage = typeof localStorage !== 'undefined';
      detail.push(`BroadcastChannel 支持：${supportsBroadcast ? '是' : '否'}`);
      detail.push(`localStorage 支持：${supportsStorage ? '是' : '否'}`);
      detail.push(`Web Locks API 支持：${supportsWebLocks ? '是' : '否（将降级）'}`);
      if (!supportsStorage) {
        setCrossTabCheck({ status: 'failed', message: '当前浏览器禁用 localStorage，跨标签页协调不可用。', detail });
        return;
      }
      const probeKey = 'smart-line-crosstab-probe';
      const leaseKey = 'smart-line-crosstab-lease';
      let storedLease: string | null = null;
      let acquiredLease = false;
      try { storedLease = localStorage.getItem(leaseKey); } catch { storedLease = null; }
      detail.push(`本机原租约：${storedLease ? storedLease : '空闲'}`);
      try {
        if (supportsWebLocks) {
          await navigator.locks.request(`smartline-crosstab-lease-${probeKey}`, { mode: 'exclusive' }, async () => {
            acquiredLease = true;
            try { localStorage.setItem(leaseKey, `probe-${Date.now()}`); } catch { /* storage guarded */ }
            await new Promise<void>((resolve) => window.setTimeout(resolve, 600));
            try { localStorage.removeItem(leaseKey); } catch { /* storage guarded */ }
          });
          if (acquiredLease) {
            setCrossTabCheck({
              status: 'success',
              message: '本地租约机制工作正常，跨标签页同步已具备最佳路径。',
              detail,
            });
            return;
          }
        }
        const fallbackChannel = 'smartline-crosstab-fallback';
        const fallbackProbe = `probe-${Date.now()}`;
        if (supportsBroadcast) {
          const channel = new BroadcastChannel(fallbackChannel);
          await new Promise<void>((resolve) => {
            channel.onmessage = (event) => {
              if (event.data === fallbackProbe) {
                channel.postMessage('ack');
                resolve();
              }
            };
            channel.postMessage(fallbackProbe);
            window.setTimeout(() => resolve(), 600);
          });
          channel.close();
          setCrossTabCheck({
            status: 'fallback',
            message: '未启用 Web Locks，已降级到 BroadcastChannel + localStorage 机制。打开第二个标签页可观察同步协调。',
            detail,
          });
          return;
        }
        setCrossTabCheck({
          status: 'fallback',
          message: '当前浏览器缺少 Web Locks 与 BroadcastChannel，跨标签页同步将仅依赖 localStorage 事件。',
          detail,
        });
      } catch (error) {
        setCrossTabCheck({
          status: 'failed',
          message: error instanceof Error ? `租约检测失败：${error.message}` : '租约检测失败。',
          detail,
        });
      }
    } catch (error) {
      setCrossTabCheck({
        status: 'failed',
        message: error instanceof Error ? `检测失败：${error.message}` : '检测失败。',
        detail,
      });
    }
  }, [supportsWebLocks]);

  useEffect(() => {
    if (healthReport || healthReportBusy) return;
    setHealthReportBusy(true);
    createCurrentWorkspaceAuditReport()
      .then(setHealthReport)
      .catch((error) => setRestoreMessage(error instanceof Error ? error.message : '数据盘点报告生成失败。'))
      .finally(() => setHealthReportBusy(false));
  }, [healthReport, healthReportBusy]);

  useEffect(() => {
    if (!dataPanelOpen) return;
    listLocalSnapshots().then(setSnapshots).catch(() => setSnapshots([]));
    getSnapshotStorageStats().then(setSnapshotStats).catch(() => setSnapshotStats(null));
  }, [dataPanelOpen]);

  useEffect(() => {
    if (!auth.enabled || !dataPanelOpen) return;
    fetch('/api/storage/status', {
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(8_000),
    })
      .then(async (response) => response.ok ? await response.json() as { r2Configured?: boolean } : null)
      .then((result) => setR2Configured(Boolean(result?.r2Configured)))
      .catch(() => setR2Configured(false));
  }, [auth.enabled, dataPanelOpen]);

  useEffect(() => {
    const refresh = () => {
      readPendingWorkspaceSync().then((pending) => setPendingFieldCount(Object.keys(pending?.fields ?? {}).length)).catch(() => setPendingFieldCount(null));
      listWorkspaceConflicts().then((items) => {
        setSyncConflicts(items);
        setSelectedConflictFields((current) => {
          const available = Object.keys(items[0]?.pending.fields ?? {}) as WorkspaceStorageField[];
          return current.filter((field) => available.includes(field));
        });
      }).catch(() => setSyncConflicts([]));
    };
    refresh();
    const timer = window.setInterval(refresh, 15_000);
    window.addEventListener(WORKSPACE_QUEUE_EVENT, refresh);
    window.addEventListener(WORKSPACE_CONFLICT_EVENT, refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(WORKSPACE_QUEUE_EVENT, refresh);
      window.removeEventListener(WORKSPACE_CONFLICT_EVENT, refresh);
    };
  }, []);

  useEffect(() => {
    const refreshRuntime = (event?: Event) => {
      const next = (event as CustomEvent<WorkspaceSyncRuntimeState | undefined> | undefined)?.detail
        ?? readWorkspaceSyncRuntimeState();
      setRuntimeState(next);
      setConnectionBusy(['connecting', 'initializing', 'migrating', 'flushing', 'verifying'].includes(next.phase));
      if (next.message) setRestoreMessage(next.message);
      if (!['connecting', 'initializing', 'migrating', 'flushing', 'verifying'].includes(next.phase)) {
        const pendingConflict = readPendingWorkspaceActivationConflict();
        setActivationConflict(pendingConflict);
        if (pendingConflict) setRoomCode((current) => current || pendingConflict.roomCode);
      }
    };
    refreshRuntime();
    window.addEventListener(WORKSPACE_SYNC_RUNTIME_EVENT, refreshRuntime);
    return () => window.removeEventListener(WORKSPACE_SYNC_RUNTIME_EVENT, refreshRuntime);
  }, []);

  useEffect(() => {
    const refresh = () => {
      const next = readLastConnected();
      setLastConnected((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
      setArchitecture(readWorkspaceSyncSettings());
    };
    refresh();
    const handleStorage = (event: StorageEvent) => {
      if (event.key === LAST_CONNECTED_KEY) refresh();
    };
    window.addEventListener(WORKSPACE_VERIFIED_EVENT, refresh);
    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener(WORKSPACE_VERIFIED_EVENT, refresh);
      window.removeEventListener('storage', handleStorage);
    };
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
  const activeConflicts = syncConflicts.filter((conflict) => conflict.status !== 'resolved');
  const historicalConflicts = syncConflicts.filter((conflict) => conflict.status === 'resolved');
  const latestConflict = historicalConflicts[0];
  const activeConflictCount = activeConflicts.length;
  const requiresUnifiedMigration = liveblocksAuthMode === 'authenticated' && architecture.architecture !== 'unified';
  const runtimeBusy = ['connecting', 'initializing', 'migrating', 'flushing', 'verifying'].includes(runtimeState.phase);
  const runtimeProblem = runtimeState.phase === 'error' || runtimeState.phase === 'conflict';
  const fullySynchronized = allConnected
    && pendingFieldCount === 0
    && activeConflictCount === 0
    && !requiresUnifiedMigration
    && !runtimeBusy
    && !runtimeProblem;

  const connectModule = useCallback((key: ModuleKey, code: string) => {
    if (!code) return;
    if (architecture.architecture === 'unified') {
      void reconnectConfiguredWorkspace(auth.userId || auth.login, auth.login).catch((error) => {
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
  }, [timeline, ebb, daily, graph, lifeMap, architecture, auth.login, auth.userId]);

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
    clearPendingWorkspaceActivationConflict();
    setActivationConflict(null);
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
          setRestoreMessage(result.warning ?? (result.source === 'cloud'
            ? '本机没有规划内容，已安全连接并完成云端数据加载。'
            : result.source === 'matching'
              ? '本机与云端数据一致，连接及云端确认均已完成。'
              : '云端为空，已安全连接并完成本机工作区上传。'));
        } else {
          const result = await reconnectConfiguredWorkspace(auth.userId || auth.login, auth.login);
          setRestoreMessage(result?.warning ?? (result && result.repairedFields.length > 0
            ? `连接及云端确认已完成，并从云端修复了 ${result.repairedFields.length} 个不一致数据字段。`
            : result && result.applied > 0
              ? `连接及云端确认已完成，已补传 ${result.applied} 个数据字段。`
              : '连接、队列清空及云端内容一致性校验均已完成。'));
        }
        return;
      }

      if (enabledCount === 0 && liveblocksAuthMode === 'authenticated') {
        setRestoreMessage('正在检查本机与云端数据，连接前会先创建本地快照…');
      const result = await activateWorkspaceWithLegacyDiscovery(
        fallbackCode,
        auth.userId || auth.login || 'owner',
        auth.login || undefined,
      );
        setArchitecture(readWorkspaceSyncSettings());
        setRestoreMessage(result.warning ?? (result.source === 'cloud'
          ? '本机没有规划内容，已安全连接并完成云端数据加载。'
          : result.source === 'matching'
            ? '本机与云端数据一致，连接及云端确认均已完成。'
            : '云端为空，已安全连接并完成本机工作区上传。'));
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
      if (error instanceof UnifiedWorkspaceConflictError) {
        setActivationConflict({ roomCode: fallbackCode, remoteSource: error.remoteSource });
      }
      setRestoreMessage(error instanceof Error ? error.message : '统一工作区连接或补传失败。');
    } finally {
      setConnectionBusy(false);
    }
  }, [roomCode, timeline.syncRoomCode, timeline.syncEnabled, ebb.syncRoomCode, ebb.syncEnabled, daily.syncRoomCode, daily.syncEnabled, graph.syncRoomCode, graph.syncEnabled, lifeMap.syncRoomCode, lifeMap.syncEnabled, connectModule, architecture, enabledCount, auth.login, auth.userId]);

  const handleResolveActivationConflict = useCallback(async (resolution: 'cloud' | 'local') => {
    if (!activationConflict || !isCurrentTabSyncLeader()) return;
    const keepCloud = resolution === 'cloud';
    const confirmed = await requestConfirmation(keepCloud
      ? '确定以云端工作区为准吗？当前设备的数据会先保存为本地快照，然后替换为云端数据。'
      : '确定以当前设备为准并覆盖云端吗？当前云端数据和本机数据都会先保存为本地快照。');
    if (!confirmed) return;
    setConnectionBusy(true);
    setRestoreMessage(keepCloud ? '正在保存双方恢复点并加载云端数据…' : '正在保存双方恢复点并上传本机数据…');
    try {
      const result = await resolveUnifiedWorkspaceConflict(
        activationConflict.roomCode,
        auth.userId || auth.login || 'owner',
        resolution,
        auth.login || undefined,
        activationConflict.remoteSource,
      );
      setArchitecture(readWorkspaceSyncSettings());
      setActivationConflict(null);
      setRestoreMessage(result.warning ?? (
        `${keepCloud ? '云端' : '本机'}数据已设为当前版本；五个数据域已连接、补传并校验完成`
          + `${result.repairedFields.length > 0 ? `，另修复 ${result.repairedFields.length} 个旧格式字段` : ''}。`
      ));
    } catch (error) {
      if (error instanceof UnifiedWorkspaceConflictError) {
        setActivationConflict({
          roomCode: activationConflict.roomCode,
          remoteSource: error.remoteSource,
        });
      }
      setRestoreMessage(error instanceof Error ? error.message : '处理本机与云端数据差异失败。');
    } finally {
      setConnectionBusy(false);
    }
  }, [activationConflict, auth.login, auth.userId]);

  const handleDisconnectAll = useCallback(() => {
    disconnectWorkspace(false);
    setRestoreMessage('已暂时断开云端连接；工作区绑定仍保留，可随时重新连接，刷新后也会自动恢复。');
  }, []);

  const handleChangeWorkspace = useCallback(async () => {
    if (!await requestConfirmation('确定在这台设备上忘记当前工作区并更换房间号吗？本机数据不会删除，账号云端绑定也不会删除；输入新房间号后会重新建立绑定。')) return;
    disconnectWorkspace(true);
    setArchitecture(readWorkspaceSyncSettings());
    setActivationConflict(null);
    setRoomCode('');
    setRestoreMessage('已在本机停用当前工作区自动发现。现在可以输入新的房间号；本机数据和原云端房间均未删除。');
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
      try { localStorage.setItem(LAST_MANUAL_EXPORT_KEY, new Date().toISOString()); } catch { /* storage guarded */ }
      setRestoreMessage(`完整工作区备份已导出（${describeLastManualExport()}）。`);
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

  const handleShowOrphans = useCallback(() => {
    if (!healthReport) return;
    const orphans = healthReport.findings.filter((finding) => finding.code === 'missing-reference');
    if (orphans.length === 0) {
      setRestoreMessage('未发现孤儿引用：所有跨模块绑定都指向实际存在的实体。');
      return;
    }
    const summary = orphans
      .slice(0, 3)
      .map((finding) => `[${finding.collection ?? '?'}] ${finding.message}`)
      .join('；');
    setRestoreMessage(orphans.length === 1
      ? `发现 1 条孤儿引用：${summary}`
      : `发现 ${orphans.length} 条孤儿引用：${summary}${orphans.length > 3 ? '…' : ''}\n请导出盘点报告查看完整明细。`);
  }, [healthReport]);

  const handleAuditExport = useCallback(async () => {
    setAuditBusy(true);
    try {
      const report = await downloadCurrentWorkspaceAuditReport();
      const status = report.integrity.status === 'passed'
        ? '通过'
        : report.integrity.status === 'warning'
          ? '需要复核'
          : '阻止迁移';
      setRestoreMessage(`数据盘点报告已导出：${status}；${report.integrity.blockerCount} 个阻断项、${report.integrity.warningCount} 个警告。`);
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '数据盘点报告导出失败。');
    } finally {
      setAuditBusy(false);
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
      if (error instanceof UnifiedWorkspaceConflictError) {
        setActivationConflict({ roomCode: activeCode, remoteSource: error.remoteSource });
      }
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

  const handleDownloadWorkspaceHistory = useCallback(async () => {
    try {
      const history = await loadWorkspaceDailyHistory(historyDate);
      const blob = new Blob([JSON.stringify(history.backup, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url; anchor.download = `smart-line-workspace-history-${historyDate}.json`; anchor.click();
      URL.revokeObjectURL(url);
      setRestoreMessage(`${historyDate} 完整工作区历史已下载。`);
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '工作区历史读取失败。');
    }
  }, [historyDate]);

  const handleRestoreWorkspaceHistory = useCallback(async () => {
    try {
      const history = await loadWorkspaceDailyHistory(historyDate);
      const validation = validateWorkspaceBackup(history.backup);
      if (validation.errors.length > 0) throw new Error(validation.errors.join('；'));
      if (!await requestConfirmation(`确定恢复 ${historyDate} 的完整工作区吗？当前内容会先自动保存本地恢复点。`)) return;
      await restoreWorkspaceBackup(history.backup);
      setRestoreMessage(`${historyDate} 工作区历史已恢复，本机修改正在进入安全补传队列。`);
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '工作区历史恢复失败。');
    }
  }, [historyDate]);

  return (
    <div className="tl-dialog-overlay" onClick={onClose}>
      <div className="tl-dialog tl-dialog--wide" role="dialog" aria-modal="true" aria-label="云同步与完整备份" onClick={(event) => event.stopPropagation()}>
        <h3 className="tl-dialog-title"><Cloud size={18} />云同步与完整备份</h3>

        {/* 数据健康卡：单行 chip + 展开明细 */}
        <WorkspaceHealthPanel report={healthReport} onShowOrphans={handleShowOrphans} />

        {/* 同步状态卡：圆点 + 主标语 + 主操作 + 待办 + 折叠的 hint */}
        <div className="tl-sync-status" style={{ flexDirection: 'column', alignItems: 'stretch', padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="tl-sync-dot" style={{ backgroundColor: fullySynchronized ? '#059669' : enabledCount > 0 ? '#D97706' : '#9CA3AF' }} />
            <strong style={{ fontSize: 14, color: '#111827' }}>{runtimeBusy
              ? runtimeState.message
              : runtimeProblem && activeConflictCount === 0
                ? runtimeState.message || '同步运行异常，请重新连接'
              : fullySynchronized
              ? (architecture.architecture === 'unified' ? '统一工作区已同步' : '旧房间同步 5/5')
              : allConnected && requiresUnifiedMigration
                ? '旧架构已连接，尚未进入统一工作区'
              : allConnected && activeConflictCount > 0
                ? `同步暂停，正在自动归档 ${activeConflictCount} 个旧冲突`
                : allConnected && pendingFieldCount !== null && pendingFieldCount > 0
                  ? `已连接，等待补传 ${pendingFieldCount} 个字段`
                  : enabledCount > 0 ? `部分同步 ${connectedCount}/5` : '尚未连接'}</strong>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {enabledCount > 0 && (
                <button type="button" className="tl-sync-backup-btn" onClick={handleConnectAll} disabled={connectionBusy}>
                  <RefreshCw size={14} />{connectionBusy ? '连接中…' : '全部重新连接'}
                </button>
              )}
              {enabledCount === 0 && (
                <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--import" onClick={() => connectModule('timeline', roomCode)}>
                  <Link size={14} />立即连接
                </button>
              )}
              {enabledCount > 0 && (
                <button type="button" className="tl-sync-backup-btn" onClick={() => void handleChangeWorkspace()} disabled={connectionBusy}>
                  <ArrowRightLeft size={14} />更换工作区
                </button>
              )}
            </div>
          </div>
          {(activeConflictCount > 0 || (pendingFieldCount ?? 0) > 0 || historicalConflicts.length > 0) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 8, fontSize: 12, color: '#374151' }}>
              {activeConflictCount > 0 && <span style={{ color: '#991B1B', fontWeight: 600 }}>● 旧冲突归档待重试 {activeConflictCount}</span>}
              {(pendingFieldCount ?? 0) > 0 && <span style={{ color: '#92400E' }}>● 待补传 {pendingFieldCount}</span>}
              {historicalConflicts.length > 0 && <span style={{ color: '#6B7280' }}>● 历史副本 {historicalConflicts.length}</span>}
            </div>
          )}
          <details style={{ marginTop: 6, fontSize: 12, color: '#6B7280' }}>
            <summary style={{ cursor: 'pointer', color: '#4B5563', listStyle: 'none' }}>详细信息</summary>
            <div style={{ paddingTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span>认证：{liveblocksAuthMode === 'authenticated' ? `用户身份认证${auth.login ? ` · GitHub：${auth.login}` : ''}` : '公钥兼容模式'}</span>
              <span>本机最近完成云端内容校验：{formatTime(lastConnected.workspace)}{requiresUnifiedMigration ? ' · 仅连接旧模块房间，请在高级设置中迁移后再比较多端。' : ''}</span>
              <span>本机本地备份：{describeLastManualExport()}</span>
            </div>
          </details>
        </div>

        {/* 本地备份过期提醒 banner：浅黄小条，只在 N>=7 天时显示 */}
        {(() => {
          const value = readLastManualExport();
          if (!value) return null;
          const days = Math.floor((Date.now() - new Date(value).getTime()) / 86_400_000);
          if (days < 7) return null;
          return (
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 14px',
              margin: '0 20px 12px',
              backgroundColor: '#FEF3C7',
              border: '1px solid #FCD34D',
              borderRadius: 6,
              fontSize: 12,
              color: '#92400E',
            }}>
              <FileSearch size={14} />
              <span>已 {days} 天未导出本地备份。浏览器数据被清后无法恢复，建议在下方『数据、备份与恢复』中导出一次。</span>
            </div>
          );
        })()}

        {!supportsWebLocks && enabledCount > 0 && (
          <div style={{
            padding: '8px 12px',
            margin: '0 20px 12px',
            backgroundColor: '#FEF3C7',
            border: '1px solid #F59E0B',
            borderRadius: 6,
            fontSize: 12,
            lineHeight: 1.5,
          }}>
            <strong style={{ color: '#92400E' }}>⚠️ 当前浏览器不支持 Web Locks API</strong>
            <p style={{ margin: '4px 0 0', color: '#78350F' }}>
              跨标签页同步将使用兼容降级模式。建议升级到 Chrome 69+、Edge 79+、Safari 15.4+ 或 Firefox 96+。
            </p>
            <button
              type="button"
              className="tl-sync-backup-btn"
              style={{ marginTop: 6 }}
              onClick={() => void runCrossTabDetection()}
              disabled={crossTabCheck.status === 'running'}
            >
              {crossTabCheck.status === 'running' ? '正在检测…' : '检测跨标签页支持'}
            </button>
            {crossTabCheck.status !== 'idle' && (
              <div style={{
                marginTop: 6,
                padding: '6px 8px',
                borderRadius: 4,
                backgroundColor: crossTabCheck.status === 'success'
                  ? '#D1FAE5'
                  : crossTabCheck.status === 'fallback'
                    ? '#FEF3C7'
                    : '#FEE2E2',
                color: crossTabCheck.status === 'success'
                  ? '#065F46'
                  : crossTabCheck.status === 'fallback'
                    ? '#92400E'
                    : '#991B1B',
                fontSize: 12,
                lineHeight: 1.5,
              }}>
                {crossTabCheck.message}
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {crossTabCheck.detail.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
        {supportsWebLocks && enabledCount > 0 && (
          <div style={{ margin: '0 20px 12px' }}>
            <button
              type="button"
              className="tl-sync-backup-btn"
              onClick={() => void runCrossTabDetection()}
              disabled={crossTabCheck.status === 'running'}
            >
              {crossTabCheck.status === 'running' ? '正在检测…' : '检测跨标签页支持'}
            </button>
            {crossTabCheck.status !== 'idle' && (
              <div style={{
                marginTop: 6,
                padding: '6px 8px',
                borderRadius: 4,
                backgroundColor: crossTabCheck.status === 'success' ? '#D1FAE5' : '#FEF3C7',
                color: crossTabCheck.status === 'success' ? '#065F46' : '#92400E',
                fontSize: 12,
                lineHeight: 1.5,
              }}>
                {crossTabCheck.message}
                <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                  {crossTabCheck.detail.map((line) => <li key={line}>{line}</li>)}
                </ul>
              </div>
            )}
          </div>
        )}
        {requiresUnifiedMigration && enabledCount > 0 && (
          <section className="tl-sync-conflict-fields" aria-label="旧同步架构迁移">
            <strong>当前平板/电脑可能仍在旧的五个房间中，必须迁移到统一工作区后才能可靠比较多端数据。</strong>
            <small>迁移会先创建本地快照，再复制并校验数量和 SHA-256；旧房间不会删除。</small>
            <div className="tl-sync-backup-actions">
              <button type="button" className="tl-sync-backup-btn" onClick={handleInspectLegacy} disabled={migrationBusy}><Check size={14} />{migrationBusy && !migrationCheck ? '检查中…' : '检查旧数据'}</button>
              <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--import" onClick={handleMigrate} disabled={migrationBusy || !migrationCheck}><ArrowRightLeft size={14} />{migrationBusy && migrationCheck ? '迁移中…' : '迁移到统一工作区'}</button>
            </div>
            {migrationStatus && <small role="status" aria-live="polite">{migrationStatus}</small>}
          </section>
        )}
        {activationConflict && (
          <section className="tl-sync-conflict-fields" aria-label="首次连接数据冲突处理">
            <strong>当前设备与{activationConflict.remoteSource === 'legacy' ? '旧房间云端' : '统一云端工作区'}都有不同数据，请明确选择一个当前版本。</strong>
            <small>两边都会先保存到本机快照中；选择完成后才会覆盖并重新校验，不会再停在无法连接的状态。</small>
            <div className="tl-sync-backup-actions">
              <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--import" onClick={() => void handleResolveActivationConflict('cloud')} disabled={connectionBusy}><Download size={14} />以云端为准</button>
              <button type="button" className="tl-sync-backup-btn" onClick={() => void handleResolveActivationConflict('local')} disabled={connectionBusy}><Upload size={14} />以本机为准</button>
            </div>
          </section>
        )}
        {restoreMessage && <p className="tl-sync-backup-hint" role="status" aria-live="polite">{restoreMessage}</p>}
        {latestConflict && <section className="tl-sync-conflict-fields" aria-label="历史恢复副本">
          <strong>历史恢复副本 · {formatTime(latestConflict.detectedAt)}</strong>
          <small>此冲突已于 {formatTime(latestConflict.resolvedAt)} 自动归档，不代表当前仍有同步故障。恢复会生成新的明确用户写入，并先保存当前完整快照。</small>
          {!showConflictRecovery && <div className="tl-sync-backup-actions">
            <button type="button" className="tl-sync-backup-btn" onClick={() => setShowConflictRecovery(true)}><RefreshCw size={14} />需要从旧副本找回数据</button>
          </div>}
          {showConflictRecovery && <>
            <small>以下"副本"是冲突发生时保存的旧数据，不是当前本机数据。默认不选择。恢复前系统会自动保存当前完整快照。</small>
            {(Object.keys(latestConflict.pending.fields) as WorkspaceStorageField[]).map((field) => {
              const isConflictField = latestConflict.conflictingFields?.includes(field);
              const detailedSummary = summarizeAllConflicts(
                {
                  pending: { fields: { [field]: latestConflict.pending.fields[field] } },
                  remoteFields: { [field]: latestConflict.remoteFields?.[field] },
                },
                latestConflict.pending.baseFields ? { fields: { [field]: latestConflict.pending.baseFields[field] } } : null,
                WORKSPACE_FIELD_LABELS,
              ).find((item) => item.field === field);
              return (
                <div key={field} style={{ marginTop: 6, padding: 8, border: isConflictField ? '1px solid #FCA5A5' : '1px solid #E5E7EB', borderRadius: 6, backgroundColor: '#FFFFFF' }}>
                  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <input
                      type="checkbox"
                      checked={selectedConflictFields.includes(field)}
                      onChange={(event) => setSelectedConflictFields((current) => event.target.checked ? [...new Set([...current, field])] : current.filter((item) => item !== field))}
                    />
                    <span style={{ flex: 1 }}>
                      <b style={{ fontSize: 13 }}>{WORKSPACE_FIELD_LABELS[field] ?? field}{isConflictField ? ' · 同字段冲突' : ''}</b>
                      <small style={{ display: 'block', color: '#6B7280', marginTop: 2 }}>
                        旧副本 {summarizeConflictValue(latestConflict.pending.fields[field])} · 冲突时云端 {summarizeConflictValue(latestConflict.remoteFields?.[field])}
                      </small>
                    </span>
                  </label>
                  {detailedSummary && <ConflictFieldDetail summary={detailedSummary} />}
                </div>
              );
            })}
            <div className="tl-sync-backup-actions">
              <button type="button" className="tl-sync-backup-btn" onClick={() => { setShowConflictRecovery(false); setSelectedConflictFields([]); }}>取消找回</button>
              <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--import" disabled={selectedConflictFields.length === 0} onClick={async () => {
                if (!await requestConfirmation(`确定从旧副本恢复已选择的 ${selectedConflictFields.length} 个数据字段吗？\n\n恢复前会自动保存当前完整快照到浏览器，可在『数据、备份与恢复 → 本地快照』中找回。恢复后旧副本中选中的字段会写入本机和云端。`)) return;
                void restoreWorkspaceConflictFields(latestConflict.id, selectedConflictFields)
                  .then(() => { setRestoreMessage('已保存恢复前快照；所选旧字段已进入强制补传队列，云端确认后会自动清除。'); setSelectedConflictFields([]); setShowConflictRecovery(false); })
                  .catch((error) => setRestoreMessage(error instanceof Error ? error.message : '冲突恢复失败。'));
              }}><RefreshCw size={14} />恢复所选旧字段</button>
            </div>
          </>}
        </section>}
        {auth.enabled && auth.login && (
          <button type="button" className="tl-sync-backup-btn" onClick={() => void handleLogout()} style={{ marginBottom: 12 }}>
            <LogOut size={14} />退出当前账号
          </button>
        )}

        {/* 房间号卡 */}
        <div className="tl-sync-info" style={{ marginTop: 12 }}>
          <div className="tl-sync-info-row" style={{ flexDirection: 'column', alignItems: 'stretch', padding: '12px 14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <label htmlFor="workspace-room-code" style={{ fontSize: 12, color: '#6B7280', fontWeight: 500 }}>房间号</label>
              <input
                id="workspace-room-code"
                className="tl-dialog-input"
                style={{ flex: 1 }}
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
            <small style={{ color: '#6B7280', fontSize: 11, marginTop: 6 }}>
              {architecture.architecture === 'unified' ? `统一工作区：${architecture.unifiedRoomId}` : '当前仍使用旧模块房间；完成检查后可复制迁移到统一工作区。'}
            </small>
          </div>
        </div>

        {/* 模块状态网格 */}
        <div className="tl-sync-info" style={{ marginTop: 12 }}>
          <div style={{ padding: '8px 14px', borderBottom: '1px solid #F3F4F6', fontSize: 12, color: '#6B7280', fontWeight: 500 }}>
            数据模块
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 0,
          }}>
            {modules.map((module) => (
              <div
                key={module.key}
                style={{
                  padding: '12px 10px',
                  borderRight: '1px solid #F3F4F6',
                  textAlign: 'center',
                  background: '#FFFFFF',
                }}
              >
                <div style={{ fontSize: 12, color: '#374151', fontWeight: 500, marginBottom: 6 }}>{module.label}</div>
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontSize: 11,
                  fontWeight: 600,
                  backgroundColor: module.status === 'connected' ? '#D1FAE5' : module.status === 'connecting' ? '#FEF3C7' : module.status === 'error' ? '#FEE2E2' : '#F3F4F6',
                  color: module.status === 'connected' ? '#065F46' : module.status === 'connecting' ? '#92400E' : module.status === 'error' ? '#991B1B' : '#6B7280',
                }}>
                  <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'currentColor' }} />
                  {module.status === 'connected' ? '已连接' : module.status === 'connecting' ? '连接中' : module.status === 'error' ? '连接异常' : '未连接'}
                </div>
                {enabledCount > 0 && module.status !== 'connected' && (
                  <button
                    type="button"
                    className="tl-sync-copy-btn"
                    style={{ marginTop: 6, width: 'auto', padding: '0 8px' }}
                    onClick={() => connectModule(module.key, ({
                      timeline: timeline.syncRoomCode,
                      ebb: ebb.syncRoomCode,
                      daily: daily.syncRoomCode,
                      graph: graph.syncRoomCode,
                      lifeMap: lifeMap.syncRoomCode,
                    }[module.key] || activeCode))}
                    title={`重新连接${module.label}`}
                  >
                    <RefreshCw size={11} /> 重连
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {enabledCount > 0 && (
          <details className="tl-settings-disclosure" style={{ marginTop: 12 }}>
            <summary><Database size={15} />同步高级设置</summary>
          <div className="tl-sync-backup-section tl-settings-disclosure-content">
            <h4 className="tl-sync-backup-title"><Database size={15} />同步架构</h4>
            {architecture.architecture === 'legacy' ? <>
              <p className="tl-sync-backup-hint">旧架构迁移操作已显示在连接状态下方，完成迁移后五个数据域将共享一个认证工作区。</p>
              {migrationCheck && <p className="tl-sync-backup-hint">待迁移：{migrationCheck.summary.groups} 个项目组、{migrationCheck.summary.tasks} 个任务、{migrationCheck.summary.lifeMapItems} 项独立人生规划、{migrationCheck.summary.projectDocuments} 份项目文档、{migrationCheck.summary.reviewTasks} 个轮次、{migrationCheck.summary.dailyDays} 天安排、{migrationCheck.summary.retrospectiveDays} 天复盘、{migrationCheck.summary.graphNodes} 个节点。</p>}
            </> : <>
              <p className="tl-sync-backup-hint">五个数据域共享同一底层房间连接，人生地图作为独立数据域同步。旧模块房间保持不变，仅在主动回退时重新连接。</p>
              <button type="button" className="tl-sync-backup-btn" onClick={handleLegacyFallback}><RefreshCw size={14} />暂时返回旧房间</button>
              {migrationReport && <button type="button" className="tl-sync-backup-btn" onClick={() => downloadMigrationReport(migrationReport)} style={{ marginLeft: 8 }}><Download size={14} />下载迁移报告</button>}
            </>}
          </div>
          </details>
        )}

        <div className="tl-sync-divider" />
        <details className="tl-settings-disclosure" onToggle={(event) => setDataPanelOpen(event.currentTarget.open)}>
          <summary><Database size={15} />数据、备份与恢复</summary>
        <div className="tl-sync-backup-section tl-settings-disclosure-content" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* 备份导出 / 恢复 */}
          <div className="tl-sync-info">
            <div style={{ padding: '8px 14px', borderBottom: '1px solid #F3F4F6', fontSize: 12, color: '#6B7280', fontWeight: 500 }}>
              完整工作区备份与恢复
            </div>
            <div style={{ padding: '10px 14px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--import" onClick={() => fileInputRef.current?.click()}>
                <Upload size={14} />恢复完整备份
              </button>
              <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--export" onClick={handleExport}>
                <Download size={14} />导出完整备份
              </button>
            </div>
            <small style={{ display: 'block', padding: '0 14px 10px', fontSize: 11, color: '#6B7280' }}>
              包含时间轴、项目文档、EBB、每日安排、知识大盘和应用设置。恢复前会校验数据并自动创建本地快照。
            </small>
          </div>

          {/* 健康 / 盘点 */}
          <div className="tl-sync-info">
            <div style={{ padding: '8px 14px', borderBottom: '1px solid #F3F4F6', fontSize: 12, color: '#6B7280', fontWeight: 500 }}>
              数据健康与盘点
            </div>
            <div style={{ padding: '10px 14px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button type="button" className="tl-sync-backup-btn" onClick={handleHealthCheck}>
                <Check size={14} />数据健康检查
              </button>
              <button type="button" className="tl-sync-backup-btn" onClick={() => void handleAuditExport()} disabled={auditBusy}>
                <FileSearch size={14} />{auditBusy ? '正在盘点…' : '导出盘点报告'}
              </button>
            </div>
            {restoreSummary && (
              <small style={{ display: 'block', padding: '0 14px 10px', fontSize: 11, color: '#374151' }}>
                最近检查：{restoreSummary.tasks} 个项目任务、{restoreSummary.lifeMapItems} 项人生规划、{restoreSummary.reviewTasks} 个轮次、{restoreSummary.retrospectiveEntries} 条复盘、{restoreSummary.graphNodes} 个节点。
              </small>
            )}
          </div>

          {/* 月度归档 (R2) */}
          {auth.enabled && (
            <div className="tl-sync-info">
              <div style={{ padding: '8px 14px', borderBottom: '1px solid #F3F4F6', fontSize: 12, color: '#6B7280', fontWeight: 500, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>R2 月度归档</span>
                <span style={{
                  fontSize: 10,
                  padding: '1px 6px',
                  borderRadius: 3,
                  backgroundColor: r2Configured ? '#D1FAE5' : '#F3F4F6',
                  color: r2Configured ? '#065F46' : '#6B7280',
                  fontWeight: 600,
                }}>
                  {r2Configured === null ? '检测中' : r2Configured ? '已启用' : '未绑定'}
                </span>
              </div>
              {r2Configured && (
                <>
                  <div style={{ padding: '10px 14px 4px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input className="tl-dialog-input" type="date" value={historyDate} onChange={(event) => setHistoryDate(event.target.value)} style={{ maxWidth: 150 }} />
                    <button type="button" className="tl-sync-backup-btn" onClick={() => void handleDownloadWorkspaceHistory()}><Download size={14} />下载完整历史</button>
                    <button type="button" className="tl-sync-backup-btn" onClick={() => void handleRestoreWorkspaceHistory()}><RefreshCw size={14} />恢复该日历史</button>
                  </div>
                  <div style={{ padding: '4px 14px 10px', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input className="tl-dialog-input" type="month" value={archivePeriod} onChange={(event) => setArchivePeriod(event.target.value)} style={{ maxWidth: 150 }} />
                    <button type="button" className="tl-sync-backup-btn" onClick={() => void handleArchivePeriod()}><Upload size={14} />保存月度归档</button>
                    <button type="button" className="tl-sync-backup-btn" onClick={() => void handleDownloadArchive()}><Download size={14} />下载月度归档</button>
                  </div>
                </>
              )}
              <small style={{ display: 'block', padding: '0 14px 10px', fontSize: 11, color: '#6B7280' }}>
                {r2Configured ? '同步校验成功后每天自动保存一份完整恢复点；月度归档仍可手动保存。' : '绑定 SMARTLINE_R2 后可使用每日完整历史和月度归档。'}
              </small>
            </div>
          )}

          {/* 本地快照 */}
          {(snapshotStats || snapshots.length > 0) && (
            <div className="tl-sync-info">
              <div style={{ padding: '8px 14px', borderBottom: '1px solid #F3F4F6', fontSize: 12, color: '#6B7280', fontWeight: 500 }}>
                本地快照
              </div>
              {snapshotStats && (
                <small style={{ display: 'block', padding: '10px 14px 6px', fontSize: 11, color: '#374151' }}>
                  共 {snapshotStats.snapshotCount} 份、{snapshotStats.chunkCount} 个去重数据块、约 {(snapshotStats.snapshotBytes / 1024).toFixed(1)} KB。
                </small>
              )}
              {snapshots.length > 0 && (
                <div>
                  {snapshots.slice(0, 5).map((snapshot) => (
                    <div className="tl-sync-info-row" key={snapshot.id} style={{ borderTop: '1px solid #F3F4F6' }}>
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
          )}
        </div>
        </details>

        <div className="tl-dialog-actions">
          <button type="button" className="tl-dialog-btn tl-dialog-btn--cancel" onClick={onClose}>{connectionBusy ? '隐藏（连接继续）' : '关闭'}</button>
          {enabledCount === 0 ? (
            <button type="button" className="tl-dialog-btn tl-dialog-btn--primary" onClick={handleConnectAll} disabled={!roomCode.trim() || connectionBusy}><Link size={14} />{connectionBusy ? '正在连接并确认云端…' : '一键连接五个模块'}</button>
          ) : (
            <button type="button" className="tl-dialog-btn tl-dialog-btn--danger" onClick={handleDisconnectAll} disabled={connectionBusy}><Unlink size={14} />暂时断开</button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={handleFileChange} />
      </div>
    </div>
  );
};

export default SyncDialog;

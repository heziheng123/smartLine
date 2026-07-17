import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Cloud, Copy, Download, Eye, EyeOff, Link, RefreshCw, Unlink, Upload } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useEbbStore, EBB_ROOM_PREFIX } from '@/ebb/store';
import { useDailyScheduleStore, DAILY_ROOM_PREFIX } from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';
import {
  downloadWorkspaceBackup,
  createWorkspaceBackup,
  listLocalSnapshots,
  restoreWorkspaceBackup,
  validateWorkspaceBackup,
  type WorkspaceBackupSummary,
  type WorkspaceSnapshot,
} from '@/services/workspaceBackup';

interface SyncDialogProps { onClose: () => void }
type ModuleKey = 'timeline' | 'ebb' | 'daily' | 'graph';
type DisplayStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

const LAST_CONNECTED_KEY = 'smart-line-sync-last-connected';

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

const SyncDialog: React.FC<SyncDialogProps> = ({ onClose }) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timeline = useTimelineStore();
  const ebb = useEbbStore();
  const daily = useDailyScheduleStore();
  const graph = useGraphStore();
  const [roomCode, setRoomCode] = useState(timeline.syncRoomCode || '');
  const [showRoomCode, setShowRoomCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const [lastConnected, setLastConnected] = useState(readLastConnected);
  const [restoreSummary, setRestoreSummary] = useState<WorkspaceBackupSummary | null>(null);
  const [restoreMessage, setRestoreMessage] = useState('');
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>([]);

  useEffect(() => {
    listLocalSnapshots().then(setSnapshots).catch(() => setSnapshots([]));
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
  ], [timeline.syncEnabled, timeline.syncStatus, ebb.syncEnabled, ebb.syncStatus, daily.syncEnabled, daily.syncStatus, graph.syncEnabled, graph.syncStatus]);

  const connectModule = useCallback((key: ModuleKey, code: string) => {
    if (!code) return;
    if (key === 'timeline') {
      timeline.enableSync(code);
      timeline.liveblocks?.enterRoom?.(code);
    } else if (key === 'ebb') {
      ebb.enableSync(code);
      ebb.liveblocks?.enterRoom?.(`${EBB_ROOM_PREFIX}${code}`);
    } else if (key === 'daily') {
      daily.enableSync(code);
      daily.liveblocks?.enterRoom?.(`${DAILY_ROOM_PREFIX}${code}`);
    } else {
      graph.enableSync(code);
      graph.liveblocks?.enterRoom?.(`graph-${code}`);
    }
  }, [timeline, ebb, daily, graph]);

  const handleConnectAll = useCallback(() => {
    const code = roomCode.trim()
      || timeline.syncRoomCode
      || ebb.syncRoomCode
      || daily.syncRoomCode
      || graph.syncRoomCode;
    if (!code) return;
    (['timeline', 'ebb', 'daily', 'graph'] as ModuleKey[]).forEach((key) => connectModule(key, code));
  }, [roomCode, timeline.syncRoomCode, ebb.syncRoomCode, daily.syncRoomCode, graph.syncRoomCode, connectModule]);

  const handleDisconnectAll = useCallback(() => {
    timeline.liveblocks?.leaveRoom?.(); timeline.disableSync();
    ebb.liveblocks?.leaveRoom?.(); ebb.disableSync();
    daily.liveblocks?.leaveRoom?.(); daily.disableSync();
    graph.liveblocks?.leaveRoom?.(); graph.disableSync();
  }, [timeline, ebb, daily, graph]);

  const activeCode = timeline.syncRoomCode || ebb.syncRoomCode || daily.syncRoomCode || graph.syncRoomCode || roomCode;
  const enabledCount = modules.filter((module) => module.enabled).length;
  const connectedCount = modules.filter((module) => module.enabled && module.status === 'connected').length;
  const allConnected = enabledCount === 4 && connectedCount === 4;

  const handleCopy = useCallback(async () => {
    if (!activeCode) return;
    await navigator.clipboard.writeText(activeCode);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
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
        const confirmed = window.confirm(
          `即将恢复完整工作区：\n时间轴任务 ${result.summary.tasks}\n项目文档 ${result.summary.projectDocuments}\nEBB 轮次 ${result.summary.reviewTasks}\n每日安排 ${result.summary.dailyDays} 天\n知识节点 ${result.summary.graphNodes}${issueText}\n\n恢复前会自动保存当前工作区快照。当前若已连接云同步，恢复内容也会同步到原房间。是否继续？`,
        );
        if (!confirmed) return;
        await restoreWorkspaceBackup(result.backup);
        setRestoreMessage('完整工作区恢复成功。已自动保存恢复前快照。');
      } catch {
        setRestoreMessage('恢复失败：文件不是有效的 JSON 备份。');
      }
    };
    reader.readAsText(file);
  }, []);

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
    if (!window.confirm(`确定恢复 ${new Date(snapshot.createdAt).toLocaleString('zh-CN')} 的本地快照吗？当前工作区会先自动保存快照。`)) return;
    try {
      await restoreWorkspaceBackup(snapshot.backup);
      setRestoreMessage('本地快照恢复成功。');
    } catch (error) {
      setRestoreMessage(error instanceof Error ? error.message : '本地快照恢复失败。');
    }
  }, []);

  return (
    <div className="tl-dialog-overlay" onClick={onClose}>
      <div className="tl-dialog" role="dialog" aria-modal="true" aria-label="云同步与完整备份" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 520 }}>
        <h3 className="tl-dialog-title"><Cloud size={18} />云同步与完整备份</h3>

        <div className="tl-sync-status">
          <span className="tl-sync-dot" style={{ backgroundColor: allConnected ? '#059669' : enabledCount > 0 ? '#D97706' : '#9CA3AF' }} />
          <strong>{allConnected ? '全部同步 4/4' : enabledCount > 0 ? `部分同步 ${connectedCount}/4` : '尚未连接'}</strong>
        </div>

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
          <span className="tl-dialog-hint">使用你现在的原房间号；后台继续连接原有四个模块房间，不迁移数据。</span>
        </label>

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
                  <button type="button" className="tl-sync-copy-btn" onClick={() => connectModule(module.key, activeCode)} title={`重新连接${module.label}`}>
                    <RefreshCw size={13} />
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>

        {enabledCount > 0 && (
          <button type="button" className="tl-sync-backup-btn" onClick={handleConnectAll} style={{ marginBottom: 12 }}>
            <RefreshCw size={14} />全部重新连接
          </button>
        )}

        <div className="tl-sync-divider" />
        <div className="tl-sync-backup-section">
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
          {restoreSummary && <p className="tl-sync-backup-hint">最近检查：{restoreSummary.tasks} 个任务、{restoreSummary.reviewTasks} 个轮次、{restoreSummary.graphNodes} 个节点。</p>}
          {restoreMessage && <p className="tl-sync-backup-hint" role="status">{restoreMessage}</p>}
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

        <div className="tl-dialog-actions">
          <button type="button" className="tl-dialog-btn tl-dialog-btn--cancel" onClick={onClose}>关闭</button>
          {enabledCount === 0 ? (
            <button type="button" className="tl-dialog-btn tl-dialog-btn--primary" onClick={handleConnectAll} disabled={!roomCode.trim()}><Link size={14} />一键连接四个模块</button>
          ) : (
            <button type="button" className="tl-dialog-btn tl-dialog-btn--danger" onClick={handleDisconnectAll}><Unlink size={14} />断开全部同步</button>
          )}
        </div>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={handleFileChange} />
      </div>
    </div>
  );
};

export default SyncDialog;

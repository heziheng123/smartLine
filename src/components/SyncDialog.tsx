import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Cloud, Download, RefreshCw, Upload } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useEbbStore } from '@/ebb/store';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { useGraphStore } from '@/graph/store';
import { useLifeMapStore } from '@/lifeMap/store';
import { useAuth } from '@/auth/AuthContext';
import { MIND_MAP_ENABLED } from '@/mindMap/config';
import { readMindMapSyncRuntimeState, MIND_MAP_SYNC_RUNTIME_EVENT } from '@/mindMap/syncRuntime';
import {
  downloadWorkspaceBackup, listLocalSnapshots,
  restoreLocalSnapshot, restoreWorkspaceBackup, validateWorkspaceBackup,
  type WorkspaceSnapshot,
} from '@/services/workspaceBackup';
import {
  readWorkspaceSyncSettings, reconnectConfiguredWorkspace, disconnectWorkspace,
  readWorkspaceSyncRuntimeState, WORKSPACE_SYNC_RUNTIME_EVENT,
} from '@/services/workspaceSync';
import { isCurrentTabSyncLeader, readWorkspaceTabLeadershipEpoch } from '@/services/workspaceTabCoordinator';
import { createCurrentWorkspaceAuditReport, downloadCurrentWorkspaceAuditReport } from '@/services/workspaceAudit';
import type { WorkspaceAuditReport } from '@/services/workspaceAuditCore';
import { discardWorkspaceConflict, listWorkspaceConflicts, readPendingWorkspaceSync, restoreWorkspaceConflictFields, type WorkspaceConflictRecord } from '@/services/workspaceOfflineQueue';
import { WORKSPACE_QUEUE_EVENT } from '@/services/workspaceSyncQueueCore';
import { useShallow } from 'zustand/react/shallow';

interface SyncDialogProps { onClose: () => void }

const LAST_MANUAL_EXPORT_KEY = 'smart-line-last-manual-export';
function readLastManualExport(): string | null {
  try {
    const v = localStorage.getItem(LAST_MANUAL_EXPORT_KEY);
    return v && !Number.isNaN(Date.parse(v)) ? v : null;
  } catch { return null; }
}
function describeExport(): string {
  const v = readLastManualExport();
  if (!v) return '还没导出过，建议现在导出一份';
  const d = Math.floor((Date.now() - new Date(v).getTime()) / 86400000);
  if (d <= 0) return '今天已经导出过';
  if (d === 1) return '昨天导出过';
  return `${d} 天前导出过${d >= 7 ? '，建议重新导出' : ''}`;
}

const SyncDialog: React.FC<SyncDialogProps> = ({ onClose }) => {
  const auth = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const timeline = useTimelineStore(useShallow((s) => ({ enabled: s.syncEnabled, status: s.syncStatus })));
  const ebb = useEbbStore(useShallow((s) => ({ enabled: s.syncEnabled, status: s.syncStatus })));
  const daily = useDailyScheduleStore(useShallow((s) => ({ enabled: s.syncEnabled, status: s.syncStatus })));
  const graph = useGraphStore(useShallow((s) => ({ enabled: s.syncEnabled, status: s.syncStatus })));
  const lifeMap = useLifeMapStore(useShallow((s) => ({ enabled: s.syncEnabled, status: s.syncStatus })));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [conflicts, setConflicts] = useState<WorkspaceConflictRecord[]>([]);
  const [showIssues, setShowIssues] = useState(false);
  const [recoveryId, setRecoveryId] = useState<string | null>(null);
  const [recoveryFields, setRecoveryFields] = useState<string[]>([]);
  const [report, setReport] = useState<WorkspaceAuditReport | null>(null);
  const [snapshots, setSnapshots] = useState<WorkspaceSnapshot[]>([]);
  const [arch, setArch] = useState(readWorkspaceSyncSettings);
  const [runtime, setRuntime] = useState(readWorkspaceSyncRuntimeState);
  const [mindMap, setMindMap] = useState(readMindMapSyncRuntimeState);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.getClientRects().length > 0);
    (focusable()[0] ?? dialog).focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
      } else if (event.key === 'Tab') {
        const items = focusable();
        if (items.length === 0) {
          event.preventDefault();
          dialog.focus();
          return;
        }
        const first = items[0];
        const last = items[items.length - 1];
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      opener?.focus();
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    const refreshAudit = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (disposed || document.hidden) return;
        createCurrentWorkspaceAuditReport().then((r) => { if (!disposed) setReport(r); }).catch(() => undefined);
      }, 800);
    };
    refreshAudit();
    listLocalSnapshots().then(setSnapshots).catch(() => setSnapshots([]));
    const refresh = () => {
      readPendingWorkspaceSync().then((p) => setPendingCount(Object.keys(p?.fields ?? {}).length)).catch(() => undefined);
      listWorkspaceConflicts().then(setConflicts).catch(() => undefined);
      setArch(readWorkspaceSyncSettings());
    };
    refresh();
    const t = window.setInterval(() => { if (!document.hidden) refresh(); }, 30000);
    window.addEventListener(WORKSPACE_QUEUE_EVENT, refresh);
    const onRt = () => { setRuntime(readWorkspaceSyncRuntimeState()); };
    const onMm = () => { setMindMap(readMindMapSyncRuntimeState()); };
    window.addEventListener(WORKSPACE_SYNC_RUNTIME_EVENT, onRt);
    window.addEventListener(MIND_MAP_SYNC_RUNTIME_EVENT, onMm);
    return () => { disposed = true; window.clearTimeout(timer); window.clearInterval(t); window.removeEventListener(WORKSPACE_QUEUE_EVENT, refresh); window.removeEventListener(WORKSPACE_SYNC_RUNTIME_EVENT, onRt); window.removeEventListener(MIND_MAP_SYNC_RUNTIME_EVENT, onMm); };
  }, []);

  const totalRecords = report ? Object.values(report.collections).reduce((s, c) => s + c.count, 0) : null;
  const activeConflicts = conflicts.filter((c) => c.status !== 'resolved');
  const historicalConflicts = conflicts.filter((c) => c.status === 'resolved');
  const blockers = report?.integrity.blockerCount ?? 0;
  const warnings = report?.integrity.warningCount ?? 0;
  const needAttention = activeConflicts.length + pendingCount + blockers;
  const enabledCount = [timeline, ebb, daily, graph, lifeMap].filter((m) => m.enabled).length;
  const connectedCount = [timeline, ebb, daily, graph, lifeMap].filter((m) => m.enabled && m.status === 'connected').length;
  const isConnected = enabledCount > 0 && connectedCount === 5 && arch.architecture === 'unified';

  const hero = !isConnected
    ? { icon: '☁️', title: '云同步未开启', desc: `本地 ${totalRecords ?? '—'} 条记录，仅保存在此浏览器中。更换设备或清理浏览器数据将无法恢复。`, primary: '开启云同步', tone: '#92400E', bg: '#FEF3C7' }
    : needAttention > 0
      ? { icon: '⚠️', title: `${needAttention} 项待处理`, desc: `${activeConflicts.length > 0 ? `设备间冲突 ${activeConflicts.length} 处，需确认保留版本。` : ''}${pendingCount > 0 ? `待云端确认 ${pendingCount} 个字段。` : ''}${blockers > 0 ? `数据校验 ${blockers} 个阻断。` : ''}`, primary: '查看处理', tone: '#991B1B', bg: '#FEE2E2' }
      : { icon: '✅', title: '已同步', desc: `本地与云端一致（${totalRecords ?? '—'} 条）。更换设备登录即可恢复。`, primary: '导出备份', tone: '#065F46', bg: '#D1FAE5' };

  const modules = [
    { label: '时间轴', hint: '项目 · 任务 · 便签', ...timeline },
    { label: 'EBB 复习', hint: '轮次 · 收集箱', ...ebb },
    { label: '每日安排', hint: '日程', ...daily },
    { label: '知识库', hint: '节点', ...graph },
    { label: '地图文档', hint: '人生规划', enabled: MIND_MAP_ENABLED && mindMap.status === 'connected', status: mindMap.status === 'connected' ? 'connected' : 'disconnected' },
  ];
  const moduleState = (m: { enabled: boolean; status: unknown }) => !m.enabled ? { t: '本地', c: '#6B7280', bg: '#F3F4F6' } : m.status === 'connected' ? { t: '已同步', c: '#065F46', bg: '#D1FAE5' } : { t: '待同步', c: '#92400E', bg: '#FEF3C7' };

  const handleConnect = useCallback(async () => {
    if (!isCurrentTabSyncLeader()) { setMessage('另一个标签页正在负责同步，请在主标签页操作。'); return; }
    const epoch = readWorkspaceTabLeadershipEpoch();
    const stillLeader = () => isCurrentTabSyncLeader() && readWorkspaceTabLeadershipEpoch() === epoch;
    setBusy(true); setMessage('正在连接云端…');
    try {
      await reconnectConfiguredWorkspace(auth.userId || auth.login, auth.login, stillLeader);
      setMessage('已连接，正在确认云端内容…');
    } catch (e) { setMessage(e instanceof Error ? e.message : '连接失败，请重试。'); }
    finally { setBusy(false); }
  }, [auth.login, auth.userId]);

  const handleExport = useCallback(async () => {
    try {
      await downloadWorkspaceBackup();
      try { localStorage.setItem(LAST_MANUAL_EXPORT_KEY, new Date().toISOString()); } catch { /* ignore */ }
      setMessage('备份已导出，请收好这个文件，换电脑靠它找回。');
    } catch (e) { setMessage(e instanceof Error ? e.message : '导出失败。'); }
  }, []);

  const handleRecovery = async (id: string) => {
    try {
      await restoreWorkspaceConflictFields(id, recoveryFields as Parameters<typeof restoreWorkspaceConflictFields>[1]);
      setRecoveryId(null);
      setRecoveryFields([]);
      setConflicts(await listWorkspaceConflicts());
      setMessage('已恢复所选数据，恢复前内容已保存为本地快照。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '恢复失败。');
    }
  };

  const handleFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = '';
    if (!f) return;
    const r = new FileReader();
    r.onload = async () => {
      try {
        const v = validateWorkspaceBackup(JSON.parse(String(r.result)));
        if (!v.backup || v.errors.length > 0) { setMessage(v.errors.join('\n') || '备份文件无效。'); return; }
        if (!window.confirm(`恢复备份会先自动保存当前内容。继续吗？\n任务 ${v.summary?.tasks} · 复盘 ${v.summary?.dailyReviews ?? 0} 天 · 知识 ${v.summary?.graphNodes}`)) return;
        await restoreWorkspaceBackup(v.backup);
        setMessage('已恢复。恢复前的内容已自动存为本地快照。');
      } catch (err) { setMessage(err instanceof Error ? err.message : '恢复失败。'); }
    };
    r.readAsText(f);
  }, []);

  return (
    <div className="tl-dialog-overlay" onClick={onClose}>
      <div ref={dialogRef} className="tl-dialog tl-dialog--wide" role="dialog" aria-modal="true" aria-label="云同步与完整备份" tabIndex={-1} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 640 }}>
        <h3 className="tl-dialog-title"><Cloud size={18} />云同步与完整备份</h3>

        <section style={{ background: hero.bg, borderRadius: 10, padding: '16px 18px', margin: '0 20px 14px' }}>
          <div style={{ fontSize: 20 }}>{hero.icon} <strong style={{ color: hero.tone }}>{hero.title}</strong></div>
          <p style={{ margin: '8px 0 12px', fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{hero.desc}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="tl-dialog-btn tl-dialog-btn--primary" disabled={busy} onClick={() => { if (!isConnected) void handleConnect(); else if (needAttention > 0) setShowIssues(true); else void handleExport(); }}>{busy ? '处理中…' : hero.primary}</button>
            {!isConnected && <button type="button" className="tl-dialog-btn tl-dialog-btn--cancel" onClick={() => void handleExport()}>导出备份</button>}
            {isConnected && needAttention > 0 && <button type="button" className="tl-dialog-btn tl-dialog-btn--cancel" onClick={() => setMessage(`冲突 ${activeConflicts.length} · 待确认 ${pendingCount} · 阻断 ${blockers}。`)}>详情</button>}
          </div>
          {isConnected && <small style={{ display: 'block', marginTop: 8, color: '#6B7280' }}>上次导出：{describeExport()} · 快照 {snapshots.length}</small>}
        </section>

        {activeConflicts.length > 0 && <p style={{ margin: '0 20px 12px' }}>冲突待处理 {activeConflicts.length}</p>}
        {historicalConflicts.length > 0 && <p style={{ margin: '0 20px 12px' }}>历史副本 {historicalConflicts.length}</p>}
        {showIssues && activeConflicts.map((conflict) => <section key={conflict.id} role="region" aria-label="当前同步冲突" style={{ margin: '0 20px 14px' }}>
          <strong>当前同步冲突</strong><p>检测于 {new Date(conflict.detectedAt).toLocaleString('zh-CN')}，请确认要保留的数据。</p>
          <button type="button" onClick={() => { setRecoveryId(conflict.id); setRecoveryFields(Object.keys(conflict.pending.fields)); }}>从旧副本找回数据</button>
          <button type="button" onClick={() => void discardWorkspaceConflict(conflict.id).then(() => listWorkspaceConflicts().then(setConflicts)).catch((error: Error) => setMessage(error.message))}>保留当前数据</button>
        </section>)}
        {historicalConflicts.map((conflict) => <section key={conflict.id} role="region" aria-label="历史恢复副本" style={{ margin: '0 20px 14px' }}>
          <strong>历史恢复副本</strong><p>这是已解决冲突时留下的副本，不代表当前仍有同步故障。</p>
          <button type="button" onClick={() => { setRecoveryId(conflict.id); setRecoveryFields(Object.keys(conflict.pending.fields)); }}>需要从旧副本找回数据</button>
        </section>)}
        {recoveryId && <section role="region" aria-label="选择恢复数据" style={{ margin: '0 20px 14px' }}>
          <strong>选择要恢复的数据</strong>
          {Object.keys(conflicts.find((item) => item.id === recoveryId)?.pending.fields ?? {}).map((field) => <label key={field} style={{ display: 'block' }}><input type="checkbox" checked={recoveryFields.includes(field)} onChange={(event) => setRecoveryFields((fields) => event.target.checked ? [...fields, field] : fields.filter((item) => item !== field))} />{field}</label>)}
          <button type="button" disabled={recoveryFields.length === 0} onClick={() => void handleRecovery(recoveryId)}>恢复所选数据</button>
          <button type="button" onClick={() => setRecoveryId(null)}>取消</button>
        </section>}

        <section style={{ margin: '0 20px 14px', border: '1px solid #E5E7EB', borderRadius: 10 }}>
          <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>数据分布</div>
          {modules.map((m) => {
            const s = moduleState(m);
            return (
              <div key={m.label} style={{ display: 'flex', alignItems: 'center', padding: '9px 14px', borderTop: '1px solid #F3F4F6', fontSize: 13 }}>
                <span><strong>{m.label}</strong> <small style={{ color: '#9CA3AF' }}>{m.hint}</small></span>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: s.c, background: s.bg, padding: '2px 10px', borderRadius: 10, fontWeight: 600 }}>{s.t}</span>
              </div>
            );
          })}
          <small style={{ display: 'block', padding: '8px 14px', color: '#9CA3AF', fontSize: 11 }}>本地：仅此浏览器 · 待同步：已保存，联网后上传 · 已同步：云端一致</small>
        </section>

        <section style={{ margin: '0 20px 14px', border: '1px solid #E5E7EB', borderRadius: 10 }}>
          <div style={{ padding: '10px 14px', fontSize: 13, fontWeight: 600 }}>备份与恢复</div>
          <div style={{ display: 'flex', gap: 8, padding: '0 14px 12px' }}>
            <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--export" onClick={() => void handleExport()}><Download size={14} />导出</button>
            <button type="button" className="tl-sync-backup-btn tl-sync-backup-btn--import" onClick={() => fileInputRef.current?.click()}><Upload size={14} />恢复</button>
            {snapshots.slice(0, 1).map((s) => (
              <button key={s.id} type="button" className="tl-sync-backup-btn" onClick={() => { if (window.confirm(`回到 ${new Date(s.createdAt).toLocaleString('zh-CN')} 的快照吗？当前内容会先保存。`)) void restoreLocalSnapshot(s).then(() => setMessage('已恢复快照。')).catch((e: Error) => setMessage(e.message)); }}><RefreshCw size={14} />历史快照</button>
            ))}
          </div>
        </section>

        {message && <p className="tl-sync-backup-hint" role="status" style={{ margin: '0 20px 12px' }}>{message}</p>}

        <details style={{ margin: '0 20px 14px', fontSize: 12, color: '#6B7280' }}>
          <summary style={{ cursor: 'pointer' }}>开发者详情：房间号、诊断、旧人生地图</summary>
          <div style={{ paddingTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span>架构：{arch.architecture} · 模块 {connectedCount}/{enabledCount} · 待确认 {pendingCount} · 阻断 {blockers} · 警告 {warnings}</span>
            <span>运行：{runtime.phase}{runtime.message ? ` · ${runtime.message}` : ''}</span>
            <span>记录：{totalRecords ?? '统计中'} 条{report ? ` · ${(report.backupBytes / 1024).toFixed(1)} KB` : ''}</span>
            <span>旧人生地图模块状态：{lifeMap.enabled ? lifeMap.status : '未启用'}（仅用于旧数据恢复，新规划请用地图文档）</span>
            <span style={{ display: 'flex', gap: 6 }}>
              <button type="button" className="tl-sync-backup-btn" onClick={() => void downloadCurrentWorkspaceAuditReport().then(() => setMessage('数据盘点报告已导出。')).catch((error: Error) => setMessage(error.message))}>导出盘点报告</button>
              <button type="button" className="tl-sync-backup-btn" onClick={() => { if (window.confirm('暂时断开云端吗？本机数据保留。')) { disconnectWorkspace(false); setMessage('已断开，本机数据保留。'); } }}><Check size={12} />暂时断开</button>
            </span>
          </div>
        </details>

        <div className="tl-dialog-actions">
          <button type="button" className="tl-dialog-btn tl-dialog-btn--cancel" onClick={onClose}>关闭</button>
        </div>
        <input ref={fileInputRef} type="file" accept="application/json,.json" hidden onChange={handleFile} />
      </div>
    </div>
  );
};

export default SyncDialog;

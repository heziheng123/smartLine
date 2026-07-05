// ============================================================
// Smart Timeline - 同步设置对话框（三房间一键连接）
// 一次性连接 Timeline + Ebb + DailySchedule 三个独立房间
// ============================================================

import React, { useState, useEffect } from 'react';
import { Cloud, Link, Unlink, Copy, Check } from 'lucide-react';
import { useTimelineStore } from '@/store';
import { useEbbStore, EBB_ROOM_PREFIX } from '@/ebb/store';
import { useDailyScheduleStore, DAILY_ROOM_PREFIX } from '@/components/dailySchedule/store';
import { useShallow } from 'zustand/react/shallow';

interface SyncDialogProps {
  onClose: () => void;
}

const SyncDialog: React.FC<SyncDialogProps> = ({ onClose }) => {
  // Timeline store
  const {
    syncEnabled: tlSyncEnabled,
    syncRoomCode: tlSyncRoomCode,
    syncStatus: tlSyncStatus,
    enableSync: tlEnableSync,
    disableSync: tlDisableSync,
    setSyncStatus: tlSetSyncStatus,
  } = useTimelineStore(
    useShallow((s) => ({
      syncEnabled: s.syncEnabled,
      syncRoomCode: s.syncRoomCode,
      syncStatus: s.syncStatus,
      enableSync: s.enableSync,
      disableSync: s.disableSync,
      setSyncStatus: s.setSyncStatus,
    })),
  );

  const tlEnterRoom = useTimelineStore((state) => state.liveblocks?.enterRoom);
  const tlLeaveRoom = useTimelineStore((state) => state.liveblocks?.leaveRoom);
  const tlStatus = useTimelineStore((state) => state.liveblocks?.status);

  // Ebb store
  const {
    syncEnabled: ebbSyncEnabled,
    syncStatus: ebbSyncStatus,
    enableSync: ebbEnableSync,
    disableSync: ebbDisableSync,
    setSyncStatus: ebbSetSyncStatus,
  } = useEbbStore(
    useShallow((s) => ({
      syncEnabled: s.syncEnabled,
      syncStatus: s.syncStatus,
      enableSync: s.enableSync,
      disableSync: s.disableSync,
      setSyncStatus: s.setSyncStatus,
    })),
  );

  const ebbEnterRoom = useEbbStore((state) => state.liveblocks?.enterRoom);
  const ebbLeaveRoom = useEbbStore((state) => state.liveblocks?.leaveRoom);
  const ebbStatus = useEbbStore((state) => state.liveblocks?.status);

  // DailySchedule store
  const {
    syncEnabled: dailySyncEnabled,
    syncStatus: dailySyncStatus,
    enableSync: dailyEnableSync,
    disableSync: dailyDisableSync,
    setSyncStatus: dailySetSyncStatus,
  } = useDailyScheduleStore(
    useShallow((s) => ({
      syncEnabled: s.syncEnabled,
      syncStatus: s.syncStatus,
      enableSync: s.enableSync,
      disableSync: s.disableSync,
      setSyncStatus: s.setSyncStatus,
    })),
  );

  const dailyEnterRoom = useDailyScheduleStore((state) => state.liveblocks?.enterRoom);
  const dailyLeaveRoom = useDailyScheduleStore((state) => state.liveblocks?.leaveRoom);
  const dailyStatus = useDailyScheduleStore((state) => state.liveblocks?.status);

  const [roomCode, setRoomCode] = useState(tlSyncRoomCode || '');
  const [copied, setCopied] = useState(false);
  const [linkEbb, setLinkEbb] = useState(true);
  const [linkDaily, setLinkDaily] = useState(true);

  // 监听 Timeline 连接状态变化
  useEffect(() => {
    if (!tlStatus) return;
    const mappedStatus =
      tlStatus === 'connected' ? 'connected' :
      tlStatus === 'connecting' || tlStatus === 'reconnecting' ? 'connecting' :
      tlStatus === 'disconnected' || tlStatus === 'initial' ? 'disconnected' : 'error';
    tlSetSyncStatus(mappedStatus);
  }, [tlStatus, tlSetSyncStatus]);

  // 监听 Ebb 连接状态变化
  useEffect(() => {
    if (!ebbStatus) return;
    const mappedStatus =
      ebbStatus === 'connected' ? 'connected' :
      ebbStatus === 'connecting' || ebbStatus === 'reconnecting' ? 'connecting' :
      ebbStatus === 'disconnected' || ebbStatus === 'initial' ? 'disconnected' : 'error';
    ebbSetSyncStatus(mappedStatus);
  }, [ebbStatus, ebbSetSyncStatus]);

  // 监听 DailySchedule 连接状态变化
  useEffect(() => {
    if (!dailyStatus) return;
    const mappedStatus =
      dailyStatus === 'connected' ? 'connected' :
      dailyStatus === 'connecting' || dailyStatus === 'reconnecting' ? 'connecting' :
      dailyStatus === 'disconnected' || dailyStatus === 'initial' ? 'disconnected' : 'error';
    dailySetSyncStatus(mappedStatus);
  }, [dailyStatus, dailySetSyncStatus]);

  // 综合状态
  const anyEnabled = tlSyncEnabled || ebbSyncEnabled || dailySyncEnabled;

  const overallStatus =
    tlSyncStatus === 'error' || ebbSyncStatus === 'error' || dailySyncStatus === 'error'
      ? 'error'
      : tlSyncStatus === 'connected' 
        && (!ebbSyncEnabled || ebbSyncStatus === 'connected')
        && (!dailySyncEnabled || dailySyncStatus === 'connected')
        ? 'connected'
      : tlSyncStatus === 'connecting' || ebbSyncStatus === 'connecting' || dailySyncStatus === 'connecting'
        ? 'connecting'
        : 'disconnected';

  const statusInfo = {
    label: overallStatus === 'connected' ? '已连接' :
           overallStatus === 'connecting' ? '连接中...' : '未连接',
    color: overallStatus === 'connected' ? '#059669' :
           overallStatus === 'connecting' ? '#D97706' : '#9CA3AF',
  };

  const handleConnect = () => {
    const code = roomCode.trim();
    if (!code) return;

    // Timeline 房间
    if (tlEnterRoom) {
      tlEnableSync(code);
      tlEnterRoom(code);
    }

    // Ebb 房间（前缀 ebb-）
    if (linkEbb && ebbEnterRoom) {
      ebbEnableSync(code);
      ebbEnterRoom(`${EBB_ROOM_PREFIX}${code}`);
    }

    // DailySchedule 房间（前缀 daily-）
    if (linkDaily && dailyEnterRoom) {
      dailyEnableSync(code);
      dailyEnterRoom(`${DAILY_ROOM_PREFIX}${code}`);
    }
  };

  const handleDisconnect = () => {
    if (tlLeaveRoom) {
      tlLeaveRoom();
      tlDisableSync();
    }
    if (ebbLeaveRoom && ebbSyncEnabled) {
      ebbLeaveRoom();
      ebbDisableSync();
    }
    if (dailyLeaveRoom && dailySyncEnabled) {
      dailyLeaveRoom();
      dailyDisableSync();
    }
  };

  const handleCopyRoomCode = () => {
    navigator.clipboard.writeText(tlSyncRoomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="tl-dialog-overlay" onClick={onClose}>
      <div className="tl-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
        <h3 className="tl-dialog-title">
          <Cloud size={18} />
          云端同步
        </h3>

        <div className="tl-sync-status">
          <span
            className="tl-sync-dot"
            style={{ backgroundColor: statusInfo.color }}
          />
          <span style={{ color: statusInfo.color, fontWeight: 500 }}>
            {statusInfo.label}
          </span>
          {anyEnabled && (
            <span className="tl-sync-room-tag">
              房间: {tlSyncRoomCode}
            </span>
          )}
        </div>

        {!anyEnabled ? (
          <>
            <label className="tl-dialog-label">
              房间代码
              <input
                className="tl-dialog-input"
                type="text"
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.replace(/[^a-zA-Z0-9_-]/g, ''))}
                placeholder="输入一个唯一的房间代码（如 my-timeline-2026）"
                maxLength={64}
              />
              <span className="tl-dialog-hint">
                相同房间代码的设备将自动实时同步数据，无需服务器配置
              </span>
            </label>

            <label className="tl-sync-checkbox-row">
              <input
                type="checkbox"
                checked={linkEbb}
                onChange={(e) => setLinkEbb(e.target.checked)}
              />
              <span>
                同时连接复习模块（Ebb）房间
                <span className="tl-sync-checkbox-hint">
                  使用前缀 <code>{EBB_ROOM_PREFIX}</code> 隔离数据
                </span>
              </span>
            </label>

            <label className="tl-sync-checkbox-row">
              <input
                type="checkbox"
                checked={linkDaily}
                onChange={(e) => setLinkDaily(e.target.checked)}
              />
              <span>
                同时连接每日安排（Daily）房间
                <span className="tl-sync-checkbox-hint">
                  使用前缀 <code>{DAILY_ROOM_PREFIX}</code> 隔离数据
                </span>
              </span>
            </label>

            <div className="tl-dialog-actions">
              <button className="tl-dialog-btn tl-dialog-btn--cancel" onClick={onClose}>
                取消
              </button>
              <button
                className="tl-dialog-btn tl-dialog-btn--primary"
                onClick={handleConnect}
                disabled={!roomCode.trim()}
              >
                <Link size={14} />
                连接
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="tl-sync-info">
              <div className="tl-sync-info-row">
                <span className="tl-sync-info-label">房间</span>
                <span className="tl-sync-info-value">
                  {tlSyncRoomCode}
                  <button
                    className="tl-sync-copy-btn"
                    onClick={handleCopyRoomCode}
                    title="复制房间代码"
                  >
                    {copied ? <Check size={12} /> : <Copy size={12} />}
                  </button>
                </span>
              </div>
              <div className="tl-sync-info-row">
                <span className="tl-sync-info-label">时间轴</span>
                <span className="tl-sync-info-value" style={{ color: tlSyncStatus === 'connected' ? '#059669' : '#D97706' }}>
                  {tlSyncStatus === 'connected' ? '已连接' : tlSyncStatus === 'connecting' ? '连接中' : '未连接'}
                </span>
              </div>
              <div className="tl-sync-info-row">
                <span className="tl-sync-info-label">复习（Ebb）</span>
                <span className="tl-sync-info-value" style={{ color: ebbSyncEnabled ? (ebbSyncStatus === 'connected' ? '#059669' : '#D97706') : '#9CA3AF' }}>
                  {ebbSyncEnabled
                    ? (ebbSyncStatus === 'connected' ? '已连接' : ebbSyncStatus === 'connecting' ? '连接中' : '未连接')
                    : '未启用'}
                </span>
              </div>
              <div className="tl-sync-info-row">
                <span className="tl-sync-info-label">每日安排</span>
                <span className="tl-sync-info-value" style={{ color: dailySyncEnabled ? (dailySyncStatus === 'connected' ? '#059669' : '#D97706') : '#9CA3AF' }}>
                  {dailySyncEnabled
                    ? (dailySyncStatus === 'connected' ? '已连接' : dailySyncStatus === 'connecting' ? '连接中' : '未连接')
                    : '未启用'}
                </span>
              </div>
              <div className="tl-sync-info-row">
                <span className="tl-sync-info-label">服务</span>
                <span className="tl-sync-info-value" style={{ color: '#059669' }}>
                  Liveblocks 实时协作
                </span>
              </div>
            </div>

            <p className="tl-sync-tip">
              在其他设备上打开此网页，输入相同的房间代码即可开始实时同步。
              时间轴、复习模块、每日安排使用独立房间，数据物理隔离。
            </p>

            <div className="tl-dialog-actions">
              <button className="tl-dialog-btn tl-dialog-btn--cancel" onClick={onClose}>
                关闭
              </button>
              <button
                className="tl-dialog-btn tl-dialog-btn--danger"
                onClick={handleDisconnect}
              >
                <Unlink size={14} />
                断开同步
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default SyncDialog;
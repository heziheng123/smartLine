// ============================================================
// Smart Timeline - 同步设置对话框（Liveblocks 版）
// ============================================================

import React, { useState, useEffect } from 'react';
import { Cloud, Link, Unlink, Copy, Check } from 'lucide-react';
import { useTimelineStore } from '@/store';

interface SyncDialogProps {
  onClose: () => void;
}

const SyncDialog: React.FC<SyncDialogProps> = ({ onClose }) => {
  const {
    syncEnabled,
    syncRoomCode,
    syncStatus,
    enableSync,
    disableSync,
    setSyncStatus,
  } = useTimelineStore();

  // 正确获取 liveblocks 对象和其方法
  const enterRoom = useTimelineStore((state) => state.liveblocks?.enterRoom);
  const leaveRoom = useTimelineStore((state) => state.liveblocks?.leaveRoom);
  const status = useTimelineStore((state) => state.liveblocks?.status);

  const [roomCode, setRoomCode] = useState(syncRoomCode || '');
  const [copied, setCopied] = useState(false);

  // 监听连接状态变化
  useEffect(() => {
    if (!status) return;

    const mappedStatus = 
      status === 'connected' ? 'connected' :
      status === 'connecting' || status === 'reconnecting' ? 'connecting' :
      status === 'disconnected' || status === 'initial' ? 'disconnected' : 'error';
    setSyncStatus(mappedStatus);
  }, [status, setSyncStatus]);

  const statusInfo = {
    label: syncStatus === 'connected' ? '已连接' : 
           syncStatus === 'connecting' ? '连接中...' : '未连接',
    color: syncStatus === 'connected' ? '#059669' : 
           syncStatus === 'connecting' ? '#D97706' : '#9CA3AF',
  };

  const handleConnect = () => {
    if (!roomCode.trim() || !enterRoom) {
      console.error('无法连接：roomCode 或 enterRoom 未定义', { roomCode, enterRoom });
      return;
    }
    
    console.log('正在连接房间:', roomCode.trim());
    enableSync(roomCode.trim());
    enterRoom(roomCode.trim());
  };

  const handleDisconnect = () => {
    if (!leaveRoom) {
      console.error('无法断开：leaveRoom 未定义');
      return;
    }
    
    console.log('正在断开房间');
    leaveRoom();
    disableSync();
  };

  const handleCopyRoomCode = () => {
    navigator.clipboard.writeText(syncRoomCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="tl-dialog-overlay" onClick={onClose}>
      <div className="tl-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 440 }}>
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
          {syncEnabled && (
            <span className="tl-sync-room-tag">
              房间: {syncRoomCode}
            </span>
          )}
        </div>

        {!syncEnabled ? (
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
                  {syncRoomCode}
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
                <span className="tl-sync-info-label">服务</span>
                <span className="tl-sync-info-value" style={{ color: '#059669' }}>
                  Liveblocks 实时协作
                </span>
              </div>
            </div>

            <p className="tl-sync-tip">
              在其他设备上打开此网页，输入相同的房间代码即可开始实时同步。
              所有修改会毫秒级推送到所有已连接的设备。
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
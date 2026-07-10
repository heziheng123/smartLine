// ============================================================
// 时间块卡片组件 - 支持拖拽移动 + 上下边缘拉伸
// ============================================================

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { Check, X, Clock, GripVertical, CircleDashed, Link as LinkIcon } from 'lucide-react';
import type { TimeBlock } from './types';
import {
  timeToMinutes,
  minutesToTime,
  snapToQuarter,
  minutesToY,
  GRID_CONFIG,
  checkCollision,
} from './conversion';

interface TimeBlockCardProps {
  block: TimeBlock;
  existingBlocks: TimeBlock[];
  onResize: (blockId: string, startTime: string, endTime: string) => void;
  onToggle: (blockId: string) => void;
  onRemove: (blockId: string) => void;
  onClick: (block: TimeBlock, rect: DOMRect) => void;
  onDragStart?: (blockId: string) => void;
  isConflict?: boolean;
  isUnlinked?: boolean; // 新增：是否未绑定节点
  isLinked?: boolean;
}

type DragMode = 'none' | 'move' | 'resize-top' | 'resize-bottom';

const TimeBlockCard: React.FC<TimeBlockCardProps> = ({
  block,
  existingBlocks,
  onResize,
  onToggle,
  onRemove,
  onClick,
  onDragStart,
  isConflict,
  isUnlinked,
  isLinked,
}) => {
  const cardRef = useRef<HTMLDivElement>(null);
  const [dragMode, setDragMode] = useState<DragMode>('none');
  // 拖拽预览时间存入 ref + state：ref 供 effect 内事件回调读取最新值，
  // state 仅用于触发渲染。这样 effect 依赖数组可去掉 preview*，避免每帧重建监听器。
  const previewRef = useRef<{ start: string | null; end: string | null }>({
    start: null,
    end: null,
  });
  const [previewStart, setPreviewStart] = useState<string | null>(null);
  const [previewEnd, setPreviewEnd] = useState<string | null>(null);
  const [localConflict, setLocalConflict] = useState(false);
  const dragStateRef = useRef<{
    mode: DragMode;
    startY: number;
    originalStartMin: number;
    originalEndMin: number;
  } | null>(null);

  const startMin = timeToMinutes(block.startTime);
  const endMin = timeToMinutes(block.endTime);
  const durationMin = endMin - startMin;

  // ── 拖拽开始 ─────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent, mode: DragMode) => {
      e.preventDefault();
      e.stopPropagation();

      dragStateRef.current = {
        mode,
        startY: e.clientY,
        originalStartMin: startMin,
        originalEndMin: endMin,
      };
      setDragMode(mode);
    },
    [startMin, endMin],
  );

  // ── 拖拽移动 ─────────────────────────────────────────────
  useEffect(() => {
    if (dragMode === 'none') return;

    const handleMouseMove = (e: MouseEvent) => {
      const state = dragStateRef.current;
      if (!state) return;

      const deltaY = e.clientY - state.startY;
      const deltaMin = (deltaY / GRID_CONFIG.hourHeight) * 60;

      let newStartMin: number;
      let newEndMin: number;

      switch (state.mode) {
        case 'move': {
          const dur = state.originalEndMin - state.originalStartMin;
          newStartMin = snapToQuarter(state.originalStartMin + deltaMin);
          newEndMin = newStartMin + dur;
          break;
        }
        case 'resize-top': {
          newStartMin = snapToQuarter(state.originalStartMin + deltaMin);
          newEndMin = state.originalEndMin;
          // 最小时长约束
          if (newEndMin - newStartMin < GRID_CONFIG.minDuration) {
            newStartMin = newEndMin - GRID_CONFIG.minDuration;
          }
          break;
        }
        case 'resize-bottom': {
          newStartMin = state.originalStartMin;
          newEndMin = snapToQuarter(state.originalEndMin + deltaMin);
          if (newEndMin - newStartMin < GRID_CONFIG.minDuration) {
            newEndMin = newStartMin + GRID_CONFIG.minDuration;
          }
          break;
        }
        default:
          return;
      }

      // 边界约束
      const gridStartMin = GRID_CONFIG.startHour * 60;
      const gridEndMin = GRID_CONFIG.endHour * 60;
      newStartMin = Math.max(gridStartMin, Math.min(newStartMin, gridEndMin - GRID_CONFIG.minDuration));
      newEndMin = Math.max(newStartMin + GRID_CONFIG.minDuration, Math.min(newEndMin, gridEndMin));

      const newStart = minutesToTime(newStartMin);
      const newEnd = minutesToTime(newEndMin);

      // 同时写 ref 和 state：ref 供下一次 mousemove/mouseup 读取，state 触发渲染
      previewRef.current = { start: newStart, end: newEnd };
      setPreviewStart(newStart);
      setPreviewEnd(newEnd);

      // 碰撞检测
      const collision = checkCollision(block.id, newStart, newEnd, existingBlocks);
      setLocalConflict(collision.overlap);
    };

    const handleMouseUp = () => {
      const state = dragStateRef.current;
      const { start: pStart, end: pEnd } = previewRef.current;
      if (state && (pStart || pEnd)) {
        const finalStart = pStart ?? block.startTime;
        const finalEnd = pEnd ?? block.endTime;
        const collision = checkCollision(block.id, finalStart, finalEnd, existingBlocks);
        if (!collision.overlap) {
          onResize(block.id, finalStart, finalEnd);
        }
      }

      setDragMode('none');
      previewRef.current = { start: null, end: null };
      setPreviewStart(null);
      setPreviewEnd(null);
      setLocalConflict(false);
      dragStateRef.current = null;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
    // 依赖数组去掉 preview* —— 由 ref 在闭包内提供最新值，避免每帧重建监听器
  }, [dragMode, block, existingBlocks, onResize]);

  // ── 渲染用时间 ───────────────────────────────────────────
  const displayStart = previewStart ?? block.startTime;
  const displayEnd = previewEnd ?? block.endTime;
  const displayStartMin = timeToMinutes(displayStart);
  const displayEndMin = timeToMinutes(displayEnd);

  const displayTop = minutesToY(displayStartMin);
  const displayHeight = Math.max(
    minutesToY(displayEndMin) - displayTop,
    GRID_CONFIG.hourHeight * GRID_CONFIG.minDuration / 60,
  );

  // ── 背景色（极淡同色） ─────────────────────────────────
  const accentColor = block.color ?? '#8B9DC3';
  
  // 拖拽状态下加深透明度，让它看起来更清晰，而非处于底层半透明状态
  const opacityHex = dragMode !== 'none' ? '80' : '60'; // 静态透明度提升到 60，拖拽时 80
  
  const bgColor = block.source === 'free' 
    ? (dragMode !== 'none' ? '#E5E7EB' : '#F3F4F6')
    : block.completed
      ? '#ECFDF5'
      : isConflict || localConflict
        ? '#FEF2F2'
        : `${accentColor}${opacityHex}`;

  const borderClass = isConflict || localConflict
    ? 'tb-card--conflict'
    : '';

  return (
    <div
      ref={cardRef}
      className={`tb-card ${block.completed ? 'tb-card--completed' : ''} ${borderClass} ${dragMode !== 'none' ? 'tb-card--dragging' : ''} ${isUnlinked ? 'tb-card--unlinked' : ''} ${block.source === 'free' ? 'tb-card--free' : ''}`}
      style={{
        top: displayTop,
        height: displayHeight,
        background: bgColor,
      }}
      onClick={() => {
        if (dragMode === 'none' && cardRef.current) {
          onClick(block, cardRef.current.getBoundingClientRect());
        }
      }}
    >
      {/* 上边缘拉伸手柄 */}
      <div
        className="tb-resize-handle tb-resize-handle--top"
        onMouseDown={(e) => handleMouseDown(e, 'resize-top')}
      />

      {/* 拖拽把手（拖回任务池） */}
      {block.source !== 'free' && (
        <div
          className="tb-grip"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/x-timeblock', block.id);
            e.dataTransfer.effectAllowed = 'move';
            onDragStart?.(block.id);
          }}
        >
          <GripVertical size={12} />
        </div>
      )}

      {/* 左侧颜色高亮条 */}
      {block.source !== 'free' && (
        <div
          className="tb-accent"
          style={{ backgroundColor: block.completed ? '#6EE7B7' : accentColor }}
        />
      )}

      {/* 内容区 */}
      <div className="tb-content">
        <span className="tb-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {block.name}
          {block.source !== 'free' && (
            <>
              {isUnlinked ? (
                <span title="未绑定节点" className="inline-flex items-center">
                  <CircleDashed size={12} style={{ opacity: 0.4 }} />
                </span>
              ) : isLinked && (
                <span title="已绑定节点" className="inline-flex items-center">
                  <LinkIcon size={12} className="opacity-60 text-blue-500" />
                </span>
              )}
            </>
          )}
        </span>
        {block.detail && <span className="tb-detail">{block.detail}</span>}
        <span className="tb-time-label">
          <Clock size={10} />
          {displayStart} - {displayEnd}
          <span className="tb-duration-label">({durationMin}min)</span>
        </span>
      </div>

      {/* 操作按钮 */}
      <div className="tb-actions">
        {block.source !== 'free' && (
          <button
            type="button"
            className={`tb-check ${block.completed ? 'tb-check--done' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggle(block.id); }}
          >
            <Check size={12} />
          </button>
        )}
        <button
          type="button"
          className="tb-delete"
          onClick={(e) => { e.stopPropagation(); onRemove(block.id); }}
        >
          <X size={12} />
        </button>
      </div>

      {/* 下边缘拉伸手柄 */}
      <div
        className="tb-resize-handle tb-resize-handle--bottom"
        onMouseDown={(e) => handleMouseDown(e, 'resize-bottom')}
      />

      {/* 移动区域（中间） */}
      {dragMode === 'none' && (
        <div
          className="tb-move-area"
          onMouseDown={(e) => handleMouseDown(e, 'move')}
        />
      )}
    </div>
  );
};

export default React.memo(TimeBlockCard);

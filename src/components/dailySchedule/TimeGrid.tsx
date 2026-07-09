// ============================================================
// 时间网格画布 - 时间刻度 + 网格线 + 当前时间线 + 时间块层
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { todayStr } from '@/utils/dateSafe';
import type { TimeBlock } from './types';
import TimeBlockCard from './TimeBlockCard';
import {
  GRID_CONFIG,
  gridTotalHeight,
  minutesToY,
  yToMinutes,
  minutesToTime,
  checkCollision,
} from './conversion';

interface TimeGridProps {
  blocks: TimeBlock[];
  selectedDate: string;
  onResize: (blockId: string, startTime: string, endTime: string) => void;
  onToggle: (blockId: string) => void;
  onRemove: (blockId: string) => void;
  onBlockClick: (block: TimeBlock, rect: DOMRect) => void;
  onBlockDragStart?: (blockId: string) => void;
  onBlankClick: (startTime: string) => void;
  /** 从任务池拖入的预览块 */
  ghostBlock: { startTime: string; endTime: string; name: string; color?: string } | null;
  conflictIds: string[];
  isUnlinkedTask: (sourceId: string) => boolean;
  isLinkedTask: (sourceId: string) => boolean;
}

const TimeGrid: React.FC<TimeGridProps> = ({
  blocks,
  selectedDate,
  onResize,
  onToggle,
  onRemove,
  onBlockClick,
  onBlockDragStart,
  onBlankClick,
  ghostBlock,
  conflictIds,
  isUnlinkedTask,
  isLinkedTask,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [nowY, setNowY] = useState<number | null>(null);
  const conflictSet = new Set(conflictIds);

  // ── 当前时间线 ───────────────────────────────────────────
  const updateNowLine = useCallback(() => {
    const now = new Date();
    if (todayStr() !== selectedDate) {
      setNowY(null);
      return;
    }
    const min = now.getHours() * 60 + now.getMinutes();
    if (min < GRID_CONFIG.startHour * 60 || min > GRID_CONFIG.endHour * 60) {
      setNowY(null);
      return;
    }
    setNowY(minutesToY(min));
  }, [selectedDate]);

  useEffect(() => {
    updateNowLine();
    const timer = setInterval(updateNowLine, 60_000);
    return () => clearInterval(timer);
  }, [updateNowLine]);

  // ── 点击空白区域 → 快速创建 ─────────────────────────────
  const handleBlankClick = useCallback(
    (e: React.MouseEvent) => {
      // 排除点击在时间块上的情况
      if ((e.target as HTMLElement).closest('.tb-card')) return;

      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const y = e.clientY - rect.top;
      const min = yToMinutes(y);
      const startHour = GRID_CONFIG.startHour * 60;
      const endHour = GRID_CONFIG.endHour * 60;

      if (min < startHour || min >= endHour) return;

      onBlankClick(minutesToTime(min));
    },
    [onBlankClick],
  );

  // ── 生成小时刻度 ────────────────────────────────────────
  const hours = [];
  for (let h = GRID_CONFIG.startHour; h <= GRID_CONFIG.endHour; h++) {
    hours.push(h);
  }

  const totalHeight = gridTotalHeight();

  return (
    <div className="tg-wrapper">
      {/* 时间刻度栏 */}
      <div className="tg-ruler" style={{ height: totalHeight }}>
        {hours.map((h) => (
          <div
            key={h}
            className="tg-ruler-label"
            style={{ top: (h - GRID_CONFIG.startHour) * GRID_CONFIG.hourHeight }}
          >
            {String(h).padStart(2, '0')}:00
          </div>
        ))}
      </div>

      {/* 画布区域 */}
      <div
        ref={containerRef}
        className="tg-canvas"
        style={{ height: totalHeight }}
        onClick={handleBlankClick}
      >
        {/* 整点/半点网格线 */}
        {hours.map((h) => {
          const y = (h - GRID_CONFIG.startHour) * GRID_CONFIG.hourHeight;
          return (
            <React.Fragment key={h}>
              {/* 整点线 */}
              <div className="tg-hour-line" style={{ top: y }} />
              {/* 半点线 */}
              {h < GRID_CONFIG.endHour && (
                <div className="tg-half-line" style={{ top: y + GRID_CONFIG.hourHeight / 2 }} />
              )}
            </React.Fragment>
          );
        })}

        {/* 当前时间指示线 */}
        {nowY !== null && (
          <div className="tg-now-line" style={{ top: nowY }}>
            <div className="tg-now-dot" />
          </div>
        )}

        {/* 时间块层 */}
        {blocks.map((block) => (
          <TimeBlockCard
            key={block.id}
            block={block}
            existingBlocks={blocks}
            onResize={onResize}
            onToggle={onToggle}
            onRemove={onRemove}
            onClick={onBlockClick}
            onDragStart={onBlockDragStart}
            isConflict={conflictSet.has(block.id)}
            isUnlinked={isUnlinkedTask(block.sourceId)}
            isLinked={isLinkedTask(block.sourceId)}
          />
        ))}

        {/* 拖入预览块 */}
        {ghostBlock && (() => {
          const gTop = minutesToY(
            Number(ghostBlock.startTime.split(':')[0]) * 60 + Number(ghostBlock.startTime.split(':')[1]),
          );
          const gBottom = minutesToY(
            Number(ghostBlock.endTime.split(':')[0]) * 60 + Number(ghostBlock.endTime.split(':')[1]),
          );
          const ghostCollision = checkCollision(null, ghostBlock.startTime, ghostBlock.endTime, blocks);
          return (
            <div
              className={`tg-ghost ${ghostCollision.overlap ? 'tg-ghost--conflict' : ''}`}
              style={{
                top: gTop,
                height: gBottom - gTop,
              }}
            >
              <div
                className="tb-accent"
                style={{ backgroundColor: ghostBlock.color ?? '#8B9DC3' }}
              />
              <span className="tg-ghost-name">{ghostBlock.name}</span>
            </div>
          );
        })()}
      </div>
    </div>
  );
};

export default React.memo(TimeGrid);

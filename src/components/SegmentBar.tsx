// ============================================================
// Smart Timeline - 任务片段条
// ============================================================

import React, { useCallback, useRef } from 'react';
import type { TaskSegment } from '@/types';
import { BAR_HEIGHT, ROW_HEIGHT, getBorderColor, MAIN_TASK_TEXT } from '@/utils/timeline-utils';

/** 单击延迟（毫秒）：用于区分单击与双击 */
const CLICK_DELAY = 250;

const SegmentBar: React.FC<{
  segment: TaskSegment;
  daysInMonth: number;
  /** 单击：打开 Markdown 详情抽屉 */
  onClick?: () => void;
  /** 双击：打开元信息编辑表单 */
  onDoubleClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({ segment, daysInMonth, onClick, onDoubleClick, onContextMenu }) => {
  const { startDay, endDay, row, color, taskName, isStart, isEnd, isMain, completed } = segment;
  const clickTimerRef = useRef<number | null>(null);

  const leftPct = ((startDay - 1) / daysInMonth) * 100;
  const widthPct = ((endDay - startDay + 1) / daysInMonth) * 100;
  const topPx = row * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;

  const radiusL = isStart ? 6 : 0;
  const radiusR = isEnd ? 6 : 0;

  const textColor = isMain ? MAIN_TASK_TEXT : getBorderColor(color);
  const borderColor = textColor;
  const arrowColor = isMain ? 'rgba(153, 27, 27, 0.5)' : `${textColor}80`;

  // 单击延迟触发：若 250ms 内出现双击，则取消单击
  const handleClick = useCallback(() => {
    if (!onClick) return;
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
    }
    clickTimerRef.current = window.setTimeout(() => {
      clickTimerRef.current = null;
      onClick();
    }, CLICK_DELAY);
  }, [onClick]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    // 取消等待中的单击
    if (clickTimerRef.current !== null) {
      window.clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onDoubleClick?.();
  }, [onDoubleClick]);

  React.useEffect(() => {
    return () => {
      if (clickTimerRef.current !== null) {
        window.clearTimeout(clickTimerRef.current);
      }
    };
  }, []);

  return (
    <div
      className={`tl-seg ${!isStart ? 'tl-seg--continued' : ''} ${!isEnd ? 'tl-seg--continues' : ''} ${isMain ? 'tl-seg--main' : ''} ${completed ? 'tl-seg--completed' : ''}`}
      style={{
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        top: topPx,
        height: BAR_HEIGHT,
        background: color,
        borderRadius: `${radiusL}px ${radiusR}px ${radiusR}px ${radiusL}px`,
        color: textColor,
        borderColor,
        cursor: 'pointer',
      }}
      title={`${taskName}\n${segment.month + 1}月${startDay}日 ~ ${endDay}日${isMain ? '\n[主线任务]' : ''}${completed ? '\n[已完成]' : ''}\n单击查看详情 · 双击编辑元信息`}
      onClick={(e) => { e.stopPropagation(); handleClick(); }}
      onDoubleClick={handleDoubleClick}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(e); }}
    >
      <span className="tl-seg-label">
        {completed ? <s>{taskName}</s> : taskName}
      </span>
      {!isEnd && (
        <span className="tl-seg-arrow tl-seg-arrow--right" style={{ color: arrowColor }}>›</span>
      )}
      {!isStart && (
        <span className="tl-seg-arrow tl-seg-arrow--left" style={{ color: arrowColor }}>‹</span>
      )}
    </div>
  );
};

export default SegmentBar;

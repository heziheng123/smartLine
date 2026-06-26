// ============================================================
// Smart Timeline - 任务片段条
// ============================================================

import React from 'react';
import type { TaskSegment } from '@/types';
import { BAR_HEIGHT, ROW_HEIGHT, getBorderColor, MAIN_TASK_TEXT } from '@/utils/timeline-utils';

const SegmentBar: React.FC<{
  segment: TaskSegment;
  daysInMonth: number;
  /** 单击：打开任务详情抽屉 */
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({ segment, daysInMonth, onClick, onContextMenu }) => {
  const { startDay, endDay, row, color, taskName, isStart, isEnd, isMain, completed } = segment;

  const leftPct = ((startDay - 1) / daysInMonth) * 100;
  const widthPct = ((endDay - startDay + 1) / daysInMonth) * 100;
  const topPx = row * ROW_HEIGHT + (ROW_HEIGHT - BAR_HEIGHT) / 2;

  const radiusL = isStart ? 6 : 0;
  const radiusR = isEnd ? 6 : 0;

  const textColor = isMain ? MAIN_TASK_TEXT : getBorderColor(color);
  const borderColor = textColor;
  const arrowColor = isMain ? 'rgba(153, 27, 27, 0.5)' : `${textColor}80`;

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
      title={`${taskName}\n${segment.month + 1}月${startDay}日 ~ ${endDay}日${isMain ? '\n[主线任务]' : ''}${completed ? '\n[已完成]' : ''}\n单击查看详情`}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
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

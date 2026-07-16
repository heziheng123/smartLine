// ============================================================
// Smart Timeline - 任务片段条
// ============================================================

import React from 'react';
import type { TaskSegment } from '@/types';
import type { TimelineMetrics } from '@/utils/timeline-utils';
import { getTaskTextColor, getTaskBorderColor } from '@/utils/timeline-utils';

const SegmentBar: React.FC<{
  segment: TaskSegment;
  daysInMonth: number;
  metrics: TimelineMetrics;
  /** 单击：打开任务详情抽屉 */
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({ segment, daysInMonth, metrics, onClick, onContextMenu }) => {
  const { startDay, endDay, row, color, taskName, isStart, isEnd, isMain, completed } = segment;

  const leftPct = ((startDay - 1) / daysInMonth) * 100;
  const widthPct = ((endDay - startDay + 1) / daysInMonth) * 100;
  const topPx = row * metrics.rowHeight + (metrics.rowHeight - metrics.barHeight) / 2;

  const radius = Math.max(4, Math.round(metrics.barHeight / 4));
  const radiusL = isStart ? radius : 0;
  const radiusR = isEnd ? radius : 0;

  // 任务文字色与箭头/边框强调色均取自任务所属主题（同色系绑定）
  const textColor = getTaskTextColor(color);
  const taskBorderColor = getTaskBorderColor(color);
  const arrowColor = `${taskBorderColor}80`;

  return (
    <div
      className={`tl-seg ${!isStart ? 'tl-seg--continued' : ''} ${!isEnd ? 'tl-seg--continues' : ''} ${isMain ? 'tl-seg--main' : ''} ${completed ? 'tl-seg--completed' : ''}`}
      style={{
        left: `${leftPct}%`,
        width: `${widthPct}%`,
        top: topPx,
        height: metrics.barHeight,
        background: color,
        borderRadius: `${radiusL}px ${radiusR}px ${radiusR}px ${radiusL}px`,
        color: textColor,
        cursor: 'pointer',
        // 方案 B：左右 1px 同色系深色细边框，为相邻同色任务提供兜底视觉边界
        // box-sizing 已为 border-box，不会撑大元素；圆角处边框自然贴合
        borderLeft: `1px solid ${taskBorderColor}`,
        borderRight: `1px solid ${taskBorderColor}`,
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

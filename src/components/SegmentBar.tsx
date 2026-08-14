// ============================================================
// Smart Timeline - 任务片段条
// P1 a11y：键盘可达性 + role="button" + Enter/Space 触发
// ============================================================

import { type FC, useRef } from 'react';
import type { TaskSegment } from '@/types';
import type { TimelineMetrics } from '@/utils/timeline-utils';
import { getTaskTextColor, getTaskBorderColor } from '@/utils/timeline-utils';

const SegmentBar: FC<{
  segment: TaskSegment;
  daysInMonth: number;
  metrics: TimelineMetrics;
  /** 单击：打开任务详情抽屉 */
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}> = ({ segment, daysInMonth, metrics, onClick, onContextMenu }) => {
  const { startDay, endDay, row, color, taskName, isStart, isEnd, isMain, completed } = segment;
  const ref = useRef<HTMLDivElement | null>(null);

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

  const a11yLabel = [
    taskName,
    `${segment.month + 1}月${startDay}日至${endDay}日`,
    isMain ? '主线任务' : '',
    completed ? '已完成' : '',
    '按 Enter 打开详情，按 Shift+F10 打开右键菜单',
  ].filter(Boolean).join('，');

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      onClick?.();
    } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      e.preventDefault();
      e.stopPropagation();
      // F-2 修复：原实现 fakeEvent 缺 clientX/clientY，导致下游 setContextMenu 收到 NaN。
      // 用元素本身 rect 构造坐标，让右键菜单出现在合理位置（元素底部中心）。
      const target = ref.current;
      const rect = target?.getBoundingClientRect();
      const fakeEvent = {
        preventDefault: () => {},
        stopPropagation: () => {},
        clientX: rect ? rect.left + rect.width / 2 : 0,
        clientY: rect ? rect.bottom : 0,
      } as unknown as React.MouseEvent;
      onContextMenu?.(fakeEvent);
    }
  };

  return (
    <div
      ref={ref}
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
        borderLeft: `1px solid ${taskBorderColor}`,
        borderRight: `1px solid ${taskBorderColor}`,
      }}
      title={`${taskName}\n${segment.month + 1}月${startDay}日 ~ ${endDay}日${isMain ? '\n[主线任务]' : ''}${completed ? '\n[已完成]' : ''}\n单击查看详情`}
      role="button"
      tabIndex={0}
      aria-label={a11yLabel}
      onClick={(e) => { e.stopPropagation(); onClick?.(); }}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(e); }}
      onKeyDown={handleKeyDown}
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
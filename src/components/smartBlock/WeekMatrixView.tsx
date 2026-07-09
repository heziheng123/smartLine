// ============================================================
// 周矩阵视图（Week Matrix View）
// 行 = 标签，列 = 日期，格子 = 智能任务块卡片（含 Body）
// 数据来源：所有 Task 的 SmartTaskBlock
// ============================================================

import React, { useState, useMemo, useCallback } from 'react';
import { ChevronLeft, ChevronRight, CalendarDays, CircleDashed } from 'lucide-react';
import type { Task, SmartTaskBlock, SmartTaskHeader } from '@/types';
import {
  getSmartTaskBlocks,
  getTagColor,
} from '@/utils/blocks';
import { sanitizeHtml } from '@/utils/sanitize';
import {
  todayStr,
  addDays,
  isBeforeDay,
  isAfterDay,
  formatDate,
  getDayOfWeek,
  splitDate,
} from '@/utils/dateSafe';

interface WeekMatrixViewProps {
  tasks: Task[];
  onUpdateBlockHeader: (taskId: string, blockId: string, patch: Partial<SmartTaskHeader>) => void;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

/** 给定 YYYY-MM-DD，返回同一周的周一（YYYY-MM-DD） */
function getWeekStartStr(dateStr: string): string {
  const dow = getDayOfWeek(dateStr); // 0=周日, 1=周一, ..., 6=周六
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDays(dateStr, offset);
}

/** 给定 YYYY-MM-DD 和月偏移量，返回目标月同日（超出则截断到月末） */
function addMonths(dateStr: string, months: number): string {
  const { year: y, month: m, day: d } = splitDate(dateStr);
  const totalMonths = y * 12 + (m - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const maxDay = new Date(newYear, newMonth, 0).getDate();
  const newDay = Math.min(d, maxDay);
  return `${newYear}-${String(newMonth).padStart(2, '0')}-${String(newDay).padStart(2, '0')}`;
}

const WeekMatrixView: React.FC<WeekMatrixViewProps> = ({
  tasks,
  onUpdateBlockHeader,
}) => {
  const [cursor, setCursor] = useState(() => todayStr());
  const [mode, setMode] = useState<'week' | 'month'>('week');

  // 计算日期范围（YYYY-MM-DD 字符串数组）
  const dateRange = useMemo(() => {
    if (mode === 'week') {
      const start = getWeekStartStr(cursor);
      return Array.from({ length: 7 }, (_, i) => addDays(start, i));
    }
    // 月模式：显示当月所有天
    const { year: y, month: m } = splitDate(cursor);
    const daysInMonth = new Date(y, m, 0).getDate();
    const start = `${y}-${String(m).padStart(2, '0')}-01`;
    return Array.from({ length: daysInMonth }, (_, i) => addDays(start, i));
  }, [cursor, mode]);

  const todayString = todayStr();

  // 提取所有 SmartTaskBlock（附所属 taskId）
  const allBlocks = useMemo(() => {
    const result: (SmartTaskBlock & { _taskId: string })[] = [];
    for (const task of tasks) {
      const blocks = getSmartTaskBlocks(task.blocks ?? []);
      for (const b of blocks) {
        result.push({ ...b, _taskId: task.id });
      }
    }
    return result;
  }, [tasks]);

  // 提取所有标签
  const tags = useMemo(() => {
    const tagSet = new Set<string>();
    for (const b of allBlocks) {
      tagSet.add(b.header.tag);
    }
    return Array.from(tagSet);
  }, [allBlocks]);

  // 按标签 × 日期分组
  const matrix = useMemo(() => {
    const map = new Map<string, (SmartTaskBlock & { _taskId: string })[]>();
    for (const block of allBlocks) {
      const key = `${block.header.tag}::${block.header.date}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(block);
    }
    return map;
  }, [allBlocks]);

  // 检测落在当前显示范围外的 block（带有效日期）
  const offRangeInfo = useMemo(() => {
    const rangeStartStr = dateRange[0];
    const rangeEndStr = dateRange[dateRange.length - 1];
    const beforeBlocks: { date: string; count: number }[] = [];
    const afterBlocks: { date: string; count: number }[] = [];
    const tally = new Map<string, number>();
    for (const b of allBlocks) {
      const d = b.header.date;
      if (!d) continue;
      if (tally.has(d)) {
        tally.set(d, tally.get(d)! + 1);
      } else {
        tally.set(d, 1);
      }
    }
    for (const [d, count] of tally) {
      if (isBeforeDay(d, rangeStartStr)) beforeBlocks.push({ date: d, count });
      else if (isAfterDay(d, rangeEndStr)) afterBlocks.push({ date: d, count });
    }
    const totalBefore = beforeBlocks.reduce((s, x) => s + x.count, 0);
    const totalAfter = afterBlocks.reduce((s, x) => s + x.count, 0);
    // 距离 cursor 最近的 off-range 日期
    beforeBlocks.sort((a, b) => b.date.localeCompare(a.date)); // 最近的在前
    afterBlocks.sort((a, b) => a.date.localeCompare(b.date)); // 最近的在前
    return {
      totalBefore,
      totalAfter,
      nearestBefore: beforeBlocks[0]?.date,
      nearestAfter: afterBlocks[0]?.date,
      beforeDates: beforeBlocks.map(x => x.date),
      afterDates: afterBlocks.map(x => x.date),
    };
  }, [allBlocks, dateRange]);

  const hasOffRangeBlocks = offRangeInfo.totalBefore > 0 || offRangeInfo.totalAfter > 0;

  const handleToggle = useCallback(
    (taskId: string, blockId: string, isCompleted: boolean) => {
      const now = todayStr();
      onUpdateBlockHeader(taskId, blockId, {
        isCompleted: !isCompleted,
        completedDate: !isCompleted ? now : undefined,
      });
    },
    [onUpdateBlockHeader],
  );

  const jumpTo = useCallback((dateStr: string) => {
    setCursor(dateStr);
  }, []);

  const rangeLabel = mode === 'week'
    ? `${formatDate(dateRange[0], 'M.D')} - ${formatDate(dateRange[6], 'M.D')}`
    : (() => { const { year, month } = splitDate(cursor); return `${year}年${month}月`; })();

  return (
    <div className="wmv-container">
      {/* ── 顶部导航 ── */}
      <div className="wmv-nav">
        <button type="button" className="wmv-nav-btn" onClick={() => setCursor(c => mode === 'week' ? addDays(c, -7) : addMonths(c, -1))}>
          <ChevronLeft size={16} />
        </button>
        <span className="wmv-nav-label">{rangeLabel}</span>
        <button type="button" className="wmv-nav-btn" onClick={() => setCursor(c => mode === 'week' ? addDays(c, 7) : addMonths(c, 1))}>
          <ChevronRight size={16} />
        </button>
        <button type="button" className="wmv-nav-btn" onClick={() => setCursor(todayStr())}>
          今天
        </button>
        <div className="wmv-nav-right">
          {hasOffRangeBlocks && (
            <div
              className="wmv-offrange-capsule"
              title="有任务块不在当前显示范围，悬停查看详情"
            >
              <span className="wmv-offrange-capsule-icon">💡</span>
              <span className="wmv-offrange-capsule-count">
                {offRangeInfo.totalBefore + offRangeInfo.totalAfter}
              </span>
              <div className="wmv-offrange-popover">
                <div className="wmv-offrange-popover-text">
                  有 {offRangeInfo.totalBefore + offRangeInfo.totalAfter} 个智能任务块不在当前{mode === 'week' ? '周' : '月'}显示范围内
                </div>
                <div className="wmv-offrange-popover-actions">
                  {offRangeInfo.nearestBefore && (
                    <button
                      type="button"
                      className="wmv-offrange-btn wmv-offrange-btn--before"
                      onClick={() => jumpTo(offRangeInfo.nearestBefore!)}
                      title={`跳到最近的早期块：${offRangeInfo.nearestBefore}`}
                    >
                      ◀ 早期 {offRangeInfo.totalBefore} 个 · {offRangeInfo.beforeDates.length} 天
                    </button>
                  )}
                  {offRangeInfo.nearestAfter && (
                    <button
                      type="button"
                      className="wmv-offrange-btn wmv-offrange-btn--after"
                      onClick={() => jumpTo(offRangeInfo.nearestAfter!)}
                      title={`跳到最近的后期块：${offRangeInfo.nearestAfter}`}
                    >
                      后期 {offRangeInfo.totalAfter} 个 · {offRangeInfo.afterDates.length} 天 ▶
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
          <div className="wmv-mode-switch">
            <button
              type="button"
              className={`wmv-mode-btn ${mode === 'week' ? 'wmv-mode-btn--active' : ''}`}
              onClick={() => setMode('week')}
            >
              周
            </button>
            <button
              type="button"
              className={`wmv-mode-btn ${mode === 'month' ? 'wmv-mode-btn--active' : ''}`}
              onClick={() => setMode('month')}
            >
              月
            </button>
          </div>
        </div>
      </div>

      {/* ── 矩阵表格 ── */}
      <div className="wmv-matrix">
        {/* 表头 */}
        <div className="wmv-row wmv-row--header">
          <div className="wmv-cell wmv-cell--tag" />
          {dateRange.map((dateStr) => {
            const isToday = dateStr === todayString;
            const dow = getDayOfWeek(dateStr);
            const isWeekend = dow === 0 || dow === 6;
            return (
              <div
                key={dateStr}
                className={`wmv-cell wmv-cell--date ${isToday ? 'wmv-cell--today' : ''} ${isWeekend ? 'wmv-cell--weekend' : ''}`}
              >
                <span className="wmv-date-weekday">
                  {WEEKDAY_LABELS[dow === 0 ? 6 : dow - 1]}
                </span>
                <span className="wmv-date-num">{splitDate(dateStr).day}</span>
              </div>
            );
          })}
        </div>

        {/* 数据行（每标签一行） */}
        {tags.map((tag) => {
          const tagColor = getTagColor(tag);
          return (
            <div key={tag} className="wmv-row">
              <div className="wmv-cell wmv-cell--tag">
                <span className="wmv-tag-badge" style={{ backgroundColor: tagColor }}>
                  {tag}
                </span>
              </div>
              {dateRange.map((dateStr) => {
                const key = `${tag}::${dateStr}`;
                const blocks = matrix.get(key) ?? [];
                const dow = getDayOfWeek(dateStr);
                const isWeekend = dow === 0 || dow === 6;

                return (
                  <div
                    key={dateStr}
                    className={`wmv-cell ${isWeekend ? 'wmv-cell--weekend' : ''} ${blocks.length > 0 ? 'wmv-cell--has-data' : ''}`}
                  >
                    {blocks.map((block) => {
                      const h = block.header;
                      const isOverdue = !h.isCompleted && isBeforeDay(h.date, todayString);
                      return (
                        <div
                          key={block.id}
                          className={`wmv-block-card ${h.isCompleted ? 'wmv-block-card--done' : ''} ${isOverdue ? 'wmv-block-card--overdue' : ''} ${!h.graphNodeId ? 'wmv-block-card--unlinked' : ''}`}
                          style={{ backgroundColor: tagColor + '40', borderLeftColor: tagColor }}
                        >
                          {/* Header 行 */}
                          <div className="wmv-block-header">
                            <button
                              type="button"
                              className={`wmv-check ${h.isCompleted ? 'wmv-check--done' : ''}`}
                              onClick={() => handleToggle(block._taskId, block.id, h.isCompleted)}
                            >
                              {h.isCompleted && '✓'}
                            </button>
                            <span className={`wmv-block-title ${h.isCompleted ? 'wmv-block-title--done' : ''}`} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {h.title}
                              {!h.graphNodeId && (
                                <span title="未绑定节点" className="inline-flex items-center flex-shrink-0 opacity-40">
                                  <CircleDashed size={12} />
                                </span>
                              )}
                            </span>
                          </div>
                          {/* Meta 行 */}
                          <div className="wmv-block-meta">
                            <span>⏳{h.duration}m</span>
                          </div>
                          {/* Body 完整内容 */}
                          {block.body && (
                            <div className="wmv-block-body">
                              <div dangerouslySetInnerHTML={{
                                __html: sanitizeHtml(block.body),
                              }} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          );
        })}

        {/* 空状态 */}
        {tags.length === 0 && (
          <div className="wmv-empty">
            <CalendarDays size={48} />
            <p>暂无智能任务块</p>
            <p className="wmv-empty-hint">在项目文档中添加智能任务块后，它们会自动出现在这里</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default WeekMatrixView;

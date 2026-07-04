// ============================================================
// 周矩阵视图（Week Matrix View）
// 行 = 标签，列 = 日期，格子 = 智能任务块卡片（含 Body）
// 数据来源：所有 Task 的 SmartTaskBlock
// ============================================================

import React, { useState, useMemo, useCallback } from 'react';
import dayjs from 'dayjs';
import { ChevronLeft, ChevronRight, CalendarDays } from 'lucide-react';
import type { Task, SmartTaskBlock, SmartTaskHeader } from '@/types';
import {
  getSmartTaskBlocks,
  getTagColor,
} from '@/utils/blocks';

interface WeekMatrixViewProps {
  tasks: Task[];
  onUpdateBlockHeader: (taskId: string, blockId: string, patch: Partial<SmartTaskHeader>) => void;
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function getWeekStart(date: dayjs.Dayjs): dayjs.Dayjs {
  const d = date.day();
  const offset = d === 0 ? -6 : 1 - d;
  return date.add(offset, 'day');
}

const WeekMatrixView: React.FC<WeekMatrixViewProps> = ({
  tasks,
  onUpdateBlockHeader,
}) => {
  const [cursor, setCursor] = useState(() => dayjs());
  const [mode, setMode] = useState<'week' | 'month'>('week');

  // 计算日期范围
  const dateRange = useMemo(() => {
    if (mode === 'week') {
      const start = getWeekStart(cursor);
      return Array.from({ length: 7 }, (_, i) => start.add(i, 'day'));
    }
    // 月模式：显示当月所有天
    const start = cursor.startOf('month');
    const daysInMonth = cursor.daysInMonth();
    return Array.from({ length: daysInMonth }, (_, i) => start.add(i, 'day'));
  }, [cursor, mode]);

  const today = dayjs().format('YYYY-MM-DD');

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

  const handleToggle = useCallback(
    (taskId: string, blockId: string, isCompleted: boolean) => {
      const now = dayjs().format('YYYY-MM-DD');
      onUpdateBlockHeader(taskId, blockId, {
        isCompleted: !isCompleted,
        completedDate: !isCompleted ? now : undefined,
      });
    },
    [onUpdateBlockHeader],
  );

  const rangeLabel = mode === 'week'
    ? `${dateRange[0].format('M.D')} - ${dateRange[6].format('M.D')}`
    : cursor.format('YYYY年M月');

  return (
    <div className="wmv-container">
      {/* ── 顶部导航 ── */}
      <div className="wmv-nav">
        <button type="button" className="wmv-nav-btn" onClick={() => setCursor(c => mode === 'week' ? c.subtract(1, 'week') : c.subtract(1, 'month'))}>
          <ChevronLeft size={16} />
        </button>
        <span className="wmv-nav-label">{rangeLabel}</span>
        <button type="button" className="wmv-nav-btn" onClick={() => setCursor(c => mode === 'week' ? c.add(1, 'week') : c.add(1, 'month'))}>
          <ChevronRight size={16} />
        </button>
        <button type="button" className="wmv-nav-btn" onClick={() => setCursor(dayjs())}>
          今天
        </button>
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

      {/* ── 矩阵表格 ── */}
      <div className="wmv-matrix">
        {/* 表头 */}
        <div className="wmv-row wmv-row--header">
          <div className="wmv-cell wmv-cell--tag" />
          {dateRange.map((d) => {
            const dateStr = d.format('YYYY-MM-DD');
            const isToday = dateStr === today;
            const isWeekend = d.day() === 0 || d.day() === 6;
            return (
              <div
                key={dateStr}
                className={`wmv-cell wmv-cell--date ${isToday ? 'wmv-cell--today' : ''} ${isWeekend ? 'wmv-cell--weekend' : ''}`}
              >
                <span className="wmv-date-weekday">
                  {WEEKDAY_LABELS[d.day() === 0 ? 6 : d.day() - 1]}
                </span>
                <span className="wmv-date-num">{d.format('D')}</span>
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
              {dateRange.map((d) => {
                const dateStr = d.format('YYYY-MM-DD');
                const key = `${tag}::${dateStr}`;
                const blocks = matrix.get(key) ?? [];
                const isWeekend = d.day() === 0 || d.day() === 6;

                return (
                  <div
                    key={dateStr}
                    className={`wmv-cell ${isWeekend ? 'wmv-cell--weekend' : ''} ${blocks.length > 0 ? 'wmv-cell--has-data' : ''}`}
                  >
                    {blocks.map((block) => {
                      const h = block.header;
                      const isOverdue = !h.isCompleted && dayjs(h.date).isBefore(dayjs(), 'day');
                      return (
                        <div
                          key={block.id}
                          className={`wmv-block-card ${h.isCompleted ? 'wmv-block-card--done' : ''} ${isOverdue ? 'wmv-block-card--overdue' : ''}`}
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
                            <span className={`wmv-block-title ${h.isCompleted ? 'wmv-block-title--done' : ''}`}>
                              {h.title}
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
                                __html: block.body,
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

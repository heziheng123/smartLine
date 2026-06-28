// ============================================================
// Ebb - 矩阵视图
// 筛选栏 + 标签统计 + 主题任务列表（圆形进度环卡片）
// ============================================================

import React, { useState, useMemo } from 'react';
import { Search, ChevronRight } from 'lucide-react';
import type { ReviewTask, EbbSettings, TopicStat } from '../types';
import {
  computeTopicStats,
  computeTagStats,
  computeRounds,
  isOverdue,
  isDueToday,
  getDateLabel,
} from '../scheduler';
import { getPointWeight } from '../complexity';
import { ROUND_COLORS } from '../constants';

export interface TaskActions {
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onReschedule: (id: string) => void;
  onAddRound: (task: ReviewTask) => void;
  onOpenRounds: (task: ReviewTask) => void;
  onOpenTimeline: (topicName: string) => void;
}

interface MatrixViewProps {
  tasks: ReviewTask[];
  settings: EbbSettings;
  taskActions: TaskActions;
}

type FilterStatus = 'all' | 'pending' | 'completed';
type SortBy = 'date' | 'ratio';

const MatrixView: React.FC<MatrixViewProps> = ({ tasks, settings, taskActions }) => {
  const [filterTag, setFilterTag] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [query, setQuery] = useState('');

  const tagStats = useMemo(() => computeTagStats(tasks), [tasks]);

  // 主题统计（带筛选）
  const topicStats = useMemo(() => {
    let list = computeTopicStats(tasks, settings);
    if (filterTag) list = list.filter((t) => (t.tag || '') === filterTag);
    if (filterStatus === 'pending') {
      list = list.filter((t) => t.completedRounds < t.totalRounds);
    } else if (filterStatus === 'completed') {
      list = list.filter((t) => t.completedRounds === t.totalRounds && t.totalRounds > 0);
    }
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter((t) => t.topicName.toLowerCase().includes(q) || (t.tag || '').toLowerCase().includes(q));
    }
    if (sortBy === 'date') {
      list = [...list].sort((a, b) => (a.nextDueDate || '9999').localeCompare(b.nextDueDate || '9999'));
    } else {
      list = [...list].sort((a, b) => a.ratio - b.ratio);
    }
    return list;
  }, [tasks, settings, filterTag, filterStatus, query, sortBy]);

  return (
    <div className="eb-matrix">
      {/* 筛选栏 */}
      <div className="eb-filter-bar">
        <div className="eb-filter-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="搜索主题..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select className="eb-filter-select" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
          <option value="">全部标签</option>
          {tagStats.filter((t) => t.tag).map((t) => (
            <option key={t.tag} value={t.tag}>{t.tag} ({t.total})</option>
          ))}
        </select>
        <select className="eb-filter-select" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as FilterStatus)}>
          <option value="all">全部状态</option>
          <option value="pending">待复习</option>
          <option value="completed">已完成</option>
        </select>
        <select className="eb-filter-select" value={sortBy} onChange={(e) => setSortBy(e.target.value as SortBy)}>
          <option value="date">按日期排序</option>
          <option value="ratio">按完成率排序</option>
        </select>
      </div>

      {/* 标签统计卡片 */}
      {tagStats.length > 0 && (
        <div className="eb-tag-stats">
          {tagStats.map((ts) => {
            const color = ts.tag ? settings.tagColors[ts.tag] : '#9CA3AF';
            return (
              <button
                key={ts.tag || '__none__'}
                type="button"
                className={`eb-tag-stat ${filterTag === (ts.tag || '') ? 'eb-tag-stat--active' : ''}`}
                onClick={() => setFilterTag(filterTag === (ts.tag || '') ? '' : (ts.tag || ''))}
              >
                <span className="eb-tag-stat-color" style={{ backgroundColor: color }} />
                <span className="eb-tag-stat-name">{ts.tag || '无标签'}</span>
                <span className="eb-tag-stat-ratio">{ts.completed}/{ts.total}</span>
                <div className="eb-tag-stat-bar">
                  <div className="eb-tag-stat-fill" style={{ width: `${ts.ratio * 100}%`, backgroundColor: color }} />
                </div>
                <span className="eb-tag-stat-pending">{ts.pending}待复习</span>
              </button>
            );
          })}
        </div>
      )}

      {/* 主题任务列表 */}
      <div className="eb-topic-list">
        {topicStats.length === 0 ? (
          <div className="eb-empty">
            <p>暂无复习任务</p>
            <p className="eb-empty-hint">点击右上角「快速添加」创建第一个复习任务</p>
          </div>
        ) : (
          topicStats.map((stat) => (
            <TopicRow
              key={stat.topicName}
              stat={stat}
              tasks={tasks}
              settings={settings}
              taskActions={taskActions}
            />
          ))
        )}
      </div>
    </div>
  );
};

// ── 主题行（圆形进度环 + 任务卡片）──────────────────────────
interface TopicRowProps {
  stat: TopicStat;
  tasks: ReviewTask[];
  settings: EbbSettings;
  taskActions: TaskActions;
}

const TopicRow: React.FC<TopicRowProps> = ({ stat, tasks, settings, taskActions }) => {
  const [expanded, setExpanded] = useState(false);
  const { roundMap, totalRoundsMap } = useMemo(() => computeRounds(tasks), [tasks]);

  const topicTasks = useMemo(
    () => tasks.filter((t) => t.topicName === stat.topicName).sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    [tasks, stat.topicName],
  );

  const tagColor = stat.tag ? settings.tagColors[stat.tag] : undefined;
  const ratio = stat.ratio;
  // 进度环颜色：100% 绿色 / 50-99% 蓝色 / <50% 红色
  const ringColor = ratio >= 1 ? '#10B981' : ratio >= 0.5 ? '#3B82F6' : '#EF4444';

  // 当前待复习任务（最早未完成）
  const nextTask = topicTasks.find((t) => !t.isCompleted);
  const isNextOverdue = nextTask ? isOverdue(nextTask) : false;
  const isNextToday = nextTask ? isDueToday(nextTask) : false;
  const isAllDone = stat.completedRounds === stat.totalRounds && stat.totalRounds > 0;

  // 左边框颜色
  const accentColor = isAllDone ? '#10B981' : isNextOverdue ? '#EF4444' : isNextToday ? '#F59E0B' : '#3B82F6';

  return (
    <div className={`eb-topic-row ${expanded ? 'eb-topic-row--expanded' : ''}`} style={{ '--accent': accentColor } as React.CSSProperties}>
      <div className="eb-topic-row-main" onClick={() => setExpanded(!expanded)}>
        {/* 圆形进度环 */}
        <div className="eb-progress-ring" style={{ '--ring-color': ringColor } as React.CSSProperties}>
          <svg viewBox="0 0 36 36">
            <circle className="eb-progress-ring-bg" cx="18" cy="18" r="15.9" />
            <circle
              className="eb-progress-ring-fg"
              cx="18" cy="18" r="15.9"
              strokeDasharray={`${ratio * 100} 100`}
            />
          </svg>
          <span className="eb-progress-ring-text">{Math.round(ratio * 100)}%</span>
        </div>

        {/* 主题信息 */}
        <div className="eb-topic-row-info">
          <div className="eb-topic-row-header">
            <span className="eb-topic-row-name">{stat.topicName}</span>
            {stat.tag && (
              <span className="eb-topic-row-tag" style={tagColor ? { backgroundColor: `${tagColor}40`, color: '#374151' } : undefined}>
                {stat.tag}
              </span>
            )}
          </div>
          <div className="eb-topic-row-meta">
            {isAllDone ? (
              <span className="eb-topic-row-status eb-topic-row-status--done">✅ 已完成全部 {stat.totalRounds} 轮</span>
            ) : nextTask ? (
              <>
                <span className={`eb-topic-row-status ${isNextOverdue ? 'eb-topic-row-status--overdue' : isNextToday ? 'eb-topic-row-status--today' : ''}`}>
                  {isNextOverdue ? '逾期' : isNextToday ? '今天' : '下次'} {nextTask.dueDate}
                </span>
                <span className="eb-topic-row-rounds">
                  {stat.completedRounds}/{stat.totalRounds} 轮
                </span>
              </>
            ) : null}
            {stat.totalPoints > 0 && (
              <span className="eb-topic-row-points">{stat.earnedPoints}/{stat.totalPoints}分</span>
            )}
          </div>
        </div>

        {/* 展开/收起 */}
        <ChevronRight size={16} className={`eb-topic-row-chevron ${expanded ? 'eb-topic-row-chevron--open' : ''}`} />
      </div>

      {/* 展开后的任务卡片列表 */}
      {expanded && (
        <div className="eb-topic-rounds">
          {topicTasks.map((t) => {
            const round = roundMap.get(t.id) ?? 0;
            const total = totalRoundsMap.get(t.topicName) ?? 0;
            const points = t.complexity ? getPointWeight(round, t.complexity, settings.complexityConfigs) : 0;
            const dateLabel = getDateLabel(t.dueDate, t.isCompleted);
            const color = ROUND_COLORS[(round - 1) % ROUND_COLORS.length];
            return (
              <div key={t.id} className={`eb-round-item ${t.isCompleted ? 'eb-round-item--done' : ''} ${isOverdue(t) ? 'eb-round-item--overdue' : ''}`}>
                <span className="eb-round-item-dot" style={{ backgroundColor: color }} />
                <span className="eb-round-item-num">R{round}/{total}</span>
                <input
                  type="checkbox"
                  checked={t.isCompleted}
                  onChange={() => taskActions.onToggle(t.id)}
                  className="eb-round-item-check"
                />
                <span className={`eb-round-item-date eb-date-pill eb-date-pill--${dateLabel.variant}`}>
                  {dateLabel.text}
                </span>
                <span className="eb-round-item-points">{points}分</span>
                <div className="eb-round-item-actions">
                  <button type="button" className="eb-icon-btn" onClick={() => taskActions.onReschedule(t.id)} title="改期">📅</button>
                  <button type="button" className="eb-icon-btn" onClick={() => taskActions.onAddRound(t)} title="追加">➕</button>
                  <button type="button" className="eb-icon-btn" onClick={() => taskActions.onOpenRounds(t)} title="轮次">⚙️</button>
                  <button type="button" className="eb-icon-btn" onClick={() => taskActions.onOpenTimeline(t.topicName)} title="时间线">▶️</button>
                  <button type="button" className="eb-icon-btn eb-icon-btn--danger" onClick={() => taskActions.onDelete(t.id)} title="删除">🗑️</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default MatrixView;

// ============================================================
// Ebb - 矩阵视图
// 筛选栏 + 标签统计 + 主题任务列表（圆形进度环卡片）
// ============================================================

import React, { useState, useMemo, memo, useDeferredValue, useEffect, useRef } from 'react';
import { Search, ChevronRight, CircleDashed, Clock3, CalendarRange, Plus, RotateCcw } from 'lucide-react';
import type { ReviewTask, EbbSettings, TopicStat } from '../types';
import {
  computeTopicStats,
  computeTagStats,
  getReviewTopicKey,
  isOverdue,
  isDueToday,
} from '../scheduler';
import { useGraphStore } from '../../graph/store';
import { todayStr } from '../../utils/dateSafe';
import {
  buildRootNodeMap,
  getReviewCategoryColor,
  resolveReviewCategory,
  type ReviewCategory,
} from '../category';

export interface TaskActions {
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onReschedule: (id: string) => void;
  onAddRound: (task: ReviewTask) => void;
  onOpenRounds: (task: ReviewTask) => void;
  onOpenTimeline: (topicKey: string) => void;
}

interface MatrixViewProps {
  tasks: ReviewTask[];
  settings: EbbSettings;
  taskActions: TaskActions;
  selectedDate?: string;
  isUnlinkedTask?: (sourceId: string) => boolean;
}

type FilterStatus = 'all' | 'pending' | 'completed';
type SortBy = 'date' | 'ratio';

const MatrixView: React.FC<MatrixViewProps> = ({ tasks, settings, taskActions, selectedDate }) => {
  const [filterTag, setFilterTag] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [visibleCount, setVisibleCount] = useState(80);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const nodes = useGraphStore((state) => state.nodes);

  const rootByNodeId = useMemo(() => buildRootNodeMap(nodes), [nodes]);

  // 所有 EBB 视图共用同一分类规则：知识节点取大盘根节点，独立内容取手动标签。
  const enhancedTasks = useMemo(() => {
    return tasks.map(task => {
      const category = resolveReviewCategory(task, rootByNodeId);
      return category ? { ...task, tag: category.label } : task;
    });
  }, [tasks, rootByNodeId]);

  const categoryByLabel = useMemo(() => {
    const map = new Map<string, ReviewCategory>();
    for (const task of tasks) {
      const category = resolveReviewCategory(task, rootByNodeId);
      if (category) map.set(category.label, category);
    }
    return map;
  }, [tasks, rootByNodeId]);

  const tagStats = useMemo(() => computeTagStats(enhancedTasks), [enhancedTasks]);

  const topicTasksMap = useMemo(() => {
    const m = new Map<string, ReviewTask[]>();
    for (const t of enhancedTasks) {
      const topicKey = getReviewTopicKey(t);
      const list = m.get(topicKey);
      if (list) list.push(t);
      else m.set(topicKey, [t]);
    }
    // 每个主题内部按 dueDate 排序
    for (const list of m.values()) {
      list.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    }
    return m;
  }, [enhancedTasks]);

  // 主题统计（带筛选）
  const topicStats = useMemo(() => {
    let list = computeTopicStats(enhancedTasks, settings);
    if (filterTag) list = list.filter((t) => (t.tag || '') === filterTag);
    if (filterStatus === 'pending') {
      list = list.filter((t) => t.completedRounds < t.totalRounds);
    } else if (filterStatus === 'completed') {
      list = list.filter((t) => t.completedRounds === t.totalRounds && t.totalRounds > 0);
    }
    if (deferredQuery.trim()) {
      const q = deferredQuery.trim().toLowerCase();
      list = list.filter((t) => t.topicName.toLowerCase().includes(q) || (t.tag || '').toLowerCase().includes(q));
    }
    if (sortBy === 'date') {
      list = [...list].sort((a, b) => (a.nextDueDate || '9999').localeCompare(b.nextDueDate || '9999'));
    } else {
      list = [...list].sort((a, b) => a.ratio - b.ratio);
    }
    return list;
  }, [enhancedTasks, settings, filterTag, filterStatus, deferredQuery, sortBy]);

  useEffect(() => setVisibleCount(80), [filterTag, filterStatus, deferredQuery, sortBy]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || visibleCount >= topicStats.length) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((count) => Math.min(topicStats.length, count + 80));
      }
    }, { rootMargin: '320px 0px' });
    observer.observe(target);
    return () => observer.disconnect();
  }, [topicStats.length, visibleCount]);

  const visibleTopicStats = useMemo(() => topicStats.slice(0, visibleCount), [topicStats, visibleCount]);

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
            const color = ts.tag
              ? getReviewCategoryColor(categoryByLabel.get(ts.tag) ?? null, settings.tagColors)
              : '#9CA3AF';
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
          visibleTopicStats.map((stat) => {
            const topicTasks = topicTasksMap.get(stat.topicKey) ?? [];
            const category = topicTasks[0]
              ? resolveReviewCategory(topicTasks[0], rootByNodeId)
              : null;
            return (
              <TopicRow
                key={stat.topicKey}
                stat={stat}
                tagColor={getReviewCategoryColor(category, settings.tagColors)}
                topicTasks={topicTasks}
                taskActions={taskActions}
                selectedDate={selectedDate}
              />
            );
          })
        )}
        {visibleCount < topicStats.length && (
          <div ref={loadMoreRef} className="py-4 text-center text-xs text-slate-400" role="status">
            已显示 {visibleCount}/{topicStats.length} 个主题，继续滚动加载
          </div>
        )}
      </div>
    </div>
  );
};

// ── 主题行（圆形进度环 + 任务卡片）──────────────────────────
interface TopicRowProps {
  stat: TopicStat;
  tagColor?: string;
  topicTasks: ReviewTask[];
  taskActions: TaskActions;
  selectedDate?: string;
}

const TopicRow: React.FC<TopicRowProps> = memo(({ stat, tagColor, topicTasks, taskActions, selectedDate }) => {
  const [expanded, setExpanded] = useState(false);

  const ratio = stat.ratio;
  // 进度环颜色：100% 绿色 / 50-99% 蓝色 / <50% 红色
  const ringColor = ratio >= 1 ? '#10B981' : ratio >= 0.5 ? '#3B82F6' : '#EF4444';

  // 当前待复习任务（最早未完成）
  const nextTask = topicTasks.find((t) => !t.isCompleted);
  const isNextOverdue = nextTask ? isOverdue(nextTask) : false;
  const isNextToday = nextTask ? isDueToday(nextTask) : false;
  const isAllDone = stat.completedRounds === stat.totalRounds && stat.totalRounds > 0;
  const hasSelectedDate = Boolean(selectedDate && topicTasks.some((task) => task.dueDate === selectedDate));

  // 左边框颜色
  const accentColor = isAllDone ? '#10B981' : isNextOverdue ? '#EF4444' : isNextToday ? '#F59E0B' : '#3B82F6';

  // 检查是否未绑定节点（优先检查待复习任务，若无则检查最新的任务，避免历史包袱干扰）
  const taskToCheck = nextTask || topicTasks[topicTasks.length - 1];
  const isUnlinked = taskToCheck ? !taskToCheck.graphNodeId : false;
  const latestCompletedTask = [...topicTasks]
    .filter((task) => task.isCompleted)
    .sort((a, b) =>
      (b.roundOrder ?? 0) - (a.roundOrder ?? 0)
      || (b.completedDate || '').localeCompare(a.completedDate || '')
      || (b.dueDate || '').localeCompare(a.dueDate || ''),
    )[0];

  return (
    <div className={`eb-topic-row ${expanded ? 'eb-topic-row--expanded' : ''} ${isUnlinked ? 'eb-topic-row--unlinked' : ''} ${hasSelectedDate ? 'is-date-match' : ''}`} style={{ '--accent': accentColor, contentVisibility: 'auto', containIntrinsicSize: '92px' } as React.CSSProperties}>
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
            <span className="eb-topic-row-name" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              {stat.topicName}
              {isUnlinked && (
                <span title="未绑定节点" className="inline-flex items-center opacity-40">
                  <CircleDashed size={14} />
                </span>
              )}
            </span>
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
                {stat.nextDurationMinutes && <span className="eb-topic-row-rounds"><Clock3 size={12} />{stat.nextDurationMinutes} 分钟</span>}
              </>
            ) : null}
            {stat.totalPoints > 0 && (
              <span className="eb-topic-row-points">{stat.earnedPoints}/{stat.totalPoints}分</span>
            )}
          </div>
        </div>

        {/* 展开/收起 */}
        <div
          className="eb-round-actions"
          style={{ opacity: 1 }}
          onClick={(event) => event.stopPropagation()}
        >
          {latestCompletedTask && (
            <button
              type="button"
              className="eb-icon-btn"
              onClick={() => taskActions.onToggle(latestCompletedTask.id)}
              title="取消最近一轮完成"
              aria-label={`取消${stat.topicName}最近一轮完成`}
            >
              <RotateCcw size={14} />
            </button>
          )}
          {taskToCheck && (
            <>
              <button
                type="button"
                className="eb-icon-btn"
                onClick={() => taskActions.onAddRound(taskToCheck)}
                title="追加一轮"
                aria-label={`为${stat.topicName}追加一轮`}
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                className="eb-plan-primary-action"
                onClick={() => taskActions.onOpenRounds(taskToCheck)}
                title="重新安排剩余轮次"
                aria-label={`重新安排${stat.topicName}的剩余轮次`}
              >
                <CalendarRange size={14} />重新安排
              </button>
            </>
          )}
        </div>
        <ChevronRight size={16} className={`eb-topic-row-chevron ${expanded ? 'eb-topic-row-chevron--open' : ''}`} />
      </div>

      {/* 展开后的知识聚合抽屉（降噪处理） */}
      {expanded && (
        <div className="eb-topic-drawer p-3 bg-white/50 border-t border-gray-100 rounded-b-xl shadow-inner backdrop-blur-sm">
          <div className="flex flex-col gap-2">
            <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Review Plan</div>
            <div className="flex flex-wrap gap-1.5">
              {topicTasks.map((t, idx) => {
                const isPast = t.isCompleted;
                const isOverdue = !isPast && t.dueDate < todayStr();
                const isToday = !isPast && t.dueDate === todayStr();
                const isFuture = !isPast && t.dueDate > todayStr();
                
                let ringColor = 'border-gray-200 text-gray-400';
                let bgColor = 'bg-white';
                
                if (isPast) {
                  ringColor = 'border-emerald-200 text-emerald-600';
                  bgColor = 'bg-emerald-50/50';
                } else if (isOverdue) {
                  ringColor = 'border-rose-300 text-rose-600 shadow-sm shadow-rose-100';
                  bgColor = 'bg-rose-50';
                } else if (isToday) {
                  ringColor = 'border-blue-400 text-blue-600 shadow-sm shadow-blue-100';
                  bgColor = 'bg-blue-50';
                } else if (isFuture) {
                  ringColor = 'border-blue-100 text-blue-400 border-dashed';
                  bgColor = 'bg-white';
                }

                return (
                  <button
                    type="button"
                    key={t.id}
                    className={`flex flex-col items-center justify-center w-14 h-14 rounded-full border-[1.5px] ${ringColor} ${bgColor} ${selectedDate === t.dueDate ? 'ring-2 ring-indigo-300 ring-offset-1' : ''} transition-all`}
                    onClick={() => taskActions.onToggle(t.id)}
                    title={t.isCompleted ? `取消第 ${idx + 1} 轮完成` : `标记第 ${idx + 1} 轮完成`}
                    aria-label={t.isCompleted ? `取消第 ${idx + 1} 轮完成` : `标记第 ${idx + 1} 轮完成`}
                  >
                    <span className="text-[10px] font-medium leading-none mb-0.5">R{idx + 1}</span>
                    <span className="text-[8px] opacity-70 leading-none">
                      {t.dueDate.slice(5).replace('-', '.')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

export default MatrixView;

// ============================================================
// Ebb - 矩阵视图
// 筛选栏 + 标签统计 + 主题任务列表（圆形进度环卡片）
// ============================================================

import React, { useState, useMemo, memo } from 'react';
import { Search, ChevronRight, CircleDashed } from 'lucide-react';
import type { ReviewTask, EbbSettings, TopicStat } from '../types';
import {
  computeTopicStats,
  computeTagStats,
  isOverdue,
  isDueToday,
} from '../scheduler';

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
  isUnlinkedTask?: (sourceId: string) => boolean;
}

type FilterStatus = 'all' | 'pending' | 'completed';
type SortBy = 'date' | 'ratio';

const MatrixView: React.FC<MatrixViewProps> = ({ tasks, settings, taskActions, isUnlinkedTask }) => {
  const [filterTag, setFilterTag] = useState<string>('');
  const [filterStatus, setFilterStatus] = useState<FilterStatus>('all');
  const [sortBy, setSortBy] = useState<SortBy>('date');
  const [query, setQuery] = useState('');

  const tagStats = useMemo(() => computeTagStats(tasks), [tasks]);

  const topicTasksMap = useMemo(() => {
    const m = new Map<string, ReviewTask[]>();
    for (const t of tasks) {
      const list = m.get(t.topicName);
      if (list) list.push(t);
      else m.set(t.topicName, [t]);
    }
    // 每个主题内部按 dueDate 排序
    for (const list of m.values()) {
      list.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
    }
    return m;
  }, [tasks]);

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
              settings={settings}
              taskActions={taskActions}
              topicTasks={topicTasksMap.get(stat.topicName) ?? []}
              isUnlinkedTask={isUnlinkedTask}
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
  settings: EbbSettings;
  taskActions: TaskActions;
  topicTasks: ReviewTask[];
  isUnlinkedTask?: (sourceId: string) => boolean;
}

const TopicRow: React.FC<TopicRowProps> = memo(({ stat, settings, taskActions, topicTasks, isUnlinkedTask }) => {
  const [expanded, setExpanded] = useState(false);

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

  // 检查是否未绑定节点（优先检查待复习任务，若无则检查最新的任务，避免历史包袱干扰）
  const taskToCheck = nextTask || topicTasks[topicTasks.length - 1];
  const isUnlinked = taskToCheck ? !taskToCheck.graphNodeId : false;

  return (
    <div className={`eb-topic-row ${expanded ? 'eb-topic-row--expanded' : ''} ${isUnlinked ? 'eb-topic-row--unlinked' : ''}`} style={{ '--accent': accentColor } as React.CSSProperties}>
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

      {/* 展开后的知识聚合抽屉（降噪处理） */}
      {expanded && (
        <div className="eb-topic-drawer p-3 bg-white/50 border-t border-gray-100 rounded-b-xl shadow-inner backdrop-blur-sm">
          {(() => {
            const firstTask = topicTasks[0];
            const accumulatedNotes = firstTask?.accumulatedNotes || [];
            
            return (
              <div className="flex flex-col">
                {accumulatedNotes.length > 0 ? (
                  <div className="flex flex-col">
                    <div className="text-[11px] font-semibold text-gray-400 mb-1.5 uppercase tracking-wider">History</div>
                    <div className="flex flex-col bg-white rounded-lg border border-gray-100 shadow-sm overflow-hidden">
                      {accumulatedNotes.map((note, idx) => {
                         let data = { date: '', type: '', typeLabel: '记录', title: '未知记录', notes: note };
                         try {
                           if (note.startsWith('{')) {
                             data = JSON.parse(note);
                           } else {
                             // fallback for old format
                             const match = note.match(/\[(.*?) (.*?)\]:\s*(.*)/);
                             if (match) {
                               data.date = match[1];
                               data.typeLabel = match[2];
                               data.notes = match[3];
                             }
                           }
                         } catch {
                           // ignore error
                         }

                         const isExercise = data.type === 'exercise' || data.typeLabel.includes('做题');
                         const isNote = data.type === 'note' || data.typeLabel.includes('笔记');
                         const typeText = '记录';
                         const badgeColor = 'bg-gray-50 text-gray-600 border-gray-200';
                         
                         return (
                           <div key={idx} className="flex flex-col p-2.5 border-b border-gray-50 last:border-0 hover:bg-gray-50/50 transition-colors">
                             <div className="flex items-baseline justify-between gap-2">
                               <div className="flex items-center gap-1.5 overflow-hidden">
                                 <span className={`text-[10px] px-1.5 py-0.5 rounded border font-medium whitespace-nowrap ${badgeColor}`}>
                                   {typeText}
                                 </span>
                                 <span className="text-xs font-medium text-gray-700 truncate">{data.title}</span>
                               </div>
                               <span className="text-[10px] text-gray-400 font-mono whitespace-nowrap shrink-0">{data.date}</span>
                             </div>
                             {data.notes && (
                               <div className="text-xs text-gray-500 leading-relaxed whitespace-pre-wrap mt-1.5 pl-1 border-l-2 border-gray-100">
                                 {data.notes}
                               </div>
                             )}
                           </div>
                         );
                       })}
                    </div>
                  </div>
                ) : (
                  <div className="text-xs text-gray-400 italic py-2 text-center bg-white/50 rounded-lg border border-gray-100 border-dashed">
                    暂无输出型学习记录
                  </div>
                )}
                
                {nextTask && (
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium py-1.5 px-4 rounded-md shadow-sm transition-all flex items-center gap-1.5"
                      onClick={(e) => {
                        e.stopPropagation();
                        taskActions.onToggle(nextTask.id);
                        setExpanded(false);
                      }}
                    >
                      <span className="opacity-80">✓</span> 已掌握 (下一轮)
                    </button>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
});

export default MatrixView;

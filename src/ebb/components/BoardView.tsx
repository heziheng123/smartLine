// ============================================================
// Ebb - 看板视图
// 三列（待复习/进行中/已完成）+ 拖拽改状态 + 标签泳道
// 每个主题只显示一张卡片（按主题聚合，非按轮次）
// ============================================================

import React, { useState, useMemo, Component, ErrorInfo, ReactNode } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import { Search, Tag } from 'lucide-react';
import type { ReviewTask, EbbSettings, ComplexityLevel } from '../types';
import { computeRounds, isOverdue, isDueToday, getDateLabel } from '../scheduler';
import { getPointWeight } from '../complexity';
import { ROUND_COLORS } from '../constants';
import type { TaskActions } from './MatrixView';

// ── 错误边界（捕获渲染异常，避免白屏）──────────────────────
class BoardErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    // 占位：错误已记录在 state 中展示
    void info;
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, color: '#991B1B', background: '#FEE2E2', borderRadius: 8, margin: 16, fontFamily: 'monospace', whiteSpace: 'pre-wrap', fontSize: 12 }}>
          <strong>BoardView 渲染错误：</strong>
          {'\n\n'}
          {this.state.error.message}
          {'\n\n'}
          {this.state.error.stack}
        </div>
      );
    }
    return this.props.children;
  }
}

interface BoardViewProps {
  tasks: ReviewTask[];
  settings: EbbSettings;
  taskActions: TaskActions;
}

/** 主题聚合后的看板卡片数据 */
interface TopicCardData {
  topicName: string;
  tag?: string;
  complexity?: ComplexityLevel;
  group: ReviewTask[];
  totalRounds: number;
  completedRounds: number;
  /** 下一轮待完成的任务（最早未完成的轮次） */
  nextTask?: ReviewTask;
  nextRound: number;
  /** 是否有今日/逾期未完成任务 */
  hasUrgent: boolean;
  /** 主题总积分 */
  totalPoints: number;
  earnedPoints: number;
  /** 累积的复习笔记/错题 */
  accumulatedNotes: string[];
}

const BoardView: React.FC<BoardViewProps> = ({ tasks, settings, taskActions }) => {
  const [query, setQuery] = useState('');
  const [groupByTag, setGroupByTag] = useState(false);

  const { roundMap, totalRoundsMap } = useMemo(() => computeRounds(tasks), [tasks]);

  // 按主题聚合 + 三列拆分
  const columns = useMemo(() => {
    // 1. 按 topicName 聚合
    const byTopic = new Map<string, ReviewTask[]>();
    for (const t of tasks) {
      if (!byTopic.has(t.topicName)) byTopic.set(t.topicName, []);
      byTopic.get(t.topicName)!.push(t);
    }

    // 2. 为每个主题计算聚合数据
    const topicCards: TopicCardData[] = [];
    for (const [topicName, group] of byTopic) {
      const totalRounds = totalRoundsMap.get(topicName) ?? group.length;
      const completedTasks = group.filter((t) => t.isCompleted);
      const completedRounds = completedTasks.length;
      const uncompleted = group
        .filter((t) => !t.isCompleted)
        .sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
      const nextTask = uncompleted[0];
      const nextRound = nextTask ? roundMap.get(nextTask.id) ?? 0 : 0;
      const hasUrgent = uncompleted.some((t) => isOverdue(t) || isDueToday(t));

      // 积分计算
      let totalPoints = 0;
      let earnedPoints = 0;
      for (const t of group) {
        const r = roundMap.get(t.id) ?? 0;
        if (t.complexity) {
          const w = getPointWeight(r, t.complexity, settings.complexityConfigs);
          totalPoints += w;
          if (t.isCompleted) earnedPoints += w;
        }
      }

      const firstTask = group[0];
      const accumulatedNotes = firstTask?.accumulatedNotes || [];
      topicCards.push({
        topicName,
        tag: firstTask?.tag,
        complexity: firstTask?.complexity,
        group,
        totalRounds,
        completedRounds,
        nextTask,
        nextRound,
        hasUrgent,
        totalPoints,
        earnedPoints,
        accumulatedNotes,
      });
    }

    // 3. 三列分类（主题级别）
    const pending: TopicCardData[] = [];   // 待复习：有今日/逾期未完成
    const progress: TopicCardData[] = [];  // 进行中：未完成但无今日/逾期（未来轮次）
    const done: TopicCardData[] = [];      // 已完成：所有轮次均完成

    for (const card of topicCards) {
      if (card.completedRounds >= card.totalRounds) {
        done.push(card);
      } else if (card.hasUrgent) {
        pending.push(card);
      } else {
        progress.push(card);
      }
    }

    // 排序
    pending.sort((a, b) => (a.nextTask?.dueDate || '').localeCompare(b.nextTask?.dueDate || ''));
    progress.sort((a, b) => (a.nextTask?.dueDate || '').localeCompare(b.nextTask?.dueDate || ''));
    done.sort((a, b) => {
      const aDate = a.group
        .map((t) => t.completedDate || '')
        .sort()
        .pop() || '';
      const bDate = b.group
        .map((t) => t.completedDate || '')
        .sort()
        .pop() || '';
      return bDate.localeCompare(aDate);
    });

    return { pending, progress, done };
  }, [tasks, roundMap, totalRoundsMap, settings.complexityConfigs]);

  // 筛选（memo 化：避免每次渲染都重新创建闭包）
  const filterTasks = useMemo(
    () => (list: TopicCardData[]) => {
      if (!query.trim()) return list;
      const q = query.toLowerCase();
      return list.filter(
        (t) => t.topicName.toLowerCase().includes(q) || (t.tag || '').toLowerCase().includes(q),
      );
    },
    [query],
  );

  // 标签泳道分组（memo 化：稳定引用）
  const groupByTagFn = useMemo(
    () => (list: TopicCardData[]) => {
      const map = new Map<string, TopicCardData[]>();
      for (const t of list) {
        const tag = t.tag || '无标签';
        if (!map.has(tag)) map.set(tag, []);
        map.get(tag)!.push(t);
      }
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    },
    [],
  );

  // colConfig 包含已筛选列表，依赖 query 和 columns
  const colConfig = useMemo(
    () => [
      { id: 'board-col-today', title: '待复习', icon: '🔴', tasks: filterTasks(columns.pending), color: '#EF4444' },
      { id: 'board-col-future', title: '进行中', icon: '🟡', tasks: filterTasks(columns.progress), color: '#F59E0B' },
      { id: 'board-col-done', title: '已完成', icon: '✅', tasks: filterTasks(columns.done), color: '#10B981' },
    ],
    [filterTasks, columns],
  );

  return (
    <div className="eb-board">
      {/* 筛选栏 */}
      <div className="eb-filter-bar">
        <div className="eb-filter-search">
          <Search size={14} />
          <input
            type="text"
            placeholder="搜索主题或标签..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="eb-filter-check">
          <input type="checkbox" checked={groupByTag} onChange={(e) => setGroupByTag(e.target.checked)} />
          <Tag size={13} />
          按标签分泳道
        </label>
      </div>

      {/* 看板列 */}
      <div className="eb-board-columns">
        {colConfig.map((col) => (
          <Droppable droppableId={col.id} key={col.id}>
            {(provided, snapshot) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className={`eb-board-col ${snapshot.isDraggingOver ? 'eb-board-col--over' : ''}`}
                style={{ '--col-color': col.color } as React.CSSProperties}
              >
                <div className="eb-board-col-header">
                  <span className="eb-board-col-icon">{col.icon}</span>
                  <span className="eb-board-col-title">{col.title}</span>
                  <span className="eb-board-col-count">{col.tasks.length}</span>
                </div>

                <div className="eb-board-col-body">
                  {groupByTag ? (
                    groupByTagFn(col.tasks).map(([tag, tagTasks]) => (
                      <Droppable droppableId={`${col.id}::${tag}`} key={tag}>
                        {(laneProvided, laneSnapshot) => (
                          <div
                            ref={laneProvided.innerRef}
                            {...laneProvided.droppableProps}
                            className={`eb-board-lane ${laneSnapshot.isDraggingOver ? 'eb-board-lane--over' : ''}`}
                          >
                            <div className="eb-board-lane-header">
                              <span className="eb-board-lane-dot" style={{ backgroundColor: settings.tagColors[tag] || '#9CA3AF' }} />
                              <span className="eb-board-lane-name">{tag}</span>
                              <span className="eb-board-lane-count">{tagTasks.length}</span>
                            </div>
                            {tagTasks.map((t, i) => (
                              <BoardCard
                                key={t.topicName}
                                card={t}
                                index={i}
                                settings={settings}
                                taskActions={taskActions}
                              />
                            ))}
                            {tagTasks.length === 0 && (
                              <div className="eb-board-empty">拖拽任务到此处</div>
                            )}
                            {laneProvided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    ))
                  ) : (
                    col.tasks.map((t, i) => (
                      <BoardCard
                        key={t.topicName}
                        card={t}
                        index={i}
                        settings={settings}
                        taskActions={taskActions}
                      />
                    ))
                  )}
                  {col.tasks.length === 0 && !groupByTag && (
                    <div className="eb-board-empty">拖拽任务到此处</div>
                  )}
                  {provided.placeholder}
                </div>
              </div>
            )}
          </Droppable>
        ))}
      </div>
    </div>
  );
};

// ── 看板卡片（主题级别）────────────────────────────────────
interface BoardCardProps {
  card: TopicCardData;
  index: number;
  settings: EbbSettings;
  taskActions: TaskActions;
}

const BoardCard: React.FC<BoardCardProps> = ({ card, index, settings, taskActions }) => {
  const { topicName, group, totalRounds, completedRounds, nextTask, nextRound, complexity, accumulatedNotes } = card;
  const isAllDone = completedRounds >= totalRounds;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // 下一轮积分
  const points = nextTask && complexity
    ? getPointWeight(nextRound, complexity, settings.complexityConfigs)
    : 0;

  // 日期标签：未完成时显示下一轮到期日；全部完成时显示最后完成日
  const dateForLabel = nextTask
    ? nextTask.dueDate
    : (group
        .map((t) => t.completedDate || t.dueDate)
        .sort()
        .pop() || '');
  const dateLabel = dateForLabel ? getDateLabel(dateForLabel, isAllDone) : null;

  const tagColor = card.tag ? settings.tagColors[card.tag] : undefined;

  // 优先级圆点
  const priorityColor = isAllDone
    ? '#10B981'
    : card.hasUrgent
      ? (nextTask && isOverdue(nextTask) ? '#EF4444' : '#F59E0B')
      : '#3B82F6';

  // 轮次颜色：显示当前进度轮次
  const progressRound = Math.min(completedRounds + 1, totalRounds);
  const roundColor = ROUND_COLORS[(progressRound - 1) % ROUND_COLORS.length];

  // 拖拽 ID：使用下一轮任务 ID（已完成主题使用首个任务 ID 作为占位）
  const draggableId = nextTask?.id || group[0]?.id || topicName;

  const cardContent = (
    <div onClick={() => { if (accumulatedNotes.length > 0) setDrawerOpen(!drawerOpen); }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <span className="eb-board-card-dot" style={{ backgroundColor: priorityColor }} />
        <div className="eb-board-card-main">
          <span
            className="eb-board-card-name"
            onClick={(e) => { e.stopPropagation(); taskActions.onOpenTimeline(topicName); }}
          >
            {topicName}
          </span>
          <div className="eb-board-card-meta">
            {card.tag && (
              <span
                className="eb-board-card-tag"
                style={tagColor ? { backgroundColor: `${tagColor}40`, color: '#374151' } : undefined}
              >
                {card.tag}
              </span>
            )}
            <span className="eb-board-card-round" style={{ color: roundColor }}>
              R{completedRounds}/{totalRounds}
            </span>
            {dateLabel && (
              <span className={`eb-board-card-date eb-date-pill eb-date-pill--${dateLabel.variant}`}>
                {dateLabel.text}
              </span>
            )}
            {points > 0 && <span className="eb-board-card-points">{points}分</span>}
            {accumulatedNotes.length > 0 && (
              <span className="eb-board-card-notes-badge" title="包含错题笔记">
                📝 {accumulatedNotes.length}
              </span>
            )}
          </div>
        </div>
        <div className="eb-board-card-actions">
          {nextTask && (
            <>
              <button
                type="button"
                className="eb-icon-btn"
                onClick={(e) => { e.stopPropagation(); taskActions.onToggle(nextTask.id); }}
                title="标记当前轮次完成"
              >
                ✓
              </button>
              <button
                type="button"
                className="eb-icon-btn"
                onClick={(e) => { e.stopPropagation(); taskActions.onReschedule(nextTask.id); }}
                title="改期"
              >
                📅
              </button>
            </>
          )}
        </div>
      </div>
      
      {/* 笔记抽屉 */}
      {drawerOpen && accumulatedNotes.length > 0 && (
        <div className="mt-2 pt-2 border-t border-gray-100 flex flex-col gap-1.5" onClick={(e) => e.stopPropagation()}>
          <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">History</div>
          <div className="flex flex-col gap-1">
            {accumulatedNotes.map((note, idx) => {
              let data = { date: '', type: '', typeLabel: '记录', title: '未知记录', notes: note };
              try {
                if (note.startsWith('{')) {
                  data = JSON.parse(note);
                } else {
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
                <div key={idx} className="flex flex-col p-1.5 bg-gray-50/50 rounded border border-gray-100/50 hover:bg-gray-50 transition-colors">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="flex items-center gap-1 overflow-hidden">
                      <span className={`text-[9px] px-1 py-0.5 rounded border font-medium whitespace-nowrap ${badgeColor}`}>
                        {typeText}
                      </span>
                      <span className="text-[11px] font-medium text-gray-700 truncate">{data.title}</span>
                    </div>
                    <span className="text-[9px] text-gray-400 font-mono whitespace-nowrap shrink-0">{data.date}</span>
                  </div>
                  {data.notes && (
                    <div className="text-[11px] text-gray-500 leading-snug whitespace-pre-wrap mt-1 pl-1 border-l-2 border-gray-200/60">
                      {data.notes}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {nextTask && (
            <button 
              className="mt-1 bg-blue-50 hover:bg-blue-100 text-blue-600 text-[11px] font-medium py-1 px-3 rounded shadow-sm transition-colors self-end flex items-center gap-1"
              onClick={(e) => { e.stopPropagation(); setDrawerOpen(false); taskActions.onToggle(nextTask.id); }}
            >
              <span className="opacity-80">✓</span> 已掌握 (下一轮)
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Draggable draggableId={draggableId} index={index} isDragDisabled={isAllDone}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`eb-board-card ${snapshot.isDragging ? 'eb-board-card--dragging' : ''} ${isAllDone ? 'eb-board-card--done' : ''}`}
          style={{
            ...provided.draggableProps.style,
            ...(isAllDone ? { pointerEvents: 'auto' as const } : undefined),
          }}
        >
          {cardContent}
        </div>
      )}
    </Draggable>
  );
};

// 用 ErrorBoundary 包裹导出，捕获渲染错误以避免白屏
const BoardViewWithBoundary: React.FC<BoardViewProps> = (props) => (
  <BoardErrorBoundary>
    <BoardView {...props} />
  </BoardErrorBoundary>
);

export default BoardViewWithBoundary;

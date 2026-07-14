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
import { useGraphStore } from '@/graph/store';

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
  /** 关联的大盘节点 ID（取组内第一个任务的） */
  graphNodeId?: string;
}

const BoardView: React.FC<BoardViewProps> = ({ tasks, settings, taskActions }) => {
  const [query, setQuery] = useState('');
  const [groupByType, setGroupByType] = useState<'none' | 'tag' | 'rootNode'>('none');

  const { roundMap, totalRoundsMap } = useMemo(() => computeRounds(tasks), [tasks]);
  const getNodeById = useGraphStore((s) => s.getNodeById);

  // 按主题聚合 + 三列拆分
  const columns = useMemo(() => {
    // 1. 按 topicName 聚合
    const byTopic = new Map<string, ReviewTask[]>();
    for (const t of tasks) {
      const g = byTopic.get(t.topicName) ?? [];
      g.push(t);
      byTopic.set(t.topicName, g);
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
        graphNodeId: firstTask?.graphNodeId,
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

  // 泳道分组逻辑
  const groupedTasksFn = useMemo(
    () => (list: TopicCardData[]) => {
      const map = new Map<string, TopicCardData[]>();
      for (const t of list) {
        let groupKey = '无分类';
        
        if (groupByType === 'tag') {
          groupKey = t.tag || '无标签';
        } else if (groupByType === 'rootNode') {
          if (t.graphNodeId) {
            let current = getNodeById(t.graphNodeId);
            while (current && current.parentId) {
              current = getNodeById(current.parentId);
            }
            groupKey = current ? current.name : '无大盘关联';
          } else {
            groupKey = '无大盘关联';
          }
        }

        if (!map.has(groupKey)) map.set(groupKey, []);
        map.get(groupKey)!.push(t);
      }
      return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    },
    [groupByType, getNodeById],
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
          <select 
            className="eb-filter-select" 
            style={{ marginLeft: 8 }}
            value={groupByType} 
            onChange={(e) => setGroupByType(e.target.value as 'none' | 'tag' | 'rootNode')}
          >
            <option value="none">不分组</option>
            <option value="tag">按标签分组</option>
            <option value="rootNode">按大盘根节点分组</option>
          </select>
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
                  {groupByType !== 'none' ? (
                    groupedTasksFn(col.tasks).map(([groupKey, tagTasks]) => (
                      <Droppable droppableId={`${col.id}::${groupKey}`} key={groupKey}>
                        {(laneProvided, laneSnapshot) => (
                          <div
                            ref={laneProvided.innerRef}
                            {...laneProvided.droppableProps}
                            className={`eb-board-lane ${laneSnapshot.isDraggingOver ? 'eb-board-lane--over' : ''}`}
                          >
                            <div className="eb-board-lane-header">
                              <span className="eb-board-lane-dot" style={{ backgroundColor: settings.tagColors[groupKey] || '#9CA3AF' }} />
                              <span className="eb-board-lane-name">{groupKey}</span>
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
                  {col.tasks.length === 0 && groupByType === 'none' && (
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
  const { topicName, group, totalRounds, completedRounds, nextTask, nextRound, complexity } = card;
  const isAllDone = completedRounds >= totalRounds;

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
    <div onClick={() => {}}>
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

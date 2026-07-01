// ============================================================
// Ebb - 单任务卡片
// 复选框/主题名/进度/日期标签/轮次徽章/标签/操作按钮
// ============================================================

import React, { useMemo, useState } from 'react';
import { Draggable } from '@hello-pangea/dnd';
import { Trash2, Calendar, Plus, Settings2 } from 'lucide-react';
import type { ReviewTask, EbbSettings } from '../types';
import { computeRounds, getDateLabel, isOverdue, isDueToday } from '../scheduler';
import { getPointWeight } from '../complexity';
import { ROUND_COLORS } from '../constants';

interface TaskCardProps {
  task: ReviewTask;
  allTasks: ReviewTask[];
  settings: EbbSettings;
  index: number;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onReschedule: (id: string) => void;
  onAddRound: (task: ReviewTask) => void;
  onOpenRounds: (task: ReviewTask) => void;
  onOpenTimeline: (topicName: string) => void;
  onDragDisabled?: boolean;
}

const TaskCard: React.FC<TaskCardProps> = ({
  task,
  allTasks,
  settings,
  index,
  onToggle,
  onDelete,
  onReschedule,
  onAddRound,
  onOpenRounds,
  onOpenTimeline,
  onDragDisabled,
}) => {
  const [hovered, setHovered] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const { round, totalRounds, points } = useMemo(() => {
    const { roundMap, totalRoundsMap } = computeRounds(allTasks);
    const r = roundMap.get(task.id) ?? 0;
    const tr = totalRoundsMap.get(task.topicName) ?? 0;
    const p = task.complexity ? getPointWeight(r, task.complexity, settings.complexityConfigs) : 0;
    return { round: r, totalRounds: tr, points: p };
  }, [allTasks, task, settings]);

  const dateLabel = useMemo(
    () => getDateLabel(task.dueDate, task.isCompleted),
    [task.dueDate, task.isCompleted],
  );

  const overdue = isOverdue(task);
  const dueToday = isDueToday(task);
  const tagColor = task.tag ? settings.tagColors[task.tag] : undefined;

  // 同主题完成进度
  const topicProgress = useMemo(() => {
    const topicTasks = allTasks.filter((t) => t.topicName === task.topicName);
    const done = topicTasks.filter((t) => t.isCompleted).length;
    return { done, total: topicTasks.length };
  }, [allTasks, task.topicName]);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirmingDelete) {
      onDelete(task.id);
    } else {
      setConfirmingDelete(true);
      setTimeout(() => setConfirmingDelete(false), 2500);
    }
  };

  const card = (
    <div
      className={[
        'eb-task-card',
        task.isCompleted ? 'eb-task-card--done' : '',
        overdue ? 'eb-task-card--overdue' : '',
        dueToday ? 'eb-task-card--today' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{
        '--task-color': tagColor || ROUND_COLORS[round % ROUND_COLORS.length],
      } as React.CSSProperties}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className="eb-task-card-accent" />
      <div className="eb-task-card-body">
        <div className="eb-task-card-meta">
          <span className="eb-task-card-round-badge" title={`第 ${round}/${totalRounds} 轮 · ${points} 分`}>
            第 {round} 轮 · {points}分
          </span>
          {task.tag && (
            <span
              className="eb-task-card-tag"
              style={tagColor ? { backgroundColor: `${tagColor}40`, color: '#374151' } : undefined}
            >
              {task.tag}
            </span>
          )}
        </div>
        <div className="eb-task-card-content">
          <input
            type="checkbox"
            checked={task.isCompleted}
            className="eb-task-card-check"
            onClick={(e) => e.stopPropagation()}
            onChange={() => onToggle(task.id)}
          />
          <span
            className="eb-task-card-text"
            onClick={() => onOpenTimeline(task.topicName)}
            title="点击查看时间线"
          >
            {task.topicName}
          </span>
        </div>
        <div className="eb-task-card-footer">
          <span className={`eb-date-pill eb-date-pill--${dateLabel.variant}`}>
            {dateLabel.text}
          </span>
          {topicProgress.total > 1 && (
            <div className="eb-task-card-progress" title={`主题进度 ${topicProgress.done}/${topicProgress.total}`}>
              <div className="eb-task-card-progress-bar">
                <div
                  className="eb-task-card-progress-fill"
                  style={{ width: `${(topicProgress.done / topicProgress.total) * 100}%` }}
                />
              </div>
              <span className="eb-task-card-progress-text">
                {topicProgress.done}/{topicProgress.total}
              </span>
            </div>
          )}
          <div className={`eb-task-card-actions ${hovered ? 'eb-task-card-actions--visible' : ''}`}>
            <button
              type="button"
              className="eb-icon-btn"
              onClick={(e) => { e.stopPropagation(); onReschedule(task.id); }}
              title="改期"
            >
              <Calendar size={13} />
            </button>
            <button
              type="button"
              className="eb-icon-btn"
              onClick={(e) => { e.stopPropagation(); onAddRound(task); }}
              title="追加一轮"
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              className="eb-icon-btn"
              onClick={(e) => { e.stopPropagation(); onOpenRounds(task); }}
              title="轮次详情"
            >
              <Settings2 size={13} />
            </button>
            <button
              type="button"
              className={`eb-icon-btn eb-icon-btn--danger ${confirmingDelete ? 'eb-icon-btn--confirm' : ''}`}
              onClick={handleDelete}
              title={confirmingDelete ? '再次点击确认删除' : '删除'}
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (onDragDisabled) {
    return card;
  }

  return (
    <Draggable draggableId={task.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={snapshot.isDragging ? 'eb-task-card--dragging-wrapper' : ''}
        >
          {card}
        </div>
      )}
    </Draggable>
  );
};

export default TaskCard;

import React, { useMemo, useState } from 'react';
import { Draggable, Droppable } from '@hello-pangea/dnd';
import {
  CalendarPlus,
  CircleDashed,
  Clock3,
  GripVertical,
  History,
  Link as LinkIcon,
  Search,
} from 'lucide-react';
import {
  filterAndSortBacklogTasks,
  type BacklogDeadlineFilter,
  type BacklogDurationFilter,
  type BacklogOriginFilter,
  type BacklogSort,
  type BacklogTask,
} from '@/domain/taskBacklog';
import { requestConfirmation } from '@/services/confirmation';
import { diffDays, formatDate, todayStr } from '@/utils/dateSafe';
import type { SmartBlockDragPayload } from '@/types';
import { DROPPABLE_BACKLOG } from '@/components/dailySchedule/dndIds';
import styles from './BacklogTaskList.module.css';

interface BacklogTaskListProps {
  tasks: BacklogTask[];
  mode?: 'native' | 'pangea';
  defaultDate?: string;
  onSchedule: (task: BacklogTask, date: string) => boolean | Promise<boolean>;
  onOpenTask: (task: BacklogTask) => void;
  emptyMessage?: string;
}

async function confirmDeadline(task: BacklogTask, date: string): Promise<boolean> {
  if (!task.deadline || date <= task.deadline) return true;
  return requestConfirmation({
    title: '排期晚于截止日期',
    message: `“${task.title}”的截止日期是 ${task.deadline}，目标日期是 ${date}。是否仍然安排？`,
    confirmLabel: '仍然安排',
    cancelLabel: '返回修改',
    tone: 'warning',
  });
}

const DeadlineLabel: React.FC<{ task: BacklogTask }> = ({ task }) => {
  if (!task.deadline) return <span className={styles.muted}>无截止日期</span>;
  const remaining = diffDays(task.deadline, todayStr());
  return (
    <span className={remaining < 0 ? styles.danger : remaining <= 2 ? styles.warning : undefined}>
      截止 {formatDate(task.deadline, 'M月D日')}
      {remaining < 0 ? ` · 逾期${Math.abs(remaining)}天` : remaining === 0 ? ' · 今天' : ` · ${remaining}天后`}
    </span>
  );
};

export const BacklogTaskList: React.FC<BacklogTaskListProps> = ({
  tasks,
  mode = 'native',
  defaultDate,
  onSchedule,
  onOpenTask,
  emptyMessage = '没有符合条件的待排期任务',
}) => {
  const [query, setQuery] = useState('');
  const [project, setProject] = useState('all');
  const [tag, setTag] = useState('all');
  const [origin, setOrigin] = useState<BacklogOriginFilter>('all');
  const [deadline, setDeadline] = useState<BacklogDeadlineFilter>('all');
  const [duration, setDuration] = useState<BacklogDurationFilter>('all');
  const [sort, setSort] = useState<BacklogSort>('deadline');
  const [busyId, setBusyId] = useState<string | null>(null);

  const projects = useMemo(() => {
    const byId = new Map(tasks.map((task) => [task.projectId, task.projectLabel]));
    return [...byId].sort((left, right) => left[1].localeCompare(right[1], 'zh-CN'));
  }, [tasks]);
  const tags = useMemo(
    () => [...new Set(tasks.map((task) => task.tag))].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [tasks],
  );
  const visibleTasks = useMemo(
    () => filterAndSortBacklogTasks(tasks, { query, project, tag, origin, deadline, duration, sort }),
    [deadline, duration, origin, project, query, sort, tag, tasks],
  );

  const schedule = async (task: BacklogTask, date: string) => {
    if (!date || busyId) return;
    if (!await confirmDeadline(task, date)) return;
    setBusyId(task.id);
    try {
      await onSchedule(task, date);
    } finally {
      setBusyId(null);
    }
  };

  const nativeDragStart = (event: React.DragEvent<HTMLDivElement>, task: BacklogTask) => {
    const payload: SmartBlockDragPayload = {
      type: 'smart-block',
      source: 'icebox',
      taskId: task.taskId,
      blockId: task.blockId,
      tag: task.tag,
      title: task.title,
      fromDate: '',
    };
    event.dataTransfer.setData('application/json', JSON.stringify(payload));
    event.dataTransfer.setData('application/x-backlog-task', task.id);
    event.dataTransfer.effectAllowed = 'move';
  };

  const renderCard = (task: BacklogTask, dragHandleProps?: React.HTMLAttributes<HTMLElement>) => (
    <article
      className={styles.card}
      data-backlog-task-id={task.id}
      onDoubleClick={() => onOpenTask(task)}
    >
      <span className={styles.dragHandle} {...dragHandleProps} aria-hidden="true">
        <GripVertical size={15} />
      </span>
      <div className={styles.cardContent}>
        <button type="button" className={styles.title} onClick={() => onOpenTask(task)}>
          {task.title}
        </button>
        <div className={styles.badges}>
          <span className={styles.project} title={task.projectLabel}>{task.projectLabel}</span>
          <span className={styles.tag} style={{ borderColor: task.tagColor, color: task.tagColor }}>{task.tag}</span>
          {task.frozenAt && <span className={styles.recovered}><History size={11} />逾期回收</span>}
        </div>
        <div className={styles.meta}>
          <span><Clock3 size={12} />{task.duration} 分钟</span>
          <DeadlineLabel task={task} />
          <span title={task.graphNodeCount > 0 ? `已绑定 ${task.graphNodeCount} 个知识节点` : '未绑定知识节点'}>
            {task.graphNodeCount > 0 ? <LinkIcon size={12} /> : <CircleDashed size={12} />}
            {task.graphNodeCount > 0 ? `${task.graphNodeCount} 个节点` : '未绑定'}
          </span>
        </div>
        {defaultDate && (
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.primaryAction}
              disabled={busyId === task.id}
              onClick={() => void schedule(task, defaultDate)}
            >
              <CalendarPlus size={13} />
              安排到当天
            </button>
          </div>
        )}
      </div>
    </article>
  );

  const cards = mode === 'pangea'
    ? (
      <Droppable droppableId={DROPPABLE_BACKLOG}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`${styles.list} ${snapshot.isDraggingOver ? styles.dropTarget : ''}`}
          >
            {visibleTasks.map((task, index) => (
              <Draggable key={task.id} draggableId={task.id} index={index}>
                {(provided, snapshot) => (
                  <div
                    ref={provided.innerRef}
                    {...provided.draggableProps}
                    className={snapshot.isDragging ? styles.dragging : undefined}
                  >
                    {renderCard(task, provided.dragHandleProps ?? undefined)}
                  </div>
                )}
              </Draggable>
            ))}
            {provided.placeholder}
          </div>
        )}
      </Droppable>
    )
    : (
      <div className={styles.list}>
        {visibleTasks.map((task) => (
          <div key={task.id} draggable onDragStart={(event) => nativeDragStart(event, task)}>
            {renderCard(task)}
          </div>
        ))}
      </div>
    );

  return (
    <div className={styles.root}>
      <div className={styles.search}>
        <Search size={14} />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索任务、项目或标签"
          aria-label="搜索待排期任务"
        />
      </div>
      <div className={styles.filters}>
        <select value={project} onChange={(event) => setProject(event.target.value)} aria-label="按项目筛选">
          <option value="all">全部项目</option>
          {projects.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
        </select>
        <select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="按标签筛选">
          <option value="all">全部标签</option>
          {tags.map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
        <select value={origin} onChange={(event) => setOrigin(event.target.value as BacklogOriginFilter)} aria-label="按进入方式筛选">
          <option value="all">全部来源</option>
          <option value="manual">手动待排</option>
          <option value="recovered">逾期回收</option>
        </select>
        <select value={deadline} onChange={(event) => setDeadline(event.target.value as BacklogDeadlineFilter)} aria-label="按截止状态筛选">
          <option value="all">全部截止状态</option>
          <option value="overdue">已经逾期</option>
          <option value="week">未来 7 天</option>
          <option value="none">无截止日期</option>
        </select>
        <select value={duration} onChange={(event) => setDuration(event.target.value as BacklogDurationFilter)} aria-label="按预计时长筛选">
          <option value="all">全部预计时长</option>
          <option value="short">30 分钟以内</option>
          <option value="medium">31–60 分钟</option>
          <option value="long">超过 60 分钟</option>
        </select>
        <select value={sort} onChange={(event) => setSort(event.target.value as BacklogSort)} aria-label="待排期任务排序">
          <option value="deadline">截止优先</option>
          <option value="duration">短任务优先</option>
          <option value="recent">最近回收</option>
          <option value="project">按项目</option>
        </select>
      </div>
      {visibleTasks.length > 0 ? cards : (
        <div className={styles.empty}>
          <CalendarPlus size={26} />
          <strong>{emptyMessage}</strong>
          <span>普通、未完成、未归档且没有排期日期的任务会显示在这里。</span>
        </div>
      )}
    </div>
  );
};

export default BacklogTaskList;

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  Inbox,
  ListChecks,
  Minus,
  Plus,
  RotateCcw,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import type { GraphNode } from '@/graph/types';
import type { DailyRetrospective, CompletedActivity } from '@/components/dailySchedule/retrospectiveTypes';
import {
  DEFAULT_TIME_SLOT_CONFIGS,
  type ScheduledItem,
  type TimeSlot,
} from '@/components/dailySchedule/types';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import { getReviewSourceId } from '@/components/dailySchedule/sourceIds';
import DailyRetrospectiveDialog from '@/components/dailySchedule/DailyRetrospectiveDialog';
import { reviewTasksForDate } from '@/domain/dailyTaskProjection';
import { todayStr } from '@/utils/dateSafe';
import { computeRounds, getReviewTopicKey, isOverdue } from '../scheduler';
import { getReviewRoundDuration } from '../duration';
import { resolveReviewCategory, getReviewCategoryColor, buildRootNodeMap } from '../category';
import type { EbbSettings, ReviewTask } from '../types';
import type { TaskActions } from './MatrixView';

interface TodayReviewViewProps {
  tasks: ReviewTask[];
  settings: EbbSettings;
  selectedDate: string;
  onSelectDate: (date: string) => void;
  taskActions: TaskActions;
  graphNodes: GraphNode[];
  inboxCount: number;
  onOpenInbox: () => void;
}

const slotIcon: Record<TimeSlot, string> = {
  morning: '☀',
  afternoon: '◐',
  evening: '☾',
};

const slotTone: Record<TimeSlot, string> = {
  morning: 'amber',
  afternoon: 'orange',
  evening: 'indigo',
};

const TodayReviewView: React.FC<TodayReviewViewProps> = ({
  tasks,
  settings,
  selectedDate,
  onSelectDate,
  taskActions,
  graphNodes,
  inboxCount,
  onOpenInbox,
}) => {
  const today = todayStr();
  const [retrospectiveOpen, setRetrospectiveOpen] = useState(false);
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverSlot, setDragOverSlot] = useState<TimeSlot | null>(null);
  const {
    isHydrated: isDailyHydrated,
    hydrateStore,
    schedules,
    retrospectives,
    addScheduledItem,
    removeScheduledItem,
    moveScheduledItem,
    reorderScheduledItems,
    upsertRetrospective,
  } = useDailyScheduleStore(
    useShallow((state) => ({
      isHydrated: state.isHydrated,
      hydrateStore: state.hydrateStore,
      schedules: state.schedules,
      retrospectives: state.retrospectives,
      addScheduledItem: state.addScheduledItem,
      removeScheduledItem: state.removeScheduledItem,
      moveScheduledItem: state.moveScheduledItem,
      reorderScheduledItems: state.reorderScheduledItems,
      upsertRetrospective: state.upsertRetrospective,
    })),
  );

  useEffect(() => {
    if (!isDailyHydrated) hydrateStore();
  }, [hydrateStore, isDailyHydrated]);

  const rootByNodeId = useMemo(() => buildRootNodeMap(graphNodes), [graphNodes]);
  const { roundMap, totalRoundsMap } = useMemo(() => computeRounds(tasks), [tasks]);
  const taskById = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks]);
  const schedule = schedules[selectedDate] ?? { date: selectedDate, items: [], blocks: [] };
  const projection = useMemo(
    () => reviewTasksForDate(tasks, selectedDate, today),
    [selectedDate, tasks, today],
  );
  const dueTasks = projection.pending;
  const completedTasks = projection.completed;
  const scheduledReviewItems = useMemo(
    () => schedule.items.filter((item) => item.source === 'review').sort((left, right) => left.order - right.order),
    [schedule.items],
  );
  const scheduledSourceIds = useMemo(
    () => new Set(scheduledReviewItems.map((item) => item.sourceId)),
    [scheduledReviewItems],
  );
  const poolTasks = useMemo(
    () => dueTasks
      .filter((task) => !scheduledSourceIds.has(getReviewSourceId(task.id)))
      .sort((left, right) => Number(isOverdue(right)) - Number(isOverdue(left))
        || left.dueDate.localeCompare(right.dueDate)
        || left.topicName.localeCompare(right.topicName, 'zh-CN')),
    [dueTasks, scheduledSourceIds],
  );
  const futureTasks = useMemo(
    () => tasks
      .filter((task) => !task.isCompleted && task.dueDate > selectedDate)
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.topicName.localeCompare(right.topicName, 'zh-CN'))
      .slice(0, 4),
    [selectedDate, tasks],
  );

  const getTaskForItem = (item: ScheduledItem) => {
    const taskId = item.sourceId.startsWith('review-') ? item.sourceId.slice('review-'.length) : '';
    return taskById.get(taskId);
  };

  const getTaskMeta = useCallback((task: ReviewTask) => {
    const round = roundMap.get(task.id) ?? task.roundOrder ?? 1;
    const totalRounds = totalRoundsMap.get(getReviewTopicKey(task)) ?? 1;
    const category = resolveReviewCategory(task, rootByNodeId);
    const color = getReviewCategoryColor(category, settings.tagColors) ?? '#64748B';
    return { round, totalRounds, duration: getReviewRoundDuration(task, round), categoryLabel: category?.label ?? '未分类', color };
  }, [rootByNodeId, roundMap, settings.tagColors, totalRoundsMap]);

  const getSlotItems = (slot: TimeSlot) => scheduledReviewItems
    .filter((item) => item.timeSlot === slot)
    .sort((left, right) => left.order - right.order);

  const slotStats = (slot: TimeSlot) => {
    const items = getSlotItems(slot);
    const minutes = items.reduce((sum, item) => sum + (getTaskForItem(item) ? getTaskMeta(getTaskForItem(item)!).duration : item.duration ?? 30), 0);
    const completed = items.filter((item) => getTaskForItem(item)?.isCompleted).length;
    const capacity = DEFAULT_TIME_SLOT_CONFIGS.find((config) => config.slot === slot)?.availableMinutes ?? 0;
    return { items, minutes, completed, capacity };
  };

  const scheduledTasks = scheduledReviewItems.map(getTaskForItem).filter(Boolean) as ReviewTask[];
  const totalScheduledMinutes = scheduledTasks.reduce((sum, task) => sum + getTaskMeta(task).duration, 0);
  const remainingDueMinutes = dueTasks.reduce((sum, task) => sum + getTaskMeta(task).duration, 0);
  const totalCapacity = DEFAULT_TIME_SLOT_CONFIGS.reduce((sum, config) => sum + config.availableMinutes, 0);
  const scheduledCompleted = scheduledTasks.filter((task) => task.isCompleted).length;
  const dueCompleted = completedTasks.length;
  const reviewStatus = retrospectives[selectedDate]?.status === 'completed'
    ? '已完成'
    : retrospectives[selectedDate]
      ? '草稿'
      : selectedDate < today || (scheduledTasks.length > 0 && scheduledCompleted === scheduledTasks.length)
        ? '可开始'
        : '尚未复盘';

  const recommendedSlot = (task: ReviewTask): TimeSlot => {
    const meta = getTaskMeta(task);
    const ranked = DEFAULT_TIME_SLOT_CONFIGS.map((config) => {
      const stats = slotStats(config.slot);
      return { slot: config.slot, remaining: stats.capacity - stats.minutes };
    }).sort((left, right) => right.remaining - left.remaining);
    return ranked.find((entry) => entry.remaining >= meta.duration)?.slot ?? ranked[ranked.length - 1].slot;
  };

  const scheduleTask = (task: ReviewTask, slot: TimeSlot = recommendedSlot(task)) => {
    const sourceId = getReviewSourceId(task.id);
    if (scheduledSourceIds.has(sourceId)) return;
    const meta = getTaskMeta(task);
    addScheduledItem(selectedDate, {
      sourceId,
      name: task.topicName,
      source: 'review',
      timeSlot: slot,
      completed: task.isCompleted,
      categoryColor: meta.color,
      detail: `${meta.categoryLabel} · R${meta.round}/${meta.totalRounds}`,
      duration: meta.duration,
    });
  };

  const handleDrop = (slot: TimeSlot) => {
    if (!draggedId) return;
    if (draggedId.startsWith('pool-review-')) {
      const task = taskById.get(draggedId.replace('pool-review-', ''));
      if (task) scheduleTask(task, slot);
    } else {
      const item = schedule.items.find((candidate) => candidate.id === draggedId);
      if (item && item.timeSlot !== slot) moveScheduledItem(selectedDate, item.id, slot, getSlotItems(slot).length);
    }
    setDraggedId(null);
    setDragOverSlot(null);
  };

  const moveWithinSlot = (item: ScheduledItem, direction: -1 | 1) => {
    const items = getSlotItems(item.timeSlot);
    const currentIndex = items.findIndex((candidate) => candidate.id === item.id);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= items.length) return;
    const nextIds = items.map((candidate) => candidate.id);
    [nextIds[currentIndex], nextIds[targetIndex]] = [nextIds[targetIndex], nextIds[currentIndex]];
    reorderScheduledItems(selectedDate, item.timeSlot, nextIds);
  };

  const retrospectiveActivities = useMemo<CompletedActivity[]>(() => completedTasks.map((task) => {
    const meta = getTaskMeta(task);
    const node = task.graphNodeId ? graphNodes.find((candidate) => candidate.id === task.graphNodeId) : undefined;
    return {
      id: `${selectedDate}:${getReviewSourceId(task.id)}`,
      sourceId: getReviewSourceId(task.id),
      sourceType: 'review',
      title: task.topicName,
      reviewTaskId: task.id,
      completedDate: selectedDate,
      completionSource: task.completionSource ?? 'manual',
      round: meta.round,
      totalRounds: meta.totalRounds,
      nodeIds: task.graphNodeId ? [task.graphNodeId] : [],
      nodeSnapshots: node ? [{ id: node.id, name: node.name }] : [],
    };
  }), [completedTasks, getTaskMeta, graphNodes, selectedDate]);

  return (
    <div className="eb-today-view">
      <div className="eb-today-toolbar">
        <div className="eb-today-date-control">
          <CalendarDays size={16} />
          <input type="date" value={selectedDate} onChange={(event) => onSelectDate(event.target.value)} aria-label="今日复习日期" />
          <button type="button" onClick={() => onSelectDate(today)} disabled={selectedDate === today}>今天</button>
        </div>
        <div className="eb-today-toolbar-hint">先安排，再按时段执行；跨日期移动会保留艾宾浩斯间隔</div>
      </div>

      <section className="eb-today-summary" aria-label="今日复习状态">
        <div className="eb-today-summary-main">
          <span className="eb-today-eyebrow">今日复习</span>
          <strong>{selectedDate === today ? '今天' : selectedDate}</strong>
          <span className="eb-today-summary-sub">{dueTasks.length + dueCompleted} 轮 · 计划 {scheduledTasks.length} 轮</span>
        </div>
        <div className="eb-today-summary-metric"><span>今日完成</span><strong>{dueCompleted}/{dueTasks.length + dueCompleted}</strong></div>
        <div className="eb-today-summary-metric"><span>剩余时长</span><strong>{remainingDueMinutes} 分钟</strong></div>
        <div className="eb-today-summary-metric"><span>逾期</span><strong className={poolTasks.some(isOverdue) ? 'is-danger' : ''}>{poolTasks.filter(isOverdue).length}</strong></div>
        <div className="eb-today-summary-metric"><span>容量</span><strong>{totalScheduledMinutes}/{totalCapacity} 分钟</strong></div>
        <button type="button" className={`eb-today-review-status is-${reviewStatus === '已完成' ? 'done' : reviewStatus === '草稿' ? 'draft' : 'ready'}`} onClick={() => setRetrospectiveOpen(true)}>
          <span>日终复盘</span><strong>{reviewStatus}</strong>
        </button>
      </section>

      <div className="eb-today-layout">
        <main className="eb-today-plan" aria-label="今日安排">
          {DEFAULT_TIME_SLOT_CONFIGS.map((config) => {
            const stats = slotStats(config.slot);
            const ratio = stats.capacity > 0 ? Math.min(1.2, stats.minutes / stats.capacity) : 0;
            const overloaded = stats.minutes > stats.capacity;
            return (
              <section key={config.slot} className={`eb-today-slot eb-today-slot--${slotTone[config.slot]} ${dragOverSlot === config.slot ? 'is-drag-over' : ''}`} onDragOver={(event) => { event.preventDefault(); setDragOverSlot(config.slot); }} onDrop={() => handleDrop(config.slot)}>
                <header className="eb-today-slot-header">
                  <div className="eb-today-slot-title"><span>{slotIcon[config.slot]}</span><strong>{config.label}</strong><small>{String(config.startHour).padStart(2, '0')}:00—{String(config.endHour).padStart(2, '0')}:00</small></div>
                  <div className="eb-today-slot-load"><strong className={overloaded ? 'is-danger' : ''}>{stats.minutes}/{stats.capacity} 分钟</strong><span>{stats.items.length} 轮 · {stats.completed} 完成</span><div><i style={{ width: `${Math.min(100, ratio * 100)}%` }} /></div></div>
                </header>
                <div className="eb-today-slot-body">
                  {stats.items.length === 0 && <div className="eb-today-slot-empty">将任务拖到这里，或从右侧点击“安排”</div>}
                  {stats.items.map((item, index) => {
                    const task = getTaskForItem(item);
                    if (!task) return null;
                    const meta = getTaskMeta(task);
                    const completed = task.isCompleted;
                    return (
                      <article key={item.id} className={`eb-today-task ${completed ? 'is-completed' : ''} ${isOverdue(task) ? 'is-overdue' : ''}`} draggable onDragStart={() => setDraggedId(item.id)} onDragEnd={() => { setDraggedId(null); setDragOverSlot(null); }}>
                        <span className="eb-today-task-accent" style={{ background: meta.color }} />
                        <div className="eb-today-task-main">
                          <strong>{task.topicName}</strong>
                          <span>R{meta.round}/{meta.totalRounds} · {meta.categoryLabel} · {meta.duration}分钟</span>
                        </div>
                        <span className={`eb-today-task-state ${isOverdue(task) ? 'is-danger' : completed ? 'is-done' : 'is-today'}`}>{completed ? '已完成' : isOverdue(task) ? '逾期' : '今天'}</span>
                        <div className="eb-today-task-actions">
                          <button type="button" onClick={() => moveWithinSlot(item, -1)} disabled={index === 0} aria-label="上移任务" title="上移"><ArrowUp size={13} /></button>
                          <button type="button" onClick={() => moveWithinSlot(item, 1)} disabled={index === stats.items.length - 1} aria-label="下移任务" title="下移"><ArrowDown size={13} /></button>
                          <button type="button" onClick={() => void taskActions.onToggle(task.id)} className={completed ? 'is-done' : ''} aria-label={completed ? '取消完成' : '完成本轮'} title={completed ? '取消完成' : '完成本轮'}><Check size={14} /></button>
                          <button type="button" onClick={() => taskActions.onOpenRounds(task)} aria-label="查看轮次" title="查看轮次"><ListChecks size={14} /></button>
                          <button type="button" onClick={() => removeScheduledItem(selectedDate, item.id)} aria-label="移回任务池" title="移回任务池"><Minus size={14} /></button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </main>

        <aside className="eb-today-pool" aria-label="待安排池">
          <header className="eb-today-pool-header"><div><Inbox size={16} /><strong>待安排池</strong></div><span>{poolTasks.length} 轮 · 约 {poolTasks.reduce((sum, task) => sum + getTaskMeta(task).duration, 0)} 分钟</span></header>
          {poolTasks.length === 0 ? <div className="eb-today-pool-empty"><Check size={22} /><strong>今天的复习都已安排</strong><span>可以开始执行，或前往复习库管理长期计划。</span></div> : (
            <div className="eb-today-pool-list">
              {poolTasks.map((task) => {
                const meta = getTaskMeta(task);
                const suggested = recommendedSlot(task);
                return (
                  <article key={task.id} className={`eb-today-pool-card ${isOverdue(task) ? 'is-overdue' : ''}`} draggable onDragStart={() => setDraggedId(`pool-review-${task.id}`)} onDragEnd={() => { setDraggedId(null); setDragOverSlot(null); }}>
                    <div className="eb-today-pool-card-title"><strong>{task.topicName}</strong><span>R{meta.round}/{meta.totalRounds}</span></div>
                    <div className="eb-today-pool-card-meta"><span style={{ color: meta.color }}>{meta.categoryLabel}</span><span><Clock3 size={12} />{meta.duration}分钟</span><span className={isOverdue(task) ? 'is-danger' : ''}>{isOverdue(task) ? '逾期' : '今天到期'}</span></div>
                    <div className="eb-today-pool-card-actions"><button type="button" className="eb-today-recommend" onClick={() => scheduleTask(task, suggested)}>推荐到{DEFAULT_TIME_SLOT_CONFIGS.find((config) => config.slot === suggested)?.label}</button><button type="button" onClick={() => scheduleTask(task)} aria-label={`安排${task.topicName}`} title="按推荐时段安排"><Plus size={14} />安排</button></div>
                  </article>
                );
              })}
            </div>
          )}
          {futureTasks.length > 0 && (
            <section className="eb-today-pool-secondary">
              <header><strong>明日候选</strong><span>{futureTasks.length} 项</span></header>
              {futureTasks.map((task) => {
                const meta = getTaskMeta(task);
                return <button type="button" key={task.id} onClick={() => taskActions.onOpenRounds(task)}><span className="eb-today-pool-secondary-dot" style={{ background: meta.color }} /><span>{task.topicName}</span><small>R{meta.round}/{meta.totalRounds} · {task.dueDate.slice(5).replace('-', '/')}</small><ChevronRight size={13} /></button>;
              })}
            </section>
          )}
          <section className="eb-today-pool-secondary">
            <header><strong>暂存内容</strong><span>{inboxCount} 项</span></header>
            <button type="button" onClick={onOpenInbox}><Inbox size={13} /><span>打开收件箱安排新的复习内容</span><ChevronRight size={13} /></button>
          </section>
          <div className="eb-today-pool-footer"><button type="button" onClick={() => taskActions.onOpenTimeline(getReviewTopicKey(poolTasks[0] ?? tasks[0]))} disabled={tasks.length === 0}><RotateCcw size={13} />查看复习链</button><button type="button" onClick={() => onSelectDate(today)}><ChevronRight size={13} />回到今天</button></div>
        </aside>
      </div>

      {retrospectiveOpen && <DailyRetrospectiveDialog date={selectedDate} activities={retrospectiveActivities} graphNodes={graphNodes} existing={retrospectives[selectedDate]} onSave={(retrospective: DailyRetrospective) => upsertRetrospective(retrospective)} onClose={() => setRetrospectiveOpen(false)} />}
    </div>
  );
};

export default TodayReviewView;

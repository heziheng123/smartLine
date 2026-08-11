import React, { useMemo, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import dayjs from 'dayjs';
import {
  AlertTriangle,
  ArrowRight,
  BookOpenCheck,
  CalendarCheck2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  Flag,
  FolderKanban,
  ListTree,
  Network,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import type { AppModule } from '@/components/Toolbar';
import SyncStatusIndicator from '@/components/SyncStatusIndicator';
import type { SmartTaskBlock, Task, TaskGroup } from '@/types';
import { useTimelineStore } from '@/store';
import { useDailyScheduleStore } from '@/components/dailySchedule/store';
import type { ScheduledItem, TimeBlock, TimeSlot } from '@/components/dailySchedule/types';
import { normalizeTimeSlotConfigs } from '@/components/dailySchedule/types';
import { durationMinutes, parseSourceId } from '@/components/dailySchedule/conversion';
import { useEbbStore } from '@/ebb/store';
import { getReviewRoundDuration } from '@/ebb/duration';
import { buildBalancedDailyReviewPlan } from '@/ebb/dailyReviewPlanning';
import { planReviewRoundReschedule } from '@/ebb/reschedulePlanning';
import { requestManualReviewToggle } from '@/services/reviewCompletionCommands';
import { useLifeMapStore } from '@/lifeMap/store';
import { activeLifeMapItems } from '@/lifeMap/data';
import { currentSystemStats } from '@/lifeMap/metrics';
import { useGraphStore } from '@/graph/store';
import { collectBacklogTasks, isBacklogTaskHeader } from '@/domain/taskBacklog';
import { getSmartTaskBlocks, getValidGraphNodeIds, isQuantityTask } from '@/utils/blocks';
import { addDays, todayStr } from '@/utils/dateSafe';
import { openProjectTaskCreate } from '@/components/smartBlock/projectTaskCreate';
import '@/styles/phone.css';
import { MOTION_DURATION, MOTION_EASE_ENTER } from '@/motion/system';

interface PhoneWorkspaceProps {
  currentView: AppModule;
  tasks: Task[];
  groups: TaskGroup[];
  onAddProject: () => void;
  onOpenProject: (taskId: string, blockId?: string) => void;
  onOpenFullView: () => void;
}

interface PhoneHeaderProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  onOpenFullView: () => void;
  onPrimaryAction?: () => void;
  primaryLabel?: string;
}

const VIEW_LABEL: Record<AppModule, string> = {
  'life-map': '人生地图',
  timeline: '项目规划',
  'daily-schedule': '今日',
  'week-matrix': '本周',
  ebb: '复习',
  'knowledge-graph': '知识',
};

const SLOT_LABEL: Record<TimeSlot, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
};

const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;
const WEEKDAY_SHORT_LABELS = ['日', '一', '二', '三', '四', '五', '六'] as const;

const formatMinutes = (minutes: number) => {
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分` : `${hours} 小时`;
};

const getMonday = (date: dayjs.Dayjs) => {
  const weekday = date.day();
  return date.subtract(weekday === 0 ? 6 : weekday - 1, 'day').startOf('day');
};

const projectProgress = (task: Task) => {
  const blocks = getSmartTaskBlocks(task.blocks ?? []).filter((block) => !block.header.isArchived);
  if (blocks.length === 0) return task.completed ? 100 : 0;
  return Math.round(blocks.filter((block) => block.header.isCompleted).length / blocks.length * 100);
};

const PhoneHeader: React.FC<PhoneHeaderProps> = ({
  eyebrow,
  title,
  subtitle,
  onOpenFullView,
  onPrimaryAction,
  primaryLabel = '新增',
}) => (
  <header className="phone-header">
    <div className="phone-header__copy">
      {eyebrow && <span>{eyebrow}</span>}
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
    <div className="phone-header__actions">
      {onPrimaryAction && (
        <button type="button" className="phone-icon-button phone-icon-button--primary" onClick={onPrimaryAction} aria-label={primaryLabel} title={primaryLabel}>
          <Plus size={19} />
        </button>
      )}
      <SyncStatusIndicator />
      <button type="button" className="phone-icon-button" onClick={onOpenFullView} aria-label="打开完整视图" title="打开完整视图">
        <ExternalLink size={18} />
      </button>
    </div>
  </header>
);

const EmptyCard: React.FC<{ icon?: React.ReactNode; title: string; detail: string }> = ({ icon, title, detail }) => (
  <div className="phone-empty-card">
    <span>{icon ?? <Sparkles size={19} />}</span>
    <strong>{title}</strong>
    <p>{detail}</p>
  </div>
);

const PhoneProjectView: React.FC<PhoneWorkspaceProps> = ({ tasks, groups, onAddProject, onOpenProject, onOpenFullView }) => {
  const toggleTaskComplete = useTimelineStore((state) => state.toggleTaskComplete);
  const [filter, setFilter] = useState<'active' | 'overdue' | 'all' | 'completed'>('active');
  const today = todayStr();
  const groupByTaskId = useMemo(() => {
    const result = new Map<string, string>();
    groups.forEach((group) => group.children.forEach((task) => result.set(task.id, group.name)));
    return result;
  }, [groups]);
  const rows = useMemo(() => tasks
    .filter((task) => {
      if (filter === 'active') return !task.completed;
      if (filter === 'completed') return Boolean(task.completed);
      if (filter === 'overdue') return !task.completed && task.end < today;
      return true;
    })
    .sort((left, right) => Number(Boolean(left.completed)) - Number(Boolean(right.completed)) || left.end.localeCompare(right.end)), [filter, tasks, today]);

  return (
    <section className="phone-page" aria-label="项目规划手机视图">
      <PhoneHeader
        eyebrow="项目执行"
        title="项目规划"
        subtitle={`${tasks.filter((task) => !task.completed).length} 个进行中项目`}
        onPrimaryAction={onAddProject}
        primaryLabel="新建项目"
        onOpenFullView={onOpenFullView}
      />
      <div className="phone-segmented" role="tablist" aria-label="项目筛选">
        {([['active', '进行中'], ['overdue', '逾期'], ['all', '全部'], ['completed', '已完成']] as const).map(([value, label]) => (
          <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label}</button>
        ))}
      </div>
      <div className="phone-card-list">
        {rows.map((task) => {
          const blocks = getSmartTaskBlocks(task.blocks ?? []).filter((block) => !block.header.isArchived);
          const activeBlocks = blocks.filter((block) => !block.header.isCompleted);
          const next = activeBlocks.filter((block) => !isBacklogTaskHeader(block.header)).sort((a, b) => (a.header.date ?? '9999').localeCompare(b.header.date ?? '9999'))[0];
          const overdue = !task.completed && task.end < today;
          const unscheduled = activeBlocks.filter((block) => isBacklogTaskHeader(block.header)).length;
          const progress = projectProgress(task);
          return (
            <article key={task.id} className={`phone-card phone-project-card ${overdue ? 'is-warning' : ''}`}>
              <button type="button" className="phone-card__main" onClick={() => onOpenProject(task.id)}>
                <span className="phone-card__title-row">
                  <i style={{ background: task.color ?? '#6366f1' }} />
                  <strong>{task.name}</strong>
                  <em>{progress}%</em>
                </span>
                <span className="phone-card__meta">{groupByTaskId.get(task.id) ?? '未分组'} · {task.start}—{task.end}</span>
                <span className="phone-progress"><i style={{ width: `${progress}%` }} /></span>
                <span className="phone-card__next">{next ? `下一步：${next.header.title}` : task.completed ? '项目已完成' : unscheduled ? '下一步：待安排' : '尚未添加智能任务'}</span>
              </button>
              <div className="phone-card__footer">
                <span>{overdue ? '已逾期' : `${blocks.length} 项任务`}{unscheduled ? ` · ${unscheduled} 项待安排` : ''}{task.lifeMapProjection?.enabled ? ' · 已投影到人生地图' : ''}</span>
                <button type="button" onClick={() => toggleTaskComplete(task.id)}>{task.completed ? <RotateCcw size={15} /> : <Check size={15} />}{task.completed ? '恢复' : '完成'}</button>
              </div>
            </article>
          );
        })}
        {rows.length === 0 && <EmptyCard icon={<FolderKanban size={20} />} title="这里还没有项目" detail="新建项目后，可以在手机上查看进度、下一步和关键日期。" />}
      </div>
    </section>
  );
};

type PhoneScheduleEntry =
  | { kind: 'item'; value: ScheduledItem }
  | { kind: 'block'; value: TimeBlock };

const PhoneTodayView: React.FC<PhoneWorkspaceProps> = ({ tasks, groups, onOpenProject, onOpenFullView }) => {
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [quickTitle, setQuickTitle] = useState('');
  const schedules = useDailyScheduleStore((state) => state.schedules);
  const addScheduledItem = useDailyScheduleStore((state) => state.addScheduledItem);
  const updateScheduledItem = useDailyScheduleStore((state) => state.updateScheduledItem);
  const updateTimeBlock = useDailyScheduleStore((state) => state.updateTimeBlock);
  const updateBlockHeader = useTimelineStore((state) => state.updateBlockHeader);
  const reviewTasks = useEbbStore((state) => state.reviewTasks);
  const dailyTimeSlots = useEbbStore((state) => state.ebbSettings.dailyTimeSlots);
  const slotConfigs = useMemo(() => normalizeTimeSlotConfigs(dailyTimeSlots), [dailyTimeSlots]);
  const allTasks = useMemo(() => tasks, [tasks]);
  const day = schedules[selectedDate] ?? { date: selectedDate, items: [], blocks: [] };
  const backlog = useMemo(() => collectBacklogTasks(allTasks, groups), [allTasks, groups]);
  const blockBySource = useMemo(() => {
    const result = new Map<string, { task: Task; block: SmartTaskBlock }>();
    allTasks.forEach((task) => getSmartTaskBlocks(task.blocks ?? []).forEach((block) => result.set(`project-blk:${task.id}::${block.id}`, { task, block })));
    return result;
  }, [allTasks]);

  const isComplete = (entry: PhoneScheduleEntry) => {
    const parsed = parseSourceId(entry.value.sourceId);
    if (parsed?.source === 'project') return Boolean(blockBySource.get(entry.value.sourceId)?.block.header.isCompleted);
    if (parsed?.source === 'review') return Boolean(reviewTasks.find((task) => task.id === parsed.reviewId)?.isCompleted);
    return entry.value.completedDate === selectedDate;
  };
  const entries: PhoneScheduleEntry[] = [
    ...day.items.map((value) => ({ kind: 'item' as const, value })),
    ...day.blocks.map((value) => ({ kind: 'block' as const, value })),
  ];
  const completed = entries.filter(isComplete).length;
  const plannedMinutes = day.items.reduce((sum, item) => sum + (item.duration ?? 30), 0)
    + day.blocks.reduce((sum, block) => sum + Math.max(0, durationMinutes(block.startTime, block.endTime)), 0);
  const dueReviews = reviewTasks.filter((task) => !task.isArchived && !task.isCompleted && task.dueDate <= selectedDate).length;

  const toggleEntry = async (entry: PhoneScheduleEntry) => {
    const parsed = parseSourceId(entry.value.sourceId);
    if (parsed?.source === 'project') {
      const source = blockBySource.get(entry.value.sourceId);
      if (!source) return;
      if (isQuantityTask(source.block.header)) {
        onOpenProject(source.task.id, source.block.id);
        return;
      }
      updateBlockHeader(source.task.id, source.block.id, {
        isCompleted: !source.block.header.isCompleted,
        completedDate: source.block.header.isCompleted ? undefined : selectedDate,
      });
      return;
    }
    if (parsed?.source === 'review') {
      await requestManualReviewToggle(parsed.reviewId);
      return;
    }
    const patch = { completedDate: entry.value.completedDate === selectedDate ? undefined : selectedDate };
    if (entry.kind === 'item') updateScheduledItem(selectedDate, entry.value.id, patch);
    else updateTimeBlock(selectedDate, entry.value.id, patch);
  };

  const submitQuickItem = (event: React.FormEvent) => {
    event.preventDefault();
    const title = quickTitle.trim();
    if (!title) return;
    addScheduledItem(selectedDate, {
      sourceId: `free-${Date.now().toString(36)}`,
      name: title,
      source: 'free',
      timeSlot: 'morning',
      duration: 30,
    });
    setQuickTitle('');
  };

  return (
    <section className="phone-page" aria-label="每日安排手机视图">
      <PhoneHeader
        eyebrow={selectedDate === todayStr() ? '今天' : '每日安排'}
        title={`${dayjs(selectedDate).format('M月D日')} · ${WEEKDAY_LABELS[dayjs(selectedDate).day()]}`}
        subtitle={`${completed}/${entries.length} 完成 · ${formatMinutes(plannedMinutes)}`}
        onOpenFullView={onOpenFullView}
      />
      <div className="phone-date-control">
        <button type="button" onClick={() => setSelectedDate(addDays(selectedDate, -1))} aria-label="前一天"><ChevronLeft size={18} /></button>
        <input type="date" value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} aria-label="选择日期" />
        <button type="button" onClick={() => setSelectedDate(addDays(selectedDate, 1))} aria-label="后一天"><ChevronRight size={18} /></button>
        {selectedDate !== todayStr() && <button type="button" className="phone-text-button" onClick={() => setSelectedDate(todayStr())}>今天</button>}
      </div>
      <div className="phone-summary-grid">
        <button type="button" onClick={() => onOpenFullView()}><Target size={17} /><strong>{completed}/{entries.length}</strong><span>完成</span></button>
        <button type="button" onClick={() => onOpenFullView()}><Clock3 size={17} /><strong>{plannedMinutes}m</strong><span>已安排</span></button>
        <button type="button" onClick={() => onOpenFullView()}><FolderKanban size={17} /><strong>{backlog.length}</strong><span>待安排</span></button>
        <button type="button" onClick={() => onOpenFullView()}><BookOpenCheck size={17} /><strong>{dueReviews}</strong><span>待复习</span></button>
      </div>
      <form className="phone-quick-add" onSubmit={submitQuickItem}>
        <Plus size={18} />
        <input value={quickTitle} onChange={(event) => setQuickTitle(event.target.value)} placeholder="快速添加生活事项" aria-label="快速添加生活事项" />
        <button type="submit" disabled={!quickTitle.trim()}>添加</button>
      </form>
      <div className="phone-schedule">
        {slotConfigs.map((slot) => {
          const slotEntries = entries.filter((entry) => entry.kind === 'item'
            ? entry.value.timeSlot === slot.slot
            : Number(entry.value.startTime.slice(0, 2)) < slot.endHour && Number(entry.value.startTime.slice(0, 2)) >= slot.startHour);
          return (
            <section key={slot.slot} className="phone-section-card">
              <header><div><span>{SLOT_LABEL[slot.slot]}</span><small>{slotEntries.length} 项</small></div><em>{slot.availableMinutes} 分钟容量</em></header>
              <div className="phone-task-list">
                {slotEntries.map((entry) => {
                  const done = isComplete(entry);
                  const source = blockBySource.get(entry.value.sourceId);
                  const quantity = source ? isQuantityTask(source.block.header) : false;
                  return (
                    <article key={`${entry.kind}:${entry.value.id}`} className={done ? 'is-completed' : ''}>
                      <button type="button" className="phone-check-button" onClick={() => void toggleEntry(entry)} aria-label={quantity ? `记录${entry.value.name}进度` : `${done ? '取消完成' : '完成'}${entry.value.name}`}>
                        {quantity ? <Zap size={16} /> : done ? <Check size={16} /> : <Circle size={16} />}
                      </button>
                      <button type="button" className="phone-task-main" onClick={() => source && onOpenProject(source.task.id, source.block.id)} disabled={!source}>
                        <strong>{entry.value.name}</strong>
                        <span>{entry.kind === 'block' ? `${entry.value.startTime}—${entry.value.endTime}` : `${entry.value.duration ?? 30} 分钟`}{entry.value.detail ? ` · ${entry.value.detail}` : ''}</span>
                      </button>
                    </article>
                  );
                })}
                {slotEntries.length === 0 && <p className="phone-list-empty">这个时段还没有安排</p>}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
};

const PhoneWeekView: React.FC<PhoneWorkspaceProps> = ({ tasks, groups, onOpenProject, onOpenFullView }) => {
  const [weekOffset, setWeekOffset] = useState(0);
  const today = todayStr();
  const initialMonday = useMemo(() => getMonday(dayjs()), []);
  const monday = initialMonday.add(weekOffset, 'week');
  const dates = Array.from({ length: 7 }, (_, index) => monday.add(index, 'day').format('YYYY-MM-DD'));
  const [selectedDate, setSelectedDate] = useState(today);
  const updateBlockHeader = useTimelineStore((state) => state.updateBlockHeader);
  const backlog = useMemo(() => collectBacklogTasks(tasks, groups), [groups, tasks]);
  const scheduled = useMemo(() => tasks.flatMap((task) => getSmartTaskBlocks(task.blocks ?? [])
    .filter((block) => !block.header.isArchived && !block.header.frozenAt && Boolean(block.header.date))
    .map((block) => ({ task, block }))), [tasks]);
  const selected = scheduled.filter(({ block }) => block.header.date === selectedDate)
    .sort((left, right) => Number(Boolean(left.block.header.isCompleted)) - Number(Boolean(right.block.header.isCompleted)));

  const changeWeek = (delta: number) => {
    const nextOffset = weekOffset + delta;
    setWeekOffset(nextOffset);
    setSelectedDate(initialMonday.add(nextOffset, 'week').format('YYYY-MM-DD'));
  };

  return (
    <section className="phone-page" aria-label="周矩阵手机视图">
      <PhoneHeader eyebrow="周执行" title="本周安排" subtitle={`${monday.format('M月D日')}—${monday.add(6, 'day').format('M月D日')}`} onOpenFullView={onOpenFullView} onPrimaryAction={() => openProjectTaskCreate({ date: selectedDate })} primaryLabel="新建项目任务" />
      <div className="phone-week-nav">
        <button type="button" onClick={() => changeWeek(-1)} aria-label="上一周"><ChevronLeft size={18} /></button>
        <button type="button" className="phone-week-nav__range" onClick={() => { setWeekOffset(0); setSelectedDate(today); }}>回到本周</button>
        <button type="button" onClick={() => changeWeek(1)} aria-label="下一周"><ChevronRight size={18} /></button>
      </div>
      <div className="phone-week-strip" role="tablist" aria-label="选择一周中的日期">
        {dates.map((date) => {
          const rows = scheduled.filter(({ block }) => block.header.date === date);
          const minutes = rows.reduce((sum, { block }) => sum + (block.header.duration || 0), 0);
          return (
            <button key={date} type="button" role="tab" aria-selected={selectedDate === date} className={`${selectedDate === date ? 'is-active' : ''} ${date === today ? 'is-today' : ''}`} onClick={() => setSelectedDate(date)}>
              <span>{WEEKDAY_SHORT_LABELS[dayjs(date).day()]}</span><strong>{dayjs(date).format('D')}</strong><small>{rows.length}项</small><i style={{ height: `${Math.min(100, Math.max(8, minutes / 240 * 100))}%` }} />
            </button>
          );
        })}
      </div>
      <div className="phone-inline-summary"><span><CalendarCheck2 size={16} />{dayjs(selectedDate).format('M月D日')} {WEEKDAY_LABELS[dayjs(selectedDate).day()]}</span><strong>{selected.length} 项 · {selected.reduce((sum, row) => sum + (row.block.header.duration || 0), 0)} 分钟</strong></div>
      <div className="phone-card-list">
        {selected.map(({ task, block }) => (
          <article key={`${task.id}:${block.id}`} className={`phone-card phone-week-task ${block.header.isCompleted ? 'is-completed' : ''}`}>
            <button type="button" className="phone-check-button" onClick={() => updateBlockHeader(task.id, block.id, { isCompleted: !block.header.isCompleted, completedDate: block.header.isCompleted ? undefined : selectedDate })} aria-label={`${block.header.isCompleted ? '取消完成' : '完成'}${block.header.title}`}>
              {block.header.isCompleted ? <Check size={16} /> : <Circle size={16} />}
            </button>
            <button type="button" className="phone-task-main" onClick={() => onOpenProject(task.id, block.id)}>
              <strong>{block.header.title}</strong><span>{task.name} · {block.header.duration || 0} 分钟{block.header.deadline ? ` · 截止 ${block.header.deadline}` : ''}</span>
            </button>
            <label className="phone-date-edit" title="调整日期"><CalendarDays size={15} /><input type="date" value={block.header.date ?? ''} onChange={(event) => updateBlockHeader(task.id, block.id, { date: event.target.value, frozenAt: undefined })} aria-label={`调整${block.header.title}日期`} /></label>
          </article>
        ))}
        {selected.length === 0 && <EmptyCard icon={<CalendarDays size={20} />} title="当天没有项目任务" detail="可以新建任务，或从完整周矩阵中安排待规划任务。" />}
      </div>
      <button type="button" className="phone-backlog-card" onClick={onOpenFullView}><FolderKanban size={18} /><span><strong>{backlog.length} 项待安排</strong><small>打开完整周矩阵进行批量规划</small></span><ArrowRight size={17} /></button>
    </section>
  );
};

const PhoneReviewView: React.FC<PhoneWorkspaceProps> = ({ onOpenFullView }) => {
  const reviewTasks = useEbbStore((state) => state.reviewTasks);
  const settings = useEbbStore((state) => state.ebbSettings);
  const rescheduleReviewRounds = useEbbStore((state) => state.rescheduleReviewRounds);
  const today = todayStr();
  const active = useMemo(() => reviewTasks.filter((task) => !task.isArchived), [reviewTasks]);
  const due = active.filter((task) => !task.isCompleted && task.dueDate <= today)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || (left.roundOrder ?? 0) - (right.roundOrder ?? 0));
  const completedToday = active.filter((task) => task.isCompleted && task.completedDate === today).length;
  const overdue = due.filter((task) => task.dueDate < today).length;
  const dueMinutes = due.reduce((sum, task) => sum + getReviewRoundDuration(task, task.roundOrder ?? 1), 0);
  const tomorrowPlan = useMemo(() => buildBalancedDailyReviewPlan(active, addDays(today, 1), settings.dailyReviewMinutes, 3), [active, settings.dailyReviewMinutes, today]);

  const deferTask = (taskId: string) => {
    try {
      const plan = planReviewRoundReschedule(active, taskId, addDays(today, 1), 'following');
      rescheduleReviewRounds(plan.updates);
    } catch {
      // The full review workspace exposes conflict details and alternate dates.
      onOpenFullView();
    }
  };

  return (
    <section className="phone-page" aria-label="艾宾浩斯复习手机视图">
      <PhoneHeader eyebrow="学习执行" title="今日复习" subtitle={`${due.length} 轮 · 预计 ${dueMinutes} 分钟`} onOpenFullView={onOpenFullView} onPrimaryAction={onOpenFullView} primaryLabel="添加复习内容" />
      <div className="phone-summary-grid phone-summary-grid--review">
        <button type="button"><Target size={17} /><strong>{due.length}</strong><span>待复习</span></button>
        <button type="button"><AlertTriangle size={17} /><strong>{overdue}</strong><span>逾期</span></button>
        <button type="button"><Clock3 size={17} /><strong>{dueMinutes}m</strong><span>预计</span></button>
        <button type="button"><Check size={17} /><strong>{completedToday}</strong><span>今日完成</span></button>
      </div>
      <button type="button" className={`phone-workload-card ${tomorrowPlan.overflowMinutes > 0 ? 'is-warning' : ''}`} onClick={onOpenFullView}>
        <CalendarCheck2 size={19} />
        <span><strong>明日负荷 {tomorrowPlan.days[0]?.minutes ?? 0}/{settings.dailyReviewMinutes} 分钟</strong><small>{tomorrowPlan.overflowMinutes > 0 ? `未来三天超载 ${tomorrowPlan.overflowMinutes} 分钟` : '未来三天容量正常'}</small></span>
        <ArrowRight size={17} />
      </button>
      <div className="phone-card-list">
        {due.map((task) => {
          const taskMinutes = getReviewRoundDuration(task, task.roundOrder ?? 1);
          const isOverdue = task.dueDate < today;
          return (
            <article key={task.id} className={`phone-card phone-review-card ${isOverdue ? 'is-warning' : ''}`}>
              <div className="phone-card__main">
                <span className="phone-card__title-row"><i style={{ background: '#8b5cf6' }} /><strong>{task.topicName}</strong><em>R{task.roundOrder ?? 1}</em></span>
                <span className="phone-card__meta">{task.tag || '未分类'} · {taskMinutes} 分钟{isOverdue ? ` · 逾期 ${dayjs(today).diff(dayjs(task.dueDate), 'day')} 天` : ''}</span>
              </div>
              <div className="phone-card__footer phone-card__footer--actions">
                <button type="button" onClick={() => deferTask(task.id)}><ChevronRight size={15} />推迟到明天</button>
                <button type="button" className="is-primary" onClick={() => void requestManualReviewToggle(task.id)}><Check size={15} />完成本轮</button>
              </div>
            </article>
          );
        })}
        {due.length === 0 && <EmptyCard icon={<BookOpenCheck size={20} />} title="今天没有待复习内容" detail="可以查看未来计划，或添加新的学习内容。" />}
      </div>
    </section>
  );
};

const PhoneLifeMapView: React.FC<PhoneWorkspaceProps> = ({ tasks, onOpenProject, onOpenFullView }) => {
  const store = useLifeMapStore();
  const today = todayStr();
  const areas = activeLifeMapItems(store.lifeMapAreas).filter((area) => !area.isHidden);
  const areaById = new Map(areas.map((area) => [area.id, area]));
  const plans = activeLifeMapItems(store.lifeMapGoals).filter((goal) => goal.kind === 'plan' && goal.status !== 'archived');
  const systems = activeLifeMapItems(store.lifeMapSystems).filter((system) => system.status === 'active');
  const events = activeLifeMapItems(store.lifeMapEvents).filter((event) => event.date >= today).sort((left, right) => left.date.localeCompare(right.date));
  const projections = tasks.filter((task) => task.lifeMapProjection?.enabled && areaById.has(task.lifeMapProjection.areaId));
  const nextEvent = events[0];

  return (
    <section className="phone-page" aria-label="人生地图手机概览">
      <PhoneHeader eyebrow="长期方向" title="人生地图" subtitle={`${plans.length} 个人生计划 · ${systems.length} 个长期系统`} onOpenFullView={onOpenFullView} onPrimaryAction={onOpenFullView} primaryLabel="添加人生内容" />
      {nextEvent ? (
        <button type="button" className="phone-hero-card" onClick={onOpenFullView}>
          <span><Flag size={19} /></span><div><small>下一关键日期 · {dayjs(nextEvent.date).diff(dayjs(today), 'day')} 天后</small><strong>{nextEvent.name}</strong><p>{dayjs(nextEvent.date).format('YYYY年M月D日')}</p></div><ArrowRight size={18} />
        </button>
      ) : <EmptyCard icon={<Flag size={20} />} title="还没有未来关键日期" detail="在完整人生地图中添加考试、截止日或重要纪念日。" />}
      <section className="phone-section-card">
        <header><div><span>长期系统</span><small>今天快速打卡</small></div><button type="button" onClick={onOpenFullView}>管理</button></header>
        <div className="phone-system-list">
          {systems.slice(0, 6).map((system) => {
            const stats = currentSystemStats(system, store.lifeMapSystemCheckIns, dayjs());
            const todayCount = activeLifeMapItems(store.lifeMapSystemCheckIns).find((item) => item.systemId === system.id && item.date === today)?.count ?? 0;
            return (
              <article key={system.id}>
                <span style={{ background: system.color ?? areaById.get(system.areaId)?.color ?? '#6366f1' }}><Zap size={15} /></span>
                <div><strong>{system.name}</strong><small>{stats.completed}/{stats.target} {system.unit || '次'} · {stats.label}</small></div>
                <div className="phone-stepper"><button type="button" disabled={todayCount <= 0} onClick={() => store.setSystemCheckIn(system.id, today, Math.max(0, todayCount - 1))}>−</button><b>{todayCount}</b><button type="button" onClick={() => store.setSystemCheckIn(system.id, today, todayCount + 1)}>＋</button></div>
              </article>
            );
          })}
          {systems.length === 0 && <p className="phone-list-empty">还没有正在运行的长期系统</p>}
        </div>
      </section>
      <section className="phone-section-card">
        <header><div><span>人生计划</span><small>长期推进方向</small></div><button type="button" onClick={onOpenFullView}>时间轴</button></header>
        <div className="phone-plan-list">
          {plans.slice(0, 6).map((plan) => (
            <article key={plan.id}>
              <div><span><i style={{ background: plan.color ?? areaById.get(plan.areaId)?.color ?? '#6366f1' }} />{areaById.get(plan.areaId)?.name ?? '未分类'}</span><strong>{plan.name}</strong><small>{plan.start}—{plan.targetDate}</small></div>
              <div className="phone-progress-control"><span className="phone-progress"><i style={{ width: `${plan.progress ?? 0}%` }} /></span><button type="button" onClick={() => store.updateGoal(plan.id, { progress: Math.min(100, (plan.progress ?? 0) + 10) })}>+10%</button></div>
            </article>
          ))}
          {plans.length === 0 && <p className="phone-list-empty">还没有人生计划</p>}
        </div>
      </section>
      <section className="phone-section-card">
        <header><div><span>项目投影</span><small>项目规划是唯一数据源</small></div></header>
        <div className="phone-compact-list">
          {projections.slice(0, 6).map((task) => <button type="button" key={task.id} onClick={() => onOpenProject(task.id)}><i style={{ background: task.color ?? '#6366f1' }} /><span><strong>{task.name}</strong><small>{areaById.get(task.lifeMapProjection!.areaId)?.name} · 只读投影</small></span><ArrowRight size={16} /></button>)}
          {projections.length === 0 && <p className="phone-list-empty">尚未从项目规划投影项目</p>}
        </div>
      </section>
    </section>
  );
};

const PhoneKnowledgeView: React.FC<PhoneWorkspaceProps> = ({ tasks, onOpenFullView }) => {
  const nodes = useGraphStore((state) => state.nodes);
  const addNode = useGraphStore((state) => state.addNode);
  const updateNode = useGraphStore((state) => state.updateNode);
  const reviewTasks = useEbbStore((state) => state.reviewTasks);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [addingParent, setAddingParent] = useState<string | 'root' | null>(null);
  const [nodeName, setNodeName] = useState('');
  const activeNodes = nodes.filter((node) => !node.isArchived);
  const childrenByParent = useMemo(() => {
    const result = new Map<string | null, typeof activeNodes>();
    activeNodes.forEach((node) => result.set(node.parentId, [...(result.get(node.parentId) ?? []), node]));
    result.forEach((values) => values.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN')));
    return result;
  }, [activeNodes]);
  const roots = childrenByParent.get(null) ?? [];
  const relatedProjectCounts = useMemo(() => {
    const result = new Map<string, number>();
    tasks.forEach((task) => getSmartTaskBlocks(task.blocks ?? []).forEach((block) => getValidGraphNodeIds(block.header).forEach((id) => result.set(id, (result.get(id) ?? 0) + 1))));
    return result;
  }, [tasks]);
  const reviewCounts = useMemo(() => {
    const result = new Map<string, number>();
    reviewTasks.filter((task) => !task.isArchived && !task.isCompleted && task.graphNodeId).forEach((task) => result.set(task.graphNodeId!, (result.get(task.graphNodeId!) ?? 0) + 1));
    return result;
  }, [reviewTasks]);

  const submitNode = (event: React.FormEvent) => {
    event.preventDefault();
    const name = nodeName.trim();
    if (!name || !addingParent) return;
    addNode(name, addingParent === 'root' ? null : addingParent);
    if (addingParent !== 'root') setExpanded((current) => new Set(current).add(addingParent));
    setAddingParent(null);
    setNodeName('');
  };

  const renderNode = (node: typeof activeNodes[number], depth = 0): React.ReactNode => {
    const children = childrenByParent.get(node.id) ?? [];
    const isExpanded = expanded.has(node.id);
    const isLeaf = children.length === 0;
    return (
      <React.Fragment key={node.id}>
        <article className="phone-node-row" style={{ '--phone-node-depth': depth } as React.CSSProperties}>
          <button type="button" className="phone-node-row__expand" onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(node.id)) next.delete(node.id); else next.add(node.id); return next; })} disabled={isLeaf} aria-label={`${isExpanded ? '收起' : '展开'}${node.name}`}><ChevronDown size={16} /></button>
          <button type="button" className="phone-node-row__main" onClick={() => !isLeaf && setExpanded((current) => new Set(current).add(node.id))}>
            <strong>{node.name}</strong><span>{children.length ? `${children.length} 个子节点` : '叶子节点'}{reviewCounts.get(node.id) ? ` · ${reviewCounts.get(node.id)} 轮待复习` : ''}{relatedProjectCounts.get(node.id) ? ` · ${relatedProjectCounts.get(node.id)} 项目任务` : ''}</span>
          </button>
          {isLeaf && <button type="button" className={`phone-node-activate ${node.status === 'activated' ? 'is-active' : ''}`} onClick={() => updateNode(node.id, { status: node.status === 'activated' ? 'unactivated' : 'activated' })} aria-label={`${node.status === 'activated' ? '取消激活' : '激活'}${node.name}`}><Zap size={16} /></button>}
          <button type="button" className="phone-node-add" onClick={() => { setAddingParent(node.id); setNodeName(''); }} aria-label={`向${node.name}添加子节点`}><Plus size={16} /></button>
        </article>
        {isExpanded && children.map((child) => renderNode(child, depth + 1))}
      </React.Fragment>
    );
  };

  return (
    <section className="phone-page" aria-label="知识大盘手机列表">
      <PhoneHeader eyebrow="知识结构" title="知识节点" subtitle={`${activeNodes.length} 个节点 · ${activeNodes.filter((node) => node.status === 'activated').length} 个已激活`} onOpenFullView={onOpenFullView} onPrimaryAction={() => { setAddingParent('root'); setNodeName(''); }} primaryLabel="添加根节点" />
      <div className="phone-inline-summary"><span><ListTree size={17} />树形列表</span><button type="button" onClick={onOpenFullView}><Network size={16} />查看图谱</button></div>
      <div className="phone-node-tree">
        {roots.map((node) => renderNode(node))}
        {roots.length === 0 && <EmptyCard icon={<Network size={20} />} title="还没有知识节点" detail="从一个学科或主题开始，再逐层添加子节点。" />}
      </div>
      {addingParent && (
        <div className="phone-sheet-backdrop" role="presentation" onClick={() => setAddingParent(null)}>
          <form className="phone-sheet" onSubmit={submitNode} onClick={(event) => event.stopPropagation()}>
            <div className="phone-sheet__handle" />
            <h2>{addingParent === 'root' ? '添加根节点' : '添加子节点'}</h2>
            <label>节点名称<input autoFocus value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="例如：政治经济学" /></label>
            <div><button type="button" onClick={() => setAddingParent(null)}>取消</button><button type="submit" className="is-primary" disabled={!nodeName.trim()}>添加节点</button></div>
          </form>
        </div>
      )}
    </section>
  );
};

const PhoneWorkspace: React.FC<PhoneWorkspaceProps> = (props) => {
  const prefersReducedMotion = useReducedMotion();
  const content = props.currentView === 'timeline'
    ? <PhoneProjectView {...props} />
    : props.currentView === 'daily-schedule'
      ? <PhoneTodayView {...props} />
      : props.currentView === 'week-matrix'
        ? <PhoneWeekView {...props} />
        : props.currentView === 'ebb'
          ? <PhoneReviewView {...props} />
          : props.currentView === 'life-map'
            ? <PhoneLifeMapView {...props} />
            : <PhoneKnowledgeView {...props} />;

  return (
    <motion.main
      key={props.currentView}
      id={`view-${props.currentView}`}
      role="tabpanel"
      className="phone-workspace"
      aria-label={`${VIEW_LABEL[props.currentView]}手机视图`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: prefersReducedMotion ? MOTION_DURATION.instant : MOTION_DURATION.standard, ease: MOTION_EASE_ENTER }}
    >
      {content}
    </motion.main>
  );
};

export default PhoneWorkspace;

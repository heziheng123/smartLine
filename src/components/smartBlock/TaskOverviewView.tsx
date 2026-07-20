import React, { useDeferredValue, useEffect, useMemo, useState } from 'react';
import '@/styles/task-overview.css';
import {
  CalendarDays,
  Check,
  ChevronDown,
  Clock3,
  FolderOpen,
  Link2,
  Search,
  Target,
  Hash,
  Plus,
} from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '@/store';
import type { SmartTaskBlock, Task, TaskGroup } from '@/types';
import { getQuantityCompleted, getQuantityDailyStatus, getQuantityProgressPercent, getQuantityTotal, getQuantityUnit, getSmartTaskBlocks, getValidGraphNodeIds, isQuantityTask } from '@/utils/blocks';
import { addDays, getDayOfWeek, isAfterDay, isBeforeDay, splitDate, todayStr } from '@/utils/dateSafe';
import { resolveTaskTheme } from '@/utils/timeline-utils';
import { resolveTaskCategoryTheme } from '@/utils/taskCategoryTheme';
import { openProjectTaskModal } from './projectTaskModal';
import { toggleProjectTaskCompletion } from '@/services/projectTaskCommands';
import { openProjectTaskCreate } from './projectTaskCreate';

type GroupMode = 'date' | 'project' | 'tag';
type StatusFilter = 'all' | 'pending' | 'completed' | 'overdue' | 'unscheduled';
type DateFilter = 'all' | 'today' | 'week' | 'month';

interface OverviewPreferences {
  query: string;
  projectId: string;
  tag: string;
  status: StatusFilter;
  dateFilter: DateFilter;
  groupMode: GroupMode;
}

interface OverviewItem {
  task: Task;
  block: SmartTaskBlock;
  projectLabel: string;
  projectColor: string;
}

interface OverviewGroup {
  key: string;
  label: string;
  order: string;
  items: OverviewItem[];
}

const PREFERENCES_KEY = 'task-overview-preferences-v1';
const GROUP_MODES: GroupMode[] = ['date', 'project', 'tag'];
const STATUS_FILTERS: StatusFilter[] = ['all', 'pending', 'completed', 'overdue', 'unscheduled'];
const DATE_FILTERS: DateFilter[] = ['all', 'today', 'week', 'month'];

function loadPreferences(): OverviewPreferences {
  const defaults: OverviewPreferences = {
    query: '',
    projectId: 'all',
    tag: 'all',
    status: 'all',
    dateFilter: 'all',
    groupMode: 'date',
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFERENCES_KEY) ?? '{}') as Partial<OverviewPreferences>;
    return {
      query: typeof parsed.query === 'string' ? parsed.query : defaults.query,
      projectId: typeof parsed.projectId === 'string' ? parsed.projectId : defaults.projectId,
      tag: typeof parsed.tag === 'string' ? parsed.tag : defaults.tag,
      status: STATUS_FILTERS.includes(parsed.status as StatusFilter) ? parsed.status as StatusFilter : defaults.status,
      dateFilter: DATE_FILTERS.includes(parsed.dateFilter as DateFilter) ? parsed.dateFilter as DateFilter : defaults.dateFilter,
      groupMode: GROUP_MODES.includes(parsed.groupMode as GroupMode) ? parsed.groupMode as GroupMode : defaults.groupMode,
    };
  } catch {
    return defaults;
  }
}

function formatShortDate(date: string): string {
  const { month, day } = splitDate(date);
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][getDayOfWeek(date)];
  return `${month}月${day}日 ${weekday}`;
}

function weekEnd(date: string): string {
  const day = getDayOfWeek(date);
  return addDays(date, day === 0 ? 0 : 7 - day);
}

function buildDateGroup(item: OverviewItem, today: string): Omit<OverviewGroup, 'items'> {
  const { header } = item.block;
  if (header.isCompleted) return { key: '__completed__', label: '已完成', order: '9' };
  if (!header.date) return { key: '__unscheduled__', label: '未安排日期', order: '8' };
  if (isBeforeDay(header.date, today)) return { key: '__overdue__', label: '已逾期', order: '0' };
  if (header.date === today) return { key: today, label: '今天', order: `1-${today}` };
  const tomorrow = addDays(today, 1);
  if (header.date === tomorrow) return { key: tomorrow, label: '明天', order: `2-${tomorrow}` };
  return { key: header.date, label: formatShortDate(header.date), order: `3-${header.date}` };
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ');
}

const TaskOverviewView: React.FC = () => {
  const { tasks, groups } = useTimelineStore(
    useShallow((state) => ({
      tasks: state.tasks,
      groups: state.groups,
    })),
  );
  const preferences = useMemo(loadPreferences, []);
  const [query, setQuery] = useState(preferences.query);
  const deferredQuery = useDeferredValue(query);
  const [projectId, setProjectId] = useState(preferences.projectId);
  const [tag, setTag] = useState(preferences.tag);
  const [status, setStatus] = useState<StatusFilter>(preferences.status);
  const [dateFilter, setDateFilter] = useState<DateFilter>(preferences.dateFilter);
  const [groupMode, setGroupMode] = useState<GroupMode>(preferences.groupMode);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set(['__completed__']));
  const today = todayStr();

  const allItems = useMemo(() => {
    const uniqueTasks = new Map<string, { task: Task; group?: TaskGroup }>();
    for (const task of tasks) uniqueTasks.set(task.id, { task });
    for (const group of groups) {
      for (const task of group.children) uniqueTasks.set(task.id, { task, group });
    }

    const result: OverviewItem[] = [];
    for (const { task, group: storedGroup } of uniqueTasks.values()) {
      const group = storedGroup ?? groups.find((candidate) =>
        candidate.id === task.groupId || candidate.children.some((child) => child.id === task.id),
      );
      const theme = resolveTaskTheme(task, group?.color);
      const projectLabel = group ? `${group.name} / ${task.name}` : task.name;
      for (const block of getSmartTaskBlocks(task.blocks ?? [])) {
        if (block.header.isArchived) continue;
        result.push({ task, block, projectLabel, projectColor: theme.backgroundColor });
      }
    }
    return result;
  }, [groups, tasks]);

  const projectOptions = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of allItems) map.set(item.task.id, item.projectLabel);
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'zh-CN'));
  }, [allItems]);

  const tags = useMemo(
    () => [...new Set(allItems.map((item) => item.block.header.tag).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'zh-CN')),
    [allItems],
  );

  useEffect(() => {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ query, projectId, tag, status, dateFilter, groupMode } satisfies OverviewPreferences));
    } catch {
      // Preferences are optional; task data must remain usable when storage is unavailable.
    }
  }, [dateFilter, groupMode, projectId, query, status, tag]);

  useEffect(() => {
    if (projectId !== 'all' && !projectOptions.some(([id]) => id === projectId)) setProjectId('all');
  }, [projectId, projectOptions]);

  useEffect(() => {
    if (tag !== 'all' && !tags.includes(tag)) setTag('all');
  }, [tag, tags]);

  const stats = useMemo(() => {
    const result = { total: allItems.length, pending: 0, today: 0, overdue: 0, unscheduled: 0, completed: 0 };
    for (const item of allItems) {
      const header = item.block.header;
      if (header.isCompleted) { result.completed++; continue; }
      result.pending++;
      if (header.date === today) result.today++;
      if (!header.date) result.unscheduled++;
      else if (isBeforeDay(header.date, today)) result.overdue++;
    }
    return result;
  }, [allItems, today]);

  const filtered = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLocaleLowerCase('zh-CN');
    const endOfWeek = weekEnd(today);
    const thisMonth = today.slice(0, 7);
    return allItems.filter((item) => {
      const { header } = item.block;
      if (projectId !== 'all' && item.task.id !== projectId) return false;
      if (tag !== 'all' && header.tag !== tag) return false;
      if (normalizedQuery) {
        const searchable = `${header.title} ${stripHtml(item.block.body)} ${item.projectLabel} ${header.tag}`.toLocaleLowerCase('zh-CN');
        if (!searchable.includes(normalizedQuery)) return false;
      }
      if (status === 'pending' && header.isCompleted) return false;
      if (status === 'completed' && !header.isCompleted) return false;
      if (status === 'overdue' && (header.isCompleted || !header.date || !isBeforeDay(header.date, today))) return false;
      if (status === 'unscheduled' && (header.isCompleted || Boolean(header.date))) return false;
      if (dateFilter === 'today' && header.date !== today) return false;
      if (dateFilter === 'week' && (!header.date || isBeforeDay(header.date, today) || isAfterDay(header.date, endOfWeek))) return false;
      if (dateFilter === 'month' && (!header.date || header.date.slice(0, 7) !== thisMonth)) return false;
      return true;
    }).sort((a, b) => {
      if (a.block.header.isCompleted !== b.block.header.isCompleted) return Number(a.block.header.isCompleted) - Number(b.block.header.isCompleted);
      const dateA = a.block.header.date || '9999-12-31';
      const dateB = b.block.header.date || '9999-12-31';
      return dateA.localeCompare(dateB) || a.block.header.title.localeCompare(b.block.header.title, 'zh-CN');
    });
  }, [allItems, dateFilter, deferredQuery, projectId, status, tag, today]);

  const grouped = useMemo(() => {
    const map = new Map<string, OverviewGroup>();
    for (const item of filtered) {
      let descriptor: Omit<OverviewGroup, 'items'>;
      if (groupMode === 'project') {
        descriptor = { key: `project-${item.task.id}`, label: item.projectLabel, order: item.projectLabel };
      } else if (groupMode === 'tag') {
        const label = item.block.header.tag || '未分类';
        descriptor = { key: `tag-${label}`, label, order: label };
      } else {
        descriptor = buildDateGroup(item, today);
      }
      const existing = map.get(descriptor.key);
      if (existing) existing.items.push(item);
      else map.set(descriptor.key, { ...descriptor, items: [item] });
    }
    return [...map.values()].sort((a, b) => a.order.localeCompare(b.order, 'zh-CN'));
  }, [filtered, groupMode, today]);

  const toggleCollapsed = (key: string) => setCollapsed((current) => {
    const next = new Set(current);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const toggleComplete = (item: OverviewItem) => {
    if (isQuantityTask(item.block.header)) return;
    toggleProjectTaskCompletion(item.task.id, item.block.id, today);
  };

  return (
    <main className="task-overview" aria-labelledby="task-overview-title">
      <header className="task-overview-header">
        <div>
          <h1 id="task-overview-title">任务总览</h1>
          <p>集中查看和管理所有项目文档中的任务</p>
        </div>
        <div className="task-overview-header-actions">
          <button type="button" className="task-overview-create" onClick={() => openProjectTaskCreate({ source: 'task-overview' })}><Plus size={15} />新建任务</button>
          <div className="task-overview-group-switch" role="group" aria-label="任务分组方式">
            {([['date', '按日期'], ['project', '按项目'], ['tag', '按类型']] as const).map(([value, label]) => (
              <button key={value} type="button" className={groupMode === value ? 'is-active' : ''} onClick={() => setGroupMode(value)}>{label}</button>
            ))}
          </div>
        </div>
      </header>

      <section className="task-overview-stats" aria-label="任务统计">
        <button type="button" className={status === 'all' && dateFilter === 'all' ? 'is-active' : ''} onClick={() => { setStatus('all'); setDateFilter('all'); }}><strong>{stats.total}</strong><span>全部任务</span></button>
        <button type="button" className={status === 'pending' && dateFilter === 'all' ? 'is-active' : ''} onClick={() => { setStatus('pending'); setDateFilter('all'); }}><strong>{stats.pending}</strong><span>未完成</span></button>
        <button type="button" className={status === 'pending' && dateFilter === 'today' ? 'is-active' : ''} onClick={() => { setStatus('pending'); setDateFilter('today'); }}><strong>{stats.today}</strong><span>今天</span></button>
        <button type="button" className={status === 'overdue' && dateFilter === 'all' ? 'is-active is-danger' : ''} onClick={() => { setStatus('overdue'); setDateFilter('all'); }}><strong>{stats.overdue}</strong><span>已逾期</span></button>
        <button type="button" className={status === 'unscheduled' && dateFilter === 'all' ? 'is-active' : ''} onClick={() => { setStatus('unscheduled'); setDateFilter('all'); }}><strong>{stats.unscheduled}</strong><span>未排期</span></button>
        <button type="button" className={status === 'completed' && dateFilter === 'all' ? 'is-active' : ''} onClick={() => { setStatus('completed'); setDateFilter('all'); }}><strong>{stats.completed}</strong><span>已完成</span></button>
      </section>

      <section className="task-overview-filters" aria-label="任务筛选">
        <label className="task-overview-search">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索任务、正文或项目……" aria-label="搜索全部项目任务" />
        </label>
        <label className="task-overview-select"><FolderOpen size={16} /><select value={projectId} onChange={(event) => setProjectId(event.target.value)} aria-label="按项目筛选"><option value="all">全部项目</option>{projectOptions.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><ChevronDown size={14} /></label>
        <label className="task-overview-select"><select value={tag} onChange={(event) => setTag(event.target.value)} aria-label="按任务类型筛选"><option value="all">全部类型</option>{tags.map((value) => <option key={value} value={value}>{value}</option>)}</select><ChevronDown size={14} /></label>
        <label className="task-overview-select"><select value={status} onChange={(event) => setStatus(event.target.value as StatusFilter)} aria-label="按任务状态筛选"><option value="all">全部状态</option><option value="pending">未完成</option><option value="completed">已完成</option><option value="overdue">已逾期</option><option value="unscheduled">未排期</option></select><ChevronDown size={14} /></label>
        <label className="task-overview-select"><CalendarDays size={16} /><select value={dateFilter} onChange={(event) => setDateFilter(event.target.value as DateFilter)} aria-label="按日期范围筛选"><option value="all">全部日期</option><option value="today">今天</option><option value="week">本周剩余</option><option value="month">本月</option></select><ChevronDown size={14} /></label>
      </section>

      <section className="task-overview-results" aria-live="polite">
        <div className="task-overview-result-count">当前显示 {filtered.length} 项</div>
        {grouped.length === 0 ? (
          <div className="task-overview-empty"><CalendarDays size={42} /><strong>没有符合条件的项目任务</strong><span>可以调整搜索内容或筛选条件</span></div>
        ) : grouped.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          return (
            <section className="task-overview-section" key={group.key}>
              <button type="button" className="task-overview-section-header" onClick={() => toggleCollapsed(group.key)} aria-expanded={!isCollapsed}>
                <ChevronDown size={17} className={isCollapsed ? 'is-collapsed' : ''} />
                <strong>{group.label}</strong>
                <span>{group.items.length} 项</span>
              </button>
              {!isCollapsed && <div className="task-overview-list">{group.items.map((item) => {
                const { header } = item.block;
                const overdue = !header.isCompleted && Boolean(header.date) && isBeforeDay(header.date, today);
                const category = resolveTaskCategoryTheme(header.tagColor);
                const graphCount = getValidGraphNodeIds(header).length;
                const quantityStatus = isQuantityTask(header) ? getQuantityDailyStatus(header, today) : null;
                return (
                  <article
                    key={`${item.task.id}-${item.block.id}`}
                    className={`task-overview-card ${header.isCompleted ? 'is-completed' : ''} ${overdue ? 'is-overdue' : ''}`}
                    style={{ '--task-accent': category.accentColor, '--task-surface': category.backgroundColor } as React.CSSProperties}
                    data-task-id={item.task.id}
                    data-block-id={item.block.id}
                    tabIndex={0}
                    onClick={() => openProjectTaskModal(item.task.id, item.block.id, { source: 'task-overview' })}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openProjectTaskModal(item.task.id, item.block.id, { source: 'task-overview' });
                      }
                    }}
                  >
                    <button type="button" className={`task-overview-check ${header.isCompleted ? 'is-checked' : ''}`} onClick={(event) => { event.stopPropagation(); toggleComplete(item); }} aria-disabled={isQuantityTask(header)} aria-label={isQuantityTask(header) ? `数量进度：${header.title}` : header.isCompleted ? `取消完成：${header.title}` : `完成：${header.title}`}>{header.isCompleted && <Check size={15} />}</button>
                    <div className="task-overview-card-content">
                      <div className="task-overview-card-title">{header.title}</div>
                      <div className="task-overview-card-meta">
                        <span className="task-overview-project-badge" style={{ backgroundColor: item.projectColor }}><FolderOpen size={12} />{item.projectLabel}</span>
                        <span className="task-overview-tag" style={{ borderColor: category.accentColor, color: category.accentColor }}>{header.tag || '未分类'}</span>
                        {header.date && <span className={overdue ? 'is-danger' : ''}><CalendarDays size={13} />{formatShortDate(header.date)}</span>}
                        {!header.date && <span><CalendarDays size={13} />未排期</span>}
                        {header.deadline && <span><Target size={13} />截止 {formatShortDate(header.deadline)}</span>}
                        {isQuantityTask(header)
                          ? <><span><Hash size={13} />进度 {getQuantityCompleted(header)}/{getQuantityTotal(header)} {getQuantityUnit(header)} · {getQuantityProgressPercent(header)}%</span><span>今日 {quantityStatus?.actual ?? 0}{quantityStatus?.target !== undefined ? `/${quantityStatus.target}` : ''} {getQuantityUnit(header)}</span></>
                          : <span><Clock3 size={13} />{header.duration} 分钟</span>}
                        <span title={graphCount > 0 ? `已绑定 ${graphCount} 个知识节点` : '未绑定知识节点'}><Link2 size={13} />{graphCount > 0 ? `${graphCount} 个节点` : '未绑定节点'}</span>
                      </div>
                    </div>
                  </article>
                );
              })}</div>}
            </section>
          );
        })}
      </section>
    </main>
  );
};

export default TaskOverviewView;

import { AlertTriangle, ChevronDown, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { getStageContents, getStageStats } from '@/lifeMap/selectors/lifeMapSelectors';
import type { LifeGoal, LifeMapData, LifeMapStage } from '@/lifeMap/types';
import { diffDays, todayStr } from '@/utils/dateSafe';
import StageStats from './StageStats';
import StageTimeline from './StageTimeline';
import '@/styles/stage-workspace.css';

interface StageWorkspaceProps {
  data: LifeMapData;
  stageId: string;
  pinned: boolean;
  onTogglePin: () => void;
  onClose: () => void;
  onEdit: (stage: LifeMapStage) => void;
  onDelete: (stage: LifeMapStage) => void;
  onCreatePlan: () => void;
  onCreateNote: () => void;
  onOpenGoal: (id: string) => void;
}

type InspectorTab = 'overview' | 'contents' | 'timeline';

const toDisplayDate = (date: string) => date.replace(/-/g, '.');
const isWithin = (date: string, start: string, end: string) => date >= start && date <= end;
const isCurrent = (item: Pick<LifeGoal, 'start' | 'targetDate' | 'status'>, today: string) => item.status === 'active' && isWithin(today, item.start, item.targetDate);

const StageWorkspace: React.FC<StageWorkspaceProps> = ({ data, stageId, pinned, onTogglePin, onClose, onEdit, onDelete, onCreatePlan, onCreateNote, onOpenGoal }) => {
  const [activeTab, setActiveTab] = useState<InspectorTab>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const contents = getStageContents(data, stageId);
  const stats = getStageStats(data, stageId);
  const today = todayStr();
  const derived = useMemo(() => {
    if (!contents || !stats) return null;
    const childIds = new Set(contents.phases.map((phase) => phase.parentGoalId));
    const executableItems = [
      ...contents.plans.filter((plan) => !childIds.has(plan.id)),
      ...contents.phases,
    ].sort((left, right) => left.start.localeCompare(right.start) || left.targetDate.localeCompare(right.targetDate));
    const currentProjects = executableItems.filter((item) => isCurrent(item, today));
    const currentSystems = contents.systems.filter((system) => system.status === 'active' && isWithin(today, system.start, system.end ?? contents.stage.end));
    const nextItems = [
      ...contents.events.filter((event) => event.date >= today).map((event) => ({ id: `event:${event.id}`, date: event.date, name: event.name, kind: 'event' as const })),
      ...executableItems.filter((item) => item.targetDate >= today).map((item) => ({ id: `goal:${item.id}`, date: item.targetDate, name: `${item.name}结束`, kind: 'goal' as const, goalId: item.id })),
    ].sort((left, right) => left.date.localeCompare(right.date) || left.name.localeCompare(right.name));
    const outOfRangeCount = executableItems.filter((item) => item.start < contents.stage.start || item.targetDate > contents.stage.end).length;
    const overdueCount = executableItems.filter((item) => item.status === 'active' && item.targetDate < today).length;
    const stageDays = Math.max(1, diffDays(contents.stage.end, contents.stage.start) + 1);
    const elapsedDays = Math.max(0, Math.min(stageDays, diffDays(today, contents.stage.start) + 1));
    const timeProgress = Math.round(elapsedDays / stageDays * 100);
    const behindSchedule = today >= contents.stage.start && today <= contents.stage.end && stats.completionRate + 15 < timeProgress;
    return { executableItems, currentProjects, currentSystems, nextItems, outOfRangeCount, overdueCount, behindSchedule };
  }, [contents, stats, today]);

  if (!contents || !stats || !derived) return null;
  const { stage } = contents;
  const stageStatus = today < stage.start ? '未开始' : today > stage.end ? '已结束' : '进行中';
  const hasContent = derived.executableItems.length > 0 || contents.systems.length > 0 || contents.events.length > 0 || contents.pinNotes.length > 0 || contents.rangeNotes.length > 0 || contents.focuses.length > 0 || contents.themes.length > 0;
  const openGoal = (id: string) => onOpenGoal(id);

  return <aside className="context-inspector stage-workspace" aria-label={`${stage.name}阶段检查器`}>
    <header className="stage-workspace__header">
      <div className="stage-workspace__heading">
        <span className="stage-workspace__eyebrow">人生阶段</span>
        <h2 title={stage.name}>{stage.name}</h2>
        <p>{toDisplayDate(stage.start)} — {toDisplayDate(stage.end)}</p>
        <div className="stage-workspace__progress" aria-label={`阶段进度 ${stats.completionRate}% · ${stageStatus}`}>
          <i><span style={{ width: `${stats.completionRate}%` }} /></i><b>{stats.completionRate}% · {stageStatus}</b>
        </div>
        <StageStats stats={stats} />
      </div>
      <div className="stage-workspace__header-actions">
        <button type="button" className={pinned ? 'is-active' : undefined} onClick={onTogglePin} aria-label={pinned ? '取消固定检查器' : '固定检查器'} title={pinned ? '取消固定' : '固定'}>{pinned ? <PinOff size={16} /> : <Pin size={16} />}</button>
        <div className="stage-workspace__more-menu">
          <button type="button" onClick={() => setMenuOpen((open) => !open)} aria-label="更多阶段操作" aria-expanded={menuOpen}><MoreHorizontal size={18} /></button>
          {menuOpen && <div role="menu">
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit(stage); }}><Pencil size={15} />编辑阶段</button>
            <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onEdit(stage); }}>调整日期</button>
            <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenuOpen(false); onDelete(stage); }}><Trash2 size={15} />删除阶段</button>
          </div>}
        </div>
        <button type="button" onClick={onClose} aria-label="关闭阶段检查器"><X size={18} /></button>
      </div>
    </header>

    <nav className="stage-workspace__tabs" aria-label="阶段检查器视图">
      {([['overview', '概览'], ['contents', '内容'], ['timeline', '时间']] as const).map(([value, label]) => <button key={value} type="button" aria-selected={activeTab === value} onClick={() => setActiveTab(value)}>{label}</button>)}
    </nav>

    <div className="stage-workspace__body">
      {activeTab === 'overview' && <StageOverview contents={contents} currentProjects={derived.currentProjects} currentSystems={derived.currentSystems} nextItems={derived.nextItems} outOfRangeCount={derived.outOfRangeCount} overdueCount={derived.overdueCount} behindSchedule={derived.behindSchedule} onOpenGoal={openGoal} onEdit={() => onEdit(stage)} />}
      {activeTab === 'contents' && (hasContent ? <StageContentsPanel contents={contents} items={derived.executableItems} onOpenGoal={openGoal} /> : <EmptyStage />)}
      {activeTab === 'timeline' && (hasContent ? <StageTimeline contents={contents} onOpenGoal={openGoal} /> : <EmptyStage />)}
    </div>

    <footer className="stage-workspace__actions">
      <button type="button" onClick={onCreatePlan}><Plus size={16} />项目</button>
      <button type="button" onClick={onCreateNote}><Plus size={16} />批注</button>
      <button type="button" onClick={() => onEdit(stage)}>编辑阶段</button>
    </footer>
  </aside>;
};

interface OverviewProps {
  contents: NonNullable<ReturnType<typeof getStageContents>>;
  currentProjects: LifeGoal[];
  currentSystems: LifeMapData['lifeMapSystems'];
  nextItems: Array<{ id: string; date: string; name: string; kind: 'event' | 'goal'; goalId?: string }>;
  outOfRangeCount: number;
  overdueCount: number;
  behindSchedule: boolean;
  onOpenGoal: (id: string) => void;
  onEdit: () => void;
}

const StageOverview: React.FC<OverviewProps> = ({ contents, currentProjects, currentSystems, nextItems, outOfRangeCount, overdueCount, behindSchedule, onOpenGoal, onEdit }) => {
  const attentionCount = outOfRangeCount + overdueCount + (behindSchedule ? 1 : 0);
  return <div className="stage-workspace__overview">
    <InspectorSection title="当前进行中" count={currentProjects.length + currentSystems.length}>
      {currentProjects.length === 0 && currentSystems.length === 0
        ? <p className="stage-workspace__quiet">今天没有正在进行的项目或系统。</p>
        : <div className="stage-workspace__now-list">
          {currentProjects.map((item) => <button type="button" key={item.id} onClick={() => onOpenGoal(item.id)}><b>{item.name}</b><span>{item.start.slice(5)} — {item.targetDate.slice(5)}</span></button>)}
          {currentSystems.map((item) => <div key={item.id}><b>{item.name}</b><span>长期系统 · {item.start.slice(5)} — {(item.end ?? contents.stage.end).slice(5)}</span></div>)}
        </div>}
    </InspectorSection>

    <InspectorSection title="接下来">
      {nextItems.length === 0 ? <p className="stage-workspace__quiet">本阶段暂时没有后续关键事项。</p> : <ol className="stage-workspace__next-list">
        {nextItems.slice(0, 4).map((item) => <li key={item.id}>{item.kind === 'event' && <i aria-hidden>◆</i>}<time>{item.date.slice(5)}</time>{item.goalId ? <button type="button" onClick={() => onOpenGoal(item.goalId!)}>{item.name}</button> : <span>{item.name}</span>}</li>)}
      </ol>}
    </InspectorSection>

    <InspectorSection title="需要关注" count={attentionCount} tone={attentionCount ? 'warning' : undefined}>
      {attentionCount === 0 ? <p className="stage-workspace__quiet">目前没有需要立即处理的问题。</p> : <ul className="stage-workspace__attention-list">
        {outOfRangeCount > 0 && <li><AlertTriangle size={15} />{outOfRangeCount} 个项目超出阶段范围</li>}
        {overdueCount > 0 && <li><AlertTriangle size={15} />{overdueCount} 个项目已超过计划结束日期</li>}
        {behindSchedule && <li><AlertTriangle size={15} />当前完成率低于时间进度</li>}
      </ul>}
    </InspectorSection>

    <InspectorSection title="阶段说明">
      {contents.stage.description ? <p className="stage-workspace__description">{contents.stage.description}</p> : <button type="button" className="stage-workspace__add-description" onClick={onEdit}>添加阶段说明</button>}
    </InspectorSection>
  </div>;
};

const InspectorSection: React.FC<{ title: string; count?: number; tone?: 'warning'; children: React.ReactNode }> = ({ title, count, tone, children }) => <section className="stage-workspace__section">
  <header><h3>{title}</h3>{count !== undefined && <span className={tone ? `is-${tone}` : undefined}>{count}</span>}</header>{children}
</section>;

const StageContentsPanel: React.FC<{ contents: NonNullable<ReturnType<typeof getStageContents>>; items: LifeGoal[]; onOpenGoal: (id: string) => void }> = ({ contents, items, onOpenGoal }) => {
  const childrenByPlan = new Map(contents.plans.map((plan) => [plan.id, contents.phases.filter((phase) => phase.parentGoalId === plan.id)]));
  return <div className="stage-workspace__contents">
    <ContentGroup title="项目" count={items.length} open>
      {contents.plans.length === 0 ? <p className="stage-workspace__quiet">暂无项目</p> : contents.plans.map((plan) => <div key={plan.id} className="stage-workspace__content-plan"><button type="button" onClick={() => onOpenGoal(plan.id)}>{plan.name}</button>{(childrenByPlan.get(plan.id) ?? []).map((child) => <button type="button" key={child.id} className="is-child" onClick={() => onOpenGoal(child.id)}>{child.name}<small>{child.start.slice(5)} — {child.targetDate.slice(5)}</small></button>)}</div>)}
    </ContentGroup>
    <ContentGroup title="系统" count={contents.systems.length}>{contents.systems.length ? contents.systems.slice(0, 5).map((item) => <div className="stage-workspace__content-line" key={item.id}>{item.name}</div>) : <p className="stage-workspace__quiet">暂无长期系统</p>}</ContentGroup>
    <ContentGroup title="关键日期" count={contents.events.length}>{contents.events.length ? contents.events.slice(0, 5).map((item) => <div className="stage-workspace__content-line" key={item.id}><i>◆</i>{item.name}<small>{item.date}</small></div>) : <p className="stage-workspace__quiet">暂无关键日期</p>}</ContentGroup>
    <ContentGroup title="批注" count={contents.pinNotes.length + contents.rangeNotes.length}>{[...contents.pinNotes, ...contents.rangeNotes].length ? [...contents.pinNotes, ...contents.rangeNotes].slice(0, 5).map((item) => <div className="stage-workspace__content-line" key={item.id}>{item.name}</div>) : <p className="stage-workspace__quiet">暂无批注</p>}</ContentGroup>
  </div>;
};

const ContentGroup: React.FC<{ title: string; count: number; open?: boolean; children: React.ReactNode }> = ({ title, count, open, children }) => <details className="stage-workspace__content-group" open={open}><summary>{title}<span>{count}</span><ChevronDown size={15} /></summary><div>{children}</div></details>;

const EmptyStage: React.FC = () => <section className="stage-workspace__empty"><b>此阶段暂无关联内容</b><span>项目、系统、重点与便签会按日期自动归入这里。</span></section>;

export default StageWorkspace;

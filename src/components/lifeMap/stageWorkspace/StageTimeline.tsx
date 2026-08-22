import { useMemo, useState, type CSSProperties } from 'react';
import { assignInclusiveIntervalTracks } from '@/lifeMap/planSwimlaneLayout';
import type { StageContents, StageWorkspaceZoom } from '@/lifeMap/selectors/lifeMapSelectors';
import { addDays, diffDays } from '@/utils/dateSafe';

const pixelsPerDay: Record<StageWorkspaceZoom, number> = { month: 3, 'half-month': 5, week: 10, day: 28 };
type StageTimelineMode = 'fit' | StageWorkspaceZoom;

const labels: Array<{ value: StageTimelineMode; label: string }> = [
  { value: 'fit', label: '适应' }, { value: 'month', label: '月' }, { value: 'half-month', label: '半月' }, { value: 'week', label: '周' }, { value: 'day', label: '日' },
];
const stepDays: Record<StageWorkspaceZoom, number> = { month: 30, 'half-month': 15, week: 7, day: 1 };

interface StageTimelineProps { contents: StageContents; onOpenGoal?: (id: string) => void; }

const StageTimeline: React.FC<StageTimelineProps> = ({ contents, onOpenGoal }) => {
  const [zoom, setZoom] = useState<StageTimelineMode>('fit');
  const dayCount = diffDays(contents.stage.end, contents.stage.start) + 1;
  const isFit = zoom === 'fit';
  const ppx = isFit ? 0 : pixelsPerDay[zoom];
  const width = isFit ? undefined : Math.max(320, dayCount * ppx);
  const ticks = useMemo(() => {
    const step = isFit ? Math.max(1, Math.ceil(dayCount / 4)) : stepDays[zoom];
    return Array.from({ length: Math.ceil(dayCount / step) + 1 }, (_, index) => {
      const offset = Math.min(dayCount - 1, index * step);
      return { offset, label: addDays(contents.stage.start, offset).slice(5) };
    });
  }, [contents.stage.start, dayCount, zoom, isFit]);
  const tracks = useMemo(() => assignInclusiveIntervalTracks(contents.plans).trackById, [contents.plans]);
  const trackCount = Math.max(1, ...tracks.values(), 0) + 1;
  const phasesByPlan = useMemo(() => new Map(contents.plans.map((plan) => [plan.id, contents.phases.filter((phase) => phase.parentGoalId === plan.id)])), [contents.phases, contents.plans]);
  const position = (date: string): string | number => {
    const offset = Math.max(0, Math.min(dayCount - 1, diffDays(date, contents.stage.start)));
    return isFit ? `${offset / Math.max(1, dayCount - 1) * 100}%` : offset * ppx;
  };
  const interval = (start: string, end: string) => {
    const visibleStart = start < contents.stage.start ? contents.stage.start : start;
    const visibleEnd = end > contents.stage.end ? contents.stage.end : end;
    const left = position(visibleStart);
    const visibleDays = Math.max(1, diffDays(visibleEnd, visibleStart) + 1);
    return { left, width: isFit ? `${visibleDays / dayCount * 100}%` : Math.max(3, (position(visibleEnd) as number) - (left as number) + ppx), clippedStart: start < contents.stage.start, clippedEnd: end > contents.stage.end };
  };
  const focusBands = [
    ...contents.themes.map((item) => ({ id: `theme:${item.id}`, name: item.name, start: item.start, end: item.end, color: item.color ?? '#8B5CF6' })),
    ...contents.focuses.map((item) => ({ id: `focus:${item.id}`, name: item.name, start: item.start, end: item.end, color: item.color ?? '#0EA5E9' })),
    ...contents.rangeNotes.map((item) => ({ id: `note:${item.id}`, name: item.name, start: item.date, end: item.endDate!, color: item.color ?? '#F59E0B' })),
  ];
  const pins = useMemo(() => [
    ...contents.pinNotes.map((note) => ({ id: note.id, name: note.name, date: note.date, color: note.color })),
    ...contents.events.map((event) => ({ id: `event:${event.id}`, name: event.name, date: event.date, color: event.color ?? '#D97706' })),
  ], [contents.events, contents.pinNotes]);
  const pinsByDate = useMemo(() => {
    const map = new Map<string, typeof pins>();
    pins.forEach((pin) => {
      if (pin.date < contents.stage.start || pin.date > contents.stage.end) return;
      const entries = map.get(pin.date) ?? [];
      entries.push(pin); map.set(pin.date, entries);
    });
    return map;
  }, [contents.stage.end, contents.stage.start, pins]);
  const checkInsBySystem = useMemo(() => new Map(contents.systems.map((system) => [system.id, contents.systemCheckIns.filter((entry) => entry.systemId === system.id)])), [contents.systemCheckIns, contents.systems]);
  const aggregateCheckIns = (systemId: string) => {
    const weeklyBuckets = new Map<number, Array<{ date: string; count: number }>>();
    (checkInsBySystem.get(systemId) ?? []).forEach((entry) => {
      const key = Math.floor(Math.max(0, diffDays(entry.date, contents.stage.start)) / 7);
      weeklyBuckets.set(key, [...(weeklyBuckets.get(key) ?? []), { date: entry.date, count: entry.count }]);
    });
    return [...weeklyBuckets.values()].flatMap((entries) => {
      const total = entries.reduce((sum, entry) => sum + entry.count, 0);
      return total <= 5 ? entries : [{ date: entries.reduce((first, entry) => entry.date < first ? entry.date : first, entries[0].date), count: total }];
    });
  };
  return <section className="stage-workspace__timeline-section" aria-label="阶段内时间轴">
    <header className="stage-workspace__timeline-toolbar"><div><b>阶段时间</b><small>{isFit ? '完整适配当前阶段' : `按${labels.find((item) => item.value === zoom)?.label}浏览`}</small></div><div role="group" aria-label="阶段时间轴缩放">{labels.map((item) => <button key={item.value} type="button" aria-pressed={zoom === item.value} onClick={() => setZoom(item.value)}>{item.label}</button>)}</div></header>
    <div className={`stage-workspace__timeline-scroll${isFit ? ' is-fit' : ''}`}>
      <div className="stage-workspace__timeline" style={{ width }}>
        <div className="stage-workspace__ticks">{ticks.map((tick) => <span key={tick.offset} style={{ left: isFit ? `${tick.offset / Math.max(1, dayCount - 1) * 100}%` : tick.offset * ppx }}><i />{tick.label}</span>)}</div>
        {focusBands.length > 0 && <div className="stage-workspace__focus-bands">{focusBands.map((band) => {
          const box = interval(band.start, band.end);
          return <span key={band.id} style={{ left: box.left, width: box.width, '--stage-focus-color': band.color } as CSSProperties} title={band.name}>{band.name}</span>;
        })}</div>}
        <div className="stage-workspace__project-tracks" style={{ minHeight: trackCount * 42 + 16 }}>
          {contents.plans.map((plan) => {
            const box = interval(plan.start, plan.targetDate);
            const top = (tracks.get(plan.id) ?? 0) * 42 + 8;
            return <div key={plan.id}><button type="button" className={`stage-workspace__project-bar${box.clippedStart ? ' is-clipped-start' : ''}${box.clippedEnd ? ' is-clipped-end' : ''}`} onClick={() => onOpenGoal?.(plan.id)} style={{ left: box.left, top, width: box.width, '--stage-project-color': plan.color ?? '#6671d7' } as CSSProperties} title={`${plan.name} · ${plan.start} — ${plan.targetDate}`}><span>{plan.name}</span></button>{(phasesByPlan.get(plan.id) ?? []).map((phase) => {
              const phaseBox = interval(phase.start, phase.targetDate);
              return <button type="button" key={phase.id} className={`stage-workspace__phase-bar${phaseBox.clippedStart ? ' is-clipped-start' : ''}${phaseBox.clippedEnd ? ' is-clipped-end' : ''}`} onClick={() => onOpenGoal?.(phase.id)} style={{ left: phaseBox.left, top: top + 25, width: phaseBox.width, '--stage-project-color': plan.color ?? '#6671d7' } as CSSProperties} title={`${phase.name} · ${phase.start} — ${phase.targetDate}`}><span>{phase.name}</span></button>;
            })}</div>;
          })}
          {contents.plans.length === 0 && <p>此阶段暂无关联项目。</p>}
        </div>
        {contents.systems.length > 0 && <section className="stage-workspace__systems" aria-label="阶段内长期系统"><b>长期系统</b>{contents.systems.map((system) => {
          const box = interval(system.start, system.end ?? contents.stage.end);
          return <div className="stage-workspace__system-row" key={system.id}><span className="stage-workspace__system-name">{system.name}</span><i className="stage-workspace__system-range" style={{ left: box.left, width: box.width, '--stage-system-color': system.color ?? '#10B981' } as CSSProperties} />{aggregateCheckIns(system.id).map((entry) => <em key={`${system.id}:${entry.date}`} style={{ left: position(entry.date) }} title={`${entry.date} · ${entry.count} 次`}>●{entry.count > 1 ? ` ${entry.count}` : ''}</em>)}</div>;
        })}</section>}
        {pinsByDate.size > 0 && <div className="stage-workspace__pin-layer" aria-label="便签与关键日期">{[...pinsByDate.entries()].map(([date, entries]) => <button key={date} type="button" style={{ left: position(date), '--stage-pin-color': entries[0]?.color ?? '#D97706' } as CSSProperties} title={entries.map((entry) => entry.name).join('；')}><i />{entries[0]?.name}{entries.length > 1 ? ` +${entries.length - 1}` : ''}</button>)}</div>}
      </div>
    </div>
  </section>;
};

export default StageTimeline;

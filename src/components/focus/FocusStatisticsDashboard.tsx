import React from 'react';
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, CircleDot, Target } from 'lucide-react';
import { focusCategoryTotals, focusDateRange, focusInterruptionSummary, focusQualitySummary, focusTimeBuckets, focusTrend, focusWeekComparison, focusWeeklyReviewInsight, moveFocusAnchor, visibleSessionsInRange, weeklyTargetForWeek, type FocusAnalyticsRange } from '@/focus/analytics';
import type { FocusSession, FocusSubject, FocusWeeklyReview } from '@/focus/types';

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};
const rangeNames: Record<FocusAnalyticsRange, string> = { day: '日', week: '周', month: '月', last7: '7 日', last30: '30 日', custom: '自定义' };
const dateLabel = (date: string, range: FocusAnalyticsRange) => range === 'month' ? date.slice(8) : range === 'week' ? `周${['日', '一', '二', '三', '四', '五', '六'][new Date(`${date}T00:00:00Z`).getUTCDay()]}` : date.slice(5);
const sumDuration = (items: readonly { activeSeconds: number }[]) => items.reduce((sum, item) => sum + item.activeSeconds, 0);
const EmptyChart: React.FC<{ title?: string; children: React.ReactNode }> = ({ title = '暂无专注数据', children }) => <div className="focus-stat-empty"><strong>{title}</strong><p>{children}</p></div>;
const interruptionReasonNames = { urgent: '临时事务', people: '被他人打断', energy: '精力不足', 'switch-task': '切换任务', other: '其他' } as const;

export const FocusStatisticsDashboard: React.FC<{
  sessions: readonly FocusSession[];
  subjects: readonly FocusSubject[];
  weeklyReviews: readonly FocusWeeklyReview[];
  today: string;
  onSaveWeeklyReview: (weekStart: string, nextWeekPlan: string) => Promise<void>;
}> = ({ sessions, subjects, weeklyReviews, today, onSaveWeeklyReview }) => {
  const [range, setRange] = React.useState<FocusAnalyticsRange>('last7');
  const [anchor, setAnchor] = React.useState(today);
  const [customStart, setCustomStart] = React.useState(today);
  const [customEnd, setCustomEnd] = React.useState(today);
  const [reviewDraft, setReviewDraft] = React.useState('');
  const [isSavingReview, setIsSavingReview] = React.useState(false);
  const [reviewError, setReviewError] = React.useState<string | null>(null);
  const period = React.useMemo(() => focusDateRange(range, anchor, customStart, customEnd), [anchor, customEnd, customStart, range]);
  const periodSessions = React.useMemo(() => visibleSessionsInRange(sessions, period), [period, sessions]);
  const trend = React.useMemo(() => focusTrend(sessions, period), [period, sessions]);
  const categories = React.useMemo(() => focusCategoryTotals(periodSessions, subjects), [periodSessions, subjects]);
  const timeBuckets = React.useMemo(() => focusTimeBuckets(periodSessions), [periodSessions]);
  const weekSessions = React.useMemo(() => visibleSessionsInRange(sessions, focusDateRange('week', today, today, today)), [sessions, today]);
  const weekRange = focusDateRange('week', today, today, today);
  const trendMax = Math.max(1, ...trend.map((point) => point.activeSeconds));
  const activeTrendDays = trend.filter((point) => point.activeSeconds > 0);
  const categoryTotal = sumDuration(categories);
  const donut = categories.length ? `conic-gradient(${categories.reduce((parts, category, index) => {
    const before = categories.slice(0, index).reduce((sum, item) => sum + item.activeSeconds, 0) / categoryTotal * 100;
    parts.push(`${category.color} ${before}% ${before + category.activeSeconds / categoryTotal * 100}%`);
    return parts;
  }, [] as string[]).join(', ')})` : 'conic-gradient(#e8ecf3 0 100%)';
  const points = trend.map((point, index) => `${16 + index / Math.max(1, trend.length - 1) * 288},${100 - point.activeSeconds / trendMax * 76}`).join(' ');
  const rankingMax = Math.max(1, ...categories.map((category) => category.activeSeconds));
  const timeBucketMax = Math.max(1, ...timeBuckets.map((bucket) => bucket.activeSeconds));
  const weeklyGoals = subjects.filter((subject) => !subject.archivedAt && weeklyTargetForWeek(subject, weekRange.end)).map((subject) => {
    const seconds = weekSessions.filter((session) => session.subjectId === subject.id).reduce((sum, session) => sum + session.activeSeconds, 0);
    const targetMinutes = weeklyTargetForWeek(subject, weekRange.end)!;
    return { subject, seconds, targetMinutes, percent: Math.min(100, seconds / (targetMinutes * 60) * 100) };
  });
  const weekComparison = React.useMemo(() => focusWeekComparison(sessions, subjects, today), [sessions, subjects, today]);
  const previousWeekSessions = React.useMemo(() => visibleSessionsInRange(
    sessions,
    focusDateRange('week', moveFocusAnchor('week', today, -1), today, today),
  ), [sessions, today]);
  const currentQuality = React.useMemo(() => focusQualitySummary(weekSessions), [weekSessions]);
  const weeklyInsight = React.useMemo(() => focusWeeklyReviewInsight(weekSessions, subjects), [subjects, weekSessions]);
  const interruptions = React.useMemo(() => focusInterruptionSummary(periodSessions), [periodSessions]);
  const weeklyReview = weeklyReviews.find((item) => item.weekStart === weekRange.start);
  React.useEffect(() => {
    setReviewDraft(weeklyReview?.nextWeekPlan ?? '');
    setReviewError(null);
  }, [weekRange.start, weeklyReview?.nextWeekPlan]);
  const weekDelta = weekComparison.current.activeSeconds - weekComparison.previous.activeSeconds;
  const weekDeltaPercent = weekComparison.previous.activeSeconds ? Math.round(weekDelta / weekComparison.previous.activeSeconds * 100) : null;
  const periodTotal = sumDuration(periodSessions);
  const summaryMetrics = [
    { label: '总专注', value: formatDuration(periodTotal) },
    { label: '会话', value: `${periodSessions.length} 次` },
    { label: '活跃主题', value: `${categories.length} 个` },
    { label: '平均单次', value: formatDuration(periodSessions.length ? Math.floor(periodTotal / periodSessions.length) : 0) },
  ];
  const chooseRange = (value: FocusAnalyticsRange) => { setRange(value); if (value !== 'custom') setAnchor(today); };
  const qualityRows = [
    ['平均单次', formatDuration(currentQuality.averageActiveSeconds)],
    ['最长有效会话', formatDuration(currentQuality.longestActiveSeconds)],
    ['每小时打断', `${currentQuality.interruptionsPerActiveHour.toFixed(1)} 次`],
    ['番茄目标达成率', currentQuality.pomodoroCompletionRate === null ? '—' : `${Math.round(currentQuality.pomodoroCompletionRate * 100)}%`],
  ];
  const weeklyGoalSummary = weeklyGoals.length
    ? `${weeklyGoals.reduce((sum, goal) => sum + Math.floor(goal.seconds / 60), 0)} / ${weeklyGoals.reduce((sum, goal) => sum + goal.targetMinutes, 0)} 分钟`
    : '未设置周目标';
  const saveWeeklyReview = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSavingReview(true);
    setReviewError(null);
    try {
      await onSaveWeeklyReview(weekRange.start, reviewDraft);
    } catch (error) {
      setReviewError(error instanceof Error ? error.message : '周度复盘保存失败，请重试。');
    } finally {
      setIsSavingReview(false);
    }
  };

  return <section className="focus-review" aria-label="数据复盘">
    <header className="focus-review__toolbar"><span>时间范围</span><div className="focus-review__controls"><div className="focus-range-switch" role="group" aria-label="专注统计范围">{(Object.keys(rangeNames) as FocusAnalyticsRange[]).map((value) => <button key={value} type="button" className={range === value ? 'is-active' : ''} onClick={() => chooseRange(value)}>{rangeNames[value]}</button>)}</div><div className="focus-period-nav"><button type="button" aria-label="前一个统计周期" disabled={range === 'custom'} onClick={() => setAnchor((value) => moveFocusAnchor(range, value, -1))}><ChevronLeft size={17} /></button><span><CalendarDays size={15} />{period.label}</span><button type="button" aria-label="后一个统计周期" disabled={range === 'custom' || period.end >= today} onClick={() => setAnchor((value) => moveFocusAnchor(range, value, 1))}><ChevronRight size={17} /></button></div></div></header>
    {range === 'custom' && <div className="focus-custom-range"><label>开始<input type="date" value={customStart} max={today} onChange={(event) => setCustomStart(event.target.value)} /></label><label>结束<input type="date" value={customEnd} min={customStart} max={today} onChange={(event) => setCustomEnd(event.target.value)} /></label></div>}
    <div className="focus-review-content">
      <article className="focus-stat-card focus-review-summary"><div className="focus-stat-card__heading"><div><BarChart3 size={17} /><h2>核心摘要</h2></div><span>{period.label}</span></div><div className="focus-overview-metrics">{summaryMetrics.map((item) => <div key={item.label} className={item.label === '总专注' ? 'focus-overview-metrics__primary' : ''}><strong>{item.value}</strong><span>{item.label}</span></div>)}</div></article>
      <div className={`focus-review-analysis-row${activeTrendDays.length < 2 && !weekComparison.bySubject.length ? ' is-sparse' : ''}`}>
        <article className="focus-stat-card focus-trend-area-card"><div className="focus-stat-card__heading"><div><CircleDot size={17} /><h2>专注趋势</h2></div><span>{period.label}</span></div>{activeTrendDays.length ? <><svg viewBox="0 0 320 112" role="img" aria-label={`${period.label}专注时长趋势`}><defs><linearGradient id="focus-trend-fill" x1="0" x2="0" y1="0" y2="1"><stop stopColor="#818cf8" stopOpacity=".28" /><stop offset="1" stopColor="#818cf8" stopOpacity="0" /></linearGradient></defs>{[24, 62, 100].map((y) => <line key={y} x1="16" x2="304" y1={y} y2={y} />)}<polygon points={`16,100 ${points} 304,100`} /><polyline points={points} />{trend.map((point, index) => <circle key={point.date} cx={16 + index / Math.max(1, trend.length - 1) * 288} cy={100 - point.activeSeconds / trendMax * 76} r="3"><title>{point.date} · {formatDuration(point.activeSeconds)} · {point.sessionCount} 次</title></circle>)}</svg><ol className="focus-trend-axis">{trend.map((point, index) => <li key={point.date} className={trend.length > 10 && index % Math.ceil(trend.length / 7) !== 0 ? 'is-muted' : ''}>{dateLabel(point.date, range)}</li>)}</ol>{activeTrendDays.length < 2 && <p className="focus-sparse-trend__note">数据不足以形成趋势，目前仅有 1 个活跃日。</p>}<div className="focus-trend-footer"><span>总投入 <strong>{formatDuration(periodTotal)}</strong></span><span>活跃 <strong>{activeTrendDays.length} 天</strong></span><span>日均 <strong>{formatDuration(activeTrendDays.length ? Math.floor(periodTotal / activeTrendDays.length) : 0)}</strong></span></div></> : <EmptyChart>完成一次专注后将在这里看到趋势。</EmptyChart>}</article>
        <article className={`focus-stat-card focus-week-comparison-card${weekComparison.bySubject.length ? '' : ' is-empty'}`}><div className="focus-stat-card__heading"><div><BarChart3 size={17} /><h2>本周 vs 上周</h2></div><span>{weekComparison.current.start.slice(5)} – {weekComparison.current.end.slice(5)}</span></div><div className="focus-week-comparison__headline"><strong>{formatDuration(weekComparison.current.activeSeconds)}</strong><span>本周专注</span><b className={weekDelta >= 0 ? 'is-up' : 'is-down'}>{weekDelta >= 0 ? '↑' : '↓'} {formatDuration(Math.abs(weekDelta))}{weekDeltaPercent === null ? ' · 新记录' : ` · ${weekDeltaPercent >= 0 ? '+' : ''}${weekDeltaPercent}%`}</b></div>{weekComparison.bySubject.length ? <ul>{weekComparison.bySubject.slice(0, 4).map(({ subject, currentSeconds, previousSeconds, weeklyTargetMinutes }) => <li key={subject.id}><span><i style={{ background: subject.color }} />{subject.name}</span><strong>{formatDuration(currentSeconds)}</strong><small>上周 {formatDuration(previousSeconds)}{weeklyTargetMinutes ? ` · 目标 ${weeklyTargetMinutes} 分` : ''}</small></li>)}</ul> : <p className="focus-week-empty-note">本周暂无专注记录</p>}</article>
      </div>
      <div className={`focus-review-analysis-row${!categories.length && !weekSessions.length && !previousWeekSessions.length ? ' is-empty' : ''}`}>
        <article className="focus-stat-card focus-quality-card"><div className="focus-stat-card__heading"><div><Target size={17} /><h2>专注质量</h2></div><span>本周</span></div>{weekSessions.length || previousWeekSessions.length ? <div className="focus-quality-metrics" aria-label="本周与上周专注质量对比">{qualityRows.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div> : <EmptyChart title="还没有质量数据">完成一次专注后，将在这里看到时长之外的专注质量。</EmptyChart>}</article>
        <article className="focus-stat-card focus-category-card"><div className="focus-stat-card__heading"><div><CircleDot size={17} /><h2>时间投入构成</h2></div><span>{period.label}</span></div>{categories.length ? <><div className="focus-category-content"><div className="focus-donut" style={{ background: donut }}><div><strong>{formatDuration(categoryTotal)}</strong><span>总计时长</span></div></div><ul className="focus-category-legend">{categories.map((category) => <li key={category.id}><i style={{ background: category.color }} /><span>{category.name}</span><strong>{formatDuration(category.activeSeconds)}</strong><em>{Math.round(category.activeSeconds / categoryTotal * 100)}%</em></li>)}</ul></div></> : <EmptyChart>完成一次专注后将在这里看到主题构成。</EmptyChart>}</article>
      </div>
      <article className="focus-stat-card focus-time-bucket-card"><div className="focus-stat-card__heading"><div><BarChart3 size={17} /><h2>投入时段</h2></div><span>{period.label}</span></div>{periodSessions.length ? <ul className="focus-time-bucket-chart" role="img" aria-label={`${period.label}分时段专注投入`}>{timeBuckets.map((bucket) => <li key={bucket.label} title={`${bucket.label} · ${formatDuration(bucket.activeSeconds)}`}><span><i className={bucket.activeSeconds ? '' : 'is-empty'} style={{ height: `${bucket.activeSeconds / timeBucketMax * 100}%` }} /></span><strong>{bucket.label}</strong><em>{formatDuration(bucket.activeSeconds)}</em></li>)}</ul> : <EmptyChart>完成一次专注后将在这里看到时段投入。</EmptyChart>}</article>
      <article className="focus-stat-card focus-ranking-card"><div className="focus-stat-card__heading"><div><BarChart3 size={17} /><h2>主题投入排行</h2></div><span>{period.label}</span></div>{categories.length ? <ul className="focus-subject-bar-chart">{categories.map((category) => <li key={category.id}><span><i style={{ background: category.color }} />{category.name}</span><div><i style={{ width: `${category.activeSeconds / rankingMax * 100}%`, background: category.color }} /></div><strong>{formatDuration(category.activeSeconds)}</strong></li>)}</ul> : <EmptyChart>完成一次专注后将在这里看到主题投入排行。</EmptyChart>}</article>
      <form className="focus-stat-card focus-weekly-review-card" onSubmit={saveWeeklyReview}><div className="focus-stat-card__heading"><div><CalendarDays size={17} /><h2 aria-label="周度复盘">本周复盘与调整</h2></div><span>{weekRange.label}</span></div><div className="focus-weekly-review-columns"><div><dl><div><dt>最稳定主题</dt><dd>{weeklyInsight.mostStableSubject ? `${weeklyInsight.mostStableSubject.subject.name} · ${weeklyInsight.mostStableSubject.activeDays} 天投入` : '本周数据不足'}</dd></div><div><dt>打断最多原因</dt><dd>{weeklyInsight.topInterruptionReason ? `${interruptionReasonNames[weeklyInsight.topInterruptionReason.reason]} · ${weeklyInsight.topInterruptionReason.count} 次` : '暂无带原因的打断'}</dd></div><div><dt>本周目标</dt><dd>{weeklyGoalSummary}</dd></div></dl>{weeklyGoals.length > 0 && <ul className="focus-goal-list focus-weekly-review-goals">{weeklyGoals.map(({ subject, seconds, targetMinutes, percent }) => <li key={subject.id}><div><span><i style={{ background: subject.color }} />{subject.name}</span><strong>{Math.floor(seconds / 60)} / {targetMinutes} 分钟</strong></div><p><i style={{ width: `${percent}%`, background: subject.color }} /></p><small>{Math.round(percent)}%</small></li>)}</ul>}{interruptions.count > 0 && <ul className="focus-interruption-list focus-weekly-review-interruptions">{interruptions.reasons.map(({ reason, count }) => <li key={reason}><span>{interruptionReasonNames[reason]}</span><strong>{count}</strong></li>)}</ul>}</div><label>下周调整<textarea value={reviewDraft} maxLength={300} placeholder="例如：增加数学分析，减少晚间英语阅读。" onChange={(event) => setReviewDraft(event.target.value)} /></label></div>{reviewError && <p className="focus-review-error">{reviewError}</p>}<div><button type="submit" disabled={isSavingReview}>{isSavingReview ? '保存中…' : '保存计划'}</button>{weeklyReview && <small>清空内容后保存，即可删除本周计划。</small>}</div></form>
    </div>
  </section>;
};

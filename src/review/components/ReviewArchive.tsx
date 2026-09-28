import { useEffect, useMemo, useState } from 'react';
import { activeReviewAnnotations, activeReviewItems, type DailyReview, type ReviewAnnotationType, type ReviewSection } from '@/review/model';
import { fetchRemoteReview } from '@/review/sync';
import type { ReviewSyncState } from '@/review/repository';

interface ArchiveEntry {
  reviewDate: string;
  status: 'draft' | 'completed';
  segments: Array<{ id: string; type: 'text' | 'voice'; capturedAt: string; text: string }>;
  items: Array<{ itemId: string; section: ReviewSection; text: string }>;
  annotations: Array<{ id: string; type: ReviewAnnotationType; quotedText: string }>;
  snapshots: Array<{ id: string; versionNo: number; completedAt: string; items: Array<{ itemId: string; section: ReviewSection; text: string }> }>;
}
interface RemoteEntry extends ArchiveEntry { revision: number; updatedAt: string }
interface DayEntry {
  date: string;
  local?: DailyReview;
  remote?: RemoteEntry;
  content?: ArchiveEntry;
  newerCloud: boolean;
  draft?: string;
  syncStatus?: ReviewSyncState['status'];
}
interface ReviewArchiveProps {
  reviews: DailyReview[];
  textDrafts: Record<string, string>;
  syncStates: Record<string, ReviewSyncState>;
  syncEnabled: boolean;
  onOpenDate: (date: string, remote?: { review: DailyReview; serverRevision: number }) => void;
}

const sections: ReviewSection[] = ['progress', 'problems', 'adjustments', 'summary'];
const sectionLabels: Record<ReviewSection, string> = {
  progress: '今日进展', problems: '问题与原因', adjustments: '接下来怎么调整', summary: '今日总结',
};
const annotationLabels: Record<ReviewAnnotationType, string> = {
  progress: '进展', problem: '问题', reflection: '反思', solution: '解决办法', emphasis: '重点',
};
const annotationSections: Record<ReviewSection, ReviewAnnotationType[]> = {
  progress: ['progress'], problems: ['problem', 'reflection'], adjustments: ['solution'], summary: [],
};

function projectLocal(review: DailyReview): ArchiveEntry {
  return {
    reviewDate: review.reviewDate,
    status: review.reviewStatus,
    segments: review.inputSegments.map((segment) => ({
      id: segment.id, type: segment.type, capturedAt: segment.capturedAt,
      text: segment.type === 'text' ? segment.text : segment.correctedText ?? segment.asrText ?? segment.interimTranscript ?? '语音待识别；原始录音仅保存在录制设备',
    })),
    items: activeReviewItems(review).map(({ itemId, section, text }) => ({ itemId, section, text })),
    annotations: activeReviewAnnotations(review).map(({ id, type, quotedText }) => ({ id, type, quotedText })),
    snapshots: review.completedVersions.map((version) => ({
      id: version.id, versionNo: version.versionNo, completedAt: version.completedAt ?? version.createdAt,
      items: version.items.filter((item) => !item.deletedAt).map(({ itemId, section, text }) => ({ itemId, section, text })),
    })),
  };
}

function categoryLines(entry: ArchiveEntry, section: ReviewSection) {
  return [
    ...entry.items.filter((item) => item.section === section).map((item) => ({ id: item.itemId, text: item.text, source: '整理条目' })),
    ...entry.annotations.filter((annotation) => annotationSections[section].includes(annotation.type)).map((annotation) => ({ id: annotation.id, text: annotation.quotedText, source: `原文标注 · ${annotationLabels[annotation.type]}` })),
  ];
}

function DayContent({ entry }: { entry: ArchiveEntry }) {
  const organized = sections.filter((section) => entry.items.some((item) => item.section === section));
  return <div className="review-archive__content">
    {organized.length > 0 && <div className="review-archive__sections">{organized.map((section) => <section key={section}><h4>{sectionLabels[section]}</h4><ul>{entry.items.filter((item) => item.section === section).map((item) => <li key={item.itemId}>{item.text}</li>)}</ul></section>)}</div>}
    <section className="review-archive__raw"><h4>原始记录</h4>{entry.segments.length ? <ol>{entry.segments.map((segment) => <li key={segment.id}><small>{segment.type === 'text' ? '文字' : '语音转写'} · {new Date(segment.capturedAt).toLocaleTimeString()}</small><p>{segment.text}</p></li>)}</ol> : <p>尚无原始记录。</p>}</section>
    {entry.annotations.length > 0 && <section className="review-archive__annotations"><h4>原文标注</h4><ul>{entry.annotations.map((annotation) => <li key={annotation.id}><b>{annotationLabels[annotation.type]}：</b>{annotation.quotedText}</li>)}</ul></section>}
    {entry.snapshots.length > 0 && <details className="review-archive__snapshots"><summary>完成快照 · {entry.snapshots.length} 个版本</summary>{entry.snapshots.map((snapshot) => <section key={snapshot.id}><h4>第 {snapshot.versionNo} 版 · {new Date(snapshot.completedAt).toLocaleString()}</h4><ul>{snapshot.items.map((item) => <li key={item.itemId}><b>{sectionLabels[item.section]}：</b>{item.text}</li>)}</ul></section>)}</details>}
  </div>;
}

export default function ReviewArchive({ reviews, textDrafts, syncStates, syncEnabled, onOpenDate }: ReviewArchiveProps) {
  const [remoteEntries, setRemoteEntries] = useState<RemoteEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  const [remoteError, setRemoteError] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [mode, setMode] = useState<'daily' | 'category'>('daily');
  const [category, setCategory] = useState<ReviewSection>('problems');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [status, setStatus] = useState<'all' | 'draft' | 'completed'>('all');
  const [visibleCount, setVisibleCount] = useState(20);
  const [openingDate, setOpeningDate] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    if (!syncEnabled) { setRemoteEntries([]); setRemoteLoading(false); setRemoteError(false); return; }
    const controller = new AbortController();
    const retryOnline = () => setLoadAttempt((attempt) => attempt + 1);
    window.addEventListener('online', retryOnline);
    setRemoteLoading(true);
    setRemoteError(false);
    const load = async () => {
      let cursor: string | null = null;
      const all: RemoteEntry[] = [];
      do {
        const response = await fetch(`/api/review-list${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, { headers: { Accept: 'application/json' }, signal: controller.signal });
        if (!response.ok) throw new Error('无法读取云端复盘');
        const page = await response.json() as { entries: RemoteEntry[]; nextCursor: string | null };
        all.push(...page.entries);
        cursor = page.nextCursor;
        if (!controller.signal.aborted) setRemoteEntries([...all]);
      } while (cursor && !controller.signal.aborted);
      if (!controller.signal.aborted) setRemoteLoading(false);
    };
    void load().catch(() => { if (!controller.signal.aborted) { setRemoteError(true); setRemoteLoading(false); } });
    return () => { controller.abort(); window.removeEventListener('online', retryOnline); };
  }, [syncEnabled, loadAttempt]);

  const days = useMemo(() => {
    const localByDate = new Map(reviews.map((review) => [review.reviewDate, review]));
    const remoteByDate = new Map(remoteEntries.map((entry) => [entry.reviewDate, entry]));
    return [...new Set([...localByDate.keys(), ...remoteByDate.keys(), ...Object.keys(textDrafts).filter((date) => textDrafts[date]?.trim())])]
      .sort((left, right) => right.localeCompare(left))
      .map((date): DayEntry => {
        const local = localByDate.get(date);
        const state = local ? syncStates[local.id] : undefined;
        const savedConflict = state?.status === 'conflict' && state.remoteReview
          ? { ...projectLocal(state.remoteReview), revision: state.serverRevision ?? 0, updatedAt: state.remoteReview.updatedAt }
          : undefined;
        const listedRemote = remoteByDate.get(date);
        const remote = listedRemote && (!savedConflict || listedRemote.revision >= savedConflict.revision) ? listedRemote : savedConflict;
        return {
          date, local, remote, content: local ? projectLocal(local) : remote,
          newerCloud: Boolean(local && remote && (state?.status === 'conflict' || remote.revision > (state?.serverRevision ?? 0))),
          draft: textDrafts[date]?.trim() || undefined, syncStatus: state?.status,
        };
      })
      .filter((day) => (!fromDate || day.date >= fromDate) && (!toDate || day.date <= toDate))
      .filter((day) => status === 'all' || day.local?.reviewStatus === status || day.remote?.status === status || (!day.local && !day.remote && status === 'draft'));
  }, [reviews, remoteEntries, textDrafts, syncStates, fromDate, toDate, status]);

  const categoryDays = useMemo(() => days.filter((day) =>
    (day.content && categoryLines(day.content, category).length > 0)
    || (day.newerCloud && day.remote && categoryLines(day.remote, category).length > 0)), [days, category]);
  const shown = mode === 'daily' ? days : categoryDays;
  const categoryCounts = Object.fromEntries(sections.map((section) => [section, days.reduce((count, day) => count + (day.content ? categoryLines(day.content, section).length : 0) + (day.newerCloud && day.remote ? categoryLines(day.remote, section).length : 0), 0)])) as Record<ReviewSection, number>;

  useEffect(() => { setVisibleCount(20); }, [mode, category, fromDate, toDate, status]);

  const openDay = async (day: DayEntry) => {
    setOpenError(null);
    const state = day.local ? syncStates[day.local.id] : undefined;
    if (!day.remote || (day.local && !day.newerCloud)
      || (state?.status === 'conflict' && day.remote.revision <= (state.serverRevision ?? 0))) { onOpenDate(day.date); return; }
    setOpeningDate(day.date);
    try {
      const remote = await fetchRemoteReview(day.date);
      if (!remote) throw new Error('云端记录不存在');
      onOpenDate(day.date, remote);
    } catch { setOpenError(day.date); }
    finally { setOpeningDate(null); }
  };

  return <section className="review-archive" aria-label="所有复盘记录">
    <header className="review-archive__intro"><div><h2>复盘总览</h2><p>直接阅读每天的复盘，也可按类别汇总查看。</p></div><span>{days.length} 天{remoteLoading ? ' · 正在加载云端记录…' : ''}</span></header>
    <nav className="review-archive__modes" aria-label="记录查看方式"><button type="button" className={mode === 'daily' ? 'is-active' : ''} onClick={() => setMode('daily')}>按日期看</button><button type="button" className={mode === 'category' ? 'is-active' : ''} onClick={() => setMode('category')}>按类别汇总</button></nav>
    {mode === 'category' && <><div className="review-archive__categories" aria-label="复盘类别">{sections.map((section) => <button type="button" key={section} className={category === section ? 'is-active' : ''} onClick={() => setCategory(section)}>{sectionLabels[section]} · {categoryCounts[section]}</button>)}</div><p className="review-archive__hint">按已整理条目和对应的原文标注汇总；未整理的原文可在「按日期看」中阅读。</p></>}
    <div className="review-archive__filters"><label>开始日期<input type="date" value={fromDate} max={toDate || undefined} onChange={(event) => setFromDate(event.target.value)} /></label><label>结束日期<input type="date" value={toDate} min={fromDate || undefined} onChange={(event) => setToDate(event.target.value)} /></label><label>状态<select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}><option value="all">全部状态</option><option value="draft">草稿</option><option value="completed">已完成</option></select></label></div>
    {mode === 'category' && <p className="review-archive__count">{sectionLabels[category]}：{categoryDays.length} 天 · {categoryCounts[category]} 条{remoteLoading ? ' · 云端汇总加载中' : ''}</p>}
    {remoteError && <div className="review-archive__notice" role="status">云端记录暂时无法读取；以下仍可查看本机内容。 <button type="button" className="review-button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>重试读取云端</button></div>}
    {shown.length === 0 && !remoteLoading && <p className="review-archive__empty">这个范围内还没有相关复盘内容。</p>}
    <div className="review-archive__list">{shown.slice(0, visibleCount).map((day) => <article className="review-archive__day" key={day.date}>
      <header className="review-archive__day-heading"><div><strong>{day.date}</strong><span>{day.content?.status === 'completed' ? '已完成' : day.content ? '草稿' : '本机未保存输入'} · {day.content?.segments.length ?? 0} 段原始记录{day.syncStatus === 'conflict' ? ' · 同步冲突' : day.newerCloud ? ' · 云端版本待核对' : day.syncStatus === 'sync_pending' || day.syncStatus === 'sync_error' ? ' · 待同步' : ''}</span></div><button type="button" className="review-button" disabled={openingDate === day.date} onClick={() => void openDay(day)}>{openingDate === day.date ? '正在打开…' : '打开当天复盘'}</button></header>
      {mode === 'daily' ? <>
        {day.content && <DayContent entry={day.content} />}
        {day.newerCloud && day.remote && <aside className="review-archive__cloud"><h3>云端版本 · 只读</h3><DayContent entry={day.remote} /><p>打开当天复盘可合并两台设备的记录。</p></aside>}
        {day.draft && <section className="review-archive__unsaved"><h4>本机未保存输入</h4><p>{day.draft}</p></section>}
      </> : <>
        {day.content && <ul className="review-archive__category-list">{categoryLines(day.content, category).map((line) => <li key={line.id}><small>{line.source}{day.newerCloud ? ' · 本机' : ''}</small><p>{line.text}</p></li>)}</ul>}
        {day.newerCloud && day.remote && <ul className="review-archive__category-list review-archive__category-list--cloud">{categoryLines(day.remote, category).map((line) => <li key={line.id}><small>{line.source} · 云端</small><p>{line.text}</p></li>)}</ul>}
      </>}
      {openError === day.date && <p className="review-archive__notice" role="alert">云端复盘未能打开，请重试。</p>}
    </article>)}</div>
    {visibleCount < shown.length && <button type="button" className="review-button review-archive__more" onClick={() => setVisibleCount((count) => count + 20)}>加载更多日期</button>}
  </section>;
}

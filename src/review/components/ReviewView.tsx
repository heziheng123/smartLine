import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Cloud, FileText, Plus, Save, Sparkles, Trash2 } from 'lucide-react';
import {
  addReviewItem,
  applyAiItems,
  appendTextSegment,
  completeDailyReview,
  createDailyReview,
  removeReviewItem,
  restoreCompletedVersion,
  updateReviewItem,
  updateTextSegment,
  type DailyReview,
  type ReviewSection,
} from '@/review/model';
import { loadDailyReviews, loadReviewSyncStates, loadReviewTextDrafts, saveDailyReviews, saveReviewTextDrafts, type ReviewSyncState } from '@/review/repository';
import { enqueueReviewSync, fetchRemoteReview, flushReviewOutbox, resolveReviewConflict, structureReview } from '@/review/sync';
import { useAuth } from '@/auth/AuthContext';

const sections: { id: ReviewSection; title: string; hint: string }[] = [
  { id: 'progress', title: '今日进展', hint: '完成、部分完成或正在推进的事情' },
  { id: 'problems', title: '问题与原因', hint: '困难、偏差和已明确的原因' },
  { id: 'adjustments', title: '接下来怎么调整', hint: '你明确想做的调整或下一步' },
  { id: 'summary', title: '今日总结', hint: '只概括已有内容，不增加新的事实' },
];

const today = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};

export default function ReviewView() {
  const auth = useAuth();
  const [reviews, setReviews] = useState<DailyReview[] | null>(null);
  const [textDrafts, setTextDrafts] = useState<Record<string, string> | null>(null);
  const [syncStates, setSyncStates] = useState<Record<string, ReviewSyncState> | null>(null);
  const [reviewDate, setReviewDate] = useState(today);
  const [itemText, setItemText] = useState('');
  const [itemSection, setItemSection] = useState<ReviewSection>('progress');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isStructuring, setIsStructuring] = useState(false);
  const syncEnabled = auth.enabled && auth.status === 'authenticated';

  useEffect(() => { void Promise.all([loadDailyReviews(), loadReviewTextDrafts(), loadReviewSyncStates()]).then(([storedReviews, drafts, states]) => { setReviews(storedReviews); setTextDrafts(drafts); setSyncStates(states); }); }, []);

  const flushSync = useCallback(() => {
    if (!syncEnabled) return;
    void flushReviewOutbox().then(setSyncStates).catch(() => setStorageError('同步队列读取失败，本机内容仍已保存。'));
  }, [syncEnabled]);

  useEffect(() => {
    if (!syncEnabled) return;
    flushSync();
    window.addEventListener('online', flushSync);
    return () => window.removeEventListener('online', flushSync);
  }, [flushSync, syncEnabled]);

  useEffect(() => {
    if (!syncEnabled) return;
    void fetchRemoteReview(reviewDate).then((remote) => {
      if (!remote) return;
      setReviews((current) => {
        if (!current || current.some((item) => item.reviewDate === reviewDate)) return current;
        const next = [...current, remote.review].sort((left, right) => right.reviewDate.localeCompare(left.reviewDate));
        void saveDailyReviews(next).catch(() => setStorageError('云端复盘未能缓存到本机。'));
        return next;
      });
      setSyncStates((current) => current && current[remote.review.id]
        ? current
        : { ...(current ?? {}), [remote.review.id]: { serverRevision: remote.serverRevision, status: 'synced' } });
    }).catch(() => undefined);
  }, [reviewDate, syncEnabled]);

  const review = useMemo(() => reviews?.find((item) => item.reviewDate === reviewDate) ?? null, [reviewDate, reviews]);
  const syncReview = useCallback((next: DailyReview) => {
    if (!syncEnabled) return;
    void enqueueReviewSync(next)
      .then(setSyncStates)
      .then(() => flushReviewOutbox())
      .then(setSyncStates)
      .catch(() => setStorageError('同步队列保存失败，本机内容仍已保存。'));
  }, [syncEnabled]);
  const update = useCallback((next: DailyReview) => {
    setReviews((current) => {
      const existing = current ?? [];
      const nextReviews = [...existing.filter((item) => item.id !== next.id), next]
        .sort((left, right) => right.reviewDate.localeCompare(left.reviewDate));
      void saveDailyReviews(nextReviews).catch((error) => { console.error('[review] 本机保存失败', error); setStorageError('本机保存失败，请暂时不要关闭页面。'); });
      return nextReviews;
    });
    syncReview(next);
  }, [syncReview]);
  const current = review ?? createDailyReview(reviewDate);
  const sourceText = textDrafts?.[reviewDate] ?? '';
  const updateSourceText = (text: string) => {
    setTextDrafts((currentDrafts) => {
      const nextDrafts = { ...(currentDrafts ?? {}), [reviewDate]: text };
      void saveReviewTextDrafts(nextDrafts).catch((error) => { console.error('[review] 输入草稿保存失败', error); setStorageError('输入草稿未能保存，请暂时不要关闭页面。'); });
      return nextDrafts;
    });
  };

  const saveSource = () => {
    const next = appendTextSegment(current, sourceText);
    if (next === current) return;
    update(next);
    updateSourceText('');
  };
  const saveItem = () => {
    const next = addReviewItem(current, itemSection, itemText);
    if (next === current) return;
    update(next);
    setItemText('');
  };
  const finish = () => update(completeDailyReview(current));
  const updateSource = (segmentId: string, text: string) => {
    const next = updateTextSegment(current, segmentId, text);
    if (next !== current) update(next);
  };
  const updateItem = (itemId: string, text: string) => {
    const next = updateReviewItem(current, itemId, text);
    if (next !== current) update(next);
  };
  const removeItem = (itemId: string) => update(removeReviewItem(current, itemId));
  const restoreVersion = (versionId: string) => update(restoreCompletedVersion(current, versionId));
  const runAi = async () => {
    if (!syncEnabled) { setAiError('登录并启用云端配置后，才能使用 AI 整理。'); return; }
    if (!current.inputSegments.length) { setAiError('先保存一段原始记录，再进行整理。'); return; }
    setAiError(null); setIsStructuring(true);
    try { update(applyAiItems(current, await structureReview(current))); }
    catch (error) { setAiError(error instanceof Error ? error.message : 'AI 整理暂时不可用。'); }
    finally { setIsStructuring(false); }
  };
  const resolveConflict = () => {
    void resolveReviewConflict(current).then(setSyncStates).then(() => flushReviewOutbox()).then(setSyncStates).catch(() => setStorageError('冲突处理未能加入同步队列。'));
  };

  if (!reviews || !textDrafts || !syncStates) return <div className="review-view review-view--loading" role="status">正在打开复盘…</div>;
  const syncState = syncStates[current.id] ?? { serverRevision: null, status: 'local_only' as const };

  return (
    <main className="review-view" aria-label="每日复盘">
      <header className="review-view__header">
        <div><p>每日复盘</p><h1>说出来，整理好，今天就到这里。</h1></div>
        <label>复盘日期<input type="date" value={reviewDate} max={today()} onChange={(event) => setReviewDate(event.target.value)} /></label>
      </header>
      {storageError && <p className="review-storage-error" role="alert">{storageError}</p>}
      {aiError && <p className="review-storage-error" role="alert">{aiError}</p>}

      <section className="review-card review-card--source">
        <div><span className="review-card__eyebrow">直接输入</span><h2>先把今天发生的事记下来</h2><p>输入会立即保存到本机；保存为记录后，整理不会改写原文。</p></div>
        <textarea value={sourceText} onChange={(event) => updateSourceText(event.target.value)} placeholder="随便写写今天做了什么、哪里没做好、接下来怎么调整。" />
        <button type="button" className="review-button review-button--primary" onClick={saveSource} disabled={!sourceText.trim()}><Save size={16} />保存为记录</button>
      </section>

      <section className="review-card">
        <div className="review-card__title"><div><span className="review-card__eyebrow">整理结果</span><h2>复盘内容</h2></div><span className={`review-status review-status--${current.reviewStatus}`}>{current.reviewStatus === 'completed' ? '已完成' : '草稿'}</span></div>
        <div className="review-actions"><button type="button" className="review-button" onClick={runAi} disabled={isStructuring || !current.inputSegments.length}><Sparkles size={16} />{isStructuring ? '正在整理…' : 'AI 整理'}</button><span className={`review-sync review-sync--${syncState.status}`}><Cloud size={14} />{syncState.status === 'synced' ? '已同步' : syncState.status === 'sync_pending' ? '待同步' : syncState.status === 'sync_error' ? '等待重试' : syncState.status === 'conflict' ? '发现冲突' : '仅本机'}</span>{syncEnabled && <button type="button" className="review-button" onClick={() => syncReview(current)}>立即同步</button>}</div>
        {syncState.status === 'conflict' && <div className="review-conflict" role="alert"><span>{syncState.error}</span><button type="button" className="review-button" onClick={resolveConflict}>以本机版本继续</button>{syncState.remoteReview && <details><summary>查看云端版本</summary><ul>{syncState.remoteReview.workingDraft.items.map((item) => <li key={item.itemId}>{sections.find((section) => section.id === item.section)?.title}：{item.text}</li>)}</ul></details>}</div>}
        <div className="review-add-item">
          <select value={itemSection} onChange={(event) => setItemSection(event.target.value as ReviewSection)} aria-label="复盘区域">
            {sections.map((section) => <option key={section.id} value={section.id}>{section.title}</option>)}
          </select>
          <input value={itemText} onChange={(event) => setItemText(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') saveItem(); }} placeholder="添加一条明确的记录" />
          <button type="button" className="review-button" onClick={saveItem} disabled={!itemText.trim()}><Plus size={16} />添加</button>
        </div>
        <div className="review-sections">
          {sections.map((section) => {
            const items = current.workingDraft.items.filter((item) => item.section === section.id);
            return <section key={section.id} className="review-section"><h3>{section.title}</h3><p>{section.hint}</p>{items.length ? <ul>{items.map((item) => <li key={item.itemId} className={item.locked ? 'is-locked' : ''}><textarea defaultValue={item.text} onBlur={(event) => updateItem(item.itemId, event.target.value)} aria-label={`编辑${section.title}`} /><button type="button" onClick={() => removeItem(item.itemId)} aria-label={`删除${item.text}`}><Trash2 size={13} /></button></li>)}</ul> : <span className="review-empty">还没有内容</span>}</section>;
          })}
        </div>
        <footer className="review-card__footer"><span>{current.inputSegments.length} 段原始记录 · {syncState.status === 'synced' ? '已同步到云端' : syncEnabled ? '已保存到本机，等待同步' : '已保存到本机'}</span><button type="button" className="review-button review-button--primary" onClick={finish} disabled={current.reviewStatus === 'completed'}><Check size={16} />完成复盘</button></footer>
      </section>

      {current.completedVersions.length > 0 && <section className="review-card review-card--completed-versions"><div><span className="review-card__eyebrow">完成版本</span><h2>完成时的快照</h2><p>恢复会创建新的工作草稿，不会修改历史快照。</p></div>{current.completedVersions.map((version) => <article key={version.id}><div className="review-version-heading"><h3>第 {version.versionNo} 版 · {new Date(version.completedAt ?? version.createdAt).toLocaleString()}</h3><button type="button" className="review-button" onClick={() => restoreVersion(version.id)}>恢复为草稿</button></div>{version.items.length ? <ul>{version.items.map((item) => <li key={item.itemId}><strong>{sections.find((section) => section.id === item.section)?.title}：</strong>{item.text}</li>)}</ul> : <span className="review-empty">完成时没有整理条目</span>}</article>)}</section>}
      {current.inputSegments.length > 0 && <section className="review-card review-card--history"><div className="review-card__title"><div><span className="review-card__eyebrow">原始记录</span><h2>可追溯，不被整理覆盖</h2></div><FileText size={19} /></div><ol>{current.inputSegments.map((segment) => <li key={segment.id}><textarea defaultValue={segment.text} onBlur={(event) => updateSource(segment.id, event.target.value)} aria-label="编辑原始记录" /></li>)}</ol></section>}
      {reviews.length > 0 && <section className="review-card review-card--review-history"><div><span className="review-card__eyebrow">历史复盘</span><h2>按日期打开已保存版本</h2></div><div>{reviews.map((item) => <button type="button" key={item.id} className={item.reviewDate === reviewDate ? 'is-current' : ''} onClick={() => setReviewDate(item.reviewDate)}>{item.reviewDate}<span>{item.reviewStatus === 'completed' ? `完成 · v${item.completedVersions.length}` : '草稿'}</span></button>)}</div></section>}
    </main>
  );
}

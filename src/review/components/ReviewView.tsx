import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, Cloud, FileText, Plus, Save, Sparkles, Trash2, X } from 'lucide-react';
import {
  addReviewItem,
  applyAiItems,
  appendTextSegment,
  appendVoiceSegment,
  completeDailyReview,
  createDailyReview,
  removeReviewItem,
  restoreCompletedVersion,
  setVoiceTranscriptionState,
  updateVoiceAudio,
  updateReviewItem,
  updateTextSegment,
  updateVoiceTranscript,
  withdrawLastInputSegment,
  type DailyReview,
  type ReviewSection,
  type VoiceInputSegment,
  type VoiceAudioRetention,
} from '@/review/model';
import { cleanExpiredVoiceAudio, eraseVoiceAudio, localReviewDeviceId, prepareVoiceWav, recoverStoredVoiceAudio, settleVoiceAudioRetention, type CapturedVoiceAudio } from '@/review/audio';
import VoiceCaptureButton from '@/review/components/VoiceCaptureButton';
import { loadDailyReviews, loadReviewSyncStates, loadReviewTextDrafts, saveDailyReviews, saveReviewTextDrafts, type ReviewSyncState } from '@/review/repository';
import { enqueueReviewSync, fetchRemoteReview, flushReviewOutbox, resolveReviewConflict, structureReview, transcribeVoiceSegment, type PersonalTerm } from '@/review/sync';
import { useAuth } from '@/auth/AuthContext';

const sections: { id: ReviewSection; title: string; hint: string }[] = [
  { id: 'progress', title: '今日进展', hint: '完成、部分完成或正在推进的事情' },
  { id: 'problems', title: '问题与原因', hint: '困难、偏差和已明确的原因' },
  { id: 'adjustments', title: '接下来怎么调整', hint: '你明确想做的调整或下一步' },
  { id: 'summary', title: '今日总结', hint: '只概括已有内容，不增加新的事实' },
];

interface ReviewViewProps {
  targetDate: string;
  onClose: () => void;
}

export default function ReviewView({ targetDate, onClose }: ReviewViewProps) {
  const auth = useAuth();
  const [reviews, setReviews] = useState<DailyReview[] | null>(null);
  const [textDrafts, setTextDrafts] = useState<Record<string, string> | null>(null);
  const [syncStates, setSyncStates] = useState<Record<string, ReviewSyncState> | null>(null);
  const [reviewDate, setReviewDate] = useState(targetDate);
  const [itemText, setItemText] = useState('');
  const [itemSection, setItemSection] = useState<ReviewSection>('progress');
  const [storageError, setStorageError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [isStructuring, setIsStructuring] = useState(false);
  const [transcribingSegmentId, setTranscribingSegmentId] = useState<string | null>(null);
  const [audioRetention, setAudioRetention] = useState<VoiceAudioRetention>(() => (localStorage.getItem('smart-line-review-audio-retention') as VoiceAudioRetention) || 'delete_after_transcription');
  const [voiceConsent, setVoiceConsent] = useState(() => localStorage.getItem('smart-line-review-voice-consent-v1') === 'accepted');
  const [personalTerms, setPersonalTerms] = useState<PersonalTerm[]>(() => { try { const value = JSON.parse(localStorage.getItem('smart-line-review-personal-terms-v1') ?? '[]'); return Array.isArray(value) ? value.filter((item): item is PersonalTerm => item && typeof item.from === 'string' && typeof item.to === 'string').slice(0, 30) : []; } catch { return []; } });
  const reviewsRef = useRef<DailyReview[] | null>(null);
  const syncEnabled = auth.enabled && auth.status === 'authenticated';

  useEffect(() => setReviewDate(targetDate), [targetDate]);

  useEffect(() => { void Promise.all([loadDailyReviews(), loadReviewTextDrafts(), loadReviewSyncStates(), cleanExpiredVoiceAudio()]).then(async ([storedReviews, drafts, states]) => {
    const repaired = await Promise.all(storedReviews.map(async (stored) => {
      let changed = false;
      const inputSegments = await Promise.all(stored.inputSegments.map(async (segment) => {
        if (segment.type !== 'voice' || segment.transcriptionState !== 'recording') return segment;
        const audio = segment.originDeviceId === localReviewDeviceId() ? await recoverStoredVoiceAudio(segment.id) : null;
        changed = true;
        return audio ? { ...segment, audio: { mimeType: audio.mimeType, durationMs: audio.durationMs, chunkCount: audio.chunkCount, byteLength: audio.byteLength, sampleRate: audio.sampleRate }, transcriptionState: 'interrupted' as const } : { ...segment, transcriptionState: 'audio_unavailable' as const };
      }));
      return changed ? { ...stored, inputSegments, updatedAt: new Date().toISOString() } : stored;
    }));
    reviewsRef.current = repaired; setReviews(repaired); setTextDrafts(drafts); setSyncStates(states);
    if (repaired.some((item, index) => item !== storedReviews[index])) await saveDailyReviews(repaired);
  }).catch(() => setStorageError('无法恢复本地录音，请暂时不要清理浏览器数据。')); }, []);

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
  const update = useCallback((next: DailyReview, shouldSync = true) => {
    const existing = reviewsRef.current ?? [];
    const nextReviews = [...existing.filter((item) => item.id !== next.id), next].sort((left, right) => right.reviewDate.localeCompare(left.reviewDate));
    reviewsRef.current = nextReviews; setReviews(nextReviews);
    void saveDailyReviews(nextReviews).catch((error) => { console.error('[review] 本机保存失败', error); setStorageError('本机保存失败，请暂时不要关闭页面。'); });
    if (shouldSync) syncReview(next);
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
  const transcribeVoice = async (reviewToTranscribe: DailyReview, segmentId: string, force = false) => {
    if (!syncEnabled) { setStorageError('登录后才能识别语音；录音仍只保存在本机。'); return; }
    const voice = reviewToTranscribe.inputSegments.find((segment): segment is VoiceInputSegment => segment.id === segmentId && segment.type === 'voice');
    if (!voice) return;
    if (voice.originDeviceId !== localReviewDeviceId()) { setStorageError('请回到录制这段语音的设备继续识别；音频不会上传到其他设备。'); return; }
    setStorageError(null); setTranscribingSegmentId(segmentId);
    const processing = setVoiceTranscriptionState(reviewToTranscribe, segmentId, 'transcribing');
    update(processing, false);
    try {
      setSyncStates(await enqueueReviewSync(processing));
      const states = await flushReviewOutbox();
      setSyncStates(states);
      if (states[processing.id]?.status !== 'synced') throw new Error('请先联网同步这段语音的记录，再重试识别。');
      const wav = await prepareVoiceWav({ segmentId, ...voice.audio });
      const receipt = await transcribeVoiceSegment(processing.reviewDate, segmentId, wav, force, personalTerms);
      const nextReviews = [...(reviewsRef.current ?? []).filter((item) => item.id !== receipt.review.id), receipt.review].sort((left, right) => right.reviewDate.localeCompare(left.reviewDate));
      await saveDailyReviews(nextReviews); // The server receipt and this local copy exist before retention can delete audio.
      reviewsRef.current = nextReviews; setReviews(nextReviews);
      setSyncStates((states) => ({ ...(states ?? {}), [receipt.review.id]: { serverRevision: receipt.serverRevision, status: 'synced' } }));
      await settleVoiceAudioRetention({ segmentId, ...voice.audio }, voice.audioRetention);
    } catch (error) {
      update(setVoiceTranscriptionState(processing, segmentId, 'retryable_failed'));
      setStorageError(error instanceof Error ? error.message : '语音识别失败，请稍后重试。');
    } finally { setTranscribingSegmentId(null); }
  };
  const beginVoice = (segmentId: string) => {
    const base = reviewsRef.current?.find((item) => item.reviewDate === reviewDate) ?? createDailyReview(reviewDate);
    const next = appendVoiceSegment(base, {
      id: segmentId,
      type: 'voice',
      originDeviceId: localReviewDeviceId(),
      audioStorageScope: 'local_only',
      audioRetention,
      transcriptionState: 'recording',
      audio: { mimeType: 'audio/wav', durationMs: 0, chunkCount: 0, byteLength: 0, sampleRate: 16_000 },
    });
    update(next, false);
  };
  const pauseVoice = async (audio: CapturedVoiceAudio) => {
    const base = reviewsRef.current?.find((item) => item.reviewDate === reviewDate);
    if (!base) throw new Error('录音片段未建立，请重新开始。');
    const next = updateVoiceAudio(base, audio.segmentId, { mimeType: audio.mimeType, durationMs: audio.durationMs, chunkCount: audio.chunkCount, byteLength: audio.byteLength, sampleRate: audio.sampleRate }, 'waiting_transcription');
    update(next, true);
  };
  const finishVoice = async (audios: CapturedVoiceAudio[]) => {
    for (const audio of audios) {
      const base = reviewsRef.current?.find((item) => item.reviewDate === reviewDate);
      if (base) await transcribeVoice(base, audio.segmentId);
    }
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
  const learnPersonalTerm = (segment: VoiceInputSegment) => {
    const from = segment.asrText?.trim(); const to = segment.correctedText?.trim();
    if (!from || !to || from === to || from.length > 80 || to.length > 80) { setStorageError('请先把本段转写改成不超过 80 字的常用表达。'); return; }
    const next = [{ from, to }, ...personalTerms.filter((item) => item.from !== from)].slice(0, 30);
    setPersonalTerms(next); localStorage.setItem('smart-line-review-personal-terms-v1', JSON.stringify(next));
  };
  const withdrawLast = () => { const last = current.inputSegments.at(-1); const next = withdrawLastInputSegment(current); if (next !== current) { update(next); if (last?.type === 'voice' && last.originDeviceId === localReviewDeviceId()) void eraseVoiceAudio({ segmentId: last.id, ...last.audio }).catch(() => setStorageError('原始记录已撤回，但本机音频未能清理。')); } };
  const restoreVersion = (versionId: string) => update(restoreCompletedVersion(current, versionId));
  const runAi = async () => {
    if (!syncEnabled) { setAiError('登录并启用云端配置后，才能使用 AI 整理。'); return; }
    if (!current.inputSegments.some((segment) => segment.type === 'text' || segment.asrText || segment.correctedText)) { setAiError('先保存文字记录，或先完成一段语音识别。'); return; }
    setAiError(null); setIsStructuring(true);
    try { update(applyAiItems(current, await structureReview(current))); }
    catch (error) { setAiError(error instanceof Error ? error.message : 'AI 整理暂时不可用。'); }
    finally { setIsStructuring(false); }
  };
  const resolveConflict = () => {
    void resolveReviewConflict(current).then(({ states, review: merged }) => { update(merged, false); setSyncStates(states); return flushReviewOutbox(); }).then(setSyncStates).catch(() => setStorageError('冲突处理未能加入同步队列。'));
  };

  if (!reviews || !textDrafts || !syncStates) return <div className="review-view review-view--loading" role="status">正在打开复盘…</div>;
  const syncState = syncStates[current.id] ?? { serverRevision: null, status: 'local_only' as const };

  return (
    <main className="review-view" aria-label="每日复盘">
      <header className="review-view__header">
        <div><p>每日复盘 · {reviewDate}</p><h1>说出来，整理好，今天就到这里。</h1></div>
        <button type="button" className="review-button" onClick={onClose}><X size={16} />返回每日安排</button>
      </header>
      {storageError && <p className="review-storage-error" role="alert">{storageError}</p>}
      {aiError && <p className="review-storage-error" role="alert">{aiError}</p>}

      <section className="review-card review-card--source">
        <div><span className="review-card__eyebrow">直接输入</span><h2>先把今天发生的事记下来</h2><p>输入会立即保存到本机；保存为记录后，整理不会改写原文。</p></div>
        <textarea value={sourceText} onChange={(event) => updateSourceText(event.target.value)} placeholder="随便写写今天做了什么、哪里没做好、接下来怎么调整。" />
        <div className="review-voice-settings"><label><input type="checkbox" checked={voiceConsent} onChange={(event) => { setVoiceConsent(event.target.checked); localStorage.setItem('smart-line-review-voice-consent-v1', event.target.checked ? 'accepted' : ''); }} />我知晓：仅在点击“说完了”后，录音才会一次性发送给语音服务转写；原始音频不会同步到云端。</label><label>本机音频<select value={audioRetention} onChange={(event) => { const value = event.target.value as VoiceAudioRetention; setAudioRetention(value); localStorage.setItem('smart-line-review-audio-retention', value); }}><option value="delete_after_transcription">转写确认后删除</option><option value="keep_7_days">保留 7 天</option><option value="keep_30_days">保留 30 天</option></select></label></div>
        <div className="review-source-actions"><button type="button" className="review-button review-button--primary" onClick={saveSource} disabled={!sourceText.trim()}><Save size={16} />保存为记录</button><VoiceCaptureButton disabled={!voiceConsent} retention={audioRetention} onStarted={beginVoice} onPaused={pauseVoice} onFinished={finishVoice} onError={setStorageError} /></div>
      </section>

      <section className="review-card">
        <div className="review-card__title"><div><span className="review-card__eyebrow">整理结果</span><h2>复盘内容</h2></div><span className={`review-status review-status--${current.reviewStatus}`}>{current.reviewStatus === 'completed' ? '已完成' : '草稿'}</span></div>
        <div className="review-actions"><button type="button" className="review-button" onClick={runAi} disabled={isStructuring || !current.inputSegments.some((segment) => segment.type === 'text' || segment.asrText || segment.correctedText)}><Sparkles size={16} />{isStructuring ? '正在整理…' : 'AI 整理'}</button><span className={`review-sync review-sync--${syncState.status}`}><Cloud size={14} />{syncState.status === 'synced' ? '已同步' : syncState.status === 'sync_pending' ? '待同步' : syncState.status === 'sync_error' ? '等待重试' : syncState.status === 'conflict' ? '发现冲突' : '仅本机'}</span>{syncEnabled && <button type="button" className="review-button" onClick={() => syncReview(current)}>立即同步</button>}</div>
        {syncState.status === 'conflict' && <div className="review-conflict" role="alert"><span>{syncState.error}</span><button type="button" className="review-button" onClick={resolveConflict}>合并两台设备记录</button>{syncState.remoteReview && <details><summary>查看云端版本</summary><ul>{syncState.remoteReview.workingDraft.items.map((item) => <li key={item.itemId}>{sections.find((section) => section.id === item.section)?.title}：{item.text}</li>)}</ul></details>}</div>}
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
        <footer className="review-card__footer"><span>{current.inputSegments.length} 段原始记录 · {syncState.status === 'synced' ? '已同步到云端' : syncEnabled ? '已保存到本机，等待同步' : '已保存到本机'}</span><span className="review-source-actions"><button type="button" className="review-button" onClick={withdrawLast} disabled={!current.inputSegments.length}>撤回上一段</button><button type="button" className="review-button review-button--primary" onClick={finish} disabled={current.reviewStatus === 'completed'}><Check size={16} />完成复盘</button></span></footer>
      </section>

      {current.completedVersions.length > 0 && <section className="review-card review-card--completed-versions"><div><span className="review-card__eyebrow">完成版本</span><h2>完成时的快照</h2><p>恢复会创建新的工作草稿，不会修改历史快照。</p></div>{current.completedVersions.map((version) => <article key={version.id}><div className="review-version-heading"><h3>第 {version.versionNo} 版 · {new Date(version.completedAt ?? version.createdAt).toLocaleString()}</h3><button type="button" className="review-button" onClick={() => restoreVersion(version.id)}>恢复为草稿</button></div>{version.items.length ? <ul>{version.items.map((item) => <li key={item.itemId}><strong>{sections.find((section) => section.id === item.section)?.title}：</strong>{item.text}</li>)}</ul> : <span className="review-empty">完成时没有整理条目</span>}</article>)}</section>}
      {current.inputSegments.length > 0 && <section className="review-card review-card--history"><div className="review-card__title"><div><span className="review-card__eyebrow">原始记录</span><h2>可追溯，不被整理覆盖</h2></div><FileText size={19} /></div><ol>{current.inputSegments.map((segment) => segment.type === 'text'
        ? <li key={segment.id}><textarea defaultValue={segment.text} onBlur={(event) => updateSource(segment.id, event.target.value)} aria-label="编辑原始记录" /></li>
        : <li key={segment.id} className="review-voice-segment"><strong>语音片段 · {Math.ceil(segment.audio.durationMs / 1_000)} 秒</strong>{segment.asrText || segment.correctedText ? <><textarea defaultValue={segment.correctedText ?? segment.asrText} onBlur={(event) => { const next = updateVoiceTranscript(current, segment.id, event.target.value); if (next !== current) update(next); }} aria-label="校对语音转写" /><span className="review-source-actions"><button type="button" className="review-button" onClick={() => learnPersonalTerm(segment)}>校对后加入常用词</button><button type="button" className="review-button" disabled={!syncEnabled || transcribingSegmentId === segment.id} onClick={() => void transcribeVoice(current, segment.id, true)}>重新识别（需保留本机音频）</button></span></> : segment.originDeviceId !== localReviewDeviceId() ? <span>该语音仍在录制设备；请回到原设备继续识别。</span> : <><span>{segment.transcriptionState === 'recording' ? '录音意外中断时会在下次打开时恢复已保存部分。' : segment.transcriptionState === 'interrupted' ? '录音已中断；已保存部分仍在本机。可继续说（将建立新片段）或点击完成并识别。' : segment.transcriptionState === 'audio_unavailable' ? '本机音频未完整保存或已被清理，无法识别。' : segment.transcriptionState === 'transcribing' ? '正在识别语音…' : segment.transcriptionState === 'retryable_failed' ? '识别失败，录音仍在本机。' : '仅保存在本机，等待点击“说完了”后识别。'}</span>{segment.transcriptionState !== 'audio_unavailable' && <button type="button" className="review-button" disabled={!syncEnabled || transcribingSegmentId === segment.id || segment.transcriptionState === 'transcribing'} onClick={() => void transcribeVoice(current, segment.id)}>{transcribingSegmentId === segment.id ? '正在识别…' : segment.transcriptionState === 'retryable_failed' ? '重试识别' : '完成并识别'}</button>}</>}</li>)}</ol></section>}
      {current.conflictSnapshots.length > 0 && <section className="review-card"><div><span className="review-card__eyebrow">冲突快照</span><h2>人工编辑的可追溯副本</h2></div>{current.conflictSnapshots.map((snapshot) => <details key={snapshot.id}><summary>{new Date(snapshot.createdAt).toLocaleString()}：{snapshot.message}</summary><p>本机：{snapshot.localItems.map((item) => item.text).join('；') || '无'}</p><p>云端：{snapshot.remoteItems.map((item) => item.text).join('；') || '无'}</p></details>)}</section>}
      {reviews.length > 0 && <section className="review-card review-card--review-history"><div><span className="review-card__eyebrow">历史复盘</span><h2>按日期打开已保存版本</h2></div><div>{reviews.map((item) => <button type="button" key={item.id} className={item.reviewDate === reviewDate ? 'is-current' : ''} onClick={() => setReviewDate(item.reviewDate)}>{item.reviewDate}<span>{item.reviewStatus === 'completed' ? `完成 · v${item.completedVersions.length}` : '草稿'}</span></button>)}</div></section>}
    </main>
  );
}

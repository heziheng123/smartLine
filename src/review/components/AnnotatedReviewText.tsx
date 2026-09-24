import { useMemo, useRef, useState } from 'react';
import {
  activeReviewAnnotations,
  activeTextVersion,
  addReviewAnnotation,
  removeReviewAnnotation,
  updateReviewAnnotation,
  type DailyReview,
  type ReviewAnnotation,
  type ReviewAnnotationType,
} from '@/review/model';

const annotationLabels: Record<ReviewAnnotationType, string> = {
  progress: '进展',
  problem: '问题',
  reflection: '反思',
  solution: '解决办法',
  emphasis: '重点',
};

const backgroundTypes: ReviewAnnotationType[] = ['progress', 'problem', 'reflection', 'solution'];

interface AnnotatedReviewTextProps {
  review: DailyReview;
  onChange: (review: DailyReview) => void;
  onAnalyze: () => void;
  analyzing: boolean;
}

export default function AnnotatedReviewText({ review, onChange, onAnalyze, analyzing }: AnnotatedReviewTextProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const version = activeTextVersion(review);
  const annotations = useMemo(() => activeReviewAnnotations(review), [review]);
  const [filter, setFilter] = useState<'all' | Exclude<ReviewAnnotationType, 'emphasis'>>('all');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const selectedAnnotation = annotations.find((annotation) => annotation.id === selectedAnnotationId) ?? null;
  const visibleAnnotations = annotations.filter((annotation) => filter === 'all' || annotation.type === filter || annotation.type === 'emphasis');
  const boundaries = [...new Set([0, version.text.length, ...visibleAnnotations.flatMap((annotation) => [annotation.start, annotation.end])])].sort((left, right) => left - right);
  const staleCount = review.annotations.filter((annotation) => !annotation.deletedAt && annotation.stale && (annotation.createdBy === 'user' || annotation.userEdited)).length;
  const counts = Object.fromEntries(backgroundTypes.map((type) => [type, annotations.filter((annotation) => annotation.type === type).length])) as Record<Exclude<ReviewAnnotationType, 'emphasis'>, number>;

  const readSelection = () => {
    const selection = window.getSelection(); const container = containerRef.current;
    if (!selection || !container || selection.rangeCount === 0 || selection.isCollapsed) { setSelectionRange(null); return; }
    const range = selection.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) { setSelectionRange(null); return; }
    const before = range.cloneRange(); before.selectNodeContents(container); before.setEnd(range.startContainer, range.startOffset);
    let start = before.toString().length; let end = start + range.toString().length;
    while (start < end && /\s/.test(version.text[start] ?? '')) start += 1;
    while (end > start && /\s/.test(version.text[end - 1] ?? '')) end -= 1;
    setSelectedAnnotationId(null);
    setSelectionRange(end > start ? { start, end } : null);
  };

  const add = (type: ReviewAnnotationType) => {
    if (!selectionRange) return;
    onChange(addReviewAnnotation(review, type, selectionRange.start, selectionRange.end));
    setSelectionRange(null); window.getSelection()?.removeAllRanges();
  };

  const edit = (type: ReviewAnnotationType) => {
    if (!selectedAnnotation) return;
    onChange(updateReviewAnnotation(review, selectedAnnotation.id, type));
    setSelectedAnnotationId(null);
  };

  return (
    <section className="review-card review-annotation-card">
      <div className="review-card__title">
        <div><span className="review-card__eyebrow">用户原文</span><h2>原文标注</h2><p>颜色只是附加批注，不会修改你的原话。</p></div>
        <button type="button" className="review-button" onClick={onAnalyze} disabled={analyzing || !version.text.trim()}>{analyzing ? '正在分析…' : annotations.length ? '重新 AI 分析' : 'AI 分析原文'}</button>
      </div>
      {version.text ? <>
        <div className="review-annotation-summary">已标出：{counts.progress} 个进展 · {counts.problem} 个问题 · {counts.reflection} 个反思 · {counts.solution} 个调整</div>
        <div className="review-annotation-filters" aria-label="标注筛选">
          {([['all', '全部'], ...backgroundTypes.map((type) => [type, annotationLabels[type]])] as Array<[typeof filter, string]>).map(([type, label]) => <button key={type} type="button" className={filter === type ? 'is-active' : ''} onClick={() => setFilter(type)}>{label}</button>)}
        </div>
        {staleCount > 0 && <p className="review-annotation-warning" role="status">转写已修改，{staleCount} 条人工标注需要重新确认；旧记录仍已保留。</p>}
        <div ref={containerRef} className="review-paper" onMouseUp={readSelection} onTouchEnd={readSelection}>
          {boundaries.slice(0, -1).map((start, index) => {
            const end = boundaries[index + 1]!; const text = version.text.slice(start, end);
            const main = visibleAnnotations.find((annotation) => annotation.type !== 'emphasis' && annotation.start <= start && annotation.end >= end);
            const emphasis = visibleAnnotations.find((annotation) => annotation.type === 'emphasis' && annotation.start <= start && annotation.end >= end);
            const target = main ?? emphasis;
            const open = () => { setSelectionRange(null); setSelectedAnnotationId(target?.id ?? null); };
            return target ? <mark key={`${start}:${end}`} role="button" tabIndex={0} className={`review-highlight review-highlight--${main?.type ?? 'plain'} ${emphasis ? 'is-emphasis' : ''}`} onClick={open} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }}>{text}</mark> : <span key={`${start}:${end}`}>{text}</span>;
          })}
        </div>
        {selectionRange && <div className="review-annotation-popover" role="dialog" aria-label="创建原文标注"><strong>标记选中文字</strong><p>“{version.text.slice(selectionRange.start, selectionRange.end)}”</p><div>{Object.entries(annotationLabels).map(([type, label]) => <button key={type} type="button" onClick={() => add(type as ReviewAnnotationType)}>{label}</button>)}<button type="button" onClick={() => setSelectionRange(null)}>取消</button></div></div>}
        {selectedAnnotation && <AnnotationPopover annotation={selectedAnnotation} onEdit={edit} onRemove={() => { onChange(removeReviewAnnotation(review, selectedAnnotation.id)); setSelectedAnnotationId(null); }} onClose={() => setSelectedAnnotationId(null)} />}
      </> : <div className="review-empty review-empty--paper">先保存文字记录，或完成一段语音识别；完整原文会显示在这里。</div>}
    </section>
  );
}

function AnnotationPopover({ annotation, onEdit, onRemove, onClose }: { annotation: ReviewAnnotation; onEdit: (type: ReviewAnnotationType) => void; onRemove: () => void; onClose: () => void }) {
  return <div className="review-annotation-popover" role="dialog" aria-label="编辑原文标注"><div><strong>{annotationLabels[annotation.type]}</strong><button type="button" onClick={onClose} aria-label="关闭标注编辑">×</button></div><blockquote>“{annotation.quotedText}”</blockquote>{annotation.summary && <p><b>AI 解释：</b>{annotation.summary}</p>}<div>{Object.entries(annotationLabels).map(([type, label]) => <button key={type} type="button" className={annotation.type === type ? 'is-active' : ''} onClick={() => onEdit(type as ReviewAnnotationType)}>改为{label}</button>)}<button type="button" className="is-danger" onClick={onRemove}>取消标记</button></div></div>;
}

import React, { useMemo, useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import type { SmartTaskBlock } from '@/types';
import { getVocabularyLearnedWords, getVocabularyTotalWords } from '@/utils/blocks';
import { recordVocabularyProgress, removeVocabularyProgress } from '@/services/projectTaskCommands';

interface VocabularyProgressDialogProps {
  taskId: string;
  block: SmartTaskBlock;
  date: string;
  onClose: () => void;
}

const VocabularyProgressDialog: React.FC<VocabularyProgressDialogProps> = ({ taskId, block, date, onClose }) => {
  const header = block.header;
  const records = header.vocabularyRecords ?? {};
  const currentRecord = records[date];
  const progress = getVocabularyLearnedWords(header);
  const total = getVocabularyTotalWords(header);
  const completedBeforeToday = progress - (currentRecord ?? 0);
  const maxForDate = total - completedBeforeToday;
  const [value, setValue] = useState(currentRecord ? String(currentRecord) : '');
  const [error, setError] = useState<string | null>(null);
  const remaining = useMemo(() => Math.max(0, total - progress), [progress, total]);

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    const learnedWords = Number(value);
    if (!Number.isInteger(learnedWords) || learnedWords <= 0) return setError('请输入大于 0 的整数。');
    if (learnedWords > maxForDate) return setError(`最多还能记录 ${maxForDate} 个单词。`);
    const result = recordVocabularyProgress(taskId, block.id, date, learnedWords);
    if ('error' in result) return setError(result.error);
    onClose();
  };

  const remove = () => {
    const result = removeVocabularyProgress(taskId, block.id, date);
    if ('error' in result) return setError(result.error);
    onClose();
  };

  return (
    <div className="ds-vocab-overlay" role="presentation" onMouseDown={onClose}>
      <section className="ds-vocab-dialog ds-vocab-dialog--progress" role="dialog" aria-modal="true" aria-labelledby="vocab-progress-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ds-vocab-dialog-header">
          <div>
            <h2 id="vocab-progress-title"><BookOpen size={18} />记录今日单词</h2>
            <p>{header.title} · {date}</p>
          </div>
          <button type="button" className="ds-vocab-icon-btn" onClick={onClose} aria-label="关闭记录窗口"><X size={18} /></button>
        </div>
        <form className="ds-vocab-form" onSubmit={save}>
          <div className="ds-vocab-progress-summary">
            <span>此前已学 {completedBeforeToday}</span>
            <span>总数 {total}</span>
          </div>
          <label>今天新学了多少个？<input autoFocus type="number" min="1" max={maxForDate} step="1" value={value} onChange={(event) => setValue(event.target.value)} placeholder={`最多 ${maxForDate}`} /></label>
          <p className="ds-vocab-form-hint">当前剩余 {remaining} 个；这里只记录新增掌握的单词，不记录学习时长。</p>
          {error && <div className="ds-vocab-error" role="alert">{error}</div>}
          <div className="ds-vocab-form-actions">
            {currentRecord && <button type="button" className="ds-vocab-danger-btn" onClick={remove}>撤销今日记录</button>}
            <button type="button" className="ds-vocab-secondary-btn" onClick={onClose}>取消</button>
            <button type="submit" className="ds-vocab-primary-btn">{currentRecord ? '更新记录' : '完成记录'}</button>
          </div>
        </form>
      </section>
    </div>
  );
};

export default VocabularyProgressDialog;

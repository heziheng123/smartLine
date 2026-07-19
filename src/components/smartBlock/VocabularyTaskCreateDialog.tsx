import React, { useState } from 'react';
import { BookOpen, X } from 'lucide-react';
import { todayStr } from '@/utils/dateSafe';

interface VocabularyTaskCreateDialogProps {
  onClose: () => void;
  onCreate: (input: {
    title: string;
    totalWords: number;
    initialCompletedWords: number;
    date: string;
  }) => void;
}

const VocabularyTaskCreateDialog: React.FC<VocabularyTaskCreateDialogProps> = ({ onClose, onCreate }) => {
  const [title, setTitle] = useState('背诵单词');
  const [totalWords, setTotalWords] = useState('');
  const [initialCompletedWords, setInitialCompletedWords] = useState('0');
  const [date, setDate] = useState(todayStr());
  const [error, setError] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const total = Number(totalWords);
    const initial = Number(initialCompletedWords);
    if (!title.trim()) return setError('请输入任务名称。');
    if (!Number.isInteger(total) || total <= 0) return setError('总单词数必须是大于 0 的整数。');
    if (!Number.isInteger(initial) || initial < 0) return setError('当前已学必须是非负整数。');
    if (initial > total) return setError('当前已学不能超过总单词数。');
    if (!date) return setError('请选择开始日期。');
    onCreate({ title: title.trim(), totalWords: total, initialCompletedWords: initial, date });
  };

  return (
    <div className="ds-vocab-overlay" role="presentation" onMouseDown={onClose}>
      <section className="ds-vocab-dialog ds-vocab-dialog--progress" role="dialog" aria-modal="true" aria-labelledby="create-vocabulary-task-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ds-vocab-dialog-header">
          <div>
            <h2 id="create-vocabulary-task-title"><BookOpen size={18} />新建单词任务</h2>
            <p>任务会保存在当前项目中，并从开始日期起进入每日安排任务池。</p>
          </div>
          <button type="button" className="ds-vocab-icon-btn" onClick={onClose} aria-label="关闭新建单词任务"><X size={18} /></button>
        </div>
        <form className="ds-vocab-form" onSubmit={submit}>
          <label>任务名称<input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：考研英语单词" /></label>
          <div className="ds-vocab-form-grid">
            <label>总单词数<input type="number" min="1" step="1" value={totalWords} onChange={(event) => setTotalWords(event.target.value)} placeholder="例如 5500" /></label>
            <label>当前已学<input type="number" min="0" step="1" value={initialCompletedWords} onChange={(event) => setInitialCompletedWords(event.target.value)} /></label>
          </div>
          <label>开始日期<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <p className="ds-vocab-form-hint">单词任务不记录学习时长；每天由你拖入上午、下午或晚上。</p>
          {error && <div className="ds-vocab-error" role="alert">{error}</div>}
          <div className="ds-vocab-form-actions">
            <button type="button" className="ds-vocab-secondary-btn" onClick={onClose}>取消</button>
            <button type="submit" className="ds-vocab-primary-btn">创建单词任务</button>
          </div>
        </form>
      </section>
    </div>
  );
};

export default VocabularyTaskCreateDialog;

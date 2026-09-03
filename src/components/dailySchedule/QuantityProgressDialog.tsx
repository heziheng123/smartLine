import React, { useMemo, useState } from 'react';
import { Hash, X } from 'lucide-react';
import type { SmartTaskBlock } from '@/types';
import {
  getQuantityCompleted,
  getQuantityDailySuggestion,
  getQuantityRecords,
  getQuantityTotal,
  getQuantityUnit,
} from '@/utils/blocks';
import { removeQuantityProgress } from '@/services/projectTaskCommands';
import { requestQuantityProgress } from '@/services/projectTaskCompletion';
import { todayStr } from '@/utils/dateSafe';
import '@/styles/daily-schedule.css';

interface QuantityProgressDialogProps {
  taskId: string;
  block: SmartTaskBlock;
  date: string;
  onClose: () => void;
}

const QuantityProgressDialog: React.FC<QuantityProgressDialogProps> = ({ taskId, block, date, onClose }) => {
  const header = block.header;
  const records = getQuantityRecords(header);
  const currentRecord = records[date];
  const progress = getQuantityCompleted(header);
  const total = getQuantityTotal(header);
  const unit = getQuantityUnit(header);
  const completedBeforeDate = progress - (currentRecord ?? 0);
  const maxForDate = total - completedBeforeDate;
  const suggestion = getQuantityDailySuggestion(header, date);
  const [value, setValue] = useState(currentRecord ? String(currentRecord) : '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const remaining = useMemo(() => Math.max(0, total - progress), [progress, total]);
  const dayLabel = date === todayStr() ? '今日' : '当日';

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(value);
    if (!Number.isInteger(amount) || amount <= 0) return setError('请输入大于 0 的整数。');
    if (amount > maxForDate) return setError(`最多还能记录 ${maxForDate} ${unit}。`);
    setSaving(true);
    try {
      const result = await requestQuantityProgress(taskId, block.id, date, amount);
      if (!result.ok) {
        if ('cancelled' in result) return;
        return setError(result.error);
      }
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    const result = removeQuantityProgress(taskId, block.id, date);
    if ('error' in result) return setError(result.error);
    onClose();
  };

  return (
    <div className="ds-vocab-overlay" role="presentation" onMouseDown={onClose}>
      <section className="ds-vocab-dialog ds-vocab-dialog--progress" role="dialog" aria-modal="true" aria-labelledby="quantity-progress-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="ds-vocab-dialog-header">
          <div>
            <h2 id="quantity-progress-title"><Hash size={18} />记录{dayLabel}完成量</h2>
            <p>{header.title} · {date}</p>
          </div>
          <button type="button" className="ds-vocab-icon-btn" onClick={onClose} aria-label="关闭数量记录窗口"><X size={18} /></button>
        </div>
        <form className="ds-vocab-form" onSubmit={save}>
          <div className="ds-vocab-progress-summary">
            <span>此前完成 {completedBeforeDate} {unit}</span>
            <span>目标 {total} {unit}</span>
          </div>
          {suggestion && (
            <div className="ds-quantity-suggestion" aria-label="每日完成建议">
              <span>{suggestion.overdue ? '已超过截止日期' : `距离截止还有 ${suggestion.daysRemaining} 天`}</span>
              <strong>建议{dayLabel}完成 {suggestion.suggested} {unit}</strong>
            </div>
          )}
          <label>{dayLabel}完成了多少{unit}？<input autoFocus type="number" min="1" max={maxForDate} step="1" value={value} onChange={(event) => setValue(event.target.value)} placeholder={suggestion?.suggested ? `建议 ${Math.min(maxForDate, suggestion.suggested)}` : `最多 ${maxForDate}`} /></label>
          <p className="ds-vocab-form-hint">当前剩余 {remaining} {unit}；这里只记录新增完成量，不记录学习时长。</p>
          {error && <div className="ds-vocab-error" role="alert">{error}</div>}
          <div className="ds-vocab-form-actions">
            {currentRecord && <button type="button" className="ds-vocab-danger-btn" onClick={remove}>撤销{dayLabel}记录</button>}
            <button type="button" className="ds-vocab-secondary-btn" onClick={onClose}>取消</button>
            <button type="submit" className="ds-vocab-primary-btn" disabled={saving}>{saving ? '处理中…' : currentRecord ? '更新记录' : '完成记录'}</button>
          </div>
        </form>
      </section>
    </div>
  );
};

export default QuantityProgressDialog;

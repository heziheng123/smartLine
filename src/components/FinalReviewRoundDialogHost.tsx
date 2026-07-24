import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarPlus, X } from 'lucide-react';
import {
  setFinalReviewRoundPromptHandler,
  type FinalReviewRoundPromptOptions,
  type FinalReviewRoundPromptResult,
} from '@/services/finalReviewRoundPrompt';

interface QueuedPrompt {
  id: number;
  options: FinalReviewRoundPromptOptions;
  resolve: (result: FinalReviewRoundPromptResult) => void;
}

let promptSequence = 0;

const FinalReviewRoundDialogHost: React.FC = () => {
  const [queue, setQueue] = useState<QueuedPrompt[]>([]);
  const [nextDueDate, setNextDueDate] = useState('');
  const appendButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const current = queue[0];
  const currentId = current?.id;

  useEffect(() => setFinalReviewRoundPromptHandler((options) => new Promise((resolve) => {
    setQueue((items) => [...items, { id: ++promptSequence, options, resolve }]);
  })), []);

  const settle = useCallback((result: FinalReviewRoundPromptResult) => {
    setQueue((items) => {
      const [active, ...rest] = items;
      active?.resolve(result);
      return rest;
    });
  }, []);

  useEffect(() => {
    if (!current) return;
    setNextDueDate(current.options.suggestedDate);
  }, [currentId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!currentId) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.setTimeout(() => appendButtonRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      settle(null);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [currentId, settle]);

  if (!current) return null;
  const { topicName, currentRound, minimumDate } = current.options;
  const dateIsValid = /^\d{4}-\d{2}-\d{2}$/.test(nextDueDate) && nextDueDate >= minimumDate;

  return createPortal(
    <div className="app-confirm-overlay" role="presentation" onMouseDown={() => settle(null)}>
      <section
        className="app-confirm app-final-review-dialog app-confirm--warning"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-final-review-title"
        aria-describedby="app-final-review-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="app-confirm-close" type="button" aria-label="取消并关闭" onClick={() => settle(null)}>
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true"><CalendarPlus size={21} /></div>
        <div className="app-confirm-content">
          <h2 id="app-final-review-title">这是当前最后一轮复习</h2>
          <p id="app-final-review-message">
            “{topicName}”第 {currentRound} 轮完成后，当前计划将没有待复习轮次。是否需要继续增加一轮？
          </p>
        </div>

        <div className="app-final-review-date">
          <label htmlFor="app-final-review-date-input">下一轮日期</label>
          <input
            id="app-final-review-date-input"
            type="date"
            min={minimumDate}
            value={nextDueDate}
            onChange={(event) => setNextDueDate(event.target.value)}
          />
          <span>已按当前复习间隔给出建议，可自行修改。</span>
        </div>

        <div className="app-final-review-options">
          <button
            type="button"
            className="app-final-review-option"
            onClick={() => settle({ decision: 'finish' })}
          >
            <strong>完成并结束计划</strong>
            <span>只完成当前轮次，不创建新的复习任务。</span>
          </button>
          <button
            ref={appendButtonRef}
            type="button"
            className="app-final-review-option app-final-review-option--primary"
            disabled={!dateIsValid}
            onClick={() => settle({ decision: 'append', nextDueDate })}
          >
            <strong>完成并增加一轮 <em>推荐</em></strong>
            <span>{dateIsValid ? `完成当前轮次，并在 ${nextDueDate} 创建下一轮。` : '请选择今天或之后的有效日期。'}</span>
          </button>
        </div>

        <footer className="app-confirm-actions">
          <button type="button" className="app-confirm-button app-confirm-button--cancel" onClick={() => settle(null)}>
            取消
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default FinalReviewRoundDialogHost;

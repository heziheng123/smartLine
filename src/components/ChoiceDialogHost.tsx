import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GitBranch, X } from 'lucide-react';
import {
  setChoiceHandler,
  type ChoiceOptions,
} from '@/services/choice';

interface QueuedChoice {
  id: number;
  options: ChoiceOptions;
  resolve: (value: string | null) => void;
}

let choiceSequence = 0;

const ChoiceDialogHost: React.FC = () => {
  const [queue, setQueue] = useState<QueuedChoice[]>([]);
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const current = queue[0];
  const currentId = current?.id;

  useEffect(() => setChoiceHandler((options) => new Promise<string | null>((resolve) => {
    setQueue((items) => [...items, { id: ++choiceSequence, options, resolve }]);
  })), []);

  const settle = useCallback((value: string | null) => {
    setQueue((items) => {
      const [active, ...rest] = items;
      active?.resolve(value);
      return rest;
    });
  }, []);

  useEffect(() => {
    if (!currentId) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.setTimeout(() => firstChoiceRef.current?.focus(), 0);
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
  const {
    title,
    message,
    choices,
    cancelLabel = '取消修改',
    tone = 'warning',
    impact = [],
  } = current.options;

  return createPortal(
    <div className="app-confirm-overlay" role="presentation" onMouseDown={() => settle(null)}>
      <section
        className={`app-confirm app-choice app-confirm--${tone}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-choice-title"
        aria-describedby="app-choice-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="app-confirm-close" type="button" aria-label={cancelLabel} onClick={() => settle(null)}>
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true"><GitBranch size={21} /></div>
        <div className="app-confirm-content">
          <h2 id="app-choice-title">{title}</h2>
          <p id="app-choice-message">{message}</p>
          {impact.length > 0 && (
            <ul className="app-confirm-impact">
              {impact.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
        </div>
        <div className="app-choice-options">
          {choices.map((choice, index) => (
            <button
              key={choice.value}
              ref={index === 0 ? firstChoiceRef : undefined}
              type="button"
              className="app-choice-option"
              onClick={() => settle(choice.value)}
            >
              <span className="app-choice-option-title">
                {choice.label}
                {choice.recommended && <span className="app-choice-recommended">推荐</span>}
              </span>
              <span className="app-choice-option-description">{choice.description}</span>
            </button>
          ))}
        </div>
        <footer className="app-confirm-actions">
          <button type="button" className="app-confirm-button app-confirm-button--cancel" onClick={() => settle(null)}>
            {cancelLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default ChoiceDialogHost;

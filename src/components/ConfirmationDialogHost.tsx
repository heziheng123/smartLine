import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, X } from 'lucide-react';
import {
  setConfirmationHandler,
  type ConfirmationOptions,
} from '@/services/confirmation';

interface QueuedConfirmation {
  id: number;
  options: ConfirmationOptions;
  resolve: (confirmed: boolean) => void;
}

let confirmationSequence = 0;

const ConfirmationDialogHost: React.FC = () => {
  const [queue, setQueue] = useState<QueuedConfirmation[]>([]);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const current = queue[0];
  const currentId = current?.id;

  useEffect(() => setConfirmationHandler((options) => new Promise<boolean>((resolve) => {
    setQueue((items) => [...items, { id: ++confirmationSequence, options, resolve }]);
  })), []);

  const settle = useCallback((confirmed: boolean) => {
    setQueue((items) => {
      const [active, ...rest] = items;
      active?.resolve(confirmed);
      return rest;
    });
  }, []);

  useEffect(() => {
    if (!currentId) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    window.setTimeout(() => confirmRef.current?.focus(), 0);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      previousFocusRef.current?.focus();
    };
  }, [currentId, settle]);

  if (!current) return null;
  const {
    title = '请确认操作',
    message,
    confirmLabel = '继续',
    cancelLabel = '取消',
    tone = 'default',
    impact = [],
  } = current.options;

  return createPortal(
    <div className="app-confirm-overlay" role="presentation" onMouseDown={() => settle(false)}>
      <section
        className={`app-confirm app-confirm--${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="app-confirm-title"
        aria-describedby="app-confirm-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="app-confirm-close" type="button" aria-label="取消并关闭" onClick={() => settle(false)}>
          <X size={17} />
        </button>
        <div className="app-confirm-icon" aria-hidden="true"><AlertTriangle size={22} /></div>
        <div className="app-confirm-content">
          <h2 id="app-confirm-title">{title}</h2>
          <p id="app-confirm-message">{message}</p>
          {impact.length > 0 && (
            <ul className="app-confirm-impact">
              {impact.map((item) => <li key={item}>{item}</li>)}
            </ul>
          )}
        </div>
        <footer className="app-confirm-actions">
          <button type="button" className="app-confirm-button app-confirm-button--cancel" onClick={() => settle(false)}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className="app-confirm-button app-confirm-button--confirm" onClick={() => settle(true)}>
            {confirmLabel}
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
};

export default ConfirmationDialogHost;

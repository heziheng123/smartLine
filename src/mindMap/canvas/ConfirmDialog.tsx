import { useEffect } from 'react';
import styles from './MindMapCanvas.module.css';

export interface MindMapConfirmDialogState {
  message: string;
  confirmLabel: string;
  action: () => void;
}

interface MindMapConfirmDialogProps {
  dialog: MindMapConfirmDialogState | null;
  onClose: () => void;
  floating?: boolean;
}

// 拆分第一步：画布/工作区/人生面板共用的确认框，替代原生 window.confirm。
export function MindMapConfirmDialog({ dialog, onClose, floating = false }: MindMapConfirmDialogProps) {
  useEffect(() => {
    if (!dialog) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [dialog, onClose]);
  if (!dialog) return null;
  return (
    <div
      role="alertdialog"
      aria-label="请确认"
      className={styles.confirmDialog}
      style={floating ? undefined : { position: 'fixed', left: '50%', top: '30%', transform: 'translateX(-50%)', zIndex: 100 }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <p>{dialog.message}</p>
      <div>
        <button type="button" onClick={onClose}>取消（Esc）</button>
        <button
          type="button"
          autoFocus
          onClick={() => {
            dialog.action();
            onClose();
          }}
        >
          {dialog.confirmLabel}
        </button>
      </div>
    </div>
  );
}

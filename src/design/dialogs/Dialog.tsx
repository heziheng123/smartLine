import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useDialogKeyboard } from './useDialogKeyboard';
import { requestConfirmation } from '@/services/confirmation';

/**
 * Dialog 标准外壳。
 *
 * 设计原则：
 * 1. 完全复用现有 .tl-dialog* 类名（timeline.css 中已有完整样式 + e2e 在用）
 * 2. 统一行为：Esc 关闭、Cmd/Ctrl+Enter 提交、错误聚合显示、a11y 标注
 * 3. P0 防护：脏态检测 → 关闭/取消/点遮罩前询问"是否放弃未保存修改"
 * 4. P1 a11y：focus trap（Tab 在对话框内循环）+ 打开时聚焦首个字段 + 关闭后还原焦点
 * 5. 不破坏任何现存的字段/色板/按钮 —— 业务内容通过 children 注入
 *
 * 使用：
 *   <Dialog
 *     title="新建任务"
 *     onCancel={closeDialog}
 *     onSubmit={handleSave}
 *     canSubmit={isValid}
 *     submitLabel="创建"
 *     errors={errorsArray}
 *     isDirty={isDirty}
 *     discardConfirmMessage="放弃未保存的修改？"
 *   >
 *     ... 字段 ...
 *   </Dialog>
 */
export interface DialogProps {
  title: string;
  onCancel: () => void;
  onSubmit?: () => void;
  canSubmit?: boolean;
  submitLabel?: string;
  cancelLabel?: string;
  /** 可选危险操作（例如"删除"），与提交按钮分列左右 */
  sideAction?: { label: string; onClick: () => void | Promise<void>; danger?: boolean };
  /** 业务错误聚合（来自字段或 API） */
  errors?: string[];
  children: ReactNode;
  /** 自定义最外层元素 class，默认沿用现有 .tl-dialog-overlay */
  overlayClassName?: string;
  /**
   * 当前是否有未保存的修改。
   * 为 true 时 Esc/点遮罩/点取消 都会先询问 `discardConfirmMessage`。
   */
  isDirty?: boolean;
  /** 关闭前提示文案（仅在 isDirty=true 时生效） */
  discardConfirmMessage?: string;
}

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Dialog(props: DialogProps) {
  const {
    title,
    onCancel,
    onSubmit,
    canSubmit = true,
    submitLabel = '保存',
    cancelLabel = '取消',
    sideAction,
    errors = [],
    children,
    overlayClassName,
    isDirty = false,
    discardConfirmMessage = '放弃未保存的修改？',
  } = props;

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // P0 D-3 守卫：脏态检测 → 关窗确认（使用项目统一的 modal，避免 native confirm 风格断裂）
  const requestCancel = useCallback(async (): Promise<void> => {
    if (isDirty) {
      const ok = await requestConfirmation({
        title: '放弃未保存的修改',
        message: discardConfirmMessage,
        confirmLabel: '放弃修改',
        cancelLabel: '继续编辑',
        tone: 'warning',
      });
      if (!ok) return;
    }
    onCancel();
  }, [isDirty, discardConfirmMessage, onCancel]);

  useDialogKeyboard({
    onCancel: requestCancel,
    onSubmit: canSubmit ? onSubmit : undefined,
  });

  // P1 D-1：focus trap + 打开时聚焦首个可聚焦元素 + 关闭时还原焦点
  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    // P1 D-1（已加强）：用微任务延迟一拍抓 activeElement。React 18 commit 阶段
    // activeElement 可能已经是 <body>（触发 dialog 的按钮在 commit 后才稳定），
    // 微任务里能抓到的真实触发按钮。strict mode 下也能避免 focus 还原退回 <body>。
    queueMicrotask(() => {
      const active = document.activeElement as HTMLElement | null;
      if (
        active
        && active !== document.body
        && document.contains(active)
        && (
          !previouslyFocusedRef.current
          || previouslyFocusedRef.current === document.body
        )
      ) {
        previouslyFocusedRef.current = active;
      }
    });

    const focusFirst = () => {
      const root = dialogRef.current;
      if (!root) return;
      const first = root.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      if (first) first.focus();
    };
    const id = window.setTimeout(focusFirst, 0);

    const handleKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const root = dialogRef.current;
      if (!root) return;
      const focusables = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
        .filter((el) => !el.hasAttribute('disabled') && el.offsetParent !== null);
      if (focusables.length === 0) {
        e.preventDefault();
        root.focus();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey) {
        if (active === first || !root.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (active === last || !root.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', handleKey);

    return () => {
      window.clearTimeout(id);
      document.removeEventListener('keydown', handleKey);
      // 用 requestAnimationFrame 延迟到下一帧再还原焦点，避免与 React 18 下一次 commit 抢焦点
      requestAnimationFrame(() => {
        const prev = previouslyFocusedRef.current;
        if (prev && typeof prev.focus === 'function' && document.contains(prev)) {
          prev.focus();
        }
      });
    };
  }, []);

  const handleOverlayClick = async (e: React.MouseEvent) => {
    if (e.target !== e.currentTarget) return;
    await requestCancel();
  };

  const handleCancelClick = async () => {
    await requestCancel();
  };

  const handleSubmitClick = async () => {
    if (!canSubmit || !onSubmit) return;
    await onSubmit();
  };

  const handleSideActionClick = async () => {
    if (!sideAction) return;
    await sideAction.onClick();
  };

  const overlayClass = `tl-dialog-overlay ${overlayClassName ?? ''}`.trim();

  if (typeof document === 'undefined') {
    return (
      <div className={overlayClass}>
        <div className="tl-dialog" role="dialog" aria-modal="true" aria-label={title}>
          {renderInner({ title, children, errors, sideAction, submitLabel, cancelLabel, canSubmit, handleCancelClick, handleSubmitClick, handleSideActionClick, dialogRef })}
        </div>
      </div>
    );
  }

  return createPortal(
    <div
      className={overlayClass}
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        ref={dialogRef}
        className="tl-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        {renderInner({ title, children, errors, sideAction, submitLabel, cancelLabel, canSubmit, handleCancelClick, handleSubmitClick, handleSideActionClick, dialogRef })}
      </div>
    </div>,
    document.body,
  );
}

interface InnerArgs {
  title: string;
  children: ReactNode;
  errors: string[];
  sideAction?: { label: string; danger?: boolean };
  submitLabel: string;
  cancelLabel: string;
  canSubmit: boolean;
  handleCancelClick: () => Promise<void>;
  handleSubmitClick: () => Promise<void>;
  handleSideActionClick: () => Promise<void>;
  dialogRef: React.MutableRefObject<HTMLDivElement | null>;
}

function renderInner({
  title,
  children,
  errors,
  sideAction,
  submitLabel,
  cancelLabel,
  canSubmit,
  handleCancelClick,
  handleSubmitClick,
  handleSideActionClick,
}: InnerArgs) {
  return (
    <>
      <div className="tl-dialog-header">
        <h3>{title}</h3>
      </div>

      <div className="tl-dialog-body">
        {children}

        {errors.length > 0 && (
          <div
            className="tl-dialog-errors"
            role="alert"
            aria-live="polite"
          >
            {errors.map((msg, idx) => (
              <div key={idx} className="tl-dialog-error">{msg}</div>
            ))}
          </div>
        )}
      </div>

      <div className="tl-dialog-footer">
        {sideAction && (
          <button
            type="button"
            className={`tl-dialog-btn ${sideAction.danger ? 'tl-dialog-btn--danger' : ''}`}
            onClick={handleSideActionClick}
          >
            {sideAction.label}
          </button>
        )}
        <div className="tl-dialog-footer-right">
          <button
            type="button"
            className="tl-dialog-btn tl-dialog-btn--secondary"
            onClick={handleCancelClick}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="tl-dialog-btn tl-dialog-btn--primary"
            onClick={handleSubmitClick}
            disabled={!canSubmit}
            aria-disabled={!canSubmit}
          >
            {submitLabel}
          </button>
        </div>
      </div>
    </>
  );
}
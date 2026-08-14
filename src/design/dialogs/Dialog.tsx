import type { ReactNode } from 'react';
import { useDialogKeyboard } from './useDialogKeyboard';

/**
 * Dialog 标准外壳。
 *
 * 设计原则：
 * 1. 完全复用现有 .tl-dialog* 类名（timeline.css 中已有完整样式 + e2e 在用）
 * 2. 新增统一行为：Esc 关闭、Cmd/Ctrl+Enter 提交、错误聚合显示、a11y 标注
 * 3. 不破坏任何现存的字段/色板/按钮 —— 业务内容通过 children 注入
 *
 * 使用：
 *   <Dialog
 *     title="新建任务"
 *     onCancel={closeDialog}
 *     onSubmit={handleSave}
 *     canSubmit={isValid}
 *     submitLabel="创建"
 *     errors={errorsArray}
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
  sideAction?: { label: string; onClick: () => void; danger?: boolean };
  /** 业务错误聚合（来自字段或 API） */
  errors?: string[];
  children: ReactNode;
  /** 自定义最外层元素 class，默认沿用现有 .tl-dialog-overlay */
  overlayClassName?: string;
}

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
  } = props;

  useDialogKeyboard({
    onCancel,
    onSubmit: canSubmit ? onSubmit : undefined,
  });

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onCancel();
  };

  return (
    <div
      className={`tl-dialog-overlay ${overlayClassName ?? ''}`.trim()}
      onClick={handleOverlayClick}
      role="presentation"
    >
      <div
        className="tl-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
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
              onClick={sideAction.onClick}
            >
              {sideAction.label}
            </button>
          )}
          <div className="tl-dialog-footer-right">
            <button
              type="button"
              className="tl-dialog-btn tl-dialog-btn--secondary"
              onClick={onCancel}
            >
              {cancelLabel}
            </button>
            <button
              type="button"
              className="tl-dialog-btn tl-dialog-btn--primary"
              onClick={onSubmit}
              disabled={!canSubmit}
              aria-disabled={!canSubmit}
            >
              {submitLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

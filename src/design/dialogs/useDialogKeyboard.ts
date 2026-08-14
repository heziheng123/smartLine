import { useEffect } from 'react';

/**
 * 统一"按 Esc 关闭"+"按 Cmd/Ctrl+Enter 提交"的键盘行为。
 * 这样 TaskDialog / NoteDialog / GroupDialog / MilestoneDialog 调用同一个 hook，
 * 4 个弹窗的键盘体验完全一致。
 *
 * 仅在该 hook 挂载时生效；卸载即解绑，不污染全局。
 */
export function useDialogKeyboard(opts: {
  onCancel: () => void;
  onSubmit?: () => void;
  disabled?: boolean;
}): void {
  const { onCancel, onSubmit, disabled } = opts;
  useEffect(() => {
    if (disabled) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
        e.preventDefault();
        onSubmit();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel, onSubmit, disabled]);
}

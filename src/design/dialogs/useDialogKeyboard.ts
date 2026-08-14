import { useEffect } from 'react';

/**
 * 统一"按 Esc 关闭"+"按 Cmd/Ctrl+Enter 提交"的键盘行为。
 * 这样 TaskDialog / NoteDialog / GroupDialog / MilestoneDialog 调用同一个 hook，
 * 4 个弹窗的键盘体验完全一致。
 *
 * 仅在该 hook 挂载时生效；卸载即解绑，不污染全局。
 *
 * onCancel / onSubmit 可以是异步的（用于"脏态确认"等场景），
 * 异步操作会先执行 await，再决定是否真正关闭/提交。
 */
export function useDialogKeyboard(opts: {
  onCancel: () => void | Promise<void>;
  onSubmit?: () => void | Promise<void>;
  disabled?: boolean;
}): void {
  const { onCancel, onSubmit, disabled } = opts;
  useEffect(() => {
    if (disabled) return undefined;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void Promise.resolve(onCancel()).catch((err) => {
          console.error('[dialog] onCancel failed', err);
        });
      } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && onSubmit) {
        e.preventDefault();
        void Promise.resolve(onSubmit()).catch((err) => {
          console.error('[dialog] onSubmit failed', err);
        });
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel, onSubmit, disabled]);
}
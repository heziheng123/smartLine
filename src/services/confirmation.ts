export type ConfirmationTone = 'default' | 'warning' | 'danger';

export interface ConfirmationOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmationTone;
  /** Optional compact impact lines shown separately from the main message. */
  impact?: string[];
}

export type ConfirmationInput = string | ConfirmationOptions;
type ConfirmationHandler = (options: ConfirmationOptions) => Promise<boolean>;

let handler: ConfirmationHandler | null = null;

export function normalizeConfirmation(input: ConfirmationInput): ConfirmationOptions {
  if (typeof input !== 'string') return input;
  const danger = /删除|清空|不可撤销/.test(input);
  const warning = /恢复|覆盖|重置|迁移|切回|归档|解冻/.test(input);
  return {
    title: danger ? '确认危险操作' : warning ? '确认操作影响' : '请确认操作',
    message: input,
    confirmLabel: danger ? '确认执行' : '继续',
    cancelLabel: '取消',
    tone: danger ? 'danger' : warning ? 'warning' : 'default',
  };
}

/** Registered once by the application-level confirmation host. */
export function setConfirmationHandler(next: ConfirmationHandler | null): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/**
 * Open the shared application confirmation dialog. The native fallback only
 * protects isolated tests or boot-time failures before the host is mounted.
 */
export function requestConfirmation(input: ConfirmationInput): Promise<boolean> {
  const options = normalizeConfirmation(input);
  if (handler) return handler(options);
  return Promise.resolve(window.confirm(options.message));
}

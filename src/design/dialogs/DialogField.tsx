import type { ReactNode } from 'react';

/**
 * 标准表单字段容器。完全沿用现有 .tl-dialog-field / .tl-dialog-label 类名
 * （timeline.css 第 1578–1606 行已定义），所以外观 100% 不变。
 *
 * 新增 a11y 行为：
 * - error 与 aria-invalid 自动绑定（符合建议 #11）
 * - hint 与 aria-describedby 自动绑定（符合 WAI-ARIA Authoring Practices）
 */
export interface DialogFieldProps {
  label: string;
  /** 单行表单提示文本，灰色小字 */
  hint?: string;
  /** 字段级错误（用户看到红字 + 输入框描红） */
  error?: string | null;
  /** 是否占据整行（默认 true） */
  fullWidth?: boolean;
  children: ReactNode;
  /** 透传 id，便于 aria-describedby 等 */
  fieldId?: string;
}

export function DialogField(props: DialogFieldProps) {
  const { label, hint, error, fullWidth = true, children, fieldId } = props;
  const errId = fieldId ? `${fieldId}-error` : undefined;
  const hintId = fieldId ? `${fieldId}-hint` : undefined;
  // aria-describedby 合并 hint + error
  const describedBy = [hintId, errId].filter(Boolean).join(' ') || undefined;

  // 找到子元素里第一个 input/select/textarea 并注入 a11y 属性。
  // 用 cloneElement 而非 Context，避免破坏现有结构。
  return (
    <label
      className={`tl-dialog-field ${fullWidth ? '' : 'tl-dialog-field--inline'}`}
      data-invalid={error ? 'true' : undefined}
    >
      <span className="tl-dialog-label">{label}</span>
      {hint && (
        <span id={hintId} className="tl-dialog-hint">{hint}</span>
      )}
      <FieldChildInjector fieldId={fieldId} describedBy={describedBy} invalid={Boolean(error)}>
        {children}
      </FieldChildInjector>
      {error && (
        <span id={errId} className="tl-dialog-error">{error}</span>
      )}
    </label>
  );
}

// ───────────────────────────────────────────────────────────────
// 注入 a11y 属性到子输入元素 —— 不强制业务重写 input 结构。
// ───────────────────────────────────────────────────────────────
import { Children, cloneElement, isValidElement } from 'react';

function FieldChildInjector(props: {
  fieldId?: string;
  describedBy?: string;
  invalid: boolean;
  children: ReactNode;
}) {
  const { fieldId, describedBy, invalid, children } = props;
  let injected = false;
  const wrapped = Children.map(children, (child) => {
    if (injected) return child;
    if (!isValidElement(child)) return child;
    const elType = (child.type as { displayName?: string; name?: string } | undefined);
    const tag = typeof child.type === 'string' ? child.type : undefined;
    const isFormControl = tag === 'input' || tag === 'select' || tag === 'textarea';
    const isComponentInput = !tag && Boolean(elType);
    if (!isFormControl && !isComponentInput) return child;
    injected = true;
    const existing = (child.props ?? {}) as Record<string, unknown>;
    return cloneElement(child, {
      ...existing,
      id: fieldId ?? existing.id,
      'aria-invalid': invalid || undefined,
      'aria-describedby': describedBy ?? existing['aria-describedby'],
      'data-invalid': invalid || undefined,
    } as Record<string, unknown>);
  });
  return <>{wrapped}</>;
}

import { useId } from 'react';
import { normalizeHex } from '@/design/color';
import { DIALOG_COLOR_SWATCHES, TASK_COLOR_SWATCHES, GROUP_COLOR_SWATCHES } from '@/design/colors';

/**
 * 标准色板控件。取代 TaskDialog / NoteDialog / GroupDialog / MilestoneDialog
 * 里 4 份几乎一样的色板代码。
 *
 * 改进点（用户能感知到）：
 * - hover 任一颜色浮出色值文字（解决"色盲/纯靠颜色选不准"问题）
 * - hex 输入实时校验：无效时输入框描红 + 按钮禁用（解决"静默失败"问题）
 * - 同一份预设（12 / 24 色可选），而不是每个 dialog 各自塞 8 / 24 个 hex
 *
 * CSS 完全沿用现有 .tl-dialog-color-row / .tl-dialog-color-btn / .tl-dialog-color-input
 * （timeline.css 第 1665-1765 行），无外观变化。
 */

export type ColorPickerVariant = 'task' | 'group' | 'note';

export interface ColorPickerProps {
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  variant?: ColorPickerVariant;
  /** 可选占位符，默认 "#自定义" */
  placeholder?: string;
}

export function ColorPicker(props: ColorPickerProps) {
  const { value, onChange, variant = 'note', placeholder = '#自定义' } = props;
  const hexErrorId = useId();
  const swatches =
    variant === 'task'
      ? TASK_COLOR_SWATCHES
      : variant === 'group'
        ? GROUP_COLOR_SWATCHES
        : [...DIALOG_COLOR_SWATCHES];

  const normalizedCurrent = normalizeHex(value ?? '');
  const hexError = value && value.trim() !== '' && !normalizedCurrent
    ? '颜色格式无效（例：#5E5CE6）'
    : null;

  return (
    <div className="tl-dialog-color-row">
      <div
        className="tl-dialog-color-grid"
        role="listbox"
        aria-label="颜色预设"
      >
        {swatches.map((c) => {
          const selected = (normalizedCurrent ?? '').toLowerCase() === c.toLowerCase();
          return (
            <button
              key={c}
              type="button"
              className={`tl-dialog-color-btn ${selected ? 'tl-dialog-color-btn--active' : ''}`}
              style={{ background: c }}
              onClick={() => onChange(c)}
              title={c}
              aria-label={`选择颜色 ${c}`}
              aria-selected={selected}
              role="option"
            />
          );
        })}
      </div>
      <input
        className="tl-dialog-input tl-dialog-color-input"
        type="text"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        placeholder={placeholder}
        aria-invalid={hexError ? 'true' : undefined}
        aria-describedby={hexError ? hexErrorId : undefined}
        data-invalid={hexError ? 'true' : undefined}
      />
      {hexError && (
        <span
          id={hexErrorId}
          className="tl-dialog-error tl-dialog-error--inline"
          role="alert"
        >
          {hexError}
        </span>
      )}
    </div>
  );
}

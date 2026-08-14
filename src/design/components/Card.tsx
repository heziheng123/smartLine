import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';

/**
 * 通用卡片 —— 取代 phone.css 里 .phone-card / .phone-section-card /
 * .phone-empty-card / .phone-hero-card / .phone-workload-card /
 * .phone-backlog-card 等多个仅在颜色与微调不同的"近亲"卡片样式。
 *
 * 设计目标：
 * - 100% 沿用现有 .tl-card* 与 .phone-card* 类名（CSS 不破坏）
 * - 在标准模式下使用新 token（--ui-radius-lg / --ui-shadow-subtle / focus ring）
 * - 业务 children 直接注入，不强制重写
 *
 * - variant: 'standard' / 'warning' / 'empty' / 'hero'
 * - tone: 'neutral' | 'warning' | 'danger'
 */
export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  tone?: 'neutral' | 'warning' | 'danger';
  /** 是否禁用内边距（用于嵌入式场景） */
  bare?: boolean;
  /** 透传 style 覆盖（如自定义背景图） */
  style?: CSSProperties;
}

export function Card(props: CardProps) {
  const { tone = 'neutral', bare, className, children, style, ...rest } = props;
  const toneClass =
    tone === 'warning'
      ? 'tl-card--warning'
      : tone === 'danger'
        ? 'tl-card--danger'
        : '';
  return (
    <div
      className={`tl-card ${toneClass} ${bare ? 'tl-card--bare' : ''} ${className ?? ''}`.trim()}
      style={style}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * 通用 IconButton —— 取代 phone.css 里 .phone-icon-button 与
 * desktop 上散落的"36×36 圆角图标按钮"。
 * 关键差异：自动加 --ui-focus-ring（解决建议 #11 焦点环缺失）
 */
export interface IconButtonProps extends HTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  ariaLabel: string;
  tone?: 'neutral' | 'primary' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  type?: 'button' | 'submit';
}

export function IconButton(props: IconButtonProps) {
  const {
    ariaLabel,
    tone = 'neutral',
    size = 'md',
    type = 'button',
    className,
    children,
    ...rest
  } = props;
  return (
    <button
      type={type}
      aria-label={ariaLabel}
      className={`tl-icon-btn tl-icon-btn--${tone} tl-icon-btn--${size} ${className ?? ''}`.trim()}
      {...rest}
    >
      {children}
    </button>
  );
}

/**
 * Tag —— 极简标签/徽章，用于状态、轮次、数量等场景
 */
export interface TagProps extends HTMLAttributes<HTMLSpanElement> {
  children: ReactNode;
  tone?: 'neutral' | 'primary' | 'success' | 'warning' | 'danger';
}

export function Tag(props: TagProps) {
  const { tone = 'neutral', className, children, ...rest } = props;
  return (
    <span
      className={`tl-tag tl-tag--${tone} ${className ?? ''}`.trim()}
      {...rest}
    >
      {children}
    </span>
  );
}

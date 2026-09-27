import type { CSSProperties } from 'react';

export const MIND_MAP_VISUAL_TOKENS = {
  color: {
    canvas: '#f4f5fa',
    surface: '#ffffff',
    surfaceMuted: '#f3f4f8',
    text: '#1e2030',
    textMuted: '#71748a',
    border: 'rgba(35, 38, 70, 0.1)',
    borderStrong: 'rgba(35, 38, 70, 0.18)',
    accent: '#5b5bd6',
    accentInk: '#3f3fb8',
    accentSoft: '#efeffd',
    accentGradient: 'linear-gradient(135deg, #6d6df2 0%, #5b5bd6 55%, #8b5cf6 100%)',
    danger: '#b42318',
    dangerSoft: '#fff1f0',
  },
  radius: {
    control: 10,
    node: 12,
    panel: 16,
  },
  shadow: {
    node: '0 2px 10px rgba(43, 45, 92, 0.08)',
    floating: '0 12px 32px rgba(43, 45, 92, 0.13)',
    modal: '0 24px 64px rgba(43, 45, 92, 0.22)',
  },
  spacing: {
    xs: 4,
    sm: 8,
    md: 12,
    lg: 16,
  },
  typography: {
    ui: 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    sizeSmall: 11,
    sizeUi: 12,
    sizeNode: 15,
  },
  node: {
    minWidth: 112,
    preferredWidth: 172,
    maxWidth: 280,
    paddingX: 14,
    paddingY: 8,
  },
  edge: {
    width: 2,
    arrowSize: 7,
  },
  selection: {
    ringWidth: 1.5,
    handleSize: 7,
  },
  canvas: {
    gridDot: 'rgba(32, 33, 36, 0.09)',
    gridLine: 'rgba(32, 33, 36, 0.06)',
    nodeShadow: 'rgba(27, 31, 39, 0.08)',
    nodeShadowBlur: 8,
    nodeShadowOffsetY: 2,
  },
} as const;

export const mindMapVisualCssVariables = {
  '--mm-canvas': MIND_MAP_VISUAL_TOKENS.color.canvas,
  '--mm-surface': MIND_MAP_VISUAL_TOKENS.color.surface,
  '--mm-surface-muted': MIND_MAP_VISUAL_TOKENS.color.surfaceMuted,
  '--mm-text': MIND_MAP_VISUAL_TOKENS.color.text,
  '--mm-text-muted': MIND_MAP_VISUAL_TOKENS.color.textMuted,
  '--mm-border': MIND_MAP_VISUAL_TOKENS.color.border,
  '--mm-border-strong': MIND_MAP_VISUAL_TOKENS.color.borderStrong,
  '--mm-accent': MIND_MAP_VISUAL_TOKENS.color.accent,
  '--mm-accent-ink': MIND_MAP_VISUAL_TOKENS.color.accentInk,
  '--mm-accent-gradient': MIND_MAP_VISUAL_TOKENS.color.accentGradient,
  '--mm-accent-soft': MIND_MAP_VISUAL_TOKENS.color.accentSoft,
  '--mm-danger': MIND_MAP_VISUAL_TOKENS.color.danger,
  '--mm-danger-soft': MIND_MAP_VISUAL_TOKENS.color.dangerSoft,
  '--mm-radius-control': `${MIND_MAP_VISUAL_TOKENS.radius.control}px`,
  '--mm-radius-node': `${MIND_MAP_VISUAL_TOKENS.radius.node}px`,
  '--mm-radius-panel': `${MIND_MAP_VISUAL_TOKENS.radius.panel}px`,
  '--mm-shadow-node': MIND_MAP_VISUAL_TOKENS.shadow.node,
  '--mm-shadow-floating': MIND_MAP_VISUAL_TOKENS.shadow.floating,
  '--mm-shadow-modal': MIND_MAP_VISUAL_TOKENS.shadow.modal,
  '--mm-space-xs': `${MIND_MAP_VISUAL_TOKENS.spacing.xs}px`,
  '--mm-space-sm': `${MIND_MAP_VISUAL_TOKENS.spacing.sm}px`,
  '--mm-space-md': `${MIND_MAP_VISUAL_TOKENS.spacing.md}px`,
  '--mm-space-lg': `${MIND_MAP_VISUAL_TOKENS.spacing.lg}px`,
  '--mm-font-ui': MIND_MAP_VISUAL_TOKENS.typography.ui,
  '--mm-font-small': `${MIND_MAP_VISUAL_TOKENS.typography.sizeSmall}px`,
  '--mm-font-size': `${MIND_MAP_VISUAL_TOKENS.typography.sizeUi}px`,
} as CSSProperties;

export function mindMapThemeCssVariables(theme: 'light' | 'dark' | 'minimal'): CSSProperties {
  if (theme === 'dark') return {
    '--mm-canvas': '#12131a', '--mm-surface': 'rgba(32,34,45,0.92)', '--mm-surface-muted': '#3a3d4d', '--mm-text': '#f1f2f7', '--mm-text-muted': '#a8adbf', '--mm-border': 'rgba(255,255,255,0.12)', '--mm-border-strong': 'rgba(255,255,255,0.24)', '--mm-accent': '#8b8bf5', '--mm-accent-ink': '#b9b9ff', '--mm-accent-soft': '#2c2c55',
  } as CSSProperties;
  if (theme === 'minimal') return {
    '--mm-canvas': '#ffffff', '--mm-surface': '#ffffff', '--mm-surface-muted': '#fafafa', '--mm-border': 'rgba(32,33,36,0.08)', '--mm-shadow-floating': '0 3px 12px rgba(27,31,39,0.06)',
  } as CSSProperties;
  return {};
}

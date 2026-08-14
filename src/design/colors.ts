/**
 * 中央颜色仓库：
 * - 一份"颜色来源真相"。所有 dialog 共用，不再各自写 PRESET_COLORS。
 * - 二段结构：
 *   1) SEMANTIC_TOKENS  —— 语义色（success/warning/danger/info），由 design-tokens.css 同步维护
 *   2) TIMELINE_COLORS  —— 业务色板（任务 24 色主题），由 timeline-utils 同步导出
 *
 * 若未来需要换色板，只动这里。
 */

import {
  GROUP_COLOR_PRESET,
  MAIN_TASK_THEME_IDX,
  TIMELINE_THEMES,
} from '@/utils/timeline-utils';

/** 语义色（被 design-tokens.css 引用、消费）。保持简洁 8 个。 */
export const SEMANTIC_TOKENS = {
  primary: '#5E5CE6',
  primaryHover: '#4F4DCC',
  primarySoft: '#EFEFFF',
  success: '#10B981',
  warning: '#F59E0B',
  warningSoft: '#FFF7ED',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  info: '#3B82F6',
  neutral: '#6E6E73',
} as const;

/** 业务色板 —— 任务/分组用，原样复用现有实现，避免破坏下游消费。 */
export const TIMELINE_COLORS = {
  themes: TIMELINE_THEMES,
  groupPalette: GROUP_COLOR_PRESET,
  taskBgPalette: TIMELINE_THEMES.map((t) => t.taskBg),
  mainThemeIndex: MAIN_TASK_THEME_IDX,
} as const;

/** 给 dialog 共用的"扁平 hex 色板"（type: 'pin'/'range' 也用同一份）。 */
export const DIALOG_COLOR_SWATCHES = [
  '#FBBF24', '#F59E0B', '#EF4444', '#10B981',
  '#3B82F6', '#8B5CF6', '#EC4899', '#6366F1',
  '#14B8A6', '#22C55E', '#0891B2', '#A855F7',
] as const;

/** 任务/分组详情的色板（24 色，与 tasks 主题对齐）。 */
export const TASK_COLOR_SWATCHES = TIMELINE_THEMES.map((t) => t.taskBg);
export const GROUP_COLOR_SWATCHES = GROUP_COLOR_PRESET;

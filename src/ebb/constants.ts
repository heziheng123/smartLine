// ============================================================
// Ebbinghaus 复习模块 - 常量与默认配置
// ============================================================

import type { ComplexityConfigs, ComplexityLevel, EbbSettings } from './types';

/** 轮次节点 8 色循环（莫兰迪色系） */
export const ROUND_COLORS = [
  '#A8C4D9', // 雾蓝
  '#C4B8D9', // 雾紫
  '#D9B8C4', // 雾粉
  '#B8D9C4', // 雾绿
  '#D9C4B8', // 雾橙
  '#B8C4D9', // 浅蓝
  '#D9D9B8', // 雾黄
  '#C4D9D9', // 雾青
];

/** 热力图 5 档色阶（莫兰迪绿系，由浅到深） */
export const HEATMAP_LEVELS = [
  '#F5F5F7', // 无负载
  '#E8F0E8', // 极低
  '#C8DEC8', // 低
  '#9CC39C', // 中
  '#6BA66B', // 高
  '#4A8A4A', // 极高
];

/** 标签默认色板（自动分配） */
export const TAG_COLOR_PALETTE = [
  '#A8C4D9', '#C4B8D9', '#D9B8C4', '#B8D9C4',
  '#D9C4B8', '#B8C4D9', '#D9D9B8', '#C4D9D9',
  '#E0B8B8', '#B8E0C4',
];

/** 默认复杂度配置 */
export const DEFAULT_COMPLEXITY_CONFIGS: ComplexityConfigs = {
  easy: {
    intervals: [1, 3, 7, 15, 30],
    weights: { 1: 2, 2: 1.5, 3: 1, 4: 0.5, 5: 0.5 },
    label: '🟢 简单',
    color: '#B8D9C4',
  },
  normal: {
    intervals: [1, 2, 4, 7, 15, 30, 60],
    weights: { 1: 5, 2: 4, 3: 3, 4: 2, 5: 1, 6: 1, 7: 0.5 },
    label: '🟡 普通',
    color: '#D9D9B8',
  },
  hard: {
    intervals: [1, 1, 2, 4, 7, 11, 15, 30, 60],
    weights: { 1: 9, 2: 7, 3: 5, 4: 3, 5: 2, 6: 2, 7: 1, 8: 1, 9: 0.5 },
    label: '🔴 困难',
    color: '#E0B8B8',
  },
};

/** 默认全局设置 */
export const DEFAULT_EBB_SETTINGS: EbbSettings = {
  customIntervals: '1, 2, 4, 7, 15',
  dailyTaskLimit: 3,
  dailyPointLimit: 14,
  complexityConfigs: DEFAULT_COMPLEXITY_CONFIGS,
  maxSpreadDays: 14,
  minTopicGapDays: 1,
  autoProcessOverdue: true,
  overdueThreshold: 3,
  maxUndoStack: 10,
  tagColors: {},
  collapsedGroups: [],
  calViewMode: 'month',
  loadThresholds: [2, 4, 6, 9],
};

/** LocalStorage 键 */
export const EBB_STORAGE_KEY = 'smart-ebb-data';
export const EBB_SYNC_SETTINGS_KEY = 'smart-ebb-liveblocks';

/** Ebb 房间前缀 */
export const EBB_ROOM_PREFIX = 'ebb-';

/** 复杂度等级列表（顺序固定） */
export const COMPLEXITY_LEVELS: ComplexityLevel[] = ['easy', 'normal', 'hard'];

/** 默认示例数据：空（避免污染用户首次进入） */
export function getDefaultEbbData() {
  return {
    reviewTasks: [] as ReviewTask[],
    inboxItems: [],
    outlineNodes: [],
    ebbSettings: { ...DEFAULT_EBB_SETTINGS },
  };
}

// 仅为类型闭环引入
import type { ReviewTask } from './types';

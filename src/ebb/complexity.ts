// ============================================================
// Ebbinghaus 复习模块 - 复杂度配置与积分计算
// ============================================================

import type { ComplexityLevel, ComplexityConfig, ComplexityConfigs } from './types';
import { DEFAULT_COMPLEXITY_CONFIGS } from './constants';

/**
 * 获取指定复杂度的配置（支持用户自定义覆盖）
 */
export function getComplexityConfig(
  level: ComplexityLevel,
  customConfigs?: ComplexityConfigs,
): ComplexityConfig {
  const configs = customConfigs ?? DEFAULT_COMPLEXITY_CONFIGS;
  return configs[level] ?? DEFAULT_COMPLEXITY_CONFIGS[level];
}

/**
 * 根据复杂度获取间隔序列
 */
export function getIntervalsForComplexity(
  level: ComplexityLevel,
  customConfigs?: ComplexityConfigs,
): number[] {
  return [...getComplexityConfig(level, customConfigs).intervals];
}

/**
 * 计算指定轮次的积分权重
 * @param round 轮次（从 1 起）
 * @param level 复杂度
 * @param customConfigs 自定义配置
 */
export function getPointWeight(
  round: number,
  level: ComplexityLevel,
  customConfigs?: ComplexityConfigs,
): number {
  const config = getComplexityConfig(level, customConfigs);
  return config.weights[round] ?? 0;
}

/**
 * 解析用户输入的间隔字符串
 * @param text "1, 2, 4, 7, 15"
 * @returns 间隔数组；解析失败返回 null
 */
export function parseIntervals(text: string): number[] | null {
  const parts = text.split(/[,，\s]+/).filter(Boolean);
  if (parts.length === 0) return null;
  const nums: number[] = [];
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (isNaN(n) || n < 1 || n > 1825) return null;
    nums.push(n);
  }
  // 校验非递减
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] < nums[i - 1]) return null;
  }
  return nums;
}

/**
 * 将间隔数组格式化为字符串
 */
export function formatIntervals(intervals: number[]): string {
  return intervals.join(', ');
}

/**
 * 判断用户的间隔是否与复杂度预设一致
 */
export function isDefaultIntervals(
  intervals: number[],
  level: ComplexityLevel,
  customConfigs?: ComplexityConfigs,
): boolean {
  const preset = getIntervalsForComplexity(level, customConfigs);
  if (preset.length !== intervals.length) return false;
  return preset.every((v, i) => v === intervals[i]);
}

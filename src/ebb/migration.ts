// ============================================================
// Ebbinghaus 复习模块 - 旧格式数据迁移工具
// 兼容旧版数据格式（tasks 顶层数组 + 扁平设置字段）
// ============================================================

import type { EbbData, ReviewTask, EbbSettings, InboxItem, StudyOutlineNode } from './types';
import { DEFAULT_EBB_SETTINGS } from './constants';

/** 迁移输入的未知结构数据 */
type UnknownData = Record<string, unknown> | null | undefined;

/**
 * 判断是否为旧格式数据
 * 旧格式特征：存在 tasks 字段但不存在 reviewTasks 字段
 */
function isLegacyFormat(data: UnknownData): boolean {
  return Array.isArray(data?.tasks) && !Array.isArray(data?.reviewTasks);
}

/**
 * 标准化 smStatus 值
 * 将非标准值（estimated/auto_adjusted）转换为标准值
 */
function normalizeSmStatus(status: unknown): ReviewTask['smStatus'] | undefined {
  if (typeof status !== 'string') return undefined;
  if (status === 'scheduled' || status === 'confirmed') {
    return status;
  }
  // estimated / auto_adjusted 等非标准状态 → scheduled
  return 'scheduled';
}

/**
 * 将旧格式任务转换为标准 ReviewTask
 * 过滤掉应用不使用的字段（easinessFactor, quality 等）
 */
function convertLegacyTask(task: unknown): ReviewTask | null {
  if (!task || typeof task !== 'object') return null;
  const t = task as Record<string, unknown>;
  if (typeof t.id !== 'string' || typeof t.topicName !== 'string') {
    return null;
  }
  if (typeof t.dueDate !== 'string' || typeof t.isCompleted !== 'boolean') {
    return null;
  }

  const complexity = t.complexity;
  return {
    id: t.id,
    topicName: t.topicName,
    dueDate: t.dueDate,
    isCompleted: t.isCompleted,
    completedDate: typeof t.completedDate === 'string' ? t.completedDate : undefined,
    tag: typeof t.tag === 'string' ? t.tag : undefined,
    outlineNodeId: typeof t.outlineNodeId === 'string' ? t.outlineNodeId : undefined,
    complexity:
      complexity === 'easy' || complexity === 'normal' || complexity === 'hard'
        ? complexity
        : undefined,
    smStatus: normalizeSmStatus(t.smStatus),
  };
}

/**
 * 将扁平的旧格式设置转换为标准 EbbSettings
 * 旧格式的设置字段散落在顶层，需要提取到 ebbSettings 对象中
 */
function convertLegacySettings(data: UnknownData): EbbSettings {
  const d = (data ?? {}) as Record<string, unknown>;
  const tagColorsUnknown = d.tagColors;
  return {
    ...DEFAULT_EBB_SETTINGS,
    autoProcessOverdue:
      typeof d.autoProcessOverdue === 'boolean'
        ? d.autoProcessOverdue
        : DEFAULT_EBB_SETTINGS.autoProcessOverdue,
    overdueThreshold:
      typeof d.overdueThreshold === 'number'
        ? d.overdueThreshold
        : DEFAULT_EBB_SETTINGS.overdueThreshold,
    tagColors:
      typeof tagColorsUnknown === 'object' && tagColorsUnknown !== null
        ? { ...DEFAULT_EBB_SETTINGS.tagColors, ...(tagColorsUnknown as Record<string, string>) }
        : DEFAULT_EBB_SETTINGS.tagColors,
    maxSpreadDays:
      typeof d.maxSpreadDays === 'number'
        ? d.maxSpreadDays
        : DEFAULT_EBB_SETTINGS.maxSpreadDays,
    minTopicGapDays:
      typeof d.minTopicGapDays === 'number'
        ? d.minTopicGapDays
        : DEFAULT_EBB_SETTINGS.minTopicGapDays,
    maxUndoStack:
      typeof d.maxUndoStack === 'number'
        ? d.maxUndoStack
        : DEFAULT_EBB_SETTINGS.maxUndoStack,
    calViewMode:
      d.calViewMode === 'month' || d.calViewMode === 'week'
        ? d.calViewMode
        : DEFAULT_EBB_SETTINGS.calViewMode,
    collapsedGroups: Array.isArray(d.collapsedGroups)
      ? d.collapsedGroups.filter((g): g is string => typeof g === 'string')
      : DEFAULT_EBB_SETTINGS.collapsedGroups,
    // 以下字段旧格式中不存在，使用默认值：
    // customIntervals, dailyTaskLimit, dailyPointLimit, dailyReviewMinutes, complexityConfigs, loadThresholds
  };
}

/**
 * 迁移旧格式数据到标准格式
 * 支持新旧格式自动识别，非旧格式数据直接透传
 */
export function normalizeLegacyEbbData(data: unknown): EbbData {
  const d = (data ?? null) as UnknownData;
  if (!isLegacyFormat(d)) {
    // 新格式或无法识别，尽量保留原结构
    return {
      reviewTasks: Array.isArray(d?.reviewTasks) ? (d!.reviewTasks as ReviewTask[]) : [],
      inboxItems: Array.isArray(d?.inboxItems) ? (d!.inboxItems as InboxItem[]) : [],
      outlineNodes: Array.isArray(d?.outlineNodes) ? (d!.outlineNodes as StudyOutlineNode[]) : [],
      ebbSettings: { ...DEFAULT_EBB_SETTINGS, ...((d?.ebbSettings as Partial<EbbSettings>) ?? {}) },
    };
  }

  // ── 旧格式转换 ──────────────────────────────────────────

  // 1. 转换任务
  const convertedTasks = (d!.tasks as unknown[])
    .map(convertLegacyTask)
    .filter((t): t is ReviewTask => t !== null);

  // 2. 收集有效的 outlineNodeId（来自 outlineNodes 数组，如果有的话）
  const validNodeIds = new Set<string>();
  if (Array.isArray(d!.outlineNodes)) {
    for (const node of d!.outlineNodes) {
      if (node && typeof node === 'object' && typeof (node as Record<string, unknown>).id === 'string') {
        validNodeIds.add((node as Record<string, unknown>).id as string);
      }
    }
  }

  // 3. 清理无效的 outlineNodeId 引用
  const reviewTasks = convertedTasks.map((task) =>
    task.outlineNodeId && !validNodeIds.has(task.outlineNodeId)
      ? { ...task, outlineNodeId: undefined }
      : task,
  );

  // 4. 转换设置
  const ebbSettings = convertLegacySettings(d);

  // 5. 校验 inboxItems 和 outlineNodes
  const isValidInboxItem = (i: unknown): i is InboxItem => {
    if (!i || typeof i !== 'object') return false;
    const r = i as Record<string, unknown>;
    return typeof r.id === 'string'
      && typeof r.topicName === 'string'
      && (r.status === 'draft' || r.status === 'staged');
  };
  const isValidOutlineNode = (n: unknown): n is StudyOutlineNode =>
    !!n && typeof n === 'object'
    && typeof (n as Record<string, unknown>).id === 'string'
    && typeof (n as Record<string, unknown>).name === 'string'
    && (
      (n as Record<string, unknown>).type === 'book'
      || (n as Record<string, unknown>).type === 'chapter'
      || (n as Record<string, unknown>).type === 'section'
    );

  return {
    reviewTasks,
    inboxItems: Array.isArray(d!.inboxItems) ? (d!.inboxItems as unknown[]).filter(isValidInboxItem) : [],
    outlineNodes: Array.isArray(d!.outlineNodes) ? (d!.outlineNodes as unknown[]).filter(isValidOutlineNode) : [],
    ebbSettings,
  };
}

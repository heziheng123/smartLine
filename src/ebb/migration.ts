// ============================================================
// Ebbinghaus 复习模块 - 旧格式数据迁移工具
// 兼容旧版数据格式（tasks 顶层数组 + 扁平设置字段）
// ============================================================

import type { EbbData, ReviewTask, EbbSettings, InboxItem, StudyOutlineNode } from './types';
import { DEFAULT_EBB_SETTINGS } from './constants';

/**
 * 判断是否为旧格式数据
 * 旧格式特征：存在 tasks 字段但不存在 reviewTasks 字段
 */
function isLegacyFormat(data: any): boolean {
  return Array.isArray(data?.tasks) && !Array.isArray(data?.reviewTasks);
}

/**
 * 标准化 smStatus 值
 * 将非标准值（estimated/auto_adjusted）转换为标准值
 */
function normalizeSmStatus(status: string | undefined): ReviewTask['smStatus'] | undefined {
  if (!status) return undefined;
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
function convertLegacyTask(task: any): ReviewTask | null {
  if (!task || typeof task.id !== 'string' || typeof task.topicName !== 'string') {
    return null;
  }
  if (typeof task.dueDate !== 'string' || typeof task.isCompleted !== 'boolean') {
    return null;
  }

  return {
    id: task.id,
    topicName: task.topicName,
    dueDate: task.dueDate,
    isCompleted: task.isCompleted,
    completedDate: typeof task.completedDate === 'string' ? task.completedDate : undefined,
    tag: typeof task.tag === 'string' ? task.tag : undefined,
    outlineNodeId: typeof task.outlineNodeId === 'string' ? task.outlineNodeId : undefined,
    complexity:
      task.complexity === 'easy' || task.complexity === 'normal' || task.complexity === 'hard'
        ? task.complexity
        : undefined,
    smStatus: normalizeSmStatus(task.smStatus),
  };
}

/**
 * 将扁平的旧格式设置转换为标准 EbbSettings
 * 旧格式的设置字段散落在顶层，需要提取到 ebbSettings 对象中
 */
function convertLegacySettings(data: any): EbbSettings {
  return {
    ...DEFAULT_EBB_SETTINGS,
    autoProcessOverdue:
      typeof data.autoProcessOverdue === 'boolean'
        ? data.autoProcessOverdue
        : DEFAULT_EBB_SETTINGS.autoProcessOverdue,
    overdueThreshold:
      typeof data.overdueThreshold === 'number'
        ? data.overdueThreshold
        : DEFAULT_EBB_SETTINGS.overdueThreshold,
    tagColors:
      typeof data.tagColors === 'object' && data.tagColors !== null
        ? { ...DEFAULT_EBB_SETTINGS.tagColors, ...data.tagColors }
        : DEFAULT_EBB_SETTINGS.tagColors,
    maxSpreadDays:
      typeof data.maxSpreadDays === 'number'
        ? data.maxSpreadDays
        : DEFAULT_EBB_SETTINGS.maxSpreadDays,
    minTopicGapDays:
      typeof data.minTopicGapDays === 'number'
        ? data.minTopicGapDays
        : DEFAULT_EBB_SETTINGS.minTopicGapDays,
    maxUndoStack:
      typeof data.maxUndoStack === 'number'
        ? data.maxUndoStack
        : DEFAULT_EBB_SETTINGS.maxUndoStack,
    calViewMode:
      data.calViewMode === 'month' || data.calViewMode === 'week'
        ? data.calViewMode
        : DEFAULT_EBB_SETTINGS.calViewMode,
    collapsedGroups: Array.isArray(data.collapsedGroups)
      ? data.collapsedGroups.filter((g: any) => typeof g === 'string')
      : DEFAULT_EBB_SETTINGS.collapsedGroups,
    // 以下字段旧格式中不存在，使用默认值：
    // customIntervals, dailyTaskLimit, dailyPointLimit, complexityConfigs, loadThresholds
  };
}

/**
 * 迁移旧格式数据到标准格式
 * 支持新旧格式自动识别，非旧格式数据直接透传
 */
export function normalizeLegacyEbbData(data: any): EbbData {
  if (!isLegacyFormat(data)) {
    // 新格式或无法识别，尽量保留原结构
    return {
      reviewTasks: Array.isArray(data?.reviewTasks) ? data.reviewTasks : [],
      inboxItems: Array.isArray(data?.inboxItems) ? data.inboxItems : [],
      outlineNodes: Array.isArray(data?.outlineNodes) ? data.outlineNodes : [],
      ebbSettings: { ...DEFAULT_EBB_SETTINGS, ...(data?.ebbSettings ?? {}) },
    };
  }

  // ── 旧格式转换 ──────────────────────────────────────────

  // 1. 转换任务
  const convertedTasks = (data.tasks as any[])
    .map(convertLegacyTask)
    .filter((t): t is ReviewTask => t !== null);

  // 2. 收集有效的 outlineNodeId（来自 outlineNodes 数组，如果有的话）
  const validNodeIds = new Set<string>();
  if (Array.isArray(data.outlineNodes)) {
    for (const node of data.outlineNodes) {
      if (typeof node.id === 'string') validNodeIds.add(node.id);
    }
  }

  // 3. 清理无效的 outlineNodeId 引用
  const reviewTasks = convertedTasks.map((task) =>
    task.outlineNodeId && !validNodeIds.has(task.outlineNodeId)
      ? { ...task, outlineNodeId: undefined }
      : task,
  );

  // 4. 转换设置
  const ebbSettings = convertLegacySettings(data);

  // 5. 校验 inboxItems 和 outlineNodes
  const isValidInboxItem = (i: any): i is InboxItem =>
    !!i && typeof i.id === 'string' && typeof i.topicName === 'string'
    && (i.status === 'draft' || i.status === 'staged');
  const isValidOutlineNode = (n: any): n is StudyOutlineNode =>
    !!n && typeof n.id === 'string' && typeof n.name === 'string'
    && (n.type === 'book' || n.type === 'chapter' || n.type === 'section');

  return {
    reviewTasks,
    inboxItems: Array.isArray(data.inboxItems) ? data.inboxItems.filter(isValidInboxItem) : [],
    outlineNodes: Array.isArray(data.outlineNodes) ? data.outlineNodes.filter(isValidOutlineNode) : [],
    ebbSettings,
  };
}

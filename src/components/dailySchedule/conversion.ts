// ============================================================
// 每日任务安排 - 时段↔时间块转换 + 碰撞检测 + 时间工具
// ============================================================

import type {
  TimeBlock,
  ScheduledItem,
  TimeSlot,
  TimeSlotConfig,
} from './types';

// ── 时间工具 ────────────────────────────────────────────────

/** 将 HH:mm 转换为当天的分钟数。无效输入返回 NaN，由调用方自行兜底。 */
export function timeToMinutes(time: string | undefined | null): number {
  if (!time || typeof time !== 'string' || !time.includes(':')) return NaN;
  const [h, m] = time.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
}

/** 将分钟数转换为 HH:mm */
export function minutesToTime(minutes: number): string {
  const clamped = Math.max(0, Math.min(24 * 60, minutes));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 吸附到最近的 15 分钟刻度 */
export function snapToQuarter(minutes: number): number {
  return Math.round(minutes / 15) * 15;
}

/** 计算两个时间之间的时长（分钟） */
export function durationMinutes(start: string, end: string): number {
  return timeToMinutes(end) - timeToMinutes(start);
}

/** 画布参数 */
export const GRID_CONFIG = {
  /** 显示起始小时 */
  startHour: 6,
  /** 显示结束小时 */
  endHour: 24,
  /** 每小时像素高度 */
  hourHeight: 60,
  /** 最小时长（分钟） */
  minDuration: 15,
  /** 最大时长（分钟） */
  maxDuration: 240,
  /** 吸附精度（分钟） */
  snapMinutes: 15,
  /** 时间刻度栏宽度 */
  rulerWidth: 52,
} as const;

/** 计算画布总高度 */
export function gridTotalHeight(): number {
  return (GRID_CONFIG.endHour - GRID_CONFIG.startHour) * GRID_CONFIG.hourHeight;
}

/** 分钟数 → 画布 Y 坐标 */
export function minutesToY(minutes: number): number {
  const offset = minutes - GRID_CONFIG.startHour * 60;
  return (offset / 60) * GRID_CONFIG.hourHeight;
}

/** 画布 Y 坐标 → 分钟数 */
export function yToMinutes(y: number): number {
  const minutes = (y / GRID_CONFIG.hourHeight) * 60 + GRID_CONFIG.startHour * 60;
  return snapToQuarter(minutes);
}

// ── SourceId 解析工具 ────────────────────────────────────────

export type ParsedSourceId =
  | { source: 'review'; reviewId: string }
  | { source: 'project'; parentTaskId: string; line: number; blockId?: never }
  | { source: 'project'; parentTaskId: string; blockId: string; line?: never };

/**
 * 解析 sourceId 格式：
 * - review: `review-{reviewId}`
 * - project (markdown): `project-md:{parentTaskId}-{line}`
 * - project (block): `project-blk:{parentTaskId}-{blockId}`
 * - project (legacy): `project-{parentTaskId}-{line}`（向后兼容）
 */
export function parseSourceId(sourceId: string): ParsedSourceId | null {
  if (sourceId.startsWith('review-')) {
    const reviewId = sourceId.slice(7);
    return reviewId ? { source: 'review', reviewId } : null;
  }

  if (sourceId.startsWith('project-')) {
    const fullId = sourceId.slice(8);

    // 新格式：blk:{taskId}::{blockId} 或旧格式 blk:{taskId}-blk-{xxx}
    if (fullId.startsWith('blk:')) {
      const rest = fullId.slice(4);
      
      // 优先匹配新格式双冒号分隔符
      const doubleColon = rest.indexOf('::');
      if (doubleColon !== -1) {
        const parentTaskId = rest.slice(0, doubleColon);
        const blockId = rest.slice(doubleColon + 2);
        if (!parentTaskId || !blockId) return null;
        return {
          source: 'project',
          parentTaskId,
          blockId,
        };
      }

      // 回退匹配旧格式：寻找 '-blk-' 作为分隔特征
      const blockIdIndex = rest.indexOf('-blk-');
      if (blockIdIndex !== -1) {
        const parentTaskId = rest.slice(0, blockIdIndex);
        const blockId = rest.slice(blockIdIndex + 1);
        if (!parentTaskId || !blockId) return null;
        return {
          source: 'project',
          parentTaskId,
          blockId, // 保留 'blk-' 前缀
        };
      }

      // 最差情况回退（如果有不带 blk- 的旧 blockId）
      const firstDash = rest.indexOf('-');
      if (firstDash === -1) return null;
      const parentTaskId = rest.slice(0, firstDash);
      const blockId = rest.slice(firstDash + 1);
      if (!parentTaskId || !blockId) return null;
      return {
        source: 'project',
        parentTaskId,
        blockId,
      };
    }

    // 新格式：md:{taskId}-{line}
    if (fullId.startsWith('md:')) {
      const rest = fullId.slice(3);
      const lastDash = rest.lastIndexOf('-');
      if (lastDash === -1) return null;
      const parentTaskId = rest.slice(0, lastDash);
      const line = parseInt(rest.slice(lastDash + 1), 10);
      if (!parentTaskId || !Number.isInteger(line) || line < 0) return null;
      return { source: 'project', parentTaskId, line };
    }

    // 旧格式兼容：{taskId}-{line}
    const lastDash = fullId.lastIndexOf('-');
    if (lastDash === -1) return null;
    const parentTaskId = fullId.slice(0, lastDash);
    const line = parseInt(fullId.slice(lastDash + 1), 10);
    if (!parentTaskId || !Number.isInteger(line) || line < 0) return null;
    return { source: 'project', parentTaskId, line };
  }

  return null;
}

// ── 碰撞检测 ────────────────────────────────────────────────

export interface CollisionResult {
  overlap: boolean;
  conflictIds: string[];
}

/** 检查新时间块是否与已有块重叠 */
export function checkCollision(
  blockId: string | null,
  startTime: string,
  endTime: string,
  existingBlocks: TimeBlock[],
): CollisionResult {
  const startMin = timeToMinutes(startTime);
  const endMin = timeToMinutes(endTime);
  const conflictIds: string[] = [];

  for (const block of existingBlocks) {
    if (block.id === blockId) continue; // 排除自身
    const bStart = timeToMinutes(block.startTime);
    const bEnd = timeToMinutes(block.endTime);
    if (startMin < bEnd && endMin > bStart) {
      conflictIds.push(block.id);
    }
  }

  return { overlap: conflictIds.length > 0, conflictIds };
}

// ── 时段 → 时间块 转换 ──────────────────────────────────────

/** 时段 → 起始分钟偏移 */
function slotStartMinute(slot: TimeSlot, configs: TimeSlotConfig[]): number {
  const cfg = configs.find((c) => c.slot === slot);
  return cfg ? cfg.startHour * 60 : 0;
}

/** 将时段模式的 items 转换为时间块 */
export function convertItemsToBlocks(
  items: ScheduledItem[],
  configs: TimeSlotConfig[],
): TimeBlock[] {
  // 按时段分组、按 order 排序
  const slotGroups = new Map<TimeSlot, ScheduledItem[]>();
  for (const item of items) {
    const list = slotGroups.get(item.timeSlot) ?? [];
    list.push(item);
    slotGroups.set(item.timeSlot, list);
  }

  const blocks: TimeBlock[] = [];

  for (const [slot, slotItems] of slotGroups) {
    slotItems.sort((a, b) => a.order - b.order);
    const slotStart = slotStartMinute(slot, configs);
    let cursor = slotStart;

    for (const item of slotItems) {
      const duration = item.duration ?? 30;
      const startTime = minutesToTime(cursor);
      const endTime = minutesToTime(cursor + duration);
      blocks.push({
        id: item.id,
        sourceId: item.sourceId,
        name: item.name,
        source: item.source,
        startTime,
        endTime,
        completed: item.completed,
        completedDate: item.completedDate,
        color: item.color,
        detail: item.detail,
      });
      cursor += duration;
    }
  }

  return blocks;
}

/** 将时间块转换为时段模式的 items */
export function convertBlocksToItems(
  blocks: TimeBlock[],
  configs: TimeSlotConfig[],
): ScheduledItem[] {
  // 按 startTime 排序
  const sorted = [...blocks].sort(
    (a, b) => timeToMinutes(a.startTime) - timeToMinutes(b.startTime),
  );

  const items: ScheduledItem[] = [];

  for (const block of sorted) {
    const startMin = timeToMinutes(block.startTime);
    // 根据开始分钟确定时段
    let slot: TimeSlot = 'morning';
    for (const cfg of configs) {
      if (startMin >= cfg.startHour * 60 && startMin < cfg.endHour * 60) {
        slot = cfg.slot;
        break;
      }
    }

    items.push({
      id: block.id,
      sourceId: block.sourceId,
      name: block.name,
      source: block.source,
      timeSlot: slot,
      order: items.filter((i) => i.timeSlot === slot).length,
      completed: block.completed,
      completedDate: block.completedDate,
      color: block.color,
      detail: block.detail,
    });
  }

  return items;
}

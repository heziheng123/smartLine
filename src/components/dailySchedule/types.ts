// ============================================================
// 每日任务安排 - 类型定义
// ============================================================

/** 时间段类型 */
export type TimeSlot = 'morning' | 'afternoon' | 'evening';

/** 任务来源类型 */
export type TaskSource = 'project' | 'review';

/** 时间段配置 */
export interface TimeSlotConfig {
  slot: TimeSlot;
  label: string;
  icon: string;
  startHour: number;
  endHour: number;
}

/** 安排到时间段的任务条目 */
export interface ScheduledItem {
  /** 唯一ID */
  id: string;
  /** 来源任务ID（项目任务ID 或 复习任务ID） */
  sourceId: string;
  /** 任务名称 */
  name: string;
  /** 来源类型 */
  source: TaskSource;
  /** 所属时间段 */
  timeSlot: TimeSlot;
  /** 排序索引 */
  order: number;
  /** 是否已完成 */
  completed: boolean;
  /** 标签颜色 */
  color?: string;
  /** 预计时长（分钟） */
  duration?: number;
  /** 额外信息（如轮次、所属项目等） */
  detail?: string;
}

/** 时间块（精确到分钟的时间安排） */
export interface TimeBlock {
  /** 唯一ID */
  id: string;
  /** 来源任务ID */
  sourceId: string;
  /** 任务名称 */
  name: string;
  /** 来源类型 */
  source: TaskSource | 'free';
  /** 开始时间（HH:mm 格式，如 "14:00"） */
  startTime: string;
  /** 结束时间（HH:mm 格式，如 "15:30"） */
  endTime: string;
  /** 是否已完成 */
  completed: boolean;
  /** 标签颜色 */
  color?: string;
  /** 额外信息 */
  detail?: string;
}

/** 视图模式 */
export type ScheduleViewMode = 'slots' | 'blocks';

/** 某日的安排数据 */
export interface DaySchedule {
  /** 日期 YYYY-MM-DD */
  date: string;
  /** 时段模式的任务列表 */
  items: ScheduledItem[];
  /** 时间块模式的任务列表 */
  blocks: TimeBlock[];
}

/** 默认时间段配置 */
export const DEFAULT_TIME_SLOT_CONFIGS: TimeSlotConfig[] = [
  { slot: 'morning', label: '上午', icon: '🌅', startHour: 6, endHour: 12 },
  { slot: 'afternoon', label: '下午', icon: '☀️', startHour: 12, endHour: 18 },
  { slot: 'evening', label: '晚上', icon: '🌙', startHour: 18, endHour: 23 },
];

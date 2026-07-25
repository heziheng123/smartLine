// ============================================================
// 每日任务安排 - 类型定义
// ============================================================

/** 时间段类型 */
export type TimeSlot = 'morning' | 'afternoon' | 'evening';

/** 任务来源类型 */
export type TaskSource = 'project' | 'review' | 'free';

/** 时间段配置 */
export interface TimeSlotConfig {
  slot: TimeSlot;
  label: string;
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
  /** @deprecated 状态现在是实时计算派生的，不需要持久化 */
  completed?: boolean;
  /** 生活安排的权威完成日期；项目和复习状态仍从各自源 Store 派生。 */
  completedDate?: string;
  /** 标签颜色 */
  color?: string;
  /** 任务种类颜色（项目标签色 / 复习色），与所属项目颜色相互独立 */
  categoryColor?: string;
  /** 预计时长（分钟） */
  duration?: number;
  /** 额外信息（如轮次、所属项目等） */
  detail?: string;
  /** 数量任务当日实际完成量（仅视图派生，不持久化） */
  quantityActual?: number;
  /** 数量任务当日稳定目标（仅视图派生） */
  quantityTarget?: number;
  quantityTotal?: number;
  quantityCompleted?: number;
  quantityUnit?: string;
  quantityState?: 'unrecorded' | 'in-progress' | 'achieved' | 'recorded';
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
  source: TaskSource;
  /** 开始时间（HH:mm 格式，如 "14:00"） */
  startTime: string;
  /** 结束时间（HH:mm 格式，如 "15:30"） */
  endTime: string;
  /** @deprecated 状态现在是实时计算派生的，不需要持久化 */
  completed?: boolean;
  /** 生活安排的权威完成日期。 */
  completedDate?: string;
  /** 标签颜色 */
  color?: string;
  /** 任务种类颜色（项目标签色 / 复习色），与所属项目颜色相互独立 */
  categoryColor?: string;
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
  { slot: 'morning', label: '上午', startHour: 6, endHour: 12 },
  { slot: 'afternoon', label: '下午', startHour: 12, endHour: 18 },
  { slot: 'evening', label: '晚上', startHour: 18, endHour: 23 },
];

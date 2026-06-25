// ============================================================
// Smart Timeline - 核心类型定义
// ============================================================

/** 任务定义 */
export interface Task {
  id: string;
  name: string;
  start: string; // YYYY-MM-DD
  end: string;   // YYYY-MM-DD
  color?: string;
  isMain?: boolean;       // 是否主线任务（红色高亮，优先显示在第0行）
  completed?: boolean;    // 是否已完成（显示删除线样式）
  notePath?: string;      // 关联笔记路径（网页版为链接或备注）
  groupId?: string;       // 所属分组 ID
}

/** 任务分组 */
export interface TaskGroup {
  id: string;
  name: string;
  start: string;          // 起始日期
  end: string;            // 结束日期
  color?: string;         // 分组颜色
  autoDate?: boolean;     // 是否自动从子任务计算日期范围
  children: Task[];       // 子任务列表
}

/** 便签/笔记 */
export interface Note {
  id: string;
  name: string;           // 便签内容
  date: string;           // 标记日期 YYYY-MM-DD
  endDate?: string;       // 结束日期（范围类型）
  type: 'pin' | 'range';  // pin=单日图钉, range=日期范围
  color?: string;         // 标记颜色（默认琥珀色 #F59E0B）
  notePath?: string;      // 关联笔记路径
}

/** 里程碑 */
export interface Milestone {
  id: string;
  name: string;           // 里程碑名称
  date: string;           // 日期 YYYY-MM-DD
  color?: string;         // 标记颜色
}

/** 完整数据（持久化到 JSON） */
export interface TimelineData {
  tasks: Task[];
  groups: TaskGroup[];
  notes: Note[];
  milestones: Milestone[];
}

/** 经布局计算后的任务，附加行号 */
export interface TaskWithLayout extends Task {
  row: number;
}

/** 布局计算结果 */
export interface LayoutResult {
  tasks: TaskWithLayout[];
  totalRows: number;
}

/** 任务被月份切割后的一个片段 */
export interface TaskSegment {
  taskId: string;
  taskName: string;
  color: string;
  /** 月份 0-11 */
  month: number;
  /** 片段起始日 1-31 */
  startDay: number;
  /** 片段结束日 1-31 */
  endDay: number;
  /** 全局行号（与 TaskWithLayout.row 一致） */
  row: number;
  /** 是否是任务的第一个片段 */
  isStart: boolean;
  /** 是否是任务的最后一个片段 */
  isEnd: boolean;
  /** 是否主线任务 */
  isMain?: boolean;
  /** 是否已完成 */
  completed?: boolean;
  /** 所属分组 ID */
  groupId?: string;
}

/** 便签被月份切割后的片段 */
export interface NoteSegment {
  noteId: string;
  noteName: string;
  color: string;
  type: 'pin' | 'range';
  month: number;
  startDay: number;
  endDay: number;
}

/** 里程碑在月份中的位置 */
export interface MilestoneInMonth {
  milestoneId: string;
  milestoneName: string;
  color: string;
  day: number;
}

/** 分组在月份中的范围 */
export interface GroupRange {
  groupId: string;
  groupName: string;
  color: string;
  startDay: number;
  endDay: number;
  /** 分组内任务的行范围 */
  rowStart: number;
  rowEnd: number;
}

/** 单个月份的布局数据 */
export interface MonthLayout {
  month: number;
  daysInMonth: number;
  segments: TaskSegment[];
  noteSegments: NoteSegment[];
  milestones: MilestoneInMonth[];
  groupRanges: GroupRange[];
  /** 该月最大行号 + 1 */
  totalRows: number;
}

/** 右键菜单项 */
export interface ContextMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  divider?: boolean;
}

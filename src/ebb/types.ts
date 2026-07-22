// ============================================================
// Ebbinghaus 复习模块 - 核心类型定义
// ============================================================

/** 复杂度等级 */
export type ComplexityLevel = 'easy' | 'normal' | 'hard';

/** 调度状态 */
export type SmStatus = 'scheduled' | 'confirmed';

/** 大纲节点类型 */
export type OutlineNodeType = 'book' | 'chapter' | 'section';

/** 收件箱项状态 */
export type InboxStatus = 'draft' | 'staged';

/** 复习任务 */
export interface ReviewTask {
  id: string;
  topicName: string;
  dueDate: string; // YYYY-MM-DD
  /** 首次生成时的计划日期；改期时保留，用于追溯原计划。旧数据缺失时回退到 dueDate。 */
  originalDueDate?: string;
  /**
   * Stable identity of this round within its current review chain.  Unlike
   * dueDate, this value never changes when a round is rescheduled.
   */
  roundOrder?: number;
  isCompleted: boolean;
  completedDate?: string;
  tag?: string;
  outlineNodeId?: string; // 保留以兼容旧版，新版推荐使用 graphNodeId
  graphNodeId?: string;   // 🧠 关联的知识大盘节点 ID
  complexity?: ComplexityLevel;
  smStatus?: SmStatus;
  isArchived?: boolean;   // 是否已归档（冷数据区）
  /** 项目任务完成所触发的计划创建日期，用于避免同节点同日连续消耗轮次。 */
  scheduleCreatedDate?: string;
  scheduleSourceTaskId?: string;
  scheduleSourceBlockId?: string;
  /** 自动完成来源；旧数据或手动完成无需填写。 */
  completionSource?: 'manual' | 'project-task';
  completionSourceTaskId?: string;
  completionSourceBlockId?: string;
  /** 自动完成逾期轮次前，后续轮次的日期快照，用于安全取消完成。 */
  previousSchedule?: Array<{ reviewTaskId: string; dueDate: string }>;
  isSupplemental?: boolean;
}

export interface SyncTaskToEbbPayload {
  action?: 'add' | 'remove' | 'revert-source';
  graphNodeId: string;
  topicName: string;
  triggerSchedule?: boolean;
  sourceTaskId?: string;
  sourceBlockId?: string;
}

/** 收件箱项 */
export interface InboxItem {
  id: string;
  topicName: string;
  tag: string;
  status: InboxStatus;
  intervals?: number[];
  startDate?: string;
  generatedTasks?: ReviewTask[];
  complexity?: ComplexityLevel;
  createdAt: string;
}

/** 大纲节点 */
export interface StudyOutlineNode {
  id: string;
  type: OutlineNodeType;
  name: string;
  parentId: string | null;
  childrenIds: string[];
  orderIndex: number;
  defaultTag?: string;
}

/** 撤销记录 */
export interface UndoEntry {
  id: string;
  type: 'delete_topic' | 'delete_all' | 'delete_node';
  description: string;
  deletedTasks: ReviewTask[];
  deletedNodes?: StudyOutlineNode[];
  timestamp: number;
}

/** 复杂度配置 */
export interface ComplexityConfig {
  intervals: number[];
  weights: Record<number, number>; // round -> weight
  label: string;
  color: string;
}

export type ComplexityConfigs = Record<ComplexityLevel, ComplexityConfig>;

/** 全局设置 */
export interface EbbSettings {
  customIntervals: string; // 默认间隔，逗号分隔
  dailyTaskLimit: number; // 每日任务数上限
  dailyPointLimit: number; // 每日积分上限
  complexityConfigs: ComplexityConfigs;
  maxSpreadDays: number; // 智能分散最大天数
  minTopicGapDays: number; // 同主题最小间隔
  autoProcessOverdue: boolean; // 自动处理逾期
  overdueThreshold: number; // 逾期阈值（天）
  maxUndoStack: number; // 撤销栈最大深度
  tagColors: Record<string, string>; // 标签颜色映射
  collapsedGroups: string[]; // 折叠分组
  calViewMode: 'month' | 'week'; // 日历视图模式
  /** 日历任务量分级阈值（升序，4 个值界定 5 级：≤t1=L1, ≤t2=L2, ≤t3=L3, ≤t4=L4, >t4=L5） */
  loadThresholds: [number, number, number, number];
}

/** Ebb 模块完整数据 */
export interface EbbData {
  reviewTasks: ReviewTask[];
  inboxItems: InboxItem[];
  outlineNodes: StudyOutlineNode[];
  ebbSettings: EbbSettings;
}

/** 计算后的任务（含运行时轮次） */
export interface ReviewTaskWithRound extends ReviewTask {
  round: number;
  totalRounds: number;
  points: number;
}

/** 标签统计 */
export interface TagStat {
  tag: string;
  total: number;
  completed: number;
  pending: number;
  overdue: number;
  ratio: number;
}

/** 主题统计（矩阵视图行） */
export interface TopicStat {
  topicKey: string;
  topicName: string;
  tag?: string;
  complexity?: ComplexityLevel;
  totalRounds: number;
  completedRounds: number;
  pendingRounds: number;
  overdueRounds: number;
  nextDueDate?: string;
  totalPoints: number;
  earnedPoints: number;
  ratio: number;
}

// ============================================================
// Smart Timeline - 核心类型定义
// ============================================================

// ============================================================
// 智能任务块（Smart Task Block）数据模型
// ============================================================

/** 块类型枚举 */
export type BlockType = 'text' | 'smart-task';

/** 纯文本块（普通段落） */
export interface TextBlock {
  type: 'text';
  id: string;
  content: string;
}

/** 智能任务块的 Header（结构化属性区，给系统看） */
export interface SmartTaskHeader {
  /** 任务业务类型；旧数据未设置时视为普通任务 */
  taskKind?: 'standard' | 'vocabulary' | 'quantity';
  title: string;
  tag: string;
  tagColor: string;
  date?: string;          // 📅 计划执行日 YYYY-MM-DD；未设置表示未排期
  deadline?: string;      // 🎯 独立截止日 YYYY-MM-DD
  duration: number;       // ⏳ 预估时长（分钟）
  isCompleted: boolean;
  completedDate?: string;
  recurring?: string;     // 🔁 循环规则
  complexity?: 'easy' | 'normal' | 'hard';
  graphNodeId?: string;   // @deprecated 旧版单节点绑定 ID（向下兼容）
  graphNodeIds?: string[];// 🧠 绑定的多个知识大盘节点 ID
  autoSyncEbb?: boolean;  // 🔄 是否自动同步至 Ebb 复习流
  isArchived?: boolean;   // 🗃️ 是否已归档（冷数据）
  frozenAt?: string;      // 🧊 进入冷冻仓的时间戳
  priority?: 'P0' | 'P1' | 'P2'; // 🚨 优先级
  estimatedTime?: number; // ⏱️ 预估耗时（分钟）
  /** 单词任务的总单词数 */
  vocabularyTotalWords?: number;
  /** 创建单词任务时已经掌握的数量 */
  vocabularyInitialCompletedWords?: number;
  /** 单词任务每日新增学习量，键为 YYYY-MM-DD */
  vocabularyRecords?: Record<string, number>;
  /** 通用数量任务的计量单位，例如“个、题、页、节、章” */
  quantityUnit?: string;
  /** 通用数量任务的目标总量 */
  quantityTotal?: number;
  /** 创建通用数量任务时已经完成的数量 */
  quantityInitialCompleted?: number;
  /** 通用数量任务每日新增完成量，键为 YYYY-MM-DD */
  quantityRecords?: Record<string, number>;
  /** R2附件仅保存引用，不在Liveblocks中保存Base64内容 */
  attachments?: AttachmentReference[];
}

export interface AttachmentReference {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
}

/** 智能任务块（核心：Header + Body 双层结构） */
export interface SmartTaskBlock {
  type: 'smart-task';
  id: string;
  header: SmartTaskHeader;
  body: string;           // 富文本 HTML（contenteditable 编辑）
}

/** 块联合类型 */
export type Block = TextBlock | SmartTaskBlock;

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
  /** 智能任务块数组（新数据载体） */
  blocks: Block[];
  blocksUpdatedAt?: string;   // blocks 上次保存时间（ISO 字符串）
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

/** 智能任务块跨视图拖拽标准数据协议 */
export interface SmartBlockDragPayload {
  type: 'smart-block';
  /** 拖拽来源标识，用于分析和特殊处理 */
  source: 'icebox' | 'week-matrix' | 'timeline' | 'backlog_river' | 'unknown';
  taskId: string;
  blockId: string;
  tag: string;
  title: string;
  /** 原始日期（YYYY-MM-DD），如果是从 Icebox 拖出则为空字符串 */
  fromDate: string;
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

/** 折叠分组在单个月份中的汇总条 */
export interface GroupSummary {
  groupId: string;
  groupName: string;
  color: string;
  taskColor: string;
  startDay: number;
  endDay: number;
  row: number;
  taskCount: number;
  completedCount: number;
}

/** 单个月份的布局数据 */
export interface MonthLayout {
  month: number;
  daysInMonth: number;
  segments: TaskSegment[];
  noteSegments: NoteSegment[];
  milestones: MilestoneInMonth[];
  groupRanges: GroupRange[];
  groupSummaries?: GroupSummary[];
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

/** 聚合后的待办项（从各任务的 Markdown 中提取，扁平化；Obsidian Tasks 兼容协议） */
export interface AggregatedTodo {
  /** 复合 ID：`${parentTaskId}-${line}`，保证全局唯一 */
  id: string;
  /** 待办内容文本 */
  text: string;
  /** 📅 Due date 截止日 YYYY-MM-DD（决定何时出现在 Daily Schedule） */
  due?: string;
  /** ⏳ Scheduled date 计划日 YYYY-MM-DD */
  scheduled?: string;
  /** 🛫 Start date 开始日 YYYY-MM-DD */
  start?: string;
  /** ➕ Created date 创建日 YYYY-MM-DD */
  created?: string;
  /** ✅ Done date 完成日 YYYY-MM-DD */
  doneDate?: string;
  /** 是否已完成 */
  checked: boolean;
  /** 所属大任务 ID */
  parentTaskId: string;
  /** 所属大任务标题（如"备战考研"） */
  parentTaskTitle: string;
  /** 所属大任务颜色（用于卡片左边缘高亮） */
  parentTaskColor?: string;
  /** 所属大任务开始日（用于智能越界校验） */
  parentTaskStart?: string;
  /** 所属大任务截止日（用于智能越界校验） */
  parentTaskEnd?: string;
  /** 🔁 循环规则（如 'every day' / 'every week on Sunday' / 'every 2 weeks when done'） */
  recurring?: string;
  /** 优先级：highest/high/normal/low/lowest（对齐 Obsidian Tasks） */
  priority?: 'highest' | 'high' | 'normal' | 'low' | 'lowest';

  // ── Smart Task Block 扩展字段 ──
  /** 所属 block ID（当来源为 SmartTaskBlock 时） */
  _blockId?: string;
  /** 标签名 */
  _tag?: string;
  /** 标签颜色 */
  _tagColor?: string;
  /** 预估时长（分钟） */
  _duration?: number;
  /** 复杂度 */
  _complexity?: 'easy' | 'normal' | 'hard';
  /** 绑定的知识大盘节点 ID */
  _graphNodeId?: string;
  /** 绑定的多个知识大盘节点 ID */
  _graphNodeIds?: string[];
  /** 是否自动同步至 Ebb 复习流 */
  _autoSyncEbb?: boolean;
  /** 任务业务类型 */
  _taskKind?: 'standard' | 'vocabulary' | 'quantity';
  _vocabularyTotalWords?: number;
  _vocabularyInitialCompletedWords?: number;
  _vocabularyRecords?: Record<string, number>;
  _quantityUnit?: string;
  _quantityTotal?: number;
  _quantityInitialCompleted?: number;
  _quantityRecords?: Record<string, number>;
}

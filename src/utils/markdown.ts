// ============================================================
// Smart Timeline - Markdown 待办解析（Obsidian Tasks 兼容协议）
// 仅保留一次性迁移用到的 extractTodos / parseTodoLine。
// 其他编辑/序列化/渲染函数已随 markdown 待办线一并废弃。
// 协议：
//   📅 Due / ⏳ Scheduled / 🛫 Start / ➕ Created / ✅ Done / ❌ Cancelled / 🔁 Recurring
//   ⏫🔼🔽⏬ 优先级
// ============================================================

// ── 类型 ────────────────────────────────────────────────────

/** 待办项解析结果（Obsidian Tasks 兼容协议） */
export interface TodoItem {
  /** 整行原始文本（不含行尾换行） */
  raw: string;
  /** 是否已完成（[x]） */
  done: boolean;
  /** 待办文本内容（去掉 `- [ ]` 与所有时间标签后） */
  text: string;
  /** 📅 Due date 截止日 YYYY-MM-DD */
  due?: string;
  /** ⏳ Scheduled date 计划日 YYYY-MM-DD */
  scheduled?: string;
  /** 🛫 Start date 开始日 YYYY-MM-DD */
  start?: string;
  /** ➕ Created date 创建日 YYYY-MM-DD */
  created?: string;
  /** ✅ Done date 完成日 YYYY-MM-DD（系统自动追加） */
  doneDate?: string;
  /** ❌ Cancelled date 取消日 YYYY-MM-DD */
  cancelledDate?: string;
  /** 🔁 循环规则（如 'every day' / 'every week on Sunday' / 'every 2 weeks when done'） */
  recurring?: string;
  /** 优先级：highest/high/normal/low/lowest */
  priority?: 'highest' | 'high' | 'normal' | 'low' | 'lowest';
  /** 在原 Markdown 中的行号（从 0 起） */
  line: number;
  /** Emoji 图标（如📖、🔄、☕等，可选） */
  emoji?: string;
  /** 缩进层级（0=顶级，1=一级嵌套，2=二级嵌套...） */
  indent?: number;
  /** 所属分组标题（## 或 ### 标题） */
  group?: string;
  /** 嵌套内容（缩进列表项，不含 checkbox） */
  nestedLines?: string[];
  /** 列表标记（'- ' | '* ' | '+ '），序列化时保留 */
  marker?: string;
}

// ── 协议常量 ────────────────────────────────────────────────

/**
 * 待办行检测正则。
 * 捕获组：1) indentSpace  2) marker  3) doneMark  4) emoji  5) textPart
 */
const TODO_REGEX = /^(\s*)([-*+]\s+)\[( |x|X)\]\s+(📖|🔄|☕|📚|✍️|🎧|🗣️)?\s*(.+?)\s*$/;

// 单标签提取（首次匹配）—— 对齐 Obsidian Tasks 七大标签
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const SCHEDULED_RE = /⏳\s*(\d{4}-\d{2}-\d{2})/;
const START_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/;
const CREATED_RE = /➕\s*(\d{4}-\d{2}-\d{2})/;
const DONE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const CANCELLED_RE = /❌\s*(\d{4}-\d{2}-\d{2})/;
const RECURRING_RE = /🔁\s*(every\s+[a-zA-Z0-9\s,]+)/;

// 优先级标签
const PRIORITY_HIGHEST_RE = /⏫/;
const PRIORITY_HIGH_RE = /🔼/;
const PRIORITY_LOW_RE = /🔽/;
const PRIORITY_LOWEST_RE = /⏬/;
const PRIORITY_TAG_RE = /[⏫🔼🔽⏬]/gu;

// 全局标签清理（剥离文本中的所有标签）
const DUE_TAG_RE = /📅\s*\d{4}-\d{2}-\d{2}/g;
const SCHEDULED_TAG_RE = /⏳\s*\d{4}-\d{2}-\d{2}/g;
const START_TAG_RE = /🛫\s*\d{4}-\d{2}-\d{2}/g;
const CREATED_TAG_RE = /➕\s*\d{4}-\d{2}-\d{2}/g;
const DONE_TAG_RE = /✅\s*\d{4}-\d{2}-\d{2}/g;
const CANCELLED_TAG_RE = /❌\s*\d{4}-\d{2}-\d{2}/g;
const RECURRING_TAG_RE = /🔁\s*every\s+[a-zA-Z0-9\s,]+/g;

// 嵌套列表项
const NESTED_LIST_REGEX = /^(\s{4,})[-*+]\s+(.+)$/;

// 标题行
const HEADER_REGEX = /^#{2,3}\s+(.+)$/;

// ── 内部辅助 ────────────────────────────────────────────────

function matchFirst(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m ? m[1] : undefined;
}

function stripTags(text: string): string {
  return text
    .replace(DUE_TAG_RE, '')
    .replace(SCHEDULED_TAG_RE, '')
    .replace(START_TAG_RE, '')
    .replace(CREATED_TAG_RE, '')
    .replace(DONE_TAG_RE, '')
    .replace(CANCELLED_TAG_RE, '')
    .replace(RECURRING_TAG_RE, '')
    .replace(PRIORITY_TAG_RE, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 解析单行待办为结构化对象。非待办行返回 null。 */
export function parseTodoLine(line: string): TodoItem | null {
  const m = line.match(TODO_REGEX);
  if (!m) return null;
  const [, indentSpace, marker, doneMark, emoji, textPart] = m;

  let priority: TodoItem['priority'] = 'normal';
  if (PRIORITY_HIGHEST_RE.test(textPart)) priority = 'highest';
  else if (PRIORITY_HIGH_RE.test(textPart)) priority = 'high';
  else if (PRIORITY_LOW_RE.test(textPart)) priority = 'low';
  else if (PRIORITY_LOWEST_RE.test(textPart)) priority = 'lowest';

  return {
    raw: line,
    done: doneMark.toLowerCase() === 'x',
    text: stripTags(textPart),
    due: matchFirst(textPart, DUE_RE),
    scheduled: matchFirst(textPart, SCHEDULED_RE),
    start: matchFirst(textPart, START_RE),
    created: matchFirst(textPart, CREATED_RE),
    doneDate: matchFirst(textPart, DONE_RE),
    cancelledDate: matchFirst(textPart, CANCELLED_RE),
    recurring: matchFirst(textPart, RECURRING_RE)?.trim(),
    priority,
    line: -1,
    emoji: emoji || undefined,
    indent: Math.floor(indentSpace.length / 4),
    marker,
    nestedLines: [],
  };
}

// ── 主入口：批量提取 ────────────────────────────────────────

/**
 * 从 Markdown 文本中提取所有待办项。
 * 支持：标题分组、emoji、七标签（📅⏳🛫➕✅❌🔁）、嵌套列表。
 */
export function extractTodos(markdown: string): TodoItem[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const todos: TodoItem[] = [];
  let currentGroup: string | undefined;
  let lastTodoIdx = -1;

  lines.forEach((line, idx) => {
    const headerMatch = line.match(HEADER_REGEX);
    if (headerMatch) {
      currentGroup = headerMatch[1].trim();
      return;
    }

    const parsed = parseTodoLine(line);
    if (parsed) {
      parsed.line = idx;
      parsed.group = currentGroup;
      todos.push(parsed);
      lastTodoIdx = todos.length - 1;
      return;
    }

    const nestedMatch = line.match(NESTED_LIST_REGEX);
    if (nestedMatch && lastTodoIdx >= 0) {
      todos[lastTodoIdx].nestedLines?.push(nestedMatch[2].trim());
      return;
    }

    if (line.trim() !== '') lastTodoIdx = -1;
  });

  return todos;
}

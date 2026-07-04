// ============================================================
// Smart Timeline - Markdown 工具模块（Obsidian Tasks 兼容协议）
// 协议（完全对齐 Obsidian Tasks 插件）：
//   📅 Due date       截止日/到期日（决定任务何时出现在 Daily Schedule）
//   ⏳ Scheduled date 计划开始工作的日期
//   🛫 Start date     开始日期（不能在此日期之前工作）
//   ➕ Created date   创建日期（自动）
//   ✅ Done date      完成日期（自动）
//   ❌ Cancelled date 取消日期（自动）
//   🔁 Recurrence     循环规则（every day / every week on Sunday / every 2 weeks / when done ...）
// 序列化顺序（与 Obsidian Tasks 一致）：🔁 ➕ 🛫 ⏳ 📅 ❌ ✅
// ============================================================

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import dayjs from 'dayjs';
import type { Task } from '@/types';

type PurifyConfig = Parameters<typeof DOMPurify.sanitize>[1];

// ── 类型 ────────────────────────────────────────────────────

/** 待办项解析结果（Obsidian Tasks 兼容协议） */
export interface TodoItem {
  /** 整行原始文本（不含行尾换行） */
  raw: string;
  /** 是否已完成（[x]） */
  done: boolean;
  /** 待办文本内容（去掉 `- [ ]` 与所有时间标签后） */
  text: string;
  /** 📅 Due date 截止日 YYYY-MM-DD（决定何时出现在 Daily Schedule） */
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
  /** 优先级：highest/high/normal/low/lowest（对齐 Obsidian Tasks，normal 为默认不写入文本） */
  priority?: 'highest' | 'high' | 'normal' | 'low' | 'lowest';
  /** 在原 Markdown 中的行号（从 0 起；parseTodoLine 返回 -1，由 extractTodos 填充） */
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

/** 完成率统计结果 */
export interface TodoProgress {
  total: number;
  done: number;
  ratio: number; // 0 ~ 1
}

/** Markdown 分组区块 */
export interface MarkdownSection {
  title: string;
  level: number;
  headerLine: number;
  startLine: number;
  endLine: number;
  content: string;
  todos: TodoItem[];
  _startLineInFullMd?: number;
}

export interface MarkdownSplit {
  beforeHtml: string;
  todos: TodoItem[];
  afterHtml: string;
}

export interface TodoSectionRange {
  headingLine: number;
  sectionEnd: number;
}

// ── 协议常量 ────────────────────────────────────────────────

/**
 * 待办行检测正则（仅用于"是否是待办行"判断，不捕获时间标签）。
 * 时间标签由 parseTodoLine 内部用独立的子正则提取，支持任意顺序。
 *
 * 捕获组：
 *  1) indentSpace  - 行首缩进空白
 *  2) marker       - 列表标记（- / * / + 加空格）
 *  3) doneMark     - ' ' | 'x' | 'X'
 *  4) emoji        - 可选 emoji（📖🔄☕📚✍️🎧🗣️）
 *  5) textPart     - 待办文本（可能含 📅⏳🛫➕✅❌🔁 标签）
 */
export const TODO_REGEX = /^(\s*)([-*+]\s+)\[( |x|X)\]\s+(📖|🔄|☕|📚|✍️|🎧|🗣️)?\s*(.+?)\s*$/;

// 单标签提取（首次匹配）—— 对齐 Obsidian Tasks 七大标签
const DUE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;
const SCHEDULED_RE = /⏳\s*(\d{4}-\d{2}-\d{2})/;
const START_RE = /🛫\s*(\d{4}-\d{2}-\d{2})/;
const CREATED_RE = /➕\s*(\d{4}-\d{2}-\d{2})/;
const DONE_RE = /✅\s*(\d{4}-\d{2}-\d{2})/;
const CANCELLED_RE = /❌\s*(\d{4}-\d{2}-\d{2})/;
// 循环规则：🔁 后跟 "every ..." 直到行尾或下一个 emoji 标签
// 规则内容仅含字母、数字、空格、逗号（覆盖 Obsidian Tasks 所有示例）
const RECURRING_RE = /🔁\s*(every\s+[a-zA-Z0-9\s,]+)/;

// 优先级标签（对齐 Obsidian Tasks）：⏫ 最高 / 🔼 高 / ⏵ 普通（默认，无标签）/ 🔽 低 / ⏬ 最低
// 解析时只识别 ⏫🔼🔽⏬ 四个显式标签；⏵ 不写入文本，仅作默认值
const PRIORITY_HIGHEST_RE = /⏫/;
const PRIORITY_HIGH_RE = /🔼/;
const PRIORITY_LOW_RE = /🔽/;
const PRIORITY_LOWEST_RE = /⏬/;
const PRIORITY_TAG_RE = /[⏫🔼🔽⏬]/gu;

// 全局标签清理（序列化前剥离文本中的所有标签）
const DUE_TAG_RE = /📅\s*\d{4}-\d{2}-\d{2}/g;
const SCHEDULED_TAG_RE = /⏳\s*\d{4}-\d{2}-\d{2}/g;
const START_TAG_RE = /🛫\s*\d{4}-\d{2}-\d{2}/g;
const CREATED_TAG_RE = /➕\s*\d{4}-\d{2}-\d{2}/g;
const DONE_TAG_RE = /✅\s*\d{4}-\d{2}-\d{2}/g;
const CANCELLED_TAG_RE = /❌\s*\d{4}-\d{2}-\d{2}/g;
const RECURRING_TAG_RE = /🔁\s*every\s+[a-zA-Z0-9\s,]+/g;

// 匹配嵌套列表项（缩进的 - 文本，不含 checkbox）
const NESTED_LIST_REGEX = /^(\s{4,})[-*+]\s+(.+)$/;

// 匹配标题行（## 或 ###）
const HEADER_REGEX = /^#{2,3}\s+(.+)$/;

const TODO_HEADING_REGEX = /^##\s+待办(清单|列表)?\s*$/;

// 配置 marked
marked.setOptions({
  gfm: true,
  breaks: true,
});

const PURIFY_CONFIG: PurifyConfig = {
  ALLOWED_TAGS: [
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'p', 'br', 'hr',
    'strong', 'em', 'del', 's', 'mark', 'code', 'pre',
    'blockquote', 'ul', 'ol', 'li',
    'a', 'img',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'input', 'span', 'div',
  ],
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'type', 'checked', 'data-line', 'data-done', 'data-date', 'class'],
  ALLOW_DATA_ATTR: true,
};

// ── 协议层：解析 / 序列化 ───────────────────────────────────

/** 从文本中取第一个匹配的第 1 捕获组 */
function matchFirst(text: string, re: RegExp): string | undefined {
  const m = text.match(re);
  return m ? m[1] : undefined;
}

/** 剥离文本中的所有时间标签，返回纯待办文字 */
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

/**
 * 解析单行待办为结构化对象。仅做语法解析，不设置 line/group/nestedLines。
 * 调用方（如 extractTodos）负责填充上下文字段。
 * 非待办行返回 null。
 */
export function parseTodoLine(line: string): TodoItem | null {
  const m = line.match(TODO_REGEX);
  if (!m) return null;
  const [, indentSpace, marker, doneMark, emoji, textPart] = m;

  // 优先级解析：⏫>🔼>⏵(默认)>🔽>⏬
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

/**
 * 将 TodoItem 序列化回 Markdown 行。
 * 标签顺序对齐 Obsidian Tasks：🔁 ➕ 🛫 ⏳ 📅 ❌ ✅
 */
export function serializeTodoLine(parsed: TodoItem): string {
  const indent = ' '.repeat((parsed.indent ?? 0) * 4);
  const marker = parsed.marker ?? '- ';
  const doneMark = parsed.done ? 'x' : ' ';
  const emoji = parsed.emoji ? `${parsed.emoji} ` : '';

  let line = `${indent}${marker}[${doneMark}] ${emoji}${parsed.text}`;
  // 优先级标签：仅 non-normal 写入；紧贴 text
  if (parsed.priority === 'highest') line += ' ⏫';
  else if (parsed.priority === 'high') line += ' 🔼';
  else if (parsed.priority === 'low') line += ' 🔽';
  else if (parsed.priority === 'lowest') line += ' ⏬';
  if (parsed.recurring) line += ` 🔁 ${parsed.recurring}`;
  if (parsed.created) line += ` ➕ ${parsed.created}`;
  if (parsed.start) line += ` 🛫 ${parsed.start}`;
  if (parsed.scheduled) line += ` ⏳ ${parsed.scheduled}`;
  if (parsed.due) line += ` 📅 ${parsed.due}`;
  if (parsed.cancelledDate) line += ` ❌ ${parsed.cancelledDate}`;
  if (parsed.doneDate) line += ` ✅ ${parsed.doneDate}`;
  return line;
}

// ── 语法迁移 ────────────────────────────────────────────────

/**
 * 将旧语法静默迁移为 Obsidian Tasks 兼容协议。
 * 仅对待办行（`- [ ]` / `- [x]` 开头）执行，普通文本行不动。
 * 幂等：已是新语法的文本不会改变。
 *
 * 迁移规则（多代累积）：
 *   @every-day/week/month → 🔁 every day/week/month
 *   @YYYY-MM-DD           → 📅 YYYY-MM-DD   （最早期单日期格式）
 *   🎯 YYYY-MM-DD         → 📅 YYYY-MM-DD   （v2 自定义 deadline 合并到 due；若已有 📅 则丢弃 🎯）
 *   ✅YYYY-MM-DD          → ✅ YYYY-MM-DD   （规范化空格）
 *   其他 emoji 标签（⏳/🛫/➕/❌/🔁）已是 Obsidian 协议，原样保留
 */
export function migrateTodoSyntax(markdown: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  let changed = false;

  for (let i = 0; i < lines.length; i++) {
    const original = lines[i];
    if (!/^\s*[-*+]\s*\[( |x|X)\]/.test(original)) continue;

    let line = original;

    // 1) 旧循环规则 @every-X → 🔁 every X
    line = line.replace(/@every-(day|week|month)\b/g, (_, r) => `🔁 every ${r}`);

    // 2) v2 自定义 🎯 deadline → 📅 due（若已有 📅 则删除 🎯，避免双 due）
    if (/🎯\s*\d{4}-\d{2}-\d{2}/.test(line)) {
      if (/📅\s*\d{4}-\d{2}-\d{2}/.test(line)) {
        // 已有 due，丢弃 deadline
        line = line.replace(/\s*🎯\s*\d{4}-\d{2}-\d{2}/g, '');
      } else {
        // 无 due，deadline 升级为 due
        line = line.replace(/🎯\s*(\d{4}-\d{2}-\d{2})/g, '📅 $1');
      }
    }

    // 3) ✅ 日期规范化空格
    line = line.replace(/✅\s*(\d{4}-\d{2}-\d{2})/g, '✅ $1');

    // 4) 旧 @YYYY-MM-DD → 📅 YYYY-MM-DD（仅当无 📅 时）
    if (!/📅\s*\d{4}-\d{2}-\d{2}/.test(line)) {
      line = line.replace(/@(\d{4}-\d{2}-\d{2})/g, '📅 $1');
    } else {
      // 已有 📅，删除多余的 @date
      line = line.replace(/\s*@\d{4}-\d{2}-\d{2}/g, '');
    }

    if (line !== original) {
      lines[i] = line;
      changed = true;
    }
  }

  return changed ? lines.join('\n') : markdown;
}

// ── 1. 默认模板生成 ─────────────────────────────────────────

export function generateTaskMarkdown(task: Task): string {
  const today = dayjs().format('YYYY-MM-DD');
  return `# ${task.name}

## 背景

（在此描述任务的目标与背景）

## 待办清单

- [ ] 待办事项 1 📅 ${today}
- [ ] 待办事项 2 📅 ${dayjs().add(7, 'day').format('YYYY-MM-DD')}
- [ ] 待办事项 3

## 备注

- 关键节点、风险点、依赖关系
`;
}

// ── 2. Markdown 分组解析 ────────────────────────────────────

export function splitMarkdownByHeaders(markdown: string): MarkdownSection[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];
  let currentSection: MarkdownSection | null = null;

  lines.forEach((line, idx) => {
    const headerMatch = line.match(HEADER_REGEX);
    if (headerMatch) {
      if (currentSection) {
        currentSection.endLine = idx;
        currentSection.content = lines.slice(currentSection.startLine, idx).join('\n');
        const sectionTodos = extractTodos(currentSection.content);
        const offset = currentSection._startLineInFullMd ?? currentSection.startLine;
        for (const t of sectionTodos) t.line += offset;
        currentSection.todos = sectionTodos;
        sections.push(currentSection);
      }
      const level = line.match(/^#{2}/) ? 2 : 3;
      currentSection = {
        title: headerMatch[1].trim(),
        level,
        headerLine: idx,
        startLine: idx + 1,
        endLine: lines.length,
        content: '',
        todos: [],
        _startLineInFullMd: idx + 1,
      };
      return;
    }
    if (!currentSection) return;
  });

  if (currentSection) {
    currentSection.endLine = lines.length;
    currentSection.content = lines.slice(currentSection.startLine, currentSection.endLine).join('\n');
    const sectionTodos = extractTodos(currentSection.content);
    const offset = currentSection._startLineInFullMd ?? currentSection.startLine;
    for (const t of sectionTodos) t.line += offset;
    currentSection.todos = sectionTodos;
    sections.push(currentSection);
  }

  return sections;
}

// ── 3. 待办解析 ─────────────────────────────────────────────

/**
 * 从 Markdown 文本中提取所有待办项（v2 协议）。
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

// ── 4. 循环规则 ─────────────────────────────────────────────

/** 星期名 → dayjs day() 值（0=周日 ... 6=周六） */
const WEEKDAY_MAP: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

/** 月份名 → 月份序号（1-12） */
const MONTH_MAP: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3,
  april: 4, apr: 4, may: 5, june: 6, jun: 6, july: 7, jul: 7,
  august: 8, aug: 8, september: 9, sep: 9, sept: 9,
  october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
};

/** 解析序数词：1st/2nd/3rd/4th.../last/2nd last */
function parseOrdinal(token: string): number | 'last' | null {
  const m = token.match(/^(\d+)(?:st|nd|rd|th)$/i);
  if (m) return parseInt(m[1], 10);
  if (/^last$/i.test(token)) return 'last';
  return null;
}

/**
 * Obsidian Tasks 兼容的循环日期计算器。
 *
 * 支持的规则（与 Obsidian Tasks 一致）：
 *   every day / every N days
 *   every week / every N weeks
 *   every month / every N months
 *   every year / every N years
 *   every weekday                         （周一到周五）
 *   every week on Sunday                  （每周指定星期）
 *   every week on Monday, Friday          （每周多日，取下一个匹配）
 *   every month on the 1st                （每月第 N 天）
 *   every month on the last               （每月最后一天）
 *   every month on the last Friday        （每月最后一个指定星期）
 *   every January on the 15th             （指定月份的指定日）
 *   ... when done                         （后缀：基于完成日而非原日期递推）
 *
 * @param refDate 参考日期（原任务日期或完成日）
 * @param rule    循环规则字符串
 * @returns 下一次日期 YYYY-MM-DD
 */
export function getNextRecurringDate(refDate: string, rule: string): string {
  const trimmed = rule.trim().toLowerCase();
  // 检测 "when done" 后缀（不影响计算逻辑，参考日期由调用方决定）
  const whenDone = /\bwhen\s+done\b/.test(trimmed);
  const base = trimmed.replace(/\s+when\s+done\b/, '');

  const ref = dayjs(refDate);

  // ── every weekday：周一到周五 ──
  if (base === 'every weekday') {
    let next = ref.add(1, 'day');
    while (next.day() === 0 || next.day() === 6) next = next.add(1, 'day');
    return next.format('YYYY-MM-DD');
  }

  // ── every week on <Day>[, <Day>...] ──
  const weekOnMatch = base.match(/^every\s+week\s+on\s+(.+)$/);
  if (weekOnMatch) {
    const dayNames = weekOnMatch[1].split(',').map((s) => s.trim());
    const targets = dayNames.map((n) => WEEKDAY_MAP[n]).filter((d) => d !== undefined);
    if (targets.length === 0) return ref.add(1, 'week').format('YYYY-MM-DD');
    // 找从 ref+1 起最近的一个匹配星期
    let next = ref.add(1, 'day');
    for (let i = 0; i < 14; i++) {
      if (targets.includes(next.day())) return next.format('YYYY-MM-DD');
      next = next.add(1, 'day');
    }
    return ref.add(1, 'week').format('YYYY-MM-DD');
  }

  // ── every month on the <ordinal> [Weekday] ──
  const monthOnMatch = base.match(/^every\s+month\s+on\s+the\s+(.+)$/);
  if (monthOnMatch) {
    const parts = monthOnMatch[1].trim().split(/\s+/);
    const ord = parseOrdinal(parts[0]);
    // every month on the last [Friday]
    if (ord === 'last') {
      const weekdayName = parts[1];
      const targetDay = weekdayName ? WEEKDAY_MAP[weekdayName] : undefined;
      const nextMonth = ref.add(1, 'month');
      const lastDayOfMonth = nextMonth.endOf('month').date();
      if (targetDay !== undefined) {
        // 从月末往前找指定星期
        let d = nextMonth.endOf('month');
        while (d.day() !== targetDay) d = d.subtract(1, 'day');
        return d.format('YYYY-MM-DD');
      }
      return nextMonth.date(lastDayOfMonth).format('YYYY-MM-DD');
    }
    // every month on the 1st / 2nd / 3rd ...
    if (typeof ord === 'number') {
      const nextMonth = ref.add(1, 'month');
      const daysInMonth = nextMonth.daysInMonth();
      const day = Math.min(ord, daysInMonth);
      return nextMonth.date(day).format('YYYY-MM-DD');
    }
  }

  // ── every <Month> on the <ordinal> ──（如 every January on the 15th）
  const monthNameMatch = base.match(/^every\s+(\w+)\s+on\s+the\s+(.+)$/);
  if (monthNameMatch) {
    const monthIdx = MONTH_MAP[monthNameMatch[1]];
    const ord = parseOrdinal(monthNameMatch[2].trim());
    if (monthIdx && typeof ord === 'number') {
      const year = ref.year() + (monthIdx <= ref.month() + 1 ? 1 : 0);
      return dayjs(`${year}-${String(monthIdx).padStart(2, '0')}-${String(ord).padStart(2, '0')}`).format('YYYY-MM-DD');
    }
  }

  // ── every N <unit>（含 every day = every 1 day）──
  const intervalMatch = base.match(/^every\s+(?:(\d+)\s+)?(day|days|week|weeks|month|months|year|years)$/);
  if (intervalMatch) {
    const n = intervalMatch[1] ? parseInt(intervalMatch[1], 10) : 1;
    const unit = intervalMatch[2].replace(/s$/, '') as 'day' | 'week' | 'month' | 'year';
    return ref.add(n, unit).format('YYYY-MM-DD');
  }

  // ── 兜底：每天 ──
  void whenDone;
  return ref.add(1, 'day').format('YYYY-MM-DD');
}

/** 将循环规则转中文标签 */
export function formatRecurringLabel(rule?: string): string {
  if (!rule) return '';
  const r = rule.trim().toLowerCase();
  const map: Record<string, string> = {
    'every day': '每日',
    'every weekday': '工作日',
    'every week': '每周',
    'every month': '每月',
    'every year': '每年',
  };
  if (map[r]) return map[r];
  // 带修饰的规则：截取关键词
  const everyNMatch = r.match(/^every\s+(\d+)\s+(day|week|month|year)s?$/);
  if (everyNMatch) {
    const n = everyNMatch[1];
    const u = { day: '日', week: '周', month: '月', year: '年' }[everyNMatch[2]] ?? '';
    return `每${n}${u}`;
  }
  if (/when\s+done/.test(r)) return `${formatRecurringLabel(r.replace(/\s*when\s+done/, ''))}(完成时)`;
  return rule;
}

// ── 5. 状态切换 / 字段更新 ──────────────────────────────────

/**
 * 在 Markdown 文本中切换某行待办的完成状态（Obsidian Tasks 兼容协议）。
 *
 * 勾选完成时：
 *   1. 原任务标记为 [x]，追加 ✅ 完成日
 *   2. 若是循环任务（含 🔁 规则），在原任务【上方】插入下一周期的新待办
 *      - 参考日期优先级：due(📅) > scheduled(⏳) > start(🛫)
 *      - "when done" 规则：基于完成日(today)递推，而非原日期
 *      - 多日期保持相对距离（如 scheduled 比 due 早 2 天，新任务也保持早 2 天）
 *      - 新任务自动追加 ➕ 创建日
 *
 * 取消完成时：移除 ✅ 标签（不自动删除已生成的循环副本，防数据丢失）。
 */
export function toggleTodoLine(markdown: string, line: number): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const parsed = parseTodoLine(lines[line]);
  if (!parsed) return markdown;

  parsed.line = line;
  const today = dayjs().format('YYYY-MM-DD');

  if (!parsed.done) {
    // ── 标记完成 ──
    parsed.done = true;
    parsed.doneDate = today;
    lines[line] = serializeTodoLine(parsed);

    // ── 循环任务：在上方生成下一周期 ──
    if (parsed.recurring) {
      // 确定参考日期（优先级 due > scheduled > start）
      const refField: 'due' | 'scheduled' | 'start' | null =
        parsed.due ? 'due' : parsed.scheduled ? 'scheduled' : parsed.start ? 'start' : null;
      if (refField) {
        const refDate = parsed[refField]!;
        const whenDone = /\bwhen\s+done\b/i.test(parsed.recurring);
        const baseRef = whenDone ? today : refDate;
        const nextRef = getNextRecurringDate(baseRef, parsed.recurring);

        // 计算其他日期相对于参考日期的偏移（保持相对距离）
        const offsetDays = (dateStr: string | undefined): number | undefined => {
          if (!dateStr) return undefined;
          return dayjs(dateStr).diff(dayjs(refDate), 'day');
        };
        const applyOffset = (offset: number | undefined): string | undefined => {
          if (offset === undefined) return undefined;
          return dayjs(nextRef).add(offset, 'day').format('YYYY-MM-DD');
        };

        const dueOffset = offsetDays(parsed.due);
        const schedOffset = offsetDays(parsed.scheduled);
        const startOffset = offsetDays(parsed.start);

        const nextParsed: TodoItem = {
          ...parsed,
          done: false,
          doneDate: undefined,
          cancelledDate: undefined,
          // 参考字段用 nextRef，其他字段保持相对偏移
          due: refField === 'due' ? nextRef : applyOffset(dueOffset),
          scheduled: refField === 'scheduled' ? nextRef : applyOffset(schedOffset),
          start: refField === 'start' ? nextRef : applyOffset(startOffset),
          created: today, // 新任务自动追加创建日
          raw: '',
          line: -1,
          nestedLines: [],
        };
        const nextLine = serializeTodoLine(nextParsed);

        // 在原任务上方插入（Obsidian Tasks 默认行为）
        lines.splice(line, 0, nextLine);
      }
    }
  } else {
    // ── 取消完成 ──
    parsed.done = false;
    parsed.doneDate = undefined;
    lines[line] = serializeTodoLine(parsed);
  }

  return lines.join('\n');
}

/**
 * 修改指定行号待办的截止日（📅 Due date）。
 * newDate 为 undefined 时移除标签。
 */
export function changeTodoDue(markdown: string, line: number, newDate?: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const parsed = parseTodoLine(lines[line]);
  if (!parsed) return markdown;

  parsed.due = newDate;
  parsed.line = line;
  lines[line] = serializeTodoLine(parsed);
  return lines.join('\n');
}

/** 修改指定行号待办的计划日（⏳ Scheduled date） */
export function changeTodoScheduled(markdown: string, line: number, newDate?: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const parsed = parseTodoLine(lines[line]);
  if (!parsed) return markdown;

  parsed.scheduled = newDate;
  parsed.line = line;
  lines[line] = serializeTodoLine(parsed);
  return lines.join('\n');
}

/** 修改指定行号待办的开始日（🛫 Start date） */
export function changeTodoStart(markdown: string, line: number, newDate?: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const parsed = parseTodoLine(lines[line]);
  if (!parsed) return markdown;

  parsed.start = newDate;
  parsed.line = line;
  lines[line] = serializeTodoLine(parsed);
  return lines.join('\n');
}

/**
 * 修改指定行号待办的循环规则（🔁）。newRule 为 undefined 时移除（变成普通待办）。
 */
export function changeTodoRecurring(markdown: string, line: number, newRule?: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const parsed = parseTodoLine(lines[line]);
  if (!parsed) return markdown;

  parsed.recurring = newRule;
  parsed.line = line;
  lines[line] = serializeTodoLine(parsed);
  return lines.join('\n');
}

/**
 * 修改指定行号待办的优先级（⏫/🔼/🔽/⏬）。
 * priority 为 'normal' 时移除优先级标签。
 */
export function changeTodoPriority(
  markdown: string,
  line: number,
  priority: TodoItem['priority'],
): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const parsed = parseTodoLine(lines[line]);
  if (!parsed) return markdown;

  parsed.priority = priority;
  parsed.line = line;
  lines[line] = serializeTodoLine(parsed);
  return lines.join('\n');
}

/**
 * 修改指定行号待办的文本内容（保留所有时间标签）。
 */
export function updateTodoText(markdown: string, line: number, newText: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const parsed = parseTodoLine(lines[line]);
  if (!parsed) return markdown;

  const trimmed = newText.trim();
  if (!trimmed) return markdown;

  parsed.text = trimmed;
  parsed.line = line;
  lines[line] = serializeTodoLine(parsed);
  return lines.join('\n');
}

/**
 * 删除指定行号的待办（包括其下方的嵌套列表项）。
 */
export function deleteTodoLine(markdown: string, line: number): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const parsed = parseTodoLine(lines[line]);
  if (!parsed) return markdown;

  lines.splice(line, 1);

  let deleteCount = 0;
  for (let i = line; i < lines.length; i++) {
    if (NESTED_LIST_REGEX.test(lines[i])) deleteCount++;
    else break;
  }
  if (deleteCount > 0) lines.splice(line, deleteCount);

  return lines.join('\n');
}

// ── 6. 完成率统计 ────────────────────────────────────────────

export function computeTodoProgress(markdown: string): TodoProgress {
  const todos = extractTodos(markdown);
  const total = todos.length;
  const done = todos.filter((t) => t.done).length;
  return { total, done, ratio: total === 0 ? 0 : done / total };
}

// ── 7. 智能定位待办清单区域 ─────────────────────────────────

export function findTodoSection(markdown: string): TodoSectionRange {
  if (!markdown) return { headingLine: -1, sectionEnd: -1 };
  const lines = markdown.split(/\r?\n/);

  let headingLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (TODO_HEADING_REGEX.test(lines[i].trim())) {
      headingLine = i;
      break;
    }
  }
  if (headingLine === -1) return { headingLine: -1, sectionEnd: -1 };

  let sectionEnd = lines.length;
  for (let i = headingLine + 1; i < lines.length; i++) {
    if (/^#{1,6}\s+/.test(lines[i].trim())) {
      sectionEnd = i;
      break;
    }
  }
  return { headingLine, sectionEnd };
}

/**
 * 在"待办清单"区域末尾智能追加一条待办。
 * - 如果有待办清单 section：在该 section 内最后一条待办后面追加
 * - 如果没有：在 markdown 末尾创建"## 待办清单"并追加
 */
export function smartAppendTodo(markdown: string, text: string, date?: string): string {
  const trimmed = text.trim();
  if (!trimmed) return markdown;

  const newLine = serializeTodoLine({
    raw: '',
    done: false,
    text: trimmed,
    due: date,
    line: -1,
    marker: '- ',
    indent: 0,
    nestedLines: [],
  });

  const { headingLine, sectionEnd } = findTodoSection(markdown);

  if (headingLine === -1) {
    const heading = '## 待办清单\n\n';
    if (!markdown) return `${heading}${newLine}\n`;
    const suffix = markdown.endsWith('\n') ? '' : '\n';
    return `${markdown}${suffix}\n${heading}${newLine}\n`;
  }

  const lines = markdown.split(/\r?\n/);
  let insertAt = sectionEnd;
  for (let i = sectionEnd - 1; i >= headingLine + 1; i--) {
    if (TODO_REGEX.test(lines[i]) || lines[i].trim() !== '') {
      insertAt = i + 1;
      break;
    }
  }
  if (insertAt === headingLine + 1) {
    for (let i = headingLine + 1; i < sectionEnd; i++) {
      if (TODO_REGEX.test(lines[i])) insertAt = i + 1;
    }
  }

  const newLines = [...lines.slice(0, insertAt), newLine, ...lines.slice(insertAt)];
  return newLines.join('\n');
}

/**
 * 在 Markdown 末尾追加一条待办。返回新的 Markdown。
 */
export function appendTodo(markdown: string, text: string, date?: string): string {
  const trimmed = text.trim();
  if (!trimmed) return markdown;
  const newLine = serializeTodoLine({
    raw: '',
    done: false,
    text: trimmed,
    due: date,
    line: -1,
    marker: '- ',
    indent: 0,
    nestedLines: [],
  });
  if (!markdown) return `## 待办清单\n\n${newLine}\n`;
  const suffix = markdown.endsWith('\n') ? '' : '\n';
  return `${markdown}${suffix}${newLine}\n`;
}

// ── 8. 区间校验 ─────────────────────────────────────────────

/**
 * 判断截止日(due)是否越出父级 Timeline Task 的 [start, end] 区间。
 * 用于智能越界警告。due 缺失时回退到 scheduled/start。
 */
export function isOutOfTaskRange(
  due: string | undefined,
  taskStart: string | undefined,
  taskEnd: string | undefined,
): boolean {
  if (!due) return false;
  const d = dayjs(due);
  if (!d.isValid()) return false;
  if (taskStart && d.isBefore(dayjs(taskStart), 'day')) return true;
  if (taskEnd && d.isAfter(dayjs(taskEnd), 'day')) return true;
  return false;
}

// ── 9. 安全渲染 ─────────────────────────────────────────────

/**
 * 将 Markdown 渲染为已净化的 HTML 字符串（v2 协议）。
 * 待办行渲染为增强 HTML（带 checkbox / emoji / 标签 pill），
 * 其他行交给 marked 处理。
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown) return '';

  const lines = markdown.split(/\r?\n/);
  let currentGroup: string | undefined;

  const preprocessed = lines
    .map((line, idx) => {
      const headerMatch = line.match(HEADER_REGEX);
      if (headerMatch) {
        currentGroup = headerMatch[1].trim();
        return line;
      }

      const parsed = parseTodoLine(line);
      if (!parsed) return line;

      const emojiHtml = parsed.emoji
        ? `<span class="tl-todo-emoji">${parsed.emoji}</span>`
        : '';

      // 日期/标签显示（Obsidian Tasks 协议：📅⏳🛫➕✅❌🔁）
      const tagsHtml: string[] = [];

      // 📅 Due date（含完成时的对照显示）
      if (parsed.due && parsed.doneDate) {
        const due = dayjs(parsed.due);
        const doneDay = dayjs(parsed.doneDate);
        const delayDays = doneDay.diff(due, 'day');
        const delayText = delayDays > 0 ? `(+${delayDays}天)` : '';
        tagsHtml.push(
          `<span class="tl-todo-date-row">` +
            `<span class="tl-todo-date-pill tl-todo-date-pill--plan" data-date="${parsed.due}">📅 ${parsed.due}</span>` +
            `<span class="tl-todo-date-pill tl-todo-date-pill--done" data-date="${parsed.doneDate}">✅ ${parsed.doneDate}${delayText}</span>` +
            `</span>`,
        );
      } else if (parsed.due) {
        const pillClass = isOverdue(parsed.due)
          ? 'tl-todo-date-pill tl-todo-date-pill--overdue'
          : 'tl-todo-date-pill tl-todo-date-pill--plan';
        tagsHtml.push(`<span class="${pillClass}" data-date="${parsed.due}">📅 ${parsed.due}</span>`);
      }

      // ⏳ Scheduled date
      if (parsed.scheduled) {
        tagsHtml.push(`<span class="tl-todo-date-pill tl-todo-date-pill--scheduled" data-date="${parsed.scheduled}">⏳ ${parsed.scheduled}</span>`);
      }
      // 🛫 Start date
      if (parsed.start) {
        tagsHtml.push(`<span class="tl-todo-date-pill tl-todo-date-pill--start" data-date="${parsed.start}">🛫 ${parsed.start}</span>`);
      }
      // ➕ Created date
      if (parsed.created) {
        tagsHtml.push(`<span class="tl-todo-date-pill tl-todo-date-pill--created" data-date="${parsed.created}">➕ ${parsed.created}</span>`);
      }

      if (parsed.recurring) {
        const label = formatRecurringLabel(parsed.recurring);
        tagsHtml.push(`<span class="tl-todo-recurring">🔁 ${label}</span>`);
      }

      const tagsHtmlStr = tagsHtml.join('');

      const indentClass = (parsed.indent ?? 0) > 0 ? `tl-todo-indent--${parsed.indent}` : '';
      const emojiColorClass = parsed.emoji ? `tl-todo-item--${getEmojiColorClass(parsed.emoji)}` : '';

      return `<div class="tl-todo-item ${parsed.done ? 'tl-todo-item--done' : ''} ${indentClass} ${emojiColorClass}" data-line="${idx}" data-done="${parsed.done ? '1' : '0'}" data-group="${currentGroup || ''}">
<div class="tl-todo-item-accent"></div>
<div class="tl-todo-item-body">
<div class="tl-todo-item-header">
<input type="checkbox" class="tl-todo-check" data-line="${idx}" ${parsed.done ? 'checked' : ''} />
${emojiHtml}
<span class="tl-todo-text">${escapeHtml(parsed.text)}</span>
${tagsHtmlStr}
</div>
</div>
</div>`;
    })
    .join('\n');

  const rawHtml = marked.parse(preprocessed, { async: false }) as string;
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG) as string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getEmojiColorClass(emoji: string): string {
  const colorMap: Record<string, string> = {
    '📖': 'new',
    '🔄': 'review',
    '☕': 'rest',
    '📚': 'study',
    '✍️': 'write',
    '🎧': 'listen',
    '🗣️': 'speak',
  };
  return colorMap[emoji] || 'default';
}

// ── 10. 拆分待办区块 ────────────────────────────────────────

export function splitMarkdownAtTodoSection(markdown: string): MarkdownSplit {
  const allTodos = extractTodos(markdown);
  const { headingLine, sectionEnd } = findTodoSection(markdown);

  if (headingLine === -1) {
    return { beforeHtml: renderMarkdown(markdown), todos: [], afterHtml: '' };
  }

  const lines = markdown.split(/\r?\n/);
  const beforeMd = lines.slice(0, headingLine).join('\n');
  const afterMd = lines.slice(sectionEnd).join('\n');
  const sectionTodos = allTodos.filter((t) => t.line >= headingLine && t.line < sectionEnd);

  return {
    beforeHtml: renderMarkdown(beforeMd),
    todos: sectionTodos,
    afterHtml: renderMarkdown(afterMd),
  };
}

// ── 11. 辅助函数 ────────────────────────────────────────────

/**
 * 判断日期是否已过期（早于今天）。
 */
export function isOverdue(dateStr?: string): boolean {
  if (!dateStr) return false;
  const d = dayjs(dateStr);
  if (!d.isValid()) return false;
  return d.isBefore(dayjs().startOf('day'));
}

/**
 * 格式化 ISO 时间戳为本地可读字符串。
 */
export function formatTimestamp(iso?: string): string {
  if (!iso) return '';
  const d = dayjs(iso);
  if (!d.isValid()) return '';
  return d.format('YYYY-MM-DD HH:mm');
}

// ============================================================
// Smart Timeline - Markdown 工具模块
// 提供：默认模板生成 / 待办解析 / 安全渲染 / 完成率统计
// ============================================================

import { marked } from 'marked';
import DOMPurify from 'dompurify';
import dayjs from 'dayjs';
import type { Task } from '@/types';

// 让 DOMPurify 的 sanitize 接收我们的窄配置对象
type PurifyConfig = Parameters<typeof DOMPurify.sanitize>[1];

// ── 类型 ────────────────────────────────────────────────────

/** 待办项解析结果 */
export interface TodoItem {
  /** 整行原始文本（不含行尾换行） */
  raw: string;
  /** 是否已完成 */
  done: boolean;
  /** 待办文本内容（去掉 `- [ ]` 与日期标记后） */
  text: string;
  /** 计划日期 YYYY-MM-DD（⏳标记） */
  planDate?: string;
  /** 完成日期 YYYY-MM-DD（✅标记） */
  doneDate?: string;
  /** 兼容旧格式：单日期（@标记） */
  date?: string;
  /** 在原 Markdown 中的行号（从 0 起） */
  line: number;
  /** Emoji图标（如📖、🔄、☕等） */
  emoji?: string;
  /** 缩进层级（0=顶级，1=一级嵌套，2=二级嵌套...） */
  indent?: number;
  /** 所属分组标题（## 或 ### 标题） */
  group?: string;
  /** 嵌套内容（缩进列表项，不含checkbox） */
  nestedLines?: string[];
}

/** 完成率统计结果 */
export interface TodoProgress {
  total: number;
  done: number;
  ratio: number; // 0 ~ 1
}

/** Markdown分组区块 */
export interface MarkdownSection {
  /** 标题文本（不含##/###） */
  title: string;
  /** 标题级别（2=##，3=###） */
  level: number;
  /** 标题行号（从0起） */
  headerLine: number;
  /** 区块内容行号范围（startLine到endLine-1） */
  startLine: number;
  endLine: number;
  /** 区块内容（不含标题行） */
  content: string;
  /** 区块内的待办项 */
  todos: TodoItem[];
  /** 内部：在完整 markdown 中的起始行号偏移，用于修正 todo.line */
  _startLineInFullMd?: number;
}

// ── 配置 ────────────────────────────────────────────────────

// 匹配待办行（P0升级版，修复版）：
// 支持emoji：📖🔄☕📚✍️🎧🗣️（可选，无重复）
// 支持双日期：⏳YYYY-MM-DD 和 ✅YYYY-MM-DD
// 兼容旧格式：@YYYY-MM-DD
// 支持缩进：任意空白前缀
// 注意：emoji后面可能有空格，文本部分要trim处理
export const TODO_REGEX = /^(\s*)([-*+]\s+)\[( |x|X)\]\s+(📖|🔄|☕|📚|✍️|🎧|🗣️)?\s*(.+?)(?:\s+⏳(\d{4}-\d{2}-\d{2}))?(?:\s+✅(\d{4}-\d{2}-\d{2}))?(?:\s+@(\d{4}-\d{2}-\d{2}))?\s*$/;

// 匹配嵌套列表项（缩进的 - 文本，不含checkbox）
const NESTED_LIST_REGEX = /^(\s{4,})[-*+]\s+(.+)$/;

// 匹配标题行（## 或 ###）
const HEADER_REGEX = /^#{2,3}\s+(.+)$/;

// 配置 marked：关闭 mangle、启用 GFM
marked.setOptions({
  gfm: true,
  breaks: true,
});

// DOMPurify 配置：允许 input/checkbox（用于待办渲染），但限制其他危险标签
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

// ── 1. 默认模板生成 ─────────────────────────────────────────

/**
 * 为任务生成默认 Markdown 模板。
 * 仅在任务 markdown 字段为空且首次打开抽屉时使用。
 */
export function generateTaskMarkdown(task: Task): string {
  const today = dayjs().format('YYYY-MM-DD');

  return `# ${task.name}

## 背景

（在此描述任务的目标与背景）

## 待办清单

- [ ] 待办事项 1 @${today}
- [ ] 待办事项 2 @${dayjs().add(7, 'day').format('YYYY-MM-DD')}
- [ ] 待办事项 3

## 备注

- 关键节点、风险点、依赖关系
`;
}

// ── 1. Markdown分组解析 ─────────────────────────────────────

/**
 * 将 Markdown 按##/###标题分组。
 * 每个分组包含标题和标题下方的所有内容（直到下一个标题为止）。
 */
export function splitMarkdownByHeaders(markdown: string): MarkdownSection[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const sections: MarkdownSection[] = [];

  let currentSection: MarkdownSection | null = null;

  lines.forEach((line, idx) => {
    // 匹配标题行（## 或 ###）
    const headerMatch = line.match(HEADER_REGEX);
    if (headerMatch) {
      // 结束上一个分组
      if (currentSection) {
        currentSection.endLine = idx;
        currentSection.content = lines.slice(currentSection.startLine, idx).join('\n');
        const sectionTodos = extractTodos(currentSection.content);
        // 修正行号：从 section 相对 → 完整 markdown 绝对
        const offset = currentSection._startLineInFullMd ?? currentSection.startLine;
        for (const t of sectionTodos) {
          t.line += offset;
        }
        currentSection.todos = sectionTodos;
        sections.push(currentSection);
      }

      // 开始新分组
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

    // 如果还没有标题，跳过（不分组）
    if (!currentSection) return;
  });

  // 添加最后一个分组
  if (currentSection) {
    currentSection.endLine = lines.length;
    currentSection.content = lines.slice(currentSection.startLine, currentSection.endLine).join('\n');
    const sectionTodos = extractTodos(currentSection.content);
    const offset = currentSection._startLineInFullMd ?? currentSection.startLine;
    for (const t of sectionTodos) {
      t.line += offset;
    }
    currentSection.todos = sectionTodos;
    sections.push(currentSection);
  }

  return sections;
}

// ── 2. 待办解析 ─────────────────────────────────────────────

/**
 * 从 Markdown 文本中提取所有待办项（P0升级版）。
 * 支持：标题分组、emoji识别、双日期、嵌套列表。
 */
export function extractTodos(markdown: string): TodoItem[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const todos: TodoItem[] = [];
  let currentGroup: string | undefined = undefined;
  let lastTodoIdx = -1; // 记录上一个待办的索引（用于收集嵌套列表）

  lines.forEach((line, idx) => {
    // 1. 识别标题行（## 或 ###），更新当前分组
    const headerMatch = line.match(HEADER_REGEX);
    if (headerMatch) {
      currentGroup = headerMatch[1].trim();
      return; // 标题行不是待办，跳过
    }

    // 2. 识别待办行
    const todoMatch = line.match(TODO_REGEX);
    if (todoMatch) {
      const [, indentSpace, , doneMark, emoji, text, planDate, doneDate, oldDate] = todoMatch;
      const indent = Math.floor(indentSpace.length / 4); // 每4个空格为一级缩进

      const todo: TodoItem = {
        raw: line,
        done: doneMark.toLowerCase() === 'x',
        text: text.trim(),
        planDate,
        doneDate,
        date: oldDate, // 兼容旧格式
        line: idx,
        emoji: emoji || undefined,
        indent,
        group: currentGroup,
        nestedLines: [], // 嵌套列表将在后续收集
      };

      todos.push(todo);
      lastTodoIdx = todos.length - 1;
      return;
    }

    // 3. 识别嵌套列表项（缩进的 - 文本）
    const nestedMatch = line.match(NESTED_LIST_REGEX);
    if (nestedMatch && lastTodoIdx >= 0) {
      // 将嵌套内容追加到上一个待办的 nestedLines
      const [, , nestedText] = nestedMatch;
      todos[lastTodoIdx].nestedLines?.push(nestedText.trim());
      return;
    }

    // 4. 非待办行、非标题行、非嵌套列表，重置lastTodoIdx
    if (line.trim() !== '') {
      lastTodoIdx = -1;
    }
  });

  return todos;
}

/**
 * 在 Markdown 文本中切换某行待办的完成状态（P0升级版）。
 * 勾选时自动记录完成日期（✅YYYY-MM-DD）。
 * 返回新的 Markdown 字符串；若行号越界或非待办行，返回原文本。
 */
export function toggleTodoLine(markdown: string, line: number): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const m = lines[line].match(TODO_REGEX);
  if (!m) return markdown;

  const [, indentSpace, prefix, doneMark, emoji, text, planDate, , oldDate] = m;
  const isCurrentlyDone = doneMark.toLowerCase() === 'x';

  // 切换完成状态
  const newDoneMark = isCurrentlyDone ? ' ' : 'x';

  // 构建新行
  let newLine = `${indentSpace}${prefix}[${newDoneMark}] ${emoji || ''}${text}`;

  // 添加计划日期（保持原有）
  if (planDate) {
    newLine += ` ⏳${planDate}`;
  } else if (oldDate) {
    // 兼容旧格式：将@日期转换为⏳日期
    newLine += ` ⏳${oldDate}`;
  }

  // 添加完成日期：勾选时记录当前日期，取消勾选时移除
  if (!isCurrentlyDone) {
    const today = dayjs().format('YYYY-MM-DD');
    newLine += ` ✅${today}`;
  }

  lines[line] = newLine;
  return lines.join('\n');
}

// ── 3. 完成率统计 ────────────────────────────────────────────

export function computeTodoProgress(markdown: string): TodoProgress {
  const todos = extractTodos(markdown);
  const total = todos.length;
  const done = todos.filter((t) => t.done).length;
  return {
    total,
    done,
    ratio: total === 0 ? 0 : done / total,
  };
}

// ── 4. 安全渲染 ─────────────────────────────────────────────

/**
 * 将 Markdown 渲染为已净化的 HTML 字符串（P0升级版）。
 * 支持：emoji醒目渲染、双日期对比、嵌套列表树状渲染。
 * 注意：分组标题由TodoList.tsx组件渲染，这里不处理标题分组。
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown) return '';

  const lines = markdown.split(/\r?\n/);
  let currentGroup: string | undefined = undefined;

  // 1) 预处理：将待办转换为增强HTML（标题行保持原样，让marked处理）
  const preprocessed = lines
    .map((line, idx) => {
      // 识别标题行（## 或 ###），更新currentGroup但不渲染为分组区块
      const headerMatch = line.match(HEADER_REGEX);
      if (headerMatch) {
        currentGroup = headerMatch[1].trim();
        return line; // 保持原样，让marked渲染为普通标题
      }

      // 识别待办行
      const m = line.match(TODO_REGEX);
      if (!m) return line; // 非待办行保持原样

      const [, indentSpace, , doneMark, emoji, text, planDate, doneDate, oldDate] = m;
      const done = doneMark.toLowerCase() === 'x';

      // 构建emoji显示（左侧单独列）
      const emojiHtml = emoji
        ? `<span class="tl-todo-emoji">${emoji}</span>`
        : '';

      // 构建日期显示（双日期对比）
      let dateHtml = '';
      if (planDate && doneDate) {
        // 计算延期天数
        const plan = dayjs(planDate);
        const doneDay = dayjs(doneDate);
        const delayDays = doneDay.diff(plan, 'day');
        const delayText = delayDays > 0 ? `(+${delayDays}天)` : '';

        dateHtml = `<span class="tl-todo-date-row">
<span class="tl-todo-date-pill tl-todo-date-pill--plan" data-date="${planDate}">⏳${planDate}</span>
<span class="tl-todo-date-pill tl-todo-date-pill--done" data-date="${doneDate}">✅${doneDate}${delayText}</span>
</span>`;
      } else if (planDate) {
        // 只有计划日期（未完成）
        const pillClass = isOverdue(planDate) ? 'tl-todo-date-pill tl-todo-date-pill--overdue' : 'tl-todo-date-pill tl-todo-date-pill--plan';
        dateHtml = `<span class="${pillClass}" data-date="${planDate}">⏳${planDate}</span>`;
      } else if (oldDate) {
        // 兼容旧格式：单日期
        const pillClass = done ? 'tl-md-date-pill tl-md-date-pill--done' : (isOverdue(oldDate) ? 'tl-md-date-pill tl-md-date-pill--overdue' : 'tl-md-date-pill tl-md-date-pill--future');
        dateHtml = `<span class="${pillClass}" data-date="${oldDate}">${oldDate}</span>`;
      }

      // 构建待办HTML
      const indentClass = indentSpace.length > 0 ? `tl-todo-indent--${Math.floor(indentSpace.length / 4)}` : '';
      const emojiColorClass = emoji ? `tl-todo-item--${getEmojiColorClass(emoji)}` : '';

      return `<div class="tl-todo-item ${done ? 'tl-todo-item--done' : ''} ${indentClass} ${emojiColorClass}" data-line="${idx}" data-done="${done ? '1' : '0'}" data-group="${currentGroup || ''}">
<div class="tl-todo-item-accent"></div>
<div class="tl-todo-item-body">
<div class="tl-todo-item-header">
<input type="checkbox" class="tl-todo-check" data-line="${idx}" ${done ? 'checked' : ''} />
${emojiHtml}
<span class="tl-todo-text">${text}</span>
${dateHtml}
</div>
</div>
</div>`;
    })
    .join('\n');

  // 2) marked解析（处理标题和普通Markdown）
  const rawHtml = marked.parse(preprocessed, { async: false }) as string;

  // 3) DOMPurify净化
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG) as string;
}

// 根据emoji返回颜色类名
function getEmojiColorClass(emoji: string): string {
  const colorMap: Record<string, string> = {
    '📖': 'new',      // 新课 - 蓝色
    '🔄': 'review',   // 复习 - 绿色
    '☕': 'rest',     // 休息 - 灰色
    '📚': 'study',    // 学习 - 蓝色
    '✍️': 'write',    // 写作 - 紫色
    '🎧': 'listen',   // 听课 - 蓝色
    '🗣️': 'speak',    // 背诵 - 橙色
  };
  return colorMap[emoji] || 'default';
}

// ── 5. 辅助：插入待办行 ─────────────────────────────────────

/**
 * 在 Markdown 末尾追加一条待办。返回新的 Markdown。
 */
export function appendTodo(markdown: string, text: string, date?: string): string {
  const trimmed = text.trim();
  if (!trimmed) return markdown;
  const dateTag = date ? ` @${date}` : '';
  const newLine = `- [ ] ${trimmed}${dateTag}`;
  if (!markdown) return `## 待办清单\n\n${newLine}\n`;
  // 确保末尾有换行
  const suffix = markdown.endsWith('\n') ? '' : '\n';
  return `${markdown}${suffix}${newLine}\n`;
}

/**
 * 修改指定行号待办的日期（P0升级版）。
 * 支持：保持emoji、双日期。
 * 如果 newDate 为 undefined，则移除日期标记（变成未排期）。
 */
export function changeTodoDate(markdown: string, line: number, newDate?: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const m = lines[line].match(TODO_REGEX);
  if (!m) return markdown;

  const [, indentSpace, prefix, doneMark, emoji, text, , doneDate] = m;

  // 构建新行：保持缩进、checkbox、emoji、文本
  let newLine = `${indentSpace}${prefix}[${doneMark}] ${emoji || ''}${text.trim()}`;

  // 添加日期（转换为⏳格式）
  if (newDate) {
    newLine += ` ⏳${newDate}`;
  }

  // 保持完成日期（如果存在）
  if (doneDate) {
    newLine += ` ✅${doneDate}`;
  }

  lines[line] = newLine;
  return lines.join('\n');
}

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

// ── 6. 待办文本编辑 ────────────────────────────────────────

/**
 * 修改指定行号待办的文本内容（P0升级版）。
 * 支持：保持emoji、双日期。
 */
export function updateTodoText(markdown: string, line: number, newText: string): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const m = lines[line].match(TODO_REGEX);
  if (!m) return markdown;

  const [, indentSpace, prefix, doneMark, emoji, , planDate, doneDate, oldDate] = m;
  const trimmed = newText.trim();
  if (!trimmed) return markdown;

  // 构建新行：保持缩进、checkbox、emoji
  let newLine = `${indentSpace}${prefix}[${doneMark}] ${emoji || ''}${trimmed}`;

  // 保持日期
  if (planDate) {
    newLine += ` ⏳${planDate}`;
  } else if (oldDate) {
    // 兼容旧格式：将@日期转换为⏳日期
    newLine += ` ⏳${oldDate}`;
  }

  if (doneDate) {
    newLine += ` ✅${doneDate}`;
  }

  lines[line] = newLine;
  return lines.join('\n');
}

/**
 * 删除指定行号的待办（包括其下方的嵌套列表项）。
 * 返回新的 Markdown。
 */
export function deleteTodoLine(markdown: string, line: number): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const m = lines[line].match(TODO_REGEX);
  if (!m) return markdown;

  // 删除待办行本身
  lines.splice(line, 1);

  // 删除紧跟其后的嵌套列表项（缩进>=4个空格的 - 文本）
  let deleteCount = 0;
  for (let i = line; i < lines.length; i++) {
    const nestedMatch = lines[i].match(NESTED_LIST_REGEX);
    if (nestedMatch) {
      deleteCount++;
    } else {
      break; // 遇到非嵌套列表项，停止删除
    }
  }

  if (deleteCount > 0) {
    lines.splice(line, deleteCount);
  }

  return lines.join('\n');
}

// ── 7. 智能定位待办清单区域 ─────────────────────────────────

/**
 * 查找"## 待办清单"（或同义标题）的位置，返回该标题行号以及该 section 结束行号。
 * 如果没找到，返回 { headingLine: -1, sectionEnd: -1 }。
 */
export interface TodoSectionRange {
  headingLine: number;
  sectionEnd: number;
}

const TODO_HEADING_REGEX = /^##\s+待办(清单|列表)?\s*$/;

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
 * 返回新的 Markdown。
 */
export function smartAppendTodo(markdown: string, text: string, date?: string): string {
  const trimmed = text.trim();
  if (!trimmed) return markdown;

  const dateTag = date ? ` @${date}` : '';
  const newTodoLine = `- [ ] ${trimmed}${dateTag}`;

  const { headingLine, sectionEnd } = findTodoSection(markdown);

  if (headingLine === -1) {
    const heading = '## 待办清单\n\n';
    if (!markdown) return `${heading}${newTodoLine}\n`;
    const suffix = markdown.endsWith('\n') ? '' : '\n';
    return `${markdown}${suffix}\n${heading}${newTodoLine}\n`;
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
      if (TODO_REGEX.test(lines[i])) {
        insertAt = i + 1;
      }
    }
  }

  const newLines = [
    ...lines.slice(0, insertAt),
    newTodoLine,
    ...lines.slice(insertAt),
  ];
  return newLines.join('\n');
}

/**
 * 将 markdown 拆分为三段：待办清单之前的 HTML（渲染后）、待办项数组、待办清单之后的 HTML（渲染后）。
 * 用于在预览模式下用 React 组件替换待办清单区域。
 */
export interface MarkdownSplit {
  beforeHtml: string;
  todos: TodoItem[];
  afterHtml: string;
}

export function splitMarkdownAtTodoSection(markdown: string): MarkdownSplit {
  const allTodos = extractTodos(markdown);
  const { headingLine, sectionEnd } = findTodoSection(markdown);

  if (headingLine === -1) {
    return {
      beforeHtml: renderMarkdown(markdown),
      todos: [],
      afterHtml: '',
    };
  }

  const lines = markdown.split(/\r?\n/);
  const beforeLines = lines.slice(0, headingLine);
  const afterLines = lines.slice(sectionEnd);

  const beforeMd = beforeLines.join('\n');
  const afterMd = afterLines.join('\n');

  const sectionTodos = allTodos.filter(
    (t) => t.line >= headingLine && t.line < sectionEnd
  );

  return {
    beforeHtml: renderMarkdown(beforeMd),
    todos: sectionTodos,
    afterHtml: renderMarkdown(afterMd),
  };
}

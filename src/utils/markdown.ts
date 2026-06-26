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
  /** 日期 YYYY-MM-DD（可能为空） */
  date?: string;
  /** 在原 Markdown 中的行号（从 0 起） */
  line: number;
}

/** 完成率统计结果 */
export interface TodoProgress {
  total: number;
  done: number;
  ratio: number; // 0 ~ 1
}

// ── 配置 ────────────────────────────────────────────────────

// 匹配 `- [ ] 文本 @YYYY-MM-DD` 或 `- [x] 文本`，支持任意空白与缩进
const TODO_REGEX = /^(\s*[-*+]\s+)\[( |x|X)\]\s+(.+?)(?:\s+@(\d{4}-\d{2}-\d{2}))?\s*$/;

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
  ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'type', 'disabled', 'checked', 'data-line', 'data-done', 'data-date', 'class'],
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

// ── 2. 待办解析 ─────────────────────────────────────────────

/**
 * 从 Markdown 文本中提取所有待办项。
 * 兼容 `- [ ]` / `- [x]` / `* [X]` 等变体。
 */
export function extractTodos(markdown: string): TodoItem[] {
  if (!markdown) return [];
  const lines = markdown.split(/\r?\n/);
  const todos: TodoItem[] = [];

  lines.forEach((line, idx) => {
    const m = line.match(TODO_REGEX);
    if (!m) return;
    const [, , doneMark, text, date] = m;
    todos.push({
      raw: line,
      done: doneMark.toLowerCase() === 'x',
      text: text.trim(),
      date,
      line: idx,
    });
  });

  return todos;
}

/**
 * 在 Markdown 文本中切换某行待办的完成状态。
 * 返回新的 Markdown 字符串；若行号越界或非待办行，返回原文本。
 */
export function toggleTodoLine(markdown: string, line: number): string {
  if (!markdown) return markdown;
  const lines = markdown.split(/\r?\n/);
  if (line < 0 || line >= lines.length) return markdown;

  const m = lines[line].match(TODO_REGEX);
  if (!m) return markdown;

  const [, prefix, doneMark, text, date] = m;
  const newDone = doneMark.toLowerCase() === 'x' ? ' ' : 'x';
  const dateTag = date ? ` @${date}` : '';
  lines[line] = `${prefix}[${newDone}] ${text}${dateTag}`;
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
 * 将 Markdown 渲染为已净化的 HTML 字符串。
 * 待办项会被增强为带 data-* 属性的可点击 checkbox。
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown) return '';

  // 1) 先抽出待办行，替换为带 data-line 的占位 checkbox HTML
  //    这样 marked 不会把 `[ ]` 当普通文本
  const lines = markdown.split(/\r?\n/);
  const preprocessed = lines
    .map((line, idx) => {
      const m = line.match(TODO_REGEX);
      if (!m) return line;
      const [, prefix, doneMark, text, date] = m;
      const done = doneMark.toLowerCase() === 'x';
      const dateAttr = date ? ` data-date="${date}"` : '';
      // 日期胶囊按状态着色：done → 绿；overdue → 红；未来 → 灰
      let pillClass = 'tl-md-date-pill tl-md-date-pill--future';
      if (done) {
        pillClass = 'tl-md-date-pill tl-md-date-pill--done';
      } else if (date && isOverdue(date)) {
        pillClass = 'tl-md-date-pill tl-md-date-pill--overdue';
      }
      const datePill = date
        ? ` <span class="${pillClass}" data-date="${date}">${date}</span>`
        : '';
      return `${prefix}<input type="checkbox" class="tl-md-todo-check" data-line="${idx}" data-done="${done ? '1' : '0'}"${dateAttr} ${done ? 'checked' : ''} /> ${text}${datePill}`;
    })
    .join('\n');

  // 2) marked 解析
  const rawHtml = marked.parse(preprocessed, { async: false }) as string;

  // 3) DOMPurify 净化
  return DOMPurify.sanitize(rawHtml, PURIFY_CONFIG) as string;
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

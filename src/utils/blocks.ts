// ============================================================
// 智能任务块工具模块
// Block 数据的 CRUD / 迁移 / 查询
// ============================================================

import type { Block, SmartTaskBlock, SmartTaskHeader, Task } from '@/types';
import { isContinuousTask, requiresTaskStartDate } from '@/domain/taskRules';
import { extractTodos, type TodoItem } from './markdown';
import { diffDays } from './dateSafe';

// ── ID 生成 ────────────────────────────────────────────────

export function genBlockId(): string {
  // The previous time + per-tab counter could collide when two browser tabs
  // created a block in the same millisecond. UUIDs keep IDs unique across
  // tabs and devices while preserving the existing `blk-` source-id prefix.
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return `blk-${uuid}`;
  return `blk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// ── 默认标签颜色（莫兰迪色系）───────────────────────────────

export const DEFAULT_TAG_COLORS: Record<string, string> = {
  '看课': '#FECDD3',   // 粉色系
  '做题': '#BFDBFE',   // 蓝色系
  '复习': '#FDE68A',   // 黄色系
  '背诵': '#D9F993',   // 绿色系
  '写作': '#DDD6FE',   // 紫色系
  '阅读': '#A5F3FC',   // 青色系
  '实操': '#BBF7D0',   // 亮绿系
};

export const DEFAULT_TAGS = Object.keys(DEFAULT_TAG_COLORS);

const TAG_COLOR_PALETTE = [
  '#FECDD3', '#BFDBFE', '#FDE68A', '#D9F993', '#DDD6FE',
  '#FBCFE8', '#A5F3FC', '#FED7AA', '#BBF7D0', '#C7D2FE',
];

export function getTagColor(tag: string, existingMap?: Record<string, string>): string {
  if (existingMap && existingMap[tag]) return existingMap[tag];
  if (DEFAULT_TAG_COLORS[tag]) return DEFAULT_TAG_COLORS[tag];
  // 根据字符串 hash 分配色板
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return TAG_COLOR_PALETTE[Math.abs(hash) % TAG_COLOR_PALETTE.length];
}

// ── 获取有效的图谱节点 IDs (防脏数据处理) ─────────────────────────────────
export function getValidGraphNodeIds(header: Partial<SmartTaskHeader> | undefined | null): string[] {
  if (!header) return [];
  const ids = header.graphNodeIds as unknown;
  if (Array.isArray(ids)) {
    return ids;
  }
  if (typeof ids === 'string' && ids.trim() !== '') {
    return [ids];
  }
  const id = header.graphNodeId;
  if (typeof id === 'string' && id.trim() !== '') {
    return [id];
  }
  return [];
}

/** Auto-sync is enabled by default and is disabled only by an explicit false. */
export function shouldAutoSyncEbb(header: Partial<SmartTaskHeader> | undefined | null): boolean {
  return header?.autoSyncEbb !== false;
}

export function isVocabularyTask(header: Partial<SmartTaskHeader> | undefined | null): boolean {
  return header?.taskKind === 'vocabulary';
}

/**
 * 数量任务统一入口。旧版 vocabulary 数据也属于数量任务，确保升级后无需迁移。
 */
export function isQuantityTask(header: Partial<SmartTaskHeader> | undefined | null): boolean {
  return isContinuousTask(header);
}

/** Common quick choices used by task creation and duration editors. */
export const TASK_DURATION_OPTIONS = [10, 15, 30, 45, 60, 90] as const;

/**
 * Returns a schedulable duration in five-minute units. Legacy quantity tasks
 * stored zero minutes, so invalid or missing values intentionally fall back to
 * 30 minutes until the user chooses an explicit daily investment.
 */
export function getTaskEstimatedMinutes(
  header: Partial<SmartTaskHeader> | undefined | null,
  fallback = 30,
): number {
  const value = Number(header?.duration);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.max(5, Math.ceil(value / 5) * 5);
}

export { requiresTaskStartDate } from '@/domain/taskRules';

/**
 * Repairs legacy quantity/vocabulary tasks whose start date was cleared by an
 * older editor. A recorded progress date is the strongest available signal;
 * otherwise the parent project's start date is the safest deterministic
 * fallback. The deadline is used only when the project starts after it.
 */
export function recoverRequiredTaskStartDate(
  header: Partial<SmartTaskHeader> | undefined | null,
  projectStart: string,
): string | undefined {
  if (!requiresTaskStartDate(header)) return header?.date;
  if (header?.date) return header.date;

  const recordDates = Object.keys(getQuantityRecords(header))
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort();
  if (recordDates[0]) return recordDates[0];
  if (header?.deadline && projectStart > header.deadline) return header.deadline;
  return projectStart || header?.deadline;
}

export function getQuantityUnit(header: Partial<SmartTaskHeader> | undefined | null): string {
  if (!isQuantityTask(header)) return '';
  const unit = header?.quantityUnit?.trim();
  return unit || '个';
}

export function getQuantityRecords(
  header: Partial<SmartTaskHeader> | undefined | null,
): Record<string, number> {
  if (!isQuantityTask(header)) return {};
  return header?.taskKind === 'quantity'
    ? (header.quantityRecords ?? {})
    : (header?.vocabularyRecords ?? {});
}

export function getQuantityInitialCompleted(
  header: Partial<SmartTaskHeader> | undefined | null,
): number {
  if (!isQuantityTask(header)) return 0;
  const value = header?.taskKind === 'quantity'
    ? header.quantityInitialCompleted
    : header?.vocabularyInitialCompletedWords;
  return Number.isInteger(value) ? Math.max(0, value!) : 0;
}

export function getQuantityCompleted(header: Partial<SmartTaskHeader> | undefined | null): number {
  if (!isQuantityTask(header)) return 0;
  return getQuantityInitialCompleted(header) + Object.values(getQuantityRecords(header)).reduce(
    (sum, value) => sum + (Number.isInteger(value) && value > 0 ? value : 0),
    0,
  );
}

export function getQuantityCompletedBeforeDate(
  header: Partial<SmartTaskHeader> | undefined | null,
  date: string,
): number {
  if (!isQuantityTask(header)) return 0;
  return getQuantityInitialCompleted(header) + Object.entries(getQuantityRecords(header)).reduce(
    (sum, [recordDate, value]) => sum + (recordDate < date && Number.isInteger(value) && value > 0 ? value : 0),
    0,
  );
}

export function getQuantityProgressPercent(header: Partial<SmartTaskHeader> | undefined | null): number {
  const total = getQuantityTotal(header);
  return total > 0 ? Math.min(100, Math.round((getQuantityCompleted(header) / total) * 100)) : 0;
}

export function getQuantityTotal(header: Partial<SmartTaskHeader> | undefined | null): number {
  if (!isQuantityTask(header)) return 0;
  const value = header?.taskKind === 'quantity'
    ? header.quantityTotal
    : header?.vocabularyTotalWords;
  return Number.isInteger(value) && value! > 0 ? value! : 0;
}

export interface QuantityDailySuggestion {
  remaining: number;
  daysRemaining: number;
  suggested: number;
  overdue: boolean;
}

export type QuantityDailyState = 'unrecorded' | 'in-progress' | 'achieved' | 'recorded';

export interface QuantityDailyStatus {
  actual: number;
  target?: number;
  state: QuantityDailyState;
  remainingToTarget: number;
}

/**
 * 用当天开始前的剩余量均摊到截止日，因此当天录入进度时目标不会跳动；
 * 下一天会根据真实完成量重新计算。截止日当天仍算 1 个可执行日，
 * 逾期后建议一次完成全部剩余量。没有截止日期时返回 null。
 */
export function getQuantityDailySuggestion(
  header: Partial<SmartTaskHeader> | undefined | null,
  date: string,
): QuantityDailySuggestion | null {
  if (!isQuantityTask(header) || !header?.deadline) return null;
  if (header.date && date < header.date) return null;
  const remaining = Math.max(0, getQuantityTotal(header) - getQuantityCompletedBeforeDate(header, date));
  const rawDays = diffDays(header.deadline, date);
  const overdue = rawDays < 0;
  const daysRemaining = Math.max(0, rawDays);
  const divisor = Math.max(1, rawDays + 1);
  return {
    remaining,
    daysRemaining,
    suggested: remaining > 0 ? Math.ceil(remaining / divisor) : 0,
    overdue,
  };
}

export function getQuantityDailyStatus(
  header: Partial<SmartTaskHeader> | undefined | null,
  date: string,
): QuantityDailyStatus {
  const actual = getQuantityRecords(header)[date] ?? 0;
  const suggestion = getQuantityDailySuggestion(header, date);
  if (!suggestion) return { actual, state: actual > 0 ? 'recorded' : 'unrecorded', remainingToTarget: 0 };
  const target = Math.min(suggestion.remaining, suggestion.suggested);
  if (actual <= 0) return { actual, target, state: 'unrecorded', remainingToTarget: target };
  return {
    actual,
    target,
    state: actual >= target ? 'achieved' : 'in-progress',
    remainingToTarget: Math.max(0, target - actual),
  };
}

export function getVocabularyLearnedWords(header: Partial<SmartTaskHeader> | undefined | null): number {
  return isVocabularyTask(header) ? getQuantityCompleted(header) : 0;
}

export function getVocabularyTotalWords(header: Partial<SmartTaskHeader> | undefined | null): number {
  return isVocabularyTask(header) ? getQuantityTotal(header) : 0;
}

// ── Markdown → Blocks 迁移 ─────────────────────────────────

/**
 * 将旧 Task.markdown 迁移为 blocks 数组。
 * 策略：
 *   - 每个 `- [ ]` / `- [x]` 待办行 → SmartTaskBlock
 *   - 非待办文本行合并为 TextBlock（连续非待办行合并为一个 TextBlock）
 *   - 待办行之间的嵌套列表项 → 归入上方 SmartTaskBlock 的 body
 *   - 若 markdown 为空，返回单个 TextBlock 占位
 */
export function migrateMarkdownToBlocks(task: Task, tagColorMap?: Record<string, string>): Block[] {
  // 一次性迁移：从历史 markdown 字段（已从类型移除）解析
  const md = (task as Task & { markdown?: string }).markdown?.trim();
  if (!md) {
    return [{ type: 'text', id: genBlockId(), content: '' }];
  }

  const lines = md.split(/\r?\n/);
  const blocks: Block[] = [];
  let pendingTextLines: string[] = [];
  let pendingNestedLines: string[] = [];
  let lastTaskBlock: SmartTaskBlock | null = null;

  const flushText = () => {
    if (pendingTextLines.length > 0) {
      blocks.push({
        type: 'text',
        id: genBlockId(),
        content: pendingTextLines.join('\n'),
      });
      pendingTextLines = [];
    }
  };

  const flushNested = () => {
    if (lastTaskBlock && pendingNestedLines.length > 0) {
      lastTaskBlock.body = pendingNestedLines.map(l => `<p>${escapeHtml(l.replace(/^\s+/, ''))}</p>`).join('');
      pendingNestedLines = [];
    }
  };

  // 提取所有待办行用于映射
  const todos = extractTodos(md);
  const todoByLine = new Map<number, TodoItem>();
  for (const t of todos) {
    todoByLine.set(t.line, t);
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const todo = todoByLine.get(i);

    if (todo) {
      flushText();
      flushNested();

      // 推断标签：从 text 中提取 #xxx 或使用默认
      const tagMatch = todo.text.match(/#(\S+)/);
      const tag = tagMatch ? tagMatch[1] : '默认';
      const cleanTitle = todo.text.replace(/#\S+/g, '').trim();

      const taskBlock: SmartTaskBlock = {
        type: 'smart-task',
        id: genBlockId(),
        header: {
          title: cleanTitle || todo.text,
          tag,
          tagColor: getTagColor(tag, tagColorMap),
          date: todo.scheduled || todo.due || task.start,
          deadline: todo.due,
          duration: 30,
          isCompleted: todo.done,
          completedDate: todo.doneDate,
          recurring: todo.recurring,
          complexity: 'normal',
          autoSyncEbb: true,
        },
        body: '',
      };
      blocks.push(taskBlock);
      lastTaskBlock = taskBlock;
    } else if (lastTaskBlock && /^\s{2,}[-*+]\s+/.test(line)) {
      // 嵌套列表项 → 归入上一个 SmartTaskBlock 的 body
      pendingNestedLines.push(line);
    } else if (line.trim() === '') {
      // 空行：如果前面有文本在累积，加入换行
      if (pendingTextLines.length > 0) pendingTextLines.push('');
    } else if (/^#{1,6}\s+/.test(line)) {
      // 标题行 → 作为文本块
      flushNested();
      flushText();
      pendingTextLines.push(line);
    } else {
      // 普通文本行
      flushNested();
      lastTaskBlock = null;
      pendingTextLines.push(line);
    }
  }

  flushText();
  flushNested();

  // 如果没有任何 block（理论上不会），添加占位
  if (blocks.length === 0) {
    blocks.push({ type: 'text', id: genBlockId(), content: '' });
  }

  return blocks;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── Blocks 查询工具 ────────────────────────────────────────

/** 获取所有 SmartTaskBlock */
export function getSmartTaskBlocks(blocks: Block[]): SmartTaskBlock[] {
  return blocks.filter((b): b is SmartTaskBlock => b.type === 'smart-task');
}

/** 统计完成进度 */
export function computeBlockProgress(blocks: Block[]): { total: number; done: number; ratio: number } {
  const tasks = getSmartTaskBlocks(blocks);
  const total = tasks.length;
  const done = tasks.filter(b => b.header.isCompleted).length;
  return { total, done, ratio: total > 0 ? done / total : 0 };
}

// ── Block CRUD 操作 ────────────────────────────────────────

/** 追加 block 到末尾 */
export function appendBlock(blocks: Block[] | undefined, block: Block): Block[] {
  const next = [...(blocks ?? []), block];
  assertUniqueBlockIds(next);
  return next;
}

/** Reject invalid or duplicate IDs before a project document is persisted. */
export function assertUniqueBlockIds(blocks: readonly Block[] | undefined): void {
  const ids = new Set<string>();
  for (const block of blocks ?? []) {
    const id = typeof block.id === 'string' ? block.id.trim() : '';
    if (!id) throw new Error('项目文档中存在缺少 ID 的内容块，已取消保存以保护数据。');
    if (ids.has(id)) throw new Error(`项目文档中存在重复内容块 ID：${id}，已取消保存以保护数据。`);
    ids.add(id);
  }
}

/** 更新 SmartTaskBlock 的 header */
export function updateBlockHeader(blocks: Block[] | undefined, blockId: string, headerPatch: Partial<SmartTaskHeader>): Block[] {
  return (blocks ?? []).map(b => {
    if (b.type !== 'smart-task' || b.id !== blockId) return b;
    const nextHeader = { ...b.header, ...headerPatch };
    if (requiresTaskStartDate(nextHeader) && !nextHeader.date) return b;
    return {
      ...b,
      header: nextHeader,
    };
  });
}

/** 删除指定 block */
export function deleteBlock(blocks: Block[] | undefined, blockId: string): Block[] {
  return (blocks ?? []).filter(b => b.id !== blockId);
}

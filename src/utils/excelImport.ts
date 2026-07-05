// ============================================================
// 批量导入工具模块
// Excel/CSV 解析 → 数据清洗 → 结构映射 → 模板生成
// 纯前端本地处理，无后端依赖
// ============================================================

import * as XLSX from 'xlsx';
import dayjs from 'dayjs';
import type { SmartTaskBlock, Task } from '@/types';
import { genBlockId, getTagColor } from './blocks';
import { makeLocalDayjs, todayStr, getDayOfWeek, formatDateLocal } from './dateSafe';

// ── 类型定义 ────────────────────────────────────────────────

/** 标准模板列定义 */
export const TEMPLATE_COLUMNS = {
  title: '任务名称',
  tag: '任务类型',
  duration: '预估时长(分钟)',
  date: '排期日期',
  deadline: '截止日期',
  complexity: '复杂度',
  remark: '详情备注',
} as const;

/** 模板列顺序（用于生成下载模板） */
export const TEMPLATE_COLUMN_ORDER = [
  TEMPLATE_COLUMNS.title,
  TEMPLATE_COLUMNS.tag,
  TEMPLATE_COLUMNS.duration,
  TEMPLATE_COLUMNS.date,
  TEMPLATE_COLUMNS.deadline,
  TEMPLATE_COLUMNS.complexity,
  TEMPLATE_COLUMNS.remark,
] as const;

/** 解析后的扁平行（与 Excel 列对应） */
export interface ParsedRow {
  /** 临时行号（用于 React key 与错误定位） */
  _rowId: string;
  title: string;
  tag: string;
  duration: number;
  /** 原始日期字符串（用于错误提示） */
  dateRaw: string;
  /** 规范化后的日期 YYYY-MM-DD（无效时为空串） */
  date: string;
  deadlineRaw: string;
  deadline: string;
  complexity: 'easy' | 'normal' | 'hard';
  remark: string;
  /** 校验错误信息（空字符串表示通过） */
  _error: string;
}

/** 批量排期配置 */
export interface BatchScheduleConfig {
  startDate: string;       // YYYY-MM-DD
  perDay: number;          // 每天分配几个任务
  skipWeekend: boolean;    // 是否跳过周末
  /** 仅对未排期的行生效；false = 覆盖所有行 */
  onlyEmpty: boolean;
}

// ── 模板生成与下载 ──────────────────────────────────────────

/**
 * 生成标准导入模板 .xlsx 文件并触发下载。
 * 包含表头 + 2 行示例数据 + 列宽优化。
 */
export function downloadTemplate(): void {
  const headers: string[] = [...TEMPLATE_COLUMN_ORDER];
  const sampleRows: (string | number)[][] = [
    ['马原第一章听课', '看课', 60, '2026-07-10', '', 'normal', '重点：唯物论'],
    ['马原第一章习题', '做题', 45, '2026-07-10', '2026-07-12', 'easy', ''],
  ];

  const aoa: (string | number)[][] = [headers, ...sampleRows];
  const ws = XLSX.utils.aoa_to_sheet(aoa);

  // 列宽优化
  ws['!cols'] = [
    { wch: 24 }, // 任务名称
    { wch: 12 }, // 任务类型
    { wch: 14 }, // 预估时长
    { wch: 14 }, // 排期日期
    { wch: 14 }, // 截止日期
    { wch: 10 }, // 复杂度
    { wch: 30 }, // 详情备注
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '批量导入');

  const dateStr = todayStr();
  XLSX.writeFile(wb, `批量导入模板-${dateStr}.xlsx`);
}

// ── 文件解析 ────────────────────────────────────────────────

/**
 * 解析用户上传的 Excel/CSV 文件为 ParsedRow 数组（未清洗）。
 * 支持的列名容错：任务名称/任务名/名称、任务类型/类型/标签 等。
 */
export async function parseImportFile(file: File): Promise<ParsedRow[]> {
  const data = await file.arrayBuffer();
  const wb = XLSX.read(data, { type: 'array' });

  const firstSheetName = wb.SheetNames[0];
  if (!firstSheetName) return [];

  const ws = wb.Sheets[firstSheetName];
  // header: 1 → 返回数组的数组，第一行作为表头
  const rows = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: '' });
  if (rows.length < 2) return [];

  const headerRow = rows[0].map((h) => String(h).trim());
  const colMap = buildColumnMap(headerRow);

  // 表头校验：必须包含"任务名称"列（或其别名），否则后续所有行标题为空
  if (colMap.title < 0) {
    throw new Error(
      '未在表头中找到"任务名称"列。请使用标准模板，或确保表头包含：任务名称 / 任务名 / 名称 / title / name',
    );
  }

  const parsed: ParsedRow[] = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    // 整行空白 → 跳过
    if (!row || row.every((c) => c === '' || c === null || c === undefined)) continue;

    const title = readCell(row, colMap.title);
    const tag = readCell(row, colMap.tag) || '';
    const durationRaw = readCell(row, colMap.duration);
    const dateRaw = readDateCell(row, colMap.date);
    const deadlineRaw = readDateCell(row, colMap.deadline);
    const complexityRaw = readCell(row, colMap.complexity);
    const remark = readCell(row, colMap.remark);

    parsed.push({
      _rowId: `row-${i}-${Math.random().toString(36).slice(2, 8)}`,
      title: title.trim(),
      tag: tag.trim(),
      duration: parseDuration(durationRaw),
      dateRaw: String(dateRaw ?? '').trim(),
      date: '',
      deadlineRaw: String(deadlineRaw ?? '').trim(),
      deadline: '',
      complexity: parseComplexity(complexityRaw),
      remark: remark.trim(),
      _error: '',
    });
  }

  return cleanseRows(parsed);
}

// ── 数据清洗与规范化 ────────────────────────────────────────

/** 列名 → 列索引映射（支持多种常见别名） */
function buildColumnMap(header: string[]): Record<keyof typeof TEMPLATE_COLUMNS, number> {
  const aliases: Record<keyof typeof TEMPLATE_COLUMNS, string[]> = {
    title: ['任务名称', '任务名', '名称', '标题', 'title', 'name'],
    tag: ['任务类型', '类型', '标签', 'tag', 'type'],
    duration: ['预估时长(分钟)', '预估时长', '时长(分钟)', '时长', 'duration', '时长(分)'],
    date: ['排期日期', '排期', '日期', '计划日期', 'date', 'scheduled'],
    deadline: ['截止日期', '截止', 'deadline', 'due'],
    complexity: ['复杂度', '难度', 'complexity'],
    remark: ['详情备注', '备注', '详情', 'remark', 'note', 'description'],
  };

  const map: Record<keyof typeof TEMPLATE_COLUMNS, number> = {
    title: -1, tag: -1, duration: -1, date: -1, deadline: -1, complexity: -1, remark: -1,
  };

  for (const key of Object.keys(aliases) as (keyof typeof TEMPLATE_COLUMNS)[]) {
    for (let i = 0; i < header.length; i++) {
      const h = header[i].toLowerCase();
      if (aliases[key].some((a) => h === a.toLowerCase() || h === a.toLowerCase().replace(/\(.*?\)/, '').trim())) {
        map[key] = i;
        break;
      }
    }
  }

  return map;
}

function readCell(row: unknown[], colIndex: number): string {
  if (colIndex < 0 || colIndex >= row.length) return '';
  const v = row[colIndex];
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * 读取日期列的原始值，直接格式化为 YYYY-MM-DD。
 * 绕过 String(Date) → dayjs(string) 链路，避免时区偏移。
 * - Date 对象：SheetJS numdate() 按本地时间创建，取本地分量即可
 * - 数字：Excel 序列号，用 XLSX.SSF.parse_date_code（纯数学，无时区）
 * - 字符串：交给 normalizeDate 处理
 */
function readDateCell(row: unknown[], colIndex: number): string {
  if (colIndex < 0 || colIndex >= row.length) return '';
  const v = row[colIndex];
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    if (isNaN(v.getTime())) return '';
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, '0');
    const d = String(v.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof v === 'number') {
    const date = XLSX.SSF.parse_date_code(v);
    if (date && date.y) {
      return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
  }
  return String(v);
}

/** 解析时长：失败时返回默认值 30 */
function parseDuration(raw: string): number {
  if (!raw) return 30;
  const n = parseInt(raw.replace(/[^\d]/g, ''), 10);
  if (isNaN(n) || n <= 0) return 30;
  return n;
}

/** 解析复杂度 */
function parseComplexity(raw: string): 'easy' | 'normal' | 'hard' {
  const s = raw.toLowerCase().trim();
  if (s === 'easy' || s === '简单' || s === '易') return 'easy';
  if (s === 'hard' || s === '困难' || s === '难') return 'hard';
  return 'normal';
}

/** 清洗：日期规范化 + 默认值 + 校验 */
export function cleanseRows(rows: ParsedRow[]): ParsedRow[] {
  return rows.map((r) => {
    // 过滤空行：任务名称为空时直接丢弃（在 parseImportFile 已做了整行空判断，
    // 这里再做一次单字段判断，避免进入校验流程）
    if (!r.title) return { ...r, _error: '任务名称为空（已忽略）' };

    const date = normalizeDate(r.dateRaw);
    const deadline = r.deadlineRaw ? normalizeDate(r.deadlineRaw) : '';

    let error = '';
    if (!r.title.trim()) {
      error = '任务名称不能为空';
    } else if (r.dateRaw && !date) {
      error = `日期格式无法识别：${r.dateRaw}`;
    } else if (r.deadlineRaw && !deadline) {
      error = `截止日期格式无法识别：${r.deadlineRaw}`;
    } else if (date && deadline && deadline < date) {
      error = '截止日期不能早于排期日期';
    }

    return {
      ...r,
      tag: r.tag || '未分类',
      date,
      deadline,
      _error: error,
    };
  });
}

/**
 * 日期格式抹平：支持
 *   - Excel 数字时间戳（cellDates 已转 Date 对象）
 *   - 2026-07-04 / 2026/7/4 / 2026.7.4
 *   - 7-4 / 7/4（默认补当前年）
 *   - Date 对象
 * 返回 YYYY-MM-DD；无法识别返回空字符串。
 */
export function normalizeDate(raw: string | Date | number): string {
  if (!raw) return '';
  if (raw instanceof Date) {
    if (isNaN(raw.getTime())) return '';
    // 直接取本地分量，避免 dayjs 时区偏移
    const y = raw.getFullYear();
    const m = String(raw.getMonth() + 1).padStart(2, '0');
    const d = String(raw.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof raw === 'number') {
    // Excel 序列号（自 1900-01-01 起的天数）
    const date = XLSX.SSF.parse_date_code(raw);
    if (date && date.y) {
      return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
    }
    return '';
  }

  const s = String(raw).trim();
  if (!s) return '';

  // 标准格式：直接拼接，不经过 dayjs，避免 dayjs('YYYY-MM-DD') 的 UTC/local 时区偏移
  const m1 = s.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/);
  if (m1) {
    const [, y, mo, d] = m1;
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 仅月日：补当前年，直接拼接
  const m2 = s.match(/^(\d{1,2})[-./](\d{1,2})$/);
  if (m2) {
    const year = new Date().getFullYear();
    const [, mo, d] = m2;
    return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // 尝试 dayjs 兜底（仅用于非标准格式如 "Jul 6, 2026"）
  const dd = dayjs(s);
  if (!dd.isValid()) return '';
  // 直接取本地分量，避免 format() 的时区风险
  return `${dd.year()}-${String(dd.month() + 1).padStart(2, '0')}-${String(dd.date()).padStart(2, '0')}`;
}

// ── 批量排期（空降排期机制）────────────────────────────────

/**
 * 对未排期的行批量分配递增日期。
 * 在内存中完成，不修改 store。
 */
export function applyBatchSchedule(rows: ParsedRow[], config: BatchScheduleConfig): ParsedRow[] {
  const start = makeLocalDayjs(config.startDate);
  if (!start.isValid()) return rows;

  let cursor = start;
  let countToday = 0;

  return rows.map((r) => {
    // 已有日期且不覆盖 → 跳过
    if (config.onlyEmpty && r.date) return r;
    // 有错误的行不参与排期
    if (r._error && r._error !== '任务名称为空（已忽略）') return r;
    if (!r.title) return r;

    // 跳过周末（cursor 基于 makeLocalDayjs，.day() 安全取本地分量）
    while (config.skipWeekend && (cursor.day() === 0 || cursor.day() === 6)) {
      cursor = cursor.add(1, 'day');
    }

    const newDate = `${cursor.year()}-${String(cursor.month() + 1).padStart(2, '0')}-${String(cursor.date()).padStart(2, '0')}`;
    const newRow: ParsedRow = { ...r, date: newDate, dateRaw: newDate };

    // 重新校验（截止日期早于排期的情况）
    if (r.deadline && r.deadline < newDate) {
      newRow._error = '截止日期不能早于排期日期';
    } else if (r._error === '截止日期不能早于排期日期') {
      newRow._error = '';
    }

    countToday++;
    if (countToday >= config.perDay) {
      countToday = 0;
      cursor = cursor.add(1, 'day');
    }

    return newRow;
  });
}

// ── 结构映射：ParsedRow → SmartTaskBlock ─────────────────────

/**
 * 将清洗后的 ParsedRow 数组映射为 SmartTaskBlock 数组。
 * 复用项目现有的 tagColor 映射规则，保持与手动创建的卡片视觉一致。
 */
export function mapRowsToBlocks(rows: ParsedRow[]): SmartTaskBlock[] {
  const blocks: SmartTaskBlock[] = [];
  for (const r of rows) {
    if (!r.title || r._error) continue;
    blocks.push({
      type: 'smart-task',
      id: genBlockId(),
      header: {
        title: r.title,
        tag: r.tag,
        tagColor: getTagColor(r.tag),
        date: r.date || formatDateLocal(new Date()),
        deadline: r.deadline || undefined,
        duration: r.duration,
        isCompleted: false,
        complexity: r.complexity,
      },
      body: r.remark ? `<p>${escapeHtml(r.remark)}</p>` : '',
    });
  }
  return blocks;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// ── 计算任务的日期范围（用于新建/更新父任务）──────────────────

/**
 * 根据导入的 blocks 与现有 task 的 start/end，计算合并后的日期范围。
 */
export function computeTaskDateRange(task: Task, newBlocks: SmartTaskBlock[]): { start: string; end: string } {
  const dates: string[] = [task.start, task.end];
  for (const b of newBlocks) {
    if (b.header.date) dates.push(b.header.date);
    if (b.header.deadline) dates.push(b.header.deadline);
  }
  const valid = dates.filter(Boolean).sort();
  if (valid.length === 0) {
    const today = formatDateLocal(new Date());
    return { start: today, end: today };
  }
  return { start: valid[0], end: valid[valid.length - 1] };
}

// ── 校验工具 ────────────────────────────────────────────────

/** 统计有效行数（可导入）与错误行数 */
export function summarizeRows(rows: ParsedRow[]): {
  total: number;
  valid: number;
  errors: number;
  empty: number;
} {
  let valid = 0, errors = 0, empty = 0;
  for (const r of rows) {
    if (!r.title) { empty++; continue; }
    if (r._error) errors++;
    else valid++;
  }
  return { total: rows.length, valid, errors, empty };
}

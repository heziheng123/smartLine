// ============================================================
// 日期安全工具
// 解决 dayjs('YYYY-MM-DD') 将纯日期字符串解析为 UTC 午夜、
// 而 .format() / .day() / .isBefore() 等方法使用本地时间
// 导致的日期偏移一天问题。
// ============================================================

import dayjs from 'dayjs';

/**
 * 将 YYYY-MM-DD 日期字符串安全地转为 dayjs 对象。
 * 核心修复：dayjs('YYYY-MM-DD') 按 ISO 8601 将纯日期字符串解析为 UTC 午夜零点，
 * 而 .format() / .day() / .year() 等方法使用本地时间，在 UTC- 时区会导致日期偏移一天。
 * 解决方案：先用 new Date(y, m-1, d) 构造本地午夜的 Date 对象，再传给 dayjs。
 */
export function makeLocalDayjs(dateStr: string): dayjs.Dayjs {
  if (!isValidCalendarDate(dateStr)) return dayjs(Number.NaN);
  const [y, m, d] = dateStr.split('-').map(Number);
  return dayjs(new Date(y, m - 1, d));
}

/**
 * 将 Date 对象格式化为 YYYY-MM-DD，取本地分量。
 * 等价于 dayjs(d).format('YYYY-MM-DD') 但无 UTC/local 偏移。
 */
export function formatDateLocal(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 获取今天的 YYYY-MM-DD，使用本地时间。
 * 替代 dayjs().format('YYYY-MM-DD')。
 */
export function todayStr(): string {
  return formatDateLocal(new Date());
}

/** Strictly validates a YYYY-MM-DD calendar date without allowing Date normalization. */
export function isValidCalendarDate(dateStr: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * 安全地将日期字符串 + 天数偏移格式化为 YYYY-MM-DD。
 * 替代 dayjs(dateStr).add(n, 'day').format('YYYY-MM-DD')。
 *
 * 原理：dayjs(dateStr).add(n, 'day') 在 dayjs 内部以 UTC 午夜为基准
 * 加天数后仍是 UTC 午夜，.format() 输出本地时间。取本地分量可消除偏移。
 */
export function addDays(dateStr: string, days: number): string {
  if (!isValidCalendarDate(dateStr)) return dateStr;
  const [y, m, d] = dateStr.split('-').map(Number);
  const base = new Date(y, m - 1, d);
  base.setDate(base.getDate() + days);
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

/**
 * 安全的日期比较：a 是否在 b 之前（精确到天）。
 * 替代 dayjs(a).isBefore(dayjs(b), 'day')。
 * 使用字符串比较，完全避免时区问题。
 */
export function isBeforeDay(a: string, b: string): boolean {
  return a < b;
}

/**
 * 安全的日期比较：a 是否在 b 之后（精确到天）。
 * 替代 dayjs(a).isAfter(dayjs(b), 'day')。
 */
export function isAfterDay(a: string, b: string): boolean {
  return a > b;
}

/**
 * 安全的日期比较：a 是否与 b 同一天。
 * 替代 dayjs(a).isSame(dayjs(b), 'day')。
 */
export function isSameDay(a: string, b: string): boolean {
  return a === b;
}

/**
 * 安全获取星期几（0=周日, 1=周一, ..., 6=周六）。
 * 替代 dayjs(dateStr).day() 和 new Date(dateStr).getDay()。
 * 纯算法，不依赖 Date 对象解析。
 */
export function getDayOfWeek(dateStr: string): number {
  // 用 dayjs 取本地分量：dayjs 内部 add(0) 不改变值，但 .day() 取本地分量
  // 不过 dayjs('YYYY-MM-DD') 的 .day() 在 UTC- 时区可能有偏移
  // 所以用纯算法：Zeller 公式或直接用 new Date 的本地构造
  const [y, m, d] = dateStr.split('-').map(Number);
  // 使用本地时间构造 Date，避免 UTC 午夜问题
  const localDate = new Date(y, m - 1, d);
  return localDate.getDay();
}

/**
 * 安全格式化日期字符串为显示文本。
 * 替代 dayjs(dateStr).format('M.D') / .format('M月D日') 等。
 * 取本地分量拼接，避免 UTC/local 偏移。
 */
export function formatDate(dateStr: string, pattern: 'M.D' | 'M月D日' | 'YYYY年MM月' | 'YYYY-MM-DD'): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  switch (pattern) {
    case 'M.D': return `${m}.${d}`;
    case 'M月D日': return `${m}月${d}日`;
    case 'YYYY年MM月': return `${y}年${String(m).padStart(2, '0')}月`;
    case 'YYYY-MM-DD': return dateStr;
  }
}

/**
 * 安全获取日期字符串的年、月、日分量。
 * 直接字符串拆分，避免 dayjs 解析。
 */
export function splitDate(dateStr: string): { year: number; month: number; day: number } {
  const [y, m, d] = dateStr.split('-').map(Number);
  return { year: y, month: m, day: d };
}

/**
 * 安全计算两个日期之间的天数差。
 * 替代 dayjs(a).diff(dayjs(b), 'day')。
 * 使用纯天数计算，避免 UTC 时间戳差值在时区边界的不确定性。
 */
export function diffDays(a: string, b: string): number {
  // 使用本地午夜的 Date 对象计算差值
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const dateA = new Date(ay, am - 1, ad);
  const dateB = new Date(by, bm - 1, bd);
  return Math.round((dateA.getTime() - dateB.getTime()) / (86400000));
}

/**
 * 安全判断日期字符串是否表示今天。
 * 替代 dateStr === dayjs().format('YYYY-MM-DD')。
 */
export function isToday(dateStr: string): boolean {
  return dateStr === todayStr();
}

/**
 * 安全判断日期是否逾期（早于今天）。
 * 替代 dayjs(dateStr).isBefore(dayjs(), 'day')。
 */
export function isOverdue(dateStr: string): boolean {
  return dateStr < todayStr();
}

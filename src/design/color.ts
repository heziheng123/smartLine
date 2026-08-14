/**
 * 颜色工具：统一处理 hex 解析/校验/对比度/补全。
 * 取代散落在 TaskDialog / NoteDialog / GroupDialog / MilestoneDialog
 * 里的 3 份几乎一样的 "replace ^#, expand 3 to 6, uppercase" 重复实现。
 */

const HEX3 = /^[0-9a-fA-F]{3}$/;
const HEX6 = /^[0-9a-fA-F]{6}$/;

/**
 * 把用户输入的颜色字符串规范化成 "#RRGGBB"。
 * - 自动去除首尾空白与 "#" 前缀
 * - 接受 3 位简写（#F00 → #FF0000）
 * - 接受不带 "#" 的 hex
 * - 无效输入返回 undefined（不要默默转成黑/白）
 */
export function normalizeHex(input: string | null | undefined): string | undefined {
  if (!input) return undefined;
  const v = input.trim().replace(/^#/, '');
  if (!v) return undefined;
  if (HEX3.test(v)) {
    return `#${v.split('').map((c) => c + c).join('').toUpperCase()}`;
  }
  if (HEX6.test(v)) {
    return `#${v.toUpperCase()}`;
  }
  return undefined;
}

/** 同步返回输入是否合法（用于输入框实时反馈）。 */
export function isValidHex(input: string | null | undefined): boolean {
  if (!input) return true; // 空视为"未指定"，合法
  const v = input.trim().replace(/^#/, '');
  return v === '' || HEX3.test(v) || HEX6.test(v);
}

/** 0..255 亮度（用于"深底用白字 / 浅底用深字"判定）。 */
export function hexBrightness(hex: string): number {
  const normalized = normalizeHex(hex);
  if (!normalized) return 0;
  const v = normalized.slice(1);
  const r = parseInt(v.substring(0, 2), 16);
  const g = parseInt(v.substring(2, 4), 16);
  const b = parseInt(v.substring(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000;
}

/** 给一个 hex 背景，挑对比度足够的前景色（黑或白）。 */
export function preferredTextOn(hex: string): '#1D1D1F' | '#FFFFFF' {
  return hexBrightness(hex) > 150 ? '#1D1D1F' : '#FFFFFF';
}

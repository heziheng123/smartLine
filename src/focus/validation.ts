import type {
  ActiveFocusSession,
  FocusBackgroundPolicy,
  FocusInterruptionReason,
  FocusSession,
  FocusSessionCorrectionField,
  FocusSubject,
  FocusWeeklyTargetVersion,
} from './types';

const interruptionReasons = new Set<FocusInterruptionReason>(['urgent', 'people', 'energy', 'switch-task', 'other']);
const backgroundPolicies = new Set<FocusBackgroundPolicy>(['continue', 'auto-pause']);
const correctionFields = new Set<FocusSessionCorrectionField>(['subjectId', 'startedAt', 'endedAt', 'activeSeconds', 'interruptions', 'mode', 'targetMinutes']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

function isLocalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return parsed.toISOString().slice(0, 10) === value;
}

function localDateFor(timestamp: string, timeZone: string): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function validateFocusSubject(value: unknown): string[] {
  if (!isRecord(value)) return ['专注主题必须是对象。'];
  const errors: string[] = [];
  if (typeof value.id !== 'string' || !value.id) errors.push('专注主题缺少 id。');
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push('专注主题名称不能为空。');
  if (typeof value.color !== 'string' || !value.color) errors.push('专注主题缺少颜色。');
  if (typeof value.order !== 'number' || !Number.isInteger(value.order) || value.order < 0) errors.push('专注主题排序无效。');
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) errors.push('专注主题时间戳无效。');
  if (value.archivedAt !== undefined && !isTimestamp(value.archivedAt)) errors.push('专注主题归档时间无效。');
  if (value.defaultBackgroundPolicy !== undefined && !backgroundPolicies.has(value.defaultBackgroundPolicy as FocusBackgroundPolicy)) {
    errors.push('专注主题后台策略无效。');
  }
  const weeklyTarget = value.weeklyTargetMinutes;
  if (weeklyTarget !== undefined && (typeof weeklyTarget !== 'number' || !Number.isInteger(weeklyTarget)
    || weeklyTarget < 1 || weeklyTarget > 10080)) {
    errors.push('每周目标必须是 1–10080 的整数分钟。');
  }
  if (value.weeklyTargetHistory !== undefined) {
    if (!Array.isArray(value.weeklyTargetHistory) || value.weeklyTargetHistory.some((item) => {
      const version = item as Partial<FocusWeeklyTargetVersion>;
      return !isRecord(item) || !isTimestamp(version.effectiveFrom)
        || (version.targetMinutes !== null && (!Number.isInteger(version.targetMinutes)
          || (version.targetMinutes as number) < 1 || (version.targetMinutes as number) > 10080));
    })) {
      errors.push('周目标版本无效。');
    } else if (value.weeklyTargetHistory.some((item, index, versions) => index > 0
      && (item as FocusWeeklyTargetVersion).effectiveFrom <= (versions[index - 1] as FocusWeeklyTargetVersion).effectiveFrom)) {
      errors.push('周目标版本必须按生效时间递增。');
    }
  }
  return errors;
}

function validateTiming(value: Record<string, unknown>, errors: string[]): void {
  if (value.mode === 'free') {
    if (value.targetMinutes !== undefined) errors.push('自由计时不能包含目标时长。');
    return;
  }
  if (value.mode !== 'pomodoro') {
    errors.push('计时模式无效。');
    return;
  }
  if (!Number.isInteger(value.targetMinutes) || (value.targetMinutes as number) < 5
    || (value.targetMinutes as number) > 240 || (value.targetMinutes as number) % 5 !== 0) {
    errors.push('番茄目标必须是 5–240 的 5 分钟步进整数。');
  }
}

export function validateFocusInterruptions(
  value: unknown,
  startedAt: string,
  endedAt: string,
): string[] {
  if (!Array.isArray(value)) return ['打断记录必须是数组。'];
  const errors: string[] = [];
  let previousEndedAt = startedAt;
  for (const item of value) {
    if (!isRecord(item) || !isTimestamp(item.startedAt) || !isTimestamp(item.endedAt)
      || (item.source !== 'manual' && item.source !== 'background')) {
      errors.push('打断记录格式无效。');
      continue;
    }
    if (item.reason !== undefined && !interruptionReasons.has(item.reason as FocusInterruptionReason)) {
      errors.push('打断原因无效。');
    }
    if (item.startedAt >= item.endedAt) errors.push('打断结束时间必须晚于开始时间。');
    if (item.startedAt < startedAt || item.endedAt > endedAt) errors.push('打断区间必须位于会话范围内。');
    if (item.startedAt < previousEndedAt) errors.push('打断区间不能重叠。');
    previousEndedAt = item.endedAt as string;
  }
  return errors;
}

export function validateFocusSession(value: unknown): string[] {
  if (!isRecord(value)) return ['专注记录必须是对象。'];
  const errors: string[] = [];
  if (typeof value.id !== 'string' || !value.id) errors.push('专注记录缺少 id。');
  if (value.source !== 'timer' && value.source !== 'manual' && value.source !== 'recovered') errors.push('专注记录来源无效。');
  if (typeof value.subjectId !== 'string' || !value.subjectId) errors.push('专注记录缺少主题。');
  if (!isTimestamp(value.startedAt) || !isTimestamp(value.endedAt)) errors.push('专注记录起止时间无效。');
  if (isTimestamp(value.startedAt) && isTimestamp(value.endedAt) && value.endedAt < value.startedAt) {
    errors.push('专注记录结束时间早于开始时间。');
  }
  if (!Number.isInteger(value.activeSeconds) || (value.activeSeconds as number) < 60) {
    errors.push('正式专注记录至少需要 60 秒有效时长。');
  } else if (isTimestamp(value.startedAt) && isTimestamp(value.endedAt)
    && (value.activeSeconds as number) > (Date.parse(value.endedAt) - Date.parse(value.startedAt)) / 1000) {
    errors.push('有效时长不能超过实际时间跨度。');
  }
  if (!isLocalDate(value.localDate) || !isTimeZone(value.timeZone)) errors.push('专注记录日期或时区无效。');
  else if (isTimestamp(value.endedAt) && localDateFor(value.endedAt, value.timeZone) !== value.localDate) {
    errors.push('专注记录日期与结束时间、固定时区不一致。');
  }
  if (typeof value.note === 'string' && (value.note.includes('\n') || value.note.length > 200)) errors.push('备注必须是最多 200 字的单行文本。');
  if (value.note !== undefined && typeof value.note !== 'string') errors.push('备注格式无效。');
  if (value.deletedAt !== undefined && !isTimestamp(value.deletedAt)) errors.push('删除时间无效。');
  if (value.correctedAt !== undefined && !isTimestamp(value.correctedAt)) errors.push('修正时间无效。');
  if (value.correctedFields !== undefined && (!Array.isArray(value.correctedFields)
    || value.correctedFields.length === 0 || value.correctedFields.some((field) => !correctionFields.has(field as FocusSessionCorrectionField)))) {
    errors.push('修正字段无效。');
  }
  if (value.correctedAt !== undefined && value.correctedFields === undefined) errors.push('修正记录缺少修正字段。');
  if (value.correctedAt === undefined && value.correctedFields !== undefined) errors.push('修正字段缺少修正时间。');
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) errors.push('专注记录时间戳无效。');
  validateTiming(value, errors);
  if (isTimestamp(value.startedAt) && isTimestamp(value.endedAt)) {
    errors.push(...validateFocusInterruptions(value.interruptions, value.startedAt, value.endedAt));
  }
  return errors;
}

export function validateFocusWeeklyReview(value: unknown): string[] {
  if (!isRecord(value)) return ['周度复盘必须是对象。'];
  const errors: string[] = [];
  if (!isLocalDate(value.weekStart)) errors.push('周度复盘周起始日期无效。');
  if (typeof value.nextWeekPlan !== 'string' || value.nextWeekPlan.trim().length > 300) errors.push('下周调整计划必须是最多 300 字的文本。');
  if (!isTimestamp(value.updatedAt)) errors.push('周度复盘更新时间无效。');
  return errors;
}

export function validateActiveFocusSession(value: unknown): string[] {
  if (!isRecord(value)) return ['活跃专注会话必须是对象。'];
  const errors: string[] = [];
  if (value.storageKey !== 'active-focus-session') errors.push('活跃会话互斥键无效。');
  if (typeof value.sessionId !== 'string' || !value.sessionId || typeof value.workspaceId !== 'string' || !value.workspaceId
    || typeof value.subjectId !== 'string' || !value.subjectId) errors.push('活跃会话缺少身份字段。');
  if (!isTimestamp(value.startedAt) || !isTimestamp(value.lastTrustedAt) || !isTimeZone(value.timeZone)) errors.push('活跃会话时间信息无效。');
  else if (value.lastTrustedAt < value.startedAt) errors.push('最后可信时间不能早于开始时间。');
  if (value.timeAnomalyAt !== undefined && !isTimestamp(value.timeAnomalyAt)) errors.push('活跃会话时间异常标记无效。');
  if (value.timeAnomalyConfirmedAt !== undefined && !isTimestamp(value.timeAnomalyConfirmedAt)) errors.push('活跃会话时间异常确认无效。');
  if (value.timeAnomalyDeltaMs !== undefined && (typeof value.timeAnomalyDeltaMs !== 'number' || !Number.isFinite(value.timeAnomalyDeltaMs))) errors.push('活跃会话时间异常偏差无效。');
  if (!Number.isFinite(value.accumulatedActiveMs) || (value.accumulatedActiveMs as number) < 0) errors.push('活跃会话累计时长无效。');
  if (value.backgroundPolicy !== 'continue' && value.backgroundPolicy !== 'auto-pause') errors.push('活跃会话后台策略无效。');
  if (value.state !== 'running' && value.state !== 'paused' && value.state !== 'recovery-needed') errors.push('活跃会话状态无效。');
  validateTiming(value, errors);
  if (!Array.isArray(value.interruptions)) errors.push('活跃会话打断记录必须是数组。');
  else if (isTimestamp(value.startedAt) && isTimestamp(value.lastTrustedAt)) {
    errors.push(...validateFocusInterruptions(value.interruptions, value.startedAt, value.lastTrustedAt));
  }
  if (value.state === 'running') {
    if (!isTimestamp(value.runningSince) || value.currentInterruption !== undefined) errors.push('运行会话锚点无效。');
    else if (isTimestamp(value.startedAt) && isTimestamp(value.lastTrustedAt) && (value.runningSince < value.startedAt || value.runningSince > value.lastTrustedAt)) errors.push('运行会话锚点超出可信范围。');
  } else if (value.state === 'paused') {
    if (value.runningSince !== undefined || !isRecord(value.currentInterruption) || !isTimestamp(value.currentInterruption.startedAt)
      || (value.currentInterruption.source !== 'manual' && value.currentInterruption.source !== 'background')) {
      errors.push('暂停会话必须包含当前打断。');
    } else if (value.currentInterruption.reason !== undefined && !interruptionReasons.has(value.currentInterruption.reason as FocusInterruptionReason)) {
      errors.push('暂停会话打断原因无效。');
    } else if (isTimestamp(value.startedAt) && isTimestamp(value.lastTrustedAt) && (value.currentInterruption.startedAt < value.startedAt || value.currentInterruption.startedAt > value.lastTrustedAt)) {
      errors.push('暂停会话打断时间超出可信范围。');
    }
  } else if (value.runningSince !== undefined || value.currentInterruption !== undefined) {
    errors.push('待恢复会话不能带有运行或暂停锚点。');
  }
  return errors;
}

export function assertValidFocusSession(value: FocusSession): void {
  const errors = validateFocusSession(value);
  if (errors.length) throw new Error(errors.join(' '));
}

export function assertValidActiveFocusSession(value: ActiveFocusSession): void {
  const errors = validateActiveFocusSession(value);
  if (errors.length) throw new Error(errors.join(' '));
}

export function assertValidFocusSubject(value: FocusSubject): void {
  const errors = validateFocusSubject(value);
  if (errors.length) throw new Error(errors.join(' '));
}

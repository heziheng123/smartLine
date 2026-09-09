export type FocusInterruptionReason = 'urgent' | 'people' | 'energy' | 'switch-task' | 'other';
export type FocusInterruptionSource = 'manual' | 'background';
export type FocusBackgroundPolicy = 'continue' | 'auto-pause';
export type ActiveFocusSessionState = 'running' | 'paused' | 'recovery-needed';
export type FocusSessionSource = 'timer' | 'manual' | 'recovered';
export type FocusSessionCorrectionField = 'subjectId' | 'startedAt' | 'endedAt' | 'activeSeconds' | 'interruptions' | 'mode' | 'targetMinutes';

export interface FocusWeeklyTargetVersion {
  /** `null` 表示从该时间起不再设置周目标。 */
  targetMinutes: number | null;
  effectiveFrom: string;
}

/** 针对一个自然周的简短、人工复盘，不参与计时事实计算。 */
export interface FocusWeeklyReview {
  weekStart: string;
  nextWeekPlan: string;
  updatedAt: string;
}

export type FocusTiming =
  | { mode: 'free'; targetMinutes?: never }
  | { mode: 'pomodoro'; targetMinutes: number };

export interface FocusSubject {
  id: string;
  name: string;
  color: string;
  weeklyTargetMinutes?: number;
  /** 周目标的变更轨迹，用于历史周的完成率不被今天的设置重写。 */
  weeklyTargetHistory?: FocusWeeklyTargetVersion[];
  defaultBackgroundPolicy?: FocusBackgroundPolicy;
  order: number;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface FocusInterruption {
  startedAt: string;
  endedAt: string;
  source: FocusInterruptionSource;
  reason?: FocusInterruptionReason;
}

export interface FocusSessionBase {
  id: string;
  source: FocusSessionSource;
  subjectId: string;
  startedAt: string;
  endedAt: string;
  activeSeconds: number;
  interruptions: FocusInterruption[];
  note?: string;
  /** 仅记录会影响计时事实的人工修正；备注可以直接编辑。 */
  correctedAt?: string;
  correctedFields?: FocusSessionCorrectionField[];
  localDate: string;
  timeZone: string;
  deletedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type FocusSession = FocusSessionBase & FocusTiming;

export interface ActiveFocusSessionBase {
  storageKey: 'active-focus-session';
  sessionId: string;
  workspaceId: string;
  subjectId: string;
  startedAt: string;
  timeZone: string;
  accumulatedActiveMs: number;
  runningSince?: string;
  state: ActiveFocusSessionState;
  backgroundPolicy: FocusBackgroundPolicy;
  lastTrustedAt: string;
  /** 同一页面生命周期内检测到系统时钟与单调时钟明显不一致时写入。 */
  timeAnomalyAt?: string;
  timeAnomalyDeltaMs?: number;
  timeAnomalyConfirmedAt?: string;
  interruptions: FocusInterruption[];
  currentInterruption?: {
    startedAt: string;
    source: FocusInterruptionSource;
    reason?: FocusInterruptionReason;
  };
}

export type ActiveFocusSession = ActiveFocusSessionBase & FocusTiming;

export interface FocusData {
  focusSubjects: FocusSubject[];
  focusSessions: FocusSession[];
  focusWeeklyReviews: FocusWeeklyReview[];
}

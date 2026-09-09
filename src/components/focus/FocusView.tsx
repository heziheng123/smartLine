import React from 'react';
import { Archive, ChevronDown, Clock3, MoreHorizontal, Pause, Play, Plus, RotateCcw, Square, Trash2, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useActiveFocusStore } from '@/focus/activeSession';
import { elapsedActiveMs, localDateAt } from '@/focus/session';
import { focusSessionsForDate, summarizeFocusSubjects, summarizeFocusWeek } from '@/focus/statistics';
import { FocusStatisticsDashboard } from './FocusStatisticsDashboard';
import { currentFocusWorkspaceId } from '@/focus/persistence';
import { useFocusStore } from '@/focus/store';
import { loadFocusCompletionPreferences, primeFocusCompletionSound, saveFocusCompletionPreferences, signalFocusTargetReached, summarizeFocusCompletion, type FocusCompletionPreferences } from '@/focus/completion';
import type { FocusBackgroundPolicy, FocusInterruption, FocusInterruptionReason, FocusSession } from '@/focus/types';
import { requestConfirmation } from '@/services/confirmation';
import '@/styles/focus.css';

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const formatTimer = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
const sourceLabel = (source: FocusSession['source']) => source === 'manual' ? '手动补录' : source === 'recovered' ? '恢复保存' : '计时记录';

const FocusRing: React.FC<{ value: number; primary: string; label: string; free?: boolean }> = ({ value, primary, label, free = false }) => {
  const circumference = 276;
  const progress = Math.max(0, Math.min(100, value));
  return <div className="focus-ring" aria-label={`${label} ${primary}`}>
    <svg viewBox="0 0 100 100" aria-hidden="true"><circle className="focus-ring__track" cx="50" cy="50" r="44" /><circle className={`focus-ring__value${free ? ' is-free' : ''}`} cx="50" cy="50" r="44" style={{ strokeDasharray: `${free ? circumference : circumference * progress / 100} ${circumference}` }} /></svg>
    <div><strong>{primary}</strong><span>{label}</span></div>
  </div>;
};

const addDays = (localDate: string, amount: number) => {
  const date = new Date(`${localDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
};

const formatInputInTimeZone = (iso: string, timeZone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(iso)).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
};

const parseInputInTimeZone = (value: string, timeZone: string): string => {
  const normalized = value.length === 16 ? `${value}:00` : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) throw new Error('日期时间格式无效。');
  const desired = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  let guess = desired;
  for (let index = 0; index < 3; index += 1) {
    const rendered = formatInputInTimeZone(new Date(guess).toISOString(), timeZone);
    const renderedMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(rendered)!;
    const renderedUtc = Date.UTC(Number(renderedMatch[1]), Number(renderedMatch[2]) - 1, Number(renderedMatch[3]), Number(renderedMatch[4]), Number(renderedMatch[5]), Number(renderedMatch[6]));
    guess += desired - renderedUtc;
  }
  const result = new Date(guess).toISOString();
  if (formatInputInTimeZone(result, timeZone) !== normalized) throw new Error('该时区不存在这个本地时间，请避开夏令时切换时刻。');
  return result;
};

interface InterruptionDraft {
  id: string;
  startedAt: string;
  endedAt: string;
  source: 'manual' | 'background';
  reason: FocusInterruptionReason | '';
}

const interruptionDraft = (timeZone: string, value?: FocusInterruption): InterruptionDraft => ({
  id: crypto.randomUUID(),
  startedAt: value ? formatInputInTimeZone(value.startedAt, timeZone) : '',
  endedAt: value ? formatInputInTimeZone(value.endedAt, timeZone) : '',
  source: value?.source ?? 'manual',
  reason: value?.reason ?? '',
});

const parseInterruptions = (drafts: InterruptionDraft[], timeZone: string): FocusInterruption[] => drafts.map((draft) => ({
  startedAt: parseInputInTimeZone(draft.startedAt, timeZone),
  endedAt: parseInputInTimeZone(draft.endedAt, timeZone),
  source: draft.source,
  ...(draft.reason ? { reason: draft.reason } : {}),
})).sort((left, right) => left.startedAt.localeCompare(right.startedAt));

const InterruptionFields: React.FC<{
  drafts: InterruptionDraft[];
  onChange: (value: InterruptionDraft[]) => void;
}> = ({ drafts, onChange }) => <fieldset className="focus-interruptions">
  <legend>打断记录（可选）</legend>
  {drafts.map((draft, index) => <div key={draft.id}>
    <label>开始<input required type="datetime-local" step="1" value={draft.startedAt} onChange={(event) => onChange(drafts.map((item) => item.id === draft.id ? { ...item, startedAt: event.target.value } : item))} /></label>
    <label>结束<input required type="datetime-local" step="1" value={draft.endedAt} onChange={(event) => onChange(drafts.map((item) => item.id === draft.id ? { ...item, endedAt: event.target.value } : item))} /></label>
    <label>来源<select value={draft.source} onChange={(event) => onChange(drafts.map((item) => item.id === draft.id ? { ...item, source: event.target.value === 'background' ? 'background' : 'manual' } : item))}><option value="manual">手动暂停</option><option value="background">后台暂停</option></select></label>
    <label>原因<select value={draft.reason} onChange={(event) => onChange(drafts.map((item) => item.id === draft.id ? { ...item, reason: event.target.value as FocusInterruptionReason | '' } : item))}><option value="">未填写</option><option value="urgent">临时事务</option><option value="people">被他人打断</option><option value="energy">精力不足</option><option value="switch-task">切换任务</option><option value="other">其他</option></select></label>
    <button type="button" aria-label={`删除第 ${index + 1} 条打断记录`} onClick={() => onChange(drafts.filter((item) => item.id !== draft.id))}>删除</button>
  </div>)}
  <button type="button" onClick={() => onChange([...drafts, interruptionDraft(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC')])}>添加打断记录</button>
</fieldset>;

function currentTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

interface FocusViewProps {
  panel?: boolean;
  mode?: 'manage' | 'review';
  onOpenReview?: () => void;
}

const FocusView: React.FC<FocusViewProps> = ({ panel = false, mode = 'manage', onOpenReview }) => {
  const { focusSubjects, focusSessions, focusWeeklyReviews, createSubject, updateSubject, reorderSubjects, archiveSubject, createManualSession, updateSession, deleteSession, saveWeeklyReview } = useFocusStore(useShallow((state) => ({
    focusSubjects: state.focusSubjects,
    focusSessions: state.focusSessions,
    focusWeeklyReviews: state.focusWeeklyReviews,
    createSubject: state.createSubject,
    updateSubject: state.updateSubject,
    reorderSubjects: state.reorderSubjects,
    archiveSubject: state.archiveSubject,
    createManualSession: state.createManualSession,
    updateSession: state.updateSession,
    deleteSession: state.deleteSession,
    saveWeeklyReview: state.saveWeeklyReview,
  })));
  const activeState = useActiveFocusStore(useShallow((state) => ({
    active: state.active,
    finishRequestedAt: state.finishRequestedAt,
    error: state.error,
    start: state.start,
    pause: state.pause,
    resume: state.resume,
    setBackgroundPolicy: state.setBackgroundPolicy,
    requestFinish: state.requestFinish,
    cancelFinish: state.cancelFinish,
    finish: state.finish,
    discard: state.discard,
    finishRecoveryAtLastTrusted: state.finishRecoveryAtLastTrusted,
    resumeRecovery: state.resumeRecovery,
    confirmTimeAnomaly: state.confirmTimeAnomaly,
  })));
  const [now, setNow] = React.useState(() => new Date());
  const [name, setName] = React.useState('');
  const [color, setColor] = React.useState('#6366f1');
  const [backgroundPolicy, setBackgroundPolicy] = React.useState<FocusBackgroundPolicy>('continue');
  const [weeklyTarget, setWeeklyTarget] = React.useState('');
  const [showCreate, setShowCreate] = React.useState(false);
  const [customMinutes, setCustomMinutes] = React.useState('50');
  const [nextBackgroundPolicy, setNextBackgroundPolicy] = React.useState<FocusBackgroundPolicy | ''>('');
  const [pauseReason, setPauseReason] = React.useState<FocusInterruptionReason | ''>('');
  const [note, setNote] = React.useState('');
  const [success, setSuccess] = React.useState<string | null>(null);
  const [completion, setCompletion] = React.useState<FocusSession | null>(null);
  const [completionPreferences, setCompletionPreferences] = React.useState<FocusCompletionPreferences>(loadFocusCompletionPreferences);
  const [showRecoveryMore, setShowRecoveryMore] = React.useState(false);
  const [showAllSubjects, setShowAllSubjects] = React.useState(false);
  const [detailSubjectId, setDetailSubjectId] = React.useState<string | null>(null);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [showManual, setShowManual] = React.useState(false);
  const [manualSubjectId, setManualSubjectId] = React.useState('');
  const [manualStartedAt, setManualStartedAt] = React.useState('');
  const [manualEndedAt, setManualEndedAt] = React.useState('');
  const [manualMinutes, setManualMinutes] = React.useState('');
  const [manualMode, setManualMode] = React.useState<'free' | 'pomodoro'>('free');
  const [manualTarget, setManualTarget] = React.useState('25');
  const [manualNote, setManualNote] = React.useState('');
  const [manualInterruptions, setManualInterruptions] = React.useState<InterruptionDraft[]>([]);
  const [editingSubjectId, setEditingSubjectId] = React.useState<string | null>(null);
  const [editingName, setEditingName] = React.useState('');
  const [editingTarget, setEditingTarget] = React.useState('');
  const [editingColor, setEditingColor] = React.useState('#6366f1');
  const [editingBackgroundPolicy, setEditingBackgroundPolicy] = React.useState<FocusBackgroundPolicy>('continue');
  const [editingSession, setEditingSession] = React.useState<FocusSession | null>(null);
  const [editingSessionSubjectId, setEditingSessionSubjectId] = React.useState('');
  const [editingSessionStartedAt, setEditingSessionStartedAt] = React.useState('');
  const [editingSessionEndedAt, setEditingSessionEndedAt] = React.useState('');
  const [editingSessionSeconds, setEditingSessionSeconds] = React.useState('');
  const [editingSessionMode, setEditingSessionMode] = React.useState<'free' | 'pomodoro'>('free');
  const [editingSessionTarget, setEditingSessionTarget] = React.useState('25');
  const [editingSessionNote, setEditingSessionNote] = React.useState('');
  const [editingSessionInterruptions, setEditingSessionInterruptions] = React.useState<InterruptionDraft[]>([]);
  const [historySubjectId, setHistorySubjectId] = React.useState('');
  const [historyMode, setHistoryMode] = React.useState<'all' | 'free' | 'pomodoro'>('all');
  const [historyRange, setHistoryRange] = React.useState<'all' | 'today' | 'last7' | 'last30' | 'custom'>('all');
  const [historyStart, setHistoryStart] = React.useState('');
  const [historyEnd, setHistoryEnd] = React.useState('');
  const completionSignalRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const timeZone = currentTimeZone();
  const today = localDateAt(now.toISOString(), timeZone);
  const subjects = React.useMemo(() => focusSubjects.filter((subject) => !subject.archivedAt).sort((a, b) => a.order - b.order), [focusSubjects]);
  const activeSubject = activeState.active ? focusSubjects.find((subject) => subject.id === activeState.active?.subjectId) : undefined;
  const todaySessions = React.useMemo(() => focusSessionsForDate(focusSessions, today), [focusSessions, today]);
  const week = React.useMemo(() => summarizeFocusWeek(focusSessions, today), [focusSessions, today]);
  const totals = React.useMemo(() => summarizeFocusSubjects(focusSessions, focusSubjects), [focusSessions, focusSubjects]);
  const latestSessionBySubject = React.useMemo(() => {
    const values = new Map<string, FocusSession>();
    for (const session of focusSessions) {
      if (session.deletedAt || (values.get(session.subjectId)?.endedAt ?? '') >= session.endedAt) continue;
      values.set(session.subjectId, session);
    }
    return values;
  }, [focusSessions]);
  const todaySeconds = todaySessions.reduce((sum, session) => sum + session.activeSeconds, 0);
  const activeDisplayTime = activeState.finishRequestedAt ? new Date(activeState.finishRequestedAt) : now;
  const activeSeconds = activeState.active ? Math.floor(elapsedActiveMs(activeState.active, activeDisplayTime) / 1000) : 0;
  const weekTotalSeconds = week.reduce((sum, day) => sum + day.activeSeconds, 0);
  const detailSubject = detailSubjectId ? focusSubjects.find((subject) => subject.id === detailSubjectId) : undefined;
  const detailSessions = detailSubject ? focusSessions.filter((session) => !session.deletedAt && session.subjectId === detailSubject.id) : [];
  const detailWeekSeconds = detailSessions.filter((session) => week.some((day) => day.localDate === session.localDate)).reduce((sum, session) => sum + session.activeSeconds, 0);
  const detailWeekTrend = week.map((day) => ({ ...day, activeSeconds: detailSessions.filter((session) => session.localDate === day.localDate).reduce((sum, session) => sum + session.activeSeconds, 0) }));
  const detailTrendMax = Math.max(1, ...detailWeekTrend.map((day) => day.activeSeconds));
  const detailTrendPoints = detailWeekTrend.map((day, index) => `${8 + index * 14},${92 - day.activeSeconds / detailTrendMax * 76}`).join(' ');
  const visibleHistorySessions = React.useMemo(() => {
    const start = historyRange === 'today' ? today : historyRange === 'last7' ? addDays(today, -6) : historyRange === 'last30' ? addDays(today, -29) : historyRange === 'custom' ? historyStart : '';
    const end = historyRange === 'today' ? today : historyRange === 'custom' ? historyEnd : '';
    return focusSessions.filter((session) => !session.deletedAt
      && (!historySubjectId || session.subjectId === historySubjectId)
      && (historyMode === 'all' || session.mode === historyMode)
      && (!start || session.localDate >= start)
      && (!end || session.localDate <= end))
      .sort((left, right) => right.endedAt.localeCompare(left.endedAt));
  }, [focusSessions, historyEnd, historyMode, historyRange, historyStart, historySubjectId, today]);

  const start = async (subjectId: string, mode: 'free' | 'pomodoro', targetMinutes?: number) => {
    try {
      if (activeState.active) return;
      const subject = focusSubjects.find((candidate) => candidate.id === subjectId);
      if (!subject) return;
      if (completionPreferences.sound) primeFocusCompletionSound();
      await activeState.start({
        workspaceId: currentFocusWorkspaceId(), subjectId, timeZone,
        backgroundPolicy: nextBackgroundPolicy || subject.defaultBackgroundPolicy || 'continue',
        ...(mode === 'pomodoro' ? { mode, targetMinutes: targetMinutes! } : { mode }),
      });
    } catch { /* 状态层已保留可重试错误 */ }
  };

  const updateCompletionPreferences = (patch: Partial<FocusCompletionPreferences>) => {
    setCompletionPreferences((current) => {
      const next = { ...current, ...patch };
      saveFocusCompletionPreferences(next);
      return next;
    });
  };

  const setBrowserNotification = async (enabled: boolean) => {
    if (!enabled) return updateCompletionPreferences({ browserNotification: false });
    if (typeof Notification === 'undefined') return setFormError('当前浏览器不支持系统通知。');
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') return setFormError('浏览器未授予通知权限，可在浏览器设置中重新开启。');
    updateCompletionPreferences({ browserNotification: true });
    setFormError(null);
  };

  const signalTargetReached = React.useCallback((sessionId: string, subjectId: string, targetMinutes: number) => {
    if (completionSignalRef.current === sessionId) return;
    completionSignalRef.current = sessionId;
    signalFocusTargetReached(focusSubjects.find((subject) => subject.id === subjectId)?.name ?? '专注主题', targetMinutes, completionPreferences);
  }, [completionPreferences, focusSubjects]);

  React.useEffect(() => {
    const active = activeState.active;
    if (!active || active.mode !== 'pomodoro' || active.state !== 'running' || activeSeconds < active.targetMinutes * 60) return;
    signalTargetReached(active.sessionId, active.subjectId, active.targetMinutes);
  }, [activeSeconds, activeState.active, signalTargetReached]);

  const updateManualStart = (value: string) => {
    setManualStartedAt(value);
    if (!value || !manualEndedAt) return;
    const minutes = Math.floor((new Date(manualEndedAt).getTime() - new Date(value).getTime()) / 60_000);
    setManualMinutes(minutes > 0 ? String(minutes) : '');
  };

  const updateManualEnd = (value: string) => {
    setManualEndedAt(value);
    if (!manualStartedAt || !value) return;
    const minutes = Math.floor((new Date(value).getTime() - new Date(manualStartedAt).getTime()) / 60_000);
    setManualMinutes(minutes > 0 ? String(minutes) : '');
  };

  const updateManualMinutes = (value: string) => {
    setManualMinutes(value);
    const minutes = Number(value);
    if (!manualStartedAt || !Number.isInteger(minutes) || minutes < 1) return;
    setManualEndedAt(formatInputInTimeZone(new Date(new Date(manualStartedAt).getTime() + minutes * 60_000).toISOString(), timeZone));
  };

  const submitSubject = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const target = weeklyTarget ? Number(weeklyTarget) : undefined;
      await createSubject({ name, color, ...(target ? { weeklyTargetMinutes: target } : {}), defaultBackgroundPolicy: backgroundPolicy });
      setName(''); setColor('#6366f1'); setBackgroundPolicy('continue'); setWeeklyTarget(''); setShowCreate(false); setFormError(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '无法创建专注主题。');
    }
  };

  const confirmDiscard = async () => {
    if (await requestConfirmation({ title: '放弃本次专注', message: '本次尚未保存为正式记录，确定放弃吗？', confirmLabel: '放弃本次', tone: 'danger' })) {
      await activeState.discard();
      activeState.cancelFinish();
      setNote('');
    }
  };

  const removeSession = async (id: string) => {
    if (await requestConfirmation({ title: '删除专注记录', message: '删除后将从统计中移除，并同步到其他设备。', confirmLabel: '删除记录', tone: 'danger' })) await deleteSession(id);
  };

  const finishActive = async () => {
    if (activeSeconds >= 12 * 60 * 60 && !await requestConfirmation({
      title: '确认保存超长专注',
      message: `本次有效专注已达 ${formatDuration(activeSeconds)}。请确认设备时间与记录时长无误后再保存。`,
      confirmLabel: '确认保存',
      tone: 'warning',
    })) return;
    const session = await activeState.finish(note);
    setNote('');
    if (session.mode === 'pomodoro') signalTargetReached(session.id, session.subjectId, session.targetMinutes);
    setCompletion(session);
    setSuccess('本次专注已保存。');
  };

  const finishRecovery = async () => {
    const session = await activeState.finishRecoveryAtLastTrusted();
    if (session.mode === 'pomodoro') signalTargetReached(session.id, session.subjectId, session.targetMinutes);
    setCompletion(session);
    setSuccess('已按最后可信时间保存本次专注。');
  };

  const submitManual = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      const startedAt = new Date(manualStartedAt);
      const enteredMinutes = Number(manualMinutes);
      const endedAt = manualEndedAt ? new Date(manualEndedAt) : new Date(startedAt.getTime() + enteredMinutes * 60_000);
      const activeSeconds = Math.floor(enteredMinutes * 60);
      const submittedAt = new Date();
      if (!manualSubjectId || !manualStartedAt || !Number.isFinite(startedAt.getTime()) || !Number.isInteger(enteredMinutes) || enteredMinutes < 1 || !Number.isFinite(endedAt.getTime()) || endedAt > submittedAt) {
        throw new Error('请填写主题、开始时间，以及有效的结束时间或有效分钟；结束时间不能晚于现在。');
      }
      const timestamp = submittedAt.toISOString();
      const common = {
        id: crypto.randomUUID(), source: 'manual' as const, subjectId: manualSubjectId,
        startedAt: startedAt.toISOString(), endedAt: endedAt.toISOString(), activeSeconds, interruptions: parseInterruptions(manualInterruptions, timeZone),
        ...(manualNote.trim() ? { note: manualNote.trim() } : {}), localDate: localDateAt(endedAt.toISOString(), timeZone), timeZone, createdAt: timestamp, updatedAt: timestamp,
      };
      await createManualSession(manualMode === 'pomodoro'
        ? { ...common, mode: 'pomodoro', targetMinutes: Number(manualTarget) }
        : { ...common, mode: 'free' });
      setShowManual(false); setManualStartedAt(''); setManualEndedAt(''); setManualMinutes(''); setManualMode('free'); setManualTarget('25'); setManualNote(''); setManualInterruptions([]); setFormError(null); setSuccess('补录记录已保存。');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '无法补录专注记录。');
    }
  };

  const openSubjectEditor = (id: string) => {
    const subject = focusSubjects.find((candidate) => candidate.id === id);
    if (!subject) return;
    setEditingSubjectId(id);
    setEditingName(subject.name);
    setEditingTarget(subject.weeklyTargetMinutes?.toString() ?? '');
    setEditingColor(subject.color);
    setEditingBackgroundPolicy(subject.defaultBackgroundPolicy ?? 'continue');
  };

  const saveSubjectEditor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingSubjectId) return;
    try {
      const target = editingTarget ? Number(editingTarget) : undefined;
      await updateSubject(editingSubjectId, { name: editingName, color: editingColor, weeklyTargetMinutes: target, defaultBackgroundPolicy: editingBackgroundPolicy });
      setEditingSubjectId(null); setFormError(null);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '无法更新专注主题。');
    }
  };

  const moveSubject = async (id: string, direction: -1 | 1) => {
    const ordered = [...focusSubjects].sort((left, right) => left.order - right.order);
    const index = ordered.findIndex((subject) => subject.id === id);
    const targetIndex = index + direction;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    [ordered[index], ordered[targetIndex]] = [ordered[targetIndex], ordered[index]];
    try {
      await reorderSubjects(ordered.map((subject) => subject.id));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '无法调整主题顺序。');
    }
  };

  const openSessionEditor = (session: FocusSession) => {
    setEditingSession(session);
    setEditingSessionSubjectId(session.subjectId);
    setEditingSessionStartedAt(formatInputInTimeZone(session.startedAt, session.timeZone));
    setEditingSessionEndedAt(formatInputInTimeZone(session.endedAt, session.timeZone));
    setEditingSessionSeconds(String(session.activeSeconds));
    setEditingSessionMode(session.mode);
    setEditingSessionTarget(session.mode === 'pomodoro' ? String(session.targetMinutes) : '25');
    setEditingSessionNote(session.note ?? '');
    setEditingSessionInterruptions(session.interruptions.map((item) => interruptionDraft(session.timeZone, item)));
    setFormError(null);
  };

  const saveSessionEditor = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingSession) return;
    try {
      const startedAtIso = parseInputInTimeZone(editingSessionStartedAt, editingSession.timeZone);
      const endedAtIso = parseInputInTimeZone(editingSessionEndedAt, editingSession.timeZone);
      const startedAt = new Date(startedAtIso);
      const endedAt = new Date(endedAtIso);
      const activeSeconds = Number(editingSessionSeconds);
      const targetMinutes = Number(editingSessionTarget);
      if (!editingSessionSubjectId || !Number.isFinite(startedAt.getTime()) || !Number.isFinite(endedAt.getTime()) || endedAt > new Date()) {
        throw new Error('请填写已有主题、有效的起止时间，且结束时间不能晚于现在。');
      }
      const { targetMinutes: _discardTargetMinutes, ...sessionBase } = editingSession;
      void _discardTargetMinutes;
      const common = {
        ...sessionBase, subjectId: editingSessionSubjectId, startedAt: startedAtIso, endedAt: endedAtIso, activeSeconds,
        interruptions: parseInterruptions(editingSessionInterruptions, editingSession.timeZone),
        note: editingSessionNote.trim() || undefined, localDate: localDateAt(endedAtIso, editingSession.timeZone), updatedAt: new Date().toISOString(),
      };
      await updateSession(editingSessionMode === 'pomodoro'
        ? { ...common, mode: 'pomodoro', targetMinutes }
        : { ...common, mode: 'free' });
      setEditingSession(null);
      setFormError(null);
      setSuccess('专注记录已保存；涉及计时事实的修改会标记为人工修正。');
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '无法更新专注记录。');
    }
  };

  const completionSummary = completion ? summarizeFocusCompletion(completion) : null;
  const isReview = mode === 'review';
  return <main className={`focus-view${panel ? ' focus-view--panel' : ''}`} aria-label={isReview ? '专注复盘' : panel ? '专注计时' : '独立专注计时'}>
    <header className="focus-view__header">
      <div><span>{isReview ? '数据复盘' : panel ? '每日专注' : '独立专注'}</span><h1>{isReview ? '专注复盘' : panel ? '专注' : '把时间留给真正重要的主题'}</h1><p>{isReview ? '回顾投入、打断与历史修正；开始专注请使用每日安排。' : panel ? '开始一次专注，或管理主题和记录。' : '记录真实投入，不关联项目、任务或日程。'}</p></div>
      <div className="focus-view__header-actions">
        {isReview ? <button type="button" className="focus-ghost-button" onClick={() => { setShowManual(true); setFormError(null); }}>添加记录</button> : <><button type="button" className="focus-ghost-button" onClick={() => { setShowManual(true); setShowCreate(false); setFormError(null); }}>添加记录</button><button type="button" className="focus-primary-button" onClick={() => { setShowCreate(true); setShowManual(false); setFormError(null); }}><Plus size={16} />新建主题</button><details className="focus-menu focus-completion-menu"><summary aria-label="完成提醒设置">提醒</summary><div><label><input type="checkbox" checked={completionPreferences.sound} onChange={(event) => { if (event.target.checked) primeFocusCompletionSound(); updateCompletionPreferences({ sound: event.target.checked }); }} />完成时提示音</label><label><input type="checkbox" checked={completionPreferences.browserNotification} onChange={(event) => void setBrowserNotification(event.target.checked)} />浏览器通知</label><small>仅在番茄目标达成时提醒，不会自动开始下一轮。</small></div></details>{onOpenReview && <button type="button" className="focus-ghost-button" onClick={onOpenReview}>查看复盘</button>}</>}
      </div>
    </header>

    {showCreate && <div className="focus-modal"><form className="focus-create" role="dialog" aria-modal="true" aria-label="新建专注主题" onSubmit={submitSubject}>
      <div className="focus-form__heading"><div><span>主题设置</span><h2>新建专注主题</h2></div><button type="button" aria-label="关闭新建主题" onClick={() => { setShowCreate(false); setFormError(null); }}><X size={17} /></button></div>
      <label>主题名称<input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：数学分析" /></label>
      <label className="focus-color-field">主题颜色<input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
      <label>每周目标（分钟，可选）<input type="number" min="1" max="10080" step="1" value={weeklyTarget} onChange={(event) => setWeeklyTarget(event.target.value)} /></label>
      <label>后台行为<select value={backgroundPolicy} onChange={(event) => setBackgroundPolicy(event.target.value === 'auto-pause' ? 'auto-pause' : 'continue')}><option value="continue">后台持续计时</option><option value="auto-pause">离开页面自动暂停</option></select></label>
      <div className="focus-form__actions"><button type="button" onClick={() => setShowCreate(false)}>取消</button><button type="submit" className="focus-primary-button">创建主题</button></div>
      {formError && <p role="alert" className="focus-error">{formError}</p>}
    </form></div>}

    {showManual && <div className="focus-modal"><form className="focus-create focus-create--wide" role="dialog" aria-modal="true" aria-label="添加专注记录" onSubmit={submitManual}>
      <div className="focus-form__heading"><div><span>历史记录</span><h2>添加专注记录</h2></div><button type="button" aria-label="关闭添加记录" onClick={() => { setShowManual(false); setFormError(null); }}><X size={17} /></button></div>
      <label>专注主题<select value={manualSubjectId} onChange={(event) => setManualSubjectId(event.target.value)}><option value="">请选择主题</option>{focusSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
      <label>开始时间<input required type="datetime-local" step="1" value={manualStartedAt} onChange={(event) => updateManualStart(event.target.value)} /></label>
      <label>结束时间<input type="datetime-local" step="1" disabled={!manualStartedAt} value={manualEndedAt} onChange={(event) => updateManualEnd(event.target.value)} /></label>
      <label>有效分钟<input type="number" min="1" step="1" disabled={!manualStartedAt} value={manualMinutes} onChange={(event) => updateManualMinutes(event.target.value)} /></label>
      <label>模式<select value={manualMode} onChange={(event) => setManualMode(event.target.value === 'pomodoro' ? 'pomodoro' : 'free')}><option value="free">自由计时</option><option value="pomodoro">番茄钟</option></select></label>
      {manualMode === 'pomodoro' && <label>番茄目标（5–240 分钟）<input type="number" min="5" max="240" step="5" value={manualTarget} onChange={(event) => setManualTarget(event.target.value)} /></label>}
      <label className="focus-form__full">备注（可选）<input maxLength={200} value={manualNote} onChange={(event) => setManualNote(event.target.value.replace(/[\r\n]/g, ''))} /></label>
      <InterruptionFields drafts={manualInterruptions} onChange={setManualInterruptions} />
      <div className="focus-form__actions"><button type="button" onClick={() => setShowManual(false)}>取消</button><button type="submit" className="focus-primary-button">保存补录</button></div>
      {formError && <p role="alert" className="focus-error">{formError}</p>}
    </form></div>}

    {editingSubjectId && <div className="focus-modal"><form className="focus-create" role="dialog" aria-modal="true" aria-label="编辑专注主题" onSubmit={saveSubjectEditor}>
      <div className="focus-form__heading"><div><span>主题设置</span><h2>编辑专注主题</h2></div><button type="button" aria-label="关闭编辑主题" onClick={() => setEditingSubjectId(null)}><X size={17} /></button></div>
      <label>主题名称<input autoFocus value={editingName} onChange={(event) => setEditingName(event.target.value)} /></label>
      <label className="focus-color-field">主题颜色<input type="color" value={editingColor} onChange={(event) => setEditingColor(event.target.value)} /></label>
      <label>每周目标（分钟，可留空）<input type="number" min="1" max="10080" step="1" value={editingTarget} onChange={(event) => setEditingTarget(event.target.value)} /></label>
      <label>后台行为<select value={editingBackgroundPolicy} onChange={(event) => setEditingBackgroundPolicy(event.target.value === 'auto-pause' ? 'auto-pause' : 'continue')}><option value="continue">后台持续计时</option><option value="auto-pause">离开页面自动暂停</option></select></label>
      <div className="focus-form__actions"><button type="button" onClick={() => setEditingSubjectId(null)}>取消</button><button type="submit" className="focus-primary-button">保存修改</button></div>
      {formError && <p role="alert" className="focus-error">{formError}</p>}
    </form></div>}

    {editingSession && <div className="focus-modal"><form className="focus-create focus-create--wide" role="dialog" aria-modal="true" aria-label="修正专注记录" onSubmit={saveSessionEditor}>
      <div className="focus-form__heading"><div><span>历史记录 · {sourceLabel(editingSession.source)}</span><h2>修正专注记录</h2><p>备注可直接更新；主题、时间、时长、模式和打断记录的修改会标记为人工修正。</p></div><button type="button" aria-label="关闭修正记录" onClick={() => setEditingSession(null)}><X size={17} /></button></div>
      <label>专注主题<select value={editingSessionSubjectId} onChange={(event) => setEditingSessionSubjectId(event.target.value)}>{focusSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
      <label>开始时间<input type="datetime-local" step="1" value={editingSessionStartedAt} onChange={(event) => setEditingSessionStartedAt(event.target.value)} /></label>
      <label>结束时间<input type="datetime-local" step="1" value={editingSessionEndedAt} onChange={(event) => setEditingSessionEndedAt(event.target.value)} /></label>
      <label>有效秒数<input type="number" min="60" step="1" value={editingSessionSeconds} onChange={(event) => setEditingSessionSeconds(event.target.value)} /></label>
      <label>模式<select value={editingSessionMode} onChange={(event) => setEditingSessionMode(event.target.value === 'pomodoro' ? 'pomodoro' : 'free')}><option value="free">自由计时</option><option value="pomodoro">番茄钟</option></select></label>
      {editingSessionMode === 'pomodoro' && <label>番茄目标（5–240 分钟）<input type="number" min="5" max="240" step="5" value={editingSessionTarget} onChange={(event) => setEditingSessionTarget(event.target.value)} /></label>}
      <label className="focus-form__full">备注（可选）<input maxLength={200} value={editingSessionNote} onChange={(event) => setEditingSessionNote(event.target.value.replace(/[\r\n]/g, ''))} /></label>
      <InterruptionFields drafts={editingSessionInterruptions} onChange={setEditingSessionInterruptions} />
      <div className="focus-form__actions"><button type="button" onClick={() => setEditingSession(null)}>取消</button><button type="submit" className="focus-primary-button">保存修正</button></div>
      {formError && <p role="alert" className="focus-error">{formError}</p>}
    </form></div>}

    {success && <p className="focus-success" role="status">{success}</p>}
    {completion && completionSummary && <div className="focus-modal"><section className="focus-completion" role="dialog" aria-modal="true" aria-label="本次专注结果"><span>本次结果</span><h2>{completionSummary.targetStatus === 'reached' ? '目标已完成' : '专注已保存'}</h2><div><p><strong>{formatDuration(completionSummary.activeSeconds)}</strong><small>有效时长</small></p><p><strong>{completionSummary.interruptions} 次</strong><small>暂停 / 打断</small></p>{completion.mode === 'pomodoro' && <p><strong>{completionSummary.targetStatus === 'reached' ? '达成' : `差 ${formatDuration(completionSummary.targetDeltaSeconds ?? 0)}`}</strong><small>{completion.targetMinutes} 分钟目标</small></p>}</div>{completion.source === 'recovered' && <p className="focus-completion__note">按最后可信时间保存，未计入页面中断期间的未知时长。</p>}<button type="button" className="focus-primary-button" onClick={() => setCompletion(null)}>完成</button></section></div>}

    {!isReview && <div className="focus-dashboard">
    <section className="focus-section focus-current-section focus-dashboard__current">
      <div className="focus-section__heading"><h2>当前专注</h2></div>
      <div className={`focus-current${activeState.active ? ` has-ring is-${activeState.active.state}` : ''}`} aria-live="polite">
        {activeState.active ? <>
          <FocusRing value={activeState.active.mode === 'pomodoro' ? activeSeconds / (activeState.active.targetMinutes * 60) * 100 : 100} primary={formatTimer(activeSeconds)} label={activeState.active.mode === 'pomodoro' ? '已专注' : '自由计时'} free={activeState.active.mode === 'free'} />
          <div className="focus-current__copy"><div className="focus-current__title"><div><h3>{activeSubject?.name ?? '已归档主题'}</h3><p>{activeState.active.mode === 'pomodoro' ? `${activeState.active.targetMinutes} 分钟番茄` : '自由计时'} · 今日 {formatDuration(todaySeconds)} · 本周 {formatDuration(weekTotalSeconds)} · {activeState.active.state === 'paused' ? '已暂停' : activeState.active.state === 'recovery-needed' ? '等待恢复确认' : '正在记录'}</p></div><span className={`focus-status is-${activeState.active.state}`}>{activeState.finishRequestedAt ? '已停止' : activeState.active.state === 'paused' ? '已暂停' : activeState.active.state === 'recovery-needed' ? '待恢复' : '进行中'}</span></div><strong className="focus-current__duration">{formatTimer(activeSeconds)}</strong>{activeState.active.mode === 'pomodoro' && <div className="focus-current__progress"><i style={{ width: `${Math.min(100, activeSeconds / (activeState.active.targetMinutes * 60) * 100)}%` }} /><span>{activeSeconds >= activeState.active.targetMinutes * 60 ? `目标已完成 · 超时 +${formatDuration(activeSeconds - activeState.active.targetMinutes * 60)}` : `已完成 ${Math.round(activeSeconds / (activeState.active.targetMinutes * 60) * 100)}%`}</span></div>}</div>
          {activeState.active.state === 'recovery-needed' ? <div className="focus-current__actions focus-recovery">
            <p>开始：{new Date(activeState.active.startedAt).toLocaleString()}<br />最后可信时间：{new Date(activeState.active.lastTrustedAt).toLocaleString()}<br />当前时间：{now.toLocaleString()}<br />未知时段：{formatDuration(Math.max(0, Math.floor((now.getTime() - new Date(activeState.active.lastTrustedAt).getTime()) / 1000)))}</p>
            <p>网页无法确认关闭页面后的真实学习状态，因此默认不计未知时段。</p>
            <button type="button" className="focus-primary-button" onClick={() => void finishRecovery()}>按最后可信时间结束并保存</button><button type="button" onClick={() => void activeState.resumeRecovery(false)}>从现在继续，不计中间时间</button><button type="button" onClick={() => setShowRecoveryMore((value) => !value)}>更多处理方式</button>{showRecoveryMore && <button type="button" onClick={() => void activeState.resumeRecovery(true)}>确认中间持续专注并计入至现在</button>}<button type="button" onClick={() => void confirmDiscard()}>放弃本次</button>
          </div> : activeState.finishRequestedAt ? <div className="focus-finish"><strong>本次已专注 {formatDuration(activeSeconds)} · 暂停 {activeState.active.interruptions.length + (activeState.active.currentInterruption ? 1 : 0)} 次</strong><input value={note} maxLength={200} onChange={(event) => setNote(event.target.value.replace(/[\r\n]/g, ''))} placeholder="备注（可选，最多 200 字）" /><button type="button" className="focus-primary-button" onClick={() => void finishActive()}>保存并结束</button><button type="button" onClick={() => { activeState.cancelFinish(); setNote(''); }}>继续计时</button><button type="button" onClick={() => void confirmDiscard()}>放弃本次</button></div> : <div className="focus-current__actions">
            <button type="button" className={activeState.active.state === 'paused' ? 'focus-primary-button' : ''} onClick={() => void (activeState.active?.state === 'running' ? activeState.pause(pauseReason || undefined).then(() => setPauseReason('')) : activeState.resume())}>{activeState.active.state === 'running' ? <Pause size={16} /> : <Play size={16} />}{activeState.active.state === 'running' ? '暂停' : '继续'}</button>
            <button type="button" className="focus-end-button" onClick={activeState.requestFinish}><Square size={14} />结束</button>
            <details className="focus-menu focus-current-menu"><summary aria-label="更多专注设置"><MoreHorizontal size={18} /></summary><div>
              {activeState.active.state === 'running' && <label>暂停原因<select value={pauseReason} onChange={(event) => setPauseReason(event.target.value as FocusInterruptionReason | '')}><option value="">不记录原因</option><option value="urgent">临时事务</option><option value="people">被他人打断</option><option value="energy">精力不足</option><option value="switch-task">切换任务</option><option value="other">其他</option></select></label>}
              <label>后台策略<select value={activeState.active.backgroundPolicy} onChange={(event) => void activeState.setBackgroundPolicy(event.target.value === 'auto-pause' ? 'auto-pause' : 'continue')}><option value="continue">后台持续计时</option><option value="auto-pause">离开页面自动暂停</option></select></label>
            </div></details>
          </div>}
        </> : <div className="focus-current__copy"><div className="focus-current__title"><div><h3>尚未开始</h3><p>从下方主题开始一次专注。</p></div><span className="focus-status">准备开始</span></div><strong className="focus-current__duration">00:00</strong></div>}
        {activeState.active?.timeAnomalyAt && !activeState.active.timeAnomalyConfirmedAt && <p role="alert" className="focus-error">检测到设备时间可能变更（偏差约 {Math.round((activeState.active.timeAnomalyDeltaMs ?? 0) / 1000)} 秒）。<button type="button" onClick={() => void activeState.confirmTimeAnomaly()}>我已确认本次时长</button></p>}
        {activeState.error && <p role="alert" className="focus-error">{activeState.error}</p>}
      </div>
    </section>

    <section className="focus-section focus-dashboard__subjects"><div className="focus-section__heading"><h2>我的专注主题</h2><span>{subjects.length} 个可用主题</span></div><div className="focus-subjects">
      {(showAllSubjects ? subjects : subjects.slice(0, 6)).map((subject) => {
        const total = totals.find((item) => item.subjectId === subject.id);
        const recent = latestSessionBySubject.get(subject.id);
        const primaryMode = recent?.mode ?? 'pomodoro';
        const primaryTarget = recent?.mode === 'pomodoro' ? recent.targetMinutes : 50;
        const primaryLabel = recent?.mode === 'pomodoro' ? `开始 ${recent.targetMinutes} 分钟` : recent ? '自由计时' : '开始 50 分钟';
        const weekSeconds = focusSessions.filter((session) => !session.deletedAt && session.subjectId === subject.id && week.some((day) => day.localDate === session.localDate)).reduce((sum, session) => sum + session.activeSeconds, 0);
        return <article className="focus-subject" key={subject.id} style={{ '--focus-subject-color': subject.color } as React.CSSProperties}>
          <div className="focus-subject__title"><div><h3>{subject.name}</h3><p>累计 {formatDuration(total?.activeSeconds ?? 0)}</p></div><details className="focus-menu focus-subject-menu"><summary aria-label={`${subject.name}主题操作`}><MoreHorizontal size={18} /></summary><div><button type="button" onClick={() => setDetailSubjectId(subject.id)}>查看详情</button><button type="button" onClick={() => openSubjectEditor(subject.id)}>编辑主题</button><button type="button" onClick={() => void moveSubject(subject.id, -1)}>上移</button><button type="button" onClick={() => void moveSubject(subject.id, 1)}>下移</button><button type="button" onClick={() => void archiveSubject(subject.id, true)}><Archive size={14} />归档</button></div></details></div>
          <div className="focus-subject__week"><div><span>本周投入</span><strong>{formatDuration(weekSeconds)}</strong></div>{subject.weeklyTargetMinutes && <FocusRing value={weekSeconds / (subject.weeklyTargetMinutes * 60) * 100} primary={`${Math.round(Math.min(100, weekSeconds / (subject.weeklyTargetMinutes * 60) * 100))}%`} label="周目标" />}</div>
          <div className="focus-subject__actions"><button type="button" className="focus-primary-button" disabled={Boolean(activeState.active)} onClick={() => void start(subject.id, primaryMode, primaryMode === 'pomodoro' ? primaryTarget : undefined)}>{primaryLabel}</button><details className="focus-menu focus-start-menu"><summary aria-label={`${subject.name}更多开始方式`}><ChevronDown size={17} /></summary><div>
            <strong>开始 {subject.name}</strong><button type="button" disabled={Boolean(activeState.active)} onClick={() => void start(subject.id, 'free')}>自由计时</button><button type="button" disabled={Boolean(activeState.active)} onClick={() => void start(subject.id, 'pomodoro', 25)}>25 分钟</button><button type="button" disabled={Boolean(activeState.active)} onClick={() => void start(subject.id, 'pomodoro', 50)}>50 分钟</button><button type="button" disabled={Boolean(activeState.active)} onClick={() => void start(subject.id, 'pomodoro', 90)}>90 分钟</button>
            <label>自定义分钟<input type="number" min="5" max="240" step="5" value={customMinutes} onChange={(event) => setCustomMinutes(event.target.value)} /></label><button type="button" disabled={Boolean(activeState.active) || Number(customMinutes) < 5 || Number(customMinutes) > 240 || Number(customMinutes) % 5 !== 0} onClick={() => void start(subject.id, 'pomodoro', Number(customMinutes))}>开始自定义番茄</button>
            <label>后台行为<select value={nextBackgroundPolicy} onChange={(event) => setNextBackgroundPolicy(event.target.value === 'continue' || event.target.value === 'auto-pause' ? event.target.value : '')}><option value="">使用主题默认值</option><option value="continue">后台持续计时</option><option value="auto-pause">离开页面自动暂停</option></select></label>
          </div></details></div>
        </article>;
      })}
      {subjects.length === 0 && <div className="focus-empty"><Clock3 size={22} /><strong>先创建一个专注主题</strong><p>主题完全独立于项目和日程。</p></div>}
    </div>{subjects.length > 6 && <button type="button" className="focus-show-subjects" onClick={() => setShowAllSubjects((value) => !value)}>{showAllSubjects ? '收起主题' : `查看全部 ${subjects.length} 个主题`}</button>}{focusSubjects.some((subject) => subject.archivedAt) && <div className="focus-archived">已归档：{focusSubjects.filter((subject) => subject.archivedAt).map((subject) => <button type="button" key={subject.id} onClick={() => void archiveSubject(subject.id, false)}>恢复 {subject.name}</button>)}</div>}</section>

    {detailSubject && <section className="focus-section focus-detail focus-dashboard__detail" aria-label={`${detailSubject.name}主题详情`}><div className="focus-section__heading"><div><span>主题详情</span><h2>{detailSubject.name}</h2></div><button type="button" onClick={() => setDetailSubjectId(null)}>关闭</button></div><div className="focus-detail__metrics"><p><strong>{formatDuration(detailSessions.reduce((sum, session) => sum + session.activeSeconds, 0))}</strong><span>累计专注</span></p><p><strong>{formatDuration(detailWeekSeconds)}</strong><span>本周专注</span></p><p><strong>{detailSubject.weeklyTargetMinutes ? `${Math.round(detailWeekSeconds / (detailSubject.weeklyTargetMinutes * 60) * 100)}%` : '未设置'}</strong><span>周目标完成度</span></p></div><h3>最近 7 天趋势</h3><svg className="focus-trend-line" viewBox="0 0 100 100" role="img" aria-label={`${detailSubject.name}最近七天专注趋势`}><polyline points={detailTrendPoints} /></svg><ol className="focus-trend-values">{detailWeekTrend.map((day) => <li key={day.localDate}><span>{day.localDate.slice(5)}</span><strong>{formatDuration(day.activeSeconds)}</strong></li>)}</ol><h3>最近会话</h3><div className="focus-history">{[...detailSessions].sort((left, right) => right.endedAt.localeCompare(left.endedAt)).slice(0, 5).map((session) => <article key={session.id}><span>{session.localDate}</span><strong>{formatDuration(session.activeSeconds)}</strong><span>{session.mode === 'pomodoro' ? `${session.targetMinutes} 分钟番茄` : '自由计时'}</span></article>)}</div></section>}

    </div>}

    {isReview && <><FocusStatisticsDashboard sessions={focusSessions} subjects={focusSubjects} weeklyReviews={focusWeeklyReviews} today={today} onSaveWeeklyReview={saveWeeklyReview} />

    <section className="focus-section focus-history-section"><div className="focus-section__heading"><h2>最近记录</h2><span>{visibleHistorySessions.length} 条已保存会话</span></div><div className="focus-history-filters" aria-label="最近记录筛选">
      <label>主题<select aria-label="按主题筛选" value={historySubjectId} onChange={(event) => setHistorySubjectId(event.target.value)}><option value="">全部主题</option>{focusSubjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
      <label>模式<select aria-label="按模式筛选" value={historyMode} onChange={(event) => setHistoryMode(event.target.value as 'all' | 'free' | 'pomodoro')}><option value="all">全部模式</option><option value="free">自由计时</option><option value="pomodoro">番茄钟</option></select></label>
      <label>时间<select aria-label="按时间筛选" value={historyRange} onChange={(event) => setHistoryRange(event.target.value as 'all' | 'today' | 'last7' | 'last30' | 'custom')}><option value="all">全部时间</option><option value="today">今天</option><option value="last7">最近 7 天</option><option value="last30">最近 30 天</option><option value="custom">自定义范围</option></select></label>
      {historyRange === 'custom' && <><label>开始日期<input aria-label="记录开始日期" type="date" value={historyStart} onChange={(event) => setHistoryStart(event.target.value)} /></label><label>结束日期<input aria-label="记录结束日期" type="date" value={historyEnd} onChange={(event) => setHistoryEnd(event.target.value)} /></label></>}
      {(historySubjectId || historyMode !== 'all' || historyRange !== 'all' || historyStart || historyEnd) && <button type="button" onClick={() => { setHistorySubjectId(''); setHistoryMode('all'); setHistoryRange('all'); setHistoryStart(''); setHistoryEnd(''); }}>清除筛选</button>}
    </div><div className="focus-history">{visibleHistorySessions.slice(0, 12).map((session) => <article key={session.id}><div><strong>{focusSubjects.find((subject) => subject.id === session.subjectId)?.name ?? '已删除主题'}</strong><span>{session.localDate} · {formatDuration(session.activeSeconds)} · {session.mode === 'pomodoro' ? `${session.targetMinutes} 分钟番茄` : '自由计时'} · {sourceLabel(session.source)}{session.correctedAt ? ' · 已人工修正' : ''}</span>{session.note && <em>{session.note}</em>}</div><button type="button" onClick={() => openSessionEditor(session)}>修正</button><button type="button" aria-label="删除专注记录" onClick={() => void removeSession(session.id)}><Trash2 size={16} /></button></article>)}{visibleHistorySessions.length === 0 && <div className="focus-empty"><RotateCcw size={22} /><strong>{focusSessions.some((session) => !session.deletedAt) ? '没有符合筛选条件的记录' : '还没有正式记录'}</strong><p>{focusSessions.some((session) => !session.deletedAt) ? '调整筛选条件后再试。' : '进行中的计时会在保存后出现在这里。'}</p></div>}</div></section></>}
  </main>;
};

export default FocusView;

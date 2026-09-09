import React from 'react';
import { Clock3, Play, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useActiveFocusStore } from '@/focus/activeSession';
import { currentFocusWorkspaceId } from '@/focus/persistence';
import { useFocusStore } from '@/focus/store';
import { loadFocusCompletionPreferences, primeFocusCompletionSound } from '@/focus/completion';
import '@/styles/focus.css';

interface FocusQuickStartProps {
  open: boolean;
  onClose: () => void;
  onOpenPanel: () => void;
}

const FocusQuickStart: React.FC<FocusQuickStartProps> = ({ open, onClose, onOpenPanel }) => {
  const { focusSubjects, focusSessions } = useFocusStore(useShallow((state) => ({
    focusSubjects: state.focusSubjects,
    focusSessions: state.focusSessions,
  })));
  const subjects = React.useMemo(() => focusSubjects.filter((subject) => !subject.archivedAt).sort((left, right) => left.order - right.order), [focusSubjects]);
  const sessions = React.useMemo(() => focusSessions.filter((session) => !session.deletedAt).sort((left, right) => right.endedAt.localeCompare(left.endedAt)), [focusSessions]);
  const active = useActiveFocusStore((state) => state.active);
  const start = useActiveFocusStore((state) => state.start);
  const [subjectId, setSubjectId] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const recentSessions = React.useMemo(() => {
    const seen = new Set<string>();
    return sessions.filter((session) => !seen.has(session.subjectId) && seen.add(session.subjectId)).slice(0, 3);
  }, [sessions]);

  React.useEffect(() => {
    if (!open) return;
    setSubjectId((current) => current && subjects.some((subject) => subject.id === current)
      ? current
      : recentSessions[0]?.subjectId ?? subjects[0]?.id ?? '');
  }, [open, recentSessions, subjects]);
  if (!open) return null;
  const startFocus = async (id: string, mode: 'free' | 'pomodoro', targetMinutes?: number) => {
    const subject = subjects.find((item) => item.id === id);
    if (!subject || active) return;
    try {
      if (loadFocusCompletionPreferences().sound) primeFocusCompletionSound();
      await start({
        workspaceId: currentFocusWorkspaceId(), subjectId: subject.id,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        backgroundPolicy: subject.defaultBackgroundPolicy ?? 'continue',
        ...(mode === 'pomodoro' ? { mode, targetMinutes: targetMinutes! } : { mode }),
      });
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法开始专注。');
    }
  };
  const currentRecent = recentSessions.find((session) => session.subjectId === subjectId);
  const modeLabel = (session: typeof currentRecent) => session?.mode === 'pomodoro' ? `${session.targetMinutes} 分钟` : '自由计时';
  const primaryMode = currentRecent?.mode ?? 'pomodoro';
  const primaryTarget = currentRecent?.mode === 'pomodoro' ? currentRecent.targetMinutes : 50;
  const primaryLabel = currentRecent ? modeLabel(currentRecent) : '50 分钟';
  return <div className="focus-quick-start-backdrop" role="presentation" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
    <section className="focus-quick-start" role="dialog" aria-modal="true" aria-label="快速开始专注">
      <header><div><span>专注</span><h2>{active ? '当前已有进行中的专注' : '快速开始专注'}</h2></div><button type="button" onClick={onClose} aria-label="关闭快速开始专注"><X size={18} /></button></header>
      {active ? <div className="focus-quick-start__active"><Clock3 size={18} /><p>请先在下方控制条完成、暂停或继续当前专注。</p><button type="button" className="focus-primary-button" onClick={() => { onClose(); onOpenPanel(); }}>打开专注面板</button></div> : subjects.length ? <>{recentSessions.length > 0 && <section className="focus-quick-start__recent" aria-label="最近专注"><span>最近专注</span><div>{recentSessions.map((session) => { const subject = subjects.find((item) => item.id === session.subjectId); return <button type="button" key={session.id} onClick={() => void startFocus(session.subjectId, session.mode, session.mode === 'pomodoro' ? session.targetMinutes : undefined)}><strong>{subject?.name ?? '已归档主题'}</strong><small>开始 {modeLabel(session)}</small></button>; })}</div></section>}<label>专注主题<select value={subjectId} onChange={(event) => setSubjectId(event.target.value)}>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><div className="focus-quick-start__modes"><button type="button" className="focus-primary-button" onClick={() => void startFocus(subjectId, primaryMode, primaryMode === 'pomodoro' ? primaryTarget : undefined)}><Play size={15} />开始 {primaryLabel}</button><button type="button" onClick={() => void startFocus(subjectId, 'free')}>自由计时</button>{[25, 50, 90].filter((minutes) => currentRecent?.mode !== 'pomodoro' || currentRecent.targetMinutes !== minutes).map((minutes) => <button key={minutes} type="button" onClick={() => void startFocus(subjectId, 'pomodoro', minutes)}>{minutes} 分钟</button>)}</div><button type="button" className="focus-quick-start__more" onClick={() => { onClose(); onOpenPanel(); }}>更多方式、主题管理与记录补录</button></> : <div className="focus-quick-start__active"><p>先创建一个专注主题，再开始记录。</p><button type="button" className="focus-primary-button" onClick={() => { onClose(); onOpenPanel(); }}>打开专注面板</button></div>}
      {error && <p className="focus-error" role="alert">{error}</p>}
    </section>
  </div>;
};

export default FocusQuickStart;

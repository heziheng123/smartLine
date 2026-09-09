import React from 'react';
import { Clock3, Pause, Play, Square } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useActiveFocusStore } from '@/focus/activeSession';
import { elapsedActiveMs } from '@/focus/session';
import { useFocusStore } from '@/focus/store';
import '@/styles/focus.css';

const format = (seconds: number) => `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds % 3600 / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;

const FocusControlBar: React.FC<{ onOpen: () => void }> = ({ onOpen }) => {
  const active = useActiveFocusStore((state) => state.active);
  const finishRequestedAt = useActiveFocusStore((state) => state.finishRequestedAt);
  const pause = useActiveFocusStore((state) => state.pause);
  const resume = useActiveFocusStore((state) => state.resume);
  const requestFinish = useActiveFocusStore((state) => state.requestFinish);
  const subject = useFocusStore(useShallow((state) => state.focusSubjects.find((item) => item.id === active?.subjectId)));
  const [now, setNow] = React.useState(() => new Date());
  React.useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  if (!active) return null;
  const seconds = Math.floor(elapsedActiveMs(active, finishRequestedAt ?? now) / 1000);
  return <aside className={`focus-control-bar is-${active.state}`} aria-label="当前专注控制条">
    <button type="button" className="focus-control-bar__open" onClick={onOpen}><Clock3 size={18} /><span>{subject?.name ?? '当前专注'} · {finishRequestedAt ? '已停止' : active.state === 'running' ? '进行中' : active.state === 'paused' ? '已暂停' : '待恢复'}</span><strong>{format(seconds)}</strong></button>
    {!finishRequestedAt && active.state !== 'recovery-needed' && <button type="button" className="focus-control-bar__action" onClick={() => void (active.state === 'running' ? pause() : resume())} aria-label={active.state === 'running' ? '暂停专注' : '继续专注'}>{active.state === 'running' ? <Pause size={17} /> : <Play size={17} />}</button>}
    {!finishRequestedAt && active.state !== 'recovery-needed' && <button type="button" className="focus-control-bar__action focus-control-bar__finish" onClick={() => { requestFinish(); onOpen(); }} aria-label="结束专注"><Square size={15} /></button>}
  </aside>;
};

export default FocusControlBar;

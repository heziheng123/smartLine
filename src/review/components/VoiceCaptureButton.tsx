import { useEffect, useRef, useState } from 'react';
import { Mic, Pause, Square } from 'lucide-react';
import { LocalOnlyAudioCapture, type CapturedVoiceAudio } from '@/review/audio';
import type { VoiceAudioRetention } from '@/review/model';

interface VoiceCaptureButtonProps {
  disabled?: boolean;
  retention: VoiceAudioRetention;
  onStarted: (segmentId: string) => void;
  onPaused: (audio: CapturedVoiceAudio) => Promise<void> | void;
  onFinished: (audio: CapturedVoiceAudio[]) => Promise<void> | void;
  onError: (message: string) => void;
}

const BAR_COUNT = 24;

function formatElapsed(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export default function VoiceCaptureButton({ disabled, retention, onStarted, onPaused, onFinished, onError }: VoiceCaptureButtonProps) {
  const capture = useRef<LocalOnlyAudioCapture | null>(null);
  const captured = useRef<CapturedVoiceAudio[]>([]);
  const channel = useRef<BroadcastChannel | null>(null);
  const tabId = useRef(crypto.randomUUID());
  const stopping = useRef(false);
  const mounted = useRef(true);
  const startedAt = useRef<number>(0);
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'saving'>('idle');
  const [otherTabRecording, setOtherTabRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [silentSeconds, setSilentSeconds] = useState(0);

  useEffect(() => {
    const currentTabId = tabId.current;
    const next = 'BroadcastChannel' in window ? new BroadcastChannel('smart-line-review-voice') : null;
    channel.current = next;
    if (next) next.onmessage = (event: MessageEvent<{ tabId?: string; recording?: boolean }>) => {
      if (event.data?.tabId !== currentTabId) setOtherTabRecording(Boolean(event.data?.recording));
    };
    return () => {
      mounted.current = false;
      capture.current?.interrupt(); capture.current = null;
      next?.postMessage({ tabId: currentTabId, recording: false }); next?.close();
    };
  }, []);

  useEffect(() => {
    if (state !== 'recording') return;
    const timer = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - startedAt.current) / 1000));
    }, 500);
    return () => window.clearInterval(timer);
  }, [state]);

  useEffect(() => {
    if (state !== 'recording') {
      setSilentSeconds(0);
      return;
    }
    if (level < 0.05) setSilentSeconds((value) => value + 1);
    else setSilentSeconds(0);
  }, [level, state, elapsed]);

  const stop = async (finish: boolean) => {
    const active = capture.current;
    if (!active || stopping.current) return;
    stopping.current = true;
    setState('saving');
    setLevel(0);
    try {
      const audio = await active.stop();
      captured.current = [...captured.current, audio];
      await onPaused(audio);
      if (finish) {
        await onFinished(captured.current);
        captured.current = [];
        if (mounted.current) {
          setState('idle');
          setElapsed(0);
        }
      } else if (mounted.current) setState('paused');
    } catch (error) {
      if (mounted.current) {
        setState(captured.current.length ? 'paused' : 'idle');
        onError(error instanceof Error ? error.message : '录音保存失败，请改用文字输入。');
      }
    } finally {
      if (capture.current === active) capture.current = null;
      stopping.current = false;
      channel.current?.postMessage({ tabId: tabId.current, recording: false });
    }
  };

  const start = async () => {
    const segmentId = `voice-segment-${crypto.randomUUID()}`;
    let next: LocalOnlyAudioCapture | null = null;
    try {
      next = new LocalOnlyAudioCapture(segmentId, retention, undefined, () => {
        if (mounted.current) onError('已达到单段音频大小上限，录音已自动结束；如需继续，请再录一段。');
        void stop(true);
      }, (value) => {
        if (mounted.current) setLevel(value);
      });
      capture.current = next;
      await next.start();
      if (!mounted.current) return;
      startedAt.current = Date.now();
      setElapsed(0);
      setLevel(0);
      onStarted(segmentId);
      setState('recording');
      channel.current?.postMessage({ tabId: tabId.current, recording: true });
    } catch (error) {
      next?.interrupt();
      if (capture.current === next) capture.current = null;
      if (mounted.current) {
        setState(captured.current.length ? 'paused' : 'idle');
        onError(error instanceof Error ? error.message : '无法开始录音，请改用文字输入。');
      }
    }
  };

  const meter = (active: boolean) => (
    <span className="review-voice-meter" aria-hidden={!active} role={active ? 'img' : undefined} aria-label={active ? '正在检测到声音' : undefined}>
      <span className="review-voice-meter__bars">
        {Array.from({ length: BAR_COUNT }, (_, index) => {
          const threshold = (index + 1) / BAR_COUNT;
          return <i key={index} className={level >= threshold ? 'is-on' : undefined} style={{ height: `${4 + (index % 5) * 3}px` }} />;
        })}
      </span>
      <span className="review-voice-meter__time">{formatElapsed(elapsed)}</span>
      {elapsed >= 300 && <span className="review-voice-meter__hint">已录 {Math.floor(elapsed / 60)} 分钟</span>}
      {silentSeconds >= 5 && active && <span className="review-voice-meter__warn">好像没收到声音，靠近麦克风试试</span>}
      {!active && elapsed > 0 && <span className="review-voice-meter__hint">已暂停 {formatElapsed(elapsed)}</span>}
    </span>
  );

  if (state === 'recording') return (
    <span className="review-source-actions review-source-actions--recording">
      {meter(true)}
      <button type="button" className="review-button review-button--recording" onClick={() => void stop(false)}><Pause size={16} />暂停思考</button>
      <button type="button" className="review-button review-button--recording" onClick={() => void stop(true)}><Square size={16} />说完了</button>
    </span>
  );
  if (state === 'paused') return (
    <span className="review-source-actions review-source-actions--recording">
      {meter(false)}
      <button type="button" className="review-button" onClick={() => void start()}><Mic size={16} />继续说</button>
      <button type="button" className="review-button review-button--primary" onClick={() => void Promise.resolve(onFinished(captured.current)).then(() => { captured.current = []; setState('idle'); setElapsed(0); }).catch((error: unknown) => onError(error instanceof Error ? error.message : '无法开始识别。'))}><Square size={16} />说完了并识别</button>
    </span>
  );
  return <button type="button" className="review-button" disabled={disabled || state === 'saving' || otherTabRecording} title={otherTabRecording ? '另一标签页正在录音，请先结束该录音。' : undefined} onClick={() => void start()}><Mic size={16} />{state === 'saving' ? '正在保存录音…' : otherTabRecording ? '另一标签页正在录音' : '开始说'}</button>;
}

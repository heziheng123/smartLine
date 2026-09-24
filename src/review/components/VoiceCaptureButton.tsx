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

export default function VoiceCaptureButton({ disabled, retention, onStarted, onPaused, onFinished, onError }: VoiceCaptureButtonProps) {
  const capture = useRef<LocalOnlyAudioCapture | null>(null);
  const captured = useRef<CapturedVoiceAudio[]>([]);
  const channel = useRef<BroadcastChannel | null>(null);
  const tabId = useRef(crypto.randomUUID());
  const stopping = useRef(false);
  const mounted = useRef(true);
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'saving'>('idle');
  const [otherTabRecording, setOtherTabRecording] = useState(false);

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

  const stop = async (finish: boolean) => {
    const active = capture.current;
    if (!active || stopping.current) return;
    stopping.current = true;
    setState('saving');
    try {
      const audio = await active.stop();
      captured.current = [...captured.current, audio];
      await onPaused(audio); // Pausing is local-only: no ASR request here.
      if (finish) {
        await onFinished(captured.current);
        captured.current = [];
        if (mounted.current) setState('idle');
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
      });
      capture.current = next;
      // Request microphone access in the click handler before any async app work.
      await next.start();
      if (!mounted.current) return;
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

  if (state === 'recording') return <span className="review-source-actions"><button type="button" className="review-button review-button--recording" onClick={() => void stop(false)}><Pause size={16} />暂停思考</button><button type="button" className="review-button review-button--recording" onClick={() => void stop(true)}><Square size={16} />说完了</button></span>;
  if (state === 'paused') return <span className="review-source-actions"><button type="button" className="review-button" onClick={() => void start()}><Mic size={16} />继续说</button><button type="button" className="review-button review-button--primary" onClick={() => void Promise.resolve(onFinished(captured.current)).then(() => { captured.current = []; setState('idle'); }).catch((error: unknown) => onError(error instanceof Error ? error.message : '无法开始识别。'))}><Square size={16} />说完了并识别</button></span>;
  return <button type="button" className="review-button" disabled={disabled || state === 'saving' || otherTabRecording} title={otherTabRecording ? '另一标签页正在录音，请先结束该录音。' : undefined} onClick={() => void start()}><Mic size={16} />{state === 'saving' ? '正在保存录音…' : otherTabRecording ? '另一标签页正在录音' : '开始说'}</button>;
}

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
  const [state, setState] = useState<'idle' | 'recording' | 'paused' | 'saving'>('idle');
  const [otherTabRecording, setOtherTabRecording] = useState(false);

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return;
    const next = new BroadcastChannel('smart-line-review-voice'); channel.current = next;
    next.onmessage = (event: MessageEvent<{ tabId?: string; recording?: boolean }>) => {
      if (event.data?.tabId !== tabId.current) setOtherTabRecording(Boolean(event.data?.recording));
    };
    return () => { next.postMessage({ tabId: tabId.current, recording: false }); next.close(); };
  }, []);

  const start = async () => {
    const segmentId = `voice-segment-${crypto.randomUUID()}`;
    try {
      const next = new LocalOnlyAudioCapture(segmentId, retention);
      // Request microphone access in the click handler before any async app work.
      await next.start();
      onStarted(segmentId);
      capture.current = next;
      setState('recording');
      channel.current?.postMessage({ tabId: tabId.current, recording: true });
    } catch (error) {
      setState(captured.current.length ? 'paused' : 'idle');
      onError(error instanceof Error ? error.message : '无法开始录音，请改用文字输入。');
    }
  };

  const stop = async (finish: boolean) => {
    if (!capture.current) return;
    setState('saving');
    try {
      const audio = await capture.current.stop();
      captured.current = [...captured.current, audio];
      await onPaused(audio); // Pausing is local-only: no ASR request here.
      capture.current = null;
      channel.current?.postMessage({ tabId: tabId.current, recording: false });
      if (finish) {
        await onFinished(captured.current);
        captured.current = [];
        setState('idle');
      } else setState('paused');
    } catch (error) {
      capture.current = null;
      channel.current?.postMessage({ tabId: tabId.current, recording: false });
      setState(captured.current.length ? 'paused' : 'idle');
      onError(error instanceof Error ? error.message : '录音保存失败，请改用文字输入。');
    }
  };

  if (state === 'recording') return <span className="review-source-actions"><button type="button" className="review-button review-button--recording" onClick={() => void stop(false)}><Pause size={16} />暂停思考</button><button type="button" className="review-button review-button--recording" onClick={() => void stop(true)}><Square size={16} />说完了</button></span>;
  if (state === 'paused') return <span className="review-source-actions"><button type="button" className="review-button" onClick={() => void start()}><Mic size={16} />继续说</button><button type="button" className="review-button review-button--primary" onClick={() => void Promise.resolve(onFinished(captured.current)).then(() => { captured.current = []; setState('idle'); }).catch((error: unknown) => onError(error instanceof Error ? error.message : '无法开始识别。'))}><Square size={16} />说完了并识别</button></span>;
  return <button type="button" className="review-button" disabled={disabled || state === 'saving' || otherTabRecording} title={otherTabRecording ? '另一标签页正在录音，请先结束该录音。' : undefined} onClick={() => void start()}><Mic size={16} />{state === 'saving' ? '正在保存录音…' : otherTabRecording ? '另一标签页正在录音' : '开始说'}</button>;
}

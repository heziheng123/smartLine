import { createDedicatedStorage } from '@/utils/persistence';
import type { VoiceAudioRetention } from './model';

const storage = createDedicatedStorage('smart-line-review-audio', 'chunks');
const keyFor = (segmentId: string, chunkSeq: number) => `voice-chunk:${segmentId}:${chunkSeq}`;
const metaKeyFor = (segmentId: string) => `voice-meta:${segmentId}`;
const DEVICE_ID_KEY = 'smart-line-review-device-id-v1';
const MIN_FREE_BYTES = 12 * 1024 * 1024;

export async function ensureVoiceStorageCapacity(): Promise<void> {
  if (!navigator.storage?.estimate) return;
  const { quota = 0, usage = 0 } = await navigator.storage.estimate();
  if (quota > 0 && quota - usage < MIN_FREE_BYTES) throw new Error('本机可用空间不足，无法安全保存录音。请清理空间或改用文字输入。');
  if (navigator.storage.persist) await navigator.storage.persist().catch(() => false);
}

export function localReviewDeviceId(): string {
  try {
    const existing = localStorage.getItem(DEVICE_ID_KEY);
    if (existing) return existing;
    const created = `review-device-${crypto.randomUUID()}`;
    localStorage.setItem(DEVICE_ID_KEY, created);
    return created;
  } catch {
    return `review-device-${crypto.randomUUID()}`;
  }
}

export interface CapturedVoiceAudio {
  segmentId: string;
  mimeType: 'audio/wav';
  durationMs: number;
  chunkCount: number;
  byteLength: number;
  sampleRate: number;
}

export interface StoredVoiceAudio extends CapturedVoiceAudio {
  retention: VoiceAudioRetention;
  state: 'recording' | 'ready' | 'deleted';
  updatedAt: string;
  expiresAt?: string;
}

export async function loadStoredVoiceAudio(segmentId: string): Promise<StoredVoiceAudio | null> {
  const value = await storage.getItem<unknown>(metaKeyFor(segmentId));
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const item = value as Partial<StoredVoiceAudio>;
  return item.segmentId === segmentId && item.mimeType === 'audio/wav' && typeof item.chunkCount === 'number' && typeof item.byteLength === 'number' && typeof item.durationMs === 'number' && typeof item.sampleRate === 'number' && ['recording', 'ready', 'deleted'].includes(item.state ?? '') && ['delete_after_transcription', 'keep_7_days', 'keep_30_days'].includes(item.retention ?? '') ? item as StoredVoiceAudio : null;
}

async function saveStoredVoiceAudio(audio: CapturedVoiceAudio, retention: VoiceAudioRetention, state: StoredVoiceAudio['state']): Promise<void> {
  const expiresAt = retention === 'delete_after_transcription' ? undefined : new Date(Date.now() + (retention === 'keep_7_days' ? 7 : 30) * 86_400_000).toISOString();
  await storage.setItem(metaKeyFor(audio.segmentId), { ...audio, retention, state, updatedAt: new Date().toISOString(), ...(expiresAt ? { expiresAt } : {}) } satisfies StoredVoiceAudio);
}

export async function recoverStoredVoiceAudio(segmentId: string): Promise<CapturedVoiceAudio | null> {
  const stored = await loadStoredVoiceAudio(segmentId);
  if (!stored || stored.state === 'deleted' || !stored.chunkCount || !stored.byteLength) return null;
  try { await loadVoicePcmChunks(segmentId, stored.chunkCount); return stored; } catch { return null; }
}

export async function loadVoicePcmChunks(segmentId: string, chunkCount: number): Promise<Blob[]> {
  const chunks = await Promise.all(Array.from({ length: chunkCount }, async (_, index) => storage.getItem<Blob>(keyFor(segmentId, index + 1))));
  if (chunks.some((chunk) => !(chunk instanceof Blob))) throw new Error('本机录音片段不完整，无法继续识别。');
  return chunks as Blob[];
}

export async function deleteVoicePcmChunks(segmentId: string, chunkCount: number): Promise<void> {
  await Promise.all(Array.from({ length: chunkCount }, (_, index) => storage.removeItem(keyFor(segmentId, index + 1))));
}

/** Deletes only after a durable server receipt; retained recordings expire locally. */
export async function settleVoiceAudioRetention(audio: CapturedVoiceAudio, retention: VoiceAudioRetention): Promise<void> {
  if (retention === 'delete_after_transcription') {
    await deleteVoicePcmChunks(audio.segmentId, audio.chunkCount);
    await saveStoredVoiceAudio(audio, retention, 'deleted');
    return;
  }
  await saveStoredVoiceAudio(audio, retention, 'ready');
}

export async function eraseVoiceAudio(audio: CapturedVoiceAudio): Promise<void> {
  await deleteVoicePcmChunks(audio.segmentId, audio.chunkCount);
  await saveStoredVoiceAudio(audio, 'delete_after_transcription', 'deleted');
}

export async function cleanExpiredVoiceAudio(): Promise<void> {
  const keys = await storage.keys();
  const metaKeys = keys.filter((key) => typeof key === 'string' && key.startsWith('voice-meta:')) as string[];
  await Promise.all(metaKeys.map(async (key) => {
    const segmentId = key.slice('voice-meta:'.length); const stored = await loadStoredVoiceAudio(segmentId);
    if (stored?.expiresAt && Date.parse(stored.expiresAt) <= Date.now() && stored.state !== 'deleted') await settleVoiceAudioRetention(stored, 'delete_after_transcription');
  }));
}

function pcmWavHeader(byteLength: number, sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => { for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index)); };
  write(0, 'RIFF'); view.setUint32(4, 36 + byteLength, true); write(8, 'WAVE'); write(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); write(36, 'data'); view.setUint32(40, byteLength, true);
  return buffer;
}

export async function prepareVoiceWav(audio: CapturedVoiceAudio): Promise<Blob> {
  const chunks = await loadVoicePcmChunks(audio.segmentId, audio.chunkCount);
  return new Blob([pcmWavHeader(audio.byteLength, audio.sampleRate), ...chunks], { type: 'audio/wav' });
}

const pcm16 = (samples: Float32Array): ArrayBuffer => {
  const output = new ArrayBuffer(samples.length * 2);
  const view = new DataView(output);
  samples.forEach((sample, index) => view.setInt16(index * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return output;
};

/** Captures mono PCM locally; conversion to a compatible WAV happens only for the one ASR request. */
export class LocalOnlyAudioCapture {
  private readonly segmentId: string;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private gain: GainNode | null = null;
  private pending: Blob[] = [];
  private pendingBytes = 0;
  private chunkCount = 0;
  private byteLength = 0;
  private writeChain = Promise.resolve();
  private readonly retention: VoiceAudioRetention;
  private readonly onProgress?: (audio: CapturedVoiceAudio) => void;
  private readonly startedAt = Date.now();
  private readonly maxDurationMs = 10 * 60_000;

  constructor(segmentId: string, retention: VoiceAudioRetention, onProgress?: (audio: CapturedVoiceAudio) => void) { this.segmentId = segmentId; this.retention = retention; this.onProgress = onProgress; }

  static supported(): boolean { return typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(window.AudioContext); }

  async start(): Promise<void> {
    if (!LocalOnlyAudioCapture.supported()) throw new Error('当前浏览器不支持安全录音，请直接输入文字。');
    await ensureVoiceStorageCapacity();
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
    this.context = new AudioContext({ sampleRate: 16_000 });
    await saveStoredVoiceAudio({ segmentId: this.segmentId, mimeType: 'audio/wav', durationMs: 0, chunkCount: 0, byteLength: 0, sampleRate: this.context.sampleRate }, this.retention, 'recording');
    await this.context.resume();
    this.source = this.context.createMediaStreamSource(this.stream);
    this.processor = this.context.createScriptProcessor(4_096, 1, 1);
    this.gain = this.context.createGain(); this.gain.gain.value = 0;
    this.processor.onaudioprocess = (event) => {
      if (Date.now() - this.startedAt >= this.maxDurationMs) return;
      const blob = new Blob([pcm16(event.inputBuffer.getChannelData(0))], { type: 'application/octet-stream' });
      this.pending.push(blob); this.pendingBytes += blob.size;
      if (this.pendingBytes >= this.context!.sampleRate * 2) this.flush();
    };
    this.source.connect(this.processor); this.processor.connect(this.gain); this.gain.connect(this.context.destination);
  }

  private flush(): void {
    if (!this.pending.length) return;
    const blob = new Blob(this.pending, { type: 'application/octet-stream' });
    this.pending = []; this.pendingBytes = 0;
    const chunkSeq = ++this.chunkCount;
    this.byteLength += blob.size;
    this.writeChain = this.writeChain.then(async () => {
      await storage.setItem(keyFor(this.segmentId, chunkSeq), blob);
      const audio = this.snapshot(); await saveStoredVoiceAudio(audio, this.retention, 'recording'); this.onProgress?.(audio);
    });
  }

  private snapshot(): CapturedVoiceAudio {
    const sampleRate = this.context?.sampleRate ?? 16_000;
    return { segmentId: this.segmentId, mimeType: 'audio/wav', durationMs: Math.round((this.byteLength / 2 / sampleRate) * 1_000), chunkCount: this.chunkCount, byteLength: this.byteLength, sampleRate };
  }

  async stop(): Promise<CapturedVoiceAudio> {
    this.flush();
    this.processor?.disconnect(); this.source?.disconnect(); this.gain?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    const sampleRate = this.context?.sampleRate ?? 16_000;
    if (this.context) await this.context.close();
    await this.writeChain;
    const durationMs = Math.round((this.byteLength / 2 / sampleRate) * 1_000);
    if (!this.chunkCount || !this.byteLength || durationMs < 300) throw new Error('录音时间太短，请再说一会儿或改用文字输入。');
    if (durationMs > this.maxDurationMs) throw new Error('单段录音最长 10 分钟；已安全保存前面的内容，请分段继续。');
    const audio = { segmentId: this.segmentId, mimeType: 'audio/wav' as const, durationMs, chunkCount: this.chunkCount, byteLength: this.byteLength, sampleRate };
    await saveStoredVoiceAudio(audio, this.retention, 'ready');
    return audio;
  }
}

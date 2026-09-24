import { createDedicatedStorage } from '@/utils/persistence';
import type { VoiceAudioRetention } from './model';
import { voicePcmByteLimit } from './voiceLimits';

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
  private sampleRate = 16_000;
  private writeChain = Promise.resolve();
  private readonly retention: VoiceAudioRetention;
  private readonly onProgress?: (audio: CapturedVoiceAudio) => void;
  private readonly onLimitReached?: () => void;
  private limitReached = false;
  private released = false;

  constructor(segmentId: string, retention: VoiceAudioRetention, onProgress?: (audio: CapturedVoiceAudio) => void, onLimitReached?: () => void) {
    this.segmentId = segmentId; this.retention = retention; this.onProgress = onProgress; this.onLimitReached = onLimitReached;
  }

  static supported(): boolean { return typeof window !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia) && Boolean(window.AudioContext); }

  async start(): Promise<void> {
    if (!LocalOnlyAudioCapture.supported()) throw new Error('当前浏览器不支持安全录音，请直接输入文字。');
    await ensureVoiceStorageCapacity();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
      this.assertActive();
      this.context = new AudioContext({ sampleRate: 16_000 });
      this.sampleRate = this.context.sampleRate;
      await saveStoredVoiceAudio({ segmentId: this.segmentId, mimeType: 'audio/wav', durationMs: 0, chunkCount: 0, byteLength: 0, sampleRate: this.context.sampleRate }, this.retention, 'recording');
      this.assertActive();
      await this.context.resume();
      this.assertActive();
      this.source = this.context.createMediaStreamSource(this.stream);
      this.processor = this.context.createScriptProcessor(4_096, 1, 1);
      this.gain = this.context.createGain(); this.gain.gain.value = 0;
      this.processor.onaudioprocess = (event) => {
        if (this.limitReached) return;
        const byteLimit = voicePcmByteLimit(this.context!.sampleRate);
        const remainingBytes = byteLimit - this.byteLength - this.pendingBytes;
        if (remainingBytes <= 0) { this.reachLimit(); return; }
        const captured = new Blob([pcm16(event.inputBuffer.getChannelData(0))], { type: 'application/octet-stream' });
        const blob = captured.size > remainingBytes ? captured.slice(0, remainingBytes, 'application/octet-stream') : captured;
        this.pending.push(blob); this.pendingBytes += blob.size;
        if (this.pendingBytes >= this.context!.sampleRate * 2 || blob.size < captured.size) this.flush();
        if (blob.size < captured.size || this.byteLength + this.pendingBytes >= byteLimit) this.reachLimit();
      };
      this.source.connect(this.processor); this.processor.connect(this.gain); this.gain.connect(this.context.destination);
    } catch (error) {
      this.interrupt();
      throw error;
    }
  }

  private reachLimit(): void {
    if (this.limitReached) return;
    this.limitReached = true;
    this.flush();
    this.onLimitReached?.();
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
    return { segmentId: this.segmentId, mimeType: 'audio/wav', durationMs: Math.round((this.byteLength / 2 / this.sampleRate) * 1_000), chunkCount: this.chunkCount, byteLength: this.byteLength, sampleRate: this.sampleRate };
  }

  private releaseHardware(): void {
    this.released = true;
    if (this.processor) { this.processor.onaudioprocess = null; this.processor.disconnect(); this.processor = null; }
    this.source?.disconnect(); this.source = null;
    this.gain?.disconnect(); this.gain = null;
    this.stream?.getTracks().forEach((track) => track.stop()); this.stream = null;
    if (this.context) { void this.context.close().catch(() => undefined); this.context = null; }
  }

  private assertActive(): void {
    if (!this.released) return;
    this.releaseHardware();
    throw new Error('录音已取消。');
  }

  interrupt(): void {
    this.flush();
    this.releaseHardware();
  }

  async stop(): Promise<CapturedVoiceAudio> {
    this.flush();
    this.releaseHardware();
    await this.writeChain;
    const durationMs = Math.round((this.byteLength / 2 / this.sampleRate) * 1_000);
    if (!this.chunkCount || !this.byteLength || durationMs < 300) throw new Error('录音时间太短，请再说一会儿或改用文字输入。');
    const audio = { segmentId: this.segmentId, mimeType: 'audio/wav' as const, durationMs, chunkCount: this.chunkCount, byteLength: this.byteLength, sampleRate: this.sampleRate };
    await saveStoredVoiceAudio(audio, this.retention, 'ready');
    return audio;
  }
}

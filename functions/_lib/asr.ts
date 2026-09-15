import type { ReviewEnv } from './reviews.ts';

export interface AsrEnv extends ReviewEnv {
  VOLCENGINE_ASR_API_KEY?: string;
  VOLCENGINE_ASR_APP_ID?: string;
  VOLCENGINE_ASR_ACCESS_KEY?: string;
  VOLCENGINE_ASR_RESOURCE_ID?: string;
}

export interface AsrResult { text: string; providerLogId?: string }
export const ASR_MAX_PER_15_MINUTES = 20;
export const canStartAsr = (recentRequests: number): boolean => Number.isInteger(recentRequests) && recentRequests >= 0 && recentRequests < ASR_MAX_PER_15_MINUTES;
const endpoint = 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

export function isWav(bytes: Uint8Array): boolean {
  return bytes.length >= 12
    && String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF'
    && String.fromCharCode(...bytes.subarray(8, 12)) === 'WAVE';
}

export function wavDurationMs(bytes: Uint8Array): number | null {
  if (!isWav(bytes) || bytes.length < 44) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const channels = view.getUint16(22, true); const sampleRate = view.getUint32(24, true); const bits = view.getUint16(34, true);
  if (channels !== 1 || bits !== 16 || sampleRate < 8_000 || sampleRate > 96_000) return null;
  return Math.round(((bytes.length - 44) / (sampleRate * channels * (bits / 8))) * 1_000);
}

export function asrRequest(env: AsrEnv, audio: Uint8Array, userId: string, operationId: string): RequestInit | null {
  const apiKey = env.VOLCENGINE_ASR_API_KEY?.trim();
  const appId = env.VOLCENGINE_ASR_APP_ID?.trim();
  const accessKey = env.VOLCENGINE_ASR_ACCESS_KEY?.trim();
  if (!apiKey && !(appId && accessKey)) return null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Api-Resource-Id': env.VOLCENGINE_ASR_RESOURCE_ID?.trim() || 'volc.bigasr.auc_turbo',
    'X-Api-Request-Id': operationId,
    'X-Api-Sequence': '-1',
  };
  if (apiKey) headers['X-Api-Key'] = apiKey;
  else { headers['X-Api-App-Key'] = appId!; headers['X-Api-Access-Key'] = accessKey!; }
  return {
    method: 'POST', headers,
    body: JSON.stringify({ user: { uid: userId }, audio: { data: toBase64(audio) }, request: { model_name: 'bigmodel' } }),
    signal: AbortSignal.timeout(60_000),
  };
}

export function readAsrResult(payload: unknown, providerLogId?: string | null): AsrResult | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const text = (payload as { result?: { text?: unknown } }).result?.text;
  if (typeof text !== 'string' || !text.trim() || text.length > 20_000) return null;
  return { text: text.trim(), ...(providerLogId ? { providerLogId } : {}) };
}

export { endpoint as VOLCENGINE_FLASH_ASR_ENDPOINT };

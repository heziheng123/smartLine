export const VOICE_WAV_HEADER_BYTES = 44;
export const VOICE_MAX_WAV_BYTES = 8 * 1024 * 1024;
export const VOICE_MAX_PCM_BYTES = VOICE_MAX_WAV_BYTES - VOICE_WAV_HEADER_BYTES;
export const VOICE_MAX_DURATION_MS = 10 * 60_000;

export function voicePcmByteLimit(sampleRate: number): number {
  const durationLimit = Math.floor((sampleRate * 2 * VOICE_MAX_DURATION_MS) / 1_000);
  return Math.min(VOICE_MAX_PCM_BYTES, durationLimit);
}

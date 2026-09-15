import assert from 'node:assert/strict';
import test from 'node:test';
import { appendVoiceSegment, createDailyReview, mergeDailyReviews, updateVoiceAudio } from '../../src/review/model.ts';

const voice = (id: string, state: 'recording' | 'waiting_transcription' = 'recording') => ({
  id, type: 'voice' as const, originDeviceId: 'review-device-test', audioStorageScope: 'local_only' as const, audioRetention: 'delete_after_transcription' as const, transcriptionState: state,
  audio: { mimeType: 'audio/wav' as const, durationMs: 0, chunkCount: 0, byteLength: 0, sampleRate: 16_000 },
});

test('voice segment exists before audio capture and can later become recoverable', () => {
  const draft = appendVoiceSegment(createDailyReview('2026-09-15'), voice('voice-segment-recovery'));
  assert.equal(draft.inputSegments[0]?.type, 'voice');
  const recovered = updateVoiceAudio(draft, 'voice-segment-recovery', { mimeType: 'audio/wav', durationMs: 1_000, chunkCount: 1, byteLength: 32_000, sampleRate: 16_000 }, 'waiting_transcription');
  assert.equal(recovered.inputSegments[0]?.type === 'voice' && recovered.inputSegments[0].audio.chunkCount, 1);
});

test('merge keeps raw segments from both devices instead of replacing cloud data', () => {
  const local = appendVoiceSegment(createDailyReview('2026-09-15'), voice('voice-segment-local', 'waiting_transcription'));
  const remote = appendVoiceSegment(createDailyReview('2026-09-15'), voice('voice-segment-remote', 'waiting_transcription'));
  const merged = mergeDailyReviews(local, remote);
  assert.deepEqual(merged.inputSegments.map((segment) => segment.id).sort(), ['voice-segment-local', 'voice-segment-remote']);
});

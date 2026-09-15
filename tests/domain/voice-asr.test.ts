import assert from 'node:assert/strict';
import test from 'node:test';
import { ASR_MAX_PER_15_MINUTES, canStartAsr, isWav, readAsrResult, wavDurationMs } from '../../functions/_lib/asr.ts';

function wavForOneSecond(): Uint8Array {
  const bytes = new Uint8Array(44 + 32_000);
  const view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']] as const) for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
  view.setUint32(4, bytes.length - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16_000, true);
  view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 32_000, true);
  return bytes;
}

test('ASR accepts a valid mono WAV and only returns provider text', () => {
  const wav = wavForOneSecond();
  assert.equal(isWav(wav), true);
  assert.equal(wavDurationMs(wav), 1_000);
  assert.deepEqual(readAsrResult({ result: { text: '  完成数据库配置。  ' } }, 'provider-log'), { text: '完成数据库配置。', providerLogId: 'provider-log' });
  assert.equal(readAsrResult({ result: { text: '' } }), null);
});

test('ASR rate limit blocks the next request at the configured boundary', () => {
  assert.equal(canStartAsr(ASR_MAX_PER_15_MINUTES - 1), true);
  assert.equal(canStartAsr(ASR_MAX_PER_15_MINUTES), false);
});

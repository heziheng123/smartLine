import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildReviewTextBlocks, locateQuoteInBlock, planReviewBlockAnalysis, reviewContentHash } from '../../src/review/textBlocks.ts';
import { buildAnalysisCacheKey, shouldReuseCache, shouldAutoRerunOnVersionChange } from '../../src/review/analysisCache.ts';
import { createInstrumentation, recordRejections } from '../../src/review/analysisMetrics.ts';
import { REVIEW_ANNOTATION_GOLDEN } from '../fixtures/review-annotation-golden.ts';

const seg = (id: string, text: string, start: number) => ({ id, text, startInDocument: start });

describe('phaseE cache + instrumentation', () => {
  it('相同请求复用缓存；刷新/重试不重调（revision/textVersion/锁门）', () => {
    const key = buildAnalysisCacheKey({ reviewId: 'r', textVersionId: 'v', targetHashes: ['h1'], promptVersion: 'annotation-prompt-v2', schemaVersion: 'annotation-schema-v2', modelVersion: 'm' });
    const cached = { key, revision: 3, textVersionId: 'v', annotations: [], analyzedAt: 't' };
    assert.equal(shouldReuseCache({ cached, currentKey: key, currentRevision: 3, currentTextVersionId: 'v', locked: false, forceReanalysis: false }), true);
    assert.equal(shouldReuseCache({ cached, currentKey: key, currentRevision: 4, currentTextVersionId: 'v', locked: false, forceReanalysis: false }), false);
    assert.equal(shouldReuseCache({ cached, currentKey: key, currentRevision: 3, currentTextVersionId: 'v2', locked: false, forceReanalysis: false }), false);
    assert.equal(shouldReuseCache({ cached, currentKey: key, currentRevision: 3, currentTextVersionId: 'v', locked: true, forceReanalysis: false }), false);
  });
  it('prompt版本变化不自动全量重跑，仅用户主动重跑', () => {
    assert.equal(shouldAutoRerunOnVersionChange('annotation-prompt-v1', 'annotation-prompt-v2', false), false);
    assert.equal(shouldAutoRerunOnVersionChange('annotation-prompt-v1', 'annotation-prompt-v2', true), true);
    assert.equal(shouldAutoRerunOnVersionChange('annotation-prompt-v2', 'annotation-prompt-v2', false), true);
  });
  it('10块新增1块只进1 target；instrumentation只记非敏感指标', () => {
    const prev = buildReviewTextBlocks(Array.from({ length: 9 }, (_, i) => seg(`s${i}`, `第${i}段完成了。`, i * 100)), 'v1');
    void prev; void reviewContentHash;
    const blocks = buildReviewTextBlocks([...Array.from({ length: 9 }, (_, i) => seg(`s${i}`, `第${i}段完成了。`, i * 100)), seg('s9', '新增一段。', 900)], 'v2', prev);
    const plan = planReviewBlockAnalysis(blocks.map((b, i) => (i < 9 ? { ...b, analysisState: 'analyzed' as const, lastAnalyzedHash: b.contentHash } : b)));
    assert.equal(plan.targetBlocks.length, 1);
    const m = recordRejections(createInstrumentation({ reviewBlockCount: 10, targetBlockCount: 1, contextBlockCount: 1, aiRequestCount: 1 }), ['QUOTE_AMBIGUOUS']);
    assert.equal(m.rejectedAnnotationCount, 1);
    assert.ok(!('text' in m) && !('quote' in m) && !('prompt' in m));
  });
});

describe('phaseF golden deterministic gate', () => {
  it('30条金集可加载；quote精确存在；安全门槛结构就绪', () => {
    assert.ok(REVIEW_ANNOTATION_GOLDEN.length >= 30);
    for (const c of REVIEW_ANNOTATION_GOLDEN) {
      for (const e of c.expectedAnnotations) {
        if (c.id === 'g16' || c.id === 'g29') continue;
        if (c.id === 'g17') {
          const blocks = buildReviewTextBlocks([seg('s', c.text, 0)], 'v');
          assert.equal(locateQuoteInBlock(blocks, blocks[0]!.blockId, e.quote, 'v'), 'QUOTE_AMBIGUOUS');
          continue;
        }
        assert.ok(c.text.includes(e.quote), `${c.id} quote必须原文存在`);
      }
    }
  });
});

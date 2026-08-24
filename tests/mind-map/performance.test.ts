import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import test from 'node:test';
import { createMindMapBenchmarkDocument } from '../../src/mindMap/benchmark.ts';
import { layoutMindMapTree } from '../../src/mindMap/layout.ts';
import { normalizeMindMapDocument } from '../../src/mindMap/model.ts';

for (const count of [500, 2_000, 5_000]) {
  test(`${count} node benchmark data normalizes and lays out within the performance guardrail`, () => {
    const source = createMindMapBenchmarkDocument(count);
    const startedAt = performance.now();
    const normalized = normalizeMindMapDocument(source);
    assert.ok(normalized);
    const layout = layoutMindMapTree(normalized);
    const elapsed = performance.now() - startedAt;
    assert.equal(Object.keys(layout.nodes).length, count);
    assert.equal(Object.keys(layout.edges).length, count - 1);
    assert.ok(elapsed < 5_000, `normalize + layout took ${elapsed.toFixed(1)}ms`);
  });
}

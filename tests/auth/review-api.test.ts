import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import test from 'node:test';
import { onRequestGet, onRequestPost } from '../../functions/api/reviews/[date].ts';
import { createSessionCookie } from '../../functions/_lib/session.ts';
import type { D1Database, D1PreparedStatement } from '../../functions/_lib/reviews.ts';
import { appendTextSegment, createDailyReview } from '../../src/review/model.ts';

test('review API stores real SQL, replays receipts, rejects stale edits and isolates users', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync(new URL('../../migrations/0001_reviews.sql', import.meta.url), 'utf8'));
  const execute = new WeakMap<D1PreparedStatement, () => { meta: { changes: number } }>();
  const database: D1Database = {
    prepare(query): D1PreparedStatement {
      let values: SQLInputValue[] = [];
      const run = () => ({ meta: { changes: Number(sqlite.prepare(query).run(...values).changes) } });
      const statement: D1PreparedStatement = {
        bind(...input) { values = input as SQLInputValue[]; return this; },
        async first<T>() { return (sqlite.prepare(query).get(...values) as T | undefined) ?? null; },
        async run() { return run(); },
      };
      execute.set(statement, run);
      return statement;
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map((statement) => execute.get(statement)!());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
    },
  };
  const env = { REVIEW_DB: database, SMARTLINE_SESSION_SECRET: 'test-session-secret-that-is-longer-than-32-characters' };
  const url = 'https://smartline.example/api/reviews/2026-09-27';
  const ownerCookie = (await createSessionCookie('owner-id', 'owner', env)).split(';')[0];
  const otherCookie = (await createSessionCookie('other-id', 'other', env)).split(';')[0];
  const get = (cookie?: string) => onRequestGet({ env, params: { date: '2026-09-27' },
    request: new Request(url, { headers: cookie ? { Cookie: cookie } : {} }) });
  const post = (body: unknown, cookie = ownerCookie) => onRequestPost({ env, params: { date: '2026-09-27' },
    request: new Request(url, { method: 'POST', headers: { Cookie: cookie, Origin: 'https://smartline.example', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) });
  try {
    assert.equal((await get()).status, 401);
    assert.equal((await get(ownerCookie)).status, 404);
    const original = appendTextSegment(createDailyReview('2026-09-27'), 'original record');
    const firstBody = { review: original, baseRevision: null, operationId: 'review-api-create-operation' };
    const first = await post(firstBody);
    assert.equal(first.status, 200);
    const receipt = await first.json() as { serverRevision: number; review: typeof original };
    assert.equal(receipt.serverRevision, 1);
    assert.equal(receipt.review.inputSegments.length, 1);
    assert.deepEqual(await (await post(firstBody)).json(), receipt);
    assert.equal((await get(otherCookie)).status, 404);

    const updated = appendTextSegment(receipt.review, 'new record');
    const accepted = await post({ review: updated, baseRevision: 1, operationId: 'review-api-update-operation' });
    assert.equal(accepted.status, 200);
    assert.equal((await accepted.json() as { serverRevision: number }).serverRevision, 2);
    assert.equal((await post({ review: original, baseRevision: 1, operationId: 'review-api-stale-operation' })).status, 409);
    assert.equal((await post({ review: {}, baseRevision: 2, operationId: 'review-api-invalid-operation' })).status, 400);
    const final = await (await get(ownerCookie)).json() as { serverRevision: number; review: typeof original };
    assert.equal(final.serverRevision, 2);
    assert.equal(final.review.inputSegments.length, 2);
    assert.equal(sqlite.prepare('SELECT COUNT(*) AS total FROM review_operations').get()?.total, 2);
  } finally { sqlite.close(); }
});

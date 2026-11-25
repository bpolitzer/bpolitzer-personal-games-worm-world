import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listScores, startGame, submitScore, scoreFor, RULES } from '../netlify/lib/leaderboard.mjs';

function memStore() {
  const m = new Map();
  return { m, get: async k => (m.has(k) ? m.get(k) : null), set: async (k, v) => { m.set(k, v); },
    delete: async k => { m.delete(k); }, list: async p => [...m.keys()].filter(k => k.startsWith(p)) };
}
const env = {};
const T0 = 1_800_000_000_000;
async function play(store, { name = 'BEN', time = 60, crashes = 2, wait = time * 1000 + 500 } = {}) {
  const { body: { ticket } } = await startGame(store, env, T0);
  return submitScore(store, env, { ticket, name, time, crashes }, T0 + wait);
}

test('score matches the game formula', () => {
  assert.equal(scoreFor(12.39, 3), 123 + 750);
});

test('a fair game is saved and ranked', async () => {
  const s = memStore();
  const r = await play(s, { name: 'ben', time: 60, crashes: 2 });
  assert.equal(r.status, 200);
  assert.equal(r.body.rank, 1);
  assert.equal(r.body.score, 1100);
  const l = await listScores(s);
  assert.deepEqual(l.body.scores, [{ name: 'BEN', score: 1100, time: 60, crashes: 2 }]);
});

test('scores sort high to low', async () => {
  const s = memStore();
  await play(s, { name: 'AAA', time: 10, crashes: 0 });
  await play(s, { name: 'BBB', time: 30, crashes: 1 });
  const r = await play(s, { name: 'CCC', time: 20, crashes: 0 });
  assert.equal(r.body.rank, 2);
  assert.deepEqual(r.body.scores.map(x => x.name), ['BBB', 'CCC', 'AAA']);
});

test('rejects a score submitted faster than it could be played', async () => {
  const r = await play(memStore(), { time: 300, wait: 10_000 });
  assert.equal(r.status, 400);
});

test('rejects forged and reused tickets', async () => {
  const s = memStore();
  const { body: { ticket } } = await startGame(s, env, T0);
  const forged = ticket.replace(/^\d+/, String(T0 - 3_000_000));
  assert.equal((await submitScore(s, env, { ticket: forged, name: 'BEN', time: 60, crashes: 0 }, T0 + 61_000)).status, 400);
  assert.equal((await submitScore(s, env, { ticket, name: 'BEN', time: 60, crashes: 0 }, T0 + 61_000)).status, 200);
  assert.equal((await submitScore(s, env, { ticket, name: 'BEN', time: 60, crashes: 0 }, T0 + 62_000)).status, 409);
});

test('rejects bad initials, blocked words and impossible crash counts', async () => {
  assert.equal((await play(memStore(), { name: 'B3N' })).status, 400);
  assert.equal((await play(memStore(), { name: 'ass' })).status, 400);
  assert.equal((await play(memStore(), { time: 5, crashes: 50 })).status, 400);
});

test('keeps only the top 100', async () => {
  const s = memStore();
  for (let i = 1; i <= RULES.KEEP + 5; i++) await play(s, { name: 'ZZZ', time: i, crashes: 0 });
  const keys = await s.list('e/');
  assert.equal(keys.length, RULES.KEEP);
  const low = await play(s, { name: 'LOW', time: 1, crashes: 0 });
  assert.equal(low.body.rank, null);
});

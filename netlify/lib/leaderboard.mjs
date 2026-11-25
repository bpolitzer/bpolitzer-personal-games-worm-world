// Worm World world leaderboard: scoring rules and anti-cheat checks.
// The store is injected so this file can be tested without Netlify:
//   store.get(key) -> string|null, store.set(key, value), store.delete(key), store.list(prefix) -> [keys]
//
// Each saved score is its own key, with the data encoded in the key name:
//   e/<score, 9 digits>-<NAME>-<seconds>-<crashes>-<saved at ms>-<random>
// Writing separate keys means two players saving at the same moment can't overwrite each other.

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const RULES = {
  PTS_SEC: 10,                          // must match the game
  PTS_CRASH: 250,                       // must match the game
  MAX_TIME: 3 * 60 * 60,                // ignore runs longer than 3 hours
  KEEP: 100,                            // scores kept on the world board
  SHOW: 10,                             // scores returned to the game
  TICKET_MAX_AGE_MS: 4 * 60 * 60 * 1000,
  CLOCK_SLACK_MS: 3000,
};

const BLOCKED = new Set(['ASS', 'FUK', 'FUC', 'FCK', 'FUQ', 'SEX', 'CUM', 'KUM', 'DIK', 'DIC', 'KKK', 'NIG', 'NGR',
  'FAG', 'TIT', 'JIZ', 'CNT', 'VAG', 'NAZ', 'SUK', 'SUC', 'SLT', 'HOE', 'XXX', 'POO', 'PUS', 'WTF']);

const b64u = buf => Buffer.from(buf).toString('base64url');
const sign = (secret, payload) => createHmac('sha256', secret).update(payload).digest('base64url');
const fail = (status, error) => ({ status, body: { error } });
const pub = e => ({ name: e.name, score: e.score, time: e.time, crashes: e.crashes });

async function getSecret(store, env) {
  if (env.SCORE_SECRET) return env.SCORE_SECRET;
  let secret = await store.get('config/secret');
  if (!secret) {
    secret = b64u(randomBytes(32));
    await store.set('config/secret', secret);
  }
  return secret;
}

function parseEntry(key) {
  const [score, name, time, crashes, ts] = key.slice(2).split('-');
  return { key, name, score: Number(score), time: Number(time), crashes: Number(crashes), ts: Number(ts) };
}

async function rankedEntries(store) {
  const keys = await store.list('e/');
  return keys.map(parseEntry)
    .filter(e => Number.isFinite(e.score) && /^[A-Z]{3}$/.test(e.name))
    .sort((a, b) => b.score - a.score || a.ts - b.ts);
}

export function scoreFor(time, crashes) {
  return Math.floor(time * RULES.PTS_SEC) + crashes * RULES.PTS_CRASH;
}

export async function listScores(store) {
  const all = await rankedEntries(store);
  return { status: 200, body: { scores: all.slice(0, RULES.SHOW).map(pub) } };
}

// Called when a game starts. The signed ticket proves when the game began.
export async function startGame(store, env, now = Date.now()) {
  const secret = await getSecret(store, env);
  const payload = `${now}.${b64u(randomBytes(12))}`;
  return { status: 200, body: { ticket: `${payload}.${sign(secret, payload)}` } };
}

export async function submitScore(store, env, body, now = Date.now()) {
  if (!body || typeof body !== 'object') return fail(400, 'Bad request.');

  const name = String(body.name || '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(name)) return fail(400, 'Initials must be 3 letters A to Z.');
  if (BLOCKED.has(name)) return fail(400, 'Please pick different initials.');

  const time = Number(body.time), crashes = Number(body.crashes);
  if (!Number.isFinite(time) || time <= 0 || time > RULES.MAX_TIME) return fail(400, 'That game time is not valid.');
  if (!Number.isInteger(crashes) || crashes < 0 || crashes > Math.ceil(time)) return fail(400, 'That crash count is not valid.');

  // Ticket: "<startMs>.<nonce>.<signature>"
  const parts = String(body.ticket || '').split('.');
  if (parts.length !== 3) return fail(400, 'Missing game ticket.');
  const [startStr, nonce, sig] = parts;
  const secret = await getSecret(store, env);
  const expected = Buffer.from(sign(secret, `${startStr}.${nonce}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return fail(400, 'Game ticket is not valid.');
  const start = Number(startStr);
  if (!Number.isFinite(start) || now - start > RULES.TICKET_MAX_AGE_MS) return fail(400, 'Game ticket has expired.');
  if (now - start + RULES.CLOCK_SLACK_MS < time * 1000) return fail(400, 'That score came in faster than the game could be played.');
  if (await store.get(`used/${nonce}`)) return fail(409, 'This game was already submitted.');
  await store.set(`used/${nonce}`, String(now));

  const score = scoreFor(time, crashes);
  const all = await rankedEntries(store);
  if (all.length >= RULES.KEEP && score <= all[RULES.KEEP - 1].score) {
    return { status: 200, body: { ok: true, rank: null, score, scores: all.slice(0, RULES.SHOW).map(pub) } };
  }

  const key = `e/${String(score).padStart(9, '0')}-${name}-${Math.floor(time)}-${crashes}-${now}-${b64u(randomBytes(4)).replace(/-/g, 'x')}`;
  await store.set(key, '1');
  const ranked = [...all, parseEntry(key)].sort((a, b) => b.score - a.score || a.ts - b.ts);
  for (const old of ranked.slice(RULES.KEEP)) await store.delete(old.key);

  const rank = ranked.findIndex(e => e.key === key) + 1;
  return { status: 200, body: { ok: true, rank, score, scores: ranked.slice(0, RULES.SHOW).map(pub) } };
}

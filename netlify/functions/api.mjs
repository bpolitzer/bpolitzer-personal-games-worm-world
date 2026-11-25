// Netlify Function for the world leaderboard.
//   GET  /api/scores  -> { scores: [top 10] }
//   POST /api/start   -> { ticket }                       (call when a game starts)
//   POST /api/scores  { ticket, name, time, crashes }     -> { ok, rank, score, scores }
import { getStore } from '@netlify/blobs';
import { listScores, startGame, submitScore } from '../lib/leaderboard.mjs';

function blobStore() {
  const s = getStore({ name: 'worm-world-leaderboard', consistency: 'strong' });
  return {
    get: key => s.get(key),
    set: (key, value) => s.set(key, value),
    delete: key => s.delete(key),
    list: async prefix => (await s.list({ prefix })).blobs.map(b => b.key),
  };
}

const json = ({ status, body }) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
});

export default async req => {
  const path = new URL(req.url).pathname.replace(/\/+$/, '');
  const store = blobStore();
  const env = { SCORE_SECRET: process.env.SCORE_SECRET };
  try {
    if (path === '/api/scores' && req.method === 'GET') return json(await listScores(store));
    if (path === '/api/start' && req.method === 'POST') return json(await startGame(store, env));
    if (path === '/api/scores' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch { return json({ status: 400, body: { error: 'Bad request.' } }); }
      return json(await submitScore(store, env, body));
    }
    return json({ status: 405, body: { error: 'Method not allowed.' } });
  } catch (err) {
    console.error(err);
    return json({ status: 500, body: { error: 'The world leaderboard is unavailable right now.' } });
  }
};

export const config = { path: ['/api/scores', '/api/start'] };

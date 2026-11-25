# Worm World

An arcade survival game that runs in the browser. Steer your pink worm with the arrow keys (or swipe), dodge every trail including your own, and grow your trail when other worms crash into it. The world leaderboard is stored on Netlify.

Live at **https://worm-world.netlify.app/**

## What's in here

| Path | What it is |
|---|---|
| `public/index.html` | The whole game: one HTML file with its CSS and JavaScript |
| `public/og-image.png` | The 1200×630 picture shown when the link is shared |
| `netlify/functions/api.mjs` | The leaderboard API, deployed as a Netlify Function |
| `netlify/lib/leaderboard.mjs` | Scoring rules and cheat checks used by the API |
| `test/leaderboard.test.mjs` | Tests for the leaderboard rules |
| `netlify.toml` | Tells Netlify to publish `public/` and deploy the functions |

## How the leaderboard works

- `GET /api/scores` returns the world top 10.
- `POST /api/start` is called when a game starts and returns a signed ticket recording the start time.
- `POST /api/scores` with `{ ticket, name, time, crashes }` saves a score. The server computes the score itself (10 points per second + 250 per crash). It rejects the score if:
  - the ticket is forged, expired or already used
  - less real time has passed than the game claims to have lasted
  - the initials aren't 3 letters A–Z, or are on a short blocklist
  - the crash count is impossible

Scores live in a Netlify Blobs store called `worm-world-leaderboard`, and the top 100 are kept. Each player's own scores are also kept in their browser, so the game still works offline. When the API can't be reached, the "World" tab shows as offline.

These checks stop casual cheating. They can't stop someone who rewrites the game code, because the game runs in the player's browser.

## Deploying

The Netlify site deploys from this repo:

1. In Netlify, open the **worm-world** site, then go to **Site configuration → Build & deploy → Link repository** and pick this repo and the `main` branch.
2. Leave the build command empty. `netlify.toml` already sets the publish folder (`public`) and functions folder.
3. Every push to `main` deploys automatically.

Optional: add an environment variable `SCORE_SECRET` (any long random string) in Netlify to sign tickets. Without it, the function creates a secret and keeps it in the Blobs store.

Netlify's free plan covers Functions and Blobs at hobby traffic.

## Developing

```bash
npm install
npm test
```

To run the site and functions locally, use the Netlify CLI: `npx netlify dev`.

## Resetting the leaderboard

In Netlify, open the site and go to **Blobs → worm-world-leaderboard**, then delete the keys that start with `e/`.

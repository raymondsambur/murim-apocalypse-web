# Murim Apocalypse

A persistent, browser-based, isometric 2D wuxia MMO. Register, receive a randomly rolled martial artist, and live in a shared world that keeps changing even when nobody is watching: the Blight spreads, sects go to war, harvests fail, masters die and legends rise.

No download needed — it runs in the browser (desktop and mobile).

- Game design: [`docs/GAME_DESIGN.md`](docs/GAME_DESIGN.md)
- Architecture and working agreement: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- Gameplay rules: [`docs/GAMEPLAY_SPEC.md`](docs/GAMEPLAY_SPEC.md)
- Current status, known gaps and next steps: [`docs/STATUS.md`](docs/STATUS.md)

## Quick start (development)

Requirements: Node.js 22.13+ (tested on 24).

```bash
npm install
npm run dev          # server on :3000 + Vite client on :5173 (open http://localhost:5173)
```

Useful scripts:

| Command | What it does |
|---|---|
| `npm run dev` | Server (watch mode) and client dev server together |
| `npm run build` | Builds the client to `dist/client` and bundles the server to `dist/server.mjs` |
| `npm start` | Runs the production build (serves the website and the game API from one process) |
| `npm test` | Runs the unit and integration tests |
| `npm run typecheck` | Type-checks all packages |
| `npx tsx scripts/preview-world.ts 1337` | Prints an ASCII map of the generated world |
| `npx tsx scripts/balance.ts` | Combat balance simulation |

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket port |
| `HOST` | `127.0.0.1` (`0.0.0.0` when `NODE_ENV=production`) | Bind address |
| `DB_PATH` | `./data/murim.db` | SQLite database file |
| `WORLD_SEED` | `1337` | Seed for the world map |
| `WORLD_HOUR_MS` | `60000` | Real milliseconds per in-world hour (60000 → a day lasts 24 minutes) |
| `COOKIE_SECURE` | `false` | Set `true` when served over HTTPS (behind a reverse proxy) |
| `SESSION_DAYS` | `14` | Login session lifetime |
| `ADMIN_USERS` | | Comma-separated usernames with admin rights |

## Deploying

The production build is a single Node process plus a SQLite file, so any small VPS works:

```bash
npm ci
npm run build
COOKIE_SECURE=true PORT=3000 npm start
```

Put it behind a reverse proxy that terminates HTTPS (Caddy, nginx, Cloudflare Tunnel) and forwards both `/` and the `/ws` WebSocket upgrade. Keep the `data/` folder on persistent storage and back it up (it contains accounts, characters and the world state). A `Dockerfile` is included.

## Project layout

```
packages/shared   Rules, data tables, world generation, combat engine, network protocol
packages/server   Fastify + WebSocket game server, SQLite persistence, systems, world simulation
packages/client   Vite + Canvas2D isometric renderer (all art generated in code) and DOM UI
docs/             Design and architecture
scripts/          Tooling (world preview, balance simulation)
```

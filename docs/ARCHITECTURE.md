# Architecture & Working Agreement

Read `docs/GAME_DESIGN.md` first for *what* we are building. This file is *how*. It is the contract that lets several people (and agents) build in parallel.

## Ground rules
- **Language**: TypeScript everywhere, `strict`. ESM only. No `any` unless unavoidable (comment why). No new npm dependencies without a strong reason (already installed: fastify, @fastify/static, ws, zod, vite, vitest, tsx, esbuild, typescript, concurrently).
- **Environment**: Windows, PowerShell. The project path has a space (`D:\Game Built Project\...`): always quote paths. The drive is **exFAT: no symlinks** (so no npm workspaces; `@murim/shared` is a path alias to `packages/shared/src/index.ts`).
- **Determinism**: simulation/worldgen code never uses `Math.random()` or `Date.now()` for game logic; use `Rng` from `@murim/shared` and pass time in. (Wall-clock time is injected by the server.)
- **Do not commit** to git and do not push. Do not edit files you do not own (see ownership). If you need a change in a file someone else owns, make a *minimal, additive* edit (e.g., add a field to `protocol.ts`) and mention it in your report.
- **Tests**: vitest, `npm test` at the repo root (`packages/**/*.test.ts`). Put tests next to the code. Run `npx tsc -p packages/<pkg>` for type checks. Keep tests fast and deterministic.
- **Ports** (so parallel agents don't collide): production default `3000`; server-core tests use `3101`; sim has no ports; client-render sandbox uses vite `5201`; client-shell uses vite `5202`. Always set `PORT`/`--port` explicitly and free it when finished. Never leave dev servers running when you finish.
- **Security mindset**: never trust the client; validate every message; rate limit; hash passwords with scrypt; HttpOnly cookies; no secrets in client code.
- **Style**: small modules, clear names, brief comments only where intent isn't obvious. Prefer pure functions for rules.

## Repository layout and ownership
```
docs/                      design + architecture (owner: lead)
scripts/                   dev tooling (preview-world.ts, balance.ts)
packages/shared/src/       rules, data, worldgen, combat engine, protocol (owner: lead; additive edits OK)
  protocol.ts              THE network contract
  simtypes.ts              world simulation state shapes
  data/*.ts                skills, items, monsters, origins, jobs, factions, names
packages/server/src/
  main.ts config.ts db.ts auth.ts http.ts ctx.ts      (owner: server-core)
  net/                     websocket gateway, validation, rate limiting (server-core)
  game/                    world runtime, entities, movement, AOI, players, npc entities, chat, persistence (server-core)
  sim/                     living-world simulation (owner: sim)  -- interface in sim/api.ts
  systems/                 gameplay systems registered into the runtime: combat, monsters, items, shops, missions,
                           jobs, crafting, social ... (owners: server-gameplay agents, wave 2)
packages/client/
  index.html src/styles.css src/main.ts
  src/net/ src/state/ src/ui/       (owner: client-shell, then panel agents)
  src/render/ src/art/              (owner: client-render)  -- interface in src/render/api.ts
```

## Runtime model (server)
- One Node process. A fixed **game tick every 100 ms** (`TICK_MS`) drives: queued player commands, movement, combat beats (every 1000 ms), monster AI, NPC wandering, activity settlement, AOI broadcast.
- **World clock**: the sim advances one **world hour every `hourMs` real milliseconds** (default 60000, env `WORLD_HOUR_MS`). On each hour boundary the runtime calls `sim.advanceHours(1, now)` and fans out the returned `SimEvent`s (chronicle lines, settlement changes, blight patches, weather, board refresh, NPC deaths/births).
- **Entities** live in memory (`Entity`), indexed by id and a spatial hash. Kinds: `player`, `npc`, `monster`, `node`. Static world (terrain/buildings) is `WorldData` generated from the seed (`generateWorld(seed)`), identical on every boot.
- **Interest management**: each client receives entities within `AOI_RADIUS` (28 tiles) as `ents` deltas (`add`/`upd`/`del`) using per-client known-sets. Movement updates carry `x,y` + next tile `nx,ny` + `step` ms so the client interpolates.
- **Movement**: server-authoritative A* (`findPath` over `worldPathGrid`), one tile per step; step time = `STEP_MS / tileSpeed / agilityFactor`. Entities don't block each other.
- **Persistence**: SQLite via `node:sqlite` (`DatabaseSync`). Characters saved on logout, every 30 s if dirty, and on shutdown. World/sim snapshot saved every 60 s and on shutdown. Layer is isolated in `db.ts` (repository functions) so Postgres could replace it.
- **Offline play**: characters with an `activity` (train/shift/craft) stay in the world as `online:false` player entities (not attackable). Activities are settled lazily from timestamps (`since`, `settled`) so offline progress is computed on login/collect, capped by `OFFLINE_CAP_MS`.
- **Auth**: username + password (scrypt, per-user salt), session token in an HttpOnly `SameSite=Lax` cookie (random 32 bytes; only its SHA-256 stored). WebSocket authenticates from that cookie during upgrade. One live connection per account (new one kicks the old with `CLOSE_REPLACED`).

## The server extension API (`packages/server/src/ctx.ts`, written by server-core)
Gameplay modules in `systems/` are written against this API. Server-core must provide (exact names may be refined, but keep the shape):
```ts
interface GameContext {
  world: WorldData; sim: Sim; config: Config; db: Db; rng: Rng;
  now(): number;                                   // ms epoch (injectable for tests)
  entities: EntityStore;                           // create/get/remove/move, spatial queries (near(x,y,r))
  players: PlayerStore;                            // byCharId, byEntityId, online list, find by name
  // sending
  send(p: Player, msg: S2C): void;
  sendNear(x: number, y: number, radius: number, msg: S2C, except?: Player): void;
  broadcast(msg: S2C): void;
  notify(p: Player, level: NoteLevel, text: string): void;
  markMe(p: Player): void;                         // schedule a `me` refresh (coalesced to <= 4/s)
  markDirty(p: Player): void;                      // schedule save
  // extension points
  command<T extends C2S['t']>(t: T, h: (p: Player, m: Extract<C2S, {t: T}>) => void): void;
  query<N extends QueryName>(name: N, h: (p: Player, args: Queries[N]['args']) => Queries[N]['res']): void;
  onTick(h: (dtMs: number, now: number) => void): void;
  onHour(h: (events: SimEvent[]) => void): void;   // after each sim hour
  onLogin(h: (p: Player) => void): void;  onLogout(h: (p: Player) => void): void;
  onInteract(kind: EntityKind, h: (p: Player, e: Entity) => boolean): void; // called when a player reaches an entity
}
interface Player { charId: number; userId: number; name: string; entity: Entity; save: CharacterSave; online: boolean; combatId: number | null; ... }
interface Entity { id: number; kind: EntityKind; x: number; y: number; ... + kind-specific `data` }
```
Each system exports `export function register(ctx: GameContext): void` and is listed in `systems/index.ts`.

## Sim API
See `packages/server/src/sim/api.ts` (`Sim`, `createSim`). State types in `packages/shared/src/simtypes.ts`. The sim owns: clock, weather, Blight, hearts, settlements (status, stock, prices, siege), factions (AI, relations, war), NPC rosters (lives, deaths, successors, legends), mission board generation, chronicle. The game server owns: entities, players, combat. The sim does not know about players except through the `record*` hooks.

## Client architecture
- Vanilla TypeScript + Vite, Canvas2D for the world, plain DOM/CSS for UI. No UI framework.
- `render/` implements `GameViewApi` (`render/api.ts`) and `RenderModule`; **all art is procedural** (generated into offscreen canvases at startup). Isometric 2:1 projection, tile 64x32 (`TILE_W`, `TILE_H`): `sx = (x - y) * 32`, `sy = (x + y) * 16`.
- `net/` WebSocket client with reconnect and typed `send(C2S)` / `query(name, args)` helpers; `state/` holds the store (me, entities summary, chat log, notes) and pub/sub; `ui/` screens and panels; `main.ts` wires screens: auth -> character creation -> game.
- Desktop and mobile: pointer events, responsive panels, bottom bar on narrow screens, tap-to-move, long-press = context action.
- Visual identity: ink-wash dark UI with parchment panels, gold (`#d9b867`) and cinnabar (`#c8452d`) accents; CJK glyphs (e.g. 劍, 丹) used as icons; serif headings.

## Gameplay rules cheatsheet (all constants live in `@murim/shared`)
- Ranks/levels: `ranks.ts` (9 stages per rank, breakthrough at stage 9 needs a pill).
- Stats and derived stats: `stats.ts`; gear: `data/items.ts` (`gearTotals`); skills `data/skills.ts`; combat engine `combat.ts` (pure, tested with `scripts/balance.ts`); monsters `data/monsters.ts`; jobs/recipes `data/jobs.ts`; factions `data/factions.ts`.
- Combat is resolved **server-side** with `stepBeat` once per second; clients only render the events.

# Server core - API summary and how to add a system

Owner: server-core. Audience: gameplay engineers (combat, monsters, items, shops, missions, jobs, social) who plug modules into `packages/server/src/systems/`.

## Running it

| Task | Command |
|---|---|
| Dev server (watch, port 3000) | `npm run dev:server` (or `npm run dev` with the Vite client) |
| Stub world instead of the real sim | `SIM_STUB=1 npm run dev:server` |
| Production | `npm run build && npm start` (the scripts suppress the `node:sqlite` ExperimentalWarning) |
| Server tests | `npx vitest run packages/server` (integration test uses port **3101**) |
| Type check | `npx tsc -p packages/server` |

`tsx` needs `--tsconfig packages/server/tsconfig.json` to resolve the `@murim/shared` alias; `dev:server` already passes it.

Environment (all optional; invalid values fail the boot with a clear message): `PORT` (3000), `HOST` (127.0.0.1, 0.0.0.0 in production), `DB_PATH` (`./data/murim.db`, directory created), `WORLD_SEED` (1337), `WORLD_HOUR_MS` (60000), `COOKIE_SECURE` (false; also sends HSTS), `SESSION_DAYS` (14), `NODE_ENV`, `LOG_LEVEL` (trace..silent, info), `SIM_STUB` (use `sim/stub.ts`), `ADMIN_USERS` (comma list of account names), `STATIC_DIR` (`dist/client`), plus `TRUST_PROXY` (read the client IP from the last `X-Forwarded-For` entry), `ALLOWED_ORIGINS` (extra browser origins allowed in production), `SIM_CATCHUP_HOURS` (48), `AUTOSAVE_MS` (30000), `WORLD_SAVE_MS` (60000).

## File map

```
main.ts            process entry: startServer(), SIGINT/SIGTERM, last-resort error handlers
server.ts          assembly: config -> db -> world -> sim (restore + catch-up) -> Game -> systems -> http + ws
config.ts db.ts auth.ts http.ts ctx.ts
net/               gateway.ts (ws), schemas.ts (zod for every C2S), ratelimit.ts, ip.ts
game/context.ts    class Game: stores, registry, per-tick pipeline, hour fan-out (the GameContext is built here)
game/runtime.ts    100 ms drift-corrected loop, world-hour scheduler, time broadcasts, shutdown
game/{entities,movement,aoi,npcs,players,chat,persist,commands,chargen,registry,log}.ts
sim/stub.ts        deterministic stand-in sim (SIM_STUB=1, tests, or when sim/index.ts is missing)
systems/index.ts   the list of gameplay modules
testkit.ts         makeHarness(): a fully wired in-memory Game with fake clock and fake sockets
```

## Tick pipeline (every 100 ms)

1. Queued commands (max 8 per player per tick, 32 queued) -> `ctx.command` handlers
2. Movement update (entities walk one tile per step)
3. NPC wandering (a slice of NPCs per tick)
4. `ctx.every` / `ctx.after` timers
5. `ctx.onTick` handlers
6. Entity re-sync for players touched by `markMe`, then `me` messages (max one per 250 ms per player)
7. AOI: one `ents` message per client with `add` / `upd` / `del`
8. World hour due? -> `sim.advanceHours(1, scheduledTime)` and fan-out (below)
9. `time` broadcast every 5 s; autosave every 30 s for dirty/moved players; world snapshot every 60 s

Queries (`{t:'q'}`) and `ping` are answered immediately, not queued. Every handler call is wrapped: a throwing system is logged (rate limited) and the player gets `{t:'err', code:'internal'}`; the loop never dies.

World hour fan-out (`Game.fanOut`): `chron` entries, `settle` (settlement views for `settle`/`siege` events), `blight` patch (`idx`/`val`, or a full map when more than 4000 tiles changed), `time` (includes weather), NPC mirror update (`npcDied`/`npcBorn`/`npcMoved`), then your `onHour` handlers and the `hour` event. `board`, `heart`, `newDay`, `newSeason` and `weather` events reach you through `onHour(events)`.

## The extension API (`ctx.ts`)

`export function register(ctx: GameContext): void` in your module; list it in `systems/index.ts`.

```ts
interface GameContext {
  world: WorldData; grid: PathGrid; sim: Sim; config: Config; db: Db; rng: Rng; log: Logger; now(): number;
  entities: EntityStore;   // create / get / has / remove / touch / near / nearest / all / ofKind / count / toView / onRemove
  players: PlayerStore;    // byCharId / byUserId / byEntityId / byName / online / onlineCount / all / near / buildMeView / saveNow
  movement: MovementApi;   // moveTo / approach / followPath / stop / teleport / isMoving / canMove / guards
  chat: ChatApi;           // system(text, to?) / toSect(sectId, msg) / setSectResolver(fn) / clean(text, maxLen?)
  events: EventBus;        // typed cross-system events (extend GameEvents by declaration merging)
  npcEntity(npcId): Entity | undefined;

  send(p, msg) / sendNear(x, y, radius, msg, except?) / broadcast(msg, except?) / notify(p, level, text)
  markMe(p)     // re-sync p's entity from p.save and send a fresh `me` (coalesced)
  markDirty(p)  // schedule a DB save

  command(t, handler, {override?})   // one handler per C2S type; GameError -> {t:'err', code, text}
  query(name, handler, {override?})  // one handler per query; GameError -> {t:'res', ok:false, err: code, data:{text}}
  onTick(h) onHour(h) onLogin(h) onLogout(h) onInteract(kind, h) onBuildMe(h) onPlayerSync(h) onSave(h) onShutdown(h)
  every(ms, h) after(ms, h)          // timers on the game loop (granularity: one tick)
}
```

Every `on*`, `every` and `after` returns an unsubscribe function. Unhandled commands reply `{t:'err', code:'not_implemented'}`, unhandled queries `{t:'res', ok:false, err:'not_implemented'}`.

Core commands already registered (override with `{override: true}` only if you must): `move`, `stop`, `interact`, `chat`, `title`. Core queries: `world`, `chronicle`, `player`, `leaderboard`, `nearbyPlayers`.

### Entities

```ts
interface Entity {
  id; kind: 'player'|'npc'|'monster'|'node'; name;
  readonly x, y;             // current tile - change only via ctx.movement
  face: Dir; state: EntityState; speed: number; hidden: boolean;
  readonly move: MoveState | null; readonly ver: number;
  data: Record<string, unknown>;   // your private per-entity state, never sent to clients
  // visible optional fields (sent to clients): look sprite lv hp maxHp tag faction role elite nodeKind combatId online weapon rank
}
```

- Change a visible field, then `ctx.entities.touch(e)`; nearby clients get a patch this tick. (A safety net re-diffs known entities every 10 ticks, but do not rely on it.)
- `hidden: true` removes the entity from other clients' views without destroying it (dead monster waiting to respawn).
- Namespaced private state: `const WOLF = new DataKey<WolfState>('wolf'); WOLF.set(e, {...}); WOLF.get(e)`.
- NPC entities carry `NPC_DATA.get(e)` = `{npcId, settlementId, homeX, homeY, holdUntil, nextWanderAt}`; `ctx.sim.npc(npcId)` is the source of truth for the NPC's life.

### Players

`Player`: `charId, userId, username, name, entity, save: CharacterSave, online, combatId, isAdmin, mutedUntil, loginAt, data`.

- `p.save` is the live character sheet. Mutate it, then `ctx.markDirty(p)` (persist) and `ctx.markMe(p)` (tell the client). Both are cheap and coalesced - call them freely.
- `p.data` is per-module runtime state (not persisted). Persist durable state in `p.save` or your own tables.
- `p.combatId` non-null blocks movement (default guard); `p.save.activity` non-null blocks movement and shows the entity as working/meditating. Both are plain predicates in `ctx.movement.guards`; push your own or splice one out.
- Characters with `save.activity` stay in the world as `online: false` player entities after logout (restored at boot). When the activity ends, set `save.activity = null` and call `ctx.markMe(p)`: the core removes the idle worker.
- `ctx.players.all()` includes offline workers; `online()` is connected players only.

### Movement

`ctx.movement.moveTo(e, x, y, {onArrive, snap, maxSteps, maxNodes, speed})` returns `{ok:true, tx, ty, steps}` or `{ok:false, reason:'blocked'|'unreachable'|'too_far'}`. `onArrive(e, 'arrived'|'cancelled'|'removed')` fires exactly once. `approach(e, target, {range, ...})` walks next to a (possibly moving) entity and calls `onArrive('arrived')` only once within `range` (default 1.5). `stop(e, immediate?)`, `teleport(e, x, y)` (respawns), `canMove(p)` runs the guards.

Step time = `STEP_MS / tileSpeed / e.speed` (x sqrt 2 on diagonals). Entities do not block each other. Players' `speed` comes from derived stats (`agility`) and is re-synced by `markMe`.

### Interaction

`{t:'interact', id}` is handled by the core: it verifies the client knows the entity, walks into range (1.5 tiles, chasing movers), then runs `onInteract(kind)` handlers; the first returning `true` wins. NPCs stop and turn to the player first. With no handler the player sees the NPC greeting / "Nothing happens". Path-finding requests (move/interact) are limited to 8/s per player.

### Errors, hooks and events

- `throw new GameError('code', 'Text for the player')` from commands and queries. Other exceptions are logged and answered with a generic `internal` error (never the message).
- `onSave(p)` runs just before a player's row is written (logout, autosave, shutdown); `onShutdown()` once before the final saves.
- Add events to the bus by declaration merging: `declare module '../ctx' { interface GameEvents { monsterKilled: {...} } }`, then `ctx.events.emit(...)` / `ctx.events.on(...)`. Built-in: `login`, `logout`, `entityRemoved`, `hour`.
- Database: `ctx.db.migrateModule('mymodule', [sql1, sql2, ...])` applies your append-only list once (versioned in `schema_version` under your module name); then `ctx.db.run/get/all/transaction`. Wrap related writes in `ctx.db.transaction(() => {...})`. Never edit an applied migration - append.

## How to add a system (worked example)

Executable version: `packages/server/src/systems/example.test.ts` (it runs in CI, so it cannot rot).

```ts
// packages/server/src/systems/inn.ts
import { DataKey, GameError, type GameContext } from '../ctx';

const REST_PRICE = 5;
interface WolfState { spawnId: number; hits: number }
const WOLF = new DataKey<WolfState>('wolf');

export function register(ctx: GameContext): void {
  // Own tables (versioned per module).
  ctx.db.migrateModule('inn', ['CREATE TABLE inn_stays (char_id INTEGER NOT NULL, at INTEGER NOT NULL)']);

  // A client command: validate, mutate, mark dirty, tell the client.
  ctx.command('rest', (p, m) => {
    const npc = ctx.npcEntity(m.npc);
    if (!npc || Math.hypot(npc.x - p.entity.x, npc.y - p.entity.y) > 3) throw new GameError('too_far', 'Walk up to the innkeeper first.');
    if (p.save.gold < REST_PRICE) throw new GameError('no_gold', 'You cannot afford a room.');
    p.save.gold -= REST_PRICE;
    p.save.hp = p.entity.maxHp ?? p.save.hp;
    ctx.db.run('INSERT INTO inn_stays (char_id, at) VALUES (?, ?)', p.charId, ctx.now());
    ctx.markDirty(p);
    ctx.markMe(p);
    ctx.notify(p, 'good', 'You wake fully rested.');
  });

  // Entities with private typed state.
  const spawn = ctx.world.settlements[0].spawn;
  const wolf = ctx.entities.create({ kind: 'monster', name: 'Grey Wolf', x: spawn.x + 2, y: spawn.y, sprite: 'wolf', lv: 2, hp: 30, maxHp: 30 });
  WOLF.set(wolf, { spawnId: 1, hits: 0 });

  // What happens when a player reaches an entity (the core does the walking).
  ctx.onInteract('monster', (p, e) => {
    if (!WOLF.get(e)) return false;
    e.hp = Math.max(0, (e.hp ?? 0) - 10);
    ctx.entities.touch(e);
    return true;
  });

  // Timers and hooks.
  ctx.every(1000, () => { /* regenerate, respawn, expire... */ });
  ctx.onHour((events) => { for (const ev of events) if (ev.k === 'siege' && ev.start) ctx.chat.system('A siege has begun!'); });
}
```

Then in `systems/index.ts`:

```ts
import { register as registerInn } from './inn';
export const systems: SystemModule[] = [registerInn];
```

A system that throws during `register` aborts the boot (loudly); a system that throws later is isolated and logged.

### Rules of thumb

- Keep per-tick work bounded (iterate your own active sets, not all entities; use `entities.near` for spatial queries).
- Use `ctx.rng` (seeded) for gameplay randomness and `ctx.now()` for time, never `Math.random()`/`Date.now()`, so tests with the harness stay deterministic.
- Validate everything a command carries against `p.save` / world state; the schema only checks shapes and bounds.
- After mutating a save: `markDirty` + `markMe`. After changing an entity's visible field: `entities.touch`.
- Tests: `import { makeHarness } from '../testkit'` gives an in-memory `Game` (stub sim, fake clock, fake sockets): `const h = makeHarness(); register(h.game.ctx); const {p, conn} = h.join('Hero'); h.say(p, {t:'rest', npc: 1}); h.tick(); expect(conn.last('note'))...`.

## Wire conventions worth knowing

- **Entity patches (`ents.upd`)**: a moving entity's patch carries `x, y` (tile it is leaving), `nx, ny` (tile it is stepping onto), `step` (remaining ms of that step), `face`, `state`. When it stops: `nx = x, ny = y, step = 0`. `add` for an id the client already holds replaces the entity (used when an optional field is removed). Self is always visible; offline workers are visible with `online: false`; AOI radius 28 tiles with 3 tiles of hysteresis.
- **hello** is sent on every (re)connect; the client must drop its entity table and rebuild from the following `ents.add`.
- **Errors**: `{t:'err', code, text}` codes used by the core: `not_implemented`, `bad_message`, `rate_limited`, `busy`, `cannot_move`, `blocked`, `unreachable`, `too_far`, `not_found`, `slow_down`, `title_too_long`, `muted`, `internal`, `no_character`.
- **Close codes**: 4001 replaced by a newer login, 4002 bad auth / no character (do not reconnect), 4003 banned, 4004 rate abuse. A missing/invalid session at the upgrade is an HTTP 401 (the browser sees a failed connection, code 1006).
- **Gateway limits**: 4 KB per frame, 40 msg/s with burst 80, 8 "strikes" (bad/over-limit messages, one forgiven per 5 s) before closing with 4004, 30 s ping/pong heartbeat, slow consumers (>1 MB queued) are dropped, 20 sockets per IP.

## HTTP API

`POST /api/register` (201), `POST /api/login`, `POST /api/logout`, `GET /api/me` (401 when logged out), `POST /api/character/roll` (`{reroll?: boolean}`: `false` returns the pending roll, `true`/omitted spends a reroll once a roll exists; the very first roll is free), `POST /api/character/create` (`{name, look}`), `GET /api/world` (gzip, ETag), `GET /api/health`. Errors are always `{error: string}`; 429 carries `Retry-After`. Request bodies must be JSON (<= 8 KB). Register and login are limited to 10/min per IP, everything under `/api` to 240/min. The built client in `STATIC_DIR` is served with an SPA fallback (never for `/api`, `/ws` or paths with a file extension).

## Deviations, additions and known gaps

- Files beyond the brief: `server.ts` (assembly, so tests can start the server in-process), `game/commands.ts`, `game/chargen.ts`, `game/runtime.ts`, `net/ip.ts`, `testkit.ts`.
- `ctx.ts` additions: `movement.approach`, `onSave`, `onShutdown`, `onBuildMe`, `onPlayerSync`, `every`/`after`, `events` bus, `DataKey`, `GameError`, `NPC_DATA`.
- `RollPreview.origin.items` and `.skills` are human-readable strings (`"Grain x5"`, `"Iron Fist"`), not ids; the contract only says `string[]`.
- An unauthenticated websocket upgrade is answered with HTTP 401 as specified (clients see code 1006, not 4002).
- Sect chat works through `ctx.chat.setSectResolver` / `chatToSect`; until the social module lands, members are found by `save.sectId`. `PublicProfile.sect` and the leaderboard `sect` are `null` until then (decorate by overriding the `player` / `leaderboard` queries).
- Entities do not collide. Combat, monsters, items, shops, missions, jobs, sects, friends, duels are not implemented (their commands answer `not_implemented`).
- The world snapshot is a single kv row rewritten every 60 s (about 120 KB with the real sim, under 1 ms to serialise). Sim restore falls back to a fresh world (keeping a `sim.snapshot.broken.<time>` backup row) if the snapshot cannot be loaded.
- Single process, single SQLite connection: all DB calls are synchronous on the game loop. Keep heavy queries out of tick handlers.

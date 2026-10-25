/**
 * Server assembly: config -> database -> world -> simulation -> game -> systems -> HTTP + WebSocket.
 * `main.ts` calls `startServer()` and wires process signals; tests call it directly (port 3101).
 */
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { generateWorld, type WorldData } from '@murim/shared';
import { AuthService } from './auth';
import { loadConfig, type Config } from './config';
import type { SystemModule } from './ctx';
import { openDb, type Db } from './db';
import { CharacterService } from './game/chargen';
import { Game } from './game/context';
import { createLogger, type Logger } from './game/log';
import { Persistence, SIM_SNAPSHOT_KEY, SIM_STUB_SNAPSHOT_KEY, loadSimSnapshot } from './game/persist';
import { Runtime } from './game/runtime';
import { buildHttp } from './http';
import { Gateway } from './net/gateway';
import type { CreateSim, Sim } from './sim/api';
import { createStubSim } from './sim/stub';
import { systems as defaultSystems } from './systems';

export interface StartOptions {
  /** Environment to read the config from (default: process.env). */
  env?: Record<string, string | undefined>;
  /** Config overrides applied after the environment. */
  config?: Partial<Config>;
  log?: Logger;
  /** Clock override (tests). */
  now?: () => number;
  /** Systems to register instead of `systems/index.ts`. */
  systems?: SystemModule[];
}

export interface RunningServer {
  config: Config;
  port: number;
  host: string;
  log: Logger;
  db: Db;
  world: WorldData;
  sim: Sim;
  simKind: 'real' | 'stub';
  game: Game;
  runtime: Runtime;
  gateway: Gateway;
  app: FastifyInstance;
  /** Graceful shutdown: kick and save everyone, write the world snapshot, close sockets and the database. */
  close(): Promise<void>;
}

/** True when no `sim/index.*` file sits next to this module (the sim engineer has not delivered yet). */
function simIndexExists(): boolean {
  const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sim');
  return ['index.ts', 'index.js', 'index.mjs'].some((f) => fs.existsSync(path.join(dir, f)));
}

async function loadCreateSim(config: Config, log: Logger): Promise<{ create: CreateSim; kind: 'real' | 'stub' }> {
  if (config.simStub) {
    log.info('simulation: stub (SIM_STUB=1)');
    return { create: createStubSim, kind: 'stub' };
  }
  try {
    // @ts-ignore sim/index.ts belongs to the sim engineer and may not exist yet.
    const mod = (await import('./sim/index')) as { createSim?: CreateSim };
    if (typeof mod.createSim !== 'function') throw new Error('sim/index does not export createSim');
    log.info('simulation: sim/index');
    return { create: mod.createSim, kind: 'real' };
  } catch (err) {
    // A sim that exists but fails to load is a bug: fail loudly instead of silently running a fake world.
    if (simIndexExists()) throw err;
    log.warn('simulation: sim/index not found, falling back to the stub simulation');
    return { create: createStubSim, kind: 'stub' };
  }
}

interface BootedSim {
  sim: Sim;
  snapshotKey: string;
  /** Wall-clock ms at which the sim's current world hour began. */
  anchor: number;
}

/** Create the sim, restore the last snapshot and catch up on downtime (capped). */
function bootSim(create: CreateSim, kind: 'real' | 'stub', world: WorldData, db: Db, config: Config, log: Logger, now: () => number): BootedSim {
  const snapshotKey = kind === 'stub' ? SIM_STUB_SNAPSHOT_KEY : SIM_SNAPSHOT_KEY;
  const { worldSeed: seed, hourMs } = config;
  const t = now();
  let snap = loadSimSnapshot(db, snapshotKey, seed, log);
  let sim: Sim;
  try {
    sim = create(world, { seed, hourMs, nowMs: snap?.savedAt ?? t, saved: snap?.saved ?? null });
  } catch (err) {
    if (!snap) throw err;
    log.error('could not restore the world snapshot; keeping a backup and starting a fresh world', err);
    db.kvSet(`${snapshotKey}.broken.${t}`, db.kvGet(snapshotKey) ?? '');
    db.kvDelete(snapshotKey);
    snap = null;
    sim = create(world, { seed, hourMs, nowMs: t, saved: null });
  }
  let anchor = snap?.savedAt ?? t;
  if (snap) {
    const elapsed = Math.max(0, Math.floor((t - snap.savedAt) / hourMs));
    const steps = Math.min(elapsed, config.catchUpHours);
    try {
      for (let i = 1; i <= steps; i++) {
        // If more time passed than we are willing to simulate, the last step re-anchors to now.
        anchor = i === steps && elapsed > steps ? t : snap.savedAt + i * hourMs;
        sim.advanceHours(1, anchor);
      }
    } catch (err) {
      log.error('world catch-up failed part-way; continuing with the state reached', err);
    }
    if (steps > 0) log.info(`world caught up ${steps} hour(s) of downtime${elapsed > steps ? ` (${elapsed - steps} more skipped)` : ''}`);
    else anchor = snap.savedAt;
  }
  return { sim, snapshotKey, anchor };
}

export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  const config = loadConfig(opts.env ?? process.env, opts.config);
  const log = opts.log ?? createLogger(config.logLevel);
  const now = opts.now ?? Date.now;
  const startedAt = now();

  const db = openDb(config.dbPath);
  let game: Game | null = null;
  let app: FastifyInstance | null = null;
  try {
    const world = generateWorld(config.worldSeed);
    const { create, kind } = await loadCreateSim(config, log);
    const booted = bootSim(create, kind, world, db, config, log, now);
    const sim = booted.sim;

    game = new Game({ world, sim, config, db, log, now });
    for (const register of opts.systems ?? defaultSystems) register(game.ctx);
    game.start();

    const persistence = new Persistence(
      { db, sim, players: game.playerMgr, log: log.child('persist'), seed: config.worldSeed, snapshotKey: booted.snapshotKey, autosaveMs: config.autosaveMs, worldSaveMs: config.worldSaveMs },
      now(),
    );
    const runtime = new Runtime({ game, persistence, log, hourAnchor: booted.anchor });

    const auth = new AuthService(db, config, now);
    const chars = new CharacterService(db, world, now);
    app = await buildHttp({
      config,
      db,
      auth,
      chars,
      world,
      players: game.players,
      log: log.child('http'),
      now,
      health: () => ({ ok: true, uptimeSec: Math.round((now() - startedAt) / 1000), online: game!.players.onlineCount(), tickMs: Math.round(runtime.stats.avgMs * 10) / 10 }),
    });
    const gateway = new Gateway({ server: app.server, game, auth, config, log: log.child('ws'), now });

    await app.listen({ port: config.port, host: config.host });
    const address = app.server.address() as AddressInfo;
    runtime.start();
    log.info(`listening on http://${config.host}:${address.port} (seed ${config.worldSeed}, ${config.hourMs} ms per world hour, db ${config.dbPath})`);

    const liveGame = game;
    const liveApp = app;
    let closing: Promise<void> | null = null;
    return {
      config,
      port: address.port,
      host: config.host,
      log,
      db,
      world,
      sim,
      simKind: kind,
      game: liveGame,
      runtime,
      gateway,
      app: liveApp,
      close(): Promise<void> {
        closing ??= (async () => {
          log.info('shutting down');
          runtime.shutdown('The server is restarting.');
          await gateway.close();
          await liveApp.close();
          db.close();
          log.info('shutdown complete');
        })();
        return closing;
      },
    };
  } catch (err) {
    // Boot failed: release what was opened so the process (or test) can exit cleanly.
    try {
      await app?.close();
    } catch {
      /* ignore */
    }
    try {
      db.close();
    } catch {
      /* ignore */
    }
    throw err;
  }
}

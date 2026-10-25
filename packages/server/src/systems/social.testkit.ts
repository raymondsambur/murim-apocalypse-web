/**
 * Test rig for the social modules (not a test file): a harness with sects, masters, friends and duels
 * registered, and players that can be given a level / gold quickly and driven with `run`.
 */
import { Rng, type C2S, type S2C } from '@murim/shared';
import type { GameContext } from '../ctx';
import { Game } from '../game/context';
import { nullLogger } from '../game/log';
import type { PlayerImpl } from '../game/players';
import { makeHarness, FakeConn, type Harness } from '../testkit';
import { register as registerDuels } from './duels';
import { register as registerFriends } from './friends';
import { register as registerMasters } from './masters';
import { register as registerSects } from './sects';

export interface Who {
  p: PlayerImpl;
  conn: FakeConn;
  user: ReturnType<Harness['join']>['user'];
  /** Queue a command, run one tick; returns the error (if any) and the toast texts received. */
  run(msg: C2S): { err: Extract<S2C, { t: 'err' }> | undefined; notes: string[] };
}

export interface SocialRig {
  h: Harness;
  ctx: GameContext;
  join(name: string, opts?: { level?: number; gold?: number }): Who;
  /** Disconnect a player (as if the socket closed). */
  leave(w: Who): void;
  /** Reconnect an account that left. */
  rejoin(w: Who): Who;
  ask(w: Who, name: string, args: Record<string, unknown>): { ok: boolean; data?: unknown; err?: string };
  /** Register the social modules on a fresh Game that shares this rig's database (a "restart"). */
  restart(): { game: Game; ctx: GameContext };
}

export function makeSocialRig(register = true): SocialRig {
  const h = makeHarness();
  const ctx = h.game.ctx;
  if (register) {
    registerSects(ctx);
    registerMasters(ctx);
    registerFriends(ctx);
    registerDuels(ctx);
  }
  let qid = 0;
  const wrap = (p: PlayerImpl, conn: FakeConn, user: Who['user']): Who => ({
    p,
    conn,
    user,
    run(msg) {
      conn.clear();
      h.say(p, msg);
      h.tick();
      return { err: conn.last('err'), notes: conn.of('note').map((n) => n.text) };
    },
  });
  const rig: SocialRig = {
    h,
    ctx,
    join(name, opts = {}) {
      const j = h.join(name);
      j.p.save.level = opts.level ?? 1;
      j.p.save.gold = opts.gold ?? 0;
      j.p.save.talents = [];
      j.p.save.reputation = {};
      j.p.save.skills = {};
      ctx.markMe(j.p);
      h.tick();
      return wrap(j.p, j.conn, j.user);
    },
    leave(w) {
      h.game.disconnect(w.conn);
    },
    rejoin(w) {
      const conn = new FakeConn();
      const p = h.game.connect(conn, w.user);
      if (!p) throw new Error('rejoin failed');
      h.tick();
      return wrap(p, conn, w.user);
    },
    ask(w, name, args) {
      const id = ++qid;
      w.conn.clear();
      h.say(w.p, { t: 'q', id, name: name as never, args: args as never });
      const res = w.conn.of('res').find((r) => r.id === id);
      return { ok: !!res?.ok, data: res?.data, err: res?.err };
    },
    restart() {
      const game = new Game({ world: h.world, sim: h.game.sim, config: h.config, db: h.db, log: nullLogger, now: h.clock.now, rng: new Rng(7) });
      game.start();
      registerSects(game.ctx);
      registerMasters(game.ctx);
      registerFriends(game.ctx);
      registerDuels(game.ctx);
      return { game, ctx: game.ctx };
    },
  };
  return rig;
}

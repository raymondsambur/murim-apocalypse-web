import { CLOSE_REPLACED, PROTOCOL_VERSION, type EntityView } from '@murim/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GameError } from '../ctx';
import { makeHarness, type Harness } from '../testkit';
import { MAX_QUEUED_COMMANDS } from './players';

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});
afterEach(() => h.close());

/** Entity views the client would hold after applying all `ents` messages. */
function clientView(conn: ReturnType<Harness['join']>['conn']): Map<number, EntityView> {
  const m = new Map<number, EntityView>();
  for (const msg of conn.of('ents')) {
    for (const v of msg.add ?? []) m.set(v.id, { ...v });
    for (const p of msg.upd ?? []) {
      const cur = m.get(p.id);
      if (cur) Object.assign(cur, p);
    }
    for (const id of msg.del ?? []) m.delete(id);
  }
  return m;
}

describe('connect / hello', () => {
  it('sends hello with the full initial state', () => {
    const { p, conn } = h.join('Hero');
    const hello = conn.last('hello')!;
    expect(hello).toBeTruthy();
    expect(hello.protocol).toBe(PROTOCOL_VERSION);
    expect(hello.you.entityId).toBe(p.entity.id);
    expect(hello.you.c.name).toBe('Hero');
    expect(hello.you.xpNext).toBeGreaterThan(0);
    expect(hello.you.d.maxHp).toBeGreaterThan(0);
    expect(hello.settlements.length).toBe(h.world.settlements.length);
    expect(Buffer.from(hello.blight, 'base64').length).toBe(h.world.w * h.world.h);
    expect(hello.time.hourMs).toBe(h.config.hourMs);
    expect(p.online).toBe(true);
    expect(h.game.players.onlineCount()).toBe(1);
  });

  it('puts the player on its saved tile and shows nearby NPCs', () => {
    const { p, conn } = h.join('Hero');
    h.tick(2);
    const view = clientView(conn);
    expect(view.get(p.entity.id)?.kind).toBe('player');
    expect([...view.values()].some((e) => e.kind === 'npc')).toBe(true);
    expect(view.get(p.entity.id)?.x).toBe(p.entity.x);
  });

  it('a second login kicks the first connection but keeps the player', () => {
    const a = h.join('Hero');
    const conn2 = new (a.conn.constructor as new () => typeof a.conn)();
    const p2 = h.game.connect(conn2, a.user)!;
    expect(p2).toBe(a.p);
    expect(a.conn.closedWith?.code).toBe(CLOSE_REPLACED);
    expect(a.conn.of('kick').length).toBe(1);
    expect(conn2.of('hello').length).toBe(1);
    expect(h.game.players.onlineCount()).toBe(1);
    // The old socket closing later must not log the player out.
    h.game.disconnect(a.conn);
    expect(h.game.players.byCharId(a.p.charId)?.online).toBe(true);
  });

  it('returns null for an account without a character', () => {
    const user = h.db.createUser('nochar', 'x', 'y', h.clock.t)!;
    const conn = new (h.join('Tmp').conn.constructor as new () => ReturnType<Harness['join']>['conn'])();
    expect(h.game.connect(conn, user)).toBeNull();
  });

  it('logout removes the entity, saves, and a later login restores the position', () => {
    const a = h.join('Hero');
    // Walk along the town's main road (the spawn tile is on it), which is always clear.
    const target = { x: a.p.entity.x, y: a.p.entity.y + 3 };
    h.say(a.p, { t: 'move', x: target.x, y: target.y });
    h.tick(40);
    expect(a.p.entity.x).toBe(target.x);
    expect(a.p.entity.y).toBe(target.y);
    const entityId = a.p.entity.id;
    h.game.disconnect(a.conn);
    expect(h.game.entities.has(entityId)).toBe(false);
    expect(h.game.players.byCharId(a.p.charId)).toBeUndefined();
    const saved = h.db.getCharacterById(a.p.charId)!.save;
    expect(saved.x).toBe(target.x);
    expect(saved.y).toBe(target.y);

    const conn2 = new (a.conn.constructor as new () => typeof a.conn)();
    const p2 = h.game.connect(conn2, a.user)!;
    expect(p2.entity.x).toBe(target.x);
    expect(p2.entity.y).toBe(target.y);
  });

  it('keeps characters with an activity as offline workers visible to others', () => {
    const a = h.join('Worker');
    const b = h.join('Watcher');
    a.p.save.activity = { kind: 'train', since: h.clock.t, settled: h.clock.t, site: '0:dojo:0' };
    h.game.disconnect(a.conn);
    const worker = h.game.players.byCharId(a.p.charId)!;
    expect(worker.online).toBe(false);
    expect(worker.entity.online).toBe(false);
    expect(worker.entity.state).toBe('meditate');
    expect(h.game.players.onlineCount()).toBe(1);
    h.tick(3);
    const seen = clientView(b.conn).get(worker.entity.id);
    expect(seen?.online).toBe(false);
    // Ending the activity and refreshing drops the worker from the world.
    worker.save.activity = null;
    h.game.ctx.markMe(worker);
    expect(h.game.players.byCharId(a.p.charId)).toBeUndefined();
  });
});

describe('commands and queries', () => {
  it('queues commands and executes them on the next tick', () => {
    const { p, conn } = h.join('Hero');
    const goal = { x: p.entity.x + 2, y: p.entity.y };
    h.say(p, { t: 'move', x: goal.x, y: goal.y });
    expect(p.entity.move).toBeNull();
    h.tick(1);
    expect(p.entity.move).not.toBeNull();
    conn.clear();
    h.tick(1);
  });

  it('answers unimplemented commands with not_implemented', () => {
    const { p, conn } = h.join('Hero');
    h.say(p, { t: 'alloc', stat: 'might', n: 1 });
    h.tick();
    expect(conn.last('err')?.code).toBe('not_implemented');
  });

  it('answers unregistered queries with not_implemented and registered ones with data', () => {
    const { p, conn } = h.join('Hero');
    h.say(p, { t: 'q', id: 7, name: 'board', args: { settlement: 0 } });
    h.say(p, { t: 'q', id: 8, name: 'world', args: {} });
    const res = conn.of('res');
    expect(res.find((r) => r.id === 7)).toMatchObject({ ok: false, err: 'not_implemented' });
    const world = res.find((r) => r.id === 8)!;
    expect(world.ok).toBe(true);
    expect((world.data as { online: number }).online).toBe(1);
  });

  it('supports registering commands/queries, rejects duplicates, honours override', () => {
    const { p, conn } = h.join('Hero');
    const calls: string[] = [];
    h.game.ctx.command('flee', () => void calls.push('first'));
    expect(() => h.game.ctx.command('flee', () => {})).toThrow(/already registered/);
    h.game.ctx.command('flee', () => void calls.push('second'), { override: true });
    h.say(p, { t: 'flee' });
    h.tick();
    expect(calls).toEqual(['second']);

    h.game.ctx.query('friends', () => [{ id: 1, name: 'Bo', level: 3, online: true, status: 'friend' as const }]);
    h.say(p, { t: 'q', id: 1, name: 'friends', args: {} });
    expect(conn.of('res').find((r) => r.id === 1)?.ok).toBe(true);
  });

  it('turns GameError and crashes in handlers into replies without breaking the loop', () => {
    const { p, conn } = h.join('Hero');
    h.game.ctx.command('rest', () => {
      throw new GameError('no_gold', 'Not enough gold.');
    });
    h.game.ctx.command('breakthrough', () => {
      throw new Error('boom');
    });
    h.game.ctx.command('astop', async () => {
      throw new GameError('async_fail', 'Async refusal.');
    });
    h.game.ctx.query('sects', () => {
      throw new Error('query boom');
    });
    h.say(p, { t: 'rest', npc: 1 });
    h.say(p, { t: 'breakthrough' });
    h.say(p, { t: 'astop' });
    h.say(p, { t: 'q', id: 3, name: 'sects', args: {} });
    expect(() => h.tick(2)).not.toThrow();
    const errs = conn.of('err');
    expect(errs.map((e) => e.code)).toEqual(expect.arrayContaining(['no_gold', 'internal']));
    expect(conn.of('res').find((r) => r.id === 3)).toMatchObject({ ok: false, err: 'internal' });
    expect(JSON.stringify(conn.sent)).not.toContain('boom');
  });

  it('limits queued commands per player', () => {
    const { p, conn } = h.join('Hero');
    for (let i = 0; i < MAX_QUEUED_COMMANDS + 5; i++) h.say(p, { t: 'stop' });
    expect(conn.of('err').filter((e) => e.code === 'busy').length).toBe(5);
  });

  it('answers ping immediately', () => {
    const { p, conn } = h.join('Hero');
    h.say(p, { t: 'ping', t0: 123 });
    expect(conn.last('pong')).toMatchObject({ t0: 123, now: h.clock.t });
  });

  it('title: sets, validates and publishes the tag', () => {
    const { p, conn } = h.join('Hero');
    h.say(p, { t: 'title', title: '  Sword   Saint ' });
    h.tick(2);
    expect(p.save.title).toBe('Sword Saint');
    expect(p.entity.tag).toBe('Sword Saint');
    h.tick(2);
    expect(conn.of('me').length).toBeGreaterThan(0);
    h.say(p, { t: 'title', title: 'x'.repeat(40) });
    h.tick();
    expect(conn.last('err')?.code).toBe('title_too_long');
    h.say(p, { t: 'title', title: '' });
    h.tick(3);
    expect(p.save.title).toBe('');
    expect(p.entity.tag).toBeUndefined();
  });
});

describe('movement over the wire', () => {
  it('walks tile by tile with ents patches carrying the next tile and step time', () => {
    const { p, conn } = h.join('Hero');
    h.tick(1);
    conn.clear();
    const start = { x: p.entity.x, y: p.entity.y };
    const goal = { x: start.x, y: start.y + 4 }; // along the town's main road, always clear
    h.say(p, { t: 'move', x: goal.x, y: goal.y });
    h.tick(40);
    expect(p.entity.x).toBe(goal.x);
    expect(p.entity.y).toBe(goal.y);
    expect(p.entity.state).toBe('idle');
    const patches = conn.of('ents').flatMap((m) => m.upd ?? []).filter((u) => u.id === p.entity.id);
    expect(patches.length).toBeGreaterThanOrEqual(3);
    const walking = patches.filter((u) => u.nx !== undefined && u.step! > 0);
    expect(walking.length).toBeGreaterThanOrEqual(3);
    for (const u of walking) {
      expect(Math.max(Math.abs(u.nx! - u.x!), Math.abs(u.ny! - u.y!))).toBe(1);
      expect(u.step).toBeGreaterThan(0);
      expect(u.step).toBeLessThan(2000);
    }
    expect(patches.at(-1)).toMatchObject({ x: goal.x, y: goal.y, nx: goal.x, ny: goal.y, step: 0 });
  });

  it('throttles path-finding requests per player', () => {
    const { p, conn } = h.join('Hero');
    for (let i = 0; i < 6; i++) {
      for (let k = 0; k < 8; k++) h.say(p, { t: 'move', x: p.entity.x + (k % 2), y: p.entity.y + 1 });
      h.tick();
    }
    expect(conn.of('err').some((e) => e.code === 'slow_down')).toBe(true);
    h.tick(20);
    conn.clear();
    h.say(p, { t: 'move', x: p.entity.x + 1, y: p.entity.y });
    h.tick();
    expect(conn.of('err').some((e) => e.code === 'slow_down')).toBe(false);
  });

  it('refuses to move while fighting or busy, and reports unreachable targets', () => {
    const { p, conn } = h.join('Hero');
    p.combatId = 9;
    h.say(p, { t: 'move', x: p.entity.x + 1, y: p.entity.y });
    h.tick();
    expect(conn.last('err')?.code).toBe('cannot_move');
    p.combatId = null;
    p.save.activity = { kind: 'train', since: 0, settled: 0, site: 's' };
    conn.clear();
    h.say(p, { t: 'move', x: p.entity.x + 1, y: p.entity.y });
    h.tick();
    expect(conn.last('err')?.code).toBe('cannot_move');
    p.save.activity = null;
    // Open water far from the spawn cannot be reached or snapped to.
    conn.clear();
    h.say(p, { t: 'move', x: 0, y: 0 });
    h.tick();
    expect(conn.last('err')).toBeTruthy();
  });

  it('stop halts after the current step', () => {
    const { p } = h.join('Hero');
    h.say(p, { t: 'move', x: p.entity.x + 8, y: p.entity.y });
    h.tick(3);
    h.say(p, { t: 'stop' });
    h.tick(10);
    expect(p.entity.move).toBeNull();
    expect(p.entity.x).toBeLessThan(p.save.x + 8);
  });
});

describe('interaction', () => {
  it('walks to an NPC and fires the onInteract handlers', () => {
    const { p, conn } = h.join('Hero');
    h.tick(2);
    const npc = h.game.entities.nearest(p.entity.x, p.entity.y, 20, (e) => e.kind === 'npc' && e.id !== p.entity.id)!;
    expect(npc).toBeTruthy();
    const seen: string[] = [];
    h.game.ctx.onInteract('npc', (who, e) => {
      seen.push(`${who.name}->${e.name}`);
      return true;
    });
    h.say(p, { t: 'interact', id: npc.id });
    h.tick(120);
    expect(seen).toEqual([`Hero->${npc.name}`]);
    expect(Math.hypot(p.entity.x - npc.x, p.entity.y - npc.y)).toBeLessThanOrEqual(1.6);
    expect(conn.of('note').length).toBe(0);
  });

  it('falls back to the greeting when nothing handles an NPC, and rejects unknown targets', () => {
    const { p, conn } = h.join('Hero');
    h.tick(2);
    const npc = h.game.entities.nearest(p.entity.x, p.entity.y, 20, (e) => e.kind === 'npc')!;
    h.say(p, { t: 'interact', id: npc.id });
    h.tick(120);
    expect(conn.last('note')?.text).toContain(npc.name);
    h.say(p, { t: 'interact', id: 999999 });
    h.tick();
    expect(conn.last('err')?.code).toBe('not_found');
  });

  it('an erroring interact handler does not stop later handlers or the loop', () => {
    const { p } = h.join('Hero');
    h.tick(2);
    const npc = h.game.entities.nearest(p.entity.x, p.entity.y, 20, (e) => e.kind === 'npc')!;
    let second = false;
    h.game.ctx.onInteract('npc', () => {
      throw new Error('bad handler');
    });
    h.game.ctx.onInteract('npc', () => (second = true));
    h.say(p, { t: 'interact', id: npc.id });
    expect(() => h.tick(120)).not.toThrow();
    expect(second).toBe(true);
  });
});

describe('chat', () => {
  it('local chat reaches nearby players only; whisper by exact name; world rate-limited', () => {
    const a = h.join('Alice');
    const b = h.join('Bob');
    const far = h.join('Faraway', { x: h.world.settlements[3].spawn.x, y: h.world.settlements[3].spawn.y });
    h.tick(2);
    [a.conn, b.conn, far.conn].forEach((c) => c.clear());

    h.say(a.p, { t: 'chat', ch: 'local', text: 'hello   there ' });
    h.tick();
    expect(b.conn.last('chat')?.msg).toMatchObject({ ch: 'local', from: 'Alice', text: 'hello there', fromId: a.p.entity.id });
    expect(a.conn.of('chat').length).toBe(1);
    expect(far.conn.of('chat').length).toBe(0);

    h.say(a.p, { t: 'chat', ch: 'whisper', to: 'bob', text: 'psst' });
    h.tick(10);
    expect(b.conn.last('chat')?.msg).toMatchObject({ ch: 'whisper', to: 'Bob', text: 'psst' });
    expect(far.conn.of('chat').length).toBe(0);

    h.say(a.p, { t: 'chat', ch: 'world', text: 'one' });
    h.tick();
    h.say(a.p, { t: 'chat', ch: 'world', text: 'two' });
    h.tick();
    expect(far.conn.of('chat').filter((c) => c.msg.ch === 'world').map((c) => c.msg.text)).toEqual(['one']);
    expect(a.conn.last('note')?.text).toMatch(/3 seconds/);
    h.tick(35);
    h.say(a.p, { t: 'chat', ch: 'world', text: 'three' });
    h.tick();
    expect(far.conn.of('chat').filter((c) => c.msg.ch === 'world').length).toBe(2);
  });

  it('muted players cannot speak; sect chat needs a sect; unknown whisper targets are told so', () => {
    const a = h.join('Alice');
    h.join('Bob');
    a.p.mutedUntil = h.clock.t + 60000;
    h.say(a.p, { t: 'chat', ch: 'local', text: 'hi' });
    h.tick();
    expect(a.conn.last('note')?.text).toMatch(/muted/);
    a.p.mutedUntil = 0;
    h.say(a.p, { t: 'chat', ch: 'sect', text: 'hi' });
    h.say(a.p, { t: 'chat', ch: 'whisper', to: 'Nobody', text: 'hi' });
    h.tick();
    const notes = a.conn.of('note').map((n) => n.text);
    expect(notes.some((t) => /not in a sect/.test(t))).toBe(true);
    expect(notes.some((t) => /not online/.test(t))).toBe(true);
  });

  it('slash commands are admin only', () => {
    const a = h.join('Alice');
    h.say(a.p, { t: 'chat', ch: 'world', text: '/announce hello world' });
    h.tick();
    expect(a.conn.last('note')?.text).toBe('Unknown command.');
    expect(a.conn.of('chat').length).toBe(0);
  });
});

describe('me refresh and autosave', () => {
  it('coalesces markMe to at most one me per 250 ms', () => {
    const { p, conn } = h.join('Hero');
    h.tick(3);
    conn.clear();
    for (let i = 0; i < 20; i++) h.game.ctx.markMe(p);
    h.tick(1);
    expect(conn.of('me').length).toBe(1);
    for (let i = 0; i < 20; i++) h.game.ctx.markMe(p);
    h.tick(1);
    expect(conn.of('me').length).toBe(1);
    h.tick(3);
    expect(conn.of('me').length).toBe(2);
  });

  it('saveDirty writes changed or moved players only', () => {
    const { p } = h.join('Hero');
    expect(h.game.playerMgr.saveDirty()).toBe(0);
    p.save.gold += 5;
    h.game.ctx.markDirty(p);
    expect(h.game.playerMgr.saveDirty()).toBe(1);
    expect(h.db.getCharacterById(p.charId)!.save.gold).toBe(p.save.gold);
    expect(h.game.playerMgr.saveDirty()).toBe(0);
  });

  it('onSave runs before every write; onShutdown runs once at shutdown; both survive throwing handlers', () => {
    const saved: string[] = [];
    let shutdowns = 0;
    h.game.ctx.onSave((pl) => void saved.push(pl.name));
    h.game.ctx.onSave(() => {
      throw new Error('bad save hook');
    });
    h.game.ctx.onShutdown(() => void shutdowns++);
    const a = h.join('Alice');
    h.join('Bob');
    a.p.save.gold += 1;
    h.game.ctx.markDirty(a.p);
    h.game.playerMgr.saveDirty();
    expect(saved).toEqual(['Alice']);
    h.game.disconnectAll('bye');
    expect(shutdowns).toBe(1);
    expect(saved).toEqual(expect.arrayContaining(['Alice', 'Bob']));
    expect(h.db.getCharacterById(a.p.charId)!.save.gold).toBe(a.p.save.gold);
  });

  it('onBuildMe decorators run for me and hello', () => {
    h.game.ctx.onBuildMe((_p, me) => {
      me.sect = { id: 1, name: 'Azure', tag: 'AZ', role: 'leader' };
    });
    const { conn } = h.join('Hero');
    expect(conn.last('hello')?.you.sect?.tag).toBe('AZ');
  });
});

describe('world hours', () => {
  it('fans out sim events to clients and onHour handlers', () => {
    const a = h.join('Hero');
    a.conn.clear();
    const hours: number[] = [];
    h.game.ctx.onHour((events) => void hours.push(events.length));
    h.game.ctx.onHour(() => {
      throw new Error('bad hour handler');
    });
    // Stub emits a chronicle line every 6 hours and blight flicker every hour.
    for (let i = 0; i < 6; i++) h.game.advanceHour(h.clock.advance(h.config.hourMs));
    expect(hours.length).toBe(6);
    expect(a.conn.of('time').length).toBe(6);
    expect(a.conn.of('chron').length).toBeGreaterThanOrEqual(1);
    const blight = a.conn.of('blight');
    expect(blight.length).toBe(6);
    expect(blight[0].idx!.length).toBeGreaterThan(0);
    expect(blight[0].val!.length).toBe(blight[0].idx!.length);
  });

  it('time view advances with the world clock', () => {
    const t0 = h.game.sim.timeView(h.clock.t);
    h.game.advanceHour(h.clock.advance(h.config.hourMs));
    const t1 = h.game.sim.timeView(h.clock.t);
    expect((t1.hours - t0.hours + 24) % 24).toBeCloseTo(1, 0);
  });
});

describe('npcs', () => {
  it('mirrors the sim roster and follows sim events', () => {
    const roster = h.game.sim.npcs().filter((n) => n.alive);
    expect(h.game.npcs.count).toBe(roster.length);
    const victim = roster[0];
    const ent = h.game.ctx.npcEntity(victim.id)!;
    expect(ent.kind).toBe('npc');
    expect(ent.name).toBe(victim.name);
    victim.alive = false;
    h.game.npcs.onSimEvents([{ k: 'npcDied', id: victim.id }]);
    expect(h.game.ctx.npcEntity(victim.id)).toBeUndefined();
    expect(h.game.entities.has(ent.id)).toBe(false);
    victim.alive = true;
    h.game.npcs.onSimEvents([{ k: 'npcBorn', id: victim.id }]);
    expect(h.game.ctx.npcEntity(victim.id)).toBeTruthy();
  });

  it('wanders around home when a player is nearby, never far away', () => {
    const { p } = h.join('Hero');
    const sim = h.game.sim;
    const npcs = sim.npcs().filter((n) => n.settlementId === 0);
    // 10 minutes of game time.
    h.tick(6000);
    for (const n of npcs) {
      const e = h.game.ctx.npcEntity(n.id)!;
      expect(Math.max(Math.abs(e.x - n.homeX), Math.abs(e.y - n.homeY))).toBeLessThanOrEqual(8);
    }
    expect(p.online).toBe(true);
  });
});

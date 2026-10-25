import { INVENTORY_SLOTS, Rng, type NodeKind, type SimEvent } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import type { Entity } from '../ctx';
import { makeRig, stackOf, type Rig } from './econ.testkit';
import { BLESSING_BUFF, GATHER_MS, NODE, RESPAWN_MAX_MS, rollGather } from './nodes';

const nodesOf = (r: Rig, kind: NodeKind): Entity[] => r.ctx.entities.ofKind('node').filter((e) => e.nodeKind === kind);

/** Stand on the first node of a kind and interact. */
function touch(r: Rig, kind: NodeKind, which = 0): Entity {
  const node = nodesOf(r, kind)[which];
  r.stand(node);
  r.conn.clear();
  r.h.say(r.p, { t: 'interact', id: node.id });
  r.h.tick();
  return node;
}

describe('rollGather', () => {
  it('yields herbs 1-3, ore 1-3 with a rare silver, and bonuses from job level and fortune', () => {
    const rng = new Rng(5);
    const seen = new Set<number>();
    let silver = 0;
    for (let i = 0; i < 400; i++) {
      const h = rollGather(rng, 'herb', 1, 0);
      expect(h.drops).toHaveLength(1);
      expect(h.drops[0].id).toBe('herb');
      expect(h.drops[0].qty).toBeGreaterThanOrEqual(1);
      expect(h.drops[0].qty).toBeLessThanOrEqual(3);
      expect(h.job).toBe('herbalist');
      seen.add(h.drops[0].qty);
      const o = rollGather(rng, 'ore', 1, 0);
      expect(o.job).toBe('miner');
      expect(o.drops[0].id).toBe('ore_iron');
      if (o.drops.length > 1) {
        silver++;
        expect(o.drops[1]).toEqual({ id: 'ore_silver', qty: 1 });
      }
    }
    expect([...seen].sort()).toEqual([1, 2, 3]);
    expect(silver / 400).toBeGreaterThan(0.04);
    expect(silver / 400).toBeLessThan(0.18);
    // +1 per 5 job levels
    for (let i = 0; i < 50; i++) expect(rollGather(rng, 'herb', 10, 0).drops[0].qty).toBeGreaterThanOrEqual(3);
    // fortune adds an occasional +1
    let bonus = 0;
    for (let i = 0; i < 400; i++) if (rollGather(new Rng(i), 'rareHerb', 1, 100).drops[0].qty === 2) bonus++;
    expect(bonus).toBeGreaterThan(100);
    expect(rollGather(rng, 'rareHerb', 1, 0).drops).toEqual([{ id: 'herb_rare', qty: 1 }]);
  });
});

describe('nodes at boot', () => {
  it('creates an entity for every world node, hearts included', () => {
    const r = makeRig();
    expect(r.ctx.entities.count('node')).toBe(r.h.world.nodes.length);
    for (const kind of ['herb', 'rareHerb', 'ore', 'shrine', 'heart'] as NodeKind[]) {
      expect(nodesOf(r, kind)).toHaveLength(r.h.world.nodes.filter((n) => n.kind === kind).length);
    }
    expect(nodesOf(r, 'heart').length).toBeGreaterThan(0);
  });

  it('hearts are left to the combat module', () => {
    const r = makeRig();
    touch(r, 'heart');
    expect(r.p.entity.state).not.toBe('work');
    expect(r.conn.of('note').at(-1)?.text).toBe('Nothing happens.');
  });
});

describe('gathering', () => {
  it('takes 3 seconds, yields items and job xp, removes the node and respawns it elsewhere', () => {
    const r = makeRig();
    const events: string[] = [];
    r.ctx.events.on('nodeGathered', (ev) => void events.push(`${ev.kind}@${ev.player.name}`));
    const before = nodesOf(r, 'herb').length;
    const node = touch(r, 'herb');
    const st = NODE.get(node)!;
    const home = { x: node.x, y: node.y };
    expect(r.p.entity.state).toBe('work');
    expect(st.busyWith).toBe(r.p.charId);
    // Not yet.
    r.h.tick(GATHER_MS / 100 - 5);
    expect(r.p.save.inventory).toHaveLength(0);
    expect(r.p.entity.state).toBe('work');
    // A save/markMe in the middle does not flatten the state.
    r.ctx.markMe(r.p);
    r.h.tick(1);
    expect(r.p.entity.state).toBe('work');
    r.h.tick(6);
    const herb = r.p.save.inventory.find((s) => s.id === 'herb');
    expect(herb?.qty).toBeGreaterThanOrEqual(1);
    expect(herb?.qty).toBeLessThanOrEqual(3);
    expect(r.p.save.jobs.herbalist.xp + (r.p.save.jobs.herbalist.lv - 1) * 1000).toBeGreaterThan(0);
    expect(r.p.entity.state).toBe('idle');
    expect(events).toEqual(['herb@Hero']);
    expect(r.conn.of('fx').some((f) => f.kind === 'gather' && f.entity === node.id)).toBe(true);
    expect(r.ctx.entities.has(node.id)).toBe(false);
    expect(nodesOf(r, 'herb')).toHaveLength(before - 1);
    // Respawn within 120-300 s, near the original spot.
    r.h.tick(1200 - 20);
    expect(nodesOf(r, 'herb')).toHaveLength(before - 1);
    r.h.tick(RESPAWN_MAX_MS / 100 - 1200 + 40);
    const now = nodesOf(r, 'herb');
    expect(now).toHaveLength(before);
    const fresh = now.find((e) => NODE.get(e)?.defId === st.defId)!;
    expect(fresh.id).not.toBe(node.id);
    expect(Math.hypot(fresh.x - home.x, fresh.y - home.y)).toBeLessThanOrEqual(8 * Math.SQRT2 + 0.01);
    expect(Math.hypot(fresh.x - home.x, fresh.y - home.y)).toBeGreaterThanOrEqual(2);
    expect(r.h.world.terrain[fresh.y * r.h.world.w + fresh.x]).toBe(st.terrain);
  });

  it('ore gives iron and mining xp', () => {
    const r = makeRig();
    touch(r, 'ore');
    r.h.tick(GATHER_MS / 100 + 2);
    expect(r.p.save.inventory.some((s) => s.id === 'ore_iron')).toBe(true);
    expect(r.p.save.jobs.miner.xp).toBeGreaterThan(0);
    expect(r.p.save.jobs.herbalist.xp).toBe(0);
  });

  it('rare herbs need herbalist level 3', () => {
    const r = makeRig();
    touch(r, 'rareHerb');
    expect(r.p.entity.state).not.toBe('work');
    expect(r.conn.of('note').at(-1)?.text).toContain('Herbalist level 3');
    r.h.tick(GATHER_MS / 100 + 2);
    expect(r.p.save.inventory).toHaveLength(0);
    r.p.save.jobs.herbalist.lv = 3;
    touch(r, 'rareHerb');
    r.h.tick(GATHER_MS / 100 + 2);
    expect(r.p.save.inventory[0]).toMatchObject({ id: 'herb_rare' });
  });

  it('job level adds quantity', () => {
    const r = makeRig();
    r.p.save.jobs.miner.lv = 10;
    touch(r, 'ore');
    r.h.tick(GATHER_MS / 100 + 2);
    expect(r.p.save.inventory.find((s) => s.id === 'ore_iron')!.qty).toBeGreaterThanOrEqual(3);
  });

  it('stop and move cancel the gather and leave the node alone', () => {
    const r = makeRig();
    const node = touch(r, 'herb');
    r.h.tick(10);
    expect(r.run({ t: 'stop' }).err).toBeUndefined();
    expect(r.p.entity.state).toBe('idle');
    expect(NODE.get(node)!.busyWith).toBeNull();
    r.h.tick(40);
    expect(r.p.save.inventory).toHaveLength(0);
    expect(r.ctx.entities.has(node.id)).toBe(true);

    r.h.say(r.p, { t: 'interact', id: node.id });
    r.h.tick();
    expect(r.p.entity.state).toBe('work');
    r.h.tick(10);
    expect(r.run({ t: 'move', x: node.x + 2, y: node.y }).err).toBeUndefined();
    expect(r.p.entity.state).not.toBe('work');
    r.h.tick(60);
    expect(r.p.save.inventory).toHaveLength(0);
    expect(r.ctx.entities.has(node.id)).toBe(true);
  });

  it('a fight, leaving or logging out interrupts it', () => {
    const r = makeRig();
    const node = touch(r, 'ore');
    r.h.tick(5);
    r.p.combatId = 9;
    r.h.tick(2);
    expect(NODE.get(node)!.busyWith).toBeNull();
    r.h.tick(40);
    expect(r.p.save.inventory).toHaveLength(0);
    expect(r.ctx.entities.has(node.id)).toBe(true);
    r.p.combatId = null;
    touch(r, 'ore');
    r.h.game.disconnect(r.conn);
    expect(NODE.get(node)!.busyWith).toBeNull();
  });

  it('refuses with a full bag; keeps what fits when the bag fills up meanwhile', () => {
    const r = makeRig();
    r.p.save.inventory = Array.from({ length: INVENTORY_SLOTS }, () => stackOf('hide', 99));
    touch(r, 'herb');
    expect(r.p.entity.state).not.toBe('work');
    expect(r.conn.of('note').at(-1)?.text).toBe('Your bag is full.');
    // One spot left in a herb stack: the yield is cut to fit and the player is told.
    r.p.save.inventory[0] = stackOf('herb', 98);
    r.p.save.jobs.herbalist.lv = 15; // +3, so at least 4 herbs
    touch(r, 'herb', 1);
    expect(r.p.entity.state).toBe('work');
    r.h.tick(GATHER_MS / 100 + 2);
    expect(r.p.save.inventory[0].qty).toBe(99);
    expect(r.conn.of('note').at(-1)?.level).toBe('warn');
  });

  it('only one player works a node at a time', () => {
    const r = makeRig();
    const { p: rival, conn: rivalConn } = r.h.join('Rival');
    rival.save.inventory = [];
    const node = touch(r, 'herb');
    r.h.game.movement.teleport(rival.entity, node.x, node.y);
    r.h.tick(2);
    rivalConn.clear();
    r.h.say(rival, { t: 'interact', id: node.id });
    r.h.tick();
    expect(rival.entity.state).not.toBe('work');
    expect(rivalConn.of('note').at(-1)?.text).toContain('already working');
    r.h.tick(GATHER_MS / 100 + 2);
    expect(r.p.save.inventory.some((s) => s.id === 'herb')).toBe(true);
    expect(rival.save.inventory.some((s) => s.id === 'herb')).toBe(false);
  });
});

describe('shrines', () => {
  it('heals half, grants the blessing, purifies the Blight and cools down for 10 minutes per player and shrine', () => {
    const r = makeRig();
    const purified: unknown[][] = [];
    const evs: SimEvent[] = [{ k: 'settle', id: 0 }];
    Object.assign(r.sim, { purify: (...a: unknown[]) => (purified.push(a), evs) });
    const fanned: SimEvent[][] = [];
    r.ctx.fanOut = (e) => void fanned.push([...e]);
    r.p.save.hp = 1;
    r.p.save.qi = 0;
    const shrine = touch(r, 'shrine');
    const max = r.p.entity.maxHp!;
    expect(r.p.save.hp).toBeGreaterThanOrEqual(Math.floor(max * 0.5));
    expect(r.p.save.hp).toBeLessThan(max);
    expect(r.p.save.qi).toBeGreaterThan(0);
    const now = r.ctx.now();
    expect(r.p.save.buffs?.[BLESSING_BUFF]).toBeGreaterThan(now + 9 * 60_000);
    expect(purified).toEqual([[shrine.x, shrine.y, 6, 30]]);
    expect(fanned).toEqual([evs]);
    expect(r.conn.of('fx').some((f) => f.kind === 'purify' && f.entity === shrine.id)).toBe(true);
    expect(r.conn.last('note')?.level).toBe('good');

    // Again straight away: nothing happens.
    const hp = r.p.save.hp;
    r.p.save.hp = 1;
    r.conn.clear();
    r.h.say(r.p, { t: 'interact', id: shrine.id });
    r.h.tick();
    expect(r.p.save.hp).toBe(1);
    expect(purified).toHaveLength(1);
    expect(r.conn.last('note')?.text).toContain('returns in');
    expect(hp).toBeGreaterThan(1);

    // Another shrine is independent.
    touch(r, 'shrine', 1);
    expect(r.p.save.hp).toBeGreaterThan(1);
    expect(purified).toHaveLength(2);

    // After 10 minutes the first one works again; another player was never blocked.
    r.h.tick(6000 + 10);
    r.p.save.hp = 1;
    touch(r, 'shrine', 0);
    expect(r.p.save.hp).toBeGreaterThan(1);
    expect(purified).toHaveLength(3);
  });

  it('is not used in a fight', () => {
    const r = makeRig();
    r.p.save.hp = 1;
    r.p.combatId = 3;
    touch(r, 'shrine');
    expect(r.p.save.hp).toBe(1);
    expect(r.p.save.buffs?.[BLESSING_BUFF]).toBeUndefined();
  });
});

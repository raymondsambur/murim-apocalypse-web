import { INVENTORY_SLOTS, MAX_ACTIVE_MISSIONS, type MissionOffer, type SimEvent } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import type { MonsterKilledEvent } from './events';
import { makeRig, NPC, stackOf, type Rig } from './econ.testkit';
import { getServices } from './services';

let nextId = 1;
function offer(extra: Partial<MissionOffer> = {}): MissionOffer {
  const id = extra.id ?? `m${nextId++}`;
  return {
    id,
    type: 'hunt',
    title: `Job ${id}`,
    desc: 'Do it.',
    settlementId: 0,
    giverId: NPC.elder,
    target: { monster: 'wolf', family: 'beast', count: 2, x: 0, y: 0, radius: 10 },
    minRank: 1,
    level: 2,
    reward: { xp: 40, gold: 25, rep: { faction: 'azure', amount: 4 }, items: [{ id: 'pill_heal_s', qty: 2 }] },
    expires: 50,
    ...extra,
  };
}

function kill(r: Rig, extra: Partial<MonsterKilledEvent> = {}): void {
  r.ctx.events.emit('monsterKilled', { killers: [r.p], entityId: 1, defId: 'wolf', family: 'beast', level: 2, elite: 0, x: 0, y: 0, spawnId: 1, siege: null, bountyFor: null, heartId: null, ...extra });
}

function accept(r: Rig, o: MissionOffer, settlement = o.settlementId) {
  r.board.push(o);
  return r.run({ t: 'maccept', offer: o.id, settlement });
}

const mission = (r: Rig, id: string) => r.p.save.missions.find((m) => m.id === id);

/** Fake monsters service recording what the missions module asks of it. */
function fakeMonsters(r: Rig, mode: 'ok' | 'none' = 'ok') {
  const calls: { spawn: unknown[][]; removed: number[] } = { spawn: [], removed: [] };
  getServices(r.ctx).monsters = {
    spawnBounty: (owner, defId, level, elite, near) => {
      calls.spawn.push([owner.charId, defId, level, elite, near]);
      return mode === 'none' ? null : r.ctx.entities.create({ kind: 'monster', name: 'Bounty', x: owner.entity.x, y: owner.entity.y, data: { bountyFor: owner.charId } });
    },
    removeBounty: (charId) => void calls.removed.push(charId),
  };
  return calls;
}

describe('board and accept', () => {
  it('serves the board of a settlement the player stands in', () => {
    const r = makeRig();
    const o = offer();
    r.board.push(o, offer({ settlementId: 1 }));
    const res = r.ask('board', { settlement: 0 });
    expect(res?.ok).toBe(true);
    const data = res?.data as { offers: MissionOffer[]; settlement: { id: number } };
    expect(data.offers.map((x) => x.id)).toEqual([o.id]);
    expect(data.settlement.id).toBe(0);
    expect(r.ask('board', { settlement: 1 })?.err).toBe('too_far');
    expect(r.ask('board', { settlement: 999 })?.err).toBe('not_found');
    expect(r.ask('board', { settlement: 0.5 })?.err).toBe('not_found');
  });

  it('accepting creates an active mission, takes the offer off the board and pushes an update', () => {
    const r = makeRig();
    const o = offer();
    expect(accept(r, o).err).toBeUndefined();
    const m = mission(r, o.id)!;
    expect(m).toMatchObject({ id: o.id, type: 'hunt', progress: 0, done: false, acceptedDay: r.sim.clock().day, reward: o.reward });
    expect(r.board).toHaveLength(0);
    const upd = r.conn.last('mission')?.update;
    expect(upd).toMatchObject({ id: o.id, progress: 0, done: false });
    expect(upd).not.toBe(m);
    expect(r.conn.last('me')).toBeTruthy();
  });

  it('refuses for every reason without losing the offer', () => {
    const r = makeRig();
    const high = offer({ minRank: 2 });
    r.board.push(high);
    expect(r.run({ t: 'maccept', offer: high.id, settlement: 0 }).err?.code).toBe('rank_low');
    expect(r.run({ t: 'maccept', offer: 'nope', settlement: 0 }).err?.code).toBe('gone');
    expect(r.run({ t: 'maccept', offer: high.id, settlement: 999 }).err?.code).toBe('not_found');
    r.p.combatId = 1;
    expect(r.run({ t: 'maccept', offer: high.id, settlement: 0 }).err?.code).toBe('in_combat');
    r.p.combatId = null;
    expect(r.board).toHaveLength(1);
    const far = r.h.world.settlements[1].spawn;
    r.h.game.movement.teleport(r.p.entity, far.x, far.y);
    const other = offer();
    r.board.push(other);
    expect(r.run({ t: 'maccept', offer: other.id, settlement: 0 }).err?.code).toBe('too_far');
    expect(r.p.save.missions).toHaveLength(0);
  });

  it('refuses duplicates and more than MAX_ACTIVE_MISSIONS', () => {
    const r = makeRig();
    const o = offer();
    accept(r, o);
    r.board.push(o); // the same id appears on the board again
    expect(r.run({ t: 'maccept', offer: o.id, settlement: 0 }).err?.code).toBe('duplicate');
    for (let i = 1; i < MAX_ACTIVE_MISSIONS; i++) expect(accept(r, offer()).err).toBeUndefined();
    expect(r.p.save.missions).toHaveLength(MAX_ACTIVE_MISSIONS);
    const extra = offer();
    expect(accept(r, extra).err?.code).toBe('too_many');
    expect(r.board.some((b) => b.id === extra.id)).toBe(true);
  });

  it('abandoning removes the mission and returns the offer to the board', () => {
    const r = makeRig();
    const o = offer();
    accept(r, o);
    kill(r);
    expect(r.run({ t: 'mabandon', id: o.id }).err).toBeUndefined();
    expect(r.p.save.missions).toHaveLength(0);
    expect(r.board).toHaveLength(1);
    expect(r.board[0]).toMatchObject({ id: o.id, reward: o.reward });
    expect(r.board[0]).not.toHaveProperty('progress');
    expect(r.run({ t: 'mabandon', id: o.id }).err?.code).toBe('not_found');
  });
});

describe('progress', () => {
  it('hunt counts kills of the target species (or family) by credited killers only', () => {
    const r = makeRig();
    const o = offer({ target: { monster: 'wolf', family: 'beast', count: 3 } });
    accept(r, o);
    kill(r, { defId: 'boar' });
    kill(r, { killers: [] });
    kill(r, { bountyFor: r.p.charId });
    expect(mission(r, o.id)?.progress).toBe(0);
    r.conn.clear();
    kill(r);
    kill(r);
    expect(mission(r, o.id)).toMatchObject({ progress: 2, done: false });
    expect(r.conn.of('mission')).toHaveLength(2);
    kill(r);
    expect(mission(r, o.id)).toMatchObject({ progress: 3, done: true });
    kill(r);
    expect(mission(r, o.id)?.progress).toBe(3);
    expect(r.conn.of('note').some((n) => n.text.includes('Objective complete'))).toBe(true);
    // Family-only hunts accept any species of that family.
    const f = offer({ target: { family: 'bandit', count: 1 } });
    accept(r, f);
    kill(r, { defId: 'thug', family: 'bandit' });
    expect(mission(r, f.id)?.done).toBe(true);
  });

  it('purify counts only Blight kills inside the target radius', () => {
    const r = makeRig();
    const o = offer({ type: 'purify', target: { family: 'blight', count: 2, x: 100, y: 60, radius: 8 } });
    accept(r, o);
    kill(r, { defId: 'hollow', family: 'blight', x: 100, y: 70 }); // 10 tiles away
    kill(r, { defId: 'wolf', family: 'beast', x: 100, y: 60 });
    expect(mission(r, o.id)?.progress).toBe(0);
    kill(r, { defId: 'hollow', family: 'blight', x: 104, y: 66 }); // exactly 7.2 tiles
    kill(r, { defId: 'hound', family: 'blight', x: 100, y: 60 });
    expect(mission(r, o.id)).toMatchObject({ progress: 2, done: true });
  });

  it('defend counts siege monsters of that settlement while the siege lasts', () => {
    const r = makeRig();
    const o = offer({ type: 'defend', target: { family: 'bandit', count: 2, x: 0, y: 0, radius: 20 } });
    accept(r, o);
    kill(r, { family: 'bandit', defId: 'thug', siege: 0 }); // no siege running
    expect(mission(r, o.id)?.progress).toBe(0);
    const st = r.sim.state.settlements[0];
    st.siegeUntil = r.sim.state.clock.totalHours + 10;
    kill(r, { family: 'bandit', defId: 'thug', siege: 1 }); // another settlement's wave
    kill(r, { family: 'bandit', defId: 'thug', siege: null }); // an ordinary bandit
    expect(mission(r, o.id)?.progress).toBe(0);
    kill(r, { family: 'bandit', defId: 'thug', siege: 0 });
    kill(r, { family: 'bandit', defId: 'archer', siege: 0 });
    expect(mission(r, o.id)).toMatchObject({ progress: 2, done: true });
  });

  it('bounty: accepting spawns the personal target, killing it finishes the job, abandoning removes it', () => {
    const r = makeRig();
    const calls = fakeMonsters(r);
    const o = offer({ type: 'bounty', level: 9, target: { monster: 'tiger', family: 'beast', count: 1, elite: 1, x: 20, y: 20, radius: 6 } });
    accept(r, o);
    expect(calls.spawn).toEqual([[r.p.charId, 'tiger', 9, 1, 0]]);
    kill(r, { defId: 'tiger', bountyFor: 12345 }); // someone else's bounty
    kill(r, { defId: 'tiger', bountyFor: null }); // a wild tiger
    expect(mission(r, o.id)?.done).toBe(false);
    kill(r, { defId: 'tiger', bountyFor: r.p.charId });
    expect(mission(r, o.id)?.done).toBe(true);

    const calls2 = calls.removed.length;
    const o2 = offer({ id: 'b2', type: 'bounty', target: { monster: 'chief', count: 1, elite: 2, x: 5, y: 5, radius: 6 } });
    r.board.push(o2);
    expect(r.run({ t: 'maccept', offer: 'b2', settlement: 0 }).err?.code).toBe('one_bounty');
    r.run({ t: 'mabandon', id: o.id });
    expect(calls.removed.length).toBeGreaterThan(calls2);
    expect(calls.removed.at(-1)).toBe(r.p.charId);
    expect(r.board.some((b) => b.id === o.id)).toBe(true);
  });

  it('bounty: when no target can be placed the offer goes back and the mission is not taken', () => {
    const r = makeRig();
    fakeMonsters(r, 'none');
    const o = offer({ type: 'bounty', target: { monster: 'tiger', count: 1, elite: 1 } });
    expect(accept(r, o).err?.code).toBe('no_target');
    expect(r.p.save.missions).toHaveLength(0);
    expect(r.board.map((b) => b.id)).toEqual([o.id]);
  });

  it('bounty targets follow the session: removed on logout, respawned on login', () => {
    const r = makeRig();
    const calls = fakeMonsters(r);
    accept(r, offer({ type: 'bounty', target: { monster: 'tiger', count: 1, elite: 1 } }));
    r.h.game.disconnect(r.conn);
    expect(calls.removed.at(-1)).toBe(r.p.charId);
    const before = calls.spawn.length;
    r.h.game.connect(r.conn as never, r.h.db.getUserById(r.p.userId)!);
    expect(calls.spawn.length).toBe(before + 1);
  });

  it('investigate completes when the player reaches the spot (low-frequency poll)', () => {
    const r = makeRig();
    const spawn = r.h.world.settlements[0].spawn;
    const far = r.h.world.settlements[1].spawn;
    const o = offer({ type: 'investigate', target: { x: far.x, y: far.y, radius: 3, count: 1 } });
    accept(r, o);
    r.h.tick(25);
    expect(mission(r, o.id)?.done).toBe(false);
    r.h.game.movement.teleport(r.p.entity, far.x + 1, far.y + 1);
    r.h.tick(12);
    expect(mission(r, o.id)).toMatchObject({ progress: 1, done: true });
    expect(spawn).toBeTruthy();
  });

  it('gather and deliver follow the bag', () => {
    const r = makeRig();
    const g = offer({ type: 'gather', target: { item: 'herb', count: 4 } });
    accept(r, g);
    expect(mission(r, g.id)).toMatchObject({ progress: 0, done: false });
    r.p.save.inventory = [stackOf('herb', 3)];
    r.h.tick(12);
    expect(mission(r, g.id)).toMatchObject({ progress: 3, done: false });
    r.p.save.inventory = [stackOf('herb', 40), stackOf('herb', 3)];
    r.h.tick(12);
    expect(mission(r, g.id)).toMatchObject({ progress: 4, done: true });
    expect(r.conn.last('mission')?.update).toMatchObject({ id: g.id, done: true });
    r.p.save.inventory = [];
    r.h.tick(12);
    expect(mission(r, g.id)?.done).toBe(false);
  });
});

describe('turn in', () => {
  it('pays xp, gold, reputation and items, removes the job and tells the sim and other modules', () => {
    const r = makeRig();
    const o = offer();
    accept(r, o);
    kill(r);
    kill(r);
    const elder = r.npc(NPC.elder);
    r.stand(elder.ent);
    const done: string[] = [];
    r.ctx.events.on('missionCompleted', (ev) => void done.push(`${ev.player.name}:${ev.mission.id}`));
    const recorded: string[] = [];
    const fanned: SimEvent[][] = [];
    const events: SimEvent[] = [{ k: 'settle', id: 0 }];
    Object.assign(r.sim, { recordMissionDone: (of: MissionOffer, name: string) => (recorded.push(`${of.id}:${name}:${'progress' in of}`), events) });
    r.ctx.fanOut = (ev) => void fanned.push([...ev]);
    r.p.save.gold = 10;
    r.p.save.reputation = { azure: 98 };
    expect(r.run({ t: 'mturnin', id: o.id }).err).toBeUndefined();
    expect(r.p.save.missions).toHaveLength(0);
    expect(r.p.save.gold).toBe(35);
    expect(r.p.save.reputation.azure).toBe(100); // clamped
    expect(r.p.save.xp + (r.p.save.level - 1) * 1000).toBeGreaterThan(0);
    expect(r.p.save.completedMissions).toBe(1);
    expect(r.p.save.inventory).toEqual([{ id: 'pill_heal_s', qty: 2 }]);
    expect(done).toEqual(['Hero:' + o.id]);
    expect(recorded).toEqual([`${o.id}:Hero:false`]);
    expect(fanned).toEqual([events]);
    expect(r.run({ t: 'mturnin', id: o.id }).err?.code).toBe('not_found');
  });

  it('needs a finished job and a fitting NPC nearby', () => {
    const r = makeRig();
    const o = offer();
    accept(r, o);
    const elder = r.npc(NPC.elder);
    r.stand(elder.ent);
    expect(r.run({ t: 'mturnin', id: o.id }).err?.code).toBe('not_done');
    kill(r);
    kill(r);
    // A villager takes nothing; a guard does.
    r.stand(r.npc(NPC.villager).ent);
    r.h.game.movement.teleport(r.p.entity, r.h.world.settlements[0].spawn.x + 40, r.h.world.settlements[0].spawn.y);
    expect(r.run({ t: 'mturnin', id: o.id }).err?.code).toBe('no_taker');
    r.stand(r.npc(NPC.guard).ent);
    expect(r.run({ t: 'mturnin', id: o.id, npc: NPC.guard }).err).toBeUndefined();
  });

  it('a named NPC must be eligible and close; the offer giver always counts', () => {
    const r = makeRig();
    const a = offer({ giverId: NPC.villager });
    const b = offer();
    accept(r, a);
    accept(r, b);
    for (const _ of [1, 2]) kill(r);
    r.stand(r.npc(NPC.elder).ent);
    expect(r.run({ t: 'mturnin', id: b.id, npc: NPC.villager }).err?.code).toBe('no_taker'); // a villager is not a taker...
    expect(r.run({ t: 'mturnin', id: a.id, npc: NPC.villager }).err).toBeUndefined(); // ...unless he posted the job
    expect(r.run({ t: 'mturnin', id: b.id, npc: 9999 }).err?.code).toBe('no_taker');
    expect(r.run({ t: 'mturnin', id: b.id, npc: NPC.guard }).err).toBeUndefined();
  });

  it('gather consumes the goods; missing goods refuse', () => {
    const r = makeRig();
    const o = offer({ type: 'gather', target: { item: 'herb', count: 5 }, reward: { xp: 10, gold: 7 } });
    accept(r, o);
    r.stand(r.npc(NPC.merchant).ent);
    r.p.save.inventory = [stackOf('herb', 3)];
    expect(r.run({ t: 'mturnin', id: o.id }).err?.code).toBe('not_done');
    expect(r.p.save.inventory[0].qty).toBe(3);
    r.p.save.inventory = [stackOf('herb', 4), stackOf('herb', 3), stackOf('grain', 1)];
    expect(r.run({ t: 'mturnin', id: o.id }).err).toBeUndefined();
    expect(r.p.save.inventory).toEqual([{ id: 'herb', qty: 2 }, { id: 'grain', qty: 1 }]);
    expect(r.p.save.gold).toBe(7);
  });

  it('deliver is handed in at the destination settlement, not where it was posted', () => {
    const r = makeRig();
    const o = offer({ type: 'deliver', target: { item: 'grain', count: 3, toSettlement: 1 }, reward: { xp: 10, gold: 9 } });
    accept(r, o);
    r.p.save.inventory = [stackOf('grain', 3)];
    r.stand(r.npc(NPC.elder).ent);
    expect(r.run({ t: 'mturnin', id: o.id }).err?.code).toBe('no_taker');
    const there = r.sim.npcs(1).find((n) => n.role === 'elder')!;
    r.stand(r.ctx.npcEntity(there.id)!);
    expect(r.run({ t: 'mturnin', id: o.id }).err).toBeUndefined();
    expect(r.p.save.inventory).toHaveLength(0);
    expect(r.p.save.gold).toBe(9);
  });

  it('a full bag refuses the hand-in and changes nothing, cargo included', () => {
    const r = makeRig();
    const o = offer({ type: 'gather', target: { item: 'herb', count: 5 }, reward: { xp: 10, gold: 7, items: [{ id: 'w_sword_1', qty: 2 }] } });
    accept(r, o);
    r.stand(r.npc(NPC.merchant).ent);
    r.p.save.inventory = [stackOf('herb', 5), ...Array.from({ length: INVENTORY_SLOTS - 1 }, (_, i) => stackOf(i % 2 ? 'hide' : 'cloth', 99))];
    const before = JSON.stringify(r.p.save.inventory);
    expect(r.run({ t: 'mturnin', id: o.id }).err?.code).toBe('bag_full');
    expect(JSON.stringify(r.p.save.inventory)).toBe(before);
    expect(r.p.save.gold).toBe(0);
    expect(mission(r, o.id)).toBeTruthy();
    // Making room lets it through: the herb stack frees its own slot, but two swords need two.
    r.p.save.inventory.pop();
    expect(r.run({ t: 'mturnin', id: o.id }).err).toBeUndefined();
    expect(r.p.save.inventory.filter((s) => s.id === 'w_sword_1' && !!s.uid)).toHaveLength(2);
    expect(r.p.save.inventory.some((s) => s.id === 'herb')).toBe(false);
  });

  it('removes the bounty target once the job is handed in', () => {
    const r = makeRig();
    const calls = fakeMonsters(r);
    const o = offer({ type: 'bounty', target: { monster: 'tiger', count: 1, elite: 1 } });
    accept(r, o);
    kill(r, { defId: 'tiger', bountyFor: r.p.charId });
    r.stand(r.npc(NPC.elder).ent);
    r.run({ t: 'mturnin', id: o.id });
    expect(calls.removed.at(-1)).toBe(r.p.charId);
    expect(r.p.save.missions).toHaveLength(0);
  });
});

describe('expiry', () => {
  it('removes unfinished jobs when their day comes, keeps finished ones', () => {
    const r = makeRig();
    const calls = fakeMonsters(r);
    const day = r.sim.clock().day;
    const soon = offer({ expires: day + 2 });
    const doneOne = offer({ expires: day + 2 });
    const later = offer({ expires: day + 9 });
    const bounty = offer({ type: 'bounty', expires: day + 2, target: { monster: 'tiger', count: 1, elite: 1 } });
    for (const o of [soon, doneOne, later, bounty]) accept(r, o);
    kill(r);
    kill(r); // wolves: soon and doneOne both complete...
    r.p.save.missions.find((m) => m.id === soon.id)!.done = false; // ...but make `soon` unfinished again
    r.p.save.missions.find((m) => m.id === soon.id)!.progress = 1;
    r.sim.state.clock.totalHours += 24 * 2;
    r.conn.clear();
    r.h.game.advanceHour(r.ctx.now());
    const ids = r.p.save.missions.map((m) => m.id);
    expect(ids).toContain(doneOne.id);
    expect(ids).toContain(later.id);
    expect(ids).not.toContain(soon.id);
    expect(ids).not.toContain(bounty.id);
    expect(calls.removed.at(-1)).toBe(r.p.charId);
    expect(r.conn.of('note').filter((n) => n.text.startsWith('Mission expired'))).toHaveLength(2);
  });

  it('a gather job whose goods are in the bag does not expire', () => {
    const r = makeRig();
    const day = r.sim.clock().day;
    const g = offer({ type: 'gather', target: { item: 'herb', count: 2 }, expires: day + 1 });
    accept(r, g);
    r.p.save.inventory = [stackOf('herb', 2)];
    r.sim.state.clock.totalHours += 24;
    r.h.game.advanceHour(r.ctx.now());
    expect(mission(r, g.id)).toBeTruthy();
  });
});

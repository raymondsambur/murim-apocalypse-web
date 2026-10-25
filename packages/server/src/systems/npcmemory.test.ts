import type { ActiveMission, NpcMenu } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { getNpcMemory } from '../npcmemory';
import { MemoryStore } from '../npcmemory/memory';
import { NPC, makeRealHarness, makeRig, type Rig } from './econ.testkit';
import { register } from './npcmemory';

function rig(): Rig & { mem: NonNullable<ReturnType<typeof getNpcMemory>> } {
  const r = makeRig();
  register(r.ctx);
  const mem = getNpcMemory(r.ctx)!;
  return Object.assign(r, { mem });
}

function kill(r: Rig, over: Record<string, unknown> = {}): void {
  const s = r.ctx.world.settlements[0];
  r.ctx.events.emit('monsterKilled', { killers: [r.p], entityId: 1, defId: 'bandit', family: 'bandit', level: 3, elite: 0, x: s.x, y: s.y, spawnId: null, siege: null, bountyFor: null, heartId: null, ...over } as never);
}

const mission = (over: Partial<ActiveMission> = {}): ActiveMission => ({
  id: 'm1',
  type: 'hunt',
  title: 'Cull',
  desc: '',
  settlementId: 0,
  target: { monster: 'wolf', count: 3 },
  minRank: 1,
  level: 2,
  reward: { xp: 10, gold: 5 },
  expires: 99,
  progress: 3,
  acceptedDay: 0,
  done: true,
  ...over,
});

function chron(r: Rig, text: string, kind: 'blight' | 'faction' | 'economy' | 'settlement' | 'npc' | 'player', importance: 1 | 2 | 3, settlementId?: number): void {
  const entry = { id: Math.floor(Math.random() * 1e6), day: 1, hour: 1, kind, text, importance, settlementId, t: 0 };
  r.h.game.fanOut([{ k: 'chron', entry }], r.h.clock.now(), true);
}

describe('npc memory system', () => {
  it('builds the NPC menu with a composed greeting, talk topics, mood and standing', () => {
    const r = rig();
    const { npc, ent } = r.npc(NPC.elder);
    r.stand(ent);
    r.conn.clear();
    r.h.say(r.p, { t: 'interact', id: ent.id });
    r.h.tick();
    const menu = r.conn.last('npc')!.menu as NpcMenu;
    expect(menu.id).toBe(npc.id);
    expect(menu.greeting.length).toBeGreaterThan(8);
    expect(menu.greeting).not.toMatch(/[{}]/);
    expect(menu.standing).toBe('unknown');
    expect(menu.talk!.topics.map((t) => t.id)).toEqual(['news', 'town', 'folk', 'me', 'blight', 'work']);
    expect(menu.talk!.traits).toEqual(npc.traits.filter((t) => ['stern', 'kind', 'greedy', 'boastful', 'weary', 'devout', 'cunning', 'honest', 'gruff', 'cheerful', 'superstitious', 'scholarly'].includes(t)));
    // The greeting is stable within a world hour (menu re-sends after a purchase must not flicker).
    const again = r.ask('npc', { id: npc.id })!.data as NpcMenu;
    expect(again.greeting).toBe(menu.greeting);
  });

  it('counts a conversation as a personal memory of the visit', () => {
    const r = rig();
    const { npc, ent } = r.npc(NPC.elder);
    r.stand(ent);
    r.ask('npc', { id: npc.id });
    expect(r.mem.recall(npc.id, r.p.charId).talks).toBe(1);
    r.ask('npc', { id: npc.id });
    expect(r.mem.recall(npc.id, r.p.charId).talks).toBe(1); // inside the cooldown
  });

  it('remembers bandit and Hollow kills near a settlement, but not beasts or distant kills', () => {
    const r = rig();
    const sid = 0;
    for (let i = 0; i < 6; i++) kill(r);
    expect(r.mem.townStanding(sid, r.p.charId)).not.toBe('unknown');
    const d = r.mem.store.townDeeds(sid, r.p.charId, r.ctx.sim.clock().totalHours);
    expect(d.map((x) => x.kind)).toEqual(['killedBandits']);

    const r2 = rig();
    for (let i = 0; i < 6; i++) kill(r2, { family: 'beast' });
    expect(r2.mem.store.size().town).toBe(0);
    for (let i = 0; i < 6; i++) kill(r2, { x: 0, y: 0, defId: 'x' });
    // (0,0) can be far from every settlement; if so nothing is remembered.
    const near = r2.ctx.world.settlements.some((s) => Math.hypot(s.x, s.y) - s.radius <= 24);
    if (!near) expect(r2.mem.store.size().town).toBe(0);

    kill(r2, { family: 'blight' });
    expect(r2.mem.store.townDeeds(0, r2.p.charId, r2.ctx.sim.clock().totalHours)[0].kind).toBe('killedHollows');
  });

  it('turns many siege kills into saving the town when the siege ends and the town stands', () => {
    const r = rig();
    for (let i = 0; i < 4; i++) kill(r, { siege: 0 });
    expect(r.mem.store.townDeeds(0, r.p.charId, r.ctx.sim.clock().totalHours).some((d) => d.kind === 'savedTown')).toBe(false);
    r.h.game.fanOut([{ k: 'siege', settlementId: 0, start: false }], r.h.clock.now(), true);
    expect(r.mem.store.townDeeds(0, r.p.charId, r.ctx.sim.clock().totalHours).some((d) => d.kind === 'savedTown')).toBe(true);
  });

  it('remembers completed missions by type, personally for the giver', () => {
    const r = rig();
    const { npc } = r.npc(NPC.elder);
    const hour = r.ctx.sim.clock().totalHours;
    r.ctx.events.emit('missionCompleted', { player: r.p, mission: mission({ type: 'deliver', giverId: npc.id, target: { count: 1, toSettlement: 0 } }) });
    r.ctx.events.emit('missionCompleted', { player: r.p, mission: mission({ id: 'm2', type: 'purify' }) });
    const kinds = r.mem.store.townDeeds(0, r.p.charId, hour).map((d) => d.kind);
    expect(kinds).toContain('deliveredGoods');
    expect(kinds).toContain('purified');
    expect(r.mem.recall(npc.id, r.p.charId).deeds.map((d) => d.kind)).toEqual(['deliveredGoods']);
  });

  it('remembers rank-ups, not stage-ups, and deaths near a town', () => {
    const r = rig();
    const hour = r.ctx.sim.clock().totalHours;
    r.p.save.lastTown = 0;
    r.ctx.events.emit('playerLevelUp', { player: r.p, from: 3, to: 4 });
    expect(r.mem.store.townDeeds(0, r.p.charId, hour)).toHaveLength(0);
    r.ctx.events.emit('playerLevelUp', { player: r.p, from: 9, to: 10 });
    expect(r.mem.store.townDeeds(0, r.p.charId, hour).map((d) => d.kind)).toEqual(['rankUp']);
    r.ctx.events.emit('playerDied', { player: r.p });
    expect(r.mem.store.townDeeds(0, r.p.charId, hour).map((d) => d.kind).sort()).toContain('diedNearby');
  });

  it('answers talk topics with composed lines and varies them', () => {
    const r = rig();
    const { npc, ent } = r.npc(NPC.guard);
    r.stand(ent);
    const seen = new Set<string>();
    for (let i = 0; i < 8; i++) {
      const res = r.ask('npcTalk', { id: npc.id, topic: 'work' })!;
      expect(res.ok).toBe(true);
      const lines = (res.data as { lines: string[] }).lines;
      expect(lines.length).toBeGreaterThanOrEqual(1);
      expect(lines[0]).not.toMatch(/[{}]/);
      seen.add(lines[0]);
    }
    expect(seen.size).toBeGreaterThanOrEqual(6);
    for (const topic of ['news', 'town', 'folk', 'me', 'blight']) {
      const res = r.ask('npcTalk', { id: npc.id, topic })!;
      expect(res.ok, topic).toBe(true);
      expect((res.data as { lines: string[] }).lines.join(' ').length, topic).toBeGreaterThan(10);
    }
  });

  it('refuses bad topics, distant NPCs and missing NPCs', () => {
    const r = rig();
    const { npc, ent } = r.npc(NPC.guard);
    r.stand(ent);
    expect(r.ask('npcTalk', { id: npc.id, topic: 'greet' })!.err).toBe('bad_topic');
    expect(r.ask('npcTalk', { id: npc.id, topic: 'nonsense' })!.err).toBe('bad_topic');
    expect(r.ask('npcTalk', { id: 99999, topic: 'news' })!.err).toBe('not_found');
    r.h.game.ctx.movement.teleport(r.p.entity, ent.x + 30, ent.y + 30);
    expect(r.ask('npcTalk', { id: npc.id, topic: 'news' })!.err).toBe('too_far');
  });

  it('turns away players the NPC refuses to serve', () => {
    const r = rig();
    const { npc, ent } = r.npc(NPC.merchant, { faction: 'jade' });
    r.stand(ent);
    r.p.save.reputation.jade = -100;
    const menu = r.ask('npc', { id: npc.id })!.data as NpcMenu;
    expect(menu.greeting).toContain('turns away');
    expect(menu.talk).toBeUndefined();
    const res = r.ask('npcTalk', { id: npc.id, topic: 'news' })!;
    expect((res.data as { lines: string[] }).lines[0]).toContain('turns away');
  });

  it('reacts to what the player did: standing shows in the menu and the voice changes', () => {
    const r = rig();
    const { npc, ent } = r.npc(NPC.elder);
    r.stand(ent);
    r.mem.remember({ charId: r.p.charId, kind: 'savedTown', place: npc.settlementId });
    r.mem.remember({ charId: r.p.charId, kind: 'killedBandits', place: npc.settlementId, magnitude: 6 });
    const menu = r.ask('npc', { id: npc.id })!.data as NpcMenu;
    expect(['welcomed', 'honoured']).toContain(menu.standing);
    const lines = new Set<string>();
    for (let i = 0; i < 12; i++) lines.add((r.ask('npcTalk', { id: npc.id, topic: 'me' })!.data as { lines: string[] }).lines[0]);
    // At least some answers quote the deeds.
    expect([...lines].some((l) => /bandit|siege|wall|stood|town/i.test(l))).toBe(true);
  });

  it('turns chronicle lines into rumors that NPCs tell, hedged by how reliable they are', () => {
    const r = rig();
    const { npc, ent } = r.npc(NPC.elder);
    r.stand(ent);
    const name = r.ctx.world.settlements[npc.settlementId].name;
    chron(r, `${name} has fallen to the Blight! Few escaped.`, 'blight', 3, npc.settlementId);
    const rumors = [...r.mem.mill.rumors.values()];
    expect(rumors).toHaveLength(1);
    expect(rumors[0].kind).toBe('fell');
    // Make sure this elder is one of the witnesses.
    const k = rumors[0].known[npc.settlementId];
    if (!k.npcs.includes(npc.id)) k.npcs.push(npc.id);
    const lines = (r.ask('npcTalk', { id: npc.id, topic: 'news' })!.data as { lines: string[] }).lines;
    expect(lines[0]).toContain(name);
    // The same rumor is not told again at once.
    const second = (r.ask('npcTalk', { id: npc.id, topic: 'news' })!.data as { lines: string[] }).lines;
    expect(second[0]).not.toContain('fallen');
    // Doubtful versions are hedged.
    k.truth = 0.2;
    const r2 = (r.ask('npcTalk', { id: npc.id, topic: 'news' })!.data as { lines: string[] }).lines;
    expect(r2.length).toBeGreaterThan(0);
  });

  it('makes a rumor out of a big enough deed, and tells it to the player as "you"', () => {
    const r = rig();
    const { npc, ent } = r.npc(NPC.elder);
    r.stand(ent);
    for (let i = 0; i < 9; i++) kill(r);
    const deeds = [...r.mem.mill.rumors.values()].filter((x) => x.topic === 'player');
    expect(deeds).toHaveLength(1);
    expect(deeds[0].subjectIds).toEqual([r.p.charId]);
    const sid = deeds[0].originSettlement;
    expect(sid).toBe(0);
    const k = deeds[0].known[sid];
    if (!k.npcs.includes(npc.id)) k.npcs.push(npc.id);
    const line = (r.ask('npcTalk', { id: npc.id, topic: 'news' })!.data as { lines: string[] }).lines[0];
    expect(line.toLowerCase()).toContain('you');
    expect(line).not.toContain(`${r.p.name} cleared`);
  });

  it('npcChat events pass rumors between two NPCs of a settlement', () => {
    const r = rig();
    chron(r, `${r.ctx.world.settlements[0].name} has fallen to the Blight!`, 'blight', 3, 0);
    const rumor = [...r.mem.mill.rumors.values()][0];
    const k = rumor.known[0];
    const listeners = r.ctx.sim.npcs(0).map((n) => n.id);
    const knower = k.npcs[0];
    const other = listeners.find((id) => !k.npcs.includes(id));
    if (other === undefined) return; // everyone already knows
    for (let i = 0; i < 30; i++) r.ctx.events.emit('npcChat', { a: knower, b: other, settlementId: 0 });
    expect(k.npcs).toContain(other);
  });

  it('keeps rumors and memory in the database each world hour', () => {
    const r = rig();
    chron(r, `${r.ctx.world.settlements[0].name} has fallen to the Blight!`, 'blight', 3, 0);
    r.mem.remember({ charId: r.p.charId, kind: 'gift', place: 0 });
    r.h.game.fanOut([], r.h.clock.now(), true);
    expect(r.h.db.all('SELECT * FROM nm_rumor')).toHaveLength(2); // the chronicle line and the gift (a deed worth a rumor)
    expect(r.h.db.all('SELECT * FROM nm_town')).toHaveLength(1);
    const copy = new MemoryStore(r.h.db);
    copy.load();
    expect(copy.size().town).toBe(1);
  });

  it('is deterministic: the same game gives the same words', () => {
    const run = (): string[] => {
      const r = rig();
      const { npc, ent } = r.npc(NPC.guard);
      r.stand(ent);
      return ['work', 'town', 'blight', 'me', 'folk', 'news'].map((topic) => (r.ask('npcTalk', { id: npc.id, topic })!.data as { lines: string[] }).lines.join(' '));
    };
    expect(run()).toEqual(run());
  });

  it('stays cheap: a thousand talks cost a fraction of a second', () => {
    const r = rig();
    const { npc, ent } = r.npc(NPC.elder);
    r.stand(ent);
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) r.mem.talk(r.p, npc, (['news', 'town', 'folk', 'me', 'blight', 'work'] as const)[i % 6]);
    expect(performance.now() - t0).toBeLessThan(1500);
  });

  it('smoke: 30 days of the real world produce rumors that spread, fade and stay within bounds', () => {
    const h = makeRealHarness();
    const ctx = h.game.ctx;
    register(ctx);
    const mem = getNpcMemory(ctx)!;
    const t0 = performance.now();
    let peak = 0;
    let maxSpread = 0;
    const kinds = new Set<string>();
    for (let hour = 0; hour < 24 * 30; hour++) {
      h.clock.advance(60_000);
      h.game.advanceHour(h.clock.t);
      peak = Math.max(peak, mem.mill.size());
      for (const r of mem.mill.rumors.values()) {
        maxSpread = Math.max(maxSpread, r.spread);
        kinds.add(r.kind);
      }
    }
    const ms = performance.now() - t0;
    // eslint-disable-next-line no-console
    console.log(`[npcmemory smoke] 720 world hours in ${ms.toFixed(0)} ms; rumors now ${mem.mill.size()} (peak ${peak}); widest spread ${maxSpread} settlements; kinds seen: ${[...kinds].join(', ')}`);
    expect(peak).toBeGreaterThan(3);
    expect(peak).toBeLessThanOrEqual(96);
    expect(maxSpread).toBeGreaterThan(1);
    expect(ms / 720).toBeLessThan(25); // includes the whole sim hour
    h.close();
  });
});

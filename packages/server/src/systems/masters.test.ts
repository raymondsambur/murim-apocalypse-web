import { afterEach, describe, expect, it } from 'vitest';
import type { ActiveMission } from '@murim/shared';
import { FakeConn } from '../testkit';
import { discipleDiscount, getMastersApi, TEACH_COOLDOWN_MS, GRADUATION_GOLD } from './masters';
import { xpMultiplier } from './lib';
import { INVITE_TTL_MS } from './social';
import { buildNpcMenu, npcMenuDecorators } from './npcmenu';
import { makeSocialRig, type SocialRig, type Who } from './social.testkit';

let rig: SocialRig | null = null;
afterEach(() => {
  rig?.h.close();
  rig = null;
  npcMenuDecorators.length = 0;
});

const NPC_ID = 5;

/** Make the stub villager an Azure master and stand `w` next to him. */
function npcMaster(r: SocialRig, w?: Who) {
  const npc = r.h.game.sim.npc(NPC_ID)!;
  npc.role = 'master';
  npc.faction = 'azure';
  npc.alive = true;
  const ent = r.ctx.npcEntity(NPC_ID)!;
  if (w) r.ctx.movement.teleport(w.p.entity, ent.x, ent.y);
  return { npc, ent };
}

const mission = (gold: number): ActiveMission => ({ id: 'm1', reward: { xp: 10, gold } }) as unknown as ActiveMission;

function pair() {
  rig = makeSocialRig();
  const r = rig;
  const master = r.join('Master', { level: 20, gold: 0 });
  const disc = r.join('Pupil', { level: 4 });
  const bond = () => {
    expect(disc.run({ t: 'master', op: 'request', id: master.p.charId }).err).toBeUndefined();
    expect(master.run({ t: 'master', op: 'accept', id: disc.p.charId }).err).toBeUndefined();
  };
  return { r, master, disc, bond };
}

describe('NPC masters', () => {
  it('accepts a worthy disciple immediately and applies the benefits', () => {
    rig = makeSocialRig();
    const r = rig;
    const w = r.join('Novice', { level: 3 });
    expect(w.run({ t: 'master', op: 'request', npc: 1 }).err?.code).toBe('not_master');
    const { npc, ent } = npcMaster(r);
    r.ctx.movement.teleport(w.p.entity, ent.x + 15, ent.y);
    expect(w.run({ t: 'master', op: 'request', npc: NPC_ID }).err?.code).toBe('too_far');
    npcMaster(r, w);
    expect(w.run({ t: 'master', op: 'request', npc: NPC_ID }).err?.code).toBe('rep_low');
    w.p.save.reputation.azure = 10;
    w.p.save.level = 19;
    expect(w.run({ t: 'master', op: 'request', npc: NPC_ID }).err?.code).toBe('rank_high');
    w.p.save.level = 3;
    expect(w.run({ t: 'master', op: 'request', npc: NPC_ID }).err).toBeUndefined();
    expect(w.p.save.masterId).toBe(-NPC_ID);
    expect(w.conn.last('me')!.me.master).toEqual({ id: NPC_ID, name: npc.name, npc: true });
    expect(xpMultiplier(r.ctx, w.p)).toBeCloseTo(1.1);
    expect(discipleDiscount(w.p, NPC_ID)).toBe(0.8);
    expect(discipleDiscount(w.p, 1)).toBe(1);
    expect(w.run({ t: 'master', op: 'request', npc: NPC_ID }).err?.code).toBe('has_master');
    expect(r.ctx.db.get('SELECT * FROM master_bonds WHERE disciple_id = ?', w.p.charId)).toMatchObject({ master_id: -NPC_ID });
    // Dismissing ends the bond and the benefits.
    expect(w.run({ t: 'master', op: 'dismiss' }).err).toBeUndefined();
    expect(w.p.save.masterId).toBeNull();
    expect(xpMultiplier(r.ctx, w.p)).toBe(1);
    expect(w.run({ t: 'master', op: 'dismiss' }).err?.code).toBe('no_master');
  });

  it('decorates the NPC menu with eligibility and a reason', () => {
    rig = makeSocialRig();
    const r = rig;
    const w = r.join('Novice', { level: 3 });
    const { npc } = npcMaster(r, w);
    expect(buildNpcMenu(r.ctx, w.p, npc).disciple).toEqual({ ok: false, already: false, reason: expect.stringContaining('reputation') });
    w.p.save.reputation.azure = 30;
    expect(buildNpcMenu(r.ctx, w.p, npc).disciple).toEqual({ ok: true, already: false });
    w.run({ t: 'master', op: 'request', npc: NPC_ID });
    expect(buildNpcMenu(r.ctx, w.p, npc).disciple).toMatchObject({ ok: false, already: true });
    npc.role = 'merchant';
    expect(buildNpcMenu(r.ctx, w.p, npc).disciple).toBeUndefined();
  });

  it('tells the player how many disciples train under a master in the compound', () => {
    rig = makeSocialRig();
    const r = rig;
    const w = r.join('Novice', { level: 3 });
    const { npc } = npcMaster(r, w);
    expect(buildNpcMenu(r.ctx, w.p, npc).students).toBeUndefined();
    const base = r.h.game.sim.npc(1)!;
    const add = (id: number, title: string, mentor: number) => r.h.game.sim.state.npcs.push({ ...base, id, role: 'disciple', title, mentor, alive: true, settlementId: npc.settlementId, disciples: 0 });
    add(9001, 'Outer Disciple', NPC_ID);
    add(9002, 'Outer Disciple', NPC_ID);
    add(9003, 'Inner Disciple', NPC_ID);
    add(9004, 'Inner Disciple', NPC_ID + 100); // somebody else's student
    expect(buildNpcMenu(r.ctx, w.p, npc).students).toEqual({ outer: 2, inner: 1 });
  });

  it('releases disciples when the NPC master dies and on login', () => {
    rig = makeSocialRig();
    const r = rig;
    const w = r.join('Novice', { level: 3 });
    const { npc } = npcMaster(r, w);
    w.p.save.reputation.azure = 10;
    w.run({ t: 'master', op: 'request', npc: NPC_ID });
    r.h.game.playerMgr.saveDirty(true);
    r.leave(w);
    npc.alive = false;
    const back = r.rejoin(w);
    expect(back.p.save.masterId).toBeNull();
    expect(back.conn.of('note').some((n) => n.text.includes('passed away'))).toBe(true);
  });
});

describe('player masters', () => {
  it('runs request / accept from the disciple side', () => {
    const { r, master, disc } = pair();
    expect(disc.run({ t: 'master', op: 'request', id: master.p.charId }).err).toBeUndefined();
    expect(master.conn.of('invite').at(-1)).toMatchObject({ kind: 'master', fromId: disc.p.charId, from: 'Pupil', data: { role: 'disciple' } });
    expect(master.run({ t: 'master', op: 'accept', id: disc.p.charId }).err).toBeUndefined();
    expect(disc.p.save.masterId).toBe(master.p.charId);
    r.h.clock.advance(500);
    r.h.tick();
    expect(disc.conn.last('me')!.me.master).toEqual({ id: master.p.charId, name: 'Master', npc: false });
    expect(master.conn.last('me')!.me.disciples).toEqual([{ id: disc.p.charId, name: 'Pupil', level: 4, online: true }]);
    expect(getMastersApi(r.ctx)!.disciplesOf(master.p.charId)).toEqual([disc.p.charId]);
    // +15% while the master is online, +10% otherwise.
    expect(xpMultiplier(r.ctx, disc.p)).toBeCloseTo(1.15);
    r.leave(master);
    expect(xpMultiplier(r.ctx, disc.p)).toBeCloseTo(1.1);
  });

  it('also works when the master makes the offer', () => {
    const { master, disc } = pair();
    expect(master.run({ t: 'master', op: 'request', id: disc.p.charId }).err).toBeUndefined();
    expect(disc.conn.last('invite')).toMatchObject({ kind: 'master', fromId: master.p.charId, data: { role: 'master' } });
    expect(disc.run({ t: 'master', op: 'accept', id: master.p.charId }).err).toBeUndefined();
    expect(disc.p.save.masterId).toBe(master.p.charId);
    // The master cannot accept their own offer.
    expect(master.run({ t: 'master', op: 'accept', id: disc.p.charId }).err?.code).toBe('no_request');
  });

  it('enforces ranks, the two-disciple limit, expiry and decline', () => {
    const { r, master, disc } = pair();
    const peer = r.join('Peer', { level: 25 });
    const low = r.join('Low', { level: 2 });
    expect(low.run({ t: 'master', op: 'request', id: disc.p.charId }).err?.code).toBe('bad_ranks');
    expect(master.run({ t: 'master', op: 'request', id: peer.p.charId }).err?.code).toBe('bad_ranks');
    expect(master.run({ t: 'master', op: 'request', id: master.p.charId }).err?.code).toBe('bad_target');
    expect(low.run({ t: 'master', op: 'request', id: 424242 }).err?.code).toBe('offline');
    // Declining.
    disc.run({ t: 'master', op: 'request', id: master.p.charId });
    expect(master.run({ t: 'master', op: 'decline', id: disc.p.charId }).err).toBeUndefined();
    expect(disc.conn.of('note').some((n) => n.text.includes('declined'))).toBe(true);
    expect(master.run({ t: 'master', op: 'accept', id: disc.p.charId }).err?.code).toBe('no_request');
    // Expiry.
    disc.run({ t: 'master', op: 'request', id: master.p.charId });
    r.h.clock.advance(INVITE_TTL_MS + 1000);
    expect(master.run({ t: 'master', op: 'accept', id: disc.p.charId }).err?.code).toBe('no_request');
    // Two disciples at most.
    r.h.clock.advance(11_000);
    for (const w of [disc, low]) {
      r.h.clock.advance(11_000);
      w.run({ t: 'master', op: 'request', id: master.p.charId });
      expect(master.run({ t: 'master', op: 'accept', id: w.p.charId }).err).toBeUndefined();
    }
    const third = r.join('Third', { level: 3 });
    expect(third.run({ t: 'master', op: 'request', id: master.p.charId }).err?.code).toBe('full');
    expect(master.run({ t: 'master', op: 'request', id: third.p.charId }).err?.code).toBe('full');
    // A disciple cannot have two masters.
    const master2 = r.join('Master2', { level: 30 });
    expect(disc.run({ t: 'master', op: 'request', id: master2.p.charId }).err?.code).toBe('has_master');
  });

  it('dismisses from either side', () => {
    const { r, master, disc, bond } = pair();
    bond();
    const stranger = r.join('Stranger', { level: 30 });
    expect(stranger.run({ t: 'master', op: 'dismiss', id: disc.p.charId }).err?.code).toBe('not_disciple');
    expect(disc.run({ t: 'master', op: 'dismiss' }).err).toBeUndefined();
    expect(master.conn.of('note').some((n) => n.text.includes('left your tutelage'))).toBe(true);
    expect(disc.p.save.masterId).toBeNull();
    r.h.clock.advance(500);
    r.h.tick();
    expect(master.conn.last('me')!.me.disciples).toEqual([]);
    bond();
    expect(master.run({ t: 'master', op: 'dismiss', id: disc.p.charId }).err).toBeUndefined();
    expect(disc.conn.of('note').some((n) => n.text.includes('dismissed you'))).toBe(true);
    expect(disc.p.save.masterId).toBeNull();
  });

  it('pays 10% of mission gold as extra tribute, also to an offline master', () => {
    const { r, master, disc, bond } = pair();
    bond();
    r.ctx.events.emit('missionCompleted', { player: disc.p, mission: mission(95) });
    expect(master.p.save.gold).toBe(9);
    expect(master.conn.of('note').some((n) => n.text.includes('9 gold in tribute'))).toBe(true);
    r.ctx.events.emit('missionCompleted', { player: disc.p, mission: mission(5) }); // 0.5 -> nothing
    expect(master.p.save.gold).toBe(9);
    // Offline master: the database row and a note on next login.
    r.h.game.playerMgr.saveDirty(true);
    r.leave(master);
    r.ctx.events.emit('missionCompleted', { player: disc.p, mission: mission(200) });
    expect(r.h.db.getCharacterById(master.p.charId)!.save.gold).toBe(29);
    const back = r.rejoin(master);
    expect(back.p.save.gold).toBe(29);
    expect(back.conn.of('note').some((n) => n.text.includes('20 gold in tribute'))).toBe(true);
  });

  it('graduates a disciple at rank 3: both get notes, the master is paid and titled once', () => {
    const { r, master, disc, bond } = pair();
    bond();
    disc.p.save.level = 19;
    r.h.tick(110); // > 10 s: the periodic check notices the new rank
    expect(disc.p.save.masterId).toBeNull();
    expect(disc.conn.of('note').some((n) => n.text.includes('graduated'))).toBe(true);
    expect(master.conn.of('note').some((n) => n.text.includes('graduated'))).toBe(true);
    expect(master.p.save.gold).toBe(GRADUATION_GOLD);
    expect(master.p.save.title).toBe('Master of Pupil');
    expect(master.p.entity.tag).toBe('Master of Pupil');
    // A second disciple graduating pays nothing more.
    const second = r.join('Second', { level: 4 });
    second.run({ t: 'master', op: 'request', id: master.p.charId });
    master.run({ t: 'master', op: 'accept', id: second.p.charId });
    r.ctx.events.emit('playerLevelUp', { player: second.p, from: 18, to: 19 });
    second.p.save.level = 19;
    r.ctx.events.emit('playerLevelUp', { player: second.p, from: 18, to: 19 });
    expect(second.p.save.masterId).toBeNull();
    expect(master.p.save.gold).toBe(GRADUATION_GOLD);
  });

  it('gives the master legacy reputation per disciple level-up', () => {
    const { r, master, disc, bond } = pair();
    master.p.save.reputation = { azure: 5, tiger: 12 };
    bond();
    disc.p.save.level = 5;
    r.ctx.events.emit('playerLevelUp', { player: disc.p, from: 4, to: 5 });
    expect(master.p.save.reputation).toEqual({ azure: 5, tiger: 13 });
  });

  it('teaches skills with requirements and a one hour cooldown', () => {
    const { r, master, disc, bond } = pair();
    bond();
    const teach = (skill: string) => master.run({ t: 'master', op: 'teach', id: disc.p.charId, skill });
    expect(teach('nonsense').err?.code).toBe('bad_skill');
    expect(teach('sword_basic').err?.code).toBe('skill_low');
    master.p.save.skills.sword_basic = { lv: 2, xp: 0 };
    expect(teach('sword_basic').err?.code).toBe('skill_low');
    master.p.save.skills.sword_basic = { lv: 3, xp: 0 };
    master.p.save.skills.sword_heaven = { lv: 5, xp: 0 };
    expect(teach('sword_heaven').err?.code).toBe('rank_low');
    expect(r.ctx.db.get('SELECT * FROM master_teach')).toBeUndefined();
    expect(teach('sword_basic').err).toBeUndefined();
    expect(disc.p.save.skills.sword_basic).toEqual({ lv: 1, xp: 0 });
    expect(disc.conn.of('note').some((n) => n.text.includes('taught you'))).toBe(true);
    expect(teach('sword_basic').err?.code).toBe('already_known');
    master.p.save.skills.blade_wild = { lv: 3, xp: 0 };
    expect(teach('blade_wild').err?.code).toBe('cooldown');
    r.h.clock.advance(TEACH_COOLDOWN_MS + 1);
    expect(teach('blade_wild').err).toBeUndefined();
    // Not mine to teach, too far, not online.
    const stranger = r.join('Stranger', { level: 20 });
    expect(stranger.run({ t: 'master', op: 'teach', id: disc.p.charId, skill: 'sword_basic' }).err?.code).toBe('not_disciple');
    r.h.clock.advance(TEACH_COOLDOWN_MS + 1);
    master.p.save.skills.fist_iron = { lv: 3, xp: 0 };
    r.ctx.movement.teleport(disc.p.entity, master.p.entity.x + 20, master.p.entity.y);
    expect(teach('fist_iron').err?.code).toBe('too_far');
  });

  it('survives a restart', () => {
    const { r, master, disc, bond } = pair();
    bond();
    r.h.game.playerMgr.saveDirty(true);
    r.leave(master);
    r.leave(disc);
    const { game, ctx } = r.restart();
    expect(getMastersApi(ctx)!.masterOf(disc.p.charId)).toBe(master.p.charId);
    const conn = new FakeConn();
    const p2 = game.connect(conn, disc.user)!;
    expect(p2.save.masterId).toBe(master.p.charId);
    expect(conn.of('hello')[0].you.master).toEqual({ id: master.p.charId, name: 'Master', npc: false });
  });

  it('heals a stale masterId on login', () => {
    const { r, disc, bond } = pair();
    bond();
    r.h.game.playerMgr.saveDirty(true);
    r.leave(disc);
    const rec = r.h.db.getCharacterById(disc.p.charId)!;
    rec.save.masterId = null;
    r.h.db.saveCharacter(rec.save, r.h.clock.t);
    expect(r.rejoin(disc).p.save.masterId).not.toBeNull();
  });
});

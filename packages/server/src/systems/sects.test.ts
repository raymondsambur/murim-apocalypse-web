import { afterEach, describe, expect, it } from 'vitest';
import type { SectView } from '@murim/shared';
import { FakeConn } from '../testkit';
import { INVITE_TTL_MS } from './social';
import { sectLevelFor, getSectsApi } from './sects';
import { xpMultiplier, grantXp } from './lib';
import { makeSocialRig, type SocialRig, type Who } from './social.testkit';

let rig: SocialRig | null = null;
afterEach(() => {
  rig?.h.close();
  rig = null;
});

/** A founded sect with a leader, and a helper that adds members with a given role. */
function setup() {
  rig = makeSocialRig();
  const r = rig;
  const leader = r.join('Leader', { level: 12, gold: 1000 });
  expect(leader.run({ t: 'sect', op: 'create', name: 'Azure Lotus', tag: 'azl' }).err).toBeUndefined();
  const sectId = leader.p.save.sectId!;
  const add = (name: string, role: 'elder' | 'disciple' | 'outer', level = 5): Who => {
    const w = r.join(name, { level });
    r.h.clock.advance(7000); // stay under the invitation rate limit
    expect(leader.run({ t: 'sect', op: 'invite', name }).err).toBeUndefined();
    expect(w.run({ t: 'sect', op: 'accept', sect: sectId }).err).toBeUndefined();
    if (role !== 'outer') expect(leader.run({ t: 'sect', op: 'promote', id: w.p.charId, role }).err).toBeUndefined();
    return w;
  };
  return { r, leader, sectId, add };
}

describe('founding a sect', () => {
  it('validates rank, gold, name and tag, then founds the sect', () => {
    rig = makeSocialRig();
    const r = rig;
    const w = r.join('Founder', { level: 5, gold: 2000 });
    expect(w.run({ t: 'sect', op: 'create', name: 'Valid Name', tag: 'VN' }).err?.code).toBe('rank_low');
    w.p.save.level = 10;
    w.p.save.gold = 100;
    expect(w.run({ t: 'sect', op: 'create', name: 'Valid Name', tag: 'VN' }).err?.code).toBe('no_gold');
    w.p.save.gold = 2000;
    expect(w.run({ t: 'sect', op: 'create', name: 'ab', tag: 'VN' }).err?.code).toBe('bad_name');
    expect(w.run({ t: 'sect', op: 'create', name: 'x'.repeat(21), tag: 'VN' }).err?.code).toBe('bad_name');
    expect(w.run({ t: 'sect', op: 'create', name: 'Bad<Name>', tag: 'VN' }).err?.code).toBe('bad_name');
    expect(w.run({ t: 'sect', op: 'create', name: 'Valid Name', tag: 'V' }).err?.code).toBe('bad_tag');
    expect(w.run({ t: 'sect', op: 'create', name: 'Valid Name', tag: 'VNVNV' }).err?.code).toBe('bad_tag');
    expect(w.run({ t: 'sect', op: 'create', name: 'Valid Name', tag: 'V1' }).err?.code).toBe('bad_tag');
    expect(w.p.save.gold).toBe(2000);

    const before = r.h.game.sim.state.chronicle.length;
    const ok = w.run({ t: 'sect', op: 'create', name: 'Valid Name', tag: 'vn', motto: 'Steel and patience' });
    expect(ok.err).toBeUndefined();
    expect(w.p.save.gold).toBe(1500);
    expect(w.p.save.sectId).toBeTypeOf('number');
    const me = w.conn.last('me')!.me;
    expect(me.sect).toEqual({ id: w.p.save.sectId, name: 'Valid Name', tag: 'VN', role: 'leader' });
    expect(w.p.entity.tag).toBe('[VN]');
    expect(r.h.game.sim.state.chronicle.length).toBe(before + 1);
    expect(r.h.game.sim.state.chronicle.at(-1)?.text).toContain('Valid Name');
    expect(r.h.game.sim.state.chronicle.at(-1)?.importance).toBe(2);
    expect(w.run({ t: 'sect', op: 'create', name: 'Another One', tag: 'AO' }).err?.code).toBe('in_sect');
  });

  it('keeps names and tags unique, case-insensitively', () => {
    const { r } = setup();
    const w = r.join('Rival', { level: 10, gold: 1000 });
    expect(w.run({ t: 'sect', op: 'create', name: 'azure LOTUS', tag: 'RIV' }).err?.code).toBe('name_taken');
    expect(w.run({ t: 'sect', op: 'create', name: 'Rival Sect', tag: 'AzL' }).err?.code).toBe('tag_taken');
    expect(w.run({ t: 'sect', op: 'create', name: 'Rival Sect', tag: 'RIV' }).err).toBeUndefined();
  });

  it('lists sects and returns the sect view with members', () => {
    const { r, leader, sectId, add } = setup();
    const m = add('Pupil', 'disciple', 8);
    const list = r.ask(m, 'sects', {}).data as { id: number; name: string; tag: string; members: number }[];
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: sectId, name: 'Azure Lotus', tag: 'AZL', members: 2 });
    const view = r.ask(leader, 'sect', {}).data as SectView;
    expect(view.members.map((x) => [x.name, x.role, x.online])).toEqual([
      ['Leader', 'leader', true],
      ['Pupil', 'disciple', true],
    ]);
    expect(view.treasury).toBe(0);
    const outsider = r.join('Outsider');
    const pub = r.ask(outsider, 'sect', { id: sectId }).data as SectView;
    expect(pub.name).toBe('Azure Lotus');
    expect(pub.treasury).toBe(0);
    expect(r.ask(outsider, 'sect', {}).data).toBeNull();
  });
});

describe('permission matrix', () => {
  it('lets only leader and elders invite; invitee joins as outer', () => {
    const { r, sectId, add } = setup();
    const elder = add('Elder', 'elder');
    const outer = add('Outer', 'outer');
    const disc = add('Disc', 'disciple');
    const t = r.join('Target');
    expect(outer.run({ t: 'sect', op: 'invite', name: 'Target' }).err?.code).toBe('no_permission');
    expect(disc.run({ t: 'sect', op: 'invite', name: 'Target' }).err?.code).toBe('no_permission');
    expect(r.join('Nosect').run({ t: 'sect', op: 'invite', name: 'Target' }).err?.code).toBe('no_sect');
    expect(elder.run({ t: 'sect', op: 'invite', name: 'Target' }).err).toBeUndefined();
    const inv = t.conn.last('invite')!;
    expect(inv).toMatchObject({ kind: 'sect', fromId: elder.p.charId, from: 'Elder' });
    expect(inv.data).toMatchObject({ sect: sectId, name: 'Azure Lotus', tag: 'AZL' });
    expect(elder.run({ t: 'sect', op: 'invite', name: 'Target' }).err?.code).toBe('already_invited');
    expect(elder.run({ t: 'sect', op: 'invite', name: 'Ghost' }).err?.code).toBe('not_found');
    expect(elder.run({ t: 'sect', op: 'invite', name: 'Elder' }).err?.code).toBe('bad_target');
    expect(elder.run({ t: 'sect', op: 'invite', name: 'Outer' }).err?.code).toBe('target_in_sect');
    expect(t.run({ t: 'sect', op: 'accept', sect: sectId }).err).toBeUndefined();
    expect(t.conn.last('me')!.me.sect?.role).toBe('outer');
    expect(r.ask(t, 'sect', {}).data).toMatchObject({ members: expect.arrayContaining([expect.objectContaining({ name: 'Target', role: 'outer' })]) });
  });

  it('lets a leader kick anyone, an elder only outers and disciples', () => {
    const { leader, add } = setup();
    const e1 = add('ElderOne', 'elder');
    const e2 = add('ElderTwo', 'elder');
    const d = add('Disc', 'disciple');
    const o = add('Out', 'outer');
    const plain = add('Plain', 'outer');
    expect(plain.run({ t: 'sect', op: 'kick', id: o.p.charId }).err?.code).toBe('no_permission');
    expect(d.run({ t: 'sect', op: 'kick', id: o.p.charId }).err?.code).toBe('no_permission');
    expect(e1.run({ t: 'sect', op: 'kick', id: e2.p.charId }).err?.code).toBe('no_permission');
    expect(e1.run({ t: 'sect', op: 'kick', id: leader.p.charId }).err?.code).toBe('no_permission');
    expect(e1.run({ t: 'sect', op: 'kick', id: e1.p.charId }).err?.code).toBe('bad_target');
    expect(e1.run({ t: 'sect', op: 'kick', id: 99999 }).err?.code).toBe('not_member');
    expect(e1.run({ t: 'sect', op: 'kick', id: o.p.charId }).err).toBeUndefined();
    expect(e1.run({ t: 'sect', op: 'kick', id: d.p.charId }).err).toBeUndefined();
    expect(leader.run({ t: 'sect', op: 'kick', id: e2.p.charId }).err).toBeUndefined();
    expect(o.p.save.sectId).toBeNull();
    expect(o.conn.last('me')!.me.sect).toBeNull();
    expect(o.p.entity.tag).toBeUndefined();
    expect(e2.p.save.sectId).toBeNull();
  });

  it('lets only the leader promote, change the motto and disband', () => {
    const { r, leader, sectId, add } = setup();
    const elder = add('Elder', 'elder');
    const o = add('Out', 'outer');
    for (const w of [elder, o]) {
      expect(w.run({ t: 'sect', op: 'promote', id: o.p.charId, role: 'disciple' }).err?.code).toBe('no_permission');
      expect(w.run({ t: 'sect', op: 'motto', motto: 'mine now' }).err?.code).toBe('no_permission');
      expect(w.run({ t: 'sect', op: 'disband' }).err?.code).toBe('no_permission');
    }
    expect(leader.run({ t: 'sect', op: 'promote', id: o.p.charId, role: 'outer' }).err?.code).toBe('no_change');
    expect(leader.run({ t: 'sect', op: 'promote', id: leader.p.charId, role: 'elder' }).err?.code).toBe('bad_target');
    expect(leader.run({ t: 'sect', op: 'promote', id: 424242, role: 'elder' }).err?.code).toBe('not_member');
    expect(leader.run({ t: 'sect', op: 'promote', id: o.p.charId, role: 'disciple' }).err).toBeUndefined();
    expect(o.conn.last('me')!.me.sect?.role).toBe('disciple');
    expect(leader.run({ t: 'sect', op: 'motto', motto: '  Be   water  ' }).err).toBeUndefined();
    expect((r.ask(o, 'sect', {}).data as SectView).motto).toBe('Be water');
    // The leader cannot just walk out; leadership can be handed over.
    expect(leader.run({ t: 'sect', op: 'leave' }).err?.code).toBe('leader_cannot_leave');
    expect(leader.run({ t: 'sect', op: 'promote', id: elder.p.charId, role: 'leader' }).err).toBeUndefined();
    expect(getSectsApi(r.ctx)!.roleOf(elder.p.charId)).toBe('leader');
    expect(getSectsApi(r.ctx)!.roleOf(leader.p.charId)).toBe('elder');
    expect(leader.run({ t: 'sect', op: 'leave' }).err).toBeUndefined();
    expect(leader.p.save.sectId).toBeNull();
    expect(elder.run({ t: 'sect', op: 'disband' }).err).toBeUndefined();
    expect(o.p.save.sectId).toBeNull();
    expect(r.ask(o, 'sect', { id: sectId }).data).toBeNull();
    expect(r.ask(o, 'sects', {}).data).toEqual([]);
  });

  it('accepts deposits from any member into the treasury', () => {
    const { r, leader, add } = setup();
    const o = add('Out', 'outer');
    o.p.save.gold = 100;
    expect(o.run({ t: 'sect', op: 'deposit', gold: 500 }).err?.code).toBe('no_gold');
    expect(o.run({ t: 'sect', op: 'deposit', gold: 0 }).err?.code).toBe('bad_amount');
    expect(o.run({ t: 'sect', op: 'deposit', gold: 60 }).err).toBeUndefined();
    expect(o.p.save.gold).toBe(40);
    expect((r.ask(leader, 'sect', {}).data as SectView).treasury).toBe(60);
    expect(r.join('Stranger').run({ t: 'sect', op: 'deposit', gold: 1 }).err?.code).toBe('no_sect');
  });

  it('lets members leave and decline invitations', () => {
    const { r, leader, sectId, add } = setup();
    const o = add('Out', 'outer');
    expect(o.run({ t: 'sect', op: 'leave' }).err).toBeUndefined();
    expect(o.p.save.sectId).toBeNull();
    expect(o.run({ t: 'sect', op: 'leave' }).err?.code).toBe('no_sect');
    expect(leader.run({ t: 'sect', op: 'invite', name: 'Out' }).err).toBeUndefined();
    expect(o.run({ t: 'sect', op: 'decline', sect: sectId }).err).toBeUndefined();
    expect(o.run({ t: 'sect', op: 'accept', sect: sectId }).err?.code).toBe('no_invite');
    expect(r.ask(o, 'sect', {}).data).toBeNull();
  });
});

describe('invitations and requests', () => {
  it('expires invitations after five minutes', () => {
    const { r, leader, sectId } = setup();
    const t = r.join('Late');
    expect(leader.run({ t: 'sect', op: 'invite', name: 'Late' }).err).toBeUndefined();
    r.h.clock.advance(INVITE_TTL_MS + 1000);
    expect(t.run({ t: 'sect', op: 'accept', sect: sectId }).err?.code).toBe('no_invite');
    expect(t.p.save.sectId).toBeNull();
    expect(leader.run({ t: 'sect', op: 'invite', name: 'Late' }).err).toBeUndefined();
    expect(t.run({ t: 'sect', op: 'accept', sect: sectId }).err).toBeUndefined();
  });

  it('turns a join request into membership when the leader invites that player', () => {
    const { r, leader, sectId } = setup();
    const t = r.join('Hopeful', { level: 4 });
    expect(t.run({ t: 'sect', op: 'join', sect: 9999 }).err?.code).toBe('not_found');
    expect(t.run({ t: 'sect', op: 'join', sect: sectId }).err).toBeUndefined();
    expect(t.run({ t: 'sect', op: 'join', sect: sectId }).err?.code).toBe('already_requested');
    expect(leader.conn.of('note').some((n) => n.text.includes('Hopeful'))).toBe(true);
    expect(leader.run({ t: 'sect', op: 'invite', name: 'Hopeful' }).err).toBeUndefined();
    expect(t.p.save.sectId).toBe(sectId);
    expect(getSectsApi(r.ctx)!.roleOf(t.p.charId)).toBe('outer');
  });

  it('treats a join request as acceptance of an open invitation', () => {
    const { r, leader, sectId } = setup();
    const t = r.join('Eager');
    leader.run({ t: 'sect', op: 'invite', name: 'Eager' });
    expect(t.run({ t: 'sect', op: 'join', sect: sectId }).err).toBeUndefined();
    expect(t.p.save.sectId).toBe(sectId);
  });

  it('rate limits invitation spam per sender', () => {
    const { r, leader } = setup();
    let limited = 0;
    for (let i = 0; i < 14; i++) {
      r.join(`Spam${i}`);
      if (leader.run({ t: 'sect', op: 'invite', name: `Spam${i}` }).err?.code === 'slow_down') limited++;
    }
    expect(limited).toBeGreaterThan(0);
  });
});

describe('level, XP bonus, chat', () => {
  it('derives the sect level from the sum of member levels', () => {
    expect(sectLevelFor(0)).toBe(0);
    expect(sectLevelFor(15)).toBe(1);
    expect(sectLevelFor(36)).toBe(3);
    expect(sectLevelFor(400)).toBe(10);
    expect(sectLevelFor(100000)).toBe(10);
  });

  it('adds +2% XP per sect level to members only', () => {
    const { r, leader, add } = setup();
    const m = add('Member', 'outer', 28); // 12 + 28 = 40 -> floor(sqrt(40) / 2) = 3
    const out = r.join('Outsider', { level: 28 });
    expect(r.ask(leader, 'sect', {}).data).toMatchObject({ level: 3 });
    expect(xpMultiplier(r.ctx, m.p)).toBeCloseTo(1.06);
    expect(xpMultiplier(r.ctx, out.p)).toBe(1);
    const before = m.p.save.xp;
    grantXp(r.ctx, m.p, 100);
    expect(m.p.save.xp - before).toBe(106);
  });

  it('caps the bonus at +20%', () => {
    const { r, leader, add } = setup();
    leader.p.save.level = 40;
    const m = add('Big', 'outer', 40);
    for (let i = 0; i < 10; i++) add(`Big${i}x`, 'outer', 40);
    r.h.clock.advance(60_000); // level cache refresh
    expect(xpMultiplier(r.ctx, m.p)).toBeCloseTo(1.2);
  });

  it('delivers sect chat to online members only', () => {
    const { r, add } = setup();
    const a = add('ChatA', 'outer');
    const b = add('ChatB', 'outer');
    const out = r.join('Eavesdrop');
    for (const w of [a, b, out]) w.conn.clear();
    r.h.say(a.p, { t: 'chat', ch: 'sect', text: 'hello sect' });
    r.h.tick();
    expect(b.conn.of('chat').some((c) => c.msg.ch === 'sect' && c.msg.text === 'hello sect')).toBe(true);
    expect(a.conn.of('chat').some((c) => c.msg.text === 'hello sect')).toBe(true);
    expect(out.conn.of('chat').some((c) => c.msg.text === 'hello sect')).toBe(false);
  });
});

describe('core query decoration', () => {
  it('fills in sect names on player profiles and the leaderboard', () => {
    const { r, add } = setup();
    const m = add('Member', 'outer');
    const out = r.join('Outsider');
    expect(r.ask(out, 'player', { id: m.p.charId }).data).toMatchObject({ name: 'Member', sect: 'Azure Lotus' });
    expect(r.ask(out, 'player', { name: 'Outsider' }).data).toMatchObject({ sect: null });
    r.h.game.playerMgr.saveDirty(true);
    const board = r.ask(out, 'leaderboard', {}).data as { name: string; sect: string | null }[];
    expect(board.find((e) => e.name === 'Leader')?.sect).toBe('Azure Lotus');
    expect(board.find((e) => e.name === 'Outsider')?.sect).toBeNull();
  });
});

describe('offline members and persistence', () => {
  it('updates offline members in the database when they are kicked or the sect disbands', () => {
    const { r, leader, sectId, add } = setup();
    const a = add('Gone', 'outer');
    const b = add('Gone2', 'outer');
    r.h.game.playerMgr.saveDirty(true);
    r.leave(a);
    r.leave(b);
    expect(r.h.db.getCharacterById(a.p.charId)!.save.sectId).toBe(sectId);
    expect(leader.run({ t: 'sect', op: 'kick', id: a.p.charId }).err).toBeUndefined();
    expect(r.h.db.getCharacterById(a.p.charId)!.save.sectId).toBeNull();
    // The kicked player hears about it on the next login.
    const back = r.rejoin(a);
    expect(back.conn.of('note').some((n) => n.text.includes('removed from Azure Lotus'))).toBe(true);
    expect(back.conn.last('me')?.me.sect ?? back.conn.last('hello')!.you.sect).toBeNull();
    // Disbanding clears the remaining offline member too.
    expect(leader.run({ t: 'sect', op: 'disband' }).err).toBeUndefined();
    expect(r.h.db.getCharacterById(b.p.charId)!.save.sectId).toBeNull();
    const back2 = r.rejoin(b);
    expect(back2.conn.of('note').some((n) => n.text.includes('disbanded'))).toBe(true);
  });

  it('heals a stale sectId on login', () => {
    const { r, sectId, add } = setup();
    const a = add('Stale', 'outer');
    r.h.game.playerMgr.saveDirty(true);
    r.leave(a);
    const rec = r.h.db.getCharacterById(a.p.charId)!;
    rec.save.sectId = null;
    r.h.db.saveCharacter(rec.save, r.h.clock.t);
    const back = r.rejoin(a);
    expect(back.p.save.sectId).toBe(sectId);
    expect(back.conn.of('hello')[0].you.sect?.name).toBe('Azure Lotus');
    expect(back.p.entity.tag).toBe('[AZL]');
  });

  it('shows the tag together with the title', () => {
    const { leader } = setup();
    leader.run({ t: 'title', title: 'Sword Saint' });
    expect(leader.p.entity.tag).toBe('[AZL] Sword Saint');
  });

  it('survives a restart: sects, roles, treasury and members come back from the database', () => {
    const { r, leader, sectId, add } = setup();
    const m = add('Keeper', 'elder', 9);
    leader.p.save.gold = 300;
    leader.run({ t: 'sect', op: 'deposit', gold: 250 });
    leader.run({ t: 'sect', op: 'motto', motto: 'Endure' });
    r.h.game.playerMgr.saveDirty(true);
    r.leave(m);
    const { game, ctx } = r.restart();
    expect(getSectsApi(ctx)!.roleOf(m.p.charId)).toBe('elder');
    expect(getSectsApi(ctx)!.sectIdOf(leader.p.charId)).toBe(sectId);
    const conn = new FakeConn();
    const p2 = game.connect(conn, m.user)!;
    expect(p2.save.sectId).toBe(sectId);
    expect(conn.of('hello')[0].you.sect).toEqual({ id: sectId, name: 'Azure Lotus', tag: 'AZL', role: 'elder' });
    game.receive(p2, { t: 'q', id: 1, name: 'sect', args: {} });
    const res = conn.of('res').find((x) => x.id === 1)!;
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ name: 'Azure Lotus', motto: 'Endure', treasury: 250 });
  });
});

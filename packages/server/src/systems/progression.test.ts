import { afterEach, describe, expect, it, vi } from 'vitest';
import { xpToNext, type CharacterSave, type TacticRule } from '@murim/shared';
import { makeScene, nearSpot, powerUp, type Scene } from './combat/testing';
import { countItem } from './lib';

let sc: Scene | null = null;
afterEach(() => {
  vi.restoreAllMocks();
  sc?.h.close();
  sc = null;
});

function hero(level = 1) {
  sc = makeScene();
  const { h, ctx } = sc;
  const j = h.join('Hero', sc.spot);
  const s: CharacterSave = j.p.save;
  s.level = level;
  s.skills = {
    fist_iron: { lv: 1, xp: 0 },
    sword_basic: { lv: 2, xp: 0 },
    int_dantian: { lv: 1, xp: 0 },
    mov_light: { lv: 1, xp: 0 },
  };
  s.loadout = { active: ['fist_iron', null, null, null], internal: null, movement: null };
  s.inventory = [{ id: 'pill_heal_s', qty: 3 }, { id: 'herb', qty: 2 }];
  h.tick(2);
  return { ...j, h, ctx, s: sc };
}

describe('alloc', () => {
  it('spends stat points and refreshes the client', () => {
    const { p, conn, h } = hero();
    p.save.statPoints = 5;
    const might = p.save.stats.might;
    conn.clear();
    h.say(p, { t: 'alloc', stat: 'might', n: 3 });
    h.tick(4);
    expect(p.save.stats.might).toBe(might + 3);
    expect(p.save.statPoints).toBe(2);
    expect(conn.last('me')!.me.c.stats.might).toBe(might + 3);
    expect(conn.last('err')).toBeUndefined();
  });

  it('rejects bad input', () => {
    const { p, conn, h } = hero();
    p.save.statPoints = 2;
    const stats = { ...p.save.stats };
    const code = (msg: Parameters<typeof h.say>[1]): string | undefined => {
      conn.clear();
      h.say(p, msg);
      h.tick();
      return conn.last('err')?.code;
    };
    expect(code({ t: 'alloc', stat: 'might', n: 3 })).toBe('no_points');
    expect(code({ t: 'alloc', stat: 'might', n: 0 })).toBe('bad_amount');
    expect(code({ t: 'alloc', stat: 'might', n: -1 })).toBe('bad_amount');
    expect(code({ t: 'alloc', stat: 'might', n: 1.5 })).toBe('bad_amount');
    expect(code({ t: 'alloc', stat: 'luck' as never, n: 1 })).toBe('bad_stat');
    expect(p.save.stats).toEqual(stats);
    expect(p.save.statPoints).toBe(2);
  });

  it('is refused while fighting or dead', () => {
    const { p, conn, h, ctx, s } = hero();
    p.save.statPoints = 2;
    powerUp(ctx, p, 15, 30);
    const boar = s.mon.spawn({ defId: 'boar', level: 3, x: s.spot.x + 1, y: s.spot.y })!;
    h.tick(2);
    h.say(p, { t: 'interact', id: boar.id });
    h.tick(3);
    expect(p.combatId).not.toBeNull();
    h.say(p, { t: 'alloc', stat: 'might', n: 1 });
    h.tick();
    expect(conn.last('err')?.code).toBe('in_combat');
  });
});

describe('build', () => {
  const rule = (c: TacticRule['cond'], a: TacticRule['act']): TacticRule => ({ cond: c, act: a });
  const valid = {
    loadout: { active: ['fist_iron', 'sword_basic', null, null] as (string | null)[], internal: 'int_dantian', movement: 'mov_light' },
    stance: 'aggressive' as const,
    tactics: [
      rule({ k: 'hpBelow', v: 40 }, { k: 'item', id: 'pill_heal_s' }),
      rule({ k: 'enemiesAtLeast', v: 2 }, { k: 'skill', id: 'sword_basic' }),
      rule({ k: 'always' }, { k: 'basic' }),
    ],
  };

  it('stores a valid build as a copy', () => {
    const { p, conn, h } = hero();
    h.say(p, { t: 'build', ...valid });
    h.tick(4);
    expect(conn.last('err')).toBeUndefined();
    expect(p.save.loadout).toEqual({ active: ['fist_iron', 'sword_basic', null, null], internal: 'int_dantian', movement: 'mov_light' });
    expect(p.save.stance).toBe('aggressive');
    expect(p.save.tactics).toEqual(valid.tactics);
    expect(p.save.tactics).not.toBe(valid.tactics);
    expect(p.save.tactics[0]).not.toBe(valid.tactics[0]);
    expect(conn.last('me')!.me.c.stance).toBe('aggressive');
  });

  it('rejects anything the character cannot do', () => {
    const { p, conn, h } = hero();
    const before = JSON.stringify([p.save.loadout, p.save.stance, p.save.tactics]);
    const bad = (patch: Partial<typeof valid>): string | undefined => {
      conn.clear();
      h.say(p, { t: 'build', ...valid, ...patch });
      h.tick();
      return conn.last('err')?.code;
    };
    // unlearned or wrongly placed skills
    expect(bad({ loadout: { ...valid.loadout, active: ['sword_heaven', null, null, null] } })).toBe('bad_build');
    expect(bad({ loadout: { ...valid.loadout, active: ['int_dantian', null, null, null] } })).toBe('bad_build');
    expect(bad({ loadout: { ...valid.loadout, internal: 'fist_iron' } })).toBe('bad_build');
    expect(bad({ loadout: { ...valid.loadout, active: ['fist_iron', 'fist_iron', null, null] } })).toBe('bad_build');
    // more slots than the rank gives
    expect(bad({ loadout: { ...valid.loadout, active: ['fist_iron', null, null, null, 'sword_basic'] } })).toBe('bad_build');
    // tactics
    const seven = Array.from({ length: 7 }, () => rule({ k: 'always' }, { k: 'basic' }));
    expect(bad({ tactics: seven })).toBe('bad_build');
    expect(bad({ tactics: [rule({ k: 'hpBelow', v: 150 }, { k: 'basic' })] })).toBe('bad_build');
    expect(bad({ tactics: [rule({ k: 'hpBelow', v: 12.5 }, { k: 'basic' })] })).toBe('bad_build');
    expect(bad({ tactics: [rule({ k: 'always' }, { k: 'skill', id: 'sword_heaven' })] })).toBe('bad_build');
    expect(bad({ tactics: [rule({ k: 'always' }, { k: 'skill', id: 'int_dantian' })] })).toBe('bad_build');
    expect(bad({ tactics: [rule({ k: 'always' }, { k: 'item', id: 'herb' })] })).toBe('bad_build');
    expect(bad({ tactics: [rule({ k: 'always' }, { k: 'item', id: 'pill_break_1' })] })).toBe('bad_build');
    expect(bad({ tactics: [rule({ k: 'always' }, { k: 'item', id: 'no_such_item' })] })).toBe('bad_build');
    expect(bad({ tactics: [rule({ k: 'bogus' } as never, { k: 'basic' })] })).toBe('bad_build');
    expect(bad({ tactics: [rule({ k: 'always' }, { k: 'dance' } as never)] })).toBe('bad_build');
    expect(bad({ stance: 'berserk' as never })).toBe('bad_build');
    expect(JSON.stringify([p.save.loadout, p.save.stance, p.save.tactics])).toBe(before);
    // and six rules are fine
    const six = Array.from({ length: 6 }, () => rule({ k: 'always' }, { k: 'basic' }));
    expect(bad({ tactics: six })).toBeUndefined();
  });

  it('grows with the rank: a fifth slot opens at First-Rate', () => {
    const { p, conn, h } = hero(19);
    h.say(p, { t: 'build', ...valid, loadout: { ...valid.loadout, active: ['fist_iron', 'sword_basic', null, null, 'fist_iron'] } });
    h.tick();
    expect(conn.last('err')?.code).toBe('bad_build'); // duplicate
    h.say(p, { t: 'build', ...valid, loadout: { ...valid.loadout, active: ['fist_iron', null, null, null, 'sword_basic'] } });
    h.tick();
    expect(p.save.loadout.active).toHaveLength(5);
    expect(p.save.loadout.active[4]).toBe('sword_basic');
  });

  it('cannot be changed mid-fight', () => {
    const { p, conn, h, ctx, s } = hero();
    powerUp(ctx, p, 15, 30);
    const boar = s.mon.spawn({ defId: 'boar', level: 3, x: s.spot.x + 1, y: s.spot.y })!;
    h.tick(2);
    h.say(p, { t: 'interact', id: boar.id });
    h.tick(3);
    h.say(p, { t: 'build', ...valid });
    h.tick();
    expect(conn.last('err')?.code).toBe('in_combat');
  });
});

describe('breakthrough', () => {
  function atPeak(level: number, pill: string, gold: number) {
    const j = hero(level);
    j.s.ctx.markMe(j.p);
    j.p.save.xp = xpToNext(level);
    j.p.save.inventory.push({ id: pill, qty: 1 });
    j.p.save.gold = gold;
    return j;
  }
  const attempt = (j: ReturnType<typeof hero>): string | undefined => {
    j.conn.clear();
    j.h.say(j.p, { t: 'breakthrough' });
    j.h.tick(4);
    return j.conn.last('err')?.code;
  };

  it('checks every requirement', () => {
    const j = hero(5);
    expect(attempt(j)).toBe('no_breakthrough'); // not a stage 9
    const k = hero(9);
    expect(attempt(k)).toBe('xp_not_full');
    k.p.save.xp = xpToNext(9);
    expect(attempt(k)).toBe('no_pill');
    k.p.save.inventory.push({ id: 'pill_break_1', qty: 1 });
    k.p.save.gold = 99;
    expect(attempt(k)).toBe('no_gold');
    expect(k.p.save.level).toBe(9);
    const top = atPeak(45, 'pill_break_4', 99999);
    expect(attempt(top)).toBe('no_breakthrough'); // Transcendent is the cap of the slice
    expect(top.p.save.level).toBe(45);
  });

  it('success: new rank, stat points, full vitals, pill and gold consumed', () => {
    const j = atPeak(9, 'pill_break_1', 150);
    vi.spyOn(j.ctx.rng, 'chance').mockReturnValue(true);
    const ups: number[] = [];
    j.ctx.events.on('playerLevelUp', (ev) => void ups.push(ev.to));
    const rec = vi.spyOn(j.h.game.sim, 'record');
    const points = j.p.save.statPoints;
    j.p.save.hp = 1;
    expect(attempt(j)).toBeUndefined();
    const s = j.p.save;
    expect(s.level).toBe(10);
    expect(s.xp).toBe(0);
    expect(s.statPoints).toBe(points + 7);
    expect(s.gold).toBe(50);
    expect(countItem(s, 'pill_break_1')).toBe(0);
    expect(s.hp).toBe(j.p.entity.maxHp);
    expect(j.conn.of('fx').some((f) => f.kind === 'breakthrough')).toBe(true);
    expect(ups).toEqual([10]);
    expect(rec).not.toHaveBeenCalled(); // only First-Rate and above make the chronicle
  });

  it('success into First-Rate opens a loadout slot, auto-fills it and writes the chronicle', () => {
    const j = atPeak(18, 'pill_break_2', 500);
    vi.spyOn(j.ctx.rng, 'chance').mockReturnValue(true);
    const rec = vi.spyOn(j.h.game.sim, 'record');
    j.p.save.loadout = { active: ['fist_iron', null, null, null], internal: null, movement: null };
    expect(attempt(j)).toBeUndefined();
    expect(j.p.save.level).toBe(19);
    expect(j.p.save.loadout.active).toHaveLength(5);
    expect(j.p.save.loadout.active.slice(0, 1)).toEqual(['fist_iron']);
    expect(j.p.save.loadout.active.includes('sword_basic')).toBe(true);
    expect(rec).toHaveBeenCalledTimes(1);
    expect(rec.mock.calls[0][0]).toContain('First-Rate');
    expect(j.p.save.gold).toBe(100);
  });

  it('failure: qi deviation costs XP, injures, eats the gold and (usually) the pill', () => {
    const j = atPeak(9, 'pill_break_1', 150);
    vi.spyOn(j.ctx.rng, 'chance').mockReturnValue(false);
    const bar = xpToNext(9);
    expect(attempt(j)).toBeUndefined();
    const s = j.p.save;
    expect(s.level).toBe(9);
    expect(s.xp).toBe(bar - Math.round(bar * 0.3));
    expect(s.gold).toBe(50);
    expect(countItem(s, 'pill_break_1')).toBe(0);
    expect(s.injuryStacks).toBe(1);
    expect(s.injuryUntil).toBeGreaterThanOrEqual(j.h.clock.t + 30 * 60_000 - 1000);
    expect(j.conn.last('note')!.level).toBe('bad');
    // the bar is no longer full: another attempt is refused until the cultivation is back
    expect(attempt(j)).toBe('xp_not_full');
  });

  it('failure with a lucky pill keeps the pill', () => {
    const j = atPeak(9, 'pill_break_1', 150);
    vi.spyOn(j.ctx.rng, 'chance').mockReturnValueOnce(false).mockReturnValueOnce(true);
    expect(attempt(j)).toBeUndefined();
    expect(countItem(j.p.save, 'pill_break_1')).toBe(1);
    expect(j.p.save.gold).toBe(50);
    expect(j.p.save.level).toBe(9);
  });

  it('is unavailable while dead or fighting', () => {
    const j = atPeak(9, 'pill_break_1', 150);
    j.p.entity.state = 'dead';
    expect(attempt(j)).toBe('dead');
    j.p.entity.state = 'idle';
    void nearSpot;
  });
});

import { ORIGINS, REROLLS, deriveForCharacter } from '@murim/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db';
import { testWorld } from '../testkit';
import { CharacterService, pickHome } from './chargen';

const world = testWorld();
let db: Db;
let svc: CharacterService;
let seedCounter: number;
let userId: number;
let t = 5000;

beforeEach(() => {
  db = openDb(':memory:');
  seedCounter = 100;
  svc = new CharacterService(db, world, () => t, () => ++seedCounter);
  userId = db.createUser('Roller', 'h', 's', 1)!.id;
});

describe('rolling', () => {
  it('the first roll is free and persisted; reroll:false returns the same roll', () => {
    const first = svc.roll(userId, false);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.preview.rerollsLeft).toBe(REROLLS);
    expect(first.preview.roll.stats.might).toBeGreaterThan(0);
    expect(first.preview.look).toBeTruthy();
    const again = svc.roll(userId, false);
    expect(again.ok && again.preview).toEqual(first.preview);
    expect(svc.rerollsLeft(userId)).toBe(REROLLS);
  });

  it('allows exactly REROLLS rerolls, keeping the look, then refuses', () => {
    const first = svc.roll(userId);
    if (!first.ok) throw new Error('roll failed');
    const seen = [JSON.stringify(first.preview.roll)];
    for (let i = 1; i <= REROLLS; i++) {
      const r = svc.roll(userId, true);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.preview.rerollsLeft).toBe(REROLLS - i);
      expect(r.preview.look).toEqual(first.preview.look);
      seen.push(JSON.stringify(r.preview.roll));
    }
    expect(new Set(seen).size).toBeGreaterThan(1);
    const denied = svc.roll(userId, true);
    expect(denied).toMatchObject({ ok: false, status: 400 });
    // The last roll stays available.
    const keep = svc.roll(userId, false);
    expect(keep.ok && JSON.stringify(keep.preview.roll)).toBe(seen.at(-1));
    expect(svc.rerollsLeft(userId)).toBe(0);
  });

  it('an omitted flag rerolls once a roll exists (as the contract says)', () => {
    svc.roll(userId);
    const r = svc.roll(userId);
    expect(r.ok && r.preview.rerollsLeft).toBe(REROLLS - 1);
  });

  it('previews describe talents, origin, items and skills in words', () => {
    const r = svc.roll(userId);
    if (!r.ok) throw new Error('roll failed');
    const o = ORIGINS[r.preview.roll.origin];
    expect(r.preview.origin).toMatchObject({ id: o.id, name: o.name, gold: o.gold });
    expect(r.preview.origin.items.length).toBe(o.items.length);
    expect(r.preview.origin.items.every((s) => !/^[a-z_0-9]+$/.test(s))).toBe(true);
    expect(r.preview.origin.skills.length).toBeGreaterThan(0);
    expect(r.preview.talents.length).toBe(r.preview.roll.talents.length);
  });

  it('survives a corrupt pending roll by rolling a fresh one', () => {
    db.setPendingRoll(userId, '{not json', 3);
    const r = svc.roll(userId, false);
    expect(r.ok && r.preview.rerollsLeft).toBe(REROLLS);
  });
});

describe('creating', () => {
  it('requires a roll first', () => {
    expect(svc.create(userId, { name: 'Hero' })).toMatchObject({ ok: false, status: 400 });
  });

  it('validates the name, enforces uniqueness ignoring case, clamps the look', () => {
    svc.roll(userId);
    for (const name of ['', 'ab', 'x'.repeat(17), '1abc', 'Li  Wei', 'Admin', undefined, 42]) {
      expect(svc.create(userId, { name }), String(name)).toMatchObject({ ok: false, status: 400 });
    }
    const other = db.createUser('Other', 'h', 's', 1)!;
    svc.roll(other.id);
    expect(svc.create(other.id, { name: 'Taken' }).ok).toBe(true);
    expect(svc.create(userId, { name: 'tAKEN' })).toMatchObject({ ok: false, status: 409 });
    // Failed attempts keep the pending roll.
    expect(db.getPendingRoll(userId)).toBeTruthy();

    const wild = { gender: 7, skin: 999, hairStyle: -4, hairColor: 1.9, outfit: 'x', outfitColor: 3, sashColor: 2, accessory: 99 };
    const made = svc.create(userId, { name: '  Mu-Yeong ', look: wild });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    expect(made.save.name).toBe('Mu-Yeong');
    expect(made.save.look).toEqual({ gender: 0, skin: 5, hairStyle: 0, hairColor: 1, outfit: 0, outfitColor: 3, sashColor: 2, accessory: 4 });
  });

  it('builds a complete, healthy save at the home settlement and consumes the roll', () => {
    const rolled = svc.roll(userId);
    if (!rolled.ok) throw new Error('roll failed');
    svc.roll(userId, true);
    const made = svc.create(userId, { name: 'Hero' });
    if (!made.ok) throw new Error(made.error);
    const save = made.save;
    const pendingOrigin = ORIGINS[save.origin];
    const home = world.settlements[save.lastTown];
    expect(pendingOrigin.homeKinds).toContain(home.kind);
    expect({ x: save.x, y: save.y }).toEqual(home.spawn);
    expect(save.level).toBe(1);
    expect(save.rerolls).toBe(1);
    expect(save.id).toBeGreaterThan(0);
    const d = deriveForCharacter(save);
    expect(save.hp).toBe(d.maxHp);
    expect(save.qi).toBe(d.maxQi);
    expect(save.inventory.some((i) => i.id === 'pill_heal_s')).toBe(true);
    expect(Object.keys(save.skills).length).toBeGreaterThan(0);
    expect(db.getPendingRoll(userId)).toBeUndefined();
    expect(db.getCharacterByUser(userId)?.save.name).toBe('Hero');
    expect(svc.rerollsLeft(userId)).toBe(0);
  });

  it('one character per account', () => {
    svc.roll(userId);
    expect(svc.create(userId, { name: 'First' }).ok).toBe(true);
    expect(svc.create(userId, { name: 'Second' })).toMatchObject({ ok: false, status: 403 });
    expect(svc.roll(userId)).toMatchObject({ ok: false, status: 403 });
  });
});

describe('pickHome', () => {
  it('prefers the starting village when its kind fits, else the nearest fitting settlement', () => {
    expect(pickHome(world, ['village', 'hamlet']).id).toBe(0);
    expect(pickHome(world, ['hamlet', 'village']).id).toBe(0);
    const townHome = pickHome(world, ['town']);
    expect(townHome.kind).toBe('town');
    const towns = world.settlements.filter((s) => s.kind === 'town');
    const start = world.settlements[0];
    const nearest = towns.reduce((a, b) => (Math.hypot(a.x - start.x, a.y - start.y) <= Math.hypot(b.x - start.x, b.y - start.y) ? a : b));
    expect(townHome.id).toBe(nearest.id);
    expect(pickHome(world, ['sectHall']).kind).toBe('sectHall');
    expect(pickHome(world, []).id).toBe(0);
  });

  it('every origin has a valid home in the production world', () => {
    for (const o of Object.values(ORIGINS)) expect(o.homeKinds).toContain(pickHome(world, o.homeKinds).kind);
  });
});

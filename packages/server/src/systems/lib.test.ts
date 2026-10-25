import { afterEach, describe, expect, it } from 'vitest';
import { INVENTORY_SLOTS, getItem } from '@murim/shared';
import { makeHarness, type Harness } from '../testkit';
import { addItem, addReputation, countItem, freeSlots, grantXp, hasBuff, removeAt, removeItem, roomFor, setBuff, xpMultiplier } from './lib';
import { getServices } from './services';

let h: Harness | null = null;
afterEach(() => {
  h?.close();
  h = null;
});

describe('inventory helpers', () => {
  it('merges stackables and respects stack size', () => {
    h = makeHarness();
    const { p } = h.join('Packer');
    const save = p.save;
    save.inventory = [];
    const stack = getItem('herb')!.stack;
    expect(addItem(save, { id: 'herb', qty: stack + 5 })).toBe(stack + 5);
    expect(save.inventory.length).toBe(2);
    expect(countItem(save, 'herb')).toBe(stack + 5);
    expect(addItem(save, { id: 'herb', qty: 3 })).toBe(3);
    expect(save.inventory[1].qty).toBe(8);
  });

  it('gives equipment unique uids and keeps rarity', () => {
    h = makeHarness();
    const { p } = h.join('Smith');
    p.save.inventory = [];
    addItem(p.save, { id: 'w_sword_1', qty: 2, r: 2, aff: [['might', 3]] });
    expect(p.save.inventory.length).toBe(2);
    const [a, b] = p.save.inventory;
    expect(a.uid).toBeTruthy();
    expect(a.uid).not.toBe(b.uid);
    expect(a.r).toBe(2);
    expect(a.aff).toEqual([['might', 3]]);
    expect(a.aff).not.toBe(b.aff);
  });

  it('refuses unknown ids and stops when the bag is full', () => {
    h = makeHarness();
    const { p } = h.join('Hoarder');
    p.save.inventory = [];
    expect(addItem(p.save, { id: 'nope', qty: 1 })).toBe(0);
    for (let i = 0; i < INVENTORY_SLOTS; i++) p.save.inventory.push({ id: 'w_sword_1', qty: 1, uid: `x${i}` });
    expect(freeSlots(p.save)).toBe(0);
    expect(roomFor(p.save, 'grain')).toBe(0);
    expect(addItem(p.save, { id: 'grain', qty: 5 })).toBe(0);
  });

  it('removes across stacks all-or-nothing', () => {
    h = makeHarness();
    const { p } = h.join('Remover');
    p.save.inventory = [
      { id: 'herb', qty: 10 },
      { id: 'herb', qty: 4 },
    ];
    expect(removeItem(p.save, 'herb', 20)).toBe(false);
    expect(countItem(p.save, 'herb')).toBe(14);
    expect(removeItem(p.save, 'herb', 12)).toBe(true);
    expect(countItem(p.save, 'herb')).toBe(2);
  });

  it('removeAt verifies the id because clients send indexes', () => {
    h = makeHarness();
    const { p } = h.join('Indexer');
    p.save.inventory = [{ id: 'herb', qty: 5 }];
    expect(removeAt(p.save, 0, 'grain', 1)).toBeNull();
    expect(removeAt(p.save, 3, 'herb', 1)).toBeNull();
    expect(removeAt(p.save, 0, 'herb', 6)).toBeNull();
    expect(removeAt(p.save, 0, 'herb', 5)?.qty).toBe(5);
    expect(p.save.inventory).toHaveLength(0);
  });
});

describe('grants', () => {
  it('grantXp applies registered multipliers', () => {
    h = makeHarness();
    const { p } = h.join('Learner');
    const base = xpMultiplier(h.game.ctx, p);
    getServices(h.game.ctx).xpModifiers.push(() => 2);
    expect(xpMultiplier(h.game.ctx, p)).toBeCloseTo(base * 2);
    const res = grantXp(h.game.ctx, p, 10);
    expect(res.gained).toBe(Math.round(10 * base * 2));
    expect(grantXp(h.game.ctx, p, 10, { raw: true }).gained).toBe(10);
  });

  it('grantXp levels up with fx, note, event and a partial heal', () => {
    h = makeHarness();
    const { p, conn } = h.join('Climber');
    const seen: number[] = [];
    h.game.ctx.events.on('playerLevelUp', (e) => seen.push(e.to));
    p.save.hp = 1;
    conn.clear();
    const res = grantXp(h.game.ctx, p, 5000, { raw: true });
    expect(res.levelsGained).toBeGreaterThan(0);
    expect(seen).toEqual([p.save.level]);
    expect(conn.of('fx').some((m) => m.kind === 'levelup')).toBe(true);
    expect(conn.of('note').some((m) => m.level === 'good')).toBe(true);
    expect(p.save.hp).toBeGreaterThan(1);
  });

  it('reputation clamps to +-100 and buffs expire', () => {
    h = makeHarness();
    const { p } = h.join('Rep');
    expect(addReputation(p.save, 'azure', 500)).toBe(100);
    expect(addReputation(p.save, 'azure', -500)).toBe(-100);
    setBuff(p.save, 'bless', 1000);
    expect(hasBuff(p.save, 'bless', 999)).toBe(true);
    expect(hasBuff(p.save, 'bless', 1000)).toBe(false);
  });
});

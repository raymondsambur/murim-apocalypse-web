import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Player } from '../ctx';
import { DUEL_EXPIRY_MS } from './duels';
import { getServices, type CombatService } from './services';
import { makeSocialRig, type SocialRig } from './social.testkit';

let rig: SocialRig | null = null;
afterEach(() => {
  rig?.h.close();
  rig = null;
});

function setup() {
  rig = makeSocialRig();
  const r = rig;
  const a = r.join('Ann', { level: 5, gold: 1000 });
  const b = r.join('Ben', { level: 5, gold: 400 });
  const calls: Array<[Player, Player, number]> = [];
  const svc: CombatService = {
    startDuel: vi.fn((x: Player, y: Player, stake: number) => {
      calls.push([x, y, stake]);
      return true;
    }),
    inCombat: vi.fn(() => false),
  };
  getServices(r.ctx).combat = svc;
  return { r, a, b, calls, svc };
}

describe('duels', () => {
  it('sends an invite carrying the challenger entity, and starts the duel on accept', () => {
    const { a, b, calls } = setup();
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id, stake: 50 }).err).toBeUndefined();
    expect(b.conn.last('invite')).toMatchObject({ kind: 'duel', fromId: a.p.charId, from: 'Ann', data: { entity: a.p.entity.id, stake: 50 } });
    expect(b.run({ t: 'duel', op: 'accept', id: a.p.charId }).err).toBeUndefined();
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(a.p);
    expect(calls[0][1]).toBe(b.p);
    expect(calls[0][2]).toBe(50);
    // The challenge is spent.
    expect(b.run({ t: 'duel', op: 'accept', id: a.p.charId }).err?.code).toBe('no_challenge');
  });

  it('rejects bad targets and states', () => {
    const { r, a, b } = setup();
    expect(a.run({ t: 'duel', op: 'challenge', id: a.p.entity.id }).err?.code).toBe('bad_target');
    expect(a.run({ t: 'duel', op: 'challenge', id: 999999 }).err?.code).toBe('not_found');
    const npc = r.ctx.npcEntity(1)!;
    expect(a.run({ t: 'duel', op: 'challenge', id: npc.id }).err?.code).toBe('not_found');
    b.p.combatId = 7;
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id }).err?.code).toBe('in_combat');
    b.p.combatId = null;
    a.p.combatId = 8;
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id }).err?.code).toBe('in_combat');
    a.p.combatId = null;
    b.p.entity.state = 'dead';
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id }).err?.code).toBe('dead');
    b.p.entity.state = 'idle';
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id }).err).toBeUndefined();
  });

  it('asks the combat service whether a fighter is already in a fight', () => {
    const { a, b, svc } = setup();
    vi.mocked(svc.inCombat).mockImplementation((p) => p === b.p);
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id }).err?.code).toBe('in_combat');
  });

  it('requires the fighters to be within 12 tiles', () => {
    const { r, a, b } = setup();
    const far = a.p.entity.x + 20 < r.h.world.w ? a.p.entity.x + 20 : a.p.entity.x - 20;
    r.ctx.movement.teleport(b.p.entity, far, a.p.entity.y);
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id }).err?.code).toBe('too_far');
    r.ctx.movement.teleport(b.p.entity, a.p.entity.x + 12, a.p.entity.y);
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id }).err).toBeUndefined();
  });

  it('caps the stake at 20% of the poorer fighter gold', () => {
    const { r, a, b, calls } = setup();
    // Ben has 400 gold: at most 80.
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id, stake: 81 }).err?.code).toBe('stake_high');
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id, stake: 80 }).err).toBeUndefined();
    // The stake is validated again on accept (Ben spent his gold meanwhile).
    b.p.save.gold = 100;
    expect(b.run({ t: 'duel', op: 'accept', id: a.p.charId }).err?.code).toBe('stake_high');
    expect(calls).toHaveLength(0);
    r.h.clock.advance(11_000);
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id, stake: 20 }).err).toBeUndefined();
    expect(b.run({ t: 'duel', op: 'accept', id: a.p.charId }).err).toBeUndefined();
    expect(calls[0][2]).toBe(20);
  });

  it('expires after 30 seconds and can be declined', () => {
    const { r, a, b, calls } = setup();
    a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id });
    r.h.clock.advance(DUEL_EXPIRY_MS + 1000);
    expect(b.run({ t: 'duel', op: 'accept', id: a.p.charId }).err?.code).toBe('no_challenge');
    expect(calls).toHaveLength(0);
    a.conn.clear();
    a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id });
    expect(b.run({ t: 'duel', op: 'decline', id: a.p.charId }).err).toBeUndefined();
    expect(a.conn.of('note').some((n) => n.text.includes('declined'))).toBe(true);
    expect(b.run({ t: 'duel', op: 'accept', id: a.p.charId }).err?.code).toBe('no_challenge');
  });

  it('only the challenged player can accept, and a logout cancels the challenge', () => {
    const { r, a, b } = setup();
    const c = r.join('Cy', { level: 5 });
    a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id });
    expect(c.run({ t: 'duel', op: 'accept', id: a.p.charId }).err?.code).toBe('no_challenge');
    r.leave(a);
    expect(b.run({ t: 'duel', op: 'accept', id: a.p.charId }).err?.code).toBe('no_challenge');
  });

  it('reports when combat is unavailable and rate limits repeated challenges', () => {
    const { r, a, b } = setup();
    delete getServices(r.ctx).combat;
    a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id });
    expect(b.run({ t: 'duel', op: 'accept', id: a.p.charId }).err?.code).toBe('unavailable');
    expect(a.run({ t: 'duel', op: 'challenge', id: b.p.entity.id }).err?.code).toBe('slow_down');
  });
});

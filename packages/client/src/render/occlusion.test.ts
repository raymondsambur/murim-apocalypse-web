import { describe, expect, it } from 'vitest';
import { MAX_GHOSTS, coverage, ghostPriority, ghostTint, isHidden, isVeiled, pickGhosts, plateAlpha, pointCovered, rowSpans, stepOcc, type Occluder } from './occlusion';

const house: Occluder = { x: 0, y: 0, w: 100, h: 100, depth: 10, spans: null };
const box = { x0: 40, y0: 40, x1: 56, y1: 70 };

describe('plate occlusion', () => {
  it('a building drawn after the entity covers it; one drawn before does not', () => {
    const c = coverage(box, 9, [house]);
    expect(c.frac).toBe(1);
    expect(c.head).toBe(true);
    expect(isHidden(c)).toBe(true);
    const front = coverage(box, 11, [house]);
    expect(front.frac).toBe(0);
    expect(isHidden(front)).toBe(false);
  });

  it('only the overlapping part counts (more than 60% hides, less keeps the plate)', () => {
    // covers the lower 4 of 5 sample rows but not the head
    const low: Occluder = { x: 0, y: 48, w: 100, h: 100, depth: 10, spans: null };
    const c = coverage(box, 9, [low]);
    expect(c.head).toBe(false);
    expect(c.frac).toBeCloseTo(0.8, 5);
    expect(isHidden(c)).toBe(true);
    const part: Occluder = { x: 0, y: 60, w: 100, h: 100, depth: 10, spans: null };
    const c2 = coverage(box, 9, [part]);
    expect(c2.frac).toBeCloseTo(0.4, 5);
    expect(isHidden(c2)).toBe(false);
  });

  it('a covered head alone hides the plate', () => {
    const roof: Occluder = { x: 0, y: 0, w: 100, h: 44, depth: 10, spans: null };
    const c = coverage(box, 9, [roof]);
    expect(c.head).toBe(true);
    expect(c.frac).toBeLessThan(0.6);
    expect(isHidden(c)).toBe(true);
  });

  it('transparent corners of an occluder sprite do not count (row spans)', () => {
    const px = new Uint32Array(10 * 4);
    // rows of width 10 where only x 3..6 are opaque
    for (let y = 0; y < 4; y++) for (let x = 3; x <= 6; x++) px[y * 10 + x] = 0xff000000;
    const sp = rowSpans(px, 10, 4);
    expect(sp.min[0]).toBe(3);
    expect(sp.max[0]).toBe(6);
    const o: Occluder = { x: 0, y: 0, w: 10, h: 4, depth: 5, spans: sp };
    expect(pointCovered(1, 1, 0, [o])).toBe(false);
    expect(pointCovered(4, 1, 0, [o])).toBe(true);
    expect(pointCovered(4, 1, 6, [o])).toBe(false);
  });

  it('fades smoothly without flicker', () => {
    let o = 0;
    o = stepOcc(o, true, 16);
    expect(o).toBeGreaterThan(0);
    expect(o).toBeLessThan(0.2);
    for (let i = 0; i < 20; i++) o = stepOcc(o, true, 16);
    expect(o).toBe(1);
    expect(plateAlpha(1)).toBeCloseTo(0.12, 5);
    expect(plateAlpha(1, 0.4)).toBeCloseTo(0.4, 5);
    expect(plateAlpha(0)).toBe(1);
    o = stepOcc(o, false, 16);
    expect(o).toBeLessThan(1);
    expect(o).toBeGreaterThan(0.8);
  });
});

describe('see-through silhouettes', () => {
  it('shows one as soon as a tenth of the body or the head is covered, long before a plate would hide', () => {
    expect(isVeiled({ frac: 0, head: false })).toBe(false);
    expect(isVeiled({ frac: 0.07, head: false })).toBe(false);
    expect(isVeiled({ frac: 0.13, head: false })).toBe(true);
    expect(isVeiled({ frac: 0, head: true })).toBe(true);
    // a hand-sized corner of a roof over the legs: a silhouette, but the plate stays
    const part: Occluder = { x: 0, y: 60, w: 100, h: 100, depth: 10, spans: null };
    const c = coverage(box, 9, [part]);
    expect(isVeiled(c)).toBe(true);
    expect(isHidden(c)).toBe(false);
    expect(isVeiled(coverage(box, 11, [house]))).toBe(false);
  });

  it('ranks yourself, the target and other players first, the crowd last', () => {
    const p = (o: Parameters<typeof ghostPriority>[0]) => ghostPriority(o);
    expect(p({ self: true, selected: false, kind: 'player' })).toBeLessThan(p({ self: false, selected: true, kind: 'npc' }));
    expect(p({ self: false, selected: true, kind: 'npc' })).toBeLessThan(p({ self: false, selected: false, kind: 'player' }));
    expect(p({ self: false, selected: false, kind: 'player' })).toBeLessThan(p({ self: false, selected: false, kind: 'monster', fighting: false }));
    expect(p({ self: false, selected: false, kind: 'monster', fighting: true })).toBeLessThan(p({ self: false, selected: false, kind: 'monster' }));
    expect(p({ self: false, selected: false, kind: 'npc', role: 'legend' })).toBeLessThan(p({ self: false, selected: false, kind: 'npc', role: 'villager' }));
    // nameless townsfolk come after everyone with a name
    expect(p({ self: false, selected: false, kind: 'npc', role: 'villager' })).toBeLessThan(p({ self: false, selected: false, kind: 'ambient', role: 'villager' }));
  });

  it('caps the count per frame, keeping the important and the near ones', () => {
    const crowd = Array.from({ length: 60 }, (_, i) => ({ id: i, priority: 5, dist: 100 - i }));
    const vip = { id: 999, priority: 0, dist: 500 };
    const picked = pickGhosts([...crowd, vip]);
    expect(picked).toHaveLength(MAX_GHOSTS);
    expect(picked[0]).toBe(vip);
    // among the crowd the nearest (largest i here) win
    expect(picked.slice(1).every((c) => c.dist <= 100 - (60 - MAX_GHOSTS))).toBe(true);
    const few = crowd.slice(0, 5);
    expect(pickGhosts(few)).toBe(few);
    expect(pickGhosts(crowd, 3).map((c) => c.id)).toEqual([59, 58, 57]);
  });

  it('tints by who it is', () => {
    const tints = new Set([
      ghostTint({ self: true, kind: 'player' }),
      ghostTint({ self: false, kind: 'monster' }),
      ghostTint({ self: false, kind: 'player' }),
      ghostTint({ self: false, kind: 'npc', role: 'legend' }),
      ghostTint({ self: false, kind: 'npc', role: 'master' }),
      ghostTint({ self: false, kind: 'npc', role: 'guard' }),
      ghostTint({ self: false, kind: 'npc', role: 'villager' }),
    ]);
    expect(tints.size).toBe(7);
    for (const t of tints) expect(t).toMatch(/^#[0-9a-f]{6}$/);
  });
});

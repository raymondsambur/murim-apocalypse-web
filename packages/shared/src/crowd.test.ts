import { describe, expect, it } from 'vitest';
import { AMBIENT_LOOKS, RESIDENTS, ambientLook, ambientQuota, crowdHourFactor, crowdMap, residentTarget, residentsOf } from './crowd';
import { LOOK_RANGES } from './types';
import { generateWorld } from './worldgen';
import { isPassable } from './worldgrid';

describe('residents', () => {
  it('hits the on-screen targets at the settlement base population', () => {
    expect(residentTarget('hamlet', 90, 90)).toBe(12);
    expect(residentTarget('village', 220, 220)).toBeGreaterThanOrEqual(25);
    expect(residentTarget('village', 220, 220)).toBeLessThanOrEqual(35);
    expect(residentTarget('town', 600, 600)).toBeGreaterThanOrEqual(60);
    expect(residentTarget('town', 600, 600)).toBeLessThanOrEqual(80);
  });

  it('follows the sim population and is capped at its growth limit', () => {
    expect(residentTarget('town', 300, 600)).toBe(35);
    expect(residentTarget('town', 6000, 600)).toBe(Math.round(RESIDENTS.town * 1.6));
    expect(residentTarget('town', 0, 600)).toBe(0);
    expect(residentTarget('ruin', 100, 100)).toBe(0);
  });

  it('never reports fewer people than the named ones living there', () => {
    expect(residentsOf('hamlet', 10, 90, 10)).toBe(10);
    expect(residentsOf('fort', 332, 320, 30)).toBeGreaterThanOrEqual(30);
    expect(ambientQuota(70, 27)).toBe(43);
    expect(ambientQuota(20, 27)).toBe(0);
  });
});

describe('crowd hours', () => {
  it('is full by day, thin at night, and smooth between whole hours', () => {
    expect(crowdHourFactor(12)).toBe(1);
    expect(crowdHourFactor(2)).toBeLessThan(0.1);
    expect(crowdHourFactor(6.5)).toBeGreaterThan(crowdHourFactor(6));
    expect(crowdHourFactor(6.5)).toBeLessThan(crowdHourFactor(7));
    expect(crowdHourFactor(24 + 12)).toBe(1);
    expect(crowdHourFactor(-1)).toBeCloseTo(crowdHourFactor(23), 5);
  });
});

describe('ambient looks', () => {
  it('are a small, valid, distinct set', () => {
    const seen = new Set<string>();
    for (let v = 0; v < AMBIENT_LOOKS; v++) {
      const l = ambientLook(v);
      expect(l.skin).toBeLessThan(LOOK_RANGES.skin);
      expect(l.hairStyle).toBeLessThan(LOOK_RANGES.hairStyle);
      expect(l.hairColor).toBeLessThan(LOOK_RANGES.hairColor);
      expect(l.outfit).toBeLessThan(LOOK_RANGES.outfit);
      expect(l.outfitColor).toBeLessThan(LOOK_RANGES.outfitColor);
      expect(l.sashColor).toBeLessThan(LOOK_RANGES.sashColor);
      expect(l.accessory).toBe(0);
      seen.add(JSON.stringify(l));
    }
    expect(seen.size).toBe(AMBIENT_LOOKS);
    expect(ambientLook(AMBIENT_LOOKS + 3)).toEqual(ambientLook(3));
    expect(ambientLook(-1)).toEqual(ambientLook(AMBIENT_LOOKS - 1));
  });
});

describe('crowd map', () => {
  it('gives every living settlement homes and spots a person can stand on', () => {
    for (const seed of [1337, 7, 42]) {
      const world = generateWorld(seed);
      for (const s of world.settlements) {
        if (s.kind === 'ruin') continue;
        const map = crowdMap(world, s);
        expect(map.homes.length, `${s.name} homes`).toBeGreaterThanOrEqual(s.kind === 'fort' ? 3 : 4);
        expect(map.spots.length, `${s.name} spots`).toBeGreaterThan(5);
        for (const h of map.homes) expect(isPassable(world, h.x, h.y), `${s.name} home door ${h.x},${h.y}`).toBe(true);
        expect(map.spots.some((p) => p.kind === 'plaza'), `${s.name} plaza`).toBe(true);
        expect(map.spots.some((p) => p.kind === 'gate')).toBe(true);
      }
    }
  });
});

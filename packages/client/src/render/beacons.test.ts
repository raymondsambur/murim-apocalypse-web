import { describe, expect, it } from 'vitest';
import { BEACON_FAR, BEACON_NEAR, BEACON_PRIORITY, BEACON_ZOOM_FULL, BEACON_ZOOM_MIN, PULSE_MS, beaconAlpha, declutter, intersects, pulseState } from './beacons';

describe('beacon alpha', () => {
  it('is full close to the centre and fades to nothing at the far edge', () => {
    expect(beaconAlpha(0, 1.5)).toBe(1);
    expect(beaconAlpha(BEACON_NEAR, 1.5)).toBe(1);
    expect(beaconAlpha(BEACON_FAR, 1.5)).toBe(0);
    expect(beaconAlpha(BEACON_FAR + 30, 1.5)).toBe(0);
    let prev = 1;
    for (let d = BEACON_NEAR; d <= BEACON_FAR; d += 2) {
      const a = beaconAlpha(d, 1.5);
      expect(a).toBeLessThanOrEqual(prev + 1e-9);
      prev = a;
    }
    expect(beaconAlpha((BEACON_NEAR + BEACON_FAR) / 2, 1.5)).toBeCloseTo(0.5, 5);
  });

  it('disappears when zoomed far out and is full from the default zoom of a phone', () => {
    expect(beaconAlpha(0, BEACON_ZOOM_MIN)).toBe(0);
    expect(beaconAlpha(0, 0.5)).toBe(0);
    expect(beaconAlpha(0, BEACON_ZOOM_FULL)).toBe(1);
    expect(beaconAlpha(0, 0.75)).toBe(1);
    expect(beaconAlpha(0, 0.65)).toBeGreaterThan(0);
    expect(beaconAlpha(0, 0.65)).toBeLessThan(1);
  });
});

describe('pulse', () => {
  it('runs for a few seconds after it starts', () => {
    expect(pulseState(undefined, 1000).active).toBe(false);
    expect(pulseState(1000, 1000)).toEqual({ active: true, k: 0 });
    expect(pulseState(1000, 1000 + PULSE_MS / 2).k).toBeCloseTo(0.5, 5);
    expect(pulseState(1000, 1000 + PULSE_MS).active).toBe(false);
    expect(pulseState(1000, 500).active).toBe(false);
    expect(PULSE_MS).toBeGreaterThanOrEqual(3000);
  });
});

describe('de-cluttering', () => {
  const r = (x: number, y: number) => ({ x, y, w: 20, h: 30 });

  it('detects overlap', () => {
    expect(intersects(r(0, 0), r(10, 10))).toBe(true);
    expect(intersects(r(0, 0), r(20, 0))).toBe(false);
    expect(intersects(r(0, 0), r(0, 30))).toBe(false);
  });

  it('keeps the first of two overlapping beacons and every separate one', () => {
    expect(declutter([{ rect: r(0, 0) }, { rect: r(5, 5) }, { rect: r(40, 0) }])).toEqual([true, false, true]);
  });

  it('always keeps a forced (pulsing) beacon, even on top of another', () => {
    expect(declutter([{ rect: r(0, 0) }, { rect: r(5, 5), force: true }, { rect: r(8, 8) }])).toEqual([true, true, false]);
  });

  it('ranks the shrine and the hermitage above the market and the gate', () => {
    expect(BEACON_PRIORITY.shrine).toBeLessThan(BEACON_PRIORITY.market);
    expect(BEACON_PRIORITY.hermitage).toBeLessThan(BEACON_PRIORITY.inn);
    expect(BEACON_PRIORITY.gate).toBeGreaterThan(BEACON_PRIORITY.alchemy);
  });
});

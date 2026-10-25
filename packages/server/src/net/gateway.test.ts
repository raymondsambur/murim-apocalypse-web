import { describe, expect, it } from 'vitest';
import { MAX_STRIKES, STRIKE_DECAY_MS, Strikes } from './gateway';

describe('Strikes', () => {
  it('trips after MAX_STRIKES in a burst', () => {
    const s = new Strikes();
    const results = Array.from({ length: MAX_STRIKES }, () => s.add(1000));
    expect(results.slice(0, -1).every((r) => !r)).toBe(true);
    expect(results.at(-1)).toBe(true);
  });

  it('forgives one strike per decay interval, so occasional mistakes never add up', () => {
    const s = new Strikes();
    let t = 0;
    for (let i = 0; i < 200; i++) {
      t += STRIKE_DECAY_MS * 1.1;
      expect(s.add(t)).toBe(false);
    }
  });

  it('a slow drip faster than the decay still trips eventually', () => {
    const s = new Strikes();
    let t = 0;
    let tripped = false;
    for (let i = 0; i < 100 && !tripped; i++) {
      t += STRIKE_DECAY_MS / 4;
      tripped = s.add(t);
    }
    expect(tripped).toBe(true);
  });
});

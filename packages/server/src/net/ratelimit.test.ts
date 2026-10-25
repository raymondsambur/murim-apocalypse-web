import { describe, expect, it } from 'vitest';
import { TokenBucket, WindowLimiter } from './ratelimit';

describe('TokenBucket', () => {
  it('allows a burst, then the sustained rate', () => {
    const b = new TokenBucket(40, 80, 0);
    let ok = 0;
    for (let i = 0; i < 100; i++) if (b.take(0)) ok++;
    expect(ok).toBe(80);
    expect(b.take(0)).toBe(false);
    // 25 ms later one token is back (40/s).
    expect(b.take(25)).toBe(true);
    expect(b.take(25)).toBe(false);
    // Long idle never exceeds the burst.
    expect(b.available(1_000_000)).toBe(80);
  });

  it('tolerates a clock that goes backwards', () => {
    const b = new TokenBucket(1, 2, 1000);
    expect(b.take(500)).toBe(true);
    expect(b.take(500)).toBe(true);
    expect(b.take(500)).toBe(false);
  });
});

describe('WindowLimiter', () => {
  it('limits per key per window and reports retry time', () => {
    const l = new WindowLimiter(3, 1000);
    expect([1, 2, 3].map(() => l.hit('a', 0).ok)).toEqual([true, true, true]);
    const r = l.hit('a', 100);
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBe(900);
    expect(l.hit('b', 100).ok).toBe(true);
    expect(l.hit('a', 1000).ok).toBe(true);
  });

  it('bounds memory under a flood of distinct keys', () => {
    const l = new WindowLimiter(5, 60000, 100);
    for (let i = 0; i < 5000; i++) l.hit(`ip${i}`, i);
    expect(l.size).toBeLessThanOrEqual(200);
  });

  it('sweeps expired windows', () => {
    const l = new WindowLimiter(5, 1000);
    for (let i = 0; i < 50; i++) l.hit(`k${i}`, 0);
    l.hit('late', 5000);
    expect(l.size).toBe(1);
  });
});

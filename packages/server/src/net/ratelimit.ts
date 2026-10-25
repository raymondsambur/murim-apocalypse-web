/** In-memory rate limiters. Time is always passed in so they are trivially testable. */

/** Classic token bucket: `burst` capacity, refilled at `ratePerSec`. */
export class TokenBucket {
  private tokens: number;
  private last: number;

  constructor(
    readonly ratePerSec: number,
    readonly burst: number,
    now: number,
  ) {
    this.tokens = burst;
    this.last = now;
  }

  private refill(now: number): void {
    const dt = Math.max(0, now - this.last);
    this.last = now;
    this.tokens = Math.min(this.burst, this.tokens + (dt * this.ratePerSec) / 1000);
  }

  /** Take `n` tokens if available. */
  take(now: number, n = 1): boolean {
    this.refill(now);
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }

  available(now: number): number {
    this.refill(now);
    return this.tokens;
  }
}

export interface LimitResult {
  ok: boolean;
  /** Milliseconds until the key may try again (0 when ok). */
  retryAfterMs: number;
  remaining: number;
}

/**
 * Fixed-window counter per key (e.g. per IP): at most `limit` hits per `windowMs`.
 * Memory is bounded: expired windows are swept lazily and the map is capped at `maxKeys`.
 */
export class WindowLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();
  private lastSweep = 0;

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    readonly maxKeys = 50000,
  ) {}

  hit(key: string, now: number): LimitResult {
    this.maybeSweep(now);
    let w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      w = { start: now, count: 0 };
      this.windows.delete(key);
      this.windows.set(key, w);
    }
    w.count++;
    if (w.count > this.limit) return { ok: false, retryAfterMs: Math.max(1, w.start + this.windowMs - now), remaining: 0 };
    return { ok: true, retryAfterMs: 0, remaining: this.limit - w.count };
  }

  get size(): number {
    return this.windows.size;
  }

  sweep(now: number): void {
    this.lastSweep = now;
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
    // Still too many live keys (flood from many addresses): drop the oldest windows.
    if (this.windows.size > this.maxKeys) {
      let excess = this.windows.size - this.maxKeys;
      for (const k of this.windows.keys()) {
        if (excess-- <= 0) break;
        this.windows.delete(k);
      }
    }
  }

  private maybeSweep(now: number): void {
    if (now - this.lastSweep >= this.windowMs || this.windows.size > this.maxKeys) this.sweep(now);
  }
}

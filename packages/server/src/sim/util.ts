/** Small helpers shared by the simulation modules. */
import type { SettlementState, SimEvent } from '@murim/shared';
import type { Ctx, Stamp } from './types';

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const round1 = (v: number): number => Math.round(v * 10) / 10;

export function emit(ctx: Ctx, e: SimEvent): void {
  ctx.events.push(e);
}

/** Order-independent key for a pair of faction ids. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

export function settlementName(ctx: Ctx, id: number): string {
  return ctx.S.defs[id]?.name ?? `settlement ${id}`;
}

export function settlement(ctx: Ctx, id: number): SettlementState {
  return ctx.st.settlements[id];
}

export function isLiving(s: SettlementState): boolean {
  return s.status !== 'fallen';
}

export function besieged(ctx: Ctx, s: SettlementState): boolean {
  return s.siegeUntil > ctx.st.clock.totalHours;
}

export function hasFlag(s: SettlementState, f: string): boolean {
  return s.flags.includes(f);
}

export function setFlag(s: SettlementState, f: string, on: boolean): boolean {
  const i = s.flags.indexOf(f);
  if (on && i < 0) {
    s.flags.push(f);
    s.flags.sort();
    return true;
  }
  if (!on && i >= 0) {
    s.flags.splice(i, 1);
    return true;
  }
  return false;
}

/**
 * Disc stamp around (cx, cy). Weight 1 at the centre falling to 0 at radius r with the given
 * exponent; only cells accepted by `ok` are kept.
 */
export function makeStamp(w: number, h: number, cx: number, cy: number, r: number, pow: number, ok: (i: number) => boolean): Stamp {
  const idx: number[] = [];
  const wt: number[] = [];
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= h) continue;
    for (let dx = -R; dx <= R; dx++) {
      const x = cx + dx;
      if (x < 0 || x >= w) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > r) continue;
      const i = y * w + x;
      if (!ok(i)) continue;
      idx.push(i);
      wt.push(Math.pow(1 - d / (r + 1), pow));
    }
  }
  return { idx: Int32Array.from(idx), wt: Float32Array.from(wt) };
}

/** Uint8Array -> base64 (Node). */
export function toBase64(a: Uint8Array): string {
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength).toString('base64');
}

export function fromBase64(s: string, n: number): Uint8Array {
  const buf = Buffer.from(s, 'base64');
  const out = new Uint8Array(n);
  out.set(buf.subarray(0, n));
  return out;
}

/** Deterministic pick from a list using a hash value (does not consume the sim Rng). */
export function hashPick<T>(arr: readonly T[], h: number): T {
  return arr[h % arr.length];
}

export function sum(a: number[]): number {
  let s = 0;
  for (const v of a) s += v;
  return s;
}

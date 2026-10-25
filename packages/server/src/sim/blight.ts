/**
 * The Blight: a byte grid (0..255) over the world.
 *
 * Each hour, on passable land only: diffusion toward the neighbour mean, proportional + constant
 * decay, emission from active hearts (pulsing, flaring) and fallen settlements, and suppression
 * around living settlements scaled by their defense and status. Season and weather scale emission
 * up and decay down (summer +20%, winter -40%, rain -25%). Values are integers; fractional updates
 * use a deterministic per-hour dither so the grid alone is the whole state.
 */
import { fbm, hash32, type BlightHeart, type SettlementStatus } from '@murim/shared';
import { BLIGHT } from './constants';
import { chron } from './chronicle';
import { dayOf, seasonOf } from './clock';
import type { Ctx } from './types';
import { clamp, emit, makeStamp, settlementName } from './util';
import { bandOfY } from './weather';

const STATUS_SUPPRESS: Record<SettlementStatus, number> = { thriving: 1.1, stable: 1, struggling: 0.85, besieged: 0.7, fallen: 0 };

export function initHearts(ctx: Ctx): BlightHeart[] {
  return ctx.world.nodes
    .filter((n) => n.kind === 'heart')
    .map((n) => ({ id: n.id, x: n.x, y: n.y, strength: ctx.rng.int(72, 90), sealedUntil: 0 }));
}

export function heartActive(h: BlightHeart, now: number): boolean {
  return h.strength > 0 && h.sealedUntil <= now;
}

/** Initial field: dense around the hearts, light over the ruin, broken up with noise. */
export function initBlight(ctx: Ctx): void {
  const { S, st, world } = ctx;
  const B = st.blight;
  const ruin = S.ruinId >= 0 ? S.defs[S.ruinId] : null;
  const R = BLIGHT.initRadius;
  for (let y = 0; y < S.h; y++) {
    for (let x = 0; x < S.w; x++) {
      const i = y * S.w + x;
      if (!S.land[i]) continue;
      let v = 0;
      for (const h of st.hearts) {
        const d = Math.hypot(x - h.x, y - h.y);
        if (d < R) v = Math.max(v, BLIGHT.initPeak * Math.pow(1 - d / R, 1.4));
      }
      if (ruin) {
        const rr = ruin.radius + 10;
        const d = Math.hypot(x - ruin.x, y - ruin.y);
        if (d < rr) v = Math.max(v, BLIGHT.initRuinPeak * (1 - d / rr));
      }
      if (v <= 0) continue;
      v *= 0.75 + 0.5 * fbm(x / 6, y / 6, world.seed + 313, 3);
      B[i] = clamp(Math.round(v), 0, 255);
    }
  }
}

/** Growth multiplier per climate band for the current hour (season x weather). */
export function growthMult(ctx: Ctx): [number, number, number] {
  const season = seasonOf(dayOf(ctx.st.clock.totalHours));
  const s = BLIGHT.season[season];
  const w = ctx.st.weather;
  return [s * BLIGHT.weather[w[0].kind], s * BLIGHT.weather[w[1].kind], s * BLIGHT.weather[w[2].kind]];
}

function heartPulse(h: BlightHeart, now: number): number {
  const span = BLIGHT.pulsePeriod[1] - BLIGHT.pulsePeriod[0];
  const period = BLIGHT.pulsePeriod[0] + (Math.imul(h.id, 7919) >>> 0) % (span + 1);
  return 1 + BLIGHT.pulseAmp * Math.sin((2 * Math.PI * now) / (24 * period) + h.id * 2.399);
}

/** Per-heart emission stamps, built lazily (hearts never move). */
const heartStamps = new WeakMap<object, Map<number, ReturnType<typeof makeStamp>>>();
function heartStamp(ctx: Ctx, h: BlightHeart) {
  let m = heartStamps.get(ctx.S);
  if (!m) {
    m = new Map();
    heartStamps.set(ctx.S, m);
  }
  let s = m.get(h.id);
  if (!s) {
    s = makeStamp(ctx.S.w, ctx.S.h, h.x, h.y, BLIGHT.heartRadius, 1, (i) => ctx.S.land[i] === 1);
    m.set(h.id, s);
  }
  return s;
}

/** Changed-tile test used for events (bucket change or zero crossing). */
function changed(a: number, b: number): boolean {
  return a >> BLIGHT.bucketShift !== b >> BLIGHT.bucketShift || (a === 0) !== (b === 0);
}

export function emitBlight(ctx: Ctx, idx: number[]): void {
  if (idx.length === 0) return;
  emit(ctx, { k: 'blight', idx });
}

/** One world hour of Blight. */
export function blightHour(ctx: Ctx): void {
  const { S, st } = ctx;
  const B = st.blight;
  const prev = S.prev;
  const src = S.src;
  const now = st.clock.totalHours;
  const w = S.w;
  const h = S.h;
  const land = S.land;
  prev.set(B);
  src.fill(0);
  const g = growthMult(ctx);

  // Sources: hearts.
  for (const heart of st.hearts) {
    if (!heartActive(heart, now)) continue;
    const flare = (st.ext.heartFlare[heart.id] ?? 0) > now ? BLIGHT.flareMult : 1;
    const e = BLIGHT.heartEmit * (heart.strength / 100) * heartPulse(heart, now) * flare * g[bandOfY(ctx, heart.y)];
    const s = heartStamp(ctx, heart);
    for (let k = 0; k < s.idx.length; k++) src[s.idx[k]] += e * s.wt[k];
  }
  // Fallen settlements breed Blight; living ones push it back.
  for (const set of st.settlements) {
    const def = S.defs[set.id];
    const band = g[bandOfY(ctx, def.y)];
    if (set.status === 'fallen') {
      let e: number;
      if (set.id === S.ruinId) e = BLIGHT.ruinEmit * band;
      else {
        const days = (now - (st.ext.fallenAt[set.id] ?? now)) / 24;
        e = BLIGHT.fallenEmit * Math.max(0, 1 - days / BLIGHT.fallenFadeDays) * band;
      }
      if (e <= 0) continue;
      const s = S.fallen[set.id];
      for (let k = 0; k < s.idx.length; k++) src[s.idx[k]] += e * s.wt[k];
    } else {
      const sup = BLIGHT.suppress * (set.defense / 100) * STATUS_SUPPRESS[set.status];
      if (sup <= 0) continue;
      const s = S.suppress[set.id];
      for (let k = 0; k < s.idx.length; k++) src[s.idx[k]] -= sup * s.wt[k];
    }
  }

  const D = BLIGHT.diffusion;
  const kBand = [BLIGHT.decayRate / g[0], BLIGHT.decayRate / g[1], BLIGHT.decayRate / g[2]];
  const cBand = [BLIGHT.decayConst / g[0], BLIGHT.decayConst / g[1], BLIGHT.decayConst / g[2]];
  let rs = hash32(st.seed, now, 0xb119) | 0;
  const out: number[] = [];
  for (let y = 0; y < h; y++) {
    const band = S.rowBand[y];
    const kd = kBand[band];
    const cd = cBand[band];
    const row = y * w;
    for (let x = 0; x < w; x++) {
      const i = row + x;
      rs = (Math.imul(rs, 1664525) + 1013904223) | 0;
      if (!land[i]) continue;
      const v = prev[i];
      let sumN = 0;
      let n = 0;
      if (x > 0 && land[i - 1]) { sumN += prev[i - 1]; n++; }
      if (x < w - 1 && land[i + 1]) { sumN += prev[i + 1]; n++; }
      if (y > 0 && land[i - w]) { sumN += prev[i - w]; n++; }
      if (y < h - 1 && land[i + w]) { sumN += prev[i + w]; n++; }
      const s = src[i];
      if (v === 0 && sumN === 0 && s <= 0) continue;
      let xv = n > 0 ? v + D * (sumN / n - v) : v;
      if (xv > 0) xv -= xv * kd + cd;
      xv += s;
      let r: number;
      if (xv <= 0 || (v === 0 && xv < 0.5)) r = 0;
      else {
        r = Math.floor(xv + ((rs >>> 8) / 16777216));
        if (r > 255) r = 255;
      }
      if (r !== v) {
        B[i] = r;
        if (changed(v, r)) out.push(i);
      }
    }
  }
  emitBlight(ctx, out);
}

/** Lower Blight in a disc; returns changed (reportable) tile indices. */
export function purifyArea(ctx: Ctx, x: number, y: number, radius: number, amount: number): number[] {
  const { S, st } = ctx;
  const B = st.blight;
  const out: number[] = [];
  if (amount <= 0 || radius < 0) return out;
  const R = Math.ceil(radius);
  const cx = Math.round(x);
  const cy = Math.round(y);
  for (let dy = -R; dy <= R; dy++) {
    const yy = cy + dy;
    if (yy < 0 || yy >= S.h) continue;
    for (let dx = -R; dx <= R; dx++) {
      const xx = cx + dx;
      if (xx < 0 || xx >= S.w) continue;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) continue;
      const i = yy * S.w + xx;
      const v = B[i];
      if (v === 0) continue;
      const r = Math.max(0, Math.round(v - amount * (1 - d / (radius + 1))));
      if (r === v) continue;
      B[i] = r;
      if (changed(v, r)) out.push(i);
    }
  }
  return out;
}

/** Centre-weighted mean Blight around a settlement. */
export function settlementBlight(ctx: Ctx, sid: number): number {
  const s = ctx.S.avg[sid];
  const B = ctx.st.blight;
  let a = 0;
  let wsum = 0;
  for (let k = 0; k < s.idx.length; k++) {
    a += B[s.idx[k]] * s.wt[k];
    wsum += s.wt[k];
  }
  return wsum > 0 ? a / wsum : 0;
}

export function nearestSettlementName(ctx: Ctx, x: number, y: number): string {
  let best = 0;
  let bd = Infinity;
  for (const d of ctx.S.defs) {
    const dd = Math.hypot(d.x - x, d.y - y);
    if (dd < bd) {
      bd = dd;
      best = d.id;
    }
  }
  return settlementName(ctx, best);
}

/** Hourly: seals that expire wake their heart. */
export function heartsHourly(ctx: Ctx): void {
  const now = ctx.st.clock.totalHours;
  for (const h of ctx.st.hearts) {
    if (h.strength === 0 && h.sealedUntil > 0 && h.sealedUntil <= now) {
      h.strength = Math.max(h.strength, BLIGHT.heartRestart);
      emit(ctx, { k: 'heart', id: h.id, active: true });
      chron(ctx, 'blight', `The sealed Blight heart near ${nearestSettlementName(ctx, h.x, h.y)} stirs again.`, 2, { key: `wake:${h.id}`, cooldown: 24 });
    }
  }
}

/** Daily: hearts regrow and sometimes flare. */
export function heartsDaily(ctx: Ctx): void {
  const now = ctx.st.clock.totalHours;
  const season = seasonOf(dayOf(now));
  const regen = BLIGHT.heartRegen * [1, 1.3, 1, 0.5][season];
  for (const h of ctx.st.hearts) {
    if (!heartActive(h, now)) continue;
    h.strength = Math.min(100, h.strength + regen);
    if (ctx.rng.chance(BLIGHT.flareChance)) {
      ctx.st.ext.heartFlare[h.id] = now + ctx.rng.int(24, 48);
      chron(ctx, 'blight', `The Blight heart near ${nearestSettlementName(ctx, h.x, h.y)} convulses; black mist rolls across the land.`, 1, { key: 'flare', cooldown: 24 * 7 });
    }
  }
}

export function damageHeartImpl(ctx: Ctx, heartId: number, amount: number, playerName: string): void {
  const now = ctx.st.clock.totalHours;
  const h = ctx.st.hearts.find((x) => x.id === heartId);
  if (!h || !heartActive(h, now) || !(amount > 0)) return;
  const near = nearestSettlementName(ctx, h.x, h.y);
  h.strength = Math.max(0, h.strength - amount);
  if (h.strength <= 0) {
    h.strength = 0;
    h.sealedUntil = now + ctx.rng.int(BLIGHT.sealDays[0], BLIGHT.sealDays[1]) * 24;
    delete ctx.st.ext.heartFlare[h.id];
    emit(ctx, { k: 'heart', id: h.id, active: false });
    emitBlight(ctx, purifyArea(ctx, h.x, h.y, 7, 90));
    ctx.st.ext.stats.heartsSealed = (ctx.st.ext.stats.heartsSealed ?? 0) + 1;
    chron(ctx, 'blight', `The Blight heart near ${near} was sealed by ${playerName}!`, 3, { force: true });
  } else {
    emitBlight(ctx, purifyArea(ctx, h.x, h.y, 4, 30));
    chron(ctx, 'blight', `${playerName} wounded the Blight heart near ${near}.`, 2, { key: `wound:${h.id}`, cooldown: 12, force: true });
  }
}

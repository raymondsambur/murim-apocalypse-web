/**
 * Settlement: given a player's running activity and `now`, grant exactly what accrued since `settled`
 * (never past `since + OFFLINE_CAP_MS`). Idempotent: a second call at the same `now` grants nothing.
 * It does not end the activity itself; it reports why it should end (`ended`) and `finishActivity` does the rest.
 */
import {
  ITEMS,
  JOB_DEFS,
  JOB_MAX_LEVEL,
  RECIPES,
  applyJobXp,
  deriveForCharacter,
  getItem,
  isBreakthroughLevel,
  rollAffixes,
  rollRarity,
  xpToNext,
  MAX_LEVEL,
  type CharacterSave,
  type ItemStack,
  type WorkSiteDef,
  type WorldData,
} from '@murim/shared';
import type { GameContext, Player } from '../../ctx';
import { addGold, addItem, freeSlots, grantXp, roomFor, xpMultiplier } from '../lib';
import { emptyReport, type EndReason, type Report } from './report';
import { CHUNK_MS, DOJO_TRAIN_MULT, capReached, craftUnits, jobXpMultiplier, settleEnd, shiftOutput, takeWhole, trainXpPerHour } from './rules';

const siteCache = new WeakMap<WorldData, Map<string, WorkSiteDef>>();
export function siteIndex(world: WorldData): Map<string, WorkSiteDef> {
  let m = siteCache.get(world);
  if (!m) {
    m = new Map();
    for (const s of world.settlements) for (const site of s.sites) m.set(site.id, site);
    siteCache.set(world, m);
  }
  return m;
}

/** Cumulative cultivation XP of a save (sum of finished stages plus the bar), to measure real gains. */
export function totalXp(save: Pick<CharacterSave, 'level' | 'xp'>): number {
  let t = save.xp;
  for (let l = 1; l < save.level; l++) t += xpToNext(l);
  return t;
}

/** True when the XP bar is full at a stage that needs a Breakthrough (or the level cap). */
export function barFull(save: Pick<CharacterSave, 'level' | 'xp'>): boolean {
  return (save.level >= MAX_LEVEL || isBreakthroughLevel(save.level)) && save.xp >= xpToNext(save.level);
}

export interface SettleResult {
  report: Report;
  /** Set when the activity can no longer continue. */
  ended: EndReason | null;
}

function seasonNow(ctx: GameContext): number {
  try {
    const s = ctx.sim.clock().season;
    return Number.isFinite(s) ? s : 0;
  } catch {
    return 0;
  }
}

export function settle(ctx: GameContext, p: Player, now: number): SettleResult {
  const a = p.save.activity;
  const report = emptyReport();
  if (!a) return { report, ended: null };
  report.kind = a.kind;
  if (a.settled < a.since) a.settled = a.since;
  const end = settleEnd(a, now);
  let ended: EndReason | null = null;
  const before = a.settled;
  const carry = (a.carry ??= {});

  if (a.kind === 'train') {
    const site = siteIndex(ctx.world).get(a.site);
    if (!site) ended = 'invalid';
    else if (end > a.settled) {
      const t = deriveForCharacter(p.save, now).total;
      const perHour = trainXpPerHour(t.insight, t.spirit, site.kind === 'dojo' ? DOJO_TRAIN_MULT : 1);
      const whole = takeWhole(carry, 'xp', (perHour * (end - a.settled)) / 3_600_000 * xpMultiplier(ctx, p));
      a.settled = end;
      if (whole > 0) {
        const t0 = totalXp(p.save);
        const res = grantXp(ctx, p, whole, { raw: true });
        report.xp += totalXp(p.save) - t0;
        report.levels += res.levelsGained;
      }
    }
    if (!ended && barFull(p.save)) ended = 'xpfull';
  } else if (a.kind === 'shift') {
    const def = JOB_DEFS[a.job];
    const site = siteIndex(ctx.world).get(a.site);
    if (!def || def.mode !== 'gather' || !site || site.kind !== def.site) ended = 'invalid';
    else {
      const season = seasonNow(ctx);
      const mult = jobXpMultiplier(p.save.talents, p.save.origin, a.job);
      while (a.settled < end) {
        const chunkEnd = Math.min(a.settled + CHUNK_MS, end);
        const out = shiftOutput(a.job, p.save.jobs[a.job].lv, season, chunkEnd - a.settled);
        const gold = takeWhole(carry, 'gold', out.gold);
        if (gold > 0) {
          addGold(p.save, gold);
          report.gold += gold;
        }
        if (p.save.jobs[a.job].lv < JOB_MAX_LEVEL) {
          const jx = takeWhole(carry, 'jxp', out.xp * mult);
          if (jx > 0) {
            if (applyJobXp(p.save, a.job, jx) > 0) report.jobLevels[a.job] = p.save.jobs[a.job].lv;
            report.jobXp[a.job] = (report.jobXp[a.job] ?? 0) + jx;
          }
        }
        let full = false;
        for (const [id, n] of out.items) {
          const q = takeWhole(carry, `i:${id}`, n);
          if (q <= 0) continue;
          const added = addItem(p.save, { id, qty: q });
          if (added > 0) report.items[id] = (report.items[id] ?? 0) + added;
          if (added < q) {
            report.lost[id] = (report.lost[id] ?? 0) + (q - added);
            full = true;
          }
        }
        a.settled = chunkEnd;
        if (full) {
          ended = 'bag';
          break;
        }
      }
    }
  } else if (a.kind === 'craft') {
    const recipe = RECIPES[a.recipe];
    const site = siteIndex(ctx.world).get(a.site);
    if (!recipe || !site || site.kind !== JOB_DEFS[recipe.job].site || !(a.remaining >= 0)) ended = 'invalid';
    else {
      const unitMs = recipe.seconds * 1000;
      const n = craftUnits(end - a.settled, recipe.seconds, a.remaining);
      const mult = jobXpMultiplier(p.save.talents, p.save.origin, recipe.job);
      const [outId, outQty] = recipe.output;
      for (let i = 0; i < n; i++) {
        const lv = p.save.jobs[recipe.job].lv;
        const stacks: ItemStack[] = [];
        if (recipe.gear) {
          const fortune = deriveForCharacter(p.save, now).total.fortune;
          for (let k = 0; k < outQty; k++) {
            const r = rollRarity(ctx.rng, fortune, Math.floor(lv / 6));
            stacks.push({ id: outId, qty: 1, r, aff: rollAffixes(ctx.rng, ITEMS[outId]?.tier ?? 1, r) });
          }
        } else stacks.push({ id: outId, qty: outQty });
        const fits = recipe.gear ? freeSlots(p.save) >= stacks.length : roomFor(p.save, outId) >= outQty;
        if (!fits || !getItem(outId)) {
          ended = 'bag';
          break;
        }
        for (const s of stacks) report.items[outId] = (report.items[outId] ?? 0) + addItem(p.save, s);
        a.remaining--;
        a.settled += unitMs;
        if (p.save.jobs[recipe.job].lv < JOB_MAX_LEVEL) {
          const jx = takeWhole(carry, 'jxp', recipe.xp * mult);
          if (jx > 0) {
            if (applyJobXp(p.save, recipe.job, jx) > 0) report.jobLevels[recipe.job] = p.save.jobs[recipe.job].lv;
            report.jobXp[recipe.job] = (report.jobXp[recipe.job] ?? 0) + jx;
          }
        }
      }
      if (!ended && a.remaining <= 0) ended = 'done';
    }
  } else ended = 'invalid';

  report.ms = Math.max(0, a.settled - before);
  if (!ended && capReached(a, now)) ended = 'cap';
  if (report.ms > 0 || report.gold > 0 || Object.keys(report.items).length > 0 || report.xp > 0) {
    ctx.markDirty(p);
    ctx.markMe(p);
  }
  report.ended = ended ?? undefined;
  return { report, ended };
}

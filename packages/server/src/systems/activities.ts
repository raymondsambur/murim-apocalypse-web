/**
 * Activities: training, work shifts and crafting that keep running while the player is offline.
 * Owner: gameplay-activities. Rules: docs/GAMEPLAY_SPEC.md section 8; notes: docs/notes/gameplay-activities.md.
 *
 * State lives in `p.save.activity` (`since` / `settled` timestamps). Output is settled lazily by
 * `activities/settle.ts` on login, every 60 s, `astop`, a move and when a fight starts.
 */
import {
  ITEMS,
  JOB_DEFS,
  OFFLINE_CAP_MS,
  RECIPES,
  RECIPE_LIST,
  INVENTORY_SLOTS,
  type Activity,
  type JobId,
  type RecipeView,
  type SiteView,
  type WorkSiteDef,
} from '@murim/shared';
import { GameError, type GameContext, type Player } from '../ctx';
import { addItem, countItem, removeItem, roomFor } from './lib';
import { describeGains, describeLost, emptyReport, END_TEXT, fmtDuration, hasGains, mergeReport, type EndReason, type Report } from './activities/report';
import {
  CRAFT_CANCEL_GRACE_MS,
  CRAFT_RANGE,
  DOJO_RANGE,
  DOJO_TRAIN_MULT,
  MAX_CRAFT_QTY,
  SETTLE_EVERY_MS,
  SHIFT_RANGE,
  maxCraftQty,
} from './activities/rules';
import { barFull, settle, siteIndex } from './activities/settle';

export * from './activities/rules';
export { barFull, settle, siteIndex, totalXp } from './activities/settle';
export type { EndReason, Report } from './activities/report';

const MOVE_FAILURES = {
  blocked: 'You cannot go there.',
  unreachable: 'There is no way to get there.',
  too_far: 'That is too far; travel in shorter hops.',
} as const;
const MIN_REPORT_MS = 120_000;
const START_COOLDOWN_MS = 1000;
const WALK_REQUESTS_PER_SEC = 8;

export interface ActivitiesApi {
  /** Settle a running activity now (no-op without one). Returns what was granted. */
  settle(p: Player): Report;
  /** Settle, then end the activity (refunding unstarted craft units). No-op without one. */
  interrupt(p: Player, reason: EndReason): Report;
  /** Players with a running activity (online and offline workers). */
  activeCount(): number;
}

const registry = new WeakMap<GameContext, ActivitiesApi>();
/** The activities API of a context (undefined when the module is not registered). */
export function getActivities(ctx: GameContext): ActivitiesApi | undefined {
  return registry.get(ctx);
}
/** Convenience for other systems: end the player's activity because of `reason` (e.g. 'combat'). */
export function interruptActivity(ctx: GameContext, p: Player, reason: EndReason = 'combat'): void {
  registry.get(ctx)?.interrupt(p, reason);
}

function siteJob(kind: WorkSiteDef['kind']): JobId | undefined {
  return (Object.values(JOB_DEFS).find((j) => j.site === kind) ?? undefined)?.id;
}

export function register(ctx: GameContext): void {
  ctx.db.migrateModule('activities', ['CREATE TABLE activity_away (char_id INTEGER PRIMARY KEY, json TEXT NOT NULL, updated_at INTEGER NOT NULL)']);
  const sites = siteIndex(ctx.world);
  const active = new Set<Player>();

  // ---- away reports (what offline workers earned, shown at the next login) -------------------
  const awayCache = new Map<number, Report>();
  const awayDirty = new Set<number>();
  const loadAway = (charId: number): Report | undefined => {
    const hit = awayCache.get(charId);
    if (hit) return hit;
    const row = ctx.db.get<{ json: string }>('SELECT json FROM activity_away WHERE char_id = ?', charId);
    if (!row) return undefined;
    try {
      const r = { ...emptyReport(), ...(JSON.parse(row.json) as Report) };
      awayCache.set(charId, r);
      return r;
    } catch {
      return undefined;
    }
  };
  const addAway = (charId: number, r: Report): void => {
    const cur = loadAway(charId) ?? emptyReport();
    mergeReport(cur, r);
    awayCache.set(charId, cur);
    awayDirty.add(charId);
  };
  const takeAway = (charId: number): Report | undefined => {
    const r = loadAway(charId);
    awayCache.delete(charId);
    awayDirty.delete(charId);
    if (r) ctx.db.run('DELETE FROM activity_away WHERE char_id = ?', charId);
    return r;
  };
  ctx.onSave((p) => {
    if (!awayDirty.has(p.charId)) return;
    const r = awayCache.get(p.charId);
    awayDirty.delete(p.charId);
    awayCache.delete(p.charId);
    if (r) ctx.db.run('INSERT OR REPLACE INTO activity_away (char_id, json, updated_at) VALUES (?, ?, ?)', p.charId, JSON.stringify(r), ctx.now());
  });

  // ---- ending ----------------------------------------------------------------------------
  /** Return the inputs of unstarted craft units and clear the activity. */
  const finish = (p: Player, reason: EndReason, report: Report, silent = false): void => {
    const a = p.save.activity;
    if (!a) return;
    if (a.kind === 'craft' && a.remaining > 0) {
      const recipe = RECIPES[a.recipe];
      if (recipe) {
        // A player-chosen stop forfeits the unit being worked on (after a short grace); system ends refund everything.
        const playerStop = reason === 'stopped' || reason === 'moved' || reason === 'combat' || reason === 'dead';
        const forfeit = playerStop && ctx.now() - a.settled > CRAFT_CANCEL_GRACE_MS ? 1 : 0;
        const units = Math.max(0, a.remaining - forfeit);
        for (const [id, n] of recipe.inputs) {
          const qty = n * units;
          if (qty <= 0) continue;
          const added = addItem(p.save, { id, qty });
          if (added > 0) report.refunded[id] = (report.refunded[id] ?? 0) + added;
          if (added < qty) report.lost[id] = (report.lost[id] ?? 0) + (qty - added);
        }
      }
    }
    p.save.activity = null;
    active.delete(p);
    report.ended = reason;
    const e = p.entity;
    if (!e.move && (e.state === 'work' || e.state === 'meditate' || e.state === 'craft')) {
      e.state = 'idle';
      ctx.entities.touch(e);
    }
    ctx.markDirty(p);
    // Offline: remember for the next login before markMe saves and drops the idle worker.
    if (!p.online) addAway(p.charId, report);
    else if (!silent) announce(p, report);
    ctx.markMe(p);
  };

  /** Tell an online player what a settle/end produced (only the notable parts). */
  const announce = (p: Player, r: Report): void => {
    for (const [job, lv] of Object.entries(r.jobLevels)) ctx.notify(p, 'good', `Your ${JOB_DEFS[job as JobId].name} skill rose to level ${lv}.`);
    if (r.kind === 'craft' && Object.keys(r.items).length) ctx.notify(p, 'info', `Crafted: ${describeGains({ ...emptyReport(), items: r.items })}.`);
    const lost = describeLost(r);
    if (lost) ctx.notify(p, 'warn', lost);
    if (r.ended && r.ended !== 'stopped' && r.ended !== 'moved') ctx.notify(p, r.ended === 'done' ? 'good' : 'warn', END_TEXT[r.ended]);
  };

  const run = (p: Player, stopReason?: EndReason): Report => {
    if (!p.save.activity) return emptyReport();
    const now = ctx.now();
    const { report, ended } = settle(ctx, p, now);
    const why = ended ?? stopReason;
    if (why) finish(p, why, report);
    else {
      if (!p.online) addAway(p.charId, report);
      else announce(p, report);
    }
    return report;
  };

  const api: ActivitiesApi = {
    settle: (p) => run(p),
    interrupt: (p, reason) => run(p, reason),
    activeCount: () => active.size,
  };
  registry.set(ctx, api);

  // ---- helpers ---------------------------------------------------------------------------
  const guardStart = (p: Player): void => {
    if (p.entity.state === 'dead') throw new GameError('dead', 'You cannot do that while dead.');
    if (p.combatId !== null) throw new GameError('in_combat', 'You cannot do that while fighting.');
    if (p.save.activity) throw new GameError('busy', 'You are already busy. Stop what you are doing first.');
    const last = (p.data.actStart as number | undefined) ?? 0;
    if (ctx.now() - last < START_COOLDOWN_MS) throw new GameError('slow_down', 'Slow down a little.');
    p.data.actStart = ctx.now();
  };
  const near = (p: Player, s: WorkSiteDef, range: number): boolean => Math.hypot(p.entity.x - s.x, p.entity.y - s.y) <= range;

  const missing = (p: Player, inputs: [string, number][], qty: number): string | null => {
    for (const [id, n] of inputs) {
      const have = countItem(p.save, id);
      if (have < n * qty) return `You need ${n * qty}x ${ITEMS[id]?.name ?? id} (you have ${have}).`;
    }
    return null;
  };
  /** Would `qty` finished units fit in the bag once their inputs are used up? */
  const outputFits = (p: Player, recipeId: string, qty: number): boolean => {
    const r = RECIPES[recipeId];
    const sim = { inventory: p.save.inventory.map((s) => ({ ...s })) } as Player['save'];
    for (const [id, n] of r.inputs) removeItem(sim, id, n * qty);
    const [outId, outQty] = r.output;
    return r.gear ? sim.inventory.length + qty * outQty <= INVENTORY_SLOTS : roomFor(sim, outId) >= qty * outQty;
  };

  const begin = (p: Player, a: Activity): void => {
    p.save.activity = a;
    active.add(p);
    const e = p.entity;
    e.state = a.kind === 'train' ? 'meditate' : a.kind === 'craft' ? 'craft' : 'work';
    ctx.entities.touch(e);
    ctx.markDirty(p);
    ctx.markMe(p);
  };

  // ---- commands ---------------------------------------------------------------------------
  ctx.command('astart', (p, m) => {
    guardStart(p);
    ctx.movement.stop(p.entity, true);
    const now = ctx.now();
    const site = sites.get(m.site);
    if (!site) throw new GameError('no_site', 'There is no such place.');
    const settlement = ctx.world.settlements[site.settlementId];

    if (m.kind === 'train') {
      if (site.kind === 'dojo') {
        if (!near(p, site, DOJO_RANGE)) throw new GameError('too_far', 'Walk up to the dojo first.');
      } else if (!settlement || Math.hypot(p.entity.x - settlement.x, p.entity.y - settlement.y) > settlement.radius) {
        throw new GameError('too_far', 'You can only train inside a settlement.');
      }
      if (barFull(p.save)) throw new GameError('xp_full', 'Your cultivation is at its limit. Seek a Breakthrough first.');
      begin(p, { kind: 'train', since: now, settled: now, site: site.id, carry: {} });
      ctx.notify(p, 'info', site.kind === 'dojo' ? 'You settle down to train at the dojo (x1.5 experience).' : 'You sit down to meditate.');
    } else if (m.kind === 'shift') {
      const def = JOB_DEFS[m.job];
      if (!def) throw new GameError('bad_job', 'Unknown trade.');
      if (def.mode !== 'gather') throw new GameError('bad_job', `${def.name}s work by crafting, not by shifts.`);
      if (site.kind !== def.site) throw new GameError('wrong_site', `A ${def.name} cannot work here.`);
      if (!near(p, site, SHIFT_RANGE)) throw new GameError('too_far', 'Walk up to the work site first.');
      const first = (def.id === 'miner' ? 'ore_iron' : def.id === 'farmer' ? 'grain' : 'herb');
      if (roomFor(p.save, first) < 1) throw new GameError('bag_full', 'Your bag is full. Make some room first.');
      begin(p, { kind: 'shift', job: def.id, since: now, settled: now, site: site.id, carry: {} });
      ctx.notify(p, 'info', `You begin a ${def.name} shift.`);
    } else {
      const recipe = RECIPES[m.recipe];
      if (!recipe) throw new GameError('no_recipe', 'Unknown recipe.');
      if (site.kind !== JOB_DEFS[recipe.job].site) throw new GameError('wrong_site', 'That cannot be made here.');
      if (!Number.isInteger(m.qty) || m.qty < 1 || m.qty > MAX_CRAFT_QTY) throw new GameError('bad_qty', `You can craft 1-${MAX_CRAFT_QTY} at a time.`);
      const lim = maxCraftQty(recipe.seconds);
      if (m.qty > lim) throw new GameError('too_long', `That batch would exceed the ${OFFLINE_CAP_MS / 3_600_000}-hour work limit; craft at most ${lim}.`);
      if (p.save.jobs[recipe.job].lv < recipe.level) throw new GameError('low_level', `Requires ${JOB_DEFS[recipe.job].name} level ${recipe.level}.`);
      if (!near(p, site, CRAFT_RANGE)) throw new GameError('too_far', 'Walk up to the workshop first.');
      const lack = missing(p, recipe.inputs, m.qty);
      if (lack) throw new GameError('no_materials', lack);
      if (!outputFits(p, recipe.id, m.qty)) throw new GameError('bag_full', 'Your bag does not have room for the finished goods. Make some room first.');
      for (const [id, n] of recipe.inputs) removeItem(p.save, id, n * m.qty);
      begin(p, { kind: 'craft', recipe: recipe.id, remaining: m.qty, since: now, settled: now, site: site.id, carry: {} });
      ctx.notify(p, 'info', `You begin crafting ${m.qty}x ${recipe.name}.`);
    }
  });

  ctx.command('astop', (p) => {
    if (!p.save.activity) throw new GameError('idle', 'You are not doing anything.');
    const r = run(p, 'stopped');
    const gains = describeGains(r);
    ctx.notify(p, 'info', gains ? `You stop. Since the last update: ${gains}.` : END_TEXT.stopped);
  });

  // Moving ends the activity (after settling). Same validation as the core `move`.
  const buckets = new WeakMap<Player, { tokens: number; at: number }>();
  ctx.command(
    'move',
    (p, m) => {
      const now = ctx.now();
      const b = buckets.get(p) ?? { tokens: WALK_REQUESTS_PER_SEC + 2, at: now };
      b.tokens = Math.min(WALK_REQUESTS_PER_SEC + 2, b.tokens + ((now - b.at) / 1000) * WALK_REQUESTS_PER_SEC);
      b.at = now;
      buckets.set(p, b);
      if (b.tokens < 1) throw new GameError('slow_down', 'Slow down a little.');
      b.tokens -= 1;
      const reason = ctx.movement.canMove(p);
      if (reason) throw new GameError('cannot_move', reason);
      const r = ctx.movement.moveTo(p.entity, m.x, m.y);
      if (!r.ok) throw new GameError(r.reason, MOVE_FAILURES[r.reason]);
      if (p.save.activity && r.steps > 0) run(p, 'moved');
    },
    { override: true },
  );
  // The default guard refuses all movement while busy; walking away now simply ends the activity.
  const probe = { combatId: null, save: { activity: { kind: 'train' } }, entity: { state: 'idle' } } as unknown as Player;
  const guards = ctx.movement.guards;
  for (let i = guards.length - 1; i >= 0; i--) {
    let r: string | null = null;
    try {
      r = guards[i](probe);
    } catch {
      /* not the activity guard */
    }
    if (r && /busy/i.test(r)) guards.splice(i, 1);
  }

  // ---- periodic work -----------------------------------------------------------------------
  const reconcile = (): void => {
    for (const p of ctx.players.all()) if (p.save.activity) active.add(p);
  };
  const settleAll = (): void => {
    reconcile();
    for (const p of [...active]) {
      if (!p.save.activity || ctx.players.byCharId(p.charId) !== p) {
        active.delete(p);
        continue;
      }
      run(p);
    }
  };
  ctx.every(SETTLE_EVERY_MS, settleAll);
  ctx.after(0, settleAll); // workers restored at boot
  ctx.onShutdown(settleAll);

  // Fights, death and walking (e.g. via interact) end the activity.
  ctx.every(250, () => {
    for (const p of [...active]) {
      if (!p.online || !p.save.activity) continue;
      if (p.combatId !== null) run(p, 'combat');
      else if (p.entity.state === 'dead') run(p, 'dead');
      else if (p.entity.move) run(p, 'moved');
    }
  });

  ctx.onLogin((p) => {
    const away = takeAway(p.charId);
    let report = away ?? emptyReport();
    if (p.save.activity) {
      active.add(p);
      const { report: r, ended } = settle(ctx, p, ctx.now());
      mergeReport(report, r);
      if (ended) finish(p, ended, report, true);
    }
    const ended = report.ended;
    const gains = describeGains(report);
    if (gains && (report.ms >= MIN_REPORT_MS || ended)) {
      ctx.notify(p, 'good', `While you were away (${fmtDuration(report.ms)} of ${report.kind === 'train' ? 'training' : report.kind === 'craft' ? 'crafting' : 'work'}): ${gains}.`);
    }
    const lost = describeLost(report);
    if (lost) ctx.notify(p, 'warn', lost);
    if (ended && (gains || ended !== 'stopped')) ctx.notify(p, ended === 'done' ? 'good' : 'warn', END_TEXT[ended]);
  });

  // ---- queries -----------------------------------------------------------------------------
  ctx.query('sites', (_p, args) => {
    const s = ctx.world.settlements[args.settlement];
    if (!s || !Number.isInteger(args.settlement)) throw new GameError('not_found', 'No such settlement.');
    return s.sites.map((w): SiteView => {
      const v: SiteView = { id: w.id, kind: w.kind, x: w.x, y: w.y, settlementId: w.settlementId };
      const job = siteJob(w.kind);
      if (job) v.job = job;
      if (w.kind === 'dojo') v.trainBonus = DOJO_TRAIN_MULT;
      return v;
    });
  });

  ctx.query('recipes', (p, args) => {
    const site = sites.get(String(args.site));
    if (!site) throw new GameError('not_found', 'No such place.');
    const job = siteJob(site.kind);
    if (!job || JOB_DEFS[job].mode !== 'craft') return [];
    const busy = p.save.activity ? 'You are busy.' : p.combatId !== null ? 'You are fighting.' : null;
    const far = near(p, site, CRAFT_RANGE) ? null : 'Walk up to the workshop first.';
    return RECIPE_LIST.filter((r) => r.job === job).map((r): RecipeView => {
      const reason =
        busy ??
        (p.save.jobs[r.job].lv < r.level ? `Requires ${JOB_DEFS[r.job].name} level ${r.level}.` : null) ??
        far ??
        missing(p, r.inputs, 1) ??
        (outputFits(p, r.id, 1) ? null : 'Your bag is full.');
      const v: RecipeView = { id: r.id, name: r.name, job: r.job, level: r.level, inputs: r.inputs, output: r.output, seconds: r.seconds, canCraft: !reason };
      if (reason) v.reason = reason;
      return v;
    });
  });
}

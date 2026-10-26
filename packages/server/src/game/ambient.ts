/**
 * Ambient townsfolk: the second population tier. Nameless people who live in a settlement beyond its named NPCs and
 * exist only while a player is near: they step out of the houses, walk between the plaza, the market, the inn, the
 * shrine and the gates by the hour, and go indoors at night, when the settlement is besieged or when nobody is watching.
 * They have no memory, no dialogue and no persistence, wear one of a small set of looks (`shared/crowd.ts`) and use the
 * ordinary entity pipeline, so clients draw them like any other person.
 *
 * Head-count: `ambientQuota(population shown, named alive) * hour factor`, scaled down together when the world-wide cap
 * (`AMBIENT_GLOBAL_CAP`) would be passed. The settlement view's population is what the sim reports for the same
 * settlement (`residentsOf`), so the figure on the world panel is the number of people who live there.
 */
import {
  AMBIENT_GLOBAL_CAP,
  AMBIENT_LOOKS,
  AMBIENT_WATCH_MARGIN,
  ambientLook,
  ambientQuota,
  crowdHourFactor,
  crowdMap,
  dist,
  nearestWalkable,
  spotMood,
  type CrowdMap,
  type PathGrid,
  type Rng,
  type SettlementDef,
  type WorldData,
} from '@murim/shared';
import { AMBIENT_DATA, type AmbientEntityData, type Entity, type Player } from '../ctx';
import type { Sim } from '../sim/api';
import type { EntityStoreImpl } from './entities';
import type { Logger } from './log';
import type { Movement } from './movement';

export const AMBIENT_TUNING = {
  /** How often the head-counts are reconciled (ms). */
  planEveryMs: 500,
  /** Entities created or sent indoors per settlement per reconciliation: the crowd trickles in and out. */
  spawnPerPlan: 2,
  leavePerPlan: 2,
  /** A watched settlement keeps its crowd this long after the last player went away (ms). */
  graceMs: 15000,
  /** Pause at a destination (ms). */
  pauseMin: 5000,
  pauseMax: 22000,
  /** Walking speed (NPCs walk at 0.55). */
  speedMin: 0.46,
  speedMax: 0.6,
  /** Doors tried when spawning: the one farthest from every player wins. */
  spawnTries: 6,
} as const;

interface Crowd {
  def: SettlementDef;
  map: CrowdMap;
  members: Set<Entity>;
  lastWatched: number;
  /** Head-count wanted at the last plan. */
  want: number;
}

export interface AmbientDeps {
  world: WorldData;
  grid: PathGrid;
  sim: Sim;
  entities: EntityStoreImpl;
  movement: Movement;
  players: { online(): Player[] };
  rng: Rng;
  log: Logger;
  now: () => number;
}

export interface AmbientStats {
  entities: number;
  watched: number;
  /** Wall-clock ms spent in the last `tick` that did work, and the worst so far. */
  lastMs: number;
  maxMs: number;
}

export class AmbientManager {
  /** World-wide ceiling on ambient entities (tests and tools may lower it, 0 switches the crowd off). */
  cap: number = AMBIENT_GLOBAL_CAP;
  private readonly crowds: Crowd[] = [];
  private readonly byId = new Map<number, Crowd>();
  private lastPlan = 0;
  private order: Entity[] = [];
  private cursor = 0;
  private statWatched = 0;
  private statLast = 0;
  private statMax = 0;

  constructor(private readonly d: AmbientDeps) {
    for (const def of d.world.settlements) {
      if (def.kind === 'ruin') continue;
      const raw = crowdMap(d.world, def);
      // keep only tiles a person can stand on
      const fix = <T extends { x: number; y: number }>(t: T): T | null => {
        const p = nearestWalkable(d.grid, t.x, t.y, 2);
        return p ? { ...t, x: p.x, y: p.y } : null;
      };
      const map: CrowdMap = { homes: raw.homes.map(fix).filter((t): t is { x: number; y: number } => t !== null), spots: raw.spots.map(fix).filter((t): t is CrowdMap['spots'][number] => t !== null) };
      const c: Crowd = { def, map, members: new Set(), lastWatched: -Infinity, want: 0 };
      this.crowds.push(c);
      this.byId.set(def.id, c);
    }
    d.entities.onRemove((e) => {
      const data = AMBIENT_DATA.get(e);
      if (data) this.byId.get(data.settlementId)?.members.delete(e);
    });
  }

  get count(): number {
    return this.d.entities.count('ambient');
  }

  stats(): AmbientStats {
    return { entities: this.count, watched: this.statWatched, lastMs: this.statLast, maxMs: this.statMax };
  }

  /** The ambient entities of a settlement (tests and tools). */
  membersOf(sid: number): Entity[] {
    return [...(this.byId.get(sid)?.members ?? [])];
  }

  /** Head-count the settlement wants at this moment (0 when nobody is watching). */
  wantOf(sid: number): number {
    return this.byId.get(sid)?.want ?? 0;
  }

  tick(now: number, ticksPerSecond = 10): void {
    if (this.crowds.length === 0) return;
    const t0 = performance.now();
    let worked = false;
    if (now - this.lastPlan >= AMBIENT_TUNING.planEveryMs) {
      this.lastPlan = now;
      this.plan(now);
      worked = true;
    }
    const n = this.order.length;
    if (n > 0) {
      const budget = Math.min(n, Math.ceil(n / ticksPerSecond));
      for (let i = 0; i < budget; i++) {
        if (this.cursor >= n) this.cursor = 0;
        const e = this.order[this.cursor++];
        if (e && this.d.entities.has(e.id)) this.step(e, now);
      }
      worked = true;
    }
    if (worked) {
      this.statLast = performance.now() - t0;
      if (this.statLast > this.statMax) this.statMax = this.statLast;
    }
  }

  // ---- head-counts -----------------------------------------------------------------------------------------------

  private plan(now: number): void {
    const { sim, entities } = this.d;
    const online = this.d.players.online().filter((p) => p.online);
    const hour = sim.timeView(now).hours;
    const factor = crowdHourFactor(hour);
    // wanted head-count per watched settlement
    const wants: { c: Crowd; want: number }[] = [];
    this.statWatched = 0;
    for (const c of this.crowds) {
      let nearest = Infinity;
      for (const p of online) nearest = Math.min(nearest, dist(p.entity.x, p.entity.y, c.def.x, c.def.y));
      const watched = nearest <= c.def.radius + AMBIENT_WATCH_MARGIN;
      if (watched) {
        c.lastWatched = now;
        this.statWatched++;
      }
      if (!watched && now - c.lastWatched > AMBIENT_TUNING.graceMs) {
        c.want = 0;
        if (c.members.size > 0) for (const e of [...c.members]) entities.remove(e);
        continue;
      }
      // inside the grace period the crowd carries on as it is
      if (!watched) continue;
      let want = 0;
      const view = sim.settlementView(c.def.id);
      if (!view.siege && view.status !== 'fallen' && view.status !== 'besieged') {
        const named = sim.npcs(c.def.id).length;
        want = Math.round(ambientQuota(view.population, named) * factor);
      }
      wants.push({ c, want });
    }
    // world-wide cap: scale every watched settlement down together
    const total = wants.reduce((a, w) => a + w.want, 0);
    if (total > this.cap) {
      const k = this.cap / total;
      for (const w of wants) w.want = Math.floor(w.want * k);
    }
    let changed = false;
    for (const { c, want } of wants) {
      c.want = want;
      const have = c.members.size;
      if (have < want) {
        for (let i = 0; i < AMBIENT_TUNING.spawnPerPlan && c.members.size < want; i++) {
          if (this.spawn(c, online, now)) changed = true;
        }
      } else if (have > want) {
        let sent = 0;
        for (const e of c.members) {
          if (sent >= AMBIENT_TUNING.leavePerPlan || have - sent <= want) break;
          const data = AMBIENT_DATA.get(e);
          if (!data || data.leaving) continue;
          this.sendIndoors(c, e, data, now);
          sent++;
        }
      }
    }
    if (changed || this.order.length !== this.count) {
      this.order = entities.ofKind('ambient');
      this.cursor = 0;
    }
  }

  // ---- individuals -----------------------------------------------------------------------------------------------

  private spawn(c: Crowd, online: Player[], now: number): boolean {
    if (c.map.homes.length === 0) return false;
    const { rng } = this.d;
    // the door farthest from every player: townsfolk step out of sight when they can
    let best = c.map.homes[0];
    let bestD = -1;
    for (let i = 0; i < AMBIENT_TUNING.spawnTries; i++) {
      const h = c.map.homes[rng.int(0, c.map.homes.length - 1)];
      let near = Infinity;
      for (const p of online) near = Math.min(near, dist(p.entity.x, p.entity.y, h.x, h.y));
      if (near > bestD) {
        bestD = near;
        best = h;
      }
    }
    const variant = rng.int(0, AMBIENT_LOOKS - 1);
    const data: AmbientEntityData = { settlementId: c.def.id, variant, nextAt: now + rng.int(0, 4000), leaving: false };
    const e = this.d.entities.create({
      kind: 'ambient',
      name: '',
      x: best.x,
      y: best.y,
      face: rng.int(0, 3) as 0 | 1 | 2 | 3,
      speed: AMBIENT_TUNING.speedMin + rng.next() * (AMBIENT_TUNING.speedMax - AMBIENT_TUNING.speedMin),
      look: ambientLook(variant),
      role: 'villager',
      data: { [AMBIENT_DATA.name]: data },
    });
    c.members.add(e);
    return true;
  }

  private sendIndoors(c: Crowd, e: Entity, data: AmbientEntityData, now: number): void {
    data.leaving = true;
    if (c.map.homes.length === 0) {
      this.d.entities.remove(e);
      return;
    }
    let best = c.map.homes[0];
    let bestD = Infinity;
    for (const h of c.map.homes) {
      const dd = dist(e.x, e.y, h.x, h.y);
      if (dd < bestD) {
        bestD = dd;
        best = h;
      }
    }
    if (bestD <= 1.5) {
      this.d.entities.remove(e);
      return;
    }
    this.walk(c, e, data, best.x, best.y, now);
  }

  /** Start a walk; if there is no path, a leaver simply vanishes and anyone else tries again later. */
  private walk(c: Crowd, e: Entity, data: AmbientEntityData, tx: number, ty: number, now: number): void {
    const r = this.d.movement.moveTo(e, tx, ty, {
      snap: 0,
      maxSteps: c.def.radius * 4,
      maxNodes: 900,
      onArrive: (ent, result) => {
        if (result === 'removed') return;
        if (data.leaving) {
          if (result === 'arrived') this.d.entities.remove(ent);
          return;
        }
        data.nextAt = this.d.now() + this.d.rng.int(AMBIENT_TUNING.pauseMin, AMBIENT_TUNING.pauseMax);
      },
    });
    if (!r.ok) {
      if (data.leaving) this.d.entities.remove(e);
      else data.nextAt = now + this.d.rng.int(2000, 6000);
    }
  }

  private step(e: Entity, now: number): void {
    const data = AMBIENT_DATA.get(e);
    if (!data || e.move || now < data.nextAt) return;
    const c = this.byId.get(data.settlementId);
    if (!c) return;
    if (data.leaving) {
      this.sendIndoors(c, e, data, now);
      return;
    }
    const { rng } = this.d;
    data.nextAt = now + rng.int(AMBIENT_TUNING.pauseMin, AMBIENT_TUNING.pauseMax);
    if (rng.chance(0.25)) {
      e.face = rng.int(0, 3) as 0 | 1 | 2 | 3;
      this.d.entities.touch(e);
      return;
    }
    const dest = this.pickSpot(c, e, this.d.sim.timeView(now).hours);
    if (!dest || (dest.x === e.x && dest.y === e.y)) return;
    // a little scatter so a crowd at one spot does not stand on one tile
    const tx = dest.x + rng.int(-1, 1);
    const ty = dest.y + rng.int(-1, 1);
    this.walk(c, e, data, nearestWalkable(this.d.grid, tx, ty, 1)?.x ?? dest.x, nearestWalkable(this.d.grid, tx, ty, 1)?.y ?? dest.y, now);
  }

  private pickSpot(c: Crowd, e: Entity, hour: number): { x: number; y: number } | null {
    const { rng } = this.d;
    let total = 0;
    const w: number[] = [];
    for (const s of c.map.spots) {
      const near = 1 / (1 + dist(e.x, e.y, s.x, s.y) / 12);
      const v = s.weight * spotMood(s.kind, hour) * near;
      w.push(v);
      total += v;
    }
    if (total <= 0) return null;
    let r = rng.next() * total;
    for (let i = 0; i < w.length; i++) {
      r -= w[i];
      if (r <= 0) return c.map.spots[i];
    }
    return c.map.spots[c.map.spots.length - 1] ?? null;
  }
}

/**
 * One visible battle at a besieged settlement: a war party marches along the road to the gate, the guards (cloned
 * from the sim's NPCs) and militia run out to meet it, and the two sides trade abstract blows (`skirmish.ts`) while
 * the battle is steered by the sim's own odds (`outcome.ts`). When the sim rolls the real result, the finale plays it
 * out: raiders rout and the town cheers, or the defence breaks and the raiders sack the plaza.
 *
 * Raiders are real `monster` entities of the monster module (so players can fight them with the normal combat
 * engine, `monsterKilled` carries `siege`, rewards and `sim.recordKill` work). Defenders are `npc` entities without
 * sim state: the guard / master / villager they are cloned from is hidden and given back to its routine at the end.
 */
import { MONSTERS, dist, isPassable, type CombatEvent, type Dir, type NpcAct, type Point, type SimEvent } from '@murim/shared';
import type { Entity, GameContext, Player } from '../ctx';
import { FACTION_BY_ID } from '@murim/shared';
import type { NpcLifeApi } from '../npclife';
import { getCombatApi } from '../systems/combat/api';
import type { MonsterKilledEvent } from '../systems/events';
import { MONSTER, type MonsterApi } from '../systems/monsters/state';
import { defenderSlots, faceFor, holdPoint, lineSlots, columnSpots, placesOf, planApproach, plazaSpots, refugeFor, type Approach } from './geometry';
import { classifyEnd, holdChance, momentum, raidersWon, wallBonus, type Outcome, type SettlementSnapshot } from './outcome';
import { familyOf, planDefenders, planParty, type DefenderPlan, type RaiderPlan } from './party';
import { defenderHp, partySize, pickFoe, strike } from './skirmish';
import { SIEGE_TUNING as T } from './tuning';
import { isLive, Unit } from './unit';

export type BattlePhase = 'march' | 'melee' | 'lull' | 'finale' | 'done';

export interface BattleDeps {
  ctx: GameContext;
  mon: MonsterApi;
  life: NpcLifeApi;
}

export interface BattleStats {
  waves: number;
  raidersSpawned: number;
  raidersKilledByDefenders: number;
  raidersKilledByPlayers: number;
  raidersRouted: number;
  defendersFallen: number;
  tilt: number;
  blows: number;
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const SIGHT = 40;

const DEF_SKILL = { sword: 'sword_basic', blade: 'blade_wild', spear: 'spear_pierce', staff: 'staff_thunder', fist: 'fist_iron' } as const;
const DEF_SHOUTS = ['Hold the gate!', 'Shields up! They come!', 'For our homes!', 'Stand firm!', 'Sound the alarm!'];
const RAID_SHOUTS = ['Break the gates!', 'Burn it all down!', 'No mercy!', 'Take the town!'];
const WIN_SHOUTS = ['They are running! We held!', 'The gate stands!'];
const LOSS_SHOUTS = ['The gate is breached!', 'Fall back!', 'Run for your lives!'];

export class Battle {
  readonly sid: number;
  readonly by: string;
  readonly name: string;
  phase: BattlePhase = 'march';
  waveNo = 0;
  /** The current (or last) wave is the one the sim's end will find at the gate. */
  final = false;
  outcome: Outcome | null = null;
  att: Unit[] = [];
  def: Unit[] = [];
  readonly stats: BattleStats = { waves: 0, raidersSpawned: 0, raidersKilledByDefenders: 0, raidersKilledByPlayers: 0, raidersRouted: 0, defendersFallen: 0, tilt: 0, blows: 0 };
  /** Last-known settlement state, to tell what the sim's roll did. */
  snapshot: SettlementSnapshot;
  pHold = 0.5;
  bias = 0;
  lastNearAt: number;
  startedAt: number;

  private readonly ctx: GameContext;
  private readonly mon: MonsterApi;
  private readonly life: NpcLifeApi;
  private approach: Approach | null = null;
  /** Where the defenders hold (just inside the gate). */
  private hold: Point = { x: 0, y: 0 };
  private waveStartedAt = 0;
  private waveSize = 0;
  private meleeStartedAt = 0;
  private nextWaveAt = 0;
  private finaleAt = 0;
  private collapseAt = 0;
  private peakStrength = 0;
  private events: CombatEvent[] = [];
  private lastShoutAt = -1e9;
  private lastBeatAt = -1e9;
  private lastAlertAt = -1e9;
  private readonly alerted = new Set<number>();
  private rot = 0;
  private budget = 0;
  private started = false;
  private breached = false;
  private readonly occ = new Map<number, number>();

  constructor(deps: BattleDeps, sid: number, by: string, now: number) {
    this.ctx = deps.ctx;
    this.mon = deps.mon;
    this.life = deps.life;
    this.sid = sid;
    this.by = by;
    this.name = deps.ctx.world.settlements[sid]?.name ?? `settlement ${sid}`;
    const st = deps.ctx.sim.state.settlements[sid];
    this.snapshot = { controller: st?.controller ?? null, status: st?.status ?? 'stable' };
    this.lastNearAt = now;
    this.startedAt = now;
  }

  // ------------------------------------------------------------------ queries

  get gate(): Point {
    return this.approach?.gate.door ?? { x: this.ctx.world.settlements[this.sid].x, y: this.ctx.world.settlements[this.sid].y };
  }

  liveRaiders(): Unit[] {
    return this.att.filter((u) => isLive(u) && u.mode !== 'flee');
  }
  liveDefenders(): Unit[] {
    return this.def.filter((u) => isLive(u) && u.mode !== 'flee');
  }
  /** Entities of this battle that exist right now (for tests and diagnostics). */
  entities(): Entity[] {
    return [...this.att, ...this.def].map((u) => u.ent).filter((e) => this.ctx.entities.has(e.id));
  }

  /** Real ms before the sim rolls the outcome, from the siege end hour and the fraction of the current hour. */
  hoursLeft(now: number): number {
    const sim = this.ctx.sim;
    const s = sim.state.settlements[this.sid];
    if (!s) return 0;
    const clk = sim.clock();
    let frac = 0;
    try {
      frac = clamp(sim.timeView(now).hours - clk.hour, 0, 0.999);
    } catch {
      frac = 0;
    }
    if (!Number.isFinite(frac)) frac = 0;
    return s.siegeUntil - clk.totalHours - frac;
  }

  private refresh(): void {
    const s = this.ctx.sim.state.settlements[this.sid];
    if (!s) return;
    if (s.siegeUntil > 0) {
      this.peakStrength = Math.max(this.peakStrength, s.siegeStrength);
      this.pHold = holdChance(s.defense, wallBonus(this.ctx.world.settlements[this.sid].kind), s.siegeStrength);
      this.snapshot = { controller: s.controller, status: s.status };
    }
    const m = momentum(this.pHold);
    if (this.phase === 'finale') this.bias = raidersWon(this.outcome ?? 'held') ? -0.9 : 0.9;
    else if (this.final) this.bias = clamp(m, -T.finalBiasMax, T.finalBiasMax);
    else this.bias = clamp(T.waveBias + T.waveBiasK * m, T.waveBiasRange[0], T.waveBiasRange[1]);
  }

  // ------------------------------------------------------------------ start

  /** Plan the approach, call up the defenders and send the first wave. False when the settlement cannot host a battle. */
  start(now: number): boolean {
    if (this.started) return true;
    const ctx = this.ctx;
    const ap = planApproach(ctx, this.sid, this.by, (n) => ctx.rng.int(0, Math.max(0, n - 1)));
    if (!ap) return false;
    this.approach = ap;
    this.hold = holdPoint(ctx, ap);
    this.started = true;
    this.refresh();
    this.mobilize(now);
    const left = this.hoursLeft(now);
    const late = left < T.lateJoinHours;
    this.final = left <= T.finalLeadHours;
    this.spawnWave(now, late);
    return true;
  }

  // ------------------------------------------------------------------ defenders

  private mobilize(now: number): void {
    const ctx = this.ctx;
    const s = ctx.sim.state.settlements[this.sid];
    const units = partySize(s?.siegeStrength ?? 30);
    const plans = planDefenders(ctx, this.sid, units, s?.defense ?? 30, s?.siegeStrength ?? 30);
    let flagged = false;
    for (const p of plans) {
      if (this.def.length >= T.unitCap / 2) break;
      const u = this.makeDefender(p, now);
      if (!u) continue;
      if (!flagged && p.kind === 'guard') {
        u.ent.flag = 1;
        ctx.entities.touch(u.ent);
        flagged = true;
      }
      this.def.push(u);
    }
  }

  private makeDefender(p: DefenderPlan, now: number): Unit | null {
    const ctx = this.ctx;
    const n = p.npc;
    this.life.seize(n.id);
    ctx.movement.stop(p.orig, true);
    const maxHp = defenderHp(n.level, p.hpMult);
    const e = ctx.entities.create({
      kind: 'npc',
      name: n.name,
      x: p.orig.x,
      y: p.orig.y,
      face: p.orig.face,
      speed: 1,
      look: n.look,
      role: p.role,
      lv: n.level,
      tag: n.title || undefined,
      faction: n.faction ?? undefined,
      hp: maxHp,
      maxHp,
      weapon: p.weapon,
      gear: p.gear,
      side: 'def',
      act: 'patrol',
    });
    p.orig.hidden = true;
    ctx.entities.touch(p.orig);
    const u = new Unit('def', e, p.kind, p.power, p.toughness, n.id);
    u.since = now;
    u.skill = DEF_SKILL[p.weapon ?? 'fist'];
    return u;
  }

  /** Defenders run to their line in front of the gate (those standing there already stay alert). */
  private sortie(now: number): void {
    const ap = this.approach;
    if (!ap) return;
    const ready = this.def.filter((u) => u.mode === 'idle' || u.mode === 'cheer');
    const slots = defenderSlots(this.ctx, ap, Math.max(1, ready.length));
    ready.forEach((u, i) => {
      u.slot = slots[i] ?? slots[0];
      u.mode = 'idle';
      u.ordered = false;
      u.target = null;
      this.setAct(u, 'patrol');
      u.since = now;
    });
  }

  // ------------------------------------------------------------------ the war party

  private spawnWave(now: number, late: boolean, quiet = false): void {
    const ctx = this.ctx;
    const ap = this.approach;
    const s = ctx.sim.state.settlements[this.sid];
    if (!ap || !s) return;
    this.waveNo++;
    this.stats.waves++;
    const strength = Math.max(s.siegeStrength, this.final ? this.peakStrength * 0.6 : 0);
    const room = Math.max(0, T.unitCap - this.def.length - this.att.filter(isLive).length);
    const n = Math.min(room, clamp(partySize(strength), T.waveMinUnits, T.partyMax));
    if (n <= 0) return;
    const plan = planParty(ctx, this.sid, this.by, strength, n);
    const spots = late ? lineSlots(ctx, ap, n) : columnSpots(ctx, ap.route, ap.leadIdx, n);
    const family = familyOf(this.by);
    const faction = this.by !== 'blight' && FACTION_BY_ID[this.by] ? this.by : undefined;
    let made = 0;
    plan.forEach((r, i) => {
      const u = this.makeRaider(r, spots[i] ?? spots[spots.length - 1], family === 'bandit' ? faction : undefined, i, n, now, late);
      if (u) {
        this.att.push(u);
        made++;
      }
    });
    this.stats.raidersSpawned += made;
    this.waveSize = made;
    this.waveStartedAt = now;
    this.phase = late ? 'melee' : 'march';
    if (late) this.meleeStartedAt = now;
    this.sortie(now);
    if (!quiet) this.sendPhase(now, 'alarm');
    this.sendPhase(now, quiet ? 'fall' : late ? 'melee' : 'march');
    this.alertPlayers(now);
    this.shout(now, this.def.find(isLive), DEF_SHOUTS);
  }

  private makeRaider(r: RaiderPlan, at: Point, faction: string | undefined, rank: number, n: number, now: number, late: boolean): Unit | null {
    const ctx = this.ctx;
    const ap = this.approach!;
    const e = this.mon.spawn({ defId: r.defId, level: r.level, x: at.x, y: at.y, elite: r.elite, siege: this.sid, wanderRadius: 2, ephemeral: true, controlled: true });
    if (!e) return null;
    const u = new Unit('att', e, r.kind, r.power, r.toughness);
    u.skill = MONSTERS[r.defId]?.skills[0] ?? 'm_claw';
    u.marchSpeed = ctx.rng.float(T.marchSpeed[0], T.marchSpeed[1]) * (r.kind === 'captain' ? 1.05 : 1);
    u.runSpeed = T.chargeSpeed * ctx.rng.float(0.92, 1.08);
    u.moveAt = now + Math.round((rank / Math.max(1, n)) * T.marchStagger);
    u.mode = late ? 'charge' : 'march';
    u.since = now;
    u.slot = null;
    e.side = 'raid';
    if (faction) e.faction = faction;
    if (r.kind === 'bearer') e.flag = 1;
    e.face = faceFor(ap.gate.door.x - at.x, ap.gate.door.y - at.y, e.face) as Dir;
    ctx.entities.touch(e);
    return u;
  }

  // ------------------------------------------------------------------ the step

  step(now: number): void {
    if (!this.started || this.phase === 'done') return;
    this.budget = T.pathBudget;
    this.refresh();
    this.syncRaiders(now);
    switch (this.phase) {
      case 'march':
        this.stepMarch(now);
        break;
      case 'melee':
        this.stepMelee(now);
        break;
      case 'lull':
        this.stepLull(now);
        break;
      case 'finale':
        this.stepFinale(now);
        break;
    }
    this.stepDefenders(now);
    this.flushEvents();
    if (now - this.lastBeatAt >= T.heartbeatMs) {
      this.lastBeatAt = now;
      this.sendPhase(now, this.phaseName());
    }
    if (now - this.lastAlertAt >= 1000) {
      this.lastAlertAt = now;
      this.alertPlayers(now);
    }
    this.att = this.att.filter((u) => u.mode !== 'out');
  }

  private phaseName(): 'march' | 'melee' | 'hold' | 'fall' {
    if (this.phase === 'finale') return raidersWon(this.outcome ?? 'held') ? 'fall' : 'hold';
    return this.phase === 'march' ? 'march' : 'melee';
  }

  /** Raiders killed or taken by the combat engine, and players' fights. */
  private syncRaiders(now: number): void {
    for (const u of this.att) {
      if (u.mode === 'out') continue;
      const st = MONSTER.get(u.ent);
      if (!this.ctx.entities.has(u.ent.id) || !st) {
        u.mode = 'out';
        continue;
      }
      if (st.mode === 'dead') {
        // killed in the real combat engine by players
        u.mode = 'out';
        this.stats.raidersKilledByPlayers++;
        continue;
      }
      if (st.mode === 'fight') {
        if (u.mode !== 'player') {
          u.mode = 'player';
          u.target = null;
        }
      } else if (u.mode === 'player') {
        u.mode = this.phase === 'finale' && raidersWon(this.outcome ?? 'held') ? 'sack' : this.phase === 'march' ? 'march' : 'charge';
        u.ordered = false;
        u.since = now;
      }
    }
  }

  // ---- march

  private stepMarch(now: number): void {
    const ap = this.approach!;
    let lead = Infinity;
    for (const u of this.att) {
      if (u.mode === 'march') {
        if (!u.ordered && now >= u.moveAt && this.budget > 0) this.orderMarch(u, now);
      }
      if (isLive(u) && u.mode !== 'player' && u.mode !== 'flee') lead = Math.min(lead, dist(u.x, u.y, ap.gate.door.x, ap.gate.door.y));
    }
    const alive = this.liveRaiders();
    if (alive.length === 0) {
      this.endWave(now);
      return;
    }
    if (lead <= T.chargeDist || now - this.waveStartedAt > T.marchTimeoutMs) this.startMelee(now);
  }

  private orderMarch(u: Unit, now: number): void {
    const ap = this.approach!;
    this.budget--;
    u.ordered = true;
    const slots = lineSlots(this.ctx, ap, Math.max(1, this.att.length));
    const idx = Math.max(0, this.att.filter((x) => x.mode === 'march' || x.mode === 'form').indexOf(u));
    const slot = slots[idx % slots.length] ?? ap.line;
    u.slot = slot;
    u.ent.speed = u.marchSpeed;
    this.go(u, slot.x, slot.y, u.marchSpeed, (res) => {
      if (res === 'arrived' && u.mode === 'march') {
        u.mode = 'form';
        u.ent.face = faceFor(ap.gate.door.x - u.x, ap.gate.door.y - u.y, u.ent.face);
        this.ctx.entities.touch(u.ent);
      }
    });
    void now;
  }

  private startMelee(now: number): void {
    this.phase = 'melee';
    this.meleeStartedAt = now;
    for (const u of this.att) {
      if (u.mode === 'march' || u.mode === 'form') {
        u.mode = 'charge';
        u.ordered = false;
        u.ent.speed = u.runSpeed;
        u.since = now;
      }
    }
    for (const u of this.def) {
      if (isLive(u)) {
        this.setAct(u, undefined);
        u.ordered = false;
      }
    }
    this.sendPhase(now, 'melee');
    this.shout(now, this.att.find((u) => isLive(u) && u.kind === 'captain'), RAID_SHOUTS);
  }

  // ---- melee

  private stepMelee(now: number): void {
    const alive = this.liveRaiders();
    // Waves before the last one are always repelled: the rest of the raiders rout.
    if (!this.final && alive.length > 0 && (alive.length <= Math.floor(this.waveSize * T.routShare) || now - this.meleeStartedAt > T.waveMaxMs)) {
      for (const u of alive) if (u.mode !== 'player') this.rout(u, now);
    }
    // The last wave against a town that is going to fall: once the line is gone the raiders pour in.
    this.breached = this.final && this.pHold < T.breachBelow && this.liveDefenders().length === 0;
    this.fight(now);
    if (this.breached) this.sack(now);
    if (this.att.filter((u) => isLive(u)).length === 0) this.endWave(now);
  }

  /** Pair up, close in, trade blows. */
  private fight(now: number): void {
    const ctx = this.ctx;
    const att = this.att.filter((u) => isLive(u) && u.mode !== 'player' && u.mode !== 'flee' && u.mode !== 'sack');
    const def = this.def.filter((u) => isLive(u) && u.mode !== 'flee');
    const loads = new Map<number, number>();
    for (const u of [...att, ...def]) if (u.target && isLive(u.target) && ctx.entities.has(u.target.ent.id)) loads.set(u.target.id, (loads.get(u.target.id) ?? 0) + 1);
    const fighters = [...att, ...def];
    const n = fighters.length;
    // who stands where (and where they are heading): attackers pick a free tile around their foe
    this.occ.clear();
    for (const u of fighters) {
      const m = u.ent.move;
      const key = (m ? m.ty : u.y) * ctx.world.w + (m ? m.tx : u.x);
      this.occ.set(key, (this.occ.get(key) ?? 0) + 1);
    }
    const gate = this.hold;
    const holdLine = this.phase !== 'finale';
    for (let k = 0; k < n; k++) {
      const u = fighters[(k + this.rot) % n];
      if (!ctx.entities.has(u.ent.id) || !isLive(u) || u.ent.hp === 0) continue;
      if (u.side === 'att' && now < u.chaseUntil) continue; // on its way to a player
      const foes = u.side === 'att' ? def.filter((f) => isLive(f)) : att.filter((f) => isLive(f) && f.mode !== 'player' && (!holdLine || dist(f.x, f.y, gate.x, gate.y) <= T.defendRange));
      if (u.side === 'att' && this.lookForPlayer(u, now)) continue;
      let t = u.target;
      if (!t || !isLive(t) || t.mode === 'player' || t.mode === 'flee' || !ctx.entities.has(t.ent.id) || now - u.targetAt > 5000) {
        t = pickFoe(u, foes, loads);
        if (t && t !== u.target) {
          loads.set(t.id, (loads.get(t.id) ?? 0) + 1);
          u.ordered = false;
        }
        u.target = t;
        u.targetAt = now;
      }
      if (!t) {
        this.idleUnit(u, now);
        continue;
      }
      const d = dist(u.x, u.y, t.x, t.y);
      if (d <= T.reach) {
        this.engage(u, t, now);
      } else {
        this.closeIn(u, t, now);
      }
    }
    this.rot = (this.rot + 1) % Math.max(1, n);
  }

  private engage(u: Unit, t: Unit, now: number): void {
    const ctx = this.ctx;
    if (u.ent.move) ctx.movement.stop(u.ent, true);
    let dirty = false;
    const face = faceFor(t.x - u.x, t.y - u.y, u.ent.face);
    if (face !== u.ent.face) {
      u.ent.face = face;
      dirty = true;
    }
    if (u.ent.state !== 'fight') {
      u.ent.state = 'fight';
      dirty = true;
    }
    if (u.ent.act !== undefined) {
      u.ent.act = undefined;
      dirty = true;
    }
    if (dirty) ctx.entities.touch(u.ent);
    u.ordered = false;
    if (now < u.nextHitAt) return;
    u.nextHitAt = now + ctx.rng.int(T.hitMs[0], T.hitMs[1]);
    const blow = strike(ctx.rng, u, t, this.bias, u.skill);
    this.stats.blows++;
    this.events.push(blow.event);
    if (blow.damage > 0) ctx.entities.touch(t.ent);
    if (blow.killed) this.kill(t, u, now);
  }

  private closeIn(u: Unit, t: Unit, now: number): void {
    const ctx = this.ctx;
    if (this.budget <= 0) return;
    const m = u.ent.move;
    if (m && dist(m.tx, m.ty, t.x, t.y) <= 3 && u.ordered) return;
    this.budget--;
    u.ordered = true;
    if (u.ent.state === 'fight') u.ent.state = 'idle';
    const speed = u.side === 'att' ? u.runSpeed : T.sortieSpeed;
    // a free tile next to the foe, the one nearest to this unit (so a crowd spreads around its target)
    let best: Point | null = null;
    let bestD = Infinity;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy === 0) continue;
        const x = t.x + dx;
        const y = t.y + dy;
        if (!isPassable(ctx.world, x, y)) continue;
        const taken = this.occ.get(y * ctx.world.w + x) ?? 0;
        const d = dist(u.x, u.y, x, y) + taken * 4;
        if (d < bestD) {
          bestD = d;
          best = { x, y };
        }
      }
    }
    if (best && bestD < 40) {
      const key = best.y * ctx.world.w + best.x;
      this.occ.set(key, (this.occ.get(key) ?? 0) + 1);
      const r = ctx.movement.moveTo(u.ent, best.x, best.y, { speed, maxSteps: 90, maxNodes: 2500, snap: 0 });
      if (r.ok) return;
    }
    ctx.movement.approach(u.ent, t.ent, { range: T.reach * 0.8, speed, maxSteps: 90, maxNodes: 2500, retries: 1, snap: 2 });
    void now;
  }

  /** No foe in reach: raiders push towards the gate, defenders hold their line. */
  private idleUnit(u: Unit, now: number): void {
    const ap = this.approach!;
    if (u.ent.state === 'fight') {
      u.ent.state = 'idle';
      this.ctx.entities.touch(u.ent);
    }
    if (u.ent.move || this.budget <= 0) return;
    if (u.side === 'att') {
      if (this.breached) return;
      if (dist(u.x, u.y, ap.gate.door.x, ap.gate.door.y) > 2.5) {
        this.budget--;
        this.go(u, ap.gate.door.x, ap.gate.door.y, u.runSpeed);
      }
    } else if (u.slot && dist(u.x, u.y, u.slot.x, u.slot.y) > 1.2) {
      this.budget--;
      this.go(u, u.slot.x, u.slot.y, T.sortieSpeed, (res) => {
        if (res === 'arrived' && isLive(u) && u.mode === 'idle') this.setAct(u, 'guard');
      });
    } else this.setAct(u, 'guard');
    void now;
  }

  // ---- players

  private playerEligible(p: Player, u: Unit, now: number): boolean {
    if (!p.online || p.entity.state === 'dead' || p.combatId !== null || p.save.activity) return false;
    if (typeof p.data.fleeImmuneUntil === 'number' && p.data.fleeImmuneUntil > now) return false;
    if (typeof p.data.siegeSpareUntil === 'number' && p.data.siegeSpareUntil > now) return false;
    const sacking = this.phase === 'finale' && raidersWon(this.outcome ?? 'held');
    if (sacking && T.sackAttacksPlayers) return true;
    return !this.mon.isSafeZone(p.entity.x, p.entity.y) && u.mode !== 'sack';
  }

  /** Raiders attack players who come close (outside the safe zone; anywhere while the town is being sacked). */
  private lookForPlayer(u: Unit, now: number): boolean {
    const ctx = this.ctx;
    if (now < u.ignorePlayersUntil) return false;
    const near = ctx.players.near(u.x, u.y, T.aggroRange, true).filter((p) => this.playerEligible(p, u, now));
    if (near.length === 0) return false;
    const t = u.target;
    const p = near.sort((a, b) => dist(u.x, u.y, a.entity.x, a.entity.y) - dist(u.x, u.y, b.entity.x, b.entity.y))[0];
    // Keep fighting a defender who is right there; otherwise turn on the player.
    if (t && isLive(t) && dist(u.x, u.y, t.x, t.y) <= T.reach) return false;
    if (this.budget <= 0) return true;
    this.budget--;
    u.ignorePlayersUntil = now + 2500;
    u.chaseUntil = now + 7000;
    u.ordered = false;
    if (u.ent.state === 'fight') u.ent.state = 'idle';
    ctx.movement.approach(u.ent, p.entity, {
      range: 1.5,
      speed: u.runSpeed,
      maxSteps: 40,
      maxNodes: 1500,
      retries: 1,
      onArrive: (_e, res) => {
        u.chaseUntil = 0;
        if (res !== 'arrived' || !ctx.entities.has(u.ent.id)) return;
        const combat = getCombatApi(ctx);
        if (!combat || dist(u.x, u.y, p.entity.x, p.entity.y) > 2.2 || !this.playerEligible(p, u, ctx.now()) || !combat.startFight([p], u.ent)) u.ignorePlayersUntil = ctx.now() + 4000;
      },
    });
    return true;
  }

  /** A player killed one of our raiders: the defence gets a bigger edge than the sim's own kill bonus. */
  onPlayerKill(ev: MonsterKilledEvent): void {
    if (ev.siege !== this.sid) return;
    const s = this.ctx.sim.state.settlements[this.sid];
    if (!s || s.siegeUntil <= 0) return;
    const room = T.tiltCap - this.stats.tilt;
    if (room <= 0) return;
    const d = Math.min(room, T.tiltPerKill * (1 + ev.elite));
    s.siegeStrength = Math.max(0, Math.round((s.siegeStrength - d) * 10) / 10);
    this.stats.tilt += d;
  }

  // ---- casualties

  private kill(t: Unit, by: Unit, now: number): void {
    const ctx = this.ctx;
    this.events.push({ k: 'down', d: t.id });
    if (t.side === 'att') {
      this.mon.kill(t.ent, []);
      t.mode = 'out';
      this.stats.raidersKilledByDefenders++;
    } else {
      this.stats.defendersFallen++;
      ctx.movement.stop(t.ent, true);
      t.mode = 'down';
      t.since = now;
      t.ent.state = 'dead';
      t.ent.hp = 0;
      t.ent.act = undefined;
      ctx.entities.touch(t.ent);
      const reserves = !this.final && this.phase !== 'finale';
      t.reviveAt = reserves ? now + 14_000 + ctx.rng.int(0, 5000) : 0;
    }
    by.target = null;
    for (const o of [...this.att, ...this.def]) if (o.target === t) o.target = null;
  }

  private rout(u: Unit, now: number): void {
    const ap = this.approach!;
    if (u.mode === 'flee' || u.mode === 'out') return;
    u.mode = 'flee';
    u.since = now;
    u.target = null;
    u.ordered = true;
    this.stats.raidersRouted++;
    const to = ap.route[0];
    u.fleeTo = to;
    if (u.ent.state === 'fight') u.ent.state = 'idle';
    u.ent.act = undefined;
    this.ctx.entities.touch(u.ent);
    if (!this.go(u, to.x, to.y, u.runSpeed, () => this.dropRaider(u), 160)) this.dropRaider(u);
  }

  private dropRaider(u: Unit): void {
    if (u.mode === 'out' && !this.ctx.entities.has(u.ent.id)) return;
    u.mode = 'out';
    this.mon.despawn(u.ent);
  }

  // ---- defenders housekeeping

  private stepDefenders(now: number): void {
    const ctx = this.ctx;
    for (const u of this.def) {
      if (u.mode === 'down') {
        if (now - u.since >= T.corpseMs) {
          u.ent.hidden = true;
          u.mode = 'out';
          ctx.entities.touch(u.ent);
        }
      } else if (u.mode === 'out' && u.reviveAt > 0 && now >= u.reviveAt && this.phase !== 'finale') this.revive(u, now);
      else if (u.mode === 'flee' && now - u.since > 18_000) this.hideDefender(u);
      else if (u.mode === 'idle' && !u.ent.move && u.slot && this.phase !== 'melee' && dist(u.x, u.y, u.slot.x, u.slot.y) > 1.5 && this.budget > 0 && !u.ordered) {
        // sortie / return to the line
        this.budget--;
        u.ordered = true;
        this.go(u, u.slot.x, u.slot.y, T.sortieSpeed, (res) => {
          if (res === 'arrived' && isLive(u) && u.mode === 'idle') this.setAct(u, 'guard');
        });
      } else if (u.mode === 'idle' && u.slot && !u.ent.move && dist(u.x, u.y, u.slot.x, u.slot.y) <= 1.5 && u.ent.act === undefined && u.ent.state === 'idle') this.setAct(u, 'guard');
    }
  }

  private revive(u: Unit, now: number): void {
    const ctx = this.ctx;
    const sp = placesOf(ctx, this.sid);
    const at = sp?.plaza.spots[ctx.rng.int(0, Math.max(0, (sp?.plaza.spots.length ?? 1) - 1))] ?? this.gate;
    ctx.movement.teleport(u.ent, at.x, at.y);
    u.ent.hidden = false;
    u.ent.state = 'idle';
    u.ent.hp = Math.round(u.maxHp * 0.7);
    u.mode = 'idle';
    u.ordered = false;
    u.reviveAt = 0;
    u.target = null;
    u.since = now;
    this.setAct(u, 'patrol');
    ctx.entities.touch(u.ent);
    if (this.approach) {
      const slot = defenderSlots(ctx, this.approach, 6)[ctx.rng.int(0, 5)];
      u.slot = slot;
    }
  }

  private hideDefender(u: Unit): void {
    u.mode = 'out';
    u.reviveAt = 0;
    u.ent.hidden = true;
    this.ctx.movement.stop(u.ent, true);
    this.ctx.entities.touch(u.ent);
  }

  // ---- lull

  private endWave(now: number): void {
    const ctx = this.ctx;
    this.phase = 'lull';
    this.nextWaveAt = now + ctx.rng.int(T.lullMs[0], T.lullMs[1]);
    for (const u of this.def) {
      if (u.mode === 'down' || u.mode === 'out') continue;
      u.target = null;
      u.hp = Math.min(u.maxHp, Math.round(u.hp + u.maxHp * 0.5));
      u.ordered = false;
      u.mode = 'idle';
      if (u.ent.state === 'fight') u.ent.state = 'idle';
      ctx.entities.touch(u.ent);
    }
    for (const u of this.def) if (u.mode === 'out' && u.reviveAt > 0) u.reviveAt = Math.min(u.reviveAt, now + 4000);
    if (this.hoursLeft(now) <= T.finalLeadHours + 0.3) this.nextWaveAt = Math.min(this.nextWaveAt, now + 5000);
    this.shout(now, this.def.find((u) => isLive(u) && u.kind !== 'militia'), WIN_SHOUTS);
    this.sendPhase(now, 'march');
    this.sortie(now);
  }

  private stepLull(now: number): void {
    const left = this.hoursLeft(now);
    if (now >= this.nextWaveAt || left <= T.finalLeadHours) {
      this.final = left <= T.finalLeadHours;
      this.spawnWave(now, false);
    }
  }

  // ------------------------------------------------------------------ the end

  /** The sim has rolled the result of this siege: play it out. */
  onSimEnd(events: readonly SimEvent[], now: number): void {
    if (this.phase === 'finale' || this.phase === 'done') return;
    const st = this.ctx.sim.state.settlements[this.sid];
    const after: SettlementSnapshot = { controller: st?.controller ?? null, status: st?.status ?? 'stable' };
    this.outcome = classifyEnd(this.snapshot, after, events, this.sid);
    this.beginFinale(now);
  }

  private beginFinale(now: number): void {
    const ctx = this.ctx;
    const won = raidersWon(this.outcome ?? 'held');
    this.phase = 'finale';
    this.finaleAt = now;
    this.final = true;
    this.refresh();
    if (!this.approach) return;
    if (won) {
      // The defence is overwhelmed: make sure there is a party at the gate to do it.
      if (this.att.filter((u) => isLive(u)).length < T.waveMinUnits) this.spawnFinalAssault(now);
      this.collapseAt = now + 13_000;
      for (const u of this.att) {
        if (isLive(u) && u.mode !== 'player') {
          u.mode = 'charge';
          u.ordered = false;
          u.ent.speed = u.runSpeed;
        }
      }
      if (this.ctx.sim.state.settlements[this.sid]?.status !== 'fallen') this.life.grieve(this.sid);
      this.shout(now, this.def.find(isLive), LOSS_SHOUTS);
      this.shout(now + T.shoutEveryMs, this.att.find((u) => isLive(u) && u.kind === 'captain'), RAID_SHOUTS, true);
    } else {
      for (const u of this.att) if (isLive(u) && u.mode !== 'player') this.rout(u, now);
      for (const u of this.def) {
        if (u.mode === 'down' || u.mode === 'out') {
          if (u.mode === 'out' && u.reviveAt > 0) this.revive(u, now);
          continue;
        }
        u.target = null;
        u.mode = 'cheer';
        u.hp = Math.min(u.maxHp, Math.round(u.hp + u.maxHp * 0.3));
        if (u.ent.state === 'fight') u.ent.state = 'idle';
        this.setAct(u, 'celebrate');
      }
      this.life.celebrate(this.sid, T.celebrateMs);
      this.shout(now, this.def.find((u) => isLive(u) && u.kind !== 'militia'), WIN_SHOUTS, true);
    }
    this.sendPhase(now, won ? 'fall' : 'hold');
    void ctx;
  }

  private spawnFinalAssault(now: number): void {
    this.spawnWave(now, true, true);
    this.phase = 'finale';
  }

  private stepFinale(now: number): void {
    const ctx = this.ctx;
    const ap = this.approach;
    if (!ap) {
      this.teardown(now);
      return;
    }
    const won = raidersWon(this.outcome ?? 'held');
    if (now - this.finaleAt >= T.finaleMs) {
      this.teardown(now);
      return;
    }
    if (!won) {
      // Stragglers are cut down by the cheering defenders; nothing else to steer.
      for (const u of this.att) if (isLive(u) && u.mode !== 'flee' && u.mode !== 'player') this.rout(u, now);
      return;
    }
    const defenders = this.def.filter((u) => isLive(u) && u.mode !== 'flee');
    if (defenders.length > 0 && now >= this.collapseAt) {
      // The line breaks: the weak fall, the rest run for the far gate.
      const sp = placesOf(ctx, this.sid);
      const refuge = sp ? refugeFor(sp, ap.gate) : ap.gate.door;
      for (const u of defenders) {
        if (u.hp / u.maxHp < 0.45 || u.kind === 'militia') {
          if (ctx.rng.chance(0.5)) {
            this.stats.defendersFallen++;
            this.kill(u, u.target ?? u, now);
            continue;
          }
        }
        u.mode = 'flee';
        u.since = now;
        u.target = null;
        if (u.ent.state === 'fight') u.ent.state = 'idle';
        u.ent.act = undefined;
        ctx.entities.touch(u.ent);
        if (!this.go(u, refuge.x, refuge.y, T.sortieSpeed, () => this.hideDefender(u), 160)) this.hideDefender(u);
      }
    }
    const engaged = this.def.some((u) => isLive(u) && u.mode !== 'flee');
    if (engaged) this.fight(now);
    else this.sack(now);
    // a plunder ends with the raiders withdrawing
    if (this.outcome === 'plundered' && now - this.finaleAt > 24_000) {
      for (const u of this.att) if (isLive(u) && u.mode !== 'flee' && u.mode !== 'player') this.rout(u, now);
    }
  }

  /** Raiders spread over the plaza and ransack it. */
  private sack(now: number): void {
    const ctx = this.ctx;
    const sp = placesOf(ctx, this.sid);
    if (!sp) return;
    const spots = plazaSpots(sp);
    let i = 0;
    for (const u of this.att) {
      if (!isLive(u) || u.mode === 'player' || u.mode === 'flee') continue;
      const k = i++;
      if (this.lookForPlayer(u, now)) continue;
      if (u.mode === 'sack') continue;
      if (u.ent.state === 'fight') u.ent.state = 'idle';
      if (u.ordered && u.ent.move) continue;
      if (this.budget <= 0) continue;
      this.budget--;
      u.ordered = true;
      const spot = spots[k % spots.length];
      const lead = u.kind === 'captain' || u.kind === 'bearer';
      const arrive = (res: string): void => {
        if (res !== 'arrived' || !isLive(u)) return;
        u.mode = 'sack';
        u.target = null;
        u.ent.act = lead ? 'celebrate' : 'loot';
        ctx.entities.touch(u.ent);
      };
      if (!this.go(u, spot.x, spot.y, u.runSpeed * 0.8, arrive, 120)) {
        // cannot walk there: loot where it stands
        u.mode = 'sack';
        u.ent.act = lead ? 'celebrate' : 'loot';
        ctx.entities.touch(u.ent);
      }
    }
  }

  // ------------------------------------------------------------------ teardown

  /** Remove every temporary entity and give the NPCs back to their routines. Safe to call at any time, twice. */
  teardown(now: number): void {
    if (this.phase === 'done' && this.att.length === 0 && this.def.length === 0) return;
    const ctx = this.ctx;
    for (const u of this.att) {
      if (!ctx.entities.has(u.ent.id)) continue;
      const st = MONSTER.get(u.ent);
      if (st && st.mode === 'fight') this.mon.despawn(u.ent);
      else ctx.entities.remove(u.ent);
    }
    for (const u of this.def) {
      const alive = isLive(u) && ctx.entities.has(u.ent.id) && !u.ent.hidden;
      const at = alive && isPassable(ctx.world, u.x, u.y) ? { x: u.x, y: u.y } : undefined;
      if (u.npcId !== undefined) this.life.release(u.npcId, at);
      if (ctx.entities.has(u.ent.id)) ctx.entities.remove(u.ent);
    }
    this.att = [];
    this.def = [];
    this.events = [];
    if (this.started && this.phase !== 'done') this.sendPhase(now, 'end');
    this.phase = 'done';
  }

  // ------------------------------------------------------------------ helpers

  private setAct(u: Unit, act: NpcAct | undefined): void {
    if (u.ent.act === act) return;
    u.ent.act = act;
    this.ctx.entities.touch(u.ent);
  }

  private go(u: Unit, x: number, y: number, speed: number, onArrive?: (res: 'arrived' | 'cancelled' | 'removed') => void, maxSteps = 100): boolean {
    if (u.ent.state === 'fight') {
      u.ent.state = 'idle';
      this.ctx.entities.touch(u.ent);
    }
    if (u.ent.act !== undefined && u.side === 'def') u.ent.act = undefined;
    const r = this.ctx.movement.moveTo(u.ent, x, y, { speed, maxSteps, maxNodes: 4000, snap: 2, onArrive: (_e, res) => onArrive?.(res) });
    return r.ok;
  }

  private flushEvents(): void {
    if (this.events.length === 0) return;
    const g = this.gate;
    for (let i = 0; i < this.events.length; i += 40) this.ctx.sendNear(g.x, g.y, SIGHT, { t: 'cfx', ev: this.events.slice(i, i + 40) });
    this.events = [];
  }

  sendPhase(now: number, phase: 'alarm' | 'march' | 'melee' | 'hold' | 'fall' | 'end'): void {
    void now;
    const g = this.gate;
    this.ctx.sendNear(g.x, g.y, SIGHT + 30, { t: 'siege', sid: this.sid, phase, by: this.by, x: g.x, y: g.y });
  }

  private alertText(): string {
    if (this.by === 'blight') return `The Hollows swarm out of the Blight towards ${this.name}!`;
    const f = FACTION_BY_ID[this.by];
    return `${f ? f.short : 'Raiders'} raiders are at the gates of ${this.name}!`;
  }

  private alertPlayers(now: number): void {
    const s = this.ctx.world.settlements[this.sid];
    if (!s) return;
    for (const p of this.ctx.players.near(s.x, s.y, s.radius + T.activateRadius, true)) {
      if (this.alerted.has(p.charId)) continue;
      this.alerted.add(p.charId);
      this.ctx.send(p, { t: 'note', level: 'warn', text: this.alertText() });
    }
    void now;
  }

  private shout(now: number, who: Unit | undefined, lines: readonly string[], force = false): void {
    if (!who || !this.ctx.entities.has(who.ent.id)) return;
    if (!force && now - this.lastShoutAt < T.shoutEveryMs) return;
    this.lastShoutAt = now;
    const text = lines[this.ctx.rng.int(0, lines.length - 1)];
    this.ctx.sendNear(who.x, who.y, 30, { t: 'chat', msg: { ch: 'local', from: who.ent.name, fromId: who.ent.id, text, t: this.ctx.now() } });
  }

  /** Compact description for logs and tests. */
  view(): { phase: BattlePhase; wave: number; raiders: number; defenders: number; down: number; pHold: number; bias: number; final: boolean; outcome: Outcome | null } {
    return {
      phase: this.phase,
      wave: this.waveNo,
      raiders: this.att.filter(isLive).length,
      defenders: this.def.filter((u) => isLive(u)).length,
      down: this.def.filter((u) => u.mode === 'down' || u.mode === 'out').length,
      pHold: this.pHold,
      bias: this.bias,
      final: this.final,
      outcome: this.outcome,
    };
  }
}

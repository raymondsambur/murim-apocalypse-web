import { ACTION_THRESHOLD } from './constants';
import type { Rng } from './rng';
import type { Cond, Stance, TacticRule, WeaponType } from './types';
import { getSkill, skillPower, skillQiCost, type SkillDef, type SkillEffect } from './data/skills';
import { stanceMods } from './stats';

export type StatusKind = 'bleed' | 'poison' | 'stun' | 'slow' | 'guard' | 'buffAtk' | 'buffDef' | 'rot';

export interface StatusEffect {
  kind: StatusKind;
  dur: number;
  /** Per-beat damage for dots, fractional strength for buffs. */
  power: number;
  src: number;
}

export interface CSkill {
  id: string;
  level: number;
  cd: number;
}

export interface Combatant {
  id: number;
  side: 0 | 1;
  name: string;
  isPlayer: boolean;
  blighted: boolean;
  level: number;
  hp: number;
  maxHp: number;
  qi: number;
  maxQi: number;
  atk: number;
  def: number;
  speed: number;
  crit: number;
  dodge: number;
  qiRegen: number;
  healPower: number;
  lifesteal: number;
  resist: number;
  antiBlight: number;
  flee: number;
  weaponType?: WeaponType;
  stance: Stance;
  skills: CSkill[];
  tactics: TacticRule[];
  /** Consumables usable in combat: item id -> {count, heal, qi, cleanse}. */
  items: Record<string, { count: number; heal?: number; qi?: number; cleanse?: boolean }>;
  meter: number;
  status: StatusEffect[];
  alive: boolean;
  fled: boolean;
  damageDealt: number;
  damageTaken: number;
  skillUses: Record<string, number>;
  itemsUsed: Record<string, number>;
}

export type CombatEvent =
  | { k: 'hit'; s: number; d: number; a: number; c?: 1; sk: string }
  | { k: 'miss'; s: number; d: number; sk: string }
  | { k: 'heal'; s: number; d: number; a: number; sk?: string }
  | { k: 'status'; s: number; d: number; st: StatusKind }
  | { k: 'dot'; d: number; a: number; st: StatusKind }
  | { k: 'use'; s: number; sk: string }
  | { k: 'item'; s: number; it: string }
  | { k: 'guard'; s: number }
  | { k: 'flee'; s: number; ok: boolean }
  | { k: 'stun'; s: number }
  | { k: 'down'; d: number };

export interface CombatState {
  combatants: Combatant[];
  beat: number;
}

const BASIC: SkillDef = {
  id: 'basic',
  name: 'Strike',
  school: 'fist',
  kind: 'active',
  tier: 0,
  glyph: '擊',
  desc: '',
  power: 1,
  hits: 1,
  target: 'one',
  qiCost: 0,
  cooldown: 0,
  req: { rank: 1, gold: 0 },
};

export function makeCombatant(base: Partial<Combatant> & Pick<Combatant, 'id' | 'side' | 'name' | 'isPlayer' | 'level' | 'maxHp' | 'atk' | 'def' | 'speed'>): Combatant {
  return {
    blighted: false,
    hp: base.maxHp,
    maxQi: 0,
    qi: base.maxQi ?? 0,
    crit: 5,
    dodge: 3,
    qiRegen: 0,
    healPower: 0,
    lifesteal: 0,
    resist: 0,
    antiBlight: 0,
    flee: 0,
    stance: 'balanced',
    skills: [],
    tactics: [],
    items: {},
    meter: 40,
    status: [],
    alive: true,
    fled: false,
    damageDealt: 0,
    damageTaken: 0,
    skillUses: {},
    itemsUsed: {},
    ...base,
  };
}

function has(c: Combatant, k: StatusKind): StatusEffect | undefined {
  return c.status.find((s) => s.kind === k);
}

function effAtk(c: Combatant): number {
  let v = c.atk * stanceMods(c.stance).atk;
  const b = has(c, 'buffAtk');
  if (b) v *= 1 + b.power;
  return v;
}

function effDef(c: Combatant): number {
  let v = c.def * stanceMods(c.stance).def;
  const b = has(c, 'buffDef');
  if (b) v *= 1 + b.power;
  return v;
}

function effDodge(c: Combatant): number {
  return Math.min(60, c.dodge + stanceMods(c.stance).dodge);
}

function effSpeed(c: Combatant): number {
  const sl = has(c, 'slow');
  return c.speed * (sl ? 1 - sl.power : 1);
}

function alive(list: Combatant[]): Combatant[] {
  return list.filter((c) => c.alive && !c.fled);
}

function enemiesOf(state: CombatState, c: Combatant): Combatant[] {
  return alive(state.combatants.filter((o) => o.side !== c.side));
}

function alliesOf(state: CombatState, c: Combatant): Combatant[] {
  return alive(state.combatants.filter((o) => o.side === c.side));
}

export function isOver(state: CombatState): boolean {
  const a = alive(state.combatants.filter((c) => c.side === 0)).length;
  const b = alive(state.combatants.filter((c) => c.side === 1)).length;
  return a === 0 || b === 0;
}

/** 0 or 1 when one side is left standing, null for a mutual wipe (or if still going). */
export function winner(state: CombatState): 0 | 1 | null {
  const a = alive(state.combatants.filter((c) => c.side === 0)).length;
  const b = alive(state.combatants.filter((c) => c.side === 1)).length;
  if (a > 0 && b === 0) return 0;
  if (b > 0 && a === 0) return 1;
  return null;
}

function condMet(cond: Cond, self: Combatant, enemies: Combatant[]): boolean {
  switch (cond.k) {
    case 'always':
      return true;
    case 'hpBelow':
      return self.hp / self.maxHp < cond.v / 100;
    case 'qiBelow':
      return self.maxQi > 0 && self.qi / self.maxQi < cond.v / 100;
    case 'qiAbove':
      return self.maxQi > 0 && self.qi / self.maxQi > cond.v / 100;
    case 'enemyHpBelow':
      return enemies.some((e) => e.hp / e.maxHp < cond.v / 100);
    case 'enemiesAtLeast':
      return enemies.length >= cond.v;
    case 'targetBlighted':
      return enemies.some((e) => e.blighted);
  }
}

function canUse(c: Combatant, s: CSkill): boolean {
  const def = getSkill(s.id);
  if (!def) return false;
  if (s.cd > 0) return false;
  return c.qi >= skillQiCost(def, s.level);
}

type Choice = { type: 'skill'; skill: CSkill } | { type: 'basic' } | { type: 'guard' } | { type: 'item'; id: string } | { type: 'flee' };

function chooseAction(state: CombatState, c: Combatant, rng: Rng): Choice {
  const enemies = enemiesOf(state, c);
  if (!c.isPlayer) {
    const usable = c.skills.filter((s) => canUse(c, s));
    if (usable.length && rng.chance(0.7)) return { type: 'skill', skill: rng.pick(usable) };
    return { type: 'basic' };
  }
  for (const rule of c.tactics) {
    if (!condMet(rule.cond, c, enemies)) continue;
    const act = rule.act;
    if (act.k === 'basic') return { type: 'basic' };
    if (act.k === 'guard') return { type: 'guard' };
    if (act.k === 'flee') return { type: 'flee' };
    if (act.k === 'item') {
      const it = c.items[act.id];
      if (it && it.count > 0) return { type: 'item', id: act.id };
      continue;
    }
    if (act.k === 'skill') {
      const s = c.skills.find((x) => x.id === act.id);
      if (s && canUse(c, s)) return { type: 'skill', skill: s };
    }
  }
  // Default: heal when hurt, area attack against groups, otherwise strongest affordable attack.
  const usable = c.skills.filter((s) => canUse(c, s));
  const healer = usable.find((s) => getSkill(s.id)?.heal);
  if (healer && c.hp / c.maxHp < 0.4) return { type: 'skill', skill: healer };
  const attackers = usable.filter((s) => (getSkill(s.id)?.power ?? 0) > 0);
  if (attackers.length) {
    const score = (s: CSkill) => {
      const d = getSkill(s.id)!;
      let v = skillPower(d, s.level) * (d.hits ?? 1);
      if (d.target === 'all') v *= Math.min(enemies.length, 3) * 0.85;
      if (d.weapon && d.weapon === c.weaponType) v *= 1.12;
      return v;
    };
    attackers.sort((a, b) => score(b) - score(a));
    return { type: 'skill', skill: attackers[0] };
  }
  return { type: 'basic' };
}

function pickTarget(state: CombatState, c: Combatant, rng: Rng): Combatant | null {
  const enemies = enemiesOf(state, c);
  if (!enemies.length) return null;
  if (c.isPlayer) return enemies.reduce((a, b) => (a.hp / a.maxHp <= b.hp / b.maxHp ? a : b));
  // Monsters go for whoever is in front, with a lean toward the weak.
  return rng.chance(0.65) ? rng.pick(enemies) : enemies.reduce((a, b) => (a.hp <= b.hp ? a : b));
}

function applyDamage(state: CombatState, events: CombatEvent[], src: Combatant, dst: Combatant, amount: number, crit: boolean, skillId: string): void {
  const g = has(dst, 'guard');
  let dmg = amount;
  if (g) dmg *= 1 - g.power;
  dmg = Math.max(1, Math.round(dmg));
  dst.hp -= dmg;
  dst.damageTaken += dmg;
  src.damageDealt += dmg;
  events.push({ k: 'hit', s: src.id, d: dst.id, a: dmg, c: crit ? 1 : undefined, sk: skillId });
  const ls = src.lifesteal;
  if (ls > 0) heal(events, src, src, dmg * ls);
  if (dst.hp <= 0) {
    dst.hp = 0;
    dst.alive = false;
    dst.status = [];
    events.push({ k: 'down', d: dst.id });
  }
}

function heal(events: CombatEvent[], src: Combatant, dst: Combatant, amount: number, skill?: string): void {
  if (!dst.alive) return;
  let a = amount;
  if (has(dst, 'rot')) a *= 0.5;
  a = Math.round(Math.min(a, dst.maxHp - dst.hp));
  if (a <= 0) return;
  dst.hp += a;
  events.push({ k: 'heal', s: src.id, d: dst.id, a, sk: skill });
}

function addStatus(events: CombatEvent[], src: Combatant, dst: Combatant, kind: StatusKind, dur: number, power: number): void {
  const existing = has(dst, kind);
  if (existing) {
    existing.dur = Math.max(existing.dur, dur);
    existing.power = Math.max(existing.power, power);
    return;
  }
  dst.status.push({ kind, dur, power, src: src.id });
  events.push({ k: 'status', s: src.id, d: dst.id, st: kind });
}

function applyEffects(state: CombatState, events: CombatEvent[], src: Combatant, dst: Combatant | null, effects: SkillEffect[], dealt: number, rng: Rng): void {
  for (const e of effects) {
    if (e.kind === 'lifesteal') {
      heal(events, src, src, dealt * e.power);
      continue;
    }
    if (e.kind === 'cleanse') {
      src.status = src.status.filter((s) => s.kind !== 'poison' && s.kind !== 'rot' && s.kind !== 'bleed');
      continue;
    }
    if (e.kind === 'guard' || e.kind === 'buffAtk' || e.kind === 'buffDef') {
      addStatus(events, src, src, e.kind, e.dur, e.power);
      continue;
    }
    if (!dst || !dst.alive) continue;
    if (e.kind === 'qiDrain') {
      const taken = Math.min(dst.qi, e.power);
      dst.qi -= taken;
      src.qi = Math.min(src.maxQi, src.qi + taken * 0.5);
      continue;
    }
    if (!rng.chance(e.chance)) continue;
    const kind = e.kind as StatusKind;
    if (dst.resist > 0 && (kind === 'poison' || kind === 'rot') && rng.chance(dst.resist)) continue;
    if (kind === 'bleed' || kind === 'poison' || kind === 'rot') addStatus(events, src, dst, kind, e.dur, e.power * src.atk * (kind === 'rot' ? 0.45 : kind === 'poison' ? 0.6 : 0.5));
    else addStatus(events, src, dst, kind, e.dur, e.power);
  }
}

function doAttack(state: CombatState, events: CombatEvent[], c: Combatant, def: SkillDef, level: number, rng: Rng): void {
  const hits = def.hits ?? 1;
  const power = skillPower(def, level);
  const targets: Combatant[] = [];
  if (def.target === 'all') targets.push(...enemiesOf(state, c));
  else {
    const t = pickTarget(state, c, rng);
    if (t) targets.push(t);
  }
  let totalDealt = 0;
  for (const t of targets) {
    let lastDealt = 0;
    for (let h = 0; h < hits; h++) {
      if (!t.alive) break;
      if (rng.next() * 100 < effDodge(t)) {
        events.push({ k: 'miss', s: c.id, d: t.id, sk: def.id });
        continue;
      }
      let base = effAtk(c) * power;
      if (def.weapon && def.weapon === c.weaponType) base *= 1.12;
      if (t.blighted && c.antiBlight > 0) base *= 1 + c.antiBlight;
      const crit = rng.next() * 100 < c.crit;
      if (crit) base *= 1.6;
      const mitig = 100 / (100 + effDef(t) * 1.4);
      const dmg = Math.max(1, base * rng.float(0.9, 1.1) * mitig);
      const before = t.hp;
      applyDamage(state, events, c, t, dmg, crit, def.id);
      lastDealt += before - t.hp;
    }
    totalDealt += lastDealt;
    if (def.effects && lastDealt > 0) applyEffects(state, events, c, t, def.effects, lastDealt, rng);
  }
  // Self-targeted bonuses on an attack that found no target still apply (guard, buffs).
  if (def.effects && targets.length === 0) applyEffects(state, events, c, null, def.effects, 0, rng);
}

function doSkill(state: CombatState, events: CombatEvent[], c: Combatant, s: CSkill, rng: Rng): void {
  const def = getSkill(s.id)!;
  c.qi -= skillQiCost(def, s.level);
  s.cd = def.cooldown ?? 0;
  c.skillUses[s.id] = (c.skillUses[s.id] ?? 0) + 1;
  events.push({ k: 'use', s: c.id, sk: s.id });
  if (def.heal) {
    heal(events, c, c, def.heal * c.healPower * (1 + 0.05 * (s.level - 1)), s.id);
    if (def.effects) applyEffects(state, events, c, null, def.effects, 0, rng);
    return;
  }
  if ((def.power ?? 0) <= 0) {
    if (def.effects) applyEffects(state, events, c, null, def.effects, 0, rng);
    return;
  }
  doAttack(state, events, c, def, s.level, rng);
}

function act(state: CombatState, events: CombatEvent[], c: Combatant, rng: Rng): void {
  const stun = has(c, 'stun');
  if (stun) {
    events.push({ k: 'stun', s: c.id });
    return;
  }
  const choice = chooseAction(state, c, rng);
  switch (choice.type) {
    case 'skill':
      doSkill(state, events, c, choice.skill, rng);
      return;
    case 'guard':
      addStatus(events, c, c, 'guard', 2, 0.5);
      c.qi = Math.min(c.maxQi, c.qi + 6);
      events.push({ k: 'guard', s: c.id });
      return;
    case 'item': {
      const it = c.items[choice.id];
      it.count--;
      c.itemsUsed[choice.id] = (c.itemsUsed[choice.id] ?? 0) + 1;
      events.push({ k: 'item', s: c.id, it: choice.id });
      if (it.heal) heal(events, c, c, it.heal);
      if (it.qi) c.qi = Math.min(c.maxQi, c.qi + it.qi);
      if (it.cleanse) c.status = c.status.filter((s) => s.kind !== 'poison' && s.kind !== 'rot' && s.kind !== 'bleed');
      return;
    }
    case 'flee': {
      const enemies = enemiesOf(state, c);
      const avg = enemies.reduce((a, e) => a + e.speed, 0) / Math.max(1, enemies.length);
      const chance = Math.max(5, Math.min(90, 35 + c.flee + (c.speed - avg) * 0.5));
      const ok = rng.next() * 100 < chance;
      if (ok) c.fled = true;
      events.push({ k: 'flee', s: c.id, ok });
      return;
    }
    default:
      doAttack(state, events, c, BASIC, 1, rng);
  }
}

/** Advance the fight by one beat (1 second). Returns the events produced. */
export function stepBeat(state: CombatState, rng: Rng): CombatEvent[] {
  const events: CombatEvent[] = [];
  state.beat++;
  // Start of beat: damage over time, regeneration, cooldowns.
  for (const c of state.combatants) {
    if (!c.alive || c.fled) continue;
    for (const s of c.status) {
      if (s.kind === 'bleed' || s.kind === 'poison' || s.kind === 'rot') {
        const dmg = Math.max(1, Math.round(s.power));
        c.hp -= dmg;
        c.damageTaken += dmg;
        events.push({ k: 'dot', d: c.id, a: dmg, st: s.kind });
        if (c.hp <= 0) {
          c.hp = 0;
          c.alive = false;
          events.push({ k: 'down', d: c.id });
          break;
        }
      }
    }
    if (!c.alive) {
      c.status = [];
      continue;
    }
    c.qi = Math.min(c.maxQi, c.qi + c.qiRegen);
    for (const s of c.skills) if (s.cd > 0) s.cd--;
    c.meter += effSpeed(c);
  }
  // Actions, fastest first.
  const order = [...state.combatants].filter((c) => c.alive && !c.fled).sort((a, b) => b.meter - a.meter);
  for (const c of order) {
    let acts = 0;
    while (c.alive && !c.fled && c.meter >= ACTION_THRESHOLD && acts < 2) {
      if (isOver(state)) break;
      c.meter -= ACTION_THRESHOLD;
      acts++;
      act(state, events, c, rng);
    }
    if (isOver(state)) break;
  }
  // End of beat: expire statuses.
  for (const c of state.combatants) {
    if (!c.alive) continue;
    for (const s of c.status) s.dur--;
    c.status = c.status.filter((s) => s.dur > 0);
  }
  return events;
}

/** Run a fight to completion (used by tests and balance tooling). */
export function simulate(side0: Combatant[], side1: Combatant[], rng: Rng, maxBeats = 120): { winner: 0 | 1 | null; beats: number; state: CombatState } {
  const state: CombatState = { combatants: [...side0, ...side1], beat: 0 };
  while (!isOver(state) && state.beat < maxBeats) stepBeat(state, rng);
  return { winner: winner(state), beats: state.beat, state };
}

/**
 * Skills & Build rules: draft editing for loadout / stance / tactics, validation that mirrors the server's
 * `build` command (progression.ts: validateLoadout + validateTactics), grouping of learned arts and the passive preview.
 * Pure: no DOM.
 */
import {
  SKILLS,
  activeSlots,
  deriveForCharacter,
  getItem,
  rankOf,
  type Act,
  type CharacterSave,
  type Cond,
  type DerivedStats,
  type ItemStack,
  type Loadout,
  type SkillDef,
  type SkillKind,
  type SkillSchool,
  type Stance,
  type TacticRule,
} from '@murim/shared';

export const MAX_TACTICS = 6;
export const STANCES: Stance[] = ['aggressive', 'balanced', 'defensive', 'evasive'];

export interface BuildDraft {
  loadout: Loadout;
  stance: Stance;
  tactics: TacticRule[];
}

export function slotCount(level: number): number {
  return activeSlots(rankOf(level));
}

function cloneRule(r: TacticRule): TacticRule {
  return { cond: { ...r.cond }, act: { ...r.act } };
}

/** Copy of the saved build; the active list is padded / cut to the slots the rank gives. */
export function draftFromSave(c: Pick<CharacterSave, 'level' | 'loadout' | 'stance' | 'tactics'>): BuildDraft {
  const n = slotCount(c.level);
  const active: (string | null)[] = [];
  for (let i = 0; i < n; i++) active.push(c.loadout.active[i] ?? null);
  return { loadout: { active, internal: c.loadout.internal ?? null, movement: c.loadout.movement ?? null }, stance: c.stance, tactics: c.tactics.map(cloneRule) };
}

export function draftEquals(a: BuildDraft, b: BuildDraft): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Make a draft fit the character again (new rank slots, forgotten skills). Keeps the player's edits otherwise. */
export function reconcileDraft(d: BuildDraft, c: Pick<CharacterSave, 'level' | 'skills'>): BuildDraft {
  const n = slotCount(c.level);
  const known = (id: string | null, kind: SkillKind) => (id && c.skills[id] && SKILLS[id]?.kind === kind ? id : null);
  const active: (string | null)[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < n; i++) {
    const id = known(d.loadout.active[i] ?? null, 'active');
    if (id && !seen.has(id)) {
      active.push(id);
      seen.add(id);
    } else active.push(null);
  }
  return { ...d, loadout: { active, internal: known(d.loadout.internal, 'internal'), movement: known(d.loadout.movement, 'movement') } };
}

// ---- learned arts ------------------------------------------------------------------------------------------

export type SlotRef = { kind: 'active'; slot: number } | { kind: 'internal' } | { kind: 'movement' };

const SCHOOL_ORDER: SkillSchool[] = ['sword', 'blade', 'spear', 'staff', 'fist', 'medicine', 'poison', 'internal', 'movement'];

export interface SchoolGroup {
  school: SkillSchool;
  skills: { def: SkillDef; lv: number; xp: number }[];
}

export function groupBySchool(skills: CharacterSave['skills']): SchoolGroup[] {
  const map = new Map<SkillSchool, SchoolGroup>();
  for (const [id, st] of Object.entries(skills)) {
    const def = SKILLS[id];
    if (!def) continue;
    let g = map.get(def.school);
    if (!g) map.set(def.school, (g = { school: def.school, skills: [] }));
    g.skills.push({ def, lv: st.lv, xp: st.xp });
  }
  for (const g of map.values()) g.skills.sort((a, b) => a.def.tier - b.def.tier || a.def.name.localeCompare(b.def.name));
  return [...map.values()].sort((a, b) => SCHOOL_ORDER.indexOf(a.school) - SCHOOL_ORDER.indexOf(b.school));
}

export function learnedOfKind(skills: CharacterSave['skills'], kind: SkillKind): SkillDef[] {
  return Object.keys(skills)
    .map((id) => SKILLS[id])
    .filter((d): d is SkillDef => !!d && d.kind === kind)
    .sort((a, b) => b.tier - a.tier || a.name.localeCompare(b.name));
}

export function slotKindOf(ref: SlotRef): SkillKind {
  return ref.kind;
}

export function skillFits(def: SkillDef | undefined, ref: SlotRef): boolean {
  return !!def && def.kind === ref.kind;
}

export function slotValue(l: Loadout, ref: SlotRef): string | null {
  return ref.kind === 'active' ? (l.active[ref.slot] ?? null) : l[ref.kind];
}

export function equippedIds(l: Loadout): string[] {
  return [...l.active, l.internal, l.movement].filter((s): s is string => !!s);
}

/** Put `id` (or empty) in a slot. A skill already equipped elsewhere moves (swapping with what was here). */
export function placeSkill(d: BuildDraft, ref: SlotRef, id: string | null): BuildDraft {
  if (id && !skillFits(SKILLS[id], ref)) return d;
  const l: Loadout = { active: [...d.loadout.active], internal: d.loadout.internal, movement: d.loadout.movement };
  const prev = slotValue(l, ref);
  if (id && ref.kind === 'active') {
    const at = l.active.indexOf(id);
    if (at >= 0 && at !== ref.slot) l.active[at] = prev;
  }
  if (ref.kind === 'active') l.active[ref.slot] = id;
  else l[ref.kind] = id;
  return { ...d, loadout: l };
}

/** Swap the contents of two active slots. */
export function swapActive(d: BuildDraft, a: number, b: number): BuildDraft {
  const active = [...d.loadout.active];
  [active[a], active[b]] = [active[b] ?? null, active[a] ?? null];
  return { ...d, loadout: { ...d.loadout, active } };
}

export function firstEmptyActive(l: Loadout): number {
  return l.active.findIndex((s) => !s);
}

// ---- tactics ------------------------------------------------------------------------------------------------

export type CondKind = Cond['k'];
export const COND_KINDS: CondKind[] = ['always', 'hpBelow', 'qiBelow', 'qiAbove', 'enemyHpBelow', 'enemiesAtLeast', 'targetBlighted'];
export type ActKind = Act['k'];
export const ACT_KINDS: ActKind[] = ['skill', 'basic', 'guard', 'item', 'flee'];

export function condHasValue(k: CondKind): boolean {
  return k !== 'always' && k !== 'targetBlighted';
}

export function condRange(k: CondKind): { min: number; max: number; unit: '%' | '' } {
  return k === 'enemiesAtLeast' ? { min: 1, max: 20, unit: '' } : { min: 0, max: 100, unit: '%' };
}

export function defaultCond(k: CondKind): Cond {
  switch (k) {
    case 'always':
    case 'targetBlighted':
      return { k };
    case 'enemiesAtLeast':
      return { k, v: 2 };
    case 'qiAbove':
      return { k, v: 60 };
    case 'hpBelow':
      return { k, v: 40 };
    default:
      return { k, v: 30 };
  }
}

export function clampCondValue(k: CondKind, v: number): number {
  const r = condRange(k);
  return Math.max(r.min, Math.min(r.max, Math.round(Number.isFinite(v) ? v : r.min)));
}

/** Change the condition kind, keeping the value when both kinds have one and it is in range. */
export function withCondKind(rule: TacticRule, k: CondKind): TacticRule {
  const next = defaultCond(k);
  if ('v' in next && 'v' in rule.cond) (next as { v: number }).v = clampCondValue(k, rule.cond.v);
  return { ...rule, cond: next };
}

export function withCondValue(rule: TacticRule, v: number): TacticRule {
  if (!('v' in rule.cond)) return rule;
  return { ...rule, cond: { ...rule.cond, v: clampCondValue(rule.cond.k, v) } as Cond };
}

export function isCombatConsumable(id: string): boolean {
  const def = getItem(id);
  return !!def && def.kind === 'consumable' && !def.use?.breakthrough && !!(def.use?.heal || def.use?.qi || def.use?.cleanse);
}

/** Combat consumables in the bag (unique ids) plus any already used by a rule. */
export function itemChoices(inventory: readonly ItemStack[], tactics: readonly TacticRule[]): string[] {
  const out: string[] = [];
  const add = (id: string) => {
    if (!out.includes(id) && isCombatConsumable(id)) out.push(id);
  };
  for (const s of inventory) add(s.id);
  for (const r of tactics) if (r.act.k === 'item') add(r.act.id);
  return out;
}

export function skillChoices(l: Loadout): string[] {
  return l.active.filter((s): s is string => !!s);
}

export function defaultAct(k: ActKind, loadout: Loadout, inventory: readonly ItemStack[], tactics: readonly TacticRule[]): Act {
  switch (k) {
    case 'skill':
      return { k, id: skillChoices(loadout)[0] ?? '' };
    case 'item':
      return { k, id: itemChoices(inventory, tactics)[0] ?? '' };
    default:
      return { k } as Act;
  }
}

export function addRule(tactics: readonly TacticRule[], rule: TacticRule): TacticRule[] {
  return tactics.length >= MAX_TACTICS ? tactics.map(cloneRule) : [...tactics.map(cloneRule), cloneRule(rule)];
}

export function removeRule(tactics: readonly TacticRule[], i: number): TacticRule[] {
  return tactics.filter((_, k) => k !== i).map(cloneRule);
}

export function moveRule(tactics: readonly TacticRule[], i: number, dir: -1 | 1): TacticRule[] {
  const out = tactics.map(cloneRule);
  const j = i + dir;
  if (j < 0 || j >= out.length || i < 0 || i >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export function replaceRule(tactics: readonly TacticRule[], i: number, rule: TacticRule): TacticRule[] {
  return tactics.map((r, k) => cloneRule(k === i ? rule : r));
}

/** The server's DEFAULT_TACTICS (one potion rule); the client copy only asks for it when resetting. */
export const DEFAULT_TACTICS_DRAFT: TacticRule[] = [{ cond: { k: 'hpBelow', v: 35 }, act: { k: 'item', id: 'pill_heal_s' } }];

// ---- validation (mirrors the server) -------------------------------------------------------------------------------

export function validCond(c: Cond): boolean {
  if (c.k === 'always' || c.k === 'targetBlighted') return true;
  if (!COND_KINDS.includes(c.k) || typeof c.v !== 'number' || !Number.isInteger(c.v)) return false;
  const r = condRange(c.k);
  return c.v >= r.min && c.v <= r.max;
}

/** i18n keys of the problems found; empty when the server would accept the build. */
export function validateDraft(c: Pick<CharacterSave, 'level' | 'skills'>, d: BuildDraft): string[] {
  const errs: string[] = [];
  const slots = slotCount(c.level);
  if (d.loadout.active.slice(slots).some((s) => s)) errs.push('build.err.slots');
  const asked = [...d.loadout.active.slice(0, slots), d.loadout.internal, d.loadout.movement].filter((s): s is string => !!s);
  if (new Set(asked).size !== asked.length) errs.push('build.err.dupe');
  const kindOk = (id: string | null, kind: SkillKind) => !id || (!!c.skills[id] && SKILLS[id]?.kind === kind);
  if (!d.loadout.active.every((s) => kindOk(s, 'active')) || !kindOk(d.loadout.internal, 'internal') || !kindOk(d.loadout.movement, 'movement')) errs.push('build.err.skill');
  if (!STANCES.includes(d.stance)) errs.push('build.err.stance');
  if (d.tactics.length > MAX_TACTICS) errs.push('build.err.tooMany');
  for (const r of d.tactics) {
    if (!validCond(r.cond)) {
      errs.push('build.err.cond');
      break;
    }
  }
  for (const r of d.tactics) {
    if (r.act.k === 'skill' && !d.loadout.active.includes(r.act.id)) {
      errs.push('build.err.tacticSkill');
      break;
    }
  }
  for (const r of d.tactics) {
    if (r.act.k === 'item' && !isCombatConsumable(r.act.id)) {
      errs.push('build.err.tacticItem');
      break;
    }
  }
  return errs;
}

/** Indexes of rules that would be refused (skill removed from the loadout, unusable item). */
export function brokenRules(d: BuildDraft): number[] {
  const out: number[] = [];
  d.tactics.forEach((r, i) => {
    if (!validCond(r.cond) || (r.act.k === 'skill' && !d.loadout.active.includes(r.act.id)) || (r.act.k === 'item' && !isCombatConsumable(r.act.id))) out.push(i);
  });
  return out;
}

/** Rules whose item is not in the bag right now (legal, but they will do nothing in a fight). */
export function emptyItemRules(d: BuildDraft, inventory: readonly ItemStack[]): number[] {
  const have = new Set(inventory.map((s) => s.id));
  const out: number[] = [];
  d.tactics.forEach((r, i) => {
    if (r.act.k === 'item' && !have.has(r.act.id)) out.push(i);
  });
  return out;
}

// ---- passive preview ----------------------------------------------------------------------------------------------------

export interface StatDelta {
  key: keyof DerivedStats;
  label: string;
  before: number;
  after: number;
  /** true when shown as a percentage fraction (0.1 = 10%). */
  frac?: boolean;
}

const PREVIEW_KEYS: { key: keyof DerivedStats; label: string; frac?: boolean }[] = [
  { key: 'maxHp', label: 'char.d.hp' },
  { key: 'maxQi', label: 'char.d.qi' },
  { key: 'atk', label: 'char.d.atk' },
  { key: 'def', label: 'char.d.def' },
  { key: 'speed', label: 'char.d.speed' },
  { key: 'crit', label: 'char.d.crit' },
  { key: 'dodge', label: 'char.d.dodge' },
  { key: 'qiRegen', label: 'char.d.qiRegen' },
  { key: 'antiBlight', label: 'char.d.antiBlight', frac: true },
  { key: 'lifesteal', label: 'char.d.lifesteal', frac: true },
  { key: 'resist', label: 'char.d.resist', frac: true },
  { key: 'flee', label: 'char.d.flee' },
];

/** Derived stats of the saved loadout against the draft loadout (only rows that exist or change). */
export function previewStats(c: CharacterSave, d: BuildDraft, now: number): StatDelta[] {
  const before = deriveForCharacter(c, now);
  const after = deriveForCharacter({ ...c, loadout: d.loadout }, now);
  const out: StatDelta[] = [];
  for (const p of PREVIEW_KEYS) {
    const b = Number(before[p.key] ?? 0);
    const a = Number(after[p.key] ?? 0);
    if (b === 0 && a === 0) continue;
    out.push({ key: p.key, label: p.label, before: b, after: a, frac: p.frac });
  }
  return out;
}

/** Fraction of the way to the next skill level (0..1), or 1 at max level. */
export function skillProgress(lv: number, xp: number, xpToNext: (lv: number) => number, maxLevel: number): number {
  if (lv >= maxLevel) return 1;
  return Math.max(0, Math.min(1, xp / Math.max(1, xpToNext(lv))));
}

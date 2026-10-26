/**
 * Pure tooltip models for items, skills and talents. Rendering to DOM lives in ui/widgets/tooltip.ts.
 * Kept free of DOM access so the wording is unit tested.
 */
import {
  RANKS,
  RARITY_COLORS,
  RARITY_MULT,
  RARITY_NAMES,
  SKILL_MAX_LEVEL,
  STAT_INFO,
  STAT_KEYS,
  TALENTS,
  getItem,
  getSkill,
  isEquipment,
  itemBonus,
  skillPower,
  skillQiCost,
  stackValue,
  type AffixKey,
  type GearBonus,
  type ItemDef,
  type ItemStack,
  type PassiveBonus,
  type SkillDef,
  type SkillEffect,
  type StatKey,
} from '@murim/shared';
import { t } from '../../i18n';
import { fmtInt, fmtNum, titleCase } from '../format';
import { itemIconName, skillIconName } from '../glyphMap';

export type Tone = 'good' | 'bad' | 'warn' | 'dim' | 'affix' | 'gold' | 'info';

export interface TipLine {
  text: string;
  tone?: Tone;
}

export interface TipModel {
  /** Icon name (see ui/icons.ts). */
  glyph: string;
  /** For items: the definition and rarity, so the tooltip can show the pixel-art icon instead of the vector glyph. */
  item?: ItemDef;
  itemRarity?: number;
  glyphColor: string;
  title: string;
  titleColor: string;
  subtitle: string;
  lines: TipLine[];
  desc?: string;
  footer: TipLine[];
}

const NEUTRAL = '#b9b2a0';

export function statName(k: StatKey): string {
  return STAT_INFO[k].name;
}

export function affixName(k: AffixKey): string {
  if (k === 'hp') return t('stat.hp');
  if (k === 'atk') return t('stat.atk');
  if (k === 'def') return t('stat.def');
  return statName(k);
}

function signed(n: number): string {
  return n >= 0 ? `+${fmtInt(n)}` : `−${fmtInt(-n)}`;
}

/** Rarity colour of a stack (equipment only; other items use the neutral border). */
export function stackColor(stack: ItemStack): string {
  const def = getItem(stack.id);
  if (!def) return NEUTRAL;
  return isEquipment(def) ? RARITY_COLORS[stack.r ?? 0] : NEUTRAL;
}

export function stackTitle(stack: ItemStack): string {
  return getItem(stack.id)?.name ?? stack.id;
}

function bonusLines(b: GearBonus, tone?: Tone): TipLine[] {
  const out: TipLine[] = [];
  if (b.atk) out.push({ text: `${signed(b.atk)} ${t('stat.atk')}`, tone });
  if (b.def) out.push({ text: `${signed(b.def)} ${t('stat.def')}`, tone });
  if (b.hp) out.push({ text: `${signed(b.hp)} ${t('stat.hp')}`, tone });
  for (const k of STAT_KEYS) if (b.stats[k]) out.push({ text: `${signed(b.stats[k]!)} ${statName(k)}`, tone });
  return out;
}

function diffBonus(a: GearBonus, b: GearBonus): GearBonus {
  const stats: GearBonus['stats'] = {};
  for (const k of STAT_KEYS) {
    const d = (a.stats[k] ?? 0) - (b.stats[k] ?? 0);
    if (d) stats[k] = d;
  }
  return { atk: a.atk - b.atk, def: a.def - b.def, hp: a.hp - b.hp, stats };
}

export interface ItemTipOptions {
  /** Item currently worn in the same slot, for a comparison section. */
  compare?: ItemStack | null;
  equipped?: boolean;
  /** Show what an NPC pays (fraction of value). */
  sellMult?: number;
  /** Show a buy price instead of the value line. */
  price?: number;
}

export function itemTipModel(stack: ItemStack, opts: ItemTipOptions = {}): TipModel {
  const def = getItem(stack.id);
  if (!def) {
    return { glyph: 'unknown', glyphColor: NEUTRAL, title: stack.id, titleColor: NEUTRAL, subtitle: t('tip.unknownItem'), lines: [], footer: [] };
  }
  const equip = isEquipment(def);
  const r = stack.r ?? 0;
  const lines: TipLine[] = [];
  let subtitle: string;
  if (equip) {
    const kind = def.weaponType ? t(`weapon.${def.weaponType}`) : t(`itemKind.${def.kind}`);
    subtitle = t('tip.equipSubtitle', { rarity: RARITY_NAMES[r], kind, tier: def.tier });
    const base = itemBonus({ id: stack.id, qty: 1, r });
    lines.push(...bonusLines(base));
    for (const [k, v] of stack.aff ?? []) lines.push({ text: `${signed(v)} ${affixName(k)}`, tone: 'affix' });
    if (def.weaponType) lines.push({ text: t('tip.weaponSchool', { school: t(`weapon.${def.weaponType}`) }), tone: 'dim' });
    if (opts.equipped) lines.push({ text: t('tip.equipped'), tone: 'gold' });
    else if (opts.compare !== undefined) {
      const diff = diffBonus(itemBonus(stack), opts.compare ? itemBonus(opts.compare) : { atk: 0, def: 0, hp: 0, stats: {} });
      const dl = bonusLines(diff).map((l) => ({ text: l.text, tone: (l.text.startsWith('+') ? 'good' : 'bad') as Tone }));
      if (dl.length) {
        lines.push({ text: opts.compare ? t('tip.vsEquipped') : t('tip.vsEmpty'), tone: 'dim' });
        lines.push(...dl);
      }
    }
  } else {
    subtitle = t('tip.itemSubtitle', { kind: t(`itemKind.${def.kind}`), tier: def.tier });
    const u = def.use;
    if (u?.heal) lines.push({ text: t('tip.heal', { n: u.heal }), tone: 'good' });
    if (u?.qi) lines.push({ text: t('tip.qi', { n: u.qi }), tone: 'info' });
    if (u?.cleanse) lines.push({ text: t('tip.cleanse'), tone: 'good' });
    if (u?.xp) lines.push({ text: t('tip.xp', { n: u.xp }), tone: 'gold' });
    if (u?.breakthrough) {
      const from = RANKS[u.breakthrough - 1]?.name ?? '?';
      const to = RANKS[u.breakthrough]?.name ?? '?';
      lines.push({ text: t('tip.breakthrough', { from, to }), tone: 'gold' });
    }
    if (u?.teach) {
      const sk = getSkill(u.teach);
      if (sk) {
        lines.push({ text: t('tip.teaches', { skill: sk.name }), tone: 'gold' });
        lines.push(...requirementLines(sk));
      }
    }
  }
  const footer: TipLine[] = [];
  if (stack.qty > 1) footer.push({ text: t('tip.qty', { n: stack.qty, max: def.stack }), tone: 'dim' });
  if (opts.price !== undefined) footer.push({ text: t('tip.price', { n: fmtInt(opts.price) }), tone: 'gold' });
  else {
    footer.push({ text: t('tip.value', { n: fmtInt(stackValue(stack)) }), tone: 'dim' });
    if (opts.sellMult !== undefined) footer.push({ text: t('tip.sellsFor', { n: fmtInt(sellPrice(stack, opts.sellMult)) }), tone: 'gold' });
  }
  return {
    glyph: itemIconName(def),
    item: def,
    itemRarity: r,
    glyphColor: def.color,
    title: def.name,
    titleColor: equip ? RARITY_COLORS[r] : NEUTRAL,
    subtitle,
    lines,
    desc: def.desc,
    footer,
  };
}

/** Gold an NPC pays for one unit. */
export function sellPrice(stack: ItemStack, sellMult: number): number {
  return Math.max(1, Math.floor(stackValue(stack) * sellMult));
}

export function requirementLines(def: SkillDef): TipLine[] {
  const out: TipLine[] = [];
  const parts: string[] = [RANKS[def.req.rank - 1]?.name ?? `Rank ${def.req.rank}`];
  for (const k of STAT_KEYS) {
    const v = def.req.stats?.[k];
    if (v) parts.push(`${statName(k)} ${v}`);
  }
  out.push({ text: t('tip.requires', { list: parts.join(', ') }), tone: 'warn' });
  return out;
}

export function effectLine(e: SkillEffect): TipLine {
  const chance = Math.round(e.chance * 100);
  const pct = Math.round(e.power * 100);
  switch (e.kind) {
    case 'guard':
      return { text: t('tip.fx.guard', { p: pct, dur: e.dur }), tone: 'info' };
    case 'buffAtk':
      return { text: t('tip.fx.buffAtk', { p: pct, dur: e.dur }), tone: 'info' };
    case 'buffDef':
      return { text: t('tip.fx.buffDef', { p: pct, dur: e.dur }), tone: 'info' };
    case 'lifesteal':
      return { text: t('tip.fx.lifesteal', { p: pct }), tone: 'good' };
    case 'qiDrain':
      return { text: t('tip.fx.qiDrain', { n: e.power }), tone: 'info' };
    case 'cleanse':
      return { text: t('tip.fx.cleanse'), tone: 'good' };
    case 'slow':
      return { text: t('tip.fx.slow', { c: chance, p: pct, dur: e.dur }), tone: 'warn' };
    default:
      return { text: t('tip.fx.status', { c: chance, status: t(`status.${e.kind}`), dur: e.dur }), tone: 'warn' };
  }
}

export function passiveLines(p: PassiveBonus): TipLine[] {
  const out: TipLine[] = [];
  const pct = (v: number) => fmtNum(v * 100, 1);
  if (p.maxHp) out.push({ text: t('tip.p.maxHp', { p: pct(p.maxHp) }), tone: 'good' });
  if (p.maxQi) out.push({ text: t('tip.p.maxQi', { p: pct(p.maxQi) }), tone: 'good' });
  if (p.atk) out.push({ text: t('tip.p.atk', { p: pct(p.atk) }), tone: 'good' });
  if (p.def) out.push({ text: t('tip.p.def', { p: pct(p.def) }), tone: 'good' });
  if (p.speed) out.push({ text: t('tip.p.speed', { p: pct(p.speed) }), tone: 'good' });
  if (p.qiRegen) out.push({ text: t('tip.p.qiRegen', { p: pct(p.qiRegen) }), tone: 'good' });
  if (p.crit) out.push({ text: t('tip.p.crit', { n: p.crit }), tone: 'good' });
  if (p.dodge) out.push({ text: t('tip.p.dodge', { n: p.dodge }), tone: 'good' });
  if (p.antiBlight) out.push({ text: t('tip.p.antiBlight', { p: pct(p.antiBlight) }), tone: 'good' });
  if (p.lifesteal) out.push({ text: t('tip.p.lifesteal', { p: pct(p.lifesteal) }), tone: 'good' });
  if (p.resist) out.push({ text: t('tip.p.resist', { p: pct(p.resist) }), tone: 'good' });
  if (p.flee) out.push({ text: t('tip.p.flee', { n: p.flee }), tone: 'good' });
  return out;
}

export function skillTipModel(id: string, level?: number, opts: { showReq?: boolean } = {}): TipModel {
  const def = getSkill(id);
  if (!def) return { glyph: 'unknown', glyphColor: NEUTRAL, title: id, titleColor: NEUTRAL, subtitle: t('tip.unknownSkill'), lines: [], footer: [] };
  const lv = Math.max(1, level ?? 1);
  const lines: TipLine[] = [];
  const subtitle = t('tip.skillSubtitle', { school: t(`school.${def.school}`), kind: t(`skillKind.${def.kind}`), tier: def.tier });
  if (level !== undefined) lines.push({ text: t('tip.skillLevel', { lv, max: SKILL_MAX_LEVEL }), tone: 'gold' });
  if (def.kind === 'active') {
    if ((def.power ?? 0) > 0) {
      const p = Math.round(skillPower(def, lv) * 100);
      lines.push({ text: (def.hits ?? 1) > 1 ? t('tip.powerHits', { p, hits: def.hits! }) : t('tip.power', { p }) });
    }
    if (def.heal) lines.push({ text: t('tip.healPower', { x: fmtNum(def.heal * (1 + 0.05 * (lv - 1)), 2) }), tone: 'good' });
    lines.push({ text: t(`tip.target.${def.target ?? 'one'}`), tone: 'dim' });
    const qi = skillQiCost(def, lv);
    if ((def.qiCost ?? 0) > 0) lines.push({ text: t('tip.qiCost', { n: qi }), tone: 'info' });
    if (def.cooldown) lines.push({ text: t('tip.cooldown', { n: def.cooldown }), tone: 'dim' });
    for (const e of def.effects ?? []) lines.push(effectLine(e));
    if (def.weapon) lines.push({ text: t('tip.bestWith', { weapon: t(`weapon.${def.weapon}`) }), tone: 'dim' });
  }
  if (def.passive) lines.push(...passiveLines(def.passive));
  const footer: TipLine[] = [];
  if (opts.showReq !== false && def.req.gold > 0) {
    footer.push(...requirementLines(def));
    footer.push({ text: t('tip.tuition', { n: fmtInt(def.req.gold) }), tone: 'dim' });
  }
  return { glyph: skillIconName(def), glyphColor: '#d9b867', title: def.name, titleColor: '#e9d9a8', subtitle, lines, desc: def.desc, footer };
}

export function talentTipModel(id: string): TipModel {
  const def = TALENTS[id];
  if (!def) return { glyph: 'unknown', glyphColor: NEUTRAL, title: titleCase(id), titleColor: NEUTRAL, subtitle: '', lines: [], footer: [] };
  const lines: TipLine[] = [];
  for (const k of STAT_KEYS) {
    const v = def.mods[k];
    if (v) lines.push({ text: `${signed(v)} ${statName(k)}`, tone: v > 0 ? 'good' : 'bad' });
  }
  if (def.passive) lines.push(...passiveLines(def.passive));
  const color = def.positive ? '#7ec26b' : '#e8574a';
  return {
    glyph: def.positive ? 'sparkle' : 'warn',
    glyphColor: color,
    title: def.name,
    titleColor: color,
    subtitle: def.positive ? t('tip.talent') : t('tip.flaw'),
    lines,
    desc: def.desc,
    footer: [],
  };
}

/** Multiplier label for gear, e.g. Rare = x1.32. */
export function rarityMultLabel(r: number): string {
  return `×${RARITY_MULT[r] ?? 1}`;
}

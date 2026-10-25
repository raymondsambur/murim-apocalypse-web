/** Combat events and tactic rules in words. Pure. */
import { STANCE_INFO, getItem, getSkill, type CombatEvent, type Cond, type Act, type Stance, type StatusKind, type TacticRule } from '@murim/shared';
import { t } from '../../i18n';
import type { Tone } from './tips';

export interface CombatLine {
  text: string;
  tone: Tone | 'neutral';
}

export function skillName(id: string | undefined): string {
  if (!id || id === 'basic') return t('combat.basic');
  return getSkill(id)?.name ?? id;
}

export function itemNameOf(id: string): string {
  return getItem(id)?.name ?? id;
}

export function statusName(st: StatusKind): string {
  return t(`status.${st}`);
}

const BUFFS: StatusKind[] = ['guard', 'buffAtk', 'buffDef'];

/** Describe one combat event. `selfId` colours lines from the local player's point of view. */
export function describeCombatEvent(ev: CombatEvent, nameOf: (id: number) => string, selfId: number | null, allies: Set<number> = new Set()): CombatLine {
  const mine = (id: number) => id === selfId || allies.has(id);
  switch (ev.k) {
    case 'hit': {
      const key = ev.sk === 'basic' ? (ev.c ? 'combat.ev.strikeCrit' : 'combat.ev.strike') : ev.c ? 'combat.ev.hitCrit' : 'combat.ev.hit';
      return {
        text: t(key, { s: nameOf(ev.s), d: nameOf(ev.d), a: ev.a, skill: skillName(ev.sk) }),
        tone: mine(ev.d) ? 'bad' : mine(ev.s) ? 'good' : 'neutral',
      };
    }
    case 'miss':
      return { text: t('combat.ev.miss', { s: nameOf(ev.s), d: nameOf(ev.d), skill: skillName(ev.sk) }), tone: 'dim' };
    case 'heal':
      return {
        text: ev.sk ? t('combat.ev.healSkill', { d: nameOf(ev.d), a: ev.a, skill: skillName(ev.sk) }) : t('combat.ev.heal', { d: nameOf(ev.d), a: ev.a }),
        tone: mine(ev.d) ? 'good' : 'neutral',
      };
    case 'status':
      if (BUFFS.includes(ev.st)) return { text: t('combat.ev.buff', { d: nameOf(ev.d), status: statusName(ev.st) }), tone: 'info' };
      return { text: t('combat.ev.status', { d: nameOf(ev.d), status: statusName(ev.st) }), tone: mine(ev.d) ? 'bad' : 'warn' };
    case 'dot':
      return { text: t('combat.ev.dot', { d: nameOf(ev.d), a: ev.a, status: statusName(ev.st) }), tone: mine(ev.d) ? 'bad' : 'warn' };
    case 'use':
      return { text: t('combat.ev.use', { s: nameOf(ev.s), skill: skillName(ev.sk) }), tone: 'gold' };
    case 'item':
      return { text: t('combat.ev.item', { s: nameOf(ev.s), item: itemNameOf(ev.it) }), tone: 'info' };
    case 'guard':
      return { text: t('combat.ev.guard', { s: nameOf(ev.s) }), tone: 'info' };
    case 'flee':
      return { text: t(ev.ok ? 'combat.ev.fleeOk' : 'combat.ev.fleeFail', { s: nameOf(ev.s) }), tone: ev.ok ? 'warn' : 'dim' };
    case 'stun':
      return { text: t('combat.ev.stun', { s: nameOf(ev.s) }), tone: mine(ev.s) ? 'bad' : 'warn' };
    case 'down':
      return { text: t('combat.ev.down', { d: nameOf(ev.d) }), tone: mine(ev.d) ? 'bad' : 'good' };
  }
}

export function describeCond(c: Cond): string {
  switch (c.k) {
    case 'always':
      return t('tactic.cond.always');
    case 'targetBlighted':
      return t('tactic.cond.targetBlighted');
    default:
      return t(`tactic.cond.${c.k}`, { v: c.v });
  }
}

export function describeAct(a: Act): string {
  switch (a.k) {
    case 'skill':
      return t('tactic.act.skill', { skill: skillName(a.id) });
    case 'item':
      return t('tactic.act.item', { item: itemNameOf(a.id) });
    default:
      return t(`tactic.act.${a.k}`);
  }
}

export function describeTactic(r: TacticRule): string {
  return t('tactic.rule', { cond: describeCond(r.cond), act: describeAct(r.act) });
}

export function stanceName(s: Stance): string {
  return STANCE_INFO[s]?.name ?? s;
}

export const STATUS_GLYPH: Record<StatusKind, string> = {
  bleed: '血',
  poison: '毒',
  stun: '暈',
  slow: '緩',
  guard: '守',
  buffAtk: '攻',
  buffDef: '防',
  rot: '腐',
};

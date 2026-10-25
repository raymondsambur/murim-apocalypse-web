import { describe, expect, it } from 'vitest';
import { RARITY_COLORS, type CombatEvent, type TacticRule } from '@murim/shared';
import { describeAct, describeCombatEvent, describeCond, describeTactic, skillName } from './combat';
import { itemTipModel, passiveLines, requirementLines, sellPrice, skillTipModel, stackColor, talentTipModel } from './tips';

const names = (id: number) => ({ 1: 'Hero', 2: 'Wolf' })[id] ?? `#${id}`;

describe('item tooltips', () => {
  it('colours equipment by rarity and lists base stats plus affixes', () => {
    const m = itemTipModel({ id: 'w_sword_2', qty: 1, r: 3, aff: [['might', 4]] });
    expect(m.titleColor).toBe(RARITY_COLORS[3]);
    expect(m.subtitle).toContain('Epic');
    const text = m.lines.map((l) => l.text);
    expect(text.some((l) => /Attack/.test(l))).toBe(true);
    expect(m.lines.find((l) => /Might/.test(l.text))?.tone).toBe('affix');
    expect(text.join(' ')).toMatch(/sword/i);
  });

  it('compares with the equipped piece (green for better, red for worse)', () => {
    const better = itemTipModel({ id: 'w_sword_3', qty: 1, r: 0 }, { compare: { id: 'w_sword_1', qty: 1, r: 0 } });
    expect(better.lines.some((l) => l.tone === 'good')).toBe(true);
    const worse = itemTipModel({ id: 'w_sword_1', qty: 1, r: 0 }, { compare: { id: 'w_sword_3', qty: 1, r: 0 } });
    expect(worse.lines.some((l) => l.tone === 'bad')).toBe(true);
    const empty = itemTipModel({ id: 'o_1', qty: 1, r: 0 }, { compare: null });
    expect(empty.lines.some((l) => /empty slot/.test(l.text))).toBe(true);
  });

  it('describes consumables, breakthrough pills and manuals', () => {
    expect(itemTipModel({ id: 'pill_heal_s', qty: 3 }).lines[0].text).toMatch(/90 health/);
    expect(itemTipModel({ id: 'pill_break_1', qty: 1 }).lines.map((l) => l.text).join(' ')).toMatch(/Third-Rate → Second-Rate/);
    expect(itemTipModel({ id: 'manual_sword_cloud', qty: 1 }).lines.map((l) => l.text).join(' ')).toMatch(/Teaches Flowing Cloud Slash/);
  });

  it('shows quantity, value and buy / sell prices', () => {
    const stack = itemTipModel({ id: 'herb', qty: 5 }, { sellMult: 0.5 });
    expect(stack.footer.map((l) => l.text).join('|')).toMatch(/Quantity 5/);
    expect(stack.footer.map((l) => l.text).join('|')).toMatch(/Sells for 3 gold/);
    expect(itemTipModel({ id: 'herb', qty: 1 }, { price: 9 }).footer[0].text).toMatch(/Price: 9/);
    expect(sellPrice({ id: 'pill_heal_s', qty: 1 }, 0.5)).toBe(10);
    expect(sellPrice({ id: 'herb', qty: 1 }, 0.01)).toBe(1);
  });

  it('survives unknown ids', () => {
    expect(itemTipModel({ id: 'nope', qty: 1 }).subtitle).toMatch(/Unknown/);
    expect(stackColor({ id: 'nope', qty: 1 })).toBeTruthy();
  });
});

describe('skill and talent tooltips', () => {
  it('shows power, cost, cooldown, effects and requirements', () => {
    const m = skillTipModel('sword_plum', 3);
    const text = m.lines.map((l) => l.text).join('|');
    expect(text).toMatch(/Level 3/);
    expect(text).toMatch(/× 3 hits/);
    expect(text).toMatch(/Costs \d+ Qi/);
    expect(text).toMatch(/Cooldown 4/);
    expect(m.footer.map((l) => l.text).join('|')).toMatch(/Requires: Second-Rate, Agility 14/);
  });

  it('describes status effects, passives and internal arts', () => {
    expect(skillTipModel('blade_wild').lines.map((l) => l.text).join('|')).toMatch(/40% chance to inflict Bleed/);
    expect(skillTipModel('int_dantian').lines.map((l) => l.text).join('|')).toMatch(/\+15% maximum Qi/);
    expect(passiveLines({ crit: 3, flee: 8 }).map((l) => l.text)).toEqual(['+3 critical chance', '+8 flee chance']);
    expect(requirementLines(({ req: { rank: 1, gold: 5 } } as never))[0].text).toMatch(/Third-Rate/);
  });

  it('tints talents by polarity', () => {
    expect(talentTipModel('iron_bones').titleColor).toBe('#7ec26b');
    expect(talentTipModel('cursed_meridians').subtitle).toBe('Flaw');
    expect(talentTipModel('cursed_meridians').lines.some((l) => l.tone === 'bad')).toBe(true);
  });
});

describe('combat log text', () => {
  it('names skills, including the basic strike and monster skills', () => {
    expect(skillName('basic')).toBe('Strike');
    expect(skillName('fist_iron')).toBe('Iron Palm Strike');
    expect(skillName('m_bite')).toBe('Bite');
    expect(skillName('mystery')).toBe('mystery');
  });

  it('tells hits from the player point of view', () => {
    const hit: CombatEvent = { k: 'hit', s: 1, d: 2, a: 12, sk: 'fist_iron' };
    expect(describeCombatEvent(hit, names, 1)).toEqual({ text: 'Hero hits Wolf with Iron Palm Strike for 12.', tone: 'good' });
    const taken: CombatEvent = { k: 'hit', s: 2, d: 1, a: 7, c: 1, sk: 'basic' };
    const line = describeCombatEvent(taken, names, 1);
    expect(line.tone).toBe('bad');
    expect(line.text).toMatch(/critical strike/);
  });

  it('covers every event kind without throwing', () => {
    const evs: CombatEvent[] = [
      { k: 'miss', s: 1, d: 2, sk: 'basic' },
      { k: 'heal', s: 1, d: 1, a: 5 },
      { k: 'heal', s: 1, d: 1, a: 5, sk: 'med_mend' },
      { k: 'status', s: 2, d: 1, st: 'poison' },
      { k: 'status', s: 1, d: 1, st: 'guard' },
      { k: 'dot', d: 1, a: 3, st: 'bleed' },
      { k: 'use', s: 1, sk: 'sword_basic' },
      { k: 'item', s: 1, it: 'pill_heal_s' },
      { k: 'guard', s: 1 },
      { k: 'flee', s: 1, ok: true },
      { k: 'flee', s: 1, ok: false },
      { k: 'stun', s: 2 },
      { k: 'down', d: 2 },
    ];
    for (const e of evs) {
      const l = describeCombatEvent(e, names, 1);
      expect(l.text.length).toBeGreaterThan(3);
      expect(l.text).not.toMatch(/\{\w+\}/);
    }
  });

  it('writes tactic rules in words', () => {
    const rule: TacticRule = { cond: { k: 'hpBelow', v: 35 }, act: { k: 'item', id: 'pill_heal_s' } };
    expect(describeTactic(rule)).toBe('If Health below 35%, then Use Minor Healing Pill');
    expect(describeCond({ k: 'always' })).toBe('Always');
    expect(describeAct({ k: 'skill', id: 'sword_basic' })).toBe('Use Three-Strike Sword Form');
    expect(describeAct({ k: 'flee' })).toBe('Flee');
  });
});

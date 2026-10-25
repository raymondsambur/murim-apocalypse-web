import { describe, expect, it } from 'vitest';
import type { ActiveMission, CharacterSave, ItemStack, MeView, TacticRule } from '@murim/shared';
import { MockRefusal, checkAccept, checkBuild, checkTurnIn, refreshCollect } from '../../net/mockPanelsA';
import {
  MAX_TACTICS,
  addRule,
  brokenRules,
  clampCondValue,
  defaultAct,
  defaultCond,
  draftFromSave,
  emptyItemRules,
  firstEmptyActive,
  groupBySchool,
  itemChoices,
  learnedOfKind,
  moveRule,
  placeSkill,
  previewStats,
  reconcileDraft,
  removeRule,
  replaceRule,
  slotCount,
  validateDraft,
  withCondKind,
  withCondValue,
} from './build';
import { boardSettlement, compass, daysLeft, hintTo, progressFraction, progressText, sortActive, turnInSettlementId, urgency } from './missions';
import { menuSignature, offerGate, restNeeded, sellList } from './npc';

const rule = (k: string, v?: number, act: TacticRule['act'] = { k: 'basic' }): TacticRule => ({ cond: (v === undefined ? { k } : { k, v }) as TacticRule['cond'], act });

function save(over: Partial<CharacterSave> = {}): CharacterSave {
  return {
    id: 1,
    name: 'T',
    level: 1,
    skills: { sword_basic: { lv: 1, xp: 0 }, sword_cloud: { lv: 2, xp: 3 }, fist_iron: { lv: 1, xp: 0 }, int_dantian: { lv: 1, xp: 0 }, mov_light: { lv: 1, xp: 0 } },
    loadout: { active: ['sword_basic', 'sword_cloud', null, null], internal: 'int_dantian', movement: null },
    stance: 'balanced',
    tactics: [{ cond: { k: 'hpBelow', v: 35 }, act: { k: 'item', id: 'pill_heal_s' } }],
    inventory: [{ id: 'pill_heal_s', qty: 3 }],
    missions: [],
    stats: { might: 10, agility: 10, vitality: 10, spirit: 10, insight: 10, fortune: 10 },
    talents: [],
    equipment: { weapon: null, outfit: null, accessory: null },
    injuryUntil: 0,
    injuryStacks: 0,
    ...over,
  } as unknown as CharacterSave;
}

describe('loadout rules', () => {
  it('pads the active list to the slots of the rank and copies tactics', () => {
    const c = save();
    const d = draftFromSave(c);
    expect(d.loadout.active).toHaveLength(slotCount(1));
    expect(slotCount(1)).toBe(4);
    expect(slotCount(19)).toBe(5);
    expect(slotCount(37)).toBe(6);
    d.tactics[0].cond = { k: 'always' };
    expect(c.tactics[0].cond).toEqual({ k: 'hpBelow', v: 35 });
  });

  it('places a skill only in a slot of its kind and moves duplicates instead of copying them', () => {
    const d = draftFromSave(save());
    expect(placeSkill(d, { kind: 'active', slot: 2 }, 'int_dantian')).toBe(d);
    const moved = placeSkill(d, { kind: 'active', slot: 3 }, 'sword_basic');
    expect(moved.loadout.active).toEqual([null, 'sword_cloud', null, 'sword_basic']);
    const swapped = placeSkill(d, { kind: 'active', slot: 1 }, 'sword_basic');
    expect(swapped.loadout.active.slice(0, 2)).toEqual(['sword_cloud', 'sword_basic']);
    expect(placeSkill(d, { kind: 'movement' }, 'mov_light').loadout.movement).toBe('mov_light');
    expect(placeSkill(d, { kind: 'internal' }, null).loadout.internal).toBeNull();
    expect(firstEmptyActive(d.loadout)).toBe(2);
  });

  it('drops forgotten skills and resizes when reconciling', () => {
    const c = save();
    const d = placeSkill(draftFromSave(c), { kind: 'active', slot: 2 }, 'fist_iron');
    delete c.skills.fist_iron;
    expect(reconcileDraft(d, c).loadout.active[2]).toBeNull();
    c.level = 19;
    expect(reconcileDraft(d, c).loadout.active).toHaveLength(5);
  });

  it('groups learned arts by school and lists by kind', () => {
    const groups = groupBySchool(save().skills);
    expect(groups.map((g) => g.school)).toEqual(['sword', 'fist', 'internal', 'movement']);
    expect(groups[0].skills.map((s) => s.def.id)).toEqual(['sword_cloud', 'sword_basic']);
    expect(learnedOfKind(save().skills, 'active').map((s) => s.id)).toContain('fist_iron');
    expect(learnedOfKind(save().skills, 'movement').map((s) => s.id)).toEqual(['mov_light']);
  });

  it('previews passives of the draft loadout against the saved one', () => {
    const c = save();
    const d = placeSkill(draftFromSave(c), { kind: 'movement' }, 'mov_light');
    const rows = previewStats(c, d, 0);
    const dodge = rows.find((r) => r.key === 'dodge')!;
    expect(dodge.after).toBeGreaterThan(dodge.before);
    expect(previewStats(c, draftFromSave(c), 0).every((r) => r.after === r.before)).toBe(true);
  });
});

describe('tactic editing', () => {
  it('adds up to the maximum, removes and reorders without touching the input', () => {
    let rules: TacticRule[] = [];
    for (let i = 0; i < 9; i++) rules = addRule(rules, rule('always'));
    expect(rules).toHaveLength(MAX_TACTICS);
    const base = [rule('hpBelow', 10), rule('qiBelow', 20), rule('always')];
    expect(moveRule(base, 0, 1).map((r) => r.cond.k)).toEqual(['qiBelow', 'hpBelow', 'always']);
    expect(moveRule(base, 0, -1).map((r) => r.cond.k)).toEqual(['hpBelow', 'qiBelow', 'always']);
    expect(removeRule(base, 1).map((r) => r.cond.k)).toEqual(['hpBelow', 'always']);
    expect(replaceRule(base, 2, rule('targetBlighted'))[2].cond.k).toBe('targetBlighted');
    expect(base[2].cond.k).toBe('always');
  });

  it('changes condition kinds keeping or defaulting the value, and clamps to the server range', () => {
    expect(withCondKind(rule('hpBelow', 60), 'qiBelow').cond).toEqual({ k: 'qiBelow', v: 60 });
    expect(withCondKind(rule('hpBelow', 60), 'always').cond).toEqual({ k: 'always' });
    expect(withCondKind(rule('always'), 'enemiesAtLeast').cond).toEqual({ k: 'enemiesAtLeast', v: 2 });
    expect(withCondKind(rule('hpBelow', 90), 'enemiesAtLeast').cond).toEqual({ k: 'enemiesAtLeast', v: 20 });
    expect(withCondValue(rule('hpBelow', 10), 250).cond).toEqual({ k: 'hpBelow', v: 100 });
    expect(withCondValue(rule('always'), 5).cond).toEqual({ k: 'always' });
    expect(clampCondValue('enemiesAtLeast', 0)).toBe(1);
    expect(clampCondValue('hpBelow', 33.6)).toBe(34);
    expect(defaultCond('targetBlighted')).toEqual({ k: 'targetBlighted' });
  });

  it('offers only loadout skills and combat consumables', () => {
    const inv: ItemStack[] = [{ id: 'pill_heal_s', qty: 1 }, { id: 'pill_break_1', qty: 1 }, { id: 'herb', qty: 4 }, { id: 'pill_heal_s', qty: 2 }];
    expect(itemChoices(inv, [])).toEqual(['pill_heal_s']);
    expect(itemChoices([], [rule('always', undefined, { k: 'item', id: 'antidote' })])).toEqual(['antidote']);
    const d = draftFromSave(save());
    expect(defaultAct('skill', d.loadout, inv, [])).toEqual({ k: 'skill', id: 'sword_basic' });
    expect(defaultAct('item', d.loadout, inv, [])).toEqual({ k: 'item', id: 'pill_heal_s' });
    expect(defaultAct('guard', d.loadout, inv, [])).toEqual({ k: 'guard' });
  });

  it('validates like the server', () => {
    const c = save();
    const ok = draftFromSave(c);
    expect(validateDraft(c, ok)).toEqual([]);
    expect(validateDraft(c, { ...ok, tactics: Array(7).fill(rule('always')) })).toContain('build.err.tooMany');
    expect(validateDraft(c, { ...ok, tactics: [rule('hpBelow', 101)] })).toContain('build.err.cond');
    expect(validateDraft(c, { ...ok, tactics: [rule('hpBelow', 5.5)] })).toContain('build.err.cond');
    expect(validateDraft(c, { ...ok, tactics: [rule('always', undefined, { k: 'skill', id: 'fist_iron' })] })).toContain('build.err.tacticSkill');
    expect(validateDraft(c, { ...ok, tactics: [rule('always', undefined, { k: 'item', id: 'pill_break_1' })] })).toContain('build.err.tacticItem');
    expect(validateDraft(c, { ...ok, loadout: { ...ok.loadout, active: ['sword_basic', 'sword_basic', null, null] } })).toContain('build.err.dupe');
    expect(validateDraft(c, { ...ok, loadout: { ...ok.loadout, internal: 'sword_basic' } })).toContain('build.err.skill');
    expect(validateDraft(c, { ...ok, loadout: { ...ok.loadout, active: ['sword_basic', null, null, null, 'sword_cloud'] } })).toContain('build.err.slots');
    expect(brokenRules({ ...ok, tactics: [rule('always', undefined, { k: 'skill', id: 'fist_iron' }), rule('always')] })).toEqual([0]);
    expect(emptyItemRules(ok, [])).toEqual([0]);
  });

  it('mock server build check agrees with the rules above', () => {
    const c = save();
    const msg = (over: object) => ({ t: 'build' as const, ...draftFromSave(c), ...over });
    expect(checkBuild(c, msg({})).loadout.active[0]).toBe('sword_basic');
    expect(() => checkBuild(c, msg({ stance: 'wild' }))).toThrow(MockRefusal);
    expect(() => checkBuild(c, msg({ tactics: [rule('always', undefined, { k: 'skill', id: 'fist_iron' })] }))).toThrow(/loadout/);
  });
});

describe('mission wording and places', () => {
  const m = (o: Partial<ActiveMission> = {}): ActiveMission => ({ id: 'a', type: 'hunt', title: 'T', desc: '', settlementId: 1, target: { monster: 'wolf', count: 5 }, minRank: 1, level: 3, reward: { xp: 1, gold: 1 }, expires: 20, progress: 2, acceptedDay: 10, done: false, ...o });

  it('progress text and fraction', () => {
    expect(progressText(m())).toBe('2 / 5');
    expect(progressText(m({ progress: 9 }))).toBe('5 / 5');
    expect(progressText(m({ done: true, progress: 3 }))).toBe('5 / 5');
    expect(progressFraction(m())).toBeCloseTo(0.4);
    expect(progressFraction(m({ done: true }))).toBe(1);
  });

  it('time left in world days', () => {
    expect(daysLeft(20, 15)).toBe(5);
    expect(daysLeft(20, 25)).toBe(0);
    expect(urgency(0)).toBe('last');
    expect(urgency(1)).toBe('soon');
    expect(urgency(3)).toBe('ok');
  });

  it('hand-in place and hints', () => {
    expect(turnInSettlementId(m())).toBe(1);
    expect(turnInSettlementId(m({ type: 'deliver', target: { item: 'herb', count: 1, toSettlement: 4 } }))).toBe(4);
    expect(compass(10, 0)).toBe('east');
    expect(compass(0, -10)).toBe('north');
    expect(compass(-5, 5)).toBe('south-west');
    const s = { id: 1, name: 'Greenreed', x: 100, y: 100, radius: 10 } as never;
    expect(hintTo(s, { x: 100, y: 150 })).toMatchObject({ dist: 50, dir: 'north', here: false });
    expect(hintTo(s, { x: 105, y: 100 }).here).toBe(true);
  });

  it('sorts ready missions first and finds the board in range', () => {
    const list = [m({ id: 'a', title: 'B', expires: 30 }), m({ id: 'b', title: 'A', expires: 12, done: false }), m({ id: 'c', title: 'C', done: true, expires: 40 })];
    expect(sortActive(list, 10).map((x) => x.id)).toEqual(['c', 'b', 'a']);
    const towns = [{ id: 1, name: 'A', x: 0, y: 0, radius: 10 }, { id: 2, name: 'B', x: 100, y: 0, radius: 10 }] as never[];
    expect(boardSettlement(towns, { x: 14, y: 0 })?.id).toBe(1);
    expect(boardSettlement(towns, { x: 50, y: 0 })).toBeNull();
    expect(boardSettlement(towns, null)).toBeNull();
  });
});

describe('npc dialog fixes', () => {
  const me = (c: Partial<CharacterSave>): MeView => ({ c: save(c), d: {}, xpNext: 1, entityId: 1, combatId: null, sect: null, master: null, disciples: [], now: 0 }) as unknown as MeView;
  const offer = (o: object) => ({ id: 'o', type: 'hunt', minRank: 1, ...o }) as never;

  it('one bounty at a time', () => {
    const active = [{ id: 'x', type: 'bounty' }] as never;
    expect(offerGate(offer({ id: 'b', type: 'bounty' }), me({ missions: active })).reason).toBe('npc.mission.oneBounty');
    expect(offerGate(offer({ id: 'h' }), me({ missions: active })).ok).toBe(true);
  });

  it('never lists manuals for sale and rests when injured', () => {
    const inv: ItemStack[] = [{ id: 'pill_heal_s', qty: 1 }, { id: 'herb', qty: 1 }];
    expect(sellList(inv, 0.5).length).toBe(2);
    expect(restNeeded({ hp: 10, maxHp: 10, qi: 5, maxQi: 5 }, 0, 0, 100)).toBe(false);
    expect(restNeeded({ hp: 10, maxHp: 10, qi: 5, maxQi: 5 }, 1, 200, 100)).toBe(true);
    expect(restNeeded({ hp: 9, maxHp: 10, qi: 5, maxQi: 5 }, 0, 0, 100)).toBe(true);
  });

  it('menu signature changes with gold, bag and missions only', () => {
    const a = menuSignature(me({ gold: 5, reputation: {} }));
    expect(menuSignature(me({ gold: 5, reputation: {} }))).toBe(a);
    expect(menuSignature(me({ gold: 6, reputation: {} }))).not.toBe(a);
    expect(menuSignature(me({ gold: 5, reputation: {}, inventory: [{ id: 'herb', qty: 1 }] }))).not.toBe(a);
  });
});

describe('mock mission rules', () => {
  it('accept refusals use the server codes', () => {
    const c = save({ level: 1 });
    const o = { id: 'o', type: 'hunt', minRank: 2, settlementId: 1, target: { count: 1 } } as never;
    expect(() => checkAccept(c, undefined)).toThrow(/gone/);
    try {
      checkAccept(c, o);
    } catch (e) {
      expect((e as MockRefusal).code).toBe('rank_low');
    }
    c.missions = Array.from({ length: 6 }, (_, i) => ({ id: `m${i}`, type: 'hunt' })) as never;
    try {
      checkAccept(c, { ...(o as object), minRank: 1 } as never);
    } catch (e) {
      expect((e as MockRefusal).code).toBe('too_many');
    }
  });

  it('gather progress follows the bag and hand-in needs the right taker', () => {
    const m = { id: 'g', type: 'gather', settlementId: 1, target: { item: 'herb', count: 3 }, progress: 0, done: false } as unknown as ActiveMission;
    const c = save({ missions: [m], inventory: [{ id: 'herb', qty: 2 }] });
    refreshCollect(c);
    expect(m.progress).toBe(2);
    expect(() => checkTurnIn(c, m, { role: 'elder', settlementId: 1 })).toThrow(/missing 1/);
    c.inventory = [{ id: 'herb', qty: 3 }];
    expect(() => checkTurnIn(c, m, { role: 'smith', settlementId: 1 })).toThrow(/Nobody/);
    expect(() => checkTurnIn(c, m, { role: 'guard', settlementId: 2 })).toThrow(/Nobody/);
    expect(() => checkTurnIn(c, m, { role: 'guard', settlementId: 1 })).not.toThrow();
  });
});

// The panels register their strings with addStrings(); check every key they (or their logic) use is defined there.
const PANEL_SRC = import.meta.glob(['../panels/skills.ts', '../panels/missions.ts', './build.ts', './missions.ts'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

describe('panel strings', () => {
  const skills = Object.entries(PANEL_SRC).find(([f]) => f.endsWith('panels/skills.ts'))![1];
  const missions = Object.entries(PANEL_SRC).find(([f]) => f.endsWith('panels/missions.ts'))![1];
  const defined = (src: string) => new Set([...src.matchAll(/^\s{2}'((?:sk|ms|build)\.[A-Za-z0-9.-]+)':/gm)].map((m) => m[1]));
  const all = new Set([...defined(skills), ...defined(missions)]);

  it('defines every literal sk./ms./build. key used', () => {
    const used = new Set<string>();
    for (const src of Object.values(PANEL_SRC)) for (const m of src.matchAll(/['"`]((?:sk|ms|build)\.[A-Za-z0-9.-]+)['"`]/g)) used.add(m[1]);
    expect([...used].filter((k) => !all.has(k) && !all.has(`${k}.one`))).toEqual([]);
  });

  it('defines the dynamic key families', () => {
    const families: Record<string, string[]> = {
      'sk.tab': ['arts', 'loadout', 'stance', 'tactics'],
      'sk.cond': ['always', 'hpBelow', 'qiBelow', 'qiAbove', 'enemyHpBelow', 'enemiesAtLeast', 'targetBlighted'],
      'sk.act': ['skill', 'item', 'guard', 'flee', 'basic'],
      'ms.obj': ['hunt', 'gather', 'deliver', 'purify', 'defend', 'bounty', 'investigate', 'sect'],
      'ms.dir': ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'],
      'ms.days': ['one', 'other'],
      'build.err': ['slots', 'dupe', 'skill', 'stance', 'tooMany', 'cond', 'tacticSkill', 'tacticItem'],
    };
    const missing: string[] = [];
    for (const [p, names] of Object.entries(families)) for (const n of names) if (!all.has(`${p}.${n}`)) missing.push(`${p}.${n}`);
    expect(missing).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import { OFFLINE_CAP_MS, type ChronicleEntry, type FriendView, type SiteView } from '@murim/shared';
import { CRAFT_RANGE, craftProgress, elapsedInfo, maxCraftQty, recipeAffordability, shiftEstimate, siteModel, trainXpPerHour } from './jobs';
import { QueryCache } from './queryCache';
import { foundGate, groupFriends, masterEligibility, memberActions, sectPerms, sectXpBonus, teachableSkills, validateSectName, validateSectTag } from './social';
import { CHRONICLE_PAGE, filterChronicle, groupByDay, mergeChronicle, oldestId, pageChronicle, sortSettlements, blightLevel, factionRows, NO_FILTER } from './world';

const entry = (id: number, o: Partial<ChronicleEntry> = {}): ChronicleEntry => ({ id, day: Math.floor(id / 4), hour: id % 24, kind: 'faction', text: `e${id}`, importance: 1, t: id, ...o });

describe('jobs: timing and estimates', () => {
  it('clamps elapsed time to the 8 hour cap', () => {
    const a = { since: 1000 };
    expect(elapsedInfo(a, 1000 + 3_600_000)).toMatchObject({ workedMs: 3_600_000, capped: false, remainingMs: OFFLINE_CAP_MS - 3_600_000 });
    expect(elapsedInfo(a, 1000 + OFFLINE_CAP_MS + 5000)).toMatchObject({ workedMs: OFFLINE_CAP_MS, capped: true, remainingMs: 0 });
    expect(elapsedInfo(a, 0).workedMs).toBe(0);
  });

  it('estimates shift output from shiftYieldPerHour with the season multiplier', () => {
    const spring = shiftEstimate('farmer', 1, 0, 3_600_000); // grain (10 + 2) x 1.0
    expect(spring.items[0][0]).toBe('grain');
    expect(spring.items[0][1]).toBeCloseTo(12);
    const winter = shiftEstimate('farmer', 1, 3, 3_600_000); // x 0.25
    expect(winter.items[0][1]).toBeCloseTo(3);
    expect(spring.gold).toBe(10);
    const half = shiftEstimate('miner', 5, 0, 1_800_000);
    expect(half.items[0][1]).toBeCloseTo((4 + 6) / 2);
    expect(shiftEstimate('blacksmith', 1, 0, 3_600_000).items).toEqual([]);
  });

  it('training xp per hour doubles up at a dojo', () => {
    expect(trainXpPerHour(10, 5, false)).toBe(37);
    expect(trainXpPerHour(10, 5, true)).toBe(55.5);
  });

  it('tracks craft progress between settles', () => {
    const a = { kind: 'craft' as const, recipe: 'r_heal_s', remaining: 3, since: 0, settled: 0, site: 's' };
    const p = craftProgress(a, 25_000)!; // 20 s per unit
    expect(p.done).toBe(1);
    expect(p.remaining).toBe(2);
    expect(p.unit).toBeCloseTo(0.25);
    expect(craftProgress({ ...a, recipe: 'nope' }, 1)).toBeNull();
  });
});

describe('jobs: recipes and sites', () => {
  const recipe = { inputs: [['herb', 3]] as [string, number][], seconds: 20 };
  it('counts what the bag supports', () => {
    const inv = [{ id: 'herb', qty: 7 }, { id: 'herb', qty: 3 }];
    expect(recipeAffordability(recipe, inv, 1)).toMatchObject({ maxByItems: 3, max: 3, missing: [] });
    expect(recipeAffordability(recipe, inv, 4).missing).toEqual([{ id: 'herb', need: 12, have: 10 }]);
    expect(recipeAffordability(recipe, [], 1).max).toBe(0);
  });
  it('limits batches by the 8 hour window and 20 units', () => {
    expect(maxCraftQty(10)).toBe(20);
    expect(maxCraftQty(1800)).toBe(16);
    expect(maxCraftQty(3600 * 9)).toBe(0);
    expect(recipeAffordability({ inputs: [['herb', 1]], seconds: 1800 }, [{ id: 'herb', qty: 99 }]).max).toBe(16);
  });
  it('explains why a site cannot be used', () => {
    const farm: SiteView = { id: 'f', kind: 'farm', x: 10, y: 10, settlementId: 0, job: 'farmer' };
    expect(siteModel(farm, { x: 11, y: 10 }, false, false)).toMatchObject({ inRange: true, blocked: null, action: { kind: 'shift', job: 'farmer' } });
    expect(siteModel(farm, { x: 20, y: 10 }, false, false).blocked).toMatchObject({ key: 'jobs.why.far', params: { n: 7 } });
    expect(siteModel(farm, { x: 11, y: 10 }, true, false).blocked?.key).toBe('jobs.why.busy');
    expect(siteModel(farm, { x: 11, y: 10 }, false, true).blocked?.key).toBe('jobs.why.combat');
    const dojo: SiteView = { id: 'd', kind: 'dojo', x: 0, y: 0, settlementId: 0, trainBonus: 1.5 };
    expect(siteModel(dojo, { x: 5, y: 0 }, false, false).action).toEqual({ kind: 'train' });
    const smithy: SiteView = { id: 's', kind: 'smithy', x: 0, y: 0, settlementId: 0, job: 'blacksmith' };
    expect(siteModel(smithy, { x: 30, y: 0 }, false, false)).toMatchObject({ action: { kind: 'craft', job: 'blacksmith' }, range: CRAFT_RANGE, blocked: null });
  });
});

describe('world: chronicle filtering and paging', () => {
  const list = Array.from({ length: 70 }, (_, i) => entry(i + 1, { kind: i % 2 ? 'blight' : 'faction', importance: ((i % 3) + 1) as 1 | 2 | 3, settlementId: i % 5 === 0 ? 2 : undefined }));
  it('filters by kind, importance and settlement, newest first', () => {
    const blight = filterChronicle(list, { ...NO_FILTER, kinds: new Set(['blight']) });
    expect(blight.every((e) => e.kind === 'blight')).toBe(true);
    expect(blight[0].id).toBeGreaterThan(blight[1].id);
    expect(filterChronicle(list, { ...NO_FILTER, minImportance: 3 }).every((e) => e.importance === 3)).toBe(true);
    expect(filterChronicle(list, { ...NO_FILTER, settlementId: 2 }).length).toBe(14);
  });
  it('pages in blocks and reports when more is available locally', () => {
    const p1 = pageChronicle(list, NO_FILTER, 1);
    expect(p1.shown).toHaveLength(CHRONICLE_PAGE);
    expect(p1.hasMoreLocal).toBe(true);
    const p3 = pageChronicle(list, NO_FILTER, 3);
    expect(p3.shown).toHaveLength(70);
    expect(p3.hasMoreLocal).toBe(false);
  });
  it('merges by id and finds the oldest id for the next page', () => {
    const merged = mergeChronicle([entry(5), entry(6)], [entry(4), entry(6, { text: 'new' })]);
    expect(merged.map((e) => e.id)).toEqual([4, 5, 6]);
    expect(merged[2].text).toBe('new');
    expect(oldestId(merged)).toBe(4);
    expect(oldestId([])).toBeUndefined();
    expect(mergeChronicle(list, [], 10)).toHaveLength(10);
  });
  it('groups by day', () => {
    const g = groupByDay([entry(9, { day: 3 }), entry(8, { day: 3 }), entry(2, { day: 1 })]);
    expect(g.map((x) => [x.day, x.entries.length])).toEqual([[3, 2], [1, 1]]);
  });
});

describe('world: settlements and factions', () => {
  const view = (status: 'thriving' | 'besieged' | 'fallen', prosperity: number, blight = 0) => ({ id: 0, controller: null, status, prosperity, population: 1, defense: 1, blight, siege: false, flags: [] });
  it('sorts besieged first by status and by prosperity on request', () => {
    const rows = [
      { name: 'B', view: view('thriving', 90) },
      { name: 'A', view: view('besieged', 10) },
      { name: 'C', view: view('fallen', 0) },
    ];
    expect(sortSettlements(rows, 'status').map((r) => r.name)).toEqual(['A', 'B', 'C']);
    expect(sortSettlements(rows, 'prosperity').map((r) => r.name)).toEqual(['B', 'A', 'C']);
    expect(sortSettlements(rows, 'name').map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });
  it('grades blight and attaches reputation titles', () => {
    expect(blightLevel(0).key).toBe('clean');
    expect(blightLevel(200).key).toBe('severe');
    const rows = factionRows(
      [
        { id: 'a', power: 10, wealth: 1, influence: 1, atWarWith: [], alliedWith: [], settlements: [], goal: '' },
        { id: 'b', power: 50, wealth: 1, influence: 1, atWarWith: [], alliedWith: [], settlements: [], goal: '' },
      ],
      { a: 70 },
    );
    expect(rows.map((r) => r.brief.id)).toEqual(['b', 'a']);
    expect(rows[1]).toMatchObject({ rep: 70, repTitle: 'Trusted' });
    expect(rows[0].rep).toBe(0);
  });
});

describe('social: sect permissions', () => {
  it('matrix of top-level buttons', () => {
    expect(sectPerms('leader')).toEqual({ invite: true, motto: true, disband: true, leave: false, deposit: true });
    expect(sectPerms('elder')).toEqual({ invite: true, motto: false, disband: false, leave: true, deposit: true });
    expect(sectPerms('disciple')).toMatchObject({ invite: false, leave: true, deposit: true });
    expect(sectPerms('outer').invite).toBe(false);
    expect(sectPerms(null).deposit).toBe(false);
  });
  it('member actions follow the server rules', () => {
    const t = (role: 'leader' | 'elder' | 'disciple' | 'outer', id = 2) => ({ id, role });
    expect(memberActions('leader', 1, t('elder'))).toEqual({ kick: true, promoteTo: ['leader', 'disciple', 'outer'] });
    expect(memberActions('leader', 1, t('leader', 1))).toEqual({ kick: false, promoteTo: [] });
    expect(memberActions('elder', 1, t('disciple'))).toEqual({ kick: true, promoteTo: [] });
    expect(memberActions('elder', 1, t('elder'))).toEqual({ kick: false, promoteTo: [] });
    expect(memberActions('elder', 1, t('leader'))).toEqual({ kick: false, promoteTo: [] });
    expect(memberActions('disciple', 1, t('outer'))).toEqual({ kick: false, promoteTo: [] });
    expect(memberActions(null, 1, t('outer'))).toEqual({ kick: false, promoteTo: [] });
  });
  it('validates sect names and tags like the server', () => {
    expect(validateSectName('')).toBe('soc.val.nameRequired');
    expect(validateSectName('ab')).toBe('soc.val.nameShort');
    expect(validateSectName('x'.repeat(21))).toBe('soc.val.nameLong');
    expect(validateSectName('Bad!Name')).toBe('soc.val.nameChars');
    expect(validateSectName('  Azure   Dawn ')).toBeNull();
    expect(validateSectTag('A')).toBe('soc.val.tagBad');
    expect(validateSectTag('ABCDE')).toBe('soc.val.tagBad');
    expect(validateSectTag('A1')).toBe('soc.val.tagBad');
    expect(validateSectTag('Dawn')).toBeNull();
  });
  it('gates founding on rank 2 (level 10) and 500 gold', () => {
    expect(foundGate(9, 1000).ok).toBe(false);
    expect(foundGate(10, 499).unmet.map((u) => u.key)).toEqual(['soc.found.needGold']);
    expect(foundGate(10, 500).ok).toBe(true);
    expect(foundGate(1, 0).unmet).toHaveLength(2);
  });
  it('sect xp bonus is 2% per level up to 20%', () => {
    expect(sectXpBonus(3)).toBeCloseTo(0.06);
    expect(sectXpBonus(99)).toBeCloseTo(0.2);
  });
});

describe('social: friends and masters', () => {
  it('groups requests, friends (online first) and outgoing', () => {
    const f = (id: number, name: string, status: FriendView['status'], online = false): FriendView => ({ id, name, level: 1, online, status });
    const g = groupFriends([f(1, 'Zed', 'friend', true), f(2, 'Amy', 'friend'), f(3, 'Bob', 'in'), f(4, 'Cat', 'out'), f(5, 'Ann', 'friend', true)]);
    expect(g.friends.map((x) => x.name)).toEqual(['Ann', 'Zed', 'Amy']);
    expect(g.incoming.map((x) => x.name)).toEqual(['Bob']);
    expect(g.outgoing.map((x) => x.name)).toEqual(['Cat']);
  });
  it('rank decides who can be a disciple or a master', () => {
    expect(masterEligibility(1)).toBe('canBeDisciple');
    expect(masterEligibility(18)).toBe('canBeDisciple');
    expect(masterEligibility(19)).toBe('canBeMaster');
    expect(masterEligibility(40)).toBe('canBeMaster');
  });
  it('lists skills known at level 3 or more', () => {
    expect(teachableSkills({ a: { lv: 1, xp: 0 }, b: { lv: 5, xp: 0 }, c: { lv: 3, xp: 0 } }).map((s) => s.id)).toEqual(['b', 'c']);
  });
});

describe('QueryCache', () => {
  it('fetches once per key and refetches when stale or forced', async () => {
    let n = 0;
    const c = new QueryCache(async () => ++n);
    const wait = () => new Promise<void>((r) => c.ensure(r, 'a', 60_000));
    await wait();
    expect(c.data).toBe(1);
    c.ensure(() => {}, 'a', 60_000);
    expect(n).toBe(1);
    await new Promise<void>((r) => c.ensure(r, 'a', 60_000, true));
    expect(c.data).toBe(2);
    await new Promise<void>((r) => c.ensure(r, 'b', 60_000));
    expect(c.data).toBe(3);
  });
  it('keeps the error text and does not hammer a failing query', async () => {
    let n = 0;
    const c = new QueryCache<number>(
      async () => {
        n++;
        throw new Error('boom');
      },
      () => 'failed',
    );
    await new Promise<void>((r) => c.ensure(r));
    expect(c.error).toBe('failed');
    c.ensure(() => {});
    expect(n).toBe(1);
  });
});

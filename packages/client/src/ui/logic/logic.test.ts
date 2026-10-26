import { describe, expect, it } from 'vitest';
import type { ActiveMission, BuildingDef, CombatView, EntityView, ItemStack, MeView, MissionOffer, NpcMenu, SettlementDef } from '@murim/shared';
import type { ConnInfo } from '../../net/socket';
import type { ChatLine, ChatTabState, Invite } from '../../state/store';
import { breakthroughStatus, inventoryCount } from './breakthrough';
import { formatChatTime, maxKey, pushHistory, stepHistory, unreadSince, whisperParty } from './chat';
import { bannerSeconds, hasReward, mergeRewardItems, splitSides } from './combatView';
import { connectionView } from './connection';
import { contextActions, entityKindKey, quickAction, type ActionContext } from './interact';
import { freeSlots, nextSortMode, reconcileSelection, sortOrder, stackActions } from './inventory';
import { INVITE_TTL_MS, inviteReplies, isExpired } from './invites';
import { buyList, maxBuy, npcTabs, offerGate, sellList, turnInMissions } from './npc';
import { LANDMARK_ICON, nearbyLandmarks } from './world';

const ctx: ActionContext = { selfId: 1, selfDead: false, inCombat: false, sectRole: null };
const ent = (o: Partial<EntityView>): EntityView => ({ id: 9, kind: 'npc', name: 'X', x: 0, y: 0, face: 0, state: 'idle', ...o });

describe('context actions', () => {
  it('offers Talk for NPCs, Attack for monsters, Gather/Mine for nodes', () => {
    expect(contextActions(ent({ kind: 'npc' }), ctx).map((a) => a.id)).toEqual(['talk']);
    expect(contextActions(ent({ kind: 'monster' }), ctx).map((a) => a.id)).toEqual(['attack']);
    expect(contextActions(ent({ kind: 'node', nodeKind: 'ore' }), ctx)[0]).toMatchObject({ id: 'gather', label: 'act.mine' });
    expect(contextActions(ent({ kind: 'node', nodeKind: 'herb' }), ctx)[0].label).toBe('act.gather');
  });

  it('nameless townsfolk offer nothing and read as passers-by', () => {
    const t = ent({ kind: 'ambient', name: '', role: 'villager' });
    expect(contextActions(t, ctx)).toEqual([]);
    expect(quickAction(t, ctx)).toBeNull();
    expect(entityKindKey(t)).toBe('kind.passerby');
  });

  it('players get inspect / whisper / friend / duel, and sect invite only for leaders and elders', () => {
    const p = ent({ kind: 'player', online: true });
    expect(contextActions(p, ctx).map((a) => a.id)).toEqual(['inspect', 'whisper', 'friend', 'duel']);
    expect(contextActions(p, { ...ctx, sectRole: 'elder' }).map((a) => a.id)).toContain('sectInvite');
    expect(contextActions(p, { ...ctx, sectRole: 'disciple' }).map((a) => a.id)).not.toContain('sectInvite');
  });

  it('explains why an action is unavailable', () => {
    const wolf = ent({ kind: 'monster' });
    expect(contextActions(wolf, { ...ctx, inCombat: true })[0].disabled).toBe('act.whyInCombat');
    expect(contextActions(wolf, { ...ctx, selfDead: true })[0].disabled).toBe('act.whyDead');
    expect(contextActions(ent({ kind: 'monster', state: 'dead' }), ctx)[0].disabled).toBe('act.whyDown');
    const away = ent({ kind: 'player', online: false });
    expect(contextActions(away, ctx).find((a) => a.id === 'whisper')!.disabled).toBe('act.whyOffline');
  });

  it('lets you join someone else\'s fight', () => {
    const fighting = ent({ kind: 'monster', state: 'fight', combatId: 3 });
    expect(contextActions(fighting, ctx).map((a) => a.id)).toEqual(['attack', 'assist']);
  });

  it('quick action is the primary one when available; nothing for yourself', () => {
    expect(quickAction(ent({ kind: 'npc' }), ctx)?.id).toBe('talk');
    expect(quickAction(ent({ kind: 'monster' }), { ...ctx, inCombat: true })).toBeNull();
    expect(contextActions(ent({ id: 1, kind: 'player' }), ctx)).toEqual([]);
    expect(quickAction(ent({ kind: 'player' }), ctx)?.id).toBe('inspect');
  });

  it('kind labels', () => {
    expect(entityKindKey(ent({ kind: 'npc', role: 'smith' }))).toBe('role.smith');
    expect(entityKindKey(ent({ kind: 'monster', elite: 2 }))).toBe('kind.boss');
    expect(entityKindKey(ent({ kind: 'node', nodeKind: 'rareHerb' }))).toBe('node.rareHerb');
  });
});

describe('inventory logic', () => {
  const inv: ItemStack[] = [
    { id: 'herb', qty: 5 },
    { id: 'w_sword_1', qty: 1, r: 0 },
    { id: 'pill_heal_s', qty: 2 },
    { id: 'w_blade_3', qty: 1, r: 3 },
  ];

  it('sorts for display without touching the real order', () => {
    expect(sortOrder(inv, 'default')).toEqual([0, 1, 2, 3]);
    expect(sortOrder(inv, 'kind')).toEqual([3, 1, 2, 0]); // weapons (higher tier first), consumables, materials
    expect(sortOrder(inv, 'rarity')[0]).toBe(3);
    expect(sortOrder(inv, 'name')).toEqual([3, 1, 2, 0]); // Crescent Blade, Iron Jian, Minor Healing Pill, Qi-Gathering Grass
    expect(sortOrder(inv, 'value')[0]).toBe(3);
    expect(inv.map((s) => s.id)).toEqual(['herb', 'w_sword_1', 'pill_heal_s', 'w_blade_3']);
  });

  it('cycles sort modes', () => {
    expect(nextSortMode('default')).toBe('kind');
    expect(nextSortMode('name')).toBe('default');
  });

  it('classifies stacks', () => {
    expect(stackActions(inv[1]).equipSlot).toBe('weapon');
    expect(stackActions(inv[2])).toMatchObject({ usable: true, useLabel: 'inv.use' });
    expect(stackActions({ id: 'pill_break_1', qty: 1 })).toMatchObject({ usable: false, breakthroughPill: true });
    expect(stackActions({ id: 'manual_sword_cloud', qty: 1 }).useLabel).toBe('inv.study');
    expect(stackActions(inv[0])).toMatchObject({ usable: false, equipSlot: null });
  });

  it('keeps a selection through reshuffles and drops it when the item is gone', () => {
    expect(reconcileSelection(inv, { idx: 2, id: 'pill_heal_s' })).toEqual({ idx: 2, id: 'pill_heal_s' });
    expect(reconcileSelection(inv, { idx: 0, id: 'pill_heal_s' })).toEqual({ idx: 2, id: 'pill_heal_s' });
    expect(reconcileSelection(inv, { idx: 0, id: 'gone' })).toBeNull();
    expect(reconcileSelection(inv, null)).toBeNull();
    expect(freeSlots(38, 40)).toBe(2);
    expect(freeSlots(45, 40)).toBe(0);
  });
});

function meWith(level: number, over: Record<string, unknown> = {}): MeView {
  return {
    c: { level, xp: 0, gold: 0, inventory: [], missions: [], ...over },
    d: { total: { spirit: 10, insight: 10 } },
    xpNext: 100,
  } as unknown as MeView;
}

describe('breakthrough status', () => {
  it('is not applicable before the last stage of a rank', () => {
    const s = breakthroughStatus(meWith(4));
    expect(s.atPeak).toBe(false);
    expect(s.stagesLeft).toBe(5);
    expect(s.blockers).toEqual(['bt.need.peak']);
    expect(s.ready).toBe(false);
  });

  it('lists every missing requirement at stage 9', () => {
    const s = breakthroughStatus(meWith(9));
    expect(s.atPeak).toBe(true);
    expect(s.pill?.id).toBe('pill_break_1');
    expect(s.gold.need).toBe(100);
    expect(s.blockers).toEqual(['bt.need.xp', 'bt.need.pill', 'bt.need.gold']);
  });

  it('is ready with a full bar, the pill and the gold; chance follows Spirit and Insight', () => {
    const s = breakthroughStatus(meWith(9, { xp: 100, gold: 150, inventory: [{ id: 'pill_break_1', qty: 1 }] }));
    expect(s.ready).toBe(true);
    expect(s.chance).toBeCloseTo(0.8 + 10 * 0.004 + 10 * 0.006, 5);
    expect(s.nextRankName).toBe('Second-Rate');
  });

  it('is sealed beyond the playable ranks', () => {
    const s = breakthroughStatus(meWith(45, { xp: 100, gold: 99999 }));
    expect(s.sealed).toBe(true);
    expect(s.ready).toBe(false);
    expect(s.blockers).toEqual(['bt.need.sealed']);
    expect(inventoryCount([{ id: 'a', qty: 2 }, { id: 'a', qty: 3 }], 'a')).toBe(5);
  });
});

describe('npc logic', () => {
  const menu = (o: Partial<NpcMenu>): NpcMenu => ({ id: 1, name: 'N', role: 'villager', title: '', faction: null, settlementId: 0, look: {} as never, level: 1, greeting: '', turnIns: [], ...o });

  it('shows only the tabs an NPC offers', () => {
    expect(npcTabs(menu({}))).toEqual([]);
    expect(npcTabs(menu({ shop: { entries: [], sellMult: 0.5 }, restPrice: 10 }))).toEqual(['shop', 'rest']);
    expect(npcTabs(menu({ role: 'master', teaches: [{ skill: 'sword_basic', gold: 1, learned: false, ok: true }], disciple: { ok: true, already: false } }))).toEqual(['teach', 'missions', 'disciple']);
    expect(npcTabs(menu({ turnIns: ['m1'] }))).toEqual(['missions']);
    expect(npcTabs(menu({ role: 'elder' }))).toEqual(['missions']);
  });

  it('computes buy limits from gold and stock, and hides unknown items', () => {
    expect(maxBuy({ id: 'herb', price: 10, stock: null }, 95)).toBe(9);
    expect(maxBuy({ id: 'herb', price: 10, stock: 3 }, 95)).toBe(3);
    expect(maxBuy({ id: 'herb', price: 10, stock: 0 }, 95)).toBe(0);
    expect(maxBuy({ id: 'herb', price: 10, stock: null }, 5)).toBe(0);
    expect(maxBuy({ id: 'herb', price: 1, stock: null }, 100000)).toBe(99);
    expect(buyList([{ id: 'herb', price: 1, stock: null }, { id: 'ghost_item', price: 1, stock: null }]).map((e) => e.id)).toEqual(['herb']);
  });

  it('lists sellable stacks with unit prices and skips breakthrough pills', () => {
    const list = sellList([{ id: 'herb', qty: 4 }, { id: 'pill_break_1', qty: 1 }, { id: 'mystery', qty: 1 }], 0.5);
    expect(list.map((l) => l.stack.id)).toEqual(['herb']);
    expect(list[0].unit).toBe(3);
  });

  it('gates mission offers by acceptance, capacity and rank', () => {
    const offer = { id: 'o1', minRank: 2 } as MissionOffer;
    const me = (level: number, missions: Partial<ActiveMission>[]) => meWith(level, { missions });
    expect(offerGate(offer, me(1, []))).toMatchObject({ ok: false, reason: 'npc.mission.rank' });
    expect(offerGate(offer, me(10, []))).toEqual({ ok: true, accepted: false });
    expect(offerGate(offer, me(10, [{ id: 'o1' }]))).toMatchObject({ accepted: true, ok: false });
    expect(offerGate(offer, me(10, Array.from({ length: 6 }, (_, i) => ({ id: `x${i}` }))))).toMatchObject({ reason: 'npc.mission.full' });
    const m = { id: 'o1', done: true } as ActiveMission;
    expect(turnInMissions(menu({ turnIns: ['o1', 'zzz'] }), meWith(1, { missions: [m] }))).toEqual([m]);
  });
});

describe('chat logic', () => {
  const tab = (keys: number[], self = false): ChatTabState => ({ unread: 0, lines: keys.map((key) => ({ key, ch: 'local', from: 'A', text: '', t: 0, self }) as ChatLine) });
  const chat = { local: tab([1, 5, 9]), world: tab([2, 7]), sect: tab([]), whisper: tab([3], true), system: tab([4]) };

  it('counts unread lines from others since a key and finds the newest key', () => {
    expect(maxKey(chat)).toBe(9);
    expect(unreadSince(chat, 4)).toBe(3); // keys 5, 9 and 7 are newer; 1-4 are not
    expect(unreadSince(chat, 9)).toBe(0);
    expect(unreadSince({ ...chat, whisper: tab([20], true) }, 9)).toBe(0); // my own lines never count
  });

  it('keeps a bounded, de-duplicated send history and steps through it', () => {
    let h: string[] = [];
    h = pushHistory(h, 'a');
    h = pushHistory(h, 'a');
    h = pushHistory(h, '  ');
    h = pushHistory(h, 'b');
    expect(h).toEqual(['a', 'b']);
    expect(pushHistory(Array.from({ length: 30 }, (_, i) => String(i)), 'new')).toHaveLength(30);
    expect(stepHistory(h, 2, -1)).toEqual({ cursor: 1, text: 'b' });
    expect(stepHistory(h, 0, -1)).toEqual({ cursor: 0, text: 'a' });
    expect(stepHistory(h, 1, 1)).toEqual({ cursor: 2, text: '' });
  });

  it('works out who a whisper is with, and formats times', () => {
    const line = (o: Partial<ChatLine>) => ({ key: 1, ch: 'whisper', from: 'Zed', text: '', t: 0, ...o }) as ChatLine;
    expect(whisperParty(line({}), 'Me')).toEqual({ dir: 'from', other: 'Zed' });
    expect(whisperParty(line({ from: 'Me', to: 'Zed' }), 'Me')).toEqual({ dir: 'to', other: 'Zed' });
    expect(formatChatTime(new Date(2020, 0, 1, 7, 5).getTime())).toBe('07:05');
  });
});

describe('connection overlay state', () => {
  const c = (o: Partial<ConnInfo>): ConnInfo => ({ state: 'open', attempt: 0, ...o });
  it('shows loading until the first hello, then nothing while healthy', () => {
    expect(connectionView(c({ state: 'connecting' }), false, null)).toEqual({ kind: 'loading' });
    expect(connectionView(c({}), false, null)).toEqual({ kind: 'loading' });
    expect(connectionView(c({}), true, null)).toEqual({ kind: 'none' });
  });
  it('shows reconnecting with the attempt and delay', () => {
    expect(connectionView(c({ state: 'reconnecting', attempt: 3, retryIn: 2000 }), true, null)).toEqual({ kind: 'reconnecting', attempt: 3, retryIn: 2000 });
  });
  it('maps close reasons', () => {
    expect(connectionView(c({ state: 'closed', reason: 'replaced' }), true, null).kind).toBe('replaced');
    expect(connectionView(c({ state: 'closed', reason: 'auth' }), true, null).kind).toBe('auth');
    expect(connectionView(c({ state: 'closed', reason: 'banned' }), true, null).kind).toBe('banned');
    expect(connectionView(c({ state: 'closed', reason: 'kicked' }), true, 'afk')).toEqual({ kind: 'kicked', reason: 'afk' });
    expect(connectionView(c({ state: 'closed', reason: 'logout' }), true, null).kind).toBe('none');
    expect(connectionView(c({ state: 'closed' }), true, null).kind).toBe('failed');
  });
});

describe('invites', () => {
  const inv = (o: Partial<Invite>): Invite => ({ key: 1, kind: 'friend', fromId: 4, from: 'Zed', at: 1000, ...o });
  it('maps each kind to accept / decline messages', () => {
    expect(inviteReplies(inv({}))).toEqual({ accept: { t: 'friend', op: 'accept', id: 4 }, decline: { t: 'friend', op: 'decline', id: 4 } });
    expect(inviteReplies(inv({ kind: 'duel' })).accept).toEqual({ t: 'duel', op: 'accept', id: 4 });
    expect(inviteReplies(inv({ kind: 'master' })).decline).toEqual({ t: 'master', op: 'decline', id: 4 });
    expect(inviteReplies(inv({ kind: 'sect', data: { sect: 12 } })).accept).toEqual({ t: 'sect', op: 'accept', sect: 12 });
    expect(inviteReplies(inv({ kind: 'sect' }))).toEqual({ accept: null, decline: null });
  });
  it('expires after a minute', () => {
    expect(isExpired(inv({ at: 0 }), INVITE_TTL_MS - 1)).toBe(false);
    expect(isExpired(inv({ at: 0 }), INVITE_TTL_MS + 1)).toBe(true);
  });
});

describe('combat view helpers', () => {
  const view = { id: 1, beat: 1, x: 0, y: 0, duel: false, fighters: [{ id: 1, side: 1 }, { id: 2, side: 0 }, { id: 3, side: 1 }] } as unknown as CombatView;
  it('puts the player on the left whichever side they fight on', () => {
    const s = splitSides(view, 1);
    expect(s.mine.map((f) => f.id)).toEqual([1, 3]);
    expect(s.theirs.map((f) => f.id)).toEqual([2]);
    expect(splitSides(view, null).mine.map((f) => f.id)).toEqual([2]);
  });
  it('merges duplicate reward items and detects empty rewards', () => {
    expect(mergeRewardItems([{ id: 'herb', qty: 1 }, { id: 'herb', qty: 2 }, { id: 'fang', qty: 1 }])).toEqual([{ id: 'herb', qty: 3 }, { id: 'fang', qty: 1 }]);
    expect(hasReward({ xp: 0, gold: 0, items: [] })).toBe(false);
    expect(hasReward({ xp: 1, gold: 0, items: [] })).toBe(true);
    expect(hasReward(undefined)).toBe(false);
    expect(bannerSeconds('win')).toBeLessThan(bannerSeconds('lose'));
  });
});

describe('landmark rows for the World panel', () => {
  const set = (id: number, kind: SettlementDef['kind'], x: number, y: number, radius = 12): SettlementDef => ({ id, name: `Town ${id}`, kind, x, y, radius, climate: 1, spawn: { x, y }, buildingIds: [], sites: [], population: 5 });
  const b = (id: number, kind: BuildingDef['kind'], sid: number, x: number, y: number): BuildingDef => ({ id, kind, x, y, w: 3, d: 3, settlementId: sid, door: { x: x + 1, y: y + 3 } });
  const world = {
    settlements: [set(0, 'village', 50, 50), set(1, 'town', 150, 50), set(2, 'ruin', 100, 100)],
    buildings: [b(0, 'inn', 0, 52, 40), b(1, 'smithy', 0, 44, 55), b(2, 'house', 0, 48, 48), b(3, 'shrine', 1, 150, 40), b(4, 'hermitage', 1, 170, 60)],
    roads: [[0, 1]] as [number, number][],
  };

  it('picks the nearest living settlement (a ruin never counts) and lists its landmarks nearest first', () => {
    const here = nearbyLandmarks(world, 50, 52)!;
    expect(here.settlement.id).toBe(0);
    expect(here.inside).toBe(true);
    expect(here.away).toBe(0);
    const kinds = here.rows.map((r) => r.def.kind);
    expect(kinds).toContain('inn');
    expect(kinds).toContain('smithy');
    expect(kinds).not.toContain('house');
    for (let i = 1; i < here.rows.length; i++) expect(here.rows[i].dist).toBeGreaterThanOrEqual(here.rows[i - 1].dist);
    // the ruin lies closer to this point than the town, but is skipped
    const away = nearbyLandmarks(world, 105, 95)!;
    expect(away.settlement.id).not.toBe(2);
    expect(away.inside).toBe(false);
    expect(away.away).toBeGreaterThan(0);
  });

  it('has an icon for every landmark kind, and the beacon kinds are the same as the list kinds', () => {
    for (const k of Object.keys(LANDMARK_ICON)) expect(typeof LANDMARK_ICON[k as keyof typeof LANDMARK_ICON]).toBe('string');
    expect(Object.keys(LANDMARK_ICON).sort()).toEqual(['alchemy', 'barracks', 'dojo', 'gate', 'hall', 'hermitage', 'inn', 'market', 'pagoda', 'shrine', 'smithy', 'yard']);
  });

  it('returns null when there is nowhere to go', () => {
    expect(nearbyLandmarks({ settlements: [set(0, 'ruin', 0, 0)], buildings: [], roads: [] }, 1, 1)).toBeNull();
  });
});

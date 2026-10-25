import { describe, expect, it, vi } from 'vitest';
import type { CombatView, EntityView, MeView } from '@murim/shared';
import { CHAT_LIMIT, Store, patchEntity } from './store';

function ent(over: Partial<EntityView> = {}): EntityView {
  return { id: 7, kind: 'npc', name: 'Elder Mu', x: 10, y: 10, face: 0, state: 'idle', ...over };
}

function me(over: Partial<MeView> = {}): MeView {
  return { entityId: 1, combatId: null, c: { hp: 50, qi: 20, name: 'Hero', missions: [] }, d: { maxHp: 100, maxQi: 40 }, xpNext: 36, sect: null, master: null, disciples: [], now: 0, ...over } as unknown as MeView;
}

describe('patchEntity', () => {
  it('applies a walking patch and keeps the step data', () => {
    const e = ent();
    patchEntity(e, { id: 7, x: 10, y: 10, nx: 11, ny: 10, step: 300, state: 'walk', face: 0 });
    expect(e).toMatchObject({ x: 10, nx: 11, ny: 10, step: 300, state: 'walk' });
  });

  it('treats nx=x, ny=y, step=0 (the server stop convention) as standing still', () => {
    const e = ent({ nx: 11, ny: 10, step: 100, state: 'walk' });
    patchEntity(e, { id: 7, x: 11, y: 10, nx: 11, ny: 10, step: 0, state: 'idle' });
    expect(e.nx).toBeUndefined();
    expect(e.ny).toBeUndefined();
    expect(e.step).toBeUndefined();
    expect(e).toMatchObject({ x: 11, y: 10, state: 'idle' });
  });

  it('clears step data when only the position changes (teleport)', () => {
    const e = ent({ nx: 11, ny: 10, step: 100 });
    patchEntity(e, { id: 7, x: 40, y: 40 });
    expect(e.nx).toBeUndefined();
    expect(e.x).toBe(40);
  });

  it('removes optional fields patched with null', () => {
    const e = ent({ combatId: 4, tag: 'Azure' });
    patchEntity(e, { id: 7, combatId: null as unknown as undefined });
    expect(e.combatId).toBeUndefined();
    expect(e.tag).toBe('Azure');
  });
});

describe('Store entities', () => {
  it('adds, patches and deletes, and drops a selection that disappears', () => {
    const s = new Store();
    const seen = vi.fn();
    s.subscribe('selected', seen);
    s.applyEnts({ add: [ent(), ent({ id: 8, name: 'Guard' })] });
    s.set('selected', 8);
    seen.mockClear();
    s.applyEnts({ upd: [{ id: 8, hp: 3 }] });
    expect(s.get('entities').get(8)!.hp).toBe(3);
    s.applyEnts({ del: [8] });
    expect(s.get('entities').has(8)).toBe(false);
    expect(s.get('selected')).toBeNull();
    expect(seen).toHaveBeenCalled();
  });

  it('ignores patches for unknown ids and finds entities by name', () => {
    const s = new Store();
    s.applyEnts({ add: [ent({ kind: 'player', name: 'Moon Lotus' })] });
    s.applyEnts({ upd: [{ id: 999, hp: 1 }] });
    expect(s.entityByName('moon lotus', 'player')?.id).toBe(7);
    expect(s.entityByName('moon lotus', 'npc')).toBeUndefined();
  });

  it('hello resets the entity table', () => {
    const s = new Store();
    s.applyEnts({ add: [ent()] });
    s.applyHello({ you: me(), time: { hours: 8, day: 1, season: 0, year: 0, hourMs: 60000, t: 0, weather: [] }, settlements: [], chronicle: [], serverNow: Date.now() + 5000 });
    expect(s.get('entities').size).toBe(0);
    expect(s.selfId()).toBe(1);
    expect(s.serverNow() - Date.now()).toBeGreaterThan(4000);
  });
});

describe('Store chat', () => {
  it('counts unread on background tabs and clears them when the tab opens', () => {
    const s = new Store();
    s.addChat({ ch: 'world', from: 'A', text: 'hi', t: 1 });
    s.addChat({ ch: 'world', from: 'A', text: 'hi again', t: 2 });
    s.addChat({ ch: 'local', from: 'B', text: 'nearby', t: 3 });
    expect(s.get('chat').world.unread).toBe(2);
    expect(s.get('chat').local.unread).toBe(0); // local is the open tab
    s.setChatTab('world');
    expect(s.get('chat').world.unread).toBe(0);
  });

  it('does not count my own lines as unread and remembers the last whisperer', () => {
    const s = new Store();
    s.addChat({ ch: 'sect', from: 'Me', text: 'x', t: 1 }, { self: true });
    expect(s.get('chat').sect.unread).toBe(0);
    s.addChat({ ch: 'whisper', from: 'Zed', text: 'psst', t: 2 });
    expect(s.get('lastWhisper')).toBe('Zed');
  });

  it('keeps only the last 200 lines per tab with increasing keys', () => {
    const s = new Store();
    for (let i = 0; i < CHAT_LIMIT + 25; i++) s.addChat({ ch: 'local', from: 'A', text: String(i), t: i });
    const lines = s.get('chat').local.lines;
    expect(lines).toHaveLength(CHAT_LIMIT);
    expect(lines[0].text).toBe('25');
    expect(lines[1].key).toBeGreaterThan(lines[0].key);
  });
});

describe('Store combat', () => {
  const view = (id: number, beat: number): CombatView => ({
    id,
    beat,
    x: 0,
    y: 0,
    duel: false,
    fighters: [
      { id: 1, name: 'Hero', side: 0, lv: 1, hp: 80, maxHp: 100, qi: 10, maxQi: 20, status: [], player: true, alive: true, fled: false },
      { id: 9, name: 'Wolf', side: 1, lv: 2, hp: 30, maxHp: 50, qi: 0, maxQi: 0, status: ['bleed'], player: false, alive: true, fled: false },
    ],
  });

  it('accumulates the log, remembers names and prefers live vitals', () => {
    const s = new Store();
    s.applyHello({ you: me(), time: { hours: 1, day: 1, season: 0, year: 0, hourMs: 1000, t: 0, weather: [] }, settlements: [], chronicle: [], serverNow: Date.now() });
    s.applyCombat(view(3, 1), [{ k: 'hit', s: 1, d: 9, a: 5, sk: 'basic' }]);
    s.applyCombat(view(3, 2), [{ k: 'miss', s: 9, d: 1, sk: 'm_bite' }]);
    const c = s.get('combat')!;
    expect(c.log.map((l) => l.ev.k)).toEqual(['hit', 'miss']);
    expect(c.names[9]).toBe('Wolf');
    expect(s.selfVitals()).toEqual({ hp: 80, maxHp: 100, qi: 10, maxQi: 20 });
  });

  it('marks the fight ended, then clears it only for the matching id', () => {
    const s = new Store();
    s.applyCombat(view(3, 1), []);
    s.endCombat({ id: 3, result: 'win', text: 'done', reward: { xp: 10, gold: 2, items: [] } });
    expect(s.get('combat')!.ended?.result).toBe('win');
    expect(s.get('combatResult')!.id).toBe(3);
    s.clearCombat(99);
    expect(s.get('combat')).not.toBeNull();
    s.clearCombat(3);
    expect(s.get('combat')).toBeNull();
  });

  it('starts a fresh log when a new fight begins after an ended one', () => {
    const s = new Store();
    s.applyCombat(view(3, 1), [{ k: 'down', d: 9 }]);
    s.endCombat({ id: 3, result: 'win', text: '' });
    s.applyCombat(view(4, 1), []);
    expect(s.get('combat')!.log).toHaveLength(0);
    expect(s.get('combat')!.ended).toBeNull();
  });
});

describe('Store invites and missions', () => {
  it('keeps one pending invite per kind and sender', () => {
    const s = new Store();
    s.addInvite({ kind: 'friend', fromId: 5, from: 'A' });
    s.addInvite({ kind: 'friend', fromId: 5, from: 'A' });
    s.addInvite({ kind: 'duel', fromId: 5, from: 'A' });
    expect(s.get('invites')).toHaveLength(2);
    s.removeInvite(s.get('invites')[0].key);
    expect(s.get('invites')).toHaveLength(1);
  });

  it('merges mission updates into me', () => {
    const s = new Store();
    s.applyMe(me());
    const m = { id: 'm1', progress: 1, done: false } as never;
    s.applyMission(m);
    s.applyMission({ id: 'm1', progress: 3, done: true } as never);
    const list = s.get('me')!.c.missions as unknown as { id: string; progress: number }[];
    expect(list).toHaveLength(1);
    expect(list[0].progress).toBe(3);
  });

  it('reset restores the initial state but keeps subscribers', () => {
    const s = new Store();
    const fn = vi.fn();
    s.subscribe('me', fn);
    s.applyMe(me());
    s.reset();
    expect(s.get('me')).toBeNull();
    expect(fn).toHaveBeenCalled();
  });
});

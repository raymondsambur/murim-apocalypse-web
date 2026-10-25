import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ORIGINS, Rng, generateWorld, getItem, newCharacterSave, randomLook, rollCharacter, type C2S, type CharacterSave, type NpcMenu, type S2C, type WorldData } from '@murim/shared';
import { MockGame, dirFromStep } from './mockGame';

let world: WorldData;
beforeAll(() => {
  world = generateWorld(1337);
}, 60000);

function newSave(): CharacterSave {
  const roll = rollCharacter(new Rng(5));
  const home = world.settlements.find((s) => ORIGINS[roll.origin].homeKinds.includes(s.kind)) ?? world.settlements[0];
  return newCharacterSave({ id: 1, name: 'Tester', look: randomLook(new Rng(2)), roll, homeSettlement: home.id, spawn: home.spawn, now: Date.now(), rerolls: 3 });
}

describe('MockGame speaks the protocol', () => {
  let out: S2C[];
  let game: MockGame;
  let save: CharacterSave;
  const send = (m: C2S) => game.handle(m);
  const of = <T extends S2C['t']>(t: T) => out.filter((m): m is Extract<S2C, { t: T }> => m.t === t);

  beforeEach(() => {
    vi.useFakeTimers();
    out = [];
    save = newSave();
    game = new MockGame({ world, save, peer: { send: (m) => out.push(m) }, persist: () => undefined, seed: 7 });
    game.start();
  });
  afterEach(() => {
    game.stop();
    vi.useRealTimers();
  });

  it('greets with hello, then the entities around the player', () => {
    expect(out[0].t).toBe('hello');
    const hello = out[0] as Extract<S2C, { t: 'hello' }>;
    expect(hello.you.entityId).toBe(1);
    expect(hello.settlements.length).toBe(world.settlements.length);
    expect(hello.protocol).toBe(1);
    const ents = of('ents')[0].add!;
    expect(ents.some((e) => e.id === 1 && e.kind === 'player')).toBe(true);
    expect(ents.some((e) => e.kind === 'npc' && e.role === 'merchant')).toBe(true);
    expect(ents.some((e) => e.kind === 'monster')).toBe(true);
    expect(ents.some((e) => e.kind === 'node')).toBe(true);
    // ids are unique
    expect(new Set(ents.map((e) => e.id)).size).toBe(ents.length);
  });

  it('walks one tile at a time and ends a walk with nx=x, ny=y, step=0', () => {
    const start = of('ents')[0].add!.find((e) => e.id === 1)!;
    send({ t: 'move', x: start.x + 3, y: start.y });
    vi.advanceTimersByTime(4000);
    const patches = of('ents').flatMap((m) => m.upd ?? []).filter((u) => u.id === 1);
    expect(patches.some((p) => p.nx !== undefined && (p.step ?? 0) > 0)).toBe(true);
    const last = patches[patches.length - 1];
    expect(last).toMatchObject({ state: 'idle', step: 0 });
    expect(last.nx).toBe(last.x);
  });

  it('opens a shop menu with real items and lets you buy and sell', () => {
    const merchant = of('ents')[0].add!.find((e) => e.role === 'merchant')!;
    send({ t: 'interact', id: merchant.id });
    vi.advanceTimersByTime(20000);
    const menu = of('npc')[0].menu as NpcMenu;
    expect(menu.shop!.entries.length).toBeGreaterThan(3);
    for (const e of menu.shop!.entries) expect(getItem(e.id)).toBeDefined();
    const entry = menu.shop!.entries.find((e) => e.id === 'pill_heal_s')!;
    game.debugGold(1000);
    vi.advanceTimersByTime(300);
    const goldBefore = (of('me').pop()!.me.c.gold);
    send({ t: 'buy', npc: menu.id, item: entry.id, qty: 2 });
    vi.advanceTimersByTime(300);
    const me = of('me').pop()!.me;
    expect(me.c.gold).toBe(goldBefore - entry.price * 2);
    const idx = me.c.inventory.findIndex((s) => s.id === 'pill_heal_s');
    expect(idx).toBeGreaterThanOrEqual(0);
    send({ t: 'sell', npc: menu.id, idx, id: 'pill_heal_s', qty: 1 });
    vi.advanceTimersByTime(300);
    expect(of('me').pop()!.me.c.gold).toBeGreaterThan(me.c.gold);
  });

  it('runs a fight to the end with combat beats and a cend', () => {
    game.debugXp(0);
    const wolf = of('ents')[0].add!.filter((e) => e.kind === 'monster').sort((a, b) => (a.lv ?? 0) - (b.lv ?? 0))[0];
    send({ t: 'interact', id: wolf.id });
    vi.advanceTimersByTime(120_000);
    const beats = of('combat');
    expect(beats.length).toBeGreaterThan(1);
    expect(beats[0].c.fighters.map((f) => f.id)).toContain(1);
    const end = of('cend');
    expect(end).toHaveLength(1);
    expect(['win', 'lose', 'fled', 'draw']).toContain(end[0].result);
    if (end[0].result === 'win') expect(end[0].reward!.xp).toBeGreaterThan(0);
  });

  it('answers queries with the documented shapes', async () => {
    const ask = (name: string, args: Record<string, unknown> = {}) => {
      out.length = 0;
      send({ t: 'q', id: 9, name, args } as C2S);
      return of('res')[0];
    };
    const board = ask('board', { settlement: world.settlements[0].id });
    expect(board.ok).toBe(true);
    expect((board.data as { offers: unknown[] }).offers.length).toBeGreaterThan(0);
    expect((ask('world').data as { factions: unknown[] }).factions.length).toBe(5);
    expect(ask('player', { name: 'Moon Lotus' }).data).toMatchObject({ name: 'Moon Lotus' });
    expect(ask('player', { name: 'nobody' }).data).toBeNull();
    const bad = ask('npc', { id: 99999 });
    expect(bad.ok).toBe(false);
  });

  it('rejects whispers to unknown players and echoes local chat', () => {
    send({ t: 'chat', ch: 'whisper', text: 'hi', to: 'Nobody' });
    expect(of('err')[0].code).toBe('no_player');
    send({ t: 'chat', ch: 'local', text: 'hello there' });
    vi.advanceTimersByTime(2000);
    const chats = of('chat').map((c) => c.msg);
    expect(chats.some((c) => c.from === 'Tester' && c.text === 'hello there')).toBe(true);
    expect(chats.some((c) => c.from !== 'Tester')).toBe(true); // a bot answers
  });

  it('spends stat points and persists nothing it should not', () => {
    save.statPoints = 3;
    const might = save.stats.might;
    send({ t: 'alloc', stat: 'might', n: 2 });
    vi.advanceTimersByTime(300);
    const me = of('me').pop()!.me;
    expect(me.c.stats.might).toBe(might + 2);
    expect(me.c.statPoints).toBe(1);
    send({ t: 'alloc', stat: 'might', n: 5 });
    expect(save.statPoints).toBe(0); // clamped to what is left
  });
});

describe('dirFromStep', () => {
  it('maps tile steps to the four screen directions', () => {
    expect(dirFromStep(1, 0)).toBe(0);
    expect(dirFromStep(0, 1)).toBe(1);
    expect(dirFromStep(-1, 0)).toBe(2);
    expect(dirFromStep(0, -1)).toBe(3);
  });
});

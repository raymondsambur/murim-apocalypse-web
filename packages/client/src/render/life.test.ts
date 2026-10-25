import { describe, expect, it } from 'vitest';
import type { EntityView, NpcAct } from '@murim/shared';
import { FRAME_COUNTS } from '../art/anim';
import { gearAppearance } from '../art/gear';
import { BEAST_FRAMES } from '../art/beasts';
import { EntityStore, seedOf, type Ent } from './entities';
import { ACT_STATE, blinkAt, gazeAt, motion, newBeastPick, newPick, pickBeast, pickChar, reactionOffset, tiltAt, windLevel, type PickEnv } from './life';
import { charKey, flipSprite } from './sprites';

const look = { gender: 0 as const, skin: 1, hairStyle: 0, hairColor: 0, outfit: 0, outfitColor: 0, sashColor: 0, accessory: 0 };
const mkView = (id: number, extra: Partial<EntityView> = {}): EntityView => ({ id, kind: 'npc', name: `n${id}`, x: 10 + id, y: 10, face: 0, state: 'idle', look, role: 'villager', ...extra });

function setup(n = 20): { store: EntityStore; ents: Ent[] } {
  const store = new EntityStore();
  const ents: Ent[] = [];
  for (let i = 1; i <= n; i++) ents.push(store.add(mkView(i, { x: 10 + (i % 5) * 0.8, y: 10 + Math.floor(i / 5) * 0.8 }), 0));
  return { store, ents };
}
const env = (store: EntityStore, now: number, extra: Partial<PickEnv> = {}): PickEnv => ({ now, moving: false, ents: store, wind: 0, weapon: null, hollow: false, hasHuman: true, toolFor: () => 'hoe', ...extra });

describe('seeded fidgets', () => {
  it('are deterministic per entity and time', () => {
    const { ents } = setup(4);
    for (const e of ents) for (let t = 0; t < 60000; t += 1337) {
      expect(blinkAt(e, t)).toBe(blinkAt(e, t));
      expect(gazeAt(e, t)).toBe(gazeAt(e, t));
      expect(tiltAt(e, t)).toBe(tiltAt(e, t));
    }
    expect(seedOf(5)).toBe(seedOf(5));
    expect(seedOf(5)).not.toBe(seedOf(6));
    expect(seedOf(5, 1)).not.toBe(seedOf(5, 2));
  });
  it('do not run in sync across a crowd and actually happen', () => {
    const { ents } = setup(40);
    let blinks = 0;
    let gazes = 0;
    const patterns = new Set<string>();
    for (const e of ents) {
      let pat = '';
      for (let t = 0; t < 30000; t += 100) {
        const b = blinkAt(e, t);
        if (b) blinks++;
        if (gazeAt(e, t) !== 0) gazes++;
        pat += b ? '1' : '0';
      }
      patterns.add(pat);
    }
    expect(blinks).toBeGreaterThan(40);
    expect(gazes).toBeGreaterThan(40);
    expect(patterns.size).toBeGreaterThan(30);
  });
  it('picks the same animation for the same inputs', () => {
    const { store, ents } = setup(8);
    for (const e of ents) for (const t of [1000, 15000, 42000]) {
      const a = newPick();
      const b = newPick();
      pickChar(e, env(store, t), a);
      pickChar(e, env(store, t), b);
      expect(a).toEqual(b);
      expect(a.frame).toBeLessThan(FRAME_COUNTS[a.state]);
    }
  });
});

describe('animation selection', () => {
  it('idles, walks, runs, fights, works and meditates', () => {
    const { store } = setup(2);
    const e = store.map.get(1)!;
    const p = newPick();
    pickChar(e, env(store, 5000), p);
    expect(p.state).toBe('idle');
    pickChar(e, env(store, 5000, { moving: true }), p);
    expect(['walk', 'run']).toContain(p.state);
    e.v.step = 260;
    pickChar(e, env(store, 5000, { moving: true }), p);
    expect(p.state).toBe('run');
    e.v.step = 450;
    pickChar(e, env(store, 5000, { moving: true }), p);
    expect(p.state).toBe('walk');
    store.patch({ id: 1, state: 'fight' }, 6000);
    pickChar(e, env(store, 6050, { weapon: 'sword' }), p);
    expect(p.state).toBe('draw');
    pickChar(e, env(store, 7000, { weapon: 'sword' }), p);
    expect(p.state).toBe('fight');
    store.patch({ id: 1, state: 'work' }, 8000);
    pickChar(e, env(store, 9000), p);
    expect(p.state).not.toBe('work'); // an NPC needs a specific act cue to work
    const kind = e.v.kind;
    e.v.kind = 'player'; // players keep the activity animations driven by their state
    pickChar(e, env(store, 9000), p);
    expect(p.state).toBe('work');
    expect(p.tool).toBe('hoe');
    e.v.kind = kind;
    store.patch({ id: 1, state: 'meditate' }, 10000);
    pickChar(e, env(store, 11000), p);
    expect(p.state).toBe('meditate');
  });
  it('plays attack variants, hit, dodge, block and the death collapse', () => {
    const { store } = setup(2);
    const e = store.map.get(1)!;
    const p = newPick();
    e.attackAt = 1000;
    e.attackIdx = 1;
    pickChar(e, env(store, 1100, { weapon: 'sword' }), p);
    expect(p.state).toBe('attack');
    const variants = new Set<number>();
    for (let i = 0; i < 40; i++) {
      e.attackIdx = i;
      pickChar(e, env(store, 1100, { weapon: 'sword' }), p);
      variants.add(p.variant);
    }
    expect(variants.size).toBeGreaterThanOrEqual(3);
    e.attackAt = -1e9;
    e.hitAt = 2000;
    pickChar(e, env(store, 2050), p);
    expect(p.state).toBe('hit');
    e.hitAt = -1e9;
    e.dodgeAt = 3000;
    pickChar(e, env(store, 3050), p);
    expect(p.state).toBe('dodge');
    e.dodgeAt = -1e9;
    e.blockAt = 4000;
    pickChar(e, env(store, 4050), p);
    expect(p.state).toBe('block');
    e.blockAt = -1e9;
    store.patch({ id: 1, state: 'dead' }, 5000);
    pickChar(e, env(store, 5100), p);
    expect(p.state).toBe('die');
    pickChar(e, env(store, 9000), p);
    expect(p.state).toBe('dead');
    const born = store.add(mkView(99, { state: 'dead' }), 0);
    pickChar(born, env(store, 10), p);
    expect(p.state).toBe('dead');
  });
  it('emotes: cheer on level-up, crouch to loot, victory after a fight', () => {
    const { store } = setup(2);
    const e = store.map.get(2)!;
    const p = newPick();
    e.cheerAt = 100;
    pickChar(e, env(store, 200), p);
    expect(p.state).toBe('cheer');
    e.cheerAt = -1e9;
    e.lootAt = 100;
    pickChar(e, env(store, 200), p);
    expect(p.state).toBe('loot');
    e.lootAt = -1e9;
    store.patch({ id: 2, state: 'fight' }, 1000);
    store.patch({ id: 2, state: 'idle' }, 4000);
    pickChar(e, env(store, 4100), p);
    expect(p.state).toBe('cheer');
  });
  it('plays a matching in-place animation for every server act cue', () => {
    const acts: NpcAct[] = ['work', 'farm', 'forge', 'brew', 'gather', 'mine', 'guard', 'eat', 'chat', 'pray', 'sweep', 'rest', 'patrol', 'trade', 'train', 'shelter', 'mourn', 'celebrate', 'loot'];
    expect(Object.keys(ACT_STATE).sort()).toEqual([...acts].sort());
    const { store } = setup(3);
    const e = store.map.get(1)!;
    const p = newPick();
    const seen = new Set<string>();
    for (const act of acts) {
      store.patch({ id: 1, act }, 0);
      pickChar(e, env(store, 7000, { weapon: act === 'train' ? 'sword' : null }), p);
      seen.add(p.state);
      expect(p.frame).toBeLessThan(FRAME_COUNTS[p.state]);
      expect(p.state, act).not.toBe('walk');
    }
    expect(seen.size).toBeGreaterThanOrEqual(9);
    // specific work cues pick their tool; the generic one just stands
    for (const [act, tool] of [['forge', 'hammer'], ['gather', 'herb'], ['mine', 'pick']] as const) {
      store.patch({ id: 1, act }, 0);
      pickChar(e, env(store, 7000), p);
      expect([p.state, p.tool], act).toEqual(['work', tool]);
    }
    store.patch({ id: 1, act: 'farm' }, 0);
    pickChar(e, env(store, 7000), p);
    expect(p.state).toBe('work');
    expect(['hoe', 'sickle']).toContain(p.tool);
    store.patch({ id: 1, act: 'work' }, 0);
    pickChar(e, env(store, 7000), p);
    expect(p.state).toBe('idle');
    // an NPC in the server state 'work' without a cue does not grab a tool
    store.patch({ id: 1, act: undefined, state: 'work' }, 0);
    pickChar(e, env(store, 7000), p);
    expect(p.state).not.toBe('work');
    expect(p.tool).toBeNull();
    store.patch({ id: 1, state: 'idle' }, 0);
    store.patch({ id: 1, act: 'eat' }, 0);
    pickChar(e, env(store, 7000), p);
    expect(p.state).toBe('eat');
    store.patch({ id: 1, act: 'rest' }, 0);
    pickChar(e, env(store, 7000), p);
    expect(p.state).toBe('rest');
    expect(p.chatIcon).toBe(0); // sitting, not sleeping: no 'z' bubble
    store.patch({ id: 1, act: undefined }, 0);
    pickChar(e, env(store, 7000), p);
    expect(['idle', 'sweep', 'chat', 'stretch']).toContain(p.state);
    // a cue never beats combat
    store.patch({ id: 1, act: 'pray' }, 0);
    e.attackAt = 6990;
    pickChar(e, env(store, 7000, { weapon: 'sword' }), p);
    expect(p.state).toBe('attack');
  });
  it('ambient activity never moves the entity and only shows for the right roles', () => {
    const { store, ents } = setup(30);
    const p = newPick();
    const before = ents.map((e) => [e.x, e.y]);
    const states = new Set<string>();
    for (let t = 0; t < 120000; t += 700) for (const e of ents) {
      pickChar(e, env(store, t), p);
      states.add(p.state);
    }
    expect(ents.map((e) => [e.x, e.y])).toEqual(before);
    expect(states.has('idle')).toBe(true);
    expect([...states].some((s) => s === 'sweep' || s === 'stretch' || s === 'chat')).toBe(true);
    // no ambient life for beasts-in-human-clothes (hollows twitch instead)
    const hollow = store.add(mkView(500, { kind: 'monster', role: undefined, sprite: 'hollow' }), 0);
    const seenH = new Set<string>();
    for (let t = 0; t < 60000; t += 500) {
      pickChar(hollow, env(store, t, { hollow: true }), p);
      seenH.add(p.state);
    }
    expect([...seenH]).toEqual(['idle']);
  });
});

describe('beasts', () => {
  it('idle fidgets (sniff, graze, stretch), attack variants and death', () => {
    const store = new EntityStore();
    const e = store.add(mkView(7, { kind: 'monster', role: undefined, sprite: 'wolf' }), 0);
    const b = newBeastPick();
    const seen = new Set<string>();
    for (let t = 0; t < 200000; t += 400) {
      pickBeast(e, t, false, false, false, b);
      seen.add(b.state);
      expect(b.frame).toBeLessThan(BEAST_FRAMES[b.state]);
    }
    expect(seen.has('idle')).toBe(true);
    expect(seen.has('sniff') || seen.has('graze') || seen.has('stretch')).toBe(true);
    e.attackAt = 1000;
    pickBeast(e, 1100, false, false, false, b);
    expect(b.state).toBe('attack');
    store.patch({ id: 7, state: 'dead' }, 3000);
    pickBeast(e, 3100, false, false, false, b);
    expect(b.state).toBe('die');
    pickBeast(e, 9000, false, false, false, b);
    expect(b.state).toBe('dead');
  });
});

describe('sprite cache keys and reduced motion', () => {
  const base = { look, state: 'idle' as const, dir: 0 as const, frame: 0, weapon: 'sword' as const };
  it('include gear, state, frame, variant, wind, gaze and blink', () => {
    const keys = new Set<string>();
    keys.add(charKey(base));
    keys.add(charKey({ ...base, gear: gearAppearance({ o: { t: 3, r: 1 } }) }));
    keys.add(charKey({ ...base, gear: gearAppearance({ o: { t: 3, r: 2 } }) }));
    keys.add(charKey({ ...base, gear: gearAppearance({ w: { t: 3, r: 2 } }) }));
    keys.add(charKey({ ...base, gear: gearAppearance({ a: { k: 'might', t: 3, r: 2 } }) }));
    keys.add(charKey({ ...base, state: 'walk' }));
    keys.add(charKey({ ...base, frame: 3 }));
    keys.add(charKey({ ...base, variant: 2 }));
    keys.add(charKey({ ...base, wind: 2 }));
    keys.add(charKey({ ...base, gaze: 1 }));
    keys.add(charKey({ ...base, tilt: -1 }));
    keys.add(charKey({ ...base, blink: true }));
    keys.add(charKey({ ...base, dir: 3 }));
    expect(keys.size).toBe(13);
    expect(charKey(base)).toBe(charKey({ ...base }));
    // the bank stores the east sprite once: west facings share its key
    expect(charKey({ ...base, dir: 1 }, 0)).toBe(charKey(base));
    expect(typeof flipSprite).toBe('function');
  });
  it('reduced motion switches off sway, knock-back and particles', () => {
    const { ents } = setup(1);
    const e = ents[0];
    e.hitAt = 100;
    const out = { x: 0, y: 0 };
    motion.reduced = false;
    reactionOffset(e, 160, out);
    expect(Math.hypot(out.x, out.y)).toBeGreaterThan(0.5);
    expect(windLevel(1.1)).toBe(2);
    motion.reduced = true;
    reactionOffset(e, 160, out);
    expect(out).toEqual({ x: 0, y: 0 });
    expect(windLevel(1.1)).toBe(0);
    motion.reduced = false;
  });
});

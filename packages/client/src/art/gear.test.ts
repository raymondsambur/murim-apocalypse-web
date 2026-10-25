import { describe, expect, it } from 'vitest';
import { STAT_KEYS, type GearLook, type Look, type NpcRole } from '@murim/shared';
import { ATTACK_VARIANTS, FRAME_COUNTS, FRAME_MS, attackStrikeFrames, poseFor, type CharState } from './anim';
import { genCharacter, type CharSpec } from './character';
import { NO_GEAR, ROLE_GEAR, SPECIAL_GEAR, gearAppearance, gearFor, gearKey, rarityCss } from './gear';
import { PixelBuffer } from './pixel';
import { lookSwatches } from './palette';
import { LOOK_RANGES } from '@murim/shared';

const look: Look = { gender: 0, skin: 2, hairStyle: 1, hairColor: 0, outfit: 3, outfitColor: 3, sashColor: 1, accessory: 0 };
const same = (a: PixelBuffer, b: PixelBuffer): boolean => a.w === b.w && a.h === b.h && a.px.every((v, i) => v === b.px[i]);
const gen = (extra: Partial<CharSpec>, gear?: GearLook): PixelBuffer => genCharacter({ look, state: 'idle', dir: 0, frame: 0, weapon: 'sword', gear: gear ? gearAppearance(gear) : undefined, ...extra }).pb;

describe('gear -> appearance mapping', () => {
  it('maps tiers and rarities and clamps junk', () => {
    expect(gearAppearance(undefined)).toBe(NO_GEAR);
    const a = gearAppearance({ w: { t: 3, r: 2 }, o: { t: 9, r: -1 }, a: { k: 'spirit', t: 0, r: 7 } });
    expect(a).toEqual({ wT: 3, wR: 2, oT: 5, oR: 0, aK: 'spirit', aT: 1, aR: 4 });
    expect(gearAppearance({}).oT).toBe(0);
  });
  it('has distinct cache keys for distinct gear', () => {
    const keys = new Set<string>();
    for (let t = 1; t <= 5; t++) for (let r = 0; r <= 4; r++) keys.add(gearKey(gearAppearance({ o: { t, r } })));
    for (let t = 1; t <= 5; t++) for (let r = 0; r <= 4; r++) keys.add(gearKey(gearAppearance({ w: { t, r } })));
    for (const k of STAT_KEYS) keys.add(gearKey(gearAppearance({ a: { k, t: 2, r: 1 } })));
    expect(keys.size).toBe(25 + 25 + STAT_KEYS.length);
    expect(gearKey(NO_GEAR)).not.toBe(gearKey(gearAppearance({ o: { t: 1, r: 0 } })));
  });
  it('gives every NPC role and hostile style tiers, and caches them', () => {
    const roles: NpcRole[] = ['villager', 'guard', 'merchant', 'smith', 'alchemist', 'innkeeper', 'master', 'elder', 'physician', 'legend', 'wanderer'];
    for (const r of roles) {
      expect(ROLE_GEAR[r]).toBeDefined();
      expect(gearFor(undefined, r, null).oT).toBeGreaterThan(0);
      expect(gearFor(undefined, r, null)).toBe(gearFor(undefined, r, null));
    }
    expect(gearFor(undefined, 'legend', null).oR).toBe(4);
    for (const s of Object.keys(SPECIAL_GEAR)) expect(gearFor(undefined, null, s).oT).toBeGreaterThan(0);
    const g: GearLook = { o: { t: 2, r: 1 } };
    expect(gearFor(g, 'guard', null)).toBe(gearFor(g, null, null));
    expect(gearFor(g, null, null).oT).toBe(2);
    expect(rarityCss(4)).toBe('#f0a43a');
  });
});

describe('gear changes the sprite', () => {
  it('each outfit tier looks different (and differs from nothing worn)', () => {
    const imgs = [0, 1, 2, 3, 4, 5].map((t) => gen({}, t ? { o: { t, r: 0 } } : undefined));
    for (let i = 0; i < imgs.length; i++) for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j]), `tier ${i} vs ${j}`).toBe(false);
  });
  it('outfit rarity adds finishing touches; epic and legendary add a glow layer', () => {
    const base = gen({}, { o: { t: 4, r: 0 } });
    for (const r of [1, 2, 3, 4]) expect(same(base, gen({}, { o: { t: 4, r } })), `rarity ${r}`).toBe(false);
    const glowOf = (r: number): boolean => genCharacter({ look, state: 'idle', dir: 0, frame: 0, gear: gearAppearance({ o: { t: 4, r } }) }).glow !== null;
    expect(glowOf(0)).toBe(false);
    expect(glowOf(3)).toBe(true);
    expect(glowOf(4)).toBe(true);
  });
  it('weapon tier and rarity change every weapon type', () => {
    for (const w of ['sword', 'blade', 'spear', 'staff', 'fist'] as const) {
      const a = gen({ weapon: w, state: 'fight', frame: 1 }, { w: { t: 1, r: 0 } });
      const b = gen({ weapon: w, state: 'fight', frame: 1 }, { w: { t: 5, r: 0 } });
      const c = gen({ weapon: w, state: 'fight', frame: 1 }, { w: { t: 5, r: 4 } });
      expect(same(a, b), w).toBe(false);
      if (w !== 'fist') expect(same(b, c), `${w} rarity`).toBe(false);
    }
    const gl = genCharacter({ look, weapon: 'sword', state: 'fight', dir: 0, frame: 1, gear: gearAppearance({ w: { t: 3, r: 3 } }) });
    expect(gl.glow).not.toBeNull();
    expect(gl.tip).not.toBeNull();
  });
  it('each accessory attribute shows a different trinket, tier adds metal', () => {
    const imgs = STAT_KEYS.map((k) => gen({ weapon: null }, { o: { t: 2, r: 0 }, a: { k, t: 3, r: 0 } }));
    const none = gen({ weapon: null }, { o: { t: 2, r: 0 } });
    for (let i = 0; i < imgs.length; i++) {
      expect(same(imgs[i], none), STAT_KEYS[i]).toBe(false);
      for (let j = i + 1; j < imgs.length; j++) expect(same(imgs[i], imgs[j])).toBe(false);
    }
    expect(same(gen({ weapon: null }, { a: { k: 'might', t: 1, r: 0 } }), gen({ weapon: null }, { a: { k: 'might', t: 5, r: 0 } }))).toBe(false);
  });
  it('keeps the look differences and west facings mirror east', () => {
    const e = genCharacter({ look, state: 'idle', dir: 0, frame: 0 });
    const w = genCharacter({ look, state: 'idle', dir: 1, frame: 0 });
    expect(same(e.pb.flipped(), w.pb)).toBe(true);
    expect(e.ax + w.ax).toBe(e.pb.w - 1);
    expect(same(gen({ look: { ...look, gender: 1 } }), gen({}))).toBe(false);
    expect(same(gen({ look: { ...look, hairStyle: 4 } }), gen({}))).toBe(false);
  });
  it('is deterministic', () => {
    const g: GearLook = { o: { t: 5, r: 4 }, w: { t: 5, r: 4 }, a: { k: 'fortune', t: 5, r: 4 } };
    expect(same(gen({ state: 'attack', frame: 3, variant: 2 }, g), gen({ state: 'attack', frame: 3, variant: 2 }, g))).toBe(true);
  });
});

describe('animation tables', () => {
  it('has frame counts and timings for every state', () => {
    for (const s of Object.keys(FRAME_COUNTS) as CharState[]) {
      expect(FRAME_COUNTS[s]).toBeGreaterThan(0);
      expect(FRAME_MS[s]).toBeGreaterThan(0);
    }
    expect(FRAME_COUNTS.walk).toBeGreaterThanOrEqual(6);
    expect(FRAME_COUNTS.walk).toBeLessThanOrEqual(8);
    expect(Object.keys(FRAME_COUNTS).sort()).toEqual(Object.keys(FRAME_MS).sort());
  });
  it('produces finite poses for every state and frame', () => {
    for (const state of Object.keys(FRAME_COUNTS) as CharState[])
      for (let f = 0; f < FRAME_COUNTS[state]; f++)
        for (const weapon of ['sword', 'spear', 'fist', null] as const) {
          const p = poseFor({ state, frame: f, weapon, variant: 1, wind: 1, look: 0, tilt: 0, blink: false, tool: null, hunch: false, stiff: false });
          for (const v of Object.values(p)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
        }
  });
  it('has 2-4 attack animations per weapon with strike frames', () => {
    for (const w of ['sword', 'blade', 'spear', 'staff', 'fist'] as const) {
      expect(ATTACK_VARIANTS[w]).toBeGreaterThanOrEqual(3);
      for (let v = 0; v < ATTACK_VARIANTS[w]; v++) expect(attackStrikeFrames(w, v).length).toBeGreaterThan(0);
    }
    // the attack variants really are different animations
    const frames = (v: number) => poseFor({ state: 'attack', frame: 3, weapon: 'sword', variant: v, wind: 0, look: 0, tilt: 0, blink: false, tool: null, hunch: false, stiff: false });
    expect(frames(0).rhy).not.toBe(frames(1).rhy);
  });
  it('walk has contact and passing poses with opposite arm swing', () => {
    const w = (f: number) => poseFor({ state: 'walk', frame: f, weapon: null, variant: 0, wind: 0, look: 0, tilt: 0, blink: false, tool: null, hunch: false, stiff: false });
    expect(w(0).frx).toBeGreaterThan(w(4).frx);
    expect(Math.sign(w(0).rhx - 6.8)).not.toBe(Math.sign(w(0).lhx + 6.6));
    expect(w(2).bob).toBeLessThan(w(0).bob);
  });
  it('palettes still match LOOK_RANGES', () => {
    expect(lookSwatches.skin.length).toBe(LOOK_RANGES.skin);
    expect(lookSwatches.hair.length).toBe(LOOK_RANGES.hairColor);
    expect(lookSwatches.outfit.length).toBe(LOOK_RANGES.outfitColor);
    expect(lookSwatches.sash.length).toBe(LOOK_RANGES.sashColor);
  });
});

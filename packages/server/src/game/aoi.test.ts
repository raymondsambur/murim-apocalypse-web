import { AOI_RADIUS, type EntityView, type S2C } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { Aoi, diffViews, type AoiViewer } from './aoi';
import { EntityStoreImpl } from './entities';

function setup() {
  const store = new EntityStoreImpl(192, 128, () => 0);
  const aoi = new Aoi(store);
  return { store, aoi };
}

function viewer(self: ReturnType<EntityStoreImpl['create']>) {
  const out: Extract<S2C, { t: 'ents' }>[] = [];
  const v: AoiViewer = { entity: self, known: new Set(), send: (m) => out.push(m as Extract<S2C, { t: 'ents' }>) };
  return { v, out };
}

const base: EntityView = { id: 1, kind: 'npc', name: 'A', x: 1, y: 1, face: 0, state: 'idle' };

describe('diffViews', () => {
  it('returns null when nothing changed', () => {
    expect(diffViews(base, { ...base }, false)).toBeNull();
  });
  it('patches only changed fields', () => {
    expect(diffViews(base, { ...base, hp: 5 }, false)).toEqual({ id: 1, hp: 5 });
    expect(diffViews({ ...base, hp: 5 }, { ...base, hp: 9, state: 'fight' }, false)).toEqual({ id: 1, hp: 9, state: 'fight' });
  });
  it('sends the full movement tuple when a step starts, continues or ends', () => {
    const walking = { ...base, state: 'walk' as const, nx: 2, ny: 1, step: 400 };
    expect(diffViews(base, walking, true)).toMatchObject({ id: 1, x: 1, y: 1, nx: 2, ny: 1, step: 400, state: 'walk' });
    const arrived = { ...base, x: 2, state: 'idle' as const };
    expect(diffViews(walking, arrived, true)).toMatchObject({ id: 1, x: 2, y: 1, nx: 2, ny: 1, step: 0, state: 'idle' });
  });
  it('asks for a full replacement when an optional field disappears', () => {
    expect(diffViews({ ...base, tag: 'Elder' }, { ...base }, false)).toBe('replace');
  });
  it('compares looks by value', () => {
    const look = { gender: 0 as const, skin: 1, hairStyle: 1, hairColor: 1, outfit: 1, outfitColor: 1, sashColor: 1, accessory: 1 };
    expect(diffViews({ ...base, look }, { ...base, look: { ...look } }, false)).toBeNull();
    expect(diffViews({ ...base, look }, { ...base, look: { ...look, skin: 2 } }, false)).toMatchObject({ look: { skin: 2 } });
  });
});

describe('Aoi', () => {
  it('sends add for new entities in range, upd for changes, del when they leave', () => {
    const { store, aoi } = setup();
    const me = store.create({ kind: 'player', name: 'Me', x: 50, y: 50 });
    const npc = store.create({ kind: 'npc', name: 'Near', x: 55, y: 50 });
    const far = store.create({ kind: 'npc', name: 'Far', x: 120, y: 50 });
    const { v, out } = viewer(me);

    aoi.sync([v], 0);
    expect(out).toHaveLength(1);
    expect(out[0].add?.map((e) => e.id).sort()).toEqual([me.id, npc.id].sort());
    expect(out[0].add?.some((e) => e.id === far.id)).toBe(false);
    expect(out[0].upd).toBeUndefined();

    // No change -> no message.
    aoi.sync([v], 100);
    expect(out).toHaveLength(1);

    // A field change becomes a patch.
    npc.name = 'Renamed';
    store.touch(npc);
    aoi.sync([v], 200);
    expect(out[1].upd).toEqual([{ id: npc.id, name: 'Renamed' }]);

    // Leaving the radius deletes it.
    store.setPos(npc, 50 + AOI_RADIUS + 10, 50);
    aoi.sync([v], 300);
    expect(out[2].del).toEqual([npc.id]);
    expect(v.known.has(npc.id)).toBe(false);
  });

  it('uses hysteresis so entities at the edge do not flicker', () => {
    const { store, aoi } = setup();
    const me = store.create({ kind: 'player', name: 'Me', x: 50, y: 50 });
    const e = store.create({ kind: 'npc', name: 'Edge', x: 50 + AOI_RADIUS - 1, y: 50 });
    const { v, out } = viewer(me);
    aoi.sync([v], 0);
    expect(v.known.has(e.id)).toBe(true);
    store.setPos(e, 50 + AOI_RADIUS + 2, 50);
    aoi.sync([v], 100);
    expect(v.known.has(e.id)).toBe(true);
    expect(out.at(-1)?.del).toBeUndefined();
    store.setPos(e, 50 + AOI_RADIUS + 5, 50);
    aoi.sync([v], 200);
    expect(v.known.has(e.id)).toBe(false);
    // And it is not re-added until it is back inside the real radius.
    store.setPos(e, 50 + AOI_RADIUS + 2, 50);
    aoi.sync([v], 300);
    expect(v.known.has(e.id)).toBe(false);
  });

  it('hidden entities are not sent and disappear when they become hidden; self always visible', () => {
    const { store, aoi } = setup();
    const me = store.create({ kind: 'player', name: 'Me', x: 50, y: 50 });
    const mob = store.create({ kind: 'monster', name: 'Wolf', x: 52, y: 50 });
    const { v, out } = viewer(me);
    aoi.sync([v], 0);
    expect(v.known.has(mob.id)).toBe(true);
    mob.hidden = true;
    aoi.sync([v], 100);
    expect(out.at(-1)?.del).toEqual([mob.id]);
    me.hidden = true;
    me.name = 'Ghost';
    store.touch(me);
    aoi.sync([v], 200);
    expect(v.known.has(me.id)).toBe(true);
  });

  it('removed entities are deleted from every viewer', () => {
    const { store, aoi } = setup();
    const me = store.create({ kind: 'player', name: 'Me', x: 50, y: 50 });
    const other = store.create({ kind: 'player', name: 'Other', x: 52, y: 50 });
    const a = viewer(me);
    const b = viewer(other);
    aoi.sync([a.v, b.v], 0);
    store.remove(other);
    aoi.sync([a.v], 100);
    expect(a.out.at(-1)?.del).toEqual([other.id]);
  });

  it('computes each entity diff once per tick for all viewers, and sends at most one message per viewer', () => {
    const { store, aoi } = setup();
    const me = store.create({ kind: 'player', name: 'Me', x: 50, y: 50 });
    const other = store.create({ kind: 'player', name: 'Other', x: 51, y: 50 });
    const crowd = Array.from({ length: 20 }, (_, i) => store.create({ kind: 'npc', name: `c${i}`, x: 48 + (i % 5), y: 48 + Math.floor(i / 5) }));
    const a = viewer(me);
    const b = viewer(other);
    aoi.sync([a.v, b.v], 0);
    a.out.length = 0;
    b.out.length = 0;
    for (const c of crowd) {
      c.hp = 3;
      store.touch(c);
    }
    aoi.sync([a.v, b.v], 100);
    expect(a.out).toHaveLength(1);
    expect(b.out).toHaveLength(1);
    expect(a.out[0].upd).toHaveLength(20);
  });

  it('a safety-net full diff catches fields changed without touch()', () => {
    const { store, aoi } = setup();
    const me = store.create({ kind: 'player', name: 'Me', x: 50, y: 50 });
    const npc = store.create({ kind: 'npc', name: 'Sneaky', x: 52, y: 50 });
    const { v, out } = viewer(me);
    aoi.sync([v], 0);
    npc.hp = 77; // no touch
    for (let i = 1; i <= aoi.fullDiffEvery; i++) aoi.sync([v], i * 100);
    expect(out.some((m) => m.upd?.some((u) => u.id === npc.id && u.hp === 77))).toBe(true);
  });
});

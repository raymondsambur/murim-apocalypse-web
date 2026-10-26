import { Rng } from '@murim/shared';
import { describe, expect, it } from 'vitest';
import { AMBIENT_ID_BASE, EntityStoreImpl, CELL_SIZE } from './entities';

function store() {
  return new EntityStoreImpl(192, 128, () => 1000);
}

describe('EntityStoreImpl', () => {
  it('creates entities with unique ids, clamped positions and defaults', () => {
    const s = store();
    const a = s.create({ kind: 'npc', name: 'A', x: 5, y: 6 });
    const b = s.create({ kind: 'monster', name: 'B', x: -10, y: 9999, sprite: 'wolf', lv: 3 });
    expect(a.id).not.toBe(b.id);
    expect(b.x).toBe(0);
    expect(b.y).toBe(127);
    expect(a).toMatchObject({ face: 0, state: 'idle', speed: 1, hidden: false, ver: 1, move: null });
    expect(s.toView(b)).toMatchObject({ kind: 'monster', sprite: 'wolf', lv: 3 });
    expect(() => s.create({ kind: 'npc', name: 'bad', x: NaN, y: 0 })).toThrow();
    expect(s.count()).toBe(2);
    expect(s.count('npc')).toBe(1);
    expect(s.ofKind('monster')).toEqual([b]);
  });

  it('near() matches a brute-force scan across cell borders', () => {
    const s = store();
    const rng = new Rng(7);
    const all = Array.from({ length: 600 }, (_, i) => s.create({ kind: 'npc', name: `n${i}`, x: rng.int(0, 191), y: rng.int(0, 127) }));
    for (let q = 0; q < 60; q++) {
      const x = rng.int(0, 191);
      const y = rng.int(0, 127);
      const r = rng.int(0, 30);
      const expected = all.filter((e) => (e.x - x) ** 2 + (e.y - y) ** 2 <= r * r).map((e) => e.id).sort((p, q2) => p - q2);
      const got = s
        .near(x, y, r)
        .map((e) => e.id)
        .sort((p, q2) => p - q2);
      expect(got).toEqual(expected);
    }
    expect(s.near(10, 10, -1)).toEqual([]);
    expect(CELL_SIZE).toBe(8);
  });

  it('keeps the spatial hash in sync when entities move or are removed', () => {
    const s = store();
    const e = s.create({ kind: 'player', name: 'P', x: 10, y: 10 });
    expect(s.near(10, 10, 2)).toContain(e);
    s.setPos(e, 100, 60);
    expect(s.near(10, 10, 5)).not.toContain(e);
    expect(s.near(100, 60, 1)).toContain(e);
    expect(s.nearest(98, 60, 10)).toBe(e);
    expect(s.nearest(98, 60, 10, (x) => x.kind === 'npc')).toBeUndefined();
    const removed: number[] = [];
    s.onRemove((x) => removed.push(x.id));
    s.remove(e);
    s.remove(e);
    expect(removed).toEqual([e.id]);
    expect(s.near(100, 60, 5)).toEqual([]);
    expect(s.get(e.id)).toBeUndefined();
  });

  it('touch bumps the version and queues the entity for the next AOI pass', () => {
    const s = store();
    const e = s.create({ kind: 'npc', name: 'T', x: 1, y: 1 });
    s.changed.clear();
    s.touch(e);
    expect(e.ver).toBe(2);
    expect(s.changed.has(e as never)).toBe(true);
    s.remove(e);
    expect(s.changed.size).toBe(0);
    s.touch(e);
    expect(s.changed.size).toBe(0);
  });

  it('views omit undefined fields and expose movement progress', () => {
    const s = store();
    const e = s.create({ kind: 'npc', name: 'V', x: 3, y: 3, tag: 'Elder' });
    const v = s.toView(e);
    expect(v).toEqual({ id: e.id, kind: 'npc', name: 'V', x: 3, y: 3, face: 0, state: 'idle', tag: 'Elder' });
    expect('hp' in v).toBe(false);
  });

  it('gives ambient townsfolk ids of their own so they never shift anyone else\'s', () => {
    const s = store();
    const a = s.create({ kind: 'npc', name: 'A', x: 1, y: 1 });
    const crowd = [s.create({ kind: 'ambient', name: '', x: 2, y: 2 }), s.create({ kind: 'ambient', name: '', x: 3, y: 3 })];
    const b = s.create({ kind: 'monster', name: 'B', x: 4, y: 4 });
    expect(b.id).toBe(a.id + 1);
    expect(crowd[0].id).toBeGreaterThanOrEqual(AMBIENT_ID_BASE);
    expect(crowd[1].id).toBe(crowd[0].id + 1);
    expect(s.count('ambient')).toBe(2);
    expect(s.ofKind('ambient')).toHaveLength(2);
    s.remove(crowd[0]);
    expect(s.count('ambient')).toBe(1);
  });
});

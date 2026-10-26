import { describe, expect, it } from 'vitest';
import { LANDMARK_LABEL, axisDir, gateDirs, gateSide, gateTile, landmarksOf, nearestLivingSettlement, type LandmarkWorld } from './landmarks';
import type { BuildingDef, SettlementDef } from './terrain';
import { generateWorld } from './worldgen';

const set = (id: number, kind: SettlementDef['kind'], x: number, y: number): SettlementDef => ({ id, name: `S${id}`, kind, x, y, radius: 12, climate: 1, spawn: { x, y: y + 3 }, buildingIds: [], sites: [], population: 10 });
const bld = (id: number, kind: BuildingDef['kind'], sid: number, x = 0, y = 0): BuildingDef => ({ id, kind, x, y, w: 3, d: 3, settlementId: sid, door: { x: x + 1, y: y + 3 } });

describe('gate directions', () => {
  it('snaps a road to the nearest compass axis of the tiles', () => {
    expect(axisDir(0)).toEqual({ x: 1, y: 0 });
    expect(axisDir(Math.PI)).toEqual({ x: -1, y: 0 });
    expect(axisDir(Math.PI / 2)).toEqual({ x: 0, y: 1 });
    expect(axisDir(-Math.PI / 2)).toEqual({ x: 0, y: -1 });
    expect(axisDir(0.6)).toEqual({ x: 1, y: 0 });
    expect(axisDir(1.0)).toEqual({ x: 0, y: 1 });
  });

  it('has one gate per distinct road direction, at least two, and four for a fort', () => {
    const a = set(0, 'village', 0, 0);
    const b = set(1, 'village', 50, 4);
    const c = set(2, 'village', 60, -3);
    const d = set(3, 'village', 2, 60);
    const all = [a, b, c, d];
    // two roads east (same axis) and one south: two gates
    expect(gateDirs(a, [[0, 1], [0, 2], [0, 3]], all)).toEqual([{ x: 1, y: 0 }, { x: 0, y: 1 }]);
    // no roads: padded to two
    expect(gateDirs(a, [], all).length).toBe(2);
    // a single road: padded to two
    expect(gateDirs(a, [[0, 1]], all).length).toBe(2);
    expect(gateDirs({ ...a, kind: 'fort' }, [[0, 1]], all)).toHaveLength(4);
  });

  it('puts the gate tile just inside the edge on the axis and names its side', () => {
    const s = set(0, 'town', 40, 50);
    expect(gateTile(s, { x: 1, y: 0 })).toEqual({ x: 40 + 11, y: 50 });
    expect(gateTile(s, { x: 0, y: -1 })).toEqual({ x: 40, y: 50 - 11 });
    expect(gateSide({ x: 1, y: 0 })).toBe('Southeast');
    expect(gateSide({ x: -1, y: 0 })).toBe('Northwest');
    expect(gateSide({ x: 0, y: 1 })).toBe('Southwest');
    expect(gateSide({ x: 0, y: -1 })).toBe('Northeast');
  });
});

describe('landmarksOf', () => {
  const world: LandmarkWorld = {
    settlements: [set(0, 'town', 40, 40), set(1, 'ruin', 100, 100)],
    buildings: [bld(0, 'inn', 0), bld(1, 'inn', 0), bld(2, 'house', 0), bld(3, 'smithy', 0), bld(4, 'herbHut', 0), bld(5, 'mineEntrance', 0), bld(6, 'hermitage', 0), bld(7, 'shrine', 0), bld(8, 'ruinedHouse', 1)],
    roads: [],
  };
  const list = landmarksOf(world);

  it('lists landmark kinds only, with the gates, and nothing for a ruin', () => {
    const kinds = list.map((l) => l.kind).sort();
    expect(kinds).toEqual(['gate', 'gate', 'hermitage', 'inn', 'inn', 'shrine', 'smithy']);
    expect(list.every((l) => l.sid === 0)).toBe(true);
    expect(new Set(list.map((l) => l.id)).size).toBe(list.length);
  });

  it('numbers repeated kinds and labels the rest plainly', () => {
    expect(list.filter((l) => l.kind === 'inn').map((l) => l.label)).toEqual(['Inn 1', 'Inn 2']);
    expect(list.find((l) => l.kind === 'smithy')!.label).toBe(LANDMARK_LABEL.smithy);
    expect(list.filter((l) => l.kind === 'gate').every((l) => /Gate$/.test(l.label))).toBe(true);
  });

  it('works on a generated world: every living settlement has a shrine and gates; the ids are unique', () => {
    const w = generateWorld(1337);
    const all = landmarksOf(w);
    expect(new Set(all.map((l) => l.id)).size).toBe(all.length);
    for (const s of w.settlements) {
      if (s.kind === 'ruin') continue;
      const mine = all.filter((l) => l.sid === s.id);
      expect(mine.some((l) => l.kind === 'shrine')).toBe(true);
      expect(mine.filter((l) => l.kind === 'gate').length).toBeGreaterThanOrEqual(2);
    }
    expect(all.filter((l) => l.kind === 'hermitage').length).toBe(w.settlements.filter((s) => ['town', 'sectHall', 'fort'].includes(s.kind)).length);
  });

  it('finds the nearest living settlement by edge distance', () => {
    const s = [set(0, 'village', 0, 0), set(1, 'ruin', 30, 0), set(2, 'town', 80, 0)];
    expect(nearestLivingSettlement(s, 28, 0)!.id).toBe(0);
    expect(nearestLivingSettlement(s, 60, 0)!.id).toBe(2);
    expect(nearestLivingSettlement([set(1, 'ruin', 0, 0)], 0, 0)).toBeNull();
  });
});

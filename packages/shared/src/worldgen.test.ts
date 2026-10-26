import { describe, expect, it } from 'vitest';
import { generateWorld, settlementsConnected } from './worldgen';
import { O, objectBlocks, type BuildingDef, type WorldData } from './terrain';
import { dist, isPassable, reachableFrom } from './worldgrid';

const SEEDS = [1337, 1, 7, 42, 2024];

function buildingsOf(world: WorldData, sid: number): BuildingDef[] {
  return world.buildings.filter((b) => b.settlementId === sid);
}

describe('worldgen layouts', () => {
  for (const seed of SEEDS) {
    const world = generateWorld(seed);
    const spawnReach = (sid: number) => reachableFrom(world, world.settlements[sid].spawn.x, world.settlements[sid].spawn.y);

    it(`seed ${seed}: is deterministic and connected`, () => {
      const again = generateWorld(seed);
      expect(again.buildings).toEqual(world.buildings);
      expect(again.terrain).toEqual(world.terrain);
      expect(again.objects).toEqual(world.objects);
      expect(settlementsConnected(world)).toBe(true);
    });

    it(`seed ${seed}: every living settlement has a shrine and every one but the hamlets a dojo`, () => {
      for (const s of world.settlements) {
        if (s.kind === 'ruin') continue;
        const kinds = new Set(buildingsOf(world, s.id).map((b) => b.kind));
        if (s.kind !== 'hamlet') expect(kinds.has('dojo'), `${s.name} dojo`).toBe(true);
        expect(kinds.has('shrine'), `${s.name} shrine`).toBe(true);
      }
    });

    it(`seed ${seed}: towns, sect halls and forts have one reachable hermitage outside the ring`, () => {
      for (const s of world.settlements) {
        const hs = buildingsOf(world, s.id).filter((b) => b.kind === 'hermitage');
        if (s.kind === 'town' || s.kind === 'sectHall' || s.kind === 'fort') {
          expect(hs, s.name).toHaveLength(1);
          const h = hs[0];
          const d = dist(h.x + h.w / 2, h.y + h.d / 2, s.x, s.y);
          expect(d).toBeGreaterThan(s.radius + 2);
          expect(d).toBeLessThan(s.radius + 17);
          expect(isPassable(world, h.door.x, h.door.y)).toBe(true);
          expect(spawnReach(s.id)[h.door.y * world.w + h.door.x]).toBe(1);
        } else expect(hs).toHaveLength(0);
      }
    });

    it(`seed ${seed}: key entrances and shrine nodes stand on open ground`, () => {
      const KEY = new Set(['inn', 'market', 'smithy', 'alchemy', 'shrine', 'dojo', 'hall', 'pagoda', 'hermitage', 'teahouse']);
      for (const b of world.buildings) {
        if (!KEY.has(b.kind)) continue;
        for (let dy = 0; dy < 2; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const o = world.objects[(b.door.y + dy) * world.w + b.door.x + dx];
            expect(o === O.Pine || o === O.Oak || o === O.Bamboo || o === O.Boulder || o === O.DeadTree, `${b.kind}#${b.id} at ${dx},${dy}`).toBe(false);
          }
        }
      }
      for (const n of world.nodes) {
        if (n.kind !== 'shrine') continue;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(objectBlocks(world.objects[(n.y + dy) * world.w + n.x + dx]) && world.objects[(n.y + dy) * world.w + n.x + dx] !== O.Building).toBe(false);
      }
    });
  }

  it('gives every fort and town a shrine building', () => {
    for (const seed of SEEDS) {
      const world = generateWorld(seed);
      for (const s of world.settlements) {
        if (s.kind !== 'fort' && s.kind !== 'town') continue;
        expect(buildingsOf(world, s.id).some((b) => b.kind === 'shrine')).toBe(true);
      }
    }
  });
});

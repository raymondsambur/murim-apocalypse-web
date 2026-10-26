import { describe, expect, it } from 'vitest';
import { generateWorld, settlementsConnected } from './worldgen';
import { O, T, TERRAIN_INFO, objectBlocks, type BuildingDef, type WorldData } from './terrain';
import { SPECS } from './townlayout';
import { dist, isPassable, reachableFrom } from './worldgrid';

const SEEDS = [1337, 1, 7, 42, 2024, 5, 9];

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

    it(`seed ${seed}: settlements are as big as their spec and every living one has a layout`, () => {
      for (const s of world.settlements) {
        expect(s.radius, s.name).toBe(SPECS[s.kind].radius);
        if (s.kind === 'ruin') expect(s.layout).toBeUndefined();
        else expect(s.layout, s.name).toBeTruthy();
      }
    });

    it(`seed ${seed}: buildings stand clear of streets, plazas, water and each other, with a reachable door`, () => {
      const owner = new Map<number, number>();
      for (const b of world.buildings) {
        // ruins and mine mouths come from older generators with looser rules
        if (world.settlements[b.settlementId].kind === 'ruin' || b.kind === 'mineEntrance') continue;
        for (let y = b.y; y < b.y + b.d; y++) {
          for (let x = b.x; x < b.x + b.w; x++) {
            const i = y * world.w + x;
            const t = world.terrain[i];
            expect(world.objects[i], `${b.kind}#${b.id} tile ${x},${y}`).toBe(O.Building);
            expect([T.Road, T.Plaza, T.Bridge, T.Farm, T.Water, T.DeepWater, T.Rock], `${b.kind}#${b.id} on terrain ${t}`).not.toContain(t);
            expect(owner.has(i), `${b.kind}#${b.id} overlaps #${owner.get(i)}`).toBe(false);
            owner.set(i, b.id);
          }
        }
        // the door is a walkable tile outside the footprint, touching it, and the settlement's streets reach it
        expect(isPassable(world, b.door.x, b.door.y), `${b.kind}#${b.id} door ${b.door.x},${b.door.y}`).toBe(true);
        const inFront = (b.door.y === b.y + b.d && b.door.x >= b.x && b.door.x < b.x + b.w) || (b.door.x === b.x + b.w && b.door.y >= b.y && b.door.y < b.y + b.d);
        expect(inFront, `${b.kind}#${b.id} door is on the south or east side`).toBe(true);
        const s = world.settlements[b.settlementId];
        expect(spawnReach(s.id)[b.door.y * world.w + b.door.x], `${b.kind}#${b.id} of ${s.name}: door not reachable from the spawn`).toBe(1);
      }
    });

    it(`seed ${seed}: towns have barracks, the market and the shrine; settlements have most of their programme`, () => {
      for (const s of world.settlements) {
        if (s.kind === 'ruin') continue;
        const kinds = buildingsOf(world, s.id).map((b) => b.kind);
        const count = (k: string) => kinds.filter((x) => x === k).length;
        if (s.kind === 'town') expect(count('barracks'), `${s.name} barracks`).toBe(2);
        if (s.kind === 'fort') expect(count('barracks'), `${s.name} barracks`).toBe(3);
        if (s.kind === 'village' || s.kind === 'town' || s.kind === 'fort') expect(count('inn'), `${s.name} inn`).toBeGreaterThanOrEqual(1);
        const want = SPECS[s.kind].program.length;
        const placed = kinds.filter((k) => k !== 'hermitage' && k !== 'tower' && k !== 'mineEntrance').length;
        expect(placed, `${s.name} (${s.kind}, ${s.layout})`).toBeGreaterThanOrEqual(Math.ceil(want * (s.kind === 'hamlet' ? 0.7 : 0.85)));
        // beds for the people the sim seeds: four to a house
        const beds = 4 * (count('house') + count('farmhouse'));
        expect(beds, `${s.name} beds`).toBeGreaterThanOrEqual(s.kind === 'hamlet' ? 8 : s.kind === 'village' ? 24 : s.kind === 'town' ? 56 : 12);
      }
    });

    it(`seed ${seed}: enclosures leave the four axes open and the avenues run out to the edge`, () => {
      for (const s of world.settlements) {
        if (s.kind === 'ruin') continue;
        const R = s.radius;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          // the opening in the enclosure (R - 1) and the first tile outside it
          for (const k of [R - 1, R, R + 1]) {
            const x = s.x + dx * k;
            const y = s.y + dy * k;
            const o = world.objects[y * world.w + x];
            const t = world.terrain[y * world.w + x];
            if (t === T.Water || t === T.DeepWater || t === T.Rock) continue;
            expect(objectBlocks(o), `${s.name} axis ${dx},${dy} at ${k}`).toBe(false);
          }
        }
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

  it('chooses different layouts: across the test seeds every archetype shows up and no seed repeats one everywhere', () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const world = generateWorld(seed);
      const here = world.settlements.filter((s) => s.layout).map((s) => s.layout);
      for (const l of here) seen.add(l as string);
      expect(new Set(here).size, `seed ${seed}`).toBeGreaterThanOrEqual(2);
    }
    expect(seen.size).toBeGreaterThanOrEqual(5);
  });

  it('puts palisades on walled towns, walls on forts and sect halls, rails on villages', () => {
    const found = new Map<string, Set<number>>();
    for (const seed of SEEDS) {
      const world = generateWorld(seed);
      for (const s of world.settlements) {
        if (s.kind === 'ruin') continue;
        const codes = found.get(s.kind) ?? new Set<number>();
        // the enclosure is the square ring at radius - 1
        const E = s.radius - 1;
        for (let t = -E; t <= E; t++) {
          for (const [x, y] of [[s.x + t, s.y - E], [s.x + t, s.y + E], [s.x - E, s.y + t], [s.x + E, s.y + t]] as const) {
            const o = world.objects[y * world.w + x];
            if (o === O.Wall || o === O.Palisade || o === O.Fence) codes.add(o);
          }
        }
        found.set(s.kind, codes);
      }
    }
    expect([...found.get('fort')!]).toEqual([O.Wall]);
    expect(found.get('sectHall')!.has(O.Wall)).toBe(true);
    expect(found.get('town')!.has(O.Palisade)).toBe(true);
    expect(found.get('village')!.has(O.Fence)).toBe(true);
    expect(found.get('hamlet')!.has(O.Fence)).toBe(true);
  });

  it('places the settlements on dry ground with the avenues leaving over land, for many seeds', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const world = generateWorld(seed);
      expect(world.settlements.length, `seed ${seed}`).toBe(8);
      expect(settlementsConnected(world), `seed ${seed}`).toBe(true);
      for (const s of world.settlements) {
        if (s.kind === 'ruin') continue;
        let land = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) if (TERRAIN_INFO[world.terrain[(s.y + dy * (s.radius + 1)) * world.w + s.x + dx * (s.radius + 1)]].passable) land++;
        expect(land, `${s.name} (seed ${seed})`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});

import { STEP_MS, T, TERRAIN_INFO, findPath, isPassable, tileSpeed, worldPathGrid, type Dir } from '@murim/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Player } from '../ctx';
import { testWorld } from '../testkit';
import { EntityStoreImpl } from './entities';
import { Movement, faceFor, stepDuration } from './movement';

const world = testWorld();
const grid = worldPathGrid(world);
const start = world.settlements[0].spawn;

let t = 0;
let store: EntityStoreImpl;
let mv: Movement;
beforeEach(() => {
  t = 1_000_000;
  store = new EntityStoreImpl(world.w, world.h, () => t);
  mv = new Movement(world, grid, store, () => t);
});

/** Run the movement update in 50 ms slices until idle; returns the elapsed ms. */
function run(limitMs = 120_000): number {
  const t0 = t;
  while (mv.movingCount > 0 && t - t0 < limitMs) {
    t += 50;
    mv.update(t);
  }
  return t - t0;
}

/** The reachable, passable tile closest to `dx,dy` away from the start. */
function walkableOffset(dx: number, dy: number): { x: number; y: number } {
  const cands: { x: number; y: number; d: number }[] = [];
  for (let oy = -8; oy <= 8; oy++) {
    for (let ox = -8; ox <= 8; ox++) {
      const x = start.x + dx + ox;
      const y = start.y + dy + oy;
      if (isPassable(world, x, y)) cands.push({ x, y, d: ox * ox + oy * oy });
    }
  }
  cands.sort((p, q) => p.d - q.d);
  for (const c of cands) if (findPath(grid, start.x, start.y, c.x, c.y) !== null) return { x: c.x, y: c.y };
  throw new Error('no walkable tile near the start');
}

describe('faceFor', () => {
  it('maps cardinal tile steps to the four isometric directions', () => {
    expect(faceFor(1, 0, 3)).toBe(0); // SE
    expect(faceFor(0, 1, 0)).toBe(1); // SW
    expect(faceFor(-1, 0, 0)).toBe(2); // NW
    expect(faceFor(0, -1, 0)).toBe(3); // NE
  });
  it('diagonals follow the dominant screen axis and keep the other half from the previous facing', () => {
    // (+1,+1) is straight down the screen: SE or SW depending on previous side.
    expect(faceFor(1, 1, 0)).toBe(0);
    expect(faceFor(1, 1, 3)).toBe(0);
    expect(faceFor(1, 1, 1)).toBe(1);
    expect(faceFor(1, 1, 2)).toBe(1);
    // (-1,-1) is straight up the screen.
    expect(faceFor(-1, -1, 0)).toBe(3);
    expect(faceFor(-1, -1, 1)).toBe(2);
    // (+1,-1) is straight right: NE or SE.
    expect(faceFor(1, -1, 0)).toBe(0);
    expect(faceFor(1, -1, 2)).toBe(3);
    // (-1,+1) is straight left.
    expect(faceFor(-1, 1, 0)).toBe(1);
    expect(faceFor(-1, 1, 3)).toBe(2);
    const dirs: Dir[] = [0, 1, 2, 3];
    for (const d of dirs) expect(faceFor(0, 0, d)).toBe(d);
  });
});

describe('stepDuration', () => {
  it('scales with terrain, speed and diagonals', () => {
    const { x, y } = start;
    const ts = tileSpeed(world, x + 1, y) || 1;
    expect(stepDuration(world, x, y, x + 1, y, 1)).toBeCloseTo(STEP_MS / ts);
    expect(stepDuration(world, x, y, x + 1, y, 2)).toBeCloseTo(STEP_MS / ts / 2);
    expect(stepDuration(world, x, y, x + 1, y + 1, 1)).toBeCloseTo((STEP_MS / (tileSpeed(world, x + 1, y + 1) || 1)) * Math.SQRT2);
    expect(stepDuration(world, x, y, x + 1, y, 0)).toBeGreaterThan(0);
    expect(stepDuration(world, x, y, x + 1, y, 1e9)).toBeGreaterThan(50);
  });
});

describe('Movement', () => {
  it('walks a path step by step and ends exactly on the target', () => {
    const e = store.create({ kind: 'npc', name: 'W', x: start.x, y: start.y });
    const goal = walkableOffset(6, 0);
    expect(isPassable(world, goal.x, goal.y)).toBe(true);
    const res = mv.moveTo(e, goal.x, goal.y);
    expect(res).toMatchObject({ ok: true, tx: goal.x, ty: goal.y });
    expect(e.move).not.toBeNull();
    expect(e.state).toBe('walk');
    expect(e.move!.nx).not.toBe(e.x === e.move!.nx && e.y === e.move!.ny ? NaN : e.x + 99);
    const elapsed = run();
    expect(e.x).toBe(goal.x);
    expect(e.y).toBe(goal.y);
    expect(e.move).toBeNull();
    expect(e.state).toBe('idle');
    // Fastest terrain is 1.25x, slowest 0.75x; diagonals cost sqrt(2).
    const steps = (res as { steps: number }).steps;
    expect(steps).toBeGreaterThanOrEqual(4);
    expect(elapsed).toBeGreaterThanOrEqual(steps * (STEP_MS / 1.25) - 60);
    expect(elapsed).toBeLessThan(steps * (STEP_MS / 0.7) * Math.SQRT2 + 200);
  });

  it('step time follows the entity speed factor', () => {
    const slow = store.create({ kind: 'npc', name: 'S', x: start.x, y: start.y, speed: 1 });
    const fast = store.create({ kind: 'npc', name: 'F', x: start.x, y: start.y + 1, speed: 2 });
    mv.moveTo(slow, start.x + 4, start.y);
    mv.moveTo(fast, start.x + 4, start.y + 1);
    expect(fast.move!.stepMs).toBeLessThan(slow.move!.stepMs);
    expect(fast.move!.stepMs).toBeCloseTo(slow.move!.stepMs / 2, -1);
  });

  it('snaps blocked targets to the nearest walkable tile, or refuses with snap = 0', () => {
    const e = store.create({ kind: 'npc', name: 'W', x: start.x, y: start.y });
    // Find a water tile within sight of the start.
    let water: { x: number; y: number } | null = null;
    for (let r = 2; r < 60 && !water; r++) {
      for (let dy = -r; dy <= r && !water; dy++) {
        for (let dx = -r; dx <= r && !water; dx++) {
          const x = start.x + dx;
          const y = start.y + dy;
          if (x >= 0 && y >= 0 && x < world.w && y < world.h && !TERRAIN_INFO[world.terrain[y * world.w + x]].passable) water = { x, y };
        }
      }
    }
    expect(water).not.toBeNull();
    expect(mv.moveTo(e, water!.x, water!.y, { snap: 0 })).toEqual({ ok: false, reason: 'blocked' });
    const snapped = mv.moveTo(e, water!.x, water!.y, { snap: 6 });
    if (snapped.ok) expect(isPassable(world, snapped.tx, snapped.ty)).toBe(true);
    else expect(['blocked', 'unreachable', 'too_far']).toContain(snapped.reason);
  });

  it('reports too_far and bad input without throwing', () => {
    const e = store.create({ kind: 'npc', name: 'W', x: start.x, y: start.y });
    expect(mv.moveTo(e, start.x + 50, start.y, { maxSteps: 10 })).toEqual({ ok: false, reason: 'too_far' });
    expect(mv.moveTo(e, NaN, 5)).toEqual({ ok: false, reason: 'blocked' });
    expect(mv.moveTo(e, -50, -50, { snap: 0 })).toEqual({ ok: false, reason: 'blocked' });
    expect(mv.moveTo({ ...e, id: 99999 } as never, 1, 1)).toEqual({ ok: false, reason: 'blocked' });
  });

  it('a new move mid-step finishes the current step first and cancels the old callback', () => {
    const e = store.create({ kind: 'npc', name: 'W', x: start.x, y: start.y });
    const results: string[] = [];
    mv.moveTo(e, start.x + 8, start.y, { onArrive: (_e, r) => results.push(`first:${r}`) });
    t += 100;
    mv.update(t);
    const firstStepTarget = { x: e.move!.nx, y: e.move!.ny };
    const goal = walkableOffset(0, 5);
    mv.moveTo(e, goal.x, goal.y, { onArrive: (_e, r) => results.push(`second:${r}`) });
    expect(results).toEqual(['first:cancelled']);
    // The step in progress is kept.
    expect(e.move!.nx).toBe(firstStepTarget.x);
    expect(e.move!.ny).toBe(firstStepTarget.y);
    run();
    expect(e.x).toBe(goal.x);
    expect(e.y).toBe(goal.y);
    expect(results).toEqual(['first:cancelled', 'second:arrived']);
  });

  it('stop() halts after the current step; immediate stop halts now', () => {
    const a = store.create({ kind: 'npc', name: 'A', x: start.x, y: start.y });
    const b = store.create({ kind: 'npc', name: 'B', x: start.x, y: start.y + 1 });
    const res: string[] = [];
    mv.moveTo(a, start.x + 8, start.y, { onArrive: (_e, r) => res.push(`a:${r}`) });
    mv.moveTo(b, start.x + 8, start.y + 1, { onArrive: (_e, r) => res.push(`b:${r}`) });
    mv.stop(a);
    mv.stop(b, true);
    expect(b.move).toBeNull();
    expect(res).toEqual(['b:cancelled']);
    run();
    expect(a.move).toBeNull();
    expect(Math.abs(a.x - start.x)).toBeLessThanOrEqual(1);
    expect(res).toContain('a:cancelled');
  });

  it('removing an entity mid-walk cancels cleanly', () => {
    const e = store.create({ kind: 'npc', name: 'W', x: start.x, y: start.y });
    const res: string[] = [];
    mv.moveTo(e, start.x + 8, start.y, { onArrive: (_e, r) => res.push(r) });
    store.remove(e);
    expect(res).toEqual(['removed']);
    expect(mv.movingCount).toBe(0);
    expect(() => mv.update(t + 10_000)).not.toThrow();
  });

  it('teleport cancels the move and relocates', () => {
    const e = store.create({ kind: 'npc', name: 'W', x: start.x, y: start.y });
    mv.moveTo(e, start.x + 8, start.y);
    mv.teleport(e, start.x, start.y + 3);
    expect(e.move).toBeNull();
    expect(e.x).toBe(start.x);
    expect(e.y).toBe(start.y + 3);
  });

  it('never fast-forwards after a long stall', () => {
    const e = store.create({ kind: 'npc', name: 'W', x: start.x, y: start.y });
    mv.moveTo(e, start.x + 10, start.y);
    t += 60_000;
    mv.update(t);
    expect(Math.abs(e.x - start.x)).toBeLessThanOrEqual(7);
    expect(e.move).not.toBeNull();
  });

  it('followPath only accepts adjacent, passable tiles', () => {
    const e = store.create({ kind: 'npc', name: 'W', x: start.x, y: start.y });
    expect(mv.followPath(e, [{ x: start.x + 5, y: start.y }])).toBe(false);
    expect(mv.followPath(e, [])).toBe(false);
    expect(mv.followPath(e, [{ x: start.x + 1, y: start.y }, { x: start.x + 2, y: start.y }])).toBe(true);
    run();
    expect(e.x).toBe(start.x + 2);
  });

  it('guards decide whether a player may move', () => {
    const p = { combatId: null, save: { activity: null } } as unknown as Player;
    expect(mv.canMove(p)).toBeNull();
    mv.guards.push((pl) => (pl.combatId !== null ? 'busy' : null));
    expect(mv.canMove({ ...p, combatId: 3 } as Player)).toBe('busy');
  });

  describe('approach', () => {
    it('stops next to the target instead of on top of it', () => {
      const e = store.create({ kind: 'player', name: 'P', x: start.x, y: start.y });
      const spot = walkableOffset(6, 0);
      const goal = store.create({ kind: 'npc', name: 'N', x: spot.x, y: spot.y });
      const res: string[] = [];
      const r = mv.approach(e, goal, { onArrive: (_e, x) => res.push(x) });
      expect(r.ok).toBe(true);
      run();
      expect(res).toEqual(['arrived']);
      const d = Math.hypot(e.x - goal.x, e.y - goal.y);
      expect(d).toBeLessThanOrEqual(1.5);
      expect(d).toBeGreaterThan(0);
    });

    it('fires immediately when already in range', () => {
      const e = store.create({ kind: 'player', name: 'P', x: start.x, y: start.y });
      const spot = walkableOffset(1, 0);
      const goal = store.create({ kind: 'npc', name: 'N', x: spot.x, y: spot.y });
      let result = '';
      const r = mv.approach(e, goal, { onArrive: (_e, x) => (result = x) });
      expect(r).toMatchObject({ ok: true, steps: 0 });
      expect(result).toBe('arrived');
      expect(e.move).toBeNull();
    });

    it('chases a target that walks away and gives up when it vanishes', () => {
      const e = store.create({ kind: 'player', name: 'P', x: start.x, y: start.y });
      const goal = store.create({ kind: 'monster', name: 'M', x: start.x + 6, y: start.y });
      const res: string[] = [];
      mv.approach(e, goal, { onArrive: (_e, x) => res.push(x) });
      t += 600;
      mv.update(t);
      store.setPos(goal, start.x + 6, start.y + 3);
      run();
      expect(res).toEqual(['arrived']);
      expect(Math.hypot(e.x - goal.x, e.y - goal.y)).toBeLessThanOrEqual(1.5);

      const e2 = store.create({ kind: 'player', name: 'P2', x: start.x, y: start.y });
      const goal2 = store.create({ kind: 'monster', name: 'M2', x: start.x + 8, y: start.y });
      const res2: string[] = [];
      mv.approach(e2, goal2, { onArrive: (_e, x) => res2.push(x) });
      store.remove(goal2);
      run();
      expect(res2).toEqual(['cancelled']);
    });
  });
});

describe('world sanity', () => {
  it('the start village is walkable', () => {
    expect(isPassable(world, start.x, start.y)).toBe(true);
    expect(world.terrain[start.y * world.w + start.x]).not.toBe(T.DeepWater);
  });
});

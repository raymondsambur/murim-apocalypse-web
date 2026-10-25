/** Shared helpers for the simulation tests (not used at runtime). */
import { generateWorld, type SimEvent, type WorldData } from '@murim/shared';
import type { Sim } from './api';
import { createSim } from './index';
import type { SimStateX } from './types';

export const HOUR_MS = 60000;
export const PROD_SEED = 1337;

const worlds = new Map<number, WorldData>();
export function worldFor(seed: number): WorldData {
  let w = worlds.get(seed);
  if (!w) {
    w = generateWorld(seed);
    worlds.set(seed, w);
  }
  return w;
}

export function makeSim(seed = PROD_SEED, saved?: { json: string; blight: string } | null): Sim {
  return createSim(worldFor(seed), { seed, hourMs: HOUR_MS, nowMs: 0, saved: saved ?? null });
}

export function stateOf(sim: Sim): SimStateX {
  return sim.state as SimStateX;
}

/** Advance whole days, returning every event (nowMs follows the sim hour). */
export function runDays(sim: Sim, days: number, onDay?: (day: number, events: SimEvent[]) => void): SimEvent[] {
  const all: SimEvent[] = [];
  const startH = sim.clock().totalHours;
  for (let d = 1; d <= days; d++) {
    const ev = sim.advanceHours(24, (startH + d * 24) * HOUR_MS);
    all.push(...ev);
    onDay?.(sim.clock().day, ev);
  }
  return all;
}

export function runHours(sim: Sim, hours: number): SimEvent[] {
  const out: SimEvent[] = [];
  for (let h = 0; h < hours; h++) out.push(...sim.advanceHours(1, (sim.clock().totalHours + 1) * HOUR_MS));
  return out;
}

export function landTiles(world: WorldData): number {
  let n = 0;
  for (let i = 0; i < world.w * world.h; i++) {
    const t = world.terrain[i];
    if (t !== 0 && t !== 1 && t !== 8) n++;
  }
  return n;
}

export function coverage(sim: Sim, world: WorldData, threshold = 16): number {
  const b = stateOf(sim).blight;
  let n = 0;
  for (let i = 0; i < b.length; i++) if (b[i] >= threshold) n++;
  return (n / landTiles(world)) * 100;
}

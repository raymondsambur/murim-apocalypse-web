/** Builds the rumor `SpreadEnv` from the live game: roads from the world, status from the sim, NPCs from the sim roster. */
import type { GameContext } from '../ctx';
import { FACTIONS } from '@murim/shared';
import { gossipiness, type RoadState, type SpreadEnv } from './rumors';
import { RUMOR } from './tuning';

export interface GameSpreadEnv extends SpreadEnv {
  /** Call once per world hour: clears the per-hour caches (road Blight, gossip levels, rosters). */
  refresh(): void;
}

export function makeSpreadEnv(ctx: GameContext): GameSpreadEnv {
  const world = ctx.world;
  const adj = new Map<number, number[]>();
  for (const s of world.settlements) adj.set(s.id, []);
  for (const [a, b] of world.roads) {
    adj.get(a)?.push(b);
    adj.get(b)?.push(a);
  }
  const roadCache = new Map<number, RoadState>();
  const gossipCache = new Map<number, number>();
  const npcCache = new Map<number, { id: number; traits: readonly string[]; role: string }[]>();

  const status = (id: number): string => {
    try {
      return ctx.sim.settlementView(id).status;
    } catch {
      return 'fallen';
    }
  };

  const blightOnRoad = (a: number, b: number): number => {
    const sa = world.settlements[a];
    const sb = world.settlements[b];
    if (!sa || !sb) return 0;
    const len = Math.hypot(sa.x - sb.x, sa.y - sb.y);
    const steps = Math.max(2, Math.ceil(len / 8));
    let sum = 0;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      sum += ctx.sim.blightAt(Math.round(sa.x + (sb.x - sa.x) * t), Math.round(sa.y + (sb.y - sa.y) * t));
    }
    return sum / (steps + 1);
  };

  const env: GameSpreadEnv = {
    refresh() {
      roadCache.clear();
      gossipCache.clear();
      npcCache.clear();
    },
    neighbors: (id) => adj.get(id) ?? [],
    distance(a, b) {
      const sa = world.settlements[a];
      const sb = world.settlements[b];
      return sa && sb ? Math.hypot(sa.x - sb.x, sa.y - sb.y) : 100;
    },
    road(a, b) {
      const key = Math.min(a, b) * 1000 + Math.max(a, b);
      let state = roadCache.get(key);
      if (state === undefined) {
        const sa = status(a);
        const sb = status(b);
        if (sa === 'fallen' || sb === 'fallen' || blightOnRoad(a, b) >= RUMOR.blightRoad) state = 'blocked';
        else if (sa === 'besieged' || sb === 'besieged') state = 'perilous';
        else state = 'open';
        roadCache.set(key, state);
      }
      return state;
    },
    alive: (id) => status(id) !== 'fallen',
    npcs(id) {
      let list = npcCache.get(id);
      if (!list) {
        list = ctx.sim.npcs(id).filter((n) => n.alive).map((n) => ({ id: n.id, traits: n.traits, role: n.role }));
        npcCache.set(id, list);
      }
      return list;
    },
    gossip(id) {
      let g = gossipCache.get(id);
      if (g === undefined) {
        const list = env.npcs(id);
        g = list.length ? list.reduce((s, n) => s + gossipiness(n.traits, n.role), 0) / list.length : 0.2;
        gossipCache.set(id, g);
      }
      return g;
    },
    factionIds: () => FACTIONS.map((f) => f.id),
    settlementIds: () => world.settlements.map((s) => s.id),
  };
  return env;
}

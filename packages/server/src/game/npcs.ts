/**
 * Map entities for the sim's named NPCs: spawn, idle wandering near home, and re-sync on
 * sim events (deaths, births, moves). The sim owns NPC lives; this only mirrors them.
 */
import { AOI_RADIUS, isPassable, nearestWalkable, type NpcRole, type NpcState, type PathGrid, type Rng, type SimEvent, type WorldData } from '@murim/shared';
import { NPC_DATA, type Entity, type NpcEntityData, type Player } from '../ctx';
import type { Sim } from '../sim/api';
import type { EntityStoreImpl } from './entities';
import type { Logger } from './log';
import { faceFor, type Movement } from './movement';

export const NPC_WALK_SPEED = 0.55;
/** How long an NPC stands still facing a player who talked to it. */
export const NPC_ATTEND_MS = 10000;

interface WanderProfile {
  radius: number;
  pauseMin: number;
  pauseMax: number;
}

function profileFor(role: NpcRole, legend: boolean): WanderProfile {
  if (legend || role === 'guard' || role === 'legend') return { radius: 1, pauseMin: 12000, pauseMax: 30000 };
  if (role === 'master' || role === 'elder' || role === 'innkeeper' || role === 'merchant' || role === 'smith' || role === 'alchemist') return { radius: 2, pauseMin: 8000, pauseMax: 20000 };
  return { radius: 3, pauseMin: 4000, pauseMax: 12000 };
}

export interface NpcDeps {
  world: WorldData;
  grid: PathGrid;
  sim: Sim;
  entities: EntityStoreImpl;
  movement: Movement;
  rng: Rng;
  log: Logger;
  now: () => number;
}

export class NpcManager {
  private readonly byNpc = new Map<number, Entity>();
  private order: number[] = [];
  private cursor = 0;

  constructor(private readonly d: NpcDeps) {
    d.entities.onRemove((e) => {
      const data = NPC_DATA.get(e);
      if (data && this.byNpc.get(data.npcId) === e) this.byNpc.delete(data.npcId);
    });
  }

  get count(): number {
    return this.byNpc.size;
  }

  entityFor(npcId: number): Entity | undefined {
    return this.byNpc.get(npcId);
  }

  /** Spawn entities for every living NPC (boot). */
  spawnAll(): void {
    this.syncAll();
  }

  private homeTile(npc: NpcState): { x: number; y: number } {
    const { world, grid } = this.d;
    if (isPassable(world, npc.homeX, npc.homeY)) return { x: npc.homeX, y: npc.homeY };
    const near = nearestWalkable(grid, npc.homeX, npc.homeY, 5);
    if (near) return near;
    const s = world.settlements[npc.settlementId] ?? world.settlements[0];
    return nearestWalkable(grid, s.spawn.x, s.spawn.y, 6) ?? { ...s.spawn };
  }

  private spawn(npc: NpcState): Entity {
    const home = this.homeTile(npc);
    const now = this.d.now();
    const data: NpcEntityData = { npcId: npc.id, settlementId: npc.settlementId, homeX: home.x, homeY: home.y, holdUntil: 0, nextWanderAt: now + this.d.rng.int(1000, 8000) };
    const e = this.d.entities.create({
      kind: 'npc',
      name: npc.name,
      x: home.x,
      y: home.y,
      face: this.d.rng.int(0, 3) as 0 | 1 | 2 | 3,
      speed: NPC_WALK_SPEED,
      look: npc.look,
      role: npc.role,
      lv: npc.level,
      tag: npc.title || undefined,
      faction: npc.faction ?? undefined,
      data: { [NPC_DATA.name]: data },
    });
    this.byNpc.set(npc.id, e);
    this.order.push(npc.id);
    return e;
  }

  private despawn(npcId: number): void {
    const e = this.byNpc.get(npcId);
    if (e) this.d.entities.remove(e);
    this.byNpc.delete(npcId);
  }

  /** Refresh visible fields from the sim; returns false if the entity must be re-created. */
  private refresh(e: Entity, npc: NpcState): boolean {
    const data = NPC_DATA.get(e);
    if (!data) return false;
    if (npc.homeX !== data.homeX || npc.homeY !== data.homeY || npc.settlementId !== data.settlementId) {
      const home = this.homeTile(npc);
      data.settlementId = npc.settlementId;
      data.homeX = home.x;
      data.homeY = home.y;
      // Moved far (new settlement): re-create so clients see it vanish and appear.
      if (Math.max(Math.abs(e.x - home.x), Math.abs(e.y - home.y)) > 12) return false;
    }
    const tag = npc.title || undefined;
    const faction = npc.faction ?? undefined;
    if (e.name !== npc.name || e.lv !== npc.level || e.role !== npc.role || e.tag !== tag || e.faction !== faction || e.look !== npc.look) {
      e.name = npc.name;
      e.lv = npc.level;
      e.role = npc.role;
      e.tag = tag;
      e.faction = faction;
      e.look = npc.look;
      this.d.entities.touch(e);
    }
    return true;
  }

  private resync(npcId: number): void {
    const npc = this.d.sim.npc(npcId);
    const e = this.byNpc.get(npcId);
    if (!npc || !npc.alive) {
      this.despawn(npcId);
      return;
    }
    if (!e) {
      this.spawn(npc);
      return;
    }
    if (!this.refresh(e, npc)) {
      this.despawn(npcId);
      this.spawn(npc);
    }
  }

  /** Full reconciliation with the sim roster (boot and every world hour). */
  syncAll(): void {
    const alive = new Set<number>();
    for (const npc of this.d.sim.npcs()) {
      if (!npc.alive) continue;
      alive.add(npc.id);
      this.resync(npc.id);
    }
    for (const id of [...this.byNpc.keys()]) if (!alive.has(id)) this.despawn(id);
    this.order = [...this.byNpc.keys()];
    this.cursor = 0;
  }

  onSimEvents(events: readonly SimEvent[]): void {
    let structural = false;
    for (const ev of events) {
      if (ev.k === 'npcDied') this.despawn(ev.id);
      else if (ev.k === 'npcBorn' || ev.k === 'npcMoved') this.resync(ev.id);
      else continue;
      structural = true;
    }
    if (structural) this.order = [...this.byNpc.keys()];
  }

  /** Talking to an NPC: it stops, turns to the player and stays put for a while. */
  attend(e: Entity, p: Player): void {
    const data = NPC_DATA.get(e);
    if (!data) return;
    data.holdUntil = this.d.now() + NPC_ATTEND_MS;
    this.d.movement.stop(e);
    const face = faceFor(p.entity.x - e.x, p.entity.y - e.y, e.face);
    if (face !== e.face) {
      e.face = face;
      this.d.entities.touch(e);
    }
  }

  /** Wander a slice of NPCs each tick (each NPC is considered about once per second). */
  tick(now: number, ticksPerSecond = 10): void {
    const n = this.order.length;
    if (n === 0) return;
    const budget = Math.min(n, Math.ceil(n / ticksPerSecond));
    for (let i = 0; i < budget; i++) {
      if (this.cursor >= n) this.cursor = 0;
      const id = this.order[this.cursor++];
      const e = this.byNpc.get(id);
      if (e) this.wander(e, now);
    }
  }

  private wander(e: Entity, now: number): void {
    const data = NPC_DATA.get(e);
    if (!data || e.move || e.state !== 'idle' || now < data.holdUntil || now < data.nextWanderAt) return;
    const npc = this.d.sim.npc(data.npcId);
    if (!npc) return;
    const prof = profileFor(npc.role, npc.legend);
    const { rng } = this.d;
    data.nextWanderAt = now + rng.int(prof.pauseMin, prof.pauseMax);
    // Nobody around to see it: skip the pathfinding.
    if (!this.d.entities.nearest(e.x, e.y, AOI_RADIUS + 4, (o) => o.kind === 'player' && o.online === true)) return;
    if (rng.chance(0.3)) {
      e.face = rng.int(0, 3) as 0 | 1 | 2 | 3;
      this.d.entities.touch(e);
      return;
    }
    const away = Math.max(Math.abs(e.x - data.homeX), Math.abs(e.y - data.homeY));
    let tx = data.homeX;
    let ty = data.homeY;
    if (away <= prof.radius) {
      tx = data.homeX + rng.int(-prof.radius, prof.radius);
      ty = data.homeY + rng.int(-prof.radius, prof.radius);
    }
    if ((tx === e.x && ty === e.y) || !isPassable(this.d.world, tx, ty)) return;
    this.d.movement.moveTo(e, tx, ty, { snap: 0, maxSteps: prof.radius * 2 + 12, maxNodes: 400 });
  }
}

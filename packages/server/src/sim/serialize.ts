/**
 * Snapshot format: `json` holds the whole SimState except the Blight grid, written with a fixed
 * key order so equal states serialize to equal bytes; `blight` is the grid as base64.
 */
import type { MissionOffer, SimState } from '@murim/shared';
import type { SerializedSim } from './api';
import { SIM_VERSION } from './constants';
import type { SimExt, SimStateX } from './types';
import { fromBase64, toBase64 } from './util';

export function newExt(): SimExt {
  return {
    siegeCooldown: {},
    siegeKills: {},
    fallenAt: {},
    lowDays: {},
    flagUntil: {},
    nextAct: {},
    warSince: {},
    truceUntil: {},
    caravanUntil: 0,
    roadBlocked: [],
    heartFlare: {},
    frontier: {},
    chronKeys: {},
    chronDay: -1,
    chronCount: [0, 0, 0],
    killDay: -1,
    killCredit: 0,
    boardSize: {},
    boardDirty: [],
    succession: [],
    lastFallHour: -999999,
    formerOwner: {},
    lostAt: {},
    lockUntil: {},
    stats: {},
  };
}

/** Fill any field an older snapshot lacks, keeping the canonical key order. */
function normalizeExt(raw: Partial<SimExt> | undefined): SimExt {
  const base = newExt();
  const r = raw ?? {};
  const out = {} as Record<string, unknown>;
  for (const k of Object.keys(base) as (keyof SimExt)[]) out[k] = r[k] !== undefined ? r[k] : base[k];
  return out as unknown as SimExt;
}

/** The persisted object with canonical key order (also the shape of `sim.state` minus the grid). */
function canonical(st: SimStateX): Omit<SimStateX, 'blight'> {
  return {
    version: st.version,
    seed: st.seed,
    clock: { totalHours: st.clock.totalHours },
    weather: st.weather,
    hearts: st.hearts,
    settlements: st.settlements,
    factions: st.factions,
    npcs: st.npcs,
    chronicle: st.chronicle,
    boards: st.boards,
    rng: st.rng,
    nextNpcId: st.nextNpcId,
    nextChronicleId: st.nextChronicleId,
    nextOfferId: st.nextOfferId,
    ext: st.ext,
  };
}

export function serializeState(st: SimStateX): SerializedSim {
  return { json: JSON.stringify(canonical(st)), blight: toBase64(st.blight) };
}

export interface RestoreCheck {
  seed: number;
  tiles: number;
  settlements: number;
  hearts: number;
}

export function restoreState(saved: SerializedSim, check: RestoreCheck): SimStateX {
  let j: Partial<SimStateX>;
  try {
    j = JSON.parse(saved.json) as Partial<SimStateX>;
  } catch (e) {
    throw new Error(`sim snapshot is not valid JSON: ${(e as Error).message}`);
  }
  if (!j || typeof j !== 'object') throw new Error('sim snapshot is malformed');
  if (typeof j.version !== 'number') throw new Error('sim snapshot has no version');
  if (j.version > SIM_VERSION) throw new Error(`sim snapshot version ${j.version} is newer than this build (${SIM_VERSION})`);
  if (j.seed !== check.seed) throw new Error(`sim snapshot is for seed ${String(j.seed)}, not ${check.seed}`);
  if (!j.clock || typeof j.clock.totalHours !== 'number' || !Number.isFinite(j.clock.totalHours)) throw new Error('sim snapshot has no clock');
  if (!Array.isArray(j.settlements) || j.settlements.length !== check.settlements) throw new Error('sim snapshot does not match this world (settlements)');
  if (!Array.isArray(j.hearts) || j.hearts.length !== check.hearts) throw new Error('sim snapshot does not match this world (hearts)');
  for (const k of ['weather', 'factions', 'npcs', 'chronicle'] as const) {
    if (!Array.isArray(j[k])) throw new Error(`sim snapshot is missing ${k}`);
  }
  if (typeof saved.blight !== 'string') throw new Error('sim snapshot has no blight grid');
  const blight = fromBase64(saved.blight, check.tiles);
  const st: SimStateX = {
    version: SIM_VERSION,
    seed: j.seed,
    clock: { totalHours: j.clock.totalHours },
    weather: j.weather!,
    blight,
    hearts: j.hearts,
    settlements: j.settlements,
    factions: j.factions!,
    npcs: j.npcs!,
    chronicle: j.chronicle!,
    boards: (j.boards ?? {}) as Record<number, MissionOffer[]>,
    rng: typeof j.rng === 'number' ? j.rng : 1,
    nextNpcId: j.nextNpcId ?? 1,
    nextChronicleId: j.nextChronicleId ?? 1,
    nextOfferId: j.nextOfferId ?? 1,
    ext: normalizeExt(j.ext),
  };
  // Older snapshots may lack optional settlement fields.
  for (const s of st.settlements) {
    if (s.siegeBy === undefined) s.siegeBy = null;
    if (!Array.isArray(s.flags)) s.flags = [];
  }
  return st;
}

export type { SimState };

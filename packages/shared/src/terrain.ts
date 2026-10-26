/** Terrain and object codes stored in the world grids (one byte per tile). */

export const T = {
  DeepWater: 0,
  Water: 1,
  Grass: 2,
  Plains: 3,
  Forest: 4,
  Dirt: 5,
  Road: 6,
  Plaza: 7,
  Rock: 8,
  Hill: 9,
  Sand: 10,
  Snow: 11,
  Bridge: 12,
  Farm: 13,
  Ruin: 14,
} as const;

export const TERRAIN_COUNT = 15;

export interface TerrainInfo {
  name: string;
  passable: boolean;
  /** Movement speed multiplier. */
  speed: number;
}

export const TERRAIN_INFO: readonly TerrainInfo[] = [
  { name: 'Deep Water', passable: false, speed: 0 },
  { name: 'Water', passable: false, speed: 0 },
  { name: 'Grassland', passable: true, speed: 1 },
  { name: 'Plains', passable: true, speed: 1 },
  { name: 'Forest', passable: true, speed: 0.85 },
  { name: 'Dirt Road', passable: true, speed: 1.2 },
  { name: 'Stone Road', passable: true, speed: 1.25 },
  { name: 'Plaza', passable: true, speed: 1.25 },
  { name: 'Mountain', passable: false, speed: 0 },
  { name: 'Highlands', passable: true, speed: 0.75 },
  { name: 'Sand', passable: true, speed: 0.9 },
  { name: 'Snowfield', passable: true, speed: 0.8 },
  { name: 'Bridge', passable: true, speed: 1.1 },
  { name: 'Farmland', passable: true, speed: 0.95 },
  { name: 'Ruins', passable: true, speed: 0.9 },
];

export const O = {
  None: 0,
  Pine: 1,
  Oak: 2,
  Bamboo: 3,
  Boulder: 4,
  Bush: 5,
  Reeds: 6,
  DeadTree: 7,
  Bones: 8,
  Flowers: 9,
  Banner: 10,
  /** A village well (blocks). */
  Well: 11,
  /** A stone street lantern (decoration, walkable). */
  Lantern: 12,
  /** Tile occupied by a building footprint. */
  Building: 200,
  /** Wall segment (forts, sect halls). */
  Wall: 201,
  /** Timber palisade segment (walled towns), connects like a wall. */
  Palisade: 202,
  /** Low rail fence segment (hamlets, villages), connects like a wall. */
  Fence: 203,
} as const;

export function objectBlocks(o: number): boolean {
  return o === O.Pine || o === O.Oak || o === O.Bamboo || o === O.Boulder || o === O.DeadTree || o === O.Building || o === O.Wall || o === O.Palisade || o === O.Fence || o === O.Well;
}

export type BuildingKind =
  | 'house'
  | 'inn'
  | 'smithy'
  | 'alchemy'
  | 'market'
  | 'shrine'
  | 'pagoda'
  | 'hall'
  | 'dojo'
  | 'farmhouse'
  | 'herbHut'
  | 'mineEntrance'
  | 'tower'
  | 'gate'
  | 'barracks'
  | 'ruinedHouse'
  | 'warehouse'
  | 'teahouse'
  /** A hermit's hut outside the walls where the legends of a town live. */
  | 'hermitage';

export interface BuildingDef {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  w: number;
  d: number;
  settlementId: number;
  /** Tile where interaction happens (in front of the door). */
  door: { x: number; y: number };
}

export type SettlementKind = 'village' | 'hamlet' | 'town' | 'fort' | 'sectHall' | 'ruin';

export type WorkSiteKind = 'herbHut' | 'mine' | 'farm' | 'smithy' | 'alchemyLab' | 'dojo';

export interface WorkSiteDef {
  id: string;
  kind: WorkSiteKind;
  x: number;
  y: number;
  settlementId: number;
}

export interface SettlementDef {
  id: number;
  name: string;
  kind: SettlementKind;
  x: number;
  y: number;
  radius: number;
  /** 0 north, 1 central, 2 south. */
  climate: number;
  spawn: { x: number; y: number };
  buildingIds: number[];
  sites: WorkSiteDef[];
  population: number;
  /** Street layout archetype (see townlayout.ts); absent for ruins. */
  layout?: string;
}

export type MonsterFamily = 'beast' | 'bandit' | 'blight';

export interface SpawnPointDef {
  id: number;
  x: number;
  y: number;
  family: MonsterFamily;
  radius: number;
  /** Danger level 1..n derived from distance to the starting village. */
  danger: number;
  packSize: number;
}

export type NodeKind = 'herb' | 'rareHerb' | 'ore' | 'shrine' | 'heart';

export interface ResourceNodeDef {
  id: number;
  kind: NodeKind;
  x: number;
  y: number;
}

export interface WorldData {
  seed: number;
  w: number;
  h: number;
  terrain: Uint8Array;
  objects: Uint8Array;
  settlements: SettlementDef[];
  buildings: BuildingDef[];
  spawnPoints: SpawnPointDef[];
  nodes: ResourceNodeDef[];
  /** Pairs of settlement ids connected by a road. */
  roads: [number, number][];
}

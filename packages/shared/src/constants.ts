/** World size in tiles. Towns are spread out so that travelling between them takes a while. */
export const WORLD_W = 288;
export const WORLD_H = 192;

/** Isometric tile footprint in screen pixels (2:1 diamond). */
export const TILE_W = 64;
export const TILE_H = 32;

/** Server simulation tick. */
export const TICK_MS = 100;
/** Base time to walk one tile at speed factor 1. */
export const STEP_MS = 420;
/** Distance (tiles) within which a client receives entity updates. */
export const AOI_RADIUS = 28;
/** Distance (tiles) within which local chat is heard. */
export const LOCAL_CHAT_RADIUS = 22;

export const COMBAT_BEAT_MS = 1000;
export const ACTION_THRESHOLD = 100;

export const INVENTORY_SLOTS = 40;
export const OFFLINE_CAP_MS = 8 * 60 * 60 * 1000;
export const MAX_ACTIVE_MISSIONS = 6;

export const MAX_NAME_LENGTH = 16;
export const MIN_NAME_LENGTH = 3;
export const MAX_CHAT_LENGTH = 200;
export const REROLLS = 3;

/** World calendar. */
export const HOURS_PER_DAY = 24;
export const DAYS_PER_SEASON = 30;
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;
export type SeasonName = (typeof SEASONS)[number];

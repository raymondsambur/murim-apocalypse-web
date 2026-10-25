/**
 * Contract between the UI layer (src/ui, src/net, src/state, main.ts) and the world renderer (src/render, src/art).
 * The renderer owns the canvas; the UI never draws into it directly.
 */
import type { CombatEvent, Dir, EntityPatch, EntityView, FxKind, Look, SettlementView, TimeView, WeaponType, WorldPayload } from '@murim/shared';

/** World payload with its grids decoded from base64. */
export interface DecodedWorld {
  payload: WorldPayload;
  terrain: Uint8Array;
  objects: Uint8Array;
}

export interface PickResult {
  /** Tile under the pointer. */
  x: number;
  y: number;
  /** Entity under the pointer (nearest, topmost), or null. */
  entityId: number | null;
}

export type PickGesture = 'tap' | 'context' | 'hover';

export interface MinimapOptions {
  /** Draw Blight overlay. Default true. */
  blight?: boolean;
  /** Draw settlement markers + names. Default true. */
  settlements?: boolean;
  /** Draw nearby entities as dots. Default true. */
  entities?: boolean;
}

export interface GameViewApi {
  /** Begin the render loop (requestAnimationFrame). */
  start(): void;
  stop(): void;
  /** Call when the canvas element's CSS size changes. Handles devicePixelRatio. */
  resize(): void;

  loadWorld(world: DecodedWorld): void;
  /** Mark which entity is the local player (camera follows it). */
  setSelf(entityId: number): void;
  applyEntities(delta: { add?: EntityView[]; upd?: EntityPatch[]; del?: number[] }): void;
  clearEntities(): void;

  setTime(time: TimeView): void;
  /** Whole Blight map (w*h bytes). */
  setBlight(data: Uint8Array): void;
  patchBlight(idx: number[], val: number[]): void;
  setSettlements(list: SettlementView[]): void;

  /** Floating damage numbers, hit flashes, etc. `names` is optional and only used for debugging overlays. */
  combatEvents(events: CombatEvent[]): void;
  /** Non-combat visual effects (level-up burst, loot sparkle...). */
  fx(kind: FxKind, entityId?: number, text?: string): void;
  /** Speech bubble above an entity (chat). */
  say(entityId: number, text: string): void;

  /** Show a pulsing marker on the tile the player was ordered to. null clears it. */
  setMoveTarget(tile: { x: number; y: number } | null): void;
  /** Highlight an entity as the current selection. */
  setSelected(entityId: number | null): void;

  /** Pointer events resolved to tiles/entities. Mouse: tap=left click, context=right click. Touch: tap, context=long press. */
  onPick(cb: (pick: PickResult, gesture: PickGesture) => void): void;

  centerOn(x: number, y: number, instant?: boolean): void;
  /** 0.5 .. 2.5. */
  setZoom(zoom: number): void;
  getZoom(): number;

  /** Latest known tile of an entity (for UI distance checks, tooltips). */
  getEntity(id: number): EntityView | undefined;
  /** All entities within `radius` tiles of the local player, nearest first. */
  nearby(radius: number): EntityView[];

  /** Redraw a minimap into the given canvas. Cheap enough to call a few times per second. */
  drawMinimap(canvas: HTMLCanvasElement, opts?: MinimapOptions): void;
  /** Convert a minimap click (canvas pixel coordinates) to a world tile. */
  minimapToTile(canvas: HTMLCanvasElement, px: number, py: number): { x: number; y: number };
}

export interface LookPreviewOptions {
  dir?: Dir;
  weapon?: WeaponType;
  /** Pixel scale of the sprite pixels. Default 6. */
  scale?: number;
  /** Walk/idle animation time in ms; omit for a still pose. */
  time?: number;
  state?: 'idle' | 'walk' | 'fight' | 'meditate';
  /** Draw a soft ground shadow and backdrop. Default true. */
  backdrop?: boolean;
}

/** Implemented in src/render/index.ts. */
export interface RenderModule {
  createGameView(canvas: HTMLCanvasElement): GameViewApi;
  /** Draw a single character into a small canvas (character creation, inspect panels, party list). */
  drawLookPreview(canvas: HTMLCanvasElement, look: Look, opts?: LookPreviewOptions): void;
  /** Number of values for each appearance option, for building pickers. Mirrors LOOK_RANGES. */
  lookSwatches: {
    skin: string[];
    hair: string[];
    outfit: string[];
    sash: string[];
  };
}

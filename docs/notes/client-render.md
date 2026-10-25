# Client renderer notes (render/ + art/)

Owner: client-render. Everything procedural, no image files. Entry: `packages/client/src/render/index.ts`
(`createGameView`, `drawLookPreview`, `lookSwatches`, default export `RenderModule`). Contract: `render/api.ts`.

## Run the sandbox
```
npx vite packages/client --port 5201 --strictPort
http://localhost:5201/sandbox.html            (add ?panel=0 to hide the panel)
```
URL params: `seed`, `season` 0-3, `hour`, `weather` (clear|cloudy|rain|storm|fog|snow), `tp` (settlement id 0-7),
`zoom`, `panel=0`. Panel: time slider + day cycle, season, weather, Blight reach / corrupt-at-cursor / clear, zoom,
teleport per settlement, settlement status cycling (thriving, struggling, besieged, fallen + controller rotation), FX
buttons, speech bubble, combat burst, minimap (click = teleport), look preview widget (click = reroll). Tap the ground
to walk (A* from `@murim/shared`), tap an entity to select, right click / long press = context, wheel/pinch = zoom,
drag = pan (detaches the camera; it re-attaches when you move or call `centerOn(self)`). `window.view` exposes the GameView
(`view.stats`, `view.tm` per-section timings).

## How a frame is built
1. Everything world-space is painted into a **low-res scene canvas** where 1 pixel = 1 art pixel (`ART = 2` world px,
   so a 64x32 tile is 32x16 art px). The camera is snapped to whole art pixels. The scene is blitted to the real canvas with
   `imageSmoothingEnabled = false` at `P = ART * zoom * dpr` device px per art px. Zoom snaps to crisp steps (0.5 on dpr 1,
   0.25 on dpr 2) via `snapZoom`; pinch is continuous until release.
2. Ground: `ChunkManager` (render/chunks.ts) paints 16x16-tile chunks (512x256 art px) with `art/terrain.ts`, only when
   missing / dirty (season or Blight changed), at most `buildMs` per frame (a whole-screen burst after teleports).
   Water chunks hold 4 pre-composited animation frames (foam + glints). Blight vein glow is a separate additive layer.
3. Sorted pass (`render/scene.ts`): sweep the visible diagonals `d = x + y`; per tile draw mountain columns, bridge rails, walls,
   vegetation (4 variants x flip x season x Blight tier), blight mist; buildings and entities are merged in by depth key
   (building = front-most tile + 0.9, entity = x + y). No per-frame sort of tiles.
4. Lighting: multiply by the hour tint x weather dimming; then additive window glow layers and light pools (lanterns,
   forge, shrines, nodes, the heart, your own faint lantern). Effects and weather are drawn after (untinted).
5. Blit, then device-resolution overlays: name plates (cached canvases), HP bars, speech bubbles, floating text.

## Files
- `render/` : `api.ts` contract; `view.ts` GameView (loop, camera, input glue, public API); `scene.ts` sorted pass + smoke/fire;
  `chunks.ts`; `sprites.ts` lazily builds canvases from the art generators (LRUs for chars/mountains/buildings);
  `entities.ts` merge + interpolation state; `interp.ts` glide math; `camera.ts`; `iso.ts` projection and frame transform;
  `input.ts` gesture tracker (tap/context/long-press/pan/pinch/hover); `fx.ts` floaters + world effects; `weather.ts`;
  `lighting.ts` (`ambientAt(hours)`); `overlay.ts`; `minimap.ts`; `world.ts` derived world data (wall masks, rock distance,
  climate); `clock.ts` extrapolated world clock; `lru.ts`.
- `art/` (pure, no DOM except `canvas.ts`): `color.ts`, `pixel.ts` (PixelBuffer), `noise.ts`, `palette.ts`, `draw.ts` helpers;
  `terrain.ts` ground painter; `mesh.ts` tiny z-buffered iso rasteriser (`Scene3D`: quads, boxes, heightfields, decals, glow
  layer); `arch.ts` building kit (wall/roof shaders, doors, windows, pillars, lanterns, stairs, crenellation);
  `buildings.ts` + `landmarks.ts` (one function per building kind); `bctx.ts` shared context; `props.ts`; `flora.ts`;
  `mountain.ts`; `walls.ts`; `character.ts` paper doll; `beasts.ts`; `nodes.ts`; `canvas.ts` PixelBuffer -> canvas.
  Because the art is DOM-free, tests and PNG dump scripts run in node.

## Adding things
- **Building**: add the kind's function in `landmarks.ts` (or `buildings.ts`), register it in the `switch` of `genBuilding`, give it
  an entry in `ROOF_DEFAULT` and `MAX_Z` (sprite headroom). Use `basic()` for walls+roof boxes, `Scene3D` for anything else;
  call `addLight`/`addSmoke` for night lights and chimney smoke. Faction roof tint: add the kind to `TINTED`.
- **Vegetation/prop**: write `genX(variant, season, tier)` in `flora.ts`, add it to `genObject` and `FLORA_CODES`.
- **Monster**: beasts go through `DEFS` (`beasts.ts`) or `drawSnake`-style custom code and `BEAST_KEYS`; human monsters add a
  `SpecialStyle` palette in `character.ts` (`paletteFor`) plus a weapon in `HUMAN_WEAPON` (`scene.ts`).
- **Node**: add a generator to `nodes.ts` and `NODE_FRAMES`.
- **Effect**: add a `case` in `Fx.fx()` / `Fx.drawWorld()` (world pixels) and a `FxKind` in the shared protocol.
- **Sprite dumps without a browser**: tsx can import the art files directly; write PixelBuffers out as PNG (see tests for usage).

## Palette tables
Character swatches (`lookSwatches`, lengths equal `LOOK_RANGES`): skin 6, hair colour 8, outfit colour 10, sash 8 (CSS hex in
`art/palette.ts`: `SKIN_CSS`, `HAIR_CSS`, `OUTFIT_CSS`, `SASH_CSS`). Hair styles 0 short, 1 topknot, 2 long loose, 3 ponytail,
4 braid, 5 shaven, 6 scholar cap; outfits 0 tunic, 1 scholar robe, 2 warrior jacket, 3 sect robe; accessories 0 none, 1 headband,
2 bamboo hat, 3 half mask, 4 hairpin. Terrain palettes per season: `TERRAIN_PAL[terrainCode][season] = [dark, base, light, accent]`.
Faction roof tones: `FACTION_ROOF`. Name colours: self `#fff3c4`, player by rank (8 steps), offline grey, NPC gold / villager green,
monsters red, elite orange, boss magenta.
Ambient grading (`lighting.ts`): dawn warm pink, noon white, dusk orange, night blue (multiply colour about 116/130/188).

## Performance notes
- Visible 1280x720 area at zoom 1 with ~55 entities: about 2 ms CPU per frame (240 fps unthrottled in the pane). At zoom 0.5
  (scene buffer is full resolution, about 25 chunks on screen) about 10 ms, dominated by chunk compositing fill rate in the
  software-composited pane; frame cost scales with buffer area, so zoom 2.5 and phones (dpr 2-3, zoom 0.75) are cheaper.
- Static ground is cached per chunk (about 0.5 MB each, water chunks 4 frames, cache bounded to 44 chunks, ImageBitmap swap).
  A chunk repaint costs 10-30 ms, so repaints are budgeted per frame; teleports use a one-frame burst.
- Characters/monsters: one cached canvas per (look, weapon, state, dir, frame, role...) in a 2600-entry LRU (generation about
  0.06 ms/frame). Buildings (80 LRU), mountains (1400 LRU), vegetation and walls are generated once per season.
- No per-frame allocation in the steady state apart from the small sorted list; particles are typed arrays or stateless.
- A hidden/background Browser pane throttles rAF and renders in software: measure only when the pane is visible.

## Known gaps / ideas
- West-facing sprites are mirrors, so handedness flips; no dedicated side views.
- Beasts are side profiles; north-facing views only raise the head.
- Wall tiles connect orthogonally only (no diagonal corner pieces); gates are generated only if the world contains `gate` buildings.
- Water glints are sparse dashes; swell/reflections are not drawn. Night has no moon shadows.

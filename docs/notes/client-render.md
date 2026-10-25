# Client renderer notes (render/ + art/)

Owner: client-render. Everything procedural, no image files. Entry: `packages/client/src/render/index.ts`
(`createGameView`, `drawLookPreview`, `lookSwatches`, default export `RenderModule`). Contract: `render/api.ts`.

## Run the sandbox
```
npx vite packages/client --port 5201 --strictPort
http://localhost:5201/sandbox.html            (add ?panel=0 to hide the panel)
```
URL params: `seed`, `season` 0-3, `hour`, `weather` (clear|cloudy|rain|storm|fog|snow), `tp` (settlement id 0-7),
`zoom`, `panel=0`, and for the gear lab `oT oR` (outfit tier/rarity), `w wT wR` (weapon type/tier/rarity), `aK aT aR`
(accessory attribute/tier/rarity), `state`, `variant`, `dir`, `gallery=1`, `crowd=1`. Panel: time slider + day cycle, season, weather, Blight reach / corrupt-at-cursor / clear, zoom,
teleport per settlement, settlement status cycling (thriving, struggling, besieged, fallen + controller rotation), FX
buttons, speech bubble, combat burst, minimap (click = teleport), look preview widget (click = reroll).
**Gear and animation lab** (bottom of the panel, applies to you): outfit tier 0-5 + rarity 0-4, weapon type / tier / rarity,
accessory attribute / tier / rarity, state (idle, walk, run, draw, fight, attack, hit, block, dodge, die, dead, meditate, work,
craft, cheer, loot, stretch, sweep, chat, fan, wipe, form, eat, pray, rest, trade, shelter, mourn), attack variant, direction,
`NPC act` dropdown (forces an `EntityView.act` cue on every NPC), `reroll look`, `max gear`, **gallery** (every frame of the
chosen state at 5x plus a live animated copy; click the backdrop to close) and **crowd** (+60 walking players with random
gear, for performance tests). `window.lab` / `window.view.debugAnim(id, state, variant, tool)` are exposed for scripts. Tap the ground
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
  `entities.ts` merge + interpolation state (+ animation event timestamps); `life.ts` animation driver (fidgets, ambient life, act cues,
  knock-back); `particles.ts` pooled dust / spark / mote particles; `interp.ts` glide math; `camera.ts`; `iso.ts` projection and frame transform;
  `input.ts` gesture tracker (tap/context/long-press/pan/pinch/hover); `fx.ts` floaters + world effects; `weather.ts`;
  `lighting.ts` (`ambientAt(hours)`); `overlay.ts`; `minimap.ts`; `world.ts` derived world data (wall masks, rock distance,
  climate); `clock.ts` extrapolated world clock; `lru.ts`.
- `art/` (pure, no DOM except `canvas.ts`): `color.ts`, `pixel.ts` (PixelBuffer), `noise.ts`, `palette.ts`, `draw.ts` helpers;
  `terrain.ts` ground painter; `figure.ts` mask shader / IK / outline for people and beasts; `gear.ts`, `anim.ts`, `charctx.ts`, `charbody.ts`, `charhead.ts`,
  `trinkets.ts`, `weapons.ts` (see Characters v2); `mesh.ts` tiny z-buffered iso rasteriser (`Scene3D`: quads, boxes, heightfields, decals, glow
  layer); `arch.ts` building kit (wall/roof shaders, doors, windows, pillars, lanterns, stairs, crenellation);
  `buildings.ts` + `landmarks.ts` (one function per building kind); `bctx.ts` shared context; `props.ts`; `flora.ts`;
  `mountain.ts`; `walls.ts`; `character.ts` paper doll; `beasts.ts` (final-size quadrupeds + snake); `nodes.ts`; `canvas.ts` PixelBuffer -> canvas.
  Because the art is DOM-free, tests and PNG dump scripts run in node.

## Adding things
- **Building**: add the kind's function in `landmarks.ts` (or `buildings.ts`), register it in the `switch` of `genBuilding`, give it
  an entry in `ROOF_DEFAULT` and `MAX_Z` (sprite headroom). Use `basic()` for walls+roof boxes, `Scene3D` for anything else;
  call `addLight`/`addSmoke` for night lights and chimney smoke. Faction roof tint: add the kind to `TINTED`.
- **Vegetation/prop**: write `genX(variant, season, tier)` in `flora.ts`, add it to `genObject` and `FLORA_CODES`.
- **Monster**: beasts go through `DEFS` (`beasts.ts`) or `drawSnake`-style custom code and `BEAST_KEYS`; human monsters add a
  `SpecialStyle` palette in `charctx.ts` (`paletteFor`), tiers in `SPECIAL_GEAR` (`gear.ts`) plus a weapon in `HUMAN_WEAPON` (`scene.ts`).
- **Outfit / weapon / accessory art**: outfit decoration lives in `charbody.ts` (switch on `c.tier`), weapon shapes in `weapons.ts`,
  accessories in `trinkets.ts`; add a rarity effect through `Ctx.pipeLine` / the glow layer.
- **Node**: add a generator to `nodes.ts` and `NODE_FRAMES`.
- **Effect**: add a `case` in `Fx.fx()` / `Fx.drawWorld()` (world pixels) and a `FxKind` in the shared protocol.
- **Sprite dumps without a browser**: tsx can import the art files directly; write PixelBuffers out as PNG (see tests for usage).

## Characters v2 (gear, detail, life)

### Sprite format
People are painted into a 64x80 canvas at the detailed *design* size (feet anchor 32,70, figure about 48 px tall), then **reduced to the in-world size
(`CHAR_K` = 30/48, a person is 30 px, see Scale and proportions)** and **cropped to their painted bounds** (the anchor `ax, ay` and `top` follow the crop). The reduction (and the elite / boss enlargement) uses `resizePixels` (art/figure.ts): one source pixel is picked per destination pixel (never blended),
weighted by overlap and by contrast against the block average so thin bright details survive; the glow layer takes the strongest pixel; the eyes are
repainted at the final size as a 1x2 pair; the selective outline is applied after the reduction (1 px). `CharSpec.full` keeps the design size
(portraits: `drawLookPreview`, the gallery). Parts are painted with `art/figure.ts`' `Shaper` (union of capsules / ellipses / polygons shaded
as one piece: 3-4 tones, light from the upper left, rim light on the lit edge, ao toward the bottom, ordered dither), two-bone IK
for arms and legs, then a **selective outline** (soft dark neighbour colour on the lit side, ink on the shadow side). Ramps now
have a fifth tone `hl` (specular). West facings are cached mirrors (`flipSprite`) of the east ones, so only dirs 0 and 3 are
generated. Files: `character.ts` (compose + public `genCharacter`), `charctx.ts` (colours, rig, constants), `charbody.ts` (legs, robe,
torso, sash, shoulders, arms, outfit tiers), `charhead.ts` (face, 7 hairstyles, hats), `trinkets.ts` (accessories, tools, cauldron),
`weapons.ts` (weapon shapes + smears), `gear.ts` (gear -> appearance, palettes), `anim.ts` (states, frame tables, poses).
`genCharacter` returns `{pb, ax, ay, top, glow, tip, wRar, oRar}`: `glow` is an additive layer (rarity piping, weapon halo, gems,
glowing eyes), `tip` the weapon tip (trail sparks).

### Gear mapping (`EntityView.gear`; NPCs and hostile humans get tiers by role / style, see `ROLE_GEAR`, `SPECIAL_GEAR`)
The player's chosen outfit colour is always the base colour; tier adds structure, trim colour and shading.

| Outfit tier | Look |
|---|---|
| none (0) | plain garment in the chosen colour, plain sash |
| 1 | patched hemp: sewn patches, frayed hem, twisted rope belt |
| 2 | leather: diagonal strap with studs, shoulder pad, bracers, sash with buckle, trimmed hem |
| 3 | embroidered cloud robe: gold-thread collar and cuffs, cloud-pattern hem band, chest motifs, ornate knot |
| 4 | silk battle robe: layered silk front panel with sheen, dark lacquered shoulder pieces with gold edge, plated waist sash, two-tier hem |
| 5 | immortal garment: flowing trailing outer panels behind the legs, cloud-collar mantle with jade clasp, gold belt with jade ring, scalloped gold hem, long hanging sleeves |

Outfit rarity (any tier): 1 fine = a subtle shine pixel on trim; 2 rare = coloured piping (rarity colour) on collar, hem, cuffs,
sash; 3 epic = piping plus an animated shimmer (glow layer drawn in 3 bands with travelling phase) and a faint aura; 4 legendary =
steady glow, soft aura disc in the rarity colour and drifting motes. (`RARITY_COLORS`: grey, green, blue, purple, orange-gold.)

| Weapon tier | Sword / blade | Spear | Staff | Fist |
|---|---|---|---|---|
| 1 | dull iron, plain bar guard, leather grip | iron head | bamboo-node stick | cloth wraps |
| 2 | steel, longer, curved guard | steel head, ringed shaft | iron-capped ends | leather straps with studs |
| 3 | bright steel with fuller, brass guard, red tassel | red horsehair tassel, fuller | carved wood, jade bead | iron knuckle plate |
| 4 | blue steel, winged gold guard with gem, long tassel | crescent side blades, gold rings | gold bands and finial | steel gauntlet with forearm guard |
| 5 | jade-white blade with glowing teal fuller, jade pommel | jade-white head, white-gold tassel | white-gold shaft, glowing orb | gold dragon gauntlet, jade studs |

Weapon rarity: 1 fine = brighter edge / ring shine; 2 rare = rarity-tinted edge + coloured glow halo; 3 epic = same with pulsing
purple glow and sparks on attacks; 4 legendary = gold-orange blaze plus trailing sparks from the tip (and embers when idle).

Accessory by `a.k`: spirit = jade pendant on a cord (tier: silver/gold frame, gem); vitality = bone charm necklace (bronze, silver,
gold caps, gem); might = iron ring / bracer on the near forearm (studs, spikes); agility = long silk sash tails that sway
(gold tips, gem); fortune = lucky coin on a cord with a red tassel; insight = scholar's seal with tassel (jade seal from tier 4).
Accessory tier: 1 iron/bone, 2 bronze, 3 silver, 4 gold, 5 gold with a rarity-coloured gem.

### Animations (`art/anim.ts`; `FRAME_COUNTS`, `FRAME_MS`)
idle 8 (breathing, weight shift, cloth and hair sway, wind level 0-2 from the weather, blink / head turn / tilt fidgets chosen per
entity), walk 8 (contact and passing poses, opposite arm swing, body bob, hem / sash / hair trailing one frame late), run 6,
draw 3 (draw the sword / raise the weapon when a fight starts), fight 4 (ready stance), attack 6 with 4 variants for the sword
(slash, thrust, overhead, spinning), 3 for blade / spear / staff (spear: thrust, low sweep, overhead; staff: smash, sweep, jab), 4 for fists
(punch, palm, uppercut, back-fist), each with wind-up, strike, follow-through and a smear / streak in the weapon colour (rarity
tinted); hit 3 (flinch), block 3, dodge 4 (sidestep), die 6 (stagger, knees buckle, fall) then dead (lying, a rotated copy of the
collapse pose); meditate 4; work 6 (hammer, hoe, pickaxe, sickle, herb picking crouch; tool by role / farmland / nearest node),
craft 6 (stirring a cauldron, with steam); cheer 4 (level-up / breakthrough / victory), loot 4 (crouch), stretch 6, sweep 6 (broom),
chat 6 (gestures, talking mouth, speech-bubble icon), fan 4, wipe 6, form 8 (martial form), eat 6, pray 4, rest 4 (seated, drifting
z), trade 6 (abacus), shelter 4 (cower), mourn 6.
Beasts (`art/beasts.ts`, drawn at final size, IK legs, fur texture): idle 4 (tail swish, ear flick), walk 8, fight 4, attack 5 (bite lunge
or claw swipe, boar gore), hit 2, die 4, dead, plus the idle fidgets sniff, graze, stretch. Blight hound: twitching idle, uneven shamble
(offset leg phases), glowing eyes and violet drips; Blight humans: glowing violet eyes, hunch, shamble, corruption drips.

### Who drives it (`render/life.ts`, pure and seeded)
`pickChar` / `pickBeast` choose state + frame from the entity: death collapse > most recent of hit / dodge-block / attack >
emotes (`cheerAt` on level-up / breakthrough, `lootAt` on loot / gather, `healAt` glow) > walk / run (run when the step time is
< 300 ms) > fight stance (with the draw transition) > victory pose after a fight > **`act` cue** > server state (work / craft /
meditate) > idle with fidgets and seeded ambient role activity. Everything depends only on (entity id, time), so crowds do not move
in sync and nothing is stored. Ambient life is in place only (never changes the position): villagers sweep / chat in mutual
pairs (icon above the speaker) / stretch, guards scan and stretch, merchants fan / chat, innkeepers wipe, masters practise a form,
smiths hammer, alchemists stir, physicians fan / chat, beasts sniff / graze / stretch. Misses make the defender dodge or block,
blows knock the victim back a few pixels and flash it white (suppressed with `prefers-reduced-motion`, which also stops sway,
particles, ambient activity and knock-backs).

**Server `act` cues** (`EntityView.act`, `NpcAct`): while present and the entity stands still it plays: work = work with the tool
for its role / terrain (alchemist: craft), eat = eat, chat = chat (faces the nearest neighbour, bubble icon), pray = pray (bow),
sweep = sweep, rest = rest (seated, z icon), patrol = stiff scanning stance (the server moves it, the sprite does not walk in
place), trade = trade (abacus), train = loops the weapon attacks (a form without a weapon), shelter = shelter, mourn = mourn,
celebrate = looping cheer with confetti. `ACT_STATE` maps act -> state. Combat, hits and walking take priority over the cue.
The sandbox's `NPC act` dropdown forces a cue on every NPC and the gallery shows its frames.

### Effects (render/particles.ts, scene.ts)
Pooled particles (typed arrays, 640): footfall dust on dirt / sand / farm / road, splashes in shallow water, snow footprints in winter
(5 s fade, drawn under everything), hammer sparks, weapon sparks (epic attacks, legendary always), qi motes (meditation; more and
brighter with rank, plus a pulsing qi aura disc), cauldron steam, outfit motes (epic / legendary), confetti. Auras use cached
`glowDisc` canvases (no per-frame gradients). Sprite generation is time-budgeted (5 ms per frame); entities draw their previous frame
until the next one exists, so a crowd that starts walking never hitches.

### API additions
`LookPreviewOptions` (render/api.ts, additive): `gear?: GearLook`, `variant?` (attack variant), `tool?`, `frame?` (fixed frame instead of
`time`), and `state` now accepts every `CharState` (see anim.ts). `drawLookPreview(canvas, look, { gear, weapon, state, time })` draws the
outfit tier / rarity, weapon and accessory (glow pulses when `time` is given). `GameView.debugAnim(id, state | null, variant, tool)` forces a
state (sandbox / tests). The renderer reads `EntityView.gear`, `EntityView.act` and the existing `weapon`, `rank`, `hp`.

### Tools and tests
`packages/client/tools/sprite-dump.test.ts` writes PNG contact sheets of frames without a browser: `DUMP=tiers|weapons|acc|rar|back|walk|attack|misc|mon|beasts|zoom|bench npx vitest run packages/client/tools`
(output dir via `DUMP_DIR`, default the session scratchpad). Tests: `art/gear.test.ts` (gear -> appearance, every tier / rarity / weapon / accessory
changes pixels, mirror, determinism, animation tables), `render/life.test.ts` (seeded fidgets, state selection, act cues, ambient never moves,
beast states, cache keys, reduced motion).

### Performance (sandbox, 1280x720-class pane, crowd toggle = 114 entities on screen, front tab)
Measured with the crowd toggle (114 characters and beasts on screen, most walking) by calling `view.frame()` in a loop (CPU time per frame,
independent of the pane's rAF throttling): **zoom 1: 4-5 ms per frame in total, of which about 1.3 ms is the 114 entities and 0.3 ms their
name plates** (2.7 ms of the rest is the blit); no-entity baseline 2.7 ms. **Zoom 0.5: 30-37 ms in this software-composited pane, of which the
entities cost about 2 ms** - the rest is the 25 ms terrain chunk compositing (unchanged by this work; see the older note above). So at
1280x720 the characters stay far above 55 fps at zoom 1 (about 16 us per entity); at zoom 0.5 the terrain fill rate, not the sprites,
sets the frame time. In a fronted pane with 114 entities `view.stats.fps` read 160-240 at zoom 1. Sprite generation costs about 0.36 ms per character frame and 0.38 ms per
beast frame in node (cropped sprites average ~10 KB); the bank keeps 3200 character and 1200 beast entries (LRU) plus lazily created mirrors.
Measure only while the pane tab is in front: background tabs are throttled to a few fps.

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
- Characters/monsters: one cached canvas per (look, gear, weapon, state, dir (east only), frame, variant, wind, gaze, blink, role...) in
  an LRU (3200 characters, 1200 beasts); generation is about 0.36 ms/frame and time-budgeted per frame (see Characters v2). Buildings (80 LRU), mountains (1400 LRU), vegetation and walls are generated once per season.
- No per-frame allocation in the steady state apart from the small sorted list; particles are typed arrays or stateless.
- A hidden/background Browser pane throttles rAF and renders in software: measure only when the pane is visible.

## Known gaps / ideas
- West-facing sprites are mirrors, so handedness flips (and the light comes from the upper right); no dedicated side views. Back views
  (NE/NW) reuse the front pose, so the weapon hand and sheath sit on the same screen side.
- Gear art is tiny at zoom 1 (accessories are 3-6 px); legendary effects are cheap particles, not light sources (no night glow from gear).
- Beasts are still side profiles; fall / die frames for beasts are a settling pose, not a physical tumble. Knock-back is a screen-space
  offset (no collision), crit screen shake is not implemented.
- Beasts are side profiles; north-facing views only raise the head.
- Wall tiles connect orthogonally only (no diagonal corner pieces); gates are generated only if the world contains `gate` buildings.
- Water glints are sparse dashes; swell/reflections are not drawn. Night has no moon shadows.


## Scale and proportions
One standing adult (`PERSON_PX` = 30 scene px, hair or hat included) is the unit; everything else is sized from the single table in
`art/scale.ts` (`TARGETS`: want / min / max as a multiple of a person, `SIZE_MULT`, `CHAR_K`, `BUILDING_ZK`). `art/scale.test.ts` measures the real
generated sprites (via `art/scaleRef.ts`, which also feeds the sandbox overlay) against that table, so a change to any generator that breaks a ratio fails.

| Thing | Before (px) | After (px) | Persons (target) |
|---|---|---|---|
| person (no hat / hat) | 48 / 50 | 31 / 32 | 1 |
| elite / elite+ / brute / bandit boss / blight lord | 53 / 61 / 57 / 61 / 75 | 36 / 38 / 38 / 46 / 57 | 1.2 / 1.25 / 1.3 / 1.5 / 1.8 |
| house door / eave (wall top) | 20 / 33 (person was 1.45 x the eave) | 36 / 59 | 1.25 / 2 |
| inn ridge, hall, pagoda (3-5 tiers), tower | 78, 87, 97+, 93 | 109, 116, 171-229, 128 | 3.4, 3.9, 5.7-7.6, 4.3 |
| fort wall (tile incl. merlons) | 45 | 80 | 2.7 |
| pine / oak / bamboo | 55-64 / 53-56 / 60-72 | 97-111 / 90-106 / 91-106 | 3-4 |
| bush / boulder / reeds | 16 / 16-23 / 29-33 | 16 / 16-23 / 20-22 | 0.5 / 0.5-0.8 / 0.7 |
| boar / wolf / bear / tiger / snake | 28 / 27 / 42 / 30 / 20 | 19 / 17 / 26 / 25 / 11 | 0.6 / 0.6 / 0.9 / 0.8 / 0.4 |

Where it lives: people = `CHAR_K * SIZE_MULT[...]` in `art/character.ts` (`charScale`, `sizeMult`); beasts = `scale` per entry of `DEFS` in `art/beasts.ts` (they paint
at final size, `k` scales every dimension) and the snake factor in `beastScale`; buildings = `Scene3D.zk` (vertical stretch of the whole model, `BUILDING_ZK` 1.8,
`ZK_KIND` in `buildings.ts` overrides: market 1.5, inn 1.6, hall and tower 1.5, mine entrance 2.2; `Style.zk` lets the wall / door / window shaders keep their texture
density) plus wider doors (`door` width 0.7-0.95 tile); fort wall = `WALL_H` / `MERLON_H` in `art/walls.ts`; trees = the generators in `art/flora.ts` (taller trunks, more
tiers, anisotropic oak crown). `BuildingArt.metrics` returns door / eave height for the test. Render keyed values that scaled with the person: shadows, selection ring,
auras, heal / meditation discs, chat / rest icons, footfall / spark / steam / confetti offsets (`scene.ts`), world effect anchors and sizes (`fx.ts`), plates / HP bars /
bubbles / floating text / picking all follow `topPx` (head top of the current sprite).
Trade-offs: the reduction is done on the painted figure (the paint code has absolute coordinates), so very small details (accessory trinkets, 1 px lace) are reduced to
1-2 px, tier trim colours and rarity piping stay visible but are less intricate; non-integer enlargement (bosses) is nearest neighbour as before.
Tall trees and houses hide more of the ground than before; that is what the plate occlusion below is for.

### Plate occlusion (render/occlusion.ts)
The sorted pass records every tall drawable (buildings, wall tiles, tall vegetation, mountains) as an `Occluder` (screen rect, painter's depth key, per-row opaque spans
computed once per sprite). After the pass each drawn entity is sampled (3 x 5 points of its body box plus the head point) against the occluders drawn after it
(`depth > e.dkey`); covered head or more than 60 % of the box sets a target, `Ent.occ` follows it with a ~140 ms ramp. The overlay fades plate, HP bar and bubble by
`plateAlpha(occ, floor)` (floor 0.4 selected / hovered, 0.35 monsters in a fight, 0.1 otherwise; your own plate never fades). While you are covered a ghost of your sprite
(50 % copy + 30 % white silhouette) is drawn over the scenery. Sandbox: `?occl=1` or the `npc behind house` button.

### Sandbox scale reference
`?scale=1` or the `scale reference` button (gear lab row) draws a person next to a house, an inn, a fort wall, a tower, a hall, a pagoda, pine / oak / bamboo, and the beasts,
blight lord, elites, bush, boulder, reeds and lantern, with a 1-tile diamond under each and ruler lines every person height; labels show measured px and persons.

### Performance after the rescale (sandbox crowd = 114 entities on screen, front tab, `view.frame()` loop)
Zoom 1: 2.3-3.0 ms per frame (scene 1.5 ms, overlay 0.2 ms incl. occlusion); zoom 0.5: 28 ms, of which 21-22 ms is chunk compositing (unchanged, software pane), scene 3-5 ms.

## Battle visuals (siege battles)

`EntityView.side` (`raid` | `def`) and `EntityView.flag` (1 = carries a banner): the banner is a pole with a waving cloth in the faction colour (Hollows: Blight violet, defenders: their faction or gold), drawn by `SceneRenderer.drawBanner`. `NpcAct 'loot'` crouches over loot (raiders sacking a town). The `siege` server message reaches `GameView.setBattle`: `alarm` = three bell rings at the gate, `march` / `melee` = a drum ring on every message, `fall` = fires on all buildings of that settlement (`SceneRenderer.setBurning`, also cleared 26 s after the last message), `hold` = a gold ring, `end` clears everything. The sandbox panel has a "Siege demo" section (town holds / town falls / stop; `?siege=hold|fall&sid=3` starts one on load) driven by `siegedemo.ts` with fake entities.

# Town life, phase 2: bigger towns with real layouts, then crowds, then sect compounds

Phase 2 of the livelier-towns plan, delivered as three stacked pull requests:

| PR | Branch | What |
|---|---|---|
| 2a | `phase2a-town-layouts` | layout archetypes, bigger settlements, town barracks, landmarks and sightlines for the new layout, world tests |
| 2b | `phase2b-population` | named + ambient population tiers, population matching what is on screen, measured budget |
| 2c | `phase2c-sect-compounds` | sect compounds (courtyard, gate, hall, yard, dormitories, pavilion) and the `disciple` role |

2b is based on 2a and 2c on 2b. Merging 2a resets the live world on the next deploy (the layout signature hashes the buildings; accounts and characters are kept).

Screenshots: `docs/notes/img/town-layout-*.png`.

## 2a: layouts (`shared/townlayout.ts`, `shared/worldgen.ts`)

`planTown({kind, spec, archetype, rng, mainAxis, field})` is a pure function: it plans one settlement on a square canvas centred on the settlement and returns the streets, plaza, water, bridges, enclosure tiles, props and the lots (`PlacedLot`: kind, x, y, w, d, face, door, zone). `worldgen.layoutTown` paints the plan onto the world. The engine never looks at the map except through `field(dx, dy)` (is this tile buildable ground), which is what keeps it testable and deterministic.

### Sizes and programmes (`SPECS`)

| kind | radius (was) | programme |
|---|---|---|
| hamlet | 11 (8) | 4 houses, 2 farmhouses, shrine, herb hut |
| village | 16 (13) | inn, market, teahouse, smithy, alchemy, herb hut, dojo, shrine, 9 houses, 2 farmhouses |
| town | 20 (14) | 2 inns, 2 markets, smithy, alchemy, 2 teahouses, warehouse, dojo, shrine, herb hut, 2 barracks, 18 houses |
| fort | 17 (14) | 3 barracks, 4 houses, dojo, shrine, smithy, inn, market, alchemy, warehouse, 4 corner towers |
| sectHall | 18 (13) | pagoda, 2 halls, 2 dojos, shrine, alchemy, teahouse, 6 houses |
| ruin | 13 | unchanged generator (a few ruined houses) |

### Archetypes

`cross` (two avenues), `mainStreet` (one trade street with lots on both sides), `grid` (regular blocks), `ring` (ring streets round a small plaza, the shrine in the middle ring), `walled` (regular grid inside a wall), `terraced` (switchback terraces for the hills), `river` (a stream through the town with bridges). Each kind has a weighted list (`SPECS[kind].archetypes`); `pickArchetype` rolls it from the settlement's seed. If the ground (water, rock) leaves more than a tenth of the programme unplaced, `layoutTown` tries the other archetypes of the kind and keeps the one that places the most.

Rules the engine keeps:

* Streets first, then lots along streets. Doors are on the south or east face only (the camera sees nothing else), the door tile is a street tile.
* Zones: market near the plaza, temple on one diagonal, craft on another, guard (barracks, towers) at the edge, homes everywhere else. The diagonals are shuffled per settlement.
* Four axis avenues are always kept: they are the roads and the `gateDirs` the guard code and the road builder use. The enclosure (stone wall, palisade, or a fence) leaves the four axes open.
* Islands of street that do not connect to the plaza are pruned before lots are placed.
* Lots are placed in three passes (margin 1, margin 0, margin 0 with 2 tiles of slack past the ring). A programme that still does not fit because a ridge or a lake cut an avenue short gets up to six dirt spurs into the empty pockets (`spur()`), then tries the missing kinds again.
* Props: well and lanterns at the plaza corners (never on a door tile), lanterns along the avenues, gardens behind some houses, trees in the blocks.

### Enclosures and new object codes

`O.Well` 11, `O.Lantern` 12, `O.Building` 200, `O.Wall` 201, `O.Palisade` 202, `O.Fence` 203 (`terrain.ts`, `objectBlocks`). Walls were already there; the palisade (towns without a wall) and the fence (villages and hamlets) are new tiles with procedural art (`client/art/walls.ts`, `genPalisadeTile` / `genFenceTile`), linked to their neighbours by `render/world.ts linkMask` and cached by `render/sprites.ts getFence`. Well and lantern are in `art/flora.ts`.

### World generation changes

* Candidate sites must keep the four axes over dry land at 17 tiles (at least 3 of 4, at least 2 in the loose fallback pass), and settlements keep a Chebyshev separation of 66 tiles (relaxed in steps to 44, and in the last resort to the old Euclidean 30) so two squares never overlap.
* Settlement kinds are assigned by room: of the middle sites the roomiest get the big kinds (town, sect hall, fort).
* The ruin site is chosen near a frontier town and its disc is reserved, so a fort tower or a hermitage can never be cleared by it.
* Hermitages are placed after every settlement is built (a hut can no longer land under another town's lot), outside the enclosure, joined to the nearest road by a footpath.
* `ensureConnected` links stranded settlements with causeways from the avenue ends and `carveLine` leaves buildings alone.
* `clearSightlines` also covers the barracks; landmarks gain the `barracks` kind (`shared/landmarks.ts`, beacon glyph and colour in `render/beacons.ts`, icon in `ui/logic/world.ts`, minimap tint).

### Town barracks

Towns used to have no barracks: 16 guards filled every house and the villagers bunked in inns. Towns now have two barracks (capacity 8 each, `NPCLIFE_TUNING.barracksCapacity`), forts three. `life.ts` also clamps a resting guard's day so the barracks guard no longer sleeps outdoors at night (rest ends at personal 21:00).

## Checks made (2a)

* `npm run typecheck` clean; `npm run build` clean; `npm test` 1125 passed (1070 on `main`).
* New and extended tests: `shared/townlayout.test.ts` (15: determinism, every archetype on an open field, doors, no overlaps, islands, enclosure axes, fallbacks), `shared/worldgen.test.ts` (seven seeds: deterministic and connected, every building clear of roads, plazas and water and of every other building, doors on the south/east face and reachable from the spawn, programme counts, enclosure axes open, hermitage constraints, 25 seeds place eight settlements), `server/npclife/npclife.test.ts` (barracks housing, nobody over capacity), plus client logic tests for the barracks landmark.
* Existing tests that had to change because the world changed: siege "pairs units up" watches 1200 ticks instead of 400 (raiders walk further round the fences); the old-age master test looks the sect hall up by kind and compares with the count before; the monster home test spawns on a walkable tile; the blight threshold is 1.0; the siege player-kill test retargets because defenders now often kill the chosen raider first.
* `scripts/sim-soak.ts` (180 days, `main` -> 2a):

| seed | alive NPCs | ms per world hour (avg / max) | snapshot json | sieges / raids / captures |
|---|---|---|---|---|
| 1337 | 145 -> 147 | 0.97 / 14.7 -> 0.98 / 12.9 | 130 -> 132 KB | 17 / 14 / 2 -> 35 / 28 / 11 |
| 7 | 151 -> 143 | 0.89 / 16.8 -> 0.85 / 16.5 | 137 -> 126 KB | 51 / 30 / 7 -> 23 / 20 / 2 |
| 42 | 148 -> 146 | 0.76 / 9.1 -> 0.91 / 20.6 | 131 -> 129 KB | 41 / 34 / 13 -> 57 / 37 / 11 |

  Cost per hour is unchanged and the counters are within the spread of one history to the next (a different world is a different history, so one seed is not a statistic).
* `scripts/siege-bot.ts` (same forced siege of the starting village, strength 55, 110 s, local servers): `main` 11 raiders, 145 hits, 37 misses, 18 down events; 2a 11 raiders, 146 hits, 41 misses, 17 down events; the same stage sequence (alarm, march, melee, and a second wave at about 70 s).

## Not done in 2a / for later

* Crowds and population are 2b; sect compounds are 2c.
* One hermitage per settlement, none for villages and hamlets.
* A settlement on a peninsula may have only one road that leaves over land (the rest go over bridges and causeways); `ensureConnected` guarantees the map stays connected, not that every avenue is dry.

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

## 2b: population tiers (`shared/crowd.ts`, `server/game/ambient.ts`)

Stacked on 2a (`phase2a-town-layouts`, pull request 3): the lot counts and the town sizes it sets are what the crowd walks through.

| tier | who | where it lives | cost |
|---|---|---|---|
| named | the sim's NPCs: guards, masters, legends, shopkeepers, a few villagers | sim roster + NPC life (names, memory, dialogue, schedules) | unchanged |
| ambient | nameless townsfolk | server entities of kind `ambient`, created only while a player is near | measured below |

### The head-count

`RESIDENTS` is the number of people who live in a settlement at full strength: hamlet 12, village 30, town 70, fort 44, sect hall 38, ruin 0. `residentTarget(kind, simPop, basePop)` scales it by the sim population against its base (capped at the sim's own 1.6 growth limit), so a plague or a fall thins the streets and growth fills them. `residentsOf` is never below the named people who live there.

The sim's `settlementView(id).population` now reports `residentsOf(...)`, so the figure on the World panel (and what the NPCs say when asked how many folk live here) is the number you can count in the streets at midday: named alive + ambient quota. The abstract `s.population` the economy runs on (90 / 220 / 600 at the base) is untouched, so prices, food and faction power did not move: the 180-day soak counters are identical to 2a on all three seeds.

At the start of a world: Silent Ford (village) 30 against 17 named, the towns 64-75 against 27 named, the hamlet 12 against 10 named.

### Ambient townsfolk

* **When.** A settlement is watched when an online player is within its radius + 22 tiles (`AMBIENT_WATCH_MARGIN`). A watched settlement fills toward `ambientQuota(population, named) * crowdHourFactor(hour)`, two people per half second per settlement (they step out of the doors, preferring the door farthest from every player), and sends two per half second indoors when it is over (night, a shrinking population). Fifteen seconds after the last player went away everyone is removed at once. A besieged or fallen settlement has nobody out.
* **Hours.** `crowdHourFactor`: 0.03-0.05 from midnight to 04:00, rising from dawn to 1.0 at 08:00, 1.0 until 16:00, then 0.95 / 0.85 / 0.65 / 0.4 / 0.22 / 0.12 / 0.07 through the evening.
* **Routine.** Each walker picks a destination every 5-22 s from the settlement's `crowdMap` (house doors are homes; the plaza, the doors of markets, inns, teahouses, shrines and work buildings, and the gates are spots), weighted by `spotMood` (market in the morning, work buildings by day, gates at dawn and dusk, the inn and the shrine in the evening) and by distance, and sometimes just turns to look around. Paths use the ordinary `Movement.moveTo` with a node budget of 900.
* **Entities.** Kind `ambient`, empty name, role `villager`, one of 24 looks (`ambientLook(0..23)`: plain clothes, ordinary hair, no accessory), speed 0.46-0.6, no hit points. Their ids come from their own range (from 1,000,000,000; `AMBIENT_ID_BASE`) so a crowd coming and going never shifts the ids of players, NPCs and monsters (monster and combat rolls are seeded by them, and several tests depend on that).
* **Cap.** `AMBIENT_GLOBAL_CAP` = 220 ambient entities in the world; when the watched settlements want more, every one is scaled down together. `game.ambient.cap` can be lowered at runtime (0 switches the tier off).
* **Not interactive.** `interact` on one answers "The passer-by is busy and does not stop." Clients do not pick them (clicks fall through to the ground), draw no plate, no minimap dot and the lowest priority for the see-through silhouettes. They have no memory, dialogue or persistence.
* **Sim events.** Nothing in the sim knows about them; they are a view of the head-count, not a second population.

### Client

`EntityKind` gained `ambient`; `contextActions` gives nothing for it (kind label "Passer-by"), `view.pickEntity` skips it, `overlay` draws no plate, `minimap` no dot, `ghostPriority` 6. The sandbox has a `townfolk` button and `?townfolk=N`, and the mock server (`?mock=1`) puts 24 around the starting plaza. Screenshots: `img/town-life-townfolk-plaza.png` (sandbox, plaza with 60 townfolk among the named crowd), `img/town-life-townfolk-game.png` (`?mock=1`).

### Measured budget

Server: `scripts/crowd-bench.ts` (real sim, real game loop, players spread over the biggest settlements, noon, 60 s of ticks after a 40 s warm-up; the crowd off against on):

| players | entities | tick avg / max | ambient share of the tick (avg / max) | A* requests | to each player |
|---|---|---|---|---|---|
| 1 | 146 -> 194 (48 ambient) | 0.129 / 2.10 -> 0.180 / 2.46 ms | 0.064 / 2.40 ms | 0.4 -> 2.3 per s | 0.70 -> 2.23 KB/s |
| 3 | 148 -> 253 (105) | 0.166 / 2.54 -> 0.303 / 5.11 ms | 0.108 / 4.84 ms | 0.8 -> 5.0 per s | 0.54 -> 1.65 KB/s |
| 7 | 152 -> 298 (146) | 0.352 / 3.86 -> 0.377 / 2.91 ms | 0.121 / 2.26 ms | 1.4 -> 7.2 per s | 0.40 -> 0.97 KB/s |

A tick has a 100 ms budget: the whole crowd costs about 0.1 ms on average, a few ms at worst (the planning pass), and a player is sent 1-2 KB/s of position patches (about 10-26 patches per second against 4-7 without the crowd; adds and deletes are unchanged). The soak is unchanged (the sim never sees them), so the simulated world costs what it did.

Client (headless Chromium in software rendering, so read these as relative: sandbox at the spawn town, zoom 0.9, frame time as `view.stats.frameMs`, sprites as the size of the `chars` LRU of the sprite bank, limit 6000):

| scene | entities drawn | frame | cached person sprites |
|---|---|---|---|
| named only (16 NPCs + 14 players) | 54 | 5.5 ms | 517 |
| + 45 townfolk (24 looks) | 99 | 6.9 ms | 966 |
| + 60 walkers with unique looks (the old crowd toggle) | 114 | 10.0 ms | 1249 |

The 24-look palette is what keeps the sprite cache small: 45 more people cost 449 sprites and 1.4 ms; the same number with unique looks costs about twice that.

### Checks made (2b)

* `npm run typecheck` clean; `npm test` 1146 passed (1125 in 2a).
* New tests: `shared/crowd.test.ts` (targets, scaling, hours, looks, crowd map), `server/game/ambient.test.ts` (11: only near players, on-screen count equals the reported population for a hamlet, a village and a town, streets and looks, walking, night against day, the grace period, siege, the world cap, not interactable, reaches clients as nameless entities, reproducible), `server/sim/core.test.ts` (population targets and follow-the-economy), `server/game/entities.test.ts` (ambient id range), client logic and occlusion tests.
* `scripts/sim-soak.ts` 180 days, seeds 1337 / 7 / 42: counters identical to 2a (alive NPCs 147 / 143 / 146, 0.90 / 0.91 / 0.80 ms per world hour, snapshots 132 / 126 / 129 KB).
* `scripts/siege-bot.ts` (forced siege of the starting village, strength 55, 110 s): 157 hits, 37 misses, 20 down events, the same stage sequence as `main` (145 / 37 / 18) and 2a (146 / 41 / 17). The crowd leaves the streets when the siege starts.

### Not done in 2b

* Ambient townsfolk do not react to fights in the street yet (phase 3 gives villagers a reason to run); during a siege they simply go indoors.
* The crowd is the same in every settlement apart from the head-count; per-kind looks (farmers in hamlets, robes in a sect hall) are for 2c.
* One shared crowd per settlement: there is no per-player thinning, so many players in one town do not add people.

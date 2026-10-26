# Town life, phase 1: gate guards, paired patrols, hermitages, landmark beacons

Phase 1 of the livelier-towns plan (phase 2: bigger towns with ambient crowds and sect compounds, phase 3: bandit and monster attacks on villagers, phase 4: escorted caravans). Code: `packages/shared/src/{guardplan,landmarks,worldgen}.ts`, `packages/server/src/npclife/**`, `packages/server/src/sim/npcs.ts`, `packages/client/src/render/{beacons,occlusion,scene}.ts`, `packages/client/src/art/{buildings,props}.ts`, `packages/client/src/ui/panels/world.ts`. Screenshots: `docs/notes/img/town-life-*.png`.

Changing the world layout resets the live world on the next deploy (the server notices the layout signature change and starts a fresh world, keeping accounts and characters).

## Guards: gates and squads (`shared/guardplan.ts`)

`guardPolicy(kind)` is the staffing table, `guardHeadcount(kind)` the total, `planGuards(kind, n, gateCount)` the duties for the `n` living guards of a settlement sorted by id. Shift 0 = day, 1 = night.

| kind | gates | per gate day / night | squad day / night | total |
|---|---|---|---|---|
| hamlet | 1 | 2 / 1 | 0 / 0 | 3 |
| village, sectHall | 2 | 1 / 1 | 2 / 0 | 6 |
| town | 3 | 2 / 1 | 4 / 3 | 16 |
| fort | 4 | 2 / 1 | 4 / 3 | 19 |
| ruin | 0 | | | 0 |

For any `n` (deaths, succession): the day / night split follows the table and is spread through the id order (so losing one guard never empties a shift, and with two or more guards both shifts keep someone); each shift puts one guard on each staffed gate first, then forms a squad only if at least two remain (never a lone patroller), and the extras go to the gates round-robin. A duty is `{kind:'gate', gate, slot}` or `{kind:'squad', squad, slot, size}`.

`sim/npcs.ts` seeds and refills toward `guardHeadcount(kind)` (`requiredCount('guard')`). It still takes the old `rng.int(2, 3)` roll for non-forts: the headcount is no longer random but several long-run sim tests were tuned on seeded histories and break when the random stream shifts.

`life.ts` stores the duty on `LifeState.duty`; `rebalanceShifts` fills it from `planGuards` (and nudges a guard whose post moved to leave its old one soon).

* **Gate duty.** `patrol` resolves to the guard's own gate (`sp.gates[duty.gate]`) and stays 1.2-2.6 world hours (`gateStandHours`) on the spot `gate.spots[duty.slot]`. Gate spots are ordered flank first: slot 0 and 1 are on either side of the road (offset 2, else 1 where a wall is in the way), slots 2 and 3 two tiles further in, then any other tile near the gate.
* **Squad duty.** All members pick the same point of the route from world time: `route[(floor(worldHours / squadBucketHours) + seed) % route.length]` with `squadBucketHours` 0.5 and a per-squad seed (`hash32(sid, shift)`); each stands on `place.spots[duty.slot]`; the stay ends at the bucket boundary, when all of them move on to the next point. The route is `sp.route`: the inner posts, gates and outskirts (not the plaza) sorted by angle.
* While a guard with a duty is on shift (schedule weight for `patrol` >= 0.9) `train`, `socialise` and `wander` (and `sweep` for squads) are suppressed. Eating and sleeping still happen in their hours, and `muster` (alarm, siege) is unchanged.

`places.ts`: gates now sit on the real road axes. `shared/landmarks.ts gateDirs` is the one place that says where roads leave a settlement (one per road to a neighbour, at least two, all four for a fort, snapped to the tile axes); the gate tile is on that axis just inside the edge. `sp.outskirts` are patrol points about 7 tiles up each road beyond the gate (`outskirtsOffset`) and the outermost tile of each farm; `sp.route` is described above.

Tuning is in `npclife/tuning.ts` (`gateStandHours`, `squadBucketHours`, `outskirtsOffset`, `hermitageCapacity`).

## Dojo, shrine, hermitage (`shared/worldgen.ts`)

* `village` and `fort` layouts get a `dojo`, `fort` also gets a `shrine`, so every settlement with masters has a training building and every living settlement a shrine. A dojo or shrine that did not fit is retried on slightly wider ground. Village radius went 11 -> 13 and fort radius 13 -> 14 so the extra buildings do not eat the houses (a village used to lose half its houses to the new dojo).
* New building kind `hermitage` (3x3), one outside each town, sectHall and fort at radius + 4..10 (the search widens to +14 after many misses; a settlement without a fitting site, like Azure Market on seed 44, simply has none), on cleared open ground, with a dirt footpath to the nearest road or the plaza. It is only placed if that path exists.
* Legends take the hermitage as home and workplace (`chooseHome` / `chooseWork`, `PlaceKind` `hermitage`, capacity 2). `SCHEDULE.legend` now trains, prays and rests there by day and comes down to the plaza or inn from about 17:30 to 21:30 (and for festivals, which the scoring already handles). Wanderers have their own `wanderer` schedule, which is the old legend one. A legend in a settlement with no hermitage falls back to the dojo (training) and the inn.
* Sightlines: after the roads exist `clearSightlines` removes trees and rocks along the four entrances of every settlement and from the two tiles in front of every key building (inn, market, smithy, alchemy, shrine, dojo, hall, pagoda, hermitage, teahouse, gate). Purification-shrine nodes are placed on the camera-facing side (south / east) first, never within two tiles of a wall or a hut, with the ground around them cleared. What Silent Fort really had: no shrine building, only a purification-shrine node 16 tiles north, outside the walls and behind the wall line.
* Art: `genBuilding` draws the hermitage (`buildings.ts`: thatched hut on a stone step, a big and a small garden pine, a stone lantern at the door, an altar with incense in front). New props: `props.gardenPine`, `props.altar`.

## Hidden people and landmarks (client)

* **Silhouettes.** `scene.ts resolveOcclusion` already knew which entities a taller drawable covers (it drives the name plates); it now also keeps a smoothed `veil` per entity (`isVeiled`: head or a tenth of the body covered) and draws `bank.ghostOf(sprite, tint)` (a faint tinted fill with a one-pixel outline) over the scenery for the most important `MAX_GHOSTS` (24) per frame: you, the selected target, players, fighters and notables, then the nearest of the crowd. The tint says who it is (`ghostTint`). Your own character keeps the old x-ray ghost as well.
* **Beacons** (`render/beacons.ts`). Landmarks come from `shared/landmarks.ts landmarksOf`: inn, market, smithy, alchemy, shrine, dojo, hall, pagoda, hermitage and the gates (a gate is a virtual landmark on its road axis). Drawn in the device-resolution overlay (never occluded), pin tip at the sprite's roof peak (`roofTop` from the building sprite's opaque rows), icon always, label from zoom 0.9. Opacity `beaconAlpha(dist, zoom)`: full within 18 tiles of the screen centre, fading to nothing at 44; gone below zoom 0.55, full from 0.75. Overlapping beacons are de-cluttered by priority (shrine, hermitage, pagoda first). `GameView.pulseLandmark(id)` makes one ring-pulse for 5 s whatever the distance and zoom.
* **World panel, Landmarks tab** (`ui/panels/world.ts`, `ui/logic/world.ts nearbyLandmarks`): the living settlement nearest the player with kind, name, distance and a Show button (centres the camera and pulses the beacon; closes the panel on phones).

## Checks made

* `npm run typecheck` clean; `npm test` 988 passed (934 before), including `shared/{guardplan,landmarks,worldgen}.test.ts`, `server/npclife/guards.test.ts`, `client/render/{occlusion,beacons}.test.ts` and `client/ui/logic/logic.test.ts`.
* Existing tests that had to change because the world and the random stream changed: the guard head-counts in `sim/npcs.test.ts`; legends' homes may lie up to radius + 16 from the centre; `factions.test.ts` reads the chronicle as it is written (it is a 300-line ring, so a "seized" line could simply have been pushed out by the year's end); `missions.test.ts` counts purify offers over three worlds (seed 1337 has one settlement in reach of the Blight, so one history can offer only a handful); the storm test accepts a lower share indoors (merchant, innkeeper and craftsmen stay at their counters); the movement speed-factor test walks both entities along one row of terrain.
* `scripts/sim-soak.ts` (120 days, seeds 1337, 7, 21, 99, new vs main): alive NPCs 92-95 -> 142-152, snapshot json 109 KB -> 129 KB, 0.9-1.25 ms per world hour either way (max 11-12 -> 13-17 ms), sieges / raids / captures within the spread of one history to the next (captures a little lower: 6 / 11 / 5 against 8 / 16 / 8 on seeds 7 / 21 / 99; one seed is not a statistic), Blight coverage and statuses in the same range.
* `scripts/siege-bot.ts` against a local server (same forced siege of Lotus Ford, strength 55, 110 s): 11 raiders against 8 defenders both before and after, same stage sequence (alarm, march, melee, the town falls because the forced strength beats its defense), 145 vs 160 hits. The battle still follows the sim's roll; more guards only change how many defenders you see. By the code (`siege/party.ts planDefenders`, not run live for the big places) a town sends all 16 guards + masters + legends up to the `defenderMax` cap of 22 against parties of 6-18, a fort hits the cap, a village sends 6 guards + masters + a few militia and a hamlet 3 guards + militia; the starting village is the only place I watched.
* Housing (real sim, harness): every dwelling stays within `houseCapacity` (4) and barracks within 8. Fort: 19 guards in 3 barracks (7 / 6 / 6). Villages and hamlets: guards in houses, 2-4 per house. Towns have no barracks, so 16 guards fill all six or nine houses to the brim and the villagers bunk in inns and the teahouse (1-2 each). Nobody is homeless or overfull, but a town barracks is the natural fix and belongs to the phase 2 layout.

## Not done / left for later

* Town barracks (see housing above), more than one hermitage per settlement, hermitages for villages and hamlets.
* The squad does not eat together: members keep their own meal times (personal schedule phase), so a squad is sometimes three strong. Squad stays are as long as the world-time bucket; a long walk between far apart route points eats most of a 30 s bucket at the default hour length.
* Gate guards do not check travellers or react to players; phase 3 (villagers under attack outside the walls) can use `sp.outskirts` and the squad routes as the place where guards respond.
* Beacons are not clickable and the landmark list is for the nearest settlement only.
* The Blight offers on seed 1337 fell from about 39 to 5 over 60 days (the hamlet, the only settlement near the hearts, rolls fewer purify offers); other seeds still give 59-96. It is the dice of one history rather than a layout effect (an old-layout world with the new roster still gave 33), but it is worth watching on the live world.

## Extending (phases 2-4)

* A new settlement kind or size: add a row to `guardPolicy` and `LAYOUTS`; `planGuards` and the duties follow.
* More patrol points: add places to `outskirts` / `posts` in `places.ts buildSettlement`; the squad route picks them up by angle.
* A new landmark kind: add it to `LandmarkKind`, `LANDMARK_LABEL`, `BUILDING_LANDMARK` (shared), a glyph and colour in `beacons.ts`, an icon in `ui/logic/world.ts LANDMARK_ICON`.
* A new building kind: `BuildingKind` + `FOOTPRINT` (shared), a sprite in `art/buildings.ts` (+ `ROOF_DEFAULT`, `MAX_Z`), a `PlaceKind` in `npclife/places.ts` if people use it.

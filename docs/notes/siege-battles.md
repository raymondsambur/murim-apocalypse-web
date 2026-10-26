# Siege battles: visible raids, defenders, and the fall of a town

Owner: siege-battles. Code: `packages/server/src/siege/**`, system `packages/server/src/systems/siege.ts`. Tests: `npx vitest run packages/server/src/siege` (27 tests, ~4 s, one of them a real-sim smoke test). Live check: `scripts/siege-bot.ts`. Client demo: the sandbox's "Siege demo" buttons.

## What the player sees

A raid or a Blight siege used to be numbers only (defense against strength, rolled when the siege ends). Now, whenever an online player is within sight of a besieged settlement, there is a battle:

1. **Alarm.** A `note` ("Black Wind raiders are at the gates of Lotus Ford!"), a client-side bell pulse (red rings on the gate), a shout from a guard. The sim's chronicle line already exists.
2. **March.** A war party of 6-18 units (from the siege strength) appears 26-34 tiles from the gate, on the road that leads to where the raiders come from (the nearest settlement of the attacking faction, the nearest awake Blight heart, or the thickest Blight), in column, with a captain at the head and a banner bearer. It walks at a staggered 0.6-0.74 speed, stops at a forming line 11 tiles out and charges (running animation). Faction raiders are bandit-family monsters with the faction colour on the sash and banner; Blight sieges bring Hollows, hounds and monks with a violet banner. Drum pulses on every stage message.
3. **Defence.** The settlement's guards, masters and legends plus up to 8 militia (the strongest villagers, armed with staffs) leave their posts and run to a line just inside the gate (the open town, not the forest outside), stand alert (`act:'guard'`), one guard carries the town's banner. Civilians hide / shelter as before (npclife). The party comes to them.
4. **Melee.** Units pair with the nearest foe (spreading around a target, free neighbour tiles first), face each other, `state:'fight'`, trade abstract blows on per-unit timers. Spectators get `cfx` hit / miss / down events (floating numbers, sparks, knock-back, weapon animations), HP bars follow `hp/maxHp`. Casualties lie dead for a few seconds, then are carried off (defenders) or removed (raiders). Fallen defenders return as reserves in the lulls.
5. **Waves.** A repelled wave routs (the survivors run back down the road and vanish), the defenders recover for 28-46 s, the next wave comes (smaller if players killed raiders). There are at most `maxWaves` (4) waves: three ordinary ones, then the raiders regroup out of sight until the last wave, which starts about 1.45 world hours before the sim rolls the result. A siege itself is short: a faction raid or a Blight siege lasts **4-8 world hours** (`FACT.raidHours`, `SETTLE.siegeHours`; 4-8 minutes at the default 60 s per world hour), so a visible battle is about 2-4 waves.
   * **A strong defence ends it early.** Two ways, both ending as a certain hold: (a) after `earlyWaves` (3) repelled waves, if the hold chance is at least `earlyHold` (0.7), the battle breaks the raiders (siege strength 0, the siege ends at the next world hour); (b) the sim itself ends any siege whose strength has been worn down to 0 (player kills, `siegeKill`) at the next world hour (`settlementsHourly`). A town that is likely to fall is not let off: it still plays its capped waves and the sim's roll at the end decides.
6. **Finale (the sim's real result).**
   * *Held:* the raiders rout, the defenders cheer (`act:'celebrate'`), the people of the town celebrate for 90 s (`npclife.celebrate`), a shout "They are running! We held!".
   * *Fell, captured or plundered:* the line breaks (the weak fall, the rest run for the far gate), the raiders pour in, ransack the plaza (`act:'loot'`, captain and bearer `celebrate`), the buildings burn (client fires while the stage message says `fall`), raiders attack players on the plaza. A plunder ends with the raiders withdrawing.
   * After `finaleMs` (38 s) everything temporary is removed and the guards go back to their routines.

## The sim decides, the battle follows

`sim/settlements.ts endSiege` rolls `defense * U(0.82, 1.18) + walls >= siegeStrength` once, when the siege ends. We cannot see that roll in advance, but we know its distribution (`siege/outcome.ts holdChance`). So:

* While the siege runs the battle leans by the live odds (`momentum`, -1..+1): damage multipliers `defenders x(1 + 0.9 b)`, `raiders x(1 - 0.9 b)`. Waves before the last are always repelled (bias `clamp(0.35 + 0.5 m, 0.1, 0.85)`: a town that will fall is worn down, not beaten); the last wave uses the bias itself, and once no defender stands and the town is very unlikely to hold (`pHold < 0.2`) the raiders pour into the town early.
* When the sim has rolled (the `siege start:false` event, or the siege vanishing from the state), `classifyEnd` reads what happened from the settlement state before / after (`fallen` = fell, a new controller = captured) and the chronicle lines of that hour ("plundered" = plundered) and the finale plays that real result, whatever the lean was. A mismatch therefore shows as a last-minute turn of the tide (the gate breaks, or the raiders break), never as a wrong ending.
* Defenders are **clones** of the sim NPCs (hidden originals, seized from the routine through `npclife`), so when the sim kills or scatters the roster of a fallen town in the same hour, the battle on screen is not cut short.

Players: raiders are ordinary `monster` entities (`monsters` module `spawn`, `controlled`), so players fight them with the normal combat engine: `monsterKilled` carries `siege`, defend missions, loot, XP and `sim.recordKill` all work, nearby raiders join a player's fight as pack mates. Each kill also lowers the siege strength by `tiltPerKill x (1 + elite)` on top of the sim's own kill bonus (capped at `tiltCap` 22 per siege), so a heroic defence can turn a certain fall into a hold. Raiders attack players who come within 6 tiles outside the safe zone; players inside the settlement are left alone while the party is at the gate (existing rule) and are fair game once the raiders sack the plaza. A player who fell in the battle is spared for 75 s after waking up.

## Cost and boundaries

* Nothing runs while nobody is near: `scan` (1 s) only looks at besieged settlements; a battle exists while a player is within `radius + 46` tiles (torn down 8 s after the last player leaves `radius + 58`, every entity removed, NPCs released), so the siege resolves silently in the sim and leaves no entities.
* Per step (400 ms): at most 10 path computations, units <= 44 (party <= 18, defenders <= 22), pairing is O(n^2) on 40 units. Measured: ~0.2 ms per tick for a party of 18 with the whole roster. Hits use per-unit timers; events are batched into one `cfx` message per step.
* Deterministic: `ctx.rng`, `ctx.now()` only (test: same seed, same battle).
* Restart: nothing is persisted; at boot `scan` finds the sieges in the sim and builds the battle when a player shows up. With less than 0.5 world hours left the party is already at the gate (final wave).
* One owner for siege monsters: the siege system calls `MonsterApi.delegateSieges()`; the monster module dismantles its ring of siege monsters and never spawns one again (without the siege system it behaves as before).

## Files

| file | role |
|---|---|
| `siege/tuning.ts` | every constant (see below) |
| `siege/outcome.ts` | `holdChance`, `momentum`, `classifyEnd` (pure) |
| `siege/skirmish.ts` | `strike`, `pickFoe`, `partySize`, `defenderHp` (pure, tested without a game) |
| `siege/geometry.ts` | `planApproach` (gate, route along the road, forming line), column / line / defender slots, plaza spots, refuge, `holdPoint` |
| `siege/party.ts` | war party plan (species by family, levels from the local danger, captain, banner bearer), defender roster |
| `siege/unit.ts` | `Unit` (a fighter: raider monster entity or defender clone) |
| `siege/battle.ts` | the `Battle` state machine: march, melee, lull, finale, teardown |
| `siege/index.ts` | `SiegeManager` (scan, step, hour hook, tilt, spare), `getSiege(ctx)`, `forceSiege` / `forceEnd` for tests and the dev trigger |
| `systems/siege.ts` | registration and the `SIEGE_DEBUG` trigger |
| `siege/testkit.ts`, `siege/siege.test.ts`, `siege/siege.smoke.test.ts` | tests |

## Tuning (`siege/tuning.ts`, `SIEGE_TUNING`)

Visibility: `activateRadius` 46, `deactivateRadius` 58, `graceMs` 8000, `stepMs` 400, `scanMs` 1000, `heartbeatMs` 4000. Party: `strengthPerUnit` 5, `partyMin` 6, `partyMax` 18, `unitsPerCaptain` 8, `marchTiles` 26-34, `columnSpacing` 1.4, `marchSpeed` 0.6-0.74, `chargeSpeed` 1.55, `lineDist` 11, `chargeDist` 14, `marchTimeoutMs` 45000. Defence: `militiaMax` 8, `defenderMin/Max` 4/22, `sortieSpeed` 1.5, `holdInside` 3.5, `defendRange` 7, `corpseMs` 4500, `lullMs` 28-46 s. Skirmish: `reach` 1.9, `hitMs` 1050-1650, `hitChance` 0.82, `critChance` 0.08, `hitFrac` 0.15 (share of the target's max HP per blow), `steerK` 0.9, `routShare` 0.34, `waveMaxMs` 110 s, `pathBudget` 10, `unitCap` 44. Steering: `waveBias`, `waveBiasK`, `waveBiasRange`, `finalBiasMax`, `breachBelow` 0.2, `finalLeadHours` 1.45, `lateJoinHours` 0.5. Waves: `maxWaves` 4, `earlyWaves` 3, `earlyHold` 0.7. Sim durations (`sim/constants.ts`): `FACT.raidHours` [4, 8], `SETTLE.siegeHours` [4, 8] (they were 18-36 and 16-30, which gave up to about 15 waves). Players: `tiltPerKill` 1.1, `tiltCap` 22, `aggroRange` 6, `spareMs` 75000, `sackAttacksPlayers`. End: `finaleMs` 38000, `celebrateMs` 90000, `shoutEveryMs` 7000.

## Protocol additions

* `EntityView.side` (`'raid' | 'def'`) and `EntityView.flag` (1 = carries a banner), `NpcAct 'loot'`.
* `S2C {t:'siege', sid, phase: 'alarm'|'march'|'melee'|'hold'|'fall'|'end', by, x, y}` (`SiegePhase`): the stage of the battle, sent to players near the gate at every change and every 4 s (idempotent, so late arrivals see the fires). The client turns it into bell / drum pulses and fires on the buildings while `fall`; the fires also die 26 s after the last message.
* `cfx` hit / miss / down events, `chat` local shouts (speech bubbles), `note` alarm: existing messages.

## Additive edits outside `siege/`

| file | edit |
|---|---|
| `packages/shared/src/protocol.ts` | `EntityView.side`, `EntityView.flag`, `NpcAct 'loot'`, `SiegePhase`, `S2C 'siege'` |
| `packages/server/src/ctx.ts`, `game/entities.ts` | `EntityExtras.side/flag`; the two keys added to `EXTRA_KEYS` (sent and diffed like the other visible fields) |
| `packages/server/src/systems/monsters.ts`, `monsters/state.ts` | `MonsterState.controlled` / `SpawnSpec.controlled` (the AI think skips such a monster; a fight that ends without its death hands it back instead of sending it home), `MonsterApi.delegateSieges()` (the built-in siege ring is dismantled and stops spawning) |
| `packages/server/src/npclife/life.ts`, `npclife/index.ts` | `seize(npcId)` / `release(npcId, at?)` (take an NPC off its routine; the clone fights instead) and `celebrate(sid, ms)` (festival mood at any hour) on `NpcLife` and `getNpcLife` |
| `packages/server/src/systems/index.ts` | one import and one array entry (`registerSiege`, last) |
| `packages/client/src/render/{api,view,scene,fx,life}.ts`, `state/dispatch.ts` | optional `GameViewApi.setBattle`, `siege` message routing, burning buildings (`SceneRenderer.setBurning`), banner drawing, bell / drum rings, `ACT_STATE.loot` |
| `packages/client/src/sandbox.ts`, `siegedemo.ts` | the "Siege demo" buttons (`?siege=hold|fall&sid=3` starts one on load) |

## Dev trigger and live check

With `SIEGE_DEBUG=1` the server watches a command file (`SIEGE_DEBUG_FILE`, default `data/siege-debug.json`; it is deleted when handled; nothing is read without the flag):

```json
{"action":"start","user":"lead_tester","by":"blackwind","strength":55,"hours":3,"defense":42}
{"action":"end","user":"lead_tester"}
```

`by` is `blight` or a faction id; `defense` sets the settlement's defense so the sim's roll can be steered; `end` makes the siege end at the next world hour (the sim rolls it). `scripts/siege-bot.ts` registers / logs in the test account on the server it is pointed at (`--url`), writes that file, stands in the town and logs entities by side and state, blows, stage messages, shouts and the final settlement state (`--fight 1` makes it attack the nearest raider). Run against your own throw-away instance (own `DB_PATH`, a short `WORLD_HOUR_MS` such as 20000) rather than a shared database.

Observed live (own instance, seed 1337, Lotus Ford, 20 s per world hour): Black Wind strength 55, defense 40: 11 raiders marched in, 9 defenders met them at the gate (22 casualties in total), the sim rolled "The Black Wind Bandits seized Lotus Ford", the finale showed the line breaking, 7 raiders reaching the plaza (loot / celebrate cues), the visitor being cut down and the scene being cleaned up 38 s later (0 entities left with a battle side). Blight strength 40, defense 95: 8 Hollows lost, "Lotus Ford has withstood the Hollow siege", the 10 defenders celebrated, clean end. Strength 25 with `--fight 1`: the level-1 bot engaged a raider and its pack mates joined the real combat engine ("You have fallen"), the battle went on and the second wave was turned back by the sim's roll.

## Known gaps

* The roll is not visible in advance, so a battle can lean the wrong way for its last minute; the finale always plays the real result (see above).
* Defenders are abstract: they never attack players, cannot be attacked, and a clone that "dies" does not kill its sim NPC (the sim kills the roster of a fallen town itself).
* Roads leave the settlements through forest: a party marching down them is partly hidden by tall trees (plates fade behind scenery); the defence line therefore stands inside the gate on cleared ground.
* One battle per settlement, one entry gate per battle (the gate nearest to where the raiders come from); no siege engines, archers firing from towers or wall climbing.
* Hollow raiders ignore `act` cues (the client never plays work / loot poses on Hollows), so a sacked town shows them standing around.
* The plunder / capture split is read from the chronicle text ("plundered") and the controller change; if the sim's wording changes, `classifyEnd` falls back to "held" for a raid that did not capture.
* Not persisted: a restart mid-siege restarts the battle at the siege's remaining time, not at the same wave.
* Tests run the real sim at the default 60 s hour: the battle timings are real-time constants, so very short `WORLD_HOUR_MS` values (a few seconds) cut the waves short (the finale still plays the result).

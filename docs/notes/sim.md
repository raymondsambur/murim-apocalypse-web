# World simulation (`packages/server/src/sim`)

Pure, deterministic living-world logic. No sockets, timers, DB or wall-clock reads: the server passes `nowMs`.
`createSim(world, { seed, hourMs, nowMs, saved? })` (in `sim/index.ts`) returns a `Sim` (`sim/api.ts`, unchanged).
Same seed + same sequence of calls + same `nowMs` values => byte-identical `serialize()` output. Read-only methods
(`greeting`, `shopFor`, `board`, `priceMult`, `timeView`, `worldInfo`, ...) never touch the sim `Rng`.

## Files
| file | role |
|---|---|
| `index.ts` | `createSim`, the hourly/daily step order, the `Sim` object |
| `constants.ts` | **every tuning knob** (`BLIGHT`, `SETTLE`, `ECON`, `FACT`, `NPC`, `MISSION`, `CHRON`, `HAPPEN`) |
| `types.ts`, `util.ts`, `static.ts` | internal state (`SimExt`), helpers, terrain masks / stamps / road paths (derived once per world) |
| `clock.ts`, `weather.ts` | calendar (totalHours 0 = 06:00 of day 0), per-band Markov weather |
| `blight.ts` | Blight grid, hearts, purify, kills, heart damage / sealing |
| `settlements.ts` | defense, status hysteresis, sieges (Blight and faction), falls, retakes, flags, prosperity, population |
| `economy.ts` | production / consumption per settlement, caravans, famine, `priceMult`, `recordTrade` |
| `factions.ts` | five factions: relations, wars, alliances, daily AI (develop / recruit / fight Blight / expedition / raid / goodwill / trade / annex), raid resolution (capture or plunder), revolts, uprisings |
| `npcs.ts` | initial roster, daily lives, deaths, succession, legends, greeting, shop listings |
| `missions.ts` | boards, offer generation (7 types), take / return / complete |
| `happenings.ts` | small daily local events (harvest, mine strike, beast raids, births...) that nudge stock / prosperity and give the chronicle texture |
| `chronicle.ts` | ring buffer of 300 with per-day caps (importance 1: 7, 2: 9, 3: unlimited) and dedupe keys |
| `serialize.ts` | snapshot format (`json` = state without the grid, key order canonical; `blight` = base64 grid) |
| `*.test.ts`, `testkit.ts` | vitest suites (75 tests, ~6 s) |

## One world hour (`advanceHours(1)`, ~0.15 ms average, 3 ms at midnight)
1. clock + 1. At 00:00: `newDay` (and `newSeason` + chronicle every 30 days), roll tomorrow's weather.
2. Fog lifting, `blightHour` (emission / diffusion / decay / suppression), seals that expire wake their heart,
   `settlementsHourly` (defense relaxes to its target, Blight sieges roll, sieges end), succession tasks due.
3. At 00:00 also: hearts regrow / flare, `economyDaily`, `settlementsDaily`, `factionsDaily`, `npcsDaily`, `happeningsDaily`.
4. At 06:00: boards are refreshed. Every hour: boards flagged dirty (siege, famine, offer taken...) are topped up.

`advanceHours(n, nowMs)` runs n of these (catch-up is fine). `timeView(nowMs)` = last advance + fraction (clamped to the hour).

## Rules in short
* **Blight** (`Uint8Array w*h`, land only): heart emission (`heartEmit` x strength x pulse x flare x season/weather),
  4-neighbour diffusion, proportional + constant decay (both scaled by season/weather), suppression around living
  settlements (`suppress` x defense x status), growth sinks at fallen settlements (fade after `fallenFadeDays`, the ruin never).
  Season multiplier `BLIGHT.season` spring/summer/autumn/winter = 1 / 1.2 / 1 / 0.6, weather rain 0.75, storm 0.7.
  Observed (seed 1337, no players): coverage (>=16) 8% at start, 10-15% in the cycle, never above ~21% on any tested seed,
  never below ~6%; the starting village stays at 0. Hearts 0..100, regrow `heartRegen`/day, `damageHeart` seals for 6-10 days.
* **Settlement status**: `thriving / stable / struggling / besieged / fallen` with hysteresis on a daily score
  (prosperity - 0.2 x Blight - famine/plague). Defense target = kind base + faction power share (capped) + capital bonus
  + ideology bonus (`SETTLE.ideologyDef`) + prosperity - 0.28 x Blight - flags.
  Settlement `blight` = weighted mean over radius+8 (`BLIGHT.avgExtra`, `avgPow`).
* **Sieges**: Blight siege chance/day = (blight - 14) / 50 (cap 0.45), never at the starting village in its first 150 days.
  Faction raid = siege with `siegeBy = factionId`. At the end: roll `defense * U(0.82,1.18) (+6 walls)` vs `siegeStrength`.
  Blight siege lost => `fallen` (population x0.1, controller null, importance-3 chronicle line, NPC roster scattered / killed).
  Raid won => capture (controller flips, `lostAt` memory for uprisings) or plunder. Player kills of the attacker family and
  defend missions reduce `siegeStrength`.
* **Fallen** settlements are retaken by a faction (power >= 32, Blight < 26) or by survivors after 18 quiet days.
* **Economy**: goods = `GOODS`. `prod/cons` recomputed daily (winter grain x0.25, autumn x1.5, Blight / siege / control modifiers).
  Caravans (`ECON.caravanCap`) move surplus over roads whose mean Blight is < 42, unless an end is besieged/fallen.
  Famine below 3 food-days (clears above 6): drains population and prosperity, raises boards' relief offers.
  `priceMult(goods) = clamp(sqrt(target/(stock+1)), 0.6, 2.5)`, target = 10 days of consumption.
* **Factions**: power 5..100, wealth 0..250 (soft cap 80), relations symmetric -100..100, alliances (>62) and wars (<-60, ends
  by exhaustion / truce / high Blight threat), one action per 1-3 days, one raid at a time, nobody holds more than 4
  settlements by force, big factions are ganged up on and suffer revolts (often to a weaker rival), a conquered place may rise
  for its old masters (uprising), landless factions fight with a bonus (`exileRaidBonus`) and can recover. Righteous factions
  occasionally mount heart-sealing **expeditions** (chronicle names the faction). Jade runs caravans (`caravanUntil`).
* **NPCs**: ~97 at start (see below). 1 year = 120 days. Old-age hazard `NPC.ageHazardBase * exp((age - level*0.22 - 65)/6.5)` per
  year. Deaths also from plague, sieges, fall of a settlement, feuds between masters of warring factions.
  Service roles (master, merchant, smith, alchemist, innkeeper, elder) are replaced 1.5-4 days later by a newcomer (`npcBorn`),
  masters inherit `teaches`; `ensureRoster` also refills guards / villagers. Masters train, gain titles at rank 4 and become legends at
  level 37 (`legend: true`, role `legend`); new wandering legends arrive when the world has too few.
* **Missions**: 4-8 offers per living settlement, refreshed daily at 06:00 (stale ones retire) and on events. See "missions" below.

## SimEvents and what the game server should do
| event | meaning | server reaction |
|---|---|---|
| `chron {entry}` | new chronicle line | broadcast to clients (already done by `fanOut`) |
| `settle {id}` | settlement view changed (status, controller, prosperity, flags, Blight...) | re-send `sim.settlementView(id)`. Emitted for every settlement once a day and on any change |
| `blight {idx[]}` | tiles changed by about a bucket of 8 (one event per hour, plus purify/kill/mission events) | send idx + `sim.state.blight[i]` (full map if the list is long) |
| `npcDied {id}` | NPC died | despawn its entity (`sim.npc(id)` still returns the record for ~40 days) |
| `npcBorn {id}` | new NPC (successor, settler, arriving legend) | spawn an entity from `sim.npc(id)` |
| `npcMoved {id}` | NPC changed settlement / home / faction / level / role | re-sync (move or re-create) the entity |
| `siege {settlementId, start}` | siege begins / ends | see below |
| `weather {zone, kind}` | a climate band's weather changed | `sim.timeView()` carries all three; use `sim.weatherAt(x, y)` for local effects (aggro, travel) |
| `board {settlementId}` | the mission board changed | re-send `sim.board(id)` to players viewing it |
| `heart {id, active}` | a Blight heart woke or was sealed | show / hide the heart boss or node; `state.hearts[i].strength`, `sealedUntil` |
| `newDay`, `newSeason` | calendar | optional UI / daily resets |

**Siege start** (`state.settlements[id]`: `siegeBy`, `siegeStrength`, `siegeUntil`): spawn attackers around the settlement while
`siegeUntil > clock.totalHours`: `siegeBy === 'blight'` => Hollows (family `blight`, levels from the local danger), otherwise raiders
of family `bandit` (the attacking faction is `siegeBy`). Every player or guard kill of that family near the settlement should go through
`sim.recordKill(x, y, family, level, elite)` which lowers `siegeStrength`. Defend offers on the board point at the same settlement.
**Siege end**: despawn leftover attackers; the outcome arrives as `settle` + chronicle lines (held / fell / captured / plundered).
A settlement that becomes `fallen` has no living NPCs and an empty board; its shops and masters are unavailable.

**NPC died**: despawn the entity; its mission `giverId` is cleared on the next board refresh. A successor appears as `npcBorn` after 1.5-4 days.

Other server duties: spawn Blight-family monsters wherever `blightAt` is high (density / level from the value); call `recordKill` for
every kill, `recordTrade` for every goods sale / purchase, `takeOffer` / `returnOffer` for mission accept / abandon,
`recordMissionDone(offer, name)` on completion (it already applies the world effect: purify lowers Blight at the target, defend damages the
siege, deliver / gather add stock, bounty writes a chronicle line - do not call `purify` again for the same mission), `damageHeart` when a
player hits a heart. Methods returning `SimEvent[]` (`recordKill`, `recordMissionDone`, `damageHeart`, `purify`) return the events instead of
queuing them: pass them through the same fan-out as `advanceHours` events. `record()` returns the entry and does **not** queue an event
(broadcast it yourself).

## Missions
Types: `hunt`, `gather`, `deliver`, `purify`, `defend` (only while besieged), `bounty` (named elite/boss, `target.elite` 1|2),
`investigate`. `id = m<N>`, `expires` is a world day (the offer is gone on that day). `level` ~ local danger level (`levelForDanger`),
starting village <= 4. Rewards: xp ~ (25+9L) x type multiplier, gold ~ (12+6L) x multiplier, faction `rep` +2..+8 (patron faction for independent
places), sometimes pills or a `manual_<skill>` of tier <= local rank. `deliver`: the server hands the parcel (or checks the item); completion adds the goods to the
destination's stock. `giverId` is an alive NPC of the settlement (cleared if it moves or dies). `takeOffer` marks the board dirty (it is topped
up and announced within the hour).

## NPC roster (created at init)
Per living settlement: guards 2-3 (fort 4), elder, merchant (`general`), smith (`weapons`; village/town/fort), alchemist (`medicine`; village/town/sectHall),
innkeeper (`food`; where an inn exists), 3-6 villagers, occasional wanderer. Masters: sectHall 3-4, fort 2-3, town 1-2, village 1 (starting
village 2, of different schools), `teaches` 2-4 skills of the faction's schools with `req.rank <=` master rank. Legends: ceil(living/2) at level 36-60,
never in the starting village at start; they wander (`npcMoved`). Homes are `isPassable` tiles near the relevant building door.
`npcs()` returns **living** NPCs only; `npc(id)` also returns the recently dead.

## Tuning knobs (all in `constants.ts`)
* Blight shape: `BLIGHT.heartEmit`, `decayRate`, `decayConst`, `diffusion`, `suppress`, `suppressExtra`, `season`, `weather`, `fallenEmit`, `ruinEmit`, `avgExtra`/`avgPow`.
* Pressure on settlements: `SETTLE.siegeBlight`/`siegeBlightSpan`/`siegeDailyCap`, `siegeHours`, `baseDefense`, `blightDefPenalty`, `retakeBlight`, `returnDays`, `startGraceDays`.
* Economy: `ECON.farmGrain`, `gardenByKind`, `huntMeat`, `mineOre`, `grainSeason`, `caravanCap`, `famineEnter/Leave`, `priceTargetDays`.
* Factions: `FACT.actEvery`, `raidStrength`, `exileRaidBonus`, `maxHoldings`, `revoltChance`, `revoltHeirChance`, `uprisingChance`, `incidentChance`, `warDeclare`, `allianceAt`, `wealthSoftCap`, `exileTarget`, `powerRelax`; `SETTLE.ideologyDef`.
* NPCs: `NPC.ageHazardBase/Scale`, `levelLongevity`, `feudChance`, `legendWanderChance`, `legendArriveChance`, `pruneDays`.
* Pacing: `CHRON.dailyCap`, `HAPPEN.perSettlementDay`, `MISSION.minOffers/maxOffers/expiresDays`.

## Soak observations (no players)
`npx tsx --tsconfig packages/server/tsconfig.json scripts/sim-soak.ts [days=60] [seed=1337] [--every=10] [--chron=30] [--quiet]`
(the `--tsconfig` flag is needed because there is no root `tsconfig.json`, so tsx cannot resolve the `@murim/shared` alias otherwise).
Seed 1337, 90 days: Blight coverage 8% -> 14%, Black Market (next to the hearts) besieged by Hollows 3x and fallen around day 55, ~20 raids with 7 captures
and 4 plunders, 4 wars / 5 truces / 3 alliances, one plague, 18 NPC deaths and 7 successions, ~4.6 chronicle lines per day.
360 days: 64 raids, 29 captures, 12 wars / 19 truces, Black Market falls twice and is retaken in between, two hearts sealed by expeditions, 26 NPC deaths,
16 successions, legends stay at 4, no famine spiral, prices 0.6-2.4. Two-year runs on four seeds stay stable (no faction pinned at 0 or 100 power,
largest holding 4 of 7, roster 81-99 NPCs). Crimson Lotus and Black Wind are the underdogs and are landless for roughly 30-70% of the time.

## Known gaps
* Nothing simulates combat between NPCs: sieges, raids and feuds are rolled abstractly (defense vs strength).
* Hearts have no guardians in the sim; the server decides what stands on a heart node.
* `settle` events are emitted daily and on change, so a client's `blight` / `defense` numbers lag by up to a day between changes.
* Deliver offers do not check that the player carries the item; the server owns that.
* Faction landlessness for the two weakest factions is long; tune `exileRaidBonus`, `ideologyDef` and `revoltHeirChance` if you want them stronger.

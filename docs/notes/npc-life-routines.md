# NPC life: routines, needs, shelter, mobilisation

Owner: npc-life-routines. Code: `packages/server/src/npclife/**`, system `packages/server/src/systems/npclife.ts`. Pure systemic code (utility AI, no model). Tests: `npx vitest run packages/server/src/npclife` (28 tests, ~2 s). The memory / gossip engineer reads this through `getNpcLife(ctx)` and the `npcChat` event.

## What it does

Every living sim NPC gets a **home** (house shared by 1-4 NPCs, same surname preferred; guards use barracks if present; innkeepers / legends live at the inn) and a **workplace** by role. Every few world minutes an NPC picks the best-scoring **activity** (schedule table by role and hour + needs + traits + weather + settlement state), walks there with `ctx.movement.moveTo`, and does it: a cue (`entity.act`) while standing, hidden indoors (`entity.hidden = true`) for sleep / hiding / eating at home. Reactions: rain and storms (shelter), night (home, guards on shifts, innkeeper open late), siege / Blight alarm (guards muster at the gates, civilians hide), famine (mope at the market), festival or a new season (crowd on the plaza), a death (neighbours mourn at the home door).

State machine per NPC (`life.ts`): `idle -> decide -> depart (random 0.3-4.5 s pause) -> travel -> doing (cue / hidden) -> idle`. Nothing is persisted; places are derived from the world, needs restart at the boot.

**LOD.** A settlement is "near" when an online player is within `radius + AOI_RADIUS + 4` tiles. Far NPCs never walk: when their activity ends they pick the next one and are placed there directly (teleport while nobody can see). Near NPCs walk (speed = entity speed, 0.55, x1.6 when hurrying in rain or alarm) and enter / leave doors visibly; a walking NPC whose settlement becomes far is snapped to its destination. Cost per tick: NPCs are visited in a rotating slice (about once per second each: `ceil(n/10)` per tick, max 48), at most 6 new decisions per tick, A* only for near NPCs.

## Places (`places.ts`, `assign.ts`)

Derived once per world (`WeakMap`): per settlement the buildings by kind (door tile + up to 10 standing spots in rings 1-3 around the door), `plaza` (Plaza terrain around the spawn, thinned), `farms` (work sites of kind `farm`), `gates` (where each road leaves the settlement, else 4 compass points), `posts` (gates + towers + barracks + plaza + 4 inner-ring points, sorted by angle). Every door and spot is verified reachable from the settlement spawn (flood-fill component labels).

| Role | Home | Work |
|---|---|---|
| villager | house / farmhouse (family first) | farm patch (every 3rd the herb hut), else herb hut, else plaza |
| guard | barracks, else house | patrol posts (loop), day / night shift by order in the settlement |
| smith | house | smithy (else market) |
| alchemist, physician | house | alchemy (else herb hut, market) |
| merchant | house | market (else warehouse, plaza) |
| innkeeper | inn | inn (else teahouse) |
| master | house (overflow: hall / dojo) | dojo, hall or pagoda |
| elder | house | hall, pagoda, teahouse, else plaza |
| legend, wanderer | inn, else house | plaza |

If every dwelling is full the NPC bunks in a teahouse / hall / dojo / pagoda / barracks / inn before doubling up.

## Activities (`activities.ts`) and the cue each one sets

| Activity | `entity.act` | `entity.state` | Where | Hidden | Hours | Notes |
|---|---|---|---|---|---|---|
| sleep | none (`rest` if no bed) | idle | home door | yes | until wake time (4-10) | wake ~05:24 +- phase, night guards 15:00, innkeeper 06:30; short nap only if exhausted |
| eat | `eat` | idle | home (indoors) or inn spots | home yes | 0.35-0.7 | inn for guards, legends, cheerful / cunning / boastful |
| work | `work` | work | workplace spot | no | 1.5-3 (greedy x1.25) | smith, alchemist, villagers, innkeeper, elder, master (teach) |
| trade | `trade` | work | market spot | no | 1.5-3 | merchants |
| socialise | `chat` once paired, none while waiting | idle | plaza / inn / market / home door, or walk up to a waiting NPC | no | 0.4-0.9 (x1.8 waiting) | pairs face each other, emit `npcChat` |
| pray | `pray` | idle | shrine, pagoda or hall | no | 0.3-0.6 | |
| sweep | `sweep` | work | home yard, or the shop front for service roles | no | 0.3-0.7 | |
| train | `train` | work | dojo / hall / pagoda (guards: dojo, barracks) | no | 1-2 | masters, guards, legends |
| patrol | `patrol` | work | next post of the loop | no | 0.3-0.8 per post | stands scanning; walking between posts is the patrol |
| wander | none | idle | plaza or home yard | no | 0.2-0.5 | looks around now and then |
| rest | `rest` | idle | home door | no | 0.5-1.1 | |
| shelter | `shelter` | idle | nearest building: inside (hidden) or under the eaves | ~55% | 0.7-1.5 | rain / storm, hurried walk |
| hide | none | idle | home, indoors | yes | 1-2 | siege, Blight alarm (60% of civilians) |
| muster | `patrol` | work | a gate | no | 1-2 | guards (4.2), masters / legends (2.6) on a siege |
| mourn | `mourn` | idle | the dead NPC's home door | no | 1.2-2.6 | up to 5 neighbours: same house, same surname, then others |
| celebrate | `celebrate` | idle | plaza | no | 0.7-1.6 | `festival` flag or the day of a `newSeason`, 10:00-22:00 |
| mope | `rest` | idle | market | no | 1-2 | `famine` flag, 08:00-20:00 |

While a player is talking to an NPC (`NPC_DATA.holdUntil`), the cue is cleared and the activity timer is paused; the NPC resumes afterwards. `entity.act` is cleared while walking.

## Default schedule (`SCHEDULE`, world hour of day; weights, highest wins after needs / traits)

| Hours | villager | guard (day shift) | guard (night shift) | artisan (smith, alchemist) | merchant | innkeeper | master | elder | legend |
|---|---|---|---|---|---|---|---|---|---|
| 00-05 | sleep | sleep | patrol | sleep | sleep | open until 01:00, then sleep | sleep | sleep | sleep |
| 05-07 | sweep, eat, work | eat, patrol | eat | sweep, eat, work | sweep, eat | sweep, eat | pray, train, eat | pray, eat | pray, train, eat |
| 07-12 | work | patrol, train | sleep (08-15) | work | trade | work | train, work | work, chat | train, wander, chat |
| 12-13:30 | eat, chat, rest | eat, chat | sleep | eat, chat | eat, chat | work, eat | eat | eat, rest | eat, chat |
| 13:30-18 | work | patrol, train | eat, train (15-19) | work | trade | work | train, work | work, chat, pray | wander, chat, train |
| 18-21 | eat, chat, pray, rest | eat, chat, rest | patrol from 19:00 | eat, chat | eat, chat | work (open late), chat | eat, pray, chat | pray, eat, chat | eat, chat |
| 21-24 | sleep | sleep | patrol | sleep (from 22) | sleep (from 22) | work | sleep (from 21) | sleep (from 20:30) | sleep (from 22) |

Each NPC has a personal offset (+-0.75 h by id hash; weary -0.3 h) so dawn and dusk have stragglers; durations and departure pauses are randomised.

**Needs** (0..1, advance per world hour: hunger +0.11, rest +0.06, company +0.07, devotion +0.05, duty +0.12; activities override, e.g. eat -1.5 hunger, sleep -0.17 rest, pray -2 devotion): hunger x1.5 feeds `eat` (and suppresses it below 0.3), rest x0.55 feeds `sleep`, company x1.2 `socialise`, devotion x0.9 `pray`, duty x0.5 `work`. `safety` is derived (1 under siege, 0.7 Blight alarm).
**Traits**: devout (+0.4 pray, devotion x1.6), superstitious (+0.15 pray), cheerful (+0.25 chat, inn meals), kind (+0.1 chat), boastful (+0.1 chat, +0.15 train), gruff (-0.3 chat, hardy), stern (-0.15 chat, hardy), weary (+0.2 sleep / rest, earlier bedtime), greedy (+0.15 work, x1.25 longer), honest (+0.1 work), cunning (inn meals).
**Weather** (`ctx.sim.weatherAt` at the settlement centre): rain 0.7, storm 1, snow 0.45, fog 0.08. Outdoor activities lose `rain x (0.9 - 0.3 hardy)`; `shelter` scores `rain x (1.5 - 0.9 hardy)` (guards x0.3, merchants x0.5, innkeeper x0.2).
**Settlement state** (`ctx.sim.settlementView`): `siege` or status `besieged` -> hide / muster; `blight >= 120` -> guards muster, 60% of civilians hide; flag `famine` -> mope, less work and trade; flag `festival` or the day of a `newSeason` (10-22 h) -> celebrate.

Reactions are applied by comparing a settlement's mood signature every world hour (`onHour`) and on any batch with `siege` / `weather` / `npc*` / `newSeason` events: when it changes, the settlement's NPCs re-decide after a random 0.8-20 s (sleepers stay asleep, except guards, masters and legends when an alarm starts or ends).

## API for other systems (`getNpcLife(ctx)`)

```ts
import { getNpcLife } from '../npclife';
const life = getNpcLife(ctx);                 // safe to call at register time, before or after the life system
life.activityOf(npcId)    // { activity, phase, cue, indoors, place: {kind,x,y,...}, chatWith, until } | undefined
life.placesOf(npcId)      // { home, work } PlaceViews
life.npcsAt('inn', sid)   // NPC ids that have arrived at a place of that kind (includes those indoors)
life.nearbyNpcs(npcId, r) // NPC ids within r tiles (default 6), visible ones only
life.needsOf(npcId)       // hunger / rest / company / devotion / safety / duty
life.stats()              // visits, decisions, snaps, travels, pairs counters
ctx.events.on('npcChat', ({ a, b, settlementId }) => ...)   // once per conversation, when the pair faces each other
```

`npclife/index.ts` also exports `NPCLIFE_TUNING`, `ACTIVITIES`, `SCHEDULE` and the types. `npcLifeController(ctx)` returns the internal controller (tests).

## Tuning (`npclife/tuning.ts`, `NPCLIFE_TUNING`)

`sweepTicks` 10 (full roster sweep per second), `maxVisitsPerTick` 48, `maxDecisionsPerTick` 6, `nearTtlMs` 1000, `nearMargin` 4, `moodTtlMs` 3000, `houseCapacity` 4, `barracksCapacity` 8, `spotsPerPlace` 10, `departJitterMs` 300-4500, `hurrySpeed` 1.6, `travelMaxSteps` 140, `travelMaxNodes` 4500, `travelRetries` 3, `avoidPlaceMs` 120000, `needs` rates, `needsMaxDt` 12, `scoreNoise` 0.12, `repeatPenalty` 0.25, `phaseSpread` 0.75, `weather` factors, `blightAlarm` 120, `blightHideShare` 0.6, `shelterInsideShare` 0.55, `festivalFrom/To` 10-22, `innMealShare` 0.28, `chatRadius` 9, `chatSeekRadius` 26, `chatHours` 0.3-0.7, `mourners` 5, `mournHours` 1.2-2.6, `mournCallHours` 7, `interruptDelayMs` 800-20000, `nearbyRadius` 6.

## How to add an activity

1. `activities.ts`: add the id to `ActivityId` and `ACTIVITY_IDS`; a row in `ACTIVITIES` (cue, entity state, hour range, need effects); a score line in `scoreAll` (use `s(id)` for the schedule weight, return about -9 to disable it); optional weights in `SCHEDULE`.
2. `life.ts` `resolve()`: add a `case` that returns a `Plan` (`this.mk(act, place, st, { inside, stable, hours, hurry })`) or `null` when no place is usable (the next best activity is tried).
3. Cue: set `cue` in the table (it is applied by `beginDoing`); special cases go in `cueFor`.
4. Add a test in `npclife/npclife.test.ts` using `makeLifeHarness` (`h.setHour`, `h.run(ms)`, `h.hours(n)`).

## Additive edits outside the folder

* `packages/server/src/ctx.ts`: `NpcEntityData.driven?: boolean`.
* `packages/server/src/game/npcs.ts`: the built-in wander skips NPCs with `driven` (one condition in `wander`). Without the life system registered nothing changes.
* `packages/server/src/systems/index.ts`: one import and one array entry (`registerNpcLife`, last).

## Known gaps

* Conversations are 2-person only and only start between NPCs that are both standing around (waiting socialisers); there is no group chat and no content (the gossip engineer hooks `npcChat`).
* NPCs do not react to individual monsters or to the player's actions, only to the settlement flags and weather. A besieged settlement's attackers do not interact with NPCs.
* Children and families are approximated by surname; there is no age-based schedule except `age >= 60` (earlier bed, more rest).
* Eating costs no goods (no hook into the economy); the innkeeper does not run out of food during a famine.
* Hidden NPCs sit on their door tile; other systems that query `entities.near` should filter `hidden`.
* The first minutes after boot place all NPCs at 06:00-ish breakfast (everyone starts with the same hunger band); the schedule spreads out within about an hour.

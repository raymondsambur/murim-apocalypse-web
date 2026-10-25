# Gameplay activities (train / shift / craft) - notes for the Jobs panel and other systems

Owner: gameplay-activities. Code: `packages/server/src/systems/activities.ts` (wiring, commands, queries) and `systems/activities/{rules,settle,report}.ts` (pure rules, settlement, reports). Tests: `activities.test.ts`, `activities.smoke.test.ts`.

## Messages

| Client sends | Result |
|---|---|
| `{t:'astart', kind:'train', site}` | Inside the site's settlement radius (dojo: within 6 tiles of the dojo, x1.5 xp). Refused when the XP bar is full at a breakthrough stage. |
| `{t:'astart', kind:'shift', site, job}` | Gather jobs only (herbalist/miner/farmer); site kind must match; within 3 tiles; bag needs room. |
| `{t:'astart', kind:'craft', site, recipe, qty}` | smithy/alchemyLab; job level; within 6 tiles; qty 1-20 and `qty*seconds <= 8 h`; inputs consumed now; the finished goods must fit the bag. |
| `{t:'astop'}` | Settles, ends, refunds unstarted craft units. |
| `{t:'move'}` | Overridden: a successful move (steps > 0) settles and ends the activity. Walking via `interact` ends it within 250 ms. |
| query `sites {settlement}` | `SiteView[]` (`job` for work sites, `trainBonus: 1.5` on dojos). |
| query `recipes {site}` | `RecipeView[]` for the site's trade (`[]` for non-crafting sites); `canCraft/reason` is for qty 1 for the calling player. |

Error codes on `err`: `dead in_combat busy slow_down no_site bad_job wrong_site too_far bag_full no_recipe bad_qty too_long low_level no_materials xp_full idle`.

State shown to the client: `me.c.activity` (`kind, since, settled, site, job/recipe/remaining, carry`). Progress bar: a craft unit is done every `recipe.seconds`; the current unit progress is `(now - settled) / (seconds*1000)`. The activity ends `since + 8 h` at the latest (client can show `since + 8*3600*1000` as the deadline). Entity state: `meditate` / `work` / `craft`.

## Rules implemented

- Settlement is lazy and exact: output for `settled .. min(now, since + OFFLINE_CAP_MS)`. Runs on login, every 60 s for everyone with an activity (online and offline workers), `astop`, a move, a fight/death (polled every 250 ms), and at shutdown. A second settle at the same time grants nothing; `now < since` grants nothing.
- Fractions are carried in `activity.carry` (xp, job xp, gold, items), so settling every minute pays the same as settling once. Shifts are simulated in 60 s chunks, so job level-ups raise the yield mid-interval and a full bag stops the run within a minute of output.
- Training XP/h = `(12 + 2*insight + spirit) * 1.5 (dojo)`, insight/spirit including gear, then `xpMultiplier` (talent, sect, master). Ends with a note when the bar is full at a breakthrough stage.
- Shift: `shiftYieldPerHour(job, level, SEASON_YIELD[job][sim.clock().season])`; job xp x1.3 talent, x1.2 origin job bonus (stack). The season at settle time is used for the whole interval.
- Craft: one unit per `recipe.seconds`, `settled` advances by whole units only (remainder stays as progress). Gear rolls `rollRarity(fortune, boost=floor(jobLevel/6))` + `rollAffixes` per piece.
- Refund policy: system ends (cap, bag full, invalid) return every unfinished unit's inputs. A player stop (`astop`, move, fight) also returns every unstarted unit, but forfeits the unit being worked on unless it has run less than 5 s. Refunds that do not fit the bag are lost with a warning note.
- Offline: workers are settled each minute by the server; when the activity ends (8 h cap, bag full, done, xp full) it is cleared, `markMe` makes the core drop the worker, and the summary is stored in table `activity_away` until the next login. On login the player gets `While you were away (7h 59m of work): 52x Grain; 160 gold; ...` and an end-reason note (only if the absence was >= 2 min or the activity ended).

## For other systems

- `interruptActivity(ctx, p, 'combat')` / `getActivities(ctx)?.settle(p)` (exported from `systems/activities`) end or settle an activity. Combat does not need to call it (it already refuses to start fights for busy players, and the 250 ms poll ends activities when `p.combatId` appears).
- The default movement guard "You are busy" was spliced out of `ctx.movement.guards` (this module owns the rule now).

## Known gaps

- Season is the one at settle time (a season change inside a long server downtime is not split).
- A craft refund that finds a full bag is lost (only reachable if the bag filled up after starting).
- `astart` stops a walking player even when the request is then refused.

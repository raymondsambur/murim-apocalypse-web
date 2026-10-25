# Gameplay economy - inventory, shops, NPC menu, missions, nodes

Owner: gameplay-economy. Files: `packages/server/src/systems/{inventory,shops,npcmenu,missions,nodes}.ts` plus the helper `econ.ts`
(shared checks: `requireIdle`, `rateLimit`, `skillBlocker`, `fillLoadout`, `learnSkill`). Tests: `*.test.ts` next to them,
`economy.smoke.test.ts` (real sim), rig in `econ.testkit.ts` (`makeRig()`, `makeRig({ real: true })`).

Rules followed: `docs/GAMEPLAY_SPEC.md` sections 4, 5, 6, 7, 10. Nothing here is persisted outside `p.save` (missions, inventory,
equipment, skills, `buffs`), so there are no tables or migrations.

## What the client sends and gets

Every command is validated against `p.save` and world state; refusals arrive as `{t:'err', code, text}` (queries: `{t:'res', ok:false, err: code, data:{text}}`).
Successful commands give a `note` toast and a fresh `me` (gold, inventory, equipment, skills, loadout, missions all live in `me.c`).
There is no per-command success message, so panels simply re-render from `me`. All commands are refused with `dead` / `in_combat` when they do not make sense.

### Inventory (`inventory.ts`)
| command | notes |
|---|---|
| `equip {idx, id}` | `id` must match the bag stack at `idx`. Needs `tier <= rank` (accessories `tier <= rank + 1`). The old piece takes the bag slot the new one leaves, so a swap never needs room. Keeps `uid`, rarity, affixes. |
| `unequip {slot}` | `weapon \| outfit \| accessory`; needs a free bag slot. |
| `use {idx, id}` | consumables out of combat (heal / qi / antidote), manuals (learn the skill, consumed), cultivation pills (`xp` through `grantXp`, refused when the bar is full at a breakthrough). Breakthrough pills are refused. Nothing is consumed when it would have no effect. Heal amounts are flat, like the combat engine's potions. |
| `drop {idx, id, qty}` | destroys `qty` (integer, 1..stack). |

After equipment changes hp / qi are clamped to the new maxima and the entity's `weapon` is updated.
Errors: `dead`, `in_combat`, `bad_item`, `not_equipment`, `rank_low`, `bad_slot`, `nothing_equipped`, `bag_full`, `cannot_use`, `use_breakthrough`, `no_effect`, `xp_full`, `already_known`, `stats_low`, `bad_skill`, `bad_qty`.
Learning a skill (manual or master) sets `skills[id] = {lv:1, xp:0}` and puts it into the first empty loadout slot of its kind (active / internal / movement) via `sanitizeLoadout`; `fx learn` + a toast.

### Shops, teaching, inns (`shops.ts`)
All of `buy`, `sell`, `learn`, `rest` need: alive, not in combat, the NPC alive with an entity within **6 tiles**, reputation with the NPC's faction **> -70** (`refused`).
`buy` / `sell` are limited to 12 per 2 s per player (`slow_down`).

| command | rules |
|---|---|
| `buy {npc, item, qty}` | qty integer 1..99; item must be in `sim.shopFor(npc).items`. Unit price `ceil(value * 1.15 * sim.priceMult(settlement, item) * repDiscount)`; `repDiscount` 0.9 at rep >= 60, 0.95 at >= 30, 1.1 at <= -30. All or nothing: needs gold and room (`roomFor`). Equipment is bought at rarity 0 (`r:0`, `aff:[]`, fresh `uid`). `sim.recordTrade(..., 'buy')`. |
| `sell {npc, idx, id, qty}` | unit price `floor(stackValue * sellMult * clamp(priceMult, 0.6, 1.5))` (rarity counts for gear). A shop only buys its trade: **general** materials + consumables; **weapons** (smith) gear + `ore_*` + `ingot_*`; **medicine** (alchemist) consumables, `herb*`, `blight_core`, `spirit_dew`; **food** meat, cooked meat, grain, wine. Manuals are not bought. Sell price is always below the buy price (tested for every item). `sim.recordTrade(..., 'sell')`. |
| `learn {npc, skill}` | the NPC must list the skill in `teaches`; not already known; `rank >= req.rank`; base stat minimums; reputation with the NPC's faction `>= 0` (`>= 20` for tier >= 3; independents have no requirement); gold `req.gold`, **x0.8 (ceil) when `save.masterId === -npc.id`**. |
| `rest {npc}` | innkeeper only; price `10 + 3 * level`; full hp / qi and clears injury; refused when nothing needs healing (`not_needed`). |

Errors: `not_found`, `too_far`, `refused`, `bad_qty`, `bad_item`, `no_shop`, `not_sold`, `shop_refuses`, `no_gold`, `bag_full`, `not_taught`, `already_known`, `rank_low`, `stats_low`, `rep_low`, `not_innkeeper`, `not_needed`, `slow_down`.

Exports other modules may use: `buyPrice(ctx, p, npc, itemId)`, `sellPrice(ctx, npc, stack, sellMult)`, `repDiscount(rep)`, `repWith`, `refusesService`, `shopAccepts(shopKind, def)`, `shopEntries`, `learnPrice(p, npc, skill)`, `learnStatus(p, npc, skill)`, `teachEntries`, `restPrice(p)`, constants `SERVICE_RANGE`, `REFUSE_REP`, `MASTER_DISCOUNT`.

### NPC menu (`npcmenu.ts`)
Reaching an NPC (`interact {id}`; the core walks there) sends `{t:'npc', menu}`; `q npc {id}` returns the same object (NPC within 10 tiles, else `too_far`; unknown / dead NPC `not_found`). Re-query after every purchase / lesson to refresh `ok` flags.
```
NpcMenu {
  id, name, role, title, faction, settlementId, look, level,
  greeting,                         // sim.greeting; "<name> turns away from you." when the NPC refuses service
  shop?: { entries: [{id, price, stock:null}], sellMult },   // price = what THIS player pays now (reputation + market)
  teaches?: [{skill, gold, learned, ok, reason?}],            // gold = price for this player; ok=false carries a reason (rank, stats, reputation, gold, already learned)
  turnIns: string[],                // ids of the player's finished missions this NPC can take
  restPrice?: number,               // innkeepers
  disciple?: ...                    // filled by the social module's decorator
}
```
Decorators: `import { npcMenuDecorators } from './npcmenu'` and push `(p, npc, menu) => void`; each runs after the base menu is built, errors are logged and ignored. Also exported: `buildNpcMenu(ctx, p, npc)`.
A hostile NPC (rep <= -70) shows no shop, lessons, rest price or turn-ins.

### Missions (`missions.ts`)
Queries / commands:
| | |
|---|---|
| `q board {settlement}` | `{offers: sim.board(id), settlement: SettlementView}`; player within `radius + 6` tiles of the settlement centre (`too_far`), valid id (`not_found`). |
| `maccept {offer, settlement}` | within `radius + 4` tiles, offer still on that board (`gone`), not already held (`duplicate`), fewer than `MAX_ACTIVE_MISSIONS` (6, `too_many`), `rank >= minRank` (`rank_low`), one bounty at a time (`one_bounty`), then `sim.takeOffer`. Creates `ActiveMission {...offer, progress:0, acceptedDay: clock().day, done:false}` (deep copy). Bounty: spawns the personal target through `getServices(ctx).monsters.spawnBounty(owner, monster, level, elite, settlementId)`; if the service returns `null` the offer goes back and you get `no_target`. |
| `mabandon {id}` | removes the mission, `sim.returnOffer(plain offer)`, removes the bounty target. |
| `mturnin {id, npc?}` | the mission must be done (gather / deliver: the bag is checked, `not_done` says how many are missing); an NPC of role `elder / guard / master / merchant` (or the offer's `giverId`) of the **giving settlement** (deliver: `target.toSettlement`) within 6 tiles (`no_taker`); gather / deliver goods are consumed. Rewards: xp via `grantXp`, gold, reputation (clamped -100..100), items via `addItem`. **Atomic**: a full bag refuses with `bag_full` and changes nothing. Then `completedMissions++`, `ctx.fanOut(sim.recordMissionDone(offer, name))` (the world effect is applied by the sim; nothing else is purified), `missionCompleted` event, removal. |

Server -> client: `{t:'mission', update: ActiveMission}` on every progress / done change (and on accept, and when the bag changes a gather / deliver counter). **A finished hand-in, an abandon and an expiry send no `mission` message: the mission is simply absent from the next `me.c.missions`.**
Progress rules (all from `monsterKilled` unless noted; only credited killers):
* hunt: `defId === target.monster` (or `family` when no monster); bounty targets of anyone do not count.
* purify: `family === 'blight'` and the kill within `target.radius` tiles of `(x, y)`.
* defend: `ev.siege === mission.settlementId` and that settlement is still besieged.
* bounty: `ev.bountyFor === p.charId` (and the right species).
* investigate: polled every second, within `target.radius` (default 2) of `(x, y)`.
* gather / deliver: polled every second (and on NPC menu / hand-in): `progress = min(count, items in bag)`, `done` follows the bag. The player carries deliver goods himself (no parcel is handed out, so there is nothing to exploit).
Expiry: on every world hour, on login and before hand-in checks, unfinished missions with `expires <= clock().day` are removed with a `warn` toast (same rule as the board: the offer is gone on that day); a bounty target is removed with them. Bounty targets are removed on logout and respawned on login, and respawned every 29 minutes (the monsters service drops them after 30).

Exports: `offerOf(mission)`, `turnInSettlement`, `canTurnInAt(mission, npc)`, `refreshCollect(ctx, p)`, `turnInsFor(ctx, p, npc)`, constants (`BOARD_RANGE`, `ACCEPT_RANGE`, `TURNIN_RANGE`, `TURNIN_ROLES`, `POLL_MS`, `BOUNTY_REFRESH_MS`).
Errors: `dead`, `in_combat`, `not_found`, `too_far`, `gone`, `duplicate`, `too_many`, `rank_low`, `one_bounty`, `no_target`, `not_done`, `no_taker`, `bag_full`.

### Nodes and shrines (`nodes.ts`)
* Boot: one `kind:'node'` entity per `world.nodes` entry (`nodeKind`, `sprite` herb / ore / shrine / heart, names "Qi-Gathering Grass", "Hundred-Year Ginseng", "Iron Vein", "Wayside Shrine", "Blight Heart"). Hearts are only entities: `onInteract('node')` returns `false` for them so the combat module can claim them. Entity `data` key `'node'` (`NODE`): `{defId, kind, ax, ay, terrain, busyWith}`.
* Gather (herb, rareHerb, ore): the core walks next to the node, then a 3 s gather starts: `entity.state = 'work'`, facing the node. Messages: toasts only (start is visible as `state:'work'` in `ents`; the finish sends `fx gather` near the node + a toast with what was found). Cancelled by `stop`, by any `move` / `interact` that goes through the movement guards, by a fight, death or logout (`interrupted` toast). One gatherer per node. Rare herbs need Herbalist level 3. A completely full bag refuses at the start; a bag that fills up meanwhile keeps what fits and warns.
* Yield (`rollGather`, pure): herb 1-3 `herb`; rareHerb 1 `herb_rare`; ore 1-3 `ore_iron` + 10% `ore_silver`; +1 per 5 job levels and a fortune chance (`fortune/200`, max 50%) of +1 on the main item. Job XP via `applyJobXp` (herb 5, rare 18, ore 6 + 10 for silver; x1.3 matching talent, x1.2 matching origin). Emits `nodeGathered {player, kind, x, y}`.
* Depletion: the entity is removed and a new one appears **120-300 s later** within 8 tiles of the original spot on the same terrain, away from settlements and other nodes (new entity id).
* Shrines: heal 50% of max hp and qi, blessing `buffs.bless_blight` for 10 min (`hasBuff(save, 'bless_blight', now)`; nothing reads it yet, see known gaps), `sim.purify(x, y, 6, 30)` through `ctx.fanOut`, `fx purify` at the shrine. Cooldown per player per shrine: `buffs['shrine:<nodeDefId>']` (10 min); during cooldown a toast says when it returns.

## Decisions worth knowing
* Handlers invoked from `onInteract` cannot throw `GameError` to the player (the core logs it), so node / shrine / NPC interactions use toasts.
* The `stop` command is **overridden** (`ctx.command('stop', ..., {override:true})` in nodes.ts, first in the system order) so it also cancels a gather; it otherwise behaves exactly like the core one. A later module that overrides `stop` again loses that (movement via the guard still cancels).
* A guard pushed on `ctx.movement.guards` cancels the gather when the player starts moving; it never refuses.
* `onPlayerSync` keeps the entity in `work` while gathering (the core would flatten it to `idle` on every `markMe`).
* Deliver missions: goods must be in the bag at hand-in; nothing is handed out on accept.
* Defend progress stops counting when the siege is over; the offer's own `expires` ends the mission.
* Bandit reputation (+1 / -1 per kill) is the combat module's job, not done here.

## Additive edits outside my files
* `ctx.ts`: `GameContext.fanOut(events: readonly SimEvent[]): void`.
* `game/context.ts`: `Game.fanOutExtra`, an optional third parameter `hourly = true` on `Game.fanOut` (skips the `time` broadcast; `onHour` handlers and the `hour` event only run for batches containing `siege / heart / board / npc* / weather / newDay / newSeason`), and the `fanOut` entry in `buildContext`. The combat module still has its own `publishSimEvents` copy; it can switch to `ctx.fanOut`.

## Known gaps
* A gather / deliver counter in `me` can lag up to 1 s behind the bag (the poll interval); the NPC menu and hand-in refresh immediately.
* Missions of a fallen settlement cannot be handed in (no living NPCs there); they run out at `expires`.
* Rate limiting covers `buy` / `sell` only (the gateway already caps all traffic).
* `packages/server/src/integration.test.ts` (server-core's) still expects the `board` query and the `alloc` command to answer `not_implemented`; they are implemented now, so that test needs updating by its owner.
* The shrine blessing is stored but no module applies its +10% damage vs Blight yet (combat would need to read `buffs.bless_blight`).
* Nodes are not persisted (they all exist again after a restart); node respawn timers use `ctx.after`.

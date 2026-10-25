# Gameplay: monsters, combat, progression

Owner: gameplay-combat. Files: `systems/monsters.ts` (+ `monsters/state.ts`), `systems/combat.ts` (+ `combat/{api,constants,rewards,simfx,testing}.ts`), `systems/progression.ts`. Spec: `GAMEPLAY_SPEC.md` sections 1-3. Tests: `monsters.test.ts`, `combat.test.ts`, `progression.test.ts`, `combat.smoke.test.ts` (real sim).

All damage math is the shared engine (`stepBeat`, `buildPlayerCombatant`, `buildMonsterCombatant`). The server uses only `ctx.rng` / `ctx.now()`.

## What happens, in order (client view)

1. **Monsters** are ordinary `monster` entities (`sprite`, `lv`, `hp`/`maxHp`, `elite` 0/1/2, `name`, `face`, `state`). They idle/wander near home, notice a player within their aggro radius, chase (`state:'walk'`) and engage.
2. **Fight start** (aggro, or the player `interact`s with a monster): both sides get `state:'fight'` and `combatId` (entity field, and `me.combatId`); the player's movement is locked. The client immediately receives `{t:'combat', c, ev:[]}` with `c.beat === 0`.
3. **Every second** each participant gets `{t:'combat', c: CombatView, ev: CombatEvent[]}`. People within 28 tiles who are not in the fight get `{t:'cfx', ev}` (floating text only).
4. **End**: each participant gets `{t:'cend', id, result, reward?, text}` once. Also look at `me` (hp, qi, inventory, xp, level) which is refreshed every beat.

### `combat` message

- `c.fighters[]`: `{id, name, side, lv, hp, maxHp, qi, maxQi, status[], player, alive, fled}`. **`id` is the entity id** of the fighter, so `ents` data (position, sprite) can be joined with it. Side 0 = players, side 1 = monsters (or the second duellist). Dead fighters stay in the list with `alive:false`; fighters that escaped have `fled:true`. A player joining with `assist` triggers an immediate `combat` message to everyone in the fight.
- `c.x,c.y`: tile of the fight (for the camera / spectators). `c.beat`: beat counter. `c.duel`: friendly duel (copies of the fighters: the HP bars are the copies', real HP is untouched).
- `ev`: the engine's `CombatEvent`s of that beat, in order (`hit` with `s`=source id, `d`=target id, `a`=amount, `c`=1 on crit, `sk`=skill id; `miss`; `heal`; `status`; `dot`; `use`; `item`; `guard`; `flee {ok}`; `stun`; `down`). The events of the final beat arrive in a normal `combat` message *before* `cend`.
- A player that has died, fled or left stops receiving `combat` (they got their `cend` already).

### `cend` message

| `result` | meaning | extra |
|---|---|---|
| `win` | all enemies down (PvE) or you won the duel | `reward {xp, gold, items[]}`: `xp` is what you really received (talent / sect / disciple multipliers included); items are stacks that fit in the bag (equipment has no `uid` yet, look in `me.c.inventory`). A duel win has `reward.gold = stake won`, xp 0. |
| `lose` | you died (sent immediately, even if allies keep fighting) or you lost a duel | text mentions the gold lost |
| `fled` | you broke away (flee command, flee tactic, or a duel forfeit does `lose` instead) | movement stays locked for 2 s |
| `draw` | duel ended evenly, the fight hit the 300-beat cap, or it was aborted | |

`text` is a ready-to-show one-liner. Level-ups, skill-ups and the death notification come as `fx` / `note` messages.

### Other messages produced here

- `fx {kind:'death', entity}` to everyone within 28 tiles when a player falls. `fx {kind:'loot', entity}` to the winner when items dropped. `fx {kind:'levelup'}` / `{kind:'breakthrough', text}` for progression.
- `note` levels: `good` (level / skill-up, breakthrough), `bad` (death, failed breakthrough), `warn` (refusals that are not errors, e.g. a full bag lost loot), `info`.
- `chron`, `settle`, `blight` broadcasts for the events returned by `sim.recordKill` / `sim.damageHeart` (same shapes as the hourly fan-out).

### Death and respawn

Player HP <= 0 in a PvE fight: `state:'dead'` (entity), `me.c.hp === 0`, `cend lose`, `fx death`, -10% carried gold, `deaths++`, `injuryStacks = min(3, stacks+1)` for 10 minutes (stats -8% per stack, see `deriveForCharacter`). **After 8 s** the player is teleported to the spawn of `save.lastTown`, `state:'idle'`, 30% HP and Qi, with a note. While dead: `move` fails with `cannot_move` ("You are dead..."), `assist`/`flee`/`alloc`/`build`/`breakthrough` fail with `dead`, NPCs and monsters answer with a note. Logging out while dead respawns first (the save is never stored dead).

Other modules should treat `p.entity.state === 'dead'` (or `getCombatApi(ctx)?.isDead(p)`) as "cannot act", and `p.combatId !== null` as "in a fight".

### Fleeing and assisting

- `flee`: asks the engine to try fleeing at the player's next action (up to 3 beats). Success sends `cend fled`, locks movement for 2 s, and monsters ignore that player for 6 s (`fleeImmuneMs`) so they can get away. In a duel `flee` forfeits (`cend lose` / `win`). The same engine roll is used by the tactic `{act:{k:'flee'}}`.
- `assist {combat}`: join a non-duel fight if you are alive, idle (no activity), within 8 tiles of `c.x,c.y` and the fight has < 5 players. Errors: `dead`, `not_found`, `duel`, `in_combat`, `cannot_assist` (full / too far; the reason is also a `note`). Interacting with a monster that is already in a fight joins that fight the same way.

### Rewards (per monster killed, per player alive at the end with >= 10% of the damage dealt to it)

XP = `monsterStats.xp` x `clamp(1 + 0.1*(mLv - pLv), 0.1, 1.6)` (x0.05 if the monster is >= 10 levels weaker; extra x for bounty "elite" boosts), gold within the monster's range, loot per entry with `chance x (1 + fortune/200)`, 6% equipment (x2 elite, x4 boss) of tier `ceil(lv/8)`, 1.5% manual (x3 elite). Full bag: extra loot is lost with a warning note. `save.kills++`; bandit kills +1 reputation with the controller of the nearest settlement and -1 with `blackwind`. Skill proficiency is granted every beat for each skill use (`learnRate`, x1.5 for the talent's `fastSchools`) with a note on skill level-ups. Potions used by tactics are removed from the bag as they are drunk.

## Progression commands

| Command | Rules | Error codes |
|---|---|---|
| `alloc {stat,n}` | integer `n` > 0, <= `statPoints`; not while fighting/dead | `bad_stat`, `bad_amount`, `no_points`, `in_combat`, `dead` |
| `build {loadout,stance,tactics}` | every named skill learned and in a slot of its kind (actives only in active slots, no duplicates, no more slots than the rank gives); stance one of 4; <= 6 tactic rules; conditions in range (`hpBelow` etc. integer 0-100, `enemiesAtLeast` 1-20); `skill` actions must be in the (new) loadout; `item` actions must be a combat consumable (not a breakthrough pill). The save gets deep copies. Not while fighting. | `bad_build`, `in_combat`, `dead` |
| `breakthrough` | stage-9 level, full XP bar, the rank's pill, the gold, rank < 5. Roll `breakthroughChance(rank, spirit, insight)` (gear included). Success: level+1, XP 0, `statPoints += 7`, HP/Qi full, loadout grows to the new slot count and auto-fills new slots, `fx breakthrough`, `playerLevelUp` event, chronicle line (`sim.record`, importance 2 or 3) when the new rank is >= 3. Failure: -30% of the bar, injury +1 stack for 30 min, half HP, gold always spent, pill consumed unless a 30% roll saves it. | `no_breakthrough`, `xp_not_full`, `no_pill`, `no_gold`, `in_combat`, `dead` |

Normal level-ups (kill XP, missions, training) go through `lib.grantXp` (not changed).

## Events and services

- `monsterKilled` (declared in `events.ts`, emitted by combat): `killers` = players with >= 10% damage share who were alive at the end, sorted by share; `entityId`, `defId`, `family`, `level`, `elite`, `x`, `y`, `spawnId` (pack monsters), `siege` (settlement id), `bountyFor` (charId) or `heartId`. Emitted before the corpse is hidden. It is emitted only for monsters killed by a winning party (not for monsters that died in a lost fight).
- `playerDied {player}` when a player's HP reaches 0 in PvE (never in duels). `playerLevelUp {player,from,to}` also for breakthroughs.
- `getServices(ctx).combat`: `startDuel(a, b, stake)` (false and a `note` if either is dead / fighting / busy or the stake cannot be covered by both; both are copies at full HP/Qi without items; ends when a fighter is at <= 15% HP; the winner takes `min(stake, loser.gold)`; no XP, no death) and `inCombat(p)`.
- `getServices(ctx).monsters`: `spawnBounty(owner, defId, level, elite, settlementId)` (personal target 15-30 tiles from the settlement centre on reachable land outside safe zones; only the owner is hunted by it and can start the fight, others may still assist; despawns after 30 min or on `removeBounty`; replacing an owner's previous target) and `removeBounty(charId)`.
- Internal APIs for tests and tools: `getMonsterApi(ctx)` (`spawn`, `kill`, `release`, `despawn`, `mates`, `think`, `checkPacks`, `checkSieges`, `population`, `lastThinkCount`, ...) and `getCombatApi(ctx)` (`startFight`, `view`, `beat`, `activeCount`, `isDead`, `respawnNow`). `register(ctx, {population:false})` in `monsters.ts` skips the world population (used by the tests). `combat/testing.ts` has `makeScene`, `powerUp`, `tickUntil`, `nearSpot`.

## Monster rules implemented

- **Packs**: one pack per `world.spawnPoints[i]` (`packSize` members within radius 3, never inside a safe zone = settlement radius + 2; fallen settlements have none). Level `levelForDanger` (+`floor(blight/40)` for blight packs), species `pickSpecies`, one elite (12%) when danger >= 5, packy species repeat 60% of the time. Blight packs exist only while `sim.blightAt >= 25`. A wiped pack respawns after `min(300, 60 + danger*8)` s if nobody is within 12 tiles. Corpses stay visible 3 s (`state:'dead'`), then are hidden (pack monsters) or removed (siege / bounty / boss monsters).
- **AI** (every 500 ms, only monsters within 30 tiles of an online player plus those chasing / walking home): aggro radius `def.aggro` (x0.5 in fog, x1.2 for beasts at night 20:00-05:00), targets that are online, alive, idle (no activity), not in a fight, not in a safe zone and not recently fled; chase with `movement.approach` at ~0.9x speed; give up after 14 tiles from home or 12 s without getting closer; walk home and heal to full. Pathing per think is capped (14 paths, 8 wanders).
- **Sieges**: while `siegeUntil > clock.totalHours` the settlement has `clamp(round(siegeStrength/5), 3, 14)` siege monsters on a ring 8-14 tiles outside the settlement radius (family `blight`, or `bandit` for faction raids; level from the nearest spawn points' danger, +blight bonus). Topped up by 3 per 10 s cycle as they die, removed when the siege ends (after the fight if they are fighting). Reconciled at boot, on `siege` hour events and every 10 s.
- **Blight hearts**: `interact` with a node whose `nodeKind==='heart'` (matched to `sim.state.hearts` by x,y): sealed/dormant -> note; otherwise the Blight Lord (`MONSTERS.lord`, level `30 + floor(strength/5)`, `elite:2`) is summoned if none is alive and the fight starts (or you join it). Killing it calls `sim.damageHeart(heart.id, 60, killerName)`; the Lord can be summoned again 30 minutes later (and only while the heart is active). An unattended Lord (10 min with no player near, or heart sealed) vanishes.

## Tuning knobs

`MONSTER_TUNING` (`monsters/state.ts`), `COMBAT_TUNING` (`combat/constants.ts`) and `PROGRESSION_TUNING` (`progression.ts`) hold every number above (radii, timers, caps, drop rates, penalties). They are plain `as const` objects; change a value and the tests that mention it.

## Entity / player data keys

- `MONSTER` DataKey (`'monster'`) on monster entities: `defId, level, elite, spawnId, siege, bountyFor, heartId, homeX/homeY, wanderRadius, mode ('idle'|'chase'|'return'|'fight'|'dead'), targetChar, expiresAt, ephemeral, despawnWhenFree, ...`. Never sent to clients.
- `p.data`: `fleeLockUntil`, `fleeImmuneUntil`, `respawnOff` (cancel function), `regenMarkedHp`, `btFull` (set by `lib.grantXp`).
- Movement guards pushed: dead players, and the 2 s flee lock (the core's in-combat guard is untouched).

## Decisions and known gaps

- Players with a running activity (train / shift / craft) are not aggro targets and cannot start fights ("Stop what you are doing first"): the activities module owns settling, combat does not touch `save.activity`.
- Players in a safe zone are never attacked by monsters (siege monsters included); they can still attack monsters standing next to the zone.
- Potions in the bag are used only through tactics (`item` rules); the default tactic drinks a Minor Healing Pill at 35% HP. Other modules must not heal `save.hp` during a fight (it is overwritten every beat).
- A player who died before the end of a won fight gets no rewards; a duel logout forfeits (with the stake).
- Monster state is not persisted: a restart re-populates the world and sieges are reconciled from the sim.
- Passive internal / movement arts do not gain proficiency (only active skill uses do).
- `integration.test.ts` (server-core) asserts that `alloc` answers `not_implemented`; that is now implemented here, so that expectation needs another still-unimplemented command.

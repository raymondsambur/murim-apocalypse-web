# NPC memory, gossip and rule-based talk

Owner: npc-life-memory. No AI model anywhere: everything an NPC knows, remembers and says comes from systemic code plus
handwritten, recombinable text (tags + slots + weights), the way Dwarf Fortress, RimWorld and Stardew do it.

```
packages/shared/src/data/dialogue/   pure, testable dialogue library + selector (also used by the client mock)
  types.ts      vocabulary (roles, traits, states, standings, deeds, rumor kinds, slots), DlgInput, buildFragments/g()
  compose.ts    composeLine(): filter by tags, score by specificity, seeded pick, anti-repeat, slot fill, glue
  greet.ts town.ts(town+folk) me.ts blight.ts work.ts news.ts rumors.ts frames.ts   the fragments
  library.ts    ALL_FRAGMENTS + libraryStats()
packages/server/src/npcmemory/       memory, rumors, talk (server side)
  tuning.ts     every constant (NPCMEM, RUMOR)
  memory.ts     MemoryStore: town + personal memory, decay, standing, pruning, persistence
  parse.ts      chronicle text -> structured rumor facts
  rumors.ts     RumorMill: creation, spread, distortion, expiry, persistence (pure, takes a SpreadEnv)
  env.ts        SpreadEnv built from the live game (roads, Blight, status, NPC rosters)
  talk.ts       builds the composer input from the game; greeting + topic answers
  index.ts      getNpcMemory(ctx) API
packages/server/src/systems/npcmemory.ts   the system: event wiring, NPC menu decorator, `npcTalk` query
scripts/npc-talk-demo.ts                   prints sample conversations (npx tsx --tsconfig packages/server/tsconfig.json scripts/npc-talk-demo.ts [seed])
```

## What a player sees

* The NPC dialog greeting is composed (`menu.greeting`), reacting to role, traits, weather, time of day, season, the
  settlement's situation (siege, famine, plague, festival, Blight, prosperity), the town's **standing** of the player and
  remembered deeds ("You're the one who cleared the bandits from our roads..."). It is stable within a world hour.
* `NpcMenu.standing` (`unknown | noted | welcomed | honoured | feared | despised`) is a chip in the dialog header and
  `NpcMenu.talk = { topics, mood, traits }` adds a **Talk** tab (last tab; the only tab for plain villagers) with
  topic buttons (Any news? / How is the town? / Who lives here? / What do you think of me? / About the Blight / About
  your work) and a scrolling log of the answers. `mood` ("gruff, weary") is the subtle line under the NPC's title.
* Query `npcTalk { id, topic } -> { lines: string[] }`. `news` returns up to two rumors the NPC knows (best first, a
  rumor is not told to the same player by the same NPC again for 72 world hours), or small talk when it knows none.
  Errors: `not_found`, `too_far` (same range as the `npc` query), `bad_topic`. NPCs that refuse service just turn away.

## Dialogue library

**1153 fragments** at the time of writing (`libraryStats()`): greet 291, town 74, folk 38, me 79, blight 80, work 112,
news (small talk) 106, rumor clauses 109, rumor hedges 41, rumor reactions 37, openers 104, closers 82. Voices: guard, merchant,
smith, alchemist, innkeeper, master, elder, physician, legend, wanderer, villager; 12 traits; role x trait archetypes
(gruff guard, gossipy innkeeper, scholarly elder, greedy merchant, devout physician, weary farmer...).

How a line is made (`composeLine`):

1. Body pool = fragments of the topic. A fragment is **eligible** when every tag dimension it declares matches the situation
   (role, trait (any of the NPC's), weather, time, season, settlement state (any), player standing, mood, remembered deed,
   rumor kind, about:self/other, hedge level) **and every `{slot}` it uses is filled**. Undeclared dimensions match anything.
2. Score = sum of the dimension weights it matched (`DLG_DIM_SCORE`: rumor 5, deed 4, role/state 3, trait/standing 2.5,
   weather 2, time/season/mood 1.5); pick with the seeded RNG, weight `(0.3 + score)^1.7 * w`. Specific lines win, generic
   ones fill in.
3. Anti-repeat: callers pass `recent` (fragment id -> world hour) and call `noteUsed`; fragments used within 36 hours are
   skipped unless nothing else is left (never silent).
4. Optionally an opener (30%) and a closer (25%) with the same tone (`warm`/`curt`/`grim`, inferred from trait, standing
   or state), picked only mildly by specificity. `[a|b|c]` inside a text picks one alternative.
5. Rumors: `hedge` (truth > .72 sure, > .42 "I heard", else "I wouldn't swear to it") wraps a `rumor` body clause for the
   rumor kind (clauses start lowercase / with a slot), plus an optional reaction by the teller's trait or the rumor kind.
   About the player themself the clauses say "you" (`about: 'self'`).
6. Final text: slots filled, whitespace tidied, sentence starts capitalised.

Slots: `{player} {npc} {title} {settlement} {kind} {faction} {controller} {weather} {season} {time} {rank} {deed} {ago}
{trade} {price} {elder} {smith} {innkeeper} {master} {merchant} {alchemist} {guards} {folk}` and, inside rumors,
`{rumor.place} {rumor.place2} {rumor.who} {rumor.faction} {rumor.faction2} {rumor.n} {rumor.deed} {rumor.age} {body}` (hedges).
`{deed}` is picked per candidate from the strongest remembered deed that the fragment's `deed` tag names
(`DEED_PHRASE`, "you ..." past tense); the roster slots never name the speaker.

### Adding content

* **A line:** append a string to the right `g({tags}, 'text', ...)` group in `greet.ts`/`town.ts`/... (append at the end of
  the list to keep positional ids stable). Tags: `role trait weather time season state standing mood deed rumor hedge about
  tone w`; values are a single word or a list. The tests fail on unknown slots/tags.
* **A tag value** (new trait, state, deed...): add it to the vocabulary in `types.ts`, set it in `server/npcmemory/talk.ts`
  (`settlementStates`, `moodsOf`...) and add lines using it. Coverage tests demand at least 3 eligible lines for every
  topic x role x trait, >= 6 greet and work lines per role, >= 12 lines per trait, >= 2 clauses per rumor kind.
* **A topic:** add it to `DLG_TOPICS` and `TALK_TOPICS` (label), write its fragments with `buildFragments('topic', 'body', 'x', groups)`
  and add them to `library.ts`. `talkLines` handles it generically (only `news` is special).
* **A rumor kind:** add to `DLG_RUMOR_KINDS`, write >= 2 clauses in `rumors.ts` and a rule in `parse.ts`
  (and an `ESCALATE`/`SOFTEN` entry in `rumors.ts` if its outcome can be blown up or played down).
* **A slot:** add to `DLG_SLOTS`, fill it in `talk.ts` (`settlementSlots` / `rumorSlots`).

## Memory of the player

Facts, never free text: `{subject: charId, kind, place: settlementId, magnitude, atWorldHour, weight}`, stored aggregated
per (place x player x kind) for **towns** (`nm_town`) and (npc x player x kind) for **individuals** (`nm_personal`,
only for NPCs who interacted personally: talks, and the giver of a completed mission). Weight decays exponentially
(half-life per kind, 10-80 days) and is decayed lazily; `magnitude` accumulates (never decays, drives rumor milestones).
Kinds (`KIND_DEFS` in `memory.ts`): killedBandits, killedHollows, savedTown, deliveredGoods, completedMission, failedMission,
duelWon, duelLost, sectFounded, rankUp, gift, insult, purified, sealedHeart, diedNearby (+ `talked` for personal visit counts).
Each has a valence (good / bad / fear / neutral), a unit weight and a cap (`weightFor` is sub-linear: ten kills are not ten times one kill).

**Standing** (`standingOf` on the decayed sums good G, bad B, fear F): `unknown` below presence 1; `feared` when F >= 4.5 and F > 0.8 G and F >= B;
`despised` when B >= 3.5 and B > 1.1 G; else by net G - B: >= 13 `honoured`, >= 5 `welcomed`, else `noted`. A player is forgiven by time.

Sources wired (`systems/npcmemory.ts`): `monsterKilled` (bandit / blight family within the settlement radius + 24 tiles, siege wave kills
count 1.5x; elites more), siege end (>= 3 weighted siege kills and the town stands -> `savedTown`), `missionCompleted` (by type: deliver ->
deliveredGoods at the destination, purify -> purified, defend -> savedTown, else completedMission; personal for the giver),
`playerLevelUp` (rank-ups only), `playerDied` (diedNearby, no rumor), the chronicle line "sealed by NAME" (sealedHeart), NPC menu opens (personal visit count, one per 2 hours).
Bounded: rows with decayed weight < 0.04 are pruned daily; hard caps 3000 town rows / 5000 personal rows (weakest dropped first); flushed to SQLite every 15 s and each world hour.

### API (`getNpcMemory(ctx)`, undefined when the module is not registered)

```ts
mem.remember({ charId, kind, place, magnitude?, npcId? })   // towns/NPCs remember; crossing a milestone starts a rumor about the deed
mem.townStanding(settlementId, charId)                      // DlgStanding
mem.townStandingDetail(settlementId, charId)                // { standing, renown, sums }
mem.recall(npcId, charId)                                   // { talks, lastHour, deeds[], familiarity }
mem.greeting(player, npc) / mem.talk(player, npc, topic)    // composed text
mem.store (MemoryStore) / mem.mill (RumorMill) / mem.env    // for tests and tools
```
Other systems can feed `gift`, `insult`, `sectFounded`, `duelWon/Lost`, `failedMission` through `remember` (no events exist for them yet).

## Rumors and gossip

`Rumor = { id, topic: chronicle|player|local, kind, importance 1..3, subjectIds, originSettlement, bornHour, expiresHour, truth, spread, facts, known: {settlementId: {since, truth, facts, hops, npcs[]}}, flights[] }`.
`facts` is structured (`kind, place, place2, who, faction, faction2, n, deed, sev`); each settlement holds its own (possibly distorted) version and the list of its NPCs
who know it. Persisted as JSON rows in `nm_rumor` (id counter in `nm_meta`).

* **Creation** (`parse.ts` mirrors the sim's phrasing): sieges (faction / Hollow), held, fell, captured, plundered, retaken, uprising, famine(+end), plague(+end),
  festival, boom, hard times, refugees, heart sealed/wounded/stirs, Blight advance/recede, expedition lost, roads blocked / caravans, war / truce / alliance,
  legend rise / seen, new master, NPC death, and player deeds the sim wrote down. Importance-1 lines become rumors with probability 0.45. Weather and seasons never do.
  Notable player deeds (milestones in `NPCMEM.rumorMilestones`) create a `player` rumor with the player as subject; duplicates (same key within 36 h) are dropped.
  The origin's witnesses are 2-4 NPCs (gossips first). A fallen origin sends its news with the survivors to the nearest living neighbour.
* **Hourly spread** (`stepHour`, once per world hour from `onHour`): (1) messengers arriving; (2) one more NPC in a settlement hears it, chance
  `inTownRate x gossip` (gossipy/cheerful/boastful/innkeepers/wanderers more; stern/gruff/masters/legends less, `gossipiness`); (3) after `holdHours`, a settlement sends a messenger down each
  open road with chance `travelRate x gossip`; arrival after `distance / tilesPerHour` hours (jitter 0.8-1.35). Roads are **blocked** when an end has fallen or the mean Blight along the road
  >= 42 (same threshold as the caravans), **perilous** when an end is besieged (rate x0.25, delay x2). A messenger that finds the road closed on arrival waits 12 h up to 3 times, then gives up.
  Hop limits by importance: minor 1, notable 3, world-shaking unlimited. `npcChat {a, b, settlementId}` (emitted by npc-life-routines) shares each rumor one of them knows with the other (40%).
* **Distortion** (`distortFacts`, per hop, by the teller's traits): every hop costs 0.04 truth; with probability 0.35 (x more for boastful/cheerful/superstitious, x less for honest/scholarly) it also garbles
  one detail: numbers inflate (boastful...) or shrink (weary, stern, kind), `sev` shifts, the **outcome flips** at +-2 (siege -> captured, Hollow siege -> fell, fell -> Hollow siege...), a name turns vague, a faction is mixed up,
  costing 0.07-0.15 more truth (0.2 more for a flipped outcome). Variants below truth 0.08 are dropped. Hedges in speech follow `truth`.
* **Fading:** lifespan 5 / 14 / 40 days by importance (+-15-20%); at most 96 rumors, the least interesting dropped first.

## Tuning constants

`server/src/npcmemory/tuning.ts`: `NPCMEM` (half-life default, prune line, row caps, standing thresholds, talk cooldown, kill radius, rumor milestones) and `RUMOR` (cap, lifespans, hop limits, minor chance,
tilesPerHour 1.8, jitter, holdHours 3, travelRate 0.16, besiegedRate/Delay, blightRoad 42, retry, inTownRate 0.5, truth losses, distortChance 0.35, chatShare 0.4, maxKnowers 24, tellCooldown 72 h).
Per-kind weights, half-lives and caps: `KIND_DEFS` in `memory.ts`. Dialogue scoring: `DLG_DIM_SCORE`, `DLG_DEFAULTS` in `compose.ts`.

## Additive edits outside the owned folders

* `packages/shared/src/index.ts`: `export * from './data/dialogue'`.
* `packages/shared/src/protocol.ts`: `NpcMenu.talk?`, `NpcMenu.standing?`, `Queries.npcTalk`.
* `packages/server/src/net/schemas.ts`: zod entry for the `npcTalk` query.
* `packages/server/src/systems/index.ts`: one import + array entry (`registerNpcMemory`, after npclife).
* `packages/client/src/ui/logic/npc.ts`: `'talk'` tab. `ui/hud/npcDialog.ts`: Talk tab, mood line, standing chip. `i18n/en.app.ts`: `npc.tab.talk`, `npc.talk.*`, `npc.standing.*`, `npc.mood`. `styles/hud.css`: appended block.
* `packages/client/src/net/mockGame.ts`: `?mock=1` support (greeting, talk menu, `npcTalk` answers with the real shared library and a faked situation).
* Tests: `shared/src/data/dialogue/dialogue.test.ts`, `server/src/npcmemory/{memory,rumors}.test.ts`, `server/src/systems/npcmemory.test.ts`, `client/src/ui/logic/talk.test.ts`. Script: `scripts/npc-talk-demo.ts`.
* The decorator is pushed into the module-global `npcMenuDecorators` (removed on shutdown; it ignores players of another context so several test harnesses can coexist).

## Known gaps

* No memory source for purchases/sales (shops emit no event), gifts, insults, duels and sect founding: the `remember` API and kinds are ready, nothing calls them yet.
* Personal memory is only visit counts and mission givers; NPCs do not yet hold grudges or favours individually beyond what the town remembers.
* NPC mood is derived from the settlement state, the hour and traits, not from the routines engineer's activities (`getNpcLife(ctx).activityOf` could feed `moodsOf` in `talk.ts`).
* Chronicle parsing is a pattern table; a new sim phrasing needs a rule in `parse.ts` (unknown lines are silently skipped).
* Anti-repeat state (`recent`, told rumors) lives in memory: it resets on restart (the memory and rumors themselves persist). English only.
* Standing has no mechanical effect (as briefed): greetings, lines and the menu chip only.
* The dialogue is deliberately small-scale per NPC: it selects among ~1150 lines, so a very talkative player will eventually hear repeats (anti-repeat spreads them over 36 hours).

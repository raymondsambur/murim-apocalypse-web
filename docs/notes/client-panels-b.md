# Client panels B: Jobs & Crafting, World, Social

Owner: client-panels-B. Files: `ui/panels/{jobs,world,social}.ts`, CSS `styles/panels/{jobs,world,social}.css`, pure logic `ui/logic/{jobs,world,social,queryCache}.ts` (tests: `ui/logic/panelsB.test.ts`), mock `net/mockPanelsB.ts` (+ small hooks in `net/mockGame.ts`).

## What is built

**Jobs & Crafting (J)**, tabs Work / Sites / Crafting.
- Work: current-activity card (train / shift / craft) with live elapsed time (1 s tick), "ends in" from `since + 8 h`, output estimate (`shiftYieldPerHour` with `SEASON_YIELD` for the current season; training XP/h; craft unit progress bar and ETA computed from `settled`), Stop (`astop`, confirm for crafts because the unit in progress is lost), five job cards (level, XP bar, yield per hour or recipe count), and "Recent reports" taken from `note` messages (away summaries, level-ups, stop notes).
- Sites: nearest settlement from the world payload, `sites` query, per-site distance / in-reach / requirement hints (shift 3 tiles, craft and dojo 6), Start shift / Train here / Craft here, a plain "Meditate" button for the settlement, and "Walk there" (`move` to the site tile).
- Crafting: workshop picker (smithy / alchemy lab of the settlement), `recipes` query (re-fetched when bag, position, jobs or activity change), recipe list with lock / missing hints, inputs vs bag counts for the chosen quantity, quantity stepper capped by bag and by the 8 h window (`maxCraftQty`), Craft button disabled with the server's `reason`.

**World (O)**, tabs Map / Chronicle / Factions / Settlements. Map reuses `gameView.drawMinimap` on a large canvas (click centres the camera; on phones the sheet then closes), legend for you / settlement colour / siege / fallen / Blight / heart / faction colours. Chronicle: store entries (live `chron` appends) plus `chronicle {before, limit}` paging, kind chips, minimum-importance filter, day headers, settlement links that centre the camera. Factions: power / wealth / influence bars, wars and alliances, held settlements (links), goal text, your reputation title from `me.c.reputation`. Settlements: status, controller, prosperity / defense / Blight bars, siege and flag badges (famine, plague, festival), sort selector, "You are here". `world` query is refreshed on open, every minute and when `settlements` change (at most every 20 s).

**Social (F)**, tabs Friends / Sect / Master / Nearby / Ranking.
- Friends: add by name, accept / decline / remove / cancel, online dots, whisper (`ui.chat('/w Name ')`), inspect; the tab badge counts incoming requests.
- Sect: member of a sect: header (level, XP bonus, treasury, motto edit for the leader), invite by name (leader / elder), member list with kick and role select driven by `memberActions`, deposit, leave / disband with confirms. No sect: browse `sects` and ask to join, found form with live validation (name 3-20, tag 2-4 letters) and the rank / gold gate.
- Master: your master (NPC or player) with leave, disciples (teach with skill picker for skills at level >= 3, dismiss), request forms by name (looked up with the `player` query to get the character id).
- Nearby: inspect, whisper, add friend, sect invite, master request (when rank-eligible), duel with a stake modal.
- Ranking: `leaderboard`, self highlighted, names open the inspect dialog.
- Invites (friend / sect / master / duel) stay with the shell's invite cards (`ui/hud/invites.ts`); the id mapping there matches the server (friend/master/duel `id = fromId`, sect `sect = data.sect`).

Mock (`?mock=1`): activities with lazy settling (train / shift / craft, away report notes, refunds), `sites`, `recipes`, friends (incoming request from Moon Lotus), sects (create / join / invite / kick / promote / deposit / motto / leave / disband), masters (NPC and player flow, teach), duel challenge errors, `leaderboard`, `nearbyPlayers`, a 48-entry chronicle (only the last 12 arrive in `hello`, the rest via paging). Debug: `__mock.game.debugWarp(ms)` pretends the running activity has been going on `ms` longer; `debugGive`, `debugGold` as before. To test founding a sect set `__mock.game.save.level = 12` and `debugGold(900)`.

## Mismatches and findings for the lead

1. `nearbyPlayers` returns **character ids** (`o.charId`) but `duel challenge` wants an **entity id**. The client resolves the entity by name (`state.entityByName(name, 'player')`), so duels only work for players currently in the entity table; the server could return `entity` too.
2. `SectView.invites` counts open invites **and join requests**, but there is no query that lists who asked. The leader approves by typing the exact name in `invite`. The panel shows the count and a hint; a `requests: {id,name,level}[]` field would let the UI offer Approve buttons.
3. Invite cards in the shell expire after `INVITE_TTL_MS = 60 s`, while sect and master invites live 5 min on the server and friend requests are permanent (they also show in the Friends tab). Duel invites live 30 s. Consider per-kind TTLs.
4. `Queries.player` by `id` is a **character id** (server `sects.ts`); by name works for offline characters too. The client uses names for inspection, and the `player` query for name -> id lookups.
5. `world` query: `FactionBrief.goal` is free English text from the sim (`'conquer <settlement name>'`, `'seal the Blight heart'`...). Displayed as is (first letter capitalised); not translatable.
6. `leaderboard` (core) is overridden by the sects module to fill `sect`; `sects.ts` sorts nothing client-side, the client sorts by level then kills.
7. Activity: `me.c.activity` only changes at each settle (every 60 s), so the panel extrapolates progress (craft units done, estimates) from `settled` / `since`; numbers can step by a unit after the next settle. `RecipeView.canCraft/reason` is for quantity 1, so the panel re-checks materials for larger quantities locally.
8. `astart` for `train` accepts **any** site id of the settlement (non-dojo requires standing inside the settlement radius); the panel uses the first non-dojo site for the plain "Meditate" button. A dedicated settlement id field would be cleaner.
9. Sect treasury has no withdrawal; the panel says so. Sect XP bonus shown as `2% x level` (client mirror of the server rule).
10. `master request {npc}` has no NPC chooser here: NPC masters are requested from the NPC dialog (existing). The Master tab only explains the requirement (reputation 10 with the faction).

## Known gaps

- No sect chat or join-request approval list (see 2); no sect treasury withdrawal; friend list has no search / note fields.
- Sites tab only knows the settlement you stand in (nearest within radius + 6 tiles); the "Walk there" button sends a plain `move` to the site tile, which can fail when that tile is not walkable (the server text is shown by the shell).
- Visual checks were done in the built-in browser at 1280x720 and 375x812 through DOM inspection and screenshots of World and Social on mobile; the Jobs panel was exercised through DOM text and the mock only (screenshot capture of the pane was flaky).
- Chronicle live-append does not highlight new rows; the Map redraws every 500 ms only while the Map tab is open.

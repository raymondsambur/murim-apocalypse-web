# Status (end of first build session)

Verified at the end of this session: `npm run typecheck` clean, `npm test` 719 tests passing (56 files), `npm run build` succeeds, and the production build was played in a browser against the real server and real simulation.

## What works (seen running)
- Register / login (username + password, scrypt, cookie session), character creation with rolled stats, talents, origin, 3 rerolls and a live appearance preview.
- Isometric procedural world (192x128 tiles, 8 settlements, roads, farms, mines, forests, coast), day/night, seasons, weather, Blight overlay, minimap and world map.
- Click-to-move with server-authoritative pathing; other players, NPCs and monsters visible with name plates; chat (local / world / whisper / sect), speech bubbles.
- NPCs with dialogs (shop, teaching, missions, rest, disciple), shops with price floats, skill learning.
- Auto-battle combat: loadout, stance, tactic rules, flee, assist, loot, XP, level-ups, death and respawn; combat HUD with live log.
- Progression: stats allocation, rank breakthroughs (pills), skills levelling, equipment and inventory.
- Missions generated from live world state (hunt, gather, deliver, purify, defend, bounty, investigate).
- Jobs, training and crafting that continue while offline (8 h cap); idle workers stay visible in towns.
- Living world simulation: weather, Blight spread and heart sealing, factions raiding / allying / warring, settlements besieged and falling, economy and caravans, NPC lives / succession / legends, public chronicle.
- Social: sects, master-disciple (NPC and player), friends, duels.
- Panels: Character, Inventory, Skills & Build, Missions, Jobs & Crafting, World (map, chronicle, factions, settlements), Social, Settings. Desktop and mobile layouts.

## Known gaps / next steps
- **Not play-tested by a human at length.** Only a first fight, a level-up, NPC talk, the Skills and World panels and the mobile HUD were exercised live. Jobs, crafting, sects, duels and missions are covered by automated tests (and the mock server) but deserve a real playthrough, ideally with two browsers.
- No audio, no localisation packs (UI strings are i18n-ready), no admin dashboard, no player market, no sect wars.
- Balance is first-pass (`scripts/balance.ts`): bosses (Blight Lord at the hearts) are untested; high-level blight packs are very deadly; early game is easy.
- Shrine blessing (`bless_blight`) is stored but combat does not read it yet.
- Sect treasury has no use; no join-request approval list (leaders approve by inviting by name); no sect missions or sect chat tab polish.
- Hand-in hint for missions shows the settlement and direction only (no NPC id/tile in `ActiveMission`).
- Item-use tactics are not validated against the bag when saved.
- Pending invites, join requests and duel challenges are in memory only (lost on restart); monsters and resource nodes are not persisted (they respawn on boot); the world simulation is snapshotted every 60 s.
- Renderer: west-facing sprites are mirrors; beasts are side profiles; no diagonal wall corners; a one-frame hitch when teleporting.
- Operations: single Node process and single SQLite connection; before a public launch add HTTPS (reverse proxy), `COOKIE_SECURE=true`, backups of `data/`, rate-limit tuning, moderation tools (mute/ban are in the DB but have no UI) and a privacy/terms page.

## Developer notes
- Per-area handoff notes: `docs/notes/*.md` (server-core, sim, client-shell, client-render, client-panels-a/b, gameplay-*). Town life phase 1 (gate guards, squads, hermitages, beacons): `docs/notes/town-life-phase1.md`.
- Work was split across agents with file ownership; briefs are in `docs/briefs/`.
- The project lives on an exFAT drive: no symlinks, so there are no npm workspaces; `@murim/shared` is a path alias (see `tsconfig.base.json`, `vite.config.ts`, `vitest.config.ts`).
- Dev: `npm run dev` (server :3000 + Vite :5173). The Vite proxy target is `MURIM_SERVER_PORT` (default 3000).
- Soak the world simulation: `npx tsx --tsconfig packages/server/tsconfig.json scripts/sim-soak.ts 90`.
- A previous batch of agent-created test accounts was moved to `data_agent_tests_*` (git-ignored); the active DB is `data/murim.db`.

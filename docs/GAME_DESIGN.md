# Murim Apocalypse — Game Design (web edition)

A persistent, browser-based, isometric 2D wuxia MMO. Players register, receive a randomly rolled martial artist, and live in a shared world that keeps changing whether or not anyone is watching: plague spreads, sects go to war, harvests fail, masters die and legends rise.

Theme: Korean-style *murim* (martial world) colliding with an *apocalypse* — the **Blight**, a spreading corruption that turns the land and the people into "Hollows".

## Decisions from the design interview
| Topic | Decision |
|---|---|
| Delivery | Website only. Nothing to download. Desktop + mobile browsers, English (i18n-ready). |
| Multiplayer | **Hybrid**: everyone shares one live map (see, chat, fight near each other) while training, jobs, crafting and the world simulation run on the server clock, including while you are offline. |
| Control | Click / tap to move. Server-authoritative. |
| Combat | **Auto-battle with your build**: loadout of skills, a stance, and tactic rules. The fight plays out on its own; the build is the skill. |
| Theme | Wuxia + apocalypse. |
| Look | Isometric 2D. All art is generated in code (tiles, buildings, layered characters), so swapping in real art later is a drop-in change. |
| Accounts | Username + password. |
| Stakes | Consensual PvP (duels). PvE death has a cost but is never permanent. |
| Character creation | Choose name + appearance. Stats, talents and birth origin are **rolled** (3 rerolls). No classes: everyone can learn anything. |
| Power frame | Murim ranks, 9 stages per rank. |
| Living world | Blight spread, factions + territory, economy + seasons, NPC lives + legends. |
| Social (v1) | Player sects, master–disciple, chat + friends. (Player trading is *not* in v1.) |
| Play loop | Mix of RimWorld (emergent, simulated world that generates its own events) and MMORPG (quests, grinding, loot, levels). |
| Scale | Designed for a few hundred concurrent players on one server process (SQLite today, storage layer isolated for Postgres later). |
| Scope | Vertical slice first: one continent, 8 settlements, all systems at working depth, then expand. |

## Ranks (power frame)
1 Third-Rate · 2 Second-Rate · 3 First-Rate · 4 Peak · 5 Transcendent · 6 Realm of Fusion · 7 Realm of Mystery · 8 Life-and-Death.
Each rank has stages 1–9 (level 1–72 overall). The slice content cap is Transcendent stage 9 (rank 5); later ranks are visible but sealed.
Stage-ups come from XP; rank-ups need a **Breakthrough**: full XP bar at stage 9, a rank-appropriate Breakthrough Pill (alchemist-crafted), and a Spirit/Insight-based success roll. Failure = qi deviation (injury, lost XP). Stat points: +2 per stage, +5 per rank.

## Stats
Rolled at creation: **Might, Agility, Vitality, Spirit, Insight, Fortune**. Derived: HP, Qi, attack, defense, action speed, crit, dodge, qi regen, learning speed.
Talents (0–2 rolled): e.g. Heavenly Meridians, Iron Bones, Sword Prodigy, Cursed Meridians, Lucky Star.
Origins (rolled): Farmer's Child, Plague Orphan, Merchant's Heir, Fallen Noble, Hunter's Kid, Physician's Apprentice, Disgraced Disciple, Wandering Beggar — each sets hometown flavour, starting items and job affinity.

## Combat (auto-battle)
- Server resolves fights in 1-second beats. Each combatant has an action meter filled by speed.
- **Loadout**: 4 active skill slots (5 at rank 3, 6 at rank 5), 1 internal art, 1 movement art.
- **Stance**: Aggressive / Balanced / Defensive / Evasive.
- **Tactics**: up to 4 ordered rules `IF condition THEN action` (use skill, guard, drink pill, flee).
- Statuses: bleed, poison, stun, guard, blight-rot. Qi is a resource; running dry means basic attacks only.
- Others near a fight can **assist** and join. Monsters group in packs and aggro by proximity.
- Death (PvE): lose 10% carried gold, gain *Injury* (-stats for 10 min), respawn at last town. Duels never kill.

## Skills
~30 martial arts across schools: sword, blade, spear, staff, fist/palm, internal arts, movement arts, medicine, poison. Learned from masters (gold + reputation), manuals (drops), or a master–disciple relationship. Skills level 1–10 through use.
*Purifying Sun Method* style arts matter in the apocalypse: bonus damage vs Hollows and they push the Blight back.

## The Living World (server simulation)
World clock: 1 world hour = 60 real seconds by default (configurable). 24 h day, 30-day seasons, 4 seasons/year.
- **Weather** per climate band (clear, cloud, rain, storm, fog, snow) changing daily, affecting travel, aggro and Blight.
- **Blight**: grid of intensity 0–255. Hearts emit it; it diffuses along land; seasons, rain and settlement defenses modulate it. High Blight spawns stronger Hollows, closes roads, starves towns and can make a settlement **fall**. Players and factions push it back by killing Hollows, purify missions and sealing hearts.
- **Factions** (5 NPC powers): Azure Cloud Sect, Crimson Lotus Cult, Mount Tiger Fist Clan, Jade Merchant Guild, Black Wind Bandits. Daily AI: develop, recruit, fight Blight, raid, ally/war, run caravans. They own settlements, and ownership changes prices, guards and missions.
- **Economy**: each settlement produces/consumes goods by population, season, control and Blight. Prices float with stock. Shortages and famine create missions; caravans move goods unless roads are blighted.
- **NPC lives**: named NPCs age, train, rise in rank, die and get successors. High-rank ones become Legends with titles, bounties and quests.
- **Chronicle**: every notable event is written to a public in-game history feed.

## Progression systems
- **Missions**: generated from live world state (purify, hunt, gather, deliver, defend siege, bounty, investigate, faction work). Rewards: XP, gold, reputation, items, manuals.
- **Jobs**: Herbalist, Miner, Farmer (gathering), Blacksmith, Alchemist (crafting). Job levels unlock recipes. Timed *work shifts*, *training* and *crafting* continue **offline** (8 h cap); others see your character working or meditating in town.
- **Equipment**: weapon, outfit, accessory; rarity-scaled stats and affixes.
- **Reputation** with each faction unlocks masters, shops and missions.

## Social
- **Sects (player-run)**: found (Second-Rate+, 500 gold), roles (Leader/Elder/Disciple/Outer), treasury, sect level + bonus, sect chat, tag over names.
- **Master–disciple**: NPC masters accept disciples (rank + reputation). Players at First-Rate+ may take up to 2 disciples (Second-Rate or lower): XP bonus for the disciple, tribute + legacy for the master, skill teaching.
- **Chat**: local, world, sect, whisper, system. **Friends** list with online status.
- **Duels**: opt-in challenge, auto-battle, no death.

## Technical architecture
- Monorepo, TypeScript throughout: `packages/shared` (rules, data, worldgen, combat math), `packages/server` (Fastify HTTP + `ws` + SQLite via `node:sqlite`), `packages/client` (Vite + Canvas2D renderer + DOM UI).
- Server is authoritative: movement, combat, loot, economy, sim. Clients send intents only. Input validated with Zod; rate limited.
- World terrain is generated deterministically from a seed on the server and sent to clients; dynamic state (Blight, ownership, entities) streams over WebSocket with interest management (only nearby entities).
- Persistence: accounts, characters, sects, relationships, and snapshots of world simulation state. Autosave + save on shutdown.
- Production: `npm run build && npm start` serves the built client and the API from one process behind any HTTPS reverse proxy.

## Out of scope for the slice (planned)
Player market, sect wars/territory, ranks above Transcendent, additional continents, audio, localisation packs, admin dashboard.

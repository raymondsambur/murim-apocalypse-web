# Brief: client-panels-A engineer (Skills & Build, Missions, NPC dialog on the real server)

You are a client UI engineer for "Murim Apocalypse" (browser persistent isometric wuxia MMO). Repo: `D:\Game Built Project\murim-apocalypse-web` (Windows, PowerShell; path has a space - quote it; drive is exFAT). Another UI engineer (panels-B) works in parallel on other panels; you both touch the mock server, so keep mock edits small, additive, in your own new files where possible, and re-read a file right before editing it. Stay on the current git branch; do not commit; do not run `npm install`.

## Read first
1. `docs/GAME_DESIGN.md`  2. `docs/notes/client-shell.md` (**panel framework, widgets, UiContext, how to add a panel, mock server usage**)  3. `docs/notes/gameplay-combat.md` and `docs/notes/gameplay-economy.md` (server message flows and formats)  4. `packages/shared/src/protocol.ts`, and shared rules you display: `data/skills.ts`, `data/items.ts`, `types.ts` (Loadout, TacticRule, Cond, Act, ActiveMission), `ranks.ts` (`activeSlots`), `stats.ts`, `combat.ts` (CombatEvent), `character.ts` (`sanitizeLoadout`).  5. Existing panels `packages/client/src/ui/panels/*` (Character, Inventory) for style.

## You own
`packages/client/src/ui/panels/skills.ts`, `missions.ts` (currently labelled placeholders), their CSS under `src/styles/panels/`, helper logic under `src/ui/logic/`, tests, and your additions to the mock (`src/net/mock*.ts`). Do not edit server or shared code (minimal additive exports only, reported). Do not edit panels owned by panels-B (jobs, world, social).

## Build
1. **Skills & Build panel (hotkey K)**: tabs *Arts* (learned skills grouped by school with level/xp bars, tier badge, glyph icon, tooltip with power/qi/cooldown/effects, internal and movement arts), *Loadout* (active slots count from `activeSlots(rank)`, one internal art slot, one movement slot; pick from learned skills; drag-and-drop on desktop and tap-to-pick on mobile; shows derived stat preview of the passives), *Stance* (four stances with descriptions), *Tactics* (ordered list of up to 6 rules `IF condition THEN action`: friendly editors for each `Cond`/`Act` using only loadout skills and combat consumables in the bag; reorder up/down, add, delete; a plain-English summary line using the existing `describeTactic`; reset to default). Save with `{t:'build', loadout, stance, tactics}` (validate client-side the same way the server does: tactics <= 6, skills in loadout); show server errors via toast; dirty-state indicator with Apply/Revert.
2. **Missions panel (hotkey M)**: *Active* (up to 6, progress bars with `progress/target.count`, type icon, reward preview, time left in world days, Abandon with confirm, "ready to hand in" highlight and where to go (settlement name/tile hint)), *Board* (query `board` for the nearest settlement within range, offers with level/min rank, rewards, Accept; disabled reasons), a *Log* line for completed count. React to `{t:'mission'}` updates and `me.c.missions`.
3. **NPC dialog on the real server**: the dialog exists; make sure it also works with the real `npc` message flows documented in `docs/notes/gameplay-economy.md` (error codes, price fields, teach reasons, turn-ins, rest). Fix mismatches you find.
4. **Mock additions** so all of the above can be exercised with `?mock=1` (extend `mockGame`: board/accept/abandon/turn-in, build validation, skills list).
5. Polish: tooltips, empty states, mobile layout (<= 760 px sheets), keyboard accessibility, i18n strings via `addStrings`.

## Verification
`npx tsc -p packages/client` clean; `npx vitest run packages/client` green (add tests for pure logic: tactic editing, loadout rules, mission progress text); `npx vite build packages/client` ok. Look at the panels in the built-in browser (mcp__Claude_Browser__*) in your **own new tab** (never touch other tabs; if unavailable rely on tests): `npx vite packages/client --port 5203 --strictPort`, open `http://localhost:5203/?mock=1`; test desktop and mobile sizes; stop your server and close your tab when done.

## Report
What you built, deviations/mismatches found between client and server docs (list them precisely for the lead), known gaps. Add a section to `docs/notes/client-shell.md` or write `docs/notes/client-panels-a.md`.

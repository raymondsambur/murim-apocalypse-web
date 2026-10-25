# Brief: sprites-v2 engineer (more detail, more life, and gear you can see)

You are the **client-render** engineer for "Murim Apocalypse" (browser persistent isometric wuxia MMO). Repo: `D:\Game Built Project\murim-apocalypse-web` (Windows, PowerShell; path has a space - quote it; drive is exFAT). Stay on the current git branch; do not commit; do not run `npm install`. You own `packages/client/src/art/**` and `packages/client/src/render/**` (and their tests, and the sandbox). Do not edit server code; shared edits only if truly necessary (minimal, additive, reported).

## Why
The user looked at the characters in the live game and wants them **more detailed and alive**: "add more into the pixels and the animations ... so that it feels alive". They also asked that **equipped gear changes how a character looks** (equipping a new robe must change the sprite). The data path for gear is done (see below); the art is yours.

## Read first
`docs/notes/client-render.md` (structure, how to add sprites, palettes, perf notes), `packages/client/src/art/character.ts` (the paper-doll), `art/beasts.ts`, `art/palette.ts`, `art/pixel.ts`, `render/sprites.ts` (sprite bank + LRU), `render/entities.ts`, `render/view.ts`, `render/fx.ts`, `render/overlay.ts`, `packages/shared/src/protocol.ts` (`EntityView.gear`), `packages/shared/src/types.ts` (`GearLook`, `Look`, `LOOK_RANGES`, `WeaponType`), `packages/shared/src/data/items.ts` (item names/tiers) and `data/monsters.ts` (sprite keys).

## New data you can use: `EntityView.gear`
`gear?: { w?: {t,r}; o?: {t,r}; a?: {k: StatKey, t, r} }` - weapon, outfit and accessory **tier (1-5)** and **rarity (0-4: common, fine, rare, epic, legendary)**; `a.k` is the attribute the accessory boosts (might, agility, vitality, spirit, insight, fortune). It is sent for players only (NPCs may be given tiers by `role` on the client). Rarity colours: `RARITY_COLORS` in shared.

## Goals

### 1. Gear is visible
- **Outfit tier** changes the garment: tier 1 plain/patched hemp, 2 leather trim and sash fittings, 3 embroidered cloud robe with trim and collar, 4 silk battle robe with layered panels and shoulder pieces, 5 immortal garment with flowing outer layers and ornaments. The player's chosen outfit colour stays the base colour so characters stay individual; tier adds structure, trim colours and shading.
- **Outfit rarity** adds finishing touches: fine = subtle trim shine, rare = coloured piping/embroidery, epic = faint animated shimmer, legendary = a soft animated aura/glow in the rarity colour and drifting particles (cheap).
- **Weapon tier/rarity** changes the weapon sprite (steel blade vs iron, guard shapes, tassels, glow for rare+, trailing sparks for legendary). Keep the existing weapon types (sword, blade, spear, staff, fist wraps -> gauntlets at higher tiers).
- **Accessory** shows as a small visible item chosen by `a.k` (jade pendant for spirit, bone charm for vitality, iron ring/bracer for might, silk sash tails for agility, lucky coin on a cord for fortune, scholar's seal/tassel for insight), tier adds gems/metal.
- The character-creation preview and other previews (`drawLookPreview`) accept an optional `gear` so the UI can show gear later (extend `LookPreviewOptions` additively; update `render/api.ts` additively and document it).

### 2. More pixel detail
- Increase effective sprite resolution and shading quality for people (e.g. a larger base canvas than the current ~24x40, or a 2x finer pixel grid) with: proper 3-4 tone shading per material with a consistent light direction, an ink-dark outline with selective outlining (sel-out), readable face (eyes, brows, nose hint, mouth), hands and feet, folds and seams in cloth, hair strands and highlights, belt/sash detail, weapon grips. Differences between male/female silhouettes, 7 hair styles and 4 outfit cuts must stay (and look better). Keep sprites crisp (nearest-neighbour) and keep the existing sprite scale conventions or update `render/*` consistently so name plates, shadows, picking bounds and HP bars still line up.
- Monsters and beasts get the same treatment (more fur/scale texture, readable eyes, better silhouettes), NPC role props (guard armour and spear, merchant hat and abacus/pack, master robe and sash, legend aura) and Blight creatures (more unsettling, violet corruption drips, glowing eyes).

### 3. Feels alive (animation and micro-behaviour)
- **Idle**: breathing (chest/shoulder bob), periodic blinking, head tilt, small weight shifts, sleeves/sash/hair swaying with subtle wind (stronger in storms), occasional looking toward nearby entities (small head turn), fidget variants per entity (seeded so crowds don't move in sync).
- **Walk**: 6-8 frame cycle with proper contact/passing poses, arm swing opposite the legs, body bob, robe hem and sash trailing with a one-frame delay, dust puffs at footfalls on dirt/sand, small splashes in shallow water, snow prints in winter; **run** variant when a character is moving fast (flee, chase).
- **Combat**: stance transition when a fight starts (draw weapon), 3-4 distinct attack animations per weapon type (slash, thrust, overhead, spinning/palm strike), wind-up and follow-through with smear/trail frames matching the weapon colour, hit reactions on the victim (flinch, knockback offset, brief white flash), block/dodge sidestep on misses, victory pose, death animation (collapse then fade) instead of an instant swap, crit emphasis (screen shake is optional and small).
- **Activities**: work (hammer swing at a smithy, hoe/sickle at farms, pickaxe at mines, herb picking crouch), meditate with a slowly pulsing qi aura and floating motes that grow with rank, craft (stirring at a cauldron with steam).
- **Ambient NPC life** (client-side only, purely visual, driven by role and a seeded timer while the entity is idle): villagers sweep, chat in pairs (small speech-bubble icons, no text), look around, stretch; guards stand at attention and occasionally scan; merchants fan themselves/arrange goods; innkeepers wipe a counter; masters practise a form. Beasts: sniff, flick ears/tail, graze, stretch; blight creatures twitch and shamble unevenly. Make sure these never look like they conflict with the server state (no walking away; only in-place animation).
- **Emotes on events** (using existing `fx` hooks where possible): level-up cheer pose, loot pick-up crouch, heal glow.
- Keep CPU in check: sprite frames are cached (bounded LRU), animation is frame-indexed (no per-frame allocation), crowd of ~60 entities must stay >= 55 fps at 1280x720 (measure in the sandbox with `zoom=1` and `zoom=0.5`; report numbers). Respect `prefers-reduced-motion` (reduce sway/particles, no flashes).

### 4. Sandbox support
Extend `packages/client/sandbox.html` / `src/sandbox.ts` with controls to preview gear: pick outfit tier (1-5), rarity (0-4), weapon type/tier/rarity, accessory attribute/tier, state (idle, walk, run, each attack, hit, die, meditate, work, craft), direction, and an "animation gallery" mode that shows one character large with all frames. Add a "crowd" toggle for performance testing.

## Verification
- `npx tsc -p packages/client` clean, `npx vitest run packages/client` green (add tests for gear -> appearance mapping, sprite cache keys including gear/state/frame, determinism of per-entity fidgets, palette lengths).
- **Look at it** in the built-in browser (mcp__Claude_Browser__*) in your **own new tab**: `npx vite packages/client --port 5201 --strictPort` then `http://localhost:5201/sandbox.html`. Take screenshots of: each outfit tier, rarity auras, each weapon, the walk and attack animations (zoomed in on the animation gallery), a village crowd, a fight, the Blight creatures. Iterate until it looks clearly better than before, and describe before/after in your report. If the browser is unavailable rely on tests and node dumps of frames.
- Stop your dev server and close your tab when done.

## Report
What changed visually (before/after), the gear mapping table (what each tier/rarity looks like), the animation list, performance numbers, API additions, known gaps. Update `docs/notes/client-render.md`.

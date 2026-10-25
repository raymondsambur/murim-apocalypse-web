# Brief: world-scale engineer (make sizes believable)

You are the client-render engineer for "Murim Apocalypse" (browser persistent isometric wuxia MMO). Repo: `D:\Game Built Project\murim-apocalypse-web` (Windows, PowerShell; path has a space - quote it; drive is exFAT). Stay on the current git branch; do not commit; do not run `npm install`. You own `packages/client/src/art/**` and `packages/client/src/render/**` (+ tests, sandbox). Another engineer works on `packages/client/src/ui/**` (English-only UI) in parallel - do not edit UI files.

## The user's complaint (verbatim)
"The size of the characters and buildings and trees is not the proper size, how come a human is as tall as a building and a wall, it doesn't make sense."

They are right. Characters were recently made bigger and more detailed (about 64x80 paint canvas, feet anchor ~32,70 in scene pixels, where one scene pixel = 2 world pixels and a tile is 64x32 world px), and now a person stands about as tall as a house wall and a fort wall, and trees/boulders look tiny next to people.

## Target proportions (the contract)
Measure the real current sizes first (sandbox screenshots + code constants), then fix so these hold at every zoom:
- A **standing adult** is roughly **1 tile wide tall in screen terms or a bit less** (about 50-60 world px tall including hair/hat, i.e. ~25-30 scene px), NOT ~2 tiles.
- A **house door** is about 1.2-1.3x the height of a person; the **eave/wall top** of a normal house is about 2x a person; a **two-storey inn / hall** about 3x; a **pagoda** 5-8x; **fort walls** about 2.5-3x a person (so soldiers on the ground clearly look smaller than the wall), **watch towers** ~4x.
- **Trees**: pine/oak 3-4x a person, bamboo 3-4x, bushes about knee-to-waist (0.4-0.6x), boulders 0.5-1x, reeds ~0.8x, flowers tiny. **Beasts**: boar/wolf about hip-high (0.5-0.6x person), bear ~0.9x long and ~0.8x tall, tiger ~0.8x, snake low; blight lord/boss about 1.6-2x a person (clearly big but not building-sized); elites 1.15-1.25x.
- Farm crops/hedges/fences knee-high; stalls waist-to-head; shrine gate (torii) ~1.8x person; stone lanterns ~0.8x person; wells ~0.6x.
- Keep the tile grid, camera, picking math and world logic unchanged. Do not change `TILE_W/TILE_H` or building footprints (tile counts) in `shared`.

## Approach (suggested, you decide)
- The cleanest fix is to **shrink characters/beasts/NPC props** to the target height AND **raise buildings, walls, trees and tall props** where they come out too low (e.g. taller walls, roofs and tree crowns), so the ratio is right without making people unreadably tiny. People can stay a little larger than strict realism (readability), but never taller than a house wall.
- Keep sprites crisp: regenerate people and beasts at the smaller target size with the same paint code if it supports a size parameter (preferred, keep the shading/outline detail legible: at ~28-34 scene px tall you must simplify tiny details like accessory trinkets so they stay readable - reduce number of tones where needed, 1px outline, 2-3 px eyes), rather than blurring a big sprite. Gear differences (outfit tier trim, rarity glow, weapon tiers, accessories) must remain visible at the new size (exaggerate them slightly, e.g. a 2 px gold collar, a bright 1-2 px trinket).
- Keep name plates, HP bars, shadows, speech bubbles, selection rings, picking/hit boxes, floating combat text, fx anchors, minimap dots and the move-target marker aligned to the new sizes (they key off head-top/bounds; verify).
- Animations (walk/attack/etc.) must keep working after the resize; weapon sizes scale with the person (a sword ~0.5-0.6x person length, spear ~1.3x, staff ~1.1x).
- Doors: buildings' door tiles/entrances should look like a person can walk through them (door height ~1.2-1.3x person).
- Sprite-cache keys and LRU sizes still valid; performance must not regress (report numbers at zoom 1 and 0.5 with the crowd toggle in the sandbox).

## Verification (visual, required)
Use the built-in browser in your **own new tab**: `npx vite packages/client --port 5201 --strictPort`, open `http://localhost:5201/sandbox.html?panel=0&tp=0&zoom=1`. Add a **"scale reference" toggle** to the sandbox: draws a person next to a house, an inn, a fort wall section, a tower, a pagoda, trees, a boulder, a boar, a bear, a tiger and a blight lord on a flat strip with a 1-tile grid, so proportions can be judged at a glance. Take screenshots (before and after) at: the start village plaza, a fort wall with guards, a forest, the fallen capital with Blight creatures, and a combat. Describe the measured heights (px) of person, door, house eave, wall, tree before/after in your report, and iterate until it looks right to a normal player. Also check the game's own client path still works (`npx vite build packages/client`).
- `npx tsc -p packages/client` clean, `npx vitest run packages/client` green (update tests that pin sprite sizes; add a test that pins the proportion ratios from a single table of target heights so they cannot drift).

## Report
Before/after heights table, what you changed (files), any trade-offs (details simplified), performance numbers, known gaps. Update `docs/notes/client-render.md` with a "Scale and proportions" section (the target table and where it lives in code).

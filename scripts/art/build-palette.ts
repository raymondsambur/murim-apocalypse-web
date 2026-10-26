/**
 * Derive the sprite-import palette from the art the game really paints: every generator in packages/client/src/art is sampled
 * (props, vegetation in all seasons, beasts, characters, buildings, walls and the sect props) and the opaque colours are reduced
 * to a fixed number with a weighted median cut (see spriteimport.ts). Writes packages/client/src/assets/palette.json.
 * Run: npx tsx scripts/art/build-palette.ts [size]
 */
import { writeFileSync } from 'node:fs';
import { O } from '@murim/shared';
import { genBeast, BEAST_KEYS } from '../../packages/client/src/art/beasts';
import { genObject, VARIANTS } from '../../packages/client/src/art/flora';
import * as P from '../../packages/client/src/art/props';
import { referenceItems } from '../../packages/client/src/art/scaleRef';
import { SECT_ASSETS } from '../../packages/client/src/art/sectprops';
import { GOLD, GOLD_DARK, INK, INK_SOFT, LACQUER, LACQUER_DARK, PARCHMENT, STONE, TIMBER } from '../../packages/client/src/art/palette';
import { countColours, derivePalette, paletteToHex, type ColourCounts } from '../../packages/client/src/art/spriteimport';

const size = Number(process.argv[2] ?? 96);
const counts: ColourCounts = new Map();
const note = (label: string, px: Uint32Array): void => {
  const before = counts.size;
  countColours(px, counts);
  console.log(label.padEnd(22), `+${counts.size - before} colours (total ${counts.size})`);
};

for (const item of referenceItems()) for (const p of item.parts) note(`ref ${item.name}`, p.pb.px);
for (const name of ['barrel', 'crate', 'haystack', 'anvil', 'cauldron', 'weaponRack', 'trainingDummy', 'stoneLantern', 'well', 'sack', 'haybale', 'urn', 'bushSmall', 'herbRack'] as const) {
  const p = (P[name] as () => P.Prop)();
  note(`prop ${name}`, p.pb.px);
}
note('prop flag', P.flag('#a8302a').pb.px);
for (const code of Object.values(O)) {
  if (typeof code !== 'number') continue;
  for (let v = 0; v < VARIANTS; v++)
    for (const season of [0, 1, 2, 3]) {
      const g = genObject(code, v, season, 0);
      if (g) countColours(g.pb.px, counts);
    }
}
console.log('flora (all variants, seasons)'.padEnd(22), `total ${counts.size}`);
for (const k of BEAST_KEYS) note(`beast ${k}`, genBeast({ key: k, state: 'idle', dir: 0, frame: 0 }).pb.px);
for (const a of SECT_ASSETS) for (const d of [0, 1, 3] as const) countColours(a.make(d, 0).pb.px, counts);
console.log('sect props'.padEnd(22), `total ${counts.size}`);

const pal = derivePalette(counts, size, [INK, INK_SOFT, LACQUER, LACQUER_DARK, GOLD, GOLD_DARK, TIMBER, STONE, PARCHMENT]);
writeFileSync(new URL('../../packages/client/src/assets/palette.json', import.meta.url), JSON.stringify(paletteToHex(pal)) + '\n');
console.log(`palette: ${pal.length} colours from ${counts.size} distinct source colours`);

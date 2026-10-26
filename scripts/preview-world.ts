import { generateWorld, settlementsConnected } from '../packages/shared/src/worldgen';
import { O, T } from '../packages/shared/src/terrain';

if (process.argv[2] === 'sweep') {
  const from = Number(process.argv[3] ?? 1);
  const to = Number(process.argv[4] ?? 30);
  for (let s = from; s <= to; s++) {
    try {
      const t = performance.now();
      const w = generateWorld(s);
      const total = w.w * w.h;
      let water = 0;
      for (const v of w.terrain) if (v === T.DeepWater || v === T.Water) water++;
      const bps = w.settlements.map((x) => x.buildingIds.length).join('/');
      console.log(`seed ${String(s).padStart(3)}: ${(performance.now() - t).toFixed(0).padStart(4)}ms land=${(((total - water) / total) * 100).toFixed(0)}% settlements=${w.settlements.length} bld=${bps} roads=${w.roads.length} spawns=${w.spawnPoints.length} nodes=${w.nodes.length} connected=${settlementsConnected(w)}`);
    } catch (e) {
      console.log(`seed ${s}: ERROR ${(e as Error).message}`);
    }
  }
  process.exit(0);
}

if (process.argv[2] === 'crop') {
  const [seedArg, cxArg, cyArg, wArg, hArg] = process.argv.slice(3).map(Number);
  const wd = generateWorld(seedArg);
  const CHR: Record<number, string> = {
    [T.DeepWater]: '~', [T.Water]: '-', [T.Grass]: '.', [T.Plains]: ',', [T.Forest]: 'f', [T.Dirt]: '=', [T.Road]: '#',
    [T.Plaza]: 'P', [T.Rock]: 'M', [T.Hill]: 'h', [T.Sand]: 's', [T.Snow]: '*', [T.Bridge]: 'B', [T.Farm]: '"', [T.Ruin]: 'x',
  };
  const lines: string[] = [];
  for (let y = cyArg; y < cyArg + hArg; y++) {
    let line = '';
    for (let x = cxArg; x < cxArg + wArg; x++) {
      if (x < 0 || y < 0 || x >= wd.w || y >= wd.h) { line += ' '; continue; }
      const i = y * wd.w + x;
      const o = wd.objects[i];
      let ch = CHR[wd.terrain[i]] ?? '?';
      if (o === O.Building) {
        const b = wd.buildings.find((bb) => x >= bb.x && x < bb.x + bb.w && y >= bb.y && y < bb.y + bb.d);
        ch = b ? ({ house: 'H', inn: 'I', smithy: 'S', alchemy: 'A', market: 'K', shrine: 'R', pagoda: 'G', hall: 'L', dojo: 'D', farmhouse: 'F', herbHut: 'E', tower: 'O', barracks: 'Q', ruinedHouse: 'X', warehouse: 'V', teahouse: 'C', hermitage: 'M' } as Record<string, string>)[b.kind] ?? 'H' : 'H';
      } else if (o === O.Wall) ch = 'W';
      else if (o === O.Palisade) ch = '|';
      else if (o === O.Fence) ch = ':';
      else if (o === O.Well) ch = 'U';
      else if (o === O.Lantern) ch = 'l';
      else if (o === O.Flowers || o === O.Bush) ch = '*';
      else if (o === O.Pine || o === O.Oak || o === O.Bamboo) ch = 'T';
      else if (o === O.Boulder) ch = 'o';
      lines.push;
      line += ch;
    }
    lines.push(line);
  }
  console.log(lines.join('\n'));
  process.exit(0);
}

const seed = Number(process.argv[2] ?? 1337);
const full = process.argv[3] === 'full';
const t0 = performance.now();
const world = generateWorld(seed);
const ms = performance.now() - t0;

const CH: Record<number, string> = {
  [T.DeepWater]: '~', [T.Water]: '-', [T.Grass]: '.', [T.Plains]: ',', [T.Forest]: 'f', [T.Dirt]: '=', [T.Road]: '#',
  [T.Plaza]: 'P', [T.Rock]: 'M', [T.Hill]: 'h', [T.Sand]: 's', [T.Snow]: '*', [T.Bridge]: 'B', [T.Farm]: '"', [T.Ruin]: 'x',
};

const step = full ? 1 : 2;
const rows: string[] = [];
for (let y = 0; y < world.h; y += step) {
  let line = '';
  for (let x = 0; x < world.w; x += step) {
    const i = y * world.w + x;
    let ch = CH[world.terrain[i]] ?? '?';
    const o = world.objects[i];
    if (o === O.Building) ch = 'H';
    else if (o === O.Wall) ch = 'W';
    else if (full && (o === O.Pine || o === O.Oak || o === O.Bamboo)) ch = 'T';
    line += ch;
  }
  rows.push(line);
}
for (const s of world.settlements) {
  const r = Math.floor(s.y / step);
  const cidx = Math.floor(s.x / step);
  const label = String(s.id);
  rows[r] = rows[r].slice(0, cidx) + label + rows[r].slice(cidx + label.length);
}
for (const n of world.nodes) {
  if (n.kind === 'heart') {
    const r = Math.floor(n.y / step);
    const cidx = Math.floor(n.x / step);
    rows[r] = rows[r].slice(0, cidx) + '@' + rows[r].slice(cidx + 1);
  }
}
for (const sp of world.spawnPoints) {
  const r = Math.floor(sp.y / step);
  const cidx = Math.floor(sp.x / step);
  rows[r] = rows[r].slice(0, cidx) + (sp.family === 'beast' ? 'b' : sp.family === 'bandit' ? 'k' : 'z') + rows[r].slice(cidx + 1);
}
console.log(rows.join('\n'));

const counts: Record<number, number> = {};
for (const t of world.terrain) counts[t] = (counts[t] ?? 0) + 1;
const total = world.w * world.h;
const land = total - (counts[T.DeepWater] ?? 0) - (counts[T.Water] ?? 0);
console.log(`\nseed=${seed} gen=${ms.toFixed(0)}ms land=${((land / total) * 100).toFixed(1)}% rock=${(((counts[T.Rock] ?? 0) / total) * 100).toFixed(1)}% hill=${(((counts[T.Hill] ?? 0) / total) * 100).toFixed(1)}% forest=${(((counts[T.Forest] ?? 0) / total) * 100).toFixed(1)}%`);
console.log(`settlements=${world.settlements.length} buildings=${world.buildings.length} roads=${world.roads.length} spawns=${world.spawnPoints.length} nodes=${world.nodes.length} connected=${settlementsConnected(world)}`);
for (const s of world.settlements) console.log(` #${s.id} ${s.kind.padEnd(8)} ${s.name.padEnd(24)} (${s.x},${s.y}) buildings=${s.buildingIds.length} sites=${s.sites.map((x) => x.kind).join(',')}`);

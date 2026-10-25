/**
 * Soak-test the world simulation with no players.
 *
 *   npx tsx --tsconfig packages/server/tsconfig.json scripts/sim-soak.ts [days=60] [seed=1337] [--every=10] [--chron=30] [--quiet]
 *
 * Prints a timeline, the chronicle (counts + excerpt), settlement statuses, the faction table,
 * Blight coverage, prices, the NPC roster summary and the sim's internal counters.
 */
import { FACTIONS, GOODS, generateWorld, type SimEvent } from '@murim/shared';
import { createSim } from '../packages/server/src/sim/index';
import type { SimStateX } from '../packages/server/src/sim/types';

const args = process.argv.slice(2);
const pos = args.filter((a) => !a.startsWith('--'));
const flag = (name: string, def: number): number => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? Number(a.split('=')[1]) : def;
};
const days = Number(pos[0] ?? 60);
const seed = Number(pos[1] ?? 1337);
const every = flag('every', 10);
const chronN = flag('chron', 30);
const quiet = args.includes('--quiet');

const world = generateWorld(seed);
const HOUR_MS = 60000;
const t0 = performance.now();
const sim = createSim(world, { seed, hourMs: HOUR_MS, nowMs: 0 });
const initMs = performance.now() - t0;
const st = sim.state as SimStateX;

let landTiles = 0;
for (let i = 0; i < world.w * world.h; i++) {
  const t = world.terrain[i];
  if (t !== 0 && t !== 1 && t !== 8) landTiles++;
}

function coverage(thr: number): number {
  let n = 0;
  for (let i = 0; i < st.blight.length; i++) if (st.blight[i] >= thr) n++;
  return (n / landTiles) * 100;
}
function blightMean(): number {
  let s = 0;
  for (let i = 0; i < st.blight.length; i++) s += st.blight[i];
  return s / landTiles;
}
const pad = (v: string | number, n: number) => String(v).padEnd(n);
const lpad = (v: string | number, n: number) => String(v).padStart(n);
const short = (id: string | null) => (id ? id.slice(0, 3) : '---');

let maxMs = 0;
let totalMs = 0;
let events = 0;
const evCount: Record<string, number> = {};
const timeline: string[] = [];
const hours = days * 24;
for (let h = 1; h <= hours; h++) {
  const a = performance.now();
  const ev: SimEvent[] = sim.advanceHours(1, h * HOUR_MS);
  const d = performance.now() - a;
  totalMs += d;
  if (d > maxMs) maxMs = d;
  events += ev.length;
  for (const e of ev) evCount[e.k] = (evCount[e.k] ?? 0) + 1;
  if (h % (every * 24) === 0 || h === hours) {
    const c = sim.clock();
    const owners = st.settlements.map((s) => `${s.id}:${s.status === 'fallen' ? 'XX' : short(s.controller)}`).join(' ');
    const wars = st.factions.flatMap((f) => f.atWarWith.filter((o) => f.id < o).map((o) => `${short(f.id)}-${short(o)}`)).join(',') || '-';
    const besieged = st.settlements.filter((s) => s.siegeUntil > st.clock.totalHours).length;
    const hearts = st.hearts.map((x) => Math.round(x.strength)).join('/');
    timeline.push(
      `d${lpad(c.day, 4)} s${c.season} blight>=16:${coverage(16).toFixed(1).padStart(5)}% >=64:${coverage(64).toFixed(1).padStart(5)}% mean:${blightMean().toFixed(1).padStart(5)} hearts:${hearts.padEnd(11)} besieged:${besieged} wars:${wars.padEnd(11)} ${owners}`,
    );
  }
}

console.log(`seed=${seed} days=${days} (${hours} hours)  init=${initMs.toFixed(0)}ms  avg=${(totalMs / hours).toFixed(2)}ms/h  max=${maxMs.toFixed(1)}ms/h  events=${events}`);
console.log(`events by kind: ${Object.entries(evCount).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log('\n== Timeline ==');
for (const l of timeline) console.log(l);

const chronicle = st.chronicle;
const byKind: Record<string, number> = {};
const byImp = [0, 0, 0];
for (const e of chronicle) {
  byKind[e.kind] = (byKind[e.kind] ?? 0) + 1;
  byImp[e.importance - 1]++;
}
const firstDay = chronicle.length ? chronicle[0].day : 0;
const span = Math.max(1, sim.clock().day - firstDay + 1);
console.log(`\n== Chronicle == ${chronicle.length} entries kept (ring ${300}), ${(chronicle.length / span).toFixed(1)}/day over last ${span} days; by importance 1/2/3 = ${byImp.join('/')}`);
console.log(`by kind: ${Object.entries(byKind).map(([k, v]) => `${k}=${v}`).join(' ')}`);
if (!quiet) {
  const tail = chronicle.slice(-chronN);
  for (const e of tail) console.log(`  d${lpad(e.day, 4)} ${String(e.hour).padStart(2, '0')}h [${e.importance}] ${e.kind.padEnd(10)} ${e.text}`);
}

console.log('\n== Settlements ==');
console.log(pad('id', 3) + pad('name', 24) + pad('kind', 9) + pad('ctl', 10) + pad('status', 11) + lpad('prosp', 6) + lpad('def', 5) + lpad('pop', 6) + lpad('blight', 7) + '  flags / food-days');
for (const s of st.settlements) {
  const def = world.settlements[s.id];
  const cons = (s.cons.grain ?? 0) + (s.cons.meat ?? 0);
  const fd = cons > 0 ? (((s.stock.grain ?? 0) + (s.stock.meat ?? 0)) / cons).toFixed(1) : '-';
  console.log(pad(s.id, 3) + pad(def.name, 24) + pad(def.kind, 9) + pad(s.controller ?? '-', 10) + pad(s.status, 11) + lpad(s.prosperity.toFixed(0), 6) + lpad(s.defense.toFixed(0), 5) + lpad(Math.round(s.population), 6) + lpad(s.blight.toFixed(0), 7) + `  ${s.flags.join(',') || '-'} / ${fd}`);
}

console.log('\n== Factions ==');
console.log(pad('faction', 11) + lpad('power', 7) + lpad('wealth', 8) + lpad('infl', 6) + '  owned  capital  wars  allies  goal');
for (const f of st.factions) {
  const owned = st.settlements.filter((s) => s.controller === f.id && s.status !== 'fallen').map((s) => s.id);
  console.log(pad(f.id, 11) + lpad(f.power.toFixed(0), 7) + lpad(f.wealth.toFixed(0), 8) + lpad(f.influence.toFixed(0), 6) + `  [${owned.join(',')}]  ${f.capital}  ${f.atWarWith.map(short).join(',') || '-'}  ${f.alliedWith.map(short).join(',') || '-'}  ${f.goal}`);
}
console.log('relations: ' + FACTIONS.flatMap((a, i) => FACTIONS.slice(i + 1).map((b) => `${short(a.id)}-${short(b.id)}=${Math.round(st.factions[i].relations[b.id])}`)).join(' '));

console.log('\n== Blight ==');
console.log(`coverage >=1: ${coverage(1).toFixed(1)}%  >=16: ${coverage(16).toFixed(1)}%  >=64: ${coverage(64).toFixed(1)}%  >=128: ${coverage(128).toFixed(1)}%  mean: ${blightMean().toFixed(1)}  max: ${Math.max(...st.blight)}`);
console.log(`hearts: ${st.hearts.map((h) => `#${h.id} str=${h.strength.toFixed(0)}${h.sealedUntil > st.clock.totalHours ? ' SEALED' : ''}`).join('  ')}`);

console.log('\n== Prices (x base) ==');
const items = [...GOODS, 'o_1', 'w_sword_2', 'pill_heal_m'];
console.log(pad('settlement', 24) + items.map((i) => lpad(i.replace('pill_heal_', 'ph_').replace('ore_iron', 'ore'), 9)).join(''));
for (const s of st.settlements) {
  if (s.status === 'fallen') continue;
  console.log(pad(world.settlements[s.id].name, 24) + items.map((i) => lpad(sim.priceMult(s.id, i).toFixed(2), 9)).join(''));
}

const alive = st.npcs.filter((n) => n.alive);
const roles: Record<string, number> = {};
for (const n of alive) roles[n.role] = (roles[n.role] ?? 0) + 1;
const legends = alive.filter((n) => n.legend);
console.log(`\n== NPCs == alive=${alive.length} dead-kept=${st.npcs.length - alive.length} nextId=${st.nextNpcId}`);
console.log(`roles: ${Object.entries(roles).map(([k, v]) => `${k}=${v}`).join(' ')}`);
console.log(`legends: ${legends.map((l) => `${l.name} "${l.title}" L${l.level}@${l.settlementId}`).join('; ') || '-'}`);
const boards = st.settlements.map((s) => `${s.id}:${(st.boards[s.id] ?? []).length}`).join(' ');
console.log(`boards: ${boards}`);
console.log(`counters: ${Object.entries(st.ext.stats).map(([k, v]) => `${k}=${v}`).join(' ')}`);
const snap = sim.serialize();
console.log(`snapshot: json=${(snap.json.length / 1024).toFixed(0)}KB blight=${(snap.blight.length / 1024).toFixed(0)}KB`);

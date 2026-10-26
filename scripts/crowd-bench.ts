/**
 * Cost of the ambient crowd: runs the real game loop with the real sim and a few players standing in towns, with the
 * crowd switched off and on, and prints the server-side numbers (tick time, entities, path requests, bytes to clients).
 *
 *   npx tsx --tsconfig packages/server/tsconfig.json scripts/crowd-bench.ts [players=1|3|7] [seconds=60] [hour=12]
 */
import { makeLifeHarness } from '../packages/server/src/npclife/testkit';

const players = Number(process.argv[2] ?? 3);
const seconds = Number(process.argv[3] ?? 60);
const hour = Number(process.argv[4] ?? 12);

interface Result {
  label: string;
  entities: number;
  ambient: number;
  tickAvg: number;
  tickMax: number;
  ambientAvg: number;
  ambientMax: number;
  pathsPerSec: number;
  kbPerPlayerSec: number;
  addsPerPlayerSec: number;
  updsPerPlayerSec: number;
}

function run(crowd: boolean): Result {
  const h = makeLifeHarness({ real: true, hourMs: 60_000 });
  h.game.ambient.cap = crowd ? h.game.ambient.cap : 0;
  h.setHour(hour);
  const living = h.ctx.world.settlements.filter((s) => s.kind !== 'ruin');
  // players spread over the biggest settlements first
  const order = [...living].sort((a, b) => b.radius - a.radius);
  const joined = Array.from({ length: players }, (_, i) => h.join(`Bench${i}`, order[i % order.length].spawn));
  let paths = 0;
  const mv = h.game.movement as unknown as { moveTo: (...a: unknown[]) => unknown };
  const orig = mv.moveTo.bind(h.game.movement);
  mv.moveTo = (...a: unknown[]) => {
    paths++;
    return orig(...a);
  };
  // warm up until the crowd has filled in
  h.run(40_000);
  for (const j of joined) j.conn.clear();
  paths = 0;
  const times: number[] = [];
  const t0 = h.clock.t;
  const ticks = Math.round((seconds * 1000) / 100);
  let ambientMs = 0;
  let ambientMax = 0;
  for (let i = 0; i < ticks; i++) {
    h.clock.advance(100);
    const s = performance.now();
    h.game.tick(h.clock.t, 100);
    times.push(performance.now() - s);
    const st = h.game.ambient.stats();
    ambientMs += st.lastMs;
    ambientMax = Math.max(ambientMax, st.lastMs);
  }
  void t0;
  let bytes = 0;
  let adds = 0;
  let upds = 0;
  for (const j of joined) {
    for (const m of j.conn.of('ents')) {
      bytes += JSON.stringify(m).length;
      adds += m.add?.length ?? 0;
      upds += m.upd?.length ?? 0;
    }
  }
  const r: Result = {
    label: crowd ? 'crowd on' : 'crowd off',
    entities: h.game.entities.count(),
    ambient: h.game.ambient.count,
    tickAvg: times.reduce((a, b) => a + b, 0) / times.length,
    tickMax: Math.max(...times),
    ambientAvg: ambientMs / ticks,
    ambientMax,
    pathsPerSec: paths / seconds,
    kbPerPlayerSec: bytes / 1024 / seconds / players,
    addsPerPlayerSec: adds / seconds / players,
    updsPerPlayerSec: upds / seconds / players,
  };
  h.close();
  return r;
}

console.log(`players=${players} seconds=${seconds} hour=${hour}`);
for (const crowd of [false, true]) {
  const r = run(crowd);
  console.log(
    `${r.label.padEnd(10)} entities=${r.entities} (ambient ${r.ambient})  tick avg ${r.tickAvg.toFixed(3)} ms max ${r.tickMax.toFixed(2)} ms  ambient avg ${r.ambientAvg.toFixed(3)} ms max ${r.ambientMax.toFixed(2)} ms  paths ${r.pathsPerSec.toFixed(1)}/s  to each player ${r.kbPerPlayerSec.toFixed(2)} KB/s (${r.addsPerPlayerSec.toFixed(1)} adds, ${r.updsPerPlayerSec.toFixed(1)} upds per s)`,
  );
}

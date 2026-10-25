/**
 * Sandbox "siege demo": a scripted raid on a settlement with fake entities, so the battle visuals (the march in column,
 * the banner, the sortie of the guards, the melee with hit numbers and casualties, the rout or the sack with fires) can be
 * tuned without a server. It mirrors what the server's siege module sends: the same entity fields (`side`, `flag`, `act`)
 * and `cfx` combat events, plus the `siege` stage messages (here `view.setBattle`).
 */
import { FACTIONS, findPath, isPassable, type CombatEvent, type EntityView, type PathGrid, type Rng, type SettlementView, type WorldData } from '@murim/shared';
import type { GameView } from './render/view';

export type DemoOutcome = 'hold' | 'fall';

interface Deps {
  view: GameView;
  wd: WorldData;
  grid: PathGrid;
  rng: Rng;
  settleView: SettlementView[];
  /** Show a line in the sandbox info box. */
  say(text: string): void;
}

type Mode = 'march' | 'form' | 'charge' | 'fight' | 'down' | 'flee' | 'sack' | 'cheer' | 'idle' | 'gone';

interface DemoUnit {
  id: number;
  side: 'raid' | 'def';
  ent: EntityView;
  mode: Mode;
  path: { x: number; y: number }[];
  nextAt: number;
  stepMs: number;
  /** Where the unit is heading once the path is walked. */
  hitAt: number;
  target: DemoUnit | null;
  power: number;
  since: number;
  startAt: number;
}

let running: { stop: () => void } | null = null;

export function stopSiegeDemo(): void {
  running?.stop();
  running = null;
}

const sgn = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
function dirOf(dx: number, dy: number, prev: 0 | 1 | 2 | 3): 0 | 1 | 2 | 3 {
  const sx = Math.sign(dx - dy);
  const sy = Math.sign(dx + dy);
  if (sx === 0 && sy === 0) return prev;
  const prevRight = prev === 0 || prev === 3;
  const prevDown = prev === 0 || prev === 1;
  const right = sx === 0 ? prevRight : sx > 0;
  const down = sy === 0 ? prevDown : sy > 0;
  if (down) return right ? 0 : 1;
  return right ? 3 : 2;
}

export function startSiegeDemo(d: Deps, outcome: DemoOutcome, sid = 0): void {
  stopSiegeDemo();
  const { view, wd, grid, rng } = d;
  const s = wd.settlements[sid];
  const hollow = outcome === 'hold' ? false : false;
  void hollow;
  const faction = 'blackwind';
  // ---- geometry: the gate, the road the party comes down --------------------------------------------------
  const other = wd.roads.map(([a, b]) => (a === sid ? b : b === sid ? a : -1)).filter((x) => x >= 0)[0] ?? (sid === 0 ? 1 : 0);
  const o = wd.settlements[other];
  const ux = o.x - s.x;
  const uy = o.y - s.y;
  const ul = Math.hypot(ux, uy) || 1;
  const near = (x: number, y: number, r = 5): { x: number; y: number } => {
    for (let k = 0; k < 80; k++) {
      const px = Math.round(x + rng.float(-r, r) * (k / 80 + 0.2));
      const py = Math.round(y + rng.float(-r, r) * (k / 80 + 0.2));
      if (isPassable(wd, px, py) && wd.objects[py * wd.w + px] === 0) return { x: px, y: py };
    }
    return { x: s.spawn.x, y: s.spawn.y };
  };
  const used = new Set<number>();
  const uniq = (p: { x: number; y: number }): { x: number; y: number } => {
    for (let r = 0; r < 4; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dy = -r; dy <= r; dy++) {
          const q = { x: p.x + dx, y: p.y + dy };
          const key = q.y * wd.w + q.x;
          if (!used.has(key) && isPassable(wd, q.x, q.y)) {
            used.add(key);
            return q;
          }
        }
      }
    }
    return p;
  };
  const gate = near(s.x + (ux / ul) * s.radius * 0.85, s.y + (uy / ul) * s.radius * 0.85, 3);
  const route = findPath(grid, gate.x, gate.y, o.spawn.x, o.spawn.y, 30000) ?? [];
  let leadI = route.length - 1;
  for (let i = 0; i < route.length; i++) {
    if (Math.hypot(route[i].x - gate.x, route[i].y - gate.y) >= 30) {
      leadI = i;
      break;
    }
  }
  const colTop = Math.min(route.length - 1, leadI + 22);
  const col = route.slice(0, colTop + 1).reverse(); // far end first, gate last
  const lineIdx = Math.max(0, col.findIndex((p) => Math.hypot(p.x - gate.x, p.y - gate.y) <= 11));
  const dirIn = (() => {
    const l = col[lineIdx] ?? gate;
    const dx = gate.x - l.x;
    const dy = gate.y - l.y;
    const n = Math.hypot(dx, dy) || 1;
    return { x: dx / n, y: dy / n };
  })();

  const lineP = col[lineIdx] ?? gate;
  const lineSlot = (k: number): { x: number; y: number } => {
    const px = -dirIn.y;
    const py = dirIn.x;
    const row = Math.floor(k / 4);
    const c = (k % 4) - 1.5;
    return uniq(near(lineP.x - dirIn.x * row * 1.8 + px * c * 1.8, lineP.y - dirIn.y * row * 1.8 + py * c * 1.8, 1));
  };

  // ---- the town: besieged, camera on the gate -----------------------------------------------------------
  const sv = d.settleView[sid];
  sv.status = 'besieged';
  sv.siege = true;
  view.setSettlements([sv]);
  view.centerOn(gate.x - dirIn.x * 7, gate.y - dirIn.y * 7, true);
  view.setZoom(1);

  // ---- spawn ---------------------------------------------------------------------------------------------
  let nextId = 5000;
  const units: DemoUnit[] = [];
  const add = (v: Omit<EntityView, 'id'>, side: 'raid' | 'def', power: number): DemoUnit => {
    const ent = { ...v, id: nextId++, side } as EntityView;
    view.applyEntities({ add: [ent] });
    const u: DemoUnit = { id: ent.id, side, ent, mode: 'idle', path: [], nextAt: 0, stepMs: 520, hitAt: 0, target: null, power, since: performance.now(), startAt: 0 };
    units.push(u);
    return u;
  };
  const N = 12;
  const raiders: DemoUnit[] = [];
  for (let k = 0; k < N; k++) {
    const i = Math.max(0, Math.round(colTop - leadI - k * 1.5));
    const lead = k === 0;
    const bearer = k === 1;
    const at = col[i] ?? gate;
    const u = add(
      {
        kind: 'monster',
        name: lead ? 'Bandit Chief' : bearer ? 'Bandit Standard-bearer' : k % 4 === 0 ? 'Bandit Swordsman' : 'Bandit Thug',
        sprite: lead ? 'bandit_boss' : 'bandit',
        x: at.x,
        y: at.y,
        face: 0,
        state: 'idle',
        lv: 9 + (lead ? 4 : 0),
        hp: 360,
        maxHp: 360,
        elite: lead ? 1 : 0,
        faction,
        flag: bearer ? 1 : undefined,
      },
      'raid',
      lead ? 1.7 : bearer ? 0.7 : 1,
    );
    u.path = col.slice(i + 1, lineIdx + 1).map((p) => ({ x: p.x, y: p.y }));
    const slot = lineSlot(k);
    const end = u.path[u.path.length - 1] ?? at;
    u.path.push(...(findPath(grid, end.x, end.y, slot.x, slot.y, 600) ?? []).map((p) => ({ x: p.x, y: p.y })));
    u.mode = 'march';
    u.stepMs = 560 + rng.int(-40, 60);
    u.startAt = performance.now() + k * 230;
    raiders.push(u);
  }
  const names = ['Guard Lin', 'Guard Mo', 'Guard Ren', 'Guard Hua', 'Master Chen', 'Farmer Bao', 'Farmer Gu', 'Farmer Han'];
  const defenders: DemoUnit[] = [];
  const plaza = near(s.spawn.x, s.spawn.y, 3);
  for (let k = 0; k < names.length; k++) {
    const mil = k >= 5;
    const mast = k === 4;
    const at = near(plaza.x, plaza.y, 4);
    const u = add(
      {
        kind: 'npc',
        name: names[k],
        x: at.x,
        y: at.y,
        face: 0,
        state: 'idle',
        look: { gender: (k % 2) as 0 | 1, skin: k % 6, hairStyle: k % 7, hairColor: k % 8, outfit: mil ? 0 : 2, outfitColor: k % 10, sashColor: k % 8, accessory: 0 },
        role: mast ? 'master' : mil ? 'villager' : 'guard',
        weapon: mast ? 'sword' : mil ? 'staff' : 'spear',
        gear: mil ? { o: { t: 1, r: 0 }, w: { t: 1, r: 0 } } : undefined,
        lv: 10 + k,
        hp: 220,
        maxHp: 220,
        act: 'patrol',
        flag: k === 0 ? 1 : undefined,
        faction: s.id % 2 ? 'azure' : 'tiger',
      },
      'def',
      mast ? 1.8 : mil ? 0.6 : 1,
    );
    u.mode = 'idle';
    defenders.push(u);
  }
  // defenders hold a line just inside the gate (the open town, not the forest outside)
  const holdP = near(gate.x + dirIn.x * 3.5, gate.y + dirIn.y * 3.5, 1);
  const slotsOf = (n: number): { x: number; y: number }[] => {
    const out: { x: number; y: number }[] = [];
    const px = -dirIn.y;
    const py = dirIn.x;
    for (let k = 0; k < n; k++) {
      const row = Math.floor(k / 4);
      const c = (k % 4) - 1.5;
      out.push(uniq(near(holdP.x - dirIn.x * row * 1.6 + px * c * 1.7, holdP.y - dirIn.y * row * 1.6 + py * c * 1.7, 1)));
    }
    return out;
  };
  const slots = slotsOf(defenders.length);
  const t0 = performance.now();
  const sortie = (): void => {
    defenders.forEach((u, i) => {
      const p = findPath(grid, u.ent.x, u.ent.y, slots[i].x, slots[i].y, 3000) ?? [];
      u.path = p.map((q) => ({ x: q.x, y: q.y }));
      u.stepMs = 270;
      u.mode = 'charge';
      view.applyEntities({ upd: [{ id: u.id, act: undefined }] });
      u.ent.act = undefined;
    });
  };
  view.setBattle({ sid, phase: 'alarm', by: faction, x: gate.x, y: gate.y });
  view.setBattle({ sid, phase: 'march', by: faction, x: gate.x, y: gate.y });
  d.say(`siege demo (${outcome}): the party marches in column, the guards run out to the gate`);
  window.setTimeout(sortie, 1500);
  view.say(defenders[0].id, 'Raiders on the road! To the gate!');
  window.setTimeout(() => view.say(raiders[0].id, 'Break the gates!'), 14000);

  // ---- the script ----------------------------------------------------------------------------------------
  let phase: 'march' | 'melee' | 'finale' = 'march';
  let finaleAt = 0;
  let lastBeat = 0;
  let meleeAt = 0;
  const alive = (u: DemoUnit): boolean => u.mode !== 'down' && u.mode !== 'gone';
  const dist = (a: DemoUnit, b: DemoUnit): number => Math.hypot(a.ent.x - b.ent.x, a.ent.y - b.ent.y);
  const patch = (u: DemoUnit, p: Partial<EntityView>): void => {
    Object.assign(u.ent, p);
    view.applyEntities({ upd: [{ id: u.id, ...p } as never] });
  };

  const stepTo = (u: DemoUnit, tx: number, ty: number, now: number): boolean => {
    // greedy single step (melee approach); true when a step was started
    const e = u.ent;
    if (e.nx !== undefined) return false;
    let dx = sgn(tx - e.x);
    let dy = sgn(ty - e.y);
    const tries: [number, number][] = [
      [dx, dy],
      [dx, 0],
      [0, dy],
      [dx, -dy],
      [-dx, dy],
    ];
    for (const [ax, ay] of tries) {
      if (ax === 0 && ay === 0) continue;
      if (isPassable(wd, e.x + ax, e.y + ay)) {
        dx = ax;
        dy = ay;
        walk(u, e.x + ax, e.y + ay, u.stepMs, now);
        return true;
      }
    }
    return false;
  };
  const walk = (u: DemoUnit, nx: number, ny: number, ms: number, now: number): void => {
    const e = u.ent;
    const face = dirOf(nx - e.x, ny - e.y, e.face);
    view.applyEntities({ upd: [{ id: u.id, x: e.x, y: e.y, nx, ny, step: ms, face, state: 'walk' }] });
    e.nx = nx;
    e.ny = ny;
    e.face = face;
    e.state = 'walk';
    u.nextAt = now + ms;
    window.setTimeout(() => {
      if (!ents.has(u.id)) return;
      e.x = nx;
      e.y = ny;
      e.nx = undefined;
      e.ny = undefined;
    }, ms);
  };
  const ents = new Set(units.map((u) => u.id));
  const settle = (u: DemoUnit, state: EntityView['state'] = 'idle'): void => {
    if (u.ent.nx !== undefined) {
      u.ent.nx = undefined;
      u.ent.ny = undefined;
    }
    view.applyEntities({ upd: [{ id: u.id, x: u.ent.x, y: u.ent.y, nx: u.ent.x, ny: u.ent.y, step: 0, state }] });
    u.ent.state = state;
  };
  const events: CombatEvent[] = [];
  const hit = (a: DemoUnit, b: DemoUnit, now: number): void => {
    const bias = outcome === 'hold' ? 0.8 : -0.8;
    const k = a.side === 'def' ? 1 + 0.9 * bias : 1 - 0.9 * bias;
    if (rng.float(0, 1) > 0.82) {
      events.push({ k: 'miss', s: a.id, d: b.id, sk: 'm_slash' });
    } else {
      const crit = rng.float(0, 1) < 0.08;
      const dmg = Math.max(1, Math.round((b.ent.maxHp ?? 200) * 0.14 * a.power * k * rng.float(0.7, 1.3) * (crit ? 1.6 : 1)));
      b.ent.hp = Math.max(0, (b.ent.hp ?? 0) - dmg);
      events.push({ k: 'hit', s: a.id, d: b.id, a: dmg, c: crit ? 1 : undefined, sk: a.side === 'def' ? 'spear_pierce' : 'm_slash' });
      view.applyEntities({ upd: [{ id: b.id, hp: b.ent.hp }] });
      if ((b.ent.hp ?? 0) <= 0) {
        events.push({ k: 'down', d: b.id });
        b.mode = 'down';
        b.since = now;
        patch(b, { state: 'dead', hp: 0, act: undefined });
        b.ent.nx = undefined;
        window.setTimeout(() => {
          view.applyEntities({ del: [b.id] });
          b.mode = 'gone';
        }, 4200);
      }
    }
    a.hitAt = now + 1050 + rng.int(0, 600);
  };

  const tick = (): void => {
    const now = performance.now();
    // movement along paths
    for (const u of units) {
      if (!alive(u)) continue;
      if ((u.mode === 'march' || u.mode === 'charge' || u.mode === 'flee' || u.mode === 'sack') && now >= u.nextAt && now >= u.startAt) {
        const nxt = u.path.shift();
        if (nxt) walk(u, nxt.x, nxt.y, u.stepMs, now);
        else if (u.ent.nx === undefined) {
          if (u.mode === 'march') {
            u.mode = 'form';
            settle(u);
          } else if (u.mode === 'flee') {
            u.mode = 'gone';
            view.applyEntities({ del: [u.id] });
          } else if (u.mode === 'sack') {
            settle(u);
            const lead = u.ent.flag === 1 || u.ent.elite === 1;
            patch(u, { act: lead ? 'celebrate' : 'loot' });
            u.mode = 'cheer';
          } else if (u.mode === 'charge' && u.side === 'def') {
            u.mode = 'idle';
            settle(u);
            patch(u, { act: 'guard' });
          }
        }
      }
    }
    if (phase === 'march') {
      const lead = Math.min(...raiders.filter(alive).map((u) => Math.hypot(u.ent.x - gate.x, u.ent.y - gate.y)));
      if (lead <= 14 || now - t0 > 45000) {
        phase = 'melee';
        meleeAt = now;
        for (const u of raiders) {
          if (u.mode === 'march' || u.mode === 'form') {
            u.mode = 'charge';
            u.stepMs = 270;
            u.path = [];
            u.startAt = 0;
          }
        }
        for (const u of defenders) if (alive(u)) patch(u, { act: undefined });
        view.setBattle({ sid, phase: 'melee', by: faction, x: gate.x, y: gate.y });
      }
    }
    if (phase === 'melee' || (phase === 'finale' && outcome === 'fall')) {
      for (const u of units) {
        if (!alive(u) || u.mode === 'flee' || u.mode === 'sack' || u.mode === 'cheer' || (u.mode === 'charge' && u.path.length && u.side === 'def' && phase === 'melee' && now - meleeAt < 2500)) continue;
        const foes = units.filter((f) => f.side !== u.side && alive(f) && f.mode !== 'flee' && f.mode !== 'cheer' && (u.side === 'raid' || phase === 'finale' || Math.hypot(f.ent.x - holdP.x, f.ent.y - holdP.y) <= 7));
        if (!foes.length) continue;
        if (!u.target || !alive(u.target) || u.target.mode === 'flee') u.target = foes.sort((a, b) => dist(u, a) - dist(u, b))[0];
        const t = u.target;
        if (dist(u, t) <= 1.9) {
          if (u.ent.state !== 'fight') {
            patch(u, { state: 'fight', face: dirOf(t.ent.x - u.ent.x, t.ent.y - u.ent.y, u.ent.face), act: undefined });
            u.ent.nx = undefined;
          }
          u.mode = 'fight';
          if (now >= u.hitAt) hit(u, t, now);
        } else {
          if (u.ent.state === 'fight') patch(u, { state: 'idle' });
          u.mode = 'charge';
          u.path = [];
          if (now >= u.nextAt) stepTo(u, t.ent.x, t.ent.y, now);
        }
      }
      if (events.length) {
        view.combatEvents(events.splice(0));
      }
    }
    const liveRaiders = raiders.filter(alive);
    const liveDef = defenders.filter(alive);
    if (phase === 'melee') {
      if (outcome === 'hold' && (liveRaiders.length <= 3 || now - meleeAt > 70000)) {
        phase = 'finale';
        finaleAt = now;
        view.setBattle({ sid, phase: 'hold', by: faction, x: gate.x, y: gate.y });
        sv.siege = false;
        sv.status = 'stable';
        view.setSettlements([sv]);
        for (const u of liveRaiders) {
          const back = col[0] ?? gate;
          const p = findPath(grid, u.ent.x, u.ent.y, back.x, back.y, 6000) ?? [];
          u.path = p.map((q) => ({ x: q.x, y: q.y }));
          u.mode = 'flee';
          u.stepMs = 260;
          patch(u, { state: 'idle' });
        }
        for (const u of liveDef) {
          u.mode = 'cheer';
          patch(u, { state: 'idle', act: 'celebrate', hp: u.ent.maxHp });
        }
        view.say(defenders[0].id, 'They are running! We held!');
        d.say('siege demo: the raiders rout, the town cheers');
      } else if (outcome === 'fall' && (liveDef.length <= 1 || now - meleeAt > 70000)) {
        phase = 'finale';
        finaleAt = now;
        view.setBattle({ sid, phase: 'fall', by: faction, x: gate.x, y: gate.y });
        sv.siege = false;
        sv.status = 'fallen';
        view.setSettlements([sv]);
        for (const u of liveDef) {
          const refuge = near(s.x - (ux / ul) * s.radius * 0.8, s.y - (uy / ul) * s.radius * 0.8, 3);
          const p = findPath(grid, u.ent.x, u.ent.y, refuge.x, refuge.y, 6000) ?? [];
          u.path = p.map((q) => ({ x: q.x, y: q.y }));
          u.mode = 'flee';
          u.stepMs = 270;
          patch(u, { state: 'idle', act: undefined });
        }
        let k = 0;
        for (const u of liveRaiders) {
          const spot = near(plaza.x, plaza.y, 4);
          const p = findPath(grid, u.ent.x, u.ent.y, spot.x, spot.y, 6000) ?? [];
          u.path = p.map((q) => ({ x: q.x, y: q.y }));
          u.mode = 'sack';
          u.stepMs = 330;
          u.startAt = now + k++ * 120;
          patch(u, { state: 'idle' });
        }
        view.say(defenders[0].id, 'The gate is breached! Run!');
        d.say('siege demo: the line breaks, the raiders pour in; the town burns');
      }
    }
    if (phase === 'finale' && now - lastBeat > 4000) {
      lastBeat = now;
      view.setBattle({ sid, phase: outcome === 'hold' ? 'hold' : 'fall', by: faction, x: gate.x, y: gate.y });
    }
    if (phase === 'finale' && now - finaleAt > 40000) stop();
  };
  const timer = window.setInterval(tick, 60);
  const stop = (): void => {
    window.clearInterval(timer);
    for (const u of units) if (u.mode !== 'gone') view.applyEntities({ del: [u.id] });
    view.setBattle({ sid, phase: 'end', by: faction, x: gate.x, y: gate.y });
    sv.siege = false;
    sv.status = 'thriving';
    view.setSettlements([sv]);
    running = null;
    d.say('siege demo finished');
  };
  running = { stop };
  void FACTIONS;
}

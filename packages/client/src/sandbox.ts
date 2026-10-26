/**
 * Standalone render sandbox (no server): generates the world locally, spawns fake entities and exposes a control panel.
 * Run: npx vite packages/client --port 5201 --strictPort  ->  http://localhost:5201/sandbox.html
 * URL params: seed, season, hour, weather (clear|cloudy|rain|storm|fog|snow), tp (settlement id), zoom, panel=0, blight=1, crowd=1, townfolk=N.
 */
import {
  FACTIONS,
  Rng,
  STAT_KEYS,
  WEAPON_TYPES,
  ambientLook,
  findPath,
  generateWorld,
  isPassable,
  worldPathGrid,
  type CombatEvent,
  type EntityView,
  type FxKind,
  type GearLook,
  type Look,
  type NpcAct,
  type StatKey,
  type WeaponType,
  type NpcRole,
  type SettlementView,
  type TimeView,
  type WeatherKind,
  type WorldPayload,
} from '@murim/shared';
import type { DecodedWorld } from './render/api';
import { FRAME_COUNTS, type CharState } from './art/anim';
import { ACT_STATE } from './render/life';
import { createGameView, drawLookPreview } from './render/index';
import { referenceItems, type RefItem } from './art/scaleRef';
import { pbToCanvas } from './art/canvas';
import { PERSON_PX } from './art/scale';
import type { GameView } from './render/view';
import { startSiegeDemo, stopSiegeDemo } from './siegedemo';

function encode(bytes: Uint8Array): string {
  let bin = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CH)));
  return btoa(bin);
}

const params = new URLSearchParams(location.search);
const seed = Number(params.get('seed') ?? 1337);
const wd = generateWorld(seed);
const payload: WorldPayload = {
  seed: wd.seed,
  w: wd.w,
  h: wd.h,
  terrain: encode(wd.terrain),
  objects: encode(wd.objects),
  settlements: wd.settlements,
  buildings: wd.buildings,
  nodes: wd.nodes,
  roads: wd.roads,
};
const decoded: DecodedWorld = { payload, terrain: wd.terrain, objects: wd.objects };
const grid = worldPathGrid(wd);
const rng = new Rng(seed * 31 + 7);

const canvas = document.getElementById('game') as HTMLCanvasElement;
const view = createGameView(canvas) as GameView;
(window as unknown as { view: GameView; wd: unknown }).view = view;
(window as unknown as { wd: unknown }).wd = wd;
view.loadWorld(decoded);

const state = {
  hours: Number(params.get('hour') ?? 11),
  season: Number(params.get('season') ?? 1),
  weather: (params.get('weather') ?? 'clear') as WeatherKind,
  cycle: false,
  cursorBlight: false,
  blightScale: 1,
};

function pushTime(): void {
  const tv: TimeView = { hours: state.hours, day: state.season * 30 + 3, season: state.season, year: 1, hourMs: 1e12, t: Date.now(), weather: [state.weather, state.weather, state.weather] };
  view.setTime(tv);
}
pushTime();

// ---- blight ----------------------------------------------------------------------
const hearts = wd.nodes.filter((n) => n.kind === 'heart');
function blightFromHearts(scale: number): Uint8Array {
  const out = new Uint8Array(wd.w * wd.h);
  if (scale <= 0) return out;
  for (let y = 0; y < wd.h; y++)
    for (let x = 0; x < wd.w; x++) {
      let v = 0;
      for (const hh of hearts) {
        const d = Math.hypot(x - hh.x, y - hh.y);
        const R = 30 * scale;
        if (d < R) v = Math.max(v, 255 * Math.pow(1 - d / R, 1.1));
      }
      out[y * wd.w + x] = Math.min(255, v | 0);
    }
  return out;
}
view.setBlight(blightFromHearts(1));

// ---- settlements ------------------------------------------------------------------
const factionIds = FACTIONS.map((f) => f.id);
const settleView: SettlementView[] = wd.settlements.map((s, i) => ({
  id: s.id,
  controller: s.kind === 'ruin' ? null : factionIds[i % factionIds.length],
  status: s.kind === 'ruin' ? 'fallen' : 'thriving',
  prosperity: 60,
  population: s.population,
  defense: 50,
  blight: 0,
  siege: false,
  flags: [],
}));
view.setSettlements(settleView);

// ---- entities ------------------------------------------------------------------------
let nextId = 100;
const SELF = 1;
const spawn = wd.settlements[0].spawn;
const ents = new Map<number, EntityView>();
interface Walker {
  id: number;
  path: [number, number][];
  i: number;
  nextAt: number;
  wander: boolean;
  center: [number, number];
  radius: number;
  stepMs: number;
  pauseUntil: number;
}
const walkers = new Map<number, Walker>();

function randLook(): Look {
  return { gender: rng.int(0, 1) as 0 | 1, skin: rng.int(0, 5), hairStyle: rng.int(0, 6), hairColor: rng.int(0, 7), outfit: rng.int(0, 3), outfitColor: rng.int(0, 9), sashColor: rng.int(0, 7), accessory: rng.int(0, 4) };
}

function nearPassable(cx: number, cy: number, r: number): [number, number] {
  for (let i = 0; i < 200; i++) {
    const x = Math.round(cx + rng.float(-r, r));
    const y = Math.round(cy + rng.float(-r, r));
    if (isPassable(wd, x, y) && wd.objects[y * wd.w + x] === 0) return [x, y];
  }
  return [cx, cy];
}

function spawnEnt(v: Omit<EntityView, 'id'> & { id?: number }, walker?: Partial<Walker>): EntityView {
  const id = v.id ?? nextId++;
  const e = { ...v, id } as EntityView;
  ents.set(id, e);
  view.applyEntities({ add: [e] });
  if (walker) walkers.set(id, { id, path: [], i: 0, nextAt: 0, wander: true, center: [e.x, e.y], radius: 8, stepMs: 420, pauseUntil: 0, ...walker });
  return e;
}

const [sx0, sy0] = nearPassable(spawn.x, spawn.y, 2);
spawnEnt({ id: SELF, kind: 'player', name: 'You', x: sx0, y: sy0, face: 0, state: 'idle', look: { gender: 0, skin: 2, hairStyle: 1, hairColor: 0, outfit: 3, outfitColor: 3, sashColor: 1, accessory: 0 }, weapon: 'sword', rank: 3, online: true, tag: 'Azure Cloud', lv: 12, hp: 220, maxHp: 260 }, { wander: false, stepMs: 380 });
view.setSelf(SELF);

const ROLES: NpcRole[] = ['villager', 'villager', 'guard', 'merchant', 'smith', 'alchemist', 'innkeeper', 'master', 'elder', 'physician', 'legend', 'wanderer'];
const names = ['Lin', 'Mo', 'Ren', 'Hua', 'Jae', 'Soo', 'Tae', 'Wei', 'Yun', 'Bao', 'Chen', 'Dae', 'Fen', 'Gu', 'Han', 'Jin'];
for (let i = 0; i < 16; i++) {
  const [x, y] = nearPassable(spawn.x, spawn.y, 9);
  const role = ROLES[i % ROLES.length];
  spawnEnt(
    { kind: 'npc', name: `${names[i % names.length]} ${role}`, x, y, face: rng.int(0, 3) as 0, state: 'idle', look: randLook(), role, faction: factionIds[i % 5], lv: rng.int(5, 40), tag: role === 'master' ? 'Master' : undefined },
    { center: [spawn.x, spawn.y], radius: 9, stepMs: 520 },
  );
}
for (let i = 0; i < 14; i++) {
  const [x, y] = nearPassable(spawn.x, spawn.y, 11);
  spawnEnt(
    { kind: 'player', name: `${names[(i * 3) % names.length]}${rng.int(1, 99)}`, x, y, face: 0, state: 'idle', look: randLook(), weapon: rng.pick(WEAPON_TYPES), rank: rng.int(1, 8), online: i % 5 !== 4, lv: rng.int(3, 60), tag: i % 3 === 0 ? 'Crimson Lotus' : undefined },
    { center: [spawn.x, spawn.y], radius: 11, stepMs: 400 },
  );
}
const MONSTERS = ['boar', 'wolf', 'snake', 'bear', 'tiger', 'bandit', 'bandit_boss', 'hollow', 'wolf_blight', 'hollow_monk', 'hollow_brute', 'hollow_lord'];
MONSTERS.forEach((m, i) => {
  const ang = (i / MONSTERS.length) * Math.PI * 2;
  const mx = Math.round(spawn.x + Math.cos(ang) * 14);
  const my = Math.round(spawn.y + Math.sin(ang) * 11);
  const [x, y] = nearPassable(mx, my, 4);
  spawnEnt(
    { kind: 'monster', name: m.replace('_', ' '), sprite: m, x, y, face: rng.int(0, 3) as 0, state: 'idle', lv: 4 + i * 3, hp: 80, maxHp: 120, elite: m === 'tiger' ? 1 : m === 'bandit_boss' || m === 'hollow_lord' ? 2 : 0 },
    { center: [x, y], radius: 3, stepMs: 700 },
  );
});
for (const nk of ['herb', 'herb', 'herb', 'rareHerb', 'rareHerb', 'ore', 'ore', 'shrine', 'heart'] as const) {
  const [x, y] = nearPassable(spawn.x - 3 + rng.int(-6, 6), spawn.y + 6 + rng.int(-2, 6), 3);
  spawnEnt({ kind: 'node', name: nk === 'herb' ? 'Herb' : nk === 'rareHerb' ? 'Rare Herb' : nk === 'ore' ? 'Iron Vein' : nk === 'shrine' ? 'Wayside Shrine' : 'Blight Heart', nodeKind: nk, sprite: nk, x, y, face: 0, state: 'idle' });
}
// a fighting pair
const [fx0, fy0] = nearPassable(spawn.x + 2, spawn.y + 3, 2);
const fighterA = spawnEnt({ kind: 'player', name: 'Duelist', x: fx0, y: fy0, face: 0, state: 'fight', look: randLook(), weapon: 'sword', rank: 4, online: true, hp: 150, maxHp: 200, lv: 22 });
const wolfFoe = spawnEnt({ kind: 'monster', name: 'Gray Wolf', sprite: 'wolf', x: fx0 + 1, y: fy0, face: 2, state: 'fight', lv: 9, hp: 60, maxHp: 140 });
setInterval(() => {
  const ev: CombatEvent[] = [];
  const crit = Math.random() < 0.25;
  ev.push({ k: 'hit', s: fighterA.id, d: wolfFoe.id, a: Math.floor(30 + Math.random() * 40) * (crit ? 2 : 1), c: crit ? 1 : undefined, sk: 'sword_basic' });
  ev.push(Math.random() < 0.3 ? { k: 'miss', s: wolfFoe.id, d: fighterA.id, sk: 'm_bite' } : { k: 'hit', s: wolfFoe.id, d: fighterA.id, a: Math.floor(8 + Math.random() * 20), sk: 'm_bite' });
  if (Math.random() < 0.25) ev.push({ k: 'status', s: fighterA.id, d: wolfFoe.id, st: 'bleed' });
  if (Math.random() < 0.2) ev.push({ k: 'dot', d: wolfFoe.id, a: 6, st: 'poison' });
  if (Math.random() < 0.15) ev.push({ k: 'heal', s: fighterA.id, d: fighterA.id, a: 24 });
  view.combatEvents(ev);
  const hp = Math.max(10, (wolfFoe.hp ?? 100) - 8 + (Math.random() < 0.3 ? 20 : 0));
  wolfFoe.hp = Math.min(wolfFoe.maxHp ?? 140, hp);
  view.applyEntities({ upd: [{ id: wolfFoe.id, hp: wolfFoe.hp }] });
}, 1000);

// ---- movement simulation ---------------------------------------------------------------------
function dirOf(dx: number, dy: number): 0 | 1 | 2 | 3 {
  const s = dx - dy;
  const t = dx + dy;
  return t >= 0 ? (s >= 0 ? 0 : 1) : s >= 0 ? 3 : 2;
}

function pickWander(w: Walker, e: EntityView): void {
  const [tx, ty] = nearPassable(w.center[0], w.center[1], w.radius);
  const p = findPath(grid, e.x, e.y, tx, ty, 800);
  w.path = (p ?? []).map((q) => [q.x, q.y] as [number, number]);
  w.i = 0;
}

function stepWalkers(now: number): void {
  for (const w of walkers.values()) {
    const e = ents.get(w.id)!;
    if (now < w.nextAt) continue;
    if (e.state === 'fight') continue;
    if (w.i >= w.path.length) {
      if (e.nx !== undefined) {
        // arrive: settle
        e.state = 'idle';
        view.applyEntities({ upd: [{ id: w.id, x: e.x, y: e.y, state: 'idle' }] });
        e.nx = undefined;
        e.ny = undefined;
      }
      if (w.wander && now >= w.pauseUntil) {
        if (w.pauseUntil === 0 || now > w.pauseUntil) {
          w.pauseUntil = now + 800 + Math.random() * 3500;
          continue;
        }
      }
      if (w.wander && now >= w.pauseUntil) pickWander(w, e);
      if (w.i >= w.path.length) continue;
    }
    const [nx, ny] = w.path[w.i++];
    const step = w.stepMs;
    const face = dirOf(nx - e.x, ny - e.y);
    // announce the step: we are at (x,y) and moving to (nx,ny)
    view.applyEntities({ upd: [{ id: w.id, x: e.x, y: e.y, nx, ny, step, face, state: 'walk' }] });
    e.state = 'walk';
    e.nx = nx;
    e.ny = ny;
    e.face = face;
    w.nextAt = now + step;
    // we arrive at next tile after `step`: commit position then
    setTimeout(() => {
      e.x = nx;
      e.y = ny;
    }, step);
  }
}
setInterval(() => stepWalkers(performance.now()), 50);
// stagger initial wandering
for (const w of walkers.values()) if (w.wander) w.pauseUntil = performance.now() + Math.random() * 2500;

view.onPick((p, g) => {
  if (g === 'hover') {
    hoverTile = p;
    return;
  }
  if (g === 'tap') {
    if (p.entityId !== null && p.entityId !== SELF) {
      view.setSelected(p.entityId);
      const t = ents.get(p.entityId);
      if (t) say(`Selected ${t.name}`);
    } else {
      view.setSelected(null);
      const self = ents.get(SELF)!;
      const path = findPath(grid, self.x, self.y, p.x, p.y, 6000);
      if (path && path.length) {
        const w = walkers.get(SELF)!;
        w.path = path.map((q) => [q.x, q.y] as [number, number]);
        w.i = 0;
        w.nextAt = 0;
        view.setMoveTarget({ x: p.x, y: p.y });
      }
    }
  } else if (g === 'context') {
    if (p.entityId !== null) view.say(p.entityId, `Context menu on #${p.entityId}`);
    else view.setMoveTarget({ x: p.x, y: p.y });
  }
});
let hoverTile: { x: number; y: number } | null = null;

function say(t: string): void {
  const el = document.getElementById('info');
  if (el) el.textContent = t;
}

// ---- panel -------------------------------------------------------------------------------------
const panel = document.getElementById('panel')!;
const seasonNames = ['Spring', 'Summer', 'Autumn', 'Winter'];
const weathers: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];
const fxKinds: FxKind[] = ['levelup', 'breakthrough', 'death', 'loot', 'heal', 'learn', 'gather', 'purify'];
panel.innerHTML = `
<div class="head"><b>Render sandbox</b> <span id="fps">-</span> <button id="collapse" title="hide panel">-</button></div>
<div id="body">
<h4>Time</h4>
<label>hour <input id="hour" type="range" min="0" max="24" step="0.05" value="${state.hours}"><span id="hourv">${state.hours}</span></label>
<label>day cycle <input id="cycle" type="checkbox"></label>
<h4>Season</h4><div class="row" id="seasons"></div>
<h4>Weather</h4><div class="row" id="weathers"></div>
<h4>Blight</h4>
<label>reach <input id="bl" type="range" min="0" max="2" step="0.05" value="1"></label>
<label>corrupt at cursor <input id="blc" type="checkbox"></label>
<div class="row"><button id="blclear">clear</button><button id="blall">all hearts</button></div>
<h4>Camera</h4>
<div class="row"><button id="zin">zoom +</button><button id="zout">zoom -</button><button id="recenter">recenter</button><span id="zv"></span></div>
<h4>Teleport</h4><div class="row" id="tele"></div>
<h4>Settlement 0..7</h4><div class="row" id="settle"></div>
<h4>Siege demo</h4><div class="row" id="siegedemo"></div>
<h4>FX on you</h4><div class="row" id="fxs"></div>
<div class="row"><button id="sayb">say</button><button id="combat">combat burst</button></div>
<h4>Gear and animation lab (applies to you)</h4>
<div id="lab"></div>
</div>`;
const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const mk = (parent: HTMLElement, label: string, fn: () => void): void => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  parent.appendChild(b);
};
seasonNames.forEach((n, i) => mk(el('seasons'), n, () => ((state.season = i), pushTime())));
weathers.forEach((w) => mk(el('weathers'), w, () => ((state.weather = w), pushTime())));
const hourEl = el<HTMLInputElement>('hour');
hourEl.oninput = () => {
  state.hours = Number(hourEl.value);
  el('hourv').textContent = state.hours.toFixed(1);
  pushTime();
};
el<HTMLInputElement>('cycle').onchange = (e) => (state.cycle = (e.target as HTMLInputElement).checked);
el<HTMLInputElement>('bl').oninput = (e) => view.setBlight(blightFromHearts(Number((e.target as HTMLInputElement).value)));
el<HTMLInputElement>('blc').onchange = (e) => (state.cursorBlight = (e.target as HTMLInputElement).checked);
el('blclear').onclick = () => view.setBlight(new Uint8Array(wd.w * wd.h));
el('blall').onclick = () => view.setBlight(blightFromHearts(Number(el<HTMLInputElement>('bl').value)));
el('zin').onclick = () => view.setZoom(view.getZoom() + 0.5);
el('zout').onclick = () => view.setZoom(view.getZoom() - 0.5);
el('recenter').onclick = () => {
  const s = ents.get(SELF)!;
  view.centerOn(s.x, s.y);
};
function teleport(x: number, y: number): void {
  const [tx, ty] = nearPassable(x, y, 3);
  const self = ents.get(SELF)!;
  self.x = tx;
  self.y = ty;
  self.nx = undefined;
  self.ny = undefined;
  const w = walkers.get(SELF)!;
  w.path = [];
  w.i = 0;
  view.applyEntities({ upd: [{ id: SELF, x: tx, y: ty, state: 'idle' }] });
  view.centerOn(tx, ty, true);
}
for (const s of wd.settlements) mk(el('tele'), `${s.id} ${s.name.split(' ')[0]}`, () => teleport(s.spawn.x, s.spawn.y));
const statuses: SettlementView['status'][] = ['thriving', 'struggling', 'besieged', 'fallen'];
wd.settlements.forEach((s, i) => {
  mk(el('settle'), `${i}`, () => {
    const v = settleView[i];
    const cur = statuses.indexOf(v.status);
    v.status = statuses[(cur + 1) % statuses.length];
    v.siege = v.status === 'besieged';
    if (v.status === 'thriving') v.controller = factionIds[(factionIds.indexOf(v.controller ?? '') + 1) % factionIds.length];
    view.setSettlements([v]);
    say(`${s.name}: ${v.status} (${v.controller})`);
  });
});
// a scripted raid: war party marches in, guards run out, melee, then the town holds or falls (fake entities)
const demoSid = (): number => {
  const self = ents.get(SELF)!;
  let best = 0;
  let bd = Infinity;
  for (const st of wd.settlements) {
    if (st.kind === 'ruin') continue;
    const dd = Math.hypot(st.x - self.x, st.y - self.y);
    if (dd < bd) {
      bd = dd;
      best = st.id;
    }
  }
  return best;
};
const autoSiege = params.get('siege');
if (autoSiege === 'hold' || autoSiege === 'fall') window.setTimeout(() => startSiegeDemo({ view, wd, grid, rng, settleView, say }, autoSiege, params.get('sid') !== null ? Number(params.get('sid')) : demoSid()), 800);
mk(el('siegedemo'), 'raid: town holds', () => startSiegeDemo({ view, wd, grid, rng, settleView, say }, 'hold', demoSid()));
mk(el('siegedemo'), 'raid: town falls', () => startSiegeDemo({ view, wd, grid, rng, settleView, say }, 'fall', demoSid()));
mk(el('siegedemo'), 'stop', () => stopSiegeDemo());
fxKinds.forEach((k) => mk(el('fxs'), k, () => view.fx(k, SELF, k === 'loot' ? '+3 Silver' : undefined)));
el('sayb').onclick = () => view.say(SELF, 'The Blight is spreading east of the ford. Stay close to the road and carry a purifying pill!');
el('combat').onclick = () => {
  const evs: CombatEvent[] = [];
  const self = SELF;
  for (let i = 0; i < 4; i++) evs.push({ k: 'hit', s: self, d: wolfFoe.id, a: 50 + i * 7, c: i === 2 ? 1 : undefined, sk: i % 2 ? 'sword_cloud' : 'fist_iron' });
  evs.push({ k: 'use', s: self, sk: 'sword_azure' }, { k: 'guard', s: self }, { k: 'stun', s: wolfFoe.id });
  view.combatEvents(evs);
};
el('collapse').onclick = () => {
  const b = el('body');
  b.style.display = b.style.display === 'none' ? '' : 'none';
};
// ---- gear / animation lab ------------------------------------------------------------------------
const lab = {
  oT: Number(params.get('oT') ?? 0),
  oR: Number(params.get('oR') ?? 0),
  wType: (params.get('w') ?? 'sword') as WeaponType | 'none',
  wT: Number(params.get('wT') ?? 0),
  wR: Number(params.get('wR') ?? 0),
  aK: (params.get('aK') ?? 'none') as StatKey | 'none',
  aT: Number(params.get('aT') ?? 3),
  aR: Number(params.get('aR') ?? 0),
  state: (params.get('state') ?? 'auto') as CharState | 'auto',
  variant: Number(params.get('variant') ?? 0),
  dir: Number(params.get('dir') ?? 0),
};
const STATES: (CharState | 'auto')[] = ['auto', 'idle', 'walk', 'run', 'draw', 'fight', 'attack', 'hit', 'block', 'dodge', 'die', 'dead', 'meditate', 'work', 'craft', 'cheer', 'loot', 'stretch', 'sweep', 'chat', 'fan', 'wipe', 'form', 'eat', 'pray', 'rest', 'trade', 'shelter', 'mourn'];
const ACTS = ['none', 'farm', 'forge', 'brew', 'gather', 'mine', 'guard', 'eat', 'chat', 'pray', 'sweep', 'rest', 'patrol', 'trade', 'train', 'shelter', 'mourn', 'celebrate', 'loot'] as const;
let labAct: (typeof ACTS)[number] = 'none';
function labGear(): GearLook | undefined {
  const g: GearLook = {};
  if (lab.oT > 0) g.o = { t: lab.oT, r: lab.oR };
  if (lab.wT > 0 && lab.wType !== 'none') g.w = { t: lab.wT, r: lab.wR };
  if (lab.aK !== 'none') g.a = { k: lab.aK, t: lab.aT, r: lab.aR };
  return g.o || g.w || g.a ? g : undefined;
}
function labApply(): void {
  const gear = labGear();
  const self = ents.get(SELF)!;
  self.gear = gear;
  self.weapon = lab.wType === 'none' ? undefined : lab.wType;
  view.applyEntities({ upd: [{ id: SELF, gear, weapon: self.weapon, face: lab.dir as 0 }] });
  const e = view.entity(SELF);
  if (e) e.face = lab.dir as 0;
  view.debugAnim(SELF, lab.state === 'auto' ? null : lab.state, lab.variant, lab.state === 'work' ? 'hammer' : null);
  if (galleryOn) buildGallery();
}
const labEl = el('lab');
const sel = (label: string, opts: (string | number)[], cur: string | number, fn: (v: string) => void): void => {
  const l = document.createElement('label');
  l.append(label);
  const s2 = document.createElement('select');
  for (const o of opts) {
    const op = document.createElement('option');
    op.value = String(o);
    op.textContent = String(o);
    if (String(o) === String(cur)) op.selected = true;
    s2.appendChild(op);
  }
  s2.onchange = () => {
    fn(s2.value);
    labApply();
  };
  l.appendChild(s2);
  labEl.appendChild(l);
};
sel('outfit tier', [0, 1, 2, 3, 4, 5], lab.oT, (v) => (lab.oT = Number(v)));
sel('outfit rarity', [0, 1, 2, 3, 4], lab.oR, (v) => (lab.oR = Number(v)));
sel('weapon', ['none', ...WEAPON_TYPES], lab.wType, (v) => (lab.wType = v as WeaponType));
sel('weapon tier', [0, 1, 2, 3, 4, 5], lab.wT, (v) => (lab.wT = Number(v)));
sel('weapon rarity', [0, 1, 2, 3, 4], lab.wR, (v) => (lab.wR = Number(v)));
sel('accessory', ['none', ...STAT_KEYS], lab.aK, (v) => (lab.aK = v as StatKey));
sel('accessory tier', [1, 2, 3, 4, 5], lab.aT, (v) => (lab.aT = Number(v)));
sel('accessory rarity', [0, 1, 2, 3, 4], lab.aR, (v) => (lab.aR = Number(v)));
sel('state', STATES, lab.state, (v) => (lab.state = v as CharState));
sel('attack variant', [0, 1, 2, 3], lab.variant, (v) => (lab.variant = Number(v)));
sel('direction', [0, 1, 2, 3], lab.dir, (v) => (lab.dir = Number(v)));
sel('NPC act (all NPCs)', [...ACTS], 'none', (v) => {
  labAct = v as (typeof ACTS)[number];
  const upd = [...ents.values()].filter((x) => x.kind === 'npc').map((x) => ({ id: x.id, act: labAct === 'none' ? undefined : (labAct as NpcAct) }));
  view.applyEntities({ upd });
  if (galleryOn) buildGallery();
});
const labRow = document.createElement('div');
labRow.className = 'row';
labEl.appendChild(labRow);
mk(labRow, 'reroll look', () => {
  const lk = randLook();
  const self = ents.get(SELF)!;
  self.look = lk;
  view.applyEntities({ upd: [{ id: SELF, look: lk }] });
  if (galleryOn) buildGallery();
});
mk(labRow, 'gallery', () => toggleGallery());
mk(labRow, 'crowd', () => toggleCrowd());
mk(labRow, 'townfolk', () => toggleTownfolk());
mk(labRow, 'scale reference', () => toggleScaleRef());
mk(labRow, 'npc behind house', () => npcBehindHouse());
mk(labRow, 'max gear', () => {
  Object.assign(lab, { oT: 5, oR: 4, wT: 5, wR: 4, aK: 'spirit', aT: 5, aR: 4 });
  const vals = [5, 4, lab.wType, 5, 4, 'spirit', 5, 4];
  labEl.querySelectorAll('select').forEach((s3, i) => {
    if (i < vals.length) s3.value = String(vals[i]);
  });
  labApply();
});

// gallery: one character large, all frames of the chosen state
let galleryOn = false;
const gal = document.createElement('div');
gal.style.cssText = 'position:fixed;inset:0;z-index:20;background:rgba(13,24,35,0.96);overflow:auto;display:none;padding:12px 260px 12px 12px;align-content:flex-start;flex-wrap:wrap;gap:6px;';
document.body.appendChild(gal);
function buildGallery(): void {
  gal.innerHTML = '';
  const self = ents.get(SELF)!;
  const st = (labAct !== 'none' ? ACT_STATE[labAct as NpcAct].state : lab.state === 'auto' ? 'idle' : lab.state) as CharState;
  const n = FRAME_COUNTS[st];
  const tool = st === 'work' ? 'hammer' : undefined;
  for (let i = 0; i < n; i++) {
    const c = document.createElement('canvas');
    c.width = 240;
    c.height = 340;
    c.style.cssText = 'border:1px solid #3a3040;border-radius:4px;image-rendering:pixelated;background:#17121d';
    c.title = `${st} frame ${i}`;
    gal.appendChild(c);
    drawLookPreview(c, self.look!, { state: st, frame: i, dir: lab.dir as 0, weapon: self.weapon, gear: self.gear, variant: lab.variant, tool, scale: 5, backdrop: true });
  }
  const live = document.createElement('canvas');
  live.width = 240;
  live.height = 340;
  live.style.cssText = 'border:1px solid #d9b867;border-radius:4px;image-rendering:pixelated;background:#17121d';
  gal.appendChild(live);
  const tick = (t: number): void => {
    if (!galleryOn || !live.isConnected) return;
    drawLookPreview(live, self.look!, { state: st, time: t, dir: lab.dir as 0, weapon: self.weapon, gear: self.gear, variant: lab.variant, tool, scale: 5 });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
function toggleGallery(): void {
  galleryOn = !galleryOn;
  gal.style.display = galleryOn ? 'flex' : 'none';
  if (galleryOn) buildGallery();
}
gal.onclick = (ev) => {
  if (ev.target === gal) toggleGallery();
};

// crowd toggle (performance test): +60 walkers around you
let crowdIds: number[] = [];
function toggleCrowd(): void {
  if (crowdIds.length) {
    view.applyEntities({ del: crowdIds });
    for (const id of crowdIds) {
      ents.delete(id);
      walkers.delete(id);
    }
    crowdIds = [];
    return;
  }
  const self = ents.get(SELF)!;
  for (let i = 0; i < 60; i++) {
    const [x, y] = nearPassable(self.x, self.y, 8);
    const w = rng.pick(WEAPON_TYPES);
    const t = rng.int(1, 5);
    const e = spawnEnt(
      { kind: 'player', name: `P${i}`, x, y, face: rng.int(0, 3) as 0, state: 'idle', look: randLook(), weapon: w, rank: rng.int(1, 8), online: true, gear: { o: { t, r: rng.int(0, 4) }, w: { t: rng.int(1, 5), r: rng.int(0, 4) }, a: { k: rng.pick([...STAT_KEYS]), t: rng.int(1, 5), r: rng.int(0, 3) } } },
      { center: [self.x, self.y], radius: 8, stepMs: rng.int(240, 520) },
    );
    crowdIds.push(e.id);
  }
}

// townsfolk toggle: the nameless ambient tier the server spawns near players (shared/crowd.ts), n of them from the 24 looks
let townIds: number[] = [];
function toggleTownfolk(n = 45): void {
  if (townIds.length) {
    view.applyEntities({ del: townIds });
    for (const id of townIds) {
      ents.delete(id);
      walkers.delete(id);
    }
    townIds = [];
    return;
  }
  for (let i = 0; i < n; i++) {
    const [x, y] = nearPassable(spawn.x, spawn.y, 12);
    const e = spawnEnt({ kind: 'ambient', name: '', x, y, face: rng.int(0, 3) as 0, state: 'idle', look: ambientLook(rng.int(0, 23)), role: 'villager' }, { center: [spawn.x, spawn.y], radius: 14, stepMs: rng.int(520, 700) });
    townIds.push(e.id);
  }
}

// scale reference: a person next to everything that has a target height (art/scale.ts), 1-tile grid and ruler lines
let refOn = false;
let refCv: HTMLCanvasElement | null = null;
function drawScaleRef(cv: HTMLCanvasElement): void {
  const items = referenceItems();
  const person = items[0];
  const rows: RefItem[][] = [[], [], []];
  for (const it of items) rows[it.row].push(it);
  const GAP = 14;
  const rowW = (r: RefItem[]): number => r.reduce((a, it) => a + it.w + GAP + (it.withPerson ? person.w + 6 : 0), GAP);
  const maxW = Math.max(rowW(rows[0]), rowW(rows[1]));
  const rowH = (r: RefItem[]): number => Math.max(...r.map((it) => it.h)) + 56;
  const hs = rows.map(rowH);
  const S = Math.max(1, Math.min(3, Math.floor(Math.min(innerWidth / maxW, innerHeight / (hs.reduce((a, b) => a + b + 14, 0) + 8)) * 4) / 4));
  cv.width = innerWidth;
  cv.height = innerHeight;
  const g = cv.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.fillStyle = '#26402c';
  g.fillRect(0, 0, cv.width, cv.height);
  g.font = `${11}px ui-monospace, Consolas, monospace`;
  const total = hs.reduce((a, b) => a + b + 14, 0) * S;
  let top = Math.max(8, Math.round((innerHeight - total) / 2));
  const drawRow = (r: RefItem[], h: number): void => {
    const base = top + (h - 46) * S;
    // ruler lines every person height
    g.fillStyle = 'rgba(255,255,255,0.35)';
    for (let k = 1; k * PERSON_PX < h - 10; k++) {
      const y = base - k * PERSON_PX * S;
      for (let x = 0; x < cv.width; x += 8) g.fillRect(x, y, 4, 1);
      g.fillStyle = '#fff';
      g.fillText(`${k} person${k > 1 ? 's' : ''} (${k * PERSON_PX}px)`, 4, y - 2);
      g.fillStyle = 'rgba(255,255,255,0.35)';
    }
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillRect(0, base, cv.width, 1);
    let x = GAP * S;
    const place = (it: RefItem, cx: number, label: number): void => {
      // 1-tile diamond under the item
      g.strokeStyle = 'rgba(255,255,255,0.45)';
      g.beginPath();
      g.moveTo(cx - 16 * S, base);
      g.lineTo(cx, base - 8 * S);
      g.lineTo(cx + 16 * S, base);
      g.lineTo(cx, base + 8 * S);
      g.closePath();
      g.stroke();
      for (const p of it.parts) g.drawImage(pbToCanvas(p.pb), cx + (p.dx - p.ax) * S, base + (p.dy - p.ay) * S, p.pb.w * S, p.pb.h * S);
      if (label >= 0) {
        g.fillStyle = '#fff';
        const t1 = it.name;
        const t = `${it.h}px ${(it.h / PERSON_PX).toFixed(1)}P`;
        g.fillText(t1, cx - g.measureText(t1).width / 2, base + 22 + label * 24);
        g.fillText(t, cx - g.measureText(t).width / 2, base + 34 + label * 24);
        if (it.door) {
          const t2 = `door ${Math.round(it.door)} eave ${Math.round(it.eave ?? 0)}`;
          g.fillText(t2, cx - g.measureText(t2).width / 2, base + 46 + label * 24);
        }
      }
    };
    let li = 0;
    for (const it of r) {
      li++;
      const half = (it.w / 2) * S;
      place(it, x + half, li % 2);
      x += it.w * S + 4 * S;
      if (it.withPerson) {
        place(person, x + (person.w / 2) * S, -1);
        x += (person.w + 6) * S;
      }
      x += GAP * S;
    }
    top += (h + 14) * S;
  };
  rows.forEach((r, i) => drawRow(r, hs[i]));
}
function toggleScaleRef(): void {
  refOn = !refOn;
  if (!refCv) {
    refCv = document.createElement('canvas');
    refCv.style.cssText = 'position:fixed;inset:0;z-index:15;width:100%;height:100%;image-rendering:pixelated;cursor:pointer';
    refCv.onclick = () => toggleScaleRef();
    document.body.appendChild(refCv);
  }
  refCv.style.display = refOn ? 'block' : 'none';
  if (refOn) drawScaleRef(refCv);
}


// occlusion test case: an NPC standing behind the nearest house (its plate and bubble must hide), and you walking behind it
// (your plate stays, an x-ray ghost shows through)
function npcBehindHouse(): void {
  const houses = wd.buildings.filter((b) => b.kind === 'house' || b.kind === 'inn').sort((a, b) => Math.hypot(a.x - spawn.x, a.y - spawn.y) - Math.hypot(b.x - spawn.x, b.y - spawn.y));
  const b = houses[0];
  if (!b) return;
  let tx = b.x + Math.floor(b.w / 2);
  let ty = b.y - 1;
  for (let k = 1; k <= 4; k++) {
    if (isPassable(wd, tx, b.y - k) && wd.objects[(b.y - k) * wd.w + tx] === 0) {
      ty = b.y - k;
      break;
    }
  }
  const e = spawnEnt({ kind: 'npc', name: 'Han Haejun', x: tx, y: ty, face: 0, state: 'idle', look: randLook(), role: 'villager', lv: 12 }, { wander: false });
  view.say(e.id, 'Nobody can see me behind the house!');
  const me = ents.get(SELF)!;
  me.x = tx + 2;
  me.y = ty - 1;
  view.applyEntities({ upd: [{ id: SELF, x: me.x, y: me.y, state: 'idle' }] });
  view.centerOn(tx, ty + 1, true);
  say('NPC behind the house: plate hidden. You at the right side behind the house: plate stays, ghost shows.');
}

(window as unknown as { lab: unknown }).lab = { lab, apply: labApply, gallery: toggleGallery, crowd: toggleCrowd, townfolk: toggleTownfolk, scaleRef: toggleScaleRef, behindHouse: npcBehindHouse, ents };
if (lab.oT || lab.wT || lab.aK !== 'none' || lab.state !== 'auto') labApply();
if (params.get('crowd') === '1') toggleCrowd();
if (params.get('townfolk')) toggleTownfolk(Number(params.get('townfolk')) || 45);
if (params.get('gallery') === '1') toggleGallery();
if (params.get('scale') === '1') toggleScaleRef();
if (params.get('occl') === '1') setTimeout(npcBehindHouse, 300);

if (params.get('panel') === '0') panel.style.display = 'none';
if (innerWidth < 640) el('body').style.display = 'none';

// ---- minimap ---------------------------------------------------------------------------------------
const mm = document.getElementById('minimap') as HTMLCanvasElement;
mm.onclick = (e) => {
  const r = mm.getBoundingClientRect();
  const t = view.minimapToTile(mm, ((e.clientX - r.left) * mm.width) / r.width, ((e.clientY - r.top) * mm.height) / r.height);
  teleport(t.x, t.y);
};

// ---- main tick for the panel -------------------------------------------------------------------------
let lastT = performance.now();
canvas.addEventListener('pointermove', () => {
  if (!state.cursorBlight || !hoverTile) return;
  const idx: number[] = [];
  const val: number[] = [];
  const R = 6;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const x = hoverTile.x + dx;
      const y = hoverTile.y + dy;
      if (x < 0 || y < 0 || x >= wd.w || y >= wd.h) continue;
      const d = Math.hypot(dx, dy);
      if (d > R) continue;
      const i = y * wd.w + x;
      const v = Math.round(255 * (1 - d / R));
      if (v > view.world!.blight[i]) {
        idx.push(i);
        val.push(v);
      }
    }
  if (idx.length) view.patchBlight(idx, val);
});
setInterval(() => {
  const now = performance.now();
  const dt = now - lastT;
  lastT = now;
  if (state.cycle) {
    state.hours = (state.hours + dt / 1000 / 2.5) % 24;
    hourEl.value = String(state.hours);
    el('hourv').textContent = state.hours.toFixed(1);
    pushTime();
  }
  const f = el('fps');
  const st = view.stats;
  f.textContent = `${st.fps.toFixed(0)} fps  ${st.frameMs.toFixed(1)}ms  ents ${st.entities}/${st.drawn}  chunks ${st.chunksBuilt}`;
  el('zv').textContent = `x${view.getZoom().toFixed(2)}`;
}, 250);
setInterval(() => view.drawMinimap(mm), 200);
setTimeout(() => view.drawMinimap(mm), 50);

window.addEventListener('resize', () => view.resize());
view.start();
const tp = params.get('tp');
if (tp !== null) {
  const s = wd.settlements[Number(tp)];
  if (s) teleport(s.spawn.x, s.spawn.y);
}
// disciples of a compound (?disciples=<settlement id>): two sparring pairs and two drilling in the yard, two sitting before the pavilion
const discId = params.get('disciples');
if (discId !== null) {
  const sid = Number(discId);
  const yard = wd.buildings.find((b) => b.settlementId === sid && b.kind === 'yard');
  const pav = wd.buildings.find((b) => b.settlementId === sid && b.kind === 'pavilion');
  const s = wd.settlements[sid];
  if (yard && s) {
    const uniform: Look = { gender: 0, skin: 2, hairStyle: 1, hairColor: 0, outfit: 1, outfitColor: 3, sashColor: 2, accessory: 0 };
    const mk2 = (x: number, y: number, act: NpcAct, face: 0 | 1 | 2 | 3, n: number, state: 'idle' | 'meditate' = 'idle'): void => {
      spawnEnt({ kind: 'npc', name: 'Disciple', x, y, face, state, act, look: { ...uniform, gender: (n & 1) as 0 | 1, hairStyle: n % 7, skin: n % 5 }, role: 'disciple', lv: 6 + n, tag: n % 3 ? 'Outer Disciple' : 'Inner Disciple' } as never, { wander: false });
    };
    const cx = yard.x + Math.floor(yard.w / 2);
    const cy = yard.y + Math.floor(yard.d / 2);
    mk2(cx - 2, cy + 1, 'spar', 0, 1);
    mk2(cx - 1, cy + 1, 'spar', 2, 2);
    mk2(cx + 1, cy + 2, 'spar', 0, 3);
    mk2(cx + 2, cy + 2, 'spar', 2, 4);
    mk2(cx - 1, yard.y + 2, 'train', 1, 5);
    mk2(cx + 1, yard.y + 2, 'train', 1, 6);
    if (pav) {
      mk2(pav.door.x - 1, pav.door.y + 1, 'meditate', 1, 7, 'meditate');
      mk2(pav.door.x + 1, pav.door.y + 1, 'meditate', 1, 8, 'meditate');
    }
    teleport(s.spawn.x, s.spawn.y);
  }
}
const zoom = params.get('zoom');
if (zoom) view.setZoom(Number(zoom));

// ---- look preview (character creation widget test) ---------------------------------------------------
{
  const pv = document.createElement('canvas');
  pv.width = 150;
  pv.height = 220;
  pv.title = 'drawLookPreview: click to reroll';
  pv.style.cssText = 'position:fixed;left:8px;bottom:8px;border:1px solid #5a4a33;border-radius:6px;image-rendering:pixelated;cursor:pointer;background:#17121d';
  document.body.appendChild(pv);
  if (innerWidth < 640) pv.style.display = 'none';
  let look = randLook();
  let dir = 0;
  pv.onclick = () => {
    look = randLook();
    dir = (dir + 1) % 4;
  };
  const wps = ['sword', 'blade', 'spear', 'staff', 'fist'] as const;
  let wi = 0;
  setInterval(() => (wi = (wi + 1) % 5), 4000);
  const tick = (t: number): void => {
    drawLookPreview(pv, look, { time: t, dir: dir as 0, weapon: wps[wi], scale: 5, state: wi % 2 ? 'walk' : 'idle' });
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

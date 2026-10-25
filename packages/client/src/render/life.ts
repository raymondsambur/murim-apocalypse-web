/**
 * Entity animation driver ("life"): picks the animation state / frame / variant of a character from the entity's
 * server state, movement and event timestamps, and adds the seeded micro behaviour: blinking, head turns toward
 * neighbours, head tilts, idle fidgets and ambient role activities (sweeping, chatting, fanning, practising a form...).
 * Everything is a pure function of (entity id, time), so crowds do not move in sync and nothing needs stored state.
 * Ambient activity is in place only: it never changes the entity's position.
 */
import type { Dir, NpcAct } from '@murim/shared';
import { ATTACK_VARIANTS, FRAME_COUNTS, FRAME_MS, type CharState, type ToolKind } from '../art/anim';
import type { WeaponType } from '@murim/shared';
import { BEAST_FRAMES, BEAST_MS, type BeastState } from '../art/beasts';
import { seedOf, type Ent, type EntityStore } from './entities';

/** Respect `prefers-reduced-motion`: no sway, flashes, particles or knock-backs. */
export const motion = { reduced: false };

export function initMotionPreference(): void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  motion.reduced = mq.matches;
  mq.addEventListener?.('change', (e) => (motion.reduced = e.matches));
}

export interface AnimPick {
  state: CharState;
  frame: number;
  variant: number;
  gaze: number;
  tilt: number;
  blink: boolean;
  tool: ToolKind | null;
  /** Facing override (chat partner), or -1. */
  dir: number;
  /** 0 none, 1 draw the chat icon this frame. */
  chatIcon: number;
  /** The entity is running. */
  run: boolean;
}

export function newPick(): AnimPick {
  return { state: 'idle', frame: 0, variant: 0, gaze: 0, tilt: 0, blink: false, tool: null, dir: -1, chatIcon: 0, run: false };
}

/** Wind bucket (0 calm, 1 breezy, 2 storm) from the weather wind value. */
export function windLevel(w: number): number {
  if (motion.reduced) return 0;
  return w < 0.4 ? 0 : w < 0.8 ? 1 : 2;
}

const slotOf = (t: number, per: number): number => Math.floor(t / per);

export function blinkAt(e: Ent, now: number): boolean {
  const t = now + e.seed * 3400;
  const slot = slotOf(t, 3400);
  const start = seedOf(e.id, slot * 3 + 1) * 2600 + 300;
  const local = t - slot * 3400;
  return local >= start && local < start + 140;
}

/** Head turn sign (-1/0/1) in screen terms or 0. */
export function gazeAt(e: Ent, now: number): number {
  const per = 4300;
  const t = now + e.seed * per;
  const slot = slotOf(t, per);
  if (seedOf(e.id, slot * 5 + 2) > 0.24) return 0;
  const local = t - slot * per;
  const st = seedOf(e.id, slot * 5 + 3) * 2200;
  if (local < st || local > st + 1400) return 0;
  return seedOf(e.id, slot * 5 + 4) < 0.5 ? -1 : 1;
}

export function tiltAt(e: Ent, now: number): number {
  const per = 5300;
  const t = now + e.seed * per;
  const slot = slotOf(t, per);
  if (seedOf(e.id, slot * 5 + 7) > 0.2) return 0;
  const local = t - slot * per;
  const st = seedOf(e.id, slot * 5 + 8) * 3500;
  if (local < st || local > st + 1000) return 0;
  return seedOf(e.id, slot * 5 + 9) < 0.5 ? -1 : 1;
}

type Amb = CharState | 'scan';
const AMBIENT: Record<string, Amb[]> = {
  villager: ['sweep', 'stretch', 'chat', 'chat'],
  elder: ['chat', 'stretch', 'chat'],
  merchant: ['fan', 'chat', 'stretch'],
  innkeeper: ['wipe', 'stretch', 'wipe'],
  master: ['form', 'form', 'stretch'],
  guard: ['scan', 'scan', 'stretch'],
  smith: ['work', 'work', 'stretch'],
  alchemist: ['craft', 'craft', 'stretch'],
  physician: ['fan', 'chat', 'stretch'],
  legend: ['form', 'stretch'],
  wanderer: ['stretch', 'chat'],
  player: ['stretch'],
};
const AMB_DUR: Partial<Record<Amb, number>> = { sweep: 4200, stretch: 2000, chat: 5200, fan: 3600, wipe: 4200, form: 2800, work: 3600, craft: 3600, scan: 4200 };

/**
 * Server activity cue (EntityView.act) -> in-place animation. 'patrol' is a stiff scanning stance (no walking: the server
 * moves the entity), 'train' loops the weapon attacks (or a form without a weapon), 'celebrate' loops the cheer.
 */
export const ACT_STATE: Record<NpcAct, { state: CharState; tool?: ToolKind }> = {
  // 'work' is the old generic cue: NPCs just stand (the server sends a specific kind instead).
  work: { state: 'idle' },
  farm: { state: 'work', tool: 'hoe' },
  forge: { state: 'work', tool: 'hammer' },
  brew: { state: 'craft' },
  gather: { state: 'work', tool: 'herb' },
  mine: { state: 'work', tool: 'pick' },
  guard: { state: 'idle' },
  eat: { state: 'eat' },
  chat: { state: 'chat' },
  pray: { state: 'pray' },
  sweep: { state: 'sweep' },
  rest: { state: 'rest' },
  patrol: { state: 'idle' },
  trade: { state: 'trade' },
  train: { state: 'form' },
  shelter: { state: 'shelter' },
  mourn: { state: 'mourn' },
  celebrate: { state: 'cheer' },
  loot: { state: 'loot' },
};

/** Nearest friendly entity within `r` tiles (cached per entity for ~1.2 s). Returns its id or -1. */
function partnerOf(e: Ent, now: number, ents: EntityStore): number {
  if (now - e.partnerAt < 1200) return e.partner;
  e.partnerAt = now;
  let best = -1;
  let bd = 3.2 * 3.2;
  for (const o of ents.map.values()) {
    if (o === e) continue;
    const k = o.v.kind;
    if (k === 'monster' || k === 'node' || o.v.state === 'dead' || o.v.state === 'fight') continue;
    const dx = o.x - e.x;
    const dy = o.y - e.y;
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = o.id;
    }
  }
  e.partner = best;
  return best;
}

function dirToward(dx: number, dy: number): Dir {
  const s = dx - dy;
  const t = dx + dy;
  return (t >= 0 ? (s >= 0 ? 0 : 1) : s >= 0 ? 3 : 2) as Dir;
}

export interface PickEnv {
  now: number;
  moving: boolean;
  /** Entity-store for neighbour queries. */
  ents: EntityStore;
  wind: number;
  weapon: WeaponType | null;
  /** Monster style: 'hollow*' shamble, 'bandit*' plain. */
  hollow: boolean;
  hasHuman: boolean;
  toolFor: (e: Ent) => ToolKind | null;
}

const ATTACK_MS = FRAME_MS.attack * FRAME_COUNTS.attack;

/** Choose the animation of a character entity. `out` is overwritten. */
export function pickChar(e: Ent, env: PickEnv, out: AnimPick): void {
  const { now, moving } = env;
  const v = e.v;
  out.state = 'idle';
  out.frame = 0;
  out.variant = 0;
  out.gaze = 0;
  out.tilt = 0;
  out.blink = false;
  out.tool = null;
  out.dir = -1;
  out.chatIcon = 0;
  out.run = false;
  const set = (s: CharState, since: number, loop = false): void => {
    out.state = s;
    const n = FRAME_COUNTS[s];
    const f = Math.floor((now - since) / FRAME_MS[s]);
    out.frame = loop ? ((f % n) + n) % n : Math.max(0, Math.min(n - 1, f));
  };

  // sandbox: forced animation
  if (e.force) {
    out.state = e.force.state;
    out.variant = e.force.variant;
    out.tool = e.force.tool;
    out.frame = Math.floor((now + e.seed * 1000) / FRAME_MS[out.state]) % FRAME_COUNTS[out.state];
    if (e.force.state === 'die') out.frame = Math.floor(((now - e.force.t0) % 2200) / FRAME_MS.die);
    if (out.frame >= FRAME_COUNTS[out.state]) out.frame = FRAME_COUNTS[out.state] - 1;
    out.blink = blinkAt(e, now);
    return;
  }
  // ---- death --------------------------------------------------------------------------------------
  if (v.state === 'dead') {
    if (e.bornDead || now - e.deadAt > FRAME_MS.die * FRAME_COUNTS.die) out.state = 'dead';
    else set('die', e.deadAt);
    return;
  }
  const sinceHit = now - e.hitAt;
  const sinceAtk = now - e.attackAt;
  const hitLen = FRAME_MS.hit * FRAME_COUNTS.hit;
  // ---- combat events (most recent wins) --------------------------------------------------------------
  const nAtk = ATTACK_VARIANTS[env.weapon ?? 'none'];
  const attacking = sinceAtk >= 0 && sinceAtk < ATTACK_MS;
  const hit = sinceHit >= 0 && sinceHit < hitLen;
  const dodging = now - e.dodgeAt >= 0 && now - e.dodgeAt < FRAME_MS.dodge * FRAME_COUNTS.dodge;
  const blocking = now - e.blockAt >= 0 && now - e.blockAt < FRAME_MS.block * FRAME_COUNTS.block;
  if (hit && (!attacking || e.hitAt > e.attackAt)) {
    set('hit', e.hitAt);
    return;
  }
  if (dodging) {
    set('dodge', e.dodgeAt);
    return;
  }
  if (blocking) {
    set('block', e.blockAt);
    return;
  }
  if (attacking) {
    set('attack', e.attackAt);
    out.variant = Math.floor(seedOf(e.id, e.attackIdx * 3 + 5) * nAtk);
    return;
  }
  // ---- emotes ------------------------------------------------------------------------------------------
  if (now - e.cheerAt >= 0 && now - e.cheerAt < FRAME_MS.cheer * FRAME_COUNTS.cheer) {
    set('cheer', e.cheerAt);
    return;
  }
  if (now - e.lootAt >= 0 && now - e.lootAt < FRAME_MS.loot * FRAME_COUNTS.loot) {
    set('loot', e.lootAt);
    return;
  }
  // ---- locomotion ----------------------------------------------------------------------------------------
  if (moving) {
    const step = Math.max(200, Math.min(700, v.step ?? 420));
    const run = step < 300;
    out.run = run;
    out.state = run ? 'run' : 'walk';
    const n = FRAME_COUNTS[out.state];
    const ms = run ? step / 3 : step / 4;
    out.frame = Math.floor((now + e.seed * 1000) / ms) % n;
    return;
  }
  // ---- fight stance --------------------------------------------------------------------------------------
  if (v.state === 'fight') {
    const sinceFight = now - e.fightSince;
    if (env.hasHuman && sinceFight >= 0 && sinceFight < FRAME_MS.draw * FRAME_COUNTS.draw) set('draw', e.fightSince);
    else set('fight', e.fightSince + e.seed * 400, true);
    if (env.hollow) out.tilt = seedOf(e.id, Math.floor(now / 380)) < 0.3 ? (seedOf(e.id, Math.floor(now / 380) + 9) < 0.5 ? -1 : 1) : 0;
    return;
  }
  // victory pose just after a fight (players and NPCs)
  if (v.kind !== 'monster' && now - e.fightEnd >= 0 && now - e.fightEnd < 640 && (v.hp === undefined || v.maxHp === undefined || v.hp > v.maxHp * 0.25)) {
    set('cheer', e.fightEnd + 40);
    return;
  }
  // ---- server activity cue (takes priority over the state activities and fidgets) --------------------------------
  if (v.act && env.hasHuman && !env.hollow) {
    const act = v.act;
    const at = e.born + e.seed * 2600;
    switch (act) {
      case 'farm':
        out.tool = e.seed < 0.5 ? 'hoe' : 'sickle';
        set('work', at, true);
        return;
      case 'forge':
      case 'gather':
      case 'mine':
        out.tool = ACT_STATE[act].tool ?? null;
        set('work', at, true);
        return;
      case 'brew':
        set('craft', at, true);
        return;
      case 'guard':
      case 'patrol':
        set('idle', at, true);
        out.blink = blinkAt(e, now);
        out.gaze = [1, 0, -1, 0, -1, 0, 1, 0][Math.floor((now + e.seed * 5000) / 900) % 8];
        return;
      case 'train':
        if (env.weapon) {
          const n = FRAME_COUNTS.attack;
          const cyc = n * FRAME_MS.attack + 700;
          const t = (now + e.seed * 4000) % cyc;
          const round = Math.floor((now + e.seed * 4000) / cyc);
          if (t < n * FRAME_MS.attack) {
            out.state = 'attack';
            out.frame = Math.floor(t / FRAME_MS.attack);
            out.variant = Math.floor(seedOf(e.id, round * 3 + 1) * ATTACK_VARIANTS[env.weapon]);
          } else {
            set('fight', at, true);
          }
        } else set('form', at, true);
        return;
      case 'chat': {
        set('chat', at, true);
        const pid = partnerOf(e, now, env.ents);
        const p = pid >= 0 ? env.ents.map.get(pid) : undefined;
        if (p) out.dir = dirToward(p.x - e.x, p.y - e.y);
        const turn = Math.floor((now + e.seed * 2000) / 1300) % 2;
        out.chatIcon = turn === (e.id & 1) ? 1 : 0;
        return;
      }
      case 'rest':
        // Sitting on a doorstep or bench: no sleeping bubble (real sleep happens indoors, out of sight).
        set('rest', at, true);
        return;
      default: {
        const s = ACT_STATE[act];
        set(s.state, at, true);
        if (s.state === 'form' || s.state === 'sweep') out.tool = null;
        return;
      }
    }
  }
  // ---- activities from the server state --------------------------------------------------------------------
  // NPCs only work with a specific cue; a bare 'work' state (e.g. mid-conversation) just stands.
  if (v.state === 'work' && v.kind !== 'npc') {
    out.tool = env.toolFor(e);
    set('work', e.born + e.seed * 600, true);
    return;
  }
  if (v.state === 'craft') {
    set('craft', e.born + e.seed * 600, true);
    return;
  }
  if (v.state === 'meditate') {
    set('meditate', e.born + e.seed * 2000, true);
    return;
  }
  // ---- idle with fidgets and ambient life ----------------------------------------------------------------
  set('idle', e.born + e.seed * 2600, true);
  out.blink = blinkAt(e, now);
  if (env.hollow) {
    const q = Math.floor(now / 330);
    out.tilt = seedOf(e.id, q) < 0.35 ? (seedOf(e.id, q + 13) < 0.5 ? -1 : 1) : 0;
    out.gaze = seedOf(e.id, q + 29) < 0.2 ? (seedOf(e.id, q + 31) < 0.5 ? -1 : 1) : 0;
    out.blink = false;
    return;
  }
  out.tilt = tiltAt(e, now);
  const g = gazeAt(e, now);
  if (g !== 0) out.gaze = g;
  if (!env.hasHuman) return;
  if (motion.reduced) return;
  // ambient role activity
  const key = v.kind === 'player' ? 'player' : v.role ?? '';
  const list = AMBIENT[key];
  if (!list) return;
  const slotLen = 9000 + e.seed * 6000;
  const t = now + e.seed * slotLen * 2;
  const slot = slotOf(t, slotLen);
  const chance = key === 'player' ? 0.18 : key === 'guard' ? 0.7 : 0.5;
  if (seedOf(e.id, slot * 7 + 11) > chance) return;
  const act = list[Math.floor(seedOf(e.id, slot * 7 + 12) * list.length)];
  const dur = AMB_DUR[act] ?? 3000;
  const start = seedOf(e.id, slot * 7 + 13) * (slotLen - dur - 500);
  const local = t - slot * slotLen - start;
  if (local < 0 || local > dur) return;
  if (act === 'scan') {
    out.gaze = [1, 0, -1, 0][Math.floor(local / 700) % 4];
    return;
  }
  if (act === 'chat') {
    const pid = partnerOf(e, now, env.ents);
    if (pid < 0) return;
    const p = env.ents.map.get(pid);
    if (!p || partnerOf(p, now, env.ents) !== e.id) return;
    // both partners chat in the same window (window derived from the pair, not from either entity)
    const a = Math.min(e.id, pid);
    const b = Math.max(e.id, pid);
    const pslot = slotOf(now, 9000);
    if (seedOf(a * 7919 + b, pslot) > 0.6) return;
    const plocal = now - pslot * 9000 - seedOf(a * 7919 + b, pslot + 99) * 3000;
    if (plocal < 0 || plocal > 5200) return;
    set('chat', now - plocal, true);
    out.dir = dirToward(p.x - e.x, p.y - e.y);
    // alternate speaker: the icon shows on the one whose turn it is
    out.chatIcon = Math.floor(plocal / 1300) % 2 === (e.id < pid ? 0 : 1) ? 1 : 0;
    return;
  }
  if (act === 'work') out.tool = env.toolFor(e) ?? 'hammer';
  out.state = act as CharState;
  const n = FRAME_COUNTS[out.state];
  out.frame = Math.floor(local / FRAME_MS[out.state]) % n;
  if (act === 'stretch') out.frame = Math.min(n - 1, Math.floor(local / (dur / n)));
}

// ---------------------------------------------------------------------------
// knock-back and sidestep offsets
// ---------------------------------------------------------------------------

/** Screen-pixel offset of an entity from blows and dodges. */
export function reactionOffset(e: Ent, now: number, out: { x: number; y: number }): void {
  out.x = 0;
  out.y = 0;
  if (motion.reduced) return;
  const th = now - e.hitAt;
  if (th >= 0 && th < 300) {
    const k = Math.sin((th / 300) * Math.PI);
    const mag = (e.crit ? 4.5 : 2.6) * k;
    out.x += e.hitDx * mag;
    out.y += e.hitDy * mag * 0.5;
  }
  const td = now - e.dodgeAt;
  const dl = FRAME_MS.dodge * FRAME_COUNTS.dodge;
  if (td >= 0 && td < dl + 120) {
    const k = td < dl * 0.6 ? td / (dl * 0.6) : 1 - (td - dl * 0.6) / (dl * 0.6 + 120);
    out.x += -e.hitDx * 4.2 * Math.max(0, k);
    out.y += -e.hitDy * 2 * Math.max(0, k);
  }
  const tf = now - e.deadAt;
  if (e.deadAt > 0 && !e.bornDead && tf >= 0 && tf < 520) {
    const k = 1 - Math.pow(1 - tf / 520, 2);
    out.x += e.hitDx * 4 * k;
    out.y += e.hitDy * 2 * k;
  }
}

export const DEFAULT_ATTACK_COUNT = ATTACK_VARIANTS;

// ---------------------------------------------------------------------------
// beasts
// ---------------------------------------------------------------------------

export interface BeastPick {
  state: BeastState;
  frame: number;
  variant: number;
}

export function newBeastPick(): BeastPick {
  return { state: 'idle', frame: 0, variant: 0 };
}

/** Choose the animation of a beast / monster entity (idle fidgets are seeded per entity). */
export function pickBeast(e: Ent, now: number, moving: boolean, blight: boolean, snake: boolean, out: BeastPick): void {
  const v = e.v;
  out.variant = 0;
  const set = (s: BeastState, since: number, loop: boolean): void => {
    out.state = s;
    const n = BEAST_FRAMES[s];
    const f = Math.floor((now - since) / BEAST_MS[s]);
    out.frame = loop ? ((f % n) + n) % n : Math.max(0, Math.min(n - 1, f));
  };
  if (e.force) {
    out.state = e.force.state === 'attack' ? 'attack' : e.force.state === 'die' ? 'die' : e.force.state === 'dead' ? 'dead' : e.force.state === 'hit' ? 'hit' : e.force.state === 'walk' || e.force.state === 'run' ? 'walk' : e.force.state === 'fight' ? 'fight' : 'idle';
    out.variant = e.force.variant;
    out.frame = Math.floor((now + e.seed * 1000) / BEAST_MS[out.state]) % BEAST_FRAMES[out.state];
    return;
  }
  if (v.state === 'dead') {
    if (e.bornDead || now - e.deadAt > BEAST_MS.die * BEAST_FRAMES.die) out.state = 'dead';
    else set('die', e.deadAt, false);
    if (out.state === 'dead') out.frame = 0;
    return;
  }
  const sinceHit = now - e.hitAt;
  const sinceAtk = now - e.attackAt;
  const attacking = sinceAtk >= 0 && sinceAtk < BEAST_MS.attack * BEAST_FRAMES.attack;
  const hit = sinceHit >= 0 && sinceHit < BEAST_MS.hit * BEAST_FRAMES.hit;
  if (hit && (!attacking || e.hitAt > e.attackAt)) {
    set('hit', e.hitAt, false);
    return;
  }
  if (attacking) {
    set('attack', e.attackAt, false);
    out.variant = Math.floor(seedOf(e.id, e.attackIdx * 3 + 5) * 2);
    return;
  }
  if (moving) {
    const step = Math.max(200, Math.min(700, v.step ?? 420));
    out.state = 'walk';
    out.frame = Math.floor((now + e.seed * 1000) / (step / 5)) % BEAST_FRAMES.walk;
    return;
  }
  if (v.state === 'fight') {
    set('fight', e.fightSince + e.seed * 300, true);
    return;
  }
  set('idle', e.born + e.seed * 1700, true);
  if (motion.reduced || blight) return;
  const slotLen = 8000 + e.seed * 6000;
  const t = now + e.seed * slotLen * 2;
  const slot = slotOf(t, slotLen);
  if (seedOf(e.id, slot * 7 + 21) > 0.5) return;
  const opts: BeastState[] = snake ? ['sniff', 'stretch'] : ['sniff', 'graze', 'stretch', 'sniff'];
  const act = opts[Math.floor(seedOf(e.id, slot * 7 + 22) * opts.length)];
  const dur = BEAST_MS[act] * BEAST_FRAMES[act] * (act === 'graze' ? 2.2 : 1.4);
  const start = seedOf(e.id, slot * 7 + 23) * (slotLen - dur - 400);
  const local = t - slot * slotLen - start;
  if (local < 0 || local > dur) return;
  out.state = act;
  out.frame = Math.floor(local / BEAST_MS[act]) % BEAST_FRAMES[act];
}

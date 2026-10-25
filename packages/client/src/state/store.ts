/**
 * Central client state with a tiny keyed pub/sub. No framework: UI code reads `store.get(key)`
 * and re-renders when `subscribe(key, fn)` fires. Reducers below translate server messages.
 */
import type {
  ActiveMission,
  ChatChannel,
  ChatMsg,
  ChronicleEntry,
  CombatEvent,
  CombatReward,
  CombatView,
  EntityPatch,
  EntityView,
  InviteKind,
  MeView,
  NoteLevel,
  NpcMenu,
  SettlementView,
  TimeView,
} from '@murim/shared';
import type { DecodedWorld } from '../render/api';
import type { ConnInfo } from '../net/socket';

export const CHAT_CHANNELS: ChatChannel[] = ['local', 'world', 'sect', 'whisper', 'system'];
export const CHAT_LIMIT = 200;
export const NOTE_LIMIT = 50;
export const COMBAT_LOG_LIMIT = 150;
export const CHRONICLE_LIMIT = 200;

export interface ChatLine extends ChatMsg {
  /** Unique, increasing key for DOM reconciliation. */
  key: number;
  /** Written by the local player. */
  self?: boolean;
  /** Notes and chronicle lines mirrored into the System tab. */
  level?: NoteLevel;
}

export interface ChatTabState {
  lines: ChatLine[];
  unread: number;
}

export interface Note {
  id: number;
  level: NoteLevel;
  text: string;
  t: number;
}

export interface CombatLogEntry {
  key: number;
  beat: number;
  ev: CombatEvent;
}

export interface CombatResult {
  id: number;
  result: 'win' | 'lose' | 'fled' | 'draw';
  reward?: CombatReward;
  text: string;
  at: number;
}

export interface CombatUi {
  view: CombatView;
  log: CombatLogEntry[];
  /** Names by fighter id, kept even after a fighter leaves the view. */
  names: Record<number, string>;
  ended: CombatResult | null;
}

export interface Invite {
  key: number;
  kind: InviteKind;
  fromId: number;
  from: string;
  data?: Record<string, unknown>;
  at: number;
}

export interface StoreState {
  me: MeView | null;
  /** id -> latest EntityView (UI lookups; the renderer keeps its own copy). */
  entities: Map<number, EntityView>;
  time: TimeView | null;
  settlements: Map<number, SettlementView>;
  chronicle: ChronicleEntry[];
  chat: Record<ChatChannel, ChatTabState>;
  chatTab: ChatChannel;
  notes: Note[];
  combat: CombatUi | null;
  /** Last combat result, kept for the result banner after the fight view closes. */
  combatResult: CombatResult | null;
  npc: NpcMenu | null;
  conn: ConnInfo;
  selected: number | null;
  invites: Invite[];
  world: DecodedWorld | null;
  /** serverTime ~= Date.now() + serverOffset. */
  serverOffset: number;
  latency: number | null;
  /** Last person who whispered us, for `/r`. */
  lastWhisper: string | null;
  kicked: string | null;
}

export type StoreKey = keyof StoreState;
type Listener = (key: StoreKey) => void;

function emptyChat(): Record<ChatChannel, ChatTabState> {
  return Object.fromEntries(CHAT_CHANNELS.map((c) => [c, { lines: [], unread: 0 }])) as unknown as Record<ChatChannel, ChatTabState>;
}

export function initialState(): StoreState {
  return {
    me: null,
    entities: new Map(),
    time: null,
    settlements: new Map(),
    chronicle: [],
    chat: emptyChat(),
    chatTab: 'local',
    notes: [],
    combat: null,
    combatResult: null,
    npc: null,
    conn: { state: 'idle', attempt: 0 },
    selected: null,
    invites: [],
    world: null,
    serverOffset: 0,
    latency: null,
    lastWhisper: null,
    kicked: null,
  };
}

let keySeq = 1;
const nextKey = () => keySeq++;

/** Apply an entity patch in place. A position update without `nx` means the entity is standing still. */
export function patchEntity(e: EntityView, p: EntityPatch): void {
  // The server ends a walk with `nx = x, ny = y, step = 0`: that means "standing still", not "stepping onto itself".
  const stopped = p.step === 0;
  const moving = 'nx' in p && p.nx !== undefined && !stopped;
  if (stopped || (('x' in p || 'y' in p) && !moving)) {
    delete e.nx;
    delete e.ny;
    delete e.step;
  }
  for (const k of Object.keys(p) as (keyof EntityPatch)[]) {
    if (k === 'id') continue;
    if (stopped && (k === 'step' || k === 'nx' || k === 'ny')) continue;
    const v = p[k];
    if (v === undefined || v === null) delete (e as unknown as Record<string, unknown>)[k];
    else (e as unknown as Record<string, unknown>)[k] = v;
  }
}

export class Store {
  private s: StoreState = initialState();
  private listeners = new Map<StoreKey, Set<Listener>>();
  private anyListeners = new Set<Listener>();

  get<K extends StoreKey>(k: K): StoreState[K] {
    return this.s[k];
  }

  set<K extends StoreKey>(k: K, v: StoreState[K]): void {
    this.s[k] = v;
    this.emit(k);
  }

  /** Mutate a value in place, then notify. */
  update<K extends StoreKey>(k: K, fn: (v: StoreState[K]) => void): void {
    fn(this.s[k]);
    this.emit(k);
  }

  subscribe(keys: StoreKey | StoreKey[], fn: Listener): () => void {
    const list = Array.isArray(keys) ? keys : [keys];
    for (const k of list) {
      let set = this.listeners.get(k);
      if (!set) this.listeners.set(k, (set = new Set()));
      set.add(fn);
    }
    return () => {
      for (const k of list) this.listeners.get(k)?.delete(fn);
    };
  }

  subscribeAll(fn: Listener): () => void {
    this.anyListeners.add(fn);
    return () => this.anyListeners.delete(fn);
  }

  emit(k: StoreKey): void {
    const set = this.listeners.get(k);
    if (set) for (const fn of [...set]) fn(k);
    for (const fn of [...this.anyListeners]) fn(k);
  }

  /** Reset game state (logout / new session) but keep listeners. */
  reset(): void {
    const keys = Object.keys(this.s) as StoreKey[];
    this.s = initialState();
    for (const k of keys) this.emit(k);
  }

  // ---- Derived lookups -------------------------------------------------------

  selfId(): number | null {
    return this.s.me?.entityId ?? null;
  }

  selfEntity(): EntityView | undefined {
    const id = this.selfId();
    return id === null ? undefined : this.s.entities.get(id);
  }

  entityByName(name: string, kind?: EntityView['kind']): EntityView | undefined {
    const n = name.toLowerCase();
    for (const e of this.s.entities.values()) if (e.name.toLowerCase() === n && (!kind || e.kind === kind)) return e;
    return undefined;
  }

  /** Current HP/Qi of the local player, preferring live combat values. */
  selfVitals(): { hp: number; maxHp: number; qi: number; maxQi: number } | null {
    const me = this.s.me;
    if (!me) return null;
    const f = this.s.combat?.view.fighters.find((x) => x.id === me.entityId);
    if (f && !this.s.combat?.ended) return { hp: f.hp, maxHp: f.maxHp, qi: f.qi, maxQi: f.maxQi };
    return { hp: me.c.hp, maxHp: me.d.maxHp, qi: me.c.qi, maxQi: me.d.maxQi };
  }

  /** Estimated server clock. */
  serverNow(): number {
    return Date.now() + this.s.serverOffset;
  }

  // ---- Reducers --------------------------------------------------------------

  applyHello(msg: { you: MeView; time: TimeView; settlements: SettlementView[]; chronicle: ChronicleEntry[]; serverNow: number }): void {
    this.s.entities.clear();
    this.s.me = msg.you;
    this.s.time = msg.time;
    this.s.settlements = new Map(msg.settlements.map((v) => [v.id, v]));
    this.s.chronicle = msg.chronicle.slice(-CHRONICLE_LIMIT);
    this.s.serverOffset = msg.serverNow - Date.now();
    this.s.npc = null;
    if (!msg.you.combatId) this.s.combat = null;
    for (const k of ['entities', 'me', 'time', 'settlements', 'chronicle', 'npc', 'combat', 'serverOffset'] as StoreKey[]) this.emit(k);
  }

  applyMe(me: MeView): void {
    this.s.me = me;
    this.emit('me');
  }

  applyEnts(delta: { add?: EntityView[]; upd?: EntityPatch[]; del?: number[] }): void {
    const ents = this.s.entities;
    for (const e of delta.add ?? []) ents.set(e.id, { ...e });
    for (const p of delta.upd ?? []) {
      const e = ents.get(p.id);
      if (e) patchEntity(e, p);
    }
    let selectionGone = false;
    for (const id of delta.del ?? []) {
      ents.delete(id);
      if (id === this.s.selected) selectionGone = true;
    }
    this.emit('entities');
    if (selectionGone) this.set('selected', null);
  }

  applyTime(time: TimeView): void {
    this.set('time', time);
  }

  applySettlements(list: SettlementView[]): void {
    for (const v of list) this.s.settlements.set(v.id, v);
    this.emit('settlements');
  }

  addChronicle(entries: ChronicleEntry[]): void {
    const seen = new Set(this.s.chronicle.map((e) => e.id));
    for (const e of entries) if (!seen.has(e.id)) this.s.chronicle.push(e);
    this.s.chronicle.sort((a, b) => a.id - b.id);
    if (this.s.chronicle.length > CHRONICLE_LIMIT) this.s.chronicle.splice(0, this.s.chronicle.length - CHRONICLE_LIMIT);
    this.emit('chronicle');
  }

  /** Add a chat line to its tab (last CHAT_LIMIT kept) and bump unread unless that tab is showing. */
  addChat(msg: ChatMsg, opts: { self?: boolean; level?: NoteLevel; visible?: boolean } = {}): ChatLine {
    const line: ChatLine = { ...msg, key: nextKey(), self: opts.self, level: opts.level };
    const tab = this.s.chat[msg.ch] ?? this.s.chat.system;
    tab.lines.push(line);
    if (tab.lines.length > CHAT_LIMIT) tab.lines.splice(0, tab.lines.length - CHAT_LIMIT);
    const showing = opts.visible ?? this.s.chatTab === msg.ch;
    if (!showing && !opts.self) tab.unread++;
    if (msg.ch === 'whisper' && !opts.self && msg.from) this.s.lastWhisper = msg.from;
    this.emit('chat');
    return line;
  }

  setChatTab(ch: ChatChannel): void {
    this.s.chatTab = ch;
    this.s.chat[ch].unread = 0;
    this.emit('chat');
    this.emit('chatTab');
  }

  addNote(level: NoteLevel, text: string): Note {
    const note: Note = { id: nextKey(), level, text, t: Date.now() };
    this.s.notes.push(note);
    if (this.s.notes.length > NOTE_LIMIT) this.s.notes.splice(0, this.s.notes.length - NOTE_LIMIT);
    this.emit('notes');
    return note;
  }

  applyCombat(view: CombatView, ev: CombatEvent[]): void {
    let c = this.s.combat;
    if (!c || c.view.id !== view.id || c.ended) {
      c = { view, log: [], names: {}, ended: null };
      this.s.combat = c;
    }
    c.view = view;
    for (const f of view.fighters) c.names[f.id] = f.name;
    for (const e of ev) c.log.push({ key: nextKey(), beat: view.beat, ev: e });
    if (c.log.length > COMBAT_LOG_LIMIT) c.log.splice(0, c.log.length - COMBAT_LOG_LIMIT);
    this.emit('combat');
  }

  endCombat(msg: { id: number; result: CombatResult['result']; reward?: CombatReward; text: string }): CombatResult {
    const res: CombatResult = { ...msg, at: Date.now() };
    const c = this.s.combat;
    if (c && (c.view.id === msg.id || !c.ended)) c.ended = res;
    this.s.combatResult = res;
    this.emit('combat');
    this.emit('combatResult');
    return res;
  }

  /** Hide the combat view after the result has been shown (keeps a newer fight). */
  clearCombat(id?: number): void {
    if (!this.s.combat) return;
    if (id !== undefined && this.s.combat.view.id !== id) return;
    this.set('combat', null);
  }

  applyMission(update: ActiveMission): void {
    const me = this.s.me;
    if (!me) return;
    const list = me.c.missions;
    const i = list.findIndex((m) => m.id === update.id);
    if (i >= 0) list[i] = update;
    else list.push(update);
    this.emit('me');
  }

  addInvite(inv: Omit<Invite, 'key' | 'at'>): Invite {
    const full: Invite = { ...inv, key: nextKey(), at: Date.now() };
    // One pending invite per kind and sender.
    this.s.invites = this.s.invites.filter((i) => !(i.kind === inv.kind && i.fromId === inv.fromId));
    this.s.invites.push(full);
    this.emit('invites');
    return full;
  }

  removeInvite(key: number): void {
    this.s.invites = this.s.invites.filter((i) => i.key !== key);
    this.emit('invites');
  }
}

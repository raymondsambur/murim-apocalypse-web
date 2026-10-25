/**
 * Handler registries behind the GameContext extension points, plus a safe-invoke helper
 * so a buggy system can never crash the game loop.
 */
import type { C2S, EntityKind, MeView, QueryName, SimEvent } from '@murim/shared';
import type { CommandHandler, CommandType, Entity, EventBus, GameEvents, InteractHandler, Off, Player, QueryHandler, RegisterOptions } from '../ctx';
import type { Logger } from './log';

/** Storage type: dispatch guarantees the message matches the registered `t`. */
export type AnyCommandHandler = (p: Player, m: C2S) => void | Promise<void>;
export type AnyQueryHandler = (p: Player, args: unknown) => unknown;

interface Timer {
  due: number;
  every: number;
  fn: (now: number) => void;
  dead: boolean;
}

function addTo<T>(set: Set<T>, h: T): Off {
  set.add(h);
  return () => {
    set.delete(h);
  };
}

export class Registry {
  readonly commands = new Map<CommandType, AnyCommandHandler>();
  readonly queries = new Map<QueryName, AnyQueryHandler>();
  readonly tick = new Set<(dtMs: number, now: number) => void>();
  readonly hour = new Set<(events: SimEvent[]) => void>();
  readonly login = new Set<(p: Player) => void>();
  readonly logout = new Set<(p: Player) => void>();
  readonly buildMe = new Set<(p: Player, me: MeView) => void>();
  readonly playerSync = new Set<(p: Player, e: Entity) => void>();
  readonly save = new Set<(p: Player) => void>();
  readonly shutdown = new Set<() => void>();
  readonly interact = new Map<EntityKind, InteractHandler[]>();
  private timers: Timer[] = [];
  private readonly errorCounts = new Map<string, { count: number; since: number }>();

  constructor(
    private readonly log: Logger,
    private readonly now: () => number,
  ) {}

  command<T extends CommandType>(t: T, h: CommandHandler<T>, opts: RegisterOptions = {}): void {
    if (this.commands.has(t) && !opts.override) throw new Error(`command handler for '${t}' is already registered (pass {override: true} to replace it)`);
    this.commands.set(t, h as unknown as AnyCommandHandler);
  }

  query<N extends QueryName>(name: N, h: QueryHandler<N>, opts: RegisterOptions = {}): void {
    if (this.queries.has(name) && !opts.override) throw new Error(`query handler for '${name}' is already registered (pass {override: true} to replace it)`);
    this.queries.set(name, h as unknown as AnyQueryHandler);
  }

  onInteract(kind: EntityKind, h: InteractHandler): Off {
    const list = this.interact.get(kind) ?? [];
    list.push(h);
    this.interact.set(kind, list);
    return () => {
      const i = list.indexOf(h);
      if (i >= 0) list.splice(i, 1);
    };
  }

  onTick = (h: (dtMs: number, now: number) => void): Off => addTo(this.tick, h);
  onHour = (h: (events: SimEvent[]) => void): Off => addTo(this.hour, h);
  onLogin = (h: (p: Player) => void): Off => addTo(this.login, h);
  onLogout = (h: (p: Player) => void): Off => addTo(this.logout, h);
  onBuildMe = (h: (p: Player, me: MeView) => void): Off => addTo(this.buildMe, h);
  onPlayerSync = (h: (p: Player, e: Entity) => void): Off => addTo(this.playerSync, h);
  onSave = (h: (p: Player) => void): Off => addTo(this.save, h);
  onShutdown = (h: () => void): Off => addTo(this.shutdown, h);

  every(ms: number, fn: (now: number) => void): Off {
    const t: Timer = { due: this.now() + Math.max(1, ms), every: Math.max(1, ms), fn, dead: false };
    this.timers.push(t);
    return () => {
      t.dead = true;
    };
  }

  after(ms: number, fn: (now: number) => void): Off {
    const t: Timer = { due: this.now() + Math.max(0, ms), every: 0, fn, dead: false };
    this.timers.push(t);
    return () => {
      t.dead = true;
    };
  }

  runTimers(now: number): void {
    let anyDead = false;
    // Iterate a snapshot: timers created by callbacks start next tick.
    for (const t of this.timers.slice()) {
      if (t.dead || now < t.due) {
        anyDead ||= t.dead;
        continue;
      }
      this.safe('timer', () => t.fn(now));
      if (t.every > 0) t.due = Math.max(t.due + t.every, now - t.every);
      else {
        t.dead = true;
        anyDead = true;
      }
    }
    if (anyDead) this.timers = this.timers.filter((t) => !t.dead);
  }

  get timerCount(): number {
    return this.timers.length;
  }

  /** Run `fn`, logging (rate-limited per label) instead of throwing. */
  safe(label: string, fn: () => void): void {
    try {
      fn();
    } catch (err) {
      this.reportError(label, err);
    }
  }

  reportError(label: string, err: unknown): void {
    const now = this.now();
    let c = this.errorCounts.get(label);
    if (!c || now - c.since > 60000) {
      if (c && c.count > 5) this.log.warn(`suppressed ${c.count - 5} more errors from ${label} in the last minute`);
      c = { count: 0, since: now };
      this.errorCounts.set(label, c);
    }
    if (++c.count <= 5) this.log.error(`handler error in ${label}`, err);
  }

  each<A extends unknown[]>(label: string, set: Iterable<(...args: A) => void>, ...args: A): void {
    for (const h of set) this.safe(label, () => h(...args));
  }
}

export class SimpleEventBus implements EventBus {
  private readonly handlers = new Map<keyof GameEvents, Set<(ev: never) => void>>();

  constructor(private readonly registry: Registry) {}

  on<K extends keyof GameEvents>(type: K, h: (ev: GameEvents[K]) => void): Off {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    const fn = h as (ev: never) => void;
    set.add(fn);
    return () => {
      set.delete(fn);
    };
  }

  emit<K extends keyof GameEvents>(type: K, ev: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const h of [...set]) this.registry.safe(`event:${String(type)}`, () => (h as (e: GameEvents[K]) => void)(ev));
  }
}

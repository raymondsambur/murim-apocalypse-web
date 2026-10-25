/**
 * Typed WebSocket client: `send(C2S)`, `query(name, args)` (promise resolved by the matching `{t:'res'}`),
 * per-message-type listeners, reconnect with exponential backoff, ping/pong latency.
 */
import { CLOSE_BAD_AUTH, CLOSE_BANNED, CLOSE_REPLACED, WS_PATH, type C2S, type Queries, type QueryName, type S2C } from '@murim/shared';

/** Minimal surface of the browser WebSocket we use (the MockServer provides a fake). */
export interface SocketLike {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type SocketFactory = (url: string) => SocketLike;

export const browserSocketFactory: SocketFactory = (url) => new WebSocket(url) as unknown as SocketLike;

export function defaultSocketUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}${WS_PATH}`;
}

const OPEN = 1;

// ---------------------------------------------------------------------------
// Query bookkeeping (pure; unit tested with fake timers)
// ---------------------------------------------------------------------------

export type QueryErrorCode = 'timeout' | 'disconnected' | 'server';

export class QueryError extends Error {
  /** Machine code from the server (`not_implemented`, `not_found`...), when it sent one. */
  serverCode?: string;
  constructor(
    readonly code: QueryErrorCode,
    message: string,
    readonly query?: string,
  ) {
    super(message);
    this.name = 'QueryError';
  }
}

export interface Timers {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

interface Pending {
  name: string;
  resolve(v: unknown): void;
  reject(e: QueryError): void;
  timer: unknown;
}

export class PendingQueries {
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(
    private timeoutMs = 10000,
    private timers: Timers = realTimers,
  ) {}

  get size(): number {
    return this.pending.size;
  }

  create<T>(name: string): { id: number; promise: Promise<T> } {
    const id = this.nextId++;
    const promise = new Promise<T>((resolve, reject) => {
      const timer = this.timers.set(() => {
        if (!this.pending.delete(id)) return;
        reject(new QueryError('timeout', `query '${name}' timed out`, name));
      }, this.timeoutMs);
      this.pending.set(id, { name, resolve: resolve as (v: unknown) => void, reject, timer });
    });
    return { id, promise };
  }

  /** Resolve or reject the query matching a `{t:'res'}`. Returns false for unknown ids (late or duplicate). */
  settle(res: { id: number; ok: boolean; data?: unknown; err?: string }): boolean {
    const p = this.pending.get(res.id);
    if (!p) return false;
    this.pending.delete(res.id);
    this.timers.clear(p.timer);
    if (res.ok) p.resolve(res.data);
    else {
      // The gateway answers failures as { err: code, data: { text } }; prefer the readable sentence.
      const text = res.data && typeof res.data === 'object' && typeof (res.data as { text?: unknown }).text === 'string' ? (res.data as { text: string }).text : '';
      const err = new QueryError('server', text || res.err || 'query failed', p.name);
      err.serverCode = res.err;
      p.reject(err);
    }
    return true;
  }

  rejectAll(code: QueryErrorCode, message: string): void {
    for (const [id, p] of this.pending) {
      this.timers.clear(p.timer);
      p.reject(new QueryError(code, message, p.name));
      this.pending.delete(id);
    }
  }
}

/** Reconnect delay for attempt n (0-based): exponential with +-25% jitter, capped. */
export function backoffDelay(attempt: number, base = 500, max = 15000, rand: () => number = Math.random): number {
  const raw = Math.min(max, base * Math.pow(2, Math.max(0, attempt)));
  return Math.round(raw * (0.75 + rand() * 0.5));
}

// ---------------------------------------------------------------------------
// Socket client
// ---------------------------------------------------------------------------

export type ConnState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';
export type CloseReason = 'replaced' | 'auth' | 'banned' | 'logout' | 'kicked';

export interface ConnInfo {
  state: ConnState;
  attempt: number;
  /** Delay before the next reconnect attempt, ms. */
  retryIn?: number;
  reason?: CloseReason;
  code?: number;
}

type Handler<T extends S2C['t']> = (msg: Extract<S2C, { t: T }>) => void;

export interface GameSocketOptions {
  url?: string;
  factory?: SocketFactory;
  queryTimeoutMs?: number;
  pingMs?: number;
  /** Give up reconnecting after this many attempts (default: never). */
  maxAttempts?: number;
}

export class GameSocket {
  private ws: SocketLike | null = null;
  private handlers = new Map<string, Set<(msg: S2C) => void>>();
  private anyHandlers = new Set<(msg: S2C) => void>();
  private stateHandlers = new Set<(info: ConnInfo) => void>();
  private queries: PendingQueries;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private kickedReason: CloseReason | null = null;
  private info: ConnInfo = { state: 'idle', attempt: 0 };
  private readonly url: string;
  private readonly factory: SocketFactory;
  private readonly pingMs: number;
  private readonly maxAttempts: number;

  /** Round-trip latency of the last ping, ms. */
  latency: number | null = null;
  /** serverTime ~= Date.now() + serverOffset. */
  serverOffset = 0;

  constructor(opts: GameSocketOptions = {}) {
    this.url = opts.url ?? defaultSocketUrl();
    this.factory = opts.factory ?? browserSocketFactory;
    this.queries = new PendingQueries(opts.queryTimeoutMs ?? 10000);
    this.pingMs = opts.pingMs ?? 5000;
    this.maxAttempts = opts.maxAttempts ?? Infinity;
  }

  get state(): ConnInfo {
    return this.info;
  }

  get isOpen(): boolean {
    return !!this.ws && this.ws.readyState === OPEN && this.info.state === 'open';
  }

  connect(): void {
    this.stopped = false;
    this.kickedReason = null;
    this.open();
  }

  /** Close for good (logout / screen teardown). */
  close(reason: CloseReason = 'logout'): void {
    this.stopped = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onclose = ws.onmessage = ws.onerror = ws.onopen = null;
      try {
        ws.close(1000, reason);
      } catch {
        /* ignore */
      }
    }
    this.queries.rejectAll('disconnected', 'socket closed');
    this.setState({ state: 'closed', attempt: 0, reason });
  }

  /** Force an immediate reconnect attempt (used by the "Retry now" button). */
  retryNow(): void {
    if (this.stopped || this.info.state === 'open' || this.info.state === 'connecting') return;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.open();
  }

  send(msg: C2S): boolean {
    if (!this.ws || this.ws.readyState !== OPEN) return false;
    this.ws.send(JSON.stringify(msg));
    return true;
  }

  query<N extends QueryName>(name: N, args: Queries[N]['args']): Promise<Queries[N]['res']> {
    if (!this.isOpen) return Promise.reject(new QueryError('disconnected', 'not connected', name));
    const { id, promise } = this.queries.create<Queries[N]['res']>(name);
    this.send({ t: 'q', id, name, args });
    return promise;
  }

  on<T extends S2C['t']>(t: T, fn: Handler<T>): () => void {
    let set = this.handlers.get(t);
    if (!set) this.handlers.set(t, (set = new Set()));
    const h = fn as (msg: S2C) => void;
    set.add(h);
    return () => set!.delete(h);
  }

  onAny(fn: (msg: S2C) => void): () => void {
    this.anyHandlers.add(fn);
    return () => this.anyHandlers.delete(fn);
  }

  onState(fn: (info: ConnInfo) => void): () => void {
    this.stateHandlers.add(fn);
    return () => this.stateHandlers.delete(fn);
  }

  // -------------------------------------------------------------------------

  private setState(info: ConnInfo): void {
    this.info = info;
    for (const fn of this.stateHandlers) fn(info);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }

  private open(): void {
    this.clearTimers();
    this.setState({ state: this.attempt === 0 ? 'connecting' : 'reconnecting', attempt: this.attempt });
    let ws: SocketLike;
    try {
      ws = this.factory(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.attempt = 0;
      this.setState({ state: 'open', attempt: 0 });
      this.ping();
      this.pingTimer = setInterval(() => this.ping(), this.pingMs);
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this.receive(ev.data);
    };
    ws.onerror = () => {
      /* onclose follows */
    };
    ws.onclose = (ev) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = null;
      this.queries.rejectAll('disconnected', 'connection lost');
      if (this.stopped) return;
      const reason = closeReason(ev.code) ?? this.kickedReason;
      if (reason) {
        this.stopped = true;
        this.setState({ state: 'closed', attempt: 0, reason, code: ev.code });
        return;
      }
      this.scheduleReconnect(ev.code);
    };
  }

  private scheduleReconnect(code?: number): void {
    if (this.attempt >= this.maxAttempts) {
      this.stopped = true;
      this.setState({ state: 'closed', attempt: this.attempt, code });
      return;
    }
    const delay = backoffDelay(this.attempt);
    this.attempt++;
    this.setState({ state: 'reconnecting', attempt: this.attempt, retryIn: delay, code });
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private ping(): void {
    this.send({ t: 'ping', t0: Date.now() });
  }

  private receive(data: unknown): void {
    let msg: S2C;
    try {
      msg = JSON.parse(typeof data === 'string' ? data : String(data)) as S2C;
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object' || typeof (msg as { t?: unknown }).t !== 'string') return;
    if (msg.t === 'res') {
      this.queries.settle(msg);
      return;
    }
    if (msg.t === 'pong') {
      const now = Date.now();
      this.latency = Math.max(0, now - msg.t0);
      this.serverOffset = msg.now - (msg.t0 + now) / 2;
    } else if (msg.t === 'hello') {
      this.serverOffset = msg.serverNow - Date.now();
    } else if (msg.t === 'kick') {
      this.kickedReason = 'kicked';
    }
    for (const fn of this.anyHandlers) fn(msg);
    const set = this.handlers.get(msg.t);
    if (set) for (const fn of set) fn(msg);
  }
}

export function closeReason(code: number): CloseReason | null {
  if (code === CLOSE_REPLACED) return 'replaced';
  if (code === CLOSE_BAD_AUTH) return 'auth';
  if (code === CLOSE_BANNED) return 'banned';
  return null;
}

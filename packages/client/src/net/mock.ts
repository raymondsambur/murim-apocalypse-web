/**
 * Dev-only MockServer (`?mock=1`): an in-memory stand-in for the HTTP API and the WebSocket gateway, good enough to
 * exercise every screen without the real server. Accounts and characters persist in localStorage so a refresh keeps
 * you logged in. It is loaded with a dynamic import from main.ts and never ships in the normal flow.
 *
 * Debug handle: `window.__mock` -> { drop(), kick(reason), game, reset() }.
 */
import {
  REROLLS,
  Rng,
  ORIGINS,
  TALENTS,
  clampLook,
  generateWorld,
  newCharacterSave,
  randomLook,
  rollCharacter,
  type AuthRequest,
  type C2S,
  type CharacterBrief,
  type CharacterSave,
  type CreateCharacterRequest,
  type Look,
  type MeResponse,
  type RollPreview,
  type S2C,
  type WorldData,
  type WorldPayload,
} from '@murim/shared';
import type { HttpResponse, HttpTransport } from './api';
import { encodeBase64 } from './base64';
import { MockGame } from './mockGame';
import type { SocketFactory, SocketLike } from './socket';

const STORE_KEY = 'murim.mock.db.v1';
const WORLD_SEED = 1337;

interface MockUser {
  id: number;
  username: string;
  password: string;
  character: CharacterSave | null;
  pending: { preview: RollPreview; rerollsLeft: number } | null;
}

interface MockDb {
  users: MockUser[];
  session: number | null;
  nextId: number;
}

export interface MockOptions {
  seed?: number;
  /** Faster world clock and shorter latencies. */
  fast?: boolean;
  /** Fake network latency in ms (default 25). */
  latency?: number;
}

export interface MockServer {
  transport: HttpTransport;
  socketFactory: SocketFactory;
  /** Simulate a dropped connection (the client should reconnect). */
  drop(code?: number): void;
  /** Send `kick` and close. */
  kick(reason?: string): void;
  /** Make the next N websocket connections fail (to exercise "reconnecting"). */
  failNext(n: number): void;
  reset(): void;
  readonly game: MockGame | null;
}

function load(): MockDb {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw) as MockDb;
  } catch {
    /* fall through */
  }
  return { users: [], session: null, nextId: 1 };
}

export function installMock(opts: MockOptions = {}): MockServer {
  let db = load();
  const latency = opts.latency ?? 25;
  let world: WorldData | null = null;
  let worldPayload: WorldPayload | null = null;
  let game: MockGame | null = null;
  let activeSocket: MockSocket | null = null;
  let failures = 0;

  const save = () => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(db));
    } catch {
      /* storage unavailable: the mock then forgets everything on reload */
    }
  };
  const user = () => db.users.find((u) => u.id === db.session) ?? null;

  const getWorld = (): WorldData => (world ??= generateWorld(opts.seed ?? WORLD_SEED));
  const getPayload = (): WorldPayload => {
    if (worldPayload) return worldPayload;
    const w = getWorld();
    return (worldPayload = {
      seed: w.seed,
      w: w.w,
      h: w.h,
      terrain: encodeBase64(w.terrain),
      objects: encodeBase64(w.objects),
      settlements: w.settlements,
      buildings: w.buildings,
      nodes: w.nodes,
      roads: w.roads,
    });
  };

  // ---- HTTP -----------------------------------------------------------------------------------------
  const ok = (body: unknown, status = 200): HttpResponse => ({ status, body });
  const err = (status: number, error: string): HttpResponse => ({ status, body: { error } });

  const meResponse = (u: MockUser): MeResponse => {
    const brief: CharacterBrief | null = u.character ? { id: u.character.id, name: u.character.name, level: u.character.level, look: u.character.look } : null;
    return { user: { id: u.id, username: u.username }, character: brief, rerollsLeft: u.pending ? u.pending.rerollsLeft : REROLLS };
  };

  const makePreview = (rerollsLeft: number): RollPreview => {
    const rng = new Rng((Math.random() * 0x7fffffff) | 0);
    const roll = rollCharacter(rng);
    const origin = ORIGINS[roll.origin];
    return {
      roll,
      talents: roll.talents.map((id) => ({ id, name: TALENTS[id].name, desc: TALENTS[id].desc, positive: TALENTS[id].positive })),
      origin: { id: origin.id, name: origin.name, desc: origin.desc, gold: origin.gold, items: origin.items.map((i) => i.id), skills: origin.skills },
      look: randomLook(rng),
      rerollsLeft,
    };
  };

  const handle = (method: 'GET' | 'POST', path: string, body: unknown): HttpResponse => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (method === 'GET' && path === '/api/me') {
      const u = user();
      return u ? ok(meResponse(u)) : err(401, 'unauthorized');
    }
    if (method === 'POST' && (path === '/api/register' || path === '/api/login')) {
      const req = b as unknown as AuthRequest;
      const username = String(req.username ?? '');
      const password = String(req.password ?? '');
      if (path === '/api/register') {
        if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return err(400, 'invalid_username');
        if (password.length < 8 || password.length > 72) return err(400, 'invalid_password');
        if (db.users.some((u) => u.username.toLowerCase() === username.toLowerCase())) return err(409, 'username_taken');
        const u: MockUser = { id: db.nextId++, username, password, character: null, pending: null };
        db.users.push(u);
        db.session = u.id;
        save();
        return ok(meResponse(u));
      }
      const u = db.users.find((x) => x.username.toLowerCase() === username.toLowerCase());
      if (!u || u.password !== password) return err(401, 'bad_credentials');
      db.session = u.id;
      save();
      return ok(meResponse(u));
    }
    if (method === 'POST' && path === '/api/logout') {
      db.session = null;
      save();
      return ok({ ok: true });
    }
    const u = user();
    if (!u) return err(401, 'unauthorized');
    if (method === 'POST' && path === '/api/character/roll') {
      if (u.character) return err(409, 'has_character');
      const wantReroll = b.reroll === true;
      if (!u.pending) u.pending = { preview: makePreview(REROLLS), rerollsLeft: REROLLS };
      else if (wantReroll) {
        if (u.pending.rerollsLeft <= 0) return err(409, 'no_rerolls');
        const left = u.pending.rerollsLeft - 1;
        u.pending = { preview: makePreview(left), rerollsLeft: left };
      }
      save();
      return ok({ ...u.pending.preview, rerollsLeft: u.pending.rerollsLeft });
    }
    if (method === 'POST' && path === '/api/character/create') {
      if (u.character) return err(409, 'has_character');
      if (!u.pending) return err(409, 'no_roll');
      const req = b as unknown as CreateCharacterRequest;
      const name = String(req.name ?? '').trim().replace(/\s+/g, ' ');
      if (!/^[A-Za-z][A-Za-z0-9' -]{2,15}$/.test(name)) return err(400, 'invalid_name');
      if (db.users.some((x) => x.character && x.character.name.toLowerCase() === name.toLowerCase())) return err(409, 'name_taken');
      const w = getWorld();
      const roll = u.pending.preview.roll;
      const origin = ORIGINS[roll.origin];
      const home = w.settlements.find((s) => origin.homeKinds.includes(s.kind)) ?? w.settlements[0];
      const look: Look = clampLook(req.look);
      u.character = newCharacterSave({ id: u.id, name, look, roll, homeSettlement: home.id, spawn: home.spawn, now: Date.now(), rerolls: u.pending.rerollsLeft });
      u.pending = null;
      save();
      return ok({ ok: true });
    }
    if (method === 'GET' && path === '/api/world') return ok(getPayload());
    return err(404, 'not_found');
  };

  const transport: HttpTransport = {
    request: (method, path, body) =>
      new Promise((resolve) => {
        // JSON round trip so the client never shares object identity with the mock's state.
        const clean = body === undefined ? undefined : JSON.parse(JSON.stringify(body));
        setTimeout(() => {
          const res = handle(method, path, clean);
          resolve({ status: res.status, body: JSON.parse(JSON.stringify(res.body ?? null)) });
        }, latency);
      }),
  };

  // ---- WebSocket -----------------------------------------------------------------------------------------
  class MockSocket implements SocketLike {
    readyState = 0;
    onopen: ((ev: unknown) => void) | null = null;
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onclose: ((ev: { code: number; reason: string }) => void) | null = null;
    onerror: ((ev: unknown) => void) | null = null;
    private closed = false;

    constructor() {
      setTimeout(() => {
        if (this.closed) return;
        const u = user();
        if (failures > 0) {
          failures--;
          return this.finish(1006, 'mock failure');
        }
        if (!u?.character) return this.finish(4002, 'auth');
        if (activeSocket && activeSocket !== this) activeSocket.finish(4001, 'replaced');
        activeSocket = this;
        this.readyState = 1;
        this.onopen?.({});
        game?.stop();
        const owner = u;
        game = new MockGame({
          world: getWorld(),
          save: owner.character!,
          username: owner.username,
          fast: opts.fast,
          peer: { send: (m) => this.deliver(m) },
          persist: (s) => {
            owner.character = s;
            save();
          },
        });
        game.start();
      }, latency);
    }

    deliver(msg: S2C): void {
      const data = JSON.stringify(msg);
      setTimeout(() => {
        if (!this.closed && this.readyState === 1) this.onmessage?.({ data });
      }, Math.max(1, Math.round(latency / 2)));
    }

    send(data: string): void {
      if (this.readyState !== 1) return;
      let msg: C2S;
      try {
        msg = JSON.parse(data) as C2S;
      } catch {
        return;
      }
      setTimeout(() => {
        if (!this.closed) game?.handle(msg);
      }, Math.max(1, Math.round(latency / 2)));
    }

    close(code = 1000, reason = ''): void {
      this.finish(code, reason, true);
    }

    finish(code: number, reason: string, silent = false): void {
      if (this.closed) return;
      this.closed = true;
      this.readyState = 3;
      if (activeSocket === this) {
        activeSocket = null;
        game?.stop();
        game = null;
      }
      if (!silent) setTimeout(() => this.onclose?.({ code, reason }), 0);
    }
  }

  const server: MockServer = {
    transport,
    socketFactory: () => new MockSocket(),
    drop(code = 1006) {
      activeSocket?.finish(code, 'mock drop');
    },
    kick(reason = 'You were removed by a moderator (mock).') {
      const s = activeSocket;
      if (!s) return;
      s.deliver({ t: 'kick', reason });
      setTimeout(() => s.finish(1000, 'kicked'), 120);
    },
    failNext(n) {
      failures = n;
    },
    reset() {
      activeSocket?.finish(1000, 'reset', true);
      db = { users: [], session: null, nextId: 1 };
      try {
        localStorage.removeItem(STORE_KEY);
      } catch {
        /* ignore */
      }
    },
    get game() {
      return game;
    },
  };
  (window as unknown as { __mock?: MockServer }).__mock = server;
  return server;
}

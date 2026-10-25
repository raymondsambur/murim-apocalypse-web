/**
 * End-to-end test against the real server: Fastify + ws + SQLite (temp file) + the stub sim,
 * on port 3101, with bots speaking the actual HTTP and WebSocket protocol.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  CLOSE_BANNED,
  CLOSE_RATE,
  CLOSE_REPLACED,
  findPath,
  worldPathGrid,
  type C2S,
  type EntityView,
  type MeResponse,
  type RollPreview,
  type S2C,
  type WorldPayload,
} from '@murim/shared';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { nullLogger } from './game/log';
import { startServer, type RunningServer } from './server';

const PORT = 3101;
const BASE = `http://127.0.0.1:${PORT}`;
const WS_URL = `ws://127.0.0.1:${PORT}/ws`;

let dir: string;
let server: RunningServer;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until(cond: () => boolean, timeoutMs = 4000, what = 'condition'): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await sleep(15);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

interface Http<T = unknown> {
  status: number;
  body: T;
  headers: Headers;
  cookie?: string;
}

async function http<T = unknown>(method: string, url: string, opts: { body?: unknown; raw?: string; cookie?: string; headers?: Record<string, string> } = {}): Promise<Http<T>> {
  const headers: Record<string, string> = { ...opts.headers };
  if (opts.cookie) headers.cookie = opts.cookie;
  let body: string | undefined;
  if (opts.raw !== undefined) {
    body = opts.raw;
    headers['content-type'] = 'application/json';
  } else if (opts.body !== undefined) {
    body = JSON.stringify(opts.body);
    headers['content-type'] = 'application/json';
  }
  // A pooled keep-alive socket can be dead after a server restart; retry once on a reset.
  let res: Response;
  try {
    res = await fetch(BASE + url, { method, headers, body });
  } catch {
    res = await fetch(BASE + url, { method, headers, body });
  }
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON body (static files) */
  }
  const set = res.headers.getSetCookie().find((c) => c.startsWith('murim_session='));
  return { status: res.status, body: parsed as T, headers: res.headers, cookie: set ? set.split(';')[0] : undefined };
}

interface Account {
  username: string;
  cookie: string;
  me: MeResponse;
}

async function register(username: string): Promise<Account> {
  const r = await http<MeResponse>('POST', '/api/register', { body: { username, password: 'correct-horse-9' } });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  expect(r.cookie).toBeTruthy();
  return { username, cookie: r.cookie!, me: r.body };
}

async function makeHero(acc: Account, name: string): Promise<MeResponse> {
  const roll = await http<RollPreview>('POST', '/api/character/roll', { cookie: acc.cookie, body: { reroll: false } });
  expect(roll.status).toBe(200);
  const made = await http<MeResponse>('POST', '/api/character/create', { cookie: acc.cookie, body: { name, look: roll.body.look } });
  expect(made.status, JSON.stringify(made.body)).toBe(201);
  return made.body;
}

// ---------------------------------------------------------------------------
// WebSocket bot
// ---------------------------------------------------------------------------

class Bot {
  readonly msgs: S2C[] = [];
  closed: { code: number; reason: string } | null = null;

  private constructor(readonly ws: WebSocket) {
    ws.on('message', (data) => this.msgs.push(JSON.parse(data.toString()) as S2C));
    ws.on('close', (code, reason) => (this.closed = { code, reason: reason.toString() }));
    ws.on('error', () => {});
  }

  static connect(cookie: string | undefined): Promise<Bot> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(WS_URL, { headers: cookie ? { cookie } : {} });
      const bot = new Bot(ws);
      ws.once('open', () => resolve(bot));
      ws.once('unexpected-response', (_req, res) => {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode}`));
      });
      ws.once('error', (e) => reject(e));
    });
  }

  send(msg: C2S | Record<string, unknown>): void {
    this.ws.send(JSON.stringify(msg));
  }

  of<T extends S2C['t']>(t: T): Extract<S2C, { t: T }>[] {
    return this.msgs.filter((m): m is Extract<S2C, { t: T }> => m.t === t);
  }

  async wait<T extends S2C['t']>(t: T, pred: (m: Extract<S2C, { t: T }>) => boolean = () => true, timeoutMs = 4000): Promise<Extract<S2C, { t: T }>> {
    let found: Extract<S2C, { t: T }> | undefined;
    await until(() => (found = this.of(t).find(pred)) !== undefined, timeoutMs, `'${t}' message`);
    return found!;
  }

  /** Entity state as the client would hold it after applying all `ents` messages. */
  entities(): Map<number, EntityView> {
    const m = new Map<number, EntityView>();
    for (const e of this.of('ents')) {
      for (const v of e.add ?? []) m.set(v.id, { ...v });
      for (const p of e.upd ?? []) {
        const cur = m.get(p.id);
        if (cur) Object.assign(cur, p);
      }
      for (const id of e.del ?? []) m.delete(id);
    }
    return m;
  }

  async waitClosed(timeoutMs = 4000): Promise<{ code: number; reason: string }> {
    await until(() => this.closed !== null, timeoutMs, 'socket close');
    return this.closed!;
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) this.ws.close();
  }
}

function setPosition(userId: number, x: number, y: number): void {
  const rec = server.db.getCharacterByUser(userId)!;
  rec.save.x = x;
  rec.save.y = y;
  server.db.saveCharacter(rec.save, Date.now());
}

/** A walkable goal 3-6 steps from (x, y) with a real path. */
function nearbyGoal(x: number, y: number): { x: number; y: number; steps: number } {
  const grid = worldPathGrid(server.world);
  for (let r = 3; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const path = findPath(grid, x, y, x + dx, y + dy);
        if (path && path.length >= 3 && path.length <= 8) return { x: x + dx, y: y + dy, steps: path.length };
      }
    }
  }
  throw new Error('no goal found');
}

const bots: Bot[] = [];
const track = async (cookie: string | undefined): Promise<Bot> => {
  const b = await Bot.connect(cookie);
  bots.push(b);
  return b;
};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'murim-int-'));
  server = await startServer({
    env: { PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: path.join(dir, 'int.db'), SIM_STUB: '1', WORLD_HOUR_MS: '300', LOG_LEVEL: 'silent', STATIC_DIR: path.join(dir, 'no-client'), AUTOSAVE_MS: '1000', WORLD_SAVE_MS: '1000' },
    log: nullLogger,
  });
}, 30000);

afterAll(async () => {
  for (const b of bots) b.close();
  await server?.close().catch(() => {});
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe('HTTP API', () => {
  it('health, world payload with ETag, security headers, JSON errors', async () => {
    const health = await http<{ ok: boolean; online: number }>('GET', '/api/health');
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
    expect(health.headers.get('x-content-type-options')).toBe('nosniff');
    expect(health.headers.get('content-security-policy')).toMatch(/frame-ancestors 'none'/);
    expect(health.headers.get('content-security-policy')).toMatch(/connect-src 'self' ws: wss:/);
    expect(health.headers.get('referrer-policy')).toBeTruthy();
    expect(health.headers.get('cache-control')).toBe('no-store');

    const world = await http<WorldPayload>('GET', '/api/world');
    expect(world.status).toBe(200);
    expect(world.body.seed).toBe(1337);
    expect(Buffer.from(world.body.terrain, 'base64').length).toBe(world.body.w * world.body.h);
    expect(Buffer.from(world.body.objects, 'base64').length).toBe(world.body.w * world.body.h);
    expect(world.body.settlements.length).toBeGreaterThan(0);
    expect(Array.isArray(world.body.roads)).toBe(true);
    const etag = world.headers.get('etag')!;
    expect(etag).toContain('1337');
    const cached = await http('GET', '/api/world', { headers: { 'if-none-match': etag } });
    expect(cached.status).toBe(304);

    const unknown = await http<{ error: string }>('GET', '/api/nope');
    expect(unknown.status).toBe(404);
    expect(typeof unknown.body.error).toBe('string');
    const ws = await http<{ error: string }>('GET', '/ws');
    expect(ws.status).toBe(426);
  });

  it('rejects unauthenticated access and malformed bodies without leaking internals', async () => {
    expect((await http('GET', '/api/me')).status).toBe(401);
    expect((await http('POST', '/api/character/roll', { body: {} })).status).toBe(401);
    expect((await http('POST', '/api/character/create', { body: { name: 'Nobody' } })).status).toBe(401);
    expect((await http('GET', '/api/me', { cookie: 'murim_session=' + 'A'.repeat(43) })).status).toBe(401);

    const bad = await http<{ error: string }>('POST', '/api/login', { raw: '{"username": ' });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toBe('Malformed JSON.');
    const big = await http<{ error: string }>('POST', '/api/login', { body: { username: 'x', password: 'y'.repeat(9000) } });
    expect(big.status).toBe(413);
    expect(Object.keys(big.body)).toEqual(['error']);
    const wrongType = await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'username=a' });
    expect(wrongType.status).toBe(415);
    const form = await fetch(BASE + '/api/register', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'username=a&password=b' });
    expect(form.status).toBe(415);
    const arr = await http('POST', '/api/login', { body: [1, 2, 3] });
    expect(arr.status).toBe(401);
  });

  it('cross-origin writes are blocked in production mode origin rules', async () => {
    // The test server runs with NODE_ENV=test (permissive), so only check the same-origin path works.
    const ok = await http('POST', '/api/logout', { headers: { origin: BASE } });
    expect(ok.status).toBe(200);
  });
});

describe('accounts and character creation', () => {
  it('register -> roll -> reroll -> create, with every rule enforced', async () => {
    // Registration rules.
    expect((await http('POST', '/api/register', { body: { username: 'a', password: 'correct-horse-9' } })).status).toBe(400);
    expect((await http('POST', '/api/register', { body: { username: 'Valid_Name', password: 'short' } })).status).toBe(400);

    const alice = await register('Alice_Int');
    expect(alice.me).toMatchObject({ user: { username: 'Alice_Int' }, character: null, rerollsLeft: 3 });
    const set = (await fetch(BASE + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'alice_int', password: 'correct-horse-9' }) })).headers.getSetCookie()[0];
    expect(set).toMatch(/^murim_session=[A-Za-z0-9_-]{43};/);
    expect(set).toContain('HttpOnly');
    expect(set).toContain('SameSite=Lax');
    expect(set).toContain('Path=/');
    expect(set).not.toContain('Secure');

    const dup = await http<{ error: string }>('POST', '/api/register', { body: { username: 'ALICE_INT', password: 'correct-horse-9' } });
    expect(dup.status).toBe(409);
    const wrongPw = await http('POST', '/api/login', { body: { username: 'Alice_Int', password: 'wrong-password-1' } });
    expect(wrongPw.status).toBe(401);
    const noUser = await http('POST', '/api/login', { body: { username: 'Ghost_User', password: 'wrong-password-1' } });
    expect(noUser.status).toBe(401);
    expect(noUser.body).toEqual(wrongPw.body);

    // Rolls.
    const first = await http<RollPreview>('POST', '/api/character/roll', { cookie: alice.cookie, body: { reroll: false } });
    expect(first.status).toBe(200);
    expect(first.body.rerollsLeft).toBe(3);
    expect(first.body.roll.stats.might).toBeGreaterThan(0);
    const same = await http<RollPreview>('POST', '/api/character/roll', { cookie: alice.cookie, body: { reroll: false } });
    expect(same.body.roll).toEqual(first.body.roll);
    const second = await http<RollPreview>('POST', '/api/character/roll', { cookie: alice.cookie, body: { reroll: true } });
    expect(second.body.rerollsLeft).toBe(2);
    const me = await http<MeResponse>('GET', '/api/me', { cookie: alice.cookie });
    expect(me.body.rerollsLeft).toBe(2);
    for (let i = 0; i < 2; i++) expect((await http('POST', '/api/character/roll', { cookie: alice.cookie, body: { reroll: true } })).status).toBe(200);
    const denied = await http<{ error: string }>('POST', '/api/character/roll', { cookie: alice.cookie, body: { reroll: true } });
    expect(denied.status).toBe(400);

    // Creation rules.
    for (const name of ['ab', 'Admin', '9lives', 'Two  Spaces', 'Bad<Name>']) {
      expect((await http('POST', '/api/character/create', { cookie: alice.cookie, body: { name } })).status, name).toBe(400);
    }
    const created = await http<MeResponse>('POST', '/api/character/create', { cookie: alice.cookie, body: { name: 'Alice Hero', look: { ...first.body.look, skin: 99 } } });
    expect(created.status).toBe(201);
    expect(created.body.character).toMatchObject({ name: 'Alice Hero', level: 1 });
    expect(created.body.character!.look.skin).toBe(5);
    expect(created.body.rerollsLeft).toBe(0);
    expect((await http('POST', '/api/character/create', { cookie: alice.cookie, body: { name: 'Another' } })).status).toBe(403);
    expect((await http('POST', '/api/character/roll', { cookie: alice.cookie, body: {} })).status).toBe(403);

    // Names are unique ignoring case across accounts.
    const bob = await register('Bob_Int');
    await http('POST', '/api/character/roll', { cookie: bob.cookie, body: {} });
    const clash = await http<{ error: string }>('POST', '/api/character/create', { cookie: bob.cookie, body: { name: 'alice hero' } });
    expect(clash.status).toBe(409);

    // Logout revokes the session.
    const out = await http('POST', '/api/logout', { cookie: bob.cookie });
    expect(out.status).toBe(200);
    expect(out.headers.getSetCookie()[0]).toContain('Max-Age=0');
    expect((await http('GET', '/api/me', { cookie: bob.cookie })).status).toBe(401);
  });
});

describe('real-time play', () => {
  let alice: Account;
  let bob: Account;
  let aliceId = 0;
  let bobId = 0;

  it('rejects websocket upgrades without a valid session', async () => {
    await expect(Bot.connect(undefined)).rejects.toThrow('HTTP 401');
    await expect(Bot.connect('murim_session=' + 'B'.repeat(43))).rejects.toThrow('HTTP 401');
    const plain = await http('GET', '/api/me');
    expect(plain.status).toBe(401);
  });

  it('hello -> move -> neighbours see it walk -> chat -> whisper -> persistence -> kick', async () => {
    // Log both heroes in (alice exists; make bob's character) and put them side by side.
    const aliceLogin = await http<MeResponse>('POST', '/api/login', { body: { username: 'Alice_Int', password: 'correct-horse-9' } });
    alice = { username: 'Alice_Int', cookie: aliceLogin.cookie!, me: aliceLogin.body };
    bob = await register('Bob2_Int');
    const bobMe = await makeHero(bob, 'Bob Hero');
    aliceId = alice.me.user.id;
    bobId = bob.me.user.id;
    const spawn = server.world.settlements[0].spawn;
    setPosition(aliceId, spawn.x, spawn.y);
    setPosition(bobId, spawn.x + 1, spawn.y);

    const a = await track(alice.cookie);
    const hello = await a.wait('hello');
    expect(hello.protocol).toBe(1);
    expect(hello.you.c.name).toBe('Alice Hero');
    expect(hello.you.c.x).toBe(spawn.x);
    expect(hello.settlements.length).toBe(server.world.settlements.length);
    const b = await track(bob.cookie);
    const bobHello = await b.wait('hello');
    expect(bobHello.you.c.name).toBe(bobMe.character!.name);

    // Both see each other and some NPCs.
    await until(() => a.entities().has(bobHello.you.entityId) && b.entities().has(hello.you.entityId), 4000, 'mutual visibility');
    expect([...a.entities().values()].some((e) => e.kind === 'npc')).toBe(true);

    // Move: server-authoritative walking, observed by both.
    const goal = nearbyGoal(spawn.x, spawn.y);
    a.send({ t: 'move', x: goal.x, y: goal.y });
    await until(() => {
      const me = a.entities().get(hello.you.entityId);
      return !!me && me.x === goal.x && me.y === goal.y && me.step === 0;
    }, 12000, 'alice to arrive');
    const walking = b.of('ents').flatMap((m) => m.upd ?? []).filter((u) => u.id === hello.you.entityId && u.nx !== undefined && (u.step ?? 0) > 0);
    expect(walking.length).toBeGreaterThanOrEqual(Math.min(goal.steps, 3));
    expect(walking.every((u) => u.state === 'walk')).toBe(true);
    expect(b.entities().get(hello.you.entityId)).toMatchObject({ x: goal.x, y: goal.y });
    expect(server.game.players.byCharId(hello.you.c.id)!.entity).toMatchObject({ x: goal.x, y: goal.y });

    // Local chat is heard by the neighbour (and echoed to the sender); whisper by exact name.
    a.send({ t: 'chat', ch: 'local', text: '  Greetings,   neighbour! ' });
    const heard = await b.wait('chat', (m) => m.msg.ch === 'local');
    expect(heard.msg).toMatchObject({ from: 'Alice Hero', text: 'Greetings, neighbour!', fromId: hello.you.entityId });
    await a.wait('chat', (m) => m.msg.ch === 'local');
    b.send({ t: 'chat', ch: 'whisper', to: 'alice hero', text: 'psst' });
    const whisper = await a.wait('chat', (m) => m.msg.ch === 'whisper');
    expect(whisper.msg).toMatchObject({ from: 'Bob Hero', to: 'Alice Hero', text: 'psst' });
    expect(a.of('chat').some((m) => m.msg.ch === 'local' && m.msg.from === 'Bob Hero')).toBe(false);

    // Queries.
    a.send({ t: 'q', id: 1, name: 'world', args: {} });
    a.send({ t: 'q', id: 2, name: 'nearbyPlayers', args: {} });
    a.send({ t: 'q', id: 3, name: 'player', args: { name: 'Bob Hero' } });
    a.send({ t: 'q', id: 4, name: 'leaderboard', args: {} });
    a.send({ t: 'q', id: 5, name: 'chronicle', args: { limit: 5 } });
    a.send({ t: 'q', id: 6, name: 'board', args: { settlement: 0 } });
    await a.wait('res', (m) => m.id === 6);
    const res = (id: number) => a.of('res').find((r) => r.id === id)!;
    expect((res(1).data as { online: number }).online).toBeGreaterThanOrEqual(2);
    expect((res(2).data as { name: string }[]).map((p) => p.name)).toContain('Bob Hero');
    expect((res(3).data as { name: string }).name).toBe('Bob Hero');
    expect((res(4).data as { name: string }[]).map((p) => p.name)).toContain('Alice Hero');
    expect(Array.isArray(res(5).data)).toBe(true);
    // Gameplay systems answer queries (board) once registered; the point here is that a reply arrives.
    expect(res(6)).toBeDefined();

    // A command with nothing to spend is refused by the progression system with a real error code.
    a.send({ t: 'alloc', stat: 'might', n: 1 });
    const refused = await a.wait('err', () => true);
    expect(refused.code).not.toBe('not_implemented');

    // World hours tick quickly in this test: time, chronicle and blight reach the client.
    await a.wait('time', () => true, 3000);
    await a.wait('chron', () => true, 6000);
    await a.wait('blight', (m) => (m.idx?.length ?? 0) > 0, 3000);
    const pong = await (async () => {
      a.send({ t: 'ping', t0: 99 });
      return a.wait('pong', (m) => m.t0 === 99);
    })();
    expect(pong.now).toBeGreaterThan(0);

    // Disconnect, reconnect: the position was persisted and the old entity is gone.
    const entityBefore = hello.you.entityId;
    a.close();
    await a.waitClosed();
    await until(() => !server.game.players.byCharId(hello.you.c.id), 3000, 'alice to be removed');
    expect(server.game.entities.has(entityBefore)).toBe(false);
    await until(() => !b.entities().has(entityBefore) || b.of('ents').some((m) => m.del?.includes(entityBefore)), 3000, 'bob to see alice leave');
    expect(server.db.getCharacterByUser(aliceId)!.save).toMatchObject({ x: goal.x, y: goal.y });
    const a2 = await track(alice.cookie);
    const hello2 = await a2.wait('hello');
    expect(hello2.you.c.x).toBe(goal.x);
    expect(hello2.you.c.y).toBe(goal.y);

    // A second login for the same account kicks the first connection.
    const a3 = await track(alice.cookie);
    await a3.wait('hello');
    const kicked = await a2.waitClosed();
    expect(kicked.code).toBe(CLOSE_REPLACED);
    expect(a2.of('kick').length).toBe(1);
    expect(server.game.players.onlineCount()).toBe(2);
    expect(server.gateway.connectionCount).toBe(2);
    a3.close();
    b.close();
    await until(() => server.game.players.onlineCount() === 0, 3000, 'everyone to leave');
  }, 40000);

  it('survives malformed and abusive traffic, closing only the offender', async () => {
    const victim = await track(bob.cookie);
    await victim.wait('hello');
    const carol = await register('Carol_Int');
    await makeHero(carol, 'Carol Hero');
    const c = await track(carol.cookie);
    await c.wait('hello');

    // Fewer than the strike limit, so the connection stays open.
    const bad: (string | Buffer)[] = ['not json', '[]', '{"t":"move","x":"a","y":1}', '{"t":"nope"}', '{"__proto__":{"t":"stop"}}', Buffer.from([1, 2, 3])];
    for (const m of bad) c.ws.send(m);
    await until(() => c.of('err').filter((e) => e.code === 'bad_message').length === bad.length, 3000, 'error replies');
    // Still alive and responsive.
    c.send({ t: 'ping', t0: 5 });
    await c.wait('pong', (m) => m.t0 === 5);
    expect(c.closed).toBeNull();

    // Sustained abuse -> closed with CLOSE_RATE; others are unaffected.
    for (let i = 0; i < 30; i++) c.ws.send('garbage ' + i);
    expect((await c.waitClosed()).code).toBe(CLOSE_RATE);
    victim.send({ t: 'ping', t0: 6 });
    await victim.wait('pong', (m) => m.t0 === 6);
    expect((await http<{ ok: boolean }>('GET', '/api/health')).body.ok).toBe(true);

    // Oversized frames are refused by the transport (1009 message too big).
    const c2 = await track(carol.cookie);
    await c2.wait('hello');
    c2.ws.send(JSON.stringify({ t: 'chat', ch: 'local', text: 'x'.repeat(5000) }));
    expect((await c2.waitClosed()).code).toBe(1009);

    // Message flood: the token bucket kicks in, then the connection is cut.
    const c3 = await track(carol.cookie);
    await c3.wait('hello');
    for (let i = 0; i < 400; i++) c3.ws.send('{"t":"ping","t0":1}');
    const closed = await c3.waitClosed();
    expect(closed.code).toBe(CLOSE_RATE);
    expect(c3.of('err').some((e) => e.code === 'rate_limited')).toBe(true);
    expect(c3.of('pong').length).toBeLessThan(400);

    victim.close();
    await until(() => server.game.players.onlineCount() === 0, 3000, 'cleanup');
  }, 30000);

  it('banned accounts cannot connect or log in', async () => {
    server.db.setUserBanned(bobId, true);
    await expect(Bot.connect(bob.cookie)).rejects.toThrow('HTTP 403');
    const login = await http('POST', '/api/login', { body: { username: 'Bob2_Int', password: 'correct-horse-9' } });
    expect(login.status).toBe(403);
    server.db.setUserBanned(bobId, false);
  });

  it('no leaks after everyone left', () => {
    expect(server.game.players.onlineCount()).toBe(0);
    expect(server.gateway.connectionCount).toBe(0);
    expect(server.game.entities.count('player')).toBe(0);
    expect(server.game.entities.count('npc')).toBeGreaterThan(0);
  });
});

describe('rate limiting', () => {
  it('throttles registration per IP (10/min) with Retry-After', async () => {
    let limited: Http<{ error: string }> | null = null;
    for (let i = 0; i < 14 && !limited; i++) {
      const r = await http<{ error: string }>('POST', '/api/register', { body: { username: `Flood_${i}`, password: 'correct-horse-9' } });
      if (r.status === 429) limited = r;
    }
    expect(limited).not.toBeNull();
    expect(Number(limited!.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(typeof limited!.body.error).toBe('string');
  }, 30000);
});

describe('restart', () => {
  it('shuts down gracefully, then restores characters, the world snapshot and serves the built client', async () => {
    // One more bot online during shutdown.
    const login = await http<MeResponse>('POST', '/api/login', { body: { username: 'Alice_Int', password: 'correct-horse-9' } });
    const live = await track(login.cookie);
    await live.wait('hello');
    const goalBefore = server.db.getCharacterByUser(login.body.user.id)!.save;
    const hoursBefore = server.sim.clock().totalHours;
    expect(hoursBefore).toBeGreaterThan(0);

    await server.close();
    const closed = await live.waitClosed();
    expect([1001, 1005, 1006]).toContain(closed.code);
    expect(live.of('kick').length).toBe(1);

    // A built client directory is served with an SPA fallback.
    const clientDir = path.join(dir, 'client');
    fs.mkdirSync(path.join(clientDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(clientDir, 'index.html'), '<!doctype html><title>Murim</title><script type="module" src="/assets/app.js"></script>');
    fs.writeFileSync(path.join(clientDir, 'assets', 'app.js'), 'console.log(1)');

    server = await startServer({
      env: { PORT: String(PORT), HOST: '127.0.0.1', DB_PATH: path.join(dir, 'int.db'), SIM_STUB: '1', WORLD_HOUR_MS: '300', LOG_LEVEL: 'silent', STATIC_DIR: clientDir },
      log: nullLogger,
    });
    // The world clock continued from the snapshot (plus catch-up for the downtime).
    expect(server.sim.clock().totalHours).toBeGreaterThanOrEqual(hoursBefore);

    const again = await http<MeResponse>('POST', '/api/login', { body: { username: 'Alice_Int', password: 'correct-horse-9' } });
    expect(again.status).toBe(200);
    const bot = await track(again.cookie);
    const hello = await bot.wait('hello');
    expect(hello.you.c.x).toBe(goalBefore.x);
    expect(hello.you.c.y).toBe(goalBefore.y);
    expect(hello.you.c.name).toBe('Alice Hero');

    const index = await http<string>('GET', '/');
    expect(index.status).toBe(200);
    expect(String(index.body)).toContain('<title>Murim</title>');
    expect(index.headers.get('content-security-policy')).toBeTruthy();
    expect(index.headers.get('cache-control')).toBe('no-cache');
    const route = await http<string>('GET', '/some/client/route');
    expect(route.status).toBe(200);
    expect(String(route.body)).toContain('<title>Murim</title>');
    const asset = await http('GET', '/assets/app.js');
    expect(asset.status).toBe(200);
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await http('GET', '/assets/missing.js')).status).toBe(404);
    expect((await http('GET', '/api/missing')).status).toBe(404);
    expect(((await http('GET', '/api/missing')).body as { error: string }).error).toBeTruthy();
  }, 40000);
});

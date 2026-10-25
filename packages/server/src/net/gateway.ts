/**
 * WebSocket gateway on `/ws`, sharing the HTTP server.
 *
 * - Authenticates from the session cookie during the upgrade (401/403 otherwise).
 * - One connection per account: a new one kicks the old (CLOSE_REPLACED, handled by the game layer).
 * - Every frame: 4 KB cap, JSON parse, zod validation, token-bucket rate limit, strike system.
 * - 30 s heartbeat (ping/pong) drops dead peers; slow consumers are dropped (backpressure guard).
 * Nothing here throws into the event loop: all handlers are wrapped.
 */
import type { IncomingMessage, Server as HttpServer } from 'node:http';
import type { Duplex } from 'node:stream';
import { CLOSE_BAD_AUTH, CLOSE_RATE, WS_PATH, type S2C } from '@murim/shared';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { AuthService } from '../auth';
import type { Config } from '../config';
import type { UserRow } from '../db';
import type { Game } from '../game/context';
import type { Logger } from '../game/log';
import type { ClientConn, PlayerImpl } from '../game/players';
import { clientIp, originAllowed } from './ip';
import { TokenBucket, WindowLimiter } from './ratelimit';
import { MAX_MESSAGE_BYTES, parseClientMessage } from './schemas';

export const MSG_RATE_PER_SEC = 40;
export const MSG_BURST = 80;
export const HEARTBEAT_MS = 30000;
/** Bytes queued on a socket before the client is considered too slow to keep up. */
export const MAX_BUFFERED_BYTES = 1024 * 1024;
/** Strikes (bad messages / rate violations) before the connection is closed. */
export const MAX_STRIKES = 8;
/** One strike is forgiven per this many ms of good behaviour. */
export const STRIKE_DECAY_MS = 5000;
export const MAX_CONNECTIONS_PER_IP = 20;
export const UPGRADES_PER_MIN_PER_IP = 60;

export interface GatewayDeps {
  server: HttpServer;
  game: Game;
  auth: AuthService;
  config: Config;
  log: Logger;
  now?: () => number;
}

function reject(socket: Duplex, status: number, text: string): void {
  if (socket.writable) socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  socket.destroy();
}

/** Strike counter that forgives one strike per STRIKE_DECAY_MS. */
export class Strikes {
  private value = 0;
  private last = 0;
  /** Adds a strike; returns true when the limit is reached. */
  add(now: number): boolean {
    this.value = Math.max(0, this.value - (now - this.last) / STRIKE_DECAY_MS) + 1;
    this.last = now;
    return this.value >= MAX_STRIKES;
  }
}

class WsConn implements ClientConn {
  alive = true;
  private closed = false;

  constructor(
    readonly id: number,
    readonly ip: string,
    readonly ws: WebSocket,
    private readonly onSlow: (conn: WsConn) => void,
  ) {}

  get open(): boolean {
    return !this.closed && this.ws.readyState === WebSocket.OPEN;
  }

  send(msg: S2C): void {
    if (!this.open) return;
    this.sendRaw(JSON.stringify(msg));
  }

  sendRaw(json: string): void {
    if (!this.open) return;
    if (this.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      this.onSlow(this);
      return;
    }
    try {
      this.ws.send(json, () => {});
    } catch {
      /* socket is going away; the close handler cleans up */
    }
  }

  close(code: number, reason: string): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close(code, reason.slice(0, 100));
    } catch {
      this.ws.terminate();
      return;
    }
    // A peer that never answers the close handshake is dropped after a grace period.
    setTimeout(() => {
      if (this.ws.readyState !== WebSocket.CLOSED) this.ws.terminate();
    }, 3000).unref();
  }

  terminate(): void {
    this.closed = true;
    this.ws.terminate();
  }
}

export class Gateway {
  private readonly wss: WebSocketServer;
  private readonly conns = new Set<WsConn>();
  private readonly perIp = new Map<string, number>();
  private readonly upgradeLimiter = new WindowLimiter(UPGRADES_PER_MIN_PER_IP, 60000);
  private readonly now: () => number;
  private heartbeat: NodeJS.Timeout | null = null;
  private nextId = 1;
  private readonly onUpgrade = (req: IncomingMessage, socket: Duplex, head: Buffer): void => this.upgrade(req, socket, head);

  constructor(private readonly d: GatewayDeps) {
    this.now = d.now ?? Date.now;
    this.wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES, perMessageDeflate: false, clientTracking: false });
    d.server.on('upgrade', this.onUpgrade);
    this.heartbeat = setInterval(() => this.beat(), HEARTBEAT_MS);
    this.heartbeat.unref();
  }

  get connectionCount(): number {
    return this.conns.size;
  }

  private upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    const { config, auth, log } = this.d;
    socket.on('error', () => {});
    try {
      const pathname = (req.url ?? '').split('?')[0];
      if (pathname !== WS_PATH) return reject(socket, 404, 'Not Found');
      if (!originAllowed(req.headers, config)) return reject(socket, 403, 'Forbidden');
      const ip = clientIp(req, config.trustProxy);
      if (!this.upgradeLimiter.hit(ip, this.now()).ok) return reject(socket, 429, 'Too Many Requests');
      if ((this.perIp.get(ip) ?? 0) >= MAX_CONNECTIONS_PER_IP) return reject(socket, 429, 'Too Many Requests');
      const session = auth.sessionFromCookieHeader(req.headers.cookie);
      if (!session) return reject(socket, 401, 'Unauthorized');
      if (session.user.banned) return reject(socket, 403, 'Forbidden');
      this.wss.handleUpgrade(req, socket, head, (ws) => this.accept(ws, ip, session.user));
    } catch (err) {
      log.error('websocket upgrade failed', err);
      if (!socket.destroyed) reject(socket, 500, 'Internal Server Error');
    }
  }

  private accept(ws: WebSocket, ip: string, user: UserRow): void {
    const { game, log } = this.d;
    const conn = new WsConn(this.nextId++, ip, ws, (c) => {
      log.warn(`dropping slow client ${c.id} (${ip})`);
      c.terminate();
    });
    this.conns.add(conn);
    this.perIp.set(ip, (this.perIp.get(ip) ?? 0) + 1);

    const bucket = new TokenBucket(MSG_RATE_PER_SEC, MSG_BURST, this.now());
    const strikes = new Strikes();
    let player: PlayerImpl | null = null;

    const strike = (code: string, text: string): void => {
      conn.send({ t: 'err', code, text });
      if (strikes.add(this.now())) {
        log.warn(`closing connection ${conn.id} (${player?.name ?? 'unknown'}): too many bad messages`);
        conn.close(CLOSE_RATE, 'too many invalid messages');
      }
    };

    // Listeners first, so no frame sent right after the handshake can be missed.
    ws.on('message', (data: RawData, isBinary: boolean) => {
      conn.alive = true;
      try {
        if (!conn.open || !player || player.conn !== conn) return;
        if (isBinary) return strike('bad_message', 'Binary messages are not supported.');
        const now = this.now();
        if (!bucket.take(now)) return strike('rate_limited', 'You are sending too many messages.');
        const raw = Array.isArray(data) ? Buffer.concat(data).toString('utf8') : Buffer.from(data as ArrayBuffer).toString('utf8');
        const parsed = parseClientMessage(raw);
        if (!parsed.ok) return strike('bad_message', `Invalid message: ${parsed.error}.`);
        game.receive(player, parsed.msg);
      } catch (err) {
        log.error('error while handling client message', err);
      }
    });
    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('error', (err) => {
      log.debug(`socket error on connection ${conn.id}: ${err.message}`);
    });
    ws.on('close', () => {
      this.conns.delete(conn);
      const n = (this.perIp.get(ip) ?? 1) - 1;
      if (n <= 0) this.perIp.delete(ip);
      else this.perIp.set(ip, n);
      try {
        game.disconnect(conn);
      } catch (err) {
        log.error('error while detaching player', err);
      }
    });

    try {
      player = game.connect(conn, user);
    } catch (err) {
      log.error('error while attaching player', err);
      conn.send({ t: 'err', code: 'internal', text: 'Could not enter the world. Try again.' });
      conn.close(1011, 'internal error');
      return;
    }
    if (!player) {
      conn.send({ t: 'err', code: 'no_character', text: 'Create a character first.' });
      conn.close(CLOSE_BAD_AUTH, 'no character');
    }
  }

  private beat(): void {
    for (const c of this.conns) {
      if (!c.alive) {
        c.terminate();
        continue;
      }
      c.alive = false;
      try {
        c.ws.ping();
      } catch {
        c.terminate();
      }
    }
  }

  /**
   * Stop accepting upgrades and close every socket (players are saved by `Game.disconnectAll` first).
   * Waits up to `graceMs` for close handshakes, then cuts whatever is left.
   */
  async close(graceMs = 500): Promise<void> {
    this.d.server.off('upgrade', this.onUpgrade);
    if (this.heartbeat) clearInterval(this.heartbeat);
    this.heartbeat = null;
    for (const c of this.conns) c.close(1001, 'server shutting down');
    const deadline = Date.now() + graceMs;
    while (this.conns.size > 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    for (const c of this.conns) c.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }
}


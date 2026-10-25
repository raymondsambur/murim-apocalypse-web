import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CLOSE_REPLACED, type S2C } from '@murim/shared';
import { GameSocket, PendingQueries, QueryError, backoffDelay, closeReason, type SocketLike } from './socket';

class FakeWs implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  send(d: string) {
    this.sent.push(d);
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  receive(m: S2C) {
    this.onmessage?.({ data: JSON.stringify(m) });
  }
  drop(code = 1006) {
    this.readyState = 3;
    this.onclose?.({ code, reason: '' });
  }
  last(): { t: string; id?: number; name?: string } {
    return JSON.parse(this.sent[this.sent.length - 1]);
  }
}

describe('PendingQueries', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resolves the query that matches the response id', async () => {
    const q = new PendingQueries(1000);
    const a = q.create<string>('npc');
    const b = q.create<string>('board');
    expect(q.settle({ id: b.id, ok: true, data: 'B' })).toBe(true);
    expect(q.settle({ id: a.id, ok: true, data: 'A' })).toBe(true);
    await expect(a.promise).resolves.toBe('A');
    await expect(b.promise).resolves.toBe('B');
    expect(q.size).toBe(0);
  });

  it('times out with a QueryError and ignores the late answer', async () => {
    const q = new PendingQueries(500);
    const p = q.create('world');
    const assertion = expect(p.promise).rejects.toMatchObject({ code: 'timeout', query: 'world' });
    vi.advanceTimersByTime(501);
    await assertion;
    expect(q.settle({ id: p.id, ok: true, data: 1 })).toBe(false);
  });

  it('rejects server failures with the readable text and the code', async () => {
    const q = new PendingQueries(500);
    const p = q.create('npc');
    q.settle({ id: p.id, ok: false, err: 'not_found', data: { text: 'No such person.' } });
    const err = (await p.promise.catch((e) => e)) as QueryError;
    expect(err).toBeInstanceOf(QueryError);
    expect(err.code).toBe('server');
    expect(err.message).toBe('No such person.');
    expect(err.serverCode).toBe('not_found');
  });

  it('rejectAll fails everything outstanding', async () => {
    const q = new PendingQueries(5000);
    const a = q.create('a');
    const b = q.create('b');
    q.rejectAll('disconnected', 'gone');
    await expect(a.promise).rejects.toMatchObject({ code: 'disconnected' });
    await expect(b.promise).rejects.toMatchObject({ code: 'disconnected' });
    expect(q.size).toBe(0);
  });
});

describe('backoffDelay', () => {
  it('grows exponentially, is capped, and stays within +-25% jitter', () => {
    const mid = () => 0.5;
    expect(backoffDelay(0, 500, 15000, mid)).toBe(500);
    expect(backoffDelay(1, 500, 15000, mid)).toBe(1000);
    expect(backoffDelay(3, 500, 15000, mid)).toBe(4000);
    expect(backoffDelay(20, 500, 15000, mid)).toBe(15000);
    expect(backoffDelay(2, 500, 15000, () => 0)).toBe(1500);
    expect(backoffDelay(2, 500, 15000, () => 1)).toBe(2500);
  });
});

describe('GameSocket', () => {
  let sockets: FakeWs[];
  const make = (extra = {}) => {
    sockets = [];
    return new GameSocket({
      url: 'ws://test/ws',
      factory: () => {
        const w = new FakeWs();
        sockets.push(w);
        return w;
      },
      queryTimeoutMs: 1000,
      pingMs: 100000,
      ...extra,
    });
  };
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('connects, sends typed messages and routes S2C by type', () => {
    const s = make();
    const chats: string[] = [];
    s.on('chat', (m) => chats.push(m.msg.text));
    s.connect();
    expect(s.send({ t: 'stop' })).toBe(false); // not open yet
    sockets[0].open();
    expect(s.isOpen).toBe(true);
    expect(s.send({ t: 'move', x: 1, y: 2 })).toBe(true);
    expect(sockets[0].last()).toEqual({ t: 'move', x: 1, y: 2 });
    sockets[0].receive({ t: 'chat', msg: { ch: 'local', from: 'A', text: 'yo', t: 1 } });
    expect(chats).toEqual(['yo']);
  });

  it('query() sends an id and resolves from the matching res', async () => {
    const s = make();
    s.connect();
    sockets[0].open();
    const p = s.query('leaderboard', {});
    const sent = sockets[0].last();
    expect(sent).toMatchObject({ t: 'q', name: 'leaderboard' });
    sockets[0].receive({ t: 'res', id: sent.id!, ok: true, data: [{ id: 1 }] });
    await expect(p).resolves.toEqual([{ id: 1 }]);
  });

  it('query() rejects immediately while disconnected and on socket loss', async () => {
    const s = make();
    await expect(s.query('world', {})).rejects.toMatchObject({ code: 'disconnected' });
    s.connect();
    sockets[0].open();
    const p = s.query('world', {});
    const done = expect(p).rejects.toMatchObject({ code: 'disconnected' });
    sockets[0].drop();
    await done;
  });

  it('reconnects with backoff after an unexpected close and resets the counter on open', () => {
    const s = make();
    const states: string[] = [];
    s.onState((i) => states.push(i.state));
    s.connect();
    sockets[0].open();
    sockets[0].drop(1006);
    expect(s.state.state).toBe('reconnecting');
    expect(s.state.retryIn).toBeGreaterThan(0);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(2000);
    expect(sockets).toHaveLength(2);
    sockets[1].open();
    expect(s.state).toMatchObject({ state: 'open', attempt: 0 });
    expect(states).toContain('reconnecting');
  });

  it('does not reconnect when the server replaced the session or kicked us', () => {
    const s = make();
    s.connect();
    sockets[0].open();
    sockets[0].drop(CLOSE_REPLACED);
    expect(s.state).toMatchObject({ state: 'closed', reason: 'replaced' });
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(1);

    const k = make();
    k.connect();
    sockets[0].open();
    sockets[0].receive({ t: 'kick', reason: 'bye' });
    sockets[0].drop(1000);
    expect(k.state).toMatchObject({ state: 'closed', reason: 'kicked' });
  });

  it('close() stops reconnecting for good and retryNow() skips the wait', () => {
    const s = make();
    s.connect();
    sockets[0].drop(1006);
    s.retryNow();
    expect(sockets).toHaveLength(2);
    s.close('logout');
    expect(s.state).toMatchObject({ state: 'closed', reason: 'logout' });
    vi.advanceTimersByTime(60000);
    expect(sockets).toHaveLength(2);
  });

  it('ping/pong updates latency and the server clock offset; garbage frames are ignored', () => {
    const s = make();
    s.connect();
    sockets[0].open();
    vi.setSystemTime(10_000);
    sockets[0].onmessage?.({ data: 'not json' });
    sockets[0].onmessage?.({ data: '{"nope":1}' });
    sockets[0].receive({ t: 'pong', t0: 9_950, now: 20_000 });
    expect(s.latency).toBe(50);
    expect(s.serverOffset).toBeGreaterThan(9_000);
  });

  it('maps close codes to reasons', () => {
    expect(closeReason(4001)).toBe('replaced');
    expect(closeReason(4002)).toBe('auth');
    expect(closeReason(4003)).toBe('banned');
    expect(closeReason(1006)).toBeNull();
  });
});

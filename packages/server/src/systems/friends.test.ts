import { afterEach, describe, expect, it } from 'vitest';
import type { FriendView } from '@murim/shared';
import { MAX_PENDING } from './friends';
import { makeSocialRig, type SocialRig } from './social.testkit';

let rig: SocialRig | null = null;
afterEach(() => {
  rig?.h.close();
  rig = null;
});

const list = (r: SocialRig, w: Parameters<SocialRig['ask']>[0]): FriendView[] => r.ask(w, 'friends', {}).data as FriendView[];

describe('friends', () => {
  it('runs the add / accept flow with an invite message and the friends query', () => {
    rig = makeSocialRig();
    const r = rig;
    const a = r.join('Alice', { level: 4 });
    const b = r.join('Bob', { level: 9 });
    expect(a.run({ t: 'friend', op: 'add', name: 'Nobody' }).err?.code).toBe('not_found');
    expect(a.run({ t: 'friend', op: 'add', name: 'alice' }).err?.code).toBe('bad_target');
    expect(a.run({ t: 'friend', op: 'add', name: 'bob' }).err).toBeUndefined();
    expect(b.conn.last('invite')).toMatchObject({ kind: 'friend', fromId: a.p.charId, from: 'Alice' });
    expect(a.run({ t: 'friend', op: 'add', name: 'Bob' }).err?.code).toBe('already_requested');
    expect(list(r, a)).toEqual([{ id: b.p.charId, name: 'Bob', level: 9, online: true, status: 'out' }]);
    expect(list(r, b)).toEqual([{ id: a.p.charId, name: 'Alice', level: 4, online: true, status: 'in' }]);
    // Only the addressee can accept.
    expect(a.run({ t: 'friend', op: 'accept', id: b.p.charId }).err?.code).toBe('no_request');
    expect(b.run({ t: 'friend', op: 'accept', id: a.p.charId }).err).toBeUndefined();
    expect(a.conn.of('note').some((n) => n.text.includes('accepted'))).toBe(true);
    expect(list(r, a)[0].status).toBe('friend');
    expect(list(r, b)[0].status).toBe('friend');
    expect(b.run({ t: 'friend', op: 'add', name: 'Alice' }).err?.code).toBe('already_friends');
  });

  it('declines, cancels and removes', () => {
    rig = makeSocialRig();
    const r = rig;
    const a = r.join('Alice');
    const b = r.join('Bob');
    const c = r.join('Cara');
    a.run({ t: 'friend', op: 'add', name: 'Bob' });
    expect(b.run({ t: 'friend', op: 'decline', id: a.p.charId }).err).toBeUndefined();
    expect(list(r, a)).toEqual([]);
    expect(b.run({ t: 'friend', op: 'decline', id: a.p.charId }).err?.code).toBe('no_request');
    // The sender can cancel with remove.
    a.run({ t: 'friend', op: 'add', name: 'Cara' });
    expect(a.run({ t: 'friend', op: 'remove', id: c.p.charId }).err).toBeUndefined();
    expect(list(r, c)).toEqual([]);
    // Friends can be removed from either side.
    a.run({ t: 'friend', op: 'add', name: 'Bob' });
    b.run({ t: 'friend', op: 'accept', id: a.p.charId });
    expect(b.run({ t: 'friend', op: 'remove', id: a.p.charId }).err).toBeUndefined();
    expect(list(r, a)).toEqual([]);
    expect(a.run({ t: 'friend', op: 'remove', id: b.p.charId }).err?.code).toBe('not_friends');
  });

  it('treats adding someone who already asked you as accepting', () => {
    rig = makeSocialRig();
    const r = rig;
    const a = r.join('Alice');
    const b = r.join('Bob');
    a.run({ t: 'friend', op: 'add', name: 'Bob' });
    expect(b.run({ t: 'friend', op: 'add', name: 'Alice' }).err).toBeUndefined();
    expect(list(r, b)[0].status).toBe('friend');
  });

  it('tells friends when someone logs in or out, and shows offline friends', () => {
    rig = makeSocialRig();
    const r = rig;
    const a = r.join('Alice');
    const b = r.join('Bob', { level: 6 });
    a.run({ t: 'friend', op: 'add', name: 'Bob' });
    b.run({ t: 'friend', op: 'accept', id: a.p.charId });
    a.conn.clear();
    r.leave(b);
    expect(a.conn.of('note').some((n) => n.text === 'Bob has gone offline.')).toBe(true);
    expect(list(r, a)[0]).toMatchObject({ name: 'Bob', online: false, level: 6, status: 'friend' });
    a.conn.clear();
    const b2 = r.rejoin(b);
    expect(a.conn.of('note').some((n) => n.text === 'Bob has come online.')).toBe(true);
    expect(b2.p.online).toBe(true);
    expect(list(r, a)[0].online).toBe(true);
  });

  it('can befriend an offline character; they see the request on login', () => {
    rig = makeSocialRig();
    const r = rig;
    const a = r.join('Alice');
    const b = r.join('Bob');
    r.h.game.playerMgr.saveDirty(true);
    r.leave(b);
    expect(a.run({ t: 'friend', op: 'add', name: 'Bob' }).err).toBeUndefined();
    expect(list(r, a)[0]).toMatchObject({ name: 'Bob', online: false, status: 'out' });
    const b2 = r.rejoin(b);
    expect(b2.conn.of('note').some((n) => n.text.includes('1 pending friend request'))).toBe(true);
    expect(b2.run({ t: 'friend', op: 'accept', id: a.p.charId }).err).toBeUndefined();
    expect(list(r, b2)[0].status).toBe('friend');
  });

  it('limits pending requests', () => {
    rig = makeSocialRig();
    const r = rig;
    const a = r.join('Asker');
    let refused = '';
    for (let i = 0; i <= MAX_PENDING; i++) {
      r.join(`Target${i}`);
      r.h.clock.advance(7000); // stay under the per-minute rate limit
      const e = a.run({ t: 'friend', op: 'add', name: `Target${i}` }).err;
      if (e) refused = e.code;
    }
    expect(refused).toBe('too_many_pending');
    expect(list(r, a)).toHaveLength(MAX_PENDING);
  });

  it('limits the friend list size', () => {
    rig = makeSocialRig();
    const r = rig;
    const a = r.join('Popular');
    for (let i = 0; i < 50; i++) {
      r.ctx.db.run("INSERT INTO friends (a, b, status, requested_by, at) VALUES (?, ?, 'friend', ?, 0)", a.p.charId, 100000 + i, a.p.charId);
    }
    const b = r.join('Latecomer');
    expect(a.run({ t: 'friend', op: 'add', name: 'Latecomer' }).err?.code).toBe('friends_full');
    expect(b.run({ t: 'friend', op: 'add', name: 'Popular' }).err).toBeUndefined();
    expect(a.run({ t: 'friend', op: 'accept', id: b.p.charId }).err?.code).toBe('friends_full');
  });

  it('rate limits friend request spam', () => {
    rig = makeSocialRig();
    const r = rig;
    const a = r.join('Spammer');
    const codes: string[] = [];
    for (let i = 0; i < 12; i++) {
      r.join(`Victim${i}`);
      const e = a.run({ t: 'friend', op: 'add', name: `Victim${i}` }).err;
      if (e) codes.push(e.code);
    }
    expect(codes).toContain('slow_down');
  });
});

/**
 * Friends list: requests by name, accept / decline / remove, online status, login and logout notices.
 * Owner: gameplay-social. Ids in ops and views are CHARACTER ids.
 *
 * Table `friends` holds one row per pair (a < b): status 'pending' (requested_by asked the other) or 'friend'.
 */
import type { FriendView } from '@murim/shared';
import { GameError, type GameContext, type Player } from '../ctx';
import { Limiter, findCharacter, findCharacterByName, setupMail, throttle } from './social';

export const MAX_FRIENDS = 50;
export const MAX_PENDING = 20;

interface Row {
  a: number;
  b: number;
  status: string;
  requested_by: number;
}

export function register(ctx: GameContext): void {
  setupMail(ctx);
  ctx.db.migrateModule('friends', [
    `CREATE TABLE friends (
       a INTEGER NOT NULL,
       b INTEGER NOT NULL,
       status TEXT NOT NULL,
       requested_by INTEGER NOT NULL,
       at INTEGER NOT NULL,
       PRIMARY KEY (a, b),
       CHECK (a < b)
     );
     CREATE INDEX friends_b ON friends(b);`,
  ]);

  const addLimit = new Limiter(ctx, 10, 60_000);
  const pair = (x: number, y: number): [number, number] => (x < y ? [x, y] : [y, x]);
  const rowOf = (x: number, y: number): Row | undefined => {
    const [a, b] = pair(x, y);
    return ctx.db.get<Row>('SELECT a, b, status, requested_by FROM friends WHERE a = ? AND b = ?', a, b);
  };
  const countFriends = (id: number): number => Number(ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM friends WHERE status = 'friend' AND (a = ? OR b = ?)", id, id)?.n ?? 0);
  /** Requests this character sent or received that are still open. */
  const countPending = (id: number, which: 'sent' | 'received'): number =>
    Number(
      ctx.db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM friends WHERE status = 'pending' AND (a = ? OR b = ?) AND requested_by ${which === 'sent' ? '=' : '!='} ?`,
        id,
        id,
        id,
      )?.n ?? 0,
    );
  const friendIds = (id: number): number[] =>
    ctx.db.all<{ a: number; b: number }>("SELECT a, b FROM friends WHERE status = 'friend' AND (a = ? OR b = ?)", id, id).map((r) => (Number(r.a) === id ? Number(r.b) : Number(r.a)));
  const link = (x: number, y: number): void => {
    const [a, b] = pair(x, y);
    ctx.db.run("UPDATE friends SET status = 'friend' WHERE a = ? AND b = ?", a, b);
  };
  const unlink = (x: number, y: number): void => {
    const [a, b] = pair(x, y);
    ctx.db.run('DELETE FROM friends WHERE a = ? AND b = ?', a, b);
  };

  const add = (p: Player, rawName: string): void => {
    const target = findCharacterByName(ctx, rawName);
    if (!target) throw new GameError('not_found', 'No character has that name.');
    if (target.id === p.charId) throw new GameError('bad_target', 'You cannot befriend yourself.');
    const row = rowOf(p.charId, target.id);
    if (row?.status === 'friend') throw new GameError('already_friends', `${target.name} is already your friend.`);
    if (row?.status === 'pending') {
      // They asked us first: adding them back is an acceptance.
      if (Number(row.requested_by) === target.id) return accept(p, target.id);
      throw new GameError('already_requested', `You have already asked ${target.name}.`);
    }
    throttle(addLimit, String(p.charId), 'You are sending too many friend requests.');
    if (countFriends(p.charId) >= MAX_FRIENDS) throw new GameError('friends_full', `Your friend list is full (${MAX_FRIENDS}).`);
    if (countPending(p.charId, 'sent') >= MAX_PENDING) throw new GameError('too_many_pending', 'You have too many unanswered friend requests.');
    if (countPending(target.id, 'received') >= MAX_PENDING) throw new GameError('target_busy', `${target.name} has too many pending requests.`);
    const [a, b] = pair(p.charId, target.id);
    ctx.db.run("INSERT INTO friends (a, b, status, requested_by, at) VALUES (?, ?, 'pending', ?, ?)", a, b, p.charId, ctx.now());
    ctx.notify(p, 'info', `Friend request sent to ${target.name}.`);
    if (target.live?.online) ctx.send(target.live, { t: 'invite', kind: 'friend', fromId: p.charId, from: p.name });
  };

  const accept = (p: Player, id: number): void => {
    const row = rowOf(p.charId, id);
    if (!row || row.status !== 'pending' || Number(row.requested_by) !== id) throw new GameError('no_request', 'There is no friend request from that player.');
    if (countFriends(p.charId) >= MAX_FRIENDS) throw new GameError('friends_full', `Your friend list is full (${MAX_FRIENDS}).`);
    if (countFriends(id) >= MAX_FRIENDS) throw new GameError('target_full', 'Their friend list is full.');
    link(p.charId, id);
    const other = findCharacter(ctx, id);
    ctx.notify(p, 'good', `You and ${other?.name ?? 'that player'} are now friends.`);
    if (other?.live?.online) ctx.notify(other.live, 'good', `${p.name} accepted your friend request.`);
  };

  const decline = (p: Player, id: number): void => {
    const row = rowOf(p.charId, id);
    if (!row || row.status !== 'pending' || Number(row.requested_by) !== id) throw new GameError('no_request', 'There is no friend request from that player.');
    unlink(p.charId, id);
    ctx.notify(p, 'info', 'Friend request declined.');
  };

  const remove = (p: Player, id: number): void => {
    const row = rowOf(p.charId, id);
    if (!row) throw new GameError('not_friends', 'That player is not on your friend list.');
    unlink(p.charId, id);
    const other = findCharacter(ctx, id);
    ctx.notify(p, 'info', row.status === 'friend' ? `${other?.name ?? 'The player'} is no longer your friend.` : 'Friend request cancelled.');
  };

  ctx.command('friend', (p, m) => {
    switch (m.op) {
      case 'add':
        return add(p, m.name);
      case 'accept':
        return accept(p, m.id);
      case 'decline':
        return decline(p, m.id);
      case 'remove':
        return remove(p, m.id);
    }
  });

  ctx.query('friends', (p) => {
    const rows = ctx.db.all<Row>('SELECT a, b, status, requested_by FROM friends WHERE a = ? OR b = ?', p.charId, p.charId);
    const out: FriendView[] = [];
    for (const r of rows) {
      const id = Number(r.a) === p.charId ? Number(r.b) : Number(r.a);
      const c = findCharacter(ctx, id);
      if (!c) continue;
      const status: FriendView['status'] = r.status === 'friend' ? 'friend' : Number(r.requested_by) === p.charId ? 'out' : 'in';
      out.push({ id, name: c.name, level: c.level, online: c.online, status });
    }
    const order = { in: 0, friend: 1, out: 2 } as const;
    out.sort((x, y) => order[x.status] - order[y.status] || Number(y.online) - Number(x.online) || x.name.localeCompare(y.name));
    return out;
  });

  const tellFriends = (p: Player, text: string): void => {
    for (const id of friendIds(p.charId)) {
      const f = ctx.players.byCharId(id);
      if (f?.online) ctx.notify(f, 'info', text);
    }
  };

  ctx.onLogin((p) => {
    tellFriends(p, `${p.name} has come online.`);
    const waiting = countPending(p.charId, 'received');
    if (waiting > 0) ctx.notify(p, 'info', `You have ${waiting} pending friend request${waiting === 1 ? '' : 's'}.`);
  });
  ctx.onLogout((p) => tellFriends(p, `${p.name} has gone offline.`));
}

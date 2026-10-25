import { describe, expect, it } from 'vitest';
import {
  AuthService,
  SESSION_COOKIE,
  containsBannedWord,
  hashPassword,
  hashToken,
  newSessionToken,
  parseCookies,
  serializeCookie,
  validateCharacterName,
  validatePassword,
  validateUsername,
  verifyPassword,
} from './auth';
import { loadConfig } from './config';
import { openDb } from './db';

describe('password hashing', () => {
  it('verifies the right password and rejects wrong ones', async () => {
    const { hash, salt } = await hashPassword('correct horse battery');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery', salt, hash)).toBe(true);
    expect(await verifyPassword('correct horse batterz', salt, hash)).toBe(false);
    expect(await verifyPassword('', salt, hash)).toBe(false);
  });

  it('uses a per-user random salt', async () => {
    const a = await hashPassword('same password 1');
    const b = await hashPassword('same password 1');
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).toMatch(/^[0-9a-f]{32}$/);
  });

  it('never throws on malformed stored hashes', async () => {
    for (const bad of ['', 'plain', 'scrypt$1$2$3', 'scrypt$99$8$1$AAAA', 'scrypt$15$8$1$AAAA', 'bcrypt$15$8$1$AAAA', 'scrypt$x$y$z$w']) {
      expect(await verifyPassword('pw', 'abcd', bad)).toBe(false);
    }
  });

  it('normalises unicode so visually identical passwords match', async () => {
    const { hash, salt } = await hashPassword('café-password');
    expect(await verifyPassword('café-password', salt, hash)).toBe(true);
  });
});

describe('validation', () => {
  it('usernames: 3-20 chars of [A-Za-z0-9_]', () => {
    for (const ok of ['abc', 'Player_1', 'a'.repeat(20), 'X_Y_Z']) expect(validateUsername(ok)).toBeNull();
    for (const bad of ['ab', 'a'.repeat(21), 'has space', 'dash-ed', 'ünï', '', 42, null, undefined, { a: 1 }, 'a\nb']) expect(validateUsername(bad)).not.toBeNull();
  });

  it('passwords: 8-72 chars', () => {
    expect(validatePassword('1234567')).not.toBeNull();
    expect(validatePassword('12345678')).toBeNull();
    expect(validatePassword('x'.repeat(72))).toBeNull();
    expect(validatePassword('x'.repeat(73))).not.toBeNull();
    expect(validatePassword(12345678)).not.toBeNull();
    expect(validatePassword(undefined)).not.toBeNull();
  });

  it('character names follow the spec', () => {
    for (const ok of ['Han', 'Mu-Yeong', "O'Neil", 'Li Wei', 'Sword9', 'A'.repeat(16)]) {
      expect(validateCharacterName(ok).ok, ok).toBe(true);
    }
    expect(validateCharacterName('  Han  ')).toEqual({ ok: true, name: 'Han' });
    for (const bad of ['Ab', 'A'.repeat(17), '1Han', 'Li  Wei', 'Li--Wei', 'Han-', "Han'", '-Han', 'Ha<n', 'Ha_n', 'Ünï', '', 7, null]) {
      expect(validateCharacterName(bad).ok, String(bad)).toBe(false);
    }
  });

  it('bans reserved and offensive names, including simple leetspeak', () => {
    expect(validateCharacterName('Admin').ok).toBe(false);
    expect(validateCharacterName('Game Master gm').ok).toBe(false);
    expect(validateCharacterName('Fuckface').ok).toBe(false);
    expect(validateCharacterName('Sh1t Lord').ok).toBe(false);
    expect(validateCharacterName('Hitler').ok).toBe(false);
    expect(containsBannedWord('Scunthorpe')).toBe(false);
    expect(validateCharacterName('Moderately').ok).toBe(true);
  });
});

describe('cookies and tokens', () => {
  it('parses cookie headers defensively', () => {
    expect(parseCookies(undefined)).toEqual({});
    expect(parseCookies('a=1; b=two; ; =x; c')).toEqual({ a: '1', b: 'two' });
    expect(parseCookies('a="quoted"; a=second')).toEqual({ a: 'quoted' });
    expect(parseCookies('bad=%E0%A4%A')).toEqual({ bad: '%E0%A4%A' });
  });

  it('serialises HttpOnly/SameSite/Path and Secure on demand', () => {
    const c = serializeCookie('murim_session', 'tok', { maxAgeSec: 100, secure: false });
    expect(c).toContain('HttpOnly');
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Path=/');
    expect(c).toContain('Max-Age=100');
    expect(c).not.toContain('Secure');
    expect(serializeCookie('a', 'b', { maxAgeSec: 1, secure: true })).toContain('Secure');
    expect(serializeCookie('a', '', { maxAgeSec: 0, secure: false })).toContain('Max-Age=0');
  });

  it('session tokens are 32 random bytes; only the SHA-256 is stored', () => {
    const a = newSessionToken();
    const b = newSessionToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url').length).toBe(32);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).not.toBe(a);
  });
});

describe('AuthService', () => {
  function setup() {
    let t = 1_000_000;
    const db = openDb(':memory:');
    const config = loadConfig({ SESSION_DAYS: '2', ADMIN_USERS: 'Boss' });
    const auth = new AuthService(db, config, () => t);
    return { db, auth, advance: (ms: number) => (t += ms) };
  }

  it('registers, logs in, resolves and revokes sessions', async () => {
    const { db, auth, advance } = setup();
    const reg = await auth.register('Alice_1', 'password123');
    expect(reg.ok).toBe(true);
    if (!reg.ok) return;
    expect(db.getUserByName('alice_1')?.id).toBe(reg.user.id);
    // Only the hash of the token is in the database.
    expect(db.getSession(hashToken(reg.token))?.userId).toBe(reg.user.id);
    expect(db.getSession(reg.token)).toBeUndefined();
    expect(auth.session(reg.token)?.user.username).toBe('Alice_1');
    expect(auth.sessionFromCookieHeader(`${SESSION_COOKIE}=${reg.token}`)?.user.id).toBe(reg.user.id);

    const login = await auth.login('ALICE_1', 'password123');
    expect(login.ok).toBe(true);
    const bad = await auth.login('alice_1', 'wrong-password');
    expect(bad).toMatchObject({ ok: false, status: 401 });
    const nobody = await auth.login('nobody', 'password123');
    expect(nobody).toMatchObject({ ok: false, status: 401, error: (bad as { error: string }).error });

    auth.logout(reg.token);
    expect(auth.session(reg.token)).toBeNull();

    // Sessions are renewed once half their life is gone, and expire eventually.
    if (!login.ok) return;
    advance(2 * 24 * 3600 * 1000 * 0.6);
    expect(auth.session(login.token)?.renewed).toBe(true);
    advance(2 * 24 * 3600 * 1000 * 1.1);
    expect(auth.session(login.token)).toBeNull();
    db.close();
  });

  it('rejects duplicate (case-insensitive) and invalid registrations', async () => {
    const { db, auth } = setup();
    expect((await auth.register('Bob', 'password123')).ok).toBe(true);
    expect(await auth.register('bOB', 'password123')).toMatchObject({ ok: false, status: 409 });
    expect(await auth.register('x', 'password123')).toMatchObject({ ok: false, status: 400 });
    expect(await auth.register('Carol', 'short')).toMatchObject({ ok: false, status: 400 });
    expect(await auth.register({ $ne: 1 }, 'password123')).toMatchObject({ ok: false, status: 400 });
    db.close();
  });

  it('banned users cannot log in; garbage tokens never resolve', async () => {
    const { db, auth } = setup();
    const reg = await auth.register('Dave', 'password123');
    if (!reg.ok) throw new Error('register failed');
    db.setUserBanned(reg.user.id, true);
    expect(await auth.login('Dave', 'password123')).toMatchObject({ ok: false, status: 403 });
    for (const t of [undefined, '', 'short', 'x'.repeat(43), 'x'.repeat(200), "' OR 1=1 --"]) expect(auth.session(t)).toBeNull();
    expect(auth.isAdmin('boss')).toBe(true);
    expect(auth.isAdmin('Dave')).toBe(false);
    db.close();
  });
});

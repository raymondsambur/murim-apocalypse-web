/**
 * Accounts and sessions: validation rules, scrypt password hashing, session tokens and cookies.
 * Only the SHA-256 of a session token is stored; the raw token lives in an HttpOnly cookie.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Config } from './config';
import type { Db, UserRow } from './db';

export const SESSION_COOKIE = 'murim_session';

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;

/** Returns an error message, or null when valid. */
export function validateUsername(u: unknown): string | null {
  if (typeof u !== 'string') return 'Username is required.';
  if (!USERNAME_RE.test(u)) return 'Username must be 3-20 characters: letters, digits or underscore.';
  return null;
}

export function validatePassword(p: unknown): string | null {
  if (typeof p !== 'string') return 'Password is required.';
  if (p.length < PASSWORD_MIN || p.length > PASSWORD_MAX) return `Password must be ${PASSWORD_MIN}-${PASSWORD_MAX} characters.`;
  return null;
}

export const CHAR_NAME_RE = /^[A-Za-z][A-Za-z0-9' -]{2,15}$/;

/** Reserved words (whole word, case-insensitive). */
const RESERVED_WORDS = new Set(['admin', 'administrator', 'moderator', 'mod', 'system', 'server', 'gm', 'staff', 'support', 'official']);
/** Always offensive: matched anywhere in the name (after de-leeting and removing separators). */
const BANNED_FRAGMENTS = ['fuck', 'shit', 'nigg', 'fagg', 'hitler', 'bitch', 'whore', 'penis'];
/** Offensive as a word but common inside innocent ones ("Scunthorpe", "Draper", "Peacock"): whole words only. */
const BANNED_WORDS = new Set(['cunt', 'rape', 'rapist', 'nazi', 'slut', 'cock', 'vagina']);
const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b' };

const deleet = (s: string): string => s.replace(/[0-9]/g, (d) => LEET[d] ?? d);

export function containsBannedWord(text: string): boolean {
  const lower = text.toLowerCase();
  const tokens = lower.split(/[^a-z0-9]+/).filter(Boolean);
  for (const w of tokens) if (RESERVED_WORDS.has(w) || BANNED_WORDS.has(deleet(w))) return true;
  const squashed = deleet(lower).replace(/[^a-z]/g, '');
  return BANNED_WORDS.has(squashed) || BANNED_FRAGMENTS.some((f) => squashed.includes(f));
}

export type NameCheck = { ok: true; name: string } | { ok: false; error: string };

/** Character display names: 3-16 chars, starts with a letter, letters/digits/space/'/-. */
export function validateCharacterName(raw: unknown): NameCheck {
  if (typeof raw !== 'string') return { ok: false, error: 'Name is required.' };
  const name = raw.trim();
  if (!CHAR_NAME_RE.test(name)) return { ok: false, error: 'Name must be 3-16 characters, start with a letter, and use only letters, digits, spaces, apostrophes or hyphens.' };
  if (/[ '-]{2,}/.test(name)) return { ok: false, error: 'Name cannot contain double spaces or repeated punctuation.' };
  if (/['-]$/.test(name)) return { ok: false, error: 'Name cannot end with punctuation.' };
  if (containsBannedWord(name)) return { ok: false, error: 'That name is not allowed.' };
  return { ok: true, name };
}

// ---------------------------------------------------------------------------
// Password hashing (scrypt; parameters are encoded in the stored hash)
// ---------------------------------------------------------------------------

const SCRYPT_LOG_N = 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;
const SCRYPT_MAXMEM = 96 * 1024 * 1024;

function scryptAsync(password: string, salt: Buffer, logN: number, r: number, p: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, KEY_LEN, { N: 2 ** logN, r, p, maxmem: SCRYPT_MAXMEM }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export interface PasswordHash {
  /** `scrypt$<logN>$<r>$<p>$<base64 key>` */
  hash: string;
  /** Hex-encoded random salt (16 bytes). */
  salt: string;
}

export async function hashPassword(password: string, saltHex = randomBytes(16).toString('hex')): Promise<PasswordHash> {
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P);
  return { hash: `scrypt$${SCRYPT_LOG_N}$${SCRYPT_R}$${SCRYPT_P}$${key.toString('base64')}`, salt: saltHex };
}

/** Constant-time comparison against a stored hash. Never throws on malformed input. */
export async function verifyPassword(password: string, saltHex: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'scrypt') return false;
  const [logN, r, p] = parts.slice(1, 4).map(Number);
  if (![logN, r, p].every(Number.isInteger) || logN < 10 || logN > 20 || r < 1 || r > 32 || p < 1 || p > 4) return false;
  const expected = Buffer.from(parts[4], 'base64');
  if (expected.length !== KEY_LEN) return false;
  try {
    const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), logN, r, p);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// Used to keep login timing similar whether or not the username exists.
const DUMMY_SALT = randomBytes(16).toString('hex');
let dummyHash: Promise<PasswordHash> | null = null;

// ---------------------------------------------------------------------------
// Session tokens and cookies
// ---------------------------------------------------------------------------

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq <= 0) continue;
    const k = part.slice(0, eq).trim();
    let v = part.slice(eq + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    if (!k || k in out) continue;
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

export interface CookieOptions {
  maxAgeSec: number;
  secure: boolean;
}

export function serializeCookie(name: string, value: string, opts: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`];
  if (opts.maxAgeSec <= 0) parts.push('Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export type AuthOutcome = { ok: true; user: UserRow; token: string } | { ok: false; status: number; error: string };

export interface SessionInfo {
  user: UserRow;
  tokenHash: string;
  /** True when the expiry was pushed forward (re-send the cookie). */
  renewed: boolean;
}

export class AuthService {
  constructor(
    private readonly db: Db,
    private readonly config: Config,
    private readonly now: () => number = Date.now,
  ) {}

  private get sessionMs(): number {
    return this.config.sessionDays * 24 * 3600 * 1000;
  }

  isAdmin(username: string): boolean {
    return this.config.adminUsers.includes(username.toLowerCase());
  }

  async register(username: unknown, password: unknown): Promise<AuthOutcome> {
    const uErr = validateUsername(username);
    if (uErr) return { ok: false, status: 400, error: uErr };
    const pErr = validatePassword(password);
    if (pErr) return { ok: false, status: 400, error: pErr };
    const name = username as string;
    if (this.db.getUserByName(name)) return { ok: false, status: 409, error: 'That username is taken.' };
    const { hash, salt } = await hashPassword(password as string);
    const user = this.db.createUser(name, hash, salt, this.now());
    if (!user) return { ok: false, status: 409, error: 'That username is taken.' };
    return { ok: true, user, token: this.createSession(user.id) };
  }

  async login(username: unknown, password: unknown): Promise<AuthOutcome> {
    const fail = { ok: false as const, status: 401, error: 'Wrong username or password.' };
    if (typeof username !== 'string' || typeof password !== 'string' || username.length > 64 || password.length > PASSWORD_MAX * 4) return fail;
    const user = USERNAME_RE.test(username) ? this.db.getUserByName(username) : undefined;
    if (!user) {
      dummyHash ??= hashPassword('dummy-password', DUMMY_SALT);
      await verifyPassword(password, DUMMY_SALT, (await dummyHash).hash);
      return fail;
    }
    if (!(await verifyPassword(password, user.salt, user.passHash))) return fail;
    if (user.banned) return { ok: false, status: 403, error: 'This account is banned.' };
    this.db.setUserLastLogin(user.id, this.now());
    return { ok: true, user, token: this.createSession(user.id) };
  }

  createSession(userId: number): string {
    const token = newSessionToken();
    this.db.createSession(hashToken(token), userId, this.now() + this.sessionMs);
    return token;
  }

  /** Resolve a raw session token (from the cookie). Expired sessions are deleted. */
  session(token: string | undefined): SessionInfo | null {
    if (!token || !TOKEN_RE.test(token)) return null;
    const tokenHash = hashToken(token);
    const s = this.db.getSession(tokenHash);
    if (!s) return null;
    const now = this.now();
    if (s.expiresAt <= now) {
      this.db.deleteSession(tokenHash);
      return null;
    }
    const user = this.db.getUserById(s.userId);
    if (!user) return null;
    let renewed = false;
    if (s.expiresAt - now < this.sessionMs / 2) {
      this.db.extendSession(tokenHash, now + this.sessionMs);
      renewed = true;
    }
    return { user, tokenHash, renewed };
  }

  sessionFromCookieHeader(header: string | undefined): SessionInfo | null {
    return this.session(parseCookies(header)[SESSION_COOKIE]);
  }

  logout(token: string | undefined): void {
    if (token && TOKEN_RE.test(token)) this.db.deleteSession(hashToken(token));
  }

  sessionCookie(token: string): string {
    return serializeCookie(SESSION_COOKIE, token, { maxAgeSec: this.sessionMs / 1000, secure: this.config.cookieSecure });
  }

  clearCookie(): string {
    return serializeCookie(SESSION_COOKIE, '', { maxAgeSec: 0, secure: this.config.cookieSecure });
  }
}

/**
 * Server configuration, read once from the environment at boot.
 * Invalid values fail fast with a clear message instead of running half-configured.
 */
import path from 'node:path';
import { LOG_LEVELS, type LogLevel } from './game/log';

export interface Config {
  /** HTTP + WebSocket port (PORT, default 3000). */
  port: number;
  /** Bind address (HOST, default 0.0.0.0 in production, 127.0.0.1 otherwise). */
  host: string;
  /** SQLite file (DB_PATH, default ./data/murim.db). Its directory is created on boot. */
  dbPath: string;
  /** World generation seed (WORLD_SEED, default 1337). */
  worldSeed: number;
  /** Real milliseconds per world hour (WORLD_HOUR_MS, default 60000). */
  hourMs: number;
  /** Mark the session cookie Secure and send HSTS (COOKIE_SECURE=1 behind HTTPS). */
  cookieSecure: boolean;
  /** Session lifetime in days (SESSION_DAYS, default 14). */
  sessionDays: number;
  nodeEnv: string;
  isProd: boolean;
  logLevel: LogLevel;
  /** Use the deterministic stub simulation (SIM_STUB=1). */
  simStub: boolean;
  /** Lower-cased usernames with admin chat commands (ADMIN_USERS=a,b). */
  adminUsers: string[];
  /** Built client served by the HTTP server (STATIC_DIR, default dist/client). */
  staticDir: string;
  /** Trust X-Forwarded-For from a reverse proxy (TRUST_PROXY=1). */
  trustProxy: boolean;
  /** Extra browser origins allowed to open the websocket / call the API (ALLOWED_ORIGINS=https://a.example,https://b.example). */
  allowedOrigins: string[];
  /** Max world hours simulated on boot to catch up downtime (SIM_CATCHUP_HOURS, default 48). */
  catchUpHours: number;
  /** Dirty character autosave interval (AUTOSAVE_MS, default 30000). */
  autosaveMs: number;
  /** World snapshot interval (WORLD_SAVE_MS, default 60000). */
  worldSaveMs: number;
}

type Env = Record<string, string | undefined>;

function int(env: Env, key: string, def: number, min: number, max: number): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === '') return def;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`config: ${key} must be an integer in [${min}, ${max}], got "${raw}"`);
  return n;
}

function bool(env: Env, key: string, def: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === '') return def;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error(`config: ${key} must be a boolean (1/0/true/false), got "${env[key]}"`);
}

export function loadConfig(env: Env = process.env, overrides: Partial<Config> = {}): Config {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const isProd = nodeEnv === 'production';
  const logLevelRaw = (env.LOG_LEVEL?.trim().toLowerCase() || 'info') as LogLevel;
  if (!LOG_LEVELS.includes(logLevelRaw)) throw new Error(`config: LOG_LEVEL must be one of ${LOG_LEVELS.join(', ')}`);
  const cfg: Config = {
    port: int(env, 'PORT', 3000, 0, 65535),
    host: env.HOST?.trim() || (isProd ? '0.0.0.0' : '127.0.0.1'),
    dbPath: path.resolve(env.DB_PATH?.trim() || './data/murim.db'),
    worldSeed: int(env, 'WORLD_SEED', 1337, 0, 0x7fffffff),
    hourMs: int(env, 'WORLD_HOUR_MS', 60000, 10, 24 * 3600 * 1000),
    cookieSecure: bool(env, 'COOKIE_SECURE', false),
    sessionDays: int(env, 'SESSION_DAYS', 14, 1, 365),
    nodeEnv,
    isProd,
    logLevel: logLevelRaw,
    simStub: bool(env, 'SIM_STUB', false),
    adminUsers: (env.ADMIN_USERS ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    staticDir: path.resolve(env.STATIC_DIR?.trim() || 'dist/client'),
    trustProxy: bool(env, 'TRUST_PROXY', false),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((s) => s.trim().replace(/\/+$/, ''))
      .filter(Boolean),
    catchUpHours: int(env, 'SIM_CATCHUP_HOURS', 48, 0, 24 * 30),
    autosaveMs: int(env, 'AUTOSAVE_MS', 30000, 1000, 3600000),
    worldSaveMs: int(env, 'WORLD_SAVE_MS', 60000, 1000, 3600000),
  };
  return { ...cfg, ...overrides };
}

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('has sensible defaults', () => {
    const c = loadConfig({});
    expect(c).toMatchObject({
      port: 3000,
      worldSeed: 1337,
      hourMs: 60000,
      cookieSecure: false,
      sessionDays: 14,
      simStub: false,
      adminUsers: [],
      logLevel: 'info',
      nodeEnv: 'development',
      isProd: false,
      host: '127.0.0.1',
    });
    expect(c.dbPath).toBe(path.resolve('./data/murim.db'));
    expect(c.staticDir).toBe(path.resolve('dist/client'));
  });

  it('reads the environment', () => {
    const c = loadConfig({
      PORT: '3101',
      HOST: '0.0.0.0',
      DB_PATH: 'tmp/x.db',
      WORLD_SEED: '42',
      WORLD_HOUR_MS: '200',
      COOKIE_SECURE: 'true',
      SESSION_DAYS: '3',
      NODE_ENV: 'production',
      LOG_LEVEL: 'WARN',
      SIM_STUB: '1',
      ADMIN_USERS: ' Alice, bob ,,',
      STATIC_DIR: 'public',
      ALLOWED_ORIGINS: 'https://a.example/, https://b.example',
    });
    expect(c).toMatchObject({
      port: 3101,
      host: '0.0.0.0',
      worldSeed: 42,
      hourMs: 200,
      cookieSecure: true,
      sessionDays: 3,
      isProd: true,
      logLevel: 'warn',
      simStub: true,
      adminUsers: ['alice', 'bob'],
      allowedOrigins: ['https://a.example', 'https://b.example'],
    });
    expect(c.dbPath).toBe(path.resolve('tmp/x.db'));
    expect(loadConfig({ NODE_ENV: 'production' }).host).toBe('0.0.0.0');
  });

  it('fails fast on invalid values', () => {
    expect(() => loadConfig({ PORT: 'abc' })).toThrow(/PORT/);
    expect(() => loadConfig({ PORT: '70000' })).toThrow(/PORT/);
    expect(() => loadConfig({ WORLD_HOUR_MS: '1' })).toThrow(/WORLD_HOUR_MS/);
    expect(() => loadConfig({ COOKIE_SECURE: 'maybe' })).toThrow(/COOKIE_SECURE/);
    expect(() => loadConfig({ LOG_LEVEL: 'loud' })).toThrow(/LOG_LEVEL/);
  });

  it('applies overrides last', () => {
    expect(loadConfig({ PORT: '1' }, { port: 2 }).port).toBe(2);
  });
});

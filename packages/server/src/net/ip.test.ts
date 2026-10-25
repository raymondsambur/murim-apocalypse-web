import { describe, expect, it } from 'vitest';
import { clientIp, originAllowed } from './ip';

const req = (headers: Record<string, string>, remote = '::ffff:10.0.0.5') => ({ headers, socket: { remoteAddress: remote } });

describe('clientIp', () => {
  it('uses the socket address by default and ignores spoofable headers', () => {
    expect(clientIp(req({ 'x-forwarded-for': '1.2.3.4' }), false)).toBe('10.0.0.5');
  });
  it('behind a trusted proxy uses the last (proxy-appended) entry', () => {
    expect(clientIp(req({ 'x-forwarded-for': '6.6.6.6, 203.0.113.9' }), true)).toBe('203.0.113.9');
    expect(clientIp(req({}), true)).toBe('10.0.0.5');
  });
});

describe('originAllowed', () => {
  const prod = { isProd: true, allowedOrigins: ['https://play.example'], trustProxy: false };
  it('allows requests without an Origin header', () => {
    expect(originAllowed({}, prod)).toBe(true);
  });
  it('in production requires the origin host to match the Host header or the allow list', () => {
    expect(originAllowed({ origin: 'https://game.example', host: 'game.example' }, prod)).toBe(true);
    expect(originAllowed({ origin: 'https://evil.example', host: 'game.example' }, prod)).toBe(false);
    expect(originAllowed({ origin: 'https://play.example', host: 'game.example' }, prod)).toBe(true);
    expect(originAllowed({ origin: 'null', host: 'game.example' }, prod)).toBe(false);
    expect(originAllowed({ origin: 'https://game.example', host: 'internal:3000', 'x-forwarded-host': 'game.example' }, { ...prod, trustProxy: true })).toBe(true);
  });
  it('is permissive in development (Vite proxy)', () => {
    expect(originAllowed({ origin: 'http://localhost:5173', host: 'localhost:3000' }, { ...prod, isProd: false })).toBe(true);
  });
});

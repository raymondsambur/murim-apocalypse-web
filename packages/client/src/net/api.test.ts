import { afterEach, describe, expect, it } from 'vitest';
import { ApiFailure, api, fetchTransport, friendlyApiError, setHttpTransport } from './api';
import { decodeBase64, decodeWorld, encodeBase64 } from './base64';

afterEach(() => setHttpTransport(fetchTransport));

describe('friendlyApiError', () => {
  it('maps known server codes to player-facing sentences', () => {
    expect(friendlyApiError(401, 'bad_credentials', 'login')).toMatch(/do not match/);
    expect(friendlyApiError(409, 'username_taken', 'register')).toMatch(/already taken/);
    expect(friendlyApiError(409, 'name_taken', 'create')).toMatch(/name is already taken/);
  });

  it('falls back on the status code, never exposing raw codes', () => {
    expect(friendlyApiError(429, '', 'login')).toMatch(/Too many/);
    expect(friendlyApiError(500, 'internal', 'me')).toMatch(/server had a problem/);
    expect(friendlyApiError(0, '', 'me')).toMatch(/Cannot reach/);
    expect(friendlyApiError(401, '', 'me')).toMatch(/session has expired/);
    expect(friendlyApiError(400, 'weird_code', 'roll')).toMatch(/went wrong/);
  });

  it('shows short readable sentences from the server as they are', () => {
    expect(friendlyApiError(400, 'That name is reserved.', 'create')).toBe('That name is reserved.');
  });
});

describe('api helpers', () => {
  it('me() returns null on 401 and the body on success', async () => {
    setHttpTransport({ request: async () => ({ status: 401, body: { error: 'unauthorized' } }) });
    expect(await api.me()).toBeNull();
    setHttpTransport({ request: async () => ({ status: 200, body: { user: { id: 1, username: 'a' }, character: null, rerollsLeft: 3 } }) });
    expect((await api.me())?.user.username).toBe('a');
  });

  it('turns failures into ApiFailure with a friendly message', async () => {
    setHttpTransport({ request: async () => ({ status: 409, body: { error: 'username_taken' } }) });
    const err = (await api.register({ username: 'a', password: 'b' }).catch((e) => e)) as ApiFailure;
    expect(err).toBeInstanceOf(ApiFailure);
    expect(err.status).toBe(409);
    expect(err.message).toMatch(/already taken/);
  });

  it('reports network errors as status 0', async () => {
    setHttpTransport({
      request: async () => {
        throw new Error('offline');
      },
    });
    const err = (await api.world().catch((e) => e)) as ApiFailure;
    expect(err.status).toBe(0);
  });

  it('roll(false) asks for the pending roll, roll(true) spends a reroll', async () => {
    const calls: unknown[] = [];
    setHttpTransport({
      request: async (method, path, body) => {
        calls.push([method, path, body]);
        return { status: 200, body: {} };
      },
    });
    await api.roll(false);
    await api.roll(true);
    expect(calls).toEqual([
      ['POST', '/api/character/roll', { reroll: false }],
      ['POST', '/api/character/roll', { reroll: true }],
    ]);
  });
});

describe('base64 world decoding', () => {
  it('round-trips bytes including large arrays', () => {
    const big = new Uint8Array(100_000).map((_, i) => i % 251);
    expect(decodeBase64(encodeBase64(big))).toEqual(big);
  });

  it('decodes a world payload and rejects a size mismatch', () => {
    const payload = { seed: 1, w: 2, h: 2, terrain: encodeBase64(new Uint8Array([1, 2, 3, 4])), objects: encodeBase64(new Uint8Array([0, 0, 0, 0])), settlements: [], buildings: [], nodes: [], roads: [] };
    const w = decodeWorld(payload);
    expect([...w.terrain]).toEqual([1, 2, 3, 4]);
    expect(() => decodeWorld({ ...payload, w: 3 })).toThrow(/size mismatch/);
  });
});

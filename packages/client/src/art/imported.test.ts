import { describe, expect, it } from 'vitest';
import { ImportedRegistry, dirGeometry, parseMeta, resolveDir, type ImportedMeta } from './imported';

const meta = (over: Partial<ImportedMeta> = {}): ImportedMeta => ({
  id: 'pack_ox',
  w: 40,
  h: 30,
  ax: 20,
  ay: 28,
  top: 0,
  footprint: { w: 1, d: 1 },
  heightPx: 26,
  dirs: { '0': { file: '0.png' }, '3': { file: '3.png', ax: 18 }, '1': { from: 0, flip: true }, '2': { from: 3, flip: true } },
  provenance: { tool: 'test', prompt: 'p', date: '2026-10-26' },
  ...over,
});

describe('imported sprite metadata', () => {
  it('accepts a complete description and rejects broken ones with a reason', () => {
    expect(parseMeta(meta()).id).toBe('pack_ox');
    expect(() => parseMeta(null)).toThrow(/not an object/);
    expect(() => parseMeta(meta({ id: 'Bad Id' }))).toThrow(/id must/);
    expect(() => parseMeta(meta({ ax: -1 }))).toThrow(/ax/);
    expect(() => parseMeta(meta({ dirs: {} }))).toThrow(/dirs missing/);
    expect(() => parseMeta(meta({ dirs: { '4': { file: 'x.png' } } }))).toThrow(/not 0-3/);
    expect(() => parseMeta(meta({ dirs: { '0': { file: 'a.png' }, '1': { from: 2 } } }))).toThrow(/missing dir 2/);
    expect(() => parseMeta({ ...meta(), provenance: undefined })).toThrow(/provenance/);
  });

  it('resolves derived facings to the picture that owns them, with the net mirroring', () => {
    const m = meta();
    expect(resolveDir(m, 0)).toMatchObject({ source: 0, flip: false });
    expect(resolveDir(m, 1)).toMatchObject({ source: 0, flip: true });
    expect(resolveDir(m, 2)).toMatchObject({ source: 3, flip: true });
    expect(resolveDir(m, 3)).toMatchObject({ source: 3, flip: false });
    // a mirror of a mirror is the original
    const twice = meta({ dirs: { '0': { file: '0.png' }, '1': { from: 0, flip: true }, '2': { from: 1, flip: true } } });
    expect(resolveDir(twice, 2)).toMatchObject({ source: 0, flip: false });
    // cycles do not hang
    const loop = { ...meta(), dirs: { '0': { from: 1 }, '1': { from: 0 } } } as ImportedMeta;
    expect(resolveDir(loop, 0)).toBeNull();
    expect(resolveDir(m, 9)).toBeNull();
  });

  it('a facing overrides the top-level geometry only where it says so', () => {
    const m = meta();
    expect(dirGeometry(m, m.dirs['0'])).toEqual({ w: 40, h: 30, ax: 20, ay: 28, top: 0 });
    expect(dirGeometry(m, m.dirs['3'])).toEqual({ w: 40, h: 30, ax: 18, ay: 28, top: 0 });
  });

  it('the registry lists, serves metadata and stays empty until pictures are loaded', () => {
    const r = new ImportedRegistry();
    r.register(meta(), (f) => `/sprites/pack_ox/${f}`);
    expect(r.ids()).toEqual(['pack_ox']);
    expect(r.meta('pack_ox')?.heightPx).toBe(26);
    expect(r.get('pack_ox', 0)).toBeUndefined();
    expect(r.get('nope', 0)).toBeUndefined();
  });
});

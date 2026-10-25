import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_BYTES, parseClientMessage } from './schemas';

const ok = (m: unknown) => parseClientMessage(JSON.stringify(m));

describe('parseClientMessage: valid messages', () => {
  const valid: unknown[] = [
    { t: 'ping', t0: 12345.5 },
    { t: 'q', id: 1, name: 'world', args: {} },
    { t: 'q', id: 2, name: 'npc', args: { id: 5 } },
    { t: 'q', id: 3, name: 'chronicle', args: { before: 10, limit: 20 } },
    { t: 'q', id: 4, name: 'player', args: { name: 'Han Solo' } },
    { t: 'q', id: 5, name: 'recipes', args: { site: '3:alchemyLab:0' } },
    { t: 'move', x: 10, y: 20 },
    { t: 'stop' },
    { t: 'interact', id: 7 },
    { t: 'assist', combat: 3 },
    { t: 'flee' },
    { t: 'alloc', stat: 'might', n: 2 },
    { t: 'equip', idx: 3, id: 'w_sword_1' },
    { t: 'unequip', slot: 'weapon' },
    { t: 'use', idx: 0, id: 'pill_heal_s' },
    { t: 'drop', idx: 1, id: 'grain', qty: 2 },
    {
      t: 'build',
      loadout: { active: ['sword_basic', null, null, null], internal: null, movement: null },
      stance: 'balanced',
      tactics: [{ cond: { k: 'hpBelow', v: 35 }, act: { k: 'item', id: 'pill_heal_s' } }, { cond: { k: 'always' }, act: { k: 'basic' } }],
    },
    { t: 'breakthrough' },
    { t: 'buy', npc: 4, item: 'grain', qty: 3 },
    { t: 'sell', npc: 4, idx: 2, id: 'grain', qty: 1 },
    { t: 'learn', npc: 4, skill: 'sword_basic' },
    { t: 'rest', npc: 4 },
    { t: 'maccept', offer: 'm12', settlement: 2 },
    { t: 'mabandon', id: 'm12' },
    { t: 'mturnin', id: 'm12' },
    { t: 'mturnin', id: 'm12', npc: 3 },
    { t: 'astart', kind: 'train', site: '0:dojo:0' },
    { t: 'astart', kind: 'shift', site: '0:farm:0', job: 'farmer' },
    { t: 'astart', kind: 'craft', site: '2:smithy:1', recipe: 'r_iron', qty: 5 },
    { t: 'astop' },
    { t: 'chat', ch: 'local', text: 'hello' },
    { t: 'chat', ch: 'whisper', text: 'psst', to: 'Bob' },
    { t: 'friend', op: 'add', name: 'Bob' },
    { t: 'friend', op: 'accept', id: 9 },
    { t: 'sect', op: 'create', name: 'Azure Lotus', tag: 'AL', motto: 'We rise' },
    { t: 'sect', op: 'promote', id: 3, role: 'elder' },
    { t: 'sect', op: 'leave' },
    { t: 'master', op: 'request', npc: 3 },
    { t: 'master', op: 'teach', id: 3, skill: 'sword_basic' },
    { t: 'duel', op: 'challenge', id: 8, stake: 10 },
    { t: 'duel', op: 'decline', id: 8 },
    { t: 'title', title: 'Sword Saint' },
  ];

  it.each(valid.map((m) => [JSON.stringify(m).slice(0, 60), m] as const))('accepts %s', (_name, m) => {
    const r = ok(m);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.msg).toEqual(m);
  });

  it('strips unknown fields instead of passing them through', () => {
    const r = ok({ t: 'move', x: 1, y: 2, admin: true, __proto__: { polluted: 1 } });
    expect(r).toMatchObject({ ok: true });
    if (r.ok) expect(Object.keys(r.msg).sort()).toEqual(['t', 'x', 'y']);
  });
});

describe('parseClientMessage: rejects malformed input', () => {
  const invalid: [string, unknown][] = [
    ['unknown type', { t: 'teleport', x: 1, y: 1 }],
    ['missing type', { x: 1, y: 1 }],
    ['non-string type', { t: 5 }],
    ['float coordinates', { t: 'move', x: 1.5, y: 2 }],
    ['negative coordinates', { t: 'move', x: -1, y: 2 }],
    ['huge coordinates', { t: 'move', x: 1e9, y: 2 }],
    ['string coordinates', { t: 'move', x: '1', y: 2 }],
    ['NaN-like', { t: 'move', x: null, y: 2 }],
    ['bad stat', { t: 'alloc', stat: 'luck', n: 1 }],
    ['zero alloc', { t: 'alloc', stat: 'might', n: 0 }],
    ['negative qty', { t: 'buy', npc: 1, item: 'grain', qty: -5 }],
    ['zero qty', { t: 'drop', idx: 0, id: 'grain', qty: 0 }],
    ['item id with spaces', { t: 'use', idx: 0, id: 'a b' }],
    ['item id injection', { t: 'use', idx: 0, id: "x'; DROP TABLE users;--" }],
    ['huge item id', { t: 'use', idx: 0, id: 'a'.repeat(200) }],
    ['bad slot', { t: 'unequip', slot: 'head' }],
    ['system chat channel', { t: 'chat', ch: 'system', text: 'x' }],
    ['empty chat', { t: 'chat', ch: 'local', text: '' }],
    ['huge chat', { t: 'chat', ch: 'local', text: 'x'.repeat(601) }],
    ['bad query name', { t: 'q', id: 1, name: 'dropTables', args: {} }],
    ['bad query args', { t: 'q', id: 1, name: 'npc', args: { id: 'x' } }],
    ['query missing args', { t: 'q', id: 1, name: 'npc' }],
    ['query negative id', { t: 'q', id: -1, name: 'world', args: {} }],
    ['too many tactics', { t: 'build', loadout: { active: [], internal: null, movement: null }, stance: 'balanced', tactics: Array(9).fill({ cond: { k: 'always' }, act: { k: 'basic' } }) }],
    ['bad stance', { t: 'build', loadout: { active: [], internal: null, movement: null }, stance: 'wild', tactics: [] }],
    ['bad tactic', { t: 'build', loadout: { active: [], internal: null, movement: null }, stance: 'balanced', tactics: [{ cond: { k: 'nope' }, act: { k: 'basic' } }] }],
    ['bad activity', { t: 'astart', kind: 'sleep', site: 'x' }],
    ['craft qty too large', { t: 'astart', kind: 'craft', site: 'x', recipe: 'r', qty: 1000 }],
    ['bad job', { t: 'astart', kind: 'shift', site: 'x', job: 'thief' }],
    ['bad sect op', { t: 'sect', op: 'nuke' }],
    ['negative deposit', { t: 'sect', op: 'deposit', gold: -5 }],
    ['bad role', { t: 'sect', op: 'promote', id: 1, role: 'god' }],
    ['ping without t0', { t: 'ping' }],
    ['infinite t0', { t: 'ping', t0: 'Infinity' }],
  ];

  it.each(invalid)('rejects %s', (_name, m) => {
    expect(ok(m).ok).toBe(false);
  });

  it('rejects non-objects, bad JSON and oversized frames without throwing', () => {
    for (const raw of ['', 'null', '[]', '42', '"str"', '{', '{"t":', 'undefined', '{"t":"move","x":1,"y":2}}', '\u0000', '{"__proto__":{"t":"stop"}}']) {
      expect(() => parseClientMessage(raw)).not.toThrow();
      expect(parseClientMessage(raw).ok).toBe(false);
    }
    expect(parseClientMessage(JSON.stringify({ t: 'chat', ch: 'local', text: 'x'.repeat(MAX_MESSAGE_BYTES) })).ok).toBe(false);
  });

  it('survives random fuzz', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const types = ['ping', 'move', 'q', 'chat', 'build', 'astart', 'sect', 'friend', 'master', 'duel', 'title', 'x'];
    const junk = () => [null, undefined, 0, -1, 1e20, NaN, 'a', '', [], {}, [1, 2], { t: 'stop' }, true][Math.floor(rnd() * 13)];
    for (let i = 0; i < 2000; i++) {
      const m: Record<string, unknown> = { t: types[Math.floor(rnd() * types.length)] };
      for (const k of ['x', 'y', 'id', 'name', 'args', 'op', 'kind', 'text', 'ch', 'loadout', 'tactics']) if (rnd() < 0.5) m[k] = junk();
      expect(() => parseClientMessage(JSON.stringify(m))).not.toThrow();
    }
  });
});

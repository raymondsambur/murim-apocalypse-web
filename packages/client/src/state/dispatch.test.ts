import { describe, expect, it, vi } from 'vitest';
import type { MeView, S2C } from '@murim/shared';
import { encodeBase64 } from '../net/base64';
import { dispatchServerMessage, type ViewSink } from './dispatch';
import { Store } from './store';

function sink(): ViewSink & Record<string, ReturnType<typeof vi.fn>> {
  return {
    clearEntities: vi.fn(),
    setSelf: vi.fn(),
    setTime: vi.fn(),
    setSettlements: vi.fn(),
    setBlight: vi.fn(),
    patchBlight: vi.fn(),
    applyEntities: vi.fn(),
    combatEvents: vi.fn(),
    fx: vi.fn(),
    say: vi.fn(),
  } as never;
}

const you = { entityId: 5, combatId: null, c: { name: 'Hero', hp: 10, qi: 1, missions: [] }, d: { maxHp: 10, maxQi: 5 }, xpNext: 36, sect: null, master: null, disciples: [], now: 0 } as unknown as MeView;
const time = { hours: 6, day: 1, season: 0, year: 0, hourMs: 60000, t: 0, weather: ['clear'] } as never;

describe('dispatchServerMessage', () => {
  it('hello fills the store and tells the renderer', () => {
    const s = new Store();
    const v = sink();
    const hello = vi.fn();
    dispatchServerMessage(s, v, { t: 'hello', you, time, settlements: [], chronicle: [], blight: encodeBase64(new Uint8Array([1, 2, 3])), serverNow: Date.now(), protocol: 1 }, { hello });
    expect(s.selfId()).toBe(5);
    expect(v.clearEntities).toHaveBeenCalled();
    expect(v.setSelf).toHaveBeenCalledWith(5);
    expect(v.setBlight).toHaveBeenCalledWith(new Uint8Array([1, 2, 3]));
    expect(hello).toHaveBeenCalled();
  });

  it('forwards entity deltas to both the store and the renderer', () => {
    const s = new Store();
    const v = sink();
    const msg: S2C = { t: 'ents', add: [{ id: 2, kind: 'monster', name: 'Wolf', x: 1, y: 1, face: 0, state: 'idle' }] };
    dispatchServerMessage(s, v, msg);
    expect(s.get('entities').get(2)?.name).toBe('Wolf');
    expect(v.applyEntities).toHaveBeenCalledWith({ add: (msg as { add: unknown }).add, upd: undefined, del: undefined });
  });

  it('shows local chat as a speech bubble above the speaker', () => {
    const s = new Store();
    const v = sink();
    s.applyEnts({ add: [{ id: 3, kind: 'player', name: 'Zed', x: 0, y: 0, face: 0, state: 'idle' }] });
    dispatchServerMessage(s, v, { t: 'chat', msg: { ch: 'local', from: 'Zed', fromId: 3, text: 'hey', t: 1 } });
    expect(v.say).toHaveBeenCalledWith(3, 'hey');
    dispatchServerMessage(s, v, { t: 'chat', msg: { ch: 'world', from: 'Zed', text: 'loud', t: 2 } });
    expect(v.say).toHaveBeenCalledTimes(1);
  });

  it('notes become toasts via the hook and system chat lines', () => {
    const s = new Store();
    const note = vi.fn();
    dispatchServerMessage(s, null, { t: 'note', level: 'good', text: 'You level up' }, { note });
    expect(note).toHaveBeenCalledWith('good', 'You level up');
    expect(s.get('chat').system.lines[0].text).toBe('You level up');
    expect(s.get('notes')).toHaveLength(1);
  });

  it('combat messages update the store and feed the renderer; cend reaches the hook', () => {
    const s = new Store();
    const v = sink();
    const ended = vi.fn();
    const c = { id: 1, beat: 1, x: 0, y: 0, duel: false, fighters: [] };
    dispatchServerMessage(s, v, { t: 'combat', c, ev: [{ k: 'down', d: 4 }] });
    expect(v.combatEvents).toHaveBeenCalledWith([{ k: 'down', d: 4 }]);
    dispatchServerMessage(s, v, { t: 'cend', id: 1, result: 'fled', text: 'ok' }, { combatEnded: ended });
    expect(ended).toHaveBeenCalled();
    expect(s.get('combat')!.ended!.result).toBe('fled');
    dispatchServerMessage(s, v, { t: 'cfx', ev: [] });
  });

  it('stores npc menus, invites and kick reasons; works without a renderer', () => {
    const s = new Store();
    dispatchServerMessage(s, null, { t: 'npc', menu: { id: 1, name: 'Mu' } as never });
    expect(s.get('npc')!.name).toBe('Mu');
    dispatchServerMessage(s, null, { t: 'invite', kind: 'duel', fromId: 9, from: 'Zed' });
    expect(s.get('invites')[0].kind).toBe('duel');
    const kicked = vi.fn();
    dispatchServerMessage(s, null, { t: 'kick', reason: 'bye' }, { kicked });
    expect(s.get('kicked')).toBe('bye');
    expect(kicked).toHaveBeenCalledWith('bye');
    dispatchServerMessage(s, null, { t: 'ents', add: [] });
  });

  it('error messages are echoed to the system tab and the error hook', () => {
    const s = new Store();
    const error = vi.fn();
    dispatchServerMessage(s, null, { t: 'err', code: 'too_far', text: 'Too far away.' }, { error });
    expect(error).toHaveBeenCalledWith('too_far', 'Too far away.');
    expect(s.get('chat').system.lines[0].level).toBe('bad');
  });
});

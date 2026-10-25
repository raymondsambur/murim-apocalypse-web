import { describe, expect, it } from 'vitest';
import { makeHarness } from '../testkit';
import { chatToSect, maskProfanity, sanitizeText } from './chat';

describe('sanitizeText', () => {
  it('collapses whitespace, strips control and invisible characters, trims', () => {
    expect(sanitizeText('  hello \t\n  world  ')).toBe('hello world');
    expect(sanitizeText('he\u0000llo\u0007')).toBe('he llo');
    expect(sanitizeText('zero​width‎joiner‮evil﻿')).toBe('zerowidthjoinerevil');
    expect(sanitizeText('\u0000\u0001  ')).toBe('');
  });

  it('caps length by code points, not UTF-16 units, without splitting characters', () => {
    const s = '\u{1F600}'.repeat(300);
    const out = sanitizeText(s, 200);
    expect(Array.from(out).length).toBe(200);
    expect(out).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(sanitizeText('x'.repeat(500)).length).toBe(200);
    expect(sanitizeText('abc   ', 3)).toBe('abc');
  });

  it('normalises unicode (NFC)', () => {
    expect(sanitizeText('é')).toBe('é');
  });

  it('masks profanity and its inflections but not innocent words', () => {
    expect(maskProfanity('what the fuck is this shit')).toBe('what the **** is this ****');
    expect(maskProfanity('Fucking hell')).toBe('******* hell');
    expect(maskProfanity('classic assassin in Scunthorpe')).toBe('classic assassin in Scunthorpe');
    expect(sanitizeText('SHIT happens')).toBe('**** happens');
  });

  it('leaves markup alone (the client renders text, never HTML)', () => {
    expect(sanitizeText('<script>alert(1)</script>')).toBe('<script>alert(1)</script>');
  });
});

describe('chat admin commands', () => {
  it('admins can mute, kick and ban; others get nothing', () => {
    const h = makeHarness({ ADMIN_USERS: 'user1_boss' });
    const boss = h.join('Boss');
    const bob = h.join('Bob');
    const eve = h.join('Eve');
    expect(boss.p.isAdmin).toBe(true);
    expect(bob.p.isAdmin).toBe(false);

    h.say(boss.p, { t: 'chat', ch: 'local', text: '/mute bob 5' });
    h.tick();
    expect(bob.p.mutedUntil).toBeGreaterThan(h.clock.t);
    expect(h.db.getUserById(bob.user.id)!.mutedUntil).toBe(bob.p.mutedUntil);

    h.say(boss.p, { t: 'chat', ch: 'local', text: '/unmute bob' });
    h.tick();
    expect(bob.p.mutedUntil).toBe(0);

    h.say(boss.p, { t: 'chat', ch: 'local', text: '/kick eve' });
    h.tick();
    expect(eve.conn.of('kick').length).toBe(1);
    expect(eve.conn.closedWith).not.toBeNull();

    h.say(boss.p, { t: 'chat', ch: 'local', text: '/ban bob' });
    h.tick();
    expect(h.db.getUserById(bob.user.id)!.banned).toBe(true);
    expect(bob.conn.closedWith?.code).toBe(4003);

    h.say(boss.p, { t: 'chat', ch: 'local', text: '/mute nobody' });
    h.tick();
    expect(boss.conn.last('note')?.text).toMatch(/No character named/);

    h.say(bob.p, { t: 'chat', ch: 'local', text: '/ban boss' });
    h.tick();
    expect(h.db.getUserById(boss.user.id)!.banned).toBe(false);
    h.close();
  });

  it('chatToSect delivers to the members the resolver names', () => {
    const h = makeHarness();
    const a = h.join('Ann');
    const b = h.join('Ben');
    const c = h.join('Cat');
    a.p.save.sectId = 7;
    b.p.save.sectId = 7;
    chatToSect(h.game.ctx.chat, 7, { ch: 'sect', from: 'Ann', text: 'hi', t: 1 });
    expect(a.conn.of('chat').length).toBe(1);
    expect(b.conn.of('chat').length).toBe(1);
    expect(c.conn.of('chat').length).toBe(0);
    h.game.ctx.chat.setSectResolver((id) => (id === 9 ? [c.p] : []));
    chatToSect(h.game.ctx.chat, 9, { ch: 'sect', from: 'Cat', text: 'yo', t: 2 });
    expect(c.conn.of('chat').length).toBe(1);
    h.close();
  });

  it('system messages go to one player or everybody', () => {
    const h = makeHarness();
    const a = h.join('Ann');
    const b = h.join('Ben');
    h.game.ctx.chat.system('Maintenance soon', a.p);
    expect(a.conn.last('chat')?.msg).toMatchObject({ ch: 'system', text: 'Maintenance soon' });
    expect(b.conn.of('chat').length).toBe(0);
    h.game.ctx.chat.system('Everyone');
    expect(b.conn.last('chat')?.msg.text).toBe('Everyone');
    h.close();
  });
});

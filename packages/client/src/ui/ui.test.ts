import { describe, expect, it } from 'vitest';
import type { TimeView } from '@murim/shared';
import { clockText, climateBand, dayPhase, fmtCompact, fmtDuration, fmtInt, fmtSigned, rankColor, seasonName, titleCase, worldClock } from './format';
import { normalizeCharName, passwordStrength, validateCharName, validatePassword, validatePasswordConfirm, validateUsername } from './validation';

describe('validation', () => {
  it('username: 3-20 of [A-Za-z0-9_]', () => {
    expect(validateUsername('')).toBe('val.username.required');
    expect(validateUsername('ab')).toBe('val.username.short');
    expect(validateUsername('a'.repeat(21))).toBe('val.username.long');
    expect(validateUsername('bad name')).toBe('val.username.chars');
    expect(validateUsername('héllo')).toBe('val.username.chars');
    expect(validateUsername('Good_Name_9')).toBeNull();
    expect(validateUsername('a'.repeat(20))).toBeNull();
  });

  it('password: 8-72 characters and confirmation', () => {
    expect(validatePassword('')).toBe('val.password.required');
    expect(validatePassword('1234567')).toBe('val.password.short');
    expect(validatePassword('x'.repeat(73))).toBe('val.password.long');
    expect(validatePassword('x'.repeat(8))).toBeNull();
    expect(validatePasswordConfirm('abc', '')).toBe('val.confirm.required');
    expect(validatePasswordConfirm('abc', 'abd')).toBe('val.confirm.mismatch');
    expect(validatePasswordConfirm('abc', 'abc')).toBeNull();
  });

  it('character name: letters, single separators inside, 3-16 long', () => {
    expect(validateCharName('')).toBe('val.name.required');
    expect(validateCharName('Al')).toBe('val.name.short');
    expect(validateCharName('A'.repeat(17))).toBe('val.name.long');
    expect(validateCharName('Han Gyeom')).toBeNull();
    expect(validateCharName("D'Arc-Lee")).toBeNull();
    expect(validateCharName('Han  Gyeom')).toBeNull(); // collapsed to one space before checking
    expect(validateCharName('Han--Gyeom')).toBe('val.name.chars');
    expect(validateCharName('9Lives')).toBe('val.name.chars');
    expect(validateCharName('Bob_')).toBe('val.name.chars');
    expect(normalizeCharName('  Han   Gyeom ')).toBe('Han Gyeom');
  });

  it('password strength is monotonic with variety and length', () => {
    expect(passwordStrength('short')).toBe(0);
    expect(passwordStrength('abcdefgh')).toBeGreaterThanOrEqual(1);
    expect(passwordStrength('Abcdefgh1234!')).toBeGreaterThan(passwordStrength('abcdefgh'));
    expect(passwordStrength('Abcdefgh1234!xyz')).toBeLessThanOrEqual(4);
  });
});

describe('format helpers', () => {
  it('formats numbers', () => {
    expect(fmtInt(1234567)).toBe('1,234,567');
    expect(fmtCompact(950)).toBe('950');
    expect(fmtCompact(12_300)).toBe('12.3k');
    expect(fmtCompact(2_500_000)).toBe('2.5m');
    expect(fmtSigned(4)).toBe('+4');
    expect(fmtSigned(-4)).toBe('-4');
    expect(fmtSigned(1.5, 1)).toBe('+1.5');
  });

  it('formats durations', () => {
    expect(fmtDuration(9_000)).toBe('9s');
    expect(fmtDuration(125_000)).toBe('2m 5s');
    expect(fmtDuration(3_900_000)).toBe('1h 5m');
  });

  it('colours by rank and titles case', () => {
    expect(rankColor(1)).toBe('#b9b2a0');
    expect(rankColor(10)).toBe('#7ec26b');
    expect(rankColor(999)).toBeTruthy();
    expect(titleCase('iron_bones')).toBe('Iron Bones');
  });

  it('extrapolates the world clock between server updates and rolls the day over', () => {
    const base: TimeView = { hours: 22, day: 29, season: 0, year: 0, hourMs: 1000, t: 0, weather: ['clear'] };
    const same = worldClock(base, 0);
    expect(same.hours).toBe(22);
    const later = worldClock(base, 3000); // +3 world hours -> 01:00 next day
    expect(later.hours).toBeCloseTo(1);
    expect(later.day).toBe(30);
    expect(later.season).toBe(1); // day 30 starts Summer
    expect(later.dayOfSeason).toBe(1);
    expect(worldClock(base, -500).hours).toBe(22); // clocks that run slightly behind never go backwards
  });

  it('day phases, clock text, season names, climate bands', () => {
    expect(dayPhase(6)).toBe('dawn');
    expect(dayPhase(12)).toBe('day');
    expect(dayPhase(18)).toBe('dusk');
    expect(dayPhase(23)).toBe('night');
    expect(dayPhase(2)).toBe('night');
    expect(clockText(9.5)).toBe('09:30');
    expect(clockText(0)).toBe('00:00');
    expect(seasonName(3)).toBe('Winter');
    expect(seasonName(5)).toBe('Summer');
    expect(climateBand(0, 120)).toBe(0);
    expect(climateBand(60, 120)).toBe(1);
    expect(climateBand(119, 120)).toBe(2);
  });
});

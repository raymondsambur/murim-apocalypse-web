/** Formatting helpers for numbers, world time and names. Pure. */
import { DAYS_PER_SEASON, HOURS_PER_DAY, RANKS, SEASONS, rankOf, type TimeView, type WeatherKind } from '@murim/shared';
import { t } from '../i18n';

export function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** 1234 -> "1.2k" for tight spaces. */
export function fmtCompact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'm';
  if (a >= 1e4) return (n / 1e3).toFixed(a >= 1e5 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return fmtInt(n);
}

export function fmtPct(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** Number with at most `digits` decimals, trailing zeros removed. */
export function fmtNum(n: number, digits = 1): string {
  return Number(n.toFixed(digits)).toString();
}

export function fmtSigned(n: number, digits = 0): string {
  const s = digits ? fmtNum(n, digits) : fmtInt(n);
  return n > 0 ? `+${s}` : s;
}

export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t('time.seconds', { n: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t('time.minutes', { n: m, s: s % 60 });
  const hh = Math.floor(m / 60);
  return t('time.hours', { n: hh, m: m % 60 });
}

export function rankColor(level: number): string {
  return RANKS[rankOf(level) - 1]?.color ?? RANKS[0].color;
}

export function rankColorOfRank(rank: number): string {
  return RANKS[Math.max(1, Math.min(RANKS.length, rank)) - 1].color;
}

export interface WorldClockReading {
  hours: number;
  day: number;
  season: number;
  year: number;
  dayOfSeason: number;
}

/** Extrapolate the world clock from the last TimeView to `serverNow`. */
export function worldClock(time: TimeView, serverNow: number): WorldClockReading {
  const elapsedHours = Math.max(0, (serverNow - time.t) / Math.max(1, time.hourMs));
  let hours = time.hours + elapsedHours;
  let day = time.day;
  while (hours >= HOURS_PER_DAY) {
    hours -= HOURS_PER_DAY;
    day++;
  }
  const extraDays = day - time.day;
  // Re-derive season/year only when the day rolled over during extrapolation.
  let season = time.season;
  let year = time.year;
  if (extraDays > 0) {
    const absSeason = Math.floor(day / DAYS_PER_SEASON);
    season = absSeason % SEASONS.length;
    year = Math.floor(absSeason / SEASONS.length) + (time.year - Math.floor(Math.floor(time.day / DAYS_PER_SEASON) / SEASONS.length));
  }
  return { hours, day, season, year, dayOfSeason: (day % DAYS_PER_SEASON) + 1 };
}

export type DayPhase = 'dawn' | 'day' | 'dusk' | 'night';

export function dayPhase(hours: number): DayPhase {
  if (hours >= 5 && hours < 7.5) return 'dawn';
  if (hours >= 7.5 && hours < 17.5) return 'day';
  if (hours >= 17.5 && hours < 20) return 'dusk';
  return 'night';
}

export const PHASE_GLYPH: Record<DayPhase, string> = { dawn: '曉', day: '日', dusk: '暮', night: '月' };
export const WEATHER_GLYPH: Record<WeatherKind, string> = { clear: '晴', cloudy: '雲', rain: '雨', storm: '雷', fog: '霧', snow: '雪' };

export function clockText(hours: number): string {
  const h = Math.floor(hours) % 24;
  const m = Math.floor((hours - Math.floor(hours)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function seasonName(season: number): string {
  return t(`season.${SEASONS[((season % 4) + 4) % 4].toLowerCase()}`);
}

/** Climate band for a tile row: 0 north, 1 central, 2 south. */
export function climateBand(y: number, worldH: number): number {
  return Math.max(0, Math.min(2, Math.floor((y / Math.max(1, worldH)) * 3)));
}

export function titleCase(s: string): string {
  return s.replace(/(^|[\s_-])(\w)/g, (_m, a: string, b: string) => (a === '_' || a === '-' ? ' ' : a) + b.toUpperCase());
}

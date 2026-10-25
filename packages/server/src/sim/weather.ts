/**
 * Weather per climate band (0 north, 1 central, 2 south): a season-aware Markov chain
 * re-rolled at midnight, with morning fog that may lift at FOG_LIFT_HOUR.
 */
import type { WeatherKind, WeatherState } from '@murim/shared';
import { FOG_LIFT_CHANCE, FOG_LIFT_HOUR } from './constants';
import { chron } from './chronicle';
import { dayOf, seasonOf } from './clock';
import type { Ctx } from './types';
import { emit } from './util';

export const WEATHER_KINDS: WeatherKind[] = ['clear', 'cloudy', 'rain', 'storm', 'fog', 'snow'];

/** Base transition weights: from -> to. */
const BASE: Record<WeatherKind, Record<WeatherKind, number>> = {
  clear: { clear: 50, cloudy: 30, rain: 9, storm: 2, fog: 8, snow: 3 },
  cloudy: { clear: 28, cloudy: 32, rain: 25, storm: 5, fog: 6, snow: 5 },
  rain: { clear: 16, cloudy: 34, rain: 30, storm: 10, fog: 8, snow: 2 },
  storm: { clear: 22, cloudy: 34, rain: 30, storm: 9, fog: 5, snow: 1 },
  fog: { clear: 34, cloudy: 34, rain: 12, storm: 2, fog: 16, snow: 2 },
  snow: { clear: 20, cloudy: 30, rain: 3, storm: 1, fog: 8, snow: 40 },
};

/** Season x kind multipliers (Spring, Summer, Autumn, Winter). Snow only falls in winter. */
const SEASON_MULT: Record<WeatherKind, [number, number, number, number]> = {
  clear: [1, 1.3, 1, 0.9],
  cloudy: [1, 0.9, 1.1, 1.2],
  rain: [1.3, 1.05, 1.1, 0.6],
  storm: [0.5, 2.6, 1.6, 0.2],
  fog: [2, 0.4, 1.9, 1],
  snow: [0, 0, 0, 1],
};

/** Band x kind multipliers. Snow mainly in the north; the south gets monsoon rain. */
const BAND_MULT: Record<WeatherKind, [number, number, number]> = {
  clear: [0.9, 1, 1.05],
  cloudy: [1.15, 1, 0.9],
  rain: [0.75, 1, 1.35],
  storm: [0.7, 1, 1.3],
  fog: [1, 1, 1.2],
  snow: [3.2, 1.1, 0.12],
};

export function initWeather(ctx: Ctx): WeatherState[] {
  const out: WeatherState[] = [];
  for (let zone = 0; zone < 3; zone++) out.push({ zone, kind: rollNext(ctx, 'clear', zone, 0), sinceHour: 0 });
  return out;
}

function rollNext(ctx: Ctx, from: WeatherKind, zone: number, season: number): WeatherKind {
  const base = BASE[from];
  const items = WEATHER_KINDS.map((k) => [k, base[k] * SEASON_MULT[k][season] * BAND_MULT[k][zone]] as const).filter(([, w]) => w > 0);
  return ctx.rng.weighted(items);
}

function setWeather(ctx: Ctx, zone: number, kind: WeatherKind): void {
  const w = ctx.st.weather[zone];
  if (w.kind === kind) return;
  w.kind = kind;
  w.sinceHour = ctx.st.clock.totalHours;
  emit(ctx, { k: 'weather', zone, kind });
}

const ZONE_NAME = ['the north', 'the central plains', 'the south'];

/** Midnight: roll tomorrow's weather for every band. */
export function weatherDaily(ctx: Ctx): void {
  const day = dayOf(ctx.st.clock.totalHours);
  const season = seasonOf(day);
  for (let zone = 0; zone < 3; zone++) {
    const prev = ctx.st.weather[zone].kind;
    const next = rollNext(ctx, prev, zone, season);
    setWeather(ctx, zone, next);
    if (next === 'storm' && prev !== 'storm') {
      chron(ctx, 'weather', `A violent storm lashes ${ZONE_NAME[zone]}.`, 1, { key: `storm:${zone}`, cooldown: 24 * 5 });
    } else if (next === 'snow' && prev !== 'snow' && zone !== 0) {
      chron(ctx, 'weather', `Snow falls on ${ZONE_NAME[zone]}.`, 1, { key: `snow:${zone}`, cooldown: 24 * 12 });
    }
  }
}

/** Hourly: morning fog lifts. */
export function weatherHourly(ctx: Ctx, hourOfDay: number): void {
  if (hourOfDay !== FOG_LIFT_HOUR) return;
  for (let zone = 0; zone < 3; zone++) {
    if (ctx.st.weather[zone].kind !== 'fog') continue;
    if (ctx.rng.chance(FOG_LIFT_CHANCE)) setWeather(ctx, zone, ctx.rng.chance(0.5) ? 'cloudy' : 'clear');
  }
}

export function bandOfY(ctx: Ctx, y: number): number {
  const yy = Math.max(0, Math.min(ctx.S.h - 1, Math.floor(y)));
  return ctx.S.rowBand[yy];
}

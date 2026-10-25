/**
 * World calendar. `totalHours` counts whole world hours since the world began.
 * totalHours = 0 is 06:00 (dawn) of day 0; a day runs midnight to midnight, so day 0 is 18 h long.
 * 24 h/day, 30 days/season (Spring, Summer, Autumn, Winter), 120 days/year.
 */
import { DAYS_PER_SEASON, DAYS_PER_YEAR, HOURS_PER_DAY, START_HOUR } from './constants';

export function hourOfDay(totalHours: number): number {
  return (totalHours + START_HOUR) % HOURS_PER_DAY;
}

export function dayOf(totalHours: number): number {
  return Math.floor((totalHours + START_HOUR) / HOURS_PER_DAY);
}

export function seasonOf(day: number): number {
  return Math.floor(day / DAYS_PER_SEASON) % 4;
}

export function yearOf(day: number): number {
  return Math.floor(day / DAYS_PER_YEAR);
}

/** First totalHours value of a given day (day 0 starts at hour 0 = 06:00). */
export function dayStartHour(day: number): number {
  return Math.max(0, day * HOURS_PER_DAY - START_HOUR);
}

export const SEASON_NAMES = ['Spring', 'Summer', 'Autumn', 'Winter'] as const;

export function clockOf(totalHours: number): { totalHours: number; hour: number; day: number; season: number; year: number } {
  const day = dayOf(totalHours);
  return { totalHours, hour: hourOfDay(totalHours), day, season: seasonOf(day), year: yearOf(day) };
}

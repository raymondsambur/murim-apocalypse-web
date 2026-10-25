/** Client-side extrapolation of the world clock between server TimeView updates. Pure (unit tested). */
import type { TimeView, WeatherKind } from '@murim/shared';

export class WorldClock {
  hours0 = 11;
  recvAt = 0;
  hourMs = 60000;
  day = 0;
  year = 0;
  season = 1;
  weather: WeatherKind[] = ['clear', 'clear', 'clear'];
  /** Previous weather per band, for cross-fades. */
  prevWeather: WeatherKind[] = ['clear', 'clear', 'clear'];
  weatherChangedAt = -1e9;

  set(tv: TimeView, now: number): void {
    this.hours0 = tv.hours;
    this.recvAt = now;
    this.hourMs = tv.hourMs > 0 ? tv.hourMs : 60000;
    this.day = tv.day;
    this.year = tv.year;
    this.season = ((tv.season % 4) + 4) % 4;
    const w = tv.weather ?? [];
    for (let i = 0; i < 3; i++) {
      const next = w[i] ?? this.weather[i];
      if (next !== this.weather[i]) {
        this.prevWeather[i] = this.weather[i];
        this.weather[i] = next;
        this.weatherChangedAt = now;
      }
    }
  }

  /** Current time of day (0..24) extrapolated to `now` (performance.now() ms). */
  hours(now: number): number {
    const h = this.hours0 + (now - this.recvAt) / this.hourMs;
    return ((h % 24) + 24) % 24;
  }

  /** 0..1 fade-in of the current weather since the last change (about 6 seconds). */
  weatherBlend(now: number): number {
    const t = (now - this.weatherChangedAt) / 6000;
    return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
  }
}

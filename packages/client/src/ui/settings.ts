/** Player-local UI settings persisted in localStorage. */
import { loadJson, saveJson } from './dom';

export interface Settings {
  /** Multiplies the root font size (all UI is sized in rem). */
  uiScale: number;
  /** Chat font size in px (before UI scale). */
  chatFont: number;
  /** null = follow the OS preference. */
  reduceMotion: boolean | null;
  showFps: boolean;
  chatCollapsed: boolean;
  minimapCollapsed: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  uiScale: 1,
  chatFont: 14,
  reduceMotion: null,
  showFps: false,
  chatCollapsed: false,
  minimapCollapsed: false,
};

const KEY = 'murim.settings.v1';

export class SettingsStore {
  private v: Settings;
  private listeners = new Set<(s: Settings) => void>();

  constructor() {
    this.v = sanitize(loadJson<Settings>(KEY, DEFAULT_SETTINGS));
  }

  get(): Readonly<Settings> {
    return this.v;
  }

  set(patch: Partial<Settings>): void {
    this.v = sanitize({ ...this.v, ...patch });
    saveJson(KEY, this.v);
    this.apply();
    for (const fn of this.listeners) fn(this.v);
  }

  subscribe(fn: (s: Settings) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Push settings into CSS variables / root classes. */
  apply(): void {
    const root = document.documentElement;
    root.style.setProperty('--ui-scale', String(this.v.uiScale));
    root.style.setProperty('--chat-font', `${this.v.chatFont}px`);
    const osReduce = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.classList.toggle('reduce-motion', this.v.reduceMotion ?? osReduce);
  }
}

function sanitize(s: Settings): Settings {
  const num = (v: unknown, lo: number, hi: number, d: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d;
  };
  return {
    uiScale: num(s.uiScale, 0.75, 1.5, 1),
    chatFont: num(s.chatFont, 11, 20, 14),
    reduceMotion: s.reduceMotion === true || s.reduceMotion === false ? s.reduceMotion : null,
    showFps: !!s.showFps,
    chatCollapsed: !!s.chatCollapsed,
    minimapCollapsed: !!s.minimapCollapsed,
  };
}

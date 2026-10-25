/**
 * Tiny i18n layer. Every UI string goes through `t('key', params)`.
 * Dictionaries are flat `{ key: 'Text with {param}' }` maps. English is the fallback.
 * Panel modules may register their own strings with `addStrings()` so a panel stays a single file.
 */
import { en } from './en';
import { enApp } from './en.app';

export type Params = Record<string, string | number>;
type Dict = Record<string, string>;

const dicts: Record<string, Dict> = { en: { ...en, ...enApp } };
let locale = 'en';
const warned = new Set<string>();

export function t(key: string, params?: Params): string {
  const s = dicts[locale]?.[key] ?? dicts.en[key];
  if (s === undefined) {
    if (!warned.has(key)) {
      warned.add(key);
      if (typeof console !== 'undefined') console.warn(`[i18n] missing key: ${key}`);
    }
    return key;
  }
  return params ? interpolate(s, params) : s;
}

/** Pick `key.one` or `key.other` by count; `{n}` is available in the string. */
export function tn(key: string, n: number, params?: Params): string {
  return t(`${key}.${n === 1 ? 'one' : 'other'}`, { n, ...params });
}

/** True when the key exists in the active (or fallback) dictionary. */
export function hasKey(key: string): boolean {
  return dicts[locale]?.[key] !== undefined || dicts.en[key] !== undefined;
}

export function interpolate(s: string, params: Params): string {
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (params[k] !== undefined ? String(params[k]) : m));
}

/** Add or override strings for a locale (default English). */
export function addStrings(dict: Dict, loc = 'en'): void {
  dicts[loc] = { ...(dicts[loc] ?? {}), ...dict };
}

export function setLocale(loc: string): void {
  locale = dicts[loc] ? loc : 'en';
  if (typeof document !== 'undefined') document.documentElement.lang = locale;
}

export function getLocale(): string {
  return locale;
}

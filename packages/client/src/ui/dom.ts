/** Minimal DOM builder. `h('button', { class: 'btn', onclick }, 'Label')`. */

export type Child = Node | string | number | null | undefined | false | Child[];

export interface Attrs {
  class?: string | (string | false | null | undefined)[];
  style?: string | Record<string, string | number | null | undefined>;
  dataset?: Record<string, string | number>;
  [key: string]: unknown;
}

/** Keys assigned as DOM properties rather than attributes. */
const PROPS = new Set(['value', 'checked', 'selected', 'indeterminate', 'textContent', 'htmlFor', 'innerHTML']);

function kebab(s: string): string {
  return s.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase());
}

export function applyAttrs(el: HTMLElement | SVGElement, attrs: Attrs): void {
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') {
      const cls = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
      if (cls) el.setAttribute('class', cls);
    } else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else
        for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
          if (sv === null || sv === undefined) continue;
          el.style.setProperty(sk.startsWith('--') ? sk : kebab(sk), String(sv));
        }
    } else if (k === 'dataset') {
      for (const [dk, dv] of Object.entries(v as Record<string, unknown>)) (el as HTMLElement).dataset[dk] = String(dv);
    } else if (k.startsWith('on') && typeof v === 'function') {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (PROPS.has(k)) {
      (el as unknown as Record<string, unknown>)[k] = v;
    } else if (v === true) {
      el.setAttribute(k, '');
    } else {
      el.setAttribute(k, String(v));
    }
  }
}

export function append(el: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs?: Attrs | null, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) applyAttrs(el, attrs);
  append(el, children);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Replace all children. */
export function mount(el: Element, ...children: Child[]): void {
  clear(el);
  append(el, children);
}

/** Decorative CJK glyph icon (hidden from screen readers). */
export function glyph(ch: string, cls = '', color?: string): HTMLSpanElement {
  return h('span', { class: ['glyph', cls], 'aria-hidden': 'true', style: color ? { color } : undefined }, ch);
}

/** Cinnabar seal-stamp glyph. */
export function seal(ch: string, cls = ''): HTMLSpanElement {
  return h('span', { class: ['seal', cls], 'aria-hidden': 'true' }, ch);
}

export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

/** True when the viewport is in the narrow (mobile) layout. Keep in sync with styles.css. */
export const NARROW_QUERY = '(max-width: 760px)';
export function isNarrow(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia(NARROW_QUERY).matches;
}

export function prefersReducedMotion(): boolean {
  if (typeof document !== 'undefined' && document.documentElement.classList.contains('reduce-motion')) return true;
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** localStorage wrappers that never throw (private mode, blocked storage). */
export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return { ...fallback, ...(JSON.parse(raw) as T) };
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

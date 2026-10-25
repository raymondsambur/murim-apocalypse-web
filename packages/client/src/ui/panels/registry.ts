/**
 * Panel registry. A panel is one file in ui/panels/ that calls `registerPanel({...})`,
 * plus one import line in ui/panels/index.ts.
 */
import type { StoreKey } from '../../state/store';
import type { UiContext } from '../context';

export interface PanelDef {
  id: string;
  /** i18n key (or literal text) for the window title. */
  title: string;
  /** Icon name (see ui/icons.ts) shown in the title seal and on the action bar. */
  glyph: string;
  /** Single-letter hotkey (case-insensitive), e.g. 'c'. */
  hotkey?: string;
  /** Position on the action bar (lower first). */
  order?: number;
  /** Preferred desktop width in px at UI scale 1. Default 420. */
  width?: number;
  /** Store keys whose changes re-render this panel while open. Default ['me']. */
  watch?: StoreKey[];
  /** Show on the action bar (default true). */
  bar?: boolean;
  /** Marks unfinished panels in the UI. */
  placeholder?: boolean;
  /** Build the panel body into `root` (already empty). Called on open and on every watched store change. */
  render(root: HTMLElement, ui: UiContext): void;
  /**
   * Optional targeted update. Return true when handled, which skips the full re-render.
   * Use it for panels with live inputs or expensive bodies.
   */
  update?(root: HTMLElement, ui: UiContext, changed: Set<StoreKey>): boolean | void;
  onOpen?(ui: UiContext): void;
  onClose?(ui: UiContext): void;
}

const panels = new Map<string, PanelDef>();

export function registerPanel(def: PanelDef): PanelDef {
  if (panels.has(def.id)) console.warn(`[panels] '${def.id}' registered twice; the later one wins`);
  panels.set(def.id, def);
  return def;
}

export function getPanel(id: string): PanelDef | undefined {
  return panels.get(id);
}

export function listPanels(): PanelDef[] {
  return [...panels.values()].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
}

export function panelForHotkey(key: string): PanelDef | undefined {
  const k = key.toLowerCase();
  return [...panels.values()].find((p) => p.hotkey?.toLowerCase() === k);
}

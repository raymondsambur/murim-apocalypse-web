/** Global keyboard shortcuts: panel hotkeys and the Esc chain. */
import type { UiContext } from '../context';
import { isTypingTarget } from '../dom';
import { panelForHotkey } from '../panels/registry';
import { closeTopModal, hasOpenModal } from '../widgets/modal';

export interface KeyOptions {
  /** Close the NPC dialog if open; returns true when something closed. */
  closeNpc(): boolean;
  /** Close transient sheets (action menu, mobile chat); returns true when something closed. */
  closeSheets(): boolean;
}

export function mountHotkeys(ui: UiContext, o: KeyOptions): { destroy(): void } {
  const onKey = (ev: KeyboardEvent) => {
    if (ev.defaultPrevented) return;
    if (ev.key === 'Escape') {
      if (hasOpenModal() && closeTopModal()) return ev.preventDefault();
      if (isTypingTarget(ev.target)) return;
      // Most specific first: dialog, floating sheets, panels, then the selection.
      if (o.closeNpc() || o.closeSheets() || ui.panels.closeTop()) return ev.preventDefault();
      if (ui.state.get('selected') !== null) {
        ui.select(null);
        ev.preventDefault();
      }
      return;
    }
    if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.repeat) return;
    if (isTypingTarget(ev.target) || hasOpenModal()) return;
    const p = panelForHotkey(ev.key);
    if (p) {
      ev.preventDefault();
      ui.panels.toggle(p.id);
    }
  };
  document.addEventListener('keydown', onKey);
  return { destroy: () => document.removeEventListener('keydown', onKey) };
}

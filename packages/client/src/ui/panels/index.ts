/**
 * Panel registry entry point. Adding a panel = one file `ui/panels/<name>.ts` that calls `registerPanel({...})`
 * plus one import line below. The action bar and hotkeys pick it up automatically.
 */
import './character';
import './inventory';
import './skills';
import './missions';
import './jobs';
import './world';
import './social';
import './settings';

export { registerPanel, getPanel, listPanels, panelForHotkey, type PanelDef } from './registry';
export { PanelManager } from './manager';

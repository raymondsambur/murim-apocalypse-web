/**
 * `UiContext` (`ui`) is what every panel and HUD component receives. It is the public API for panel authors:
 *   ui.state      central Store (get/subscribe/reducers)
 *   ui.net        send(C2S) / query(name, args)
 *   ui.gameView   the world renderer (centerOn, setSelected, fx...)
 *   ui.render     RenderModule (drawLookPreview, lookSwatches)
 *   ui.panels     PanelManager (open/close/toggle)
 *   ui.toast      feedback toasts
 *   ui.tooltips   rich tooltip builders (item / skill / talent)
 */
import type { C2S, NoteLevel, Queries, QueryName } from '@murim/shared';
import type { GameViewApi, RenderModule } from '../render/api';
import type { Store } from '../state/store';
import type { t } from '../i18n';
import type { PanelManager } from './panels/manager';
import type { SettingsStore } from './settings';
import type { ConfirmOptions } from './widgets/modal';
import type { itemTooltip, skillTooltip, talentTooltip } from './widgets/tooltip';

export interface NetApi {
  /** Send an intent. Returns false (and toasts) when not connected. */
  send(msg: C2S): boolean;
  /** Request/response lookup; rejects with QueryError on timeout/disconnect/server error. */
  query<N extends QueryName>(name: N, args: Queries[N]['args']): Promise<Queries[N]['res']>;
  readonly connected: boolean;
  /** Last measured round-trip, ms. */
  readonly latency: number | null;
}

export interface UiContext {
  state: Store;
  net: NetApi;
  gameView: GameViewApi;
  render: RenderModule;
  panels: PanelManager;
  settings: SettingsStore;
  t: typeof t;
  toast(text: string, level?: NoteLevel): void;
  confirm(o: ConfirmOptions): Promise<boolean>;
  tooltips: { item: typeof itemTooltip; skill: typeof skillTooltip; talent: typeof talentTooltip };
  /** Open the chat input, optionally pre-filled (e.g. "/w Name "). */
  chat(prefill?: string): void;
  /** Show another player's public profile. */
  inspectPlayer(target: { id?: number; name?: string }): void;
  /** Select an entity in the world (context card + highlight). */
  select(entityId: number | null): void;
  /** Walk to an entity and interact with it (talk to an NPC, fight a monster, gather a node). */
  interact(entityId: number): void;
  /** Close the NPC dialog. */
  closeNpc(): void;
  logout(): void;
}

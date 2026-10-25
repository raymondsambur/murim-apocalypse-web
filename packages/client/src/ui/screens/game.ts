/**
 * Game screen: full-viewport world canvas under the HUD (player card, clock + minimap, chat dock, action bar,
 * context card, combat HUD, NPC dialog, overlays) and the floating panel windows. Owns the live GameSession.
 */
import { t } from '../../i18n';
import { api } from '../../net/api';
import type { GameSocket } from '../../net/socket';
import type { DecodedWorld, RenderModule } from '../../render/api';
import { GameSession } from '../../state/session';
import type { Store } from '../../state/store';
import type { UiContext } from '../context';
import { h } from '../dom';
import { mountActionBar } from '../hud/actionBar';
import { mountChatDock } from '../hud/chatDock';
import { mountClock } from '../hud/clock';
import { mountCombatHud } from '../hud/combatHud';
import { mountContextCard } from '../hud/contextCard';
import { mountFps } from '../hud/fps';
import { inspectPlayer } from '../hud/inspect';
import { mountInteraction } from '../hud/interaction';
import { mountInvites } from '../hud/invites';
import { mountHotkeys } from '../hud/keys';
import { mountMinimap } from '../hud/minimap';
import { mountNpcDialog } from '../hud/npcDialog';
import { mountOverlays } from '../hud/overlays';
import { mountPlayerCard } from '../hud/playerCard';
import '../panels';
import { PanelManager } from '../panels/manager';
import type { SettingsStore } from '../settings';
import { confirmModal } from '../widgets/modal';
import { toast } from '../widgets/toast';
import { itemTooltip, skillTooltip, talentTooltip } from '../widgets/tooltip';
import type { Screen } from './screen';

export interface GameScreenOptions {
  store: Store;
  settings: SettingsStore;
  render: RenderModule;
  world: DecodedWorld;
  socket: GameSocket;
  /** The stand-in renderer is in use (the real one is not built yet). */
  standin: boolean;
  onLogout(): void;
  onReauth(notice?: string): void;
}

export interface GameScreen extends Screen {
  ui: UiContext;
  /** Call once the element is in the document: sizes the canvas, loads the world and opens the socket. */
  start(): void;
}

export function createGameScreen(o: GameScreenOptions): GameScreen {
  const { store, settings, render, world, socket } = o;

  // ---- DOM skeleton ---------------------------------------------------------------------------
  const canvas = h('canvas', { class: 'game-canvas', tabindex: '-1', 'aria-label': t('game.canvas') });
  const hudTL = h('div', { class: 'hud-tl' });
  const hudTR = h('div', { class: 'hud-tr' });
  const hudTop = h('div', { class: 'hud-top' });
  const hudBL = h('div', { class: 'hud-bl' });
  const hudBR = h('div', { class: 'hud-br' });
  const hudLayers = h('div', { class: 'hud-layers' });
  const hud = h('div', { class: 'hud' }, hudTL, hudTR, hudTop, hudBL, hudBR, hudLayers);
  const panelsHost = h('div', { class: 'panels-host' });
  const root = h('div', { class: 'game' }, canvas, hud, panelsHost);

  // ---- renderer -----------------------------------------------------------------------------------
  const gameView = render.createGameView(canvas);
  const fit = () => gameView.resize();
  const ro = new ResizeObserver(fit);
  ro.observe(root);
  window.addEventListener('orientationchange', fit);
  // Safari fires gesture events for pinch; the canvas handles zoom itself.
  const noGesture = (e: Event) => e.preventDefault();
  canvas.addEventListener('gesturestart', noGesture);
  canvas.addEventListener('gesturechange', noGesture);
  store.set('world', world);

  // ---- session + context -------------------------------------------------------------------------------
  const session = new GameSession({
    store,
    socket,
    view: gameView,
    hooks: {
      note: (level, text) => toast(text, level),
      error: (code, text) => {
        if (code === 'not_implemented') toast(t('err.notImplemented'), 'warn');
        else toast(text, 'bad');
      },
    },
    onNotConnected: () => toast(t('err.notConnected'), 'warn'),
  });

  const panels = new PanelManager(panelsHost);
  let interaction!: ReturnType<typeof mountInteraction>;
  let chat!: ReturnType<typeof mountChatDock>;

  const ui: UiContext = {
    state: store,
    net: session.net,
    gameView,
    render,
    panels,
    settings,
    t,
    toast: (text, level = 'info') => toast(text, level),
    confirm: confirmModal,
    tooltips: { item: itemTooltip, skill: skillTooltip, talent: talentTooltip },
    chat: (prefill) => chat.focus(prefill),
    inspectPlayer: (target) => void inspectPlayer(ui, target),
    select: (id) => interaction.select(id),
    interact: (id) => void session.net.send({ t: 'interact', id }),
    closeNpc: () => {
      if (store.get('npc')) store.set('npc', null);
    },
    logout: o.onLogout,
  };
  panels.attach(ui);

  // ---- HUD ---------------------------------------------------------------------------------------------------
  interaction = mountInteraction(ui, canvas);
  const parts = [
    mountPlayerCard(hudTL, ui),
    mountInvites(hudTL, ui),
    mountClock(hudTR, ui),
    mountMinimap(hudTR, ui),
    mountCombatHud(hudTop, ui),
    mountFps(hudTop, ui),
    mountContextCard(hudBR, ui),
  ];
  chat = mountChatDock(hudBL, ui);
  const bar = mountActionBar(hudBR, ui);
  const npc = mountNpcDialog(hudLayers, ui);
  const overlays = mountOverlays(hudLayers, ui, { socket, onReauth: o.onReauth });
  const keys = mountHotkeys(ui, {
    closeNpc: () => {
      if (!npc.isOpen()) return false;
      ui.closeNpc();
      return true;
    },
    closeSheets: () => {
      const a = bar.closeSheet();
      if (!chat.isCollapsed() && matchMedia('(max-width: 760px)').matches) {
        chat.collapse();
        return true;
      }
      return a;
    },
  });

  // A rejected WebSocket upgrade looks like a plain network failure (the server answers 401 before upgrading).
  // While reconnecting, ask the HTTP API whether the session is still valid and fall back to sign-in if it is not.
  let lastChecked = -1;
  const unsubConn = store.subscribe('conn', () => {
    const c = store.get('conn');
    if (c.state !== 'reconnecting' || c.attempt < 2 || c.attempt === lastChecked || (c.attempt & (c.attempt - 1)) !== 0) return;
    lastChecked = c.attempt;
    void api
      .me()
      .then((me) => {
        if (!me) o.onReauth(t('err.sessionExpired'));
      })
      .catch(() => undefined);
  });

  // Anything that outlives the renderer's own state (selection) is cleared when a new conversation begins.
  const unsubNpc = store.subscribe('npc', () => {
    if (store.get('npc')) bar.closeSheet();
  });

  return {
    el: root,
    ui,
    start() {
      document.body.classList.add('has-hud');
      gameView.resize();
      gameView.loadWorld(world);
      gameView.start();
      session.start();
    },
    destroy() {
      document.body.classList.remove('has-hud');
      unsubNpc();
      unsubConn();
      keys.destroy();
      overlays.destroy();
      npc.destroy();
      bar.destroy();
      chat.destroy();
      for (const p of parts) p.destroy();
      interaction.destroy();
      panels.destroy();
      session.stop();
      gameView.stop();
      ro.disconnect();
      window.removeEventListener('orientationchange', fit);
      root.remove();
    },
  };
}

/**
 * App: the top-level flow auth -> character creation -> game. It owns the Store and the settings, loads the renderer,
 * and swaps full-screen screens. Everything the player sees in between (boot, errors) is a tiny screen too.
 */
import type { MeResponse } from '@murim/shared';
import { ApiFailure, api } from '../net/api';
import { decodeWorld } from '../net/base64';
import { GameSocket, type SocketFactory } from '../net/socket';
import type { RenderModule } from '../render/api';
import { Store } from '../state/store';
import { t } from '../i18n';
import { h } from './dom';
import { loadRenderModule } from './renderLoader';
import { createAuthScreen } from './screens/auth';
import { createCreateScreen } from './screens/create';
import { createGameScreen, type GameScreen } from './screens/game';
import { mountInkBackdrop } from './screens/inkBackdrop';
import type { Screen } from './screens/screen';
import { SettingsStore } from './settings';
import { toast } from './widgets/toast';
import { icon } from './icons';

export interface AppOptions {
  root: HTMLElement;
  /** Replaces the browser WebSocket (the dev MockServer plugs in here). */
  socketFactory?: SocketFactory;
  /** Extra info for the console / debugging (set when running against the mock). */
  debug?: boolean;
}

export class App {
  readonly settings = new SettingsStore();
  readonly store = new Store();
  private screen: Screen | null = null;
  private game: GameScreen | null = null;
  private render: RenderModule | null = null;
  private standin = false;
  private routing = 0;

  constructor(private o: AppOptions) {}

  async start(): Promise<void> {
    this.settings.apply();
    document.title = t('app.title');
    try {
      const r = await loadRenderModule();
      this.render = r.module;
      this.standin = r.standin;
    } catch (e) {
      this.fatal(e, () => void this.start());
      return;
    }
    await this.route();
  }

  // ---- screens -----------------------------------------------------------------------------------
  private show(next: Screen): void {
    const prev = this.screen;
    this.screen = next;
    this.o.root.replaceChildren(next.el);
    prev?.destroy();
  }

  private boot(text: string): Screen {
    const root = h('main', { class: 'screen screen-boot' });
    const bd = mountInkBackdrop(root);
    root.append(h('span', { class: 'seal seal-lg seal-pulse', 'aria-hidden': 'true' }, icon('logo')), h('div', { class: 'boot-status', role: 'status' }, h('span', { class: 'spinner', 'aria-hidden': 'true' }), text));
    return {
      el: root,
      destroy() {
        bd.destroy();
        root.remove();
      },
    };
  }

  private fatal(e: unknown, retry: () => void): void {
    console.error('[app]', e);
    const root = h('main', { class: 'screen screen-boot' });
    const bd = mountInkBackdrop(root);
    const msg = e instanceof ApiFailure ? e.message : t('err.network');
    root.append(
      h('span', { class: 'seal seal-lg', 'aria-hidden': 'true' }, icon('brokenRoad')),
      h('div', { class: 'boot-error' }, h('h1', { class: 'overlay-title' }, t('boot.errorTitle')), h('p', { class: 'overlay-text', role: 'alert' }, msg), h('button', { class: 'btn btn-primary', type: 'button', onclick: retry }, t('common.retry'))),
    );
    this.show({
      el: root,
      destroy() {
        bd.destroy();
        root.remove();
      },
    });
  }

  // ---- flow -----------------------------------------------------------------------------------------
  async route(notice?: string): Promise<void> {
    const token = ++this.routing;
    this.show(this.boot(t('boot.loading')));
    let me: MeResponse | null;
    try {
      me = await api.me();
    } catch (e) {
      if (token === this.routing) this.fatal(e, () => void this.route(notice));
      return;
    }
    if (token !== this.routing) return;
    if (!me) this.showAuth(notice);
    else this.afterAuth(me);
  }

  private showAuth(notice?: string): void {
    this.show(createAuthScreen({ notice, onAuthed: (me) => this.afterAuth(me) }));
  }

  private afterAuth(me: MeResponse): void {
    if (me.character) void this.enterGame();
    else this.showCreate(me);
  }

  private showCreate(me: MeResponse): void {
    this.show(
      createCreateScreen({
        me,
        render: this.render!,
        onCreated: () => void this.enterGame(),
        onLogout: () => void this.logout(),
      }),
    );
  }

  private async enterGame(): Promise<void> {
    const token = ++this.routing;
    this.show(this.boot(t('boot.world')));
    try {
      const payload = await api.world();
      const world = decodeWorld(payload);
      if (token !== this.routing) return;
      const socket = new GameSocket({ factory: this.o.socketFactory });
      const screen = createGameScreen({
        store: this.store,
        settings: this.settings,
        render: this.render!,
        world,
        socket,
        standin: this.standin,
        onLogout: () => void this.logout(),
        onReauth: (notice) => void this.reauth(notice),
      });
      this.game = screen;
      this.show(screen);
      screen.start();
      if (this.o.debug) (window as unknown as { __murim?: unknown }).__murim = { store: this.store, ui: screen.ui, socket };
      if (this.standin) toast(t('boot.standin'), 'warn', { ttl: 6000 });
    } catch (e) {
      if (token === this.routing) this.fatal(e, () => void this.enterGame());
    }
  }

  async logout(): Promise<void> {
    this.routing++;
    // Showing the boot screen first destroys the game screen, which closes the socket cleanly.
    this.show(this.boot(t('boot.logout')));
    this.game = null;
    await api.logout();
    this.store.reset();
    this.showAuth();
  }

  /** The session is no longer valid (expired / banned): back to the title screen with a message. */
  private async reauth(notice?: string): Promise<void> {
    this.routing++;
    this.show(this.boot(t('boot.logout')));
    this.game = null;
    this.store.reset();
    await this.route(notice);
  }
}

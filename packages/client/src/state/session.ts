/**
 * GameSession: owns the live connection to the game server. It feeds every `S2C` message into the Store
 * (and the renderer), mirrors connection state into the Store, and exposes the `NetApi` used by the UI.
 */
import type { C2S, Queries, QueryName } from '@murim/shared';
import type { GameSocket } from '../net/socket';
import { QueryError } from '../net/socket';
import type { NetApi } from '../ui/context';
import { dispatchServerMessage, type DispatchHooks, type ViewSink } from './dispatch';
import type { Store } from './store';

export interface SessionOptions {
  store: Store;
  socket: GameSocket;
  view: ViewSink;
  hooks?: DispatchHooks;
  /** Called when the UI tries to send while disconnected. */
  onNotConnected?: () => void;
}

export class GameSession {
  readonly net: NetApi;
  private unsubs: (() => void)[] = [];
  private started = false;

  constructor(private o: SessionOptions) {
    const { socket } = o;
    const self = this;
    this.net = {
      send(msg: C2S): boolean {
        const ok = socket.send(msg);
        if (!ok) self.o.onNotConnected?.();
        return ok;
      },
      query<N extends QueryName>(name: N, args: Queries[N]['args']): Promise<Queries[N]['res']> {
        return socket.query(name, args);
      },
      get connected() {
        return socket.isOpen;
      },
      get latency() {
        return socket.latency;
      },
    };
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const { store, socket, view, hooks } = this.o;
    this.unsubs.push(
      socket.onAny((msg) => {
        if (msg.t === 'pong') {
          store.set('latency', socket.latency);
          store.set('serverOffset', socket.serverOffset);
        }
        dispatchServerMessage(store, view, msg, hooks);
      }),
      socket.onState((info) => store.set('conn', info)),
    );
    socket.connect();
  }

  stop(): void {
    for (const u of this.unsubs) u();
    this.unsubs = [];
    this.started = false;
    this.o.socket.close('logout');
  }
}

export { QueryError };

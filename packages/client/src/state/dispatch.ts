/**
 * Routes every S2C message into the Store and forwards render-relevant ones to the GameView.
 * UI side effects (toasts, banners) go through hooks so this stays testable without a DOM.
 */
import type { NoteLevel, S2C } from '@murim/shared';
import { decodeBase64 } from '../net/base64';
import type { GameViewApi } from '../render/api';
import type { CombatResult, Invite, Store } from './store';

export type ViewSink = Pick<
  GameViewApi,
  'clearEntities' | 'setSelf' | 'setTime' | 'setSettlements' | 'setBlight' | 'patchBlight' | 'applyEntities' | 'combatEvents' | 'fx' | 'say' | 'setBattle'
>;

export interface DispatchHooks {
  note?(level: NoteLevel, text: string): void;
  error?(code: string, text: string): void;
  combatEnded?(res: CombatResult): void;
  invite?(inv: Invite): void;
  kicked?(reason: string): void;
  hello?(): void;
}

export function dispatchServerMessage(store: Store, view: ViewSink | null, msg: S2C, hooks: DispatchHooks = {}): void {
  switch (msg.t) {
    case 'hello': {
      store.applyHello(msg);
      if (view) {
        view.clearEntities();
        view.setSelf(msg.you.entityId);
        view.setTime(msg.time);
        view.setSettlements(msg.settlements);
        if (msg.blight) {
          try {
            view.setBlight(decodeBase64(msg.blight));
          } catch {
            /* malformed blight map: keep the old one */
          }
        }
      }
      hooks.hello?.();
      return;
    }
    case 'me':
      store.applyMe(msg.me);
      return;
    case 'ents':
      store.applyEnts(msg);
      view?.applyEntities({ add: msg.add, upd: msg.upd, del: msg.del });
      return;
    case 'time':
      store.applyTime(msg.time);
      view?.setTime(msg.time);
      return;
    case 'blight':
      if (!view) return;
      if (msg.full) view.setBlight(decodeBase64(msg.full));
      else if (msg.idx && msg.val) view.patchBlight(msg.idx, msg.val);
      return;
    case 'settle':
      store.applySettlements(msg.list);
      view?.setSettlements([...store.get('settlements').values()]);
      return;
    case 'chron':
      store.addChronicle(msg.entries);
      for (const e of msg.entries) if (e.importance >= 2) store.addChat({ ch: 'system', from: '', text: e.text, t: e.t }, { level: e.importance >= 3 ? 'warn' : 'info' });
      return;
    case 'chat': {
      const me = store.get('me');
      const self = !!me && (msg.msg.fromId === me.entityId || msg.msg.from === me.c.name);
      store.addChat(msg.msg, { self });
      if (msg.msg.ch === 'local' && view) {
        const byId = msg.msg.fromId !== undefined ? store.get('entities').get(msg.msg.fromId) : undefined;
        const ent = byId ?? store.entityByName(msg.msg.from);
        if (ent) view.say(ent.id, msg.msg.text);
      }
      return;
    }
    case 'note':
      store.addNote(msg.level, msg.text);
      store.addChat({ ch: 'system', from: '', text: msg.text, t: store.serverNow() }, { level: msg.level, visible: true });
      hooks.note?.(msg.level, msg.text);
      return;
    case 'combat':
      store.applyCombat(msg.c, msg.ev);
      view?.combatEvents(msg.ev);
      return;
    case 'cend': {
      const res = store.endCombat(msg);
      hooks.combatEnded?.(res);
      return;
    }
    case 'cfx':
      view?.combatEvents(msg.ev);
      return;
    case 'npc':
      store.set('npc', msg.menu);
      return;
    case 'err':
      store.addChat({ ch: 'system', from: '', text: msg.text, t: store.serverNow() }, { level: 'bad', visible: true });
      hooks.error?.(msg.code, msg.text);
      return;
    case 'invite': {
      const inv = store.addInvite({ kind: msg.kind, fromId: msg.fromId, from: msg.from, data: msg.data });
      hooks.invite?.(inv);
      return;
    }
    case 'fx':
      view?.fx(msg.kind, msg.entity, msg.text);
      return;
    case 'siege':
      view?.setBattle?.(msg);
      return;
    case 'mission':
      store.applyMission(msg.update);
      return;
    case 'kick':
      store.set('kicked', msg.reason);
      hooks.kicked?.(msg.reason);
      return;
    case 'pong':
    case 'res':
      return;
  }
}

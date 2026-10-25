/** Mapping from an incoming `invite` to the accept / decline messages. Pure. */
import type { C2S, InviteKind } from '@murim/shared';
import type { Invite } from '../../state/store';

export const INVITE_TTL_MS = 60_000;

export const INVITE_ICON: Record<InviteKind, string> = { friend: 'friend', sect: 'sect', master: 'master', duel: 'swords' };

export interface InviteReplies {
  accept: C2S | null;
  decline: C2S | null;
}

function sectId(inv: Invite): number | null {
  const v = inv.data?.sect ?? inv.data?.sectId ?? inv.data?.id;
  return typeof v === 'number' ? v : null;
}

export function inviteReplies(inv: Invite): InviteReplies {
  switch (inv.kind) {
    case 'friend':
      return { accept: { t: 'friend', op: 'accept', id: inv.fromId }, decline: { t: 'friend', op: 'decline', id: inv.fromId } };
    case 'sect': {
      const sect = sectId(inv);
      return sect === null ? { accept: null, decline: null } : { accept: { t: 'sect', op: 'accept', sect }, decline: { t: 'sect', op: 'decline', sect } };
    }
    case 'master':
      return { accept: { t: 'master', op: 'accept', id: inv.fromId }, decline: { t: 'master', op: 'decline', id: inv.fromId } };
    case 'duel':
      return { accept: { t: 'duel', op: 'accept', id: inv.fromId }, decline: { t: 'duel', op: 'decline', id: inv.fromId } };
  }
}

export function isExpired(inv: Invite, now: number, ttl = INVITE_TTL_MS): boolean {
  return now - inv.at > ttl;
}

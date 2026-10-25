/** What the connection overlay should say, derived from the socket state. Pure. */
import type { ConnInfo } from '../../net/socket';

export type ConnView =
  | { kind: 'none' }
  | { kind: 'loading' }
  | { kind: 'reconnecting'; attempt: number; retryIn?: number }
  | { kind: 'replaced' }
  | { kind: 'auth' }
  | { kind: 'banned' }
  | { kind: 'kicked'; reason: string }
  | { kind: 'failed' };

/**
 * `hasHello` is true once the server greeted us at least once this session (the Store has a `me`).
 * Before that, a healthy connection means "still loading"; after it, a broken one means "reconnecting".
 */
export function connectionView(conn: ConnInfo, hasHello: boolean, kickedReason: string | null): ConnView {
  switch (conn.state) {
    case 'closed':
      switch (conn.reason) {
        case 'replaced':
          return { kind: 'replaced' };
        case 'auth':
          return { kind: 'auth' };
        case 'banned':
          return { kind: 'banned' };
        case 'kicked':
          return { kind: 'kicked', reason: kickedReason ?? '' };
        case 'logout':
          return { kind: 'none' };
        default:
          return { kind: 'failed' };
      }
    case 'reconnecting':
      return { kind: 'reconnecting', attempt: conn.attempt, retryIn: conn.retryIn };
    case 'connecting':
    case 'idle':
    case 'open':
      return hasHello ? { kind: 'none' } : { kind: 'loading' };
  }
}

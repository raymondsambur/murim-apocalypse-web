/** Turn a failed socket query into a sentence for the player. */
import { QueryError } from '../net/socket';
import { t } from '../i18n';

export function queryErrorMessage(e: unknown): string {
  if (e instanceof QueryError) {
    if (e.code === 'timeout') return t('err.queryTimeout');
    if (e.code === 'disconnected') return t('err.notConnected');
    if (e.serverCode === 'not_implemented' || e.message === 'not_implemented') return t('err.notImplemented');
    // The server may send a short readable sentence; bare codes get the generic text.
    if (e.message && /\s/.test(e.message) && e.message.length < 140) return e.message;
    return t('err.queryFailed');
  }
  return t('err.generic');
}

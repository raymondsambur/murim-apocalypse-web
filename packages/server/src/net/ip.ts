/** Client address and origin helpers shared by the HTTP routes and the websocket gateway. */
import type { IncomingHttpHeaders } from 'node:http';
import type { Config } from '../config';

interface HasSocketAndHeaders {
  headers: IncomingHttpHeaders;
  socket: { remoteAddress?: string };
}

function first(h: string | string[] | undefined): string | undefined {
  return Array.isArray(h) ? h[0] : h;
}

/**
 * The address used for rate limiting. Behind a trusted reverse proxy (TRUST_PROXY=1) this is the
 * LAST X-Forwarded-For entry, i.e. the one our own proxy appended, so clients cannot spoof it by
 * sending their own header. Otherwise it is the socket address.
 */
export function clientIp(req: HasSocketAndHeaders, trustProxy: boolean): string {
  if (trustProxy) {
    const xff = first(req.headers['x-forwarded-for']);
    if (xff) {
      const parts = xff.split(',');
      const last = parts[parts.length - 1]?.trim();
      if (last) return last.slice(0, 64);
    }
  }
  return (req.socket.remoteAddress ?? 'unknown').replace(/^::ffff:/, '');
}

/**
 * Cross-origin protection for cookie-authenticated requests and websocket upgrades.
 * - No `Origin` header (curl, bots, same-origin GETs) is allowed.
 * - Origins listed in ALLOWED_ORIGINS are allowed.
 * - In development anything is allowed (the Vite dev proxy forwards a different Origin).
 * - Otherwise the origin's host must equal the Host the request was addressed to.
 */
export function originAllowed(headers: IncomingHttpHeaders, config: Pick<Config, 'isProd' | 'allowedOrigins' | 'trustProxy'>): boolean {
  const origin = first(headers.origin);
  if (!origin) return true;
  if (config.allowedOrigins.includes(origin)) return true;
  if (!config.isProd) return true;
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  const requested = (config.trustProxy ? first(headers['x-forwarded-host']) : undefined) ?? first(headers.host);
  return !!requested && requested.toLowerCase() === host.toLowerCase();
}

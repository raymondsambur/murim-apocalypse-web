/** Typed helpers for the HTTP API (see `protocol.ts`). */
import type { AuthRequest, CreateCharacterRequest, MeResponse, RollPreview, WorldPayload } from '@murim/shared';
import { t } from '../i18n';

export interface HttpResponse {
  status: number;
  body: unknown;
}

/** Swappable so the dev MockServer can answer requests in memory. */
export interface HttpTransport {
  request(method: 'GET' | 'POST', path: string, body?: unknown): Promise<HttpResponse>;
}

export const fetchTransport: HttpTransport = {
  async request(method, path, body) {
    const res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = { error: text.slice(0, 200) };
      }
    }
    return { status: res.status, body: json };
  },
};

let transport: HttpTransport = fetchTransport;

export function setHttpTransport(tr: HttpTransport): void {
  transport = tr;
}

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiFailure';
  }
}

export type ApiContext = 'login' | 'register' | 'roll' | 'create' | 'me' | 'world' | 'logout';

/** Known server error codes -> i18n keys. The server may also send plain sentences, which are shown as-is. */
const CODE_KEYS: Record<string, string> = {
  bad_credentials: 'err.badCredentials',
  invalid_credentials: 'err.badCredentials',
  username_taken: 'err.usernameTaken',
  user_exists: 'err.usernameTaken',
  invalid_username: 'val.username.chars',
  invalid_password: 'val.password.short',
  name_taken: 'err.nameTaken',
  invalid_name: 'val.name.chars',
  no_rerolls: 'err.noRerolls',
  has_character: 'err.hasCharacter',
  no_roll: 'err.noRoll',
  rate_limited: 'err.rateLimited',
  too_many_requests: 'err.rateLimited',
  unauthorized: 'err.sessionExpired',
};

/** Map an HTTP failure to a sentence a player can act on. Pure, so it is unit tested. */
export function friendlyApiError(status: number, code: string, ctx: ApiContext): string {
  const key = CODE_KEYS[code.toLowerCase()];
  if (key) return t(key);
  if (status === 0) return t('err.network');
  if (status === 429) return t('err.rateLimited');
  if (status === 401) return ctx === 'login' ? t('err.badCredentials') : t('err.sessionExpired');
  if (status === 409) return ctx === 'register' ? t('err.usernameTaken') : ctx === 'create' ? t('err.nameTaken') : t('err.conflict');
  if (status >= 500) return t('err.server');
  // Short human-readable messages from the server are worth showing verbatim.
  if (code && code.length <= 160 && /\s/.test(code)) return code;
  return t('err.generic');
}

async function call<T>(method: 'GET' | 'POST', path: string, ctx: ApiContext, body?: unknown): Promise<T> {
  let res: HttpResponse;
  try {
    res = await transport.request(method, path, body);
  } catch {
    throw new ApiFailure(0, 'network', t('err.network'));
  }
  if (res.status >= 200 && res.status < 300) return res.body as T;
  const raw = res.body && typeof res.body === 'object' && 'error' in res.body ? String((res.body as { error: unknown }).error ?? '') : '';
  throw new ApiFailure(res.status, raw, friendlyApiError(res.status, raw, ctx));
}

export const api = {
  /** Current session, or null when logged out (401). */
  async me(): Promise<MeResponse | null> {
    try {
      return await call<MeResponse>('GET', '/api/me', 'me');
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) return null;
      throw e;
    }
  },
  login(req: AuthRequest): Promise<MeResponse> {
    return call<MeResponse>('POST', '/api/login', 'login', req);
  },
  register(req: AuthRequest): Promise<MeResponse> {
    return call<MeResponse>('POST', '/api/register', 'register', req);
  },
  /** Not in protocol.ts yet; the server is expected to clear the session cookie. */
  async logout(): Promise<void> {
    try {
      await call<unknown>('POST', '/api/logout', 'logout', {});
    } catch {
      /* best effort: the socket is closed and the UI resets regardless */
    }
  },
  /** `reroll: false` asks for the pending roll (first roll is free); `true` spends a reroll. */
  roll(reroll: boolean): Promise<RollPreview> {
    return call<RollPreview>('POST', '/api/character/roll', 'roll', { reroll });
  },
  create(req: CreateCharacterRequest): Promise<unknown> {
    return call<unknown>('POST', '/api/character/create', 'create', req);
  },
  world(): Promise<WorldPayload> {
    return call<WorldPayload>('GET', '/api/world', 'world');
  },
};

/** Chat input parsing: `/w name msg`, `/r msg`, `/world msg`, `/sect msg`, `/local msg`, `/help`. Pure. */
import { MAX_CHAT_LENGTH, type ChatChannel } from '@murim/shared';

export type SendChannel = Exclude<ChatChannel, 'system'>;

export type ChatIntent =
  | { kind: 'send'; ch: SendChannel; text: string; to?: string }
  /** Command without a message: switch the input to that channel (and whisper target). */
  | { kind: 'switch'; ch: SendChannel; to?: string }
  | { kind: 'help' }
  | { kind: 'error'; key: string; params?: Record<string, string | number> }
  | { kind: 'empty' };

export interface ChatParseContext {
  /** Channel selected in the input's channel picker. */
  channel: ChatChannel;
  /** Current whisper target when the picker is on Whisper. */
  whisperTo?: string | null;
  /** Last player who whispered us (for /r). */
  lastWhisper?: string | null;
  /** Names that may contain spaces ("Han Gyeom"), matched longest-first after /w. */
  knownNames?: string[];
}

const ALIASES: Record<string, SendChannel | 'reply' | 'help'> = {
  w: 'whisper',
  whisper: 'whisper',
  t: 'whisper',
  tell: 'whisper',
  msg: 'whisper',
  r: 'reply',
  reply: 'reply',
  world: 'world',
  g: 'world',
  global: 'world',
  sect: 'sect',
  s: 'sect',
  local: 'local',
  l: 'local',
  say: 'local',
  help: 'help',
  '?': 'help',
};

export const CHAT_COMMANDS = ['/w <name> <message>', '/r <message>', '/world <message>', '/sect <message>', '/local <message>', '/help'];

/** Split "name rest" for whispers, honouring quotes and multi-word known names. */
export function splitTarget(rest: string, knownNames: string[] = []): { name: string; text: string } | null {
  const s = rest.trim();
  if (!s) return null;
  if (s[0] === '"' || s[0] === "'") {
    const q = s[0];
    const end = s.indexOf(q, 1);
    if (end > 1) return { name: s.slice(1, end).trim(), text: s.slice(end + 1).trim() };
  }
  const lower = s.toLowerCase();
  const sorted = [...knownNames].filter((n) => n.includes(' ')).sort((a, b) => b.length - a.length);
  for (const n of sorted) {
    const ln = n.toLowerCase();
    if (lower === ln) return { name: n, text: '' };
    if (lower.startsWith(ln + ' ')) return { name: n, text: s.slice(n.length).trim() };
  }
  const sp = s.search(/\s/);
  if (sp < 0) return { name: s, text: '' };
  return { name: s.slice(0, sp), text: s.slice(sp + 1).trim() };
}

function checkLength(intent: ChatIntent): ChatIntent {
  if (intent.kind === 'send' && intent.text.length > MAX_CHAT_LENGTH) return { kind: 'error', key: 'chat.err.tooLong', params: { max: MAX_CHAT_LENGTH } };
  return intent;
}

export function parseChatInput(raw: string, ctx: ChatParseContext): ChatIntent {
  const input = raw.trim();
  if (!input) return { kind: 'empty' };

  // "//text" escapes a leading slash.
  if (input.startsWith('//')) return checkLength(plain(input.slice(1), ctx));
  if (!input.startsWith('/')) return checkLength(plain(input, ctx));

  const m = /^\/(\S+)\s*([\s\S]*)$/.exec(input);
  const cmd = (m?.[1] ?? '').toLowerCase();
  const rest = (m?.[2] ?? '').trim();
  const target = ALIASES[cmd];
  if (!target) return { kind: 'error', key: 'chat.err.unknown', params: { cmd: '/' + cmd } };
  if (target === 'help') return { kind: 'help' };
  if (target === 'reply') {
    if (!ctx.lastWhisper) return { kind: 'error', key: 'chat.err.noReply' };
    if (!rest) return { kind: 'switch', ch: 'whisper', to: ctx.lastWhisper };
    return checkLength({ kind: 'send', ch: 'whisper', to: ctx.lastWhisper, text: rest });
  }
  if (target === 'whisper') {
    const split = splitTarget(rest, ctx.knownNames);
    if (!split) return { kind: 'error', key: 'chat.err.noTarget' };
    if (!split.text) return { kind: 'switch', ch: 'whisper', to: split.name };
    return checkLength({ kind: 'send', ch: 'whisper', to: split.name, text: split.text });
  }
  if (!rest) return { kind: 'switch', ch: target };
  return checkLength({ kind: 'send', ch: target, text: rest });
}

function plain(text: string, ctx: ChatParseContext): ChatIntent {
  const ch: ChatChannel = ctx.channel === 'system' ? 'local' : ctx.channel;
  if (ch === 'whisper') {
    if (!ctx.whisperTo) return { kind: 'error', key: 'chat.err.noTarget' };
    return { kind: 'send', ch, to: ctx.whisperTo, text };
  }
  return { kind: 'send', ch, text };
}

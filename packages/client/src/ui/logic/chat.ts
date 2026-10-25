/** Chat dock logic that does not need a DOM. */
import type { ChatChannel } from '@murim/shared';
import type { ChatLine, ChatTabState } from '../../state/store';

/** Messages from others that arrived after `sinceKey` in any tab (used for the collapsed badge). */
export function unreadSince(chat: Record<ChatChannel, ChatTabState>, sinceKey: number): number {
  let n = 0;
  for (const tab of Object.values(chat)) for (const l of tab.lines) if (l.key > sinceKey && !l.self) n++;
  return n;
}

export function maxKey(chat: Record<ChatChannel, ChatTabState>): number {
  let m = 0;
  for (const tab of Object.values(chat)) {
    const last = tab.lines[tab.lines.length - 1];
    if (last && last.key > m) m = last.key;
  }
  return m;
}

/** Sent-message history (newest last, no consecutive duplicates, bounded). */
export function pushHistory(hist: readonly string[], text: string, max = 30): string[] {
  const t = text.trim();
  if (!t || hist[hist.length - 1] === t) return [...hist];
  const out = [...hist, t];
  return out.length > max ? out.slice(out.length - max) : out;
}

/** Step through history with Up (-1) / Down (+1). The cursor equals hist.length for the fresh, empty line. */
export function stepHistory(hist: readonly string[], cursor: number, dir: -1 | 1): { cursor: number; text: string } {
  const next = Math.max(0, Math.min(hist.length, cursor + dir));
  return { cursor: next, text: next >= hist.length ? '' : hist[next] };
}

/** For whisper lines: who is the other party, and in which direction. */
export function whisperParty(line: ChatLine, myName: string): { dir: 'from' | 'to'; other: string } {
  if (line.self || (line.from === myName && line.to)) return { dir: 'to', other: line.to ?? '' };
  return { dir: 'from', other: line.from };
}

const TWO = (n: number) => String(n).padStart(2, '0');
export function formatChatTime(ms: number): string {
  const d = new Date(ms);
  return `${TWO(d.getHours())}:${TWO(d.getMinutes())}`;
}

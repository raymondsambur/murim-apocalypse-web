/** The public world history: a paced, deduplicated ring buffer of short English lines. */
import type { ChronicleEntry, ChronicleKind } from '@murim/shared';
import { CHRON } from './constants';
import { dayOf, hourOfDay } from './clock';
import type { Ctx } from './types';
import { emit } from './util';

export interface ChronOpts {
  sid?: number;
  /** Dedupe key: an entry with the same key is dropped within `cooldown` hours. */
  key?: string;
  cooldown?: number;
  /** Bypass the daily caps (player-driven lines). */
  force?: boolean;
}

export function chron(ctx: Ctx, kind: ChronicleKind, text: string, importance: 1 | 2 | 3, opts: ChronOpts = {}): ChronicleEntry | null {
  const st = ctx.st;
  const ext = st.ext;
  const now = st.clock.totalHours;
  if (opts.key) {
    const last = ext.chronKeys[opts.key];
    if (last !== undefined && now - last < (opts.cooldown ?? 48)) return null;
  }
  const day = dayOf(now);
  if (ext.chronDay !== day) {
    ext.chronDay = day;
    ext.chronCount = [0, 0, 0];
  }
  if (!opts.force && importance < 3 && ext.chronCount[importance - 1] >= CHRON.dailyCap[importance - 1]) return null;
  ext.chronCount[importance - 1]++;
  if (opts.key) ext.chronKeys[opts.key] = now;
  const entry: ChronicleEntry = {
    id: st.nextChronicleId++,
    day,
    hour: hourOfDay(now),
    kind,
    text,
    importance,
    t: ctx.wallMs,
  };
  if (opts.sid !== undefined) entry.settlementId = opts.sid;
  st.chronicle.push(entry);
  if (st.chronicle.length > CHRON.size) st.chronicle.splice(0, st.chronicle.length - CHRON.size);
  emit(ctx, { k: 'chron', entry });
  return entry;
}

/** Drop dedupe keys older than 30 days so the map stays small. */
export function pruneChronKeys(ctx: Ctx): void {
  const now = ctx.st.clock.totalHours;
  const keys = ctx.st.ext.chronKeys;
  for (const k of Object.keys(keys)) if (now - keys[k] > 24 * 30) delete keys[k];
}

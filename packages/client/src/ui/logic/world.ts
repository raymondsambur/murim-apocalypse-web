/** Pure helpers for the World panel: chronicle filtering and paging, settlement and faction summaries, map colours. */
import { FACTION_BY_ID, reputationTitle, type ChronicleEntry, type ChronicleKind, type FactionBrief, type SettlementStatus, type SettlementView } from '@murim/shared';

export const CHRONICLE_KINDS: ChronicleKind[] = ['blight', 'faction', 'settlement', 'npc', 'weather', 'economy', 'player', 'legend', 'season'];
export const CHRONICLE_PAGE = 30;

export interface ChronicleFilter {
  kinds: ReadonlySet<ChronicleKind> | null;
  /** Minimum importance 1..3. */
  minImportance: 1 | 2 | 3;
  settlementId?: number | null;
}

export const NO_FILTER: ChronicleFilter = { kinds: null, minImportance: 1 };

export function matchesChronicle(e: ChronicleEntry, f: ChronicleFilter): boolean {
  if (e.importance < f.minImportance) return false;
  if (f.kinds && f.kinds.size && !f.kinds.has(e.kind)) return false;
  if (f.settlementId != null && e.settlementId !== f.settlementId) return false;
  return true;
}

/** Newest first. */
export function filterChronicle(list: readonly ChronicleEntry[], f: ChronicleFilter): ChronicleEntry[] {
  return list.filter((e) => matchesChronicle(e, f)).sort((a, b) => b.id - a.id || b.t - a.t);
}

/** Merge entries by id (later wins), keep sorted ascending by id. */
export function mergeChronicle(base: readonly ChronicleEntry[], extra: readonly ChronicleEntry[], limit = 600): ChronicleEntry[] {
  const map = new Map<number, ChronicleEntry>();
  for (const e of base) map.set(e.id, e);
  for (const e of extra) map.set(e.id, e);
  const out = [...map.values()].sort((a, b) => a.id - b.id);
  return out.length > limit ? out.slice(out.length - limit) : out;
}

export function oldestId(list: readonly ChronicleEntry[]): number | undefined {
  let min: number | undefined;
  for (const e of list) if (min === undefined || e.id < min) min = e.id;
  return min;
}

/** Entries visible on screen: `page` pages of CHRONICLE_PAGE from the filtered, newest-first list. */
export function pageChronicle(list: readonly ChronicleEntry[], f: ChronicleFilter, pages: number): { shown: ChronicleEntry[]; hasMoreLocal: boolean } {
  const all = filterChronicle(list, f);
  const n = Math.max(1, pages) * CHRONICLE_PAGE;
  return { shown: all.slice(0, n), hasMoreLocal: all.length > n };
}

/** Group newest-first entries by day for date headers. */
export function groupByDay(entries: readonly ChronicleEntry[]): { day: number; entries: ChronicleEntry[] }[] {
  const out: { day: number; entries: ChronicleEntry[] }[] = [];
  for (const e of entries) {
    const last = out[out.length - 1];
    if (last && last.day === e.day) last.entries.push(e);
    else out.push({ day: e.day, entries: [e] });
  }
  return out;
}

export const KIND_GLYPH: Record<ChronicleKind, string> = { blight: '蝕', faction: '旗', settlement: '城', npc: '人', weather: '天', economy: '貨', player: '俠', legend: '傳', season: '季' };

export function factionColor(id: string | null | undefined, fallback = '#8a8f99'): string {
  return (id && FACTION_BY_ID[id]?.color) || fallback;
}

export function factionName(id: string | null | undefined): string {
  return (id && FACTION_BY_ID[id]?.short) || '';
}

export const STATUS_ORDER: Record<SettlementStatus, number> = { besieged: 0, struggling: 1, stable: 2, thriving: 3, fallen: 4 };

export const STATUS_TONE: Record<SettlementStatus, 'good' | 'info' | 'warn' | 'bad' | 'dim'> = { thriving: 'good', stable: 'info', struggling: 'warn', besieged: 'bad', fallen: 'dim' };

export const STATUS_COLOR: Record<SettlementStatus, string> = { thriving: '#6bc17f', stable: '#d7c28a', struggling: '#e0a23a', besieged: '#e8574a', fallen: '#6b6b70' };

export type SettlementSort = 'status' | 'name' | 'prosperity' | 'blight';

export function sortSettlements<T extends { view: SettlementView; name: string }>(list: readonly T[], by: SettlementSort): T[] {
  const cmp: Record<SettlementSort, (a: T, b: T) => number> = {
    status: (a, b) => STATUS_ORDER[a.view.status] - STATUS_ORDER[b.view.status] || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    prosperity: (a, b) => b.view.prosperity - a.view.prosperity || a.name.localeCompare(b.name),
    blight: (a, b) => b.view.blight - a.view.blight || a.name.localeCompare(b.name),
  };
  return [...list].sort(cmp[by]);
}

/** Blight 0..255 as a 0..1 danger fraction and a label key. */
export function blightLevel(v: number): { frac: number; key: 'clean' | 'light' | 'heavy' | 'severe' } {
  const frac = Math.max(0, Math.min(1, v / 255));
  const key = v < 16 ? 'clean' : v < 64 ? 'light' : v < 128 ? 'heavy' : 'severe';
  return { frac, key };
}

export interface FactionRow {
  brief: FactionBrief;
  rep: number | null;
  repTitle: string | null;
}

export function factionRows(list: readonly FactionBrief[], reputation: Record<string, number> | undefined): FactionRow[] {
  return [...list]
    .sort((a, b) => b.power - a.power)
    .map((brief) => {
      const rep = reputation ? (reputation[brief.id] ?? 0) : null;
      return { brief, rep, repTitle: rep === null ? null : reputationTitle(rep) };
    });
}

/** Percent width for a faction bar relative to the largest value in the set (so bars stay readable). */
export function barPct(value: number, max: number): number {
  return max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
}

export function chronicleStamp(e: Pick<ChronicleEntry, 'day' | 'hour'>): { day: number; hour: string } {
  return { day: e.day + 1, hour: `${String(Math.floor(e.hour) % 24).padStart(2, '0')}:00` };
}

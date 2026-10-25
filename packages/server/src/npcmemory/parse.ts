/**
 * Turns chronicle lines (free text written by the sim) into structured rumor facts. The sim only gives us text, a kind,
 * an importance and an optional settlement, so this is a table of patterns that mirrors the sim's own phrasing.
 * Unknown lines yield null (no rumor). Add a rule here when the sim learns a new kind of line.
 */
import { FACTIONS, type ChronicleEntry, type DlgDeed, type DlgRumorKind } from '@murim/shared';
import type { RumorFacts } from './rumors';

export interface NameIndex {
  /** Settlement names, longest first. */
  settlements: { id: number; name: string }[];
  factions: { id: string; names: string[] }[];
}

export function buildNameIndex(settlements: readonly { id: number; name: string }[]): NameIndex {
  return {
    settlements: [...settlements].sort((a, b) => b.name.length - a.name.length).map((s) => ({ id: s.id, name: s.name })),
    factions: FACTIONS.map((f) => ({ id: f.id, names: [f.name, f.short] })),
  };
}

/** Settlement ids in order of first appearance in the text. */
export function settlementsIn(text: string, names: NameIndex): number[] {
  const hits: [number, number][] = [];
  let masked = text;
  for (const s of names.settlements) {
    const i = masked.indexOf(s.name);
    if (i >= 0) {
      hits.push([i, s.id]);
      masked = masked.slice(0, i) + ' '.repeat(s.name.length) + masked.slice(i + s.name.length);
    }
  }
  return hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]);
}

/** Faction ids in order of first appearance. */
export function factionsIn(text: string, names: NameIndex): string[] {
  const hits: [number, string][] = [];
  for (const f of names.factions) {
    let best = -1;
    for (const n of f.names) {
      const i = text.indexOf(n);
      if (i >= 0 && (best < 0 || i < best)) best = i;
    }
    if (best >= 0) hits.push([best, f.id]);
  }
  return hits.sort((a, b) => a[0] - b[0]).map((h) => h[1]);
}

export interface ParsedRumor {
  kind: DlgRumorKind;
  facts: RumorFacts;
  topic: 'chronicle' | 'player' | 'local';
}

const leadName = (text: string, re: RegExp): string | undefined => re.exec(text)?.[1]?.trim();

/** Parse one chronicle entry. `importance` and `settlementId` come from the entry itself. */
export function parseChronicle(entry: ChronicleEntry, names: NameIndex): ParsedRumor | null {
  const t = entry.text;
  const sets = settlementsIn(t, names);
  const facs = factionsIn(t, names);
  const place = entry.settlementId ?? sets[0];
  const mk = (kind: DlgRumorKind, extra: Partial<RumorFacts> = {}, topic: ParsedRumor['topic'] = entry.kind === 'player' ? 'player' : entry.importance === 1 ? 'local' : 'chronicle'): ParsedRumor => ({
    kind,
    topic,
    facts: { kind, place, sev: 0, ...extra },
  });

  // ---- sieges and their outcomes
  if (/lay siege to/.test(t)) return mk('siege', { place: sets[0] ?? place, faction: facs[0] });
  if (/Hollows pour out|tide of Hollows|dead walk on/.test(t)) return mk('hollowSiege');
  if (/withstood the Hollow siege/.test(t)) return mk('held');
  if (/drove the .* from the gates|turned back the/.test(t)) return mk('held', { place: sets[0] ?? place, faction: facs[1] ?? facs[0] });
  if (/has fallen to the Blight/.test(t)) return mk('fell', { place: sets[0] ?? place });
  if (/\bseized\b/.test(t)) return mk('captured', { place: sets[0] ?? place, faction: facs[0], faction2: facs[1] });
  if (/\bplundered\b/.test(t)) return mk('plundered', { place: sets[0] ?? place, faction: facs[0] });
  if (/retaken .* from the Blight|Survivors return to the ruins/.test(t)) return mk('retaken', { place: sets[0] ?? place, faction: facs[0] });
  if (/rise against|thrown off the rule/.test(t)) return mk('uprising', { place: sets[0] ?? place, faction: facs[0] });
  if (/accepted the protection of/.test(t)) return mk('captured', { place: sets[0] ?? place, faction: facs[0] });

  // ---- hunger, sickness, fortune
  if (/Famine grips/.test(t)) return mk('famine');
  if (/famine in .* has eased/.test(t)) return mk('famineEnd');
  if (/Plague breaks out|wasting fever spreads/.test(t)) return mk('plague');
  if (/plague in .* has run its course/.test(t)) return mk('plagueEnd');
  if (/festival|Lanterns and drums/i.test(t)) return mk('festival');
  if (/Trade booms|prospers; its markets overflow/.test(t)) return mk('boom');
  if (/Hard times have come/.test(t)) return mk('hardTimes');
  if (/Refugees from/.test(t)) return mk('refugees', { place: sets[0] ?? place });

  // ---- the Blight
  const sealed = /was sealed by (.+?)!/.exec(t);
  if (sealed) return mk('heartSealed', { who: sealed[1].replace(/^the /, ''), place: sets[0] ?? place }, 'player');
  if (/wounded the Blight heart/.test(t)) return mk('heartWounded', { who: leadName(t, /^(.+?) wounded the Blight heart/), place: sets[0] ?? place });
  if (/stirs again|convulses/.test(t)) return mk('heartStirs', { place: sets[0] ?? place });
  if (/has reached the outskirts|presses against the walls/.test(t)) return mk('blightAdvance');
  if (/The Blight recedes from/.test(t)) return mk('blightRecede');
  if (/expedition against the Blight heart .* lost to the Hollows/.test(t)) return mk('expedition', { place: sets[0] ?? place, faction: facs[0] });

  // ---- roads and trade
  if (/choked by the Blight; caravans have stopped/.test(t)) return mk('roadBlocked', { place: sets[0], place2: sets[1] });
  if (/Caravans move again/.test(t)) return mk('caravan', { place: sets[0], place2: sets[1] });
  const hauls = /hauls (\d+) units .* from (.+?) to (.+?)\./.exec(t);
  if (hauls) return mk('caravan', { place: sets[1] ?? place, place2: sets[0], n: Number(hauls[1]) });

  // ---- politics
  if (/declared war on/.test(t)) return mk('war', { faction: facs[0], faction2: facs[1], place: undefined });
  if (/agreed to a truce/.test(t)) return mk('truce', { faction: facs[0], faction2: facs[1], place: undefined });
  if (/sworn an alliance/.test(t)) return mk('alliance', { faction: facs[0], faction2: facs[1], place: undefined });

  // ---- people
  if (/is now counted among the legends/.test(t)) return mk('legendRise', { who: leadName(t, /^(.+?),/) });
  if (entry.kind === 'legend' && /has (been seen in|come to)/.test(t)) return mk('legendSeen', { who: leadName(t, /^The legend (.+?),/), place: sets[0] ?? place });
  if (/takes the mantle|has come to teach|has become the new/.test(t)) return mk('newMaster', { who: leadName(t, /^(?:Master |Elder )?(.+?)(?:,| has| takes)/), place });
  if ((entry.kind === 'npc' || entry.kind === 'legend') && /has died|has succumbed|was slain|fell in the fighting|has died \(/.test(t)) {
    return mk('npcDeath', { who: leadName(t, /^(?:Master |Elder |The legend )(.+?)(?:,| of| has| was| fell)/) ?? leadName(t, /^(.+?) (?:has|was|fell)/), place });
  }

  // ---- player deeds the sim already wrote down
  if (entry.kind === 'player' || entry.kind === 'blight' || entry.kind === 'settlement' || entry.kind === 'economy') {
    const who = leadName(t, /^(.+?) (?:slew|cleansed|rallied|brought relief|returned from)/);
    if (who) {
      let deed: DlgDeed | null = null;
      if (/slew the/.test(t)) deed = 'completedMission';
      else if (/cleansed the Blight/.test(t)) deed = 'purified';
      else if (/rallied the defenders/.test(t)) deed = 'savedTown';
      else if (/brought relief/.test(t)) deed = 'deliveredGoods';
      if (deed) return mk('playerDeed', { who, deed, place: sets[0] ?? place }, 'player');
    }
  }
  return null;
}
